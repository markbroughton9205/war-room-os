"""WRIM1-RUN-000010 trainer.

THIS FILE DOES NOT TRAIN UNLESS BOTH are present:
  --authorize-wrim1-run-000010
  env WRIM_TRAINING_AUTHORIZATION=ON_FOR_WRIM1_RUN_000010_ONLY
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
from pathlib import Path
from typing import Any

from run000010_identity import (
    AUTHORIZE_ENV,
    AUTHORIZE_ENV_VALUE,
    AUTHORIZE_FLAG,
    RUN_ID,
    STAGE3B_AUTHORIZATION,
    TRAINING_AUTHORIZATION,
)


def authorization_ok(argv: list[str] | None = None) -> bool:
    import sys

    args = argv if argv is not None else sys.argv[1:]
    return AUTHORIZE_FLAG in args and os.environ.get(AUTHORIZE_ENV) == AUTHORIZE_ENV_VALUE


def denial_payload(reason: str) -> dict[str, Any]:
    return {
        "ok": False,
        "kind": "WRIM1_RUN_000010_TRAINING_DENIED",
        "run_id": RUN_ID,
        "reason": reason,
        "TRAINING_AUTHORIZATION": TRAINING_AUTHORIZATION,
        "STAGE3B_AUTHORIZATION": STAGE3B_AUTHORIZATION,
        "optimizer_steps": 0,
        "OPTIMIZER_STEPS": 0,
        "AdamW_constructed": False,
        "training_executed": False,
        "TRAINING_AUTHORIZATION_FINAL": "OFF",
    }


def jsonable_packing(packing: dict[str, Any]) -> dict[str, Any]:
    skip = {"_stream", "_interleaved", "_selected", "_prefix", "_leftover"}
    out = {}
    for k, v in packing.items():
        if k in skip:
            continue
        try:
            json.dumps(v)
            out[k] = v
        except TypeError:
            out[k] = str(v)
    return out


def verify_capability_dataset() -> dict[str, Any]:
    from run000008_dataset import DATASET_DIRNAME, TRAIN_NAME, VAL_NAME, load_jsonl, sha256_file, sha256_text
    from run000010_identity import CAPABILITY_DATASET_HASH, LINUX_DATA_ROOT

    root = Path(LINUX_DATA_ROOT) / DATASET_DIRNAME
    train_p = root / TRAIN_NAME
    val_p = root / VAL_NAME
    if not train_p.is_file() or not val_p.is_file():
        return {"ok": False, "reason": "missing_files", "train": str(train_p), "val": str(val_p)}
    train_sha = sha256_file(train_p)
    val_sha = sha256_file(val_p)
    got = sha256_text(train_sha + val_sha)
    train_n = len(load_jsonl(train_p))
    val_n = len(load_jsonl(val_p))
    return {
        "ok": got == CAPABILITY_DATASET_HASH and train_n == 1050 and val_n == 118,
        "got": got,
        "expected": CAPABILITY_DATASET_HASH,
        "train_sha256": train_sha,
        "validation_sha256": val_sha,
        "train_count": train_n,
        "validation_count": val_n,
        "mutated": False,
    }


def verify_mode_entry_dataset() -> dict[str, Any]:
    from run000008_dataset import load_jsonl, sha256_file, sha256_text
    from run000010_dataset import DATASET_DIRNAME, TRAIN_NAME, VAL_NAME
    from run000010_identity import LINUX_DATA_ROOT, MODE_ENTRY_DATASET_HASH

    root = Path(LINUX_DATA_ROOT) / DATASET_DIRNAME
    train_p = root / TRAIN_NAME
    val_p = root / VAL_NAME
    if not train_p.is_file() or not val_p.is_file():
        return {"ok": False, "reason": "missing_files", "train": str(train_p), "val": str(val_p)}
    train_sha = sha256_file(train_p)
    val_sha = sha256_file(val_p)
    got = sha256_text(train_sha + val_sha)
    train_rows = load_jsonl(train_p)
    val_rows = load_jsonl(val_p)
    json_n = sum(1 for r in train_rows + val_rows if str(r.get("category") or "") in {"json", "code"})
    return {
        "ok": got == MODE_ENTRY_DATASET_HASH and json_n == 0 and len(train_rows) >= 750 and len(val_rows) >= 60,
        "got": got,
        "expected": MODE_ENTRY_DATASET_HASH,
        "train_sha256": train_sha,
        "validation_sha256": val_sha,
        "train_count": len(train_rows),
        "validation_count": len(val_rows),
        "json_code_count": json_n,
        "mutated": False,
    }


def rng_snapshot() -> dict[str, Any]:
    import numpy as np
    import torch

    py_state = random.getstate()
    np_state = np.random.get_state()
    return {
        "python_seed": 1010,
        "numpy_seed": 1010,
        "torch_cpu_seed": 1010,
        "torch_cuda_seed": 1010,
        "python_getstate_hash": hashlib.sha256(repr(py_state).encode()).hexdigest(),
        "numpy_state_hash": hashlib.sha256(np.asarray(np_state[1]).tobytes()).hexdigest(),
        "torch_cpu_rng_hash": hashlib.sha256(repr(torch.random.get_rng_state().tolist()).encode()).hexdigest(),
        "torch_cuda_rng_hash": (
            hashlib.sha256(repr(torch.cuda.get_rng_state().tolist()).encode()).hexdigest()
            if torch.cuda.is_available()
            else None
        ),
    }


def basin_counts_from_eval(ev: dict[str, Any]) -> dict[str, int]:
    cap_b = ((ev.get("capability_basins") or {}).get("counts")) or {}
    s3_b = ((ev.get("stage3_basins") or {}).get("counts")) or {}
    me_b = ((ev.get("mode_entry_basins") or {}).get("counts")) or {}
    keys = (
        "EXPECTED_TASK_MODE",
        "COLON_UNDERSCORE_ATTRACTOR",
        "LITERARY_CONTINUATION",
        "TOKENIZER_CHATTER",
        "SCHEMA_CHATTER",
        "REPETITION_LOOP",
        "OVERLONG_CONTINUATION",
        "OTHER",
    )
    return {k: int(cap_b.get(k) or 0) + int(s3_b.get(k) or 0) + int(me_b.get(k) or 0) for k in keys}


def run_authorized_training(args: argparse.Namespace) -> dict[str, Any]:
    import numpy as np
    import torch
    from tokenizers import Tokenizer

    from run000006_instruction_addendum_eval import eval_checkpoint, summarize as summarize_addendum
    from run000006_integrity import hash_reference_nll_path
    from run000007_env import verify_linux_env
    from run000007_gates import annotate_eval_snapshot, evaluate_gates, hard_stop_payload
    from run000007_preflight import collision_roots, locate_addendum, locate_reference_nll, resolve_dump_root, sha256_file, suite_canonical_sha256
    from run000007_vram import ensure_vram_for_training, start_user_ollama
    from run000008_capability_eval import eval_capability_items
    from run000008_correctness import category_correctness
    from run000008_dataset import DATASET_DIRNAME, VAL_NAME, load_jsonl as load_cap_jsonl
    from run000010_collision import assert_run_id_unused
    from run000010_diagnostics import classify_eval_items, delta_teacher_force_me, s3_inst_02_trace, teacher_force_capability
    from run000010_identity import (
        ADDENDUM_SHA,
        BASELINE_SHA,
        BETAS,
        CAPABILITY_DATASET_HASH,
        MODE_ENTRY_DATASET_HASH,
        EPS,
        EVAL_SEED,
        FULL_EVAL_STEPS,
        GRAD_CLIP,
        LINUX_DATA_ROOT,
        LINUX_VENV_PYTHON,
        MAX_TOKENS,
        MICRO_BATCH,
        NEXT_UNAUTHORIZED_STEP,
        OPTIMIZER_STATE_STEPS,
        PARENT_SHA,
        PEAK_LR,
        REFERENCE_NLL_CANONICAL_LF_SHA,
        SEED,
        SEQ_LEN,
        STEPS,
        SUITE_SHA,
        TOKENIZER_SHA,
        TOKENS_PER_STEP,
        WEIGHT_DECAY,
        WEIGHT_STEPS,
    )
    from run000010_pack import pack_run000010_stream
    from run000010_report import diagnose, engineer_diagnosis, select_best, traj
    from run000010_schedule import freeze_schedule, lr_run000010, self_test as schedule_self_test
    from stage1_pack import slice_contiguous_batches
    from stage2_pack import encode_corpus1_val_units, encode_rehearsal_val_units
    from stage3_eval_baseline import concat_units
    from stage3_runtime import parent_pointer, write_abort, write_json
    from stage3a_run import evaluate_candidate, load_baseline, load_suite, save_continuity, save_weights
    from wrim_g20m import WRIM0Model
    from wrim_proven_load import disable_tf32, load_parent_into_model

    ckpt_root = Path(args.ckpt)
    report_path = Path(args.report)
    commander_report_path = Path(args.commander_report) if getattr(args, "commander_report", None) else (ckpt_root / "WRIM1_RUN_000010_MODE_ENTRY_STOPPING_REPORT.json")
    env = verify_linux_env(python_bin=LINUX_VENV_PYTHON)
    if not env["ok"]:
        payload = {**denial_payload("training_environment_mismatch"), "env": env}
        write_json(report_path, payload)
        return payload

    if ckpt_root.exists() and any(ckpt_root.rglob("model.safetensors")):
        payload = denial_payload("run_directory_already_has_weights")
        write_json(report_path, payload)
        return payload

    dump = resolve_dump_root(args.dump_root)
    if dump is None:
        payload = denial_payload("dump_root_missing")
        write_json(report_path, payload)
        return payload

    coll = assert_run_id_unused(RUN_ID, collision_roots(Path(args.data_root)))
    if not coll["ok"]:
        payload = {**denial_payload("run_id_collision"), "collision": coll, "RUN_ID_UNUSED_BEFORE_START": False}
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

    cap_ds = verify_capability_dataset()
    if not cap_ds["ok"]:
        payload = {**denial_payload("capability_dataset_hash_mismatch"), "capability_dataset": cap_ds}
        write_json(report_path, payload)
        return payload
    me_ds = verify_mode_entry_dataset()
    if not me_ds["ok"]:
        payload = {**denial_payload("mode_entry_dataset_hash_mismatch"), "mode_entry_dataset": me_ds}
        write_json(report_path, payload)
        return payload

    sched = schedule_self_test()
    if not sched["ok"]:
        payload = {**denial_payload("lr_schedule_self_test_failed"), "schedule_self_test": sched}
        write_json(report_path, payload)
        return payload

    packing = pack_run000010_stream(dump, tokenizer_path)
    if not packing["decision"]["ok"]:
        payload = {**denial_payload("packing_preflight_fail"), "packing": jsonable_packing(packing)}
        write_json(report_path, payload)
        return payload
    if packing.get("EVAL_DUMP_LEAKAGE") != "NONE" or packing.get("INSTRUCTION_ADDENDUM_LEAKAGE") != "NONE":
        payload = {**denial_payload("eval_or_addendum_leakage"), "packing": jsonable_packing(packing)}
        write_json(report_path, payload)
        return payload

    nll_path = locate_reference_nll(Path(args.data_root))
    nll = hash_reference_nll_path(nll_path) if nll_path else None
    if not nll or nll.get("CANONICAL_LF_SHA256") != REFERENCE_NLL_CANONICAL_LF_SHA:
        payload = {**denial_payload("reference_nll_mismatch"), "reference_nll": nll}
        write_json(report_path, payload)
        return payload

    addendum_path = Path(args.addendum) if getattr(args, "addendum", None) else locate_addendum(Path(args.data_root))
    if addendum_path is None or not addendum_path.is_file():
        payload = denial_payload("addendum_missing")
        write_json(report_path, payload)
        return payload
    addendum_hash = suite_canonical_sha256(addendum_path)
    if addendum_hash != ADDENDUM_SHA:
        payload = {**denial_payload("addendum_hash_mismatch"), "addendum_hash": addendum_hash}
        write_json(report_path, payload)
        return payload
    addendum_obj = json.loads(addendum_path.read_text(encoding="utf-8"))
    addendum_items = list(addendum_obj.get("items") or [])

    cap_val_path = Path(LINUX_DATA_ROOT) / DATASET_DIRNAME / VAL_NAME
    cap_val_items = load_cap_jsonl(cap_val_path)
    from run000010_dataset import DATASET_DIRNAME as ME_DIR, VAL_NAME as ME_VAL
    me_val_path = Path(LINUX_DATA_ROOT) / ME_DIR / ME_VAL
    me_val_items = load_cap_jsonl(me_val_path)

    ollama_restored = False
    vram = ensure_vram_for_training()
    ollama_active_before = bool(vram.get("OLLAMA_ACTIVE_BEFORE"))
    ollama_stopped = bool(vram.get("OLLAMA_STOPPED_FOR_TRAINING"))
    if not vram["ok"]:
        payload = {
            **denial_payload("insufficient_vram"),
            "vram": vram,
            "OLLAMA_ACTIVE_BEFORE": ollama_active_before,
            "OLLAMA_STOPPED_FOR_TRAINING": ollama_stopped,
        }
        if ollama_stopped:
            start_user_ollama()
            ollama_restored = True
            payload["OLLAMA_RESTORED"] = True
        write_json(report_path, payload)
        payload["TRAINING_AUTHORIZATION"] = "OFF"
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
    suite = load_suite(Path(args.suite))
    baseline = load_baseline(Path(args.baseline))
    if not suite["hash_ok"] or suite["stored_hash"] != SUITE_SHA:
        payload = denial_payload("suite_hash_mismatch")
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload
    if not baseline["hash_ok"] or baseline["sha256"] != BASELINE_SHA:
        payload = denial_payload("baseline_hash_mismatch")
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload

    stream = packing.pop("_stream")
    packing.pop("_interleaved", None)
    packing.pop("_selected", None)
    if stream is None or int(getattr(stream, "size", 0) or 0) < MAX_TOKENS + 1:
        payload = denial_payload("packed_stream_too_short")
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload
    batches = slice_contiguous_batches(stream, STEPS, MICRO_BATCH, SEQ_LEN)
    c0 = concat_units(encode_rehearsal_val_units(tokenizer, dump))
    c1v = concat_units(encode_corpus1_val_units(tokenizer, dump))
    wrim0_logp: dict[str, torch.Tensor] = {}
    parent_cpu = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}

    ckpt_root.mkdir(parents=True, exist_ok=True)
    evals_dir = ckpt_root / "evals"
    evals_dir.mkdir(parents=True, exist_ok=True)
    write_json(ckpt_root / "step-0" / "parent_pointer.json", parent_pointer(weights_path=weights, parent_sha=PARENT_SHA))
    write_json(
        ckpt_root / "lr-schedule.json",
        {"seed": SEED, "eval_seed": EVAL_SEED, "schedule": lr_table, "peak_lr": PEAK_LR, "final_lr": 1e-6, "self_test": sched, "every_lr": {str(s): lr_run000010(s) for s in range(1, STEPS + 1)}},
    )
    write_json(ckpt_root / "packing.json", jsonable_packing(packing))
    write_json(ckpt_root / "rng-after-seed.json", rng_after_seed)

    parent_eval_hold: dict[str, Any] | None = None
    addendum_parent_rows: list[dict[str, Any]] | None = None
    parent_tf: dict[str, Any] | None = None
    parent_tf_me: dict[str, Any] | None = None
    parent_ids02: list[int] = []
    addendum_by_step: dict[str, Any] = {}
    capability_by_step: dict[str, Any] = {}
    correctness_by_step: dict[str, Any] = {}
    teacher_by_step: dict[str, Any] = {}
    basin_by_step: dict[str, Any] = {}
    evals_by_step: dict[str, dict[str, Any]] = {}
    checkpoints: list[dict[str, Any]] = []
    gates_by_step: dict[str, Any] = {}
    peak_me = 0
    peak_me_step = 0
    peak_passed = False
    trainer_sha = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    proven_sha = hashlib.sha256((Path(__file__).resolve().parent / "wrim_proven_load.py").read_bytes()).hexdigest()
    packer_sha = hashlib.sha256((Path(__file__).resolve().parent / "run000010_pack.py").read_bytes()).hexdigest()
    diag_sha = hashlib.sha256((Path(__file__).resolve().parent / "run000010_diagnostics.py").read_bytes()).hexdigest()
    provenance = hashlib.sha256(f"{trainer_sha}|{proven_sha}|{packer_sha}|{diag_sha}".encode()).hexdigest()

    def slim_eval(ev: dict[str, Any]) -> dict[str, Any]:
        keep = dict(ev)
        keep.pop("items", None)
        cap = dict(keep.get("capability_validation") or {})
        cap.pop("items", None)
        keep["capability_validation"] = cap
        tf = dict(keep.get("teacher_forced") or {})
        tf.pop("items", None)
        keep["teacher_forced"] = tf
        add = dict(keep.get("instruction_addendum") or {})
        add.pop("items", None)
        keep["instruction_addendum"] = add
        me = dict(keep.get("mode_entry_validation") or {})
        me.pop("items", None)
        keep["mode_entry_validation"] = me
        tfme = dict(keep.get("teacher_forced_mode_entry") or {})
        tfme.pop("items", None)
        keep["teacher_forced_mode_entry"] = tfme
        return keep

    def run_eval(step: int, train_loss: float | None, tokens: int, lr: float | None) -> dict[str, Any]:
        nonlocal parent_eval_hold, addendum_parent_rows, parent_tf, parent_tf_me, parent_ids02, peak_me, peak_me_step, peak_passed
        torch.manual_seed(EVAL_SEED)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(EVAL_SEED)
        ev = evaluate_candidate(
            model=model,
            tokenizer=tokenizer,
            device=device,
            dump_root=dump,
            suite_items=suite["obj"]["items"],
            frozen_items=baseline["obj"]["items"],
            wrim0_logp=wrim0_logp,
            parent_cpu=parent_cpu,
            c0=c0,
            c1=c1v,
            greedy_256=True,
            step=step,
            train_loss=train_loss,
            tokens=tokens,
            lr=lr,
        )
        cats = ev.get("category_aggregates") or {}
        ev["json_n_collapsed"] = int((cats.get("JSON_STRUCTURED_OUTPUT") or {}).get("n_collapsed") or 0)
        ev["code_n_collapsed"] = int((cats.get("CODE") or {}).get("n_collapsed") or 0)
        ev["n_collapsed_256"] = int(ev.get("n_collapsed") or 0)
        cap = ev.get("cap_eval_0") or {}
        ev["cap_items"] = list(cap.get("items") or [])
        ev["historical_binary"] = cap.get("historical_binary") or ev.get("historical_binary")
        parent_cap = list((parent_eval_hold or {}).get("cap_items") or [])
        ev["NEW_CAP_FAILURES_VS_PARENT"] = [
            str(x.get("evalId"))
            for x in ev["cap_items"]
            if any(str(p.get("evalId")) == str(x.get("evalId")) and p.get("binary_pass") is True and x.get("binary_pass") is not True for p in parent_cap)
        ]
        ev = annotate_eval_snapshot(ev, parent_eval_hold)
        inst = ev.get("s3_inst_02") or {}
        first = inst.get("first_token_id")
        if first is not None:
            ev["S3_INST_02_FIRST_TOKEN"] = first
            try:
                ev["S3_INST_02_FIRST_TOKEN_TEXT"] = tokenizer.decode([int(first)])
            except Exception:
                ev["S3_INST_02_FIRST_TOKEN_TEXT"] = None
        ev["S3_INST_02_MAX_RUN_256"] = inst.get("max_run_256")
        ev["S3_INST_02_GENERATION_HASH"] = inst.get("token_id_sha256_256")
        d02 = next((it.get("descriptive_256") or {} for it in (ev.get("items") or []) if it.get("item_id") == "s3-inst-02"), {})
        ids02 = [int(x) for x in (d02.get("new_ids") or [])]
        if step == 0:
            parent_ids02 = list(ids02)
        trace = s3_inst_02_trace(tokenizer, ids02, parent_ids02)
        ev.update({f"S3_INST_02_{k}": v for k, v in trace.items()})
        ev["S3_INST_02_SECOND_TOKEN"] = trace.get("SECOND_TOKEN")
        ev["S3_INST_02_FIRST_CHANGED_POSITION"] = trace.get("FIRST_CHANGED_POSITION")
        ev["S3_INST_02_EOS_POSITION"] = trace.get("EOS_POSITION")
        corr = category_correctness(list(ev.get("items") or []))
        ev["stage3_correctness"] = corr
        correctness_by_step[str(step)] = corr
        add_rows = eval_checkpoint(model=model, tokenizer=tokenizer, device=device, items=addendum_items)
        add_sum = summarize_addendum(add_rows, addendum_parent_rows)
        ev["instruction_addendum"] = {"summary": add_sum, "items": add_rows}
        addendum_by_step[str(step)] = add_sum
        write_json(evals_dir / f"addendum-step-{step}.json", {"step": step, "summary": add_sum, "items": add_rows})
        cap_sum = eval_capability_items(model=model, tokenizer=tokenizer, device=device, items=cap_val_items)
        cap_items = cap_sum.pop("items")
        ev["capability_validation"] = cap_sum
        capability_by_step[str(step)] = cap_sum
        write_json(evals_dir / f"capability-step-{step}.json", {"step": step, "summary": cap_sum, "items": cap_items})
        me_sum = eval_capability_items(model=model, tokenizer=tokenizer, device=device, items=me_val_items)
        me_items = me_sum.pop("items")
        ev["mode_entry_validation"] = me_sum
        write_json(evals_dir / f"mode-entry-step-{step}.json", {"step": step, "summary": me_sum, "items": me_items})
        cap_tf_items = [x for x in cap_val_items if str(x.get("category") or "") in {"instruction", "stopping"}]
        tf = teacher_force_capability(model=model, tokenizer=tokenizer, device=device, items=cap_tf_items)
        tf_items = tf.pop("items")
        tf_me = teacher_force_capability(model=model, tokenizer=tokenizer, device=device, items=me_val_items)
        tf_me_items = tf_me.pop("items")
        if step == 0:
            parent_tf = dict(tf)
            parent_tf_me = dict(tf_me)
        ev["teacher_forced"] = tf
        ev["teacher_forced_mode_entry"] = tf_me
        ev["teacher_forced_delta"] = delta_teacher_force_me(tf_me, parent_tf_me)
        teacher_by_step[str(step)] = {"summary": tf_me, "capability_instruction_stopping": tf, "delta": ev["teacher_forced_delta"]}
        write_json(evals_dir / f"teacher-forced-step-{step}.json", {"step": step, "mode_entry": tf_me, "capability_instruction_stopping": tf, "items": tf_me_items, "cap_items": tf_items, "delta": ev["teacher_forced_delta"]})
        cap_basins = classify_eval_items(cap_items)
        s3_basins = classify_eval_items(list(ev.get("items") or []))
        me_basins = classify_eval_items(me_items)
        ev["capability_basins"] = {"counts": cap_basins["counts"], "n": cap_basins["n"]}
        ev["stage3_basins"] = {"counts": s3_basins["counts"], "n": s3_basins["n"]}
        ev["mode_entry_basins"] = {"counts": me_basins["counts"], "n": me_basins["n"]}
        ev["basin_counts"] = basin_counts_from_eval(ev)
        basin_by_step[str(step)] = ev["basin_counts"]
        write_json(evals_dir / f"basins-step-{step}.json", {"step": step, "capability": cap_basins, "stage3": s3_basins, "mode_entry": me_basins, "combined": ev["basin_counts"]})
        me_now = int(me_sum.get("PASS_COUNT") or 0)
        inst_now = int(((me_sum.get("INSTRUCTION_VALIDATION") or {}).get("correct") or 0))
        stop_now = int(((me_sum.get("STOPPING_VALIDATION") or {}).get("correct") or 0))
        score_now = me_now + inst_now + stop_now
        if score_now > peak_me:
            peak_me = score_now
            peak_me_step = step
        elif peak_me > 0 and score_now < peak_me:
            prev = evals_by_step.get(str(peak_me_step)) or parent_eval_hold or {}
            run_now = ev.get("S3_INST_02_MAX_RUN_256")
            run_peak = prev.get("S3_INST_02_MAX_RUN_256")
            worse_rep = run_now is not None and run_peak is not None and int(run_now) > int(run_peak)
            if worse_rep:
                peak_passed = True
                ev["PEAK_PASSED"] = True
                ev["PEAK_MODE_ENTRY_STEP"] = peak_me_step
                ev["PEAK_MODE_ENTRY_SCORE"] = peak_me
        if step == 0:
            parent_eval_hold = ev
            addendum_parent_rows = add_rows
        evals_by_step[str(step)] = slim_eval(ev)
        return ev

    def build_commander_report(summary: dict[str, Any]) -> dict[str, Any]:
        diag = diagnose(evals_by_step, summary.get("metrics") or [], peak_passed)
        best = diag["best"]
        best_ev = best.get("eval") or {}
        hashes = {}
        for meta in checkpoints:
            step = meta.get("step")
            h = meta.get("model_sha256") or meta.get("tensors_sha256") or meta.get("sha256") or meta.get("hash")
            if step is not None:
                hashes[str(step)] = h or meta
        last_ev = evals_by_step.get(str(summary.get("optimizer_steps") or 0)) or evals_by_step.get("0") or {}
        parent_ev = evals_by_step.get("0") or {}
        stop_reason = summary.get("stop_reason") or ("COMPLETE" if summary.get("ok") else summary.get("reason") or "UNKNOWN")
        hard = bool(summary.get("HARD_STOP_TRIGGERED") or summary.get("action") == "HARD_STOP")
        report = {
            "kind": "WRIM1_RUN_000010_MODE_ENTRY_STOPPING_REPORT",
            "RUN_ID": RUN_ID,
            "RUN_ID_UNUSED_BEFORE_START": True,
            "TRAINING_AUTHORIZATION_INITIAL": "ON_FOR_WRIM1_RUN_000010_ONLY",
            "TRAINING_AUTHORIZATION_FINAL": "OFF",
            "ENVIRONMENT_VERIFIED": bool(env.get("ok")),
            "PARENT": "WRIM-0",
            "PARENT_HASH": parent_hash,
            "PARENT_VERIFIED": parent_hash == PARENT_SHA,
            "TOKENIZER_HASH": tok_hash,
            "TOKENIZER_VERIFIED": tok_hash == TOKENIZER_SHA,
            "STAGE3_HASH": suite.get("stored_hash"),
            "STAGE3_VERIFIED": bool(suite.get("hash_ok")) and suite.get("stored_hash") == SUITE_SHA,
            "INSTRUCTION_ADDENDUM_HASH": addendum_hash,
            "INSTRUCTION_ADDENDUM_VERIFIED": addendum_hash == ADDENDUM_SHA,
            "CAPABILITY_DATASET_HASH": cap_ds.get("got") or CAPABILITY_DATASET_HASH,
            "CAPABILITY_DATASET_VERIFIED": bool(cap_ds.get("ok")),
            "TRAINER_PROVENANCE_HASH": provenance,
            "TRAINER_FILE_SHA256": trainer_sha,
            "PROVEN_LOAD_SHA256": proven_sha,
            "PACKER_SHA256": packer_sha,
            "DIAGNOSTICS_SHA256": diag_sha,
            "PACKING_PREFLIGHT": packing.get("PACKING_PREFLIGHT"),
            "TRAINING_MIX_ACTUAL": packing.get("TRAINING_MIX_ACTUAL") or packing.get("TRAINING_MIX"),
            "INSTRUCTION_SHARE": packing.get("INSTRUCTION_SHARE"),
            "STOPPING_SHARE": packing.get("STOPPING_SHARE"),
            "JSON_TRAIN_SHARE": packing.get("JSON_TRAIN_SHARE"),
            "CODE_TRAIN_SHARE": packing.get("CODE_TRAIN_SHARE"),
            "MODE_ENTRY_DATASET_CREATED": True,
            "MODE_ENTRY_DATASET_ID": me_ds.get("got") and "WR-CORPUS-MODE-ENTRY-1-v1.0.0",
            "MODE_ENTRY_DATASET_HASH": me_ds.get("got") or MODE_ENTRY_DATASET_HASH,
            "MODE_ENTRY_TRAIN_COUNT": me_ds.get("train_count"),
            "MODE_ENTRY_VALIDATION_COUNT": me_ds.get("validation_count"),
            "STAGE3_LEAKAGE": packing.get("EVAL_DUMP_LEAKAGE"),
            "ADDENDUM_LEAKAGE": packing.get("INSTRUCTION_ADDENDUM_LEAKAGE"),
            "STARVED_DOC_IDS": packing.get("STARVED_DOC_IDS"),
            "MAX_REHEARSAL_DOC_SHARE": packing.get("MAX_REHEARSAL_DOC_SHARE"),
            "VRAM_PREFLIGHT": vram,
            "OLLAMA_ACTIVE_BEFORE": ollama_active_before,
            "OLLAMA_STOPPED": ollama_stopped,
            "OLLAMA_RESTORED": ollama_restored,
            "MAX_STEPS": 40,
            "STEPS_EXECUTED": int(summary.get("optimizer_steps") or 0),
            "FINAL_STEP": int(summary.get("optimizer_steps") or 0),
            "MAX_TOKENS": MAX_TOKENS,
            "TOKENS_PROCESSED": int(summary.get("tokens_seen") or 0),
            "STEP_41_EXECUTED": "NO",
            "STOP_REASON": stop_reason,
            "HARD_STOP_TRIGGERED": hard,
            "HARD_STOP_STEP": summary.get("triggering_step") if hard else None,
            "HARD_STOP_REASON": summary.get("stop_reason") if hard else None,
            "CHECKPOINT_HASHES": hashes,
            "BEST_CHECKPOINT_STEP": best.get("step"),
            "BEST_CHECKPOINT_HASH": hashes.get(str(best.get("step"))),
            "BEST_CHECKPOINT_REASON": best.get("reason"),
            "TRAIN_LOSS_TRAJECTORY": {str(m["step"]): m.get("loss") for m in (summary.get("metrics") or [])},
            "VAL0_TRAJECTORY": traj(evals_by_step, lambda e: e.get("val_loss_corpus0")),
            "VAL1_TRAJECTORY": traj(evals_by_step, lambda e: e.get("val_loss_corpus1")),
            "DELTA_NLL_TRAJECTORY": traj(evals_by_step, lambda e: e.get("mean_wrim0_anchor_nll_delta")),
            "KL_TRAJECTORY": traj(evals_by_step, lambda e: e.get("mean_kl_wrim0_to_candidate")),
            "GRADIENT_TRAJECTORY": {str(m["step"]): m.get("grad_norm") for m in (summary.get("metrics") or [])},
            "LR_TRAJECTORY": {str(s): lr_run000010(s) for s in range(1, STEPS + 1)},
            "PARAMETER_DISPLACEMENT_TRAJECTORY": traj(evals_by_step, lambda e: e.get("parameter_displacement")),
            "CAP_TRAJECTORY": traj(evals_by_step, lambda e: e.get("historical_binary")),
            "COLLAPSE_TRAJECTORY": traj(evals_by_step, lambda e: e.get("n_collapsed_256")),
            "INSTRUCTION_GREEDY_TRAJECTORY": traj(evals_by_step, lambda e: (e.get("capability_validation") or {}).get("INSTRUCTION_VALIDATION")),
            "STOPPING_GREEDY_TRAJECTORY": traj(evals_by_step, lambda e: (e.get("capability_validation") or {}).get("STOPPING_VALIDATION")),
            "MODE_ENTRY_VALIDATION_TRAJECTORY": traj(
                evals_by_step,
                lambda e: {
                    "INSTRUCTION": (e.get("mode_entry_validation") or {}).get("INSTRUCTION_VALIDATION"),
                    "STOPPING": (e.get("mode_entry_validation") or {}).get("STOPPING_VALIDATION"),
                    "TOTAL": (e.get("mode_entry_validation") or {}).get("PASS_COUNT"),
                },
            ),
            "JSON_GREEDY_TRAJECTORY": traj(evals_by_step, lambda e: (e.get("capability_validation") or {}).get("JSON_VALIDATION")),
            "CODE_GREEDY_TRAJECTORY": traj(evals_by_step, lambda e: (e.get("capability_validation") or {}).get("CODE_VALIDATION")),
            "CAPABILITY_VALIDATION_TRAJECTORY": traj(
                evals_by_step,
                lambda e: {
                    "INSTRUCTION": (e.get("capability_validation") or {}).get("INSTRUCTION_VALIDATION"),
                    "JSON": (e.get("capability_validation") or {}).get("JSON_VALIDATION"),
                    "CODE": (e.get("capability_validation") or {}).get("CODE_VALIDATION"),
                    "STOPPING": (e.get("capability_validation") or {}).get("STOPPING_VALIDATION"),
                    "TOTAL": f"{(e.get('capability_validation') or {}).get('PASS_COUNT')}/118",
                },
            ),
            "TARGET_FIRST_TOKEN_PROBABILITY_TRAJECTORY": traj(evals_by_step, lambda e: (((e.get("teacher_forced_mode_entry") or {}).get("instruction_stopping") or (e.get("teacher_forced") or {}).get("instruction_stopping") or {})).get("TARGET_FIRST_TOKEN_PROBABILITY")),
            "TARGET_FIRST_TOKEN_RANK_TRAJECTORY": traj(evals_by_step, lambda e: (((e.get("teacher_forced_mode_entry") or {}).get("instruction_stopping") or (e.get("teacher_forced") or {}).get("instruction_stopping") or {})).get("TARGET_FIRST_TOKEN_RANK")),
            "TARGET_SEQUENCE_NLL_TRAJECTORY": traj(evals_by_step, lambda e: (((e.get("teacher_forced_mode_entry") or {}).get("instruction_stopping") or (e.get("teacher_forced") or {}).get("instruction_stopping") or {})).get("TARGET_SEQUENCE_AVG_NLL")),
            "EOS_PROBABILITY_TRAJECTORY": traj(evals_by_step, lambda e: (((e.get("teacher_forced_mode_entry") or {}).get("instruction_stopping") or (e.get("teacher_forced") or {}).get("instruction_stopping") or {})).get("EOS_PROBABILITY_AT_CORRECT_STOP")),
            "TARGET_STOP_TOKEN_RANK_TRAJECTORY": traj(evals_by_step, lambda e: (((e.get("teacher_forced_mode_entry") or {}).get("instruction_stopping") or {})).get("TARGET_STOP_TOKEN_RANK")),
            "EXPECTED_TASK_MODE_TRAJECTORY": traj(evals_by_step, lambda e: (e.get("basin_counts") or {}).get("EXPECTED_TASK_MODE")),
            "COLON_UNDERSCORE_ATTRACTOR_TRAJECTORY": traj(evals_by_step, lambda e: (e.get("basin_counts") or {}).get("COLON_UNDERSCORE_ATTRACTOR")),
            "LITERARY_CONTINUATION_TRAJECTORY": traj(evals_by_step, lambda e: (e.get("basin_counts") or {}).get("LITERARY_CONTINUATION")),
            "TOKENIZER_CHATTER_TRAJECTORY": traj(evals_by_step, lambda e: (e.get("basin_counts") or {}).get("TOKENIZER_CHATTER")),
            "REPETITION_LOOP_TRAJECTORY": traj(evals_by_step, lambda e: (e.get("basin_counts") or {}).get("REPETITION_LOOP")),
            "S3_INST_02_MAX_RUN_TRAJECTORY": traj(evals_by_step, lambda e: e.get("S3_INST_02_MAX_RUN_256")),
            "S3_INST_02_GENERATION_HASHES": traj(evals_by_step, lambda e: e.get("S3_INST_02_GENERATION_HASH")),
            "S3_INST_02_FIRST_TOKEN_TRAJECTORY": traj(evals_by_step, lambda e: e.get("S3_INST_02_FIRST_TOKEN")),
            "NEW_FAILURES_VS_WRIM0": last_ev.get("NEW_FAILURES_VS_PARENT") if last_ev else parent_ev.get("NEW_FAILURES_VS_PARENT"),
            "RECOVERED_FAILURES_VS_WRIM0": last_ev.get("RECOVERED_FAILURES_VS_PARENT"),
            "UNCHANGED_FAILURES": last_ev.get("UNCHANGED_FAILURES"),
            "NET_FAILURE_DELTA": last_ev.get("NET_FAILURE_DELTA"),
            "FAILURE_ITEM_IDS": last_ev.get("FAILURE_ITEM_IDS") or last_ev.get("NEW_FAILURES_VS_PARENT_IDS"),
            "MODE_ENTRY_RESULT": diag.get("MODE_ENTRY_RESULT"),
            "STOPPING_RESULT": diag.get("STOPPING_RESULT"),
            "CAPABILITY_SIGNAL_CLASSIFICATION": diag.get("CAPABILITY_SIGNAL_CLASSIFICATION"),
            "TEACHER_FORCED_SIGNAL_STATUS": diag.get("TEACHER_FORCED_SIGNAL_STATUS"),
            "GREEDY_THRESHOLD_STATUS": diag.get("GREEDY_THRESHOLD_STATUS"),
            "ATTRACTOR_STATUS": diag.get("ATTRACTOR_STATUS"),
            "RETENTION_STATUS": diag.get("RETENTION_STATUS"),
            "CATASTROPHIC_FORGETTING": diag.get("CATASTROPHIC_FORGETTING"),
            "OVERFITTING": diag.get("OVERFITTING"),
            "INSTABILITY": diag.get("INSTABILITY"),
            "WRIM_CAPABILITY_PLATEAU_REVIEW_REQUIRED": diag.get("WRIM_CAPABILITY_PLATEAU_REVIEW_REQUIRED"),
            "TOKENIZER_REVIEW_REQUIRED": diag.get("TOKENIZER_REVIEW_REQUIRED"),
            "MODEL_CAPACITY_REVIEW_REQUIRED": diag.get("MODEL_CAPACITY_REVIEW_REQUIRED"),
            "ARCHITECTURE_REVIEW_REQUIRED": diag.get("ARCHITECTURE_REVIEW_REQUIRED"),
            "TRAINING_ENGINEER_DIAGNOSIS": engineer_diagnosis(diag),
            "RUN_000010_DISPOSITION": diag.get("disposition"),
            "STAGE3B_READY_FOR_AUTHORIZATION": "NO",
            "WRIM0_MODIFIED": "NO",
            "RUN000009_MODIFIED": "NO",
            "TOKENIZER_MODIFIED": "NO",
            "STAGE3_MODIFIED": "NO",
            "INSTRUCTION_ADDENDUM_MODIFIED": "NO",
            "STAGE3B_EXECUTED": "NO",
            "MODEL_PROMOTED": "NO",
            "RAEL_PROMOTED": "NO",
            "COMMIT": "NO",
            "PUSH": "NO",
            "DEPLOY": "NO",
            "PEAK_PASSED": peak_passed,
            "PEAK_MODE_ENTRY_STEP": peak_me_step,
            "PEAK_MODE_ENTRY_SCORE": peak_me,
            "BEST_EVAL_SLIM": slim_eval(best_ev) if best_ev else None,
            "RNG_AFTER_SEED": rng_after_seed,
            "NEXT_COMMANDER_DECISION": "STOP. TRAINING_AUTHORIZATION=OFF. Do not start RUN-000011. Do not start Stage 3B. Do not promote. Do not modify Ra'el. Do not commit, push, or deploy.",
        }
        write_json(commander_report_path, report)
        data_copy = Path(LINUX_DATA_ROOT) / "WRIM1_RUN_000010_MODE_ENTRY_STOPPING_REPORT.json"
        write_json(data_copy, report)
        return report

    try:
        eval0 = run_eval(0, None, 0, None)
        write_json(evals_dir / "step-0.json", eval0)
        g0 = evaluate_gates(eval0, eval_step=0, parent_eval=parent_eval_hold)
        gates_by_step["0"] = g0
        write_json(ckpt_root / "gate-step-0.json", g0)
        if g0["prevent_next_optimizer_step"]:
            payload = hard_stop_payload(reason="gate_at_step0", metric="pretrain_eval", value=g0, step=0, tokens=0)
            payload["TRAINING_AUTHORIZATION"] = "OFF"
            payload["HARD_STOP_TRIGGERED"] = True
            payload["OLLAMA_ACTIVE_BEFORE"] = ollama_active_before
            payload["OLLAMA_STOPPED_FOR_TRAINING"] = ollama_stopped
            payload["commander_report"] = build_commander_report(payload)
            write_json(report_path, payload)
            return payload

        model.enable_training()
        optimizer = torch.optim.AdamW(
            model.parameters(),
            lr=lr_run000010(1),
            betas=tuple(BETAS),
            eps=EPS,
            weight_decay=WEIGHT_DECAY,
            fused=False,
        )
        metrics: list[dict[str, Any]] = []
        tokens_seen = 0
        abort: dict[str, Any] | None = None
        for step in range(1, STEPS + 1):
            if step >= NEXT_UNAUTHORIZED_STEP:
                abort = hard_stop_payload(reason="step_41_forbidden", metric="step", value=step, step=step - 1, tokens=tokens_seen)
                abort["TRAINING_AUTHORIZATION"] = "OFF"
                abort["HARD_STOP_TRIGGERED"] = True
                break
            x_np, y_np = batches[step - 1]
            x = torch.tensor(x_np, dtype=torch.long, device=device)
            y = torch.tensor(y_np, dtype=torch.long, device=device)
            for pg in optimizer.param_groups:
                pg["lr"] = lr_run000010(step)
            optimizer.zero_grad(set_to_none=True)
            logits = model(x)
            loss = torch.nn.functional.cross_entropy(logits.reshape(-1, logits.size(-1)), y.reshape(-1))
            if not torch.isfinite(loss):
                abort = hard_stop_payload(reason="NaN_or_Inf_loss", metric="loss", value=str(loss.item()), step=step, tokens=tokens_seen)
                abort["TRAINING_AUTHORIZATION"] = "OFF"
                abort["HARD_STOP_TRIGGERED"] = True
                break
            loss.backward()
            grad_norm = torch.nn.utils.clip_grad_norm_(model.parameters(), GRAD_CLIP)
            if not torch.isfinite(grad_norm) or float(grad_norm) >= 50:
                abort = hard_stop_payload(reason="gradient_hard_stop", metric="grad_norm", value=float(grad_norm) if torch.isfinite(grad_norm) else str(grad_norm), step=step, tokens=tokens_seen)
                abort["TRAINING_AUTHORIZATION"] = "OFF"
                abort["HARD_STOP_TRIGGERED"] = True
                meta = save_continuity(ckpt_root / f"step-{step}", model, optimizer, step, tokens_seen, {"packing_cursor": step})
                checkpoints.append(meta)
                break
            optimizer.step()
            tokens_seen += TOKENS_PER_STEP
            row = {
                "step": step,
                "loss": float(loss.item()),
                "lr": lr_run000010(step),
                "grad_norm": float(grad_norm),
                "tokens_seen": tokens_seen,
            }
            metrics.append(row)
            (ckpt_root / "metrics.jsonl").open("a", encoding="utf-8").write(json.dumps(row) + "\n")
            if step in FULL_EVAL_STEPS:
                if step in WEIGHT_STEPS and step not in OPTIMIZER_STATE_STEPS:
                    meta = save_weights(ckpt_root / f"step-{step}", model, step, tokens_seen)
                    checkpoints.append(meta)
                ev = run_eval(step, float(loss.item()), tokens_seen, lr_run000010(step))
                ev["grad_norm"] = float(grad_norm)
                write_json(evals_dir / f"step-{step}.json", ev)
                gate = evaluate_gates(ev, eval_step=step, parent_eval=parent_eval_hold)
                gates_by_step[str(step)] = gate
                write_json(ckpt_root / f"gate-step-{step}.json", gate)
                protected_risk = bool(gate.get("prevent_next_optimizer_step")) or int(ev.get("NEW_FAILURES_VS_PARENT") or 0) > 0
                if peak_passed and protected_risk:
                    meta = save_continuity(ckpt_root / f"step-{step}", model, optimizer, step, tokens_seen, {"packing_cursor": step, "PEAK_PASSED": True})
                    checkpoints.append(meta)
                    abort = hard_stop_payload(
                        reason="PEAK_PASSED_PROTECTED_RISK",
                        metric="capability_reversal_plus_protected_risk",
                        value={"peak_me": peak_me, "peak_step": peak_me_step, "now": (ev.get("mode_entry_validation") or {}).get("PASS_COUNT")},
                        step=step,
                        tokens=tokens_seen,
                    )
                    abort["gate"] = gate
                    abort["TRAINING_AUTHORIZATION"] = "OFF"
                    abort["HARD_STOP_TRIGGERED"] = True
                    abort["PEAK_PASSED"] = True
                    break
                if gate["prevent_next_optimizer_step"]:
                    meta = save_continuity(ckpt_root / f"step-{step}", model, optimizer, step, tokens_seen, {"packing_cursor": step})
                    checkpoints.append(meta)
                    trig = (gate["triggers"] or [{}])[-1]
                    abort = hard_stop_payload(
                        reason="HARD_STOP_GATE",
                        metric=str(trig.get("METRIC")),
                        value=trig.get("value"),
                        step=step,
                        tokens=tokens_seen,
                    )
                    abort["gate"] = gate
                    abort["TRAINING_AUTHORIZATION"] = "OFF"
                    abort["HARD_STOP_TRIGGERED"] = True
                    break
        if abort is None:
            meta = save_continuity(ckpt_root / "step-40", model, optimizer, 40, tokens_seen, {"packing_cursor": 40})
            checkpoints.append(meta)
            summary = {
                "ok": True,
                "kind": "WRIM1_RUN_000010_TRAINING_COMPLETE_PENDING_REVIEW",
                "run_id": RUN_ID,
                "optimizer_steps": len(metrics),
                "tokens_seen": tokens_seen,
                "stop_reason": "COMPLETE",
                "HARD_STOP_TRIGGERED": False,
                "TRAINING_AUTHORIZATION": "OFF",
                "STAGE3B_AUTHORIZATION": "NO",
                "promotion_candidate": False,
                "checkpoints": checkpoints,
                "gates": gates_by_step,
                "metrics": metrics,
                "instruction_addendum_by_step": addendum_by_step,
                "capability_validation_by_step": capability_by_step,
                "stage3_correctness_by_step": correctness_by_step,
                "teacher_forced_by_step": teacher_by_step,
                "basins_by_step": basin_by_step,
                "packing": jsonable_packing(packing),
                "lr_schedule": lr_table,
                "TRAINER_FILE_SHA256": trainer_sha,
                "PROVEN_LOAD_SHA256": proven_sha,
                "TRAINER_PROVENANCE_HASH": provenance,
                "OLLAMA_ACTIVE_BEFORE": ollama_active_before,
                "OLLAMA_STOPPED_FOR_TRAINING": ollama_stopped,
                "VRAM_FREE_BEFORE_TRAINING": vram.get("VRAM_FREE_BEFORE_TRAINING"),
                "PEAK_PASSED": peak_passed,
            }
            summary["commander_report"] = build_commander_report(summary)
            write_json(report_path, summary)
            return summary
        abort["TRAINING_AUTHORIZATION"] = "OFF"
        abort["OLLAMA_ACTIVE_BEFORE"] = ollama_active_before
        abort["OLLAMA_STOPPED_FOR_TRAINING"] = ollama_stopped
        abort["checkpoints"] = checkpoints
        abort["gates"] = gates_by_step
        abort["metrics"] = metrics
        abort["instruction_addendum_by_step"] = addendum_by_step
        abort["capability_validation_by_step"] = capability_by_step
        abort["stage3_correctness_by_step"] = correctness_by_step
        abort["teacher_forced_by_step"] = teacher_by_step
        abort["basins_by_step"] = basin_by_step
        abort["TRAINER_FILE_SHA256"] = trainer_sha
        abort["PROVEN_LOAD_SHA256"] = proven_sha
        abort["TRAINER_PROVENANCE_HASH"] = provenance
        abort["optimizer_steps"] = len(metrics)
        abort["tokens_seen"] = tokens_seen
        abort["commander_report"] = build_commander_report(abort)
        write_json(report_path, abort)
        write_abort(ckpt_root, abort)
        return abort
    finally:
        if ollama_stopped:
            restore = start_user_ollama()
            ollama_restored = bool(restore.get("restored"))
            sidecar = ckpt_root / "ollama-restore.json"
            write_json(sidecar, {"OLLAMA_RESTORED": ollama_restored, **restore})
        write_json(ckpt_root / "training-authorization-off.json", {"TRAINING_AUTHORIZATION": "OFF", "run_id": RUN_ID})


def main() -> int:
    import sys

    ap = argparse.ArgumentParser()
    ap.add_argument(AUTHORIZE_FLAG, action="store_true")
    ap.add_argument("--dump-root", default=None)
    ap.add_argument("--data-root", required=True)
    ap.add_argument("--suite", required=True)
    ap.add_argument("--baseline", required=True)
    ap.add_argument("--addendum", default=None)
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--commander-report", default=None)
    args, _unknown = ap.parse_known_args()
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
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
                    "run_id",
                    "optimizer_steps",
                    "TRAINING_AUTHORIZATION",
                    "stop_reason",
                    "HARD_STOP_TRIGGERED",
                )
            },
            indent=2,
            default=str,
        )
    )
    return 0 if out.get("kind") != "WRIM1_RUN_000010_TRAINING_DENIED" or out.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
