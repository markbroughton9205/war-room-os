"""Official WRIM1-RUN-000002 packing: capability units + 2048-token deficit interleave.

Does not permute tokens inside units. Does not use Recovery checkpoints as parent.
Does not write production or WRIM-0 weights.
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
from tokenizers import Tokenizer

from capability_curriculum_lib import (
    CURRICULUM_ID,
    EVAL_ID,
    account_training,
    build_eval_suite,
    build_training_examples,
    floors_report,
    leak_scan,
)
from contiguous_pack import (
    PackedUnit,
    concatenate_units,
    group_chunks_into_source_runs,
    is_eval_infra_text,
    load_jsonl,
    take_units_token_capped,
    text_of,
    wrap_lm_tokens,
)
from interleave_curriculum import (
    WINDOW_TOKENS_DEFAULT,
    interleave_units_by_deficit,
    prove_interleave_unit_order_only,
    prove_window_split_preserves_tokens,
    split_units_contiguous_windows,
)
from materialize_capability_curriculum import (
    PACK_TARGET,
    REHEARSAL_FRAC,
    leftover_units,
    rehearsal_units,
    supervised_units,
    validator,
)
from hashes import sha256_file, sha256_json


EXPECTED_PACK_TOKENS = 686_070
PACK_SEED = 20260831


def select_curriculum_units(
    *,
    tokenizer: Tokenizer,
    examples: list[dict[str, Any]],
    leftover: dict[str, list[PackedUnit]],
    rehearsal: list[PackedUnit],
    seed: int = PACK_SEED,
) -> dict[str, Any]:
    """Same selection as pack_candidate, without unit permutation (interleave replaces it)."""
    eos_id = tokenizer.token_to_id("<|eos|>")
    rng = np.random.default_rng(seed)
    sup = supervised_units(examples, tokenizer)
    sup_tokens = int(sum(u.tokens.size for u in sup))
    rehearsal_budget = int(PACK_TARGET * REHEARSAL_FRAC)
    leftover_budget = max(0, PACK_TARGET - rehearsal_budget - sup_tokens)
    prose_share, code_share, json_share = 0.50, 0.42, 0.08
    selected: list[PackedUnit] = []
    selected.extend(take_units_token_capped(rehearsal, rehearsal_budget, eos_id, rng=rng))
    selected.extend(sup)
    selected.extend(take_units_token_capped(leftover.get("prose", []), int(leftover_budget * prose_share), eos_id, rng=rng))
    selected.extend(take_units_token_capped(leftover.get("code", []), int(leftover_budget * code_share), eos_id, rng=rng))
    selected.extend(take_units_token_capped(leftover.get("json", []), int(leftover_budget * json_share), eos_id, rng=rng))
    mix = defaultdict(int)
    for u in selected:
        mix[u.bucket] += int(u.tokens.size)
    return {
        "selected": selected,
        "supervised_unit_tokens": sup_tokens,
        "rehearsal_budget": rehearsal_budget,
        "leftover_budget": leftover_budget,
        "mix_unit_tokens": dict(mix),
        "actual_pack_tokens": int(sum(u.tokens.size for u in selected)),
    }


def interleave_selected(selected: list[PackedUnit], eos_id: int, window_tokens: int = WINDOW_TOKENS_DEFAULT) -> dict[str, Any]:
    windows = split_units_contiguous_windows(selected, window_tokens, eos_id=eos_id)
    split_ok = True
    split_failures = []
    for u in selected:
        pr = prove_window_split_preserves_tokens(u, window_tokens, eos_id=eos_id)
        if not pr["equal_to_source"] or not pr["intra_window_matches_source_slices"]:
            split_ok = False
            split_failures.append({"unit_id": u.unit_id, **pr})
    interleaved = interleave_units_by_deficit(windows)
    inter_proof = prove_interleave_unit_order_only(windows, interleaved)
    train_stream = concatenate_units([u.tokens for u in interleaved])
    train_mask = concatenate_units([u.loss_mask.astype(np.int32) for u in interleaved])
    return {
        "train_units": interleaved,
        "train_stream": train_stream.astype(np.int32),
        "train_mask": train_mask.astype(np.float32),
        "split_preserves_tokens": split_ok,
        "split_failures": split_failures[:8],
        "interleave_unit_order_only": inter_proof,
        "window_tokens": window_tokens,
        "units_before_split": len(selected),
        "windows_after_split": len(windows),
        "shuffle": "deficit_interleave_contiguous_windows",
        "contiguous": True,
        "no_token_permutation": True,
    }


def pack_val_stream(root: Path, tokenizer: Tokenizer) -> dict[str, Any]:
    bos_id = tokenizer.token_to_id("<|bos|>")
    eos_id = tokenizer.token_to_id("<|eos|>")
    val_jsonl = root / "model-lab/corpora/WR-CORPUS-1-HARDENED/validation/shard-00000.jsonl"
    rows = load_jsonl(val_jsonl)
    units: list[PackedUnit] = []
    for run in group_chunks_into_source_runs(rows):
        text = "".join(text_of(r) for r in run)
        path = str(run[0].get("source_path") or "")
        if not text.strip() or is_eval_infra_text(text, path):
            continue
        body = tokenizer.encode(text).ids
        if not body:
            continue
        ids, mask = wrap_lm_tokens(body, bos_id, eos_id)
        units.append(
            PackedUnit(
                unit_id=str(run[0].get("chunk_id")),
                bucket="val",
                origin="val-hardened-clean",
                tokens=np.array(ids, dtype=np.int32),
                loss_mask=np.array(mask, dtype=np.uint8),
                n_eos=1,
            )
        )
    stream = concatenate_units([u.tokens for u in units])
    mask = concatenate_units([u.loss_mask.astype(np.int32) for u in units])
    return {
        "val_stream": stream.astype(np.int32),
        "val_mask": mask.astype(np.float32),
        "val_units": len(units),
        "val_tokens": int(stream.size),
    }


def scan_stream_vs_eval(
    *,
    tokenizer: Tokenizer,
    units: list[PackedUnit],
    examples: list[dict[str, Any]],
    eval_suite: dict[str, Any],
    prompt_list: list[str],
) -> dict[str, Any]:
    extra = []
    phrase_hits = []
    for u in units:
        decoded = tokenizer.decode(u.tokens.tolist(), skip_special_tokens=True)
        extra.append(decoded)
        for p in prompt_list:
            if p and p in decoded:
                phrase_hits.append({"unit_id": u.unit_id, "prompt_prefix": p[:80]})
                break
    leak = leak_scan(examples, eval_suite, extra_texts=extra)
    known = int(leak["known_eval_leakage"]) + len(phrase_hits)
    return {
        "known_eval_leakage": known,
        "passed": known == 0 and leak["passed"] and not phrase_hits,
        "leak_scan": leak,
        "prompt_list_hits": phrase_hits[:20],
        "n_units_decoded": len(units),
        "eval_id": eval_suite.get("suite_id"),
        "EXCLUDE_FROM_TRAINING": True,
    }


def official_mask_audit(train_units: list[PackedUnit], tokenizer: Tokenizer) -> dict[str, Any]:
    assistant_id = tokenizer.token_to_id("<|assistant|>")
    lm_full = 0
    lm_not_full = 0
    sup_ok = 0
    sup_bad = 0
    n_sup = 0
    prompt_tokens = 0
    target_tokens = 0
    for u in train_units:
        mask = np.asarray(u.loss_mask)
        if u.bucket != "supervised":
            if int(np.sum(mask == 1)) == mask.size:
                lm_full += 1
            else:
                lm_not_full += 1
            target_tokens += int(np.sum(mask == 1))
            continue
        n_sup += 1
        ids = u.tokens.tolist()
        if assistant_id is None or assistant_id not in ids:
            sup_bad += mask.size
            continue
        apos = ids.index(assistant_id)
        for i, m in enumerate(mask.tolist()):
            expect = 1 if i > apos else 0
            if int(m) == expect:
                sup_ok += 1
            else:
                sup_bad += 1
            if expect == 0:
                prompt_tokens += 1
            else:
                target_tokens += 1
    masked = int(sum(int(np.sum(np.asarray(u.loss_mask) == 0)) for u in train_units))
    trainable = int(sum(int(np.sum(np.asarray(u.loss_mask) == 1)) for u in train_units))
    return {
        "passed": sup_bad == 0 and lm_not_full == 0 and n_sup > 0,
        "supervised_units": n_sup,
        "supervised_mask_tokens_ok": sup_ok,
        "supervised_mask_tokens_bad": sup_bad,
        "lm_units_full_causal": lm_full,
        "lm_units_not_full_causal": lm_not_full,
        "prompt_token_count": prompt_tokens,
        "target_token_count": int(sum(int(np.sum(np.asarray(u.loss_mask) == 1)) for u in train_units if u.bucket == "supervised")),
        "masked_token_count": masked,
        "trainable_token_count": trainable,
    }


def tool_target_proof(train_units: list[PackedUnit], tokenizer: Tokenizer) -> dict[str, Any]:
    assistant_id = tokenizer.token_to_id("<|assistant|>")
    n_tool_units = 0
    n_tool_call_in_target = 0
    n_tool_call_in_prompt = 0
    n_gradient_bearing = 0
    n_masked_tool = 0
    for u in train_units:
        if u.origin != "tool_use" and u.bucket != "supervised":
            continue
        decoded = tokenizer.decode(u.tokens.tolist(), skip_special_tokens=False)
        if "<tool_call>" not in decoded:
            continue
        n_tool_units += 1
        ids = u.tokens.tolist()
        mask = np.asarray(u.loss_mask).tolist()
        if assistant_id is None or assistant_id not in ids:
            n_masked_tool += 1
            continue
        apos = ids.index(assistant_id)
        # locate tool_call substring via decode windows is brittle; use token decode per index
        text = decoded
        call_at = text.find("<tool_call>")
        if call_at < 0:
            continue
        # all tokens after assistant must be trainable
        after = mask[apos + 1 :]
        if after and all(int(m) == 1 for m in after):
            n_gradient_bearing += 1
        else:
            n_masked_tool += 1
        if call_at >= 0:
            # assistant marker appears before tool_call in rendered text
            atext = text.find("<|assistant|>")
            if atext >= 0 and call_at > atext:
                n_tool_call_in_target += 1
            else:
                n_tool_call_in_prompt += 1
    return {
        "passed": n_tool_units > 0 and n_masked_tool == 0 and n_tool_call_in_prompt == 0,
        "tool_units_with_tool_call": n_tool_units,
        "tool_call_after_assistant": n_tool_call_in_target,
        "tool_call_in_prompt_span": n_tool_call_in_prompt,
        "gradient_bearing_assistant_span": n_gradient_bearing,
        "masked_tool_failures": n_masked_tool,
        "note": "Tool JSON lives in the assistant span; those tokens receive gradient.",
    }


def materialize_official_pack(*, root: Path, tokenizer: Tokenizer) -> dict[str, Any]:
    eval_dir = root / "model-lab/eval-only" / EVAL_ID
    curr_dir = root / "model-lab/manifests/wrim1_1_capability/test-design" / CURRICULUM_ID
    readme = eval_dir / "SUITE_README.txt"
    marker = readme.read_text(encoding="utf-8") if readme.is_file() else ""
    suite = json.loads((eval_dir / "suite.json").read_text(encoding="utf-8"))
    prompt_list = json.loads((eval_dir / "prompt-list.json").read_text(encoding="utf-8")).get("prompts") or []
    examples = build_training_examples()
    leftover = leftover_units(root, tokenizer)
    rehearsal = rehearsal_units(root, tokenizer)
    selected_pack = select_curriculum_units(
        tokenizer=tokenizer, examples=examples, leftover=leftover, rehearsal=rehearsal
    )
    eos_id = tokenizer.token_to_id("<|eos|>")
    interleaved = interleave_selected(selected_pack["selected"], eos_id)
    val = pack_val_stream(root, tokenizer)
    account = account_training(examples, tokenizer)
    floors = floors_report(account)
    leak_examples = leak_scan(examples, suite)
    vali = validator(
        account=account,
        floors=floors,
        leak=leak_examples,
        eval_suite=suite,
        pack={"actual_pack_tokens": selected_pack["actual_pack_tokens"]},
        examples=examples,
    )
    stream_scan = scan_stream_vs_eval(
        tokenizer=tokenizer,
        units=interleaved["train_units"],
        examples=examples,
        eval_suite=suite,
        prompt_list=prompt_list,
    )
    mask_proof = official_mask_audit(interleaved["train_units"], tokenizer)
    tool_proof = tool_target_proof(interleaved["train_units"], tokenizer)
    total = int(interleaved["train_stream"].size) or 1
    counts = defaultdict(int)
    for u in interleaved["train_units"]:
        counts[u.bucket] += int(u.tokens.size)
    pct = {k: round(100.0 * v / total, 4) for k, v in counts.items()}
    return {
        **interleaved,
        **val,
        "curriculum_id": CURRICULUM_ID,
        "eval_id": EVAL_ID,
        "eval_path": str(eval_dir),
        "eval_exclude_marker": marker.strip()[:80],
        "eval_exclude_ok": "EXCLUDE_FROM_TRAINING=true" in marker or suite.get("EXCLUDE_FROM_TRAINING") is True,
        "selected_tokens": selected_pack["actual_pack_tokens"],
        "mix_unit_tokens": selected_pack["mix_unit_tokens"],
        "token_counts": dict(counts),
        "token_pct": pct,
        "rehearsal_pct": float(pct.get("wr_corpus_0") or 0),
        "account": account,
        "floors": floors,
        "example_leak_scan": leak_examples,
        "validator": vali,
        "stream_leak_scan": stream_scan,
        "mask_proof": mask_proof,
        "tool_proof": tool_proof,
        "curriculum_dir": str(curr_dir),
        "design_manifest": json.loads((curr_dir / "MANIFEST.json").read_text(encoding="utf-8")) if (curr_dir / "MANIFEST.json").is_file() else {},
        "expected_pack_tokens": EXPECTED_PACK_TOKENS,
        "pack_token_match": selected_pack["actual_pack_tokens"] == EXPECTED_PACK_TOKENS,
    }
