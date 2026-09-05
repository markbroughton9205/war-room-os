"""ACTIVE CORE vs ACTIVE MODULES. Composed runtime is not a merged checkpoint."""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from paths import ACTIVE_RUNTIME_PATH, WRIM0_CHECKPOINT_SHA256, WRIM0_ID

RuntimeKind = Literal["CORE", "CAPABILITY_MODULE", "COMPOSED_RUNTIME"]


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class ActiveRuntimeState:
    kind: RuntimeKind
    active_core_id: str
    active_core_checkpoint_sha: str
    active_module_ids: list[str]
    composed_runtime_id: str
    lineage_role: str
    updated_at: str
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def composed_runtime_id(core_id: str, module_ids: list[str]) -> str:
    mods = ",".join(sorted(module_ids))
    if not mods:
        return f"composed:{core_id}+[]"
    return f"composed:{core_id}+[{mods}]"


def default_active_runtime() -> ActiveRuntimeState:
    return ActiveRuntimeState(
        kind="CORE" if True else "COMPOSED_RUNTIME",
        active_core_id=WRIM0_ID,
        active_core_checkpoint_sha=WRIM0_CHECKPOINT_SHA256,
        active_module_ids=[],
        composed_runtime_id=composed_runtime_id(WRIM0_ID, []),
        lineage_role="OFFICIAL_FROZEN_CORE",
        updated_at=_utcnow(),
        notes="Phase 1 default: WRIM-0 with no capability modules. Not a merged checkpoint.",
    )


def load_or_init_active_runtime(path: Path | None = None) -> ActiveRuntimeState:
    p = path or ACTIVE_RUNTIME_PATH
    if not p.is_file():
        state = default_active_runtime()
        save_active_runtime(state, p)
        return state
    raw = json.loads(p.read_text(encoding="utf-8"))
    return ActiveRuntimeState(**raw)


def save_active_runtime(state: ActiveRuntimeState, path: Path | None = None) -> None:
    p = path or ACTIVE_RUNTIME_PATH
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = state.to_dict()
    if payload["active_core_id"] != WRIM0_ID and payload["lineage_role"] != "TEST_ONLY_COMPARISON":
        raise ValueError("refusing to persist a non-WRIM-0 ACTIVE core without TEST_ONLY role")
    p.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def attach_module_to_runtime(state: ActiveRuntimeState, module_id: str) -> ActiveRuntimeState:
    if module_id in state.active_module_ids:
        return state
    modules = [*state.active_module_ids, module_id]
    return ActiveRuntimeState(
        kind="COMPOSED_RUNTIME",
        active_core_id=state.active_core_id,
        active_core_checkpoint_sha=state.active_core_checkpoint_sha,
        active_module_ids=modules,
        composed_runtime_id=composed_runtime_id(state.active_core_id, modules),
        lineage_role=state.lineage_role,
        updated_at=_utcnow(),
        notes="Composition identity only. Core checkpoint SHA unchanged. Weights not merged.",
    )


def detach_module_from_runtime(state: ActiveRuntimeState, module_id: str) -> ActiveRuntimeState:
    modules = [m for m in state.active_module_ids if m != module_id]
    return ActiveRuntimeState(
        kind="CORE" if not modules else "COMPOSED_RUNTIME",
        active_core_id=state.active_core_id,
        active_core_checkpoint_sha=state.active_core_checkpoint_sha,
        active_module_ids=modules,
        composed_runtime_id=composed_runtime_id(state.active_core_id, modules),
        lineage_role=state.lineage_role,
        updated_at=_utcnow(),
        notes="Core unchanged after detach.",
    )
