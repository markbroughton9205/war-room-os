"""Retention-anchored lm_head trainer. Body frozen. No Stage3/graduation train data."""
from __future__ import annotations

import hashlib
import json
import os
import random
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn.functional as F

from wrim_arch_uh1_ac1_train import AC1_CTRL_WD, _write, unset_auth
from wrim_arch_uh1_ac2 import _ctrl_grads
from wrim_arch_uh1_ac2_train import pack_rows
from wrim_arch_uh1_phase_a import _sha_file, _split_loss, load_jsonl
from wrim_cpt_identity import BOS_ID, EOS_ID
from wrim_g20m import WRIM0Model
from wrim_g20m_uh1 import UH1_AC2_PARAM_COUNT, WRIMUH1Model, freeze_body_train_ac2
from wrim_hvu_identity import (
    AUTHORIZE_ENV_NAME,
    BETAS,
    CANONICAL_HASH,
    CKPT_BASE,
    DATA_ROOT,
    EPS,
    EVAL_STEPS,
    EXPECTED_PARENT_MODEL_HASH,
    EXPERIMENTAL_PARENT_CKPT,
    GRAD_CLIP,
    GRAD_HARD,
    GRAD_REVIEW,
    GRAD_WARN,
    MICRO_BATCH,
    SEED,
    SEQ_LEN,
    TOKENIZER_EXPECTED_SHA,
    TOKENS_PER_STEP,
)
from wrim_plm1_gates import hard_hits
from wrim_resumable_checkpoint import MODEL_NAME, save_resumable_checkpoint
from wrim_retention_eval import eval_retention_bundle

REH_EXCLUDE_CATS = frozenset({"role_boundary_rehearsal"})
HEAD_LR_DEFAULT = 1e-4


def kl_mean(student_logits: torch.Tensor, teacher_logits: torch.Tensor) -> torch.Tensor:
    log_p = F.log_softmax(student_logits.float(), dim=-1)
    log_q = F.log_softmax(teacher_logits.float(), dim=-1)
    return (torch.exp(log_q) * (log_q - log_p)).sum(dim=-1).mean()


def mixed_kl(student_logits, *, teacher, teacher400, teacher_mix: str, x: torch.Tensor) -> torch.Tensor:
    with torch.no_grad():
        t014 = teacher(x)
        t400 = teacher400(x) if teacher400 is not None else None
    if teacher_mix == "400" and t400 is not None:
        return kl_mean(student_logits, t400)
    if teacher_mix == "mix" and t400 is not None:
        return 0.5 * kl_mean(student_logits, t014) + 0.5 * kl_mean(student_logits, t400)
    return kl_mean(student_logits, t014)


def head_l2(student, teacher) -> torch.Tensor:
    return ((student.lm_head.weight - teacher.lm_head.weight.detach()) ** 2).mean()


def pack_rehearsal(tokenizer, docs: list[dict[str, Any]], steps: int) -> list[tuple[np.ndarray, np.ndarray]]:
    ids: list[int] = []
    for rec in docs:
        if str(rec.get("category") or "") in REH_EXCLUDE_CATS:
            continue
        text = str(rec.get("text") or "")
        if not text.strip():
            continue
        toks = list(tokenizer.encode(text, add_special_tokens=False).ids)
        if not toks:
            continue
        ids.extend([BOS_ID, *toks, EOS_ID])
    need = steps * MICRO_BATCH * SEQ_LEN + 1
    if len(ids) < 8:
        raise ValueError("rehearsal stream empty")
    while len(ids) < need:
        ids = ids + ids
    stream = np.asarray(ids[:need], dtype=np.int32)
    batches = []
    span = MICRO_BATCH * SEQ_LEN
    for s in range(steps):
        xs = []
        ys = []
        for b in range(MICRO_BATCH):
            off = s * span + b * SEQ_LEN
            chunk = stream[off : off + SEQ_LEN + 1]
            xs.append(chunk[:-1])
            ys.append(chunk[1:])
        batches.append((np.stack(xs), np.stack(ys)))
    return batches


