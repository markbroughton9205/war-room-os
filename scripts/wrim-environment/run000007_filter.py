"""Packer-only exclusion for WRIM1-RUN-000007. Does not rewrite jsonl/npy/tokenizer."""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any

from run000007_identity import (
    ADDENDUM_NEEDLES,
    EXCLUDED_SOURCE_PATHS,
    FILTER_VERSION,
    KNOWN_EVAL_DUMP_CHUNK_IDS,
    PRIVILEGE_REPAIR_PATH,
)

EVAL_OUTPUT_PATH_MARKERS = (
    "wrim0_eval_results.json",
    "GENESIS_REPORT.md",
    "/eval_results",
    "eval-results",
)


def text_of(rec: dict[str, Any]) -> str:
    if isinstance(rec.get("text"), str):
        return rec["text"]
    if isinstance(rec.get("renderedTrainingText"), str):
        return rec["renderedTrainingText"]
    return ""


def _norm_path(path: str) -> str:
    return str(path or "").replace("\\", "/").lstrip("./")


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def bucket_for_record(rec: dict[str, Any]) -> str:
    kind = rec.get("kind") or "chunk"
    fmt = rec.get("format") or ""
    path = str(rec.get("source_path") or rec.get("path") or "")
    if kind == "behavior_example" or fmt == "instruction_response":
        return "behavior"
    if fmt in ("code",) or path.endswith((".ts", ".tsx", ".js", ".mjs", ".cjs", ".py")):
        return "code"
    if "json" in str(fmt) or path.endswith(".json"):
        return "json"
    if fmt in ("language_modeling", "language") or path.endswith((".md", ".txt")):
        return "prose"
    return "other"


def is_eval_output_artifact(rec: dict[str, Any]) -> bool:
    path = _norm_path(rec.get("source_path") or rec.get("path") or "")
    for p in EXCLUDED_SOURCE_PATHS:
        leaf = p.split("/")[-1]
        if path.endswith(p) or path.endswith("/" + leaf) or path.endswith(leaf):
            return True
    if any(m.lower() in path.lower() for m in EVAL_OUTPUT_PATH_MARKERS):
        return True
    return False


def is_privilege_repair(rec: dict[str, Any]) -> bool:
    path = _norm_path(rec.get("source_path") or rec.get("path") or "")
    return path.endswith(PRIVILEGE_REPAIR_PATH) or path.endswith("PRODUCTION_DATABASE_PRIVILEGE_REPAIR.md")


def classify_record(rec: dict[str, Any]) -> dict[str, Any]:
    path = _norm_path(rec.get("source_path") or rec.get("path") or "")
    text = text_of(rec)
    chunk_id = str(rec.get("chunk_id") or "")
    privilege = is_privilege_repair(rec)
    eval_art = is_eval_output_artifact(rec)
    has_loop = "tokenizer_tokenizer" in text
    dump_collapse = eval_art and has_loop
    known = chunk_id in KNOWN_EVAL_DUMP_CHUNK_IDS
    # Provenance-aware: never exclude privilege-repair; no rule here excludes a record merely for containing "tokenizer".
    exclude = (not privilege) and (eval_art or known or dump_collapse)
    reason = None
    if exclude:
        if eval_art:
            reason = "eval_output_artifact_source_path"
        elif dump_collapse:
            reason = "eval_artifact_tokenizer_tokenizer_dump"
        else:
            reason = "known_eval_dump_chunk_id"
    return {
        "exclude": exclude,
        "reason": reason,
        "chunk_id": chunk_id,
        "source_path": path,
        "family": bucket_for_record(rec),
        "privilege_repair_protected": privilege,
        "eval_output_artifact": eval_art,
        "has_tokenizer_tokenizer": has_loop,
        "token_count_declared": int(rec.get("token_count") or 0),
    }


def family_counts(records: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    n: dict[str, int] = defaultdict(int)
    tok: dict[str, int] = defaultdict(int)
    for rec in records:
        fam = bucket_for_record(rec)
        n[fam] += 1
        tok[fam] += int(rec.get("token_count") or 0)
    return {"records": dict(n), "tokens_declared": dict(tok)}


def addendum_needles_in_text(text: str) -> list[str]:
    hits = []
    blob = text or ""
    for needle in ADDENDUM_NEEDLES:
        if needle and needle in blob:
            hits.append(needle)
    return hits


def filter_records(records: list[dict[str, Any]]) -> dict[str, Any]:
    kept: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    for rec in records:
        row = classify_record(rec)
        if row["exclude"]:
            excluded.append({**row, "kind": rec.get("kind"), "format": rec.get("format")})
        else:
            kept.append(rec)
    needle_hits = []
    for rec in kept:
        hits = addendum_needles_in_text(text_of(rec))
        if hits:
            needle_hits.append({"chunk_id": rec.get("chunk_id"), "needles": hits, "source_path": rec.get("source_path")})
    return {
        "FILTER_VERSION": FILTER_VERSION,
        "TOTAL_SOURCE_RECORDS": len(records),
        "EXCLUDED_RECORDS": len(excluded),
        "EXCLUDED_RECORD_IDS": [e["chunk_id"] for e in excluded if e.get("chunk_id")],
        "EXCLUDED_TOKEN_COUNT": int(sum(int(e.get("token_count_declared") or 0) for e in excluded)),
        "FAMILY_COUNTS_BEFORE": family_counts(records),
        "FAMILY_COUNTS_AFTER": family_counts(kept),
        "excluded": excluded,
        "kept": kept,
        "privilege_repair_kept": any(is_privilege_repair(r) for r in kept),
        "privilege_repair_excluded": any(e.get("privilege_repair_protected") for e in excluded),
        "INSTRUCTION_ADDENDUM_LEAKAGE": needle_hits,
        "broad_tokenizer_ban": False,
    }


def scan_jsonl(path: Path) -> dict[str, Any]:
    rows = load_jsonl(path)
    out = filter_records(rows)
    out["source_file"] = str(path)
    # Drop kept records from the serializable scan (too large); keep IDs/stats.
    kept_ids = [str(r.get("chunk_id") or "") for r in out["kept"]]
    out["KEPT_RECORD_COUNT"] = len(out["kept"])
    out["kept_record_ids_head"] = kept_ids[:8]
    out.pop("kept", None)
    return out


def assert_dump_excluded(result: dict[str, Any]) -> dict[str, Any]:
    excluded = set(result.get("EXCLUDED_RECORD_IDS") or [])
    missing = [cid for cid in KNOWN_EVAL_DUMP_CHUNK_IDS if cid not in excluded]
    leaked = bool(missing)
    return {
        "ok": not leaked,
        "decision": "PASS" if not leaked else "PRETRAIN_ABORT",
        "EVAL_DUMP_LEAKAGE": "NONE" if not leaked else missing,
        "missing_known_ids": missing,
    }


def assert_addendum_absent(result: dict[str, Any]) -> dict[str, Any]:
    hits = list(result.get("INSTRUCTION_ADDENDUM_LEAKAGE") or [])
    return {
        "ok": len(hits) == 0,
        "decision": "PASS" if not hits else "PRETRAIN_ABORT",
        "INSTRUCTION_ADDENDUM_LEAKAGE": "NONE" if not hits else hits,
    }
