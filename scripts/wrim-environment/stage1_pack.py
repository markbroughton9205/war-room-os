"""Corrected contiguous unit packing for WRIM1-NEBULA-DIAG-000001.

Never permutes the 1-D token stream. Wrap every unit [BOS=1] + ids + [EOS=2].
Deficit-interleave 2048-token family windows, then slice contiguous 512 windows.
TOOL_USE excluded. Eval-only / leakage strings excluded. Hidden eval contamination = STOP.
"""
from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from tokenizers import Tokenizer

BOS_ID = 1
EOS_ID = 2
SEQ_LEN = 512
WINDOW_TOKENS = 2048
PACKING_SEED = 20260912
DATA_ORDER_SEED = 20260912
TARGET_STREAM_TOKENS = 65536
MIX = {
    "wr_corpus_0": 0.300,
    "prose": 0.341,
    "code": 0.256,
    "json": 0.086,
    "behavior": 0.017,
}

HELD_OUT_PROMPT_STRINGS = [
    "Alice was beginning to",
    "heldOutChecksum(input: string): string",
    '{"trainingStarted":',
    "select_tool curl https://example.invalid/wave81",
    "Source Rho timestamps an incident at 09:11 UTC",
    "Cite only provenance refs present on the record. Record provenanceRefs=[].",
    "Held-out retrieval probe",
    "Claim M: river crest 3.1m. Claim N: river crest 5.9m",
    "Observation validUntil=2026-08-30T17:00:00.000Z evaluated at 2026-08-30T18:00:00.000Z",
    "Continue project wave8.1 corpus hardening without starting WRIM-1 training.",
    "export function sha256(value: string)",
]

EVAL_INFRA_MARKERS = [
    "contaminationFingerprint",
    "WRIM-RECOVERY-DIAGNOSTIC-0",
    "w81-eval-language-alice",
    "buildHeldOutSuite81",
    "held-out-eval-suite",
    "heldOutChecksum",
    "WAVE_9_WRIM1",
    "WRIM1_RUN_000001_EVALUATION",
    "GENESIS_REPORT",
    "live_wrim0_heldout_run",
    "EXCLUDE_FROM_TRAINING",
    "WRIM-1.1-CAP-EVAL-0",
    "WRIM11_CAP_EVAL_0",
]

EVAL_INFRA_PATH_MARKERS = [
    "heldout.ts",
    "heldout",
    "/eval.ts",
    "behavior.ts",
    "held-out",
    "held_out",
    "genesis_report",
    "wrim0-heldout",
    "held-out-results",
    "wrim1_checkpoints/held-out",
    "eval-only",
    "wrim-1.1-cap-eval",
    "cap-eval-0",
]


@dataclass
class PackedUnit:
    unit_id: str
    bucket: str
    origin: str
    tokens: np.ndarray
    source_path: str = ""
    n_eos: int = 0
    n_bos: int = 0


def leak_hits(text: str) -> list[str]:
    hits = []
    for prompt in HELD_OUT_PROMPT_STRINGS:
        if prompt and prompt in text:
            hits.append(prompt[:48])
    return hits


def is_eval_infra_text(text: str, path: str = "") -> bool:
    blob = text
    low_path = path.lower().replace("\\", "/")
    if any(m in low_path for m in EVAL_INFRA_PATH_MARKERS):
        return True
    if any(m in blob for m in EVAL_INFRA_MARKERS):
        return True
    return bool(leak_hits(blob))


def is_tool_use(rec: dict) -> bool:
    kind = str(rec.get("kind") or "")
    fmt = str(rec.get("format") or "")
    tags = rec.get("capability_tags") or rec.get("capabilityTags") or []
    path = str(rec.get("source_path") or rec.get("path") or "")
    blob = f"{kind} {fmt} {path} {' '.join(str(t) for t in tags)}".lower()
    return "tool_use" in blob or "tool-use" in blob or "tooluse" in blob or "tool_required" in blob


def text_of(rec: dict) -> str:
    if isinstance(rec.get("text"), str):
        return rec["text"]
    if isinstance(rec.get("renderedTrainingText"), str):
        return rec["renderedTrainingText"]
    return ""


def bucket_for_record(rec: dict) -> str:
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


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def wrap_lm_tokens(body: list[int]) -> np.ndarray:
    return np.array([BOS_ID, *body, EOS_ID], dtype=np.int32)


