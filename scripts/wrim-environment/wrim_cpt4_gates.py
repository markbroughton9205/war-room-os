"""WRIM1-CPT-000004 Stage 3 retention gate semantics. Does not train."""
from __future__ import annotations

from typing import Any

from wrim_cpt4_identity import (
    PARENT_STAGE3_COLLAPSE,
    PARENT_STAGE3_DELTA_VS_WRIM0,
    STAGE3_CATASTROPHE_VS_WRIM0,
    STAGE3_PARENT_DRIFT_HARD,
    STAGE3_REVIEW_DELTA,
)
from wrim_cpt_stage_b_corpus import b1_hard_gate_hits


def stage3_review_triggered(delta_vs_wrim0: float | None) -> bool:
    if delta_vs_wrim0 is None:
        return False
    return float(delta_vs_wrim0) >= float(STAGE3_REVIEW_DELTA)


def cpt4_stage3_hard_hits(
    *,
    historical_pass_count: int | None,
    n_collapsed: int | None,
    parent_collapse: int | None,
    delta_vs_wrim0: float | None,
    parent_delta: float | None,
) -> list[str]:
    hits: list[str] = []
    if historical_pass_count is not None and int(historical_pass_count) < 5:
        hits.append("STAGE3_HISTORICAL")
    if n_collapsed is not None and int(n_collapsed) > 5:
        hits.append("STAGE3_COLLAPSE")
    pc = PARENT_STAGE3_COLLAPSE if parent_collapse is None else int(parent_collapse)
    if n_collapsed is not None and int(n_collapsed) > pc + 2:
        hits.append("STAGE3_COLLAPSE_VS_PARENT")
    if delta_vs_wrim0 is not None:
        base = float(PARENT_STAGE3_DELTA_VS_WRIM0 if parent_delta is None else parent_delta)
        drift = float(delta_vs_wrim0) - base
        if drift > float(STAGE3_PARENT_DRIFT_HARD) or float(delta_vs_wrim0) > float(STAGE3_CATASTROPHE_VS_WRIM0):
            hits.append("STAGE3_PARENT_RELATIVE_CATASTROPHE")
    return hits


def cpt4_hard_gate_hits(
    bundle: dict[str, Any],
    *,
    parent_collapse: int | None,
    parent_delta: float | None,
) -> tuple[list[str], bool]:
    """Return (hard_hits, stage3_nll_review). 1.15 is review only, not a hard hit."""
    raw = b1_hard_gate_hits(bundle)
    filtered = [h for h in raw if h != "STAGE3_RETENTION"]
    s3 = cpt4_stage3_hard_hits(
        historical_pass_count=None if bundle.get("stage3_historical") is None else int(bundle["stage3_historical"]),
        n_collapsed=None if bundle.get("stage3_collapse") is None else int(bundle["stage3_collapse"]),
        parent_collapse=parent_collapse,
        delta_vs_wrim0=None if bundle.get("stage3_delta_nll") is None else float(bundle["stage3_delta_nll"]),
        parent_delta=parent_delta,
    )
    review = stage3_review_triggered(None if bundle.get("stage3_delta_nll") is None else float(bundle["stage3_delta_nll"]))
    # de-dupe while preserving order
    hits: list[str] = []
    for h in filtered + s3:
        if h not in hits:
            hits.append(h)
    return hits, review


def self_test_cpt4_gates() -> dict[str, Any]:
    """Fail-closed unit checks. No optimizer. No model load."""
    failures: list[str] = []
    parent_c = 3
    parent_d = PARENT_STAGE3_DELTA_VS_WRIM0

    def run(hist, coll, delta):
        return cpt4_hard_gate_hits(
            {
                "stage3_historical": hist,
                "stage3_collapse": coll,
                "stage3_delta_nll": delta,
                "step": 40,
            },
            parent_collapse=parent_c,
            parent_delta=parent_d,
        )

    hits, review = run(6, 0, 1.1536)
    if hits:
        failures.append(f"1.15 review must not hard-stop, got {hits}")
    if not review:
        failures.append("1.1536 must set STAGE3_NLL_REVIEW")

    hits, review = run(6, 0, 1.149)
    if review:
        failures.append("1.149 must not review")
    if hits:
        failures.append(f"1.149 must not hard-stop, got {hits}")

    hits, _ = run(4, 0, 0.9)
    if "STAGE3_HISTORICAL" not in hits:
        failures.append("hist 4 must hard-stop")

    hits, _ = run(6, 6, 0.9)
    if "STAGE3_COLLAPSE" not in hits and "STAGE3_COLLAPSE_VS_PARENT" not in hits:
        failures.append("collapse 6 must hard-stop")

    hits, _ = run(6, 0, parent_d + 0.849)
    if "STAGE3_PARENT_RELATIVE_CATASTROPHE" not in hits:
        failures.append("parent-relative drift > 0.848 must hard-stop")

    hits, review = run(6, 0, parent_d + 0.305)
    if hits:
        failures.append(f"CPT-000003-like +0.305 must continue, got {hits}")
    if not review:
        failures.append("CPT-000003-like +0.305 must review (Δ>=1.15)")

    return {"ok": not failures, "failures": failures, "n_checks": 6}
