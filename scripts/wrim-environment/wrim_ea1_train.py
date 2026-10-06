"""EA1 / EA1+RA1 trainer. Base frozen. Single-trainer lock required."""
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
from wrim_arch_uh1_phase_a import _split_loss, load_jsonl
from wrim_g20m_ra1 import (
    EA1_PREFIX,
    PLACEMENT_B,
    RA1_PREFIX,
    WRIMRA1Model,
    freeze_base_train_ra1,
    frozen_parameter_hash,
    global_weight_l2,
    ra1_l2,
)
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
    GRAD_REVIEW,
    SEED,
    TOKENIZER_EXPECTED_SHA,
    TOKENS_PER_STEP,
)
from wrim_plm1_gates import hard_hits
from wrim_resumable_checkpoint import MODEL_NAME, OPTIMIZER_NAME, save_resumable_checkpoint
from wrim_retention_eval import eval_retention_bundle
from wrim_single_trainer_lock import acquire_trainer_lock, release_trainer_lock
from wrim_u_train import dense_eval_steps


def _adapter_grads(model: torch.nn.Module) -> dict[str, float]:
    ea1 = 0.0
    ra1 = 0.0
    frozen = 0.0
    for name, p in model.named_parameters():
        if p.grad is None:
            continue
        n = float(p.grad.detach().float().norm(2).item())
        if name.startswith(EA1_PREFIX):
            ea1 += n * n
        elif name.startswith(RA1_PREFIX):
            ra1 += n * n
        elif not p.requires_grad:
            frozen += n * n
    ea1_n = ea1 ** 0.5
    ra1_n = ra1 ** 0.5
    total = (ea1 + ra1) ** 0.5
    gate = "UNSAFE"
    if total < GRAD_REVIEW:
        gate = "SAFE"
    elif total < GRAD_HARD:
        gate = "REVIEW"
    return {
        "EA1_TOTAL_GRAD": ea1_n,
        "RA1_TOTAL_GRAD": ra1_n,
        "COMBINED_GRAD": total,
        "FROZEN_GRAD": frozen ** 0.5,
        "GRAD_GATE": gate,
        "TOTAL_TRAINABLE_GRAD": total,
    }


