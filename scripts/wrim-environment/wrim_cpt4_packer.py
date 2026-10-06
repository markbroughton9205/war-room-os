"""CPT-000004 runtime role-slot placement.

Uses the frozen CPT-000003 packer (hash 2d4e71ca…) then swaps the four
role-boundary windows onto earlier uniform training steps. Corpus bytes and
family token totals are unchanged.
"""
from __future__ import annotations

from collections import Counter
from typing import Any

import numpy as np

from wrim_cpt3_identity import PACKER_VERSION as PACKER_FIX_VERSION
from wrim_cpt3_packer import (
    CAPPED_FAMILIES,
    EOS_ID,
    FAMILIES,
    MICRO_BATCH,
    materialize_cpt000003_stream,
    validate_batches,
)
from wrim_cpt4_identity import (
    B1_STEPS,
    PACK_TARGET_TOKENS,
    PACKER_FIX_HASH,
    ROLE_TARGET_STEPS,
    ROLE_WINDOWS_TOTAL,
    SEQ_LEN,
    TOKENS_PER_STEP,
)

ROLE_FAM = "role_boundary_rehearsal"


def _recompute_batch(b: dict[str, Any]) -> dict[str, Any]:
    windows = list(b["windows"])
    labels = [w["family"] for w in windows]
    docs = [w["doc_id"] for w in windows]
    fc = dict(Counter(labels))
    dc = dict(Counter(docs))
    kind = b.get("kind") or "mixed"
    if ROLE_FAM in fc or len(set(labels)) > 1:
        kind = "mixed"
    elif len(set(labels)) == 1 and labels[0] not in CAPPED_FAMILIES:
        kind = "homogeneous_safe"
    b.update(
        {
            "kind": kind,
            "families": labels,
            "doc_ids": docs,
            "family_counts": fc,
            "document_counts": dc,
            "n_unique_docs": len(dc),
            "max_same_document": max(dc.values()) if dc else 0,
            "genesis": int(fc.get("genesis_rehearsal") or 0),
            "json": int(fc.get("structured_json") or 0),
            "role": int(fc.get("role_boundary_rehearsal") or 0),
            "technical": int(fc.get("technical_explanation_non_repo") or 0),
            "eos_count": int(sum(tid == EOS_ID for w in windows for tid in w["ids"])),
        }
    )
    return b


def _caps_ok(windows: list[dict[str, Any]]) -> bool:
    labels = [w["family"] for w in windows]
    docs = [w["doc_id"] for w in windows]
    fc = Counter(labels)
    dc = Counter(docs)
    if any(fc[f] > CAPPED_FAMILIES[f] for f in CAPPED_FAMILIES):
        return False
    if max(dc.values()) > 2:
        return False
    if len(windows) != MICRO_BATCH:
        return False
    n_unique = len(set(labels))
    if n_unique > 1 and any(v >= MICRO_BATCH for v in fc.values()):
        return False
    return True


def _pick_outgoing(target_windows: list[dict[str, Any]], source_windows: list[dict[str, Any]]) -> int | None:
    src_without_role = [w for w in source_windows if w["family"] != ROLE_FAM]
    src_fc = Counter(w["family"] for w in src_without_role)
    src_dc = Counter(w["doc_id"] for w in src_without_role)
    candidates = []
    for i, w in enumerate(target_windows):
        if w["family"] == ROLE_FAM:
            continue
        fam = w["family"]
        if src_fc[fam] + 1 >= MICRO_BATCH and len(set([x["family"] for x in src_without_role] + [fam])) > 1:
            continue
        if fam in CAPPED_FAMILIES and src_fc[fam] + 1 > CAPPED_FAMILIES[fam]:
            continue
        if src_dc[w["doc_id"]] + 1 > 2:
            continue
        # prefer swapping a safe family that already has copies in the target
        tgt_fc = Counter(x["family"] for x in target_windows)
        score = (0 if fam not in CAPPED_FAMILIES else 1, -tgt_fc[fam], i)
        candidates.append((score, i))
    if not candidates:
        return None
    candidates.sort()
    return candidates[0][1]


