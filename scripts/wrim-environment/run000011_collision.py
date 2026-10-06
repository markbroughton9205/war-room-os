"""Hard run-ID collision / existing-run inspect for WRIM1-RUN-000011."""
from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable

from run000007_collision import occupied_reasons
from run000011_identity import LINUX_CKPT_ROOT, MISSION_ORIGIN, RESERVED_HISTORICAL_RUN_IDS, RUN_ID
from wrim_resumable_checkpoint import is_complete_checkpoint, latest_complete_checkpoint, load_manifest


HARD_STOP_MARKERS = (
    "HARD_STOP_GATE",
    "NaN_or_Inf_loss",
    "gradient_hard_stop",
    "PEAK_PASSED_PROTECTED_RISK",
    "ATTRACTOR",
    "retention_hard",
    "CAP_HARD",
    "new_protected_failure",
)


def assert_run_id_unused(run_id: str, search_roots: Iterable[Path]) -> dict[str, Any]:
    hits = occupied_reasons(run_id, search_roots, reserved=RESERVED_HISTORICAL_RUN_IDS)
    unused = len(hits) == 0
    return {
        "run_id": run_id,
        "unused": unused,
        "ok": unused,
        "hits": hits,
        "decision": "PASS" if unused else "INSPECT_EXISTING",
        "overwrite_existing_run": False,
        "mint_another_id": False,
        "canonical_run_id": RUN_ID,
    }


def inspect_existing_run(ckpt_root: Path | None = None) -> dict[str, Any]:
    root = Path(ckpt_root or LINUX_CKPT_ROOT)
    origin_path = root / "run-origin.json"
    origin = None
    if origin_path.is_file():
        import json

        try:
            origin = json.loads(origin_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            origin = {"unreadable": True}
    created_by_this_mission = bool(origin) and origin.get("CREATED_BY_MISSION") == MISSION_ORIGIN
    latest = latest_complete_checkpoint(root) if root.is_dir() else None
    abort = root / "abort.json"
    summary = root / "training-summary.json"
    hard = False
    hard_reason = None
    for p in (abort, summary):
        if not p.is_file():
            continue
        import json

        try:
            obj = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if obj.get("HARD_STOP_TRIGGERED") or obj.get("action") == "HARD_STOP":
            hard = True
            hard_reason = obj.get("stop_reason") or obj.get("reason")
        sr = str(obj.get("stop_reason") or "")
        if any(m.lower() in sr.lower() for m in HARD_STOP_MARKERS):
            hard = True
            hard_reason = sr
    weights = list(root.rglob("model.safetensors")) if root.is_dir() else []
    return {
        "exists": root.is_dir(),
        "path": str(root),
        "origin": origin,
        "created_by_this_mission": created_by_this_mission,
        "latest_complete_checkpoint": str(latest) if latest else None,
        "latest_complete": is_complete_checkpoint(latest) if latest else False,
        "manifest": load_manifest(latest) if latest and is_complete_checkpoint(latest) else None,
        "HARD_STOP": hard,
        "HARD_STOP_REASON": hard_reason,
        "has_any_weights": len(weights) > 0,
        "weight_paths": [str(p) for p in weights[:20]],
    }


def resume_decision(inspect: dict[str, Any], collision: dict[str, Any]) -> dict[str, Any]:
    if collision.get("unused"):
        return {"action": "START_FRESH", "ok": True, "RUN_ID_UNUSED_BEFORE_START": True}
    if inspect.get("HARD_STOP"):
        return {
            "action": "REFUSE_RESUME",
            "ok": False,
            "reason": "prior_safety_hard_stop",
            "HARD_STOP_REASON": inspect.get("HARD_STOP_REASON"),
            "RUN_ID_UNUSED_BEFORE_START": False,
        }
    if inspect.get("created_by_this_mission") and inspect.get("latest_complete"):
        return {
            "action": "RESUME_SAME_RUN",
            "ok": True,
            "RUN_ID_UNUSED_BEFORE_START": False,
            "checkpoint": inspect.get("latest_complete_checkpoint"),
        }
    if inspect.get("exists") and inspect.get("has_any_weights"):
        return {
            "action": "RETURN_STATE_TO_COMMANDER",
            "ok": False,
            "reason": "existing_run_000011_not_created_by_this_mission_or_not_resumable",
            "inspect": inspect,
            "overwrite_existing_run": False,
        }
    if inspect.get("exists") and not inspect.get("has_any_weights"):
        return {"action": "START_FRESH", "ok": True, "RUN_ID_UNUSED_BEFORE_START": True, "empty_dir": True}
    return {
        "action": "RETURN_STATE_TO_COMMANDER",
        "ok": False,
        "reason": "occupied_without_clear_resume",
        "collision": collision,
        "inspect": inspect,
    }
