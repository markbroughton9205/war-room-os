"""WRIM1-CPT-000005 retention/plateau/top5 gates. Does not train."""
from __future__ import annotations

from typing import Any

from wrim_cpt5_identity import (
    CPT000004_STAGE3_DELTA_VS_WRIM0,
    FOUNDATION_TOP5_HARD,
    FOUNDATION_TOP5_REVIEW,
    STAGE3_CATASTROPHE_VS_WRIM0,
    STAGE3_PARENT_DRIFT_HARD,
    STAGE3_REVIEW_DELTA,
    STEP400_STAGE3_COLLAPSE,
    STEP400_STAGE3_DELTA_VS_WRIM0,
)
from wrim_cpt_stage_b_corpus import b1_hard_gate_hits

# CPT-000004 already sits below 0.45 EOS argmax; local step>50 would false-trip EOS_COLLAPSE.
FILTER_FROM_B1 = {
    "STAGE3_RETENTION",  # 1.15 is REVIEW
    "EOS_COLLAPSE",
    "FOUNDATION_TOP5_COLLAPSE",  # replaced by <=3 hard / <=4 review
}


def stage3_review_triggered(delta_vs_wrim0: float | None) -> bool:
    if delta_vs_wrim0 is None:
        return False
    return float(delta_vs_wrim0) >= float(STAGE3_REVIEW_DELTA)


def cpt5_stage3_hard_hits(
    *,
    historical_pass_count: int | None,
    n_collapsed: int | None,
    delta_vs_wrim0: float | None,
) -> list[str]:
    hits: list[str] = []
    if historical_pass_count is not None and int(historical_pass_count) < 5:
        hits.append("STAGE3_HISTORICAL")
    if n_collapsed is not None and int(n_collapsed) > 5:
        hits.append("STAGE3_COLLAPSE")
    if n_collapsed is not None and int(n_collapsed) > int(STEP400_STAGE3_COLLAPSE) + 2:
        hits.append("STAGE3_COLLAPSE_VS_STEP400")
    if delta_vs_wrim0 is not None:
        drift = float(delta_vs_wrim0) - float(STEP400_STAGE3_DELTA_VS_WRIM0)
        if drift > float(STAGE3_PARENT_DRIFT_HARD) or float(delta_vs_wrim0) > float(STAGE3_CATASTROPHE_VS_WRIM0):
            hits.append("STAGE3_CUMULATIVE_CATASTROPHE")
    return hits


def cpt5_top5_hits(top5: int | None) -> tuple[list[str], bool]:
    """Return (hard_hits, review)."""
    if top5 is None:
        return [], False
    hard: list[str] = []
    review = False
    if int(top5) <= int(FOUNDATION_TOP5_HARD):
        hard.append("FOUNDATION_TOP5_COLLAPSE")
    if int(top5) <= int(FOUNDATION_TOP5_REVIEW):
        review = True
    return hard, review


def cpt5_hard_gate_hits(bundle: dict[str, Any]) -> tuple[list[str], dict[str, bool]]:
    raw = b1_hard_gate_hits(bundle)
    filtered = [h for h in raw if h not in FILTER_FROM_B1]
    s3 = cpt5_stage3_hard_hits(
        historical_pass_count=None if bundle.get("stage3_historical") is None else int(bundle["stage3_historical"]),
        n_collapsed=None if bundle.get("stage3_collapse") is None else int(bundle["stage3_collapse"]),
        delta_vs_wrim0=None if bundle.get("stage3_delta_nll") is None else float(bundle["stage3_delta_nll"]),
    )
    top5_hard, top5_review = cpt5_top5_hits(None if bundle.get("foundation_top5") is None else int(bundle["foundation_top5"]))
    review_flags = {
        "STAGE3_NLL_REVIEW": stage3_review_triggered(
            None if bundle.get("stage3_delta_nll") is None else float(bundle["stage3_delta_nll"])
        ),
        "FOUNDATION_TOP5_REVIEW": top5_review and not bool(top5_hard),
    }
    hits: list[str] = []
    for h in filtered + s3 + top5_hard:
        if h not in hits:
            hits.append(h)
    return hits, review_flags


