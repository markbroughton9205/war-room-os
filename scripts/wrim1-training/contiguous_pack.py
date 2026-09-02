"""TEST_ONLY contiguous packing for WRIM-1.1 recovery. Not official lineage."""
from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from tokenizers import Tokenizer

from dataset_cursor import concatenate_units, permute_unit_order


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


def bucket_for_record(rec: dict) -> str:
    kind = rec.get("kind") or "chunk"
    fmt = rec.get("format") or ""
    path = str(rec.get("source_path") or rec.get("path") or "")
    tags = rec.get("capability_tags") or rec.get("capabilityTags") or []
    if kind == "behavior_example" or fmt == "instruction_response":
        return "behavior"
    if fmt in ("code",) or path.endswith((".ts", ".tsx", ".js", ".mjs", ".cjs", ".py")):
        return "code"
    if "json" in fmt or path.endswith(".json"):
        return "json"
    if fmt in ("language_modeling", "language") or path.endswith((".md", ".txt")):
        return "prose"
    if any(t in ("code",) for t in tags) and path.endswith((".ts", ".tsx")):
        return "code"
    return "other"


def text_of(rec: dict) -> str:
    if isinstance(rec.get("text"), str):
        return rec["text"]
    if isinstance(rec.get("renderedTrainingText"), str):
        return rec["renderedTrainingText"]
    return ""


def is_eval_infra_text(text: str, path: str = "") -> bool:
    blob = text
    low_path = path.lower()
    if any(m in low_path for m in EVAL_INFRA_PATH_MARKERS):
        return True
    if any(m in blob for m in EVAL_INFRA_MARKERS):
        return True
    for prompt in HELD_OUT_PROMPT_STRINGS:
        if prompt and prompt in blob:
            return True
    return False


def leak_hits(text: str) -> list[str]:
    hits = []
    for prompt in HELD_OUT_PROMPT_STRINGS:
        if prompt and prompt in text:
            hits.append(prompt[:48])
    return hits


@dataclass
class PackedUnit:
    unit_id: str
    bucket: str
    origin: str
    tokens: np.ndarray
    loss_mask: np.ndarray
    source_path: str = ""
    n_eos: int = 0
    truncated: bool = False


def truncate_unit_to_budget(unit: PackedUnit, budget: int, eos_id: int) -> PackedUnit | None:
    """Contiguous prefix only. Never permutes tokens. Ends on EOS."""
    if budget < 4:
        return None
    n = min(int(unit.tokens.size), int(budget))
    prefix = np.array(unit.tokens[:n], dtype=np.int32)
    if prefix.size < 3:
        return None
    if int(prefix[-1]) != int(eos_id):
        prefix = np.concatenate([prefix[:-1], np.array([eos_id], dtype=np.int32)])
    mask_src = np.asarray(unit.loss_mask)
    if mask_src.size >= prefix.size:
        mask = np.array(mask_src[: prefix.size], dtype=np.uint8)
    else:
        mask = np.ones(prefix.size, dtype=np.uint8)
    mask[-1] = 1
    return PackedUnit(
        unit_id=f"{unit.unit_id}:prefix{prefix.size}",
        bucket=unit.bucket,
        origin=unit.origin,
        tokens=prefix,
        loss_mask=mask,
        source_path=unit.source_path,
        n_eos=int(np.count_nonzero(prefix == eos_id)),
        truncated=True,
    )


def take_units_token_capped(
    pool: list[PackedUnit],
    token_budget: int,
    eos_id: int,
    *,
    rng: np.random.Generator | None = None,
    deterministic: bool = False,
) -> list[PackedUnit]:
    """Select units without exceeding token_budget. Truncate the last unit contiguously if needed."""
    if token_budget <= 0 or not pool:
        return []
    if deterministic:
        ordered = sorted(pool, key=lambda u: str(u.unit_id))
    else:
        if rng is None:
            raise ValueError("rng required unless deterministic")
        order = rng.permutation(len(pool))
        ordered = [pool[int(i)] for i in order]
    out: list[PackedUnit] = []
    used = 0
    for u in ordered:
        remaining = token_budget - used
        if remaining <= 0:
            break
        n = int(u.tokens.size)
        if n <= remaining:
            out.append(u)
            used += n
            continue
        capped = truncate_unit_to_budget(u, remaining, eos_id)
        if capped is not None:
            out.append(capped)
            used += int(capped.tokens.size)
        break
    return out


