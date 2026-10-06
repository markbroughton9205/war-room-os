"""Read-only loader for WR-CORPUS-PLM-FIRST-TOKEN-1-v1.0.0.

Does not rewrite train/val/manifest. Does not mutate PLM-PROBE-1 or CPT-2.
Does not train.
"""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any

from wrim_plm1_corpus import leakage_scan
from wrim_plm2_corpus import class_report
from wrim_plm3_identity import (
    CORPUS_DIRNAME,
    CORPUS_ID,
    CORPUS_VERSION,
    DATA_ROOT,
    EXPECTED_CORPUS_HASH,
    EXPECTED_MANIFEST_HASH,
    EXPECTED_TRAIN_HASH,
    EXPECTED_VAL_HASH,
    MIN_CLASS_OVERLAP,
)


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _sha256_bytes(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def example_overlap(train: list[dict[str, Any]], val: list[dict[str, Any]]) -> dict[str, Any]:
    train_pt = {(str(r["prompt"]), str(r["target"])) for r in train}
    train_p = {str(r["prompt"]) for r in train}
    val_pt = [(str(r["prompt"]), str(r["target"])) for r in val]
    pair_hits = [i for i, k in enumerate(val_pt) if k in train_pt]
    prompt_hits = [i for i, (p, _) in enumerate(val_pt) if p in train_p]
    return {
        "TRAIN_VAL_EXAMPLE_OVERLAP": len(pair_hits),
        "TRAIN_VAL_PROMPT_OVERLAP": len(prompt_hits),
        "pair_hit_ids": [val[i]["example_id"] for i in pair_hits],
        "prompt_hit_ids": [val[i]["example_id"] for i in prompt_hits],
        "ok": len(pair_hits) == 0 and len(prompt_hits) == 0,
    }


def load_frozen_corpus(root: Path | None = None, tokenizer=None) -> dict[str, Any]:
    root = Path(root or Path(DATA_ROOT) / CORPUS_DIRNAME)
    train_p = root / "train.jsonl"
    val_p = root / "val.jsonl"
    man_p = root / "manifest.json"
    hash_p = root / "CORPUS_HASH.txt"
    if not train_p.is_file() or not val_p.is_file() or not man_p.is_file():
        return {"ok": False, "reason": "frozen_corpus_missing", "root": str(root)}
    train_hash = _sha256_file(train_p)
    val_hash = _sha256_file(val_p)
    manifest = json.loads(man_p.read_text(encoding="utf-8"))
    man_copy = {k: v for k, v in manifest.items() if k != "manifest_sha256"}
    man_blob = json.dumps(man_copy, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    manifest_hash = _sha256_bytes(man_blob)
    corpus_hash = _sha256_bytes((train_hash + val_hash + manifest_hash).encode("ascii"))
    live_txt = hash_p.read_text(encoding="utf-8").strip() if hash_p.is_file() else None
    mismatches = []
    if train_hash != EXPECTED_TRAIN_HASH:
        mismatches.append("TRAIN_HASH")
    if val_hash != EXPECTED_VAL_HASH:
        mismatches.append("VAL_HASH")
    if manifest_hash != EXPECTED_MANIFEST_HASH:
        mismatches.append("MANIFEST_HASH")
    if corpus_hash != EXPECTED_CORPUS_HASH:
        mismatches.append("CORPUS_HASH")
    if live_txt is not None and live_txt != EXPECTED_CORPUS_HASH:
        mismatches.append("CORPUS_HASH.txt")
    train = _load_jsonl(train_p)
    val = _load_jsonl(val_p)
    crep = class_report(train, val, tokenizer=tokenizer)
    exo = example_overlap(train, val)
    leak = leakage_scan(train, val)
    class_overlap = float(crep.get("FIRST_TOKEN_TRAIN_VAL_OVERLAP") or 0)
    ok = (
        not mismatches
        and crep.get("ok")
        and leak.get("ok")
        and exo.get("ok")
        and class_overlap >= float(MIN_CLASS_OVERLAP)
        and len(train) == 180
        and len(val) == 60
    )
    return {
        "ok": ok,
        "root": str(root),
        "CORPUS_ID": CORPUS_ID,
        "CORPUS_VERSION": CORPUS_VERSION,
        "CORPUS_HASH": corpus_hash,
        "MANIFEST_HASH": manifest_hash,
        "TRAIN_HASH": train_hash,
        "VAL_HASH": val_hash,
        "TRAIN_EXAMPLES": len(train),
        "VAL_EXAMPLES": len(val),
        "LEAKAGE_SCAN": "PASS" if leak.get("ok") else "FAIL",
        "DUPLICATE_SCAN": "PASS" if leak.get("ok") else "FAIL",
        "mismatch_fields": mismatches,
        "rewritten": False,
        "leakage": leak,
        "class_report": crep,
        "TRAIN_VAL_CLASS_OVERLAP": class_overlap,
        "TRAIN_VAL_EXAMPLE_OVERLAP": exo["TRAIN_VAL_EXAMPLE_OVERLAP"],
        "TRAIN_VAL_PROMPT_OVERLAP": exo["TRAIN_VAL_PROMPT_OVERLAP"],
        "example_overlap": exo,
        "train": train,
        "val": val,
        "FIRST_TOKEN_TRAIN_VAL_OVERLAP_MEANS": "class-set overlap: |train_classes ∩ val_classes| / |val_classes|",
    }
