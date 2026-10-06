"""Hard run-ID collision guard for WRIM1-RUN-000008."""
from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable

from run000007_collision import occupied_reasons
from run000008_identity import RESERVED_HISTORICAL_RUN_IDS, RUN_ID


def assert_run_id_unused(run_id: str, search_roots: Iterable[Path]) -> dict[str, Any]:
    hits = occupied_reasons(run_id, search_roots, reserved=RESERVED_HISTORICAL_RUN_IDS)
    unused = len(hits) == 0
    return {
        "run_id": run_id,
        "unused": unused,
        "ok": unused,
        "hits": hits,
        "decision": "PASS" if unused else "PRETRAIN_ABORT",
        "abort_before": [
            "model_copy",
            "optimizer_construction",
            "checkpoint_creation",
            "manifest_initialization",
            "training_step",
        ],
        "overwrite_existing_run": False,
        "mint_another_id": False,
        "canonical_run_id": RUN_ID,
    }
