"""RUN-000011 diagnostics: rank buckets, top-k, logit margins, per-example deltas.

Does not mutate RUN-000010 diagnostics. Does not train.
"""
from __future__ import annotations

from collections import Counter
from statistics import median
from typing import Any

from run000010_diagnostics import (  # noqa: F401
    classify_basin,
    classify_eval_items,
    delta_teacher_force_me,
    s3_inst_02_trace,
    teacher_force_capability as teacher_force_capability_000010,
    teacher_force_item as teacher_force_item_000010,
)

RANK_BUCKETS = (1, 5, 10, 50, 100, 500, 1000)


def _percentile(vals: list[float], p: float) -> float | None:
    if not vals:
        return None
    xs = sorted(vals)
    if len(xs) == 1:
        return xs[0]
    k = (len(xs) - 1) * (p / 100.0)
    lo = int(k)
    hi = min(lo + 1, len(xs) - 1)
    frac = k - lo
    return xs[lo] * (1.0 - frac) + xs[hi] * frac


def bucket_ranks(ranks: list[int | float | None]) -> dict[str, int]:
    nums = [int(r) for r in ranks if r is not None]
    out = {
        "rank_eq_1": 0,
        "rank_le_5": 0,
        "rank_le_10": 0,
        "rank_le_50": 0,
        "rank_le_100": 0,
        "rank_le_500": 0,
        "rank_le_1000": 0,
        "rank_gt_1000": 0,
        "n": len(nums),
    }
    for r in nums:
        if r == 1:
            out["rank_eq_1"] += 1
        if r <= 5:
            out["rank_le_5"] += 1
        if r <= 10:
            out["rank_le_10"] += 1
        if r <= 50:
            out["rank_le_50"] += 1
        if r <= 100:
            out["rank_le_100"] += 1
        if r <= 500:
            out["rank_le_500"] += 1
        if r <= 1000:
            out["rank_le_1000"] += 1
        if r > 1000:
            out["rank_gt_1000"] += 1
    return out


def topk_counts(ranks: list[int | float | None]) -> dict[str, int]:
    nums = [int(r) for r in ranks if r is not None]
    return {
        "TARGET_IN_TOP_1": sum(1 for r in nums if r <= 1),
        "TARGET_IN_TOP_5": sum(1 for r in nums if r <= 5),
        "TARGET_IN_TOP_10": sum(1 for r in nums if r <= 10),
        "TARGET_IN_TOP_50": sum(1 for r in nums if r <= 50),
        "TARGET_IN_TOP_100": sum(1 for r in nums if r <= 100),
        "TARGET_IN_TOP_500": sum(1 for r in nums if r <= 500),
        "n": len(nums),
    }


def margin_stats(margins: list[float | None]) -> dict[str, Any]:
    vals = [float(x) for x in margins if x is not None]
    if not vals:
        return {"n": 0, "mean": None, "median": None, "p10": None, "p25": None, "p50": None, "p75": None, "p90": None}
    return {
        "n": len(vals),
        "mean": sum(vals) / len(vals),
        "median": float(median(vals)),
        "p10": _percentile(vals, 10),
        "p25": _percentile(vals, 25),
        "p50": _percentile(vals, 50),
        "p75": _percentile(vals, 75),
        "p90": _percentile(vals, 90),
        "min": min(vals),
        "max": max(vals),
    }


def teacher_force_item(*, model, tokenizer, device, ex: dict[str, Any]) -> dict[str, Any]:
    import math

    row = teacher_force_item_000010(model=model, tokenizer=tokenizer, device=device, ex=ex)
    if not row.get("ok"):
        return row
    # Log-prob margin equals logit margin. Do not run a second forward during eval.
    first_prob = row.get("TARGET_FIRST_TOKEN_PROBABILITY")
    margin = row.get("MARGIN_BETWEEN_TARGET_FIRST_TOKEN_AND_ARGMAX")
    eps = 1e-12
    argmax_prob = None
    if first_prob is not None and margin is not None:
        argmax_prob = float(first_prob) - float(margin)
    row["TARGET_LOGIT"] = float(math.log(max(float(first_prob), eps))) if first_prob is not None else None
    row["ARGMAX_LOGIT"] = float(math.log(max(float(argmax_prob), eps))) if argmax_prob is not None else None
    if row["TARGET_LOGIT"] is not None and row["ARGMAX_LOGIT"] is not None:
        row["LOGIT_MARGIN_TO_ARGMAX"] = float(row["TARGET_LOGIT"] - row["ARGMAX_LOGIT"])
    else:
        row["LOGIT_MARGIN_TO_ARGMAX"] = None
    return row


