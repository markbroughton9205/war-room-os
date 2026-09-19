"""BALANCED_GENESIS rehearsal packer for WRIM1-RUN-000006.

Stdlib only. Does not construct an optimizer. Does not mutate corpus or tokenizer.
Uses the frozen WRIM-0 train.npy slices for the five genesis train documents.
"""
from __future__ import annotations

import hashlib
import json
import struct
from array import array
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from run000006_coverage import FROZEN_GENESIS_TRAIN_IDS, rehearsal_coverage_report
from run000006_gates import packing_preflight_decision
from run000006_identity import LOCKED_MIX, MAX_TOKENS, PACK_TARGET_TOKENS, SEED

BOS_ID = 1
EOS_ID = 2
MAX_EXCERPT_TOKENS = 1024
MAJORITY_HARD_CAP = 0.50


@dataclass
class Unit:
    unit_id: str
    bucket: str
    tokens: list[int]
    origin: str = "WR-CORPUS-0"

    @property
    def size(self) -> int:
        return len(self.tokens)


def seed_offset(seed: int, tag: str) -> int:
    digest = hashlib.sha256(f"{seed}:{tag}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "little") % (2**31)


def shuffle_units(units: list[Unit], seed: int) -> list[Unit]:
    """Deterministic Fisher-Yates. Independent of NumPy so preflight == future runner."""
    out = list(units)
    if len(out) <= 1:
        return out
    sb = str(int(seed)).encode("utf-8")
    for i in range(len(out) - 1, 0, -1):
        h = hashlib.sha256(sb + b":" + i.to_bytes(8, "little")).digest()
        j = int.from_bytes(h[:8], "little") % (i + 1)
        out[i], out[j] = out[j], out[i]
    return out


def genesis_doc_id(unit: Unit) -> str:
    return str(unit.unit_id).split("#", 1)[0].split(":", 1)[0]


def load_npy_u2_le(path: Path) -> list[int]:
    raw = path.read_bytes()
    if raw[:6] != b"\x93NUMPY":
        raise ValueError(f"not an npy file: {path}")
    major, minor = raw[6], raw[7]
    if major == 1:
        hlen = struct.unpack_from("<H", raw, 8)[0]
        header = raw[10 : 10 + hlen].decode("latin1")
        data = raw[10 + hlen :]
    elif major == 2:
        hlen = struct.unpack_from("<I", raw, 8)[0]
        header = raw[12 : 12 + hlen].decode("latin1")
        data = raw[12 + hlen :]
    else:
        raise ValueError(f"unsupported npy version {major}.{minor}")
    if "<u2" not in header and "|u2" not in header:
        raise ValueError(f"expected little-endian uint16 tokens, header={header!r}")
    arr = array("H")
    arr.frombytes(data)
    if arr.itemsize != 2:
        arr.byteswap()
    return list(arr)


def wrap_lm_tokens(body: list[int]) -> list[int]:
    out = list(body)
    if not out or out[0] != BOS_ID:
        out = [BOS_ID, *out]
    if out[-1] != EOS_ID:
        out = [*out, EOS_ID]
    return out


def split_bounded_excerpts(unit: Unit, max_tokens: int = MAX_EXCERPT_TOKENS) -> list[Unit]:
    raw = list(unit.tokens)
    if raw and raw[0] == BOS_ID:
        raw = raw[1:]
    if raw and raw[-1] == EOS_ID:
        raw = raw[:-1]
    if not raw:
        return []
    inner = max(8, int(max_tokens) - 2)
    out: list[Unit] = []
    start = 0
    i = 0
    while start < len(raw):
        end = min(len(raw), start + inner)
        wrapped = wrap_lm_tokens(raw[start:end])
        out.append(
            Unit(
                unit_id=f"{unit.unit_id}#ex{i}:{start}-{end}",
                bucket=unit.bucket,
                tokens=wrapped,
                origin=unit.origin,
            )
        )
        start = end
        i += 1
    return out


def contiguous_prefix(unit: Unit, budget: int) -> Unit | None:
    if budget < 4:
        return None
    n = min(unit.size, int(budget))
    prefix = list(unit.tokens[:n])
    if not prefix:
        return None
    prefix[0] = BOS_ID
    prefix[-1] = EOS_ID
    if len(prefix) < 4:
        return None
    return Unit(
        unit_id=f"{unit.unit_id}:prefix{len(prefix)}",
        bucket=unit.bucket,
        tokens=prefix,
        origin=unit.origin,
    )


def take_round_robin_docs(queues: dict[str, list[Unit]], budget: int, majority_cap: float = MAJORITY_HARD_CAP) -> list[Unit]:
    remaining = {k: list(v) for k, v in queues.items()}
    used = {k: 0 for k in remaining}
    out: list[Unit] = []
    filled = 0
    hard = int(budget * majority_cap) - 1 if budget > 0 else 0
    hard = max(0, hard)
    while filled < budget - 3 and any(remaining[k] for k in remaining):
        active = [k for k in sorted(remaining) if remaining[k] and used[k] < hard]
        if not active:
            active = [k for k in sorted(remaining) if remaining[k] and used[k] < hard]
            if not active:
                break
        total_used = max(1, filled)
        best = min(active, key=lambda k: used[k] / total_used)
        u = remaining[best].pop(0)
        n = u.size
        room_budget = budget - filled
        room_cap = hard - used[best]
        room = min(room_budget, room_cap)
        if n <= room:
            out.append(u)
            used[best] += n
            filled += n
            continue
        capped = contiguous_prefix(u, room)
        if capped is not None and capped.size <= room:
            out.append(capped)
            used[best] += capped.size
            filled += capped.size
        remaining[best] = []
    return out


def load_frozen_genesis_train_units(dump_root: Path) -> list[Unit]:
    npy = dump_root / "model-lab" / "manifests" / "wrim0_corpus_shards" / "train.npy"
    man_path = dump_root / "model-lab" / "manifests" / "wrim0_corpus_shards" / "shard-manifest.json"
    man = json.loads(man_path.read_text(encoding="utf-8"))
    tokens = load_npy_u2_le(npy)
    offset = 0
    units: list[Unit] = []
    frozen = set(FROZEN_GENESIS_TRAIN_IDS)
    for doc in man.get("trainDocs") or []:
        n = int(doc["tokenCount"])
        sl = tokens[offset : offset + n]
        offset += n
        doc_id = str(doc.get("documentId"))
        if doc_id not in frozen:
            continue
        if len(sl) < 3:
            continue
        units.append(Unit(unit_id=doc_id, bucket="wr_corpus_0", tokens=sl, origin="WR-CORPUS-0"))
    by_id = {u.unit_id: u for u in units}
    ordered = [by_id[d] for d in FROZEN_GENESIS_TRAIN_IDS if d in by_id]
    return ordered


def balanced_genesis_units(raw_genesis: list[Unit], seed: int, budget: int) -> list[Unit]:
    queues: dict[str, list[Unit]] = {}
    for doc in raw_genesis:
        excerpts = split_bounded_excerpts(doc)
        doc_id = genesis_doc_id(doc)
        queues[doc_id] = shuffle_units(excerpts, seed_offset(seed, f"genesis-excerpts:{doc_id}"))
    return take_round_robin_docs(queues, budget)


def coverage_from_units(units: list[Unit], prefix_tokens: int | None = None) -> dict[str, Any]:
    used = 0
    by_doc: dict[str, int] = {}
    limit = int(prefix_tokens) if prefix_tokens is not None else sum(u.size for u in units)
    for u in units:
        n = u.size
        take = n if used + n <= limit else max(0, limit - used)
        if take <= 0:
            break
        if u.bucket == "wr_corpus_0":
            doc = genesis_doc_id(u)
            by_doc[doc] = int(by_doc.get(doc, 0)) + take
        used += take
        if used >= limit:
            break
    return rehearsal_coverage_report(by_doc)


def pack_balanced_genesis(dump_root: Path, tokenizer_path: Path | None = None) -> dict[str, Any]:
    del tokenizer_path  # genesis tokens are already in frozen train.npy; tokenizer is not mutated
    units = load_frozen_genesis_train_units(dump_root)
    discovered = [u.unit_id for u in units]
    budget = int(PACK_TARGET_TOKENS * float(LOCKED_MIX["wr_corpus_0"]))
    selected = balanced_genesis_units(units, SEED, budget)
    audit = coverage_from_units(selected)
    # Mixed-prefix sensitivity: first ~30% of the 102400-token train prefix is genesis mass.
    prefix_genesis = min(int(sum(u.size for u in selected)), int(MAX_TOKENS * float(LOCKED_MIX["wr_corpus_0"])))
    prefix_audit = coverage_from_units(selected, prefix_genesis)
    decision = packing_preflight_decision(
        starved_doc_ids=list(audit["STARVED_DOC_IDS"]),
        max_doc_share=float(audit["MAX_DOC_SHARE"]),
    )
    if prefix_audit["STARVED_DOC_IDS"] or float(prefix_audit["MAX_DOC_SHARE"]) >= 0.50:
        decision = packing_preflight_decision(
            starved_doc_ids=list(prefix_audit["STARVED_DOC_IDS"]),
            max_doc_share=float(prefix_audit["MAX_DOC_SHARE"]),
        )
    return {
        "packer": "balanced-genesis-excerpt-v1-stdlib-run000006",
        "discovered_genesis_ids": discovered,
        "frozen_pool": list(FROZEN_GENESIS_TRAIN_IDS),
        "selected_token_counts": {"wr_corpus_0": int(sum(u.size for u in selected))},
        "stream_tokens": None,
        "prefix_tokens": MAX_TOKENS,
        "seed": SEED,
        "strategy": "BALANCED_GENESIS",
        "locked_mix": LOCKED_MIX,
        "rehearsal_budget": budget,
        "audit": audit,
        "prefix_audit": prefix_audit,
        "decision": decision,
        "ALL_REHEARSAL_DOCS": audit["ALL_DOC_IDS"],
        "REHEARSAL_TOKEN_ALLOCATION": audit["DOC_TOKEN_COUNTS"],
        "MAX_REHEARSAL_DOC_SHARE": audit["MAX_DOC_SHARE"],
        "EFFECTIVE_DOCUMENT_N": audit["EFFECTIVE_DOCUMENT_N"],
        "STARVED_DOC_IDS": audit["STARVED_DOC_IDS"],
        "corpus_mutated": False,
        "tokenizer_mutated": False,
        "optimizer_constructed": False,
        "numpy_required": False,
        "tokenizers_required": False,
        "exact_mixed_interleave": False,
        "note": "Genesis rehearsal allocation is exact from frozen train.npy. Mixed WR-CORPUS-1 interleave is applied only at authorized training and cannot starve a genesis doc that already has early round-robin excerpts.",
    }


def self_test() -> dict[str, Any]:
    counts = {
        FROZEN_GENESIS_TRAIN_IDS[0]: 1000,
        FROZEN_GENESIS_TRAIN_IDS[1]: 1000,
        FROZEN_GENESIS_TRAIN_IDS[2]: 1000,
        FROZEN_GENESIS_TRAIN_IDS[3]: 1000,
    }
    omitted = rehearsal_coverage_report(counts)
    empty = rehearsal_coverage_report({})
    checks = [
        FROZEN_GENESIS_TRAIN_IDS[4] in omitted["STARVED_DOC_IDS"],
        len(omitted["ALL_DOC_IDS"]) == 5,
        empty["STARVED_DOC_IDS"] == list(FROZEN_GENESIS_TRAIN_IDS),
        omitted["MAX_DOC_SHARE"] == 0.25,
    ]
    return {"ok": all(checks), "checks": checks, "omitted_starved": omitted["STARVED_DOC_IDS"]}
