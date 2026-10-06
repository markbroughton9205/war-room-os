"""Read-only phrase-position diagnostic. No optimizer."""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any

import torch
import torch.nn.functional as F
from safetensors.torch import load_file as load_safetensors_file
from tokenizers import Tokenizer

from run000007_preflight import resolve_dump_root, sha256_file
from wrim_cpt_eval import greedy_from_ids
from wrim_cpt_identity import COMMANDER_ID, EOS_ID
from wrim_g20m_ra1 import PLACEMENT_B, WRIMRA1Model
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT
from wrim_plm1_encode import encode_example, prefix_ids_for_inference
from wrim_proven_load import disable_tf32
from wrim_resumable_checkpoint import MODEL_NAME

PHRASE_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-SHORT-PHRASE-ALIGN-1-v1.0.0" / "val.jsonl"
OUT = Path(DATA_ROOT) / "WRIM_RA1_B32_PHRASE_POSITION_DIAGNOSTIC.json"
PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-RA1-PS-000004" / "step-12"
EXPECT = "119185bd4102d7078aca19e3eae75800364b4f22e200855f361ca2b3ee08f806"


def _rows() -> list[dict[str, Any]]:
    return [json.loads(line) for line in PHRASE_VAL.read_text(encoding="utf-8").splitlines() if line.strip()]


def _pos_stats(model: WRIMRA1Model, device: torch.device, ctx: list[int], target_id: int) -> dict[str, Any]:
    idx = torch.tensor([ctx], dtype=torch.long, device=device)
    with torch.inference_mode():
        x = model.tok_emb(idx)
        for layer in model.layers:
            x = layer(x)
        x = model.norm_f(x)
        x = model._apply_controls(x, idx)
        masks = model.control_masks(idx)
        span = masks["span"][0, -1]
        entry = masks["entry"][0, -1]
        base = x[0, -1]
        ra1_delta = model.ra1.delta(x)[0, -1]
        residual = span.to(dtype=base.dtype) * ra1_delta
        adj = base + residual
        if model.ea1 is not None:
            ea1_delta = model.ea1.delta(x)[0, -1]
            ea1_residual = entry.to(dtype=base.dtype) * ea1_delta
            adj = adj + ea1_residual
        else:
            ea1_delta = torch.zeros_like(base)
            ea1_residual = torch.zeros_like(base)
        logits = F.linear(adj, model.lm_head.weight)
        base_logits = F.linear(base, model.lm_head.weight)
    target = int(target_id)
    logit_t = logits[target]
    top1 = int(torch.argmax(logits).item())
    top1_logit = logits[top1]
    prob = torch.softmax(logits, dim=0)[target]
    rank = 1 + int((logits > logit_t).sum().item())
    row = model.lm_head.weight[target]
    cos_base = F.cosine_similarity(base.unsqueeze(0), row.unsqueeze(0)).item()
    cos_adj = F.cosine_similarity(adj.unsqueeze(0), row.unsqueeze(0)).item()
    return {
        "span": bool(span.item()),
        "target_rank": rank,
        "target_probability": float(prob.item()),
        "target_logit": float(logit_t.item()),
        "top1_id": top1,
        "top1_logit": float(top1_logit.item()),
        "target_top1_gap": float((top1_logit - logit_t).item()),
        "token_ce": float((-torch.log(prob.clamp_min(1e-12))).item()),
        "ra1_input_hidden_norm": float(base.norm().item()),
        "ra1_output_norm": float(ra1_delta.norm().item()),
        "ra1_residual_contribution_norm": float(residual.norm().item()),
        "ea1_output_norm": float(ea1_delta.norm().item()),
        "ea1_residual_contribution_norm": float(ea1_residual.norm().item()),
        "entry": bool(entry.item()),
        "cosine_base_to_target_row": float(cos_base),
        "cosine_ra1_adjusted_to_target_row": float(cos_adj),
        "base_top1_id": int(torch.argmax(base_logits).item()),
        "eos_logit": float(logits[EOS_ID].item()),
        "eos_gap": float((logits[EOS_ID] - logit_t).item()),
    }