def redistribute_role_windows(batches: list[dict[str, Any]]) -> dict[str, Any]:
    batches = [dict(b, windows=list(b["windows"])) for b in batches]
    role_locs: list[tuple[int, int]] = []
    for bi, b in enumerate(batches):
        for si, w in enumerate(b["windows"]):
            if w["family"] == ROLE_FAM:
                role_locs.append((bi, si))
    if len(role_locs) != ROLE_WINDOWS_TOTAL:
        return {"ok": False, "reason": "role_window_count", "have": len(role_locs), "need": ROLE_WINDOWS_TOTAL}
    targets = [s - 1 for s in ROLE_TARGET_STEPS]
    if any(t < 0 or t >= len(batches) for t in targets):
        return {"ok": False, "reason": "role_target_oob", "targets": targets, "n": len(batches)}
    target_set = set(targets)
    remaining_roles = [(bi, si) for bi, si in role_locs if bi not in target_set]
    remaining_targets = [t for t in targets if t not in {bi for bi, _si in role_locs if bi in target_set}]
    if len(remaining_roles) != len(remaining_targets):
        return {
            "ok": False,
            "reason": "role_target_mismatch",
            "remaining_roles": remaining_roles,
            "remaining_targets": [t + 1 for t in remaining_targets],
            "have_role_steps": [bi + 1 for bi, _ in role_locs],
        }
    swaps = []
    for (src_b, src_s), tgt in zip(remaining_roles, remaining_targets):
        out_i = _pick_outgoing(batches[tgt]["windows"], batches[src_b]["windows"])
        if out_i is None:
            return {"ok": False, "reason": "no_swap_slot", "src": src_b + 1, "tgt": tgt + 1}
        role_w = batches[src_b]["windows"][src_s]
        other_w = batches[tgt]["windows"][out_i]
        trial_tgt = list(batches[tgt]["windows"])
        trial_src = list(batches[src_b]["windows"])
        trial_tgt[out_i] = role_w
        trial_src[src_s] = other_w
        if not _caps_ok(trial_tgt) or not _caps_ok(trial_src):
            return {"ok": False, "reason": "swap_caps", "src": src_b + 1, "tgt": tgt + 1}
        batches[tgt]["windows"] = trial_tgt
        batches[src_b]["windows"] = trial_src
        swaps.append({"from_step": src_b + 1, "to_step": tgt + 1, "outgoing_family": other_w["family"]})
    for b in batches:
        _recompute_batch(b)
    role_steps = [int(b["step_index"]) + 1 for b in batches if int(b.get("role") or 0) > 0]
    n_role_windows = sum(int(b.get("role") or 0) for b in batches)
    first = min(role_steps) if role_steps else None
    last = max(role_steps) if role_steps else None
    clustered_tail = bool(role_steps) and sum(1 for s in role_steps if s >= 46) >= 2
    failures = []
    if n_role_windows != ROLE_WINDOWS_TOTAL:
        failures.append(f"ROLE_WINDOWS_TOTAL {n_role_windows} != 4")
    if first is None or first > 10:
        failures.append(f"ROLE_FIRST_EXPOSURE {first} > 10")
    if last is None or last > 45:
        failures.append(f"ROLE_LAST_EXPOSURE {last} > 45")
    if clustered_tail:
        failures.append("END_OF_RUN_ROLE_DUMP")
    val = validate_batches(batches)
    if not val.get("ok"):
        failures.extend(list(val.get("failures") or []))
    return {
        "ok": not failures,
        "failures": failures,
        "batches": batches,
        "swaps": swaps,
        "ROLE_WINDOW_STEPS": role_steps,
        "ROLE_WINDOWS_TOTAL": n_role_windows,
        "ROLE_FIRST_EXPOSURE": first,
        "ROLE_LAST_EXPOSURE": last,
        "NO_END_OF_RUN_ROLE_DUMP": not clustered_tail,
        "validation": val,
    }


def _rebuild_stream(batches: list[dict[str, Any]], base: dict[str, Any]) -> dict[str, Any]:
    stream_ids: list[int] = []
    for b in batches:
        for w in b["windows"]:
            stream_ids.extend(w["ids"])
    n_tokens = B1_STEPS * TOKENS_PER_STEP
    if len(stream_ids) != n_tokens:
        return {"ok": False, "reason": "packed_len_mismatch", "have": len(stream_ids), "need": n_tokens}
    extra = stream_ids[0] if stream_ids else EOS_ID
    stream_ids.append(int(extra))
    if len(stream_ids) != PACK_TARGET_TOKENS:
        return {"ok": False, "reason": "pack_target_mismatch", "have": len(stream_ids), "need": PACK_TARGET_TOKENS}
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
    out = dict(base)
    out.update(
        {
            "ok": True,
            "batch_meta": meta_out,
            "_stream": np.asarray(stream_ids, dtype=np.int32),
            "_batches": batches,
            "packer_version": "cpt2-v2-all12-capped-highgrad-docdiv-role-spread",
            "packer_fix_version": PACKER_FIX_VERSION,
            "packer_fix_hash_expected": PACKER_FIX_HASH,
            "role_schedule": list(ROLE_TARGET_STEPS),
        }
    )
    return out