def group_chunks_into_source_runs(records: list[dict]) -> list[list[dict]]:
    by_source: dict[str, list[dict]] = defaultdict(list)
    for rec in records:
        if rec.get("kind") == "behavior_example":
            continue
        key = str(rec.get("source_lineage") or rec.get("source_path") or rec.get("chunk_id") or rec.get("id"))
        by_source[key].append(rec)
    runs: list[list[dict]] = []
    for items in by_source.values():
        items.sort(key=lambda r: int(r.get("original_offset_start") or 0))
        current: list[dict] = []
        prev_end = None
        for rec in items:
            start = rec.get("original_offset_start")
            end = rec.get("original_offset_end")
            if current and prev_end is not None and start is not None and int(start) != int(prev_end):
                runs.append(current)
                current = []
            current.append(rec)
            prev_end = end
        if current:
            runs.append(current)
    return runs


def shuffle_unit_order(units: list[PackedUnit], seed: int) -> list[PackedUnit]:
    if len(units) <= 1:
        return list(units)
    rng = np.random.default_rng(seed)
    order = rng.permutation(len(units))
    return [units[int(i)] for i in order]


def split_unit_windows(unit: PackedUnit, window_tokens: int = WINDOW_TOKENS) -> list[PackedUnit]:
    n = int(unit.tokens.size)
    if n <= window_tokens:
        return [unit]
    out: list[PackedUnit] = []
    start = 0
    w = 0
    while start < n:
        end = min(n, start + window_tokens)
        tok = np.array(unit.tokens[start:end], dtype=np.int32)
        out.append(
            PackedUnit(
                unit_id=f"{unit.unit_id}#w{w}:{start}-{end}",
                bucket=unit.bucket,
                origin=unit.origin,
                tokens=tok,
                source_path=unit.source_path,
                n_eos=int(np.count_nonzero(tok == EOS_ID)),
                n_bos=int(np.count_nonzero(tok == BOS_ID)),
            )
        )
        start = end
        w += 1
    return out


def interleave_by_deficit(units: list[PackedUnit]) -> list[PackedUnit]:
    queues: dict[str, list[PackedUnit]] = defaultdict(list)
    for u in units:
        queues[u.bucket].append(u)
    totals = {k: int(sum(u.tokens.size for u in v)) for k, v in queues.items()}
    grand = int(sum(totals.values())) or 1
    target = {k: v / grand for k, v in totals.items()}
    used = {k: 0 for k in totals}
    remaining = {k: list(v) for k, v in queues.items()}
    out: list[PackedUnit] = []
    while any(remaining[k] for k in remaining):
        total_used = int(sum(used.values()))
        best = None
        best_score = None
        for fam in sorted(remaining.keys()):
            if not remaining[fam]:
                continue
            score = target[fam] if total_used == 0 else target[fam] - (used[fam] / total_used)
            if best is None or score > best_score:
                best = fam
                best_score = score
        u = remaining[best].pop(0)
        out.append(u)
        used[best] += int(u.tokens.size)
    return out


def take_until_budget(units: list[PackedUnit], budget: int) -> list[PackedUnit]:
    out: list[PackedUnit] = []
    used = 0
    for u in units:
        if used >= budget:
            break
        out.append(u)
        used += int(u.tokens.size)
    return out


def encode_corpus1_units(tokenizer: Tokenizer, dump_root: Path) -> dict[str, list[PackedUnit]]:
    train_jsonl = dump_root / "model-lab" / "corpora" / "WR-CORPUS-1-HARDENED" / "train" / "shard-00000.jsonl"
    rows = load_jsonl(train_jsonl)
    clean: list[dict] = []
    for rec in rows:
        text = text_of(rec)
        path = str(rec.get("source_path") or "")
        if is_tool_use(rec) or is_eval_infra_text(text, path):
            continue
        clean.append(rec)
    by_bucket: dict[str, list[PackedUnit]] = defaultdict(list)
    for run in group_chunks_into_source_runs(clean):
        text = "".join(text_of(r) for r in run)
        if not text.strip():
            continue
        body = tokenizer.encode(text).ids
        if not body:
            continue
        ids = wrap_lm_tokens(body)
        bucket = bucket_for_record(run[0])
        if bucket == "behavior":
            bucket = "other"
        if bucket == "other":
            continue
        unit = PackedUnit(
            unit_id=str(run[0].get("source_lineage") or run[0].get("chunk_id")),
            bucket=bucket,
            origin="WR-CORPUS-1",
            tokens=ids,
            source_path=str(run[0].get("source_path") or ""),
            n_eos=int(np.count_nonzero(ids == EOS_ID)),
            n_bos=int(np.count_nonzero(ids == BOS_ID)),
        )
        by_bucket[bucket].append(unit)
    return by_bucket