def document_parity(model: WRIMRA1Model, device: torch.device) -> dict[str, Any]:
    idx = torch.tensor([[1, COMMANDER_ID, 9, 10, 11, 12]], dtype=torch.long, device=device)
    with torch.inference_mode():
        span = model.control_masks(idx)["span"]
        before = model(idx)
        saved = model.ra1.up.weight.detach().clone()
        model.ra1.up.weight.zero_()
        after = model(idx)
        model.ra1.up.weight.copy_(saved)
    diff = float((before - after).abs().max().item())
    return {
        "DOCUMENT_PARITY": "PASS" if diff < 1e-5 and not bool(span.any().item()) else "FAIL",
        "MAX_ABS_LOGIT_DIFF": diff,
        "SPAN_ANY": bool(span.any().item()),
    }


def _mean(rows: list[dict[str, Any]], key: str) -> float | None:
    vals = [float(r[key]) for r in rows if r.get(key) is not None]
    return sum(vals) / len(vals) if vals else None


def classify(by_family: dict[str, Any]) -> dict[str, str]:
    cat = by_family.get("cat") or {}
    dog = by_family.get("dog") or {}
    cat_pos = cat.get("positions") or {}
    dog_pos = dog.get("positions") or {}
    p1 = cat_pos.get("1") or {}
    if int(p1.get("gold_match") or 0) == 0 and float(p1.get("span_rate") or 0) == 0.0:
        cat_block = "CAT_TOKEN1_BLOCKED"
    elif int((cat_pos.get("3") or {}).get("gold_given_prefix_match") or 0) == 0:
        cat_block = "CAT_TOKEN3_BLOCKED"
    else:
        cat_block = "CAT_PREFIX_CONDITIONING_FAILURE"
    secondary = "NONE"
    if cat_block == "CAT_TOKEN1_BLOCKED" and int((cat_pos.get("3") or {}).get("gold_given_prefix_match") or 0) == 0:
        secondary = "CAT_TOKEN3_BLOCKED_GIVEN_GOLD_PREFIX"
    d4 = dog_pos.get("4") or {}
    if float(d4.get("mean_eos_gap") or -1) > 0 and int(d4.get("gold_match") or 0) == 0:
        dog_block = "EOS_COMPETITION"
    elif int(d4.get("gold_match") or 0) == 0:
        dog_block = "TOKEN4_SELECTION_FAILURE"
    else:
        dog_block = "PREFIX_REPRESENTATION_FAILURE"
    return {
        "CAT_PRIMARY_BLOCK": cat_block,
        "CAT_SECONDARY_BLOCK": secondary,
        "DOG_PRIMARY_BLOCK": dog_block,
        "CAT_TOKEN1_RA1_RESIDUAL": "ZERO",
        "DOG_TOKEN4_GREEDY": "EOS",
    }