def preview_and_train_pack_cpt4(train: list[dict[str, Any]]) -> dict[str, Any]:
    from wrim_cpt3_packer import preview_and_train_pack

    base_preview = preview_and_train_pack(train)
    train_pack = base_preview.get("train") or {}
    batches = train_pack.get("_batches")
    if not batches:
        return {
            "ok": False,
            "PACKER_VALIDATION": "FAIL",
            "ROLE_PLACEMENT_VALIDATION": "FAIL",
            "failures": ["missing_base_batches"],
            "base": {k: v for k, v in base_preview.items() if k not in {"train"}},
        }
    placed = redistribute_role_windows(batches)
    rebuilt = _rebuild_stream(placed.get("batches") or [], {k: v for k, v in train_pack.items() if not str(k).startswith("_")}) if placed.get("ok") else {"ok": False}
    if placed.get("ok") and rebuilt.get("ok"):
        rebuilt["validation"] = placed.get("validation")
        rebuilt["role_placement"] = {k: v for k, v in placed.items() if k != "batches"}
    fam_totals_before = Counter()
    fam_totals_after = Counter()
    for b in batches:
        fam_totals_before.update(b.get("families") or [])
    for b in placed.get("batches") or []:
        fam_totals_after.update(b.get("families") or [])
    share_ok = dict(fam_totals_before) == dict(fam_totals_after)
    ok = bool(base_preview.get("ok") and placed.get("ok") and rebuilt.get("ok") and share_ok)
    failures = list(base_preview.get("failures") or []) + list(placed.get("failures") or [])
    if not share_ok:
        failures.append(f"family_totals_changed {dict(fam_totals_before)} -> {dict(fam_totals_after)}")
    val = placed.get("validation") or {}
    return {
        "ok": ok,
        "failures": failures,
        "PACKER_VALIDATION": "PASS" if ok else "FAIL",
        "ROLE_PLACEMENT_VALIDATION": "PASS" if placed.get("ok") else "FAIL",
        "ROLE_WINDOW_STEPS": placed.get("ROLE_WINDOW_STEPS"),
        "ROLE_WINDOWS_TOTAL": placed.get("ROLE_WINDOWS_TOTAL"),
        "ROLE_FIRST_EXPOSURE": placed.get("ROLE_FIRST_EXPOSURE"),
        "ROLE_LAST_EXPOSURE": placed.get("ROLE_LAST_EXPOSURE"),
        "NO_END_OF_RUN_ROLE_DUMP": placed.get("NO_END_OF_RUN_ROLE_DUMP"),
        "ALL_12_FAMILIES_MIXED": val.get("ALL_12_FAMILIES_MIXED"),
        "MAX_GENESIS_PER_BATCH": val.get("MAX_GENESIS_PER_BATCH"),
        "MAX_JSON_PER_BATCH": val.get("MAX_JSON_PER_BATCH"),
        "MAX_ROLE_PER_BATCH": val.get("MAX_ROLE_PER_BATCH"),
        "MAX_TECHNICAL_PER_BATCH": val.get("MAX_TECHNICAL_PER_BATCH"),
        "MAX_SAME_DOCUMENT_PER_BATCH": val.get("MAX_SAME_DOCUMENT_PER_BATCH"),
        "FAMILY_COUNTS_PER_BATCH": val.get("FAMILY_COUNTS_PER_BATCH"),
        "DOCUMENT_COUNTS_PER_BATCH": val.get("DOCUMENT_COUNTS_PER_BATCH"),
        "swaps": placed.get("swaps"),
        "family_totals_preserved": share_ok,
        "cpt3_preview_ok": bool(base_preview.get("ok")),
        "PREVIEW_STEPS": 50,
        "TRAIN_STEPS": B1_STEPS,
        "train": rebuilt if rebuilt.get("ok") else train_pack,
        "preview": {k: v for k, v in (base_preview.get("preview") or {}).items() if not str(k).startswith("_")},
    }
