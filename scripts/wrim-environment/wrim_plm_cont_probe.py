"""Continuation-curriculum gradient geometry probe.

Authorized: freeze analysis dataset + backward-only diagnostics (no optimizer).
NOT authorized: training, optimizer.step, PLM-000003, checkpoints, CPT, SFT.
"""
from __future__ import annotations

import hashlib
import json
import os
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from wrim_plm3_identity import (
    AUTHORIZE_ENV_NAME,
    CANONICAL_CHECKPOINT,
    CANONICAL_HASH,
    EXPECTED_PARENT_MODEL_HASH,
    EXPERIMENTAL_PARENT_CHECKPOINT,
    EXPERIMENTAL_PARENT_CKPT,
    GRAD_HARD,
    GRAD_REVIEW,
    NEWLINE_TOKEN_ID,
    SEED,
    TOKENIZER_EXPECTED_SHA,
)
from wrim_plm3_probe import _probe_one
from wrim_plm_cont_corpus import CORPUS_ID, CORPUS_VERSION, OLD_CORPUS_HASH, freeze_corpus


REPORT_NAME = "WRIM1_PLM_NEXT_CONTINUATION_CURRICULUM_PREPARATION_REPORT.json"
POLICIES = (
    ("A", 1.0),
    ("B", 1.5),
    ("C", 2.0),
)


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _attn_ffn(by_module: dict[str, float]) -> dict[str, float]:
    attn_sq = 0.0
    ffn_sq = 0.0
    for k, v in (by_module or {}).items():
        if k.endswith(".attn"):
            attn_sq += float(v) ** 2
        elif k.endswith(".ffn"):
            ffn_sq += float(v) ** 2
    return {"ATTENTION_GRAD": attn_sq ** 0.5, "FFN_GRAD": ffn_sq ** 0.5}


def _mass(n_first: int, n_later: int, n_eos: int, first_w: float) -> dict[str, float]:
    w_first = n_first * first_w
    w_later = n_later * 1.0
    w_eos = n_eos * 1.0
    tot = w_first + w_later + w_eos
    return {
        "FIRST_TOKEN_COUNT": n_first,
        "LATER_TOKEN_COUNT": n_later,
        "EOS_COUNT": n_eos,
        "WEIGHTED_FIRST_MASS": w_first / tot if tot else None,
        "WEIGHTED_LATER_MASS": w_later / tot if tot else None,
        "WEIGHTED_EOS_MASS": w_eos / tot if tot else None,
        "weight_sum": tot,
    }


