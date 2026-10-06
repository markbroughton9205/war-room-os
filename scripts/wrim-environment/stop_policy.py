"""Canonical WRIM generation stop policy (P1).

Single source of truth for HARD_ABORT / SOFT_STOP / REVIEW_REQUIRED / CONTINUE_ELIGIBLE.
Imported by the P1 replay and by any future P2 runner. Do not fork this logic.
Does not create an optimizer. Does not train.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

POLICY_PATH = Path(__file__).with_name("stop_policy.json")
POLICY: dict[str, Any] = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
STOP_POLICY_VERSION = str(POLICY["version"])


def snapshot_from_compact(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "looping": int(row.get("dev_looping") if row.get("dev_looping") is not None else row.get("looping") or 0),
        "collapse": int(row.get("dev_collapsed") if row.get("dev_collapsed") is not None else row.get("collapse") or 0),
        "unique128": float(row.get("dev_unique_128") if row.get("dev_unique_128") is not None else row.get("unique128") or 0.0),
        "unique256": float(row.get("dev_unique_256") if row.get("dev_unique_256") is not None else row.get("unique256") or 0.0),
        "json_valid": int(row.get("dev_json_valid") if row.get("dev_json_valid") is not None else row.get("json_valid") or 0),
        "instruction": int(row.get("dev_instruction_ok") if row.get("dev_instruction_ok") is not None else row.get("instruction") or 0),
        "entity": int(row.get("dev_entity_ok") if row.get("dev_entity_ok") is not None else row.get("entity") or 0),
        "dnll": row.get("dnll"),
        "kl": row.get("kl"),
        "val0": row.get("val0"),
        "cap_pass": row.get("cap_pass"),
        "special_rate": row.get("special_rate"),
        "nan_or_inf": bool(row.get("nan_or_inf")),
        "hash_mismatch": bool(row.get("hash_mismatch")),
        "contamination": bool(row.get("contamination")),
        "disk_integrity_failure": bool(row.get("disk_integrity_failure")),
    }


def floor_status(parent: int, cand: int) -> str:
    if parent == 0 and cand == 0:
        return "UNCHANGED_AT_FLOOR"
    if parent == 0 and cand > 0:
        return "LEFT_FLOOR"
    if cand < parent:
        return "DEGRADED"
    if cand > parent:
        return "IMPROVED"
    return "UNCHANGED"


def _unique_cmp(cand: float, parent: float) -> str:
    deg = float(POLICY["unique_degrade_delta"])
    imp = float(POLICY["unique_improve_delta"])
    if cand < parent - deg:
        return "DEGRADED"
    if cand > parent + imp:
        return "IMPROVED"
    return "UNCHANGED"


def _count_cmp(cand: int, parent: int, *, degrade_delta: int, improve_delta: int) -> str:
    if cand >= parent + degrade_delta:
        return "DEGRADED"
    if cand <= parent - improve_delta:
        return "IMPROVED"
    return "UNCHANGED"


def generation_axis_states(parent: dict[str, Any], cand: dict[str, Any]) -> dict[str, str]:
    return {
        "looping": _count_cmp(int(cand["looping"]), int(parent["looping"]), degrade_delta=int(POLICY["looping_degrade_delta"]), improve_delta=int(POLICY["looping_improve_delta"])),
        "collapse": _count_cmp(int(cand["collapse"]), int(parent["collapse"]), degrade_delta=int(POLICY["collapse_degrade_delta"]), improve_delta=int(POLICY["collapse_improve_delta"])),
        "unique128": _unique_cmp(float(cand["unique128"]), float(parent["unique128"])),
        "unique256": _unique_cmp(float(cand["unique256"]), float(parent["unique256"])),
    }


def floor_metric_states(parent: dict[str, Any], cand: dict[str, Any]) -> dict[str, str]:
    out = {}
    for key in POLICY["floor_metrics"]:
        out[key] = floor_status(int(parent.get(key) or 0), int(cand.get(key) or 0))
    return out


def generation_hits(states: dict[str, str]) -> list[str]:
    return [axis for axis in POLICY["generation_axes"] if states.get(axis) == "DEGRADED"]


def hard_abort_reason(cand: dict[str, Any]) -> str | None:
    if cand.get("nan_or_inf"):
        return "NaN_or_Inf"
    if cand.get("hash_mismatch"):
        return "hash_mismatch"
    if cand.get("contamination"):
        return "contamination"
    if cand.get("disk_integrity_failure"):
        return "disk_runtime_integrity_failure"
    ha = POLICY["hard_abort"]
    dnll = cand.get("dnll")
    kl = cand.get("kl")
    val0 = cand.get("val0")
    cap = cand.get("cap_pass")
    special = cand.get("special_rate")
    if dnll is not None and float(dnll) > float(ha["dnll_gt"]):
        return "dnll_gt_0.105"
    if kl is not None and float(kl) > float(ha["kl_gt"]):
        return "kl_gt_0.018"
    if val0 is not None and float(val0) > float(ha["val0_gt"]):
        return "val0_gt_parent"
    if cap is not None and int(cap) <= int(ha["cap_le"]):
        return "cap_le_3_of_6"
    if special is not None and float(special) > float(ha["special_rate_gt"]):
        return "special_rate_gt_0.08"
    return None


def decide(parent: dict[str, Any], cand: dict[str, Any]) -> dict[str, Any]:
    hard = hard_abort_reason(cand)
    axes = generation_axis_states(parent, cand)
    floors = floor_metric_states(parent, cand)
    hits = generation_hits(axes)
    improvements = [axis for axis in POLICY["generation_axes"] if axes.get(axis) == "IMPROVED"]
    if hard:
        decision = "HARD_ABORT"
    elif len(hits) >= int(POLICY["soft_stop_min_hits"]):
        decision = "SOFT_STOP"
    elif len(hits) >= int(POLICY["review_required_hits"]):
        decision = "REVIEW_REQUIRED"
    else:
        decision = "CONTINUE_ELIGIBLE"
    next_allowed = decision == "CONTINUE_ELIGIBLE"
    artifact = None
    if decision == "HARD_ABORT":
        artifact = "ABORT.json"
    elif decision == "SOFT_STOP":
        artifact = "SOFT_STOP.json"
    elif decision == "REVIEW_REQUIRED":
        artifact = "REVIEW_REQUIRED.json"
    return {
        "policy_version": STOP_POLICY_VERSION,
        "decision": decision,
        "hard_abort_reason": hard,
        "generation_axis_states": axes,
        "floor_metric_states": floors,
        "hits": hits,
        "hit_count": len(hits),
        "improvements": improvements,
        "next_optimizer_step_allowed": next_allowed,
        "artifact": artifact,
        "training_authorization_after": "OFF" if not next_allowed else "UNCHANGED_STILL_REQUIRES_COMMANDER",
        "note": "CONTINUE_ELIGIBLE is not authorization. TRAINING_AUTHORIZATION remains OFF until a Commander pass.",
    }


def simulate_boundary(parent: dict[str, Any], cand: dict[str, Any], *, checkpoint_n: int) -> dict[str, Any]:
    out = decide(parent, cand)
    return {
        **out,
        "checkpoint": checkpoint_n,
        "next_step": checkpoint_n + 1,
        "would_emit": out["artifact"],
        "step_n_plus_1_blocked": not out["next_optimizer_step_allowed"],
    }
