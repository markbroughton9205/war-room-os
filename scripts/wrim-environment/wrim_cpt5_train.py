"""WRIM1-CPT-000005 Stage B continued-foundation trainer.

Does not train unless BOTH are present:
  --authorize-wrim1-cpt-000005
  env WRIM_TRAINING_AUTHORIZATION=ON_FOR_WRIM1_CPT_000005_ONLY

New run ID. Experimental parent is CPT-000004/step-50. Canonical remains STEP_400.
Preserves optimizer/LR/RNG lineage. Does not resume CPT-000002 or CPT-000003.
Does not restart warmup. Unsets WRIM_TRAINING_AUTHORIZATION on every exit path.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import time
import traceback
from pathlib import Path
from typing import Any

from wrim_cpt5_identity import (
    ARCHITECTURE_ID,
    AUTHORIZE_ENV_NAME,
    AUTHORIZE_FLAG,
    B1_EVAL_STEPS,
    B1_LR,
    B1_MAX_TOKENS,
    B1_STEPS,
    B1_WARMUP,
    BETAS,
    CANONICAL_CHECKPOINT,
    CANONICAL_HASH,
    CKPT_ROOT,
    CORPUS_ID,
    CORPUS_VERSION,
    CPT000004_STAGE3_COLLAPSE,
    CPT000004_STAGE3_DELTA_VS_WRIM0,
    CPT_RUN_ID,
    CUMULATIVE_PARENT_STEPS,
    CUMULATIVE_PARENT_TOKENS,
    DATA_ROOT,
    EPS,
    EVAL_SEED,
    EXPECTED_CORPUS_HASH,
    EXPECTED_MANIFEST_HASH,
    EXPECTED_PARENT_MODEL_HASH,
    EXPECTED_PARENT_OPTIMIZER_HASH,
    EXPECTED_PARENT_RNG_HASH,
    EXPECTED_PARENT_SCHEDULER_HASH,
    EXPECTED_TRAIN_HASH,
    EXPECTED_VAL_HASH,
    EXPERIMENTAL_PARENT_CHECKPOINT,
    EXPERIMENTAL_PARENT_CKPT,
    EXPERIMENTAL_PARENT_STEP,
    FORBIDDEN_PARENT_PREFIXES,
    GRAD_CLIP,
    GRAD_HARD,
    GRAD_REVIEW,
    GRAD_WARN,
    INDEPENDENT_NL_MANIFEST_HASH_EXPECTED,
    INDEPENDENT_NL_PACK,
    INDEPENDENT_NL_PACK_HASH_EXPECTED,
    LR_SCHEDULE_ID,
    MASK_PROMPT_TOKENS,
    MICRO_BATCH,
    MISSION_ORIGIN,
    OBJECTIVE,
    PACK_TARGET_TOKENS,
    PACKER_FIX_HASH,
    PACKER_VERSION,
    PARAMETER_COUNT,
    PARENT_CHECKPOINT,
    PARENT_HASH,
    PARENT_WRIM0_HASH,
    PRIOR_EXPERIMENTAL_CKPT_ROOT,
    PRIOR_EXPERIMENTAL_RUN,
    REPORT_FILENAME,
    RETIRED_CKPT_ROOTS,
    RETIRED_CPT_RUNS,
    ROLE_TARGET_STEPS,
    SEED,
    SEQ_LEN,
    STAGE_A_STALE_VALUE,
    STAGE_B_AUTHORIZE_ENV_VALUE,
    STAGE_B_CPT000002_STALE_VALUE,
    STAGE_B_CPT000003_STALE_VALUE,
    STAGE_B_CPT000004_STALE_VALUE,
    STAGE3_OBSERVE_STEPS,
    STEP400_STAGE3_COLLAPSE,
    STEP400_STAGE3_DELTA_VS_WRIM0,
    TOKENIZER_EXPECTED_SHA,
    TOKENIZER_ID,
    TOKENS_PER_STEP,
    WEIGHT_DECAY,
)
from wrim_cpt_identity import (
    ADDENDUM_SHA,
    ASSISTANT_ID,
    COMMANDER_ID,
    LINUX_CKPT_ROOT,
    LINUX_VENV_PYTHON,
    SUITE_SHA,
)
from wrim_cpt_stage_b_identity import PROVISIONAL_STAGE_B_PARENT_CHECKPOINT


CODE_INTRUSION_RE = re.compile(r"\b(const|export|function|import)\b|from ['\"]|module\.exports")
MARKDOWN_INTRUSION_RE = re.compile(r"(^#{1,3}\s)|```|(^\*\s)", re.M)
PATH_INTRUSION_RE = re.compile(r"research-engine|app/api|lib/|docs/war-room")


def authorization_ok(argv: list[str] | None = None) -> bool:
    import sys

    args = argv if argv is not None else sys.argv[1:]
    env = os.environ.get(AUTHORIZE_ENV_NAME)
    if env in {
        STAGE_A_STALE_VALUE,
        STAGE_B_CPT000002_STALE_VALUE,
        STAGE_B_CPT000003_STALE_VALUE,
        STAGE_B_CPT000004_STALE_VALUE,
    }:
        return False
    return AUTHORIZE_FLAG in args and env == STAGE_B_AUTHORIZE_ENV_VALUE


def unset_training_authorization() -> None:
    os.environ.pop(AUTHORIZE_ENV_NAME, None)


def denial_payload(reason: str) -> dict[str, Any]:
    present = AUTHORIZE_ENV_NAME in os.environ
    value = os.environ.get(AUTHORIZE_ENV_NAME)
    return {
        "ok": False,
        "kind": "WRIM1_CPT_000005_TRAINING_DENIED",
        "CPT_RUN_ID": CPT_RUN_ID,
        "reason": reason,
        "WRIM_TRAINING_AUTHORIZATION": "UNSET" if not present else "SET_BUT_REJECTED",
        "stale_stage_a_token_present": value == STAGE_A_STALE_VALUE,
        "TRAINING_AUTHORIZATION_ACTIVE": "NO",
        "TRAINING_AUTHORIZATION_FINAL": "OFF",
        "OPTIMIZER_CREATED": "NO",
        "BACKWARD_EXECUTED": "NO",
        "OPTIMIZER_STEPS": 0,
        "optimizer_steps": 0,
        "AdamW_constructed": False,
        "gradient_allocated": False,
        "checkpoint_mutated": False,
        "training_executed": False,
        "STAGE_B_EXECUTED": "NO",
        "SFT_EXECUTED": "NO",
        "RUN_000013_EXECUTED": "NO",
        "STAGE3B_EXECUTED": "NO",
        "CANONICAL_PROMOTED": "NO",
        "RAEL_PROMOTED": False,
        "WRIM0_MODIFIED": False,
        "TOKENIZER_MODIFIED": False,
        "ARCHITECTURE_MODIFIED": False,
        "COMMIT": False,
        "PUSH": False,
        "DEPLOY": False,
    }


def lr_cpt_000005(step: int) -> float:
    """Continuation LR: constant 5e-5. Warmup already completed in CPT-000004."""
    del step
    return float(B1_LR)


def freeze_schedule() -> dict[str, float]:
    return {str(s): lr_cpt_000005(s) for s in range(1, B1_STEPS + 1)}


def jsonable_packing(packing: dict[str, Any]) -> dict[str, Any]:
    out = {}
    for k, v in packing.items():
        if str(k).startswith("_"):
            continue
        try:
            json.dumps(v)
            out[k] = v
        except TypeError:
            out[k] = str(v)
    return out


def rng_snapshot() -> dict[str, Any]:
    import numpy as np
    import torch

    py_state = random.getstate()
    np_state = np.random.get_state()
    return {
        "python_seed": SEED,
        "numpy_seed": SEED,
        "torch_cpu_seed": SEED,
        "torch_cuda_seed": SEED,
        "python_getstate_hash": hashlib.sha256(repr(py_state).encode()).hexdigest(),
        "numpy_state_hash": hashlib.sha256(np.asarray(np_state[1]).tobytes()).hexdigest(),
        "torch_cpu_rng_hash": hashlib.sha256(repr(torch.random.get_rng_state().tolist()).encode()).hexdigest(),
        "torch_cuda_rng_hash": (
            hashlib.sha256(repr(torch.cuda.get_rng_state().tolist()).encode()).hexdigest()
            if torch.cuda.is_available()
            else None
        ),
    }


def file_sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def slim_foundation(ev: dict[str, Any]) -> dict[str, Any]:
    keep = dict(ev)
    items = []
    for it in list(ev.get("items") or []):
        row = {
            k: it.get(k)
            for k in (
                "item_id",
                "family",
                "ARGMAX_TOKEN",
                "ARGMAX_LOGIT",
                "TARGET_TOKEN",
                "TARGET_LOGIT",
                "TARGET_RANK",
                "LOGIT_GAP",
                "greedy",
                "greedy_exact",
                "eos",
            )
        }
        top = (it.get("TOP_10") or [])[:5]
        row["TOP_5"] = top
        items.append(row)
    keep["items"] = items
    return keep


def slim_nl(ev: dict[str, Any]) -> dict[str, Any]:
    keep = {k: v for k, v in ev.items() if k != "generations"}
    gens = []
    for g in list(ev.get("generations") or [])[:4]:
        gens.append(
            {
                k: g.get(k)
                for k in (
                    "passage_id",
                    "category",
                    "nll",
                    "continuation",
                    "tag_fragment",
                    "repeated_token",
                    "newline_first",
                    "eos_stopped",
                )
            }
        )
    keep["sample_generations"] = gens
    keep["n_passages"] = ev.get("n_passages")
    return keep


def inspect_cpt000005(ckpt_root: Path) -> dict[str, Any]:
    from wrim_resumable_checkpoint import is_complete_checkpoint, latest_complete_checkpoint, load_manifest

    origin_path = ckpt_root / "run-origin.json"
    origin = None
    if origin_path.is_file():
        try:
            origin = json.loads(origin_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            origin = {"unreadable": True}
    created_by_this_mission = bool(origin) and origin.get("CREATED_BY_MISSION") == MISSION_ORIGIN
    if origin and origin.get("CPT_RUN_ID") in (*RETIRED_CPT_RUNS, PRIOR_EXPERIMENTAL_RUN):
        created_by_this_mission = False
    latest = latest_complete_checkpoint(ckpt_root) if ckpt_root.is_dir() else None
    abort = ckpt_root / "abort.json"
    summary = ckpt_root / "training-summary.json"
    hard = False
    hard_reason = None
    markers = (
        "HARD_STOP_GATE",
        "NaN_or_Inf_loss",
        "gradient_hard_stop",
        "token_cap",
        "FOUNDATION_RANK_DEGRADE",
        "INDEPENDENT_NL_NLL_WORSE",
    )
    for p in (abort, summary):
        if not p.is_file():
            continue
        try:
            obj = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if obj.get("HARD_STOP_TRIGGERED") or obj.get("action") == "HARD_STOP":
            hard = True
            hard_reason = obj.get("stop_reason") or obj.get("reason")
        sr = str(obj.get("stop_reason") or "")
        if any(m.lower() in sr.lower() for m in markers):
            hard = True
            hard_reason = sr
    weights = list(ckpt_root.rglob("model.safetensors")) if ckpt_root.is_dir() else []
    return {
        "exists": ckpt_root.is_dir(),
        "path": str(ckpt_root),
        "origin": origin,
        "created_by_this_mission": created_by_this_mission,
        "latest_complete_checkpoint": str(latest) if latest else None,
        "latest_complete": is_complete_checkpoint(latest) if latest else False,
        "manifest": load_manifest(latest) if latest and is_complete_checkpoint(latest) else None,
        "HARD_STOP": hard,
        "HARD_STOP_REASON": hard_reason,
        "has_any_weights": len(weights) > 0,
    }


def resume_decision_cpt5(inspect: dict[str, Any]) -> dict[str, Any]:
    if inspect.get("HARD_STOP"):
        return {
            "action": "REFUSE_RESUME",
            "ok": False,
            "reason": "prior_safety_hard_stop",
            "HARD_STOP_REASON": inspect.get("HARD_STOP_REASON"),
        }
    if inspect.get("created_by_this_mission") and inspect.get("latest_complete"):
        return {
            "action": "RESUME_SAME_RUN",
            "ok": True,
            "checkpoint": inspect.get("latest_complete_checkpoint"),
        }
    if inspect.get("exists") and inspect.get("has_any_weights") and not inspect.get("created_by_this_mission"):
        return {
            "action": "RETURN_STATE_TO_COMMANDER",
            "ok": False,
            "reason": "existing_cpt_run_not_created_by_this_mission",
        }
    return {"action": "START_FRESH", "ok": True, "RUN_ID_UNUSED_BEFORE_START": not inspect.get("exists")}


def classify_greedy_probe(text: str, new_ids: list[int] | None = None) -> dict[str, Any]:
    t = text or ""
    code = bool(CODE_INTRUSION_RE.search(t))
    md = bool(MARKDOWN_INTRUSION_RE.search(t))
    path = bool(PATH_INTRUSION_RE.search(t))
    from wrim_val_nl_independent import TAG_RE, SPACED_TAG_RE

    tag = bool(TAG_RE.search(t) or SPACED_TAG_RE.search(t))
    ids = list(new_ids or [])
    repeats = bool(ids) and max(__import__("collections").Counter(ids).values()) >= 8
    premature = bool(ids) and 2 in ids[:4]
    first_nl = bool(ids) and ids[0] == 112
    loop = bool(re.search(r"(_\s*){6,}", t))
    prose = (not code and not md and not path and not tag and not repeats and not loop and len(t.strip()) > 8)
    return {
        "code_intrusion": code,
        "markdown_intrusion": md,
        "path_intrusion": path,
        "role_tag_contamination": tag,
        "repetition": repeats,
        "premature_eos": premature,
        "document_continuation": first_nl,
        "tokenizer_loop": loop,
        "prose_continuation": prose,
    }


def nl_probe_rates(ev: dict[str, Any]) -> dict[str, Any]:
    gens = list(ev.get("generations") or [])
    n = max(1, len(gens))
    labels = [classify_greedy_probe(g.get("continuation") or "") for g in gens]
    def rate(key: str) -> float:
        return sum(1 for x in labels if x.get(key)) / n

    return {
        "code_intrusion_rate": rate("code_intrusion"),
        "markdown_intrusion_rate": rate("markdown_intrusion"),
        "path_intrusion_rate": rate("path_intrusion"),
        "prose_continuation_count": sum(1 for x in labels if x.get("prose_continuation")),
        "prose_continuation_rate": rate("prose_continuation"),
        "n": len(gens),
    }


def foundation_tag_emissions(found: dict[str, Any]) -> int:
    from wrim_val_nl_independent import TAG_RE, SPACED_TAG_RE

    n = 0
    for it in found.get("items") or []:
        fam = str(it.get("family") or "")
        if fam in {"role", "role_boundary", "tag"}:
            continue
        g = str(it.get("greedy") or "")
        if TAG_RE.search(g) or SPACED_TAG_RE.search(g):
            n += 1
    return n


def success_at_checkpoint(step: int, found: dict[str, Any], nl: dict[str, Any], val: dict[str, Any], s3: dict[str, Any] | None, probes: dict[str, Any], parent_probes: dict[str, Any] | None) -> dict[str, Any]:
    checks = {
        "independent_nl_nll_le_7_10": (nl.get("natural_language_nll_mean") is not None and float(nl["natural_language_nll_mean"]) <= 7.10),
        "independent_nl_newline_le_0_075": float(nl.get("NEWLINE_ATTRACTOR_RATE") or 99) <= 0.075,
        "independent_nl_repeat_le_0_25": float(nl.get("repeated_token_rate") or 99) <= 0.25,
        "independent_nl_tag_eq_0": float(nl.get("tag_fragment_rate") or 99) == 0.0,
        "code_intrusion_below_parent": (
            parent_probes is None
            or float(probes.get("code_intrusion_rate") or 99) < float(parent_probes.get("code_intrusion_rate") or 0)
        ),
        "markdown_intrusion_below_parent": (
            parent_probes is None
            or float(probes.get("markdown_intrusion_rate") or 99) < float(parent_probes.get("markdown_intrusion_rate") or 0)
        ),
        "prose_continuation_ge_1": int(probes.get("prose_continuation_count") or 0) >= 1,
        "foundation_rank_le_2200": (found.get("ASSISTANT_BOUNDARY_TARGET_RANK") is not None and float(found["ASSISTANT_BOUNDARY_TARGET_RANK"]) <= 2200),
        "foundation_top5_ge_6": int(found.get("ASSISTANT_BOUNDARY_TOP5_COUNT") or 0) >= 6,
        "stage3_historical_ge_5": s3 is None or int(s3.get("historical_pass_count") or 0) >= 5,
        "code_nll_le_5_50": val.get("code") is not None and float(val["code"]) <= 5.50,
        "json_nll_le_4_90": val.get("json") is not None and float(val["json"]) <= 4.90,
        "eos_argmax_ge_0_45": ((val.get("eos") or {}).get("EOS_ARGMAX_ACCURACY") is not None and float((val.get("eos") or {})["EOS_ARGMAX_ACCURACY"]) >= 0.45),
    }
    return {"step": step, "all": all(checks.values()), "checks": checks}


def next_commander_boundary(hard: bool, complete: bool) -> str:
    if hard:
        return (
            "STOP. WRIM1-CPT-000005 hard-stopped. WRIM_TRAINING_AUTHORIZATION=OFF. "
            "Do not start step 101+. Do not resume CPT-000002, CPT-000003, or CPT-000004. "
            "Do not start CPT-000006. Do not promote. Canonical remains STEP_400. "
            "Do not commit, push, or deploy. Return to Commander."
        )
    if complete:
        return (
            "STOP. WRIM1-CPT-000005 continued-foundation run complete pending Commander review. "
            "WRIM_TRAINING_AUTHORIZATION=OFF. Do not auto-extend past 100 new steps. "
            "Do not start CPT-000006, SFT, Stage 3B, or promotion. Canonical remains STEP_400. "
            "Do not commit, push, or deploy."
        )
    return (
        "STOP. WRIM1-CPT-000005 exited. WRIM_TRAINING_AUTHORIZATION=OFF. "
        "Do not continue without a new Commander authorization envelope."
    )


def run_authorized_training(args: argparse.Namespace) -> dict[str, Any]:
    import numpy as np
    import torch
    from tokenizers import Tokenizer

    from run000007_env import verify_linux_env
    from run000007_preflight import resolve_dump_root, sha256_file
    from run000007_vram import ensure_vram_for_training, start_user_ollama
    from stage1_pack import slice_contiguous_batches
    from stage3_runtime import parent_pointer, write_abort, write_json
    from wrim_cpt_eval import evaluate_foundation, family_nll
    from wrim_cpt_preflight import locate_addendum, locate_baseline, locate_suite
    from wrim_cpt_stage_b_corpus import (
        b1_warnings,
        collect_forbidden_texts,
        corpus_root,
        leak_scan_docs,
        load_jsonl,
        tokenize_docs,
        val_family_id_packs,
    )
    from wrim_cpt5_gates import cpt5_hard_gate_hits, interval_trend, self_test_cpt5_gates
    from wrim_cpt5_packer import preview_and_train_pack_cpt5
    from wrim_g20m import WRIM0Model
    from wrim_proven_load import disable_tf32
    from wrim_resumable_checkpoint import (
        MODEL_NAME,
        disk_preflight,
        latest_complete_checkpoint,
        move_optimizer_state_to_device,
        restore_resumable_checkpoint,
        restore_rng,
        save_resumable_checkpoint,
        schedule_hash,
    )
    from wrim_train_liveness import (
        TerminationCapture,
        disk_free_bytes,
        oom_kill_evidence,
        ram_rss_bytes,
        utc_now,
        vram_free_mib,
        write_heartbeat,
    )
    from wrim_val_nl_independent import eval_candidate

    ckpt_root = Path(args.ckpt).resolve()
    retired_roots = [Path(p).resolve() for p in RETIRED_CKPT_ROOTS]
    prior_root = Path(PRIOR_EXPERIMENTAL_CKPT_ROOT).resolve()
    report_path = Path(args.report)
    commander_report_path = Path(args.commander_report) if getattr(args, "commander_report", None) else (Path(DATA_ROOT) / REPORT_FILENAME)
    env = verify_linux_env(python_bin=LINUX_VENV_PYTHON)
    if not env["ok"]:
        payload = {**denial_payload("training_environment_mismatch"), "env": env}
        write_json(report_path, payload)
        return payload

    if ckpt_root in retired_roots or ckpt_root == prior_root or any(rid in str(ckpt_root) for rid in (*RETIRED_CPT_RUNS, PRIOR_EXPERIMENTAL_RUN)):
        payload = denial_payload("refuses_to_write_or_resume_prior_or_retired_cpt_run")
        write_json(report_path, payload)
        return payload

    inspect = inspect_cpt000005(ckpt_root)
    decision = resume_decision_cpt5(inspect)
    resume_mode = decision.get("action") == "RESUME_SAME_RUN"
    process_restart_count = 0
    resume_count = 0
    resume_steps: list[int] = []
    if decision.get("action") in {"RETURN_STATE_TO_COMMANDER", "REFUSE_RESUME"}:
        payload = {
            **denial_payload(str(decision.get("reason") or "existing_cpt_run")),
            "inspect": inspect,
            "resume_decision": decision,
        }
        write_json(report_path, payload)
        return payload

    dump = resolve_dump_root(args.dump_root)
    if dump is None:
        payload = denial_payload("dump_root_missing")
        write_json(report_path, payload)
        return payload

    wrim0_weights = dump / "model-lab" / "manifests" / "wrim0_checkpoints" / "checkpoint-final.safetensors"
    tokenizer_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    step400_weights = Path(LINUX_CKPT_ROOT) / PROVISIONAL_STAGE_B_PARENT_CHECKPOINT / MODEL_NAME
    exp_parent = Path(EXPERIMENTAL_PARENT_CKPT)
    exp_model = exp_parent / MODEL_NAME
    exp_opt = exp_parent / "optimizer.pt"
    exp_sched = exp_parent / "scheduler.pt"
    exp_rng = exp_parent / "rng-state.pt"
    wrim0_hash = sha256_file(wrim0_weights)
    tok_hash = sha256_file(tokenizer_path)
    canonical_hash = sha256_file(step400_weights)
    if not exp_parent.is_dir() or not exp_model.is_file() or not exp_opt.is_file():
        payload = denial_payload("experimental_parent_checkpoint_missing")
        write_json(report_path, payload)
        return payload
    parent_model_hash = sha256_file(exp_model)
    parent_opt_hash = sha256_file(exp_opt)
    parent_sched_hash = sha256_file(exp_sched) if exp_sched.is_file() else None
    parent_rng_hash = sha256_file(exp_rng) if exp_rng.is_file() else None
    if any(parent_model_hash.startswith(p) for p in FORBIDDEN_PARENT_PREFIXES):
        payload = {
            **denial_payload("forbidden_parent_or_hash_mismatch"),
            "parent_live": parent_model_hash,
            "PARENT_EXPECTED": EXPECTED_PARENT_MODEL_HASH,
        }
        write_json(report_path, payload)
        return payload
    hash_gate = {
        "CORPUS_EXPECTED": EXPECTED_CORPUS_HASH,
        "CANONICAL_EXPECTED": CANONICAL_HASH,
        "CANONICAL": CANONICAL_CHECKPOINT,
        "EXPERIMENTAL_PARENT": EXPERIMENTAL_PARENT_CHECKPOINT,
        "PARENT_MODEL_EXPECTED": EXPECTED_PARENT_MODEL_HASH,
        "PARENT_OPTIMIZER_EXPECTED": EXPECTED_PARENT_OPTIMIZER_HASH,
        "TOKENIZER_EXPECTED": TOKENIZER_EXPECTED_SHA,
        "WRIM0_EXPECTED": PARENT_WRIM0_HASH,
        "canonical_live": canonical_hash,
        "parent_model_live": parent_model_hash,
        "parent_optimizer_live": parent_opt_hash,
        "parent_scheduler_live": parent_sched_hash,
        "parent_rng_live": parent_rng_hash,
        "tokenizer_live": tok_hash,
        "wrim0_live": wrim0_hash,
        "canonical_ok": canonical_hash == CANONICAL_HASH,
        "parent_model_ok": parent_model_hash == EXPECTED_PARENT_MODEL_HASH,
        "parent_optimizer_ok": parent_opt_hash == EXPECTED_PARENT_OPTIMIZER_HASH,
        "parent_scheduler_ok": parent_sched_hash == EXPECTED_PARENT_SCHEDULER_HASH,
        "parent_rng_ok": parent_rng_hash == EXPECTED_PARENT_RNG_HASH,
        "tokenizer_ok": tok_hash == TOKENIZER_EXPECTED_SHA,
        "wrim0_unchanged": wrim0_hash == PARENT_WRIM0_HASH,
        "CANONICAL_CHANGED": False,
    }
    if not (
        hash_gate["canonical_ok"]
        and hash_gate["parent_model_ok"]
        and hash_gate["parent_optimizer_ok"]
        and hash_gate["tokenizer_ok"]
        and hash_gate["wrim0_unchanged"]
    ):
        payload = {**denial_payload("parent_or_frozen_hash_mismatch"), "hash_gate": hash_gate}
        write_json(report_path, payload)
        return payload

    root = corpus_root()
    man_p = root / f"{CORPUS_VERSION}-MANIFEST.json"
    sha_p = root / f"{CORPUS_VERSION}-SHA256.json"
    train_p = root / f"{CORPUS_VERSION}-TRAIN.jsonl"
    val_p = root / f"{CORPUS_VERSION}-VAL.jsonl"
    if not all(p.is_file() for p in (man_p, sha_p, train_p, val_p)):
        payload = denial_payload("cpt2_corpus_not_frozen")
        write_json(report_path, payload)
        return payload
    corpus_manifest = json.loads(man_p.read_text(encoding="utf-8"))
    sha_doc = json.loads(sha_p.read_text(encoding="utf-8"))
    live_train = sha256_file(train_p)
    live_val = sha256_file(val_p)
    corpus_hash = sha_doc.get("CORPUS_HASH") or corpus_manifest.get("CORPUS_HASH")
    hash_gate.update(
        {
            "corpus_live": corpus_hash,
            "train_live": live_train,
            "val_live": live_val,
            "corpus_ok": corpus_hash == EXPECTED_CORPUS_HASH,
            "manifest_live": sha256_file(man_p),
            "manifest_ok": sha256_file(man_p) == EXPECTED_MANIFEST_HASH,
            "train_ok": live_train == EXPECTED_TRAIN_HASH,
            "val_ok": live_val == EXPECTED_VAL_HASH,
        }
    )
    if not (hash_gate["corpus_ok"] and hash_gate["train_ok"] and hash_gate["val_ok"] and hash_gate["manifest_ok"]):
        payload = {**denial_payload("corpus_hash_mismatch"), "hash_gate": hash_gate}
        write_json(report_path, payload)
        return payload

    nl_root = Path(DATA_ROOT) / INDEPENDENT_NL_PACK
    nl_passages_path = nl_root / f"{INDEPENDENT_NL_PACK}-PASSAGES.jsonl"
    nl_sha_path = nl_root / f"{INDEPENDENT_NL_PACK}-SHA256.json"
    nl_man_path = nl_root / f"{INDEPENDENT_NL_PACK}-MANIFEST.json"
    if not nl_passages_path.is_file():
        payload = denial_payload("independent_nl_pack_missing")
        write_json(report_path, payload)
        return payload
    nl_sha_doc = json.loads(nl_sha_path.read_text(encoding="utf-8")) if nl_sha_path.is_file() else {}
    live_nl_pack = nl_sha_doc.get("PACK_HASH")
    live_nl_man = sha256_file(nl_man_path) if nl_man_path.is_file() else None
    hash_gate.update(
        {
            "independent_nl_pack_live": live_nl_pack,
            "independent_nl_manifest_live": live_nl_man,
            "independent_nl_ok": live_nl_pack == INDEPENDENT_NL_PACK_HASH_EXPECTED,
        }
    )
    if not hash_gate["independent_nl_ok"]:
        payload = {**denial_payload("independent_nl_hash_mismatch"), "hash_gate": hash_gate}
        write_json(report_path, payload)
        return payload

    ollama_restored = False
    vram = ensure_vram_for_training()
    ollama_stopped = bool(vram.get("OLLAMA_STOPPED_FOR_TRAINING"))
    if not vram["ok"]:
        payload = {**denial_payload("insufficient_vram"), "vram": vram, "hash_gate": hash_gate}
        if ollama_stopped:
            start_user_ollama()
            ollama_restored = True
            payload["OLLAMA_RESTORED"] = True
        write_json(report_path, payload)
        return payload

    disk = disk_preflight(
        ckpt_root,
        n_full_checkpoints=6,
        bytes_per_checkpoint=400_000_000,
        eval_bytes=1_000_000_000,
        extra_bytes=1_000_000_000,
    )
    if not disk["ok"]:
        payload = {**denial_payload("insufficient_disk_for_checkpoints"), "DISK_PREFLIGHT": disk, "hash_gate": hash_gate}
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload

    lr_table = freeze_schedule()
    if not all(abs(float(v) - float(B1_LR)) < 1e-12 for v in lr_table.values()):
        payload = {**denial_payload("lr_schedule_not_constant_continuation"), "lr_table_sample": {k: lr_table[k] for k in ("1", "10", "100") if k in lr_table}}
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload
    # Packer is independently seeded. Training RNG is restored from the experimental parent after optimizer load.
    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    from safetensors.torch import load_file as load_safetensors_file

    model = WRIM0Model()
    try:
        parent_state = load_safetensors_file(str(exp_model))
        model.load_state_dict(parent_state, strict=True)
        model.to(device)
        canonical_cpu = {k: v.detach().cpu().clone() for k, v in load_safetensors_file(str(step400_weights)).items()}
    except Exception as exc:
        payload = {
            **denial_payload("experimental_parent_load_failed"),
            "PYTHON_EXCEPTION": f"{type(exc).__name__}: {exc}",
            "hash_gate": hash_gate,
            "HARD_STOP_TRIGGERED": False,
            "stop_reason": "PROCESS_EXCEPTION",
        }
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload

    here = Path(__file__).resolve().parent
    packer_fix_live = file_sha(here / "wrim_cpt3_packer.py")
    if packer_fix_live != PACKER_FIX_HASH:
        payload = {
            **denial_payload("packer_fix_hash_mismatch"),
            "packer_fix_live": packer_fix_live,
            "PACKER_FIX_HASH": PACKER_FIX_HASH,
        }
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload
    gate_test = self_test_cpt5_gates()
    if not gate_test.get("ok"):
        payload = {
            **denial_payload("retention_gate_implementation_tests_fail"),
            "gate_test": gate_test,
        }
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload

    train_docs = load_jsonl(train_p)
    val_docs = load_jsonl(val_p)
    train_tok = tokenize_docs(train_docs, tokenizer)
    val_tok = tokenize_docs(val_docs, tokenizer)
    packer_bundle = preview_and_train_pack_cpt5(train_tok)
    packer_gate = {
        "PACKER_VALIDATION": packer_bundle.get("PACKER_VALIDATION"),
        "ROLE_PLACEMENT_VALIDATION": packer_bundle.get("ROLE_PLACEMENT_VALIDATION"),
        "ROLE_WINDOW_STEPS": packer_bundle.get("ROLE_WINDOW_STEPS"),
        "ROLE_WINDOWS_TOTAL": packer_bundle.get("ROLE_WINDOWS_TOTAL"),
        "ROLE_FIRST_EXPOSURE": packer_bundle.get("ROLE_FIRST_EXPOSURE"),
        "ROLE_LAST_EXPOSURE": packer_bundle.get("ROLE_LAST_EXPOSURE"),
        "NO_END_OF_RUN_ROLE_DUMP": packer_bundle.get("NO_END_OF_RUN_ROLE_DUMP"),
        "ALL_12_FAMILIES_MIXED": packer_bundle.get("ALL_12_FAMILIES_MIXED"),
        "MAX_GENESIS_PER_BATCH": packer_bundle.get("MAX_GENESIS_PER_BATCH"),
        "MAX_JSON_PER_BATCH": packer_bundle.get("MAX_JSON_PER_BATCH"),
        "MAX_ROLE_PER_BATCH": packer_bundle.get("MAX_ROLE_PER_BATCH"),
        "MAX_TECHNICAL_PER_BATCH": packer_bundle.get("MAX_TECHNICAL_PER_BATCH"),
        "MAX_SAME_DOCUMENT_PER_BATCH": packer_bundle.get("MAX_SAME_DOCUMENT_PER_BATCH"),
        "failures": packer_bundle.get("failures"),
        "PREVIEW_STEPS": packer_bundle.get("PREVIEW_STEPS"),
        "TRAIN_STEPS": packer_bundle.get("TRAIN_STEPS"),
        "packer_version": PACKER_VERSION,
        "packer_fix_hash": packer_fix_live,
        "family_totals_preserved": packer_bundle.get("family_totals_preserved"),
        "swaps": packer_bundle.get("swaps"),
        "gate_test": gate_test,
    }
    if not packer_bundle.get("ok"):
        payload = {
            **denial_payload("packer_validation_fail"),
            "packer_gate": packer_gate,
            "FAMILY_COUNTS_PER_BATCH": packer_bundle.get("FAMILY_COUNTS_PER_BATCH"),
            "DOCUMENT_COUNTS_PER_BATCH": packer_bundle.get("DOCUMENT_COUNTS_PER_BATCH"),
            "hash_gate": hash_gate,
            "OPTIMIZER_CREATED": "NO",
            "AdamW_constructed": False,
        }
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload
    packing = packer_bundle["train"]
    stream = packing.pop("_stream")
    packing.pop("_batches", None)
    batch_meta = list(packing.get("batch_meta") or [])
    val_packs = val_family_id_packs(val_tok)
    if stream is None or int(getattr(stream, "size", 0) or 0) < PACK_TARGET_TOKENS:
        payload = denial_payload("packed_stream_too_short")
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload
    batches = slice_contiguous_batches(stream, B1_STEPS, MICRO_BATCH, SEQ_LEN)
    parent_cpu = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}

    forbidden = collect_forbidden_texts(dump)
    leak = leak_scan_docs(train_docs, forbidden)
    val_leak = bool(leak.get("EXACT_DUPLICATES") or leak.get("LONG_SPAN_OVERLAP_GE_48") or leak.get("NEEDLE_HITS"))
    if val_leak:
        payload = {
            **denial_payload("MEMORIZATION_LEAKAGE"),
            "HARD_STOP_TRIGGERED": True,
            "stop_reason": "MEMORIZATION_LEAKAGE",
            "leak": {k: leak.get(k) for k in ("EXACT_DUPLICATES", "LONG_SPAN_OVERLAP_GE_48", "NEEDLE_HITS")},
        }
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload

    nl_rows = load_jsonl(nl_passages_path)

    ckpt_root.mkdir(parents=True, exist_ok=True)
    evals_dir = ckpt_root / "evals"
    evals_dir.mkdir(parents=True, exist_ok=True)
    write_json(ckpt_root / "parent_pointer.json", {
        **parent_pointer(weights_path=exp_model, parent_sha=EXPECTED_PARENT_MODEL_HASH),
        "EXPERIMENTAL_PARENT": EXPERIMENTAL_PARENT_CHECKPOINT,
        "CANONICAL": CANONICAL_CHECKPOINT,
        "CANONICAL_HASH": CANONICAL_HASH,
        "PARENT_OPTIMIZER_HASH": parent_opt_hash,
        "LINEAGE": [CANONICAL_CHECKPOINT, EXPERIMENTAL_PARENT_CHECKPOINT, CPT_RUN_ID],
    })
    write_json(
        ckpt_root / "run-origin.json",
        {"CREATED_BY_MISSION": MISSION_ORIGIN, "CPT_RUN_ID": CPT_RUN_ID, "STAGE": "B1_CONTINUED_FOUNDATION_100", "timestamp": utc_now(), "RETIRED_RUNS": list(RETIRED_CPT_RUNS), "EXPERIMENTAL_PARENT": EXPERIMENTAL_PARENT_CHECKPOINT, "CANONICAL": CANONICAL_CHECKPOINT, "LINEAGE": [CANONICAL_CHECKPOINT, EXPERIMENTAL_PARENT_CHECKPOINT, CPT_RUN_ID]},
    )
    write_json(
        ckpt_root / "lr-schedule.json",
        {"seed": "restored_from_cpt000004_step50", "eval_seed": EVAL_SEED, "schedule": lr_table, "peak_lr": B1_LR, "warmup": B1_WARMUP, "constant_continuation": True, "parent_scheduler_hash": parent_sched_hash},
    )
    write_json(ckpt_root / "packing.json", {**jsonable_packing(packing), "packer_gate": packer_gate, "FAMILY_COUNTS_PER_BATCH": packer_bundle.get("FAMILY_COUNTS_PER_BATCH"), "DOCUMENT_COUNTS_PER_BATCH": packer_bundle.get("DOCUMENT_COUNTS_PER_BATCH"), "preview_validation": (packer_bundle.get("preview") or {}).get("validation")})
    write_json(ckpt_root / "packer-preview-100.json", {
        "PACKER_VALIDATION": packer_bundle.get("PACKER_VALIDATION"),
        "ROLE_PLACEMENT_VALIDATION": packer_bundle.get("ROLE_PLACEMENT_VALIDATION"),
        "ROLE_WINDOW_STEPS": packer_bundle.get("ROLE_WINDOW_STEPS"),
        "ROLE_WINDOWS_TOTAL": packer_bundle.get("ROLE_WINDOWS_TOTAL"),
        "ROLE_FIRST_EXPOSURE": packer_bundle.get("ROLE_FIRST_EXPOSURE"),
        "ROLE_LAST_EXPOSURE": packer_bundle.get("ROLE_LAST_EXPOSURE"),
        "NO_END_OF_RUN_ROLE_DUMP": packer_bundle.get("NO_END_OF_RUN_ROLE_DUMP"),
        "ALL_12_FAMILIES_MIXED": packer_bundle.get("ALL_12_FAMILIES_MIXED"),
        "MAX_GENESIS_PER_BATCH": packer_bundle.get("MAX_GENESIS_PER_BATCH"),
        "MAX_JSON_PER_BATCH": packer_bundle.get("MAX_JSON_PER_BATCH"),
        "MAX_ROLE_PER_BATCH": packer_bundle.get("MAX_ROLE_PER_BATCH"),
        "MAX_TECHNICAL_PER_BATCH": packer_bundle.get("MAX_TECHNICAL_PER_BATCH"),
        "MAX_SAME_DOCUMENT_PER_BATCH": packer_bundle.get("MAX_SAME_DOCUMENT_PER_BATCH"),
        "FAMILY_COUNTS_PER_BATCH": packer_bundle.get("FAMILY_COUNTS_PER_BATCH"),
        "DOCUMENT_COUNTS_PER_BATCH": packer_bundle.get("DOCUMENT_COUNTS_PER_BATCH"),
        "preview_homogeneous_fraction": (packer_bundle.get("preview") or {}).get("homogeneous_fraction"),
        "train_homogeneous_fraction": packing.get("homogeneous_fraction"),
        "unique_docs_per_family": packing.get("unique_docs_per_family"),
        "swaps": packer_bundle.get("swaps"),
    })
    write_json(ckpt_root / "rng-after-seed.json", {"note": "experimental_parent_rng_restored_after_optimizer_load"})
    write_json(ckpt_root / "hash-gate.json", hash_gate)

    here = Path(__file__).resolve().parent
    trainer_sha = file_sha(Path(__file__))
    proven_sha = file_sha(here / "wrim_proven_load.py")
    packer_sha = file_sha(here / "wrim_cpt3_packer.py")
    packer_previous_sha = file_sha(here / "wrim_cpt_stage_b_corpus.py")
    eval_sha = file_sha(here / "wrim_cpt_eval.py")
    ckpt_mod_sha = file_sha(here / "wrim_resumable_checkpoint.py")
    live_sha = file_sha(here / "wrim_train_liveness.py")
    nl_eval_sha = file_sha(here / "wrim_val_nl_independent.py")
    provenance = hashlib.sha256(
        f"{trainer_sha}|{proven_sha}|{packer_sha}|{eval_sha}|{ckpt_mod_sha}|{live_sha}|{nl_eval_sha}".encode()
    ).hexdigest()
    stream_sha = hashlib.sha256(stream.tobytes()).hexdigest()
    addendum_path = locate_addendum(Path(args.data_root))
    addendum_hash = sha256_file(addendum_path) if addendum_path else ADDENDUM_SHA
    suite_path = Path(args.suite) if getattr(args, "suite", None) else locate_suite()
    baseline_path = Path(args.baseline) if getattr(args, "baseline", None) else locate_baseline(Path(args.data_root))
    identity = {
        "RUN_ID": CPT_RUN_ID,
        "PARENT_MODEL_ID": EXPERIMENTAL_PARENT_CHECKPOINT,
        "PARENT_HASH": parent_model_hash,
        "CANONICAL_MODEL_ID": CANONICAL_CHECKPOINT,
        "CANONICAL_HASH": canonical_hash,
        "PARENT_OPTIMIZER_HASH": parent_opt_hash,
        "TOKENIZER_HASH": tok_hash,
        "STAGE3_HASH": SUITE_SHA,
        "INSTRUCTION_ADDENDUM_HASH": addendum_hash,
        "TRAIN_DATASET_IDS": [CORPUS_ID, CORPUS_VERSION],
        "TRAIN_DATASET_HASHES": {CORPUS_VERSION: corpus_hash},
        "VALIDATION_DATASET_IDS": [CORPUS_ID, "WRIM-FOUNDATION-EVAL-1", INDEPENDENT_NL_PACK],
        "VALIDATION_DATASET_HASHES": {CORPUS_VERSION: corpus_hash, INDEPENDENT_NL_PACK: live_nl_pack},
        "TRAINER_PROVENANCE_HASH": provenance,
        "PACKER_PROVENANCE_HASH": packer_sha,
        "PACKER_PREVIOUS_HASH": packer_previous_sha,
        "PACKER_VERSION": PACKER_VERSION,
        "OPTIMIZER_CLASS": "AdamW",
        "OPTIMIZER_HYPERPARAMETERS": {
            "fused": False,
            "betas": [0.9, 0.95],
            "eps": 1e-8,
            "weight_decay": WEIGHT_DECAY,
            "grad_clip": GRAD_CLIP,
        },
        "LR_SCHEDULE_ID": LR_SCHEDULE_ID,
    }
    write_json(ckpt_root / "run-identity.json", identity)

    suite = None
    baseline = None
    wrim0_logp: dict[str, torch.Tensor] = {}
    if suite_path and suite_path.is_file() and baseline_path and baseline_path.is_file():
        from stage3a_run import load_baseline, load_suite

        suite = load_suite(suite_path)
        baseline = load_baseline(baseline_path)

    heartbeat_path = ckpt_root / "heartbeat.jsonl"
    term = TerminationCapture()
    term.install()
    last_durable = None
    checkpoints: list[dict[str, Any]] = []
    foundation_by_step: dict[str, Any] = {}
    val_by_step: dict[str, Any] = {}
    nl_by_step: dict[str, Any] = {}
    probe_by_step: dict[str, Any] = {}
    stage3_by_step: dict[str, Any] = {}
    success_by_step: dict[str, Any] = {}
    warnings_fired: list[dict[str, Any]] = []
    parent_probes: dict[str, Any] | None = None
    parent_nl_nll: float | None = None
    parent_s3_collapse = STEP400_STAGE3_COLLAPSE
    parent_s3_delta = STEP400_STAGE3_DELTA_VS_WRIM0
    stage3_review_any = False
    plateau_review_any = False
    top5_review_any = False
    role_by_step: dict[str, Any] = {}
    trend_by_step: dict[str, Any] = {}
    t_train0 = time.perf_counter()

    def persist_full(step: int, tokens: int) -> dict[str, Any]:
        nonlocal last_durable
        dest = ckpt_root / f"step-{step}"
        if dest.is_dir() and (dest / "resume-manifest.json").is_file():
            man = json.loads((dest / "resume-manifest.json").read_text(encoding="utf-8"))
            last_durable = str(dest)
            row = {"step": step, "model_sha256": man.get("MODEL_HASH"), "path": str(dest), "reused": True}
            checkpoints.append(row)
            return {"ok": True, "path": str(dest), "manifest": man}
        saved = save_resumable_checkpoint(
            run_root=ckpt_root,
            step=step,
            model=model,
            optimizer=optimizer,
            tokens_processed=tokens,
            next_token_offset=tokens,
            stream_prefix_sha256=stream_sha,
            curriculum={"stage": "CPT_STAGE_B1_CPT000005", "max_tokens": B1_MAX_TOKENS, "objective": OBJECTIVE, "mask_prompt_tokens": MASK_PROMPT_TOKENS, "packer_version": PACKER_VERSION, "cumulative_parent_steps": CUMULATIVE_PARENT_STEPS},
            identity=identity,
            lr_table=lr_table,
            authorized_max_step=B1_STEPS,
            authorized_max_tokens=B1_MAX_TOKENS,
        )
        last_durable = saved["path"]
        man = saved["manifest"]
        checkpoints.append({"step": step, "model_sha256": man.get("MODEL_HASH"), "path": saved["path"]})
        return saved

    def heartbeat(step: int, tokens: int, loss: float | None, grad: float | None, lr: float | None, phase: str = "train") -> None:
        write_heartbeat(
            heartbeat_path,
            {
                "run_id": CPT_RUN_ID,
                "step": step,
                "tokens": tokens,
                "loss": loss,
                "gradient_norm": grad,
                "lr": lr,
                "phase": phase,
                "vram_free_mib": vram_free_mib(),
                "ram_rss_bytes": ram_rss_bytes(),
                "disk_free_bytes": disk_free_bytes(ckpt_root),
                "last_durable_checkpoint": last_durable,
            },
        )
        write_json(
            ckpt_root / "last-heartbeat.json",
            {"run_id": CPT_RUN_ID, "step": step, "tokens": tokens, "timestamp": utc_now(), "LAST_DURABLE_CHECKPOINT": last_durable, "phase": phase},
        )

    def eos_metrics_from_ids(ids: list[int]) -> dict[str, Any]:
        if len(ids) < 3:
            return {"n": 0}
        x = torch.tensor([ids[:-1]], dtype=torch.long, device=device)
        y = torch.tensor(ids[1:], dtype=torch.long, device=device)
        with torch.inference_mode():
            logits = model(x)[0]
            lf = logits.float()
            pred = torch.argmax(lf, dim=-1)
            probs = torch.softmax(lf, dim=-1)
            order = torch.argsort(lf, dim=-1, descending=True)
        eos_pos = (y == 2).nonzero(as_tuple=False).flatten()
        ast_pos = (x[0] == ASSISTANT_ID).nonzero(as_tuple=False).flatten()
        n_eos = int(eos_pos.numel())
        eos_hit = int((pred[eos_pos] == 2).sum().item()) if n_eos else 0
        ast_next = 0
        ast_n = int(ast_pos.numel())
        if ast_n:
            ast_next = int((pred[ast_pos] == 2).sum().item())
        ranks: list[int] = []
        eos_probs: list[float] = []
        for i in eos_pos.tolist():
            rank_t = torch.nonzero(order[i] == 2, as_tuple=False)
            if rank_t.numel():
                ranks.append(int(rank_t[0].item()) + 1)
            eos_probs.append(float(probs[i, 2].item()))
        return {
            "EOS_POSITIONS": n_eos,
            "EOS_ARGMAX_ACCURACY": (eos_hit / n_eos) if n_eos else None,
            "EOS_ARGMAX_COUNT": eos_hit,
            "EOS_MEAN_RANK": (sum(ranks) / len(ranks)) if ranks else None,
            "EOS_MEAN_PROBABILITY": (sum(eos_probs) / len(eos_probs)) if eos_probs else None,
            "ASSISTANT_THEN_EOS_RATE": (ast_next / ast_n) if ast_n else None,
            "COMMANDER_COUNT": int((y == COMMANDER_ID).sum().item()),
            "ASSISTANT_COUNT": ast_n,
        }

    def metric_bundle(step: int, found: dict[str, Any], nlls: dict[str, Any], nl: dict[str, Any], s3: dict[str, Any] | None, train_loss: float | None, grad_norm: float | None) -> dict[str, Any]:
        return {
            "step": step,
            "foundation_mean_rank": found.get("ASSISTANT_BOUNDARY_TARGET_RANK"),
            "foundation_top5": found.get("ASSISTANT_BOUNDARY_TOP5_COUNT"),
            "independent_nl_nll": nl.get("natural_language_nll_mean"),
            "independent_nl_newline": nl.get("NEWLINE_ATTRACTOR_RATE"),
            "independent_nl_doc_cont": nl.get("DOCUMENT_CONTINUATION_ATTRACTOR_RATE"),
            "independent_nl_repeat": nl.get("repeated_token_rate"),
            "independent_nl_tag_fragment": nl.get("tag_fragment_rate"),
            "stage3_historical": None if s3 is None else s3.get("historical_pass_count"),
            "stage3_collapse": None if s3 is None else s3.get("n_collapsed"),
            "stage3_delta_nll": None if s3 is None else s3.get("mean_wrim0_anchor_nll_delta"),
            "code_nll": nlls.get("code"),
            "json_nll": nlls.get("json"),
            "eos_argmax": (nlls.get("eos") or {}).get("EOS_ARGMAX_ACCURACY"),
            "eos_greedy_stop": found.get("EOS_GREEDY_STOP_COUNT"),
            "grad_norm": grad_norm,
            "train_loss": train_loss,
            "nan": False,
            "val_leak": False,
            "foundation_non_tag_tag_emissions": foundation_tag_emissions(found),
        }

    def run_eval(step: int, train_loss: float | None, tokens: int, lr: float | None, grad_norm: float | None = None) -> dict[str, Any]:
        nonlocal parent_probes, parent_nl_nll, stage3_review_any, plateau_review_any, top5_review_any
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        heartbeat(step, tokens, train_loss, grad_norm, lr, phase="eval_start")
        torch.manual_seed(EVAL_SEED)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(EVAL_SEED)
        was = model.training
        model.eval()
        found = evaluate_foundation(model=model, tokenizer=tokenizer, device=device)
        nlls = family_nll(model=model, device=device, packs=val_packs)
        short_ids = val_packs.get("role") or []
        nlls["short"] = nlls.get("role")
        nlls["eos"] = eos_metrics_from_ids(short_ids)
        nl = eval_candidate(name=f"cpt000005-step-{step}", model=model, tokenizer=tokenizer, device=device, rows=nl_rows)
        probes = nl_probe_rates(nl)
        role_windows_seen = 0
        role_tokens_seen = 0
        role_window_steps_seen: list[int] = []
        for m in batch_meta:
            si = int(m.get("step_index") or 0) + 1
            if si <= step and int(m.get("role") or 0) > 0:
                role_windows_seen += int(m.get("role") or 0)
                role_tokens_seen += int(m.get("role") or 0) * SEQ_LEN
                role_window_steps_seen.append(si)
        eos = nlls.get("eos") or {}
        role_items = [
            it
            for it in (found.get("items") or [])
            if str(it.get("family") or "") in {"role", "role_boundary", "eos_prediction", "stopping"}
            or it.get("prompt_mode") == "role"
        ]
        role_row = {
            "ROLE_WINDOWS_SEEN": role_windows_seen,
            "ROLE_TOKENS_SEEN": role_tokens_seen,
            "ROLE_WINDOW_STEPS_SEEN": role_window_steps_seen,
            "ROLE_EOS_MEAN_RANK": eos.get("EOS_MEAN_RANK"),
            "ROLE_EOS_MEAN_PROBABILITY": eos.get("EOS_MEAN_PROBABILITY"),
            "ROLE_EOS_ARGMAX_COUNT": eos.get("EOS_ARGMAX_COUNT"),
            "ROLE_EOS_ARGMAX_ACCURACY": eos.get("EOS_ARGMAX_ACCURACY"),
            "ROLE_GREEDY_STOP_COUNT": int(found.get("EOS_GREEDY_STOP_COUNT") or 0),
            "ROLE_ITEM_GREEDY_STOP_COUNT": sum(1 for it in role_items if it.get("eos")),
            "ROLE_ITEM_N": len(role_items),
        }
        role_by_step[str(step)] = role_row
        foundation_by_step[str(step)] = slim_foundation(found)
        val_by_step[str(step)] = nlls
        nl_by_step[str(step)] = slim_nl(nl)
        probe_by_step[str(step)] = probes
        write_json(evals_dir / f"foundation-step-{step}.json", slim_foundation(found))
        write_json(evals_dir / f"val-nll-step-{step}.json", nlls)
        write_json(evals_dir / f"independent-nl-step-{step}.json", slim_nl(nl))
        write_json(evals_dir / f"role-eval-step-{step}.json", role_row)
        s3_obs = None
        if step in STAGE3_OBSERVE_STEPS and suite is not None and baseline is not None:
            from stage3a_run import evaluate_candidate

            ev = evaluate_candidate(
                model=model,
                tokenizer=tokenizer,
                device=device,
                dump_root=dump,
                suite_items=suite["obj"]["items"],
                frozen_items=baseline["obj"]["items"],
                wrim0_logp=wrim0_logp,
                parent_cpu=parent_cpu,
                c0=np.array(val_packs.get("genesis") or [1, 2, 3], dtype=np.int32),
                c1=np.array(val_packs.get("general") or [1, 2, 3], dtype=np.int32),
                greedy_256=False,
                step=step,
                train_loss=train_loss,
                tokens=tokens,
                lr=lr,
            )
            delta = ev.get("mean_wrim0_anchor_nll_delta")
            drift = None if delta is None else float(delta) - float(STEP400_STAGE3_DELTA_VS_WRIM0)
            incr = None if delta is None else float(delta) - float(CPT000004_STAGE3_DELTA_VS_WRIM0)
            s3_obs = {
                "step": step,
                "cumulative_step": CUMULATIVE_PARENT_STEPS + int(step),
                "mean_wrim0_anchor_nll_delta": delta,
                "mean_kl_wrim0_to_candidate": ev.get("mean_kl_wrim0_to_candidate"),
                "historical_pass_count": ev.get("historical_pass_count"),
                "historical_binary": ev.get("historical_binary"),
                "n_collapsed": ev.get("n_collapsed"),
                "val_loss_corpus0": ev.get("val_loss_corpus0"),
                "STAGE3_DRIFT_VS_STEP400": drift,
                "STAGE3_INCREMENTAL_DRIFT_VS_PARENT": incr,
                "STAGE3_NLL_REVIEW": bool(delta is not None and float(delta) >= 1.15),
                "observe_only": True,
            }
            stage3_by_step[str(step)] = s3_obs
            write_json(evals_dir / f"stage3-observe-step-{step}.json", s3_obs)
        if step == 0:
            parent_probes = probes
            parent_nl_nll = nl.get("natural_language_nll_mean")
        slope_row = {
            "independent_nl_nll": nl.get("natural_language_nll_mean"),
            "general_nll": nlls.get("general"),
            "genesis_nll": nlls.get("genesis"),
            "code_nll": nlls.get("code"),
            "json_nll": nlls.get("json"),
            "foundation_rank": found.get("ASSISTANT_BOUNDARY_TARGET_RANK"),
        }
        prev_eval = None
        earlier = [s for s in B1_EVAL_STEPS if s < step]
        if earlier:
            prev_s = str(earlier[-1])
            prev_eval = {
                "independent_nl_nll": (nl_by_step.get(prev_s) or {}).get("natural_language_nll_mean"),
                "general_nll": (val_by_step.get(prev_s) or {}).get("general"),
                "genesis_nll": (val_by_step.get(prev_s) or {}).get("genesis"),
                "code_nll": (val_by_step.get(prev_s) or {}).get("code"),
                "json_nll": (val_by_step.get(prev_s) or {}).get("json"),
                "foundation_rank": (foundation_by_step.get(prev_s) or {}).get("ASSISTANT_BOUNDARY_TARGET_RANK"),
            }
            trend_by_step[str(step)] = interval_trend(prev_eval, slope_row)
        else:
            trend_by_step[str(step)] = "BASELINE"
        recent_trends = [trend_by_step.get(str(s)) for s in B1_EVAL_STEPS if 0 < s <= step]
        if len(recent_trends) >= 2 and recent_trends[-1] == "PLATEAUING" and recent_trends[-2] == "PLATEAUING":
            plateau_review_any = True
        success_by_step[str(step)] = success_at_checkpoint(step, found, nl, nlls, s3_obs, probes, parent_probes)
        if was:
            model.train()
            model.enable_training()
        heartbeat(step, tokens, train_loss, grad_norm, lr, phase="eval_done")
        bundle = metric_bundle(step, found, nlls, nl, s3_obs, train_loss, grad_norm)
        hits, review_flags = cpt5_hard_gate_hits(bundle)
        warns = list(b1_warnings(bundle, parent_nl_nll))
        review = bool(review_flags.get("STAGE3_NLL_REVIEW"))
        if review:
            stage3_review_any = True
            warns.append("STAGE3_NLL_REVIEW")
        if review_flags.get("FOUNDATION_TOP5_REVIEW"):
            top5_review_any = True
            warns.append("FOUNDATION_TOP5_REVIEW")
        if plateau_review_any:
            warns.append("PLATEAU_REVIEW")
        if warns:
            warnings_fired.append({"step": step, "warnings": warns, **review_flags, "PLATEAU_REVIEW": plateau_review_any, "trend": trend_by_step.get(str(step))})
        return {
            "step": step,
            "cumulative_step": CUMULATIVE_PARENT_STEPS + int(step),
            "foundation": slim_foundation(found),
            "val": nlls,
            "independent_nl": slim_nl(nl),
            "probes": probes,
            "stage3": s3_obs,
            "role": role_row,
            "hard_gate_hits": hits,
            "STAGE3_NLL_REVIEW": review,
            "FOUNDATION_TOP5_REVIEW": review_flags.get("FOUNDATION_TOP5_REVIEW"),
            "PLATEAU_REVIEW": plateau_review_any,
            "LEARNING_TREND": trend_by_step.get(str(step)),
            "warnings": warns,
            "metric_bundle": bundle,
        }

    optimizer = None
    try:
        start_step = 1
        tokens_seen = 0
        metrics: list[dict[str, Any]] = []
        abort: dict[str, Any] | None = None
        model.enable_training()
        optimizer = torch.optim.AdamW(
            model.parameters(),
            lr=lr_cpt_000005(1),
            betas=tuple(BETAS),
            eps=EPS,
            weight_decay=WEIGHT_DECAY,
            fused=False,
        )
        optimizer_lineage = "fresh_vessel"
        if not resume_mode:
            opt_blob = torch.load(exp_opt, map_location="cpu", weights_only=False)
            if not isinstance(opt_blob, dict) or "state_dict" not in opt_blob:
                payload = denial_payload("parent_optimizer_state_missing")
                write_json(report_path, payload)
                return payload
            if not opt_blob["state_dict"].get("state"):
                payload = denial_payload("parent_optimizer_state_empty_refusing_fresh_adamw")
                write_json(report_path, payload)
                return payload
            optimizer.load_state_dict(opt_blob["state_dict"])
            move_optimizer_state_to_device(optimizer, device)
            if exp_rng.is_file():
                rng_blob = torch.load(exp_rng, map_location="cpu", weights_only=False)
                restore_rng(rng_blob)
            if exp_sched.is_file():
                sched_blob = torch.load(exp_sched, map_location="cpu", weights_only=False)
                parent_lr_now = sched_blob.get("lr_now")
                write_json(
                    ckpt_root / "optimizer-lineage-audit.json",
                    {
                        "FRESH_ADAMW_STATE": False,
                        "LOADED_PARENT_OPTIMIZER": True,
                        "PARENT_OPTIMIZER_HASH": parent_opt_hash,
                        "PARENT_SCHEDULER_LR_NOW": parent_lr_now,
                        "CONTINUATION_LR": B1_LR,
                        "WARMUP_RESTARTED": False,
                        "parent_scheduler_current_step": sched_blob.get("current_step"),
                        "parent_scheduler_next_step": sched_blob.get("next_step"),
                    },
                )
                if parent_lr_now is not None and abs(float(parent_lr_now) - float(B1_LR)) > 1e-12:
                    payload = {
                        **denial_payload("parent_lr_not_continuation_5e-5"),
                        "parent_lr_now": parent_lr_now,
                    }
                    write_json(report_path, payload)
                    return payload
            optimizer_lineage = "cpt000004_step50"
            write_json(ckpt_root / "rng-after-seed.json", rng_snapshot())

        if resume_mode:
            process_restart_count = 1
            resume_count = 1
            latest = latest_complete_checkpoint(ckpt_root)
            if latest is None:
                payload = denial_payload("resume_requested_but_no_complete_checkpoint")
                write_json(report_path, payload)
                return payload
            from wrim_resumable_checkpoint import load_manifest

            man_preview = load_manifest(latest)
            expected = dict(identity)
            expected["TRAINER_PROVENANCE_HASH"] = man_preview.get("TRAINER_PROVENANCE_HASH")
            restored = restore_resumable_checkpoint(path=latest, model=model, optimizer=optimizer, expected_identity=expected)
            if not restored["ok"]:
                payload = {**denial_payload("resume_identity_or_hash_failed"), "restore": restored}
                write_json(report_path, payload)
                return payload
            if restored.get("stream", {}).get("stream_prefix_sha256") != stream_sha:
                payload = {**denial_payload("STREAM_STATE_MISMATCH"), "restore": restored, "recomputed_stream_sha": stream_sha}
                write_json(report_path, payload)
                return payload
            model.to(device)
            move_optimizer_state_to_device(optimizer, device)
            man = restored["manifest"]
            start_step = int(man["NEXT_GLOBAL_STEP"])
            tokens_seen = int(man["TOKENS_PROCESSED"])
            last_durable = restored["path"]
            resume_steps.append(int(man["CURRENT_GLOBAL_STEP"]))
            metrics_path = ckpt_root / "metrics.jsonl"
            if metrics_path.is_file():
                for line in metrics_path.read_text(encoding="utf-8").splitlines():
                    if line.strip():
                        metrics.append(json.loads(line))
            for p in sorted(evals_dir.glob("foundation-step-*.json")):
                try:
                    obj = json.loads(p.read_text(encoding="utf-8"))
                    step_s = p.name.replace("foundation-step-", "").replace(".json", "")
                    foundation_by_step[step_s] = obj
                except (OSError, json.JSONDecodeError):
                    continue
            for p in sorted(evals_dir.glob("val-nll-step-*.json")):
                try:
                    obj = json.loads(p.read_text(encoding="utf-8"))
                    step_s = p.name.replace("val-nll-step-", "").replace(".json", "")
                    val_by_step[step_s] = obj
                except (OSError, json.JSONDecodeError):
                    continue
            for p in sorted(evals_dir.glob("independent-nl-step-*.json")):
                try:
                    obj = json.loads(p.read_text(encoding="utf-8"))
                    step_s = p.name.replace("independent-nl-step-", "").replace(".json", "")
                    nl_by_step[step_s] = obj
                    if step_s == "0":
                        parent_nl_nll = obj.get("natural_language_nll_mean")
                except (OSError, json.JSONDecodeError):
                    continue
            for p in sorted(evals_dir.glob("role-eval-step-*.json")):
                try:
                    obj = json.loads(p.read_text(encoding="utf-8"))
                    step_s = p.name.replace("role-eval-step-", "").replace(".json", "")
                    role_by_step[step_s] = obj
                except (OSError, json.JSONDecodeError):
                    continue
            for p in sorted(evals_dir.glob("stage3-observe-step-*.json")):
                try:
                    obj = json.loads(p.read_text(encoding="utf-8"))
                    step_s = p.name.replace("stage3-observe-step-", "").replace(".json", "")
                    stage3_by_step[step_s] = obj
                except (OSError, json.JSONDecodeError):
                    continue
            if "0" not in foundation_by_step:
                ev0 = run_eval(0, None, 0, None)
                if ev0.get("hard_gate_hits"):
                    abort = {
                        **denial_payload("HARD_STOP_GATE"),
                        "HARD_STOP_TRIGGERED": True,
                        "stop_reason": ",".join(ev0["hard_gate_hits"]),
                        "HARD_STOP_GATES": ev0["hard_gate_hits"],
                        "step": 0,
                    }
            heartbeat(int(man["CURRENT_GLOBAL_STEP"]), tokens_seen, None, None, None)
            if start_step > B1_STEPS and abort is None:
                summary = {
                    "ok": True,
                    "kind": "WRIM1_CPT_000005_CONTINUED_FOUNDATION_COMPLETE_PENDING_REVIEW",
                    "CPT_RUN_ID": CPT_RUN_ID,
                    "optimizer_steps": B1_STEPS,
                    "tokens_seen": tokens_seen,
                    "stop_reason": "COMPLETE",
                    "HARD_STOP_TRIGGERED": False,
                    "TRAINING_AUTHORIZATION": "OFF",
                    "hash_gate": hash_gate,
                }
                write_json(report_path, summary)
                return summary
        else:
            ev0 = run_eval(0, None, 0, None)
            persist_full(0, 0)
            if ev0.get("hard_gate_hits"):
                abort = {
                    **denial_payload("HARD_STOP_GATE"),
                    "HARD_STOP_TRIGGERED": True,
                    "stop_reason": ",".join(ev0["hard_gate_hits"]),
                    "HARD_STOP_GATES": ev0["hard_gate_hits"],
                    "step": 0,
                    "tokens_seen": 0,
                }

        if abort is None:
            for step in range(start_step, B1_STEPS + 1):
                if step > B1_STEPS:
                    abort = {
                        **denial_payload("step_101_forbidden"),
                        "HARD_STOP_TRIGGERED": True,
                        "stop_reason": "step_101_forbidden",
                        "step": step - 1,
                        "tokens_seen": tokens_seen,
                    }
                    break
                if tokens_seen + TOKENS_PER_STEP > B1_MAX_TOKENS:
                    abort = {
                        **denial_payload("token_cap"),
                        "HARD_STOP_TRIGGERED": True,
                        "stop_reason": "token_cap",
                        "tokens_seen": tokens_seen,
                        "step": step - 1,
                    }
                    break
                x_np, y_np = batches[step - 1]
                meta = batch_meta[step - 1] if step - 1 < len(batch_meta) else {}
                x = torch.tensor(x_np, dtype=torch.long, device=device)
                y = torch.tensor(y_np, dtype=torch.long, device=device)
                for pg in optimizer.param_groups:
                    pg["lr"] = lr_cpt_000005(step)
                optimizer.zero_grad(set_to_none=True)
                logits = model(x)
                loss = torch.nn.functional.cross_entropy(logits.reshape(-1, logits.size(-1)), y.reshape(-1))
                if not torch.isfinite(loss):
                    abort = {
                        **denial_payload("NaN_or_Inf_loss"),
                        "HARD_STOP_TRIGGERED": True,
                        "stop_reason": "NAN_INF",
                        "HARD_STOP_GATES": ["NAN_INF"],
                        "step": step,
                        "tokens_seen": tokens_seen,
                        "loss": str(loss.item()),
                        "batch_meta": meta,
                    }
                    break
                loss.backward()
                grad_norm = torch.nn.utils.clip_grad_norm_(model.parameters(), GRAD_CLIP)
                unclipped = float(grad_norm) if torch.isfinite(grad_norm) else None
                clipped = min(unclipped, float(GRAD_CLIP)) if unclipped is not None else None
                if not torch.isfinite(grad_norm) or (unclipped is not None and unclipped >= GRAD_HARD):
                    abort = {
                        **denial_payload("gradient_hard_stop"),
                        "HARD_STOP_TRIGGERED": True,
                        "stop_reason": "GRAD_INSTABILITY",
                        "HARD_STOP_GATES": ["GRAD_INSTABILITY"],
                        "step": step,
                        "tokens_seen": tokens_seen,
                        "grad_norm": unclipped if unclipped is not None else str(grad_norm),
                        "grad_norm_unclipped": unclipped,
                        "grad_norm_clipped": clipped,
                        "batch_meta": meta,
                    }
                    persist_full(step, tokens_seen)
                    break
                optimizer.step()
                tokens_seen += TOKENS_PER_STEP
                gate_flag = None
                if unclipped is not None and unclipped >= GRAD_REVIEW:
                    gate_flag = "REVIEW"
                    warnings_fired.append({"step": step, "warnings": ["grad_norm>=6.5"], "grad_norm": unclipped, "batch_meta": meta})
                elif unclipped is not None and unclipped >= GRAD_WARN:
                    gate_flag = "WARNING"
                    warnings_fired.append({"step": step, "warnings": ["grad_norm>=5.0"], "grad_norm": unclipped, "batch_meta": meta})
                row = {
                    "step": step,
                    "loss": float(loss.item()),
                    "lr": lr_cpt_000005(step),
                    "grad_norm": unclipped,
                    "grad_norm_unclipped": unclipped,
                    "grad_norm_clipped": clipped,
                    "tokens_seen": tokens_seen,
                    "batch_type": meta.get("kind"),
                    "family_composition": meta.get("family_counts"),
                    "document_composition": meta.get("document_counts"),
                    "families": meta.get("families"),
                    "doc_ids": meta.get("doc_ids"),
                    "eos_count": meta.get("eos_count"),
                    "rare_token_rate": meta.get("rare_token_rate"),
                    "genesis": meta.get("genesis"),
                    "json": meta.get("json"),
                    "role": meta.get("role"),
                    "technical": meta.get("technical"),
                    "ROLE_SEQUENCE_COUNT": meta.get("role"),
                    "GENESIS_SEQUENCE_COUNT": meta.get("genesis"),
                    "JSON_SEQUENCE_COUNT": meta.get("json"),
                    "grad_gate": gate_flag,
                }
                metrics.append(row)
                (ckpt_root / "metrics.jsonl").open("a", encoding="utf-8").write(json.dumps(row) + "\n")
                heartbeat(step, tokens_seen, float(loss.item()), unclipped, lr_cpt_000005(step))
                if step in B1_EVAL_STEPS:
                    persist_full(step, tokens_seen)
                    ev = run_eval(step, float(loss.item()), tokens_seen, lr_cpt_000005(step), unclipped)
                    write_json(
                        evals_dir / f"step-{step}.json",
                        {
                            "step": step,
                            "val": ev.get("val"),
                            "independent_nl": ev.get("independent_nl"),
                            "probes": ev.get("probes"),
                            "hard_gate_hits": ev.get("hard_gate_hits"),
                            "STAGE3_NLL_REVIEW": ev.get("STAGE3_NLL_REVIEW"),
                            "warnings": ev.get("warnings"),
                            "role": ev.get("role"),
                            "foundation_summary": {
                                k: ev.get("foundation", {}).get(k)
                                for k in (
                                    "ASSISTANT_BOUNDARY_TARGET_RANK",
                                    "ASSISTANT_BOUNDARY_TOP5_COUNT",
                                    "ASSISTANT_BOUNDARY_GREEDY_COUNT",
                                    "NEWLINE_ATTRACTOR_RATE",
                                    "DOCUMENT_CONTINUATION_ATTRACTOR_RATE",
                                    "EOS_GREEDY_STOP_COUNT",
                                )
                            },
                        },
                    )
                    if ev.get("hard_gate_hits"):
                        abort = {
                            **denial_payload("HARD_STOP_GATE"),
                            "HARD_STOP_TRIGGERED": True,
                            "stop_reason": ",".join(ev["hard_gate_hits"]),
                            "HARD_STOP_GATES": ev["hard_gate_hits"],
                            "step": step,
                            "tokens_seen": tokens_seen,
                            "metric_bundle": ev.get("metric_bundle"),
                        }
                        break

        elapsed = time.perf_counter() - t_train0
        tps = (tokens_seen / elapsed) if elapsed > 0 else None
        losses = [m.get("loss") for m in metrics if m.get("loss") is not None]
        grads = [m.get("grad_norm") for m in metrics if m.get("grad_norm") is not None]
        last_step = max((m.get("step") or 0) for m in metrics) if metrics else 0
        best = None
        best_hash = None
        best_nl = None
        for s, nlv in nl_by_step.items():
            r = nlv.get("natural_language_nll_mean")
            if r is None:
                continue
            if best_nl is None or float(r) < float(best_nl):
                best_nl = r
                ck = next((c for c in checkpoints if int(c.get("step") or -1) == int(s)), None)
                best = ck.get("path") if ck else f"step-{s}"
                best_hash = ck.get("model_sha256") if ck else None
        continued_recipe = {
            "optimizer": "AdamW",
            "lr": B1_LR,
            "schedule": "warmup_10_then_constant_5e-5",
            "warmup_steps": B1_WARMUP,
            "steps": B1_STEPS,
            "max_tokens": B1_MAX_TOKENS,
            "weight_decay": WEIGHT_DECAY,
            "grad_clip": GRAD_CLIP,
            "objective": OBJECTIVE,
            "mask_prompt_tokens": MASK_PROMPT_TOKENS,
        }
        any_success = any(bool(v.get("all")) for v in success_by_step.values())
        f0 = foundation_by_step.get("0") or {}
        fN = foundation_by_step.get(str(last_step)) or {}
        nl0 = nl_by_step.get("0") or {}
        nlN = nl_by_step.get(str(last_step)) or {}
        val0 = val_by_step.get("0") or {}
        valN = val_by_step.get(str(last_step)) or {}
        complete = abort is None and last_step == B1_STEPS and tokens_seen == B1_MAX_TOKENS
        next_decision = next_commander_boundary(bool(abort), complete)

        def _max_grad(pred):
            vals = [float(m["grad_norm"]) for m in metrics if m.get("grad_norm") is not None and pred(m)]
            return max(vals) if vals else None

        def _mean_grad(pred):
            vals = [float(m["grad_norm"]) for m in metrics if m.get("grad_norm") is not None and pred(m)]
            return (sum(vals) / len(vals)) if vals else None

        category_grad_summary = {
            "genesis_containing": {"n": sum(1 for m in metrics if int(m.get("genesis") or 0) > 0), "max_grad": _max_grad(lambda m: int(m.get("genesis") or 0) > 0), "mean_grad": _mean_grad(lambda m: int(m.get("genesis") or 0) > 0)},
            "json_containing": {"n": sum(1 for m in metrics if int(m.get("json") or 0) > 0), "max_grad": _max_grad(lambda m: int(m.get("json") or 0) > 0), "mean_grad": _mean_grad(lambda m: int(m.get("json") or 0) > 0)},
            "role_containing": {"n": sum(1 for m in metrics if int(m.get("role") or 0) > 0), "max_grad": _max_grad(lambda m: int(m.get("role") or 0) > 0), "mean_grad": _mean_grad(lambda m: int(m.get("role") or 0) > 0)},
            "technical_containing": {"n": sum(1 for m in metrics if int(m.get("technical") or 0) > 0), "max_grad": _max_grad(lambda m: int(m.get("technical") or 0) > 0), "mean_grad": _mean_grad(lambda m: int(m.get("technical") or 0) > 0)},
            "mixed": {"n": sum(1 for m in metrics if m.get("batch_type") == "mixed"), "max_grad": _max_grad(lambda m: m.get("batch_type") == "mixed"), "mean_grad": _mean_grad(lambda m: m.get("batch_type") == "mixed")},
            "homogeneous_safe": {"n": sum(1 for m in metrics if m.get("batch_type") == "homogeneous_safe"), "max_grad": _max_grad(lambda m: m.get("batch_type") == "homogeneous_safe"), "mean_grad": _mean_grad(lambda m: m.get("batch_type") == "homogeneous_safe")},
        }
        cpt2_metrics = []
        cpt2_metrics_path = Path(RETIRED_CKPT_ROOTS[0]) / "metrics.jsonl"
        if cpt2_metrics_path.is_file():
            for line in cpt2_metrics_path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    cpt2_metrics.append(json.loads(line))
        matched = []
        for m in metrics:
            if int(m.get("step") or 0) > 20:
                continue
            prev = next((p for p in cpt2_metrics if int(p.get("step") or 0) == int(m["step"])), None)
            matched.append(
                {
                    "step": m.get("step"),
                    "cpt4_loss": m.get("loss"),
                    "cpt4_grad": m.get("grad_norm"),
                    "cpt4_batch_type": m.get("batch_type"),
                    "cpt4_families": m.get("family_composition"),
                    "cpt2_loss": None if prev is None else prev.get("loss"),
                    "cpt2_grad": None if prev is None else prev.get("grad_norm"),
                }
            )
        packer_fix_pass = (
            bool(packer_gate.get("ALL_12_FAMILIES_MIXED"))
            and int(packer_gate.get("MAX_GENESIS_PER_BATCH") or 0) <= 2
            and int(packer_gate.get("MAX_JSON_PER_BATCH") or 0) <= 2
            and int(packer_gate.get("MAX_ROLE_PER_BATCH") or 0) <= 2
            and int(packer_gate.get("MAX_TECHNICAL_PER_BATCH") or 0) <= 2
            and int(packer_gate.get("MAX_SAME_DOCUMENT_PER_BATCH") or 0) <= 2
            and packer_gate.get("PACKER_VALIDATION") == "PASS"
            and packer_gate.get("ROLE_PLACEMENT_VALIDATION") == "PASS"
        )
        nl0_v = nl0.get("natural_language_nll_mean")
        nlN_v = nlN.get("natural_language_nll_mean")

        def _trend(a: Any, b: Any, *, lower_better: bool = True, eps: float = 0.01) -> str:
            if a is None or b is None:
                return "INCONCLUSIVE"
            if lower_better:
                if float(b) < float(a) - eps:
                    return "IMPROVING"
                if float(b) > float(a) + eps:
                    return "DEGRADING"
                return "NEUTRAL"
            if float(b) > float(a) + eps:
                return "IMPROVING"
            if float(b) < float(a) - eps:
                return "DEGRADING"
            return "NEUTRAL"

        if nl0_v is None or nlN_v is None:
            learning_signal = "INCONCLUSIVE"
        else:
            overall = interval_trend(
                {
                    "independent_nl_nll": nl0_v,
                    "general_nll": val0.get("general"),
                    "genesis_nll": val0.get("genesis"),
                    "code_nll": val0.get("code"),
                    "json_nll": val0.get("json"),
                    "foundation_rank": f0.get("ASSISTANT_BOUNDARY_TARGET_RANK"),
                },
                {
                    "independent_nl_nll": nlN_v,
                    "general_nll": valN.get("general"),
                    "genesis_nll": valN.get("genesis"),
                    "code_nll": valN.get("code"),
                    "json_nll": valN.get("json"),
                    "foundation_rank": fN.get("ASSISTANT_BOUNDARY_TARGET_RANK"),
                },
            )
            learning_signal = "PLATEAUING" if overall in {"NEUTRAL", "PLATEAUING", "INCONCLUSIVE"} else overall
            last_intervals = [trend_by_step.get(str(s)) for s in B1_EVAL_STEPS if s > 0 and trend_by_step.get(str(s))]
            if last_intervals.count("DEGRADING") >= 2:
                learning_signal = "DEGRADING"
            elif last_intervals[-2:] == ["PLATEAUING", "PLATEAUING"]:
                learning_signal = "PLATEAUING"
        s3_final = stage3_by_step.get(str(last_step)) or stage3_by_step.get("50") or {}
        s3_parent = stage3_by_step.get("0") or {}
        hist_n = s3_final.get("historical_pass_count")
        coll_n = s3_final.get("n_collapsed")
        delta_n = s3_final.get("mean_wrim0_anchor_nll_delta")
        drift_n = s3_final.get("STAGE3_DRIFT_VS_STEP400")
        if drift_n is None and delta_n is not None:
            drift_n = float(delta_n) - float(parent_s3_delta)
        hard_retention = bool(abort) and any(
            x in str(abort.get("stop_reason") or "")
            for x in ("STAGE3_HISTORICAL", "STAGE3_COLLAPSE", "STAGE3_CUMULATIVE_CATASTROPHE", "FOUNDATION_TOP5_COLLAPSE")
        )
        if hard_retention or (hist_n is not None and int(hist_n) < 5) or (coll_n is not None and int(coll_n) > 5):
            retention_signal = "DEGRADING"
        elif stage3_review_any:
            retention_signal = "MIXED"
        elif hist_n is not None and int(hist_n) >= 5 and (coll_n is None or int(coll_n) <= 5):
            retention_signal = "HEALTHY"
        else:
            retention_signal = "MIXED"
        r0 = role_by_step.get("0") or {}
        rN = role_by_step.get(str(last_step)) or role_by_step.get("100") or {}
        role_rank_t = _trend(r0.get("ROLE_EOS_MEAN_RANK"), rN.get("ROLE_EOS_MEAN_RANK"), lower_better=True, eps=0.5)
        role_prob_t = _trend(r0.get("ROLE_EOS_MEAN_PROBABILITY"), rN.get("ROLE_EOS_MEAN_PROBABILITY"), lower_better=False, eps=0.01)
        role_stop_t = _trend(r0.get("ROLE_GREEDY_STOP_COUNT"), rN.get("ROLE_GREEDY_STOP_COUNT"), lower_better=False, eps=0.5)
        role_votes = [x for x in (role_rank_t, role_prob_t, role_stop_t) if x != "INCONCLUSIVE"]
        if not role_votes:
            role_boundary_signal = "INCONCLUSIVE"
        elif role_votes.count("DEGRADING") > role_votes.count("IMPROVING"):
            role_boundary_signal = "DEGRADING"
        elif role_votes.count("IMPROVING") > role_votes.count("DEGRADING"):
            role_boundary_signal = "IMPROVING"
        else:
            role_boundary_signal = "NEUTRAL"
        role_final = rN
        valN_eos = (valN.get("eos") or {}) if isinstance(valN, dict) else {}
        commander_fields = {
            "REPORT": "WRIM1_CPT_000005_CONTINUED_FOUNDATION_REPORT",
            "RUN_ID": CPT_RUN_ID,
            "PARENT": EXPERIMENTAL_PARENT_CHECKPOINT,
            "PARENT_MODEL_HASH": parent_model_hash,
            "PARENT_OPTIMIZER_HASH": parent_opt_hash,
            "PARENT_HASH": parent_model_hash,
            "CANONICAL_MODEL": CANONICAL_CHECKPOINT,
            "CORPUS_HASH": corpus_hash,
            "TOKENIZER_HASH": TOKENIZER_EXPECTED_SHA,
            "PACKER_HASH": packer_sha,
            "PACKER_VALIDATION": packer_gate.get("PACKER_VALIDATION"),
            "ROLE_PLACEMENT_VALIDATION": packer_gate.get("ROLE_PLACEMENT_VALIDATION"),
            "ROLE_WINDOW_STEPS": packer_gate.get("ROLE_WINDOW_STEPS"),
            "STEPS_EXECUTED": last_step,
            "NEW_TOKENS_EXECUTED": tokens_seen,
            "CUMULATIVE_CPT_STEPS": CUMULATIVE_PARENT_STEPS + int(last_step),
            "CUMULATIVE_CPT_TOKENS": CUMULATIVE_PARENT_TOKENS + int(tokens_seen),
            "STEP_101_EXECUTED": "NO",
            "MAX_GRAD_NORM": max(grads) if grads else None,
            "GRAD_HARD_STOP": bool(abort) and "GRAD" in str(abort.get("stop_reason") or ""),
            "LOSS_TRAJECTORY": {"first": losses[0] if losses else None, "last": losses[-1] if losses else None, "min": min(losses) if losses else None},
            "INDEPENDENT_NL_NLL": {"parent": nl0_v, "final": nlN_v, "by_step": {k: (v or {}).get("natural_language_nll_mean") for k, v in nl_by_step.items()}},
            "GENERAL_VAL_NLL": {"parent": val0.get("general"), "final": valN.get("general")},
            "GENESIS_VAL_NLL": {"parent": val0.get("genesis"), "final": valN.get("genesis")},
            "CODE_NLL": {"parent": val0.get("code"), "final": valN.get("code")},
            "JSON_NLL": {"parent": val0.get("json"), "final": valN.get("json")},
            "FOUNDATION_RANK": {"parent": f0.get("ASSISTANT_BOUNDARY_TARGET_RANK"), "final": fN.get("ASSISTANT_BOUNDARY_TARGET_RANK")},
            "FOUNDATION_TOP5": {"parent": f0.get("ASSISTANT_BOUNDARY_TOP5_COUNT"), "final": fN.get("ASSISTANT_BOUNDARY_TOP5_COUNT")},
            "STAGE3_HISTORICAL": {"parent": s3_parent.get("historical_pass_count"), "final": hist_n, "by_step": {k: (v or {}).get("historical_pass_count") for k, v in stage3_by_step.items()}},
            "STAGE3_COLLAPSE": {"parent": s3_parent.get("n_collapsed"), "final": coll_n, "by_step": {k: (v or {}).get("n_collapsed") for k, v in stage3_by_step.items()}},
            "STAGE3_DELTA_VS_WRIM0": {"parent": s3_parent.get("mean_wrim0_anchor_nll_delta"), "final": delta_n, "by_step": {k: (v or {}).get("mean_wrim0_anchor_nll_delta") for k, v in stage3_by_step.items()}},
            "STAGE3_DRIFT_VS_STEP400": {"final": drift_n, "by_step": {k: (v or {}).get("STAGE3_DRIFT_VS_STEP400") for k, v in stage3_by_step.items()}},
            "STAGE3_INCREMENTAL_DRIFT_VS_PARENT": {"final": None if delta_n is None else float(delta_n) - float(CPT000004_STAGE3_DELTA_VS_WRIM0), "by_step": {k: (v or {}).get("STAGE3_INCREMENTAL_DRIFT_VS_PARENT") for k, v in stage3_by_step.items()}},
            "STAGE3_1_15_REVIEW_TRIGGERED": stage3_review_any,
            "STAGE3_HARD_RETENTION_TRIGGERED": hard_retention,
            "ROLE_WINDOWS_SEEN": role_final.get("ROLE_WINDOWS_SEEN"),
            "ROLE_TOKENS_SEEN": role_final.get("ROLE_TOKENS_SEEN"),
            "ROLE_EOS_RANK": {"parent": r0.get("ROLE_EOS_MEAN_RANK"), "final": role_final.get("ROLE_EOS_MEAN_RANK"), "by_step": {k: (v or {}).get("ROLE_EOS_MEAN_RANK") for k, v in role_by_step.items()}},
            "ROLE_EOS_PROBABILITY": {"parent": r0.get("ROLE_EOS_MEAN_PROBABILITY"), "final": role_final.get("ROLE_EOS_MEAN_PROBABILITY"), "by_step": {k: (v or {}).get("ROLE_EOS_MEAN_PROBABILITY") for k, v in role_by_step.items()}},
            "ROLE_EOS_ARGMAX": {"parent": r0.get("ROLE_EOS_ARGMAX_COUNT"), "final": role_final.get("ROLE_EOS_ARGMAX_COUNT")},
            "ROLE_GREEDY_STOP": {"parent": r0.get("ROLE_GREEDY_STOP_COUNT"), "final": role_final.get("ROLE_GREEDY_STOP_COUNT")},
            "EOS_ANALYSIS": {
                "foundation_greedy_stop": {"parent": f0.get("EOS_GREEDY_STOP_COUNT"), "final": fN.get("EOS_GREEDY_STOP_COUNT")},
                "val_eos_argmax": {"parent": (val0.get("eos") or {}).get("EOS_ARGMAX_ACCURACY") if isinstance(val0, dict) else None, "final": valN_eos.get("EOS_ARGMAX_ACCURACY")},
                "role_by_step": role_by_step,
            },
            "NEW_FAILURES": None if abort is None else abort.get("HARD_STOP_GATES") or [abort.get("stop_reason")],
            "PLATEAU_REVIEW": plateau_review_any,
            "BEST_ANALYSIS_CHECKPOINT": best,
            "LEARNING_SIGNAL": learning_signal,
            "RETENTION_SIGNAL": retention_signal,
            "ROLE_BOUNDARY_SIGNAL": role_boundary_signal,
            "LEARNING_TREND_BY_STEP": trend_by_step,
            "HARD_STOP": bool(abort),
            "STOP_REASON": "COMPLETE" if abort is None else abort.get("stop_reason"),
            "TRAINING_AUTHORIZATION_FINAL": "OFF",
            "CPT_000006_CREATED": "NO",
            "CANONICAL_CHANGED": "NO",
            "MODEL_PROMOTED": "NO",
            "COMMIT": "NO",
            "PUSH": "NO",
            "DEPLOY": "NO",
            "NEXT_COMMANDER_DECISION": next_decision,
        }
        base = {
            "CPT_RUN_ID": CPT_RUN_ID,
            "PARENT": PARENT_CHECKPOINT,
            "PARENT_HASH": PARENT_HASH,
            "ARCHITECTURE": ARCHITECTURE_ID,
            "PARAMETER_COUNT": PARAMETER_COUNT,
            "TOKENIZER": TOKENIZER_ID,
            "TOKENIZER_HASH": TOKENIZER_EXPECTED_SHA,
            "CORPUS_ID": CORPUS_ID,
            "CORPUS_VERSION": CORPUS_VERSION,
            "CORPUS_HASH": corpus_hash,
            "INDEPENDENT_NL_PACK": INDEPENDENT_NL_PACK,
            "INDEPENDENT_NL_PACK_HASH": live_nl_pack,
            "OBJECTIVE": OBJECTIVE,
            "MASK_PROMPT_TOKENS": MASK_PROMPT_TOKENS,
            "MAX_STEPS": B1_STEPS,
            "MAX_TOKENS": B1_MAX_TOKENS,
            "STEP_101_EXECUTED": False,
            "LEARNING_RATE": B1_LR,
            "WARMUP_STEPS": B1_WARMUP,
            "CHECKPOINTS": list(B1_EVAL_STEPS),
            "hash_gate": hash_gate,
            "packer_gate": packer_gate,
            "PACKER_VERSION": PACKER_VERSION,
            "PACKER_FIX_HASH": packer_sha,
            "PACKER_PREVIOUS_HASH": packer_previous_sha,
            "PACKER_NEW_HASH": packer_sha,
            "PACKER_VALIDATION": packer_gate.get("PACKER_VALIDATION"),
            "ROLE_PLACEMENT_VALIDATION": packer_gate.get("ROLE_PLACEMENT_VALIDATION"),
            "ROLE_WINDOW_STEPS": packer_gate.get("ROLE_WINDOW_STEPS"),
            "ALL_12_FAMILIES_MIXED": packer_gate.get("ALL_12_FAMILIES_MIXED"),
            "MAX_GENESIS_PER_BATCH": packer_gate.get("MAX_GENESIS_PER_BATCH"),
            "MAX_JSON_PER_BATCH": packer_gate.get("MAX_JSON_PER_BATCH"),
            "MAX_ROLE_PER_BATCH": packer_gate.get("MAX_ROLE_PER_BATCH"),
            "MAX_TECHNICAL_PER_BATCH": packer_gate.get("MAX_TECHNICAL_PER_BATCH"),
            "MAX_SAME_DOCUMENT_PER_BATCH": packer_gate.get("MAX_SAME_DOCUMENT_PER_BATCH"),
            "packing": jsonable_packing(packing),
            "TRAINER_PROVENANCE_HASH": provenance,
            "TRAINER_FILE_SHA256": trainer_sha,
            "CONTINUED_PRETRAIN_RECIPE": continued_recipe,
            "optimizer_steps": last_step,
            "OPTIMIZER_STEPS": last_step,
            "STEPS_EXECUTED": last_step,
            "tokens_seen": tokens_seen,
            "TOKENS_EXECUTED": tokens_seen,
            "TRAINING_TIME": elapsed,
            "TOKENS_PER_SECOND": tps,
            "LOSS_TRAJECTORY": commander_fields["LOSS_TRAJECTORY"],
            "GRADIENT_TRAJECTORY": {"first": grads[0] if grads else None, "last": grads[-1] if grads else None, "max": max(grads) if grads else None},
            "MAX_GRAD_NORM": commander_fields["MAX_GRAD_NORM"],
            "CATEGORY_GRAD_SUMMARY": category_grad_summary,
            "GENESIS_BATCH_MAX_GRAD": category_grad_summary["genesis_containing"]["max_grad"],
            "JSON_BATCH_MAX_GRAD": category_grad_summary["json_containing"]["max_grad"],
            "ROLE_BATCH_MAX_GRAD": category_grad_summary["role_containing"]["max_grad"],
            "TECHNICAL_BATCH_MAX_GRAD": category_grad_summary["technical_containing"]["max_grad"],
            "CPT000002_MATCHED_STEP_COMPARISON": matched,
            "PACKER_FIX_RESULT": "PASS" if packer_fix_pass else "FAIL",
            "LEARNING_SIGNAL": learning_signal,
            "RETENTION_SIGNAL": retention_signal,
            "ROLE_BOUNDARY_SIGNAL": role_boundary_signal,
            "metrics": metrics,
            "checkpoints": checkpoints,
            "foundation_by_step": {k: {kk: vv.get(kk) if isinstance(vv, dict) else vv for kk in ("ASSISTANT_BOUNDARY_TARGET_RANK", "ASSISTANT_BOUNDARY_TOP5_COUNT", "ASSISTANT_BOUNDARY_GREEDY_COUNT", "NEWLINE_ATTRACTOR_RATE", "DOCUMENT_CONTINUATION_ATTRACTOR_RATE", "EOS_GREEDY_STOP_COUNT", "n")} for k, vv in foundation_by_step.items()},
            "val_by_step": val_by_step,
            "independent_nl_by_step": nl_by_step,
            "probe_by_step": probe_by_step,
            "stage3_by_step": stage3_by_step,
            "role_by_step": role_by_step,
            "success_by_step": success_by_step,
            "SUCCESS_CRITERIA_MET_AT_ANY_GATED_CHECKPOINT": any_success,
            "WARNINGS": warnings_fired,
            "STAGE3_1_15_REVIEW_TRIGGERED": stage3_review_any,
            "STAGE3_HARD_RETENTION_TRIGGERED": hard_retention,
            "PARENT_FOUNDATION": {k: f0.get(k) for k in ("ASSISTANT_BOUNDARY_TARGET_RANK", "ASSISTANT_BOUNDARY_TOP5_COUNT", "NEWLINE_ATTRACTOR_RATE", "EOS_GREEDY_STOP_COUNT")},
            "FINAL_FOUNDATION": {k: fN.get(k) for k in ("ASSISTANT_BOUNDARY_TARGET_RANK", "ASSISTANT_BOUNDARY_TOP5_COUNT", "NEWLINE_ATTRACTOR_RATE", "EOS_GREEDY_STOP_COUNT")},
            "PARENT_INDEPENDENT_NL": {k: nl0.get(k) for k in ("natural_language_nll_mean", "NEWLINE_ATTRACTOR_RATE", "DOCUMENT_CONTINUATION_ATTRACTOR_RATE", "repeated_token_rate", "tag_fragment_rate")},
            "FINAL_INDEPENDENT_NL": {k: nlN.get(k) for k in ("natural_language_nll_mean", "NEWLINE_ATTRACTOR_RATE", "DOCUMENT_CONTINUATION_ATTRACTOR_RATE", "repeated_token_rate", "tag_fragment_rate")},
            "PARENT_VAL": val0,
            "FINAL_VAL": valN,
            "PROCESS_RESTART_COUNT": process_restart_count,
            "RESUME_COUNT": resume_count,
            "RESUME_STEPS": resume_steps,
            "BEST_CHECKPOINT": best,
            "BEST_ANALYSIS_CHECKPOINT": best,
            "BEST_CHECKPOINT_HASH": best_hash,
            "BEST_INDEPENDENT_NL_NLL": best_nl,
            "STAGE_B_EXECUTED": True,
            "SFT_EXECUTED": False,
            "RUN_000013_EXECUTED": False,
            "STAGE3B_EXECUTED": False,
            "CANONICAL_PROMOTED": False,
            "RAEL_PROMOTED": False,
            "MODEL_PROMOTED": False,
            "WRIM0_MODIFIED": False,
            "TOKENIZER_MODIFIED": False,
            "ARCHITECTURE_MODIFIED": False,
            "CORPUS_MUTATED": False,
            "COMMIT": False,
            "PUSH": False,
            "DEPLOY": False,
            "CPT_000002_RESUMED": False,
            "CPT_000003_RESUMED": False,
            "CPT_000004_RESUMED": False,
            "CPT_000006_CREATED": False,
            "STEP_101_EXECUTED": False,
            "CANONICAL_CHANGED": False,
            "TRAINING_AUTHORIZATION": "OFF",
            "WRIM_TRAINING_AUTHORIZATION": "OFF",
            "TRAINING_AUTHORIZATION_FINAL": "OFF",
            "NEXT_COMMANDER_DECISION": next_decision,
            **commander_fields,
        }
        if abort is None:
            summary = {
                "ok": True,
                "kind": "WRIM1_CPT_000005_CONTINUED_FOUNDATION_COMPLETE_PENDING_REVIEW",
                "stop_reason": "COMPLETE",
                "HARD_STOP_TRIGGERED": False,
                **base,
            }
            write_json(report_path, summary)
            write_json(commander_report_path, summary)
            write_json(ckpt_root / "training-summary.json", {k: summary.get(k) for k in ("ok", "kind", "optimizer_steps", "tokens_seen", "stop_reason", "HARD_STOP_TRIGGERED")})
            return summary
        abort.update(base)
        abort["kind"] = "WRIM1_CPT_000005_CONTINUED_FOUNDATION_HARD_STOP"
        abort["ok"] = False
        abort["TRAINING_AUTHORIZATION"] = "OFF"
        abort["WRIM_TRAINING_AUTHORIZATION"] = "OFF"
        abort["TRAINING_AUTHORIZATION_FINAL"] = "OFF"
        write_json(report_path, abort)
        write_abort(ckpt_root, abort)
        write_json(commander_report_path, abort)
        return abort
    except Exception as exc:
        tb = traceback.format_exc()
        oom = oom_kill_evidence()
        gpu_oom = "out of memory" in str(exc).lower() or ("cuda" in str(exc).lower() and "memory" in str(exc).lower())
        payload = {
            **denial_payload("python_exception"),
            "HARD_STOP_TRIGGERED": False,
            "stop_reason": "PROCESS_EXCEPTION",
            "PYTHON_EXCEPTION": f"{type(exc).__name__}: {exc}",
            "traceback": tb[-4000:],
            "OOM_KILL_EVIDENCE": oom,
            "GPU_OOM_EVIDENCE": gpu_oom,
            "EXIT_CODE": 1,
            "SIGNAL": term.signal if "term" in locals() else None,
            "hash_gate": hash_gate if "hash_gate" in locals() else None,
            "NEXT_COMMANDER_DECISION": next_commander_boundary(False, False),
        }
        write_json(report_path, payload)
        write_json(ckpt_root / "last-exit.json", payload)
        return payload
    finally:
        unset_training_authorization()
        if ollama_stopped:
            restore = start_user_ollama()
            ollama_restored = bool(restore.get("restored"))
            write_json(ckpt_root / "ollama-restore.json", {"OLLAMA_RESTORED": ollama_restored, **restore})
        write_json(
            ckpt_root / "training-authorization-off.json",
            {"TRAINING_AUTHORIZATION": "OFF", "WRIM_TRAINING_AUTHORIZATION": "OFF", "CPT_RUN_ID": CPT_RUN_ID, "timestamp": utc_now()},
        )


def main() -> int:
    import sys

    ap = argparse.ArgumentParser()
    ap.add_argument(AUTHORIZE_FLAG, action="store_true")
    ap.add_argument("--dump-root", default=None)
    ap.add_argument("--data-root", default=DATA_ROOT)
    ap.add_argument("--ckpt", default=CKPT_ROOT)
    ap.add_argument("--report", default=str(Path(DATA_ROOT) / REPORT_FILENAME))
    ap.add_argument("--commander-report", default=None)
    ap.add_argument("--suite", default=None)
    ap.add_argument("--baseline", default=None)
    args, _unknown = ap.parse_known_args()
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        if not authorization_ok(sys.argv[1:]):
            payload = denial_payload("TRAINING_AUTHORIZATION_OFF_OR_FLAG_MISSING")
            report_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
            print(json.dumps(payload, indent=2))
            return 0
        out = run_authorized_training(args)
        print(
            json.dumps(
                {
                    k: out.get(k)
                    for k in (
                        "ok",
                        "kind",
                        "CPT_RUN_ID",
                        "optimizer_steps",
                        "tokens_seen",
                        "TRAINING_AUTHORIZATION",
                        "WRIM_TRAINING_AUTHORIZATION",
                        "stop_reason",
                        "HARD_STOP_TRIGGERED",
                        "HARD_STOP_GATES",
                        "SUCCESS_CRITERIA_MET_AT_ANY_GATED_CHECKPOINT",
                    )
                },
                indent=2,
                default=str,
            )
        )
        return 0
    finally:
        unset_training_authorization()


if __name__ == "__main__":
    raise SystemExit(main())
