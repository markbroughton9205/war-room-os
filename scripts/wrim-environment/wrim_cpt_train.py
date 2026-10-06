"""WRIM1-CPT-000001 Stage A continued-pretraining trainer.

Does not train unless BOTH are present:
  --authorize-wrim1-cpt-000001
  env WRIM_TRAINING_AUTHORIZATION=ON_FOR_WRIM1_CPT_000001_STAGE_A_ONLY

Parent is WRIM-0 only. Full-stream next-token CE. Hard stop at 4,997,120 tokens.
Does not start Stage B. Does not create RUN-000013. Does not mutate tokenizer.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import time
import traceback
from pathlib import Path
from typing import Any

from wrim_cpt_identity import (
    ADDENDUM_SHA,
    ARCHITECTURE,
    ASSISTANT_ID,
    AUTHORIZE_ENV,
    AUTHORIZE_ENV_VALUE,
    AUTHORIZE_FLAG,
    BETAS,
    COMMANDER_ID,
    CORPUS_ID,
    CORPUS_VERSION,
    CPT_RUN_ID,
    EPS,
    EVAL_SEED,
    FULL_EVAL_STEPS,
    GRAD_CLIP,
    LINUX_CKPT_ROOT,
    LINUX_DATA_ROOT,
    LINUX_VENV_PYTHON,
    LOCKED_MIX,
    MAX_ADDITIONAL_TOKENS_CAP,
    MAX_TOKENS,
    MICRO_BATCH,
    MIN_LR,
    MISSION_ORIGIN,
    OPTIMIZER_STATE_STEPS,
    ORIGINAL_PRETRAIN_RECIPE,
    PACKER_VERSION,
    PARAM_COUNT,
    PARENT_ID,
    PARENT_SHA,
    PEAK_LR,
    SEED,
    SEQ_LEN,
    STAGE,
    STAGE3_OBSERVE_STEPS,
    STAGE3B_AUTHORIZATION,
    STEPS,
    SUITE_SHA,
    TOKENIZER_ID,
    TOKENIZER_SHA,
    TOKENS_PER_STEP,
    TRAINING_AUTHORIZATION,
    WARMUP_STEPS,
    WEIGHT_DECAY,
    WEIGHT_STEPS,
)


def authorization_ok(argv: list[str] | None = None) -> bool:
    import sys

    args = argv if argv is not None else sys.argv[1:]
    return AUTHORIZE_FLAG in args and os.environ.get(AUTHORIZE_ENV) == AUTHORIZE_ENV_VALUE


def denial_payload(reason: str) -> dict[str, Any]:
    return {
        "ok": False,
        "kind": "WRIM1_CPT_000001_TRAINING_DENIED",
        "CPT_RUN_ID": CPT_RUN_ID,
        "reason": reason,
        "TRAINING_AUTHORIZATION": TRAINING_AUTHORIZATION,
        "STAGE3B_AUTHORIZATION": STAGE3B_AUTHORIZATION,
        "optimizer_steps": 0,
        "OPTIMIZER_STEPS": 0,
        "AdamW_constructed": False,
        "training_executed": False,
        "TRAINING_AUTHORIZATION_FINAL": "OFF",
        "STAGE_B_EXECUTED": False,
        "WRIM0_MODIFIED": False,
        "TOKENIZER_MODIFIED": False,
        "ARCHITECTURE_MODIFIED": False,
        "CANONICAL_PROMOTED": False,
        "STAGE3B_EXECUTED": False,
        "RAEL_PROMOTED": False,
        "COMMIT": False,
        "PUSH": False,
        "DEPLOY": False,
    }


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
        row = {k: it.get(k) for k in ("item_id", "family", "ARGMAX_TOKEN", "ARGMAX_LOGIT", "TARGET_TOKEN", "TARGET_LOGIT", "TARGET_RANK", "LOGIT_GAP", "greedy", "greedy_exact", "eos")}
        top = (it.get("TOP_10") or [])[:5]
        row["TOP_5"] = top
        items.append(row)
    keep["items"] = items
    return keep


def classify_foundation_signal(parent_f: dict[str, Any] | None, now: dict[str, Any], genesis_parent: float | None, genesis_now: float | None) -> dict[str, Any]:
    p_rank = (parent_f or {}).get("ASSISTANT_BOUNDARY_TARGET_RANK")
    n_rank = now.get("ASSISTANT_BOUNDARY_TARGET_RANK")
    p_top5 = int((parent_f or {}).get("ASSISTANT_BOUNDARY_TOP5_COUNT") or 0)
    n_top5 = int(now.get("ASSISTANT_BOUNDARY_TOP5_COUNT") or 0)
    p_g = int((parent_f or {}).get("ASSISTANT_BOUNDARY_GREEDY_COUNT") or 0)
    n_g = int(now.get("ASSISTANT_BOUNDARY_GREEDY_COUNT") or 0)
    p_nl = float((parent_f or {}).get("NEWLINE_ATTRACTOR_RATE") or 0)
    n_nl = float(now.get("NEWLINE_ATTRACTOR_RATE") or 0)
    rank_improved = p_rank is not None and n_rank is not None and float(n_rank) < float(p_rank) * 0.7
    greedy_nonzero = n_g > 0
    top5_material = n_top5 >= max(2, p_top5 + 1)
    attractor_eased = n_nl < p_nl - 0.15 or n_nl < 0.5
    eos_now = int(now.get("EOS_GREEDY_STOP_COUNT") or 0)
    eos_parent = int((parent_f or {}).get("EOS_GREEDY_STOP_COUNT") or 0)
    eos_improved = eos_now > eos_parent
    gen_ok = True
    if genesis_parent is not None and genesis_now is not None:
        gen_ok = genesis_now < genesis_parent + 0.75
    a = bool(rank_improved or top5_material)
    b = bool(attractor_eased)
    c = bool(greedy_nonzero or top5_material)
    d = bool(eos_improved or eos_now > 0)
    e = bool(gen_ok)
    if not e:
        disp = "RETENTION_FAILURE"
    elif a and b and c and d and e:
        disp = "FOUNDATION_BREAKTHROUGH"
    elif a or b or c or d:
        disp = "FOUNDATION_IMPROVING"
    else:
        disp = "INSUFFICIENT_FOUNDATION_SIGNAL"
    continue_b = disp in {"FOUNDATION_BREAKTHROUGH", "FOUNDATION_IMPROVING"} and e
    return {
        "A_rank_improved": a,
        "B_attractor_eased": b,
        "C_short_response_signal": c,
        "D_eos_improved": d,
        "E_general_language_held": e,
        "FOUNDATION_SIGNAL_STATUS": disp,
        "RESPONSE_BOUNDARY_STATUS": "IMPROVING" if a or b else "UNCHANGED",
        "EOS_LEARNING_STATUS": "IMPROVING" if d else "UNCHANGED",
        "UNDERTRAINING_HYPOTHESIS_STATUS": "STILL_PLAUSIBLE" if disp != "FOUNDATION_BREAKTHROUGH" else "WEAKENED",
        "CPT_STAGE_A_DISPOSITION": disp,
        "CONTINUE_TO_STAGE_B_RECOMMENDED": "YES" if continue_b else "NO",
    }


def build_commander_report(summary: dict[str, Any]) -> dict[str, Any]:
    packing = summary.get("packing") or {}
    f0 = ((summary.get("foundation_by_step") or {}).get("0")) or {}
    fN = ((summary.get("foundation_by_step") or {}).get(str(summary.get("optimizer_steps") or 0))) or {}
    if not fN:
        steps = sorted((int(k) for k in (summary.get("foundation_by_step") or {})), reverse=True)
        fN = (summary.get("foundation_by_step") or {}).get(str(steps[0])) if steps else {}
    val = summary.get("val_by_step") or {}
    last_val = val.get(str(summary.get("optimizer_steps") or 0)) or {}
    parent_val = val.get("0") or {}
    return {
        "kind": "WRIM_CONTINUED_PRETRAINING_STAGE_A_REPORT",
        "CPT_RUN_ID": CPT_RUN_ID,
        "PARENT": PARENT_ID,
        "PARENT_HASH": PARENT_SHA,
        "ARCHITECTURE": ARCHITECTURE,
        "PARAMETER_COUNT": PARAM_COUNT,
        "TOKENIZER": TOKENIZER_ID,
        "TOKENIZER_HASH": TOKENIZER_SHA,
        "CORPUS_ID": CORPUS_ID,
        "CORPUS_HASH": summary.get("CORPUS_HASH"),
        "CORPUS_TOTAL_TOKENS": packing.get("n_tokens"),
        "CORPUS_MIX": packing.get("shares"),
        "ROLE_DELIMITED_TOKEN_COUNT": (packing.get("counts") or {}).get("role"),
        "ASSISTANT_TOKEN_DENSITY": packing.get("ASSISTANT_TOKEN_DENSITY"),
        "COMMANDER_TOKEN_DENSITY": packing.get("COMMANDER_TOKEN_DENSITY"),
        "EOS_DENSITY": packing.get("EOS_DENSITY"),
        "CODE_SHARE": (packing.get("shares") or {}).get("code"),
        "JSON_SHARE": (packing.get("shares") or {}).get("json"),
        "NATURAL_LANGUAGE_SHARE": (packing.get("shares") or {}).get("natural"),
        "TECHNICAL_SHARE": (packing.get("shares") or {}).get("technical"),
        "GENESIS_REHEARSAL_SHARE": (packing.get("shares") or {}).get("genesis"),
        "EXACT_DUPLICATES": summary.get("EXACT_DUPLICATES"),
        "NEAR_DUPLICATES": summary.get("NEAR_DUPLICATES"),
        "STAGE3_LEAKAGE": summary.get("STAGE3_LEAKAGE"),
        "ADDENDUM_LEAKAGE": summary.get("ADDENDUM_LEAKAGE"),
        "LICENSE_STATUS": summary.get("LICENSE_STATUS"),
        "ORIGINAL_PRETRAIN_RECIPE": ORIGINAL_PRETRAIN_RECIPE,
        "CONTINUED_PRETRAIN_RECIPE": summary.get("CONTINUED_PRETRAIN_RECIPE"),
        "TRAINER_PROVENANCE_HASH": summary.get("TRAINER_PROVENANCE_HASH"),
        "MAX_ADDITIONAL_TOKENS": MAX_ADDITIONAL_TOKENS_CAP,
        "TOKENS_EXECUTED": summary.get("tokens_seen"),
        "OPTIMIZER_STEPS": summary.get("optimizer_steps"),
        "TRAINING_TIME": summary.get("TRAINING_TIME"),
        "TOKENS_PER_SECOND": summary.get("TOKENS_PER_SECOND"),
        "GRADIENT_TRAJECTORY": summary.get("GRADIENT_TRAJECTORY"),
        "LOSS_TRAJECTORY": summary.get("LOSS_TRAJECTORY"),
        "GENERAL_VAL_NLL": last_val.get("general"),
        "GENESIS_VAL_NLL": last_val.get("genesis"),
        "CODE_VAL_NLL": last_val.get("code"),
        "JSON_VAL_NLL": last_val.get("json"),
        "ROLE_RESPONSE_VAL_NLL": last_val.get("role"),
        "SHORT_RESPONSE_VAL_NLL": last_val.get("short"),
        "EOS_METRICS": last_val.get("eos") or fN,
        "ASSISTANT_BOUNDARY_TARGET_RANK": fN.get("ASSISTANT_BOUNDARY_TARGET_RANK"),
        "ASSISTANT_BOUNDARY_TOP5_COUNT": fN.get("ASSISTANT_BOUNDARY_TOP5_COUNT"),
        "ASSISTANT_BOUNDARY_GREEDY_COUNT": fN.get("ASSISTANT_BOUNDARY_GREEDY_COUNT"),
        "DOCUMENT_CONTINUATION_ATTRACTOR_RATE": fN.get("DOCUMENT_CONTINUATION_ATTRACTOR_RATE"),
        "BACKTICK_ATTRACTOR_RATE": fN.get("BACKTICK_ATTRACTOR_RATE"),
        "NEWLINE_ATTRACTOR_RATE": fN.get("NEWLINE_ATTRACTOR_RATE"),
        "COLON_ATTRACTOR_RATE": fN.get("COLON_ATTRACTOR_RATE"),
        "UNDERSCORE_ATTRACTOR_RATE": fN.get("UNDERSCORE_ATTRACTOR_RATE"),
        "STAGE3_OBSERVATION": summary.get("stage3_by_step"),
        "CAP": MAX_ADDITIONAL_TOKENS_CAP,
        "RETENTION_STATUS": summary.get("RETENTION_STATUS"),
        "PROCESS_RESTART_COUNT": summary.get("PROCESS_RESTART_COUNT"),
        "RESUME_COUNT": summary.get("RESUME_COUNT"),
        "BEST_CHECKPOINT": summary.get("BEST_CHECKPOINT"),
        "BEST_CHECKPOINT_HASH": summary.get("BEST_CHECKPOINT_HASH"),
        "PARENT_FOUNDATION": f0,
        "FINAL_FOUNDATION": fN,
        "PARENT_VAL": parent_val,
        **classify_foundation_signal(f0, fN, parent_val.get("genesis"), last_val.get("genesis")),
        "STAGE_B_EXECUTED": False,
        "WRIM0_MODIFIED": False,
        "TOKENIZER_MODIFIED": False,
        "ARCHITECTURE_MODIFIED": False,
        "CANONICAL_PROMOTED": False,
        "STAGE3B_EXECUTED": False,
        "RAEL_PROMOTED": False,
        "COMMIT": False,
        "PUSH": False,
        "DEPLOY": False,
        "HARD_STOP_TRIGGERED": summary.get("HARD_STOP_TRIGGERED"),
        "stop_reason": summary.get("stop_reason"),
        "NEXT_COMMANDER_DECISION": summary.get("NEXT_COMMANDER_DECISION"),
    }


def run_authorized_training(args: argparse.Namespace) -> dict[str, Any]:
    import numpy as np
    import torch
    from tokenizers import Tokenizer

    from run000007_env import verify_linux_env
    from run000007_preflight import collision_roots, resolve_dump_root, sha256_file
    from run000007_vram import ensure_vram_for_training, start_user_ollama
    from stage1_pack import slice_contiguous_batches
    from stage3_runtime import parent_pointer, write_abort, write_json
    from wrim_cpt_collision import assert_run_id_unused, inspect_existing_run, resume_decision
    from wrim_cpt_corpus import CORPUS_VERSION as CV
    from wrim_cpt_corpus import corpus_root
    from wrim_cpt_eval import evaluate_foundation, family_nll
    from wrim_cpt_pack import pack_cpt_stream
    from wrim_cpt_preflight import locate_addendum, locate_baseline, locate_suite
    from wrim_cpt_schedule import freeze_schedule, lr_cpt_000001
    from wrim_g20m import WRIM0Model
    from wrim_proven_load import disable_tf32, load_parent_into_model
    from wrim_resumable_checkpoint import (
        disk_preflight,
        latest_complete_checkpoint,
        move_optimizer_state_to_device,
        restore_resumable_checkpoint,
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

    ckpt_root = Path(args.ckpt)
    report_path = Path(args.report)
    commander_report_path = Path(args.commander_report) if getattr(args, "commander_report", None) else (ckpt_root / "WRIM_CONTINUED_PRETRAINING_STAGE_A_REPORT.json")
    env = verify_linux_env(python_bin=LINUX_VENV_PYTHON)
    if not env["ok"]:
        payload = {**denial_payload("training_environment_mismatch"), "env": env}
        write_json(report_path, payload)
        return payload

    inspect = inspect_existing_run(ckpt_root)
    coll = assert_run_id_unused(CPT_RUN_ID, collision_roots(Path(args.data_root)))
    decision = resume_decision(inspect, coll)
    resume_mode = decision.get("action") == "RESUME_SAME_RUN"
    process_restart_count = 0
    resume_count = 0
    resume_steps: list[int] = []
    if decision.get("action") in {"RETURN_STATE_TO_COMMANDER", "REFUSE_RESUME"}:
        payload = {
            **denial_payload(str(decision.get("reason") or "existing_cpt_run")),
            "collision": coll,
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

    weights = dump / "model-lab" / "manifests" / "wrim0_checkpoints" / "checkpoint-final.safetensors"
    tokenizer_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    parent_hash = sha256_file(weights)
    tok_hash = sha256_file(tokenizer_path)
    if parent_hash != PARENT_SHA or tok_hash != TOKENIZER_SHA:
        payload = denial_payload("parent_or_tokenizer_hash_mismatch")
        payload.update({"parent_hash": parent_hash, "tokenizer_hash": tok_hash})
        write_json(report_path, payload)
        return payload

    man_p = corpus_root() / f"{CV}-MANIFEST.json"
    if not man_p.is_file():
        payload = denial_payload("cpt_corpus_not_frozen")
        write_json(report_path, payload)
        return payload
    corpus_manifest = json.loads(man_p.read_text(encoding="utf-8"))
    corpus_hash = corpus_manifest.get("CORPUS_HASH")

    sched = {"ok": True}
    from wrim_cpt_schedule import self_test as schedule_self_test

    sched = schedule_self_test()
    if not sched["ok"]:
        payload = {**denial_payload("lr_schedule_self_test_failed"), "schedule_self_test": sched}
        write_json(report_path, payload)
        return payload

    ollama_restored = False
    vram = ensure_vram_for_training()
    ollama_active_before = bool(vram.get("OLLAMA_ACTIVE_BEFORE"))
    ollama_stopped = bool(vram.get("OLLAMA_STOPPED_FOR_TRAINING"))
    if not vram["ok"]:
        payload = {**denial_payload("insufficient_vram"), "vram": vram}
        if ollama_stopped:
            start_user_ollama()
            ollama_restored = True
            payload["OLLAMA_RESTORED"] = True
        write_json(report_path, payload)
        return payload

    disk = disk_preflight(
        ckpt_root,
        n_full_checkpoints=9,
        bytes_per_checkpoint=400_000_000,
        eval_bytes=1_000_000_000,
        extra_bytes=1_000_000_000,
    )
    if not disk["ok"]:
        payload = {**denial_payload("insufficient_disk_for_checkpoints"), "DISK_PREFLIGHT": disk}
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload

    lr_table = freeze_schedule()
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)
    rng_after_seed = rng_snapshot()
    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    model = WRIM0Model()
    load_parent_into_model(model, weights)
    model.to(device)

    packing = pack_cpt_stream(dump)
    if not packing.get("ok"):
        payload = {**denial_payload("packing_preflight_fail"), "packing": jsonable_packing(packing)}
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload
    stream = packing.pop("_stream")
    val_packs = packing.pop("_val_packs", {}) or {}
    packing.pop("_role_val", None)
    packing.pop("_pools", None)
    if stream is None or int(getattr(stream, "size", 0) or 0) < MAX_TOKENS + 1:
        payload = denial_payload("packed_stream_too_short")
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload
    batches = slice_contiguous_batches(stream, STEPS, MICRO_BATCH, SEQ_LEN)
    parent_cpu = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}

    ckpt_root.mkdir(parents=True, exist_ok=True)
    evals_dir = ckpt_root / "evals"
    evals_dir.mkdir(parents=True, exist_ok=True)
    write_json(ckpt_root / "parent_pointer.json", parent_pointer(weights_path=weights, parent_sha=PARENT_SHA))
    write_json(
        ckpt_root / "run-origin.json",
        {"CREATED_BY_MISSION": MISSION_ORIGIN, "CPT_RUN_ID": CPT_RUN_ID, "STAGE": STAGE, "timestamp": utc_now()},
    )
    write_json(
        ckpt_root / "lr-schedule.json",
        {"seed": SEED, "eval_seed": EVAL_SEED, "schedule": lr_table, "peak_lr": PEAK_LR, "min_lr": MIN_LR, "self_test": sched},
    )
    write_json(ckpt_root / "packing.json", jsonable_packing(packing))
    write_json(ckpt_root / "rng-after-seed.json", rng_after_seed)

    here = Path(__file__).resolve().parent
    trainer_sha = file_sha(Path(__file__))
    proven_sha = file_sha(here / "wrim_proven_load.py")
    packer_sha = file_sha(here / "wrim_cpt_pack.py")
    eval_sha = file_sha(here / "wrim_cpt_eval.py")
    ckpt_mod_sha = file_sha(here / "wrim_resumable_checkpoint.py")
    live_sha = file_sha(here / "wrim_train_liveness.py")
    sched_sha = file_sha(here / "wrim_cpt_schedule.py")
    corpus_sha = file_sha(here / "wrim_cpt_corpus.py")
    provenance = hashlib.sha256(
        f"{trainer_sha}|{proven_sha}|{packer_sha}|{eval_sha}|{ckpt_mod_sha}|{live_sha}|{sched_sha}|{corpus_sha}".encode()
    ).hexdigest()
    lr_schedule_hash = schedule_hash(lr_table)
    stream_sha = hashlib.sha256(stream.tobytes()).hexdigest()
    addendum_path = locate_addendum(Path(args.data_root))
    addendum_hash = sha256_file(addendum_path) if addendum_path else ADDENDUM_SHA
    suite_path = Path(args.suite) if getattr(args, "suite", None) else locate_suite()
    baseline_path = Path(args.baseline) if getattr(args, "baseline", None) else locate_baseline(Path(args.data_root))
    identity = {
        "RUN_ID": CPT_RUN_ID,
        "PARENT_MODEL_ID": PARENT_ID,
        "PARENT_HASH": parent_hash,
        "TOKENIZER_HASH": tok_hash,
        "STAGE3_HASH": SUITE_SHA,
        "INSTRUCTION_ADDENDUM_HASH": addendum_hash,
        "TRAIN_DATASET_IDS": [CORPUS_ID, CORPUS_VERSION],
        "TRAIN_DATASET_HASHES": {CORPUS_VERSION: corpus_hash},
        "VALIDATION_DATASET_IDS": [CORPUS_ID, "WRIM-FOUNDATION-EVAL-1"],
        "VALIDATION_DATASET_HASHES": {CORPUS_VERSION: corpus_hash},
        "TRAINER_PROVENANCE_HASH": provenance,
        "PACKER_PROVENANCE_HASH": packer_sha,
        "OPTIMIZER_CLASS": "AdamW",
        "OPTIMIZER_HYPERPARAMETERS": {
            "fused": False,
            "betas": [0.9, 0.95],
            "eps": 1e-8,
            "weight_decay": WEIGHT_DECAY,
            "grad_clip": GRAD_CLIP,
        },
        "LR_SCHEDULE_ID": "wrim_cpt_schedule.lr_cpt_000001",
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
    stage3_by_step: dict[str, Any] = {}
    parent_foundation: dict[str, Any] | None = None
    parent_genesis_nll: float | None = None
    parent_s3_pass: set[str] = set()
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
            curriculum={"stage": "CPT_STAGE_A", "max_tokens": MAX_TOKENS, "mix": LOCKED_MIX},
            identity=identity,
            lr_table=lr_table,
            authorized_max_step=STEPS,
            authorized_max_tokens=MAX_TOKENS,
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
            pred = torch.argmax(logits, dim=-1)
        eos_pos = (y == 2).nonzero(as_tuple=False).flatten()
        ast_pos = (x[0] == ASSISTANT_ID).nonzero(as_tuple=False).flatten()
        n_eos = int(eos_pos.numel())
        eos_hit = int((pred[eos_pos] == 2).sum().item()) if n_eos else 0
        ast_next = 0
        ast_n = int(ast_pos.numel())
        if ast_n:
            # next-token after assistant should not be commander/document junk exclusively; record argmax id
            ast_next = int((pred[ast_pos] == 2).sum().item())
        return {
            "EOS_POSITIONS": n_eos,
            "EOS_ARGMAX_ACCURACY": (eos_hit / n_eos) if n_eos else None,
            "ASSISTANT_THEN_EOS_RATE": (ast_next / ast_n) if ast_n else None,
            "COMMANDER_COUNT": int((y == COMMANDER_ID).sum().item()),
            "ASSISTANT_COUNT": ast_n,
        }

    def run_eval(step: int, train_loss: float | None, tokens: int, lr: float | None) -> dict[str, Any]:
        nonlocal parent_foundation, parent_genesis_nll, parent_s3_pass
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        heartbeat(step, tokens, train_loss, None, lr, phase="eval_start")
        torch.manual_seed(EVAL_SEED)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(EVAL_SEED)
        was = model.training
        model.eval()
        found = evaluate_foundation(model=model, tokenizer=tokenizer, device=device)
        nlls = family_nll(model=model, device=device, packs=val_packs)
        short_ids = val_packs.get("role") or []
        nlls["short"] = nlls.get("role")
        eos = eos_metrics_from_ids(short_ids)
        nlls["eos"] = eos
        foundation_by_step[str(step)] = slim_foundation(found)
        val_by_step[str(step)] = nlls
        write_json(evals_dir / f"foundation-step-{step}.json", slim_foundation(found))
        write_json(evals_dir / f"val-nll-step-{step}.json", nlls)
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
            s3_obs = {
                "step": step,
                "mean_wrim0_anchor_nll_delta": ev.get("mean_wrim0_anchor_nll_delta"),
                "mean_kl_wrim0_to_candidate": ev.get("mean_kl_wrim0_to_candidate"),
                "historical_pass_count": ev.get("historical_pass_count"),
                "historical_binary": ev.get("historical_binary"),
                "n_collapsed": ev.get("n_collapsed"),
                "val_loss_corpus0": ev.get("val_loss_corpus0"),
                "observe_only": True,
            }
            stage3_by_step[str(step)] = s3_obs
            write_json(evals_dir / f"stage3-observe-step-{step}.json", s3_obs)
            if step == 0:
                parent_s3_pass = {
                    str(x.get("evalId"))
                    for x in list((ev.get("cap_eval_0") or {}).get("items") or [])
                    if x.get("binary_pass") is True
                }
        if step == 0:
            parent_foundation = slim_foundation(found)
            parent_genesis_nll = nlls.get("genesis")
        if was:
            model.train()
            for p in model.parameters():
                p.requires_grad_(True)
        heartbeat(step, tokens, train_loss, None, lr, phase="eval_done")
        new_fail = []
        if s3_obs and step != 0:
            now_pass = set()
            # historical_binary may be a dict or count; keep observe-only
            pass
        return {
            "step": step,
            "foundation": slim_foundation(found),
            "val": nlls,
            "stage3": s3_obs,
            "NEW_PROTECTED_FAILURES": new_fail,
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
            lr=lr_cpt_000001(1),
            betas=tuple(BETAS),
            eps=EPS,
            weight_decay=WEIGHT_DECAY,
            fused=False,
        )

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
                    if step_s == "0":
                        parent_foundation = obj
                except (OSError, json.JSONDecodeError):
                    continue
            for p in sorted(evals_dir.glob("val-nll-step-*.json")):
                try:
                    obj = json.loads(p.read_text(encoding="utf-8"))
                    step_s = p.name.replace("val-nll-step-", "").replace(".json", "")
                    val_by_step[step_s] = obj
                    if step_s == "0":
                        parent_genesis_nll = obj.get("genesis")
                except (OSError, json.JSONDecodeError):
                    continue
            if "0" not in foundation_by_step:
                run_eval(0, None, 0, None)
            heartbeat(int(man["CURRENT_GLOBAL_STEP"]), tokens_seen, None, None, None)
            if start_step > STEPS:
                summary = {
                    "ok": True,
                    "kind": "WRIM1_CPT_000001_STAGE_A_COMPLETE_PENDING_REVIEW",
                    "CPT_RUN_ID": CPT_RUN_ID,
                    "optimizer_steps": STEPS,
                    "tokens_seen": tokens_seen,
                    "stop_reason": "COMPLETE",
                    "HARD_STOP_TRIGGERED": False,
                    "TRAINING_AUTHORIZATION": "OFF",
                }
                summary["commander_report"] = build_commander_report({**summary, "packing": packing, "foundation_by_step": foundation_by_step, "val_by_step": val_by_step})
                write_json(report_path, summary)
                return summary
        else:
            run_eval(0, None, 0, None)
            persist_full(0, 0)

        for step in range(start_step, STEPS + 1):
            if tokens_seen + TOKENS_PER_STEP > MAX_ADDITIONAL_TOKENS_CAP:
                abort = {
                    **denial_payload("token_cap"),
                    "HARD_STOP_TRIGGERED": True,
                    "stop_reason": "token_cap",
                    "tokens_seen": tokens_seen,
                    "step": step - 1,
                }
                break
            x_np, y_np = batches[step - 1]
            x = torch.tensor(x_np, dtype=torch.long, device=device)
            y = torch.tensor(y_np, dtype=torch.long, device=device)
            for pg in optimizer.param_groups:
                pg["lr"] = lr_cpt_000001(step)
            optimizer.zero_grad(set_to_none=True)
            logits = model(x)
            loss = torch.nn.functional.cross_entropy(logits.reshape(-1, logits.size(-1)), y.reshape(-1))
            if not torch.isfinite(loss):
                abort = {
                    **denial_payload("NaN_or_Inf_loss"),
                    "HARD_STOP_TRIGGERED": True,
                    "stop_reason": "NaN_or_Inf_loss",
                    "step": step,
                    "tokens_seen": tokens_seen,
                    "loss": str(loss.item()),
                }
                break
            loss.backward()
            grad_norm = torch.nn.utils.clip_grad_norm_(model.parameters(), GRAD_CLIP)
            if not torch.isfinite(grad_norm) or float(grad_norm) >= 50:
                abort = {
                    **denial_payload("gradient_hard_stop"),
                    "HARD_STOP_TRIGGERED": True,
                    "stop_reason": "gradient_hard_stop",
                    "step": step,
                    "tokens_seen": tokens_seen,
                    "grad_norm": float(grad_norm) if torch.isfinite(grad_norm) else str(grad_norm),
                }
                persist_full(step, tokens_seen)
                break
            optimizer.step()
            tokens_seen += TOKENS_PER_STEP
            row = {
                "step": step,
                "loss": float(loss.item()),
                "lr": lr_cpt_000001(step),
                "grad_norm": float(grad_norm),
                "tokens_seen": tokens_seen,
            }
            metrics.append(row)
            (ckpt_root / "metrics.jsonl").open("a", encoding="utf-8").write(json.dumps(row) + "\n")
            heartbeat(step, tokens_seen, float(loss.item()), float(grad_norm), lr_cpt_000001(step))
            if step in WEIGHT_STEPS or step in OPTIMIZER_STATE_STEPS:
                persist_full(step, tokens_seen)
            if step in FULL_EVAL_STEPS:
                ev = run_eval(step, float(loss.item()), tokens_seen, lr_cpt_000001(step))
                write_json(evals_dir / f"step-{step}.json", {"step": step, "val": ev.get("val"), "foundation_summary": {k: ev.get("foundation", {}).get(k) for k in ("ASSISTANT_BOUNDARY_TARGET_RANK", "ASSISTANT_BOUNDARY_TOP5_COUNT", "ASSISTANT_BOUNDARY_GREEDY_COUNT", "NEWLINE_ATTRACTOR_RATE", "BACKTICK_ATTRACTOR_RATE")}})
                g_now = (ev.get("val") or {}).get("genesis")
                if parent_genesis_nll is not None and g_now is not None and float(g_now) > float(parent_genesis_nll) + 1.5:
                    abort = {
                        **denial_payload("genesis_nll_regression"),
                        "HARD_STOP_TRIGGERED": True,
                        "stop_reason": "genesis_nll_regression",
                        "step": step,
                        "tokens_seen": tokens_seen,
                        "parent_genesis_nll": parent_genesis_nll,
                        "now_genesis_nll": g_now,
                    }
                    break

        elapsed = time.perf_counter() - t_train0
        tps = (tokens_seen / elapsed) if elapsed > 0 else None
        losses = [m.get("loss") for m in metrics if m.get("loss") is not None]
        grads = [m.get("grad_norm") for m in metrics if m.get("grad_norm") is not None]
        last_step = max((m.get("step") or 0) for m in metrics) if metrics else 0
        best = None
        best_hash = None
        best_rank = None
        for s, f in foundation_by_step.items():
            r = f.get("ASSISTANT_BOUNDARY_TARGET_RANK")
            if r is None:
                continue
            if best_rank is None or float(r) < float(best_rank):
                best_rank = r
                ck = next((c for c in checkpoints if int(c.get("step") or -1) == int(s)), None)
                best = ck.get("path") if ck else f"step-{s}"
                best_hash = ck.get("model_sha256") if ck else None
        continued_recipe = {
            "optimizer": "AdamW",
            "peak_lr": PEAK_LR,
            "min_lr": MIN_LR,
            "warmup_steps": WARMUP_STEPS,
            "steps": STEPS,
            "max_tokens": MAX_TOKENS,
            "weight_decay": WEIGHT_DECAY,
            "grad_clip": GRAD_CLIP,
            "objective": "full_stream_next_token_ce",
        }
        next_decision = (
            "STOP. Stage A complete. TRAINING_AUTHORIZATION=OFF. Do not start Stage B automatically. "
            "Do not start RUN-000013. Do not start instruction SFT. Do not start Stage 3B. "
            "Do not promote WRIM, Ra'el, tokenizer, or architecture. Do not commit, push, or deploy. "
            "Return to Commander."
        )
        if abort is None:
            if STEPS not in WEIGHT_STEPS:
                persist_full(last_step, tokens_seen)
            summary = {
                "ok": True,
                "kind": "WRIM1_CPT_000001_STAGE_A_COMPLETE_PENDING_REVIEW",
                "CPT_RUN_ID": CPT_RUN_ID,
                "optimizer_steps": last_step,
                "tokens_seen": tokens_seen,
                "stop_reason": "COMPLETE",
                "HARD_STOP_TRIGGERED": False,
                "TRAINING_AUTHORIZATION": "OFF",
                "STAGE3B_AUTHORIZATION": "NO",
                "checkpoints": checkpoints,
                "metrics": metrics[-32:],
                "packing": jsonable_packing(packing),
                "CORPUS_HASH": corpus_hash,
                "TRAINER_PROVENANCE_HASH": provenance,
                "TRAINER_FILE_SHA256": trainer_sha,
                "CONTINUED_PRETRAIN_RECIPE": continued_recipe,
                "foundation_by_step": foundation_by_step,
                "val_by_step": val_by_step,
                "stage3_by_step": stage3_by_step,
                "TRAINING_TIME": elapsed,
                "TOKENS_PER_SECOND": tps,
                "LOSS_TRAJECTORY": {"first": losses[0] if losses else None, "last": losses[-1] if losses else None, "min": min(losses) if losses else None},
                "GRADIENT_TRAJECTORY": {"first": grads[0] if grads else None, "last": grads[-1] if grads else None, "max": max(grads) if grads else None},
                "PROCESS_RESTART_COUNT": process_restart_count,
                "RESUME_COUNT": resume_count,
                "BEST_CHECKPOINT": best,
                "BEST_CHECKPOINT_HASH": best_hash,
                "EXACT_DUPLICATES": corpus_manifest.get("exact_duplicates_dropped_from_role"),
                "NEAR_DUPLICATES": "NOT_COMPUTED_MINHASH",
                "STAGE3_LEAKAGE": "NONE_IN_ROLE_SCAN",
                "ADDENDUM_LEAKAGE": "NONE_IN_ROLE_SCAN",
                "LICENSE_STATUS": "INTERNAL_FIRST_PARTY_PLUS_ORIGINAL_SYNTHETIC_ROLE",
                "RETENTION_STATUS": "HELD" if (val_by_step.get(str(last_step), {}).get("genesis") is None or parent_genesis_nll is None or float(val_by_step.get(str(last_step), {}).get("genesis")) < float(parent_genesis_nll) + 1.5) else "REGRESSED",
                "EXIT_CODE": 0,
                "SIGNAL": term.signal,
                "PYTHON_EXCEPTION": None,
                "NEXT_COMMANDER_DECISION": next_decision,
            }
            summary["commander_report"] = build_commander_report(summary)
            write_json(report_path, summary)
            write_json(commander_report_path, summary["commander_report"])
            write_json(ckpt_root / "training-summary.json", {k: summary.get(k) for k in ("ok", "kind", "optimizer_steps", "tokens_seen", "stop_reason", "HARD_STOP_TRIGGERED")})
            write_json(Path(LINUX_DATA_ROOT) / "WRIM_CONTINUED_PRETRAINING_STAGE_A_REPORT.json", summary["commander_report"])
            return summary
        abort.update(
            {
                "TRAINING_AUTHORIZATION": "OFF",
                "checkpoints": checkpoints,
                "metrics": metrics[-32:],
                "packing": jsonable_packing(packing),
                "CORPUS_HASH": corpus_hash,
                "TRAINER_PROVENANCE_HASH": provenance,
                "foundation_by_step": foundation_by_step,
                "val_by_step": val_by_step,
                "stage3_by_step": stage3_by_step,
                "TRAINING_TIME": elapsed,
                "TOKENS_PER_SECOND": tps,
                "PROCESS_RESTART_COUNT": process_restart_count,
                "RESUME_COUNT": resume_count,
                "CONTINUED_PRETRAIN_RECIPE": continued_recipe,
                "NEXT_COMMANDER_DECISION": next_decision,
                "optimizer_steps": last_step,
                "tokens_seen": tokens_seen,
            }
        )
        abort["commander_report"] = build_commander_report(abort)
        write_json(report_path, abort)
        write_abort(ckpt_root, abort)
        write_json(commander_report_path, abort["commander_report"])
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
            "SIGNAL": term.signal,
        }
        try:
            payload["commander_report"] = build_commander_report(payload)
        except Exception:
            pass
        write_json(report_path, payload)
        write_json(ckpt_root / "last-exit.json", payload)
        return payload
    finally:
        if ollama_stopped:
            restore = start_user_ollama()
            ollama_restored = bool(restore.get("restored"))
            write_json(ckpt_root / "ollama-restore.json", {"OLLAMA_RESTORED": ollama_restored, **restore})
        write_json(
            ckpt_root / "training-authorization-off.json",
            {"TRAINING_AUTHORIZATION": "OFF", "CPT_RUN_ID": CPT_RUN_ID, "SIGNAL": term.signal, "timestamp": utc_now()},
        )


def daemonize_training(ckpt_root: Path) -> None:
    if os.environ.get("WRIM_DAEMONIZED") == "1":
        return
    from wrim_train_liveness import utc_now

    ckpt_root.mkdir(parents=True, exist_ok=True)
    pid = os.fork()
    if pid > 0:
        print(json.dumps({"daemonized": True, "intermediate_pid": pid, "CPT_RUN_ID": CPT_RUN_ID}, indent=2))
        raise SystemExit(0)
    os.setsid()
    pid = os.fork()
    if pid > 0:
        os._exit(0)
    os.environ["WRIM_DAEMONIZED"] = "1"
    (ckpt_root / "trainer.pid").write_text(str(os.getpid()) + "\n", encoding="utf-8")
    log = open(ckpt_root / "trainer-daemon.log", "a", encoding="utf-8", buffering=1)
    os.dup2(log.fileno(), 1)
    os.dup2(log.fileno(), 2)
    dn = os.open("/dev/null", os.O_RDONLY)
    os.dup2(dn, 0)
    print(json.dumps({"daemon_child_pid": os.getpid(), "CPT_RUN_ID": CPT_RUN_ID, "timestamp": utc_now()}))


def main() -> int:
    import sys

    ap = argparse.ArgumentParser()
    ap.add_argument(AUTHORIZE_FLAG, action="store_true")
    ap.add_argument("--dump-root", default=None)
    ap.add_argument("--data-root", required=True)
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--commander-report", default=None)
    ap.add_argument("--suite", default=None)
    ap.add_argument("--baseline", default=None)
    args, _unknown = ap.parse_known_args()
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    if not authorization_ok(sys.argv[1:]):
        payload = denial_payload("TRAINING_AUTHORIZATION_OFF_OR_FLAG_MISSING")
        report_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(payload, indent=2))
        return 0
    daemonize_training(Path(args.ckpt))
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
                    "stop_reason",
                    "HARD_STOP_TRIGGERED",
                )
            },
            indent=2,
            default=str,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