def _train_body(
    *,
    run_id: str,
    corpus_dir: Path,
    parent_ckpt: Path,
    pack_name: str,
    steps: int,
    ea1_lr: float,
    ra1_lr: float,
    train_ea1: bool,
    train_ra1: bool,
    restore_ollama: bool,
    load_optimizer: bool,
    eval_steps: tuple[int, ...] | None,
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

    os.environ[AUTHORIZE_ENV_NAME] = f"ON_FOR_{run_id.replace('-', '_')}_ONLY"
    t0 = datetime.now(timezone.utc).isoformat()
    ckpt_root = Path(CKPT_BASE) / run_id
    report_path = Path(DATA_ROOT) / f"{run_id}_REPORT.json"
    ollama_stopped = False
    max_tokens = min(steps * TOKENS_PER_STEP, 204_800)
    use_steps = max(1, min(steps, max_tokens // TOKENS_PER_STEP))

    def finish(obj: dict[str, Any]) -> dict[str, Any]:
        obj.setdefault("TRAINING_AUTHORIZATION_FINAL", "OFF")
        obj.setdefault("MODEL_PROMOTED", "NO")
        obj.setdefault("CANONICAL_CHANGED", "NO")
        obj.setdefault("TOKENIZER_CHANGED", "NO")
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
    vram = ensure_vram_for_training(required_free_mib=10000.0)
    ollama_stopped = bool(vram.get("OLLAMA_STOPPED_FOR_TRAINING"))
    if not env.get("ok"):
        return finish({"ok": False, "reason": "env_fail", "env": env, "RUN_ID": run_id})
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    if sha256_file(tok_path) != TOKENIZER_EXPECTED_SHA:
        return finish({"ok": False, "reason": "tokenizer_hash_mismatch", "RUN_ID": run_id})
    tokenizer = Tokenizer.from_file(str(tok_path))
    step400 = Path(LINUX_CKPT_ROOT) / PROVISIONAL_STAGE_B_PARENT_CHECKPOINT / MODEL_NAME
    if sha256_file(step400) != CANONICAL_HASH:
        return finish({"ok": False, "reason": "canonical_hash_changed", "RUN_ID": run_id})
    if sha256_file(Path(EXPERIMENTAL_PARENT_CKPT) / MODEL_NAME) != EXPECTED_PARENT_MODEL_HASH:
        return finish({"ok": False, "reason": "foundation_parent_hash_mismatch", "RUN_ID": run_id})
    parent_path = parent_ckpt / MODEL_NAME if parent_ckpt.is_dir() else parent_ckpt
    if not parent_path.is_file():
        return finish({"ok": False, "reason": "parent_missing", "RUN_ID": run_id})
    if ckpt_root.is_dir() and (ckpt_root / f"step-{use_steps}" / "resume-manifest.json").is_file():
        return finish({"ok": False, "reason": "second_execution_forbidden", "RUN_ID": run_id})

    stream, mask, batches = pack_rows(tokenizer, corpus_dir, max(use_steps, 3))
    val_rows = load_jsonl(corpus_dir / "val.jsonl")
    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)

    src_state = load_safetensors_file(str(parent_path))
    model = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32, ea1=True)
    missing, unexpected = model.load_state_dict(src_state, strict=False)
    extra = set(missing) - {n for n, _ in model.named_parameters() if n.startswith(EA1_PREFIX) or n.startswith(RA1_PREFIX)} - {"assistant_stop_ctrl"}
    if extra or unexpected:
        return finish({"ok": False, "reason": "state_dict_mismatch", "missing": list(missing), "unexpected": list(unexpected), "RUN_ID": run_id})
    if any(k.startswith("ra1.") for k in missing):
        return finish({"ok": False, "reason": "warm_start_missing_ra1", "missing": list(missing), "RUN_ID": run_id})
    if model.ea1 is None:
        return finish({"ok": False, "reason": "ea1_missing", "RUN_ID": run_id})
    if any(k.startswith("ea1.") for k in missing):
        model.ea1.reset_zero_init()
    model.to(device)
    mask_info = freeze_base_train_ra1(model, train_ea1=train_ea1, train_ra1=train_ra1)
    frozen_hash0 = frozen_parameter_hash(model)
    parent_cpu = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
    frozen_parent = {k: v.detach().cpu().clone() for k, v in src_state.items() if not k.startswith(EA1_PREFIX) and not k.startswith(RA1_PREFIX)}
    for k, v in model.state_dict().items():
        if not k.startswith(EA1_PREFIX) and not k.startswith(RA1_PREFIX):
            frozen_parent[k] = v.detach().cpu().clone()

    probe_rows = []
    unsafe = False
    for bi in range(3):
        x_np, y_np, m_np = batches[bi]
        x = torch.tensor(x_np, dtype=torch.long, device=device)
        y = torch.tensor(y_np, dtype=torch.long, device=device)
        y_mask = torch.tensor(m_np, dtype=torch.int8, device=device)
        model.zero_grad(set_to_none=True)
        freeze_base_train_ra1(model, train_ea1=train_ea1, train_ra1=train_ra1)
        logits = model(x)
        split = _split_loss(logits, y, y_mask, first_w=1.0)
        if not torch.isfinite(split["loss"]):
            unsafe = True
            probe_rows.append({"batch": bi, "nan": True})
            break
        split["loss"].backward()
        grads = _adapter_grads(model)
        probe_rows.append({"batch": bi, **grads, "FIRST_TOKEN_CE": split["FIRST_TOKEN_CE"], "LATER_TOKEN_CE": split["LATER_TOKEN_CE"]})
        if (not np.isfinite(grads["COMBINED_GRAD"])) or grads["COMBINED_GRAD"] >= GRAD_HARD:
            unsafe = True
            break
    model.zero_grad(set_to_none=True)
    freeze_base_train_ra1(model, train_ea1=train_ea1, train_ra1=train_ra1)
    max_g = max((float(r.get("COMBINED_GRAD") or 0) for r in probe_rows), default=0.0)
    preflight = {"N_BATCHES": len(probe_rows), "MAX_COMBINED_GRAD": max_g, "BATCHES": probe_rows, "UNSAFE": unsafe, "EA1_LR": ea1_lr, "RA1_LR": ra1_lr, **mask_info}
    if unsafe:
        return finish({"ok": False, "reason": "preflight_unsafe", "PREFLIGHT": preflight, "RUN_ID": run_id, "OPTIMIZER_CONSTRUCTED": "NO", "TOKENS_USED": 0, "OPTIMIZER_STEPS": 0})

    groups = []
    ea1_params = [p for n, p in model.named_parameters() if n.startswith(EA1_PREFIX) and p.requires_grad]
    ra1_params = [p for n, p in model.named_parameters() if n.startswith(RA1_PREFIX) and p.requires_grad]
    if ea1_params:
        groups.append({"params": ea1_params, "lr": ea1_lr})
    if ra1_params:
        groups.append({"params": ra1_params, "lr": ra1_lr})
    if not groups:
        return finish({"ok": False, "reason": "no_trainable_params", "RUN_ID": run_id})
    optimizer = torch.optim.AdamW(groups, betas=BETAS, eps=EPS, weight_decay=AC1_CTRL_WD, fused=False)
    opt_loaded = False
    if load_optimizer:
        opt_path = (parent_ckpt if parent_ckpt.is_dir() else parent_ckpt.parent) / OPTIMIZER_NAME
        if opt_path.is_file():
            try:
                blob = torch.load(opt_path, map_location="cpu", weights_only=False)
                sd = blob["state_dict"] if isinstance(blob, dict) and "state_dict" in blob else blob
                optimizer.load_state_dict(sd)
                for pg in optimizer.param_groups:
                    names = {id(p) for p in pg["params"]}
                    if ea1_params and id(ea1_params[0]) in names:
                        pg["lr"] = ea1_lr
                    if ra1_params and id(ra1_params[0]) in names:
                        pg["lr"] = ra1_lr
                opt_loaded = True
            except Exception:
                opt_loaded = False

    croot = corpus_root()
    val_docs = load_jsonl(croot / f"{CPT2_CORPUS_VERSION}-VAL.jsonl")
    val_packs = val_family_id_packs(tokenize_docs(val_docs, tokenizer))
    nl_rows = load_jsonl(Path(DATA_ROOT) / INDEPENDENT_NL_PACK / f"{INDEPENDENT_NL_PACK}-PASSAGES.jsonl")
    ft_rows = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-FIRST-TOKEN-1-v1.0.0" / "val.jsonl")
    tt_rows = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "val.jsonl")
    t3_align = Path(DATA_ROOT) / "WR-CORPUS-PLM-THREE-TOKEN-ALIGN-1-v1.0.0" / "val.jsonl"
    t3_rows = load_jsonl(t3_align) if t3_align.is_file() else None
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
        "ARCHITECTURE_ID": model.architecture_id,
        "EA1_BOTTLENECK": 32,
        "RA1_BOTTLENECK": 32,
        "EA1_LR": ea1_lr,
        "RA1_LR": ra1_lr,
        "TRAIN_EA1": train_ea1,
        "TRAIN_RA1": train_ra1,
        "TRAINABLE_NAMES": mask_info["TRAINABLE_NAMES"],
        "TOKENIZER_HASH": sha256_file(tok_path),
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
            "ea1_lr": ea1_lr,
            "ra1_lr": ra1_lr,
        },
        "LR_SCHEDULE_ID": "constant_per_adapter_group",
        "TRAIN_SCOPE": "EA1_ONLY" if train_ea1 and not train_ra1 else "EA1_RA1",
        "PACK": pack_name,
        "NEW_OPTIMIZER_STATE": not opt_loaded,
        "FROZEN_PARAMETER_HASH": frozen_hash0,
    }
    _write(ckpt_root / "run-identity.json", identity)
    stream_sha = hashlib.sha256(stream.tobytes()).hexdigest()
    lr_table = {str(s): ra1_lr for s in range(0, use_steps + 2)}
    metrics: list[dict[str, Any]] = []
    stage3_by_step: dict[str, Any] = {}
    prefix_by_step: dict[str, Any] = {}
    dist_by_step: dict[str, Any] = {}
    eval_snaps: list[dict[str, Any]] = []
    abort = None
    tokens_seen = 0
    t_train0 = time.perf_counter()
    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()

    def dist_now() -> dict[str, Any]:
        h = frozen_parameter_hash(model)
        return {
            "RA1_WEIGHT_DISTANCE": ra1_l2(model, parent_cpu),
            "GLOBAL_WEIGHT_DRIFT": global_weight_l2(model, frozen_parent),
            "FROZEN_PARAMETER_HASH": h,
            "FROZEN_PARAMETER_HASH_MATCH": "YES" if h == frozen_hash0 else "NO",
        }

    def persist(step: int, tokens: int) -> None:
        save_resumable_checkpoint(
            run_root=ckpt_root,
            step=step,
            model=model,
            optimizer=optimizer,
            tokens_processed=tokens,
            next_token_offset=tokens,
            stream_prefix_sha256=stream_sha,
            curriculum={"pack": pack_name, "ea1_lr": ea1_lr, "ra1_lr": ra1_lr, "train_ea1": train_ea1, "train_ra1": train_ra1},
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
            t3_rows=t3_rows,
            step=step,
            name=run_id,
        )
        freeze_base_train_ra1(model, train_ea1=train_ea1, train_ra1=train_ra1)
        dist = dist_now()
        if dist["FROZEN_PARAMETER_HASH_MATCH"] != "YES" or dist["GLOBAL_WEIGHT_DRIFT"] > 1e-8:
            bundle.setdefault("hard_gate_hits", [])
            if isinstance(bundle["hard_gate_hits"], list):
                bundle["hard_gate_hits"] = list(bundle["hard_gate_hits"]) + ["FROZEN_BASE_CHANGED"]
        _write(evals_dir / f"role-geo-step-{step}.json", {"val": bundle["geo_mix"], "ft": bundle["geo_ft"]})
        _write(evals_dir / f"prefix-tt-step-{step}.json", bundle["prefix_tt"])
        if bundle.get("prefix_t3"):
            _write(evals_dir / f"prefix-t3-step-{step}.json", bundle["prefix_t3"])
        _write(evals_dir / f"prefix-step-{step}.json", bundle["prefix_mix"])
        _write(evals_dir / f"foundation-step-{step}.json", bundle["foundation"])
        _write(evals_dir / f"val-nll-step-{step}.json", bundle["nlls"])
        _write(evals_dir / f"independent-nl-step-{step}.json", bundle["independent_nl"])
        _write(evals_dir / f"stage3-step-{step}.json", bundle["stage3"])
        _write(evals_dir / f"distance-step-{step}.json", dist)
        stage3_by_step[str(step)] = bundle["stage3"]
        prefix_by_step[str(step)] = bundle["prefix_tt"]
        dist_by_step[str(step)] = dist
        hits = list(bundle.get("hard_gate_hits") or [])
        extra_hits = hard_hits(
            {
                "stage3_historical": bundle["stage3"].get("historical_pass_count"),
                "stage3_collapse": bundle["stage3"].get("n_collapsed"),
                "stage3_delta_nll": bundle["stage3"].get("mean_wrim0_anchor_nll_delta"),
                "grad_norm": grad,
                "nan": False,
            }
        )
        for h in extra_hits:
            if h not in hits:
                hits.append(h)
        eval_snaps.append(
            {
                "step": step,
                "stage3": bundle["stage3"].get("historical_pass_count"),
                "collapse": bundle["stage3"].get("n_collapsed"),
                "drift": bundle["stage3"].get("STAGE3_DRIFT_VS_STEP400"),
                "exact": bundle["prefix_tt"].get("GREEDY_TWO_TOKEN_EXACT"),
                "n_classes_exact": bundle["prefix_tt"].get("N_CLASSES_GREEDY_TWO_TOKEN"),
                "three_exact": bundle.get("GREEDY_THREE_TOKEN_EXACT"),
                "greedy_first_ft": bundle.get("GREEDY_FIRST_TOKEN_MATCH_FT"),
                "first_token_classes": bundle.get("FIRST_TOKEN_CLASSES_WORKING"),
                "greedy_stopping": bundle.get("GREEDY_STOPPING"),
                "ramble": bundle.get("RAMBLE_RATE"),
                "empty": bundle.get("EMPTY_RESPONSE_RATE"),
                "independent_nl": bundle.get("INDEPENDENT_NL_NLL"),
                "general_nl": bundle.get("GENERAL_NL_NLL"),
                "code": bundle.get("CODE_NLL"),
                "json": bundle.get("JSON_NLL"),
                "newline": bundle.get("NEWLINE_ARGMAX_RATE"),
                "distance": dist,
                "hard_gate_hits": hits,
            }
        )
        return {**bundle, "distance": dist, "hard_gate_hits": hits}

    ev0 = run_eval(0, None, 0, None)
    persist(0, 0)
    if ev0.get("hard_gate_hits"):
        abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": ",".join(ev0["hard_gate_hits"]), "step": 0}
    if eval_steps is None:
        eval_at = dense_eval_steps(use_steps)
    else:
        eval_at = tuple(sorted({int(s) for s in eval_steps if 1 <= int(s) <= use_steps}))
    trainable = [p for p in model.parameters() if p.requires_grad]
    if abort is None:
        for step in range(1, use_steps + 1):
            if tokens_seen + TOKENS_PER_STEP > max_tokens:
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "token_cap", "step": step}
                break
            x_np, y_np, m_np = batches[step - 1]
            x = torch.tensor(x_np, dtype=torch.long, device=device)
            y = torch.tensor(y_np, dtype=torch.long, device=device)
            y_mask = torch.tensor(m_np, dtype=torch.int8, device=device)
            optimizer.zero_grad(set_to_none=True)
            logits = model(x)
            split = _split_loss(logits, y, y_mask, first_w=1.0)
            loss = split["loss"]
            if not torch.isfinite(loss):
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "NAN_INF", "step": step}
                break
            loss.backward()
            grads = _adapter_grads(model)
            raw = grads["COMBINED_GRAD"]
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
                **grads,
                "tokens_seen": tokens_seen,
                "ea1_lr": ea1_lr,
                "ra1_lr": ra1_lr,
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
    final_step = max([int(k) for k in stage3_by_step], default=0)
    complete = abort is None and final_step >= use_steps
    dN = dist_by_step.get(str(final_step)) or dist_now()
    report = {
        "ok": complete,
        "kind": f"{run_id}_REPORT",
        "RUN_ID": run_id,
        "PACK": pack_name,
        "ARCHITECTURE_ID": model.architecture_id,
        "EA1_LR": ea1_lr,
        "RA1_LR": ra1_lr,
        "TRAIN_EA1": train_ea1,
        "TRAIN_RA1": train_ra1,
        "STEPS": use_steps if complete else final_step,
        "TOKENS_USED": tokens_seen,
        "OPTIMIZER_STEPS": int(tokens_seen // TOKENS_PER_STEP),
        "OPTIMIZER_CONSTRUCTED": "YES",
        "PREFLIGHT": {k: preflight[k] for k in preflight if k != "BATCHES"},
        "EVAL_SNAPS": eval_snaps,
        "METRICS": metrics,
        "WALL_SECONDS": train_s,
        "FROZEN_PARAMETER_HASH_MATCH": dN.get("FROZEN_PARAMETER_HASH_MATCH"),
        "GLOBAL_WEIGHT_DRIFT": dN.get("GLOBAL_WEIGHT_DRIFT"),
        "abort": abort,
        "timestamp": t0,
        "finished": datetime.now(timezone.utc).isoformat(),
        "TRAINING_AUTHORIZATION": "OFF",
    }
    if abort:
        report["ok"] = False
        report["HARD_STOP_TRIGGERED"] = True
    return finish(report)


def train_ea1(
    *,
    run_id: str,
    corpus_dir: Path,
    parent_ckpt: Path,
    pack_name: str,
    steps: int,
    ea1_lr: float = 3e-4,
    ra1_lr: float = 3e-4,
    train_ea1: bool = True,
    train_ra1: bool = False,
    restore_ollama: bool = True,
    load_optimizer: bool = False,
    eval_steps: tuple[int, ...] | None = None,
    authorization_id: str = "WRIM_EA1_TRAIN",
) -> dict[str, Any]:
    if ea1_lr > 1e-3 + 1e-12:
        return {"ok": False, "reason": "ea1_lr_unauthorized", "OPTIMIZER_STEPS": 0, "TOKENS_USED": 0, "OPTIMIZER_CONSTRUCTED": "NO"}
    lock = acquire_trainer_lock(
        run_id=run_id,
        authorization_id=authorization_id,
        checkpoint_parent=str(parent_ckpt),
        token_budget=int(steps) * int(TOKENS_PER_STEP),
    )
    if not lock.get("ok"):
        return {
            "ok": False,
            "reason": "WRIM_TRAINER_ALREADY_ACTIVE",
            "RUN_ID": run_id,
            "TOKENS_USED": 0,
            "OPTIMIZER_STEPS": 0,
            "OPTIMIZER_CONSTRUCTED": "NO",
            "LOCK": lock.get("LOCK"),
            "ACTIVE_TRAINERS": lock.get("ACTIVE_TRAINERS"),
        }
    try:
        return _train_body(
            run_id=run_id,
            corpus_dir=corpus_dir,
            parent_ckpt=parent_ckpt,
            pack_name=pack_name,
            steps=steps,
            ea1_lr=ea1_lr,
            ra1_lr=ra1_lr,
            train_ea1=train_ea1,
            train_ra1=train_ra1,
            restore_ollama=restore_ollama,
            load_optimizer=load_optimizer,
            eval_steps=eval_steps,
        )
    finally:
        release_trainer_lock(run_id)