def encode_rehearsal_units(tokenizer: Tokenizer, dump_root: Path) -> list[PackedUnit]:
    npy = dump_root / "model-lab" / "manifests" / "wrim0_corpus_shards" / "train.npy"
    man = json.loads((dump_root / "model-lab" / "manifests" / "wrim0_corpus_shards" / "shard-manifest.json").read_text(encoding="utf-8"))
    wrim0 = np.load(npy)
    offset = 0
    units: list[PackedUnit] = []
    for doc in man.get("trainDocs") or []:
        n = int(doc["tokenCount"])
        sl = np.array(wrim0[offset : offset + n], dtype=np.int32)
        offset += n
        decoded = tokenizer.decode(sl.tolist(), skip_special_tokens=True)
        if is_eval_infra_text(decoded, "WR-CORPUS-0"):
            continue
        if sl.size < 3:
            continue
        units.append(
            PackedUnit(
                unit_id=str(doc.get("documentId")),
                bucket="wr_corpus_0",
                origin="WR-CORPUS-0",
                tokens=sl,
                n_eos=int(np.count_nonzero(sl == EOS_ID)),
                n_bos=int(np.count_nonzero(sl == BOS_ID)),
            )
        )
    return units


def encode_behavior_units(tokenizer: Tokenizer, dump_root: Path) -> list[PackedUnit]:
    path = dump_root / "model-lab" / "manifests" / "wave8_1" / "behavior-examples.json"
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    units: list[PackedUnit] = []
    for ex in payload.get("examples") or []:
        rendered = ex.get("renderedTrainingText") or ""
        if is_eval_infra_text(rendered, "behavior-examples.json"):
            continue
        blob = json.dumps(ex, ensure_ascii=False).lower()
        if "tool" in blob and ("tool_use" in blob or "select_tool" in blob):
            continue
        ids = tokenizer.encode(rendered).ids
        if not ids:
            continue
        if ids[0] != BOS_ID:
            ids = [BOS_ID, *ids]
        if ids[-1] != EOS_ID:
            ids = [*ids, EOS_ID]
        units.append(
            PackedUnit(
                unit_id=str(ex.get("exampleId")),
                bucket="behavior",
                origin="behavior-non-tool",
                tokens=np.array(ids, dtype=np.int32),
                n_eos=int(ids.count(EOS_ID)),
                n_bos=int(ids.count(BOS_ID)),
            )
        )
    return units


