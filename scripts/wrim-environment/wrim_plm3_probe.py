"""WRIM1-PLM-000003 backward-only first-token scale probe.

Authorized: preparation + one backward diagnostic.
NOT authorized: optimizer.step, step 1, training, checkpoint, resume of PLM-000002.
TRAINING_AUTHORIZATION remains OFF.
"""
from __future__ import annotations

import hashlib
import json
import os
import random
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from wrim_plm3_identity import (
    ASSISTANT_DELIMITER_POLICY,
    AUTHORIZE_ENV_NAME,
    BETAS,
    CANONICAL_CHECKPOINT,
    CANONICAL_HASH,
    CORPUS_ID,
    CORPUS_VERSION,
    DATA_ROOT,
    EOS_LOSS_WEIGHT,
    EXPECTED_PARENT_MODEL_HASH,
    EXPECTED_PARENT_OPTIMIZER_HASH,
    EXPERIMENTAL_PARENT_CHECKPOINT,
    EXPERIMENTAL_PARENT_CKPT,
    FAILED_PRIOR_CKPT,
    FAILED_PRIOR_RUN,
    FIRST_TOKEN_LOSS_WEIGHT,
    GRAD_CLIP,
    GRAD_HARD,
    GRAD_REVIEW,
    GRAD_WARN,
    LATER_TOKEN_LOSS_WEIGHT,
    LEARNING_RATE,
    MAX_TOKENS,
    MICRO_BATCH,
    NEWLINE_TOKEN_ID,
    OPTIMIZER_STATE_POLICY,
    PARENT_STAGE3_DELTA_VS_WRIM0,
    PARENT_STAGE3_DRIFT_VS_STEP400,
    PLM000002_FIRST_TOKEN_LOSS_WEIGHT,
    PREP_REPORT_FILENAME,
    REMAINING_STAGE3_HEADROOM,
    RUN_ID,
    SEED,
    SEQ_LEN,
    STAGE3_PARENT_DRIFT_HARD,
    STEPS,
    TOKENIZER_EXPECTED_SHA,
    TOKENIZER_ID,
    TOKENS_PER_STEP,
)


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _write_json(path: Path, obj: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8")


def _module_key(name: str) -> str:
    if name.startswith("tok_emb"):
        return "tok_emb_tied_embed_and_output_head"
    if name.startswith("norm_f"):
        return "norm_f"
    parts = name.split(".")
    if len(parts) >= 3 and parts[0] == "layers":
        return f"layers.{parts[1]}.{parts[2]}"
    return name.rsplit(".", 1)[0]


def _grad_stats(model) -> dict[str, Any]:
    import torch

    per_param = []
    grouped: dict[str, list] = defaultdict(list)
    sq = []
    for name, p in model.named_parameters():
        if p.grad is None:
            per_param.append({"name": name, "grad_norm": None, "numel": int(p.numel())})
            continue
        n = float(p.grad.detach().float().norm(2).item())
        per_param.append({"name": name, "grad_norm": n, "numel": int(p.numel())})
        grouped[_module_key(name)].append(n * n)
        sq.append(n * n)
    total = float(sum(sq) ** 0.5) if sq else 0.0
    by_module = {k: float(sum(v) ** 0.5) for k, v in grouped.items()}
    embed = by_module.get("tok_emb_tied_embed_and_output_head")
    return {
        "total_unclipped_l2": total,
        "by_module": dict(sorted(by_module.items())),
        "embedding_output_head_tied_grad_norm": embed,
        "n_params_with_grad": sum(1 for r in per_param if r["grad_norm"] is not None),
        "per_param": per_param,
    }


def _batch_entry_logits(logits, y, y_mask, first_flag) -> dict[str, Any]:
    import torch

    sel = first_flag
    n = int(sel.sum().item())
    if n == 0:
        return {"n_first_positions": 0}
    lg = logits[sel].float()
    tgt = y[sel]
    gather = lg.gather(-1, tgt.unsqueeze(-1)).squeeze(-1)
    nl = lg[:, NEWLINE_TOKEN_ID]
    probs = torch.softmax(lg, dim=-1)
    tgt_p = probs.gather(-1, tgt.unsqueeze(-1)).squeeze(-1)
    nl_p = probs[:, NEWLINE_TOKEN_ID]
    argmax = lg.argmax(dim=-1)
    ranks = []
    for i in range(n):
        order = torch.argsort(lg[i], descending=True)
        hit = torch.nonzero(order == tgt[i], as_tuple=False)
        ranks.append(int(hit[0].item()) + 1 if hit.numel() else None)
    return {
        "n_first_positions": n,
        "TARGET_LOGIT": float(gather.mean().item()),
        "NEWLINE_LOGIT": float(nl.mean().item()),
        "TARGET_NEWLINE_LOGIT_GAP": float((gather - nl).mean().item()),
        "FIRST_TARGET_PROBABILITY": float(tgt_p.mean().item()),
        "NEWLINE_PROBABILITY": float(nl_p.mean().item()),
        "NEWLINE_ARGMAX_COUNT": int((argmax == NEWLINE_TOKEN_ID).sum().item()),
        "NEWLINE_ARGMAX_RATE": float((argmax == NEWLINE_TOKEN_ID).float().mean().item()),
        "FIRST_TARGET_RANK": float(sum(r for r in ranks if r is not None) / max(1, sum(1 for r in ranks if r is not None))),
        "FIRST_TARGET_TOP1": int(sum(1 for r in ranks if r == 1)),
        "FIRST_TARGET_TOP5": int(sum(1 for r in ranks if r is not None and r <= 5)),
        "FIRST_TARGET_TOP10": int(sum(1 for r in ranks if r is not None and r <= 10)),
    }


def _probe_one(*, model, x, y, y_mask, first_w: float) -> dict[str, Any]:
    import torch

    from wrim_plm3_encode import MASK_CAP_FIRST, weighted_split_losses

    model.zero_grad(set_to_none=True)
    logits = model(x)
    split = weighted_split_losses(logits, y, y_mask, first_w=first_w)
    loss = split["loss"]
    finite = bool(torch.isfinite(loss))
    if not finite:
        return {
            "FIRST_TOKEN_LOSS_WEIGHT": first_w,
            "finite_loss": False,
            "weighted_loss": None,
            "FIRST_TOKEN_CE": split["FIRST_TOKEN_CE"],
            "EOS_CE": split["EOS_CE"],
            "LATER_TOKEN_CE": split["LATER_TOKEN_CE"],
            "optimizer_step": False,
        }
    loss.backward()
    # Unclipped total L2 — same quantity clip_grad_norm_ returned in PLM-000002.
    # Do NOT call clip_grad_norm_: clipping is not applied, and no optimizer.step.
    grads = _grad_stats(model)
    entry = _batch_entry_logits(logits.detach(), y, y_mask, y_mask == MASK_CAP_FIRST)
    total = grads["total_unclipped_l2"]
    gate = "OK"
    if not (total == total) or total >= GRAD_HARD:
        gate = "HARD"
    elif total >= GRAD_REVIEW:
        gate = "REVIEW"
    elif total >= GRAD_WARN:
        gate = "WARN"
    return {
        "FIRST_TOKEN_LOSS_WEIGHT": first_w,
        "finite_loss": True,
        "weighted_loss": float(loss.detach().item()),
        "FIRST_TOKEN_CE": split["FIRST_TOKEN_CE"],
        "LATER_TOKEN_CE": split["LATER_TOKEN_CE"],
        "EOS_CE": split["EOS_CE"],
        "n_first_supervised": split["n_first_supervised"],
        "n_later_supervised": split["n_later_supervised"],
        "n_eos_supervised": split["n_eos_supervised"],
        "weight_sum": split["weight_sum"],
        "total_unclipped_grad_norm": total,
        "GRAD_GATE": gate,
        "GRAD_WARN": GRAD_WARN,
        "GRAD_REVIEW": GRAD_REVIEW,
        "GRAD_HARD": GRAD_HARD,
        "clip_applied": False,
        "optimizer_step": False,
        "embedding_output_head_tied_grad_norm": grads["embedding_output_head_tied_grad_norm"],
        "by_module": grads["by_module"],
        "batch_entry": entry,
    }


def main() -> dict[str, Any]:
    import numpy as np
    import torch
    from safetensors.torch import load_file as load_safetensors_file
    from tokenizers import Tokenizer

    from run000007_preflight import resolve_dump_root, sha256_file
    from wrim_cpt_identity import LINUX_CKPT_ROOT
    from wrim_cpt_stage_b_identity import PROVISIONAL_STAGE_B_PARENT_CHECKPOINT
    from wrim_g20m import WRIM0Model
    from wrim_plm3_corpus import load_frozen_corpus
    from wrim_plm3_encode import (
        boundary_fixtures,
        encode_example,
        mask_report,
        pack_train_stream,
        slice_batches,
        validate_inference_match,
    )
    from wrim_proven_load import disable_tf32
    from wrim_resumable_checkpoint import MODEL_NAME

    t0 = datetime.now(timezone.utc).isoformat()
    abort_dir = Path(FAILED_PRIOR_CKPT)
    abort_paths = [abort_dir / "abort.json", abort_dir / "ABORT.json"]
    abort_before = {str(p): _sha256_file(p) if p.is_file() else None for p in abort_paths}

    auth_env = os.environ.get(AUTHORIZE_ENV_NAME, "OFF")
    if auth_env not in ("", "OFF", None):
        os.environ[AUTHORIZE_ENV_NAME] = "OFF"
    os.environ[AUTHORIZE_ENV_NAME] = "OFF"

    dump = resolve_dump_root(None)
    if dump is None:
        return {"ok": False, "reason": "dump_root_missing", "TRAINING_AUTHORIZATION": "OFF"}

    parent = Path(EXPERIMENTAL_PARENT_CKPT)
    exp_model = parent / MODEL_NAME
    exp_opt = parent / "optimizer.pt"
    man_p = parent / "resume-manifest.json"
    parent_model_hash = sha256_file(exp_model)
    parent_opt_hash = sha256_file(exp_opt) if exp_opt.is_file() else None
    parent_manifest_hash = sha256_file(man_p) if man_p.is_file() else None
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    tok_hash = sha256_file(tok_path)
    step400 = Path(LINUX_CKPT_ROOT) / PROVISIONAL_STAGE_B_PARENT_CHECKPOINT / MODEL_NAME
    canonical_hash = sha256_file(step400)

    plm3_ckpt = Path("/home/chosenone/.local/share/war-room-os/data/wrim-checkpoints/test-only") / RUN_ID
    run_id_unused = not (plm3_ckpt.is_dir() and (plm3_ckpt / "step-10" / "resume-manifest.json").is_file())
    cpt6 = Path("/home/chosenone/.local/share/war-room-os/data/wrim-checkpoints/test-only/WRIM1-CPT-000006")

    tokenizer = Tokenizer.from_file(str(tok_path))
    corpus = load_frozen_corpus(tokenizer=tokenizer)
    train_rows = corpus.get("train") or []
    val_rows = corpus.get("val") or []

    encoded = [encode_example(tokenizer, r) for r in train_rows]
    val_encoded = [encode_example(tokenizer, r) for r in val_rows]
    match_ok = all(validate_inference_match(tokenizer, r, e) for r, e in zip(train_rows, encoded))
    match_ok = match_ok and all(validate_inference_match(tokenizer, r, e) for r, e in zip(val_rows, val_encoded))
    class_ids: dict[str, set[int]] = {}
    single_token = True
    for rec, enc in list(zip(train_rows, encoded)) + list(zip(val_rows, val_encoded)):
        class_ids.setdefault(rec["first_token_class"], set()).add(int(enc["first_target_id"]))
        if len(enc["target_ids"]) != 1:
            single_token = False
    class_consistent = all(len(s) == 1 for s in class_ids.values())
    fixtures = boundary_fixtures(tokenizer, encoded, n=6) if encoded else []
    stream, mask = pack_train_stream(encoded)
    mask_2 = mask_report(mask, first_w=FIRST_TOKEN_LOSS_WEIGHT)
    mask_4 = mask_report(mask, first_w=PLM000002_FIRST_TOKEN_LOSS_WEIGHT)
    batches = slice_batches(stream, mask)
    x_np, y_np, m_np = batches[0]

    # Boundary sample from first train example
    e0 = encoded[0]
    boundary = {
        "RAW_TEMPLATE": "<|commander|>\\nPROMPT<|assistant|>TARGET + EOS",
        "ASSISTANT_DELIMITER_POLICY": ASSISTANT_DELIMITER_POLICY,
        "no_newline_after_assistant": True,
        "first_example_id": e0["example_id"],
        "assistant_index": int(e0["assistant_index"]),
        "first_target_index": int(e0["first_target_index"]),
        "eos_index": int(e0["eos_index"]),
        "first_target_id": int(e0["first_target_id"]),
        "target_ids": list(e0["target_ids"]),
        "tokens_around_assistant": [int(x) for x in e0["tokens"][int(e0["assistant_index"]) - 1 : int(e0["eos_index"]) + 1]],
        "mask_around_assistant": [int(x) for x in e0["mask"][int(e0["assistant_index"]) - 1 : int(e0["eos_index"]) + 1]],
        "inference_prefix_matches_train": bool(match_ok),
    }

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
    # Confirm parent hash of loaded weights by hashing the source file only.
    # Do not construct AdamW. Do not optimizer.step.

    x = torch.tensor(x_np, dtype=torch.long, device=device)
    y = torch.tensor(y_np, dtype=torch.long, device=device)
    y_mask = torch.tensor(m_np, dtype=torch.int8, device=device)

    probe_4 = _probe_one(model=model, x=x, y=y, y_mask=y_mask, first_w=PLM000002_FIRST_TOKEN_LOSS_WEIGHT)
    probe_2 = _probe_one(model=model, x=x, y=y, y_mask=y_mask, first_w=FIRST_TOKEN_LOSS_WEIGHT)
    model.zero_grad(set_to_none=True)

    # Cheap held-out first-token forward (no generate, no weight update) to confirm parent baseline.
    from wrim_plm3_encode import prefix_ids_for_inference

    ranks = []
    tgt_logits = []
    nl_logits = []
    nl_argmax = 0
    with torch.inference_mode():
        for rec in val_rows:
            enc = encode_example(tokenizer, rec)
            prefix = prefix_ids_for_inference(tokenizer, rec["prompt"])
            lg = model(torch.tensor([prefix], dtype=torch.long, device=device))[0, -1].float()
            tid = int(enc["first_target_id"])
            order = torch.argsort(lg, descending=True)
            rank_t = torch.nonzero(order == tid, as_tuple=False)
            ranks.append(int(rank_t[0].item()) + 1 if rank_t.numel() else None)
            tgt_logits.append(float(lg[tid].item()))
            nl_logits.append(float(lg[NEWLINE_TOKEN_ID].item()))
            if int(order[0].item()) == NEWLINE_TOKEN_ID:
                nl_argmax += 1
    n_val = max(1, len(val_rows))
    heldout_forward = {
        "n": len(val_rows),
        "FIRST_TARGET_RANK": float(sum(r for r in ranks if r is not None) / max(1, sum(1 for r in ranks if r is not None))),
        "TARGET_LOGIT": float(sum(tgt_logits) / n_val),
        "NEWLINE_LOGIT": float(sum(nl_logits) / n_val),
        "TARGET_NEWLINE_LOGIT_GAP": float(sum(t - n for t, n in zip(tgt_logits, nl_logits)) / n_val),
        "NEWLINE_ARGMAX_COUNT": nl_argmax,
        "NEWLINE_ARGMAX_RATE": nl_argmax / n_val,
        "greedy_not_rerun": True,
        "note": "Forward-only first-token logits. Greedy metrics taken from PLM-000002/step-0 parent eval (same weights, no step).",
    }

    plm2_step0 = Path(FAILED_PRIOR_CKPT) / "evals" / "prefix-lm-step-0.json"
    plm2_parent_eval = json.loads(plm2_step0.read_text(encoding="utf-8")) if plm2_step0.is_file() else {}

    abort_after = {str(p): _sha256_file(p) if p.is_file() else None for p in abort_paths}
    abort_untouched = abort_before == abort_after

    g2 = probe_2.get("total_unclipped_grad_norm")
    g4 = probe_4.get("total_unclipped_grad_norm")
    probe_safe = (
        probe_2.get("finite_loss")
        and g2 is not None
        and g2 < GRAD_HARD
        and bool(np.isfinite(g2))
    )
    parent_ok = parent_model_hash == EXPECTED_PARENT_MODEL_HASH and parent_opt_hash == EXPECTED_PARENT_OPTIMIZER_HASH
    canonical_ok = canonical_hash == CANONICAL_HASH
    tok_ok = tok_hash == TOKENIZER_EXPECTED_SHA
    prep_ok = (
        corpus.get("ok")
        and parent_ok
        and canonical_ok
        and tok_ok
        and match_ok
        and single_token
        and class_consistent
        and mask_2.get("ok")
        and abort_untouched
        and run_id_unused
        and not cpt6.exists()
        and auth_env in ("", "OFF", None)
    )
    if not prep_ok:
        prep_status = "NOT READY"
    elif not probe_safe:
        prep_status = "PARTIAL"
    else:
        prep_status = "PASS"

    crep = corpus.get("class_report") or {}
    report = {
        "ok": prep_ok and probe_safe,
        "kind": "WRIM1_PLM_NEXT_FIRST_TOKEN_SCALE_PREPARATION_REPORT",
        "PREPARATION_STATUS": prep_status,
        "GRADIENT_PROBE": "SAFE" if probe_safe else "UNSAFE",
        "TRAINING_AUTHORIZATION": "OFF",
        "TRAINING_AUTHORIZATION_FINAL": "OFF",
        "optimizer_constructed": False,
        "optimizer_step": False,
        "STEPS_EXECUTED": 0,
        "TOKENS_EXECUTED": 0,
        "STEP_1_EXECUTED": "NO",
        "SECOND_RUN_CREATED": "NO",
        "MODEL_PROMOTED": "NO",
        "CANONICAL_CHANGED": "NO",
        "COMMIT": "NO",
        "PUSH": "NO",
        "DEPLOY": "NO",
        "CPT_000006_CREATED": "NO",
        "PLM_000002_RESUMED": "NO",
        "PLM_000002_ABORT_UNTOUCHED": abort_untouched,
        "PLM_000002_ABORT_SHA256_BEFORE": abort_before,
        "PLM_000002_ABORT_SHA256_AFTER": abort_after,
        "PROPOSED_RUN_ID": RUN_ID,
        "RUN_ID_UNUSED": run_id_unused,
        "EXPERIMENTAL_PARENT": EXPERIMENTAL_PARENT_CHECKPOINT,
        "PARENT_MODEL_HASH": parent_model_hash,
        "PARENT_MODEL_HASH_EXPECTED": EXPECTED_PARENT_MODEL_HASH,
        "PARENT_MODEL_HASH_OK": parent_model_hash == EXPECTED_PARENT_MODEL_HASH,
        "PARENT_OPTIMIZER_HASH": parent_opt_hash,
        "PARENT_CHECKPOINT_MANIFEST_HASH": parent_manifest_hash,
        "CANONICAL": CANONICAL_CHECKPOINT,
        "CANONICAL_HASH": canonical_hash,
        "CANONICAL_HASH_OK": canonical_ok,
        "TOKENIZER_ID": TOKENIZER_ID,
        "TOKENIZER_HASH": tok_hash,
        "TOKENIZER_HASH_OK": tok_ok,
        "CORPUS_ID": CORPUS_ID,
        "CORPUS_VERSION": CORPUS_VERSION,
        "CORPUS_HASH": corpus.get("CORPUS_HASH"),
        "MANIFEST_HASH": corpus.get("MANIFEST_HASH"),
        "TRAIN_HASH": corpus.get("TRAIN_HASH"),
        "VAL_HASH": corpus.get("VAL_HASH"),
        "CORPUS_REWRITTEN": False,
        "TRAIN_EXAMPLES": corpus.get("TRAIN_EXAMPLES"),
        "VAL_EXAMPLES": corpus.get("VAL_EXAMPLES"),
        "FIRST_TOKEN_CLASSES": crep.get("FIRST_TOKEN_CLASSES"),
        "FIRST_TOKEN_CLASS_COUNTS": crep.get("FIRST_TOKEN_CLASS_COUNTS"),
        "FIRST_TOKEN_TRAIN_VAL_OVERLAP": crep.get("FIRST_TOKEN_TRAIN_VAL_OVERLAP"),
        "FIRST_TOKEN_TRAIN_VAL_OVERLAP_MEANS": corpus.get("FIRST_TOKEN_TRAIN_VAL_OVERLAP_MEANS"),
        "TRAIN_VAL_CLASS_OVERLAP": corpus.get("TRAIN_VAL_CLASS_OVERLAP"),
        "TRAIN_VAL_EXAMPLE_OVERLAP": corpus.get("TRAIN_VAL_EXAMPLE_OVERLAP"),
        "TRAIN_VAL_PROMPT_OVERLAP": corpus.get("TRAIN_VAL_PROMPT_OVERLAP"),
        "LEAKAGE_SCAN": corpus.get("LEAKAGE_SCAN"),
        "BOUNDARY_VALIDATION": "PASS" if match_ok and single_token else "FAIL",
        "LOSS_MASK_VALIDATION": "PASS" if mask_2.get("ok") else "FAIL",
        "ANSWER_TOKEN_BOUNDARIES": boundary,
        "BOUNDARY_FIXTURES": fixtures,
        "MASK_2X": {k: v for k, v in mask_2.items()},
        "MASK_4X": {k: v for k, v in mask_4.items()},
        "FIRST_TOKEN_LOSS_WEIGHT": FIRST_TOKEN_LOSS_WEIGHT,
        "LATER_TOKEN_LOSS_WEIGHT": LATER_TOKEN_LOSS_WEIGHT,
        "EOS_LOSS_WEIGHT": EOS_LOSS_WEIGHT,
        "OPTIMIZER_STATE_POLICY": OPTIMIZER_STATE_POLICY,
        "LEARNING_RATE": LEARNING_RATE,
        "BETAS": list(BETAS),
        "WEIGHT_DECAY": 0.1,
        "GRAD_CLIP": GRAD_CLIP,
        "GRAD_WARN": GRAD_WARN,
        "GRAD_REVIEW": GRAD_REVIEW,
        "GRAD_HARD": GRAD_HARD,
        "SEED": SEED,
        "STEPS": STEPS,
        "TOKENS_PER_STEP": TOKENS_PER_STEP,
        "MAX_TOKENS": MAX_TOKENS,
        "MICRO_BATCH": MICRO_BATCH,
        "SEQ_LEN": SEQ_LEN,
        "STAGE3_PARENT_DRIFT_HARD": STAGE3_PARENT_DRIFT_HARD,
        "PARENT_STAGE3_DELTA_VS_WRIM0": PARENT_STAGE3_DELTA_VS_WRIM0,
        "PARENT_STAGE3_DRIFT_VS_STEP400": PARENT_STAGE3_DRIFT_VS_STEP400,
        "REMAINING_STAGE3_HEADROOM": REMAINING_STAGE3_HEADROOM,
        "GRADIENT_PROBE_4X": {k: v for k, v in probe_4.items() if k != "by_module"},
        "GRADIENT_PROBE_2X": {k: v for k, v in probe_2.items() if k != "by_module"},
        "GRADIENT_PROBE_2X_BY_MODULE": probe_2.get("by_module"),
        "GRADIENT_PROBE_4X_BY_MODULE": probe_4.get("by_module"),
        "HELDOUT_FORWARD_PARENT": heldout_forward,
        "PLM_000002_STEP0_HELDOUT": {
            k: plm2_parent_eval.get(k)
            for k in (
                "FIRST_TARGET_TOKEN_RANK",
                "FIRST_TARGET_TOKEN_PROBABILITY",
                "FIRST_TARGET_TOP1_COUNT",
                "FIRST_TARGET_TOP5_COUNT",
                "FIRST_TARGET_TOP10_COUNT",
                "GREEDY_FIRST_TOKEN_MATCH",
                "GREEDY_EXACT_ANSWER",
                "GREEDY_SHORT_ANSWER_CORRECT",
                "NEWLINE_ARGMAX_COUNT",
                "NEWLINE_ARGMAX_RATE",
                "NEWLINE_PROBABILITY",
                "TARGET_LOGIT",
                "NEWLINE_LOGIT",
                "TARGET_MINUS_NEWLINE_LOGIT_GAP",
                "RESPONSE_ENTRY_ENTROPY",
                "EOS_MEAN_RANK",
                "EOS_MEAN_PROBABILITY",
                "EOS_ARGMAX",
                "RAMBLE_RATE",
                "EMPTY_RESPONSE_RATE",
            )
        },
        "PLM_000002_COMPARISON": {
            "old_first_token_weight": PLM000002_FIRST_TOKEN_LOSS_WEIGHT,
            "new_first_token_weight": FIRST_TOKEN_LOSS_WEIGHT,
            "old_ce_mass_split": {
                "first": mask_4.get("weight_mass_first"),
                "later": mask_4.get("weight_mass_later"),
                "eos": mask_4.get("weight_mass_eos"),
            },
            "new_ce_mass_split": {
                "first": mask_2.get("weight_mass_first"),
                "later": mask_2.get("weight_mass_later"),
                "eos": mask_2.get("weight_mass_eos"),
            },
            "old_grad_norm_logged": ">=8.0",
            "old_grad_norm_reconstructed": g4,
            "new_grad_norm": g2,
            "logit_rank_baseline_deltas": {
                "note": "Parent weights; loss weight does not change forward eval. Deltas vs PLM-000002/step-0 should be ~0.",
                "FIRST_TARGET_RANK_delta": heldout_forward["FIRST_TARGET_RANK"] - float(plm2_parent_eval.get("FIRST_TARGET_TOKEN_RANK") or 0),
                "TARGET_LOGIT_delta": heldout_forward["TARGET_LOGIT"] - float(plm2_parent_eval.get("TARGET_LOGIT") or 0),
                "NEWLINE_LOGIT_delta": heldout_forward["NEWLINE_LOGIT"] - float(plm2_parent_eval.get("NEWLINE_LOGIT") or 0),
                "GAP_delta": heldout_forward["TARGET_NEWLINE_LOGIT_GAP"] - float(plm2_parent_eval.get("TARGET_MINUS_NEWLINE_LOGIT_GAP") or 0),
                "NEWLINE_ARGMAX_RATE_delta": heldout_forward["NEWLINE_ARGMAX_RATE"] - float(plm2_parent_eval.get("NEWLINE_ARGMAX_RATE") or 0),
            },
        },
        "CLASS_TOKEN_IDS": {k: sorted(v) for k, v in class_ids.items()},
        "timestamp": t0,
        "probe_finished": datetime.now(timezone.utc).isoformat(),
        "NEXT_COMMANDER_DECISION": (
            "WAIT FOR EXPLICIT AUTHORIZATION TO EXECUTE STEP 1."
            if probe_safe and prep_ok
            else "STOP. DO NOT TRAIN. Gradient probe UNSAFE or preparation not ready."
        ),
    }
    out = Path(DATA_ROOT) / PREP_REPORT_FILENAME
    _write_json(out, report)
    # Drop bulky row lists from returned object already done. Keep module maps in file.
    return report


if __name__ == "__main__":
    obj = main()
    slim = {k: v for k, v in obj.items() if k not in {"BOUNDARY_FIXTURES", "GRADIENT_PROBE_2X_BY_MODULE", "GRADIENT_PROBE_4X_BY_MODULE"}}
    print(json.dumps(slim, indent=2, default=str))
