"""Read-only EA1/RA1 interference map. No optimizer."""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any

import torch
from safetensors.torch import load_file as load_safetensors_file
from tokenizers import Tokenizer

from run000007_preflight import resolve_dump_root, sha256_file
from wrim_g20m_ra1 import EA1_PREFIX, PLACEMENT_B, RA1_PREFIX, WRIMRA1Model
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT
from wrim_plm1_encode import encode_example, prefix_ids_for_inference
from wrim_proven_load import disable_tf32
from wrim_ra1_grad_corpus import NAT_DIR, PHRASE_ALIGN_DIR
from wrim_ra1_phrase_diagnostic import _pos_stats
from wrim_ra1_phrase_school import load_rows
from wrim_resumable_checkpoint import MODEL_NAME

PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-EA1-000010" / "step-25"
EXPECT = "8e6505954602961d7b432362b67633aa1cc798f7a7b4262624edb3ed213323fb"
NAT_LOST = [
    Path(CKPT_BASE) / "WRIM1-UH1-AC2-EA1-000011" / "step-25",
    Path(CKPT_BASE) / "WRIM1-UH1-AC2-EA1-000012" / "step-25",
]
OUT = Path(DATA_ROOT) / "WRIM_EA1_RA1_NATURAL_INTERFERENCE_MAP.json"


def _load(ckpt: Path, device: torch.device) -> WRIMRA1Model:
    model = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32, ea1=True)
    missing, unexpected = model.load_state_dict(load_safetensors_file(str(ckpt / MODEL_NAME)), strict=False)
    extra = set(missing) - {n for n, _ in model.named_parameters() if n.startswith(EA1_PREFIX) or n.startswith(RA1_PREFIX)} - {"assistant_stop_ctrl"}
    if extra or unexpected:
        raise RuntimeError(f"load mismatch {ckpt} extra={extra} unexpected={unexpected}")
    return model.to(device).eval()


def _adapter_l2(a: WRIMRA1Model, b: WRIMRA1Model) -> dict[str, float]:
    ea1 = 0.0
    ra1 = 0.0
    sa = a.state_dict()
    sb = b.state_dict()
    for k, va in sa.items():
        vb = sb[k]
        d = float((va.detach().cpu().float() - vb.detach().cpu().float()).pow(2).sum().item())
        if k.startswith(EA1_PREFIX):
            ea1 += d
        elif k.startswith(RA1_PREFIX):
            ra1 += d
    return {"EA1_L2": ea1 ** 0.5, "RA1_L2": ra1 ** 0.5, "COMBINED_L2": (ea1 + ra1) ** 0.5}


def _family_probe(model: WRIMRA1Model, tok: Any, device: torch.device, rows: list[dict[str, Any]]) -> dict[str, Any]:
    by: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    for rec in rows:
        enc = encode_example(tok, rec)
        tgt = [int(x) for x in enc["target_ids"]]
        prefix = prefix_ids_for_inference(tok, rec["prompt"])
        fam = str(rec.get("first_token_class") or rec.get("family") or "unk")
        for k, gold in enumerate(tgt, start=1):
            stats = _pos_stats(model, device, prefix + tgt[: k - 1], gold)
            stats["gold_match"] = int(stats["top1_id"] == gold)
            by[fam][str(k)].append(stats)
    out: dict[str, Any] = {}
    for fam, positions in by.items():
        pos_out = {}
        for k, rs in positions.items():
            n = len(rs)
            pos_out[k] = {
                "n": n,
                "gold_match": sum(int(r["gold_match"]) for r in rs),
                "mean_rank": sum(float(r["target_rank"]) for r in rs) / n,
                "mean_prob": sum(float(r["target_probability"]) for r in rs) / n,
                "mean_gap": sum(float(r["target_top1_gap"]) for r in rs) / n,
                "mean_ea1_residual": sum(float(r["ea1_residual_contribution_norm"]) for r in rs) / n,
                "mean_ra1_residual": sum(float(r["ra1_residual_contribution_norm"]) for r in rs) / n,
                "mean_ea1_out": sum(float(r["ea1_output_norm"]) for r in rs) / n,
                "mean_ra1_out": sum(float(r["ra1_output_norm"]) for r in rs) / n,
                "mean_entry": sum(float(r["entry"]) for r in rs) / n,
                "mean_span": sum(float(r["span"]) for r in rs) / n,
                "mean_eos_gap": sum(float(r["eos_gap"]) for r in rs) / n,
                "competitors": sorted({tok.id_to_token(int(r["top1_id"])) for r in rs}),
            }
        out[fam] = pos_out
    return out


def _delta(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "mean_rank",
        "mean_prob",
        "mean_gap",
        "mean_ea1_residual",
        "mean_ra1_residual",
        "mean_ea1_out",
        "mean_ra1_out",
        "mean_eos_gap",
        "gold_match",
    )
    out: dict[str, Any] = {}
    for fam, positions in a.items():
        fam_d = {}
        for k, row in positions.items():
            other = (b.get(fam) or {}).get(k) or {}
            fam_d[k] = {key: float(row.get(key) or 0) - float(other.get(key) or 0) for key in keys}
            fam_d[k]["parent_competitors"] = (b.get(fam) or {}).get(k, {}).get("competitors")
            fam_d[k]["now_competitors"] = row.get("competitors")
        out[fam] = fam_d
    return out