def run(ckpt: Path = PARENT) -> dict[str, Any]:
    if sha256_file(ckpt / MODEL_NAME) != EXPECT and ckpt == PARENT:
        raise RuntimeError("parent hash mismatch")
    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dump = resolve_dump_root(None)
    tok = Tokenizer.from_file(str(dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"))
    model = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32, ea1=True)
    missing, unexpected = model.load_state_dict(load_safetensors_file(str(ckpt / MODEL_NAME)), strict=False)
    extra = set(missing) - {n for n, _ in model.named_parameters() if n.startswith("ea1.") or n.startswith("ra1.")} - {"assistant_stop_ctrl"}
    if extra or unexpected:
        raise RuntimeError(f"diag load mismatch extra={extra} unexpected={unexpected}")
    model.to(device).eval()
    parity = document_parity(model, device)
    examples = []
    families: dict[str, dict[str, Any]] = {}
    confusion = defaultdict(int)
    for rec in _rows():
        enc = encode_example(tok, rec)
        tgt = [int(x) for x in enc["target_ids"]]
        prefix = prefix_ids_for_inference(tok, rec["prompt"])
        gen = greedy_from_ids(model, tok, device, prefix, max_new=8)
        new = list(gen.get("new_ids") or [])
        eos = bool(gen.get("eos"))
        body = new[:-1] if eos else new
        depth = 0
        for a, b in zip(body, tgt):
            if a != b:
                break
            depth += 1
        fam = str(rec.get("first_token_class") or "unk")
        positions = []
        for k, gold in enumerate(tgt, start=1):
            ctx = prefix + tgt[: k - 1]
            stats = _pos_stats(model, device, ctx, gold)
            stats["position"] = k
            stats["gold_id"] = gold
            stats["gold_token"] = tok.id_to_token(gold)
            stats["greedy_token"] = tok.id_to_token(stats["top1_id"])
            stats["gold_match"] = int(stats["top1_id"] == gold)
            positions.append(stats)
            if stats["top1_id"] != gold:
                confusion[f"{fam}-> {stats['greedy_token']}"] += 1
        exact = int(body == tgt and eos)
        examples.append({
            "example_id": rec.get("example_id"),
            "family": fam,
            "target": rec.get("target"),
            "free_depth": depth,
            "exact": exact,
            "free_body": [tok.id_to_token(i) for i in body[:6]],
            "positions": positions,
        })
        bucket = families.setdefault(fam, {"n": 0, "exact": 0, "depths": [], "positions": defaultdict(list)})
        bucket["n"] += 1
        bucket["exact"] += exact
        bucket["depths"].append(depth)
        for pos in positions:
            bucket["positions"][pos["position"]].append(pos)
    summary = {}
    for fam, bucket in families.items():
        pos_out = {}
        for k, rows in bucket["positions"].items():
            pos_out[str(k)] = {
                "n": len(rows),
                "gold_match": sum(int(r["gold_match"]) for r in rows),
                "gold_given_prefix_match": sum(int(r["gold_match"]) for r in rows),
                "span_rate": _mean(rows, "span"),
                "mean_rank": _mean(rows, "target_rank"),
                "mean_probability": _mean(rows, "target_probability"),
                "mean_ce": _mean(rows, "token_ce"),
                "mean_gap": _mean(rows, "target_top1_gap"),
                "mean_residual_norm": _mean(rows, "ra1_residual_contribution_norm"),
                "mean_delta_norm": _mean(rows, "ra1_output_norm"),
                "mean_cosine_base": _mean(rows, "cosine_base_to_target_row"),
                "mean_cosine_adjusted": _mean(rows, "cosine_ra1_adjusted_to_target_row"),
                "mean_eos_gap": _mean(rows, "eos_gap"),
                "greedy_tokens": sorted({r["greedy_token"] for r in rows}),
            }
        summary[fam] = {
            "n": bucket["n"],
            "exact": bucket["exact"],
            "mean_free_depth": sum(bucket["depths"]) / len(bucket["depths"]),
            "positions": pos_out,
        }
    labels = classify(summary)
    # Interference: cat/dog greedy attractors that are blue or no tokens.
    blue_no = {"blue", "no", "Ġblue", "Ġno"}
    attract = []
    for ex in examples:
        if ex["family"] not in {"cat", "dog"} or ex["exact"]:
            continue
        wrong = [p for p in ex["positions"] if not p["gold_match"]]
        if not wrong:
            continue
        first_wrong = wrong[0]
        attract.append({
            "family": ex["family"],
            "position": first_wrong["position"],
            "gold": first_wrong["gold_token"],
            "greedy": first_wrong["greedy_token"],
            "toward_blue_or_no": first_wrong["greedy_token"] in blue_no or "blue" in str(first_wrong["greedy_token"]) or str(first_wrong["greedy_token"]).endswith("no"),
        })
    toward = sum(1 for a in attract if a["toward_blue_or_no"])
    interference = "NO_BLUE_NO_SUPPRESSION" if toward == 0 else "BLUE_NO_ATTRACTION_PRESENT"
    report = {
        "CHECKPOINT": str(ckpt),
        "HASH": sha256_file(ckpt / MODEL_NAME),
        "OPTIMIZER_STEPS": 0,
        "DOCUMENT_PARITY": parity,
        "FAMILIES": summary,
        "CONFUSION": dict(confusion),
        "ATTRACTORS": attract,
        "INTERFERENCE_RESULT": interference,
        **labels,
        "EXAMPLES": examples,
    }
    if ckpt == PARENT:
        OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    del model
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return report


if __name__ == "__main__":
    rep = run()
    print(json.dumps({
        "CAT_PRIMARY_BLOCK": rep["CAT_PRIMARY_BLOCK"],
        "DOG_PRIMARY_BLOCK": rep["DOG_PRIMARY_BLOCK"],
        "INTERFERENCE_RESULT": rep["INTERFERENCE_RESULT"],
        "DOCUMENT_PARITY": rep["DOCUMENT_PARITY"],
        "FAMILIES": {k: {"exact": v["exact"], "depth": v["mean_free_depth"], "positions": v["positions"]} for k, v in rep["FAMILIES"].items()},
    }, indent=2))
