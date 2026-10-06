"""WRIM1-RUN-000004 STAGE3A corrective 25-step pilot.

Commander-authorized. Fresh AdamW from WRIM-0. No step 26. No STAGE3B.
Does not overwrite WRIM1-RUN-000003. Does not train on evaluation suites.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn.functional as F
from safetensors.torch import load_file, save_file
from tokenizers import Tokenizer

from phase2_grid import parameter_displacement
from safetensors_model import load_model_state_from_safetensors
from stage1_pack import causal_batch_audit, slice_contiguous_batches
from stage2 import collect_optimizer_tensors
from stage2_eval import EVAL_SEED, greedy_generate
from stage2_pack import encode_corpus1_val_units, encode_rehearsal_val_units
from stage3_eval_baseline import (
    concat_units,
    continuation_metrics,
    encode_prompt_ids,
    extract_json_blob,
    measure_val_loss,
    score_item,
    teacher_force_nll_kl,
)
from stage3_eval_items import ITEMS as STAGE3_ITEMS
from stage3_runtime import (
    BASELINE_SHA,
    PARAM_COUNT,
    PARENT_SHA,
    STAGE3B_AUTHORIZATION,
    SUITE_SHA,
    TOKENIZER_SHA,
    disk_guard,
    utc_now,
    write_json,
)
from stage3a_adjudication import UNIQUENESS_FLOOR, evaluate_adjudication_items, rebuild_from_ids
from stage3a_adjudication_sets import ITEMS as ADJ_ITEMS
from stage3a_candidate_selection import constraint_bools
from stage3a_corrective_dev_sets import ITEMS as DEV_ITEMS
from stage3a_corrective_pack import (
    CORRECTIVE_MIX,
    NEEDED_TRAIN_TOKENS,
    STEPS,
    TOKENS_PER_STEP,
    TOTAL_PILOT_TOKENS,
    build_corrective_stream,
)
from stage3a_corrective_schedule import lr_corrective, run_schedule_unit_tests
from stage3a_run import (
    acquire_lock,
    cap_eval_overlay,
    disable_tf32,
    gpu_stats,
    load_baseline,
    release_lock,
    rng_snapshot,
    sha256_file,
)
from wrim_g20m import VOCAB_SIZE, WRIM0Model, expected_torch_keys

RUN_ID = "WRIM1-RUN-000004"
HISTORICAL_RUN_ID = "WRIM1-RUN-000003"
MAX_STEPS = 25
TOKEN_BUDGET = 102_400
SEQ_LEN = 512
MICRO_BATCH = 8
GRAD_CLIP = 1.0
PARENT_VAL0 = 8.890125
PARENT_VAL1 = 7.971308
DNLL_ABORT = 0.105
KL_ABORT = 0.018
VAL0_ABORT = PARENT_VAL0
VAL1_ABORT = 8.271308
CAP_ABORT_LE = 3
CAP_SUCCESS_GE = 5
SPECIAL_ABORT = 0.08
SPECIAL_SUCCESS_DELTA = 0.02
COLLAPSE_ABORT_DELTA = 4
EVAL_CHECKPOINTS = (0, 5, 10, 15, 20, 25)
TRAIN_SEED = 4004

ADAMW = {
    "name": "AdamW",
    "fused": False,
    "betas": [0.9, 0.95],
    "eps": 1e-8,
    "weight_decay": 0.1,
    "grad_clip": GRAD_CLIP,
    "fresh": True,
    "resume_stage3a_moments": False,
}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def tensors_sha256(state: dict[str, torch.Tensor]) -> str:
    h = hashlib.sha256()
    for k in sorted(state):
        t = state[k].detach().contiguous().cpu().float().numpy().tobytes()
        h.update(k.encode("utf-8"))
        h.update(t)
    return h.hexdigest()


def packing_meta(packed: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in packed.items() if k != "stream"}


def mix_matches_design(packed: dict[str, Any], design: dict[str, Any]) -> dict[str, Any]:
    want = (design.get("packing") or {}) if isinstance(design.get("packing"), dict) else {}
    got = packing_meta(packed)
    mismatches = []
    if got.get("packed_source_ids_sha256") != want.get("packed_source_ids_sha256"):
        mismatches.append("packed_source_ids_sha256")
    if got.get("selected_counts") != want.get("selected_counts"):
        mismatches.append("selected_counts")
    if int(got.get("n_alice_docs") or -1) != int(want.get("n_alice_docs") or -2):
        mismatches.append("n_alice_docs")
    got_pct = got.get("packed_token_percent") or {}
    want_pct = want.get("packed_token_percent") or design.get("mix_actual_percent") or {}
    for k, wv in want_pct.items():
        if abs(float(got_pct.get(k, -1)) - float(wv)) > 0.05:
            mismatches.append(f"pct:{k}")
    if abs(float(got.get("alice_frac_packed") or -1) - float(want.get("alice_frac_packed") or design.get("packing", {}).get("alice_frac_packed") or -2)) > 1e-4:
        mismatches.append("alice_frac_packed")
    if float(got.get("alice_frac_packed") or 0) > 0.035:
        mismatches.append("alice_cap_exceeded")
    if got.get("packing") != "DOCUMENT_MAJOR_CONTIGUOUS":
        mismatches.append("packing")
    if got.get("seed") != 4004:
        mismatches.append("seed")
    if int(got.get("stream_n_tokens") or 0) != NEEDED_TRAIN_TOKENS:
        mismatches.append("stream_n_tokens")
    return {"ok": not mismatches, "mismatches": mismatches, "got_pct": got_pct, "want_pct": want_pct}


def abort_body(*, reason: str, step: int | None, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "ok": False,
        "kind": "ABORT",
        "run_id": RUN_ID,
        "reason": reason,
        "step": step,
        "timestamp": utc_now(),
        "TRAINING_AUTHORIZATION": "OFF",
        "STAGE3B_AUTHORIZATION": "NO",
        "STAGE3B_EXECUTION_READINESS": False,
        "final_classification": "CORRECTIVE_STAGE3A_PILOT_ABORTED",
        "promotion_candidate": False,
        **(extra or {}),
    }


def reseed_eval() -> None:
    torch.manual_seed(EVAL_SEED)
    np.random.seed(EVAL_SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(EVAL_SEED)


def score_dev_item(item: dict[str, Any], gen: dict[str, Any]) -> dict[str, Any]:
    scores = score_item(item, gen, gen, gen)
    payload = item.get("reference_payload") or {}
    keys = list(payload.get("required_keys") or [])
    if "json_bool_null" in (item.get("scoring_functions") or []) and "hatch_ok" in keys:
        blob = extract_json_blob(gen.get("continuation") or "")
        parsed = None
        valid = False
        if blob:
            try:
                parsed = json.loads(blob)
                valid = True
            except Exception:
                valid = False
        scores["json_valid"] = valid
        scores["json_bool_null"] = bool(
            valid and isinstance(parsed, dict) and isinstance(parsed.get("hatch_ok"), bool) and parsed.get("slip") is None
        )
    return scores


def length_metrics(item: dict[str, Any], gen: dict[str, Any], length: int) -> dict[str, Any]:
    scores = score_dev_item(item, gen)
    metrics = continuation_metrics(gen)
    flags = constraint_bools(scores)
    constraint_ok = all(v for _k, v in flags) if flags else True
    uniq = float(gen.get("unique_ratio") or 0.0)
    looping = bool((uniq < 0.20 and int(gen.get("n_new") or 0) >= 16) or int(gen.get("max_run") or 0) >= 8)
    return {
        "length": length,
        "constraint_ok": constraint_ok,
        "constraint_flags": {k: v for k, v in flags},
        "json_valid": scores.get("json_valid"),
        "key_value_lines": scores.get("key_value_lines"),
        "list_lines": scores.get("list_lines"),
        "csv_row": scores.get("csv_row"),
        "entity_track": scores.get("entity_track"),
        "collapsed": gen.get("collapsed"),
        "special_loop": gen.get("special_loop"),
        "looping": looping,
        "premature_eos": gen.get("premature_eos") if "premature_eos" in gen else None,
        "unique_ratio": gen.get("unique_ratio"),
        "entropy": gen.get("entropy"),
        "max_run": gen.get("max_run"),
        "special_rate_0_8": metrics.get("special_rate_0_8"),
        "n_new": gen.get("n_new"),
        "continuation_prefix": (gen.get("continuation") or "")[:240],
    }


def eval_dev(*, model, tokenizer, device, long_cap: int) -> dict[str, Any]:
    rows = []
    for it in DEV_ITEMS:
        lengths = [int(n) for n in (it.get("eval_lengths") or [int(it.get("max_new_tokens") or 32)]) if int(n) <= long_cap]
        if not lengths:
            lengths = [32]
        max_len = max(lengths)
        full = greedy_generate(model, tokenizer, it["prompt_text"], device, max_new=max_len)
        by_len = {}
        for n in lengths:
            sliced = rebuild_from_ids(full, tokenizer, int(n))
            by_len[str(n)] = length_metrics(it, sliced, int(n))
        primary = by_len[str(max_len)]
        rows.append({"item_id": it["item_id"], "category": it["category"], "eval_lengths": lengths, "by_length": by_len, **primary})

    def take(length: int | None) -> list[dict[str, Any]]:
        out = []
        for r in rows:
            if length is None:
                out.append(r)
            elif str(length) in (r.get("by_length") or {}):
                out.append({**r, **r["by_length"][str(length)]})
        return out

    def agg(use: list[dict[str, Any]]) -> dict[str, Any]:
        if not use:
            return {"n": 0}
        json_n = [r for r in use if r.get("json_valid") is not None]
        kv_n = [r for r in use if r.get("key_value_lines") is not None]
        list_n = [r for r in use if r.get("list_lines") is not None]
        csv_n = [r for r in use if r.get("csv_row") is not None]
        inst = [r for r in use if str(r.get("category")) == "DEV_INSTRUCTION"]
        longish = [r for r in use if str(r.get("category")) in {"DEV_LONG_PROSE", "DEV_SEMANTIC", "DEV_REPETITION"}]
        ent = [r for r in use if r.get("entity_track") is not None]
        collapse_or_loop = int(sum(1 for r in use if r.get("collapsed") or r.get("looping")))
        return {
            "n": len(use),
            "constraint_ok_count": int(sum(1 for r in use if r.get("constraint_ok"))),
            "instruction_constraint_ok": int(sum(1 for r in inst if r.get("constraint_ok"))),
            "instruction_n": len(inst),
            "json_valid_count": int(sum(1 for r in json_n if r.get("json_valid") is True)),
            "json_n": len(json_n),
            "kv_ok_count": int(sum(1 for r in kv_n if r.get("key_value_lines") is True)),
            "list_ok_count": int(sum(1 for r in list_n if r.get("list_lines") is True)),
            "csv_ok_count": int(sum(1 for r in csv_n if r.get("csv_row") is True)),
            "n_collapsed": int(sum(1 for r in use if r.get("collapsed"))),
            "n_looping": int(sum(1 for r in use if r.get("looping"))),
            "n_special_loop": int(sum(1 for r in use if r.get("special_loop"))),
            "collapse_or_loop": collapse_or_loop,
            "mean_unique_ratio": float(sum(float(r.get("unique_ratio") or 0.0) for r in use) / max(1, len(use))),
            "mean_special_rate": float(sum(float(r.get("special_rate_0_8") or 0.0) for r in use) / max(1, len(use))),
            "entity_track_ok": int(sum(1 for r in ent if r.get("entity_track") is True)),
            "entity_track_n": len(ent),
            "longform_n": len(longish),
            "longform_unique": float(sum(float(r.get("unique_ratio") or 0.0) for r in longish) / max(1, len(longish))),
            "longform_collapse_or_loop": int(sum(1 for r in longish if r.get("collapsed") or r.get("looping"))),
        }

    a32 = agg(take(32))
    a128 = agg(take(128))
    a256 = agg(take(256))
    return {
        "suite_id": "WRIM-DEV-S3A-COR-000001",
        "development_only": True,
        "training_use": "FORBIDDEN",
        "n_items": len(rows),
        "agg_32": a32,
        "agg_128": a128,
        "agg_256": a256,
        "primary": agg(rows),
        "items": [{"item_id": r["item_id"], "category": r["category"], "constraint_ok": r.get("constraint_ok"), "json_valid": r.get("json_valid"), "collapsed": r.get("collapsed"), "looping": r.get("looping"), "unique_ratio": r.get("unique_ratio"), "special_rate_0_8": r.get("special_rate_0_8")} for r in rows],
    }


def eval_retention(
    *,
    model,
    tokenizer,
    device,
    dump_root: Path,
    frozen_items: list[dict[str, Any]],
    wrim0_logp: dict[str, torch.Tensor],
    c0: np.ndarray,
    c1: np.ndarray,
) -> dict[str, Any]:
    v0 = measure_val_loss(model, c0, device)
    v1 = measure_val_loss(model, c1, device)
    frozen_by_id = {r["item_id"]: r for r in frozen_items}
    deltas = []
    kls = []
    for it in STAGE3_ITEMS:
        prompt_ids = encode_prompt_ids(tokenizer, it["prompt_text"])
        frozen = frozen_by_id[it["item_id"]]
        frozen_ids = list((frozen.get("historical_32") or {}).get("new_ids") or [])
        parent_logp = wrim0_logp.get(it["item_id"])
        bundle = teacher_force_nll_kl(model, prompt_ids, frozen_ids, device, parent_logp)
        if parent_logp is None and bundle.get("log_softmax") is not None:
            wrim0_logp[it["item_id"]] = bundle["log_softmax"]
        frozen_nll = float(frozen.get("wrim0_anchor_nll_32"))
        delta = float(bundle["nll"] - frozen_nll) if math.isfinite(bundle["nll"]) else float("nan")
        deltas.append(delta)
        if bundle["kl"] is not None and math.isfinite(bundle["kl"]):
            kls.append(float(bundle["kl"]))
    cap = cap_eval_overlay(model, tokenizer, device, dump_root)
    return {
        "val_loss_corpus0": v0,
        "val_loss_corpus1": v1,
        "mean_wrim0_anchor_nll_delta": float(sum(deltas) / max(1, len(deltas))),
        "mean_kl_wrim0_to_candidate": float(sum(kls) / max(1, len(kls))) if kls else None,
        "cap_eval_0": cap,
        "historical_pass_count": cap.get("historical_pass_count"),
        "historical_binary": cap.get("historical_binary"),
        "nll_n": len(deltas),
    }


def snapshot_eval(
    *,
    model,
    tokenizer,
    device,
    dump_root: Path,
    frozen_items,
    wrim0_logp,
    c0,
    c1,
    parent_cpu,
    step: int,
    tokens: int,
    lr: float | None,
    train_loss: float | None,
    full_adj: bool,
    long_cap: int,
) -> dict[str, Any]:
    was = model.training
    model.eval()
    reseed_eval()
    ret = eval_retention(model=model, tokenizer=tokenizer, device=device, dump_root=dump_root, frozen_items=frozen_items, wrim0_logp=wrim0_logp, c0=c0, c1=c1)
    reseed_eval()
    dev = eval_dev(model=model, tokenizer=tokenizer, device=device, long_cap=long_cap)
    adj = None
    if full_adj:
        reseed_eval()
        adj = evaluate_adjudication_items(model, tokenizer, device, ADJ_ITEMS)
        adj = {
            "suite_id": "WRIM-EVAL-S3A-ADJ-000001",
            "evaluation_only": True,
            "n_items": adj.get("n_items"),
            "descriptive_pass_count": adj.get("descriptive_pass_count"),
            "constraint_ok_count": adj.get("constraint_ok_count"),
            "by_length": adj.get("by_length"),
            "by_category": adj.get("by_category"),
            "n_collapsed": adj.get("n_collapsed"),
            "json_valid_count": adj.get("json_valid_count"),
        }
    disp = parameter_displacement(model, parent_cpu)
    if was:
        model.train()
        for p in model.parameters():
            p.requires_grad_(True)
    primary = dev.get("primary") or {}
    a128 = dev.get("agg_128") or {}
    a256 = dev.get("agg_256") or {}
    return {
        "step": step,
        "tokens": tokens,
        "lr": lr,
        "train_loss": train_loss,
        **ret,
        "dev": {
            "constraint_ok_count": primary.get("constraint_ok_count"),
            "instruction_constraint_ok": primary.get("instruction_constraint_ok"),
            "json_valid_count": primary.get("json_valid_count"),
            "kv_ok_count": primary.get("kv_ok_count"),
            "list_ok_count": primary.get("list_ok_count"),
            "csv_ok_count": primary.get("csv_ok_count"),
            "n_collapsed": primary.get("n_collapsed"),
            "n_looping": primary.get("n_looping"),
            "collapse_or_loop": primary.get("collapse_or_loop"),
            "mean_unique_ratio": primary.get("mean_unique_ratio"),
            "mean_special_rate": primary.get("mean_special_rate"),
            "entity_track_ok": primary.get("entity_track_ok"),
            "unique_ratio_128": a128.get("mean_unique_ratio"),
            "collapse_or_loop_128": a128.get("collapse_or_loop"),
            "longform_unique_128": a128.get("longform_unique"),
            "unique_ratio_256": a256.get("mean_unique_ratio"),
            "collapse_or_loop_256": a256.get("collapse_or_loop"),
            "longform_unique_256": a256.get("longform_unique"),
            "full": dev,
        },
        "adjudication": adj,
        "parameter_displacement": disp,
        "special_token_mean_rate": float(primary.get("mean_special_rate") or 0.0),
    }


def hard_abort_reason(ev: dict[str, Any], parent0: dict[str, Any] | None) -> str | None:
    dnll = ev.get("mean_wrim0_anchor_nll_delta")
    kl = ev.get("mean_kl_wrim0_to_candidate")
    v0 = ev.get("val_loss_corpus0")
    v1 = ev.get("val_loss_corpus1")
    cap = int(ev.get("historical_pass_count") or 0)
    special = float(ev.get("special_token_mean_rate") or 0.0)
    if dnll is not None and math.isfinite(float(dnll)) and float(dnll) > DNLL_ABORT:
        return "dnll_gt_0.105"
    if kl is not None and math.isfinite(float(kl)) and float(kl) > KL_ABORT:
        return "kl_gt_0.018"
    if v0 is not None and float(v0) > VAL0_ABORT:
        return "val0_gt_parent"
    if v1 is not None and float(v1) > VAL1_ABORT:
        return "val1_gt_8.271308"
    if cap <= CAP_ABORT_LE:
        return "cap_le_3_of_6"
    if special > SPECIAL_ABORT:
        return "special_rate_gt_0.08"
    if parent0 is not None:
        p_combo = int(((parent0.get("dev") or {}).get("collapse_or_loop")) or 0)
        n_combo = int(((ev.get("dev") or {}).get("collapse_or_loop")) or 0)
        if n_combo >= p_combo + COLLAPSE_ABORT_DELTA:
            return "dev_collapse_or_loop_parent_plus_4"
    return None


def soft_degradations(ev: dict[str, Any], parent0: dict[str, Any]) -> list[str]:
    hits = []
    p = parent0.get("dev") or {}
    n = ev.get("dev") or {}
    if int(n.get("instruction_constraint_ok") or 0) <= int(p.get("instruction_constraint_ok") or 0) - 2:
        hits.append("instruction")
    if int(n.get("json_valid_count") or 0) < int(p.get("json_valid_count") or 0):
        hits.append("structured")
    pu = float(p.get("unique_ratio_128") or p.get("mean_unique_ratio") or 0.0)
    nu = float(n.get("unique_ratio_128") or n.get("mean_unique_ratio") or 0.0)
    if nu <= pu - 0.05:
        hits.append("longform_unique")
    if int(n.get("n_looping") or 0) >= int(p.get("n_looping") or 0) + 2:
        hits.append("repetition")
    if int(n.get("n_collapsed") or 0) >= int(p.get("n_collapsed") or 0) + 2:
        hits.append("collapse")
    if int(n.get("entity_track_ok") or 0) <= int(p.get("entity_track_ok") or 0) - 2:
        hits.append("semantic")
    return hits


def generation_axes(ev: dict[str, Any], parent0: dict[str, Any]) -> dict[str, Any]:
    p = parent0.get("dev") or {}
    n = ev.get("dev") or {}
    improved = []
    worsened = []
    # repetition
    loop_imp = int(n.get("n_looping") or 0) <= int(p.get("n_looping") or 0) - 2
    uniq_imp = float(n.get("unique_ratio_128") or n.get("mean_unique_ratio") or 0.0) >= float(p.get("unique_ratio_128") or p.get("mean_unique_ratio") or 0.0) + 0.03
    if loop_imp or uniq_imp:
        improved.append("repetition_resistance")
    elif int(n.get("n_looping") or 0) > int(p.get("n_looping") or 0) or float(n.get("mean_unique_ratio") or 0) < float(p.get("mean_unique_ratio") or 0) - 0.01:
        worsened.append("repetition_resistance")
    # continuity
    ent_imp = int(n.get("entity_track_ok") or 0) >= int(p.get("entity_track_ok") or 0) + 1
    if uniq_imp or ent_imp:
        improved.append("continuity_128_256")
    elif float(n.get("unique_ratio_128") or 0) < float(p.get("unique_ratio_128") or 0) - 0.01 or int(n.get("entity_track_ok") or 0) < int(p.get("entity_track_ok") or 0):
        worsened.append("continuity_128_256")
    # instruction
    if int(n.get("instruction_constraint_ok") or 0) >= int(p.get("instruction_constraint_ok") or 0) + 1:
        improved.append("instruction_following")
    elif int(n.get("instruction_constraint_ok") or 0) < int(p.get("instruction_constraint_ok") or 0):
        worsened.append("instruction_following")
    # structured
    struct_now = int(n.get("json_valid_count") or 0) + int(n.get("kv_ok_count") or 0) + int(n.get("list_ok_count") or 0) + int(n.get("csv_ok_count") or 0)
    struct_p = int(p.get("json_valid_count") or 0) + int(p.get("kv_ok_count") or 0) + int(p.get("list_ok_count") or 0) + int(p.get("csv_ok_count") or 0)
    json_imp = int(n.get("json_valid_count") or 0) >= int(p.get("json_valid_count") or 0) + 1
    if json_imp or struct_now >= struct_p + 1:
        improved.append("structured_output")
    elif struct_now < struct_p:
        worsened.append("structured_output")
    return {"improved": improved, "worsened": worsened}


def retention_ok(ev: dict[str, Any], parent0: dict[str, Any]) -> bool:
    dnll = float(ev.get("mean_wrim0_anchor_nll_delta") or 0)
    kl = float(ev.get("mean_kl_wrim0_to_candidate") or 0)
    v0 = float(ev.get("val_loss_corpus0") or 9e9)
    cap = int(ev.get("historical_pass_count") or 0)
    special = float(ev.get("special_token_mean_rate") or 0)
    p_special = float(parent0.get("special_token_mean_rate") or 0)
    return dnll < DNLL_ABORT and kl < KL_ABORT and v0 < VAL0_ABORT and cap >= CAP_SUCCESS_GE and special <= p_special + SPECIAL_SUCCESS_DELTA


def classify(*, aborted: bool, completed: bool, success: bool, improved: list[str], worsened: list[str]) -> str:
    if aborted:
        return "CORRECTIVE_STAGE3A_PILOT_ABORTED"
    if success:
        return "CORRECTIVE_STAGE3A_PILOT_HEALTHY"
    if improved and (not success):
        return "CORRECTIVE_STAGE3A_PILOT_MIXED"
    if completed:
        return "CORRECTIVE_STAGE3A_PILOT_FAILED"
    return "CORRECTIVE_STAGE3A_PILOT_ABORTED"


def save_weights(ckpt_dir: Path, model: WRIM0Model, step: int, tokens: int) -> dict[str, Any]:
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    model_cpu = {k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()}
    save_hash = tensors_sha256(model_cpu)
    path = ckpt_dir / "model.safetensors"
    save_file(model_cpu, str(path))
    reload_hash = tensors_sha256(load_file(str(path)))
    if reload_hash != save_hash:
        raise RuntimeError("checkpoint_write_hash_failure")
    return {
        "model_path": str(path),
        "model_sha256": sha256_file(path),
        "tensors_sha256": save_hash,
        "reload_ok": True,
        "step": step,
        "tokens": tokens,
    }


def save_step_ckpt(ckpt_dir: Path, model: WRIM0Model, optimizer: torch.optim.AdamW, step: int, tokens: int, lr: float, extra: dict[str, Any]) -> dict[str, Any]:
    meta = save_weights(ckpt_dir, model, step, tokens)
    opt_path = ckpt_dir / "optimizer.safetensors"
    save_file(collect_optimizer_tensors(optimizer, model), str(opt_path))
    meta["optimizer_path"] = str(opt_path)
    meta["optimizer_sha256"] = sha256_file(opt_path)
    write_json(ckpt_dir / "scheduler.json", {"step": step, "lr": lr, "formula": "corrective 1e-5 warmup-8 cosine-to-1e-6", "next_unauthorized_step": 26})
    write_json(ckpt_dir / "rng.json", rng_snapshot())
    write_json(ckpt_dir / "meta.json", extra)
    return meta


def compact(ev: dict[str, Any]) -> dict[str, Any]:
    d = ev.get("dev") or {}
    return {
        "step": ev.get("step"),
        "tokens": ev.get("tokens"),
        "lr": ev.get("lr"),
        "train_loss": ev.get("train_loss"),
        "dnll": ev.get("mean_wrim0_anchor_nll_delta"),
        "kl": ev.get("mean_kl_wrim0_to_candidate"),
        "val0": ev.get("val_loss_corpus0"),
        "val1": ev.get("val_loss_corpus1"),
        "cap": ev.get("historical_binary"),
        "cap_pass": ev.get("historical_pass_count"),
        "dev_looping": d.get("n_looping"),
        "dev_collapsed": d.get("n_collapsed"),
        "dev_collapse_or_loop": d.get("collapse_or_loop"),
        "dev_unique": d.get("mean_unique_ratio"),
        "dev_unique_128": d.get("unique_ratio_128"),
        "dev_unique_256": d.get("unique_ratio_256"),
        "dev_json_valid": d.get("json_valid_count"),
        "dev_instruction_ok": d.get("instruction_constraint_ok"),
        "dev_entity_ok": d.get("entity_track_ok"),
        "dev_kv_ok": d.get("kv_ok_count"),
        "dev_list_ok": d.get("list_ok_count"),
        "dev_csv_ok": d.get("csv_ok_count"),
        "special_rate": ev.get("special_token_mean_rate"),
        "adj_pass": ((ev.get("adjudication") or {}).get("descriptive_pass_count") if ev.get("adjudication") else None),
    }


def run_corrective(
    *,
    weights: Path,
    tokenizer_path: Path,
    dump_root: Path,
    baseline_path: Path,
    design_path: Path,
    eval_dir: Path,
    report_path: Path,
    ckpt_root: Path,
    authorize: bool,
) -> dict[str, Any]:
    started = utc_now()
    t_run0 = time.perf_counter()
    ckpt_root.mkdir(parents=True, exist_ok=True)
    lock_path = ckpt_root / "RUN.lock"
    evals_dir = ckpt_root / "evals"
    evals_dir.mkdir(parents=True, exist_ok=True)
    metrics_path = ckpt_root / "metrics.jsonl"

    def fail(reason: str, step: int | None = 0, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = abort_body(reason=reason, step=step, extra=extra)
        write_json(ckpt_root / "ABORT.json", payload)
        write_json(report_path, payload)
        return payload

    if not authorize:
        return fail("TRAINING_DENIED_missing_cli_authorization", 0)
    if STAGE3B_AUTHORIZATION != "NO":
        return fail("STAGE3B_must_remain_NO", 0)
    sched = run_schedule_unit_tests()
    if not sched["ok"]:
        return fail("schedule_self_test", 0, {"schedule": sched})
    if abs(lr_corrective(1) - 1.25e-6) > 1e-15 or abs(lr_corrective(8) - 1e-5) > 1e-15 or abs(lr_corrective(25) - 1e-6) > 1e-15:
        return fail("lr_schedule_mismatch", 0)

    if not design_path.exists():
        return fail("missing_corrective_design_report", 0)
    design = json.loads(design_path.read_text(encoding="utf-8"))
    if design.get("run_id") != RUN_ID or design.get("ok") is not True:
        return fail("design_not_ready", 0, {"run_id": design.get("run_id")})

    parent_sha = sha256_file(weights)
    tok_sha = sha256_file(tokenizer_path)
    mismatches = []
    if parent_sha != PARENT_SHA:
        mismatches.append("parent_sha")
    if tok_sha != TOKENIZER_SHA:
        mismatches.append("tokenizer_sha")
    baseline = load_baseline(baseline_path)
    if not baseline["hash_ok"]:
        mismatches.append("baseline_sha")
    disk0 = disk_guard(ckpt_root)
    lock = acquire_lock(lock_path)
    if not lock["ok"]:
        return fail("conflicting_active_wrim_training_pid", 0, lock)
    if mismatches:
        release_lock(lock_path)
        return fail("parent_tokenizer_data_sha_mismatch", 0, {"mismatches": mismatches, "parent": parent_sha, "tokenizer": tok_sha})
    if disk0["hard_stop"]:
        release_lock(lock_path)
        return fail("disk_safety_failure", 0, {"disk": disk0})
    if (ckpt_root.parent / HISTORICAL_RUN_ID).exists() and ckpt_root.resolve() == (ckpt_root.parent / HISTORICAL_RUN_ID).resolve():
        release_lock(lock_path)
        return fail("refuses_to_overwrite_000003", 0)

    disable_tf32()
    torch.manual_seed(TRAIN_SEED)
    np.random.seed(TRAIN_SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(TRAIN_SEED)
        torch.cuda.reset_peak_memory_stats()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tokenizer = Tokenizer.from_file(str(tokenizer_path))

    print("[corrective] rebuild stream and verify mix vs frozen design", flush=True)
    packed = build_corrective_stream(dump_root=dump_root, tokenizer=tokenizer)
    mix_check = mix_matches_design(packed, design)
    if not mix_check["ok"]:
        release_lock(lock_path)
        return fail("corrective_stream_mismatch_vs_design", 0, {"mix_check": mix_check})
    stream = packed["stream"]
    if int(stream.size) != NEEDED_TRAIN_TOKENS:
        release_lock(lock_path)
        return fail("packing_integrity_failure", 0, {"n": int(stream.size)})
    stream_path = ckpt_root / "corrective-stream.npy"
    np.save(stream_path, stream)
    stream_sha = sha256_bytes(stream.tobytes())
    if packed.get("stream_sha256") != stream_sha:
        release_lock(lock_path)
        return fail("packing_integrity_failure", 0, {"stream_sha": stream_sha})
    write_json(ckpt_root / "packing-audit.json", {**packing_meta(packed), "stream_path": str(stream_path), "stream_persisted": True, "mix_check": mix_check, "eval_suites_in_stream": False})
    batches = slice_contiguous_batches(stream, MAX_STEPS, MICRO_BATCH, SEQ_LEN)
    causal = causal_batch_audit(batches, stream)
    if not causal.get("ok") or len(batches) != 25:
        release_lock(lock_path)
        return fail("packing_integrity_failure", 0, {"causal": causal, "n_batches": len(batches)})

    state, coverage = load_model_state_from_safetensors(weights)
    if set(state) != set(expected_torch_keys()):
        release_lock(lock_path)
        return fail("invalid_architecture_or_tensor_shape", 0, {"coverage": coverage})
    model = WRIM0Model()
    model.load_state_dict(state, strict=True)
    n_params = int(sum(p.numel() for p in model.parameters()))
    if n_params != PARAM_COUNT:
        release_lock(lock_path)
        return fail("invalid_architecture_or_tensor_shape", 0, {"n_params": n_params})
    parent_cpu = {k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()}
    model.to(device)
    model.freeze_inference()
    c0 = concat_units(encode_rehearsal_val_units(tokenizer, dump_root))
    c1 = concat_units(encode_corpus1_val_units(tokenizer, dump_root))
    frozen_items = baseline["obj"]["items"]
    wrim0_logp: dict[str, torch.Tensor] = {}

    write_json(
        ckpt_root / "parent-pointer.json",
        {
            "kind": "PARENT_POINTER_ONLY",
            "step": 0,
            "parent_id": "WRIM-0",
            "parent_sha256": parent_sha,
            "weights_path": str(weights),
            "not_a_trained_checkpoint": True,
            "optimizer_state_present": False,
            "run_id": RUN_ID,
        },
    )

    print("[corrective] step-0 eval", flush=True)
    eval0 = snapshot_eval(
        model=model,
        tokenizer=tokenizer,
        device=device,
        dump_root=dump_root,
        frozen_items=frozen_items,
        wrim0_logp=wrim0_logp,
        c0=c0,
        c1=c1,
        parent_cpu=parent_cpu,
        step=0,
        tokens=0,
        lr=None,
        train_loss=None,
        full_adj=True,
        long_cap=256,
    )
    write_json(evals_dir / "step-0.json", eval0)
    write_json(evals_dir / "step-0.compact.json", compact(eval0))
    if abs(float(eval0["val_loss_corpus0"]) - PARENT_VAL0) > 0.02:
        release_lock(lock_path)
        return fail("step0_val0_did_not_reproduce", 0, {"val0": eval0["val_loss_corpus0"]})
    pre = hard_abort_reason(eval0, None)
    if pre and pre not in {"dev_collapse_or_loop_parent_plus_4"}:
        # parent itself may have weak generation; do not abort the pilot before step 1 on DEV collapse vs itself
        if pre.startswith("cap_") or pre.startswith("val") or pre.startswith("dnll") or pre.startswith("kl") or pre.startswith("special"):
            release_lock(lock_path)
            return fail(pre, 0, {"eval": compact(eval0)})

    model.enable_training()
    model.to(device)
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=lr_corrective(1),
        betas=tuple(ADAMW["betas"]),
        eps=ADAMW["eps"],
        weight_decay=ADAMW["weight_decay"],
        fused=False,
    )
    metrics: list[dict[str, Any]] = []
    evals: dict[int, dict[str, Any]] = {0: eval0}
    ckpts: dict[int, dict[str, Any]] = {0: {"kind": "PARENT_POINTER_ONLY", "parent_sha256": parent_sha, "weights_path": str(weights)}}
    aborted = False
    abort_reason = None
    last_valid_step = 0
    tokens_seen = 0

    def persist_metric(row: dict[str, Any]) -> None:
        metrics.append(row)
        with metrics_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, separators=(",", ":")) + "\n")

    try:
        for step in range(1, MAX_STEPS + 1):
            if step > MAX_STEPS:
                aborted = True
                abort_reason = "optimizer_step_26_forbidden"
                write_json(ckpt_root / "ABORT.json", abort_body(reason=abort_reason, step=step))
                break
            disk = disk_guard(ckpt_root)
            if disk["hard_stop"]:
                aborted = True
                abort_reason = "disk_safety_failure"
                write_json(ckpt_root / "ABORT.json", abort_body(reason=abort_reason, step=step, extra={"disk": disk}))
                break
            lr = lr_corrective(step)
            for pg in optimizer.param_groups:
                pg["lr"] = lr
            x_np, y_np = batches[step - 1]
            x = torch.tensor(x_np, dtype=torch.long, device=device)
            y = torch.tensor(y_np, dtype=torch.long, device=device)
            t0 = time.perf_counter()
            optimizer.zero_grad(set_to_none=True)
            logits = model(x)
            loss = F.cross_entropy(logits.reshape(-1, VOCAB_SIZE), y.reshape(-1))
            if not bool(torch.isfinite(loss).item()):
                aborted = True
                abort_reason = "NaN_or_Inf"
                write_json(ckpt_root / "ABORT.json", abort_body(reason=abort_reason, step=step, extra={"loss": str(loss)}))
                break
            loss.backward()
            grads_finite = True
            grad_sq = 0.0
            for p in model.parameters():
                if p.grad is None or not torch.isfinite(p.grad).all():
                    grads_finite = False
                    break
                grad_sq += float(p.grad.detach().float().pow(2).sum().item())
            if not grads_finite:
                aborted = True
                abort_reason = "NaN_or_Inf"
                write_json(ckpt_root / "ABORT.json", abort_body(reason=abort_reason, step=step))
                break
            grad_norm = math.sqrt(grad_sq)
            before = [p.detach().clone() for p in model.parameters()]
            clip = torch.nn.utils.clip_grad_norm_(model.parameters(), GRAD_CLIP)
            clipped = bool(float(clip) > GRAD_CLIP + 1e-12) or grad_norm > GRAD_CLIP
            optimizer.step()
            tokens_seen += TOKENS_PER_STEP
            if tokens_seen > TOKEN_BUDGET:
                aborted = True
                abort_reason = "token_budget_exceeded"
                write_json(ckpt_root / "ABORT.json", abort_body(reason=abort_reason, step=step, extra={"tokens_seen": tokens_seen}))
                break
            delta_sq = 0.0
            for p, b in zip(model.parameters(), before):
                delta_sq += float((p.detach() - b).float().pow(2).sum().item())
            update_norm = math.sqrt(delta_sq)
            elapsed = time.perf_counter() - t0
            last_valid_step = step
            persist_metric(
                {
                    "step": step,
                    "tokens": tokens_seen,
                    "loss": float(loss.item()),
                    "lr": lr,
                    "grad_norm": grad_norm,
                    "clip": float(clip),
                    "clipped": clipped,
                    "update_norm": update_norm,
                    "elapsed_s": elapsed,
                    "timestamp": utc_now(),
                }
            )
            print(json.dumps({"step": step, "loss": float(loss.item()), "lr": lr, "grad_norm": grad_norm, "tokens": tokens_seen}), flush=True)
            if step in EVAL_CHECKPOINTS:
                try:
                    ckpts[step] = save_step_ckpt(
                        ckpt_root / f"step-{step}",
                        model,
                        optimizer,
                        step,
                        tokens_seen,
                        lr,
                        {"loss": float(loss.item()), "grad_norm": grad_norm, "clipped": clipped, "timestamp": utc_now()},
                    )
                except Exception as exc:
                    aborted = True
                    abort_reason = "checkpoint_write_hash_failure"
                    write_json(ckpt_root / "ABORT.json", abort_body(reason=abort_reason, step=step, extra={"error": str(exc)}))
                    break
                print(f"[corrective] eval step {step}", flush=True)
                ev = snapshot_eval(
                    model=model,
                    tokenizer=tokenizer,
                    device=device,
                    dump_root=dump_root,
                    frozen_items=frozen_items,
                    wrim0_logp=wrim0_logp,
                    c0=c0,
                    c1=c1,
                    parent_cpu=parent_cpu,
                    step=step,
                    tokens=tokens_seen,
                    lr=lr,
                    train_loss=float(loss.item()),
                    full_adj=(step == 25),
                    long_cap=256,
                )
                evals[step] = ev
                write_json(evals_dir / f"step-{step}.json", ev)
                write_json(evals_dir / f"step-{step}.compact.json", compact(ev))
                har = hard_abort_reason(ev, eval0)
                if har:
                    aborted = True
                    abort_reason = har
                    write_json(ckpt_root / "ABORT.json", abort_body(reason=abort_reason, step=step, extra={"eval": compact(ev)}))
                    reseed_eval()
                    adj_abort = evaluate_adjudication_items(model, tokenizer, device, ADJ_ITEMS)
                    write_json(evals_dir / "abort-adjudication.json", {"descriptive_pass_count": adj_abort.get("descriptive_pass_count"), "by_length": adj_abort.get("by_length"), "by_category": adj_abort.get("by_category")})
                    break
                soft = soft_degradations(ev, eval0)
                if len(soft) >= 2:
                    aborted = True
                    abort_reason = "soft_stop:" + ",".join(soft)
                    write_json(ckpt_root / "ABORT.json", abort_body(reason=abort_reason, step=step, extra={"soft": soft, "eval": compact(ev)}))
                    reseed_eval()
                    adj_abort = evaluate_adjudication_items(model, tokenizer, device, ADJ_ITEMS)
                    write_json(evals_dir / "abort-adjudication.json", {"descriptive_pass_count": adj_abort.get("descriptive_pass_count"), "by_length": adj_abort.get("by_length"), "by_category": adj_abort.get("by_category")})
                    break
        if (not aborted) and last_valid_step == 25 and 25 not in evals:
            # should not happen; eval is inside checkpoint branch
            pass
    except Exception as exc:
        aborted = True
        abort_reason = "runtime_integrity_failure"
        write_json(ckpt_root / "ABORT.json", abort_body(reason=abort_reason, step=last_valid_step, extra={"error": str(exc)}))
    finally:
        release_lock(lock_path)

    final_ev = evals.get(25) or evals.get(last_valid_step) or eval0
    axes = generation_axes(final_ev, eval0) if last_valid_step > 0 else {"improved": [], "worsened": []}
    ret_ok = retention_ok(final_ev, eval0)
    success = (not aborted) and last_valid_step == 25 and len(axes["improved"]) >= 2 and ret_ok
    completed = (not aborted) and last_valid_step == 25
    classification = classify(aborted=aborted, completed=completed, success=success, improved=axes["improved"], worsened=axes["worsened"])
    continuation = "CORRECTIVE_STAGE3A_CONTINUATION_READY" if classification == "CORRECTIVE_STAGE3A_PILOT_HEALTHY" else "NO"
    ended = utc_now()

    def traj(key: str) -> list[dict[str, Any]]:
        out = []
        for s in sorted(evals):
            row = compact(evals[s])
            out.append({"step": s, "value": row.get(key)})
        return out

    payload = {
        "ok": completed and not aborted,
        "kind": "STAGE3A_CORRECTIVE_PILOT",
        "run_id": RUN_ID,
        "historical_run_id_unmodified": HISTORICAL_RUN_ID,
        "parent": "WRIM-0",
        "parent_sha256": parent_sha,
        "tokenizer_sha256": tok_sha,
        "corrective_stream_sha256": stream_sha,
        "packed_source_ids_sha256": packed.get("packed_source_ids_sha256"),
        "realized_mix_percent": packed.get("packed_token_percent"),
        "alice_frac_packed": packed.get("alice_frac_packed"),
        "optimizer": ADAMW,
        "lr_schedule": sched["formula"],
        "start_timestamp": started,
        "end_timestamp": ended,
        "elapsed_s": round(time.perf_counter() - t_run0, 3),
        "optimizer_steps": last_valid_step if not (aborted and last_valid_step == 0) else last_valid_step,
        "optimizer_steps_executed": last_valid_step,
        "tokens_trained": tokens_seen,
        "abort_occurred": aborted,
        "abort_reason": abort_reason,
        "step_metrics": metrics,
        "checkpoint_hashes": ckpts,
        "evals": {str(k): compact(v) for k, v in evals.items()},
        "eval_step0": compact(eval0),
        "eval_step5": compact(evals[5]) if 5 in evals else None,
        "eval_step10": compact(evals[10]) if 10 in evals else None,
        "eval_step15": compact(evals[15]) if 15 in evals else None,
        "eval_step20": compact(evals[20]) if 20 in evals else None,
        "eval_step25": compact(evals[25]) if 25 in evals else None,
        "dnll_trajectory": traj("dnll"),
        "kl_trajectory": traj("kl"),
        "val0_trajectory": traj("val0"),
        "val1_trajectory": traj("val1"),
        "cap_trajectory": traj("cap"),
        "repetition_trajectory": traj("dev_looping"),
        "collapse_trajectory": traj("dev_collapsed"),
        "structured_output_trajectory": traj("dev_json_valid"),
        "instruction_trajectory": traj("dev_instruction_ok"),
        "longform_trajectory": traj("dev_unique_128"),
        "special_token_trajectory": traj("special_rate"),
        "dev_results": (final_ev.get("dev") or {}),
        "final_adjudication": (evals.get(25) or evals.get(last_valid_step) or {}).get("adjudication") if not aborted else (json.loads((evals_dir / "abort-adjudication.json").read_text(encoding="utf-8")) if (evals_dir / "abort-adjudication.json").exists() else (final_ev.get("adjudication"))),
        "generation_axes_improved": axes["improved"],
        "generation_axes_worsened": axes["worsened"],
        "retention_ok": ret_ok,
        "success_criteria_met": success,
        "final_classification": classification,
        "continuation_recommendation": continuation,
        "TRAINING_AUTHORIZATION": "OFF",
        "STAGE3B_AUTHORIZATION": "NO",
        "STAGE3B_EXECUTION_READINESS": False,
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "QWEN_INTELLIGENCE_CLASS": "THIRD_PARTY_MODEL_RUNNING_LOCALLY",
        "RAEL_STATUS": "NOT_IMPLEMENTED",
        "WRIM1_RUN_000003_unchanged": True,
        "nothing_pushed": True,
        "nothing_deployed": True,
        "promotion_candidate": False,
        "hardware": gpu_stats(),
        "device": str(device),
    }
    write_json(report_path, payload)
    print(json.dumps({k: payload.get(k) for k in ("ok", "final_classification", "optimizer_steps_executed", "tokens_trained", "abort_occurred", "abort_reason", "generation_axes_improved", "success_criteria_met", "TRAINING_AUTHORIZATION")}, indent=2), flush=True)
    return payload


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--weights", required=True)
    p.add_argument("--tokenizer", required=True)
    p.add_argument("--dump-root", required=True)
    p.add_argument("--baseline", required=True)
    p.add_argument("--design", required=True)
    p.add_argument("--eval-dir", required=True)
    p.add_argument("--report", required=True)
    p.add_argument("--ckpt-dir", required=True)
    p.add_argument("--authorize-wrim1-run-000004", action="store_true")
    args = p.parse_args()
    ckpt = Path(args.ckpt_dir)
    if "WRIM1-RUN-000003" in str(ckpt):
        print(json.dumps({"ok": False, "error": "refuses_to_write_000003"}), flush=True)
        return 2
    out = run_corrective(
        weights=Path(args.weights),
        tokenizer_path=Path(args.tokenizer),
        dump_root=Path(args.dump_root),
        baseline_path=Path(args.baseline),
        design_path=Path(args.design),
        eval_dir=Path(args.eval_dir),
        report_path=Path(args.report),
        ckpt_root=ckpt,
        authorize=bool(args.authorize_wrim1_run_000004),
    )
    if out.get("optimizer_steps_executed", 0) > 25:
        return 3
    if Path(ckpt / "step-26").exists():
        return 3
    return 0 if (out.get("final_classification") and out.get("TRAINING_AUTHORIZATION") == "OFF") else 1


if __name__ == "__main__":
    sys.exit(main())