def main() -> dict[str, Any]:
    import numpy as np
    import torch
    from safetensors.torch import load_file as load_safetensors_file
    from tokenizers import Tokenizer

    from run000007_preflight import resolve_dump_root, sha256_file
    from wrim_cpt_identity import LINUX_CKPT_ROOT, LINUX_DATA_ROOT
    from wrim_cpt_stage_b_identity import PROVISIONAL_STAGE_B_PARENT_CHECKPOINT
    from wrim_g20m import WRIM0Model
    from wrim_plm3_encode import (
        encode_example,
        mask_report,
        pack_train_stream,
        prefix_ids_for_inference,
        slice_batches,
        validate_inference_match,
    )
    from wrim_plm3_identity import DATA_ROOT
    from wrim_proven_load import disable_tf32
    from wrim_resumable_checkpoint import MODEL_NAME
    from wrim_target_only_loss import MASK_CAP_EOS, MASK_CAP_TARGET
    from wrim_plm3_encode import MASK_CAP_FIRST

    os.environ[AUTHORIZE_ENV_NAME] = "OFF"
    t0 = datetime.now(timezone.utc).isoformat()
    dump = resolve_dump_root(None)
    if dump is None:
        return {"ok": False, "reason": "dump_root_missing", "TRAINING_AUTHORIZATION": "OFF"}

    old_hash_path = Path(DATA_ROOT) / "WR-CORPUS-PLM-FIRST-TOKEN-1-v1.0.0" / "CORPUS_HASH.txt"
    old_before = old_hash_path.read_text(encoding="utf-8").strip()

    parent = Path(EXPERIMENTAL_PARENT_CKPT)
    exp_model = parent / MODEL_NAME
    parent_model_hash = sha256_file(exp_model)
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    tok_hash = sha256_file(tok_path)
    step400 = Path(LINUX_CKPT_ROOT) / PROVISIONAL_STAGE_B_PARENT_CHECKPOINT / MODEL_NAME
    canonical_hash = sha256_file(step400)

    plm3 = Path("/home/chosenone/.local/share/war-room-os/data/wrim-checkpoints/test-only/WRIM1-PLM-000003")
    tokenizer = Tokenizer.from_file(str(tok_path))
    corpus = freeze_corpus(tokenizer=tokenizer)
    if not corpus.get("ok"):
        return {"ok": False, "reason": "corpus_freeze_fail", "corpus": {k: v for k, v in corpus.items() if k not in {"train", "val", "encoded"}}, "TRAINING_AUTHORIZATION": "OFF"}

    train_rows = corpus["train"]
    val_rows = corpus["val"]
    encoded = [encode_example(tokenizer, r) for r in train_rows]
    val_encoded = [encode_example(tokenizer, r) for r in val_rows]
    match_ok = all(validate_inference_match(tokenizer, r, e) for r, e in zip(train_rows, encoded))
    match_ok = match_ok and all(validate_inference_match(tokenizer, r, e) for r, e in zip(val_rows, val_encoded))
    stream, mask = pack_train_stream(encoded)
    batches = slice_batches(stream, mask)
    x_np, y_np, m_np = batches[0]
    packed = mask_report(mask, first_w=1.0)
    batch_n_first = int((m_np == MASK_CAP_FIRST).sum())
    batch_n_later = int((m_np == MASK_CAP_TARGET).sum())
    batch_n_eos = int((m_np == MASK_CAP_EOS).sum())

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

    x = torch.tensor(x_np, dtype=torch.long, device=device)
    y = torch.tensor(y_np, dtype=torch.long, device=device)
    y_mask = torch.tensor(m_np, dtype=torch.int8, device=device)

    policy_rows = []
    for name, w in POLICIES:
        probe = _probe_one(model=model, x=x, y=y, y_mask=y_mask, first_w=w)
        model.zero_grad(set_to_none=True)
        mods = probe.get("by_module") or {}
        af = _attn_ffn(mods)
        mass = _mass(batch_n_first, batch_n_later, batch_n_eos, w)
        g = probe.get("total_unclipped_grad_norm")
        gate = "HARD"
        if g is not None and g < 6.5:
            gate = "OK_MARGIN"
        elif g is not None and g < GRAD_HARD:
            gate = "UNDER_HARD_THIN_MARGIN"
        policy_rows.append(
            {
                "POLICY": name,
                "FIRST_TOKEN_LOSS_WEIGHT": w,
                "LATER_TOKEN_LOSS_WEIGHT": 1.0,
                "EOS_LOSS_WEIGHT": 1.0,
                **mass,
                "FIRST_TOKEN_CE": probe.get("FIRST_TOKEN_CE"),
                "LATER_TOKEN_CE": probe.get("LATER_TOKEN_CE"),
                "EOS_CE": probe.get("EOS_CE"),
                "TOTAL_WEIGHTED_LOSS": probe.get("weighted_loss"),
                "UNCLIPPED_GRAD_L2": g,
                "TIED_EMBED_OUTPUT_GRAD": probe.get("embedding_output_head_tied_grad_norm"),
                "ATTENTION_GRAD": af["ATTENTION_GRAD"],
                "FFN_GRAD": af["FFN_GRAD"],
                "GRAD_GATE": gate,
                "clip_applied": False,
                "optimizer_step": False,
                "finite_loss": probe.get("finite_loss"),
                "batch_entry": probe.get("batch_entry"),
            }
        )

    ranks = []
    probs = []
    tgt_logits = []
    nl_logits = []
    nl_probs = []
    nl_argmax = 0
    with torch.inference_mode():
        for rec in val_rows:
            enc = encode_example(tokenizer, rec)
            prefix = prefix_ids_for_inference(tokenizer, rec["prompt"])
            lg = model(torch.tensor([prefix], dtype=torch.long, device=device))[0, -1].float()
            pr = torch.softmax(lg, dim=-1)
            tid = int(enc["first_target_id"])
            order = torch.argsort(lg, descending=True)
            hit = torch.nonzero(order == tid, as_tuple=False)
            ranks.append(int(hit[0].item()) + 1 if hit.numel() else None)
            probs.append(float(pr[tid].item()))
            tgt_logits.append(float(lg[tid].item()))
            nl_logits.append(float(lg[NEWLINE_TOKEN_ID].item()))
            nl_probs.append(float(pr[NEWLINE_TOKEN_ID].item()))
            if int(order[0].item()) == NEWLINE_TOKEN_ID:
                nl_argmax += 1
    n_val = max(1, len(val_rows))
    forward = {
        "n": len(val_rows),
        "FIRST_TARGET_RANK": float(sum(r for r in ranks if r is not None) / max(1, sum(1 for r in ranks if r is not None))),
        "FIRST_TARGET_PROBABILITY": float(sum(probs) / n_val),
        "NEWLINE_ARGMAX_COUNT": nl_argmax,
        "NEWLINE_ARGMAX_RATE": nl_argmax / n_val,
        "NEWLINE_PROBABILITY": float(sum(nl_probs) / n_val),
        "TARGET_LOGIT": float(sum(tgt_logits) / n_val),
        "NEWLINE_LOGIT": float(sum(nl_logits) / n_val),
        "TARGET_MINUS_NEWLINE_GAP": float(sum(t - n for t, n in zip(tgt_logits, nl_logits)) / n_val),
        "greedy_not_run": True,
        "note": "Parent weights, new prompts. Newline mode is expected to remain intact before training.",
    }

    safe = [p for p in policy_rows if p["UNCLIPPED_GRAD_L2"] is not None and p["UNCLIPPED_GRAD_L2"] < 8.0]
    margin_ok = [p for p in safe if p["UNCLIPPED_GRAD_L2"] < 6.5]
    if margin_ok:
        best = min(margin_ok, key=lambda p: (p["FIRST_TOKEN_LOSS_WEIGHT"], p["UNCLIPPED_GRAD_L2"]))
        primary = "CONTINUATION_CURRICULUM_GRAD_SAFE"
        best_name = f"POLICY_{best['POLICY']}"
        geom = None
    elif safe:
        best = min(safe, key=lambda p: (p["FIRST_TOKEN_LOSS_WEIGHT"], p["UNCLIPPED_GRAD_L2"]))
        primary = "CONTINUATION_CURRICULUM_GRAD_SAFE"
        best_name = f"POLICY_{best['POLICY']}_THIN_MARGIN"
        geom = None
    else:
        best = None
        primary = "CONTINUATION_CURRICULUM_STILL_UNSAFE"
        best_name = None
        geom = "FIRST_TOKEN_CURRICULUM_GEOMETRY_REQUIRES_REDESIGN"

    old_after = old_hash_path.read_text(encoding="utf-8").strip()
    crep = corpus["class_report"]
    cstat = corpus["continuation"]
    exo = corpus["example_overlap"]

    rec_dir = None
    if primary == "CONTINUATION_CURRICULUM_GRAD_SAFE" and best is not None:
        rec_dir = (
            f"Future bounded PLM-000003 may use POLICY {best['POLICY']} "
            f"(first-token weight {best['FIRST_TOKEN_LOSS_WEIGHT']}) on this continuation corpus. "
            "Do not start it in this mission."
        )
    else:
        rec_dir = (
            "Do not lower LR, weaken GRAD_HARD, or raise clip. Next analysis should isolate "
            "assistant-boundary control-state, tied output-head geometry, or supervised-position "
            "batch density — not another first-token multiplier on zero-later-token data."
        )

    report = {
        "ok": True,
        "kind": "WRIM1_PLM_NEXT_CONTINUATION_CURRICULUM_PREPARATION_REPORT",
        "PREPARATION_STATUS": "PASS" if corpus.get("ok") and match_ok and parent_model_hash == EXPECTED_PARENT_MODEL_HASH else "PARTIAL",
        "CANONICAL": CANONICAL_CHECKPOINT,
        "CANONICAL_HASH": canonical_hash,
        "CANONICAL_HASH_OK": canonical_hash == CANONICAL_HASH,
        "PARENT": EXPERIMENTAL_PARENT_CHECKPOINT,
        "PARENT_MODEL_HASH": parent_model_hash,
        "PARENT_MODEL_HASH_OK": parent_model_hash == EXPECTED_PARENT_MODEL_HASH,
        "TOKENIZER_HASH_OK": tok_hash == TOKENIZER_EXPECTED_SHA,
        "NEW_DATASET_ID": CORPUS_ID,
        "NEW_DATASET_VERSION": CORPUS_VERSION,
        "CORPUS_HASH": corpus["CORPUS_HASH"],
        "TRAIN_HASH": corpus["TRAIN_HASH"],
        "VAL_HASH": corpus["VAL_HASH"],
        "TRAIN_EXAMPLES": corpus["TRAIN_EXAMPLES"],
        "VAL_EXAMPLES": corpus["VAL_EXAMPLES"],
        "FIRST_TOKEN_CLASSES": crep["FIRST_TOKEN_CLASSES"],
        "FIRST_TOKEN_CLASS_COUNTS": crep["FIRST_TOKEN_CLASS_COUNTS"],
        "FIRST_TOKEN_CLASS_BALANCE": {
            "min_train": crep.get("min_train"),
            "max_train": crep.get("max_train"),
            "balance_ok": crep.get("balance_ok"),
        },
        "TRAIN_VAL_CLASS_OVERLAP": crep["FIRST_TOKEN_TRAIN_VAL_OVERLAP"],
        "TRAIN_VAL_PROMPT_OVERLAP": exo["TRAIN_VAL_PROMPT_OVERLAP"],
        "TRAIN_VAL_EXAMPLE_OVERLAP": exo["TRAIN_VAL_EXAMPLE_OVERLAP"],
        "LEAKAGE_SCAN": corpus["LEAKAGE_SCAN"],
        "MEAN_TARGET_LENGTH": cstat["MEAN_TARGET_LENGTH"],
        "MEDIAN_TARGET_LENGTH": cstat["MEDIAN_TARGET_LENGTH"],
        "LATER_TOKEN_DIVERSITY": cstat["LATER_TOKEN_DIVERSITY"],
        "CONTINUATION_STATS": {k: v for k, v in cstat.items() if k != "patterns_per_class"},
        "PATTERNS_PER_CLASS": cstat["patterns_per_class"],
        "OLD_SINGLE_TOKEN_CORPUS_UNTOUCHED": old_before == OLD_CORPUS_HASH and old_after == OLD_CORPUS_HASH,
        "BOUNDARY_VALIDATION": "PASS" if match_ok else "FAIL",
        "PACKED_STREAM_COUNTS": {
            "n_first": packed.get("n_first_supervised"),
            "n_later": packed.get("n_later_supervised"),
            "n_eos": packed.get("n_eos_supervised"),
            "n_prompt": packed.get("n_prompt_masked"),
        },
        "FIRST_BATCH_COUNTS": {
            "FIRST_TOKEN_COUNT": batch_n_first,
            "LATER_TOKEN_COUNT": batch_n_later,
            "EOS_COUNT": batch_n_eos,
        },
        "POLICIES": policy_rows,
        "POLICY_A_FIRST_WEIGHT": 1.0,
        "POLICY_A_GRAD": policy_rows[0]["UNCLIPPED_GRAD_L2"],
        "POLICY_A_WEIGHTED_MASS": {
            "first": policy_rows[0]["WEIGHTED_FIRST_MASS"],
            "later": policy_rows[0]["WEIGHTED_LATER_MASS"],
            "eos": policy_rows[0]["WEIGHTED_EOS_MASS"],
        },
        "POLICY_B_FIRST_WEIGHT": 1.5,
        "POLICY_B_GRAD": policy_rows[1]["UNCLIPPED_GRAD_L2"],
        "POLICY_B_WEIGHTED_MASS": {
            "first": policy_rows[1]["WEIGHTED_FIRST_MASS"],
            "later": policy_rows[1]["WEIGHTED_LATER_MASS"],
            "eos": policy_rows[1]["WEIGHTED_EOS_MASS"],
        },
        "POLICY_C_FIRST_WEIGHT": 2.0,
        "POLICY_C_GRAD": policy_rows[2]["UNCLIPPED_GRAD_L2"],
        "POLICY_C_WEIGHTED_MASS": {
            "first": policy_rows[2]["WEIGHTED_FIRST_MASS"],
            "later": policy_rows[2]["WEIGHTED_LATER_MASS"],
            "eos": policy_rows[2]["WEIGHTED_EOS_MASS"],
        },
        "BASELINE_PLM000001_GRAD": 7.157,
        "BASELINE_SINGLE_TOKEN_4X_GRAD": 13.824,
        "BASELINE_SINGLE_TOKEN_2X_GRAD": 12.615,
        "BEST_SAFE_POLICY": best_name,
        "GRADIENT_MARGIN": None if best is None else (GRAD_HARD - float(best["UNCLIPPED_GRAD_L2"])),
        "RECOMMENDED_FUTURE_POLICY": None if best is None else f"POLICY_{best['POLICY']}",
        "TIED_OUTPUT_GRAD_ANALYSIS": {
            "note": "tok_emb is tied to the output head. Compare to single-token 2x/4x probes where this term dominated (~9.1–9.9).",
            "by_policy": {p["POLICY"]: p["TIED_EMBED_OUTPUT_GRAD"] for p in policy_rows},
        },
        "FORWARD_GEOMETRY": forward,
        "FORWARD_GEOMETRY_MATCH": "PARENT_NEWLINE_MODE_INTACT" if forward["NEWLINE_ARGMAX_RATE"] == 1.0 else "PARENT_NEWLINE_MODE_NOT_100",
        "PRIMARY_DECISION": primary,
        "GEOMETRY_NOTE": geom,
        "NEXT_ANALYSIS_DIRECTION": rec_dir,
        "TRAINING_AUTHORIZATION": "OFF",
        "OPTIMIZER_CREATED": "NO",
        "OPTIMIZER_STEP": "NO",
        "WEIGHTS_CHANGED": "NO",
        "PLM_000003_CREATED": "NO" if not (plm3.is_dir() and (plm3 / "step-1").exists()) else "DIR_EXISTS",
        "CHECKPOINT_TREE_CREATED": "NO",
        "MODEL_PROMOTED": "NO",
        "CANONICAL_CHANGED": "NO",
        "COMMIT": "NO",
        "PUSH": "NO",
        "DEPLOY": "NO",
        "COMMANDER_DECISION_REQUIRED": "YES",
        "timestamp": t0,
        "finished": datetime.now(timezone.utc).isoformat(),
    }
    out = Path(DATA_ROOT) / REPORT_NAME
    slim_policies = [{k: v for k, v in p.items() if k != "batch_entry"} for p in policy_rows]
    dump_obj = dict(report)
    dump_obj["POLICIES"] = slim_policies
    out.write_text(json.dumps(dump_obj, indent=2) + "\n", encoding="utf-8")
    return report


if __name__ == "__main__":
    obj = main()
    print(json.dumps({k: v for k, v in obj.items() if k not in {"POLICIES", "PATTERNS_PER_CLASS", "FIRST_TOKEN_CLASS_COUNTS"}}, indent=2, default=str))
    if obj.get("POLICIES"):
        print("--- POLICIES ---")
        print(json.dumps(obj["POLICIES"], indent=2, default=str))
