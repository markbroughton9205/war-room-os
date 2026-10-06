"""Stage 3 correctness aggregation for WRIM1-RUN-000008.

Non-collapsed != correct. No optimizer.
"""
from __future__ import annotations

from typing import Any

from run000007_gates import item_collapsed, json_correct


SKIP = {"primary_collapsed", "primary_special_loop", "special_rate_ok"}


def constraint_correct(it: dict[str, Any]) -> bool:
    if item_collapsed(it):
        return False
    scores = dict(it.get("category_scores") or {})
    keys = [k for k in scores if k not in SKIP]
    if not keys:
        return False
    return all(bool(scores[k]) for k in keys)


def code_correct(it: dict[str, Any]) -> bool:
    return constraint_correct(it)


def instruction_correct(it: dict[str, Any]) -> bool:
    return constraint_correct(it)


def stopping_proxy_correct(it: dict[str, Any]) -> bool:
    """s3-spec-05 and similar stop items: constraint pass and no long identical run."""
    if not constraint_correct(it):
        return False
    d = it.get("descriptive_256") or {}
    max_run = d.get("max_token_run")
    if max_run is not None and int(max_run) >= 20:
        return False
    return True


def category_correctness(items: list[dict[str, Any]]) -> dict[str, Any]:
    by = {"JSON_STRUCTURED_OUTPUT": [], "CODE": [], "INSTRUCTION_FOLLOWING": [], "SPECIAL_TOKEN_STABILITY": []}
    for it in items:
        cat = str(it.get("category") or "")
        if cat in by:
            by[cat].append(it)
    json_items = by["JSON_STRUCTURED_OUTPUT"]
    code_items = by["CODE"]
    inst_items = by["INSTRUCTION_FOLLOWING"]
    spec_items = by["SPECIAL_TOKEN_STABILITY"]
    json_n = sum(1 for it in json_items if json_correct(it))
    code_n = sum(1 for it in code_items if code_correct(it))
    inst_n = sum(1 for it in inst_items if instruction_correct(it))
    stop_ids = {"s3-spec-05", "s3-inst-02"}
    stop_items = [it for it in items if it.get("item_id") in stop_ids] or spec_items
    stop_n = sum(1 for it in stop_items if stopping_proxy_correct(it))
    return {
        "JSON_CORRECT_COUNT": json_n,
        "JSON_TOTAL": len(json_items),
        "JSON_CORRECTNESS": f"{json_n}/{len(json_items)}",
        "CODE_CORRECT_COUNT": code_n,
        "CODE_TOTAL": len(code_items),
        "CODE_CORRECTNESS": f"{code_n}/{len(code_items)}",
        "INSTRUCTION_CORRECT_COUNT": inst_n,
        "INSTRUCTION_TOTAL": len(inst_items),
        "INSTRUCTION_CORRECTNESS": f"{inst_n}/{len(inst_items)}",
        "STOPPING_CORRECT_COUNT": stop_n,
        "STOPPING_TOTAL": len(stop_items),
        "STOPPING_CORRECTNESS": f"{stop_n}/{len(stop_items)}" if stop_items else None,
        "json_pass_ids": [it.get("item_id") for it in json_items if json_correct(it)],
        "code_pass_ids": [it.get("item_id") for it in code_items if code_correct(it)],
        "instruction_pass_ids": [it.get("item_id") for it in inst_items if instruction_correct(it)],
    }
