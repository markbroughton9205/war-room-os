"""Selective upper-body unfreeze trainer. New optimizer per stage. Body LR << lm_head LR."""
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

from wrim_arch_uh1_ac1_train import AC1_CTRL_WD, _write, unset_auth
from wrim_arch_uh1_ac2_train import pack_rows
from wrim_arch_uh1_phase_a import _sha_file, _split_loss, load_jsonl
from wrim_g20m_uh1 import UH1_AC2_PARAM_COUNT, WRIMUH1Model
from wrim_hvu_identity import (
    AUTHORIZE_ENV_NAME,
    BETAS,
    CANONICAL_HASH,
    CKPT_BASE,
    DATA_ROOT,
    EPS,
    EXPECTED_PARENT_MODEL_HASH,
    EXPERIMENTAL_PARENT_CKPT,
    GRAD_CLIP,
    GRAD_HARD,
    MICRO_BATCH,
    SEED,
    TOKENIZER_EXPECTED_SHA,
    TOKENS_PER_STEP,
)
from wrim_plm1_gates import hard_hits
from wrim_resumable_checkpoint import MODEL_NAME, save_resumable_checkpoint
from wrim_retention_eval import eval_retention_bundle
from wrim_selective_unfreeze import (
    distance_from_parent,
    freeze_u_stage,
    from_layer_for_stage,
    group_params,
    layer_grads,
)

HEAD_LR_DEFAULT = 1e-4


def dense_eval_steps(steps: int) -> tuple[int, ...]:
    out = {0, 1, 2, 5, 10}
    out.update(range(15, steps + 1, 5))
    if steps not in out:
        out.add(steps)
    return tuple(sorted(s for s in out if 0 <= s <= steps))


