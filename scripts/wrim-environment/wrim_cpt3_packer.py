"""WRIM1-CPT-000003 runtime packer.

Fixes CPT-000002 defect: mixed batches only used families 0–7, so
structured_json / technical / genesis / role appeared only as 8/8 homogeneous
minibatches.

Does not mutate frozen corpus JSONL. Window tokens are built from the same
family-local concatenation as CPT-000002; only minibatch assembly changes.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

import numpy as np

from wrim_cpt2_identity import BOS_ID, EOS_ID, PAD_ID, REQUESTED_MIX
from wrim_cpt3_identity import (
    B1_MAX_TOKENS,
    B1_STEPS,
    CAPPED_FAMILIES,
    MAX_SAME_DOCUMENT_PER_BATCH,
    MICRO_BATCH,
    MIXED_MAX_PER_FAMILY,
    PACK_TARGET_TOKENS,
    PACKER_PREVIEW_STEPS,
    PACKER_PREVIOUS_VERSION,
    PACKER_VERSION,
    SEED,
    SEQ_LEN,
    TOKENS_PER_STEP,
)
from wrim_cpt_stage_b_corpus import family_budgets

FAMILIES: tuple[str, ...] = tuple(REQUESTED_MIX.keys())
SAFE_HOMO_FAMILIES: tuple[str, ...] = tuple(f for f in FAMILIES if f not in CAPPED_FAMILIES)


def pack_family_windows_tagged(docs: list[dict[str, Any]], budget: int, family: str) -> dict[str, Any]:
    """Family-local concat + 512 windows, each tagged with majority doc_id.

    Token content matches wrim_cpt_stage_b_corpus.pack_family_windows for the
    same docs/budget/family. Adds document identity required by the CPT-000003
    same-document cap. Does not rewrite corpus files.
    """
    import random

    if not docs or budget <= 0:
        return {"windows": [], "eos": 0, "cross_doc": 0, "pad": 0, "tokens": 0, "fill": 0.0, "content_tokens": 0, "unique_docs": 0}
    order = list(docs)
    rng = random.Random(SEED + sum(ord(c) for c in family))
    rng.shuffle(order)
    stream: list[int] = []
    stream_docs: list[str] = []
    cross_doc = 0
    i = 0
    while len(stream) < budget:
        rec = order[i % len(order)]
        ids = list(rec["token_ids"])
        doc_id = str(rec.get("doc_id") or rec.get("source_id") or f"{family}:unknown")
        if stream and ids and ids[0] == BOS_ID:
            cross_doc += 1
        stream.extend(ids)
        stream_docs.extend([doc_id] * len(ids))
        i += 1
        if i > max(8, len(order)) * 800:
            break
    if len(stream) < budget:
        return {
            "windows": [],
            "eos": 0,
            "cross_doc": 0,
            "pad": 0,
            "tokens": 0,
            "fill": 0.0,
            "content_tokens": 0,
            "short": True,
            "have": len(stream),
            "need": budget,
            "unique_docs": 0,
        }
    stream = stream[:budget]
    stream_docs = stream_docs[:budget]
    windows: list[dict[str, Any]] = []
    pad = 0
    for off in range(0, budget, SEQ_LEN):
        chunk = stream[off : off + SEQ_LEN]
        docs_chunk = stream_docs[off : off + SEQ_LEN]
        if len(chunk) < SEQ_LEN:
            pad += SEQ_LEN - len(chunk)
            chunk = chunk + [PAD_ID] * (SEQ_LEN - len(chunk))
            docs_chunk = docs_chunk + ["__pad__"] * (SEQ_LEN - len(docs_chunk))
        counts = Counter(d for d in docs_chunk if d != "__pad__")
        maj = counts.most_common(1)[0][0] if counts else "__pad__"
        windows.append(
            {
                "ids": chunk,
                "family": family,
                "doc_id": maj,
                "doc_ids": sorted({d for d in docs_chunk if d != "__pad__"}),
            }
        )
    total = len(windows) * SEQ_LEN
    eos_count = int(sum(1 for t in stream if t == EOS_ID))
    return {
        "windows": windows,
        "eos": eos_count,
        "cross_doc": cross_doc,
        "pad": pad,
        "tokens": total,
        "content_tokens": int(budget - pad),
        "fill": (total - pad) / total if total else 0.0,
        "unique_docs": len({w["doc_id"] for w in windows}),
        "doc_window_counts": dict(Counter(w["doc_id"] for w in windows)),
    }


def _family_cap(fam: str, mixed: bool) -> int:
    if fam in CAPPED_FAMILIES:
        return int(CAPPED_FAMILIES[fam])
    if mixed:
        return int(MIXED_MAX_PER_FAMILY)
    return int(MICRO_BATCH)


def _can_add(batch: list[dict[str, Any]], fam: str, doc_id: str, mixed: bool) -> bool:
    fam_count = sum(1 for x in batch if x["family"] == fam)
    if fam_count >= _family_cap(fam, mixed):
        return False
    doc_count = sum(1 for x in batch if x["doc_id"] == doc_id)
    if doc_count >= MAX_SAME_DOCUMENT_PER_BATCH:
        return False
    return True


def _take_window(
    fam: str,
    batch: list[dict[str, Any]],
    fam_windows: dict[str, list[dict[str, Any]]],
    cursor: dict[str, int],
    used_in_batch: set[tuple[str, int]],
    mixed: bool,
    prefer_other_doc: str | None = None,
) -> dict[str, Any] | None:
    ws = fam_windows.get(fam) or []
    n = len(ws)
    if n == 0:
        return None
    start = cursor[fam]
    fallback: tuple[int, dict[str, Any]] | None = None
    for k in range(n):
        i = (start + k) % n
        key = (fam, i)
        if key in used_in_batch:
            continue
        w = ws[i]
        if not _can_add(batch, fam, w["doc_id"], mixed):
            continue
        if prefer_other_doc is not None and w["doc_id"] == prefer_other_doc:
            if fallback is None:
                fallback = (i, w)
            continue
        used_in_batch.add(key)
        cursor[fam] = start + k + 1
        return w
    if fallback is not None:
        i, w = fallback
        used_in_batch.add((fam, i))
        cursor[fam] = i + 1
        return w
    return None


def _ranked_families(remaining: dict[str, int], rotate_from: int) -> list[str]:
    rotated = list(FAMILIES[rotate_from:] + FAMILIES[:rotate_from])
    return sorted(rotated, key=lambda f: (-int(remaining.get(f) or 0), rotated.index(f)))


def assemble_minibatches(
    fam_windows: dict[str, list[dict[str, Any]]],
    n_steps: int,
) -> dict[str, Any]:
    remaining = {f: len(fam_windows.get(f) or []) for f in FAMILIES}
    cursor = {f: 0 for f in FAMILIES}
    batches: list[dict[str, Any]] = []
    homo = 0
    mixed_n = 0
    mixed_families_seen: set[str] = set()

    def fill_mixed(rotate_from: int) -> list[dict[str, Any]] | None:
        batch: list[dict[str, Any]] = []
        used_in_batch: set[tuple[str, int]] = set()
        dedicated = FAMILIES[rotate_from % len(FAMILIES)]
        prefer = None
        w = _take_window(dedicated, batch, fam_windows, cursor, used_in_batch, mixed=True)
        if w is not None:
            batch.append(w)
            remaining[dedicated] = max(0, remaining[dedicated] - 1)
            prefer = w["doc_id"] if dedicated == "genesis_rehearsal" else None
        while len(batch) < MICRO_BATCH:
            placed = False
            for fam in _ranked_families(remaining, rotate_from):
                pref = prefer if fam == "genesis_rehearsal" else None
                got = _take_window(fam, batch, fam_windows, cursor, used_in_batch, mixed=True, prefer_other_doc=pref)
                if got is None:
                    continue
                batch.append(got)
                remaining[fam] = max(0, remaining[fam] - 1)
                placed = True
                break
            if not placed:
                for fam in FAMILIES[rotate_from:] + FAMILIES[:rotate_from]:
                    got = _take_window(fam, batch, fam_windows, cursor, used_in_batch, mixed=True)
                    if got is None:
                        continue
                    batch.append(got)
                    remaining[fam] = max(0, remaining[fam] - 1)
                    placed = True
                    break
            if not placed:
                return None
        return batch

    mixed_idx = 0
    for step in range(n_steps):
        batch: list[dict[str, Any]] | None = None
        kind = "mixed"
        if step % 2 == 0:
            candidates = sorted(
                [f for f in SAFE_HOMO_FAMILIES if remaining.get(f, 0) >= MICRO_BATCH and (fam_windows.get(f) or [])],
                key=lambda f: (-int(remaining.get(f) or 0), SAFE_HOMO_FAMILIES.index(f)),
            )
            saved_cursor = dict(cursor)
            saved_remaining = dict(remaining)
            for fam in candidates:
                cursor = dict(saved_cursor)
                remaining = dict(saved_remaining)
                trial: list[dict[str, Any]] = []
                used_in_batch: set[tuple[str, int]] = set()
                ok = True
                for _ in range(MICRO_BATCH):
                    got = _take_window(fam, trial, fam_windows, cursor, used_in_batch, mixed=False)
                    if got is None:
                        ok = False
                        break
                    trial.append(got)
                if ok and len(trial) == MICRO_BATCH:
                    batch = trial
                    remaining[fam] = max(0, remaining[fam] - MICRO_BATCH)
                    kind = "homogeneous_safe"
                    homo += 1
                    saved_cursor = dict(cursor)
                    saved_remaining = dict(remaining)
                    break
            cursor = dict(saved_cursor)
            remaining = dict(saved_remaining)
        if batch is None:
            batch = fill_mixed(mixed_idx)
            mixed_idx += 1
            kind = "mixed"
            mixed_n += 1
            if batch is None:
                return {"ok": False, "reason": "incomplete_minibatch", "step": step, "have": 0}
        if len(batch) != MICRO_BATCH:
            return {"ok": False, "reason": "incomplete_minibatch", "step": step, "have": len(batch)}
        labels = [w["family"] for w in batch]
        docs = [w["doc_id"] for w in batch]
        fam_counts = dict(Counter(labels))
        doc_counts = dict(Counter(docs))
        if kind == "mixed":
            mixed_families_seen.update(labels)
        batches.append(
            {
                "step_index": step,
                "kind": kind,
                "families": labels,
                "doc_ids": docs,
                "family_counts": fam_counts,
                "document_counts": doc_counts,
                "n_unique_docs": len(doc_counts),
                "max_same_document": max(doc_counts.values()) if doc_counts else 0,
                "genesis": int(fam_counts.get("genesis_rehearsal") or 0),
                "json": int(fam_counts.get("structured_json") or 0),
                "role": int(fam_counts.get("role_boundary_rehearsal") or 0),
                "technical": int(fam_counts.get("technical_explanation_non_repo") or 0),
                "eos_count": int(sum(ids == EOS_ID for w in batch for ids in w["ids"])),
                "windows": batch,
            }
        )
    return {
        "ok": True,
        "batches": batches,
        "homogeneous_minibatches": homo,
        "mixed_minibatches": mixed_n,
        "homogeneous_fraction": homo / n_steps if n_steps else 0.0,
        "mixed_families_seen": sorted(mixed_families_seen),
    }


def validate_batches(batches: list[dict[str, Any]]) -> dict[str, Any]:
    failures: list[str] = []
    mixed_fams: set[str] = set()
    max_genesis = 0
    max_json = 0
    max_role = 0
    max_tech = 0
    max_same_doc = 0
    eight_eight = []
    family_counts_per_batch = []
    document_counts_per_batch = []
    for i, b in enumerate(batches):
        fc = dict(b.get("family_counts") or Counter(b["families"]))
        dc = dict(b.get("document_counts") or Counter(b["doc_ids"]))
        family_counts_per_batch.append(fc)
        document_counts_per_batch.append(dc)
        g = int(fc.get("genesis_rehearsal") or 0)
        j = int(fc.get("structured_json") or 0)
        r = int(fc.get("role_boundary_rehearsal") or 0)
        t = int(fc.get("technical_explanation_non_repo") or 0)
        same = max(dc.values()) if dc else 0
        max_genesis = max(max_genesis, g)
        max_json = max(max_json, j)
        max_role = max(max_role, r)
        max_tech = max(max_tech, t)
        max_same_doc = max(max_same_doc, same)
        if b.get("kind") == "mixed":
            mixed_fams.update(b["families"])
            for fam, c in fc.items():
                if int(c) >= MICRO_BATCH:
                    failures.append(f"batch {i}: mixed 8/8 {fam}")
                    eight_eight.append({"batch": i, "family": fam, "kind": "mixed"})
        if g >= MICRO_BATCH:
            failures.append(f"batch {i}: 8/8 genesis")
            eight_eight.append({"batch": i, "family": "genesis_rehearsal"})
        if j >= MICRO_BATCH:
            failures.append(f"batch {i}: 8/8 json")
        if r >= MICRO_BATCH:
            failures.append(f"batch {i}: 8/8 role")
        if g > CAPPED_FAMILIES["genesis_rehearsal"]:
            failures.append(f"batch {i}: genesis {g} > 2")
        if j > CAPPED_FAMILIES["structured_json"]:
            failures.append(f"batch {i}: json {j} > 2")
        if r > CAPPED_FAMILIES["role_boundary_rehearsal"]:
            failures.append(f"batch {i}: role {r} > 2")
        if t > CAPPED_FAMILIES["technical_explanation_non_repo"]:
            failures.append(f"batch {i}: technical {t} > 2")
        if same >= MICRO_BATCH:
            failures.append(f"batch {i}: 8/8 single-document {max(dc, key=dc.get)}")
        if same > MAX_SAME_DOCUMENT_PER_BATCH:
            failures.append(f"batch {i}: same-document {same} > {MAX_SAME_DOCUMENT_PER_BATCH}")
        if len(b["families"]) != MICRO_BATCH:
            failures.append(f"batch {i}: width {len(b['families'])} != 8")
    all12 = set(FAMILIES).issubset(mixed_fams)
    if not all12:
        missing = [f for f in FAMILIES if f not in mixed_fams]
        failures.append(f"mixed batches missing families: {missing}")
    return {
        "ok": not failures,
        "failures": failures,
        "ALL_12_FAMILIES_MIXED": all12,
        "MIXED_FAMILIES_SEEN": sorted(mixed_fams),
        "MAX_GENESIS_PER_BATCH": max_genesis,
        "MAX_JSON_PER_BATCH": max_json,
        "MAX_ROLE_PER_BATCH": max_role,
        "MAX_TECHNICAL_PER_BATCH": max_tech,
        "MAX_SAME_DOCUMENT_PER_BATCH": max_same_doc,
        "NO_8_8_GENESIS": max_genesis < MICRO_BATCH,
        "NO_8_8_JSON": max_json < MICRO_BATCH,
        "NO_8_8_ROLE": max_role < MICRO_BATCH,
        "NO_8_8_SINGLE_DOCUMENT": max_same_doc < MICRO_BATCH,
        "FAMILY_COUNTS_PER_BATCH": family_counts_per_batch,
        "DOCUMENT_COUNTS_PER_BATCH": document_counts_per_batch,
        "eight_eight_events": eight_eight,
        "n_batches": len(batches),
    }


def materialize_cpt000003_stream(train: list[dict[str, Any]], n_steps: int) -> dict[str, Any]:
    n_tokens = n_steps * TOKENS_PER_STEP
    budgets = family_budgets(n_tokens, REQUESTED_MIX)
    by: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for rec in train:
        by[str(rec["category"])].append(rec)
    family_packs: dict[str, Any] = {}
    missing: list[str] = []
    fam_windows: dict[str, list[dict[str, Any]]] = {}
    unique_docs: dict[str, int] = {}
    for fam in FAMILIES:
        rows = by.get(fam) or []
        bud = int(budgets.get(fam) or 0)
        if not rows or bud <= 0:
            missing.append(fam)
            family_packs[fam] = {"windows": [], "short": True}
            fam_windows[fam] = []
            unique_docs[fam] = 0
            continue
        packed = pack_family_windows_tagged(rows, bud, fam)
        family_packs[fam] = {k: v for k, v in packed.items() if k != "windows"}
        family_packs[fam]["n_windows"] = len(packed.get("windows") or [])
        if packed.get("short"):
            missing.append(fam)
        fam_windows[fam] = list(packed.get("windows") or [])
        unique_docs[fam] = int(packed.get("unique_docs") or 0)
    assembled = assemble_minibatches(fam_windows, n_steps)
    if not assembled.get("ok"):
        return {"ok": False, "reason": assembled.get("reason"), "step": assembled.get("step"), "missing_families": missing, "unique_docs": unique_docs}
    batches = assembled["batches"]
    validation = validate_batches(batches)
    stream_ids: list[int] = []
    for b in batches:
        for w in b["windows"]:
            stream_ids.extend(w["ids"])
    if len(stream_ids) != n_tokens:
        return {
            "ok": False,
            "reason": "packed_len_mismatch",
            "have": len(stream_ids),
            "need": n_tokens,
            "validation": validation,
            "missing_families": missing,
        }
    extra = stream_ids[0] if stream_ids else EOS_ID
    stream_ids.append(int(extra))
    target = n_tokens + 1
    if n_steps == B1_STEPS and target != PACK_TARGET_TOKENS:
        return {"ok": False, "reason": "pack_target_mismatch", "have": target, "need": PACK_TARGET_TOKENS}
    actual_tokens = {f: int(family_packs[f].get("content_tokens") or 0) for f in FAMILIES}
    tot = sum(actual_tokens.values()) or 1
    actual_share = {f: actual_tokens[f] / tot for f in FAMILIES}
    # rare-token rate vs this packed stream (exclude the extra label token)
    counts = Counter(stream_ids[:-1])
    rare = {tid for tid, c in counts.items() if c <= 2}
    meta_out = []
    for b in batches:
        ids = [t for w in b["windows"] for t in w["ids"]]
        rare_n = sum(1 for t in ids if t in rare)
        role_n = sum(1 for t in ids if t in {4, 5, 6})
        meta_out.append(
            {
                "step_index": b["step_index"],
                "kind": b["kind"],
                "families": b["families"],
                "doc_ids": b["doc_ids"],
                "family_counts": b["family_counts"],
                "document_counts": b["document_counts"],
                "n_unique_docs": b["n_unique_docs"],
                "max_same_document": b["max_same_document"],
                "genesis": b["genesis"],
                "json": b["json"],
                "role": b["role"],
                "technical": b["technical"],
                "eos_count": b["eos_count"],
                "rare_token_rate": rare_n / max(1, len(ids)),
                "role_token_count": role_n,
                "token_count": len(ids),
            }
        )
    stream = np.asarray(stream_ids, dtype=np.int32)
    pad = sum(int(family_packs[f].get("pad") or 0) for f in FAMILIES)
    eos = sum(int(family_packs[f].get("eos") or 0) for f in FAMILIES)
    return {
        "ok": bool(validation.get("ok")) and not missing,
        "reason": None if (validation.get("ok") and not missing) else ("validation_fail" if not validation.get("ok") else "missing_families"),
        "missing_families": missing,
        "budgets": budgets,
        "actual_tokens": actual_tokens,
        "actual_share": actual_share,
        "eos_count": eos,
        "eos_density": eos / tot if tot else 0.0,
        "padding_rate": pad / max(1, n_tokens),
        "packer_version": PACKER_VERSION,
        "packer_previous_version": PACKER_PREVIOUS_VERSION,
        "seq_len": SEQ_LEN,
        "micro_batch": MICRO_BATCH,
        "steps": n_steps,
        "tokens_per_step": TOKENS_PER_STEP,
        "packed_tokens": int(stream.size) - 1,
        "stream_len": int(stream.size),
        "homogeneous_minibatches": assembled["homogeneous_minibatches"],
        "mixed_minibatches": assembled["mixed_minibatches"],
        "homogeneous_fraction": assembled["homogeneous_fraction"],
        "unique_docs_per_family": unique_docs,
        "validation": validation,
        "batch_meta": meta_out,
        "_stream": stream,
        "_batches": batches,
    }


def preview_and_train_pack(train: list[dict[str, Any]]) -> dict[str, Any]:
    """Validate ≥100 minibatches, then build the 50-step training stream."""
    preview = materialize_cpt000003_stream(train, PACKER_PREVIEW_STEPS)
    preview_val = preview.get("validation") or {"ok": False, "failures": ["preview_pack_failed"]}
    train_pack = materialize_cpt000003_stream(train, B1_STEPS)
    train_val = train_pack.get("validation") or {"ok": False, "failures": ["train_pack_failed"]}
    ok = bool(preview.get("ok") and train_pack.get("ok") and preview_val.get("ok") and train_val.get("ok"))
    failures = list(preview_val.get("failures") or []) + [f"train:{x}" for x in (train_val.get("failures") or [])]
    if preview.get("missing_families"):
        failures.append(f"preview missing families: {preview.get('missing_families')}")
    if train_pack.get("missing_families"):
        failures.append(f"train missing families: {train_pack.get('missing_families')}")
    return {
        "ok": ok,
        "failures": failures,
        "preview": {k: v for k, v in preview.items() if not str(k).startswith("_")},
        "train": train_pack,
        "PACKER_VALIDATION": "PASS" if ok else "FAIL",
        "ALL_12_FAMILIES_MIXED": bool(preview_val.get("ALL_12_FAMILIES_MIXED") and train_val.get("ALL_12_FAMILIES_MIXED")),
        "MAX_GENESIS_PER_BATCH": max(int(preview_val.get("MAX_GENESIS_PER_BATCH") or 0), int(train_val.get("MAX_GENESIS_PER_BATCH") or 0)),
        "MAX_JSON_PER_BATCH": max(int(preview_val.get("MAX_JSON_PER_BATCH") or 0), int(train_val.get("MAX_JSON_PER_BATCH") or 0)),
        "MAX_ROLE_PER_BATCH": max(int(preview_val.get("MAX_ROLE_PER_BATCH") or 0), int(train_val.get("MAX_ROLE_PER_BATCH") or 0)),
        "MAX_TECHNICAL_PER_BATCH": max(int(preview_val.get("MAX_TECHNICAL_PER_BATCH") or 0), int(train_val.get("MAX_TECHNICAL_PER_BATCH") or 0)),
        "MAX_SAME_DOCUMENT_PER_BATCH": max(int(preview_val.get("MAX_SAME_DOCUMENT_PER_BATCH") or 0), int(train_val.get("MAX_SAME_DOCUMENT_PER_BATCH") or 0)),
        "PREVIEW_STEPS": PACKER_PREVIEW_STEPS,
        "TRAIN_STEPS": B1_STEPS,
        "FAMILY_COUNTS_PER_BATCH": preview_val.get("FAMILY_COUNTS_PER_BATCH"),
        "DOCUMENT_COUNTS_PER_BATCH": preview_val.get("DOCUMENT_COUNTS_PER_BATCH"),
    }
