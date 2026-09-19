"""Hard run-ID collision guard. Aborts before model copy / optimizer / checkpoint / step."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Iterable

from run000006_identity import RESERVED_HISTORICAL_RUN_IDS, RUN_ID

TRAINING_MARKERS = (
    "run-manifest.json",
    "metrics.jsonl",
    "model.safetensors",
    "optimizer.safetensors",
)

PRETRAINING_KINDS = {
    "WRIM1_RUN_000006_PRETRAINING_GATE",
    "WRIM1_RUN_000006_TRAINING_CONFIG",
    "WRIM1_RUN_000006_DRY_RUN",
}

SKIP_DIR_NAMES = {".git", "node_modules", "__pycache__", ".next", ".venv", ".vendor"}
SKIP_SUFFIXES = {".safetensors", ".npy", ".bin", ".pt", ".pth", ".so", ".dll", ".whl"}
SCAN_SUFFIXES = {".json", ".jsonl", ".md", ".txt", ".log"}


def _dir_has_training_markers(path: Path) -> bool:
    if not path.is_dir():
        return False
    try:
        for child in path.iterdir():
            if child.name in TRAINING_MARKERS:
                return True
            if child.is_dir():
                try:
                    for grandchild in child.iterdir():
                        if grandchild.name in TRAINING_MARKERS:
                            return True
                except OSError:
                    continue
    except OSError:
        return False
    return False


def _manifest_obj(path: Path) -> dict[str, Any] | None:
    try:
        obj = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    return obj if isinstance(obj, dict) else None


def _named_run_dirs(root: Path, run_id: str) -> list[Path]:
    hits = [
        root / run_id,
        root / "test-only" / run_id,
        root / "wrim-checkpoints" / "test-only" / run_id,
        root.parent / "wrim-checkpoints" / "test-only" / run_id,
    ]
    out: list[Path] = []
    seen: set[str] = set()
    for p in hits:
        key = str(p)
        if key in seen:
            continue
        seen.add(key)
        if p.is_dir():
            out.append(p)
    return out


def _iter_scan_files(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIR_NAMES]
        for fn in filenames:
            p = Path(dirpath) / fn
            suf = p.suffix.lower()
            if suf in SKIP_SUFFIXES:
                continue
            if fn in TRAINING_MARKERS or suf in SCAN_SUFFIXES:
                yield p


def _is_pretraining_artifact(obj: dict[str, Any], run_id: str) -> bool:
    kind = str(obj.get("kind") or "")
    if run_id == RUN_ID and kind in PRETRAINING_KINDS:
        return True
    blob = json.dumps(obj).lower()
    if "suggested" in blob and int(obj.get("optimizer_steps") or obj.get("optimizer_steps_this_pass") or 0) == 0:
        return True
    if kind in {"STAGE3A_CORRECTIVE_TRAINING_DESIGN"}:
        return True
    return False


def occupied_reasons(run_id: str, search_roots: Iterable[Path], *, reserved: Iterable[str] = RESERVED_HISTORICAL_RUN_IDS) -> list[dict[str, str]]:
    hits: list[dict[str, str]] = []
    if run_id in set(reserved):
        hits.append({"kind": "registry", "path": "RESERVED_HISTORICAL_RUN_IDS", "detail": run_id})
    needle = run_id
    for root in search_roots:
        root = Path(root)
        if not root.exists():
            continue
        for named in _named_run_dirs(root, needle):
            if _dir_has_training_markers(named):
                hits.append({"kind": "checkpoint_dir", "path": str(named), "detail": "training_markers"})
        try:
            for p in _iter_scan_files(root):
                if p.name in TRAINING_MARKERS and p.parent.name == needle:
                    hits.append({"kind": "training_log", "path": str(p), "detail": p.name})
                    continue
                if p.suffix.lower() not in {".json", ".jsonl"} and p.name != "run-manifest.json":
                    if not (p.name.endswith("-report.json") or p.name.endswith("manifest.json")):
                        continue
                obj = _manifest_obj(p)
                if not obj:
                    continue
                rid = obj.get("run_id")
                if rid != needle:
                    continue
                if _is_pretraining_artifact(obj, needle):
                    continue
                steps = int(obj.get("optimizer_steps") or obj.get("optimizer_steps_this_pass") or 0)
                if steps > 0:
                    kind = "manifest" if p.name == "run-manifest.json" else "status_artifact"
                    hits.append({"kind": kind, "path": str(p), "detail": str(rid)})
        except OSError:
            continue
    seen = set()
    uniq: list[dict[str, str]] = []
    for h in hits:
        key = (h["kind"], h["path"])
        if key in seen:
            continue
        seen.add(key)
        uniq.append(h)
    return uniq


def assert_run_id_unused(run_id: str, search_roots: Iterable[Path]) -> dict[str, Any]:
    hits = occupied_reasons(run_id, search_roots)
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
    }
