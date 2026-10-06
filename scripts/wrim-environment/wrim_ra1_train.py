"""Train RA1 only. Frozen UH1-AC2 base. New optimizer per run."""
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
from wrim_g20m_ra1 import (
    PLACEMENT_B,
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
    MICRO_BATCH,
    SEED,
    TOKENIZER_EXPECTED_SHA,
    TOKENS_PER_STEP,
)
from wrim_plm1_gates import hard_hits
from wrim_resumable_checkpoint import MODEL_NAME, OPTIMIZER_NAME, save_resumable_checkpoint
from wrim_retention_eval import eval_retention_bundle
from wrim_u_train import dense_eval_steps


def _ra1_grads(model: torch.nn.Module) -> dict[str, float]:
    up = down = norm = frozen = 0.0
    train_sq = 0.0
    for name, p in model.named_parameters():
        if p.grad is None:
            continue
        n = float(p.grad.detach().float().norm(2).item())
        if not p.requires_grad:
            frozen += n * n
            continue
        train_sq += n * n
        if name.endswith("up.weight"):
            up = n
        elif name.endswith("down.weight"):
            down = n
        elif ".norm.weight" in name and name.startswith("ra1."):
            norm = n
    g = train_sq ** 0.5
    gate = "UNSAFE"
    if g < GRAD_REVIEW:
        gate = "SAFE"
    elif g < GRAD_HARD:
        gate = "REVIEW"
    return {
        "RA1_TOTAL_GRAD": g,
        "W_UP_GRAD": up,
        "W_DOWN_GRAD": down,
        "ADAPTER_NORM_GRAD": norm,
        "FROZEN_GRAD": frozen ** 0.5,
        "GRAD_GATE": gate,
        "TOTAL_TRAINABLE_GRAD": g,
    }


