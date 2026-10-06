"""WRIM1-PLM-000001 hard-stop gates. Does not train."""
from __future__ import annotations

from typing import Any

from wrim_plm1_identity import (
    GRAD_HARD,
    PARENT_STAGE3_DELTA_VS_WRIM0,
    STAGE3_PARENT_DRIFT_HARD,
    STAGE3_REVIEW_DELTA,
    STEP400_STAGE3_COLLAPSE,
    STEP400_STAGE3_DELTA_VS_WRIM0,
)


def stage3_review(delta_vs_wrim0: float | None) -> bool:
    return delta_vs_wrim0 is not None and float(delta_vs_wrim0) >= float(STAGE3_REVIEW_DELTA)


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


def classify_signal(parent: dict[str, Any], final: dict[str, Any], *, hard: bool) -> str:
    if hard:
        return "HARMFUL"
    pr = parent.get("FIRST_TARGET_TOKEN_RANK")
    fr = final.get("FIRST_TARGET_TOKEN_RANK")
    pp = parent.get("FIRST_TARGET_TOKEN_PROBABILITY")
    fp = final.get("FIRST_TARGET_TOKEN_PROBABILITY")
    pt5 = int(parent.get("FIRST_TARGET_TOP5_COUNT") or 0)
    ft5 = int(final.get("FIRST_TARGET_TOP5_COUNT") or 0)
    gf = int(final.get("GREEDY_FIRST_TOKEN_MATCH") or 0)
    ge = int(final.get("GREEDY_EXACT_ANSWER") or 0)
    gs = int(final.get("GREEDY_SHORT_ANSWER_CORRECT") or 0)
    gp = int(parent.get("GREEDY_FIRST_TOKEN_MATCH") or 0)
    rank_move = pr is not None and fr is not None and (float(pr) - float(fr)) >= max(20.0, 0.15 * float(pr))
    prob_move = pp is not None and fp is not None and (float(fp) - float(pp)) >= 0.02
    top_move = ft5 > pt5
    greedy_new = (gf > gp) or (ge > 0) or (gs > int(parent.get("GREEDY_SHORT_ANSWER_CORRECT") or 0))
    if greedy_new or rank_move or prob_move or top_move:
        nll_p = parent.get("TARGET_SEQUENCE_NLL")
        nll_f = final.get("TARGET_SEQUENCE_NLL")
        if greedy_new or rank_move or top_move:
            return "PRESENT"
        if prob_move and nll_p is not None and nll_f is not None and float(nll_f) < float(nll_p) - 0.05:
            return "PRESENT"
        return "WEAK"
    nll_p = parent.get("TARGET_SEQUENCE_NLL")
    nll_f = final.get("TARGET_SEQUENCE_NLL")
    if nll_p is not None and nll_f is not None and float(nll_f) < float(nll_p) - 0.05:
        return "WEAK"
    return "ABSENT"