def classify(delta: dict[str, Any], weight_l2: dict[str, float]) -> str:
    dog1 = ((delta.get("dog") or {}).get("1") or {})
    dog4 = ((delta.get("dog") or {}).get("4") or {})
    cat1 = ((delta.get("cat") or {}).get("1") or {})
    nat_entry = []
    for fam in ("yes", "no", "ok", "json"):
        nat_entry.append(((delta.get(fam) or {}).get("1") or {}).get("mean_ea1_residual") or 0)
    ea1_dog = abs(float(dog1.get("mean_ea1_residual") or 0))
    ra1_dog_span = abs(float(((delta.get("dog") or {}).get("2") or {}).get("mean_ra1_residual") or 0)) + abs(
        float(((delta.get("dog") or {}).get("3") or {}).get("mean_ra1_residual") or 0)
    )
    eos = float(dog4.get("mean_eos_gap") or 0)
    dog_match = float(dog1.get("gold_match") or 0)
    cat_match = float(cat1.get("gold_match") or 0)
    votes: list[str] = []
    if ea1_dog > 0.05 and ea1_dog >= ra1_dog_span:
        votes.append("ENTRY_INTERFERENCE")
    if ra1_dog_span > 0.05 and ra1_dog_span > ea1_dog:
        votes.append("SPAN_INTERFERENCE")
    if eos > 0.4:
        votes.append("EOS_INTERFERENCE")
    if dog_match < -2 or cat_match < -1:
        votes.append("SHARED_SEMANTIC_DIRECTION_INTERFERENCE")
    if abs(weight_l2["EA1_L2"]) > abs(weight_l2["RA1_L2"]) * 1.2 and ea1_dog > 0.02:
        votes.append("ENTRY_INTERFERENCE")
    if abs(weight_l2["RA1_L2"]) > abs(weight_l2["EA1_L2"]) * 1.2:
        votes.append("SPAN_INTERFERENCE")
    if not votes:
        return "LATE_TOKEN_INTERFERENCE" if abs(float(((delta.get("dog") or {}).get("4") or {}).get("gold_match") or 0)) >= 2 else "UNCLEAR"
    # Prefer shared semantic if phrase families that share labels moved at entry.
    if "SHARED_SEMANTIC_DIRECTION_INTERFERENCE" in votes and "ENTRY_INTERFERENCE" in votes:
        return "SHARED_SEMANTIC_DIRECTION_INTERFERENCE"
    return votes[0]


def main() -> dict[str, Any]:
    if sha256_file(PARENT / MODEL_NAME) != EXPECT:
        raise SystemExit("000010 hash mismatch")
    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dump = resolve_dump_root(None)
    tok = Tokenizer.from_file(str(dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"))
    phrase = load_rows(PHRASE_ALIGN_DIR / "val.jsonl")
    natural = load_rows(NAT_DIR / "val.jsonl")
    parent_model = _load(PARENT, device)
    parent_probe = {
        "phrase": _family_probe(parent_model, tok, device, phrase),
        "natural": _family_probe(parent_model, tok, device, natural),
    }
    comparisons = []
    for ckpt in NAT_LOST:
        if not (ckpt / MODEL_NAME).is_file():
            continue
        model = _load(ckpt, device)
        probe = {
            "phrase": _family_probe(model, tok, device, phrase),
            "natural": _family_probe(model, tok, device, natural),
        }
        weights = _adapter_l2(model, parent_model)
        d_phrase = _delta(probe["phrase"], parent_probe["phrase"])
        d_nat = _delta(probe["natural"], parent_probe["natural"])
        label = classify(d_phrase, weights)
        comparisons.append({
            "CHECKPOINT": str(ckpt),
            "HASH": sha256_file(ckpt / MODEL_NAME),
            "ADAPTER_WEIGHT_L2_VS_000010": weights,
            "PHRASE_DELTA_VS_000010": d_phrase,
            "NATURAL_DELTA_VS_000010": d_nat,
            "INTERFERENCE_CLASSIFICATION": label,
        })
        del model
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    labels = [c["INTERFERENCE_CLASSIFICATION"] for c in comparisons]
    primary = labels[0] if labels else "UNCLEAR"
    if labels.count("SHARED_SEMANTIC_DIRECTION_INTERFERENCE") >= 1:
        primary = "SHARED_SEMANTIC_DIRECTION_INTERFERENCE"
    report = {
        "PARENT": str(PARENT),
        "PARENT_HASH": EXPECT,
        "OPTIMIZER_STEPS": 0,
        "KNOWN_NATURAL_TRAIN_COLLISION": "previous natural forms used cat/dog one-word labels that share token-1 classes with phrase families",
        "PARENT_PROBE": parent_probe,
        "COMPARISONS": comparisons,
        "INTERFERENCE_CLASSIFICATION": primary,
        "RECOMMENDED_NATURAL_SHARE": "LOW",
        "RECOMMENDED_DROP_COLLIDING_LABELS": True,
        "RECOMMENDED_PHRASE_REHEARSAL": "HIGH",
    }
    OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    del parent_model
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return {
        "INTERFERENCE_CLASSIFICATION": primary,
        "COMPARISONS": [
            {
                "ckpt": Path(c["CHECKPOINT"]).parent.name,
                "class": c["INTERFERENCE_CLASSIFICATION"],
                "l2": c["ADAPTER_WEIGHT_L2_VS_000010"],
                "dog1_match_delta": ((c["PHRASE_DELTA_VS_000010"].get("dog") or {}).get("1") or {}).get("gold_match"),
                "dog1_ea1": ((c["PHRASE_DELTA_VS_000010"].get("dog") or {}).get("1") or {}).get("mean_ea1_residual"),
                "dog2_ra1": ((c["PHRASE_DELTA_VS_000010"].get("dog") or {}).get("2") or {}).get("mean_ra1_residual"),
                "dog4_eos": ((c["PHRASE_DELTA_VS_000010"].get("dog") or {}).get("4") or {}).get("mean_eos_gap"),
            }
            for c in comparisons
        ],
        "OUT": str(OUT),
    }


if __name__ == "__main__":
    print(json.dumps(main(), indent=2))