def wrap_lm_tokens(body: list[int], bos_id: int, eos_id: int) -> tuple[list[int], list[int]]:
    ids = [bos_id, *body, eos_id]
    mask = [1] * len(ids)
    return ids, mask


def wrap_behavior_tokens(ids: list[int], assistant_id: int) -> tuple[list[int], list[int]]:
    """Causal loss on response tokens only. Prompt/context targets are masked."""
    mask = [0] * len(ids)
    try:
        apos = ids.index(assistant_id)
    except ValueError:
        return ids, [1] * len(ids)
    for i in range(len(ids)):
        target_index = i
        if target_index > apos:
            mask[i] = 1
    return ids, mask


def encode_lm_document(tokenizer: Tokenizer, text: str, bos_id: int, eos_id: int) -> PackedUnit | None:
    body = tokenizer.encode(text).ids
    if not body:
        return None
    ids, mask = wrap_lm_tokens(body, bos_id, eos_id)
    return PackedUnit(
        unit_id="",
        bucket="prose",
        origin="lm",
        tokens=np.array(ids, dtype=np.int32),
        loss_mask=np.array(mask, dtype=np.uint8),
        n_eos=1,
    )


def group_chunks_into_source_runs(records: Iterable[dict]) -> list[list[dict]]:
    by_source: dict[str, list[dict]] = defaultdict(list)
    for rec in records:
        if rec.get("kind") == "behavior_example":
            continue
        key = str(rec.get("source_lineage") or rec.get("source_path") or rec.get("chunk_id") or rec.get("id"))
        by_source[key].append(rec)
    runs: list[list[dict]] = []
    for _key, items in by_source.items():
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


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def _select_units_recovery_002(
    *,
    rehearsal_units: list[PackedUnit],
    behavior_units: list[PackedUnit],
    remaining_pools: dict[str, list[PackedUnit]],
    rehearsal_budget: int,
    target_tokens: int,
    remainder: int,
    eos_id: int,
    rng: np.random.Generator,
) -> list[PackedUnit]:
    """RECOVERY-002 leftover fill (prose-first). Default path — do not change 002."""
    desired = {
        "prose": int(remainder * 0.40),
        "code": min(int(remainder * 0.30), int(target_tokens * 0.2239)),
        "json": int(remainder * 0.10),
        "other": int(remainder * 0.05),
    }
    selected: list[PackedUnit] = []
    selected.extend(take_units_token_capped(
        rehearsal_units, rehearsal_budget, eos_id, deterministic=True,
    ))
    selected.extend(behavior_units)
    for bucket, budget in desired.items():
        selected.extend(take_units_token_capped(
            remaining_pools[bucket], budget, eos_id, rng=rng, deterministic=False,
        ))
    used_ids = {id(u) for u in selected}
    filled = int(sum(u.tokens.size for u in selected))
    leftover_budget = target_tokens - filled
    leftover_order = ["prose", "json", "other", "code"]
    code_cap = int(target_tokens * 0.2239)
    code_used = int(sum(u.tokens.size for u in selected if u.bucket == "code"))
    for bucket in leftover_order:
        if leftover_budget <= 0:
            break
        pool = [u for u in remaining_pools[bucket] if id(u) not in used_ids]
        budget = leftover_budget
        if bucket == "code":
            budget = min(budget, max(0, code_cap - code_used))
        taken = take_units_token_capped(pool, budget, eos_id, rng=rng, deterministic=False)
        selected.extend(taken)
        used_ids.update(id(u) for u in taken)
        added = int(sum(u.tokens.size for u in taken))
        leftover_budget -= added
        if bucket == "code":
            code_used += added
    return selected


