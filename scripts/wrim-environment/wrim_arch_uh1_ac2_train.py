"""AC2 control-vector trainer. Body and lm_head frozen unless fallback requested.

Does not promote canonical. Unsets training authorization on every exit.
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

from wrim_arch_uh1_ac1_train import AC1_CTRL_LR, AC1_CTRL_WD, _write, role_geometry, unset_auth
from wrim_arch_uh1_ac2 import CONVERT_ID as AC2_CONVERT_ID
from wrim_arch_uh1_ac2 import _ctrl_grads, probe_pack
from wrim_arch_uh1_phase_a import _sha_file, _split_loss, load_jsonl
from wrim_g20m_uh1 import (
    ARCH_ID_UH1_AC2,
    UH1_AC2_PARAM_COUNT,
    UH1_AC2_STOP_PARAM_COUNT,
    WRIMUH1Model,
    freeze_body_train_ac2,
)
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
    ROLE_MAX_TOKENS,
    ROLE_STEPS,
    SEED,
    SEQ_LEN,
    STAGE3_REVIEW_DELTA,
    STEP400_STAGE3_DELTA_VS_WRIM0,
    TOKENIZER_EXPECTED_SHA,
    TOKENS_PER_STEP,
)
from wrim_plm1_gates import hard_hits
from wrim_plm3_encode import encode_example, pack_train_stream, slice_batches


def pack_rows(tokenizer, corpus_dir: Path, steps: int) -> tuple[np.ndarray, np.ndarray, list]:
    train_rows = load_jsonl(corpus_dir / "train.jsonl")
    encoded = [encode_example(tokenizer, r) for r in train_rows]
    mean_len = max(1, int(np.mean([int(e["tokens"].size) for e in encoded])))
    need = steps * MICRO_BATCH * SEQ_LEN + 1
    tiled = list(encoded)
    while len(tiled) * mean_len * 60 < need:
        tiled = tiled + tiled
    stream, mask = pack_train_stream(tiled, steps=steps)
    return stream, mask, slice_batches(stream, mask, steps=steps)


def train_ac2(
    *,
    run_id: str,
    corpus_dir: Path,
    parent_ckpt: Path,
    pack_name: str,
    lm_head: bool = False,
    stop_control: bool = False,
    ctrl_trainable: bool = True,
    steps: int = ROLE_STEPS,
    lr: float = AC1_CTRL_LR,
    head_lr: float | None = None,
) -> dict[str, Any]:
    from safetensors.torch import load_file as load_safetensors_file
    from tokenizers import Tokenizer

    from run000007_env import verify_linux_env
    from run000007_preflight import resolve_dump_root, sha256_file
    from run000007_vram import ensure_vram_for_training, start_user_ollama
    from wrim_cpt2_identity import CORPUS_VERSION as CPT2_CORPUS_VERSION
    from wrim_cpt5_identity import INDEPENDENT_NL_PACK
    from wrim_cpt_eval import evaluate_foundation, family_nll
    from wrim_cpt_identity import ADDENDUM_SHA, LINUX_CKPT_ROOT, SUITE_SHA
    from wrim_cpt_preflight import locate_baseline, locate_suite
    from wrim_cpt_stage_b_corpus import corpus_root, tokenize_docs, val_family_id_packs
    from wrim_cpt_stage_b_identity import PROVISIONAL_STAGE_B_PARENT_CHECKPOINT
    from wrim_plm1_eval import evaluate_prefix_heldout
    from wrim_proven_load import disable_tf32
    from wrim_resumable_checkpoint import MODEL_NAME, save_resumable_checkpoint
    from wrim_val_nl_independent import eval_candidate
    from stage3a_run import evaluate_candidate, load_baseline, load_suite

    auth_value = f"ON_FOR_{run_id.replace('-', '_')}_ONLY"
    os.environ[AUTHORIZE_ENV_NAME] = auth_value
    t0 = datetime.now(timezone.utc).isoformat()
    ckpt_root = Path(CKPT_BASE) / run_id
    report_path = Path(DATA_ROOT) / f"{run_id}_REPORT.json"
    ollama_stopped = False
    max_tokens = steps * TOKENS_PER_STEP

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
        return finish({"ok": False, "reason": "dump_root_missing", "RUN_ID": run_id, "TRAINING_AUTHORIZATION": "OFF"})
    env = verify_linux_env()
    vram = ensure_vram_for_training()
    ollama_stopped = bool(vram.get("OLLAMA_STOPPED_FOR_TRAINING"))
    if not env.get("ok"):
        return finish({"ok": False, "reason": "env_fail", "env": env, "RUN_ID": run_id, "TRAINING_AUTHORIZATION": "OFF"})

    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    tok_hash = sha256_file(tok_path)
    if tok_hash != TOKENIZER_EXPECTED_SHA:
        return finish({"ok": False, "reason": "tokenizer_hash_mismatch", "RUN_ID": run_id, "TRAINING_AUTHORIZATION": "OFF"})
    tokenizer = Tokenizer.from_file(str(tok_path))
    step400 = Path(LINUX_CKPT_ROOT) / PROVISIONAL_STAGE_B_PARENT_CHECKPOINT / MODEL_NAME
    if sha256_file(step400) != CANONICAL_HASH:
        return finish({"ok": False, "reason": "canonical_hash_changed", "RUN_ID": run_id, "TRAINING_AUTHORIZATION": "OFF"})
    foundation_hash = sha256_file(Path(EXPERIMENTAL_PARENT_CKPT) / MODEL_NAME)
    if foundation_hash != EXPECTED_PARENT_MODEL_HASH:
        return finish({"ok": False, "reason": "foundation_parent_hash_mismatch", "RUN_ID": run_id, "TRAINING_AUTHORIZATION": "OFF"})
    parent_path = parent_ckpt / MODEL_NAME if parent_ckpt.name != MODEL_NAME else parent_ckpt
    if parent_ckpt.is_dir():
        parent_path = parent_ckpt / MODEL_NAME
    if not parent_path.is_file():
        return finish({"ok": False, "reason": "parent_missing", "path": str(parent_path), "RUN_ID": run_id, "TRAINING_AUTHORIZATION": "OFF"})
    if ckpt_root.is_dir() and (ckpt_root / f"step-{steps}" / "resume-manifest.json").is_file():
        return finish({"ok": False, "reason": "second_execution_forbidden", "RUN_ID": run_id, "TRAINING_AUTHORIZATION": "OFF"})

    stream, mask, batches = pack_rows(tokenizer, corpus_dir, steps)
    train_rows = load_jsonl(corpus_dir / "train.jsonl")
    val_rows = load_jsonl(corpus_dir / "val.jsonl")

    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)

    model = WRIMUH1Model(assistant_control=True, span_control=True, stop_control=stop_control)
    src_state = load_safetensors_file(str(parent_path))
    missing, unexpected = model.load_state_dict(src_state, strict=False)
    extra = set(missing) - {"assistant_span_ctrl", "assistant_stop_ctrl"}
    if extra or unexpected:
        return finish({"ok": False, "reason": "state_dict_mismatch", "missing": list(missing), "unexpected": list(unexpected), "RUN_ID": run_id, "TRAINING_AUTHORIZATION": "OFF"})
    if "assistant_span_ctrl" in missing:
        with torch.no_grad():
            model.assistant_span_ctrl.zero_()
    if stop_control and model.assistant_stop_ctrl is not None and "assistant_stop_ctrl" in missing:
        with torch.no_grad():
            model.assistant_stop_ctrl.zero_()
    model.to(device)
    freeze_body_train_ac2(model, lm_head=lm_head, stop=stop_control, ctrl=ctrl_trainable)
    preflight = probe_pack(model, tokenizer, train_rows, device, lm_head=lm_head, stop=stop_control, ctrl=ctrl_trainable)
    freeze_body_train_ac2(model, lm_head=lm_head, stop=stop_control, ctrl=ctrl_trainable)
    if float(preflight["TOTAL_TRAINABLE_GRAD"]) >= GRAD_HARD:
        return finish({"ok": False, "reason": "preflight_unsafe", "preflight": preflight, "RUN_ID": run_id, "TRAINING_AUTHORIZATION": "OFF"})
    n_params = int(sum(p.numel() for p in model.parameters()))
    expect = UH1_AC2_STOP_PARAM_COUNT if stop_control else UH1_AC2_PARAM_COUNT
    if n_params != expect:
        return finish({"ok": False, "reason": "param_count", "n": n_params, "expect": expect, "RUN_ID": run_id, "TRAINING_AUTHORIZATION": "OFF"})
    trainable = [p for p in model.parameters() if p.requires_grad]
    use_head_lr = float(head_lr) if (lm_head and head_lr is not None) else None
    if lm_head and ctrl_trainable:
        hl = 3e-4 if use_head_lr is None else use_head_lr
        groups = [
            {"params": [model.assistant_ctrl, model.assistant_span_ctrl], "lr": lr},
            {"params": [model.lm_head.weight], "lr": hl},
        ]
        if stop_control and model.assistant_stop_ctrl is not None:
            groups[0]["params"].append(model.assistant_stop_ctrl)
        optimizer = torch.optim.AdamW(groups, betas=BETAS, eps=EPS, weight_decay=AC1_CTRL_WD, fused=False)
        group_lrs = [lr, hl]
    elif lm_head and not ctrl_trainable:
        hl = 3e-4 if use_head_lr is None else use_head_lr
        optimizer = torch.optim.AdamW([model.lm_head.weight], lr=hl, betas=BETAS, eps=EPS, weight_decay=AC1_CTRL_WD, fused=False)
        group_lrs = [hl]
    else:
        optimizer = torch.optim.AdamW(trainable, lr=lr, betas=BETAS, eps=EPS, weight_decay=AC1_CTRL_WD, fused=False)
        group_lrs = [lr]

    croot = corpus_root()
    val_docs = load_jsonl(croot / f"{CPT2_CORPUS_VERSION}-VAL.jsonl")
    val_packs = val_family_id_packs(tokenize_docs(val_docs, tokenizer))
    nl_root = Path(DATA_ROOT) / INDEPENDENT_NL_PACK
    nl_rows = load_jsonl(nl_root / f"{INDEPENDENT_NL_PACK}-PASSAGES.jsonl")
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
        "ARCHITECTURE_ID": model.architecture_id,
        "TRAIN_SCOPE": ("LM_HEAD_ONLY" if (lm_head and not ctrl_trainable) else ("LM_HEAD_PLUS_CTRL" if lm_head else "CONTROL_VECTORS_ONLY")),
        "BODY_FROZEN": True,
        "LM_HEAD_TRAINED": lm_head,
        "CTRL_TRAINABLE": ctrl_trainable,
        "STOP_CONTROL": stop_control,
        "PACK": pack_name,
    }
    _write(ckpt_root / "run-identity.json", identity)
    stream_sha = hashlib.sha256(stream.tobytes()).hexdigest()
    lr_table = {str(s): lr for s in range(0, steps + 2)}
    metrics = []
    geo_by_step = {}
    stage3_by_step = {}
    found_by_step = {}
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
            curriculum={"stage": "UH1_AC2", "pack": pack_name, "lm_head": lm_head, "stop": stop_control, "ctrl": ctrl_trainable, "lr": lr},
            identity=identity,
            lr_table=lr_table,
            authorized_max_step=steps,
            authorized_max_tokens=max_tokens,
        )

    def run_eval(step: int, loss: float | None, tokens: int, grad: float | None) -> dict[str, Any]:
        model.eval()
        geo_val = role_geometry(model, tokenizer, device, val_rows)
        geo_train = role_geometry(model, tokenizer, device, train_rows)
        prefix = evaluate_prefix_heldout(model=model, tokenizer=tokenizer, device=device, rows=val_rows)
        found = evaluate_foundation(model=model, tokenizer=tokenizer, device=device)
        nlls = family_nll(model=model, device=device, packs=val_packs)
        nl = eval_candidate(name=f"{run_id}-step-{step}", model=model, tokenizer=tokenizer, device=device, rows=nl_rows)
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
            train_loss=loss,
            tokens=tokens,
            lr=lr,
        )
        freeze_body_train_ac2(model, lm_head=lm_head, stop=stop_control, ctrl=ctrl_trainable)
        delta = ev.get("mean_wrim0_anchor_nll_delta")
        drift = None if delta is None else float(delta) - float(STEP400_STAGE3_DELTA_VS_WRIM0)
        s3_obs = {
            "step": step,
            "mean_wrim0_anchor_nll_delta": delta,
            "historical_pass_count": ev.get("historical_pass_count"),
            "n_collapsed": ev.get("n_collapsed"),
            "STAGE3_DRIFT_VS_STEP400": drift,
            "STAGE3_NLL_REVIEW": bool(delta is not None and float(delta) >= STAGE3_REVIEW_DELTA),
        }
        slim_prefix = {k: v for k, v in prefix.items() if k != "items"}
        slim_found = {k: v for k, v in found.items() if k != "items"}
        _write(evals_dir / f"role-geo-step-{step}.json", {"val": geo_val, "train": geo_train})
        _write(evals_dir / f"prefix-step-{step}.json", slim_prefix)
        _write(evals_dir / f"foundation-step-{step}.json", slim_found)
        _write(evals_dir / f"val-nll-step-{step}.json", nlls)
        _write(evals_dir / f"independent-nl-step-{step}.json", {k: v for k, v in nl.items() if k != "generations"})
        _write(evals_dir / f"stage3-step-{step}.json", s3_obs)
        geo_by_step[str(step)] = {"val": geo_val, "train": geo_train}
        prefix_by_step[str(step)] = slim_prefix
        found_by_step[str(step)] = slim_found
        stage3_by_step[str(step)] = s3_obs
        nll_by_step[str(step)] = nlls
        bundle = {
            "stage3_historical": s3_obs.get("historical_pass_count"),
            "stage3_collapse": s3_obs.get("n_collapsed"),
            "stage3_delta_nll": s3_obs.get("mean_wrim0_anchor_nll_delta"),
            "grad_norm": grad,
            "nan": False,
        }
        return {"hard_gate_hits": hard_hits(bundle), "geo_val": geo_val, "prefix": slim_prefix, "stage3": s3_obs, "foundation": slim_found, "nlls": nlls}

    ev0 = run_eval(0, None, 0, None)
    persist(0, 0)
    parent_geo = ev0["geo_val"]
    parent_prefix = ev0["prefix"]
    if ev0.get("hard_gate_hits"):
        abort = {"HARD_STOP_TRIGGERED": True, "stop_reason": ",".join(ev0["hard_gate_hits"]), "step": 0}

    eval_steps = tuple(s for s in EVAL_STEPS if s <= steps)
    if steps > 10:
        eval_steps = tuple(sorted(set(eval_steps + tuple(s for s in range(10, steps + 1, 10)))))
    if steps not in eval_steps:
        eval_steps = eval_steps + (steps,)
    if abort is None:
        for step in range(1, steps + 1):
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
            grads = _ctrl_grads(model)
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
                **{k: grads[k] for k in ("ENTRY_CTRL_GRAD", "SPAN_CTRL_GRAD", "STOP_CTRL_GRAD", "LM_HEAD_GRAD")},
                "entry_l2": float(model.assistant_ctrl.detach().float().norm(2).item()),
                "span_l2": float(model.assistant_span_ctrl.detach().float().norm(2).item()),
                "tokens_seen": tokens_seen,
                "lr": lr,
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
    final_step = max([int(k) for k in geo_by_step], default=0)
    final_geo = geo_by_step.get(str(final_step), {}).get("val") or parent_geo
    p0 = prefix_by_step.get("0") or parent_prefix
    pN = prefix_by_step.get(str(final_step)) or {}
    s0 = stage3_by_step.get("0") or {}
    sN = stage3_by_step.get(str(final_step)) or {}
    complete = abort is None and final_step >= steps
    best_hash = None
    if (ckpt_root / f"step-{final_step}" / MODEL_NAME).is_file():
        best_hash = _sha_file(ckpt_root / f"step-{final_step}" / MODEL_NAME)
    later0 = metrics[0]["LATER_TOKEN_CE"] if metrics else None
    laterN = metrics[-1]["LATER_TOKEN_CE"] if metrics else None
    eos0 = metrics[0]["EOS_CE"] if metrics else None
    eosN = metrics[-1]["EOS_CE"] if metrics else None
    ramble0 = p0.get("RAMBLE_RATE")
    rambleN = pN.get("RAMBLE_RATE")
    span_improved = (
        (later0 is not None and laterN is not None and laterN < later0 - 0.05)
        or (eos0 is not None and eosN is not None and eosN < eos0 - 0.05)
        or (ramble0 is not None and rambleN is not None and rambleN < ramble0 - 0.05)
    )
    report = {
        "ok": complete,
        "kind": f"{run_id}_REPORT",
        "RUN_ID": run_id,
        "ARCHITECTURE_ID": model.architecture_id,
        "PACK": pack_name,
        "LM_HEAD_TRAINED": lm_head,
        "STOP_CONTROL": stop_control,
        "STEPS": steps if complete else final_step,
        "TOKENS_USED": tokens_seen,
        "PREFLIGHT": {k: preflight.get(k) for k in ("TOTAL_TRAINABLE_GRAD", "ENTRY_CTRL_GRAD", "SPAN_CTRL_GRAD", "GRAD_GATE", "FIRST_TOKEN_CE", "LATER_TOKEN_CE", "EOS_CE")},
        "PARENT_ROLE_GEOMETRY": parent_geo,
        "FINAL_ROLE_GEOMETRY": final_geo,
        "PREFIX_PARENT": p0,
        "PREFIX_FINAL": pN,
        "STAGE3_HISTORICAL": {"parent": s0.get("historical_pass_count"), "final": sN.get("historical_pass_count")},
        "STAGE3_COLLAPSE": {"parent": s0.get("n_collapsed"), "final": sN.get("n_collapsed")},
        "STAGE3_DRIFT_VS_STEP400": sN.get("STAGE3_DRIFT_VS_STEP400"),
        "NLL_PARENT": nll_by_step.get("0"),
        "NLL_FINAL": nll_by_step.get(str(final_step)),
        "METRICS": metrics,
        "SPAN_SIGNAL": "PRESENT" if span_improved else "ABSENT",
        "LATER_TOKEN_CE": {"start": later0, "final": laterN},
        "EOS_CE": {"start": eos0, "final": eosN},
        "RAMBLE_RATE": {"parent": ramble0, "final": rambleN},
        "PARAMETER_COUNT": n_params,
        "PEAK_VRAM_BYTES": peak_vram,
        "WALL_SECONDS": train_s,
        "TOKENS_PER_SECOND": (tokens_seen / train_s) if train_s > 0 and tokens_seen else None,
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


if __name__ == "__main__":
    obj = train_ac2(
        run_id="WRIM1-UH1-AC2-SPAN-000001",
        corpus_dir=Path(DATA_ROOT) / "WR-CORPUS-HVU-ROLE-C3_easy_bigram_eos-v1.0.0",
        parent_ckpt=Path(CKPT_BASE) / AC2_CONVERT_ID,
        pack_name="C3_easy_bigram",
    )
    keys = (
        "ok", "SPAN_SIGNAL", "TOKENS_USED", "STEPS", "LATER_TOKEN_CE", "EOS_CE", "RAMBLE_RATE",
        "FINAL_ROLE_GEOMETRY", "STAGE3_HISTORICAL", "STAGE3_COLLAPSE", "STAGE3_DRIFT_VS_STEP400",
        "BEST_EXPERIMENTAL_CHECKPOINT", "BEST_EXPERIMENTAL_HASH", "abort",
    )
    print(json.dumps({k: obj.get(k) for k in keys}, indent=2))