def train_kl(
    *,
    run_id: str,
    corpus_dir: Path,
    parent_ckpt: Path,
    pack_name: str,
    teacher_014: Path,
    teacher_400: Path | None,
    kl_weight: float,
    teacher_mix: str = "014",
    kl_on: str = "rehearsal",
    l2_weight: float = 0.0,
    steps: int = 10,
    head_lr: float = HEAD_LR_DEFAULT,
) -> dict[str, Any]:
    from safetensors.torch import load_file as load_safetensors_file
    from tokenizers import Tokenizer

    from run000007_env import verify_linux_env
    from run000007_preflight import resolve_dump_root, sha256_file
    from run000007_vram import ensure_vram_for_training, start_user_ollama
    from wrim_cpt2_identity import CORPUS_VERSION as CPT2_CORPUS_VERSION
    from wrim_cpt5_identity import INDEPENDENT_NL_PACK
    from wrim_cpt_identity import ADDENDUM_SHA, LINUX_CKPT_ROOT, SUITE_SHA
    from wrim_cpt_preflight import locate_baseline, locate_suite
    from wrim_cpt_stage_b_corpus import corpus_root, tokenize_docs, val_family_id_packs
    from wrim_cpt_stage_b_identity import PROVISIONAL_STAGE_B_PARENT_CHECKPOINT
    from wrim_proven_load import disable_tf32
    from wrim_cpt_stage_a_select import load_weights_only
    from stage3a_run import load_baseline, load_suite

    auth_value = f"ON_FOR_{run_id.replace('-', '_')}_ONLY"
    os.environ[AUTHORIZE_ENV_NAME] = auth_value
    t0 = datetime.now(timezone.utc).isoformat()
    ckpt_root = Path(CKPT_BASE) / run_id
    report_path = Path(DATA_ROOT) / f"{run_id}_REPORT.json"
    ollama_stopped = False
    tokens_per_step = TOKENS_PER_STEP if kl_on == "response" else 2 * TOKENS_PER_STEP
    max_tokens = min(steps * tokens_per_step, 204_800)
    use_steps = max(1, min(steps, max_tokens // tokens_per_step))

    def finish(obj: dict[str, Any]) -> dict[str, Any]:
        obj.setdefault("TRAINING_AUTHORIZATION_FINAL", "OFF")
        obj.setdefault("MODEL_PROMOTED", "NO")
        obj.setdefault("CANONICAL_CHANGED", "NO")
        obj.setdefault("TOKENIZER_CHANGED", "NO")
        obj.setdefault("FULL_BODY_UNFROZEN", "NO")
        obj.setdefault("STAGE3B_STARTED", "NO")
        obj.setdefault("COMMIT", "NO")
        obj.setdefault("PUSH", "NO")
        obj.setdefault("DEPLOY", "NO")
        unset_auth()
        if ollama_stopped:
            start_user_ollama()
        _write(report_path, obj)
        return obj

    dump = resolve_dump_root(None)
    if dump is None:
        return finish({"ok": False, "reason": "dump_root_missing", "RUN_ID": run_id})
    env = verify_linux_env()
    vram = ensure_vram_for_training()
    ollama_stopped = bool(vram.get("OLLAMA_STOPPED_FOR_TRAINING"))
    if not env.get("ok"):
        return finish({"ok": False, "reason": "env_fail", "env": env, "RUN_ID": run_id})
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    tok_hash = sha256_file(tok_path)
    if tok_hash != TOKENIZER_EXPECTED_SHA:
        return finish({"ok": False, "reason": "tokenizer_hash_mismatch", "RUN_ID": run_id})
    tokenizer = Tokenizer.from_file(str(tok_path))
    step400 = Path(LINUX_CKPT_ROOT) / PROVISIONAL_STAGE_B_PARENT_CHECKPOINT / MODEL_NAME
    if sha256_file(step400) != CANONICAL_HASH:
        return finish({"ok": False, "reason": "canonical_hash_changed", "RUN_ID": run_id})
    foundation_hash = sha256_file(Path(EXPERIMENTAL_PARENT_CKPT) / MODEL_NAME)
    if foundation_hash != EXPECTED_PARENT_MODEL_HASH:
        return finish({"ok": False, "reason": "foundation_parent_hash_mismatch", "RUN_ID": run_id})
    parent_path = parent_ckpt / MODEL_NAME if parent_ckpt.is_dir() else parent_ckpt
    if not parent_path.is_file():
        return finish({"ok": False, "reason": "parent_missing", "path": str(parent_path), "RUN_ID": run_id})
    if ckpt_root.is_dir() and (ckpt_root / f"step-{use_steps}" / "resume-manifest.json").is_file():
        return finish({"ok": False, "reason": "second_execution_forbidden", "RUN_ID": run_id})

    stream, mask, batches = pack_rows(tokenizer, corpus_dir, use_steps)
    train_rows = load_jsonl(corpus_dir / "train.jsonl")
    val_rows = load_jsonl(corpus_dir / "val.jsonl")
    croot = corpus_root()
    reh_docs = load_jsonl(croot / f"{CPT2_CORPUS_VERSION}-TRAIN.jsonl")
    reh_batches = pack_rehearsal(tokenizer, reh_docs, use_steps) if kl_on != "response" else None

    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)

    model = WRIMUH1Model(assistant_control=True, span_control=True, stop_control=False)
    src_state = load_safetensors_file(str(parent_path))
    missing, unexpected = model.load_state_dict(src_state, strict=False)
    extra = set(missing) - {"assistant_span_ctrl", "assistant_stop_ctrl"}
    if extra or unexpected:
        return finish({"ok": False, "reason": "state_dict_mismatch", "missing": list(missing), "unexpected": list(unexpected), "RUN_ID": run_id})
    model.to(device)
    freeze_body_train_ac2(model, lm_head=True, stop=False, ctrl=False)

    teacher = WRIMUH1Model(assistant_control=True, span_control=True, stop_control=False)
    t014_path = teacher_014 / MODEL_NAME if teacher_014.is_dir() else teacher_014
    teacher.load_state_dict(load_safetensors_file(str(t014_path)), strict=False)
    teacher.to(device)
    teacher.freeze_inference()

    teacher400 = None
    if teacher_mix in {"400", "mix"}:
        teacher400 = WRIM0Model()
        load_weights_only(teacher400, step400 if teacher_400 is None else (teacher_400 / MODEL_NAME if teacher_400.is_dir() else teacher_400))
        teacher400.to(device)
        teacher400.freeze_inference()

    # preflight combined objective
    x_np, y_np, m_np = batches[0]
    x = torch.tensor(x_np, dtype=torch.long, device=device)
    y = torch.tensor(y_np, dtype=torch.long, device=device)
    y_mask = torch.tensor(m_np, dtype=torch.int8, device=device)
    xr = None
    if reh_batches is not None:
        xr = torch.tensor(reh_batches[0][0], dtype=torch.long, device=device)
    model.zero_grad(set_to_none=True)
    freeze_body_train_ac2(model, lm_head=True, stop=False, ctrl=False)
    logits = model(x)
    split = _split_loss(logits, y, y_mask, first_w=1.0)
    if kl_on == "response":
        kl = mixed_kl(logits, teacher=teacher, teacher400=teacher400, teacher_mix=teacher_mix, x=x)
    else:
        logits_r = model(xr)
        kl = mixed_kl(logits_r, teacher=teacher, teacher400=teacher400, teacher_mix=teacher_mix, x=xr)
    l2 = head_l2(model, teacher)
    loss0 = split["loss"] + float(kl_weight) * kl + float(l2_weight) * l2
    loss0.backward()
    grads = _ctrl_grads(model)
    raw0 = float(grads["TOTAL_TRAINABLE_GRAD"])
    gate = "HARD" if raw0 >= GRAD_HARD else ("REVIEW" if raw0 >= GRAD_REVIEW else ("WARN" if raw0 >= GRAD_WARN else "SAFE"))
    preflight = {
        "TOTAL_TRAINABLE_GRAD": raw0,
        "ENTRY_CTRL_GRAD": grads.get("ENTRY_CTRL_GRAD"),
        "SPAN_CTRL_GRAD": grads.get("SPAN_CTRL_GRAD"),
        "LM_HEAD_GRAD": grads.get("LM_HEAD_GRAD"),
        "KL": float(kl.detach().item()),
        "L2": float(l2.detach().item()),
        "CE": float(split["loss"].detach().item()),
        "FIRST_TOKEN_CE": split["FIRST_TOKEN_CE"],
        "LATER_TOKEN_CE": split["LATER_TOKEN_CE"],
        "EOS_CE": split["EOS_CE"],
        "GRAD_GATE": gate,
        "KL_WEIGHT": kl_weight,
        "L2_WEIGHT": l2_weight,
        "KL_ON": kl_on,
        "TEACHER_MIX": teacher_mix,
    }
    model.zero_grad(set_to_none=True)
    freeze_body_train_ac2(model, lm_head=True, stop=False, ctrl=False)
    if raw0 >= GRAD_HARD or not np.isfinite(raw0):
        return finish({"ok": False, "reason": "preflight_unsafe", "preflight": preflight, "RUN_ID": run_id})
    n_params = int(sum(p.numel() for p in model.parameters()))
    if n_params != UH1_AC2_PARAM_COUNT:
        return finish({"ok": False, "reason": "param_count", "n": n_params, "RUN_ID": run_id})
    trainable = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.AdamW([model.lm_head.weight], lr=head_lr, betas=BETAS, eps=EPS, weight_decay=AC1_CTRL_WD, fused=False)

    val_docs = load_jsonl(croot / f"{CPT2_CORPUS_VERSION}-VAL.jsonl")
    val_packs = val_family_id_packs(tokenize_docs(val_docs, tokenizer))
    nl_rows = load_jsonl(Path(DATA_ROOT) / INDEPENDENT_NL_PACK / f"{INDEPENDENT_NL_PACK}-PASSAGES.jsonl")
    ft_rows = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-FIRST-TOKEN-1-v1.0.0" / "val.jsonl")
    tt_rows = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "val.jsonl")
    suite = load_suite(locate_suite())
    baseline = load_baseline(locate_baseline(Path(DATA_ROOT)))
    wrim0_logp: dict[str, torch.Tensor] = {}
    parent_cpu = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}

    ckpt_root.mkdir(parents=True, exist_ok=True)
    evals_dir = ckpt_root / "evals"
    evals_dir.mkdir(parents=True, exist_ok=True)
    identity = {
        "RUN_ID": run_id,
        "PARENT_MODEL_ID": str(parent_ckpt),
        "PARENT_HASH": sha256_file(parent_path),
        "TEACHER_014": str(teacher_014),
        "TEACHER_014_HASH": sha256_file(t014_path),
        "TEACHER_MIX": teacher_mix,
        "KL_WEIGHT": kl_weight,
        "L2_WEIGHT": l2_weight,
        "KL_ON": kl_on,
        "HEAD_LR": head_lr,
        "TOKENIZER_HASH": tok_hash,
        "STAGE3_HASH": SUITE_SHA,
        "INSTRUCTION_ADDENDUM_HASH": ADDENDUM_SHA,
        "TRAIN_DATASET_IDS": [corpus_dir.name, "WR-CORPUS-CPT-2-v1.0.0-TRAIN-KL-ANCHOR"],
        "TRAIN_DATASET_HASHES": {corpus_dir.name: sha256_file(corpus_dir / "train.jsonl")},
        "VALIDATION_DATASET_IDS": [corpus_dir.name + "-val", "WRIM-FOUNDATION-EVAL-1", INDEPENDENT_NL_PACK],
        "VALIDATION_DATASET_HASHES": {corpus_dir.name + "-val": sha256_file(corpus_dir / "val.jsonl")},
        "TRAINER_PROVENANCE_HASH": sha256_file(Path(__file__)),
        "PACKER_PROVENANCE_HASH": sha256_file(Path(__file__).with_name("wrim_plm3_encode.py")),
        "OPTIMIZER_CLASS": "AdamW",
        "OPTIMIZER_HYPERPARAMETERS": {"fused": False, "betas": list(BETAS), "eps": EPS, "weight_decay": AC1_CTRL_WD, "grad_clip": GRAD_CLIP, "lr": head_lr},
        "ARCHITECTURE_ID": model.architecture_id,
        "TRAIN_SCOPE": "LM_HEAD_ONLY_PLUS_KL_ANCHOR",
        "BODY_FROZEN": True,
        "LM_HEAD_TRAINED": True,
        "CTRL_TRAINABLE": False,
        "PACK": pack_name,
        "PREFLIGHT": preflight,
    }
    _write(ckpt_root / "run-identity.json", identity)
    stream_sha = hashlib.sha256(stream.tobytes()).hexdigest()
    lr_table = {str(s): head_lr for s in range(0, use_steps + 2)}
    metrics = []
    geo_by_step = {}
    stage3_by_step = {}
    prefix_by_step = {}
    nll_by_step = {}
    abort = None
    tokens_seen = 0
    t_train0 = time.perf_counter()
    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()

    def persist(step: int, tokens: int) -> None:
        save_resumable_checkpoint(
            run_root=ckpt_root,
            step=step,
            model=model,
            optimizer=optimizer,
            tokens_processed=tokens,
            next_token_offset=tokens,
            stream_prefix_sha256=stream_sha,
            curriculum={"stage": "UH1_AC2_KL", "pack": pack_name, "kl_weight": kl_weight, "teacher_mix": teacher_mix, "lr": head_lr},
            identity=identity,
            lr_table=lr_table,
            authorized_max_step=use_steps,
            authorized_max_tokens=max_tokens,
        )

    def run_eval(step: int, loss: float | None, tokens: int, grad: float | None) -> dict[str, Any]:
        model.eval()
        bundle = eval_retention_bundle(
            model=model,
            tokenizer=tokenizer,
            device=device,
            dump=dump,
            suite=suite,
            baseline=baseline,
            wrim0_logp=wrim0_logp,
            parent_cpu=parent_cpu,
            val_packs=val_packs,
            nl_rows=nl_rows,
            ft_rows=ft_rows,
            tt_rows=tt_rows,
            mix_rows=val_rows,
            step=step,
            name=run_id,
        )
        freeze_body_train_ac2(model, lm_head=True, stop=False, ctrl=False)
        _write(evals_dir / f"role-geo-step-{step}.json", {"val": bundle["geo_mix"], "ft": bundle["geo_ft"]})
        _write(evals_dir / f"prefix-step-{step}.json", bundle["prefix_mix"])
        _write(evals_dir / f"prefix-tt-step-{step}.json", bundle["prefix_tt"])
        _write(evals_dir / f"foundation-step-{step}.json", bundle["foundation"])
        _write(evals_dir / f"val-nll-step-{step}.json", bundle["nlls"])
        _write(evals_dir / f"independent-nl-step-{step}.json", bundle["independent_nl"])
        _write(evals_dir / f"stage3-step-{step}.json", bundle["stage3"])
        geo_by_step[str(step)] = bundle["geo_mix"]
        prefix_by_step[str(step)] = bundle["prefix_tt"]
        stage3_by_step[str(step)] = bundle["stage3"]
        nll_by_step[str(step)] = bundle["nlls"]
        gate_bundle = {
            "stage3_historical": bundle["stage3"].get("historical_pass_count"),
            "stage3_collapse": bundle["stage3"].get("n_collapsed"),
            "stage3_delta_nll": bundle["stage3"].get("mean_wrim0_anchor_nll_delta"),
            "grad_norm": grad,
            "nan": False,
        }
        return {**bundle, "hard_gate_hits": hard_hits(gate_bundle)}

    ev0 = run_eval(0, None, 0, None)
    persist(0, 0)
    if ev0.get("hard_gate_hits"):
        abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": ",".join(ev0["hard_gate_hits"]), "step": 0}

    eval_steps = tuple(s for s in EVAL_STEPS if s <= use_steps)
    if use_steps > 10:
        eval_steps = tuple(sorted(set(eval_steps + tuple(s for s in range(10, use_steps + 1, 10)))))
    if use_steps not in eval_steps:
        eval_steps = eval_steps + (use_steps,)
    if abort is None:
        for step in range(1, use_steps + 1):
            if tokens_seen + tokens_per_step > max_tokens:
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "token_cap", "step": step}
                break
            x_np, y_np, m_np = batches[step - 1]
            x = torch.tensor(x_np, dtype=torch.long, device=device)
            y = torch.tensor(y_np, dtype=torch.long, device=device)
            y_mask = torch.tensor(m_np, dtype=torch.int8, device=device)
            optimizer.param_groups[0]["lr"] = head_lr
            optimizer.zero_grad(set_to_none=True)
            logits = model(x)
            split = _split_loss(logits, y, y_mask, first_w=1.0)
            if kl_on == "response":
                kl = mixed_kl(logits, teacher=teacher, teacher400=teacher400, teacher_mix=teacher_mix, x=x)
            else:
                xr = torch.tensor(reh_batches[step - 1][0], dtype=torch.long, device=device)
                logits_r = model(xr)
                kl = mixed_kl(logits_r, teacher=teacher, teacher400=teacher400, teacher_mix=teacher_mix, x=xr)
            l2 = head_l2(model, teacher)
            loss = split["loss"] + float(kl_weight) * kl + float(l2_weight) * l2
            if not torch.isfinite(loss):
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "NAN_INF", "step": step}
                break
            loss.backward()
            grads = _ctrl_grads(model)
            raw = grads["TOTAL_TRAINABLE_GRAD"]
            if not np.isfinite(raw) or raw >= GRAD_HARD:
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "GRAD_INSTABILITY", "grad": raw, "step": step, "grads": grads}
                break
            clipped = float(torch.nn.utils.clip_grad_norm_(trainable, GRAD_CLIP))
            optimizer.step()
            tokens_seen += tokens_per_step
            row = {
                "step": step,
                "loss": float(loss.item()),
                "CE": float(split["loss"].item()),
                "KL": float(kl.detach().item()),
                "L2": float(l2.detach().item()),
                "FIRST_TOKEN_CE": split["FIRST_TOKEN_CE"],
                "LATER_TOKEN_CE": split["LATER_TOKEN_CE"],
                "EOS_CE": split["EOS_CE"],
                "raw_grad": raw,
                "clipped_grad": clipped,
                "LM_HEAD_GRAD": grads.get("LM_HEAD_GRAD"),
                "tokens_seen": tokens_seen,
                "lr": head_lr,
                "kl_weight": kl_weight,
                "grad_gate": "WARN" if raw >= GRAD_WARN else ("REVIEW" if raw >= GRAD_REVIEW else "SAFE"),
            }
            metrics.append(row)
            with (ckpt_root / "metrics.jsonl").open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(row) + "\n")
            if step in eval_steps:
                persist(step, tokens_seen)
                ev = run_eval(step, row["loss"], tokens_seen, raw)
                if ev.get("hard_gate_hits"):
                    abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": ",".join(ev["hard_gate_hits"]), "step": step}
                    break

    train_s = time.perf_counter() - t_train0
    peak_vram = int(torch.cuda.max_memory_allocated()) if torch.cuda.is_available() else None
    final_step = max([int(k) for k in stage3_by_step], default=0)
    s0 = stage3_by_step.get("0") or {}
    sN = stage3_by_step.get(str(final_step)) or {}
    p0 = prefix_by_step.get("0") or {}
    pN = prefix_by_step.get(str(final_step)) or {}
    complete = abort is None and final_step >= use_steps
    best_hash = None
    if (ckpt_root / f"step-{final_step}" / MODEL_NAME).is_file():
        best_hash = _sha_file(ckpt_root / f"step-{final_step}" / MODEL_NAME)
    report = {
        "ok": complete,
        "kind": f"{run_id}_REPORT",
        "RUN_ID": run_id,
        "PACK": pack_name,
        "KL_WEIGHT": kl_weight,
        "TEACHER_MIX": teacher_mix,
        "HEAD_LR": head_lr,
        "STEPS": use_steps if complete else final_step,
        "TOKENS_USED": tokens_seen,
        "PREFLIGHT": preflight,
        "PREFIX_PARENT": p0,
        "PREFIX_FINAL": pN,
        "STAGE3_HISTORICAL": {"parent": s0.get("historical_pass_count"), "final": sN.get("historical_pass_count")},
        "STAGE3_COLLAPSE": {"parent": s0.get("n_collapsed"), "final": sN.get("n_collapsed")},
        "STAGE3_DRIFT_VS_STEP400": sN.get("STAGE3_DRIFT_VS_STEP400"),
        "TOKEN2_CE": {"parent": p0.get("TOKEN2_CE"), "final": pN.get("TOKEN2_CE")},
        "TOKEN2_RANK": {"parent": p0.get("TOKEN2_RANK"), "final": pN.get("TOKEN2_RANK")},
        "TOKEN2_ORACLE": {"parent": p0.get("TOKEN2_GIVEN_GOLD_TOKEN1_CORRECT"), "final": pN.get("TOKEN2_GIVEN_GOLD_TOKEN1_CORRECT")},
        "GREEDY_TWO_TOKEN_EXACT": {"parent": p0.get("GREEDY_TWO_TOKEN_EXACT"), "final": pN.get("GREEDY_TWO_TOKEN_EXACT")},
        "NLL_PARENT": nll_by_step.get("0"),
        "NLL_FINAL": nll_by_step.get(str(final_step)),
        "METRICS": metrics,
        "PARAMETER_COUNT": n_params,
        "PEAK_VRAM_BYTES": peak_vram,
        "WALL_SECONDS": train_s,
        "BEST_EXPERIMENTAL_CHECKPOINT": f"{run_id}/step-{final_step}",
        "BEST_EXPERIMENTAL_HASH": best_hash,
        "abort": abort,
        "timestamp": t0,
        "finished": datetime.now(timezone.utc).isoformat(),
        "TRAINING_AUTHORIZATION": "OFF",
        "TRANSFORMER_BODY_FROZEN": True,
    }
    if abort:
        report["ok"] = False
        report["HARD_STOP_TRIGGERED"] = True
    return finish(report)