def _select_units_recovery_003_balanced(
    *,
    rehearsal_units: list[PackedUnit],
    behavior_units: list[PackedUnit],
    remaining_pools: dict[str, list[PackedUnit]],
    rehearsal_budget: int,
    target_tokens: int,
    eos_id: int,
    rng: np.random.Generator,
) -> tuple[list[PackedUnit], dict[str, Any]]:
    """RECOVERY-003: 15% rehearsal, leftover split toward ~35/35/10 prose/code/json.

    Never dump leftover into prose. Never exceed 45% prose or 45% code.
    Behavior uses all clean examples (cannot fabricate a 5% share).
    """
    selected: list[PackedUnit] = []
    selected.extend(take_units_token_capped(
        rehearsal_units, rehearsal_budget, eos_id, deterministic=True,
    ))
    selected.extend(behavior_units)
    used_ids = {id(u) for u in selected}

    desired_total = {
        "prose": int(target_tokens * 0.35),
        "code": int(target_tokens * 0.35),
        "json": int(target_tokens * 0.10),
    }
    prose_cap = int(target_tokens * 0.45)
    code_cap = int(target_tokens * 0.45)

    for bucket, budget in desired_total.items():
        pool = [u for u in remaining_pools.get(bucket, []) if id(u) not in used_ids]
        taken = take_units_token_capped(pool, budget, eos_id, rng=rng, deterministic=False)
        selected.extend(taken)
        used_ids.update(id(u) for u in taken)

    filled = int(sum(u.tokens.size for u in selected))
    leftover_budget = target_tokens - filled
    leftover_order = ["json", "code", "prose"]
    leftover_added = 0
    for bucket in leftover_order:
        if leftover_budget <= 0:
            break
        used = int(sum(u.tokens.size for u in selected if u.bucket == bucket))
        if bucket == "prose":
            room = max(0, prose_cap - used)
        elif bucket == "code":
            room = max(0, code_cap - used)
        else:
            room = leftover_budget
        budget = min(leftover_budget, room)
        if budget <= 0:
            continue
        pool = [u for u in remaining_pools.get(bucket, []) if id(u) not in used_ids]
        taken = take_units_token_capped(pool, budget, eos_id, rng=rng, deterministic=False)
        selected.extend(taken)
        used_ids.update(id(u) for u in taken)
        added = int(sum(u.tokens.size for u in taken))
        leftover_budget -= added
        leftover_added += added

    meta = {
        "mix_profile": "recovery_003_balanced",
        "desired_total_tokens": desired_total,
        "prose_cap_tokens": prose_cap,
        "code_cap_tokens": code_cap,
        "leftover_fill_order": leftover_order,
        "leftover_added_tokens": leftover_added,
        "unfilled_tokens": max(0, leftover_budget),
        "behavior_all_clean_examples": True,
        "behavior_target_guide_pct": 5.0,
        "note": (
            "Leftover fill is json→code→prose with 45% prose/code caps. "
            "Does not use RECOVERY-002 prose-first leftover dump."
        ),
    }
    return selected, meta


# Exact RECOVERY-001 packed token counts (from 001 data-mix-report).
RECOVERY_001_TOKEN_COUNTS = {
    "prose": 136005,
    "code": 102132,
    "json": 34363,
    "behavior": 6650,
    "wr_corpus_0": 176935,
}
RECOVERY_001_PCJ = (
    RECOVERY_001_TOKEN_COUNTS["prose"]
    + RECOVERY_001_TOKEN_COUNTS["code"]
    + RECOVERY_001_TOKEN_COUNTS["json"]
)
RECOVERY_001_PCJ_FRAC = {
    "prose": RECOVERY_001_TOKEN_COUNTS["prose"] / RECOVERY_001_PCJ,
    "code": RECOVERY_001_TOKEN_COUNTS["code"] / RECOVERY_001_PCJ,
    "json": RECOVERY_001_TOKEN_COUNTS["json"] / RECOVERY_001_PCJ,
}


