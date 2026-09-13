"""STAGE3A candidate adjudication. ZERO optimizer steps.

Evaluates WRIM-0, STEP25_A0.2, STEP25_A0.4, STEP50_A0.5 on a frozen
80-item evaluation-only suite. Does not train. Does not start STAGE3B.
Does not promote. Raw STEP50 is historical only.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

import torch
from safetensors.torch import load_file
from tokenizers import Tokenizer

from phase2_grid import FROZEN_NLL_SHA, sha256_json_text
from phase3a_interpolation import lerp_state, load_into_model, tensors_sha256, verify_endpoint_keys
from stage2_eval import EVAL_SEED, SPECIAL_IDS, greedy_generate
from stage3_eval_baseline import (
    NGRAM,
    char_ngrams,
    continuation_metrics,
    duplication_audit,
    leakage_audit,
    normalize_ws,
    score_item,
)
from stage3_eval_items import ITEMS as STAGE3_ITEMS
from stage3_runtime import (
    BASELINE_SHA,
    PARENT_SHA,
    REVIEW_BANDS,
    RUN_ID,
    STAGE3B_AUTHORIZATION,
    STAGE3_AUTHORIZATION,
    SUITE_SHA,
    TOKENIZER_SHA,
    TRAINING_AUTHORIZATION,
    authorization_gate,
    utc_now,
    write_json,
)
from stage3a_adjudication_sets import CATEGORIES, ITEMS, SUITE_ID, assert_inventory, freeze_payload
from stage3a_candidate_selection import constraint_bools, inside_review_bands
from stage3a_review import EXPECTED_STEP25_SHA, EXPECTED_STEP50_SHA, load_frozen_inference
from stage3a_review_sets import RETENTION_ITEMS, STRUCT_ITEMS
from stage3a_run import cap_eval_overlay, disable_tf32, load_baseline, load_suite, sha256_file

EOS_ID = 2
BOOT_SEED = 3003
N_BOOT = 2000
H2H_DELTA = 0.03
UNIQUENESS_FLOOR = 0.35

CANDIDATE_SPECS = [
    {"candidate_id": "WRIM-0", "source": "parent", "alpha": 1.0, "kind": "PARENT_REFERENCE"},
    {"candidate_id": "STEP25_A0.2", "source": "step25", "alpha": 0.2, "kind": "TEST_ONLY_MERGE"},
    {"candidate_id": "STEP25_A0.4", "source": "step25", "alpha": 0.4, "kind": "TEST_ONLY_MERGE"},
    {"candidate_id": "STEP50_A0.5", "source": "step50", "alpha": 0.5, "kind": "TEST_ONLY_MERGE"},
]

AXIS_NAMES = [
    "RETENTION",
    "ADAPTATION",
    "GENERATION_STABILITY",
    "STRUCTURED_OUTPUT",
    "INSTRUCTION_FOLLOWING",
    "LONG_FORM",
    "GENERALIZATION",
]


def freeze_suite(eval_dir: Path) -> dict[str, Any]:
    assert_inventory()
    path = eval_dir / f"{SUITE_ID}.json"
    write_json(path, freeze_payload())
    return {
        "path": str(path),
        "suite_id": SUITE_ID,
        "sha256": sha256_json_text(path),
        "n_items": len(ITEMS),
        "categories": {cat: sum(1 for it in ITEMS if it["category"] == cat) for cat in CATEGORIES},
        "frozen_before_evaluation": True,
        "training_use": "FORBIDDEN",
        "replaces_cap_eval_0": False,
        "independent_from_cap_eval_0": True,
        "independent_from_wrim_eval_s3_000001": True,
        "independent_from_wrim_eval_s3a_ret_000001": True,
        "independent_from_wrim_eval_s3a_struct_000001": True,
    }


def cross_suite_dup(items: list[dict[str, Any]], others: list[dict[str, Any]], label: str) -> dict[str, Any]:
    blocking = []
    pairs = []
    for a in items:
        ga = set(char_ngrams(a["prompt_text"], NGRAM))
        na = normalize_ws(a["prompt_text"])
        for b in others:
            gb = set(char_ngrams(b["prompt_text"], NGRAM))
            union = ga | gb
            jac = (len(ga & gb) / len(union)) if union else 0.0
            exact = a["prompt_text"] == b["prompt_text"] or na == normalize_ws(b["prompt_text"])
            block = exact or jac >= 0.70
            if jac >= 0.18 or block:
                row = {"new": a["item_id"], "other": b["item_id"], "suite": label, "char13_jaccard": round(jac, 6), "blocking": block}
                pairs.append(row)
                if block:
                    blocking.append(a["item_id"])
    return {"ok": not blocking, "blocking_item_ids": blocking, "pairs": pairs[:60], "n_pairs_reported": min(60, len(pairs))}


def category_diversity(items: list[dict[str, Any]]) -> dict[str, Any]:
    per_cat = {}
    poor = []
    for cat in CATEGORIES:
        cat_items = [it for it in items if it["category"] == cat]
        mean_jac = []
        for i, a in enumerate(cat_items):
            ga = set(char_ngrams(a["prompt_text"], NGRAM))
            for b in cat_items[i + 1 :]:
                gb = set(char_ngrams(b["prompt_text"], NGRAM))
                union = ga | gb
                mean_jac.append((len(ga & gb) / len(union)) if union else 0.0)
        mean = round(sum(mean_jac) / max(1, len(mean_jac)), 6)
        per_cat[cat] = {"n": len(cat_items), "mean_pairwise_char13_jaccard": mean}
        if mean >= 0.25:
            poor.append(cat)
    return {"ok": not poor, "poor_category_diversity": poor, "per_category": per_cat}


def audit_suite(tokenizer: Tokenizer, dump_root: Path) -> dict[str, Any]:
    leak = leakage_audit(ITEMS, tokenizer, dump_root)
    dup_internal = duplication_audit(ITEMS)
    diversity = category_diversity(ITEMS)
    vs_stage3 = cross_suite_dup(ITEMS, STAGE3_ITEMS, "WRIM-EVAL-S3-000001")
    vs_ret = cross_suite_dup(ITEMS, RETENTION_ITEMS, "WRIM-EVAL-S3A-RET-000001")
    vs_struct = cross_suite_dup(ITEMS, STRUCT_ITEMS, "WRIM-EVAL-S3A-STRUCT-000001")
    ok = (
        bool(leak.get("ok"))
        and not (dup_internal.get("blocking_pairs"))
        and diversity["ok"]
        and vs_stage3["ok"]
        and vs_ret["ok"]
        and vs_struct["ok"]
    )
    return {
        "ok": ok,
        "leakage": leak,
        "duplication_internal": dup_internal,
        "category_diversity": diversity,
        "duplication_vs_stage3": vs_stage3,
        "duplication_vs_s3a_retention": vs_ret,
        "duplication_vs_s3a_struct": vs_struct,
        "note": "Evaluation-only. Forbidden for training. CAP-EVAL-0 and WRIM-EVAL-S3A-RET-000001 unmodified.",
    }


def rebuild_from_ids(full: dict[str, Any], tokenizer: Tokenizer, n: int) -> dict[str, Any]:
    ids = list(full.get("new_ids") or [])[:n]
    continuation = tokenizer.decode(ids, skip_special_tokens=True) if ids else ""
    max_run = 1
    run = 1
    for a, b in zip(ids, ids[1:]):
        run = run + 1 if a == b else 1
        max_run = max(max_run, run)
    uniq = (len(set(ids)) / len(ids)) if ids else None
    collapsed = bool(ids) and max_run >= max(6, len(ids) // 3)
    special_loop = False
    spec_run = 0
    last_spec = None
    for tid in ids:
        if tid in SPECIAL_IDS:
            spec_run = spec_run + 1 if tid == last_spec else 1
            last_spec = tid
            if spec_run >= 4:
                special_loop = True
                break
        else:
            spec_run = 0
            last_spec = None
    premature_eos = bool(ids) and (EOS_ID in ids) and (len(list(full.get("new_ids") or [])) < n or (ids[-1] == EOS_ID and len(ids) < n))
    looping = bool((uniq is not None and uniq < 0.20 and len(ids) >= 16) or max_run >= 8)
    return {
        "new_ids": ids,
        "continuation": continuation,
        "n_new": len(ids),
        "finite": full.get("finite"),
        "entropy": full.get("entropy"),
        "unique_ratio": round(uniq, 4) if uniq is not None else None,
        "max_run": max_run,
        "collapsed": collapsed,
        "special_loop": special_loop,
        "premature_eos": premature_eos,
        "looping": looping,
        "p_period": full.get("p_period"),
    }


def length_row(item: dict[str, Any], gen: dict[str, Any], length: int) -> dict[str, Any]:
    scores = score_item(item, gen, gen, gen)
    metrics = continuation_metrics(gen)
    flags = constraint_bools(scores)
    constraint_ok = all(v for _k, v in flags) if flags else True
    uniq = float(gen.get("unique_ratio") or 0.0)
    descriptive_pass = (
        (not bool(gen.get("collapsed")))
        and (not bool(gen.get("special_loop")))
        and (not bool(gen.get("looping")))
        and uniq >= UNIQUENESS_FLOOR
        and constraint_ok
    )
    return {
        "length": length,
        "descriptive_pass": descriptive_pass,
        "constraint_ok": constraint_ok,
        "constraint_flags": {k: v for k, v in flags},
        "json_valid": scores.get("json_valid"),
        "collapsed": gen.get("collapsed"),
        "special_loop": gen.get("special_loop"),
        "looping": gen.get("looping"),
        "premature_eos": gen.get("premature_eos"),
        "unique_ratio": gen.get("unique_ratio"),
        "entropy": gen.get("entropy"),
        "max_run": gen.get("max_run"),
        "special_rate_0_8": metrics.get("special_rate_0_8"),
        "n_new": gen.get("n_new"),
        "token_id_sha256": metrics.get("token_id_sha256"),
        "continuation": gen.get("continuation") or "",
        "continuation_prefix": (gen.get("continuation") or "")[:240],
    }


def evaluate_adjudication_items(model, tokenizer, device, items: list[dict[str, Any]]) -> dict[str, Any]:
    rows = []
    for it in items:
        lengths = list(it.get("eval_lengths") or [int(it.get("max_new_tokens") or 32)])
        max_len = max(int(x) for x in lengths)
        full = greedy_generate(model, tokenizer, it["prompt_text"], device, max_new=max_len)
        by_len = {}
        for n in lengths:
            sliced = rebuild_from_ids(full, tokenizer, int(n))
            by_len[str(n)] = length_row(it, sliced, int(n))
        primary = by_len[str(max_len)]
        rows.append(
            {
                "item_id": it["item_id"],
                "category": it["category"],
                "head_to_head": bool(it.get("head_to_head")),
                "eval_lengths": lengths,
                "primary_length": max_len,
                "by_length": by_len,
                **{k: primary[k] for k in primary if k != "continuation"},
            }
        )
    by_cat: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_cat.setdefault(row["category"], []).append(row)

    def agg(cat_rows: list[dict[str, Any]], length: int | None = None) -> dict[str, Any]:
        use = []
        for r in cat_rows:
            if length is None:
                use.append(r)
            elif str(length) in (r.get("by_length") or {}):
                use.append({**r, **(r["by_length"][str(length)])})
        if not use:
            return {"n": 0}
        return {
            "n": len(use),
            "descriptive_pass_count": int(sum(1 for r in use if r.get("descriptive_pass"))),
            "constraint_ok_count": int(sum(1 for r in use if r.get("constraint_ok"))),
            "n_collapsed": int(sum(1 for r in use if r.get("collapsed"))),
            "n_special_loop": int(sum(1 for r in use if r.get("special_loop"))),
            "n_looping": int(sum(1 for r in use if r.get("looping"))),
            "n_premature_eos": int(sum(1 for r in use if r.get("premature_eos"))),
            "json_valid_count": int(sum(1 for r in use if r.get("json_valid") is True)),
            "json_n": int(sum(1 for r in use if r.get("json_valid") is not None)),
            "mean_unique_ratio": float(sum(float(r.get("unique_ratio") or 0.0) for r in use) / max(1, len(use))),
            "mean_entropy": float(sum(float(r.get("entropy") or 0.0) for r in use) / max(1, len(use))),
            "mean_max_run": float(sum(float(r.get("max_run") or 0.0) for r in use) / max(1, len(use))),
            "mean_special_rate": float(sum(float(r.get("special_rate_0_8") or 0.0) for r in use) / max(1, len(use))),
        }

    length_aggs = {}
    for length in (32, 128, 256, 512):
        length_aggs[str(length)] = agg(rows, length)
        by_cat_len = {}
        for cat, cat_rows in by_cat.items():
            a = agg(cat_rows, length)
            if a.get("n"):
                by_cat_len[cat] = a
        length_aggs[str(length)]["by_category"] = by_cat_len

    return {
        "n_items": len(rows),
        **agg(rows),
        "by_category": {k: agg(v) for k, v in by_cat.items()},
        "by_length": length_aggs,
        "items": rows,
        "scoring_method": "rule_based_deterministic_greedy; no LLM judge",
        "llm_judge": None,
    }


def bootstrap_ci(flags: list[bool], *, seed: int = BOOT_SEED, n_boot: int = N_BOOT) -> dict[str, Any]:
    n = len(flags)
    if n == 0:
        return {"mean": None, "ci95": [None, None], "n": 0, "n_boot": n_boot, "seed": seed}
    arr = [1.0 if f else 0.0 for f in flags]
    mean = sum(arr) / n
    g = torch.Generator()
    g.manual_seed(seed)
    rates = []
    for _ in range(n_boot):
        idx = torch.randint(0, n, (n,), generator=g)
        rates.append(sum(arr[int(i)] for i in idx.tolist()) / n)
    rates.sort()
    lo = rates[int(0.025 * (n_boot - 1))]
    hi = rates[int(0.975 * (n_boot - 1))]
    return {
        "mean": round(mean, 6),
        "ci95": [round(lo, 6), round(hi, 6)],
        "n": n,
        "n_boot": n_boot,
        "seed": seed,
        "pre_registered": True,
    }


def h2h_flag(base: dict[str, Any], other: dict[str, Any]) -> str:
    b_pass = bool(base.get("descriptive_pass"))
    o_pass = bool(other.get("descriptive_pass"))
    b_col = bool(base.get("collapsed") or base.get("special_loop") or base.get("looping"))
    o_col = bool(other.get("collapsed") or other.get("special_loop") or other.get("looping"))
    b_u = float(base.get("unique_ratio") or 0.0)
    o_u = float(other.get("unique_ratio") or 0.0)
    b_ok = bool(base.get("constraint_ok"))
    o_ok = bool(other.get("constraint_ok"))
    signals = []
    if o_col and not b_col:
        signals.append("WORSE")
    elif b_col and not o_col:
        signals.append("BETTER")
    if o_ok and not b_ok:
        signals.append("BETTER")
    elif b_ok and not o_ok:
        signals.append("WORSE")
    if o_pass and not b_pass:
        signals.append("BETTER")
    elif b_pass and not o_pass:
        signals.append("WORSE")
    if abs(o_u - b_u) >= H2H_DELTA:
        signals.append("BETTER" if o_u > b_u else "WORSE")
    uniq = set(signals)
    if not uniq:
        return "SIMILAR"
    if uniq == {"BETTER"}:
        return "BETTER"
    if uniq == {"WORSE"}:
        return "WORSE"
    return "AMBIGUOUS"


def historical_from_selection(selection_path: Path) -> dict[str, Any]:
    obj = json.loads(selection_path.read_text(encoding="utf-8"))
    rows = list(obj.get("comparison") or [])
    by_id = {r.get("candidate_id"): r for r in rows}
    out = {}
    for spec in CANDIDATE_SPECS:
        cid = spec["candidate_id"]
        row = dict(by_id.get(cid) or {})
        row["inside_review_bands"] = inside_review_bands(row) if row.get("mean_kl_wrim0_to_candidate") is not None else False
        out[cid] = {
            "source": "stage3a-candidate-selection.json",
            "unmodified_cap_eval_0": True,
            "unmodified_s3a_retention": True,
            "mean_wrim0_anchor_nll_delta": row.get("mean_wrim0_anchor_nll_delta"),
            "mean_kl_wrim0_to_candidate": row.get("mean_kl_wrim0_to_candidate"),
            "val_loss_corpus0": row.get("val_loss_corpus0"),
            "val_loss_corpus1": row.get("val_loss_corpus1"),
            "historical_binary": row.get("historical_binary"),
            "historical_pass_count": row.get("historical_pass_count"),
            "expanded_retention_pass": row.get("expanded_retention_pass"),
            "expanded_retention_n": row.get("expanded_retention_n"),
            "expanded_struct_constraint": row.get("expanded_struct_constraint"),
            "expanded_struct_json_valid": row.get("expanded_struct_json_valid"),
            "pareto_zsum": row.get("pareto_zsum"),
            "inside_review_bands": row["inside_review_bands"],
        }
    return {"ok": obj.get("ok") is True, "by_candidate": out, "selection_kind": obj.get("kind")}


def axis_scores(cid: str, adj: dict[str, Any], hist: dict[str, Any], cap: dict[str, Any]) -> dict[str, float]:
    by_cat = adj.get("by_category") or {}
    json_cat = by_cat.get("JSON_STRUCTURED_OUTPUT") or {}
    inst_cat = by_cat.get("INSTRUCTION_FOLLOWING") or {}
    long_cat = by_cat.get("LONG_FORM_CONTINUATION") or {}
    long256 = ((adj.get("by_length") or {}).get("256") or {}).get("by_category", {}).get("LONG_FORM_CONTINUATION") or long_cat
    n = max(1, int(adj.get("n_items") or 1))
    retention = float(cap.get("historical_pass_count") or 0) + 0.01 * float(hist.get("expanded_retention_pass") or 0)
    v1 = float(hist.get("val_loss_corpus1") or 99.0)
    v0 = float(hist.get("val_loss_corpus0") or 99.0)
    adaptation = -(v1 + 0.25 * (v0 - 8.89))
    stability = (
        -float(adj.get("n_collapsed") or 0)
        - float(adj.get("n_looping") or 0)
        - float(adj.get("n_special_loop") or 0)
        + float(adj.get("mean_unique_ratio") or 0.0)
        - float(adj.get("mean_special_rate") or 0.0)
    )
    structured = float(json_cat.get("constraint_ok_count") or 0) + 0.5 * float(json_cat.get("json_valid_count") or 0)
    instruction = float(inst_cat.get("constraint_ok_count") or 0)
    long_form = float(long256.get("descriptive_pass_count") or 0) - 0.5 * float(long256.get("n_collapsed") or 0)
    generalization = float(adj.get("descriptive_pass_count") or 0) / n
    return {
        "RETENTION": retention,
        "ADAPTATION": adaptation,
        "GENERATION_STABILITY": stability,
        "STRUCTURED_OUTPUT": structured,
        "INSTRUCTION_FOLLOWING": instruction,
        "LONG_FORM": long_form,
        "GENERALIZATION": generalization,
    }


def pareto_set(axis_by_id: dict[str, dict[str, float]]) -> dict[str, Any]:
    ids = list(axis_by_id.keys())

    def dominates(a: str, b: str) -> bool:
        aa = axis_by_id[a]
        bb = axis_by_id[b]
        ge = all(aa[k] >= bb[k] - 1e-12 for k in AXIS_NAMES)
        gt = any(aa[k] > bb[k] + 1e-12 for k in AXIS_NAMES)
        return ge and gt

    undominated = [i for i in ids if not any(dominates(j, i) for j in ids if j != i)]
    kind = "NO_CLEAR_WINNER"
    if len(undominated) == 1:
        winner = undominated[0]
        if all(dominates(winner, other) for other in ids if other != winner):
            kind = "DOMINANT"
        else:
            kind = "PARETO_PREFERRED"
    elif len(undominated) > 1:
        kind = "TRADEOFF_ONLY"
    return {"ids": undominated, "kind": kind, "dominance_kind": kind}


def recommend(axis_by_id: dict[str, dict[str, float]], pareto: dict[str, Any], hist: dict[str, dict[str, Any]], adj_by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    parent_gen = int((adj_by_id.get("WRIM-0") or {}).get("descriptive_pass_count") or 0)
    parent_col = int((adj_by_id.get("WRIM-0") or {}).get("n_collapsed") or 0)
    interp_ids = [c["candidate_id"] for c in CANDIDATE_SPECS if c["candidate_id"] != "WRIM-0"]
    any_inside = any(bool((hist.get(cid) or {}).get("inside_review_bands")) for cid in interp_ids)
    worse_gen = all(int((adj_by_id.get(cid) or {}).get("descriptive_pass_count") or 0) + 2 < parent_gen for cid in interp_ids)
    more_collapse = all(int((adj_by_id.get(cid) or {}).get("n_collapsed") or 0) > parent_col + 2 for cid in interp_ids)
    if (not any_inside) or (worse_gen and more_collapse):
        rec = "F. STAGE3A_BRANCH_NOT_HEALTHY_ENOUGH_FOR_CONTINUATION"
        preferred = "WRIM-0"
    else:
        votes: dict[str, int] = {cid: 0 for cid in [c["candidate_id"] for c in CANDIDATE_SPECS]}
        for axis in AXIS_NAMES:
            best = max(axis_by_id.items(), key=lambda kv: kv[1][axis])[0]
            votes[best] += 1
        preferred = max(votes.items(), key=lambda kv: (kv[1], kv[0] != "WRIM-0"))[0]
        if pareto["kind"] in ("TRADEOFF_ONLY", "NO_CLEAR_WINNER") and max(votes.values()) <= 3:
            rec = "E. NO_CLEAR_WINNER_MORE_EVALUATION_REQUIRED"
            preferred = "NO_CLEAR_WINNER"
        elif preferred == "WRIM-0":
            rec = "A. KEEP_WRIM0_AND_STOP_STAGE3A_BRANCH"
        elif preferred == "STEP25_A0.2":
            rec = "B. STEP25_A0.2_PREFERRED_FOR_FUTURE_REVIEW"
        elif preferred == "STEP25_A0.4":
            rec = "C. STEP25_A0.4_PREFERRED_FOR_FUTURE_REVIEW"
        elif preferred == "STEP50_A0.5":
            rec = "D. STEP50_A0.5_PREFERRED_FOR_FUTURE_REVIEW"
        else:
            rec = "E. NO_CLEAR_WINNER_MORE_EVALUATION_REQUIRED"
    return {
        "STAGE3B_RECOMMENDATION": rec,
        "PREFERRED_STAGE3A_EVALUATION_CANDIDATE": preferred if preferred != "NO_CLEAR_WINNER" else pareto["ids"],
        "axis_winners": {axis: max(axis_by_id.items(), key=lambda kv: kv[1][axis])[0] for axis in AXIS_NAMES},
        "axis_numeric": axis_by_id,
        "pareto": pareto,
        "STAGE3B_AUTHORIZATION": "NO",
        "TRAINING_AUTHORIZATION": "OFF",
        "promotion": False,
        "note": "No recommendation grants STAGE3B or training authorization. Interpolants remain TEST_ONLY_MERGE.",
    }


def load_candidate_state(spec: dict[str, Any], parent_cpu, cand25, cand50):
    if spec["source"] == "parent":
        return {k: v.contiguous() for k, v in parent_cpu.items()}
    src = cand25 if spec["source"] == "step25" else cand50
    return lerp_state(src, parent_cpu, float(spec["alpha"]))


def run_adjudication(
    *,
    weights: Path,
    tokenizer_path: Path,
    dump_root: Path,
    suite_path: Path,
    baseline_path: Path,
    nll_anchor_path: Path,
    ckpt_root: Path,
    selection_path: Path,
    eval_dir: Path,
    report_path: Path,
    freeze_only: bool,
) -> dict[str, Any]:
    if TRAINING_AUTHORIZATION != "OFF":
        raise SystemExit("TRAINING_AUTHORIZATION must remain OFF")
    gate = authorization_gate(requested_mode="stage3a")
    if gate.get("allowed"):
        raise SystemExit("STAGE3A training gate must stay closed")
    if STAGE3B_AUTHORIZATION != "NO":
        raise SystemExit("STAGE3B must remain unauthorized")

    step25 = ckpt_root / "step-25" / "model.safetensors"
    step50 = ckpt_root / "step-50" / "model.safetensors"
    missing = [str(p) for p in (weights, tokenizer_path, dump_root, suite_path, baseline_path, nll_anchor_path, step25, step50, selection_path) if not p.exists()]
    if missing:
        payload = {"ok": False, "kind": "STAGE3A_CANDIDATE_ADJUDICATION_BLOCKED", "reason": "missing_required_path", "missing": missing, "TRAINING_AUTHORIZATION": "OFF"}
        write_json(report_path, payload)
        return payload

    freeze = freeze_suite(eval_dir)
    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    audit = audit_suite(tokenizer, dump_root)
    adj_dir = ckpt_root / "adjudication"
    adj_dir.mkdir(parents=True, exist_ok=True)
    write_json(adj_dir / "leakage.json", audit)
    if not audit["ok"]:
        payload = {
            "ok": False,
            "kind": "STAGE3A_CANDIDATE_ADJUDICATION_BLOCKED",
            "reason": "leakage_or_duplication",
            "audit": {
                "ok": False,
                "blocking_leakage": (audit.get("leakage") or {}).get("blocking_item_ids"),
                "blocking_dup": (audit.get("duplication_internal") or {}).get("blocking_pairs"),
                "blocking_vs_stage3": (audit.get("duplication_vs_stage3") or {}).get("blocking_item_ids"),
                "blocking_vs_s3a_ret": (audit.get("duplication_vs_s3a_retention") or {}).get("blocking_item_ids"),
                "blocking_vs_s3a_struct": (audit.get("duplication_vs_s3a_struct") or {}).get("blocking_item_ids"),
            },
            "freeze": freeze,
            "TRAINING_AUTHORIZATION": "OFF",
            "optimizer_steps_this_pass": 0,
        }
        write_json(report_path, payload)
        print(json.dumps({"ok": False, "reason": "leakage_or_duplication", "audit": payload["audit"]}, indent=2), flush=True)
        return payload
    if freeze_only:
        payload = {
            "ok": True,
            "kind": "STAGE3A_ADJUDICATION_SUITE_FROZEN",
            "freeze": freeze,
            "audit": {"ok": True, "n_haystacks": (audit.get("leakage") or {}).get("n_haystacks")},
            "TRAINING_AUTHORIZATION": "OFF",
            "optimizer_steps_this_pass": 0,
        }
        write_json(report_path, payload)
        print(json.dumps(payload, indent=2), flush=True)
        return payload

    disable_tf32()
    torch.manual_seed(EVAL_SEED)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type == "cuda":
        torch.cuda.manual_seed_all(EVAL_SEED)

    parent_sha = sha256_file(weights)
    tok_sha = sha256_file(tokenizer_path)
    suite = load_suite(suite_path)
    baseline = load_baseline(baseline_path)
    nll_sha = sha256_json_text(nll_anchor_path)
    s25_sha = sha256_file(step25)
    s50_sha = sha256_file(step50)
    sha_block = {
        "parent": {"got": parent_sha, "expected": PARENT_SHA, "ok": parent_sha == PARENT_SHA},
        "tokenizer": {"got": tok_sha, "expected": TOKENIZER_SHA, "ok": tok_sha == TOKENIZER_SHA},
        "suite": {"got": suite["stored_hash"], "expected": SUITE_SHA, "ok": suite["hash_ok"]},
        "baseline": {"got": baseline["sha256"], "expected": BASELINE_SHA, "ok": baseline["hash_ok"]},
        "historical_nll_anchor": {"got": nll_sha, "expected": FROZEN_NLL_SHA, "ok": nll_sha == FROZEN_NLL_SHA},
        "step25_model": {"got": s25_sha, "expected": EXPECTED_STEP25_SHA, "ok": s25_sha == EXPECTED_STEP25_SHA},
        "step50_model": {"got": s50_sha, "expected": EXPECTED_STEP50_SHA, "ok": s50_sha == EXPECTED_STEP50_SHA},
        "adjudication_suite": {"got": freeze["sha256"], "suite_id": SUITE_ID, "ok": True},
    }
    if not all(v["ok"] for v in sha_block.values()):
        payload = {"ok": False, "kind": "STAGE3A_CANDIDATE_ADJUDICATION_BLOCKED", "reason": "sha_mismatch", "sha": sha_block, "TRAINING_AUTHORIZATION": "OFF"}
        write_json(report_path, payload)
        return payload

    hist_pack = historical_from_selection(selection_path)
    if not hist_pack["ok"]:
        payload = {"ok": False, "kind": "STAGE3A_CANDIDATE_ADJUDICATION_BLOCKED", "reason": "selection_report_not_ok", "TRAINING_AUTHORIZATION": "OFF"}
        write_json(report_path, payload)
        return payload

    parent_model, parent_cpu = load_frozen_inference(weights, device)
    cand25_state = {k: v.contiguous() for k, v in load_file(str(step25)).items()}
    cand50_state = {k: v.contiguous() for k, v in load_file(str(step50)).items()}
    keys_ok25, key_reasons25 = verify_endpoint_keys(cand25_state, parent_cpu)
    keys_ok50, key_reasons50 = verify_endpoint_keys(cand50_state, parent_cpu)
    reconstruction = {"candidates": {}, "deterministic_greedy": {}, "endpoint": {
        "step25_keys_ok": keys_ok25,
        "step50_keys_ok": keys_ok50,
        "step25_key_reasons": key_reasons25,
        "step50_key_reasons": key_reasons50,
        "lerp_formula": "theta(alpha)=(1-alpha)*candidate + alpha*WRIM-0",
    }}
    if not keys_ok25 or not keys_ok50:
        payload = {"ok": False, "kind": "STAGE3A_CANDIDATE_ADJUDICATION_BLOCKED", "reason": "interpolation_keys", "reconstruction": reconstruction, "TRAINING_AUTHORIZATION": "OFF"}
        write_json(report_path, payload)
        return payload

    probe_prompt = ITEMS[0]["prompt_text"]
    results: dict[str, Any] = {}
    cap_by_id: dict[str, Any] = {}
    for spec in CANDIDATE_SPECS:
        cid = spec["candidate_id"]
        print(f"[adjudication] reconstruct {cid}", flush=True)
        merged_a = load_candidate_state(spec, parent_cpu, cand25_state, cand50_state)
        merged_b = load_candidate_state(spec, parent_cpu, cand25_state, cand50_state)
        sha_a = tensors_sha256(merged_a)
        sha_b = tensors_sha256(merged_b)
        identical_weights = sha_a == sha_b
        model = parent_model if spec["source"] == "parent" else load_into_model(merged_a, device)
        torch.manual_seed(EVAL_SEED)
        if device.type == "cuda":
            torch.cuda.manual_seed_all(EVAL_SEED)
        g1 = greedy_generate(model, tokenizer, probe_prompt, device, max_new=32)
        torch.manual_seed(EVAL_SEED)
        if device.type == "cuda":
            torch.cuda.manual_seed_all(EVAL_SEED)
        g2 = greedy_generate(model, tokenizer, probe_prompt, device, max_new=32)
        m1 = continuation_metrics(g1)
        m2 = continuation_metrics(g2)
        reconstruction["candidates"][cid] = {
            "kind": spec["kind"],
            "source": spec["source"],
            "alpha": spec["alpha"],
            "weight_sha256": sha_a,
            "repeat_weight_sha256": sha_b,
            "identical_weights": identical_weights,
            "promotion": False,
            "written_to_production_wrim": False,
        }
        reconstruction["deterministic_greedy"][cid] = {
            "item_id": ITEMS[0]["item_id"],
            "seed": EVAL_SEED,
            "identical_token_sha": m1["token_id_sha256"] == m2["token_id_sha256"],
            "token_id_sha256": m1["token_id_sha256"],
        }
        if not identical_weights or m1["token_id_sha256"] != m2["token_id_sha256"]:
            payload = {"ok": False, "kind": "STAGE3A_CANDIDATE_ADJUDICATION_BLOCKED", "reason": "reconstruction_or_greedy_mismatch", "reconstruction": reconstruction, "TRAINING_AUTHORIZATION": "OFF"}
            write_json(report_path, payload)
            return payload
        print(f"[adjudication] eval {cid}", flush=True)
        adj = evaluate_adjudication_items(model, tokenizer, device, ITEMS)
        cap = cap_eval_overlay(model, tokenizer, device, dump_root)
        write_json(adj_dir / f"{cid}.json", {"adjudication": {k: v for k, v in adj.items() if k != "items"}, "cap_eval_0": cap, "items": adj["items"]})
        results[cid] = adj
        cap_by_id[cid] = cap
        if spec["source"] != "parent":
            del model

    axis_by_id = {cid: axis_scores(cid, results[cid], hist_pack["by_candidate"][cid], cap_by_id[cid]) for cid in results}
    pareto = pareto_set(axis_by_id)
    decision = recommend(axis_by_id, pareto, hist_pack["by_candidate"], results)

    uncertainty = {}
    for cid, adj in results.items():
        flags = [bool(r.get("descriptive_pass")) for r in adj.get("items") or []]
        cat_ci = {}
        for cat in CATEGORIES:
            cat_flags = [bool(r.get("descriptive_pass")) for r in (adj.get("items") or []) if r.get("category") == cat]
            cat_ci[cat] = bootstrap_ci(cat_flags, seed=BOOT_SEED)
        uncertainty[cid] = {
            "overall_descriptive_pass": bootstrap_ci(flags, seed=BOOT_SEED),
            "by_category": cat_ci,
            "note": "Do not treat tiny count differences as decisive when CIs overlap.",
        }

    h2h_items = [it for it in ITEMS if it.get("head_to_head")]
    h2h_rows = []
    for it in h2h_items:
        length = max(int(x) for x in (it.get("eval_lengths") or [32]))
        cells = {}
        for cid in results:
            row = next(r for r in results[cid]["items"] if r["item_id"] == it["item_id"])
            cell = dict(row["by_length"][str(length)])
            cells[cid] = {
                "descriptive_pass": cell.get("descriptive_pass"),
                "constraint_ok": cell.get("constraint_ok"),
                "collapsed": cell.get("collapsed"),
                "special_loop": cell.get("special_loop"),
                "looping": cell.get("looping"),
                "unique_ratio": cell.get("unique_ratio"),
                "max_run": cell.get("max_run"),
                "n_new": cell.get("n_new"),
                "json_valid": cell.get("json_valid"),
                "continuation": cell.get("continuation"),
            }
        parent_cell = cells["WRIM-0"]
        flags = {cid: h2h_flag(parent_cell, cells[cid]) if cid != "WRIM-0" else "REFERENCE" for cid in cells}
        flags["STEP25_A0.2_vs_STEP50_A0.5"] = h2h_flag(cells["STEP50_A0.5"], cells["STEP25_A0.2"])
        flags["STEP25_A0.4_vs_STEP50_A0.5"] = h2h_flag(cells["STEP50_A0.5"], cells["STEP25_A0.4"])
        h2h_rows.append({"item_id": it["item_id"], "category": it["category"], "length": length, "criteria": "descriptive_pass, constraint_ok, collapse/loop, unique_ratio delta>=0.03", "outputs": cells, "flags_vs_WRIM0": flags})
    write_json(adj_dir / "head-to-head.json", {"n": len(h2h_rows), "items": h2h_rows, "hidden_reasoning_exposed": False})

    compact = {}
    for cid, adj in results.items():
        compact[cid] = {
            "kind": next(s["kind"] for s in CANDIDATE_SPECS if s["candidate_id"] == cid),
            "promotion": False,
            "cap_eval_0": cap_by_id[cid],
            "historical": hist_pack["by_candidate"][cid],
            "adjudication": {k: v for k, v in adj.items() if k != "items"},
            "uncertainty": uncertainty[cid]["overall_descriptive_pass"],
            "axes": axis_by_id[cid],
        }

    payload = {
        "ok": True,
        "kind": "STAGE3A_CANDIDATE_ADJUDICATION",
        "WRIM_STAGE3A_CANDIDATE_ADJUDICATION": "COMPLETE",
        "run_id": RUN_ID,
        "created_at": utc_now(),
        "optimizer_steps_this_pass": 0,
        "parameter_update_count_this_pass": 0,
        "TRAINING_AUTHORIZATION": "OFF",
        "STAGE3_AUTHORIZATION": STAGE3_AUTHORIZATION,
        "STAGE3B_AUTHORIZATION": "NO",
        "STAGE3B_EXECUTION_READINESS": False,
        "promotion_candidate": False,
        "interpolation_auto_promoted": False,
        "raw_step50_re_admitted": False,
        "candidates_evaluated": [s["candidate_id"] for s in CANDIDATE_SPECS],
        "seeds": {"greedy_eval": EVAL_SEED, "bootstrap": BOOT_SEED, "pre_registered": True, "stochastic_sampling": False},
        "sha": sha_block,
        "freeze": freeze,
        "audit": {
            "ok": True,
            "n_haystacks": (audit.get("leakage") or {}).get("n_haystacks"),
            "blocking_item_ids": (audit.get("leakage") or {}).get("blocking_item_ids"),
        },
        "reconstruction": reconstruction,
        "results": compact,
        "uncertainty": {cid: uncertainty[cid]["overall_descriptive_pass"] for cid in uncertainty},
        "head_to_head_path": str(adj_dir / "head-to-head.json"),
        "selection": decision,
        "llm_judge": {"used": False, "identity": None, "note": "Scoring is rule-based/deterministic. No candidate graded itself."},
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "QWEN_INTELLIGENCE_CLASS": "THIRD_PARTY_MODEL_RUNNING_LOCALLY",
        "RAEL_STATUS": "NOT_IMPLEMENTED",
        "review_bands_unchanged": REVIEW_BANDS,
    }
    write_json(report_path, payload)
    write_json(adj_dir / "adjudication-report.json", payload)
    print(json.dumps({"ok": True, "recommendation": decision["STAGE3B_RECOMMENDATION"], "preferred": decision["PREFERRED_STAGE3A_EVALUATION_CANDIDATE"], "pareto": pareto}, indent=2), flush=True)
    return payload


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--weights", required=True)
    p.add_argument("--tokenizer", required=True)
    p.add_argument("--dump-root", required=True)
    p.add_argument("--suite", required=True)
    p.add_argument("--baseline", required=True)
    p.add_argument("--nll-anchor", required=True)
    p.add_argument("--ckpt-dir", required=True)
    p.add_argument("--selection", required=True)
    p.add_argument("--eval-dir", required=True)
    p.add_argument("--report", required=True)
    p.add_argument("--freeze-only", action="store_true")
    args = p.parse_args()
    try:
        out = run_adjudication(
            weights=Path(args.weights),
            tokenizer_path=Path(args.tokenizer),
            dump_root=Path(args.dump_root),
            suite_path=Path(args.suite),
            baseline_path=Path(args.baseline),
            nll_anchor_path=Path(args.nll_anchor),
            ckpt_root=Path(args.ckpt_dir),
            selection_path=Path(args.selection),
            eval_dir=Path(args.eval_dir),
            report_path=Path(args.report),
            freeze_only=bool(args.freeze_only),
        )
    except Exception as exc:
        Path(args.report).parent.mkdir(parents=True, exist_ok=True)
        write_json(Path(args.report), {"ok": False, "kind": "STAGE3A_CANDIDATE_ADJUDICATION_BLOCKED", "error": str(exc), "TRAINING_AUTHORIZATION": "OFF", "optimizer_steps_this_pass": 0})
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2), flush=True)
        return 1
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