def interval_trend(prev: dict[str, Any], cur: dict[str, Any]) -> str:
    """Classify one eval interval: IMPROVING / PLATEAUING / DEGRADING."""
    specs = [
        ("independent_nl_nll", True, 0.01),
        ("general_nll", True, 0.01),
        ("genesis_nll", True, 0.01),
        ("code_nll", True, 0.01),
        ("json_nll", True, 0.01),
        ("foundation_rank", True, 5.0),
    ]
    votes = []
    for key, lower_better, eps in specs:
        a, b = prev.get(key), cur.get(key)
        if a is None or b is None:
            continue
        if lower_better:
            if float(b) < float(a) - eps:
                votes.append("IMPROVING")
            elif float(b) > float(a) + eps:
                votes.append("DEGRADING")
            else:
                votes.append("PLATEAUING")
    if not votes:
        return "INCONCLUSIVE"
    if votes.count("DEGRADING") >= 4:
        return "DEGRADING"
    if votes.count("IMPROVING") >= 4:
        return "IMPROVING"
    if votes.count("IMPROVING") > votes.count("DEGRADING"):
        return "IMPROVING"
    if votes.count("DEGRADING") > votes.count("IMPROVING"):
        return "DEGRADING"
    return "PLATEAUING"


def self_test_cpt5_gates() -> dict[str, Any]:
    failures: list[str] = []

    def run(hist, coll, delta, top5=6, step=40):
        return cpt5_hard_gate_hits(
            {
                "stage3_historical": hist,
                "stage3_collapse": coll,
                "stage3_delta_nll": delta,
                "foundation_top5": top5,
                "step": step,
                "eos_argmax": 0.33,
                "eos_greedy_stop": 4,
            }
        )

    hits, flags = run(6, 0, 1.1536)
    if hits:
        failures.append(f"1.15 review must not hard-stop, got {hits}")
    if not flags["STAGE3_NLL_REVIEW"]:
        failures.append("1.1536 must set STAGE3_NLL_REVIEW")

    hits, _ = run(6, 0, STEP400_STAGE3_DELTA_VS_WRIM0 + 0.284)
    if hits:
        failures.append(f"CPT-000004 ending drift must continue, got {hits}")

    hits, _ = run(6, 0, STEP400_STAGE3_DELTA_VS_WRIM0 + 0.849)
    if "STAGE3_CUMULATIVE_CATASTROPHE" not in hits:
        failures.append("cumulative drift > 0.848 vs STEP_400 must hard-stop")

    hits, _ = run(4, 0, 1.0)
    if "STAGE3_HISTORICAL" not in hits:
        failures.append("hist 4 must hard-stop")

    hits, flags = run(6, 0, 1.0, top5=4)
    if hits:
        failures.append(f"top5=4 is review not hard, got {hits}")
    if not flags["FOUNDATION_TOP5_REVIEW"]:
        failures.append("top5=4 must set FOUNDATION_TOP5_REVIEW")

    hits, _ = run(6, 0, 1.0, top5=3)
    if "FOUNDATION_TOP5_COLLAPSE" not in hits:
        failures.append("top5=3 must hard-stop")

    hits, _ = run(6, 0, 1.0, step=75)
    if "EOS_COLLAPSE" in hits:
        failures.append("inherited 0.33 EOS argmax must not hard-stop at local step>50")

    t = interval_trend(
        {"independent_nl_nll": 7.0, "general_nll": 6.0, "genesis_nll": 5.0, "code_nll": 4.5, "json_nll": 4.1, "foundation_rank": 2017},
        {"independent_nl_nll": 6.9, "general_nll": 5.9, "genesis_nll": 4.9, "code_nll": 4.4, "json_nll": 4.0, "foundation_rank": 2000},
    )
    if t != "IMPROVING":
        failures.append(f"all-improving interval must be IMPROVING, got {t}")

    return {"ok": not failures, "failures": failures, "n_checks": 8}