def teacher_force_capability(*, model, tokenizer, device, items: list[dict[str, Any]]) -> dict[str, Any]:
    rows = []
    by_cat: dict[str, list[dict[str, Any]]] = {"instruction": [], "json": [], "code": [], "stopping": []}
    for ex in items:
        row = teacher_force_item(model=model, tokenizer=tokenizer, device=device, ex=ex)
        rows.append(row)
        cat = str(row.get("category") or "")
        if cat in by_cat and row.get("ok"):
            by_cat[cat].append(row)

    def agg(vals: list[dict[str, Any]]) -> dict[str, Any]:
        probs = [float(v["TARGET_FIRST_TOKEN_PROBABILITY"]) for v in vals if v.get("TARGET_FIRST_TOKEN_PROBABILITY") is not None]
        ranks = [float(v["TARGET_FIRST_TOKEN_RANK"]) for v in vals if v.get("TARGET_FIRST_TOKEN_RANK") is not None]
        nlls = [float(v["TARGET_SEQUENCE_AVG_NLL"]) for v in vals if v.get("TARGET_SEQUENCE_AVG_NLL") is not None]
        eos = [float(v["EOS_PROBABILITY_AT_CORRECT_STOP"]) for v in vals if v.get("EOS_PROBABILITY_AT_CORRECT_STOP") is not None]
        stop_ranks = [float(v["TARGET_STOP_TOKEN_RANK"]) for v in vals if v.get("TARGET_STOP_TOKEN_RANK") is not None]
        margins = [float(v["MARGIN_BETWEEN_TARGET_FIRST_TOKEN_AND_ARGMAX"]) for v in vals if v.get("MARGIN_BETWEEN_TARGET_FIRST_TOKEN_AND_ARGMAX") is not None]
        logit_margins = [float(v["LOGIT_MARGIN_TO_ARGMAX"]) for v in vals if v.get("LOGIT_MARGIN_TO_ARGMAX") is not None]
        json_m = [float(v["PROBABILITY_MASS_ON_VALID_JSON_START"]) for v in vals if v.get("PROBABILITY_MASS_ON_VALID_JSON_START") is not None]
        code_m = [float(v["PROBABILITY_MASS_ON_CODE_START"]) for v in vals if v.get("PROBABILITY_MASS_ON_CODE_START") is not None]
        inst = [v for v in vals if v.get("category") == "instruction"]
        stop = [v for v in vals if v.get("category") == "stopping"]
        return {
            "n": len(vals),
            "TARGET_FIRST_TOKEN_PROBABILITY": (sum(probs) / len(probs)) if probs else None,
            "TARGET_FIRST_TOKEN_RANK": (sum(ranks) / len(ranks)) if ranks else None,
            "TARGET_SEQUENCE_AVG_NLL": (sum(nlls) / len(nlls)) if nlls else None,
            "EOS_PROBABILITY_AT_CORRECT_STOP": (sum(eos) / len(eos)) if eos else None,
            "TARGET_STOP_TOKEN_RANK": (sum(stop_ranks) / len(stop_ranks)) if stop_ranks else None,
            "MARGIN_BETWEEN_TARGET_FIRST_TOKEN_AND_ARGMAX": (sum(margins) / len(margins)) if margins else None,
            "LOGIT_MARGIN_TO_ARGMAX": (sum(logit_margins) / len(logit_margins)) if logit_margins else None,
            "LOGIT_MARGIN_STATS": margin_stats(logit_margins),
            "PROBABILITY_MASS_ON_VALID_JSON_START": (sum(json_m) / len(json_m)) if json_m else None,
            "PROBABILITY_MASS_ON_CODE_START": (sum(code_m) / len(code_m)) if code_m else None,
            "median_first_token_rank": (sorted(ranks)[len(ranks) // 2] if ranks else None),
            "TARGET_FIRST_TOKEN_RANK_BUCKETS": bucket_ranks([v.get("TARGET_FIRST_TOKEN_RANK") for v in inst]),
            "STOP_TOKEN_RANK_BUCKETS": bucket_ranks([v.get("TARGET_STOP_TOKEN_RANK") for v in vals if v.get("category") in {"instruction", "stopping"}]),
            "TARGET_TOPK": topk_counts([v.get("TARGET_FIRST_TOKEN_RANK") for v in inst]),
            "STOP_TOPK": topk_counts([v.get("TARGET_STOP_TOKEN_RANK") for v in stop or vals]),
        }

    overall = agg([r for r in rows if r.get("ok")])
    inst_stop = agg([r for r in rows if r.get("ok") and r.get("category") in {"instruction", "stopping"}])
    return {
        "n": len(rows),
        "ok_n": int(sum(1 for r in rows if r.get("ok"))),
        "overall": overall,
        "instruction_stopping": inst_stop,
        "by_category": {k: agg(v) for k, v in by_cat.items()},
        "items": rows,
    }


def per_example_deltas(
    now_items: list[dict[str, Any]],
    parent_items: list[dict[str, Any]],
    greedy_items: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    parent_by = {str(r.get("example_id")): r for r in parent_items}
    greedy_by = {}
    for g in greedy_items or []:
        eid = str(g.get("example_id") or g.get("id") or "")
        greedy_by[eid] = g
    rows = []
    for r in now_items:
        eid = str(r.get("example_id"))
        p = parent_by.get(eid) or {}
        g = greedy_by.get(eid) or {}
        r0 = p.get("TARGET_FIRST_TOKEN_RANK")
        r1 = r.get("TARGET_FIRST_TOKEN_RANK")
        p0 = p.get("TARGET_FIRST_TOKEN_PROBABILITY")
        p1 = r.get("TARGET_FIRST_TOKEN_PROBABILITY")
        rank_delta = None if r0 is None or r1 is None else int(r1) - int(r0)
        prob_delta = None if p0 is None or p1 is None else float(p1) - float(p0)
        rows.append(
            {
                "ITEM_ID": eid,
                "STEP0_TARGET_FIRST_TOKEN_RANK": r0,
                "CURRENT_TARGET_FIRST_TOKEN_RANK": r1,
                "RANK_DELTA": rank_delta,
                "STEP0_TARGET_PROB": p0,
                "CURRENT_TARGET_PROB": p1,
                "PROB_DELTA": prob_delta,
                "GREEDY_CORRECT": bool(g.get("correct") or g.get("CORRECT") or g.get("pass")),
                "EOS_CORRECT": bool(g.get("eos_correct") or (g.get("stopped") and g.get("correct"))),
                "CATEGORY": r.get("category"),
                "STEP0_LOGIT_MARGIN": p.get("LOGIT_MARGIN_TO_ARGMAX"),
                "CURRENT_LOGIT_MARGIN": r.get("LOGIT_MARGIN_TO_ARGMAX"),
            }
        )
    improved = [x for x in rows if x.get("RANK_DELTA") is not None and x["RANK_DELTA"] < 0]
    worsened = [x for x in rows if x.get("RANK_DELTA") is not None and x["RANK_DELTA"] > 0]
    by_cat: dict[str, list[int]] = {}
    for x in rows:
        cat = str(x.get("CATEGORY") or "unknown")
        by_cat.setdefault(cat, [])
        if x.get("RANK_DELTA") is not None:
            by_cat[cat].append(int(x["RANK_DELTA"]))
    family = {}
    for cat, deltas in by_cat.items():
        family[cat] = {
            "n": len(deltas),
            "mean_rank_delta": (sum(deltas) / len(deltas)) if deltas else None,
            "improved_n": sum(1 for d in deltas if d < 0),
            "worsened_n": sum(1 for d in deltas if d > 0),
        }
    ranked_fam = sorted(family.items(), key=lambda kv: (kv[1]["mean_rank_delta"] is None, kv[1]["mean_rank_delta"] or 0))
    return {
        "items": rows,
        "improved_n": len(improved),
        "worsened_n": len(worsened),
        "mean_rank_delta": (sum(x["RANK_DELTA"] for x in rows if x.get("RANK_DELTA") is not None) / max(1, sum(1 for x in rows if x.get("RANK_DELTA") is not None))),
        "BEST_IMPROVING_ITEM_FAMILIES": [{"family": k, **v} for k, v in ranked_fam[:4]],
        "WORST_ITEM_FAMILIES": [{"family": k, **v} for k, v in list(reversed(ranked_fam))[:4]],
        "by_family": family,
    }


def attach_rank_diagnostics(tf: dict[str, Any], parent_tf: dict[str, Any] | None, greedy_items: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    items = list(tf.get("items") or [])
    parent_items = list((parent_tf or {}).get("items") or [])
    inst = [r for r in items if r.get("ok") and r.get("category") == "instruction"]
    stop = [r for r in items if r.get("ok") and r.get("category") == "stopping"]
    inst_stop = [r for r in items if r.get("ok") and r.get("category") in {"instruction", "stopping"}]
    deltas = per_example_deltas(inst_stop, parent_items, greedy_items)
    block = {
        "TARGET_FIRST_TOKEN_RANK_BUCKETS": bucket_ranks([r.get("TARGET_FIRST_TOKEN_RANK") for r in inst]),
        "STOP_TOKEN_RANK_BUCKETS": bucket_ranks([r.get("TARGET_STOP_TOKEN_RANK") for r in inst_stop]),
        "TARGET_TOPK": topk_counts([r.get("TARGET_FIRST_TOKEN_RANK") for r in inst]),
        "STOP_TOPK": topk_counts([r.get("TARGET_STOP_TOKEN_RANK") for r in stop]),
        "TARGET_LOGIT_MARGIN_STATS": margin_stats([r.get("LOGIT_MARGIN_TO_ARGMAX") for r in inst_stop]),
        "PER_EXAMPLE_DELTAS": {k: v for k, v in deltas.items() if k != "items"},
        "PER_EXAMPLE_DELTAS_ITEMS": deltas.get("items"),
        "BEST_IMPROVING_ITEM_FAMILIES": deltas.get("BEST_IMPROVING_ITEM_FAMILIES"),
        "WORST_ITEM_FAMILIES": deltas.get("WORST_ITEM_FAMILIES"),
    }
    return block