def _select_units_recovery_004_001_relative(
    *,
    rehearsal_units: list[PackedUnit],
    behavior_units: list[PackedUnit],
    remaining_pools: dict[str, list[PackedUnit]],
    rehearsal_budget: int,
    target_tokens: int,
    eos_id: int,
    rng: np.random.Generator,
) -> tuple[list[PackedUnit], dict[str, Any]]:
    """RECOVERY-004: 30% rehearsal; leftover uses 001 prose/code/JSON relative shares."""
    selected: list[PackedUnit] = []
    selected.extend(take_units_token_capped(
        rehearsal_units, rehearsal_budget, eos_id, deterministic=True,
    ))
    selected.extend(behavior_units)
    used_ids = {id(u) for u in selected}
    filled = int(sum(u.tokens.size for u in selected))
    leftover = max(0, target_tokens - filled)
    desired = {k: int(leftover * v) for k, v in RECOVERY_001_PCJ_FRAC.items()}
    for bucket, budget in desired.items():
        pool = [u for u in remaining_pools.get(bucket, []) if id(u) not in used_ids]
        taken = take_units_token_capped(pool, budget, eos_id, rng=rng, deterministic=False)
        selected.extend(taken)
        used_ids.update(id(u) for u in taken)

    filled = int(sum(u.tokens.size for u in selected))
    leftover_budget = target_tokens - filled
    leftover_order = ["prose", "code", "json"]
    leftover_added = 0
    for bucket in leftover_order:
        if leftover_budget <= 0:
            break
        pool = [u for u in remaining_pools.get(bucket, []) if id(u) not in used_ids]
        taken = take_units_token_capped(pool, leftover_budget, eos_id, rng=rng, deterministic=False)
        selected.extend(taken)
        used_ids.update(id(u) for u in taken)
        added = int(sum(u.tokens.size for u in taken))
        leftover_budget -= added
        leftover_added += added

    meta = {
        "mix_profile": "recovery_004_001_relative",
        "rehearsal_frac_target": 0.30,
        "recovery_001_pcj_frac": {k: round(v, 6) for k, v in RECOVERY_001_PCJ_FRAC.items()},
        "desired_pcj_tokens": desired,
        "leftover_fill_order": leftover_order,
        "leftover_added_tokens": leftover_added,
        "unfilled_tokens": max(0, leftover_budget),
        "behavior_all_clean_examples": True,
        "note": (
            "Non-rehearsal leftover uses RECOVERY-001 prose/code/JSON relative shares "
            "(not 003 35/35 and not 002 prose-first dump). Rehearsal is token-capped at 30%."
        ),
    }
    return selected, meta


