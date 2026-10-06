"""WRIM1-PLM-000002 hard-stop and signal gates. Does not train."""
from __future__ import annotations

from typing import Any

from wrim_plm2_identity import (
    GRAD_HARD,
    STAGE3_PARENT_DRIFT_HARD,
    STAGE3_REVIEW_DELTA,
    STEP400_STAGE3_COLLAPSE,
    STEP400_STAGE3_DELTA_VS_WRIM0,
)


def hard_hits(bundle: dict[str, Any]) -> list[str]:
    hits: list[str] = []
    hist = bundle.get("stage3_historical")
    coll = bundle.get("stage3_collapse")
    delta = bundle.get("stage3_delta_nll")
    grad = bundle.get("grad_norm")
    if hist is not None and int(hist) < 5:
        hits.append("STAGE3_HISTORICAL")
    if coll is not None and int(coll) > 5:
        hits.append("STAGE3_COLLAPSE")
    if coll is not None and int(coll) > int(STEP400_STAGE3_COLLAPSE) + 2:
        hits.append("STAGE3_COLLAPSE_VS_STEP400")
    if delta is not None:
        drift = float(delta) - float(STEP400_STAGE3_DELTA_VS_WRIM0)
        if drift > float(STAGE3_PARENT_DRIFT_HARD):
            hits.append("STAGE3_CUMULATIVE_CATASTROPHE")
    if bundle.get("nan"):
        hits.append("NAN_INF")
    if grad is not None and float(grad) >= float(GRAD_HARD):
        hits.append("GRAD_INSTABILITY")
    return hits


def classify_entry(parent: dict[str, Any], final: dict[str, Any], *, hard: bool) -> str:
    if hard:
        return "HARMFUL"
    gf = int(final.get("GREEDY_FIRST_TOKEN_MATCH") or 0)
    nl = final.get("NEWLINE_ARGMAX_RATE")
    classes = final.get("by_class") or []
    n_cls_hit = sum(1 for c in classes if int(c.get("GREEDY_MATCH") or 0) > 0)
    gap0 = parent.get("TARGET_MINUS_NEWLINE_LOGIT_GAP")
    gap1 = final.get("TARGET_MINUS_NEWLINE_LOGIT_GAP")
    gap_shrink = gap0 is not None and gap1 is not None and (float(gap1) - float(gap0)) >= 1.0
    if gf > 0 and nl is not None and float(nl) < 1.0:
        if gf >= 3 and n_cls_hit >= 2 and gap_shrink:
            return "STRONG"
        if gf >= 3 and n_cls_hit >= 2:
            return "STRONG"
        return "STRONG" if gf >= 5 else "WEAK"
    pr = parent.get("FIRST_TARGET_TOKEN_RANK")
    fr = final.get("FIRST_TARGET_TOKEN_RANK")
    pp = parent.get("FIRST_TARGET_TOKEN_PROBABILITY")
    fp = final.get("FIRST_TARGET_TOKEN_PROBABILITY")
    rank_move = pr is not None and fr is not None and (float(pr) - float(fr)) >= max(20.0, 0.10 * float(pr))
    prob_move = pp is not None and fp is not None and (float(fp) - float(pp)) >= 0.01
    if rank_move or prob_move or gap_shrink:
        return "WEAK"
    if nl is not None and float(nl) >= 1.0 and gf == 0:
        return "ABSENT"
    return "ABSENT"