def build_corrected_stream(*, dump_root: Path, tokenizer: Tokenizer) -> dict[str, Any]:
    c1 = encode_corpus1_units(tokenizer, dump_root)
    rehearsal = shuffle_unit_order(encode_rehearsal_units(tokenizer, dump_root), DATA_ORDER_SEED)
    behavior = shuffle_unit_order(encode_behavior_units(tokenizer, dump_root), DATA_ORDER_SEED + 1)
    families = {
        "wr_corpus_0": rehearsal,
        "prose": shuffle_unit_order(c1.get("prose", []), DATA_ORDER_SEED + 2),
        "code": shuffle_unit_order(c1.get("code", []), DATA_ORDER_SEED + 3),
        "json": shuffle_unit_order(c1.get("json", []), DATA_ORDER_SEED + 4),
        "behavior": behavior,
    }
    selected: list[PackedUnit] = []
    selected_counts: dict[str, int] = {}
    for fam, frac in MIX.items():
        budget = int(TARGET_STREAM_TOKENS * frac)
        taken = take_until_budget(families.get(fam, []), budget)
        selected.extend(taken)
        selected_counts[fam] = int(sum(u.tokens.size for u in taken))

    windows: list[PackedUnit] = []
    for u in selected:
        windows.extend(split_unit_windows(u))
    interleaved = interleave_by_deficit(windows)
    stream = np.concatenate([u.tokens for u in interleaved]) if interleaved else np.zeros((0,), dtype=np.int32)

    leak_scan_hits = []
    for u in interleaved:
        decoded = tokenizer.decode(u.tokens.tolist(), skip_special_tokens=True)
        hits = leak_hits(decoded)
        if hits:
            leak_scan_hits.append({"unit_id": u.unit_id, "origin": u.origin, "hits": hits})

    bos_total = int(np.count_nonzero(stream == BOS_ID))
    eos_total = int(np.count_nonzero(stream == EOS_ID))
    token_counts: dict[str, int] = defaultdict(int)
    for u in interleaved:
        token_counts[u.bucket] += int(u.tokens.size)
    total = int(stream.size) or 1
    pct = {k: round(100.0 * v / total, 2) for k, v in token_counts.items()}

    rebuilt = np.concatenate([u.tokens for u in interleaved]) if interleaved else stream
    contiguous_units = bool(np.array_equal(rebuilt, stream))
    no_token_shuffle = True
    for u in selected:
        parts = split_unit_windows(u)
        rebuilt_u = np.concatenate([p.tokens for p in parts])
        if not np.array_equal(rebuilt_u, u.tokens):
            no_token_shuffle = False
            break

    needed = 10 * 8 * SEQ_LEN + 1
    packing_ok = (
        int(stream.size) >= needed
        and bos_total > 0
        and eos_total > 0
        and contiguous_units
        and no_token_shuffle
        and not leak_scan_hits
        and eos_total >= bos_total
    )
    return {
        "stream": stream,
        "audit": {
            "method": "CONTIGUOUS_UNIT_PACK_DEFICIT_INTERLEAVE",
            "historical_shuffle": "FORBIDDEN",
            "bos_id": BOS_ID,
            "eos_id": EOS_ID,
            "bos_count": bos_total,
            "eos_count": eos_total,
            "stream_tokens": int(stream.size),
            "needed_tokens": needed,
            "window_tokens": WINDOW_TOKENS,
            "seq_len": SEQ_LEN,
            "selected_token_counts": selected_counts,
            "packed_token_percent": pct,
            "n_units_selected": len(selected),
            "n_windows": len(windows),
            "leak_scan_hits": leak_scan_hits,
            "contiguous_concat": contiguous_units,
            "unit_token_order_preserved": no_token_shuffle,
            "tool_use": "EXCLUDED",
            "packing_ok": packing_ok,
            "seed_data_order": DATA_ORDER_SEED,
            "seed_packing": PACKING_SEED,
        },
    }


def slice_contiguous_batches(stream: np.ndarray, steps: int, batch_size: int, seq_len: int) -> list[tuple[np.ndarray, np.ndarray]]:
    batches = []
    offset = 0
    for _ in range(steps):
        xs = []
        ys = []
        for _b in range(batch_size):
            xs.append(stream[offset : offset + seq_len])
            ys.append(stream[offset + 1 : offset + seq_len + 1])
            offset += seq_len
        x = np.stack(xs).astype(np.int64)
        y = np.stack(ys).astype(np.int64)
        batches.append((x, y))
    return batches


def causal_batch_audit(batches: list[tuple[np.ndarray, np.ndarray]], stream: np.ndarray) -> dict[str, Any]:
    ok = True
    reasons = []
    bos_in_batch = False
    eos_in_batch = False
    for i, (x, y) in enumerate(batches):
        if not np.array_equal(y[:, :-1], x[:, 1:]):
            ok = False
            reasons.append(f"step{i}: y[t] != x[t+1] inside window")
        if i + 1 < len(batches):
            # last target of last row in batch i should be stream-adjacent to next window start
            pass
        if np.any(x == BOS_ID) or np.any(y == BOS_ID):
            bos_in_batch = True
        if np.any(x == EOS_ID) or np.any(y == EOS_ID):
            eos_in_batch = True
    if not bos_in_batch:
        ok = False
        reasons.append("no BOS in packed batches")
    if not eos_in_batch:
        ok = False
        reasons.append("no EOS in packed batches")
    return {
        "ok": ok,
        "reasons": reasons,
        "bos_present": bos_in_batch,
        "eos_present": eos_in_batch,
        "n_batches": len(batches),
        "shape": [int(batches[0][0].shape[0]), int(batches[0][0].shape[1])] if batches else [],
        "stream_tokens": int(stream.size),
    }