def materialize_recovery_mix(
    *,
    root: Path,
    tokenizer: Tokenizer,
    seed: int = 20260830,
    target_tokens: int = 400_000,
    rehearsal_frac: float = 0.15,
    mix_profile: str = "recovery_002",
) -> dict[str, Any]:
    bos_id = tokenizer.token_to_id("<|bos|>")
    eos_id = tokenizer.token_to_id("<|eos|>")
    assistant_id = tokenizer.token_to_id("<|assistant|>")
    if bos_id is None or eos_id is None:
        raise RuntimeError("tokenizer missing bos/eos")

    train_jsonl = root / "model-lab/corpora/WR-CORPUS-1-HARDENED/train/shard-00000.jsonl"
    val_jsonl = root / "model-lab/corpora/WR-CORPUS-1-HARDENED/validation/shard-00000.jsonl"
    behavior_path = root / "model-lab/manifests/wave8_1/behavior-examples.json"
    wrim0_npy = root / "model-lab/manifests/wrim0_corpus_shards/train.npy"
    wrim0_man = json.loads((root / "model-lab/manifests/wrim0_corpus_shards/shard-manifest.json").read_text())

    train_rows = load_jsonl(train_jsonl)
    val_rows = load_jsonl(val_jsonl)
    behavior = json.loads(behavior_path.read_text(encoding="utf-8"))

    excluded = []
    clean_train = []
    for rec in train_rows:
        text = text_of(rec)
        path = str(rec.get("source_path") or "")
        if is_eval_infra_text(text, path):
            excluded.append({"split": "train", "path": path, "chunk_id": rec.get("chunk_id"), "hits": leak_hits(text)})
            continue
        clean_train.append(rec)

    clean_val = []
    for rec in val_rows:
        text = text_of(rec)
        path = str(rec.get("source_path") or "")
        if is_eval_infra_text(text, path):
            excluded.append({"split": "val", "path": path, "chunk_id": rec.get("chunk_id"), "hits": leak_hits(text)})
            continue
        clean_val.append(rec)

    by_bucket: dict[str, list[PackedUnit]] = defaultdict(list)
    for run in group_chunks_into_source_runs(clean_train):
        text = "".join(text_of(r) for r in run)
        if not text.strip():
            continue
        body = tokenizer.encode(text).ids
        if not body:
            continue
        ids, mask = wrap_lm_tokens(body, bos_id, eos_id)
        bucket = bucket_for_record(run[0])
        if bucket == "behavior":
            bucket = "other"
        unit = PackedUnit(
            unit_id=str(run[0].get("source_lineage") or run[0].get("chunk_id")),
            bucket=bucket,
            origin="wr-corpus-1-hardened-clean",
            tokens=np.array(ids, dtype=np.int32),
            loss_mask=np.array(mask, dtype=np.uint8),
            source_path=str(run[0].get("source_path") or ""),
            n_eos=1,
        )
        by_bucket[bucket].append(unit)

    behavior_units: list[PackedUnit] = []
    for ex in behavior.get("examples") or []:
        rendered = ex.get("renderedTrainingText") or ""
        if is_eval_infra_text(rendered, "behavior-examples.json"):
            excluded.append({"split": "behavior", "exampleId": ex.get("exampleId"), "hits": leak_hits(rendered)})
            continue
        ids = tokenizer.encode(rendered).ids
        if not ids:
            continue
        ids, mask = wrap_behavior_tokens(ids, assistant_id)
        if eos_id not in ids:
            ids = list(ids) + [eos_id]
            mask = list(mask) + [1]
        behavior_units.append(PackedUnit(
            unit_id=str(ex.get("exampleId")),
            bucket="behavior",
            origin="behavior-examples",
            tokens=np.array(ids, dtype=np.int32),
            loss_mask=np.array(mask, dtype=np.uint8),
            n_eos=int(np.count_nonzero(np.array(ids) == eos_id)),
        ))

    rehearsal_units: list[PackedUnit] = []
    wrim0 = np.load(wrim0_npy)
    offset = 0
    alice_docs_dropped = 0
    for doc in wrim0_man.get("trainDocs") or []:
        n = int(doc["tokenCount"])
        sl = np.array(wrim0[offset:offset + n], dtype=np.int32)
        offset += n
        decoded = tokenizer.decode(sl.tolist(), skip_special_tokens=True)
        if is_eval_infra_text(decoded, "WR-CORPUS-0"):
            alice_docs_dropped += 1
            continue
        rehearsal_units.append(PackedUnit(
            unit_id=str(doc.get("documentId")),
            bucket="wr_corpus_0",
            origin="WR-CORPUS-0",
            tokens=sl,
            loss_mask=np.ones(sl.size, dtype=np.uint8),
            n_eos=int(np.count_nonzero(sl == eos_id)),
        ))

    rng = np.random.default_rng(seed)

    rehearsal_budget = int(target_tokens * rehearsal_frac)
    remainder = max(0, target_tokens - rehearsal_budget)
    remaining_pools = {
        "prose": by_bucket.get("prose", []),
        "code": by_bucket.get("code", []),
        "json": by_bucket.get("json", []),
        "other": by_bucket.get("other", []),
    }
    available = {k: int(sum(u.tokens.size for u in v)) for k, v in remaining_pools.items()}
    mix_meta: dict[str, Any] = {"mix_profile": mix_profile}
    interleave_meta: dict[str, Any] = {}
    if mix_profile == "recovery_003_balanced":
        selected, mix_meta = _select_units_recovery_003_balanced(
            rehearsal_units=rehearsal_units,
            behavior_units=behavior_units,
            remaining_pools=remaining_pools,
            rehearsal_budget=rehearsal_budget,
            target_tokens=target_tokens,
            eos_id=eos_id,
            rng=rng,
        )
    elif mix_profile == "recovery_004_001_relative":
        selected, mix_meta = _select_units_recovery_004_001_relative(
            rehearsal_units=rehearsal_units,
            behavior_units=behavior_units,
            remaining_pools=remaining_pools,
            rehearsal_budget=rehearsal_budget,
            target_tokens=target_tokens,
            eos_id=eos_id,
            rng=rng,
        )
    elif mix_profile == "recovery_005_interleaved":
        selected, mix_meta = _select_units_recovery_004_001_relative(
            rehearsal_units=rehearsal_units,
            behavior_units=behavior_units,
            remaining_pools=remaining_pools,
            rehearsal_budget=rehearsal_budget,
            target_tokens=target_tokens,
            eos_id=eos_id,
            rng=rng,
        )
    else:
        selected = _select_units_recovery_002(
            rehearsal_units=rehearsal_units,
            behavior_units=behavior_units,
            remaining_pools=remaining_pools,
            rehearsal_budget=rehearsal_budget,
            target_tokens=target_tokens,
            remainder=remainder,
            eos_id=eos_id,
            rng=rng,
        )

    interleave_meta: dict[str, Any] = {}
    if mix_profile == "recovery_005_interleaved":
        from interleave_curriculum import (  # noqa: WPS433
            WINDOW_TOKENS_DEFAULT,
            interleave_units_by_deficit,
            prove_interleave_unit_order_only,
            prove_window_split_preserves_tokens,
            split_units_contiguous_windows,
        )
        window_tokens = WINDOW_TOKENS_DEFAULT
        selected_before_split = list(selected)
        windows = split_units_contiguous_windows(selected, window_tokens, eos_id=eos_id)
        split_proofs = []
        split_ok = True
        for u in selected_before_split:
            pr = prove_window_split_preserves_tokens(u, window_tokens, eos_id=eos_id)
            if not pr["equal_to_source"] or not pr["intra_window_matches_source_slices"]:
                split_ok = False
            split_proofs.append({"unit_id": u.unit_id, "n_tokens": int(u.tokens.size), **pr})
        interleaved = interleave_units_by_deficit(windows)
        inter_proof = prove_interleave_unit_order_only(windows, interleaved)
        interleave_meta = {
            "interleave": "deficit_fifo_per_family",
            "window_tokens": window_tokens,
            "units_before_split": len(selected_before_split),
            "windows_after_split": len(windows),
            "split_preserves_tokens": split_ok,
            "interleave_unit_order_only": inter_proof,
            "split_proof_failures": [p for p in split_proofs if not p["equal_to_source"]],
            "note": (
                "Recovery-005: same 004 unit selection; split into contiguous training-window "
                "units; interleave family order by deficit. No token permutation. No extra BOS/EOS."
            ),
        }
        mix_meta = {**mix_meta, **interleave_meta, "mix_profile": "recovery_005_interleaved"}
        if not split_ok or not inter_proof.get("passed"):
            raise RuntimeError("Recovery-005 contiguity/interleave proof failed before packing")
        unit_objs = interleaved
    else:
        unit_objs = permute_unit_order(selected, seed, 0)
    train_stream = concatenate_units([u.tokens for u in unit_objs])
    train_mask = concatenate_units([u.loss_mask.astype(np.int32) for u in unit_objs])

    val_units: list[PackedUnit] = []
    for run in group_chunks_into_source_runs(clean_val):
        text = "".join(text_of(r) for r in run)
        if not text.strip():
            continue
        body = tokenizer.encode(text).ids
        if not body:
            continue
        ids, mask = wrap_lm_tokens(body, bos_id, eos_id)
        val_units.append(PackedUnit(
            unit_id=str(run[0].get("chunk_id")),
            bucket=bucket_for_record(run[0]),
            origin="val-clean",
            tokens=np.array(ids, dtype=np.int32),
            loss_mask=np.array(mask, dtype=np.uint8),
            n_eos=1,
        ))
    val_stream = concatenate_units([u.tokens for u in val_units])
    val_mask = concatenate_units([u.loss_mask.astype(np.int32) for u in val_units])

    packed_payload = tokenizer.decode(train_stream.tolist()[: min(train_stream.size, 50_000)], skip_special_tokens=False)
    # Full leak scan on all unit texts (decode each unit, not the truncated payload)
    leak_scan_hits = []
    for u in unit_objs:
        decoded = tokenizer.decode(u.tokens.tolist(), skip_special_tokens=True)
        hits = leak_hits(decoded)
        if hits:
            leak_scan_hits.append({"unit_id": u.unit_id, "origin": u.origin, "hits": hits})

    token_counts = defaultdict(int)
    unit_counts = defaultdict(int)
    eos_counts = defaultdict(int)
    for u in unit_objs:
        token_counts[u.bucket] += int(u.tokens.size)
        unit_counts[u.bucket] += 1
        eos_counts[u.bucket] += int(u.n_eos)
    total = int(train_stream.size) or 1
    eos_total = int(np.count_nonzero(train_stream == eos_id))
    bos_total = int(np.count_nonzero(train_stream == bos_id))
    pct = {k: round(100.0 * v / total, 2) for k, v in token_counts.items()}
    prose_pct = float(pct.get("prose") or 0)
    code_pct = float(pct.get("code") or 0)
    json_pct = float(pct.get("json") or 0)
    behavior_pct = float(pct.get("behavior") or 0)
    rehearsal_pct = round(100.0 * token_counts.get("wr_corpus_0", 0) / total, 4)
    mix_stop_reasons = []
    if mix_profile == "recovery_003_balanced":
        if prose_pct > 45.0:
            mix_stop_reasons.append(f"prose {prose_pct}% exceeds 45%")
        if code_pct > 45.0:
            mix_stop_reasons.append(f"code {code_pct}% exceeds 45%")
        if rehearsal_pct > 15.5:
            mix_stop_reasons.append(f"rehearsal {rehearsal_pct}% exceeds 15.5%")
        if rehearsal_pct < 14.5:
            mix_stop_reasons.append(f"rehearsal {rehearsal_pct}% below 14.5%")
        if total < 300_000 or total > 500_000:
            mix_stop_reasons.append(f"train tokens {total} outside 300K-500K TEST_ONLY band")
        if abs(prose_pct - code_pct) > 20.0:
            mix_stop_reasons.append(f"prose/code imbalance {prose_pct}/{code_pct}")
    if mix_profile in ("recovery_004_001_relative", "recovery_005_interleaved"):
        if rehearsal_pct > 30.5:
            mix_stop_reasons.append(f"rehearsal {rehearsal_pct}% exceeds 30.5%")
        if rehearsal_pct < 29.5:
            mix_stop_reasons.append(f"rehearsal {rehearsal_pct}% below 29.5%")
        if total < 300_000 or total > 500_000:
            mix_stop_reasons.append(f"train tokens {total} outside 300K-500K TEST_ONLY band")
        if abs(prose_pct - 34.11) > 3.0:
            mix_stop_reasons.append(f"prose {prose_pct}% off 001-relative target ~34.11%")
        if abs(code_pct - 25.61) > 3.0:
            mix_stop_reasons.append(f"code {code_pct}% off 001-relative target ~25.61%")
        if abs(json_pct - 8.61) > 3.0:
            mix_stop_reasons.append(f"json {json_pct}% off 001-relative target ~8.61%")
        if mix_profile == "recovery_005_interleaved":
            if not interleave_meta.get("split_preserves_tokens", False):
                mix_stop_reasons.append("window split did not preserve source token order")
            ip = interleave_meta.get("interleave_unit_order_only") or {}
            if not ip.get("passed"):
                mix_stop_reasons.append("interleave changed intra-unit tokens")
            if ip.get("passed") and not ip.get("unit_order_changed"):
                mix_stop_reasons.append("interleave did not change unit order (not actually interleaved)")
    mix_gate = {
        "mix_profile": mix_profile,
        "prose_pct": prose_pct,
        "code_pct": code_pct,
        "json_pct": json_pct,
        "behavior_pct": behavior_pct,
        "rehearsal_pct": rehearsal_pct,
        "passed": len(mix_stop_reasons) == 0,
        "stop_reasons": mix_stop_reasons,
        **mix_meta,
    }

    report = {
        "test_only": True,
        "promotable": False,
        "lineage": "NOT_OFFICIAL_WRIM_LINEAGE",
        "excluded_eval_infra_records": len(excluded),
        "excluded_sample": excluded[:20],
        "alice_or_heldout_wr_corpus_0_docs_dropped": alice_docs_dropped,
        "held_out_leak_hits": leak_scan_hits,
        "held_out_leak_count": len(leak_scan_hits),
        "train_tokens": int(train_stream.size),
        "val_tokens": int(val_stream.size),
        "train_units": len(unit_objs),
        "val_units": len(val_units),
        "bos_count": bos_total,
        "eos_count": eos_total,
        "eos_per_1k_tokens": (1000.0 * eos_total / total) if total else 0.0,
        "eos_per_unit": (eos_total / max(1, len(unit_objs))),
        "old_wrim1_eos_count": 30,
        "old_wrim1_train_tokens": 3_874_900,
        "old_wrim1_eos_per_1k": 1000.0 * 30 / 3_874_900,
        "token_counts": dict(token_counts),
        "token_pct": pct,
        "mix_gate": mix_gate,
        "unit_counts": dict(unit_counts),
        "eos_by_bucket": dict(eos_counts),
        "available_cleaned_tokens": available,
        "behavior_units": len(behavior_units),
        "rehearsal_units_available_clean": len(rehearsal_units),
        "rehearsal_units_selected": int(unit_counts.get("wr_corpus_0", 0)),
        "rehearsal_tokens": int(token_counts.get("wr_corpus_0", 0)),
        "rehearsal_pct": round(100.0 * token_counts.get("wr_corpus_0", 0) / total, 4),
        "rehearsal_target_tokens": rehearsal_budget,
        "rehearsal_frac_target": rehearsal_frac,
        "rehearsal_cap_method": (
            "deterministic unit_id order; take whole WR-CORPUS-0 documents while they fit; "
            "truncate the last document to a contiguous prefix ending in EOS; never permute tokens"
        ),
        "rehearsal_truncated_units": int(sum(1 for u in unit_objs if u.bucket == "wr_corpus_0" and u.truncated)),
        "target_tokens": target_tokens,
        "contiguous": True,
        "shuffle": (
            "deficit_interleave_contiguous_windows"
            if mix_profile == "recovery_005_interleaved"
            else "unit_order_only"
        ),
        "interleave": interleave_meta,
        "payload_prefix_chars_for_debug": len(packed_payload),
    }
    return {
        "train_stream": train_stream.astype(np.int32),
        "train_mask": train_mask.astype(np.float32),
        "val_stream": val_stream.astype(np.int32),
        "val_mask": val_mask.astype(np.float32),
        "train_units": unit_objs,
        "report": report,
        "bos_id": bos_id,
        "eos_id": eos_id,
        "assistant_id": assistant_id,
    }
