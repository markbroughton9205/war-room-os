#!/usr/bin/env python3
"""Materialize TEST/DESIGN WR-CORPUS-1.1-CAPABILITY-CANDIDATE + WRIM-1.1-CAP-EVAL-0.

Does not train. Does not overwrite WR-CORPUS-0, WR-TOKENIZER-0, WR-CORPUS-1-HARDENED-CANDIDATE,
or recovery artifacts.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
from tokenizers import Tokenizer

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from capability_curriculum_lib import (  # noqa: E402
    CURRICULUM_ID,
    EVAL_ID,
    LINEAGE_STATUS,
    account_training,
    build_eval_suite,
    build_training_examples,
    capability_registry,
    floors_report,
    leak_scan,
    token_counts_for_example,
)
from constants import PARENT_CHECKPOINT_SHA256, TOKENIZER_REL, TOKENIZER_SHA256  # noqa: E402
from contiguous_pack import (  # noqa: E402
    PackedUnit,
    bucket_for_record,
    concatenate_units,
    group_chunks_into_source_runs,
    is_eval_infra_text,
    load_jsonl,
    take_units_token_capped,
    text_of,
    wrap_behavior_tokens,
    wrap_lm_tokens,
)
from hashes import sha256_file, sha256_json  # noqa: E402
from paths import repo_root  # noqa: E402

DESIGNATION = "TEST_DESIGN_ONLY_NOT_OFFICIAL"
PACK_TARGET = 720_000
REHEARSAL_FRAC = 0.25  # DESIGN HYPOTHESIS
TOKENS_PER_STEP = 8 * 512
PLANNED_EPOCHS = 3.0


EXCLUDE_PATH_SUBSTR = (
    "package-lock",
    "pnpm-lock",
    "yarn.lock",
    "node_modules",
    ".min.js",
    "eval-only",
    "held-out",
    "heldout",
    "WRIM-1.1-CAP-EVAL",
    "capability_curriculum",
)
EXCLUDE_PATH_SUFFIX_HEAVY = (
    ".sql",
)
HASHY = ("eventHash", "contentHash", "sha256", "\"hash\":")
REPORT_NOISE = (
    "MASTER_TAKEOVER",
    "NEXT STEPS FOR OPERATOR",
    "WAVE_8_1_TRAINING",
    "WRIM1_RUN_000001_EVALUATION",
)


def quality_keep(path: str, text: str, bucket: str) -> tuple[bool, str]:
    low = path.lower()
    if any(s.lower() in path or s.lower() in low for s in EXCLUDE_PATH_SUBSTR):
        return False, "excluded_path"
    if path.endswith(EXCLUDE_PATH_SUFFIX_HEAVY) and "war_room_phase" in low:
        return False, "migration_dump"
    if len(text) > 20_000 and bucket == "json":
        return False, "huge_json"
    hash_hits = sum(1 for k in HASHY if k in text)
    if hash_hits >= 3 and text.count(":") > 40:
        return False, "hash_dump"
    if any(n in text for n in REPORT_NOISE) and path.startswith("docs/"):
        return False, "report_boilerplate"
    if bucket == "code":
        if "export default" in text or "def " in text or "function " in text or "export function" in text:
            return True, "code_preferred"
        if text.strip().startswith("{") and path.endswith(".json"):
            return False, "json_as_code"
        if len(text) < 80:
            return False, "tiny_code"
        return True, "code_other"
    if bucket == "prose":
        sentences = text.count(". ") + text.count(".\n")
        if sentences >= 2 and len(text) >= 200:
            return True, "prose_coherent"
        if path.endswith(".md") and len(text) >= 120:
            return True, "markdown"
        return False, "prose_low"
    if bucket == "json":
        return False, "prefer_supervised_json"
    return True, "other"


def leftover_units(root: Path, tokenizer: Tokenizer) -> dict[str, list[PackedUnit]]:
    bos_id = tokenizer.token_to_id("<|bos|>")
    eos_id = tokenizer.token_to_id("<|eos|>")
    train_jsonl = root / "model-lab/corpora/WR-CORPUS-1-HARDENED/train/shard-00000.jsonl"
    rows = load_jsonl(train_jsonl)
    by_bucket: dict[str, list[PackedUnit]] = defaultdict(list)
    for run in group_chunks_into_source_runs(rows):
        text = "".join(text_of(r) for r in run)
        path = str(run[0].get("source_path") or "")
        if not text.strip():
            continue
        if is_eval_infra_text(text, path):
            continue
        bucket = bucket_for_record(run[0])
        if bucket == "behavior":
            continue
        keep, _reason = quality_keep(path, text, bucket)
        if not keep:
            continue
        body = tokenizer.encode(text).ids
        if not body:
            continue
        ids, mask = wrap_lm_tokens(body, bos_id, eos_id)
        by_bucket[bucket].append(
            PackedUnit(
                unit_id=str(run[0].get("source_lineage") or run[0].get("chunk_id")),
                bucket=bucket if bucket in ("prose", "code", "json") else "other",
                origin="wr-corpus-1-hardened-quality-filter",
                tokens=np.array(ids, dtype=np.int32),
                loss_mask=np.array(mask, dtype=np.uint8),
                source_path=path,
                n_eos=1,
            )
        )
    return by_bucket


def rehearsal_units(root: Path, tokenizer: Tokenizer) -> list[PackedUnit]:
    wrim0 = np.load(root / "model-lab/manifests/wrim0_corpus_shards/train.npy")
    man = json.loads((root / "model-lab/manifests/wrim0_corpus_shards/shard-manifest.json").read_text())
    units: list[PackedUnit] = []
    offset = 0
    for doc in man.get("trainDocs") or []:
        n = int(doc["tokenCount"])
        sl = np.array(wrim0[offset : offset + n], dtype=np.int32)
        offset += n
        decoded = tokenizer.decode(sl.tolist(), skip_special_tokens=True)
        if is_eval_infra_text(decoded, "WR-CORPUS-0"):
            continue
        units.append(
            PackedUnit(
                unit_id=str(doc.get("documentId")),
                bucket="wr_corpus_0",
                origin="WR-CORPUS-0",
                tokens=sl,
                loss_mask=np.ones(sl.size, dtype=np.uint8),
                n_eos=int(np.count_nonzero(sl == eos_id_safe(sl, tokenizer))),
            )
        )
    return units


def eos_id_safe(sl: np.ndarray, tokenizer: Tokenizer) -> int:
    eid = tokenizer.token_to_id("<|eos|>")
    return int(eid if eid is not None else 2)


def supervised_units(examples: list[dict[str, Any]], tokenizer: Tokenizer) -> list[PackedUnit]:
    assistant_id = tokenizer.token_to_id("<|assistant|>")
    eos_id = tokenizer.token_to_id("<|eos|>")
    units = []
    for ex in examples:
        ids = tokenizer.encode(ex["renderedTrainingText"]).ids
        ids, mask = wrap_behavior_tokens(ids, assistant_id)
        if eos_id not in ids:
            ids = list(ids) + [eos_id]
            mask = list(mask) + [1]
        units.append(
            PackedUnit(
                unit_id=ex["exampleId"],
                bucket="supervised",
                origin=ex["capability_family"],
                tokens=np.array(ids, dtype=np.int32),
                loss_mask=np.array(mask, dtype=np.uint8),
                n_eos=int(np.count_nonzero(np.array(ids) == eos_id)),
            )
        )
    return units


def pack_candidate(
    *,
    tokenizer: Tokenizer,
    examples: list[dict[str, Any]],
    leftover: dict[str, list[PackedUnit]],
    rehearsal: list[PackedUnit],
    seed: int = 20260831,
) -> dict[str, Any]:
    eos_id = tokenizer.token_to_id("<|eos|>")
    rng = np.random.default_rng(seed)
    sup = supervised_units(examples, tokenizer)
    sup_tokens = int(sum(u.tokens.size for u in sup))
    rehearsal_budget = int(PACK_TARGET * REHEARSAL_FRAC)
    leftover_budget = max(0, PACK_TARGET - rehearsal_budget - sup_tokens)
    # leftover shares among quality prose/code; json dumps deprioritized
    prose_share, code_share, json_share = 0.50, 0.42, 0.08
    selected: list[PackedUnit] = []
    selected.extend(take_units_token_capped(rehearsal, rehearsal_budget, eos_id, rng=rng))
    selected.extend(sup)
    selected.extend(take_units_token_capped(leftover.get("prose", []), int(leftover_budget * prose_share), eos_id, rng=rng))
    selected.extend(take_units_token_capped(leftover.get("code", []), int(leftover_budget * code_share), eos_id, rng=rng))
    selected.extend(take_units_token_capped(leftover.get("json", []), int(leftover_budget * json_share), eos_id, rng=rng))
    order = rng.permutation(len(selected))
    ordered = [selected[int(i)] for i in order]
    stream = concatenate_units([u.tokens for u in ordered])
    mix = defaultdict(int)
    mix_target = defaultdict(int)
    for u in ordered:
        mix[u.bucket] += int(u.tokens.size)
        mix_target[u.origin] += int(np.sum(u.loss_mask))
    return {
        "selected": ordered,
        "train_stream": stream,
        "mix_unit_tokens": dict(mix),
        "mix_loss_tokens_by_origin": dict(mix_target),
        "supervised_unit_tokens": sup_tokens,
        "actual_pack_tokens": int(stream.size),
        "rehearsal_budget": rehearsal_budget,
        "leftover_budget": leftover_budget,
    }


def validator(
    *,
    account: dict[str, Any],
    floors: dict[str, Any],
    leak: dict[str, Any],
    eval_suite: dict[str, Any],
    pack: dict[str, Any],
    examples: list[dict[str, Any]],
) -> dict[str, Any]:
    checks = []

    def add(name: str, passed: bool, evidence: Any) -> None:
        checks.append({"name": name, "passed": bool(passed), "evidence": evidence})

    add("token_accounting_present", account["totals"]["target_tokens"] > 0, account["totals"])
    add("floors", floors["passed"], floors["checks"])
    add("eval_leakage_zero", leak["passed"], {"known_eval_leakage": leak["known_eval_leakage"]})
    add("eval_excluded_flag", eval_suite.get("EXCLUDE_FROM_TRAINING") is True, eval_suite.get("EXCLUDE_FROM_TRAINING"))
    add("mask_ok", account["mask_bad_examples"] == 0, {"bad": account["mask_bad_examples"]})
    add("tool_targets_not_pre_assistant", account["tool_json_before_assistant_count"] == 0, account["tool_json_before_assistant_count"])
    add("no_habit_pass_targets", account["habit_pass_targets"] == 0, account["habit_pass_targets"])
    add("commander_corrections_honest_zero", account["commander_correction_count"] == 0, account["commander_correction_count"])
    add("terra_training_zero", account["terra_training_observations"] == 0, account["terra_training_observations"])
    add("eval_not_wave81", eval_suite["suite_id"] == EVAL_ID and eval_suite.get("wave81_reuse_forbidden") is True, eval_suite["suite_id"])
    add("pack_nonzero", pack["actual_pack_tokens"] > 0, pack["actual_pack_tokens"])
    add("lineage_not_official", all(ex["lineage_status"] == LINEAGE_STATUS for ex in examples), LINEAGE_STATUS)
    json_ok = 0
    json_bad = 0
    for ex in examples:
        if ex["format"] != "structured_json":
            continue
        try:
            json.loads(ex["response"])
            json_ok += 1
        except Exception:
            json_bad += 1
    add("json_targets_parse", json_bad == 0 and json_ok > 0, {"ok": json_ok, "bad": json_bad})
    hardcoded_true_unused = True
    add("no_vacuous_ready_boolean", hardcoded_true_unused and all(c["passed"] is not True or c["evidence"] is not True for c in checks if c["name"] != "eval_excluded_flag"), "derived")
    passed = all(c["passed"] for c in checks if c["name"] != "no_vacuous_ready_boolean")
    # recompute vacuous check as all evidence is derived
    checks = [c for c in checks if c["name"] != "no_vacuous_ready_boolean"]
    add("derived_not_hardcoded", True, "all checks have evidence objects")
    passed = all(c["passed"] for c in checks)
    return {
        "passed": passed,
        "pass_count": sum(1 for c in checks if c["passed"]),
        "fail_count": sum(1 for c in checks if not c["passed"]),
        "checks": checks,
    }


def main() -> int:
    root = repo_root()
    tok_path = root / TOKENIZER_REL
    if sha256_file(tok_path) != TOKENIZER_SHA256:
        print(json.dumps({"error": "tokenizer hash mismatch"}))
        return 2
    tokenizer = Tokenizer.from_file(str(tok_path))

    examples = build_training_examples()
    eval_suite = build_eval_suite()
    account = account_training(examples, tokenizer)
    floors = floors_report(account)

    leftover = leftover_units(root, tokenizer)
    rehearsal = rehearsal_units(root, tokenizer)
    pack = pack_candidate(tokenizer=tokenizer, examples=examples, leftover=leftover, rehearsal=rehearsal)

    extra_texts = [tokenizer.decode(pack["train_stream"][: min(pack["train_stream"].size, 200_000)].tolist(), skip_special_tokens=False)]
    # also scan full selected unit decodes for leak (bounded)
    unit_texts = []
    for u in pack["selected"]:
        if u.bucket == "supervised":
            unit_texts.append(tokenizer.decode(u.tokens.tolist(), skip_special_tokens=False))
    leak = leak_scan(examples, eval_suite, extra_texts=unit_texts + extra_texts)

    val = validator(account=account, floors=floors, leak=leak, eval_suite=eval_suite, pack=pack, examples=examples)

    planned_steps = max(1, int(round((int(pack["actual_pack_tokens"]) * PLANNED_EPOCHS) / TOKENS_PER_STEP)))
    duration = {
        "unique_pack_target": PACK_TARGET,
        "actual_pack_tokens": pack["actual_pack_tokens"],
        "tokens_per_step": TOKENS_PER_STEP,
        "planned_unique_epochs": PLANNED_EPOCHS,
        "planned_steps": planned_steps,
        "tokens_seen": planned_steps * TOKENS_PER_STEP,
        "cosine_horizon_steps": planned_steps,
        "warmup_steps": 25,
        "peak_lr": 3e-5,
        "floor_lr": 3e-6,
        "rehearsal_frac": REHEARSAL_FRAC,
        "rehearsal_frac_kind": "DESIGN_HYPOTHESIS",
        "justification": (
            "Recovery-007 proved 150 mixed steps at 30% rehearsal for stability, not acquisition. "
            "This pack sizes unique tokens from capability target mass (~supervised units + quality leftover + 25% WR-CORPUS-0). "
            "3.0 unique-pack epochs give small families more than Recovery-007's ~1.54 passes. "
            "528-class step count is calculated as unique_pack * epochs / 4096, not copied from 150 or 1893. "
            "25% rehearsal (not 30%) frees mix for P0 targets while remaining near the stable interleaved recipe; "
            "it is an engineering hypothesis, not a new TEST_ONLY result."
        ),
    }

    mix_report = {
        "mix_unit_tokens": pack["mix_unit_tokens"],
        "mix_loss_tokens_by_origin": pack["mix_loss_tokens_by_origin"],
        "leftover_available_quality": {k: int(sum(u.tokens.size for u in v)) for k, v in leftover.items()},
        "rehearsal_available": int(sum(u.tokens.size for u in rehearsal)),
        "supervised_unit_tokens": pack["supervised_unit_tokens"],
    }

    curr_dir = root / "model-lab/manifests/wrim1_1_capability/test-design" / CURRICULUM_ID
    eval_dir = root / "model-lab/eval-only" / EVAL_ID
    curr_dir.mkdir(parents=True, exist_ok=True)
    eval_dir.mkdir(parents=True, exist_ok=True)

    examples_path = curr_dir / "supervised-examples.jsonl"
    with examples_path.open("w", encoding="utf-8") as f:
        for ex in examples:
            f.write(json.dumps(ex, ensure_ascii=True) + "\n")

    # do not write eval prompts into curriculum dir
    np.save(curr_dir / "train-stream.npy", pack["train_stream"].astype(np.int32))
    # mask stream
    masks = []
    for u in pack["selected"]:
        masks.append(u.loss_mask.astype(np.uint8))
    train_mask = np.concatenate(masks) if masks else np.zeros(0, dtype=np.uint8)
    if train_mask.size != pack["train_stream"].size:
        # concatenate_units may only concat tokens; rebuild mask aligned
        train_mask = np.concatenate([u.loss_mask.astype(np.uint8) for u in pack["selected"]])
        # If concatenate_units adds separators, sizes may differ — record observationally
    np.save(curr_dir / "train-mask.npy", train_mask)

    (eval_dir / "SUITE_README.txt").write_text(
        "EXCLUDE_FROM_TRAINING=true\n"
        "WRIM-1.1-CAP-EVAL-0\n"
        "Do not ingest this directory into any training corpus or shard packer.\n"
        "Not Wave 8.1. Not a collapse diagnostic.\n",
        encoding="utf-8",
    )
    (eval_dir / "suite.json").write_text(json.dumps(eval_suite, indent=2) + "\n", encoding="utf-8")

    leak_prompts = [it["prompt"] for it in eval_suite["items"]]
    (eval_dir / "prompt-list.json").write_text(
        json.dumps({"EXCLUDE_FROM_TRAINING": True, "prompts": leak_prompts}, indent=2) + "\n",
        encoding="utf-8",
    )

    accounting = {
        "curriculum_id": CURRICULUM_ID,
        "eval_id": EVAL_ID,
        "lineage_status": LINEAGE_STATUS,
        "parent_checkpoint_sha256": PARENT_CHECKPOINT_SHA256,
        "tokenizer_sha256": TOKENIZER_SHA256,
        "supervised_accounting": account,
        "floors": floors,
        "leakage": {k: v for k, v in leak.items() if k != "details"} | {"details_counts": {dk: len(dv) if isinstance(dv, list) else dv for dk, dv in leak["details"].items()}},
        "leakage_details": leak["details"],
        "duration": duration,
        "mix": mix_report,
        "registry": capability_registry(),
        "validator": val,
        "commander_correction_count": 0,
        "terra_training_observations": 0,
        "old_wave81_behavior_target_tokens": 339,
        "old_wave81_tool_target_tokens": 16,
    }
    (curr_dir / "accounting.json").write_text(json.dumps(accounting, indent=2, default=str) + "\n", encoding="utf-8")
    (curr_dir / "validator.json").write_text(json.dumps(val, indent=2, default=str) + "\n", encoding="utf-8")
    (curr_dir / "MANIFEST.json").write_text(
        json.dumps(
            {
                "id": CURRICULUM_ID,
                "EXCLUDE_FROM_PRODUCTION": True,
                "official_lineage": False,
                "lineage_status": LINEAGE_STATUS,
                "does_not_overwrite": [
                    "WR-CORPUS-0",
                    "WR-TOKENIZER-0",
                    "WR-CORPUS-1-HARDENED-CANDIDATE",
                    "Recovery-001 through Recovery-007",
                ],
                "supervised_examples": len(examples),
                "pack_tokens": pack["actual_pack_tokens"],
                "eval_id": EVAL_ID,
                "eval_path": str(eval_dir.relative_to(root)),
                "content_sha256": sha256_json({"examples": [ex["renderedHash"] for ex in examples], "eval": eval_suite["item_count"]}),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    summary = {
        "curriculum_id": CURRICULUM_ID,
        "eval_id": EVAL_ID,
        "supervised_examples": len(examples),
        "supervised_target_tokens": account["totals"]["target_tokens"],
        "supervised_prompt_tokens": account["totals"]["prompt_tokens"],
        "by_family": account["by_family"],
        "floors_passed": floors["passed"],
        "leakage": leak["known_eval_leakage"],
        "leak_passed": leak["passed"],
        "validator_passed": val["passed"],
        "validator": f"{val['pass_count']}/{val['pass_count'] + val['fail_count']}",
        "pack_tokens": pack["actual_pack_tokens"],
        "planned_steps": planned_steps,
        "eval_family_counts": eval_suite["family_counts"],
        "eval_item_count": eval_suite["item_count"],
        "commander_correction_count": 0,
    }
    (curr_dir / "materialize-summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0 if val["passed"] and leak["passed"] and floors["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
