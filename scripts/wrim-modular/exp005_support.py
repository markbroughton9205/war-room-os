"""EXP-005 dataset loaders. Reuses EXP-004 6-class render/metrics. No WRIM-0 mutation."""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from exp004_support import (
    CLASS_NAMES,
    CLASS_TO_ID,
    EVAL4_BUNDLE,
    N_CLASSES,
    classification_report_6,
    family_leak,
    is_failure_row,
    keyword_predict,
    labels,
    load_eval4_split,
    load_jsonl,
    load_v4_train,
    mask_class_tool_names,
    mask_urls,
    pred_ids,
    render_prefix,
    routing_label,
    schema_predict,
)
from paths import TOOL_EVAL_4_DIR, TOOL_EVAL_5_DIR, V5_CANDIDATE_DIR

HARD_BOUNDARY_PAIRS_V5 = frozenset(
    {
        "WEB_vs_RESEARCH",
        "FILES_vs_MEMORY",
        "MEMORY_vs_NO_TOOL",
        "WEB_vs_NO_TOOL",
        "SHA256_vs_NO_TOOL",
    }
)


def v5_hashes() -> dict[str, Any]:
    return json.loads((V5_CANDIDATE_DIR / "HASHES.json").read_text(encoding="utf-8"))


def eval5_hashes() -> dict[str, Any]:
    return json.loads((TOOL_EVAL_5_DIR / "HASHES.json").read_text(encoding="utf-8"))


def v5_gates() -> dict[str, Any]:
    return json.loads((V5_CANDIDATE_DIR / "baselines.json").read_text(encoding="utf-8"))["gates"]


def _row(rec: dict[str, Any], split: str) -> dict[str, Any]:
    cls = routing_label(rec)
    return {
        "example_id": rec["example_id"],
        "input": rec["input"],
        "prompt_prefix": render_prefix(rec["input"]),
        "gold_class": cls,
        "family_id": rec["family_id"],
        "source_type": rec.get("source_type"),
        "execution_outcome": rec.get("execution_outcome"),
        "role": rec.get("role"),
        "split": split,
        "boundary_pair": rec.get("boundary_pair") or "",
        "EXCLUDE_FROM_TRAINING": bool(rec.get("EXCLUDE_FROM_TRAINING")),
    }


def load_v5_train() -> list[dict[str, Any]]:
    path = V5_CANDIDATE_DIR / "train.jsonl"
    digest = __import__("hashlib").sha256(path.read_bytes()).hexdigest()
    expected = v5_hashes()["train.jsonl"]
    if digest != expected:
        raise ValueError(f"V5 train hash mismatch {digest} != {expected}")
    rows = load_jsonl(path)
    out = []
    for r in rows:
        if r.get("EXCLUDE_FROM_TRAINING"):
            raise ValueError(f"EXCLUDE_FROM_TRAINING in V5 train: {r.get('example_id')}")
        if r.get("split") != "train":
            raise ValueError(f"unexpected split {r.get('split')}")
        out.append(_row(r, "train"))
    return out


def load_eval5_split(name: str) -> list[dict[str, Any]]:
    rows = load_jsonl(TOOL_EVAL_5_DIR / f"{name}.jsonl")
    out = []
    for r in rows:
        if not r.get("EXCLUDE_FROM_TRAINING"):
            raise ValueError(f"EVAL-5 missing EXCLUDE_FROM_TRAINING: {r.get('example_id')}")
        if r.get("split") != name:
            raise ValueError(f"split mismatch {r.get('split')} vs {name}")
        out.append(_row(r, name))
    return out


def assert_eval5_contract(val: list[dict[str, Any]], test: list[dict[str, Any]]) -> None:
    if not val or not test:
        raise ValueError("EVAL-5 empty split")
    for split, rows in (("validation", val), ("test", test)):
        missing = [c for c in CLASS_NAMES if c not in {r["gold_class"] for r in rows}]
        if missing:
            raise ValueError(f"EVAL-5 {split} missing {missing}")
    h = eval5_hashes()
    if "combined_bundle" not in h:
        raise ValueError("EVAL-5 hashes missing bundle")


def is_hard_boundary_row_v5(row: dict[str, Any]) -> bool:
    return row.get("boundary_pair") in HARD_BOUNDARY_PAIRS_V5


def class_weights_from_train(train: list[dict[str, Any]]) -> dict[str, float]:
    """w_c = N / (K * n_c). Deterministic from frozen train distribution."""
    n = len(train)
    k = N_CLASSES
    counts = Counter(r["gold_class"] for r in train)
    return {c: (n / (k * max(counts.get(c, 1), 1))) for c in CLASS_NAMES}


def eval4_still_frozen() -> bool:
    h = json.loads((TOOL_EVAL_4_DIR / "HASHES.json").read_text(encoding="utf-8"))
    return h.get("combined_bundle") == EVAL4_BUNDLE
