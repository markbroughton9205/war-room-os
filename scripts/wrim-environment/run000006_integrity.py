"""Canonical LF hashing for wrim0-reference-nll.json. Does not rewrite the artifact."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from run000006_identity import REFERENCE_NLL_CANONICAL_LF_SHA


def newline_normalize_bytes(raw: bytes) -> bytes:
    """CRLF or CR → LF. Does not change JSON numbers, keys, values, or other whitespace."""
    text = raw.decode("utf-8")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return text.encode("utf-8")


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical_lf_sha256(raw: bytes) -> str:
    return sha256_bytes(newline_normalize_bytes(raw))


def hash_reference_nll_bytes(raw: bytes) -> dict[str, Any]:
    raw_sha = sha256_bytes(raw)
    lf_sha = canonical_lf_sha256(raw)
    obj = json.loads(newline_normalize_bytes(raw))
    return {
        "RAW_SHA256": raw_sha,
        "CANONICAL_LF_SHA256": lf_sha,
        "matches_frozen_expected": lf_sha == REFERENCE_NLL_CANONICAL_LF_SHA,
        "n_items": len(obj.get("items") or []),
        "kind": obj.get("kind"),
        "rewritten": False,
    }


def hash_reference_nll_path(path: Path) -> dict[str, Any]:
    raw = path.read_bytes()
    out = hash_reference_nll_bytes(raw)
    out["path"] = str(path)
    out["bytes"] = len(raw)
    return out


def integrity_verdict(raw: bytes, *, expected_lf_sha: str = REFERENCE_NLL_CANONICAL_LF_SHA) -> dict[str, Any]:
    hashed = hash_reference_nll_bytes(raw)
    ok = hashed["CANONICAL_LF_SHA256"] == expected_lf_sha
    return {
        **hashed,
        "REFERENCE_NLL_INTEGRITY": "PASS" if ok else "FAIL",
        "ok": ok,
    }