def _train_ra1_body(
    *,
    run_id: str,
    corpus_dir: Path,
    parent_ckpt: Path,
    pack_name: str = "FT60-TT40",
    steps: int = 10,
    lr: float = 3e-4,
    placement: str = PLACEMENT_B,
    bottleneck: int = 32,
    restore_ollama: bool = True,
    required_free_mib: float = 10000.0,
    reset_adapter: bool = True,
    load_optimizer: bool = False,
    eval_steps: tuple[int, ...] | None = None,
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

    auth_value = f"ON_FOR_{run_id.replace('-', '_')}_ONLY"
    os.environ[AUTHORIZE_ENV_NAME] = auth_value
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
        obj.setdefault("BASE_MODEL_CHANGED", "NO")
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
    model = WRIMRA1Model(placement=placement, bottleneck=bottleneck)
    missing, unexpected = model.load_state_dict(src_state, strict=False)
    extra = set(missing) - {n for n, _ in model.named_parameters() if n.startswith("ra1.") or n.startswith("ea1.")} - {"assistant_stop_ctrl"}
    if extra or unexpected:
        return finish({"ok": False, "reason": "state_dict_mismatch", "missing": list(missing), "unexpected": list(unexpected), "RUN_ID": run_id})
    if reset_adapter:
        model.ra1.reset_zero_init()
    elif any(k.startswith("ra1.") for k in missing):
        return finish({"ok": False, "reason": "warm_start_missing_ra1", "missing": list(missing), "RUN_ID": run_id})
    model.to(device)
    mask_info = freeze_base_train_ra1(model)
    frozen_hash0 = frozen_parameter_hash(model)
    parent_cpu = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
    frozen_parent = {k: v.detach().cpu().clone() for k, v in src_state.items()}

    probe_rows = []
    unsafe = False
    for bi in range(3):
        x_np, y_np, m_np = batches[bi]
        x = torch.tensor(x_np, dtype=torch.long, device=device)
        y = torch.tensor(y_np, dtype=torch.long, device=device)
        y_mask = torch.tensor(m_np, dtype=torch.int8, device=device)
        model.zero_grad(set_to_none=True)
        freeze_base_train_ra1(model)
        logits = model(x)
        split = _split_loss(logits, y, y_mask, first_w=1.0)
        if not torch.isfinite(split["loss"]):
            unsafe = True
            probe_rows.append({"batch": bi, "nan": True})
            break
        split["loss"].backward()
        grads = _ra1_grads(model)
        probe_rows.append({"batch": bi, **grads, "FIRST_TOKEN_CE": split["FIRST_TOKEN_CE"], "LATER_TOKEN_CE": split["LATER_TOKEN_CE"]})
        if (not np.isfinite(grads["RA1_TOTAL_GRAD"])) or grads["RA1_TOTAL_GRAD"] >= GRAD_HARD:
            unsafe = True
            break
    model.zero_grad(set_to_none=True)
    freeze_base_train_ra1(model)
    max_g = max((float(r.get("RA1_TOTAL_GRAD") or 0) for r in probe_rows), default=0.0)
    preflight = {"N_BATCHES": len(probe_rows), "MAX_RA1_GRAD": max_g, "BATCHES": probe_rows, "UNSAFE": unsafe, "LR": lr, **mask_info}
    if unsafe:
        return finish({"ok": False, "reason": "preflight_unsafe", "PREFLIGHT": preflight, "RUN_ID": run_id})

    trainable = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.AdamW(trainable, lr=lr, betas=BETAS, eps=EPS, weight_decay=AC1_CTRL_WD, fused=False)
    opt_loaded = False
    if load_optimizer:
        opt_path = (parent_ckpt if parent_ckpt.is_dir() else parent_ckpt.parent) / OPTIMIZER_NAME
        if opt_path.is_file():
            try:
                blob = torch.load(opt_path, map_location="cpu", weights_only=False)
                sd = blob["state_dict"] if isinstance(blob, dict) and "state_dict" in blob else blob
                optimizer.load_state_dict(sd)
                for pg in optimizer.param_groups:
                    pg["lr"] = lr
                opt_loaded = True
            except Exception:
                opt_loaded = False

    croot = corpus_root()
    val_docs = load_jsonl(croot / f"{CPT2_CORPUS_VERSION}-VAL.jsonl")
    val_packs = val_family_id_packs(tokenize_docs(val_docs, tokenizer))
    nl_rows = load_jsonl(Path(DATA_ROOT) / INDEPENDENT_NL_PACK / f"{INDEPENDENT_NL_PACK}-PASSAGES.jsonl")
    ft_rows = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-FIRST-TOKEN-1-v1.0.0" / "val.jsonl")
    tt_rows = load_jsonl(Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "val.jsonl")
    t3_open = Path(DATA_ROOT) / "WR-CORPUS-PLM-T3-OPEN-v1.0.0" / "val.jsonl"
    t3_align = Path(DATA_ROOT) / "WR-CORPUS-PLM-THREE-TOKEN-ALIGN-1-v1.0.0" / "val.jsonl"
    t3_legacy = Path(DATA_ROOT) / "WR-CORPUS-PLM-THREE-TOKEN-1-v1.0.0" / "val.jsonl"
    pack = str(pack_name or "")
    if "OPEN" in pack and t3_open.is_file():
        t3_path = t3_open
    elif "ALIGN" in pack and t3_align.is_file():
        t3_path = t3_align
    elif t3_align.is_file():
        t3_path = t3_align
    else:
        t3_path = t3_legacy
    t3_rows = load_jsonl(t3_path) if t3_path.is_file() else None
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
        "RA1_PLACEMENT": placement,
        "RA1_BOTTLENECK": bottleneck,
        "RA1_PARAMETER_COUNT": mask_info["RA1_PARAMETER_COUNT"],
        "RA1_LR": lr,
        "TRAINABLE_NAMES": mask_info["TRAINABLE_NAMES"],
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
        "OPTIMIZER_HYPERPARAMETERS": {"fused": False, "betas": list(BETAS), "eps": EPS, "weight_decay": AC1_CTRL_WD, "grad_clip": GRAD_CLIP, "lr": lr},
        "TRAIN_SCOPE": "RA1_ONLY",
        "PACK": pack_name,
        "PREFLIGHT": {k: preflight[k] for k in preflight if k != "BATCHES"},
        "NEW_OPTIMIZER_STATE": not opt_loaded,
        "OPTIMIZER_STATE_POLICY": "WARM_ADAM_NEW_STREAM" if opt_loaded else "RESET_PER_RUN",
        "FROZEN_PARAMETER_HASH": frozen_hash0,
    }
    _write(ckpt_root / "run-identity.json", identity)
    stream_sha = hashlib.sha256(stream.tobytes()).hexdigest()
    lr_table = {str(s): lr for s in range(0, use_steps + 2)}
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
            curriculum={"pack": pack_name, "lr": lr, "placement": placement, "bottleneck": bottleneck},
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
        freeze_base_train_ra1(model)
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
        extra = hard_hits(
            {
                "stage3_historical": bundle["stage3"].get("historical_pass_count"),
                "stage3_collapse": bundle["stage3"].get("n_collapsed"),
                "stage3_delta_nll": bundle["stage3"].get("mean_wrim0_anchor_nll_delta"),
                "grad_norm": grad,
                "nan": False,
            }
        )
        for h in extra:
            if h not in hits:
                hits.append(h)
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
                "three_exact": bundle.get("GREEDY_THREE_TOKEN_EXACT"),
                "n_classes_three": bundle.get("N_CLASSES_GREEDY_THREE_TOKEN"),
                "token3_ce": bundle.get("TOKEN3_CE"),
                "token3_rank": bundle.get("TOKEN3_RANK"),
                "token3_oracle": bundle.get("TOKEN3_GIVEN_GOLD_PREFIX"),
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
    if abort is None:
        for step in range(1, use_steps + 1):
            if tokens_seen + TOKENS_PER_STEP > max_tokens:
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "token_cap", "step": step}
                break
            x_np, y_np, m_np = batches[step - 1]
            x = torch.tensor(x_np, dtype=torch.long, device=device)
            y = torch.tensor(y_np, dtype=torch.long, device=device)
            y_mask = torch.tensor(m_np, dtype=torch.int8, device=device)
            for pg in optimizer.param_groups:
                pg["lr"] = lr
            optimizer.zero_grad(set_to_none=True)
            logits = model(x)
            split = _split_loss(logits, y, y_mask, first_w=1.0)
            loss = split["loss"]
            if not torch.isfinite(loss):
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "NAN_INF", "step": step}
                break
            loss.backward()
            grads = _ra1_grads(model)
            raw = grads["RA1_TOTAL_GRAD"]
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
                "lr": lr,
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
    dN = dist_by_step.get(str(final_step)) or dist_now()
    report = {
        "ok": complete,
        "kind": f"{run_id}_REPORT",
        "RUN_ID": run_id,
        "PACK": pack_name,
        "ARCHITECTURE_ID": model.architecture_id,
        "RA1_PLACEMENT": placement,
        "RA1_BOTTLENECK": bottleneck,
        "RA1_PARAMETER_COUNT": mask_info["RA1_PARAMETER_COUNT"],
        "RA1_LR": lr,
        "STEPS": use_steps if complete else final_step,
        "TOKENS_USED": tokens_seen,
        "PREFLIGHT": preflight,
        "STAGE3_HISTORICAL": {"parent": s0.get("historical_pass_count"), "final": sN.get("historical_pass_count"), "best": bN.get("stage3")},
        "STAGE3_COLLAPSE": {"parent": s0.get("n_collapsed"), "final": sN.get("n_collapsed"), "best": bN.get("collapse")},
        "STAGE3_DRIFT_VS_STEP400": bN.get("drift", sN.get("STAGE3_DRIFT_VS_STEP400")),
        "TOKEN2_CE": {"parent": p0.get("TOKEN2_CE"), "final": pN.get("TOKEN2_CE"), "best": bN.get("token2_ce")},
        "TOKEN2_RANK": {"parent": p0.get("TOKEN2_RANK"), "final": pN.get("TOKEN2_RANK"), "best": bN.get("token2_rank")},
        "TOKEN2_ORACLE": {"parent": p0.get("TOKEN2_GIVEN_GOLD_TOKEN1_CORRECT"), "final": pN.get("TOKEN2_GIVEN_GOLD_TOKEN1_CORRECT"), "best": bN.get("oracle")},
        "GREEDY_TWO_TOKEN_EXACT": {"parent": p0.get("GREEDY_TWO_TOKEN_EXACT"), "final": pN.get("GREEDY_TWO_TOKEN_EXACT"), "best": bN.get("exact")},
        "GREEDY_THREE_TOKEN_EXACT": {"parent": None, "final": bN.get("three_exact"), "best": bN.get("three_exact")},
        "N_CLASSES_GREEDY_THREE_TOKEN": bN.get("n_classes_three"),
        "TOKEN3_CE": bN.get("token3_ce"),
        "TOKEN3_RANK": bN.get("token3_rank"),
        "FIRST_TOKEN_CLASSES_WORKING": bN.get("first_token_classes"),
        "GREEDY_FIRST_TOKEN_MATCH": bN.get("greedy_first_ft"),
        "GREEDY_SHORT_ANSWER_CORRECT": bN.get("greedy_short"),
        "GREEDY_STOPPING": bN.get("greedy_stopping"),
        "RAMBLE_RATE": bN.get("ramble"),
        "EMPTY_RESPONSE_RATE": bN.get("empty"),
        "NEWLINE_ARGMAX_RATE": bN.get("newline"),
        "INDEPENDENT_NL_NLL": bN.get("independent_nl"),
        "GENERAL_NL_NLL": bN.get("general_nl"),
        "CODE_NLL": bN.get("code"),
        "JSON_NLL": bN.get("json"),
        "DISTANCE_FINAL": dN,
        "EVAL_SNAPS": eval_snaps,
        "METRICS": metrics,
        "PEAK_VRAM_BYTES": peak_vram,
        "WALL_SECONDS": train_s,
        "BEST_EXPERIMENTAL_CHECKPOINT": f"{run_id}/step-{best_step}",
        "BEST_EXPERIMENTAL_HASH": best_hash,
        "FROZEN_PARAMETER_HASH_MATCH": dN.get("FROZEN_PARAMETER_HASH_MATCH"),
        "GLOBAL_WEIGHT_DRIFT": dN.get("GLOBAL_WEIGHT_DRIFT"),
        "RA1_WEIGHT_DISTANCE": dN.get("RA1_WEIGHT_DISTANCE"),
        "BASE_MODEL_CHANGED": "NO" if dN.get("FROZEN_PARAMETER_HASH_MATCH") == "YES" else "YES",
        "abort": abort,
        "timestamp": t0,
        "finished": datetime.now(timezone.utc).isoformat(),
        "TRAINING_AUTHORIZATION": "OFF",
        "MICRO_BATCH": MICRO_BATCH,
    }
    if abort:
        report["ok"] = False
        report["HARD_STOP_TRIGGERED"] = True
    report["OPTIMIZER_CONSTRUCTED"] = "YES"
    report["OPTIMIZER_STEPS"] = int(tokens_seen // TOKENS_PER_STEP)
    return finish(report)


def train_ra1(
    *,
    run_id: str,
    corpus_dir: Path,
    parent_ckpt: Path,
    pack_name: str = "FT60-TT40",
    steps: int = 10,
    lr: float = 3e-4,
    placement: str = PLACEMENT_B,
    bottleneck: int = 32,
    restore_ollama: bool = True,
    required_free_mib: float = 10000.0,
    reset_adapter: bool = True,
    load_optimizer: bool = False,
    eval_steps: tuple[int, ...] | None = None,
    authorization_id: str = "WRIM_RA1_TRAIN",
) -> dict[str, Any]:
    """Acquire the single-trainer lock before any optimizer exists."""
    from wrim_single_trainer_lock import acquire_trainer_lock, release_trainer_lock

    budget = int(steps) * int(TOKENS_PER_STEP)
    lock = acquire_trainer_lock(
        run_id=run_id,
        authorization_id=authorization_id,
        checkpoint_parent=str(parent_ckpt),
        token_budget=budget,
    )
    if not lock.get("ok"):
        return {
            "ok": False,
            "reason": "WRIM_TRAINER_ALREADY_ACTIVE",
            "RUN_ID": run_id,
            "TOKENS_USED": 0,
            "OPTIMIZER_STEPS": 0,
            "OPTIMIZER_CONSTRUCTED": "NO",
            "TRAINING_AUTHORIZATION_FINAL": "OFF",
            "MODEL_PROMOTED": "NO",
            "CANONICAL_CHANGED": "NO",
            "LOCK": lock.get("LOCK"),
            "ACTIVE_TRAINERS": lock.get("ACTIVE_TRAINERS"),
        }
    try:
        return _train_ra1_body(
            run_id=run_id,
            corpus_dir=corpus_dir,
            parent_ckpt=parent_ckpt,
            pack_name=pack_name,
            steps=steps,
            lr=lr,
            placement=placement,
            bottleneck=bottleneck,
            restore_ollama=restore_ollama,
            required_free_mib=required_free_mib,
            reset_adapter=reset_adapter,
            load_optimizer=load_optimizer,
            eval_steps=eval_steps,
        )
    finally:
        release_trainer_lock(run_id)