def train_u(
    *,
    run_id: str,
    corpus_dir: Path,
    parent_ckpt: Path,
    pack_name: str,
    stage: str,
    steps: int = 10,
    head_lr: float = HEAD_LR_DEFAULT,
    body_lr: float = 1e-6,
    ctrl_lr: float | None = None,
    ctrl_trainable: bool = True,
    lm_head_trainable: bool | None = None,
    restore_ollama: bool = True,
    required_free_mib: float = 10000.0,
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
    from stage3a_run import load_baseline, load_suite

    use_ctrl_lr = float(body_lr if ctrl_lr is None else ctrl_lr)
    use_head = bool(head_lr > 0) if lm_head_trainable is None else bool(lm_head_trainable)
    if float(head_lr) <= 0:
        use_head = False
    auth_value = f"ON_FOR_{run_id.replace('-', '_')}_ONLY"
    os.environ[AUTHORIZE_ENV_NAME] = auth_value
    t0 = datetime.now(timezone.utc).isoformat()
    ckpt_root = Path(CKPT_BASE) / run_id
    report_path = Path(DATA_ROOT) / f"{run_id}_REPORT.json"
    ollama_stopped = False
    max_tokens = min(steps * TOKENS_PER_STEP, 204_800)
    use_steps = max(1, min(steps, max_tokens // TOKENS_PER_STEP))
    from_layer = from_layer_for_stage(stage)

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
        if ollama_stopped and restore_ollama:
            start_user_ollama()
        _write(report_path, obj)
        return obj

    dump = resolve_dump_root(None)
    if dump is None:
        return finish({"ok": False, "reason": "dump_root_missing", "RUN_ID": run_id})
    env = verify_linux_env()
    vram = ensure_vram_for_training(required_free_mib=required_free_mib)
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

    stream, mask, batches = pack_rows(tokenizer, corpus_dir, max(use_steps, 3))
    train_rows = load_jsonl(corpus_dir / "train.jsonl")
    val_rows = load_jsonl(corpus_dir / "val.jsonl")

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
    mask_info = freeze_u_stage(model, stage=stage, lm_head=use_head, ctrl=ctrl_trainable)
    parent_cpu = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}

    probe_rows = []
    unsafe = False
    for bi in range(3):
        x_np, y_np, m_np = batches[bi]
        x = torch.tensor(x_np, dtype=torch.long, device=device)
        y = torch.tensor(y_np, dtype=torch.long, device=device)
        y_mask = torch.tensor(m_np, dtype=torch.int8, device=device)
        model.zero_grad(set_to_none=True)
        freeze_u_stage(model, stage=stage, lm_head=use_head, ctrl=ctrl_trainable)
        logits = model(x)
        split = _split_loss(logits, y, y_mask, first_w=1.0)
        if not torch.isfinite(split["loss"]):
            unsafe = True
            probe_rows.append({"batch": bi, "nan": True})
            break
        split["loss"].backward()
        grads = layer_grads(model)
        row = {
            "batch": bi,
            **grads,
            "FIRST_TOKEN_CE": split["FIRST_TOKEN_CE"],
            "LATER_TOKEN_CE": split["LATER_TOKEN_CE"],
            "EOS_CE": split["EOS_CE"],
        }
        probe_rows.append(row)
        if (not np.isfinite(grads["TOTAL_TRAINABLE_GRAD"])) or grads["TOTAL_TRAINABLE_GRAD"] >= GRAD_HARD:
            unsafe = True
            break
    model.zero_grad(set_to_none=True)
    freeze_u_stage(model, stage=stage, lm_head=use_head, ctrl=ctrl_trainable)
    max_g = max((float(r.get("TOTAL_TRAINABLE_GRAD") or 0) for r in probe_rows), default=0.0)
    preflight = {
        "N_BATCHES": len(probe_rows),
        "MAX_TOTAL_TRAINABLE_GRAD": max_g,
        "BATCHES": probe_rows,
        "UNSAFE": unsafe,
        "HEAD_LR": head_lr,
        "BODY_LR": body_lr,
        "CTRL_LR": use_ctrl_lr,
        **mask_info,
    }
    # drop long name list from preflight file copies later; keep count
    preflight_slim = {k: v for k, v in preflight.items() if k != "TRAINABLE_NAMES"}
    preflight_slim["TRAINABLE_NAME_COUNT"] = len(mask_info["TRAINABLE_NAMES"])
    if unsafe:
        return finish({"ok": False, "reason": "preflight_unsafe", "preflight": preflight_slim, "RUN_ID": run_id, "UNFREEZE_STAGE": stage})

    groups = group_params(model)
    opt_groups = []
    group_lrs = []
    if groups["lm_head"]:
        opt_groups.append({"params": groups["lm_head"], "lr": head_lr})
        group_lrs.append(head_lr)
    if groups["body"]:
        opt_groups.append({"params": groups["body"], "lr": body_lr})
        group_lrs.append(body_lr)
    if groups["ctrl"]:
        opt_groups.append({"params": groups["ctrl"], "lr": use_ctrl_lr})
        group_lrs.append(use_ctrl_lr)
    if not opt_groups:
        return finish({"ok": False, "reason": "no_trainable_params", "RUN_ID": run_id, "UNFREEZE_STAGE": stage})
    optimizer = torch.optim.AdamW(opt_groups, betas=BETAS, eps=EPS, weight_decay=AC1_CTRL_WD, fused=False)
    trainable = [p for p in model.parameters() if p.requires_grad]

    croot = corpus_root()
    val_docs = load_jsonl(croot / f"{CPT2_CORPUS_VERSION}-VAL.jsonl")
    val_packs = val_family_id_packs(tokenize_docs(val_docs, tokenizer))
    nl_rows = load_jsonl(Path(DATA_ROOT) / INDEPENDENT_NL_PACK / f"{INDEPENDENT_NL_PACK}-PASSAGES.jsonl")
    ft_rows = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-FIRST-TOKEN-1-v1.0.0" / "val.jsonl")
    tt_rows = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "val.jsonl")
    suite = load_suite(locate_suite())
    baseline = load_baseline(locate_baseline(Path(DATA_ROOT)))
    wrim0_logp: dict[str, torch.Tensor] = {}

    ckpt_root.mkdir(parents=True, exist_ok=True)
    evals_dir = ckpt_root / "evals"
    evals_dir.mkdir(parents=True, exist_ok=True)
    identity = {
        "RUN_ID": run_id,
        "PARENT_MODEL_ID": str(parent_ckpt),
        "PARENT_HASH": sha256_file(parent_path),
        "UNFREEZE_STAGE": stage,
        "FROM_LAYER": from_layer,
        "TRAINABLE_NAMES": mask_info["TRAINABLE_NAMES"],
        "TRAINABLE_PARAMETER_COUNT": mask_info["TRAINABLE_PARAMETER_COUNT"],
        "TOTAL_PARAMETER_COUNT": mask_info["TOTAL_PARAMETER_COUNT"],
        "TRAINABLE_PERCENT": mask_info["TRAINABLE_PERCENT"],
        "HEAD_LR": head_lr,
        "BODY_LR": body_lr,
        "CTRL_LR": use_ctrl_lr,
        "CTRL_TRAINABLE": ctrl_trainable,
        "LM_HEAD_TRAINABLE": use_head,
        "LM_HEAD_FROZEN": (not use_head),
        "TOKENIZER_HASH": tok_hash,
        "STAGE3_HASH": SUITE_SHA,
        "INSTRUCTION_ADDENDUM_HASH": ADDENDUM_SHA,
        "TRAIN_DATASET_IDS": [corpus_dir.name],
        "TRAIN_DATASET_HASHES": {corpus_dir.name: sha256_file(corpus_dir / "train.jsonl")},
        "VALIDATION_DATASET_IDS": [corpus_dir.name + "-val", "WRIM-FOUNDATION-EVAL-1", INDEPENDENT_NL_PACK],
        "VALIDATION_DATASET_HASHES": {corpus_dir.name + "-val": sha256_file(corpus_dir / "val.jsonl")},
        "TRAINER_PROVENANCE_HASH": sha256_file(Path(__file__)),
        "PACKER_PROVENANCE_HASH": sha256_file(Path(__file__).with_name("wrim_plm3_encode.py")),
        "OPTIMIZER_CLASS": "AdamW",
        "OPTIMIZER_HYPERPARAMETERS": {
            "fused": False,
            "betas": list(BETAS),
            "eps": EPS,
            "weight_decay": AC1_CTRL_WD,
            "grad_clip": GRAD_CLIP,
            "head_lr": head_lr,
            "body_lr": body_lr,
            "ctrl_lr": use_ctrl_lr,
        },
        "ARCHITECTURE_ID": model.architecture_id,
        "TRAIN_SCOPE": f"SELECTIVE_{stage}",
        "BODY_FROZEN_BELOW": from_layer,
        "LM_HEAD_TRAINED": True,
        "PACK": pack_name,
        "PREFLIGHT": preflight_slim,
        "NEW_OPTIMIZER_STATE": True,
    }
    _write(ckpt_root / "run-identity.json", identity)
    stream_sha = hashlib.sha256(stream.tobytes()).hexdigest()
    lr_table = {str(s): head_lr for s in range(0, use_steps + 2)}
    metrics = []
    stage3_by_step = {}
    prefix_by_step = {}
    dist_by_step = {}
    eval_snaps: list[dict[str, Any]] = []
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
            curriculum={
                "stage": stage,
                "pack": pack_name,
                "head_lr": head_lr,
                "body_lr": body_lr,
                "ctrl_lr": use_ctrl_lr,
                "from_layer": from_layer,
            },
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
        freeze_u_stage(model, stage=stage, lm_head=use_head, ctrl=ctrl_trainable)
        dist = distance_from_parent(model, parent_cpu, from_layer=from_layer)
        _write(evals_dir / f"role-geo-step-{step}.json", {"val": bundle["geo_mix"], "ft": bundle["geo_ft"]})
        _write(evals_dir / f"prefix-step-{step}.json", bundle["prefix_mix"])
        _write(evals_dir / f"prefix-tt-step-{step}.json", bundle["prefix_tt"])
        _write(evals_dir / f"foundation-step-{step}.json", bundle["foundation"])
        _write(evals_dir / f"val-nll-step-{step}.json", bundle["nlls"])
        _write(evals_dir / f"independent-nl-step-{step}.json", bundle["independent_nl"])
        _write(evals_dir / f"stage3-step-{step}.json", bundle["stage3"])
        _write(evals_dir / f"distance-step-{step}.json", dist)
        stage3_by_step[str(step)] = bundle["stage3"]
        prefix_by_step[str(step)] = bundle["prefix_tt"]
        dist_by_step[str(step)] = dist
        gate_bundle = {
            "stage3_historical": bundle["stage3"].get("historical_pass_count"),
            "stage3_collapse": bundle["stage3"].get("n_collapsed"),
            "stage3_delta_nll": bundle["stage3"].get("mean_wrim0_anchor_nll_delta"),
            "grad_norm": grad,
            "nan": False,
        }
        hits = hard_hits(gate_bundle)
        eval_snaps.append(
            {
                "step": step,
                "stage3": bundle["stage3"].get("historical_pass_count"),
                "collapse": bundle["stage3"].get("n_collapsed"),
                "drift": bundle["stage3"].get("STAGE3_DRIFT_VS_STEP400"),
                "token2_ce": bundle["prefix_tt"].get("TOKEN2_CE"),
                "token2_rank": bundle["prefix_tt"].get("TOKEN2_RANK"),
                "oracle": bundle["prefix_tt"].get("TOKEN2_GIVEN_GOLD_TOKEN1_CORRECT"),
                "exact": bundle["prefix_tt"].get("GREEDY_TWO_TOKEN_EXACT"),
                "n_classes_exact": bundle["prefix_tt"].get("N_CLASSES_GREEDY_TWO_TOKEN"),
                "first_token_classes": bundle.get("FIRST_TOKEN_CLASSES_WORKING"),
                "greedy_first_ft": bundle.get("GREEDY_FIRST_TOKEN_MATCH_FT"),
                "greedy_short": bundle.get("GREEDY_SHORT_ANSWER_CORRECT"),
                "greedy_stopping": bundle.get("GREEDY_STOPPING"),
                "ramble": bundle.get("RAMBLE_RATE"),
                "empty": bundle.get("EMPTY_RESPONSE_RATE"),
                "independent_nl": bundle.get("INDEPENDENT_NL_NLL"),
                "general_nl": bundle.get("GENERAL_NL_NLL"),
                "code": bundle.get("CODE_NLL"),
                "json": bundle.get("JSON_NLL"),
                "distance": dist,
                "hard_gate_hits": hits,
            }
        )
        return {**bundle, "distance": dist, "hard_gate_hits": hits}

    ev0 = run_eval(0, None, 0, None)
    persist(0, 0)
    if ev0.get("hard_gate_hits"):
        abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": ",".join(ev0["hard_gate_hits"]), "step": 0}

    eval_at = dense_eval_steps(use_steps)
    if abort is None:
        for step in range(1, use_steps + 1):
            if tokens_seen + TOKENS_PER_STEP > max_tokens:
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "token_cap", "step": step}
                break
            x_np, y_np, m_np = batches[step - 1]
            x = torch.tensor(x_np, dtype=torch.long, device=device)
            y = torch.tensor(y_np, dtype=torch.long, device=device)
            y_mask = torch.tensor(m_np, dtype=torch.int8, device=device)
            for pg, glr in zip(optimizer.param_groups, group_lrs):
                pg["lr"] = glr
            optimizer.zero_grad(set_to_none=True)
            logits = model(x)
            split = _split_loss(logits, y, y_mask, first_w=1.0)
            loss = split["loss"]
            if not torch.isfinite(loss):
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "NAN_INF", "step": step}
                break
            loss.backward()
            grads = layer_grads(model)
            raw = grads["TOTAL_TRAINABLE_GRAD"]
            if not np.isfinite(raw) or raw >= GRAD_HARD:
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "GRAD_INSTABILITY", "grad": raw, "step": step, "grads": grads}
                break
            clipped = float(torch.nn.utils.clip_grad_norm_(trainable, GRAD_CLIP))
            optimizer.step()
            tokens_seen += TOKENS_PER_STEP
            row = {
                "step": step,
                "loss": float(loss.item()),
                "FIRST_TOKEN_CE": split["FIRST_TOKEN_CE"],
                "LATER_TOKEN_CE": split["LATER_TOKEN_CE"],
                "EOS_CE": split["EOS_CE"],
                "raw_grad": raw,
                "clipped_grad": clipped,
                **{k: grads[k] for k in grads if k.endswith("_GRAD") or k == "GRAD_GATE"},
                "tokens_seen": tokens_seen,
                "head_lr": head_lr,
                "body_lr": body_lr,
            }
            metrics.append(row)
            with (ckpt_root / "metrics.jsonl").open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(row) + "\n")
            if step in eval_at:
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
    d0 = dist_by_step.get("0") or {}
    dN = dist_by_step.get(str(final_step)) or {}
    complete = abort is None and final_step >= use_steps
    legal = [e for e in eval_snaps if e.get("stage3") is not None and int(e["stage3"]) >= 5 and not e.get("hard_gate_hits")]
    six = [e for e in legal if int(e["stage3"]) >= 6]
    pool = six or legal
    best_snap = None
    if pool:
        best_snap = min(
            pool,
            key=lambda e: (
                float(e.get("token2_ce") if e.get("token2_ce") is not None else 1e9),
                float(e.get("token2_rank") if e.get("token2_rank") is not None else 1e12),
                int(e.get("step") or 0),
            ),
        )
    best_step = int(best_snap["step"]) if best_snap is not None else final_step
    best_hash = None
    if (ckpt_root / f"step-{best_step}" / MODEL_NAME).is_file():
        best_hash = _sha_file(ckpt_root / f"step-{best_step}" / MODEL_NAME)
    bN = next((e for e in eval_snaps if int(e["step"]) == best_step), None) or {}
    report = {
        "ok": complete,
        "kind": f"{run_id}_REPORT",
        "RUN_ID": run_id,
        "UNFREEZE_STAGE": stage,
        "PACK": pack_name,
        "HEAD_LR": head_lr,
        "BODY_LR": body_lr,
        "CTRL_LR": use_ctrl_lr,
        "LM_HEAD_FROZEN": (not use_head),
        "CTRL_TRAINABLE": ctrl_trainable,
        "STEPS": use_steps if complete else final_step,
        "TOKENS_USED": tokens_seen,
        "TRAINABLE_PARAMETER_COUNT": mask_info["TRAINABLE_PARAMETER_COUNT"],
        "TOTAL_PARAMETER_COUNT": mask_info["TOTAL_PARAMETER_COUNT"],
        "TRAINABLE_PERCENT": mask_info["TRAINABLE_PERCENT"],
        "PREFLIGHT": preflight_slim,
        "PREFIX_PARENT": p0,
        "PREFIX_FINAL": pN,
        "STAGE3_HISTORICAL": {"parent": s0.get("historical_pass_count"), "final": sN.get("historical_pass_count"), "best": bN.get("stage3")},
        "STAGE3_COLLAPSE": {"parent": s0.get("n_collapsed"), "final": sN.get("n_collapsed"), "best": bN.get("collapse")},
        "STAGE3_DRIFT_VS_STEP400": bN.get("drift", sN.get("STAGE3_DRIFT_VS_STEP400")),
        "TOKEN2_CE": {"parent": p0.get("TOKEN2_CE"), "final": pN.get("TOKEN2_CE"), "best": bN.get("token2_ce")},
        "TOKEN2_RANK": {"parent": p0.get("TOKEN2_RANK"), "final": pN.get("TOKEN2_RANK"), "best": bN.get("token2_rank")},
        "TOKEN2_ORACLE": {"parent": p0.get("TOKEN2_GIVEN_GOLD_TOKEN1_CORRECT"), "final": pN.get("TOKEN2_GIVEN_GOLD_TOKEN1_CORRECT"), "best": bN.get("oracle")},
        "GREEDY_TWO_TOKEN_EXACT": {"parent": p0.get("GREEDY_TWO_TOKEN_EXACT"), "final": pN.get("GREEDY_TWO_TOKEN_EXACT"), "best": bN.get("exact")},
        "FIRST_TOKEN_CLASSES_WORKING": bN.get("first_token_classes"),
        "GREEDY_FIRST_TOKEN_MATCH": bN.get("greedy_first_ft"),
        "GREEDY_SHORT_ANSWER_CORRECT": bN.get("greedy_short"),
        "GREEDY_STOPPING": bN.get("greedy_stopping"),
        "RAMBLE_RATE": bN.get("ramble"),
        "EMPTY_RESPONSE_RATE": bN.get("empty"),
        "INDEPENDENT_NL_NLL": bN.get("independent_nl"),
        "GENERAL_NL_NLL": bN.get("general_nl"),
        "CODE_NLL": bN.get("code"),
        "JSON_NLL": bN.get("json"),
        "DISTANCE_PARENT": d0,
        "DISTANCE_FINAL": dN,
        "DISTANCE_BEST": bN.get("distance"),
        "EVAL_SNAPS": eval_snaps,
        "METRICS": metrics,
        "PEAK_VRAM_BYTES": peak_vram,
        "WALL_SECONDS": train_s,
        "TOKENS_PER_SECOND": (tokens_seen / train_s) if train_s > 0 and tokens_seen else None,
        "BEST_EXPERIMENTAL_CHECKPOINT": f"{run_id}/step-{best_step}",
        "BEST_EXPERIMENTAL_HASH": best_hash,
        "BEST_LEGAL_STEP": best_step,
        "abort": abort,
        "timestamp": t0,
        "finished": datetime.now(timezone.utc).isoformat(),
        "TRAINING_AUTHORIZATION": "OFF",
        "TRANSFORMER_BODY_FROZEN_BELOW": from_layer,
        "MICRO_BATCH": MICRO_BATCH,
    }
    if abort:
        report["ok"] = False
        report["HARD_STOP_TRIGGERED"] = True
    return finish(report)


