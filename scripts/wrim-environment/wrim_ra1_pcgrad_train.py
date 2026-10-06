"""RA1-only grouped-task trainer: standard sum, PCGrad, or orthogonal projection.

EA1 frozen. Body/lm_head/tok_emb frozen. New optimizer from parent. No promotion.
"""
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
from wrim_arch_uh1_phase_a import load_jsonl
from wrim_ea1_train import _adapter_grads
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
from wrim_ra1_conflict_lib import (
    GROUP_ORDER,
    PROTECTED_ORDER,
    TOKENS_PER_GROUP_SEQ,
    assign_ra1_grad,
    capture_all_tasks,
    combine_sum,
    conflict_pairs,
    load_group_rows,
    ortho_against_sum,
    pack_group_batches,
    pcgrad_project,
)
from wrim_resumable_checkpoint import MODEL_NAME, save_resumable_checkpoint
from wrim_retention_eval import eval_retention_bundle
from wrim_single_trainer_lock import acquire_trainer_lock, release_trainer_lock
from wrim_u_train import dense_eval_steps

MECHANISMS = ("sum", "pcgrad", "ortho")
RA1_LR_CAP = 3e-4


def _train_body(
    *,
    run_id: str,
    corpus_dir: Path,
    parent_ckpt: Path,
    pack_name: str,
    steps: int,
    ra1_lr: float,
    mechanism: str,
    restore_ollama: bool,
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

    if mechanism not in MECHANISMS:
        return {"ok": False, "reason": "unknown_mechanism", "OPTIMIZER_CONSTRUCTED": "NO", "TOKENS_USED": 0, "OPTIMIZER_STEPS": 0, "RUN_ID": run_id}
    if ra1_lr > RA1_LR_CAP + 1e-12:
        return {"ok": False, "reason": "ra1_lr_unauthorized", "OPTIMIZER_CONSTRUCTED": "NO", "TOKENS_USED": 0, "OPTIMIZER_STEPS": 0, "RUN_ID": run_id}

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

    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)

    groups = load_group_rows(corpus_dir)
    packed = pack_group_batches(tokenizer, groups, max(use_steps, 3))
    val_rows = load_jsonl(corpus_dir / "val.jsonl")

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
    model.to(device)
    mask_info = freeze_base_train_ra1(model, train_ea1=False, train_ra1=True)
    if any(n.startswith(EA1_PREFIX) for n in mask_info["TRAINABLE_NAMES"]):
        return finish({"ok": False, "reason": "ea1_not_frozen", "RUN_ID": run_id})
    frozen_hash0 = frozen_parameter_hash(model)
    parent_cpu = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
    frozen_parent = {k: v.detach().cpu().clone() for k, v in src_state.items() if not k.startswith(EA1_PREFIX) and not k.startswith(RA1_PREFIX)}
    for k, v in model.state_dict().items():
        if not k.startswith(EA1_PREFIX) and not k.startswith(RA1_PREFIX):
            frozen_parent[k] = v.detach().cpu().clone()

    probe_rows = []
    unsafe = False
    for bi in range(3):
        cap = capture_all_tasks(model, device, packed, bi)
        g_nat = cap["grads"]["natural"]
        prot = {k: cap["grads"][k] for k in PROTECTED_ORDER}
        if mechanism == "pcgrad":
            g_nat_p, events = pcgrad_project(g_nat, prot, list(PROTECTED_ORDER))
            g_final = combine_sum(g_nat_p, prot)
        elif mechanism == "ortho":
            g_nat_p, events_o = ortho_against_sum(g_nat, prot)
            g_final = combine_sum(g_nat_p, prot)
            events = [events_o] if events_o.get("applied") else []
        else:
            g_final = combine_sum(g_nat, prot)
            events = []
        raw = float(g_final.norm().item())
        effective = raw / float(len(GROUP_ORDER))
        task_norms = {k: float(v.norm().item()) for k, v in cap["grads"].items()}
        pairs = conflict_pairs(cap["grads"])
        probe_rows.append({
            "batch": bi,
            "raw_sum_grad": raw,
            "effective_mixed_grad": effective,
            "task_norms": task_norms,
            "conflicts": [p["TASK_PAIR"] for p in pairs if p["CONFLICT"] == "YES"],
            "n_proj": len(events),
        })
        if (not np.isfinite(raw)) or (not np.isfinite(effective)) or effective >= GRAD_HARD:
            unsafe = True
            break
        if any(not np.isfinite(v) for v in task_norms.values()):
            unsafe = True
            break
    model.zero_grad(set_to_none=True)
    freeze_base_train_ra1(model, train_ea1=False, train_ra1=True)
    max_g = max((float(r.get("effective_mixed_grad") or 0) for r in probe_rows), default=0.0)
    preflight = {
        "N_BATCHES": len(probe_rows),
        "MAX_COMBINED_GRAD": max_g,
        "MAX_RAW_SUM_GRAD": max((float(r.get("raw_sum_grad") or 0) for r in probe_rows), default=0.0),
        "SAFETY_NORM": "mean_equivalent_of_equal_task_sum",
        "BATCHES": probe_rows,
        "UNSAFE": unsafe,
        "RA1_LR": ra1_lr,
        "MECHANISM": mechanism,
        **mask_info,
    }
    if unsafe:
        return finish({"ok": False, "reason": "preflight_unsafe", "PREFLIGHT": preflight, "RUN_ID": run_id, "OPTIMIZER_CONSTRUCTED": "NO", "TOKENS_USED": 0, "OPTIMIZER_STEPS": 0})

    ra1_params = [p for n, p in model.named_parameters() if n.startswith(RA1_PREFIX) and p.requires_grad]
    if not ra1_params:
        return finish({"ok": False, "reason": "no_trainable_params", "RUN_ID": run_id})
    optimizer = torch.optim.AdamW([{"params": ra1_params, "lr": ra1_lr}], betas=BETAS, eps=EPS, weight_decay=AC1_CTRL_WD, fused=False)

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
        "EA1_LR": 0.0,
        "RA1_LR": ra1_lr,
        "TRAIN_EA1": False,
        "TRAIN_RA1": True,
        "MECHANISM": mechanism,
        "PROJECTION_ORDER": list(PROTECTED_ORDER),
        "GROUP_ORDER": list(GROUP_ORDER),
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
            "ea1_lr": 0.0,
            "ra1_lr": ra1_lr,
            "mechanism": mechanism,
        },
        "LR_SCHEDULE_ID": "constant_ra1_only",
        "TRAIN_SCOPE": "RA1_ONLY",
        "PACK": pack_name,
        "NEW_OPTIMIZER_STATE": True,
        "FROZEN_PARAMETER_HASH": frozen_hash0,
    }
    _write(ckpt_root / "run-identity.json", identity)
    stream_sha = hashlib.sha256()
    for name in GROUP_ORDER:
        x0, _, _ = packed[name][0]
        stream_sha.update(np.ascontiguousarray(x0).tobytes())
    stream_hex = stream_sha.hexdigest()
    lr_table = {str(s): ra1_lr for s in range(0, use_steps + 2)}
    metrics: list[dict[str, Any]] = []
    stage3_by_step: dict[str, Any] = {}
    prefix_by_step: dict[str, Any] = {}
    dist_by_step: dict[str, Any] = {}
    eval_snaps: list[dict[str, Any]] = []
    abort = None
    tokens_seen = 0
    nat_tokens = 0
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
        final = ckpt_root / f"step-{step}"
        if (final / "resume-manifest.json").is_file():
            return
        save_resumable_checkpoint(
            run_root=ckpt_root,
            step=step,
            model=model,
            optimizer=optimizer,
            tokens_processed=tokens,
            next_token_offset=tokens,
            stream_prefix_sha256=stream_hex,
            curriculum={"pack": pack_name, "ra1_lr": ra1_lr, "train_ea1": False, "train_ra1": True, "mechanism": mechanism},
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
        freeze_base_train_ra1(model, train_ea1=False, train_ra1=True)
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
            cap = capture_all_tasks(model, device, packed, step - 1)
            g_nat = cap["grads"]["natural"]
            prot = {k: cap["grads"][k] for k in PROTECTED_ORDER}
            pairs = conflict_pairs(cap["grads"])
            n_conflict = sum(1 for p in pairs if p["CONFLICT"] == "YES")
            g_sum = combine_sum(g_nat, prot)
            raw_sum = float(g_sum.norm().item())
            task_norms = {k: float(v.norm().item()) for k, v in cap["grads"].items()}
            order = list(PROTECTED_ORDER)
            proj_events: list[dict[str, Any]] = []
            if mechanism == "pcgrad":
                g_nat_p, proj_events = pcgrad_project(g_nat, prot, order)
                g_final = combine_sum(g_nat_p, prot)
            elif mechanism == "ortho":
                g_nat_p, evp = ortho_against_sum(g_nat, prot)
                g_final = combine_sum(g_nat_p, prot)
                if evp.get("applied"):
                    proj_events = [evp]
            else:
                g_final = g_sum
            projected = float(g_final.norm().item())
            effective = projected / float(len(GROUP_ORDER))
            if (not np.isfinite(raw_sum)) or (not np.isfinite(projected)) or effective >= GRAD_HARD:
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "GRAD_INSTABILITY", "raw": raw_sum, "projected": projected, "effective": effective, "step": step}
                break
            if any(not np.isfinite(v) for v in task_norms.values()):
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "GRAD_INSTABILITY", "task_norms": task_norms, "step": step}
                break
            optimizer.zero_grad(set_to_none=True)
            assign_ra1_grad(model, g_final)
            grads = _adapter_grads(model)
            raw = grads["COMBINED_GRAD"]
            if not np.isfinite(raw) or (raw / float(len(GROUP_ORDER))) >= GRAD_HARD:
                abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": "GRAD_INSTABILITY", "grad": raw, "effective": raw / float(len(GROUP_ORDER)), "step": step, "grads": grads}
                break
            clipped = float(torch.nn.utils.clip_grad_norm_(trainable, GRAD_CLIP))
            optimizer.step()
            tokens_seen += TOKENS_PER_STEP
            nat_tokens += TOKENS_PER_GROUP_SEQ
            mean_loss = float(np.mean([float(cap["infos"][k]["loss"] or 0) for k in GROUP_ORDER]))
            row = {
                "step": step,
                "loss": mean_loss,
                "raw_grad": raw,
                "raw_sum_grad": raw_sum,
                "projected_grad": projected,
                "effective_mixed_grad": effective,
                "clipped_grad": clipped,
                "n_conflict": n_conflict,
                "n_projected": len(proj_events),
                "projection_order": order,
                "proj_events": proj_events,
                "pairs": pairs,
                "task_norms": task_norms,
                "task_parts": {k: {"W_DOWN_GRAD": cap["parts"][k].get("W_DOWN_GRAD"), "W_UP_GRAD": cap["parts"][k].get("W_UP_GRAD"), "ADAPTER_NORM_GRAD": cap["parts"][k].get("ADAPTER_NORM_GRAD")} for k in GROUP_ORDER},
                "tokens_seen": tokens_seen,
                "natural_relevant_tokens": nat_tokens,
                "ra1_lr": ra1_lr,
                "mechanism": mechanism,
                **grads,
            }
            metrics.append(row)
            with (ckpt_root / "metrics.jsonl").open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(row) + "\n")
            if step in eval_at:
                persist(step, tokens_seen)
                ev = run_eval(step, row["loss"], tokens_seen, effective)
                if ev.get("hard_gate_hits"):
                    abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": ",".join(ev["hard_gate_hits"]), "step": step}
                    break
    train_s = time.perf_counter() - t_train0
    last_opt = int(tokens_seen // TOKENS_PER_STEP)
    if tokens_seen > 0:
        persist(last_opt, tokens_seen)
    final_step = max([int(k) for k in stage3_by_step] + [last_opt], default=0)
    complete = abort is None and tokens_seen >= use_steps * TOKENS_PER_STEP
    dN = dist_by_step.get(str(final_step)) or dist_now()
    report = {
        "ok": complete,
        "kind": f"{run_id}_REPORT",
        "RUN_ID": run_id,
        "PACK": pack_name,
        "ARCHITECTURE_ID": model.architecture_id,
        "EA1_LR": 0.0,
        "RA1_LR": ra1_lr,
        "TRAIN_EA1": False,
        "TRAIN_RA1": True,
        "MECHANISM": mechanism,
        "PROJECTION_ORDER": list(PROTECTED_ORDER),
        "STEPS": use_steps if complete else final_step,
        "TOKENS_USED": tokens_seen,
        "NEW_NATURAL_RELEVANT_TOKENS": nat_tokens,
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


def train_ra1_conflict(
    *,
    run_id: str,
    corpus_dir: Path,
    parent_ckpt: Path,
    pack_name: str,
    steps: int,
    ra1_lr: float = 3e-4,
    mechanism: str = "sum",
    restore_ollama: bool = True,
    eval_steps: tuple[int, ...] | None = None,
    authorization_id: str = "WRIM_RA1_GRADIENT_CONFLICT",
) -> dict[str, Any]:
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
            ra1_lr=ra1_lr,
            mechanism=mechanism,
            restore_ollama=restore_ollama,
            eval_steps=eval_steps,
        )
    finally:
        release_trainer_lock(run_id)
