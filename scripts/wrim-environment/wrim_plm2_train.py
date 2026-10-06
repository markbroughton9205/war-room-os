"""WRIM1-PLM-000002 first-token weighted short-answer trainer.

Does not train unless BOTH are present:
  --authorize-wrim1-plm-000002
  env WRIM_TRAINING_AUTHORIZATION=ON_FOR_WRIM1_PLM_000002_ONLY

Experimental parent: CPT-000005/step-75. Canonical remains STEP_400.
Fresh AdamW. 10 steps. First-token CE weight 4.0. Unsets authorization on every exit.
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

from wrim_plm2_identity import (
    ASSISTANT_DELIMITER_POLICY,
    AUTHORIZE_ENV_NAME,
    AUTHORIZE_ENV_VALUE,
    AUTHORIZE_FLAG,
    BETAS,
    CANONICAL_CHECKPOINT,
    CANONICAL_HASH,
    CKPT_ROOT,
    CKPT_STEPS,
    CORPUS_ID,
    CORPUS_VERSION,
    DATA_ROOT,
    EPS,
    EVAL_SEED,
    EVAL_STEPS,
    EXPECTED_PARENT_MODEL_HASH,
    EXPECTED_PARENT_OPTIMIZER_HASH,
    EXPERIMENTAL_PARENT_CHECKPOINT,
    EXPERIMENTAL_PARENT_CKPT,
    FORBIDDEN_RUNS,
    GRAD_CLIP,
    GRAD_HARD,
    GRAD_REVIEW,
    GRAD_WARN,
    LEARNING_RATE,
    LR_SCHEDULE_ID,
    MAX_TOKENS,
    MICRO_BATCH,
    MISSION_ORIGIN,
    OBJECTIVE,
    OPTIMIZER_STATE_POLICY,
    PARENT_NEWLINE_ARGMAX_RATE,
    PARENT_FOUNDATION_RANK,
    PARENT_FOUNDATION_TOP5,
    PARENT_STAGE3_DELTA_VS_WRIM0,
    PARENT_STAGE3_DRIFT_VS_STEP400,
    REMAINING_STAGE3_HEADROOM,
    REPORT_FILENAME,
    RUN_ID,
    SEED,
    SEQ_LEN,
    STAGE3_PARENT_DRIFT_HARD,
    STAGE3_REVIEW_DELTA,
    STALE_AUTH_VALUES,
    STEP400_STAGE3_COLLAPSE,
    STEP400_STAGE3_DELTA_VS_WRIM0,
    STEPS,
    TOKENIZER_EXPECTED_SHA,
    TOKENIZER_ID,
    TOKENS_PER_STEP,
    WARMUP_STEPS,
    WEIGHT_DECAY,
    WHY_RESET_OPTIMIZER,
    WHY_SELECTED_LR,
    FIRST_TOKEN_LOSS_WEIGHT,
    LATER_TOKEN_LOSS_WEIGHT,
    EOS_LOSS_WEIGHT,
    MIN_CLASS_OVERLAP,
)


def authorization_ok(argv: list[str] | None = None) -> bool:
    import sys

    args = argv if argv is not None else sys.argv[1:]
    return AUTHORIZE_FLAG in args and os.environ.get(AUTHORIZE_ENV_NAME) == AUTHORIZE_ENV_VALUE


def denial_payload(reason: str) -> dict[str, Any]:
    return {
        "ok": False,
        "kind": "WRIM1_PLM_000002_TRAINING_DENIED",
        "RUN_ID": RUN_ID,
        "reason": reason,
        "TRAINING_AUTHORIZATION": "OFF",
        "optimizer_steps": 0,
        "AdamW_constructed": False,
        "training_executed": False,
        "TRAINING_AUTHORIZATION_FINAL": "OFF",
        "CPT_000006_CREATED": "NO",
        "SFT_CREATED": "NO",
        "MODEL_PROMOTED": "NO",
        "CANONICAL_CHANGED": "NO",
        "COMMIT": "NO",
        "PUSH": "NO",
        "DEPLOY": "NO",
    }


def lr_plm_000002(_step: int) -> float:
    return float(LEARNING_RATE)


def next_decision(hard: bool, complete: bool) -> str:
    if hard:
        return (
            "STOP. WRIM1-PLM-000002 hard-stopped. WRIM_TRAINING_AUTHORIZATION=OFF. "
            "REFUSE_RESUME. Do not start step 11. Do not create a second PLM-000002 "
            "execution, CPT-000006, SFT, or Stage 3B. Canonical remains STEP_400."
        )
    if complete:
        return (
            "STOP. WRIM1-PLM-000002 complete pending Commander review. "
            "WRIM_TRAINING_AUTHORIZATION=OFF. Do not run a second PLM-000002 execution. "
            "Do not create CPT-000006. Canonical remains STEP_400."
        )
    return "STOP. WRIM1-PLM-000002 exited. WRIM_TRAINING_AUTHORIZATION=OFF."


def unset_auth() -> None:
    os.environ.pop(AUTHORIZE_ENV_NAME, None)
    os.environ[AUTHORIZE_ENV_NAME] = "OFF"


def file_sha(p: Path) -> str:
    from run000007_preflight import sha256_file

    return sha256_file(p)


def run_authorized_training(args: argparse.Namespace) -> dict[str, Any]:
    import numpy as np
    import torch
    from safetensors.torch import load_file as load_safetensors_file
    from tokenizers import Tokenizer

    from run000007_env import verify_linux_env
    from run000007_preflight import resolve_dump_root, sha256_file
    from run000007_vram import ensure_vram_for_training, start_user_ollama
    from stage3_runtime import parent_pointer, write_abort, write_json
    from wrim_cpt5_identity import INDEPENDENT_NL_PACK, INDEPENDENT_NL_PACK_HASH_EXPECTED
    from wrim_cpt5_train import nl_probe_rates
    from wrim_cpt_eval import evaluate_foundation, family_nll
    from wrim_cpt_identity import LINUX_CKPT_ROOT
    from wrim_cpt_preflight import locate_addendum, locate_baseline, locate_suite
    from wrim_cpt_stage_b_identity import PROVISIONAL_STAGE_B_PARENT_CHECKPOINT
    from wrim_cpt2_identity import CORPUS_VERSION as CPT2_CORPUS_VERSION
    from wrim_cpt_stage_b_corpus import corpus_root, load_jsonl, tokenize_docs, val_family_id_packs
    from wrim_g20m import WRIM0Model
    from wrim_plm2_corpus import freeze_corpus
    from wrim_plm2_encode import (
        boundary_fixtures,
        encode_example,
        mask_report,
        pack_train_stream,
        slice_batches,
        validate_inference_match,
        weighted_split_losses,
    )
    from wrim_plm2_eval import evaluate_prefix_heldout
    from wrim_plm2_gates import classify_entry, hard_hits
    from wrim_proven_load import disable_tf32
    from wrim_resumable_checkpoint import (
        MODEL_NAME,
        disk_preflight,
        latest_complete_checkpoint,
        restore_resumable_checkpoint,
        restore_rng,
        save_resumable_checkpoint,
    )
    from wrim_target_only_loss import IGNORE_INDEX, MASK_IGNORE
    from wrim_train_liveness import TerminationCapture, ram_rss_bytes, utc_now, vram_free_mib, write_heartbeat
    from wrim_val_nl_independent import eval_candidate
    from wrim_cpt_identity import SUITE_SHA, ADDENDUM_SHA

    report_path = Path(DATA_ROOT) / REPORT_FILENAME
    ckpt_root = Path(CKPT_ROOT)
    dump = resolve_dump_root(getattr(args, "dump_root", None))
    if dump is None:
        payload = denial_payload("dump_root_missing")
        write_json(report_path, payload)
        return payload

    env = verify_linux_env()
    disk = disk_preflight(
        ckpt_root,
        n_full_checkpoints=6,
        bytes_per_checkpoint=400_000_000,
        eval_bytes=1_000_000_000,
        extra_bytes=1_000_000_000,
    )
    vram = ensure_vram_for_training()
    ollama_stopped = bool(vram.get("ollama_stopped_for_training"))
    if not env.get("ok") or not disk.get("ok"):
        payload = {**denial_payload("resource_preflight_fail"), "env": env, "disk": disk, "vram": vram}
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload

    for forbidden in FORBIDDEN_RUNS:
        p = Path("/home/chosenone/.local/share/war-room-os/data/wrim-checkpoints/test-only") / forbidden
        if forbidden == "WRIM1-CPT-000006" and p.exists():
            payload = denial_payload("cpt_000006_exists")
            write_json(report_path, payload)
            if ollama_stopped:
                start_user_ollama()
            return payload

    parent = Path(EXPERIMENTAL_PARENT_CKPT)
    exp_model = parent / MODEL_NAME
    exp_opt = parent / "optimizer.pt"
    man_p = parent / "resume-manifest.json"
    if not exp_model.is_file() or not man_p.is_file():
        payload = denial_payload("parent_checkpoint_incomplete")
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload
    parent_model_hash = sha256_file(exp_model)
    parent_opt_hash = sha256_file(exp_opt) if exp_opt.is_file() else None
    manifest_hash = sha256_file(man_p)
    if parent_model_hash != EXPECTED_PARENT_MODEL_HASH:
        payload = {**denial_payload("parent_model_hash_mismatch"), "live": parent_model_hash, "expected": EXPECTED_PARENT_MODEL_HASH}
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload
    if parent_opt_hash != EXPECTED_PARENT_OPTIMIZER_HASH:
        payload = {**denial_payload("parent_optimizer_hash_mismatch"), "live": parent_opt_hash, "expected": EXPECTED_PARENT_OPTIMIZER_HASH}
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload

    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    tok_hash = sha256_file(tok_path)
    if tok_hash != TOKENIZER_EXPECTED_SHA:
        payload = denial_payload("tokenizer_hash_mismatch")
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload

    step400 = Path(LINUX_CKPT_ROOT) / PROVISIONAL_STAGE_B_PARENT_CHECKPOINT / MODEL_NAME
    canonical_hash = sha256_file(step400)
    if canonical_hash != CANONICAL_HASH:
        payload = denial_payload("canonical_hash_changed")
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload

    tokenizer = Tokenizer.from_file(str(tok_path))
    corpus = freeze_corpus(tokenizer=tokenizer)
    if not corpus.get("ok"):
        payload = {**denial_payload("corpus_freeze_fail"), "corpus": corpus}
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload
    crep = corpus.get("class_report") or {}
    if float(crep.get("FIRST_TOKEN_TRAIN_VAL_OVERLAP") or 0) < float(MIN_CLASS_OVERLAP):
        payload = {**denial_payload("first_token_class_overlap_fail"), "class_report": crep}
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload
    if "PLM-000001" in EXPERIMENTAL_PARENT_CHECKPOINT:
        payload = denial_payload("forbidden_plm000001_parent")
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload

    train_rows = load_jsonl(Path(corpus["root"]) / "train.jsonl")
    val_rows = load_jsonl(Path(corpus["root"]) / "val.jsonl")
    encoded = [encode_example(tokenizer, r) for r in train_rows]
    val_encoded = [encode_example(tokenizer, r) for r in val_rows]
    match_ok = all(validate_inference_match(tokenizer, r, e) for r, e in zip(train_rows, encoded))
    match_ok = match_ok and all(validate_inference_match(tokenizer, r, e) for r, e in zip(val_rows, val_encoded))
    class_ids = {}
    for rec, enc in list(zip(train_rows, encoded)) + list(zip(val_rows, val_encoded)):
        class_ids.setdefault(rec["first_token_class"], set()).add(int(enc["first_target_id"]))
        if len(enc["target_ids"]) != 1:
            payload = {**denial_payload("multi_token_target_not_allowed"), "example": rec["example_id"]}
            write_json(report_path, payload)
            if ollama_stopped:
                start_user_ollama()
            return payload
    if any(len(s) != 1 for s in class_ids.values()):
        payload = {**denial_payload("class_first_token_inconsistent"), "class_ids": {k: sorted(v) for k, v in class_ids.items()}}
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload
    fixtures = boundary_fixtures(tokenizer, encoded, n=6)
    if not match_ok:
        payload = {**denial_payload("boundary_encoding_fail"), "fixtures": fixtures}
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload

    stream, mask = pack_train_stream(encoded)
    mask_stats = mask_report(mask)
    if not mask_stats.get("ok"):
        payload = {**denial_payload("loss_mask_fail"), "mask": mask_stats}
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload
    batches = slice_batches(stream, mask)
    train_token_count = int(sum(int(e["tokens"].size) for e in encoded))
    val_token_count = int(sum(int(e["tokens"].size) for e in val_encoded))

    # CPT-2 val packs (read-only)
    croot = corpus_root()
    val_p = croot / f"{CPT2_CORPUS_VERSION}-VAL.jsonl"
    if not val_p.is_file():
        payload = denial_payload("cpt2_val_missing")
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload
    val_docs = load_jsonl(val_p)
    val_tok = tokenize_docs(val_docs, tokenizer)
    val_packs = val_family_id_packs(val_tok)
    nl_root = Path(DATA_ROOT) / INDEPENDENT_NL_PACK
    nl_passages_path = nl_root / f"{INDEPENDENT_NL_PACK}-PASSAGES.jsonl"
    if not nl_passages_path.is_file():
        payload = denial_payload("independent_nl_pack_missing")
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload
    nl_rows = load_jsonl(nl_passages_path)
    live_nl_pack = sha256_file(nl_root / f"{INDEPENDENT_NL_PACK}-SHA256.json") if (nl_root / f"{INDEPENDENT_NL_PACK}-SHA256.json").is_file() else None

    if ckpt_root.is_dir() and (ckpt_root / "step-10" / "resume-manifest.json").is_file():
        payload = denial_payload("second_execution_forbidden")
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload
    if (ckpt_root / "abort.json").is_file():
        abort_obj = json.loads((ckpt_root / "abort.json").read_text(encoding="utf-8"))
        if abort_obj.get("HARD_STOP_TRIGGERED"):
            payload = {**denial_payload("REFUSE_RESUME"), "prior_abort": abort_obj}
            write_json(report_path, payload)
            if ollama_stopped:
                start_user_ollama()
            return payload

    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)

    model = WRIM0Model()
    model.load_state_dict(load_safetensors_file(str(exp_model)), strict=True)
    model.to(device)
    model.train()
    optimizer = torch.optim.AdamW(model.parameters(), lr=LEARNING_RATE, betas=BETAS, eps=EPS, weight_decay=WEIGHT_DECAY, fused=False)
    # refuse empty state: AdamW is fresh by policy; record that explicitly
    if any(optimizer.state):
        payload = denial_payload("unexpected_nonempty_adamw_before_step")
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload

    lr_table = {str(s): LEARNING_RATE for s in range(0, STEPS + 2)}
    identity = {
        "RUN_ID": RUN_ID,
        "PARENT_MODEL_ID": EXPERIMENTAL_PARENT_CHECKPOINT,
        "PARENT_HASH": parent_model_hash,
        "CANONICAL_MODEL_ID": CANONICAL_CHECKPOINT,
        "CANONICAL_HASH": canonical_hash,
        "PARENT_OPTIMIZER_HASH": parent_opt_hash,
        "TOKENIZER_HASH": tok_hash,
        "STAGE3_HASH": SUITE_SHA,
        "INSTRUCTION_ADDENDUM_HASH": ADDENDUM_SHA,
        "TRAIN_DATASET_IDS": [CORPUS_ID, CORPUS_VERSION],
        "TRAIN_DATASET_HASHES": {CORPUS_VERSION: corpus["CORPUS_HASH"]},
        "VALIDATION_DATASET_IDS": [CORPUS_VERSION, "WRIM-FOUNDATION-EVAL-1", INDEPENDENT_NL_PACK],
        "VALIDATION_DATASET_HASHES": {CORPUS_VERSION: corpus["CORPUS_HASH"], INDEPENDENT_NL_PACK: live_nl_pack},
        "TRAINER_PROVENANCE_HASH": file_sha(Path(__file__)),
        "PACKER_PROVENANCE_HASH": file_sha(Path(__file__).with_name("wrim_plm1_encode.py")),
        "OPTIMIZER_CLASS": "AdamW",
        "OPTIMIZER_HYPERPARAMETERS": {"fused": False, "betas": list(BETAS), "eps": EPS, "weight_decay": WEIGHT_DECAY, "grad_clip": GRAD_CLIP},
        "LR_SCHEDULE_ID": LR_SCHEDULE_ID,
    }
    ckpt_root.mkdir(parents=True, exist_ok=True)
    evals_dir = ckpt_root / "evals"
    evals_dir.mkdir(parents=True, exist_ok=True)
    write_json(ckpt_root / "run-identity.json", identity)
    write_json(ckpt_root / "optimizer-manifest.json", {
        "OPTIMIZER_STATE_POLICY": OPTIMIZER_STATE_POLICY,
        "RATIONALE": WHY_RESET_OPTIMIZER,
        "LEARNING_RATE": LEARNING_RATE,
        "WHY_SELECTED": WHY_SELECTED_LR,
        "warmup": WARMUP_STEPS,
        "scheduler": "constant",
        "seed": SEED,
        "precision": "FP32",
        "objective": OBJECTIVE,
        "loss_mask_policy": ASSISTANT_DELIMITER_POLICY,
        "FIRST_TOKEN_LOSS_WEIGHT": FIRST_TOKEN_LOSS_WEIGHT,
        "LATER_TOKEN_LOSS_WEIGHT": LATER_TOKEN_LOSS_WEIGHT,
        "EOS_LOSS_WEIGHT": EOS_LOSS_WEIGHT,
        "FRESH_ADAMW_STATE": True,
        "parent_weights": EXPECTED_PARENT_MODEL_HASH,
    })
    write_json(ckpt_root / "boundary-fixtures.json", fixtures)
    write_json(ckpt_root / "mask-report.json", mask_stats)
    write_json(ckpt_root / "parent_pointer.json", {
        **parent_pointer(weights_path=exp_model, parent_sha=EXPECTED_PARENT_MODEL_HASH),
        "PARENT_STAGE3_DELTA_VS_WRIM0": PARENT_STAGE3_DELTA_VS_WRIM0,
        "PARENT_STAGE3_DRIFT_VS_STEP400": PARENT_STAGE3_DRIFT_VS_STEP400,
        "REMAINING_STAGE3_HEADROOM": REMAINING_STAGE3_HEADROOM,
        "CHECKPOINT_MANIFEST_HASH": manifest_hash,
    })

    suite_path = locate_suite()
    baseline_path = locate_baseline(Path(DATA_ROOT))
    wrim0_logp: dict[str, torch.Tensor] = {}
    if not (suite_path and suite_path.is_file() and baseline_path and baseline_path.is_file()):
        payload = denial_payload("stage3_suite_or_baseline_missing")
        write_json(report_path, payload)
        if ollama_stopped:
            start_user_ollama()
        return payload
    from stage3a_run import load_baseline, load_suite

    suite = load_suite(suite_path)
    baseline = load_baseline(baseline_path)

    stream_sha = hashlib.sha256(stream.tobytes()).hexdigest()
    parent_cpu = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
    metrics: list[dict[str, Any]] = []
    checkpoints: list[dict[str, Any]] = []
    plm_by_step: dict[str, Any] = {}
    foundation_by_step: dict[str, Any] = {}
    val_by_step: dict[str, Any] = {}
    nl_by_step: dict[str, Any] = {}
    stage3_by_step: dict[str, Any] = {}
    last_durable = None
    heartbeat_path = ckpt_root / "heartbeat.jsonl"
    term = TerminationCapture()
    term.install()
    abort = None
    t0 = time.perf_counter()

    def persist_full(step: int, tokens: int) -> dict[str, Any]:
        nonlocal last_durable
        dest = ckpt_root / f"step-{step}"
        if dest.is_dir() and (dest / "resume-manifest.json").is_file():
            man = json.loads((dest / "resume-manifest.json").read_text(encoding="utf-8"))
            last_durable = str(dest)
            checkpoints.append({"step": step, "path": str(dest), "model_sha256": man.get("MODEL_HASH"), "reused": True})
            return {"ok": True, "path": str(dest), "manifest": man}
        saved = save_resumable_checkpoint(
            run_root=ckpt_root,
            step=step,
            model=model,
            optimizer=optimizer,
            tokens_processed=tokens,
            next_token_offset=tokens,
            stream_prefix_sha256=stream_sha,
            curriculum={
                "stage": "PREFIX_LM_PROBE",
                "objective": OBJECTIVE,
                "mask_prompt_tokens": True,
                "assistant_delimiter_policy": ASSISTANT_DELIMITER_POLICY,
                "parent": EXPERIMENTAL_PARENT_CHECKPOINT,
            },
            identity=identity,
            lr_table=lr_table,
            authorized_max_step=STEPS,
            authorized_max_tokens=MAX_TOKENS,
        )
        last_durable = saved["path"]
        checkpoints.append({"step": step, "path": saved["path"], "model_sha256": saved["manifest"].get("MODEL_HASH")})
        return saved

    def heartbeat(step: int, tokens: int, loss: float | None, grad: float | None, lr: float | None, phase: str = "train") -> None:
        write_heartbeat(heartbeat_path, {"run_id": RUN_ID, "step": step, "tokens": tokens, "loss": loss, "gradient_norm": grad, "lr": lr, "phase": phase, "last_durable_checkpoint": last_durable})

    def run_eval(step: int, train_loss: float | None, tokens: int, lr: float | None, grad_norm: float | None = None) -> dict[str, Any]:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        heartbeat(step, tokens, train_loss, grad_norm, lr, phase="eval")
        torch.manual_seed(EVAL_SEED)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(EVAL_SEED)
        was = model.training
        model.eval()
        plm = evaluate_prefix_heldout(model=model, tokenizer=tokenizer, device=device, rows=val_rows)
        found = evaluate_foundation(model=model, tokenizer=tokenizer, device=device)
        nlls = family_nll(model=model, device=device, packs=val_packs) if val_packs else {}
        nl = eval_candidate(name=f"plm000001-step-{step}", model=model, tokenizer=tokenizer, device=device, rows=nl_rows) if nl_rows else {}
        probes = nl_probe_rates(nl) if nl else {}
        s3_obs = None
        if suite is not None and baseline is not None:
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
            incr = None if delta is None else float(delta) - float(PARENT_STAGE3_DELTA_VS_WRIM0)
            s3_obs = {
                "step": step,
                "mean_wrim0_anchor_nll_delta": delta,
                "historical_pass_count": ev.get("historical_pass_count"),
                "n_collapsed": ev.get("n_collapsed"),
                "STAGE3_DRIFT_VS_STEP400": drift,
                "STAGE3_DRIFT_VS_PREFIX_PARENT": incr,
                "STAGE3_NLL_REVIEW": bool(delta is not None and float(delta) >= STAGE3_REVIEW_DELTA),
            }
        bundle = {
            "stage3_historical": None if s3_obs is None else s3_obs.get("historical_pass_count"),
            "stage3_collapse": None if s3_obs is None else s3_obs.get("n_collapsed"),
            "stage3_delta_nll": None if s3_obs is None else s3_obs.get("mean_wrim0_anchor_nll_delta"),
            "grad_norm": grad_norm,
            "nan": False,
        }
        hits = hard_hits(bundle)
        slim_plm = {k: v for k, v in plm.items() if k != "items"}
        write_json(evals_dir / f"prefix-lm-step-{step}.json", slim_plm)
        write_json(evals_dir / f"foundation-step-{step}.json", {k: v for k, v in found.items() if k != "items"})
        write_json(evals_dir / f"val-nll-step-{step}.json", nlls)
        write_json(evals_dir / f"independent-nl-step-{step}.json", {k: v for k, v in nl.items() if k != "generations"})
        if s3_obs:
            write_json(evals_dir / f"stage3-observe-step-{step}.json", s3_obs)
        plm_by_step[str(step)] = slim_plm
        foundation_by_step[str(step)] = {k: v for k, v in found.items() if k != "items"}
        val_by_step[str(step)] = nlls
        nl_by_step[str(step)] = nl
        stage3_by_step[str(step)] = s3_obs
        if was:
            model.train()
            model.enable_training()
        else:
            model.eval()
        return {
            "hard_gate_hits": hits,
            "STAGE3_NLL_REVIEW": bool(s3_obs and s3_obs.get("STAGE3_NLL_REVIEW")),
            "prefix": slim_plm,
            "foundation": foundation_by_step[str(step)],
            "val": nlls,
            "nl": {k: nl.get(k) for k in ("natural_language_nll_mean", "NEWLINE_ATTRACTOR_RATE", "repeated_token_rate")},
            "probes": probes,
            "stage3": s3_obs,
        }

    start_step = 1
    tokens_seen = 0
    latest = latest_complete_checkpoint(ckpt_root)
    if latest:
        restored = restore_resumable_checkpoint(path=latest, model=model, optimizer=optimizer, expected_identity={"RUN_ID": RUN_ID})
        if not restored.get("ok"):
            payload = {**denial_payload("resume_checkpoint_invalid"), "restore": restored}
            write_json(report_path, payload)
            if ollama_stopped:
                start_user_ollama()
            return payload
        man = restored["manifest"]
        start_step = int(man["NEXT_GLOBAL_STEP"])
        tokens_seen = int(man["TOKENS_PROCESSED"])
        last_durable = str(latest)
        if start_step > STEPS:
            abort = {**denial_payload("already_complete"), "stop_reason": "COMPLETE"}
    else:
        ev0 = run_eval(0, None, 0, LEARNING_RATE)
        persist_full(0, 0)
        if ev0.get("hard_gate_hits"):
            abort = {
                **denial_payload("HARD_STOP_GATE"),
                "HARD_STOP_TRIGGERED": True,
                "stop_reason": ",".join(ev0["hard_gate_hits"]),
                "step": 0,
            }

    if abort is None:
        for step in range(start_step, STEPS + 1):
            if step > STEPS:
                abort = {**denial_payload("step_11_forbidden"), "HARD_STOP_TRIGGERED": True, "stop_reason": "step_11_forbidden"}
                break
            if tokens_seen + TOKENS_PER_STEP > MAX_TOKENS:
                abort = {**denial_payload("token_cap"), "HARD_STOP_TRIGGERED": True, "stop_reason": "token_cap"}
                break
            x_np, y_np, m_np = batches[step - 1]
            x = torch.tensor(x_np, dtype=torch.long, device=device)
            y = torch.tensor(y_np, dtype=torch.long, device=device)
            y_mask = torch.tensor(m_np, dtype=torch.int8, device=device)
            for pg in optimizer.param_groups:
                pg["lr"] = lr_plm_000002(step)
            optimizer.zero_grad(set_to_none=True)
            logits = model(x)
            split = weighted_split_losses(logits, y, y_mask)
            loss = split["loss"]
            if not torch.isfinite(loss):
                abort = {**denial_payload("NAN_INF"), "HARD_STOP_TRIGGERED": True, "stop_reason": "NAN_INF", "step": step}
                break
            loss.backward()
            grad = float(torch.nn.utils.clip_grad_norm_(model.parameters(), GRAD_CLIP))
            if not np.isfinite(grad) or grad >= GRAD_HARD:
                abort = {**denial_payload("GRAD_INSTABILITY"), "HARD_STOP_TRIGGERED": True, "stop_reason": "GRAD_INSTABILITY", "grad": grad, "step": step}
                write_abort(ckpt_root, abort)
                (ckpt_root / "abort.json").write_text(json.dumps(abort, indent=2) + "\n", encoding="utf-8")
                break
            optimizer.step()
            tokens_seen += TOKENS_PER_STEP
            if grad >= GRAD_HARD:
                ggate = "HARD"
            elif grad >= GRAD_REVIEW:
                ggate = "REVIEW"
            elif grad >= GRAD_WARN:
                ggate = "WARN"
            else:
                ggate = None
            row = {
                "step": step,
                "loss": float(loss.item()),
                "FIRST_TOKEN_CE": split["FIRST_TOKEN_CE"],
                "LATER_TOKEN_CE": split["LATER_TOKEN_CE"],
                "EOS_CE": split["EOS_CE"],
                "lr": LEARNING_RATE,
                "grad_norm": grad,
                "tokens_seen": tokens_seen,
                "n_first_supervised": split["n_first_supervised"],
                "n_later_supervised": split["n_later_supervised"],
                "n_eos_supervised": split["n_eos_supervised"],
                "n_ignored": split["n_ignored"],
                "grad_gate": ggate,
            }
            metrics.append(row)
            with (ckpt_root / "metrics.jsonl").open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(row) + "\n")
            heartbeat(step, tokens_seen, row["loss"], grad, LEARNING_RATE)
            if step in CKPT_STEPS:
                persist_full(step, tokens_seen)
            if step in EVAL_STEPS:
                ev = run_eval(step, row["loss"], tokens_seen, LEARNING_RATE, grad)
                if ev.get("hard_gate_hits"):
                    abort = {
                        **denial_payload("HARD_STOP_GATE"),
                        "HARD_STOP_TRIGGERED": True,
                        "stop_reason": ",".join(ev["hard_gate_hits"]),
                        "HARD_STOP_GATES": ev["hard_gate_hits"],
                        "step": step,
                        "tokens_seen": tokens_seen,
                    }
                    write_abort(ckpt_root, abort)
                    break

    elapsed = time.perf_counter() - t0
    hard = bool(abort and abort.get("HARD_STOP_TRIGGERED"))
    complete = (not hard) and tokens_seen >= MAX_TOKENS and (abort is None or abort.get("reason") != "step_11_forbidden")
    if abort is None and tokens_seen >= MAX_TOKENS:
        complete = True
    last = max((m.get("step") or 0) for m in metrics) if metrics else 0
    p0 = plm_by_step.get("0") or {}
    pN = plm_by_step.get(str(last if last in EVAL_STEPS else max([int(k) for k in plm_by_step if int(k) <= last], default=0))) or {}
    # pick last eval key
    eval_keys = sorted(int(k) for k in plm_by_step)
    last_eval = eval_keys[-1] if eval_keys else 0
    pN = plm_by_step.get(str(last_eval)) or {}
    f0 = foundation_by_step.get("0") or {}
    fN = foundation_by_step.get(str(last_eval)) or {}
    n0 = nl_by_step.get("0") or {}
    nN = nl_by_step.get(str(last_eval)) or {}
    v0 = val_by_step.get("0") or {}
    vN = val_by_step.get(str(last_eval)) or {}
    s0 = stage3_by_step.get("0") or {}
    sN = stage3_by_step.get(str(last_eval)) or {}
    signal = classify_entry(p0, pN, hard=hard)
    gp0 = int(p0.get("GREEDY_FIRST_TOKEN_MATCH") or 0)
    ge0 = int(p0.get("GREEDY_EXACT_ANSWER") or 0)
    gs0 = int(p0.get("GREEDY_SHORT_ANSWER_CORRECT") or 0)
    gpN = int(pN.get("GREEDY_FIRST_TOKEN_MATCH") or 0)
    geN = int(pN.get("GREEDY_EXACT_ANSWER") or 0)
    gsN = int(pN.get("GREEDY_SHORT_ANSWER_CORRECT") or 0)
    breakthrough = (not hard) and (gp0 == 0 and gpN > 0)
    nl0 = p0.get("NEWLINE_ARGMAX_RATE")
    nlN = pN.get("NEWLINE_ARGMAX_RATE")
    newline_broken = bool(nlN is not None and float(nlN) < 1.0)
    losses = [m["loss"] for m in metrics if m.get("loss") is not None]
    first_ce = [m.get("FIRST_TOKEN_CE") for m in metrics if m.get("FIRST_TOKEN_CE") is not None]
    later_ce = [m.get("LATER_TOKEN_CE") for m in metrics if m.get("LATER_TOKEN_CE") is not None]
    eos_ce = [m.get("EOS_CE") for m in metrics if m.get("EOS_CE") is not None]
    grads = [m["grad_norm"] for m in metrics if m.get("grad_norm") is not None]
    s3_final_delta = sN.get("mean_wrim0_anchor_nll_delta") if sN else None
    s3_final_drift = sN.get("STAGE3_DRIFT_VS_STEP400") if sN else None
    retention = "HEALTHY"
    if hard:
        retention = "DEGRADING"
    elif sN and (sN.get("n_collapsed") or 0) > (s0.get("n_collapsed") or 0):
        retention = "MIXED"
    elif s3_final_drift is not None and float(s3_final_drift) > float(PARENT_STAGE3_DRIFT_VS_STEP400) + 0.05:
        retention = "MIXED"
    best_ck = f"WRIM1-PLM-000002/step-{last_eval}"
    crep = corpus.get("class_report") or {}
    commander = {
        "ok": not hard,
        "kind": "WRIM1_PLM_000002_FIRST_TOKEN_CURRICULUM_COMPLETE_PENDING_REVIEW" if complete else ("WRIM1_PLM_000002_HARD_STOP" if hard else "WRIM1_PLM_000002_INCOMPLETE"),
        "RUN_ID": RUN_ID,
        "CANONICAL": CANONICAL_CHECKPOINT,
        "EXPERIMENTAL_PARENT": EXPERIMENTAL_PARENT_CHECKPOINT,
        "PARENT_MODEL_HASH": parent_model_hash,
        "PARENT_OPTIMIZER_HASH": parent_opt_hash,
        "CHECKPOINT_MANIFEST_HASH": manifest_hash,
        "PARENT_STAGE3_DELTA_VS_WRIM0": PARENT_STAGE3_DELTA_VS_WRIM0,
        "PARENT_STAGE3_DRIFT_VS_STEP400": PARENT_STAGE3_DRIFT_VS_STEP400,
        "REMAINING_STAGE3_HEADROOM": REMAINING_STAGE3_HEADROOM,
        "PARENT_NEWLINE_ARGMAX_RATE": PARENT_NEWLINE_ARGMAX_RATE,
        "CORPUS_ID": CORPUS_ID,
        "CORPUS_HASH": corpus["CORPUS_HASH"],
        "MANIFEST_HASH": corpus["MANIFEST_HASH"],
        "TRAIN_HASH": corpus["TRAIN_HASH"],
        "VAL_HASH": corpus["VAL_HASH"],
        "TRAIN_EXAMPLES": corpus["TRAIN_EXAMPLES"],
        "VAL_EXAMPLES": corpus["VAL_EXAMPLES"],
        "TRAIN_TOKENS": train_token_count,
        "VAL_TOKENS": val_token_count,
        "FIRST_TOKEN_CLASSES": crep.get("FIRST_TOKEN_CLASSES"),
        "FIRST_TOKEN_CLASS_COUNTS": crep.get("FIRST_TOKEN_CLASS_COUNTS"),
        "FIRST_TOKEN_TRAIN_VAL_OVERLAP": crep.get("FIRST_TOKEN_TRAIN_VAL_OVERLAP"),
        "LEAKAGE_SCAN": corpus["LEAKAGE_SCAN"],
        "BOUNDARY_VALIDATION": "PASS" if match_ok else "FAIL",
        "LOSS_MASK_VALIDATION": "PASS" if mask_stats.get("ok") else "FAIL",
        "FIRST_TOKEN_LOSS_WEIGHT": FIRST_TOKEN_LOSS_WEIGHT,
        "LATER_TOKEN_LOSS_WEIGHT": LATER_TOKEN_LOSS_WEIGHT,
        "EOS_LOSS_WEIGHT": EOS_LOSS_WEIGHT,
        "ASSISTANT_DELIMITER_POLICY": ASSISTANT_DELIMITER_POLICY,
        "PROMPT_TOKENS_SUPERVISED": "NO",
        "TARGET_TOKENS_SUPERVISED": "YES",
        "EOS_SUPERVISED": "YES",
        "OPTIMIZER_STATE_POLICY": OPTIMIZER_STATE_POLICY,
        "LEARNING_RATE": LEARNING_RATE,
        "STEPS_EXECUTED": last,
        "TOKENS_EXECUTED": tokens_seen,
        "STEP_11_EXECUTED": "NO",
        "TRAIN_LOSS": {"first": losses[0] if losses else None, "last": losses[-1] if losses else None, "min": min(losses) if losses else None},
        "MAX_GRAD_NORM": max(grads) if grads else None,
        "FIRST_TOKEN_CE": {"first": first_ce[0] if first_ce else None, "last": first_ce[-1] if first_ce else None},
        "LATER_TOKEN_CE": {"first": later_ce[0] if later_ce else None, "last": later_ce[-1] if later_ce else None},
        "EOS_CE": {"first": eos_ce[0] if eos_ce else None, "last": eos_ce[-1] if eos_ce else None},
        "FIRST_TARGET_RANK": {"parent": p0.get("FIRST_TARGET_TOKEN_RANK"), "final": pN.get("FIRST_TARGET_TOKEN_RANK")},
        "FIRST_TARGET_PROBABILITY": {"parent": p0.get("FIRST_TARGET_TOKEN_PROBABILITY"), "final": pN.get("FIRST_TARGET_TOKEN_PROBABILITY")},
        "FIRST_TARGET_TOP1": {"parent": p0.get("FIRST_TARGET_TOP1_COUNT"), "final": pN.get("FIRST_TARGET_TOP1_COUNT")},
        "FIRST_TARGET_TOP5": {"parent": p0.get("FIRST_TARGET_TOP5_COUNT"), "final": pN.get("FIRST_TARGET_TOP5_COUNT")},
        "FIRST_TARGET_TOP10": {"parent": p0.get("FIRST_TARGET_TOP10_COUNT"), "final": pN.get("FIRST_TARGET_TOP10_COUNT")},
        "GREEDY_FIRST_TOKEN_MATCH": {"parent": gp0, "final": gpN},
        "GREEDY_EXACT_ANSWER": {"parent": ge0, "final": geN},
        "GREEDY_SHORT_ANSWER_CORRECT": {"parent": gs0, "final": gsN},
        "NEWLINE_ARGMAX_COUNT": {"parent": p0.get("NEWLINE_ARGMAX_COUNT"), "final": pN.get("NEWLINE_ARGMAX_COUNT")},
        "NEWLINE_ARGMAX_RATE": {"parent": nl0, "final": nlN},
        "NEWLINE_PROBABILITY": {"parent": p0.get("NEWLINE_PROBABILITY"), "final": pN.get("NEWLINE_PROBABILITY")},
        "TARGET_LOGIT": {"parent": p0.get("TARGET_LOGIT"), "final": pN.get("TARGET_LOGIT")},
        "NEWLINE_LOGIT": {"parent": p0.get("NEWLINE_LOGIT"), "final": pN.get("NEWLINE_LOGIT")},
        "TARGET_NEWLINE_LOGIT_GAP": {"parent": p0.get("TARGET_MINUS_NEWLINE_LOGIT_GAP"), "final": pN.get("TARGET_MINUS_NEWLINE_LOGIT_GAP")},
        "RESPONSE_ENTRY_ENTROPY": {"parent": p0.get("RESPONSE_ENTRY_ENTROPY"), "final": pN.get("RESPONSE_ENTRY_ENTROPY")},
        "GREEDY_STOPPING": {"parent": p0.get("GREEDY_STOPPING"), "final": pN.get("GREEDY_STOPPING")},
        "EOS_RANK": {"parent": p0.get("EOS_MEAN_RANK"), "final": pN.get("EOS_MEAN_RANK")},
        "EOS_PROBABILITY": {"parent": p0.get("EOS_MEAN_PROBABILITY"), "final": pN.get("EOS_MEAN_PROBABILITY")},
        "EOS_ARGMAX": {"parent": p0.get("EOS_ARGMAX"), "final": pN.get("EOS_ARGMAX")},
        "RAMBLE_RATE": {"parent": p0.get("RAMBLE_RATE"), "final": pN.get("RAMBLE_RATE")},
        "EMPTY_RESPONSE_RATE": {"parent": p0.get("EMPTY_RESPONSE_RATE"), "final": pN.get("EMPTY_RESPONSE_RATE")},
        "INDEPENDENT_NL_NLL": {"parent": n0.get("natural_language_nll_mean"), "final": nN.get("natural_language_nll_mean")},
        "GENERAL_VAL_NLL": {"parent": v0.get("general"), "final": vN.get("general")},
        "GENESIS_VAL_NLL": {"parent": v0.get("genesis"), "final": vN.get("genesis")},
        "CODE_NLL": {"parent": v0.get("code"), "final": vN.get("code")},
        "JSON_NLL": {"parent": v0.get("json"), "final": vN.get("json")},
        "FOUNDATION_RANK": {"parent": f0.get("ASSISTANT_BOUNDARY_TARGET_RANK"), "final": fN.get("ASSISTANT_BOUNDARY_TARGET_RANK")},
        "FOUNDATION_TOP5": {"parent": f0.get("ASSISTANT_BOUNDARY_TOP5_COUNT"), "final": fN.get("ASSISTANT_BOUNDARY_TOP5_COUNT")},
        "STAGE3_HISTORICAL": {"parent": s0.get("historical_pass_count"), "final": sN.get("historical_pass_count")},
        "STAGE3_COLLAPSE": {"parent": s0.get("n_collapsed"), "final": sN.get("n_collapsed")},
        "STAGE3_DELTA_VS_WRIM0": {"parent": s0.get("mean_wrim0_anchor_nll_delta"), "final": s3_final_delta},
        "STAGE3_DRIFT_VS_STEP400": {"parent": s0.get("STAGE3_DRIFT_VS_STEP400"), "final": s3_final_drift},
        "STAGE3_DRIFT_VS_PARENT": {"final": None if sN is None else sN.get("STAGE3_DRIFT_VS_PREFIX_PARENT")},
        "NEW_FAILURES": None if not hard else (abort or {}).get("stop_reason"),
        "BEST_ANALYSIS_CHECKPOINT": best_ck,
        "FIRST_TOKEN_ENTRY_SIGNAL": signal,
        "GREEDY_BREAKTHROUGH": "YES" if breakthrough else "NO",
        "NEWLINE_MODE_BROKEN": "YES" if newline_broken else "NO",
        "RETENTION_SIGNAL": retention,
        "HARD_STOP": hard,
        "STOP_REASON": "COMPLETE" if complete else ((abort or {}).get("stop_reason") or "INCOMPLETE"),
        "TRAINING_AUTHORIZATION_FINAL": "OFF",
        "SECOND_RUN_CREATED": "NO",
        "MODEL_PROMOTED": "NO",
        "CANONICAL_CHANGED": "NO",
        "COMMIT": "NO",
        "PUSH": "NO",
        "DEPLOY": "NO",
        "NEXT_COMMANDER_DECISION": next_decision(hard, complete),
        "class_metrics_parent": p0.get("by_class"),
        "class_metrics_final": pN.get("by_class"),
        "fixtures": fixtures,
        "mask_stats": mask_stats,
        "optimizer_steps": last,
        "TRAINING_TIME": elapsed,
        "plm_by_step": plm_by_step,
        "stage3_by_step": stage3_by_step,
    }
    write_json(report_path, commander)
    write_json(ckpt_root / "training-summary.json", {"ok": not hard, "stop_reason": commander["STOP_REASON"], "optimizer_steps": last, "tokens_seen": tokens_seen, "HARD_STOP_TRIGGERED": hard})
    if ollama_stopped:
        start_user_ollama()
    return commander


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(AUTHORIZE_FLAG, action="store_true")
    parser.add_argument("--dump-root", default=None)
    args, _unknown = parser.parse_known_args()
    from stage3_runtime import write_json

    report_path = Path(DATA_ROOT) / REPORT_FILENAME
    try:
        if not authorization_ok():
            payload = denial_payload("authorization_missing")
            write_json(report_path, payload)
            print(json.dumps({"ok": False, "reason": "authorization_missing"}))
            return
        result = run_authorized_training(args)
        print(json.dumps({"ok": result.get("ok"), "STOP_REASON": result.get("STOP_REASON"), "STEPS_EXECUTED": result.get("STEPS_EXECUTED"), "FIRST_TOKEN_ENTRY_SIGNAL": result.get("FIRST_TOKEN_ENTRY_SIGNAL"), "GREEDY_BREAKTHROUGH": result.get("GREEDY_BREAKTHROUGH"), "NEWLINE_MODE_BROKEN": result.get("NEWLINE_MODE_BROKEN")}, default=str))
    except Exception as exc:
        payload = {**denial_payload("exception"), "error": str(exc), "traceback": traceback.format_exc()}
        write_json(report_path, payload)
        raise
    finally:
        unset_auth()
        from datetime import datetime, timezone

        Path(CKPT_ROOT).mkdir(parents=True, exist_ok=True)
        (Path(CKPT_ROOT) / "training-authorization-off.json").write_text(
            json.dumps({"WRIM_TRAINING_AUTHORIZATION": "OFF", "RUN_ID": RUN_ID, "timestamp": datetime.now(timezone.utc).isoformat()}, indent=2),
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
