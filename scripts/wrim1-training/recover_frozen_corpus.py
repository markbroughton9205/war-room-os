"""Recover exact Wave 8.1 frozen chunk bytes and materialize immutable shards.

Does not modify current source files, WR-TOKENIZER-0, WRIM-0, or the frozen
Wave 8.1 corpus-manifest.json. Official training must consume these shards
rather than live worktree slices.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from tokenizers import Tokenizer

from constants import (
    CORPUS_ID,
    CORPUS_SHA256,
    TEST_TOKENS,
    TOKENIZER_REL,
    TOKENIZER_SHA256,
    TOTAL_CANDIDATE_TOKENS,
    TRAIN_TOKENS,
    VAL_TOKENS,
)
from corpus_bundle import (
    BEHAVIOR_REL,
    BUNDLE_REL,
    FROZEN_CORPUS_REL,
    TOKENIZE_PAYLOAD_CANDIDATES,
    bundle_dir,
    recovery_dir,
)
from hashes import sha256_bytes, sha256_file, sha256_json
from js_utf16 import js_slice
from paths import repo_root


TOOL_FINGERPRINT = {
    "tool": "recover_frozen_corpus",
    "wave": "8.1R",
    "version": "wave8.1r-1",
}


def sha256_utf8(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def split_for(lineage: str, seed: int = 8101) -> str:
    digest = hashlib.sha256(f"{seed}:{lineage}".encode("utf-8")).hexdigest()
    bucket = int(digest[:8], 16) % 10
    if bucket == 0:
        return "test"
    if bucket == 1:
        return "validation"
    return "train"


def git_show(root: Path, spec: str) -> Optional[str]:
    proc = subprocess.run(["git", "show", spec], cwd=str(root), capture_output=True)
    if proc.returncode != 0:
        return None
    try:
        return proc.stdout.decode("utf-8")
    except UnicodeDecodeError:
        return proc.stdout.decode("utf-8", errors="replace")


def git_rev_list_path(root: Path, rel: str) -> List[str]:
    proc = subprocess.run(
        ["git", "rev-list", "--all", "--", rel],
        cwd=str(root),
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        return []
    return [ln.strip() for ln in proc.stdout.splitlines() if ln.strip()]


def load_tokenize_payloads() -> Tuple[Dict[str, str], Dict[str, str], List[Dict[str, Any]]]:
    by_hash: dict[str, str] = {}
    by_id: dict[str, str] = {}
    sources: list[dict[str, Any]] = []
    for path_str in TOKENIZE_PAYLOAD_CANDIDATES:
        path = Path(path_str)
        if not path.is_file():
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        items = payload.get("items") or []
        matched = 0
        for item in items:
            text = item.get("text")
            item_id = item.get("id")
            if not isinstance(text, str):
                continue
            digest = sha256_utf8(text)
            by_hash.setdefault(digest, text)
            if isinstance(item_id, str):
                by_id.setdefault(item_id, text)
            matched += 1
        sources.append({
            "path": str(path),
            "sha256": sha256_file(path),
            "item_count": matched,
        })
    return by_hash, by_id, sources


def try_slice(text: Optional[str], chunk: Dict[str, Any]) -> Optional[str]:
    if text is None:
        return None
    sl = js_slice(text, chunk["offsetStart"], chunk["offsetEnd"])
    if sha256_utf8(sl) == chunk["contentHash"]:
        return sl
    return None


def recover_chunks(root: Path) -> dict[str, Any]:
    corpus_path = root / FROZEN_CORPUS_REL
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    if corpus.get("contentHash") != CORPUS_SHA256 or corpus.get("corpusId") != CORPUS_ID:
        raise RuntimeError("frozen corpus identity mismatch; refusing recovery")
    chunks: list[dict[str, Any]] = corpus["chunks"]
    by_hash, by_id, tokenize_sources = load_tokenize_payloads()
    file_cache: dict[tuple[str, str], str | None] = {}

    def cached(kind: str, rel: str) -> str | None:
        key = (kind, rel)
        if key in file_cache:
            return file_cache[key]
        text: str | None = None
        if kind == "worktree":
            path = root / rel
            if path.is_file():
                text = path.read_text(encoding="utf-8")
        elif kind == "index":
            text = git_show(root, f":{rel}")
        elif kind == "head":
            text = git_show(root, f"HEAD:{rel}")
        file_cache[key] = text
        return text

    recovered: list[dict[str, Any]] = []
    unrecovered: list[dict[str, Any]] = []
    source_counts: Counter[str] = Counter()
    drifted_paths: set[str] = set()
    historical_refs: dict[str, str] = {}

    for chunk in chunks:
        rel = chunk["path"]
        text = None
        source_type = None
        source_ref = None

        sl = try_slice(cached("worktree", rel), chunk)
        if sl is not None:
            text, source_type, source_ref = sl, "current_worktree", rel
        if text is None:
            sl = try_slice(cached("index", rel), chunk)
            if sl is not None:
                text, source_type, source_ref = sl, "git_index", f":{rel}"
        if text is None:
            sl = try_slice(cached("head", rel), chunk)
            if sl is not None:
                text, source_type, source_ref = sl, "git_head", f"HEAD:{rel}"
        if text is None:
            payload_text = by_id.get(chunk["chunkId"]) or by_hash.get(chunk["contentHash"])
            if payload_text is not None and sha256_utf8(payload_text) == chunk["contentHash"]:
                text, source_type, source_ref = payload_text, "existing_artifact", "wave81-tokenize-payload"
        if text is None:
            commits = git_rev_list_path(root, rel)
            for commit in commits:
                hist = git_show(root, f"{commit}:{rel}")
                sl = try_slice(hist, chunk)
                if sl is not None:
                    text, source_type, source_ref = sl, "git_historical", f"{commit}:{rel}"
                    historical_refs[chunk["chunkId"]] = source_ref
                    break
        if text is None:
            unrecovered.append({
                "chunkId": chunk["chunkId"],
                "path": rel,
                "contentHash": chunk["contentHash"],
                "offsetStart": chunk["offsetStart"],
                "offsetEnd": chunk["offsetEnd"],
            })
            drifted_paths.add(rel)
            continue

        if source_type != "current_worktree":
            drifted_paths.add(rel)
        source_counts[source_type] += 1
        recovered.append({
            **chunk,
            "text": text,
            "recovery_source_type": source_type,
            "recovery_source_ref": source_ref,
            "recovery_confidence": "exact_hash_match",
        })

    worktree_match = source_counts.get("current_worktree", 0)
    return {
        "corpus": corpus,
        "recovered": recovered,
        "unrecovered": unrecovered,
        "source_counts": dict(source_counts),
        "tokenize_sources": tokenize_sources,
        "drifted_paths": sorted(drifted_paths),
        "historical_refs": historical_refs,
        "worktree_match": worktree_match,
        "worktree_mismatch": len(chunks) - worktree_match,
        "total": len(chunks),
    }


def example_split(example: dict[str, Any]) -> str:
    lineage = (example.get("source_lineage") or [example["exampleId"]])[0]
    return split_for(lineage)


def materialize(root: Path | None = None) -> dict[str, Any]:
    root = root or repo_root()
    tokenizer_path = root / TOKENIZER_REL
    tok_sha = sha256_file(tokenizer_path)
    if tok_sha != TOKENIZER_SHA256:
        raise RuntimeError(f"tokenizer hash mismatch actual={tok_sha}")
    audit = recover_chunks(root)
    if audit["unrecovered"]:
        fail_path = recovery_dir(root) / "unrecovered-chunks.json"
        fail_path.parent.mkdir(parents=True, exist_ok=True)
        fail_path.write_text(json.dumps(audit["unrecovered"], indent=2) + "\n", encoding="utf-8")
        raise RuntimeError(
            f"WAVE 8.1R FAIL: {len(audit['unrecovered'])} frozen chunks unrecoverable; "
            f"see {fail_path}"
        )
    if len(audit["recovered"]) != audit["total"]:
        raise RuntimeError("recovery count mismatch")

    examples_path = root / BEHAVIOR_REL
    examples_doc = json.loads(examples_path.read_text(encoding="utf-8"))
    examples = examples_doc.get("examples") or []
    if len(examples) != 31:
        raise RuntimeError(f"expected 31 behavior examples, got {len(examples)}")
    for example in examples:
        text = example["renderedTrainingText"]
        if sha256_utf8(text) != example["renderedHash"]:
            raise RuntimeError(f"behavior renderedHash mismatch {example['exampleId']}")

    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    vocab = tokenizer.get_vocab_size()
    dtype = np.uint16 if vocab < 65536 else np.int32

    records_by_split: dict[str, list[dict[str, Any]]] = {"train": [], "validation": [], "test": []}
    token_ids: dict[str, list[int]] = {"train": [], "validation": [], "test": []}
    split_membership = {"train": 0, "validation": 0, "test": 0}

    for rec in audit["recovered"]:
        ids = tokenizer.encode(rec["text"]).ids
        expected_n = rec.get("tokenizerTokens")
        if expected_n is not None and int(expected_n) != len(ids):
            raise RuntimeError(
                f"chunk token count mismatch {rec['chunkId']} expected={expected_n} actual={len(ids)}"
            )
        split = rec["split"]
        split_membership[split] += 1
        token_ids[split].extend(ids)
        records_by_split[split].append({
            "kind": "chunk",
            "chunk_id": rec["chunkId"],
            "split": split,
            "source_id": rec["sourceId"],
            "source_path": rec["path"],
            "source_lineage": rec["parentLineage"],
            "original_offset_start": rec["offsetStart"],
            "original_offset_end": rec["offsetEnd"],
            "contentHash": rec["contentHash"],
            "normalizedHash": rec.get("normalizedHash"),
            "recovery_source_type": rec["recovery_source_type"],
            "recovery_source_ref": rec["recovery_source_ref"],
            "recovery_confidence": rec["recovery_confidence"],
            "token_count": len(ids),
            "format": rec.get("format"),
            "capability_tags": rec.get("capabilityTags") or [],
            "text": rec["text"],
        })

    frozen_splits = audit["corpus"]["splitCounts"]
    if (
        split_membership["train"] != frozen_splits["train"]["chunks"]
        or split_membership["validation"] != frozen_splits["validation"]["chunks"]
        or split_membership["test"] != frozen_splits["test"]["chunks"]
    ):
        raise RuntimeError(f"chunk split membership mismatch {split_membership} vs {frozen_splits}")

    for example in examples:
        text = example["renderedTrainingText"]
        ids = tokenizer.encode(text).ids
        split = example_split(example)
        token_ids[split].extend(ids)
        records_by_split[split].append({
            "kind": "behavior_example",
            "chunk_id": example["exampleId"],
            "split": split,
            "source_id": example["exampleId"],
            "source_path": BEHAVIOR_REL,
            "source_lineage": (example.get("source_lineage") or [example["exampleId"]])[0],
            "original_offset_start": 0,
            "original_offset_end": len(text),
            "contentHash": example["renderedHash"],
            "normalizedHash": None,
            "recovery_source_type": "behavior_example_manifest",
            "recovery_source_ref": BEHAVIOR_REL,
            "recovery_confidence": "exact_hash_match",
            "token_count": len(ids),
            "format": example.get("format"),
            "capability_tags": example.get("capabilityTags") or example.get("capability_tags") or [],
            "text": text,
        })

    counts = {name: len(ids) for name, ids in token_ids.items()}
    if counts["train"] != TRAIN_TOKENS or counts["validation"] != VAL_TOKENS or counts["test"] != TEST_TOKENS:
        raise RuntimeError(f"token counts mismatch {counts}")
    if sum(counts.values()) != TOTAL_CANDIDATE_TOKENS:
        raise RuntimeError(f"total token count mismatch {sum(counts.values())}")

    out = bundle_dir(root)
    for name in ("train", "validation", "test", "chunks", "provenance", "tokens"):
        (out / name).mkdir(parents=True, exist_ok=True)

    source_shard_meta: list[dict[str, Any]] = []
    token_shard_meta: list[dict[str, Any]] = []
    chunk_index: list[dict[str, Any]] = []

    for split in ("train", "validation", "test"):
        shard_id = f"{split}/shard-00000.jsonl"
        shard_path = out / split / "shard-00000.jsonl"
        lines = []
        for index, rec in enumerate(records_by_split[split]):
            rec = {
                **rec,
                "shard_id": shard_id,
                "shard_index": index,
            }
            lines.append(json.dumps(rec, ensure_ascii=False, separators=(",", ":")))
            chunk_index.append({k: rec[k] for k in rec if k != "text"})
        payload = ("\n".join(lines) + "\n").encode("utf-8")
        shard_path.write_bytes(payload)
        source_sha = sha256_bytes(payload)
        source_shard_meta.append({
            "shard_id": shard_id,
            "split": split,
            "path": f"{BUNDLE_REL}/{split}/shard-00000.jsonl",
            "sha256": source_sha,
            "record_count": len(records_by_split[split]),
            "format": "jsonl",
        })
        arr = np.array(token_ids[split], dtype=dtype)
        token_path = out / "tokens" / f"{split}.npy"
        np.save(token_path, arr)
        token_sha = sha256_file(token_path)
        token_shard_meta.append({
            "shard_id": f"tokens/{split}.npy",
            "split": split,
            "path": f"{BUNDLE_REL}/tokens/{split}.npy",
            "sha256": token_sha,
            "token_count": int(arr.size),
            "record_count": len(records_by_split[split]),
            "tokenizer_sha256": TOKENIZER_SHA256,
            "source_shard_sha256": source_sha,
            "dtype": str(dtype),
        })

    index_path = out / "chunks" / "chunk-index.json"
    index_path.write_text(json.dumps({"records": chunk_index}, indent=2) + "\n", encoding="utf-8")

    created_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    materialized = {
        "bundleId": "WR-CORPUS-1-HARDENED-MATERIALIZED",
        "corpusIdentityId": CORPUS_ID,
        "corpusIdentityHash": CORPUS_SHA256,
        "tokenizerId": "WR-TOKENIZER-0",
        "tokenizerSha256": TOKENIZER_SHA256,
        "createdAt": created_at,
        "chunkCount": audit["total"],
        "exampleCount": len(examples),
        "tokenCounts": counts,
        "sourceShards": source_shard_meta,
        "tokenShards": token_shard_meta,
        "chunkIndexPath": f"{BUNDLE_REL}/chunks/chunk-index.json",
        "recoveryManifestPath": f"{BUNDLE_REL}/provenance/recovery-manifest.json",
        "officialLoader": "immutable_shards_only",
        "mutableSourceReconstruction": False,
    }
    materialized["materializedBundleHash"] = sha256_json({
        "corpusIdentityHash": CORPUS_SHA256,
        "tokenizerSha256": TOKENIZER_SHA256,
        "sourceShards": source_shard_meta,
        "tokenShards": token_shard_meta,
        "tokenCounts": counts,
    })
    (out / "corpus-manifest.json").write_text(json.dumps(materialized, indent=2) + "\n", encoding="utf-8")

    recovery = {
        "recovery_id": "WR-CORPUS-1-HARDENED-RECOVERY-8.1R",
        "frozen_corpus_id": CORPUS_ID,
        "frozen_corpus_hash": CORPUS_SHA256,
        "total_chunks": audit["total"],
        "recovered_chunks": len(audit["recovered"]),
        "unrecovered_chunks": 0,
        "recovery_source_counts": audit["source_counts"],
        "drifted_paths": audit["drifted_paths"],
        "tokenize_payload_sources": audit["tokenize_sources"],
        "historical_git_refs": audit["historical_refs"],
        "worktree_match": audit["worktree_match"],
        "worktree_mismatch": audit["worktree_mismatch"],
        "source_shard_hashes": {row["shard_id"]: row["sha256"] for row in source_shard_meta},
        "token_shard_hashes": {row["shard_id"]: row["sha256"] for row in token_shard_meta},
        "materialized_bundle_hash": materialized["materializedBundleHash"],
        "tokenizer_hash": TOKENIZER_SHA256,
        "token_counts": counts,
        "created_at": created_at,
        "tool_version_fingerprint": TOOL_FINGERPRINT,
        "per_chunk_source": [
            {
                "chunk_id": rec["chunkId"],
                "path": rec["path"],
                "recovery_source_type": rec["recovery_source_type"],
                "recovery_source_ref": rec["recovery_source_ref"],
            }
            for rec in audit["recovered"]
        ],
    }
    (out / "provenance" / "recovery-manifest.json").write_text(
        json.dumps(recovery, indent=2) + "\n", encoding="utf-8"
    )
    rec_dir = recovery_dir(root)
    rec_dir.mkdir(parents=True, exist_ok=True)
    (rec_dir / "recovery-manifest.json").write_text(json.dumps({
        **{k: recovery[k] for k in recovery if k != "per_chunk_source"},
        "per_chunk_source_path": f"{BUNDLE_REL}/provenance/recovery-manifest.json",
    }, indent=2) + "\n", encoding="utf-8")
    (rec_dir / "materialized-manifest.json").write_text(json.dumps(materialized, indent=2) + "\n", encoding="utf-8")
    return {"materialized": materialized, "recovery": recovery, "audit": {
        "total": audit["total"],
        "source_counts": audit["source_counts"],
        "drifted_paths": audit["drifted_paths"],
        "worktree_match": audit["worktree_match"],
        "worktree_mismatch": audit["worktree_mismatch"],
    }}


def verify_bundle(root: Path | None = None, bundle: Path | None = None) -> dict[str, Any]:
    root = root or repo_root()
    out = bundle or bundle_dir(root)
    manifest_path = out / "corpus-manifest.json"
    if not manifest_path.is_file():
        return {"ok": False, "detail": "materialized corpus-manifest.json missing"}
    man = json.loads(manifest_path.read_text(encoding="utf-8"))
    if man.get("corpusIdentityHash") != CORPUS_SHA256:
        return {"ok": False, "detail": "logical corpus identity mismatch"}
    tok = sha256_file(root / TOKENIZER_REL)
    if tok != TOKENIZER_SHA256 or man.get("tokenizerSha256") != TOKENIZER_SHA256:
        return {"ok": False, "detail": "tokenizer hash mismatch"}
    for row in man.get("sourceShards") or []:
        path = root / row["path"]
        if not path.is_file() or sha256_file(path) != row["sha256"]:
            return {"ok": False, "detail": f"source shard hash fail {row['shard_id']}"}
    for row in man.get("tokenShards") or []:
        path = root / row["path"]
        if not path.is_file() or sha256_file(path) != row["sha256"]:
            return {"ok": False, "detail": f"token shard hash fail {row['shard_id']}"}
        arr = np.load(path, mmap_mode="r")
        if int(arr.size) != int(row["token_count"]):
            return {"ok": False, "detail": f"token count fail {row['shard_id']}"}
    counts = man.get("tokenCounts") or {}
    if counts.get("train") != TRAIN_TOKENS or counts.get("validation") != VAL_TOKENS or counts.get("test") != TEST_TOKENS:
        return {"ok": False, "detail": f"tokenCounts mismatch {counts}"}
    recomputed = sha256_json({
        "corpusIdentityHash": man["corpusIdentityHash"],
        "tokenizerSha256": man["tokenizerSha256"],
        "sourceShards": man["sourceShards"],
        "tokenShards": man["tokenShards"],
        "tokenCounts": man["tokenCounts"],
    })
    if recomputed != man.get("materializedBundleHash"):
        return {"ok": False, "detail": "materializedBundleHash mismatch"}
    return {"ok": True, "detail": "all shard hashes verified", "bundle_hash": man["materializedBundleHash"], "manifest": man}


def worktree_drift_report(root: Path | None = None) -> dict[str, Any]:
    root = root or repo_root()
    corpus = json.loads((root / FROZEN_CORPUS_REL).read_text(encoding="utf-8"))
    mismatches = 0
    checked = 0
    paths: set[str] = set()
    cache: dict[str, str | None] = {}
    for chunk in corpus["chunks"]:
        rel = chunk["path"]
        checked += 1
        if rel not in cache:
            path = root / rel
            cache[rel] = path.read_text(encoding="utf-8") if path.is_file() else None
        text = cache[rel]
        if text is None or try_slice(text, chunk) is None:
            mismatches += 1
            paths.add(rel)
    return {
        "detected": mismatches > 0,
        "checked": checked,
        "mismatches": mismatches,
        "paths": sorted(paths),
        "status": "informational",
    }


if __name__ == "__main__":
    report = materialize()
    print(json.dumps({
        "ok": True,
        "bundle_hash": report["materialized"]["materializedBundleHash"],
        "token_counts": report["materialized"]["tokenCounts"],
        "recovery_source_counts": report["recovery"]["recovery_source_counts"],
        "worktree_mismatch": report["audit"]["worktree_mismatch"],
    }, indent=2))
    sys.exit(0)