def probe_u_mixes(
    *,
    parent_ckpt: Path,
    stage: str,
    mixes: list[tuple[str, Path]],
    ctrl_trainable: bool = True,
    n_batches: int = 3,
    restore_ollama: bool = False,
    required_free_mib: float = 10000.0,
) -> dict[str, Any]:
    """Gradient-only mix preflight. Does not construct an optimizer or train."""
    from safetensors.torch import load_file as load_safetensors_file
    from tokenizers import Tokenizer

    from run000007_env import verify_linux_env
    from run000007_preflight import resolve_dump_root, sha256_file
    from run000007_vram import ensure_vram_for_training, start_user_ollama
    from wrim_proven_load import disable_tf32

    ollama_stopped = False
    dump = resolve_dump_root(None)
    env = verify_linux_env()
    vram = ensure_vram_for_training(required_free_mib=required_free_mib)
    ollama_stopped = bool(vram.get("OLLAMA_STOPPED_FOR_TRAINING"))
    out: dict[str, Any] = {"ok": False, "UNFREEZE_STAGE": stage, "vram": {"ok": vram.get("ok"), "free": vram.get("VRAM_FREE_BEFORE_TRAINING")}}
    try:
        if dump is None or not env.get("ok") or not vram.get("ok"):
            out["reason"] = "env_or_vram"
            return out
        tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
        tokenizer = Tokenizer.from_file(str(tok_path))
        parent_path = parent_ckpt / MODEL_NAME if parent_ckpt.is_dir() else parent_ckpt
        disable_tf32()
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        model = WRIMUH1Model(assistant_control=True, span_control=True, stop_control=False)
        model.load_state_dict(load_safetensors_file(str(parent_path)), strict=False)
        model.to(device)
        mask_info = freeze_u_stage(model, stage=stage, lm_head=True, ctrl=ctrl_trainable)
        rows = []
        unsafe_any = False
        for pack_name, corpus_dir in mixes:
            _stream, _mask, batches = pack_rows(tokenizer, corpus_dir, max(n_batches, 3))
            probe_rows = []
            unsafe = False
            for bi in range(n_batches):
                x_np, y_np, m_np = batches[bi]
                x = torch.tensor(x_np, dtype=torch.long, device=device)
                y = torch.tensor(y_np, dtype=torch.long, device=device)
                y_mask = torch.tensor(m_np, dtype=torch.int8, device=device)
                model.zero_grad(set_to_none=True)
                freeze_u_stage(model, stage=stage, lm_head=use_head, ctrl=ctrl_trainable)
                logits = model(x)
                split = _split_loss(logits, y, y_mask, first_w=1.0)
                if not torch.isfinite(split["loss"]):
                    unsafe = True
                    probe_rows.append({"batch": bi, "nan": True})
                    break
                split["loss"].backward()
                grads = layer_grads(model)
                probe_rows.append(
                    {
                        "batch": bi,
                        "TOTAL_TRAINABLE_GRAD": grads["TOTAL_TRAINABLE_GRAD"],
                        "LM_HEAD_GRAD": grads["LM_HEAD_GRAD"],
                        "BODY_GRAD": grads["BODY_GRAD"],
                        "LAYER_17_GRAD": grads.get("LAYER_17_GRAD"),
                        "LAYER_16_GRAD": grads.get("LAYER_16_GRAD"),
                        "ENTRY_CTRL_GRAD": grads["ENTRY_CTRL_GRAD"],
                        "SPAN_CTRL_GRAD": grads["SPAN_CTRL_GRAD"],
                        "GRAD_GATE": grads["GRAD_GATE"],
                        "FIRST_TOKEN_CE": split["FIRST_TOKEN_CE"],
                        "LATER_TOKEN_CE": split["LATER_TOKEN_CE"],
                        "EOS_CE": split["EOS_CE"],
                    }
                )
                if (not np.isfinite(grads["TOTAL_TRAINABLE_GRAD"])) or grads["TOTAL_TRAINABLE_GRAD"] >= GRAD_HARD:
                    unsafe = True
                    break
            max_g = max((float(r.get("TOTAL_TRAINABLE_GRAD") or 0) for r in probe_rows), default=0.0)
            rows.append({"pack": pack_name, "unsafe": unsafe, "MAX_TOTAL_TRAINABLE_GRAD": max_g, "BATCHES": probe_rows})
            unsafe_any = unsafe_any or unsafe
            model.zero_grad(set_to_none=True)
        out.update(
            {
                "ok": not unsafe_any,
                "mask": {k: mask_info[k] for k in mask_info if k != "TRAINABLE_NAMES"},
                "TRAINABLE_NAME_COUNT": len(mask_info["TRAINABLE_NAMES"]),
                "mixes": rows,
            }
        )
        return out
    finally:
        if ollama_stopped and restore_ollama:
            start_user_ollama()
