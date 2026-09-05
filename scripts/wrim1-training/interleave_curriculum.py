"""TEST_ONLY interleaved rehearsal for WRIM-1.1 Recovery-005.

Changes UNIT ORDER only. Never permutes tokens inside a unit/window.
Does not add BOS/EOS or a new boundary policy.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

import numpy as np

from contiguous_pack import PackedUnit
from dataset_cursor import concatenate_units, initial_cursor, next_batch

FAMILIES = ("wr_corpus_0", "prose", "code", "json", "behavior", "other")
WINDOW_TOKENS_DEFAULT = 2048  # four ctx=512 sequences; short vs 115k Austen binge


def split_unit_contiguous_windows(
    unit: PackedUnit,
    window_tokens: int,
    eos_id: int | None = None,
) -> list[PackedUnit]:
    """Slice a packed unit into contiguous windows. Intra-window order is the source order."""
    n = int(unit.tokens.size)
    if window_tokens <= 0:
        raise ValueError("window_tokens must be positive")
    if n <= window_tokens:
        return [PackedUnit(
            unit_id=f"{unit.unit_id}#w0:0-{n}",
            bucket=unit.bucket,
            origin=unit.origin,
            tokens=np.array(unit.tokens, dtype=np.int32),
            loss_mask=np.array(unit.loss_mask),
            source_path=unit.source_path,
            n_eos=int(unit.n_eos) if eos_id is None else int(np.count_nonzero(unit.tokens == eos_id)),
            truncated=bool(unit.truncated),
        )]
    out: list[PackedUnit] = []
    start = 0
    w = 0
    while start < n:
        end = min(n, start + window_tokens)
        tok = np.array(unit.tokens[start:end], dtype=np.int32)
        mask_src = np.asarray(unit.loss_mask)
        mask = np.array(mask_src[start:end], dtype=mask_src.dtype)
        if eos_id is None:
            n_eos = 0
        else:
            n_eos = int(np.count_nonzero(tok == eos_id))
        out.append(PackedUnit(
            unit_id=f"{unit.unit_id}#w{w}:{start}-{end}",
            bucket=unit.bucket,
            origin=unit.origin,
            tokens=tok,
            loss_mask=mask,
            source_path=unit.source_path,
            n_eos=n_eos,
            truncated=bool(unit.truncated and end == n),
        ))
        start = end
        w += 1
    return out


def split_units_contiguous_windows(
    units: list[PackedUnit],
    window_tokens: int,
    eos_id: int | None = None,
) -> list[PackedUnit]:
    out: list[PackedUnit] = []
    for i, u in enumerate(units):
        parts = split_unit_contiguous_windows(u, window_tokens, eos_id=eos_id)
        for p in parts:
            out.append(PackedUnit(
                unit_id=f"{i}:{p.unit_id}",
                bucket=p.bucket,
                origin=p.origin,
                tokens=p.tokens,
                loss_mask=p.loss_mask,
                source_path=p.source_path,
                n_eos=p.n_eos,
                truncated=p.truncated,
            ))
    return out


def reconstruct_from_windows(windows: list[PackedUnit]) -> np.ndarray:
    if not windows:
        return np.zeros((0,), dtype=np.int32)
    return concatenate_units([u.tokens for u in windows])


def interleave_units_by_deficit(units: list[PackedUnit]) -> list[PackedUnit]:
    """Greedy deficit scheduler: keep local mix near each family's global share.

    Queues are FIFO per family so source order inside a document is preserved
    across its windows; only the sequence of families is interleaved.
    """
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
            if total_used == 0:
                score = target[fam]
            else:
                score = target[fam] - (used[fam] / total_used)
            if best is None or score > best_score:
                best = fam
                best_score = score
        u = remaining[best].pop(0)
        out.append(u)
        used[best] += int(u.tokens.size)
    return out


def prove_window_split_preserves_tokens(
    unit: PackedUnit,
    window_tokens: int,
    eos_id: int | None = None,
) -> dict[str, Any]:
    windows = split_unit_contiguous_windows(unit, window_tokens, eos_id=eos_id)
    rebuilt = reconstruct_from_windows(windows)
    equal = bool(np.array_equal(rebuilt, unit.tokens))
    intra_ok = True
    pos = 0
    for w in windows:
        n = int(w.tokens.size)
        if not np.array_equal(w.tokens, unit.tokens[pos:pos + n]):
            intra_ok = False
            break
        pos += n
    return {
        "equal_to_source": equal,
        "intra_window_matches_source_slices": intra_ok,
        "n_windows": len(windows),
        "source_tokens": int(unit.tokens.size),
        "rebuilt_tokens": int(rebuilt.size),
    }


def prove_interleave_unit_order_only(
    original_units: list[PackedUnit],
    interleaved: list[PackedUnit],
) -> dict[str, Any]:
    orig_map = {u.unit_id: u.tokens.tobytes() for u in original_units}
    if len(interleaved) != len(original_units):
        return {"passed": False, "reason": "unit count changed"}
    ids_orig = {u.unit_id for u in original_units}
    ids_new = {u.unit_id for u in interleaved}
    if ids_orig != ids_new:
        return {"passed": False, "reason": "unit id set changed"}
    order_changed = [u.unit_id for u in original_units] != [u.unit_id for u in interleaved]
    for u in interleaved:
        if u.tokens.tobytes() != orig_map[u.unit_id]:
            return {"passed": False, "reason": f"token bytes changed for {u.unit_id}"}
    concat_orig = concatenate_units([u.tokens for u in original_units])
    concat_new = concatenate_units([u.tokens for u in interleaved])
    return {
        "passed": True,
        "unit_order_changed": bool(order_changed),
        "token_multiset_equal": True,
        "concat_equal_only_if_order_unchanged": bool(np.array_equal(concat_orig, concat_new)),
        "n_units": len(interleaved),
    }


def build_span_index(units: list[PackedUnit]) -> list[dict[str, Any]]:
    spans = []
    pos = 0
    for u in units:
        n = int(u.tokens.size)
        spans.append({
            "start": pos,
            "end": pos + n,
            "unit_id": u.unit_id,
            "bucket": u.bucket,
            "origin": u.origin,
            "source_path": u.source_path,
            "n_tokens": n,
            "n_eos": int(u.n_eos),
            "truncated": bool(u.truncated),
        })
        pos += n
    return spans


def _counts_for_range(spans: list[dict[str, Any]], start: int, end: int) -> dict[str, int]:
    by: dict[str, int] = defaultdict(int)
    for s in spans:
        lo = max(start, s["start"])
        hi = min(end, s["end"])
        if hi > lo:
            by[s["bucket"]] += hi - lo
    return dict(by)


def pct_from_counts(counts: dict[str, int]) -> dict[str, float]:
    tot = int(sum(counts.values())) or 1
    return {k: round(100.0 * v / tot, 4) for k, v in sorted(counts.items())}


def dominant_family(counts: dict[str, int]) -> str:
    if not counts:
        return "none"
    return max(counts.items(), key=lambda kv: (kv[1], kv[0]))[0]


def simulate_step_mix(
    *,
    train_stream: np.ndarray,
    train_mask: np.ndarray,
    units: list[PackedUnit],
    ctx: int,
    batch: int,
    seed: int,
    n_steps: int,
) -> list[dict[str, Any]]:
    spans = build_span_index(units)
    cursor = initial_cursor(train_stream.size, ctx, batch, seed)
    rows = []
    for step in range(1, n_steps + 1):
        offset_before = cursor.token_offset
        epoch_before = cursor.epoch
        x, y, w, cursor = next_batch(train_stream, cursor, loss_mask=train_mask)
        by: dict[str, int] = defaultdict(int)
        seq_starts = []
        off = offset_before
        epoch = epoch_before
        usable = train_stream.size - ctx - 1
        for _ in range(batch):
            if off > usable:
                epoch += 1
                off = 0
            seq_starts.append(off)
            by_range = _counts_for_range(spans, off, off + ctx)
            for k, v in by_range.items():
                by[k] += v
            off += ctx
        tot = int(sum(by.values())) or 1
        pct = pct_from_counts(by)
        rows.append({
            "step": step,
            "token_counts": dict(by),
            "pct": pct,
            "rehearsal_pct": float(pct.get("wr_corpus_0") or 0.0),
            "prose_pct": float(pct.get("prose") or 0.0),
            "code_pct": float(pct.get("code") or 0.0),
            "json_pct": float(pct.get("json") or 0.0),
            "behavior_pct": float(pct.get("behavior") or 0.0),
            "dominant_source_family": dominant_family(by),
            "seq_starts": seq_starts,
            "n_tokens": tot,
            "causal_ok": bool(all(np.array_equal(y[i, :-1], x[i, 1:]) for i in range(x.shape[0]))),
        })
    return rows


def rolling_rehearsal(rows: list[dict[str, Any]], width: int) -> list[dict[str, Any]]:
    out = []
    for i in range(len(rows)):
        lo = max(0, i + 1 - width)
        chunk = rows[lo:i + 1]
        by: dict[str, int] = defaultdict(int)
        for r in chunk:
            for k, v in r["token_counts"].items():
                by[k] += v
        tot = int(sum(by.values())) or 1
        out.append({
            "end_step": rows[i]["step"],
            "window_steps": len(chunk),
            "width": width,
            "rehearsal_pct": round(100.0 * by.get("wr_corpus_0", 0) / tot, 4),
            "pct": pct_from_counts(by),
        })
    return out


def consecutive_runs(rows: list[dict[str, Any]], *, rehearsal_only: bool) -> dict[str, Any]:
    """Longest run of steps that are ~100% rehearsal or ~0% rehearsal."""
    longest = 0
    cur = 0
    longest_span = None
    start = None
    for r in rows:
        reh = float(r["rehearsal_pct"])
        hit = reh >= 99.0 if rehearsal_only else reh <= 1.0
        if hit:
            cur += 1
            if start is None:
                start = r["step"]
            if cur > longest:
                longest = cur
                longest_span = [start, r["step"]]
        else:
            cur = 0
            start = None
    return {
        "kind": "rehearsal_only" if rehearsal_only else "non_rehearsal_only",
        "longest_steps": longest,
        "span": longest_span,
    }


def local_mix_preflight(rows: list[dict[str, Any]]) -> dict[str, Any]:
    roll5 = rolling_rehearsal(rows, 5)
    roll10 = rolling_rehearsal(rows, 10)
    reh_run = consecutive_runs(rows, rehearsal_only=True)
    non_run = consecutive_runs(rows, rehearsal_only=False)
    reasons = []
    # Pathological: 004's 27-step Austen binge, or a 10-step window at 0% or 100%.
    if reh_run["longest_steps"] >= 8:
        reasons.append(f"rehearsal-only run of {reh_run['longest_steps']} steps (span {reh_run['span']})")
    if non_run["longest_steps"] >= 10:
        reasons.append(f"non-rehearsal-only run of {non_run['longest_steps']} steps (span {non_run['span']})")
    for r in roll10:
        if r["window_steps"] < 10:
            continue
        if r["rehearsal_pct"] >= 99.0:
            reasons.append(f"10-step window ending {r['end_step']} is {r['rehearsal_pct']}% rehearsal")
        if r["rehearsal_pct"] <= 1.0:
            reasons.append(f"10-step window ending {r['end_step']} is {r['rehearsal_pct']}% rehearsal")
    # One family dominating many consecutive steps unexpectedly (same as 004 Austen).
    fam_run = 0
    fam_cur = None
    fam_len = 0
    fam_span = None
    start = None
    for r in rows:
        d = r["dominant_source_family"]
        if d == fam_cur:
            fam_len += 1
        else:
            fam_cur = d
            fam_len = 1
            start = r["step"]
        if fam_len > fam_run:
            fam_run = fam_len
            fam_span = {"family": d, "span": [start, r["step"]], "length": fam_len}
    if fam_run >= 12:
        reasons.append(
            f"dominant family {fam_span['family']} for {fam_run} consecutive steps {fam_span['span']}"
        )
    return {
        "passed": len(reasons) == 0,
        "stop_reasons": reasons,
        "longest_rehearsal_only_steps": reh_run["longest_steps"],
        "longest_rehearsal_only_span": reh_run["span"],
        "longest_non_rehearsal_only_steps": non_run["longest_steps"],
        "longest_non_rehearsal_only_span": non_run["span"],
        "longest_dominant_family_run": fam_span,
        "rolling_5": roll5,
        "rolling_10": roll10,
        "n_steps": len(rows),
    }


def families_for_positions(spans: list[dict[str, Any]], positions: np.ndarray) -> list[str]:
    """Map stream positions to bucket. positions shape [N]."""
    bounds = np.array([s["end"] for s in spans], dtype=np.int64)
    idx = np.searchsorted(bounds, positions, side="right")
    out = []
    for i, p in zip(idx.tolist(), positions.tolist()):
        if i >= len(spans) or p < spans[i]["start"] or p >= spans[i]["end"]:
            out.append("other")
        else:
            out.append(spans[i]["bucket"])
    return out
