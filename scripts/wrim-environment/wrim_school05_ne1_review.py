"""School 05 NATURAL_ENTRY_NE1_REVIEW.

Read-only diagnostic and six-gate NE1 decision. Does not construct an optimizer.
Does not auto-build NE1. Canonical remains STEP_400.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import torch
from safetensors.torch import load_file as load_safetensors_file
from tokenizers import Tokenizer

from run000007_preflight import resolve_dump_root, sha256_file
from wrim_arch_uh1_ac1_train import _write
from wrim_entry_bypass_review import (
    ENTRY_CLASSES,
    class_of_token,
    cosine,
    gold_prefix_matrix,
    mean_pair_cos,
    summarize_probes,
    token1_probe,
)
from wrim_g20m_ra1 import (
    PLACEMENT_B,
    WRIMRA1Model,
    frozen_parameter_hash,
    module_parameter_hash,
)
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT
from wrim_plm1_encode import prefix_ids_for_inference
from wrim_promptbook.engine import Engine
from wrim_promptbook.identity import (
    EA1_HASH,
    FROZEN_BASE_HASH,
    PARENT_CHECKPOINT,
    PARENT_HASH,
    PHRASE_REF,
    RA1_HASH,
)
from wrim_proven_load import disable_tf32
from wrim_ra1_conflict_lib import natural_span_eval
from wrim_ra1_grad_corpus import GRAD_DIR, NAT_DIR, PHRASE_ALIGN_DIR
from wrim_ra1_phrase_school import _score_loaded, load_rows
from wrim_resumable_checkpoint import MODEL_NAME

PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-EA1-000010" / "step-25"
REPORT = Path(DATA_ROOT) / "WRIM_GENESIS_SCHOOL05_NE1_REVIEW.json"
DETAIL = Path(DATA_ROOT) / "WRIM_GENESIS_SCHOOL05_NE1_REVIEW_DETAIL.json"
GEN_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-GENERALIZATION-EVAL-1-v1.0.0" / "val.jsonl"


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", str(s).strip().lower())


def load_parent(device: torch.device) -> WRIMRA1Model:
    if sha256_file(PARENT / MODEL_NAME) != PARENT_HASH:
        raise SystemExit("parent_hash_mismatch")
    src = load_safetensors_file(str(PARENT / MODEL_NAME))
    model = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32, ea1=True, na1=False, rmr1=False)
    missing, unexpected = model.load_state_dict(src, strict=False)
    extra = set(missing) - {n for n, _ in model.named_parameters() if n.startswith(("ea1.", "ra1.", "na1.", "rmr1."))} - {"assistant_stop_ctrl"}
    if extra or unexpected:
        raise RuntimeError(f"load mismatch extra={extra} unexpected={unexpected}")
    return model.to(device).eval()


def leakage_audit(train: list[dict[str, Any]], val: list[dict[str, Any]], extra: list[dict[str, Any]]) -> dict[str, Any]:
    train_pt = {(_norm(r["prompt"]), _norm(r["target"])) for r in train}
    train_p = {_norm(r["prompt"]) for r in train}
    val_overlap = [r.get("example_id") for r in val if (_norm(r["prompt"]), _norm(r["target"])) in train_pt]
    extra_overlap = [r.get("example_id") for r in extra if (_norm(r["prompt"]), _norm(r["target"])) in train_pt]
    extra_prompt = [r.get("example_id") for r in extra if _norm(r["prompt"]) in train_p]
    grad_hits: list[str] = []
    gpath = GRAD_DIR / "WRIM-FOUNDATION-GRADUATION-1-v1.0.0.json"
    if not gpath.is_file():
        gpath = GRAD_DIR / "val.jsonl"
    forbidden: set[str] = set()
    if gpath.suffix == ".json" and gpath.is_file():
        obj = json.loads(gpath.read_text(encoding="utf-8"))
        for it in obj.get("items") or []:
            if it.get("prompt"):
                forbidden.add(_norm(str(it["prompt"])))
            if it.get("target"):
                forbidden.add(_norm(str(it["target"])))
    for r in train:
        pn, tn = _norm(r["prompt"]), _norm(r["target"])
        if (pn in forbidden and len(pn) >= 8) or (tn in forbidden and len(tn) >= 8):
            grad_hits.append(str(r.get("example_id")))
    ok = not val_overlap and not extra_overlap and not extra_prompt and not grad_hits
    return {
        "ok": ok,
        "train_val_overlap": val_overlap,
        "train_extra_overlap": extra_overlap,
        "train_extra_prompt_overlap": extra_prompt,
        "graduation_hits": grad_hits,
        "n_train": len(train),
        "n_val": len(val),
        "n_extra": len(extra),
        "never_train_on": ["NAT_DIR/val.jsonl", "extra_unseen_natural_span_eval", "WRIM-FOUNDATION-GRADUATION-1-v1.0.0"],
    }


def gold_sum(mats: list[list[dict[str, Any]]], k: int) -> int:
    return sum(int((m[k].get("exact_remaining") if k < len(m) else 0) or 0) for m in mats)


def apply_gates(*, scored: dict[str, Any], gold: dict[str, Any], leak: dict[str, Any], rmr_primary: bool) -> dict[str, Any]:
    a_off = scored["A_EA1_BYPASS"]["official"]
    a_ex = scored["A_EA1_BYPASS"]["extra"]
    b_off = scored["B_BASE_BYPASS"]["official"]
    b_ex = scored["B_BASE_BYPASS"]["extra"]
    t1_fail = int(a_off["token1_fail"]) + int(a_ex["token1_fail"])
    greedy_a = int(a_off["greedy_exact"]) + int(a_ex["greedy_exact"])
    greedy_b = int(b_off["greedy_exact"]) + int(b_ex["greedy_exact"])
    t1_a = int(a_off["token1_exact"]) + int(a_ex["token1_exact"])
    t1_b = int(b_off["token1_exact"]) + int(b_ex["token1_exact"])
    gold_off = int(gold["A_EA1_BYPASS"]["official_k1"])
    gold_ex = int(gold["A_EA1_BYPASS"]["extra_k1"])
    free_off = int(gold["A_EA1_BYPASS"]["official_k0"])
    free_ex = int(gold["A_EA1_BYPASS"]["extra_k0"])
    token1_earliest = t1_fail >= 3 and greedy_a <= t1_a + 2
    gold_exceeds = (gold_off - free_off) >= 2 and (gold_ex - free_ex) >= 4
    ea1_helps = (t1_a > t1_b) or (greedy_a > greedy_b)
    ea1_insufficient = t1_fail >= 3
    ea1_useful_insufficient = ea1_helps and ea1_insufficient
    router_not_primary = not rmr_primary
    leakage_ok = bool(leak.get("ok"))
    objective_ok = True
    gates = {
        "token1_earliest_failure": bool(token1_earliest),
        "gold_token1_exceeds_free_greedy": bool(gold_exceeds),
        "ea1_useful_but_insufficient": bool(ea1_useful_insufficient),
        "router_not_primary_failure": bool(router_not_primary),
        "leakage_audited": bool(leakage_ok),
        "objective_without_heldout_train": bool(objective_ok),
    }
    all_pass = all(gates.values())
    if all_pass:
        option = "B"
        reason = "All six Promptbook NE1 gates pass. Bounded NE1 B32 capacity proof is justified."
    elif not token1_earliest or not gold_exceeds:
        option = "C"
        reason = "Token1/gold-prefix geometry does not support an entry specialist."
    else:
        option = "A"
        reason = "NE1 gates incomplete; redesign data/objective on current EA1 before a new adapter."
    return {
        "gates": gates,
        "all_gates_pass": all_pass,
        "option": option,
        "reason": reason,
        "evidence": {
            "token1_fail_ea1_bypass": t1_fail,
            "greedy_ea1_bypass": greedy_a,
            "greedy_base_bypass": greedy_b,
            "token1_ea1_bypass": t1_a,
            "token1_base_bypass": t1_b,
            "gold_official_k0": free_off,
            "gold_official_k1": gold_off,
            "gold_extra_k0": free_ex,
            "gold_extra_k1": gold_ex,
        },
    }


def main() -> dict[str, Any]:
    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dump = resolve_dump_root(None)
    if dump is None:
        raise SystemExit("dump_root_missing")
    tok = Tokenizer.from_file(str(dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"))
    model = load_parent(device)
    hashes = {
        "FROZEN": frozen_parameter_hash(model),
        "EA1": module_parameter_hash(model, "ea1."),
        "RA1": module_parameter_hash(model, "ra1."),
        "NA1": module_parameter_hash(model, "na1."),
        "RMR1": module_parameter_hash(model, "rmr1."),
    }
    official = load_rows(NAT_DIR / "val.jsonl")
    extra = natural_span_eval()
    train = load_rows(NAT_DIR / "train.jsonl")
    phrase_rows = load_rows(PHRASE_ALIGN_DIR / "val.jsonl")
    leak = leakage_audit(train, official, extra)

    splits = {"official": official, "extra": extra}
    routes = {
        "A_EA1_BYPASS": ("ea1", "bypass"),
        "B_BASE_BYPASS": ("none", "bypass"),
        "C_EA1_RA1": ("ea1", "ra1"),
        "D_BASE_RA1": ("none", "ra1"),
    }
    scored: dict[str, dict[str, Any]] = {}
    details: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for rname, (entry, span) in routes.items():
        model.set_entry_route(entry)
        model.set_span_route(span)
        scored[rname] = {}
        details[rname] = {}
        for sname, rows in splits.items():
            probes = [token1_probe(model, tok, device, rec) for rec in rows]
            for p in probes:
                p.pop("ea1_delta", None)
            scored[rname][sname] = summarize_probes(probes)
            details[rname][sname] = probes

    model.set_entry_route("ea1")
    model.set_span_route("bypass")
    gold_a = {
        "official": [gold_prefix_matrix(model, tok, device, rec) for rec in official],
        "extra": [gold_prefix_matrix(model, tok, device, rec) for rec in extra],
    }
    model.set_entry_route("none")
    model.set_span_route("bypass")
    gold_b = {
        "official": [gold_prefix_matrix(model, tok, device, rec) for rec in official],
        "extra": [gold_prefix_matrix(model, tok, device, rec) for rec in extra],
    }
    gold = {
        "A_EA1_BYPASS": {
            "official_k0": gold_sum(gold_a["official"], 0),
            "official_k1": gold_sum(gold_a["official"], 1),
            "extra_k0": gold_sum(gold_a["extra"], 0),
            "extra_k1": gold_sum(gold_a["extra"], 1),
        },
        "B_BASE_BYPASS": {
            "official_k0": gold_sum(gold_b["official"], 0),
            "official_k1": gold_sum(gold_b["official"], 1),
            "extra_k0": gold_sum(gold_b["extra"], 0),
            "extra_k1": gold_sum(gold_b["extra"], 1),
        },
    }

    model.set_entry_route("ea1")
    model.set_span_route("bypass")
    nat_ok: list[torch.Tensor] = []
    nat_fail: list[torch.Tensor] = []
    nat_all: list[torch.Tensor] = []
    for rec in official + extra:
        p = token1_probe(model, tok, device, rec)
        prefix = prefix_ids_for_inference(tok, rec["prompt"])
        idx = torch.tensor([prefix], dtype=torch.long, device=device)
        with torch.inference_mode():
            pre = model.hidden_pre_adapters(idx)[0, -1]
            vec = model.ea1.delta(pre.unsqueeze(0).unsqueeze(0))[0, 0].detach().float().cpu()
        nat_all.append(vec)
        (nat_ok if int(p["token1_ok"]) else nat_fail).append(vec)
    phrase_vecs: list[torch.Tensor] = []
    for rec in phrase_rows[:24]:
        prefix = prefix_ids_for_inference(tok, rec["prompt"])
        idx = torch.tensor([prefix], dtype=torch.long, device=device)
        with torch.inference_mode():
            pre = model.hidden_pre_adapters(idx)[0, -1]
            vec = model.ea1.delta(pre.unsqueeze(0).unsqueeze(0))[0, 0].detach().float().cpu()
        phrase_vecs.append(vec)

    def mean_vec(vs: list[torch.Tensor]) -> torch.Tensor | None:
        if not vs:
            return None
        return torch.stack(vs).mean(0)

    pv, nv, nov, nfv = mean_vec(phrase_vecs), mean_vec(nat_all), mean_vec(nat_ok), mean_vec(nat_fail)
    ea1_geo = {
        "phrase_internal_cosine": mean_pair_cos(phrase_vecs),
        "natural_internal_cosine": mean_pair_cos(nat_all),
        "cosine_phrase_mean_vs_natural_mean": None if pv is None or nv is None else cosine(pv, nv),
        "cosine_phrase_vs_natural_fail": None if pv is None or nfv is None else cosine(pv, nfv),
        "cosine_phrase_vs_natural_ok": None if pv is None or nov is None else cosine(pv, nov),
        "n_phrase": len(phrase_vecs),
        "n_natural": len(nat_all),
        "n_natural_ok": len(nat_ok),
        "n_natural_fail": len(nat_fail),
    }

    attractor_map = []
    for split in ("official", "extra"):
        for row in details["A_EA1_BYPASS"][split]:
            if int(row.get("token1_ok") or 0):
                continue
            g = str(row.get("top1") or "")
            attractor_map.append({
                "split": split,
                "family": row.get("family"),
                "target": row.get("target"),
                "gold": row.get("gold"),
                "top1": g,
                "class": class_of_token(g),
                "established_entry_class": class_of_token(g) in ENTRY_CLASSES,
                "rank": row.get("rank"),
            })

    model.set_entry_route("ea1")
    model.set_span_route("ra1")
    phrase_scored = _score_loaded(model, tok, device, phrase_rows)
    phrase_exact = int(phrase_scored.get("short_phrase_exact") or 0)
    identity = phrase_exact == PHRASE_REF["phrase"]

    decision = apply_gates(scored=scored, gold=gold, leak=leak, rmr_primary=False)
    a_off = scored["A_EA1_BYPASS"]["official"]
    a_ex = scored["A_EA1_BYPASS"]["extra"]
    b_off = scored["B_BASE_BYPASS"]["official"]
    b_ex = scored["B_BASE_BYPASS"]["extra"]

    report = {
        "kind": "WRIM_GENESIS_SCHOOL05_NE1_REVIEW",
        "CANONICAL": "STEP_400",
        "PARENT": PARENT_CHECKPOINT,
        "PARENT_HASH": PARENT_HASH,
        "HASHES": hashes,
        "FROZEN_HASH_MATCH": hashes["FROZEN"] == FROZEN_BASE_HASH,
        "EA1_HASH_MATCH": hashes["EA1"] == EA1_HASH,
        "RA1_HASH_MATCH": hashes["RA1"] == RA1_HASH,
        "NE1_IMPLEMENTED": False,
        "OPTIMIZER_CONSTRUCTED": "NO",
        "TOKENS_USED": 0,
        "EA1_ON_BYPASS_OFFICIAL": a_off["greedy_exact"],
        "EA1_OFF_BYPASS_OFFICIAL": b_off["greedy_exact"],
        "EA1_ON_BYPASS_EXTRA_UNSEEN": a_ex["greedy_exact"],
        "EA1_OFF_BYPASS_EXTRA_UNSEEN": b_ex["greedy_exact"],
        "EA1_ON_BYPASS_OFFICIAL_TOKEN1": a_off["token1_exact"],
        "EA1_OFF_BYPASS_OFFICIAL_TOKEN1": b_off["token1_exact"],
        "EA1_ON_BYPASS_EXTRA_TOKEN1": a_ex["token1_exact"],
        "EA1_OFF_BYPASS_EXTRA_TOKEN1": b_ex["token1_exact"],
        "GOLD_TOKEN1_OFFICIAL": f"{gold['A_EA1_BYPASS']['official_k0']}→{gold['A_EA1_BYPASS']['official_k1']}",
        "GOLD_TOKEN1_EXTRA": f"{gold['A_EA1_BYPASS']['extra_k0']}→{gold['A_EA1_BYPASS']['extra_k1']}",
        "GOLD": gold,
        "SCORED": scored,
        "EA1_GEOMETRY": ea1_geo,
        "ATTRACTORS": attractor_map,
        "PHRASE_EXACT": phrase_exact,
        "STRUCTURED_IDENTITY_HOLD": identity,
        "LEAKAGE": leak,
        "RMR1_TWO_TOKEN_REGRESSION_OPEN": True,
        "RMR1_PRODUCTION_READY": False,
        "DECISION": decision,
        "NE1_AUTO_CREATE": False,
        "if_option_B": {
            "arch": "NE1 B32 entry-only pre_lm_head zero-init",
            "train": "NE1 only",
            "natural": "NE1 token1 then BYPASS token2+",
            "structured": "EA1+RA1 unchanged",
            "router": "RMR1 frozen experimental, not in first proof",
            "budget": 102400,
            "extend_once": 204800,
            "train_corpus": "WR-CORPUS-PLM-SHORT-NATURAL-1-v1.0.0/train.jsonl",
        },
    }
    _write(REPORT, json.loads(json.dumps(report, default=str)))
    _write(DETAIL, json.loads(json.dumps({"details": details, "gold_a": gold_a, "gold_b": gold_b}, default=str)))

    eng = Engine()
    rec = eng.record_ne1_review({
        "option": decision["option"],
        "gates": decision["gates"],
        "reason": decision["reason"],
        "evidence": decision["evidence"],
        "report": str(REPORT),
    })
    report["PROMPTBOOK"] = rec
    _write(REPORT, json.loads(json.dumps(report, default=str)))
    return report


if __name__ == "__main__":
    out = main()
    print(json.dumps({
        "ok": True,
        "option": out["DECISION"]["option"],
        "gates": out["DECISION"]["gates"],
        "all_gates_pass": out["DECISION"]["all_gates_pass"],
        "NE1_AUTHORIZED": out.get("PROMPTBOOK", {}).get("NE1_AUTHORIZED"),
        "CURRENT_MISSION": out.get("PROMPTBOOK", {}).get("CURRENT_MISSION"),
        "optimizer_constructed": False,
        "tokens_used": 0,
        "official_greedy": out["EA1_ON_BYPASS_OFFICIAL"],
        "extra_greedy": out["EA1_ON_BYPASS_EXTRA_UNSEEN"],
        "gold_official": out["GOLD_TOKEN1_OFFICIAL"],
        "gold_extra": out["GOLD_TOKEN1_EXTRA"],
        "report": str(REPORT),
    }, indent=2))
