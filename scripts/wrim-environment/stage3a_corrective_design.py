"""Freeze WRIM1-RUN-000004 STAGE3A corrective design. ZERO optimizer steps.

Does not train. Does not start STAGE3B. Does not mutate corpora.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from tokenizers import Tokenizer

from phase2_grid import sha256_json_text
from stage2_eval import load_diagnostic_items, load_retention_items
from stage3_eval_baseline import NGRAM, char_ngrams, duplication_audit, leakage_audit, normalize_ws
from stage3_eval_items import ITEMS as STAGE3_ITEMS
from stage3_runtime import (
    PARENT_SHA,
    STAGE3_AUTHORIZATION,
    STAGE3B_AUTHORIZATION,
    TOKENIZER_SHA,
    TRAINING_AUTHORIZATION,
    authorization_gate,
    utc_now,
    write_json,
)
from stage3a_adjudication_sets import ITEMS as ADJ_ITEMS
from stage3a_corrective_dev_sets import ITEMS as DEV_ITEMS
from stage3a_corrective_dev_sets import SUITE_ID as DEV_SUITE_ID
from stage3a_corrective_dev_sets import freeze_payload as freeze_dev
from stage3a_corrective_pack import CORRECTIVE_MIX, NEEDED_TRAIN_TOKENS, STEPS, TOTAL_PILOT_TOKENS, TOKENS_PER_STEP, build_corrective_stream
from stage3a_corrective_schedule import run_schedule_unit_tests
from stage3a_review_sets import RETENTION_ITEMS, STRUCT_ITEMS
from stage3a_run import sha256_file

RUN_ID = "WRIM1-RUN-000004"
PARENT_VAL0 = 8.890125
PARENT_VAL1 = 7.971308

SENTINELS = {
    "dnll_abort_gt": 0.105,
    "kl_abort_gt": 0.018,
    "val0_abort_gt": PARENT_VAL0,
    "val1_review_gt": PARENT_VAL1 + 0.30,
    "cap_abort_le": 3,
    "cap_success_ge": 5,
    "cap_total": 6,
    "special_rate_abort_gt": 0.08,
    "special_rate_success_delta": 0.02,
    "collapse_abort_delta": 4,
    "unique128_success_delta": 0.03,
    "instruction_success_delta": 1,
    "json_success_delta": 1,
    "looping_success_delta": 2,
}

EVAL_EXCLUSIONS = [
    "CAP-EVAL-0",
    "WRIM-EVAL-S3-000001",
    "WRIM-EVAL-S3A-RET-000001",
    "WRIM-EVAL-S3A-STRUCT-000001",
    "WRIM-EVAL-S3A-ADJ-000001",
]


def _prompt_items(items: list[dict[str, Any]], *, id_key: str, prompt_keys: tuple[str, ...], suite: str) -> list[dict[str, Any]]:
    out = []
    for it in items:
        prompt = ""
        for k in prompt_keys:
            val = it.get(k)
            if isinstance(val, str) and val:
                prompt = val
                break
        out.append({"item_id": str(it.get(id_key) or it.get("id") or ""), "prompt_text": prompt, "suite": suite})
    return out


def cross_dup(items: list[dict[str, Any]], others: list[dict[str, Any]], label: str) -> dict[str, Any]:
    blocking = []
    for a in items:
        ga = set(char_ngrams(a["prompt_text"], NGRAM))
        na = normalize_ws(a["prompt_text"])
        for b in others:
            gb = set(char_ngrams(b["prompt_text"], NGRAM))
            union = ga | gb
            jac = (len(ga & gb) / len(union)) if union else 0.0
            exact = a["prompt_text"] == b["prompt_text"] or na == normalize_ws(b["prompt_text"])
            if exact or jac >= 0.70:
                blocking.append({"new": a["item_id"], "other": b.get("item_id") or b.get("id"), "suite": label, "jaccard": round(jac, 6)})
    return {"ok": not blocking, "blocking": blocking[:20]}


def freeze_design(
    *,
    weights: Path,
    tokenizer_path: Path,
    dump_root: Path,
    eval_dir: Path,
    report_path: Path,
) -> dict[str, Any]:
    if TRAINING_AUTHORIZATION != "OFF":
        raise SystemExit("TRAINING_AUTHORIZATION must remain OFF")
    gate = authorization_gate(requested_mode="dry-run")
    if gate.get("allowed"):
        raise SystemExit("dry-run gate must not allow optimizer steps")
    if STAGE3B_AUTHORIZATION != "NO":
        raise SystemExit("STAGE3B must remain unauthorized")

    sched = run_schedule_unit_tests()
    if not sched["ok"]:
        payload = {"ok": False, "kind": "CORRECTIVE_STAGE3A_DESIGN_BLOCKED", "reason": "schedule_self_test", "schedule": sched, "optimizer_steps_this_pass": 0, "TRAINING_AUTHORIZATION": "OFF"}
        write_json(report_path, payload)
        return payload

    parent_sha = sha256_file(weights)
    tok_sha = sha256_file(tokenizer_path)
    sha_block = {
        "parent": {"got": parent_sha, "expected": PARENT_SHA, "ok": parent_sha == PARENT_SHA},
        "tokenizer": {"got": tok_sha, "expected": TOKENIZER_SHA, "ok": tok_sha == TOKENIZER_SHA},
    }
    if not all(v["ok"] for v in sha_block.values()):
        payload = {"ok": False, "kind": "CORRECTIVE_STAGE3A_DESIGN_BLOCKED", "reason": "sha_mismatch", "sha": sha_block, "optimizer_steps_this_pass": 0, "TRAINING_AUTHORIZATION": "OFF"}
        write_json(report_path, payload)
        return payload

    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    packed = build_corrective_stream(dump_root=dump_root, tokenizer=tokenizer)
    packed_meta = {k: v for k, v in packed.items() if k != "stream"}
    freeze = freeze_dev()
    items = list(DEV_ITEMS)
    leak = leakage_audit(items, tokenizer, dump_root)
    dup = duplication_audit(items)
    cap_items = _prompt_items(load_retention_items(dump_root), id_key="evalId", prompt_keys=("prompt", "input", "generation_prompt"), suite="CAP-EVAL-0")
    diag_items = _prompt_items(load_diagnostic_items(dump_root), id_key="id", prompt_keys=("input", "prompt"), suite="DIAGNOSTIC-0")
    vs = {
        "stage3": cross_dup(items, STAGE3_ITEMS, "WRIM-EVAL-S3-000001"),
        "ret": cross_dup(items, RETENTION_ITEMS, "WRIM-EVAL-S3A-RET-000001"),
        "struct": cross_dup(items, STRUCT_ITEMS, "WRIM-EVAL-S3A-STRUCT-000001"),
        "adj": cross_dup(items, ADJ_ITEMS, "WRIM-EVAL-S3A-ADJ-000001"),
        "cap": cross_dup(items, cap_items, "CAP-EVAL-0"),
        "diag": cross_dup(items, diag_items, "DIAGNOSTIC-0"),
    }
    audit_ok = bool(leak.get("ok")) and not dup.get("blocking_pairs") and all(v["ok"] for v in vs.values())
    eval_dir.mkdir(parents=True, exist_ok=True)
    dev_path = eval_dir / f"{DEV_SUITE_ID}.json"
    write_json(dev_path, freeze)
    if not audit_ok:
        payload = {
            "ok": False,
            "kind": "CORRECTIVE_STAGE3A_DESIGN_BLOCKED",
            "reason": "dev_set_leakage_or_duplication",
            "leakage_ok": leak.get("ok"),
            "blocking_leakage": leak.get("blocking_item_ids"),
            "blocking_dup": dup.get("blocking_pairs"),
            "cross": {k: v["blocking"] for k, v in vs.items()},
            "TRAINING_AUTHORIZATION": "OFF",
            "optimizer_steps_this_pass": 0,
        }
        write_json(report_path, payload)
        print(json.dumps({"ok": False, "reason": payload["reason"], "blocking_leakage": payload["blocking_leakage"], "cross": payload["cross"]}, indent=2), flush=True)
        return payload

    mix_actual = packed.get("packed_token_percent") or {}
    mix_deviations = {}
    for fam, target in CORRECTIVE_MIX.items():
        actual = float(mix_actual.get(fam, 0.0)) / 100.0
        mix_deviations[fam] = round(actual - target, 4)
    alice_ok = float(packed.get("alice_frac_packed") or 0) <= 0.035
    mix_ok = all(abs(v) <= 0.08 for v in mix_deviations.values()) and alice_ok
    if not mix_ok:
        payload = {
            "ok": False,
            "kind": "CORRECTIVE_STAGE3A_DESIGN_BLOCKED",
            "final_classification": "CORRECTIVE_STAGE3A_DESIGN_BLOCKED",
            "reason": "mix_or_alice_cap_miss",
            "mix_actual_percent": mix_actual,
            "mix_deviations": mix_deviations,
            "alice_frac_packed": packed.get("alice_frac_packed"),
            "packing": packed_meta,
            "dev_suite": {
                "id": DEV_SUITE_ID,
                "path": str(dev_path),
                "sha256": sha256_json_text(dev_path),
                "n_items": 40,
            },
            "TRAINING_AUTHORIZATION": "OFF",
            "optimizer_steps_this_pass": 0,
            "STAGE3B_AUTHORIZATION": "NO",
        }
        write_json(report_path, payload)
        print(json.dumps({"ok": False, "reason": payload["reason"], "mix_actual": mix_actual, "alice": packed.get("alice_frac_packed")}, indent=2), flush=True)
        return payload

    payload = {
        "ok": True,
        "kind": "STAGE3A_CORRECTIVE_TRAINING_DESIGN",
        "WRIM_STAGE3A_CORRECTIVE_DESIGN": "READY",
        "final_classification": "CORRECTIVE_STAGE3A_DESIGN_READY",
        "run_id": RUN_ID,
        "historical_run_id_unmodified": "WRIM1-RUN-000003",
        "created_at": utc_now(),
        "optimizer_steps_this_pass": 0,
        "parameter_update_count_this_pass": 0,
        "TRAINING_AUTHORIZATION": "OFF",
        "STAGE3_AUTHORIZATION": STAGE3_AUTHORIZATION,
        "STAGE3B_AUTHORIZATION": "NO",
        "STAGE3B_EXECUTION_READINESS": False,
        "CORRECTIVE_STAGE3A_EXECUTION_READINESS": False,
        "parent": "WRIM-0",
        "parent_rejected_alternatives": {
            "raw_STEP50": "rejected_unsuitable_drift",
            "STEP25": "rejected_confound_plus_generation_still_fails",
            "interpolants": "rejected_test_only_merge_not_parents",
        },
        "sha": sha_block,
        "authorization_gate": gate,
        "schedule": sched["formula"],
        "schedule_table": sched["table"],
        "schedule_self_test": {"ok": sched["ok"], "passed": sched["passed"]},
        "optimizer": {
            "name": "AdamW",
            "fused": False,
            "betas": [0.9, 0.95],
            "eps": 1e-8,
            "weight_decay": 0.1,
            "grad_clip": 1.0,
            "fresh": True,
            "resume_stage3a_moments": False,
        },
        "peak_lr": 1e-5,
        "min_lr": 1e-6,
        "warmup_steps": 8,
        "steps": STEPS,
        "seq_len": 512,
        "micro_batch": 8,
        "grad_accum": 1,
        "tokens_per_step": TOKENS_PER_STEP,
        "total_pilot_tokens": TOTAL_PILOT_TOKENS,
        "needed_stream_tokens": NEEDED_TRAIN_TOKENS,
        "seed": 4004,
        "precision": "FP32_TF32_OFF",
        "mix": CORRECTIVE_MIX,
        "mix_actual_percent": mix_actual,
        "mix_deviations": mix_deviations,
        "mix_within_8pp": mix_ok,
        "packing": packed_meta,
        "unlikelihood_loss": False,
        "repetition_penalty_training": False,
        "auxiliary_objective": False,
        "curriculum": "NONE_BEYOND_DOCUMENT_MAJOR_PACK",
        "data_weighting": "FAMILY_MIX_PLUS_ALICE_CAP",
        "checkpoints": [0, 5, 10, 15, 20, 25],
        "eval_schedule": {
            "compact_every": [0, 5, 10, 15, 20, 25],
            "compact_metrics": ["dnll", "kl", "val0", "val1", "DEV", "CAP"],
            "full_frozen_adjudication": [0, 25],
            "dev_for_selection": True,
            "frozen_evals_for_selection": False,
        },
        "sentinels": SENTINELS,
        "dev_suite": {
            "id": DEV_SUITE_ID,
            "path": str(dev_path),
            "sha256": sha256_json_text(dev_path),
            "n_items": 40,
            "development_only": True,
            "training_use": "FORBIDDEN",
            "checkpoint_selection_allowed": True,
            "final_eval_suite": False,
        },
        "eval_exclusions": EVAL_EXCLUSIONS,
        "leakage_audit": {"ok": True, "n_haystacks": leak.get("n_haystacks"), "blocking_item_ids": []},
        "cross_suite_ok": {k: v["ok"] for k, v in vs.items()},
        "ready_for_commander_authorization": True,
        "ready_to_run_optimizer": False,
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "QWEN_INTELLIGENCE_CLASS": "THIRD_PARTY_MODEL_RUNNING_LOCALLY",
        "RAEL_STATUS": "NOT_IMPLEMENTED",
        "ROADMAP_22_STATUS": "CLOSED",
        "ROADMAP_23_STATUS": "ACTIVE",
        "nothing_pushed": True,
        "nothing_deployed": True,
    }
    write_json(report_path, payload)
    print(
        json.dumps(
            {
                "ok": True,
                "run_id": RUN_ID,
                "parent": "WRIM-0",
                "peak_lr": 1e-5,
                "steps": 25,
                "tokens": TOTAL_PILOT_TOKENS,
                "dev_sha": payload["dev_suite"]["sha256"],
                "alice_frac": packed.get("alice_frac_packed"),
                "mix_actual": mix_actual,
                "mix_ok": mix_ok,
            },
            indent=2,
        ),
        flush=True,
    )
    return payload


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--weights", required=True)
    p.add_argument("--tokenizer", required=True)
    p.add_argument("--dump-root", required=True)
    p.add_argument("--eval-dir", required=True)
    p.add_argument("--report", required=True)
    args = p.parse_args()
    try:
        out = freeze_design(
            weights=Path(args.weights),
            tokenizer_path=Path(args.tokenizer),
            dump_root=Path(args.dump_root),
            eval_dir=Path(args.eval_dir),
            report_path=Path(args.report),
        )
    except Exception as exc:
        Path(args.report).parent.mkdir(parents=True, exist_ok=True)
        write_json(
            Path(args.report),
            {
                "ok": False,
                "kind": "CORRECTIVE_STAGE3A_DESIGN_BLOCKED",
                "final_classification": "CORRECTIVE_STAGE3A_DESIGN_BLOCKED",
                "error": str(exc),
                "TRAINING_AUTHORIZATION": "OFF",
                "optimizer_steps_this_pass": 0,
            },
        )
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2), flush=True)
        return 1
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
