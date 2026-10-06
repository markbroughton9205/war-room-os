"""WRIM observability bus. Training talks only to this bus; adapters fan out independently."""
from __future__ import annotations

import json
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


EVENT_TYPES = (
    "RUN_STARTED",
    "RUN_CONFIG",
    "STEP_COMPLETED",
    "EVAL_COMPLETED",
    "CHECKPOINT_SAVED",
    "STOP_POLICY_DECISION",
    "RUN_STOPPED",
    "RUN_FAILED",
)

UNKNOWN = "UNKNOWN"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def unknown_if_missing(value: Any) -> Any:
    if value is None or value == "":
        return UNKNOWN
    return value


@dataclass
class AdapterError:
    adapter: str
    error: str
    traceback: str = ""


@dataclass
class ObservabilityBus:
    mode: str = "OBSERVABILITY_STANDARD"
    adapters: dict[str, Callable[[dict[str, Any]], None]] = field(default_factory=dict)
    errors: list[AdapterError] = field(default_factory=list)
    emitted: int = 0
    per_adapter_ok: dict[str, int] = field(default_factory=dict)
    per_adapter_fail: dict[str, int] = field(default_factory=dict)
    journal_path: Path | None = None

    def register(self, name: str, fn: Callable[[dict[str, Any]], None]) -> None:
        self.adapters[name] = fn
        self.per_adapter_ok.setdefault(name, 0)
        self.per_adapter_fail.setdefault(name, 0)

    def emit(self, event: dict[str, Any]) -> dict[str, Any]:
        event.setdefault("timestamp", utc_now())
        event.setdefault("hardware_id", UNKNOWN)
        self.emitted += 1
        if self.journal_path is not None:
            self.journal_path.parent.mkdir(parents=True, exist_ok=True)
            with self.journal_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(event, default=str) + "\n")
        results: dict[str, str] = {}
        for name, fn in list(self.adapters.items()):
            try:
                fn(event)
                self.per_adapter_ok[name] = self.per_adapter_ok.get(name, 0) + 1
                results[name] = "ok"
            except Exception as exc:  # noqa: BLE001 — isolation: one backend must not stop the bus
                self.per_adapter_fail[name] = self.per_adapter_fail.get(name, 0) + 1
                err = AdapterError(adapter=name, error=str(exc), traceback=traceback.format_exc())
                self.errors.append(err)
                results[name] = f"adapter_error:{exc}"
                continue
        return results

    def summary(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "emitted": self.emitted,
            "adapters": list(self.adapters),
            "per_adapter_ok": self.per_adapter_ok,
            "per_adapter_fail": self.per_adapter_fail,
            "errors": [{"adapter": e.adapter, "error": e.error} for e in self.errors[-32:]],
            "isolation": "one backend failure does not stop remaining adapters",
        }
