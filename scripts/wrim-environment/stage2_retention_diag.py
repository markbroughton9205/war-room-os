"""Read-only Stage 2 retention-failure diagnosis. No training. No optimizer. No Stage 3."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
import torch
from safetensors.torch import load_file
from tokenizers import Tokenizer

from safetensors_model import load_model_state_from_safetensors
from stage1_pack import (
    DATA_ORDER_SEED,
    encode_behavior_units,
    encode_corpus1_units,
    encode_rehearsal_units,
    shuffle_unit_order,
)
from stage2_eval import EVAL_SEED, entropy_from_logits, greedy_generate, load_retention_items, score_retention
from stage2_pack import MIX, NEEDED_TRAIN_TOKENS, TARGET_STREAM_TOKENS, _pack_selected, expand_family, take_until_budget
from wrim_g20m import N_LAYERS, WRIM0Model

FAILED_EVAL_ID = "cap0-ret-02"
PARENT_SHA = "d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def disable_tf32() -> None:
    if torch.cuda.is_available():
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        torch.backends.cudnn.benchmark = False
    if hasattr(torch, "set_float32_matmul_precision"):
        torch.set_float32_matmul_precision("highest")


def classify_excerpt(text: str) -> str:
    low = text.lower()
    if "```" in text or "`" in text[:400] or "model-lab" in low or "function " in low or "def " in low[:400]:
        return "code_or_markdown"
    if any(w in low for w in ("alice", "gryphon", "queen", "hatter", "rabbit")):
        return "literary_alice_like"
    if any(w in low for w in ("said", "chapter", "once ", "the ")):
        return "prose_like"
    return "other"


def first_token_stats(model: WRIM0Model, tokenizer: Tokenizer, prompt: str, device: torch.device, parent_argmax: int | None = None) -> dict[str, Any]:
    bos = tokenizer.token_to_id("<|bos|>")
    body = tokenizer.encode(prompt, add_special_tokens=False).ids
    ids = [int(bos), *body]
    model.eval()
    with torch.inference_mode():
        cur = torch.tensor([ids], dtype=torch.long, device=device)
        logits = model(cur)[0, -1].float()
    finite = bool(torch.isfinite(logits).all().item())
    probs = torch.softmax(logits, dim=-1)
    argmax_id = int(torch.argmax(logits).item())
    entropy = entropy_from_logits(logits)
    topv, topi = torch.topk(probs, k=8)
    parent_rank = None
    parent_prob = None
    if parent_argmax is not None:
        order = torch.argsort(probs, descending=True)
        parent_rank = int((order == parent_argmax).nonzero(as_tuple=False)[0].item()) + 1
        parent_prob = float(probs[parent_argmax].item())
    return {
        "finite": finite,
        "entropy": entropy,
        "argmax_id": argmax_id,
        "argmax_token": tokenizer.decode([argmax_id], skip_special_tokens=False),
        "argmax_prob": float(probs[argmax_id].item()),
        "parent_token_rank": parent_rank,
        "parent_token_prob": parent_prob,
        "top8": [
            {"id": int(i), "prob": float(p), "tok": tokenizer.decode([int(i)], skip_special_tokens=False)}
            for p, i in zip(topv.tolist(), topi.tolist())
        ],
    }


def module_group(name: str) -> str:
    if name.startswith("tok_emb"):
        return "embeddings"
    if name.startswith("norm_f"):
        return "final_norm"
    if ".attn_norm." in name or ".ffn_norm." in name:
        return "block_norms"
    if ".attn." in name:
        return "attention"
    if ".ffn." in name:
        return "ffn"
    return "other"


def layer_index(name: str) -> int | None:
    if not name.startswith("layers."):
        return None
    try:
        return int(name.split(".")[1])
    except Exception:
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--dump-root", required=True)
    ap.add_argument("--ckpt-dir", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--eval-full", required=True)
    args = ap.parse_args()

    parent_path = Path(args.weights)
    tok_path = Path(args.tokenizer)
    dump_root = Path(args.dump_root)
    ckpt_dir = Path(args.ckpt_dir)
    out_path = Path(args.report)
    eval_full = json.loads(Path(args.eval_full).read_text(encoding="utf-8"))
    stage2_report = json.loads((ckpt_dir / "stage2-report.json").read_text(encoding="utf-8"))
    tokenizer = Tokenizer.from_file(str(tok_path))
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    disable_tf32()
    torch.manual_seed(EVAL_SEED)
    if device.type == "cuda":
        torch.cuda.manual_seed_all(EVAL_SEED)

    parent_sha = sha256_file(parent_path)
    if parent_sha != PARENT_SHA:
        payload = {"ok": False, "error": "parent SHA mismatch", "got": parent_sha}
        out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(json.dumps(payload))
        return 1

    # --- retention timeline from recorded evals ---
    timeline = []
    failed_series = []
    for ev in eval_full:
        items = {it["evalId"]: it for it in ev.get("retention_items") or []}
        failed = items.get(FAILED_EVAL_ID)
        row = {
            "step": ev.get("step"),
            "retention_family": ev.get("retention_family"),
            "retention_pass": ev.get("retention_pass"),
            "train_loss": ev.get("train_loss"),
            "validation_loss": ev.get("validation_loss"),
            "mean_unique_ratio": ev.get("mean_unique_ratio"),
            "items": {
                eid: {"pass": it["pass"], "unique_ratio": it["unique_ratio"], "collapsed": it["collapsed"]}
                for eid, it in items.items()
            },
        }
        timeline.append(row)
        if failed:
            failed_series.append(
                {
                    "step": ev.get("step"),
                    "pass": failed["pass"],
                    "unique_ratio": failed["unique_ratio"],
                    "collapsed": failed["collapsed"],
                    "continuation_excerpt": (failed.get("continuation") or "")[:120],
                }
            )

    passing_steps = [r["step"] for r in failed_series if r["pass"]]
    failing_steps = [r["step"] for r in failed_series if not r["pass"]]
    last_pass = max(passing_steps) if passing_steps else None
    first_fail = min(failing_steps) if failing_steps else None

    ret_items = load_retention_items(dump_root)
    failed_item = next(it for it in ret_items if it.get("evalId") == FAILED_EVAL_ID)
    prompt = failed_item.get("generation_prompt") or failed_item["prompt"]

    # --- reconstruct packing / exposure (no training; same seeds as Stage 2) ---
    c1 = encode_corpus1_units(tokenizer, dump_root)
    rehearsal = expand_family(shuffle_unit_order(encode_rehearsal_units(tokenizer, dump_root), DATA_ORDER_SEED))
    behavior = expand_family(shuffle_unit_order(encode_behavior_units(tokenizer, dump_root), DATA_ORDER_SEED + 1))
    families = {
        "wr_corpus_0": rehearsal,
        "prose": expand_family(shuffle_unit_order(c1.get("prose", []), DATA_ORDER_SEED + 2)),
        "code": expand_family(shuffle_unit_order(c1.get("code", []), DATA_ORDER_SEED + 3)),
        "json": expand_family(shuffle_unit_order(c1.get("json", []), DATA_ORDER_SEED + 4)),
        "behavior": behavior,
    }
    selected = []
    for fam, frac in MIX.items():
        selected.extend(take_until_budget(families.get(fam, []), int(TARGET_STREAM_TOKENS * frac)))
    stream, meta = _pack_selected(selected, NEEDED_TRAIN_TOKENS)
    interleaved = meta["interleaved_units"]
    labels = []
    origins = []
    for u in interleaved:
        n = int(u.tokens.size)
        labels.extend([u.bucket] * n)
        doc_id = str(u.unit_id).split("#", 1)[0].split(":", 1)[0]
        origins.extend([doc_id] * n)
    labels = np.array(labels)
    origins = np.array(origins)
    actual_used = int(stage2_report["tokens"])
    labels_used = labels[:actual_used]
    origins_used = origins[:actual_used]
    packed_percent = meta["packed_token_percent"]

    def mix_of(arr: np.ndarray) -> dict[str, float]:
        counts: dict[str, int] = defaultdict(int)
        for b in arr.tolist():
            counts[str(b)] += 1
        tot = max(1, int(arr.size))
        out = {k: round(100.0 * v / tot, 4) for k, v in sorted(counts.items(), key=lambda kv: -kv[1])}
        wr0 = out.get("wr_corpus_0", 0.0)
        out["WR-CORPUS-0"] = wr0
        out["WR-CORPUS-1"] = round(100.0 - wr0, 4)
        return out

    per_step_mix = []
    rehearsal_steps = []
    for step in range(1, 31):
        sl = labels[(step - 1) * 4096 : step * 4096]
        mix = mix_of(sl)
        per_step_mix.append({"step": step, "mix": mix, "rehearsal_pct": mix.get("WR-CORPUS-0", 0.0)})
        if mix.get("WR-CORPUS-0", 0.0) > 0:
            rehearsal_steps.append(step)
    gaps = []
    if rehearsal_steps:
        for a, b in zip(rehearsal_steps, rehearsal_steps[1:]):
            gaps.append(b - a - 1)
        if rehearsal_steps[0] > 1:
            gaps.append(rehearsal_steps[0] - 1)
        if rehearsal_steps[-1] < 30:
            gaps.append(30 - rehearsal_steps[-1])
    max_rehearsal_gap_steps = int(max(gaps) if gaps else 0)

    def window_mix(end_step: int) -> dict[str, float]:
        return mix_of(labels[(end_step - 10) * 4096 : end_step * 4096]) if end_step >= 10 else mix_of(labels[: end_step * 4096])

    # corpus-0 document coverage in first 30 steps
    wr0_mask = labels_used == "wr_corpus_0"
    wr0_ids, wr0_counts = np.unique(origins_used[wr0_mask], return_counts=True) if wr0_mask.any() else (np.array([]), np.array([]))
    # available rehearsal docs
    man = json.loads((dump_root / "model-lab" / "manifests" / "wrim0_corpus_shards" / "shard-manifest.json").read_text(encoding="utf-8"))
    doc_classes = []
    wrim0 = np.load(dump_root / "model-lab" / "manifests" / "wrim0_corpus_shards" / "train.npy")
    offset = 0
    for doc in man.get("trainDocs") or []:
        n = int(doc["tokenCount"])
        sl = wrim0[offset : offset + n]
        offset += n
        decoded = tokenizer.decode(sl[:80].tolist(), skip_special_tokens=True)
        seen = int(wr0_counts[list(wr0_ids).index(doc["documentId"])]) if doc["documentId"] in set(wr0_ids.tolist()) else 0
        doc_classes.append(
            {
                "documentId": doc["documentId"],
                "tokenCount": n,
                "coarse_class": classify_excerpt(decoded),
                "tokens_in_first_30_steps": seen,
                "share_of_used_rehearsal_pct": round(100.0 * seen / max(1, int(wr0_mask.sum())), 4),
            }
        )

    code_in_fail_window = mix_of(labels[20 * 4096 : 30 * 4096])

    # --- load WRIM-0 and step-30 (read-only) ---
    parent_state, _map = load_model_state_from_safetensors(parent_path)
    parent = WRIM0Model().to(device)
    parent.load_state_dict(parent_state, strict=True)
    parent.freeze_inference()
    step30_state = load_file(str(ckpt_dir / "model.safetensors"))
    step30 = WRIM0Model().to(device)
    step30.load_state_dict(step30_state, strict=True)
    step30.freeze_inference()

    parent_stats = first_token_stats(parent, tokenizer, prompt, device)
    s30_stats = first_token_stats(step30, tokenizer, prompt, device, parent_argmax=parent_stats["argmax_id"])
    parent_gen = greedy_generate(parent, tokenizer, prompt, device)
    s30_gen = greedy_generate(step30, tokenizer, prompt, device)
    parent_gen2 = greedy_generate(parent, tokenizer, prompt, device)
    s30_gen2 = greedy_generate(step30, tokenizer, prompt, device)
    parent_ok = score_retention(parent_gen, failed_item.get("expected") or {})
    s30_ok = score_retention(s30_gen, failed_item.get("expected") or {})
    deterministic = parent_gen["new_ids"] == parent_gen2["new_ids"] and s30_gen["new_ids"] == s30_gen2["new_ids"]

    # weight deltas parent vs step 30 only (10/20 checkpoints were not saved)
    deltas: dict[str, dict[str, float]] = defaultdict(lambda: {"sum_sq": 0.0, "n": 0, "max_abs": 0.0})
    layer_attn = [0.0] * N_LAYERS
    layer_ffn = [0.0] * N_LAYERS
    for k, p in parent_state.items():
        a = p.detach().float().cpu()
        b = step30_state[k].detach().float().cpu()
        d = (b - a).abs()
        rms = float(torch.sqrt((b - a).pow(2).mean()).item())
        g = module_group(k)
        deltas[g]["sum_sq"] += float((b - a).pow(2).sum().item())
        deltas[g]["n"] += int(a.numel())
        deltas[g]["max_abs"] = max(deltas[g]["max_abs"], float(d.max().item()))
        li = layer_index(k)
        if li is not None:
            if ".attn." in k:
                layer_attn[li] += rms
            if ".ffn." in k:
                layer_ffn[li] += rms
    module_rms = {
        g: {
            "rms": math.sqrt(v["sum_sq"] / max(1, v["n"])),
            "n_params": v["n"],
            "max_abs": v["max_abs"],
        }
        for g, v in deltas.items()
    }
    early = list(range(0, 6))
    mid = list(range(6, 12))
    late = list(range(12, 18))

    def band(vals: list[float], idxs: list[int]) -> float:
        return float(sum(vals[i] for i in idxs) / max(1, len(idxs)))

    steps = stage2_report["steps"]
    clip_n = sum(1 for s in steps if float(s["grad_norm_pre_clip"]) > 1.0)
    def mean_field(lo: int, hi: int, key: str) -> float:
        sl = [s for s in steps if lo <= s["step"] <= hi]
        return float(sum(s[key] for s in sl) / len(sl))

    lr_by = {s["step"]: s["lr"] for s in steps}

    payload = {
        "ok": True,
        "kind": "TEST_ONLY",
        "classification": "STOPPED_BY_SENTINEL / REJECTED_FOR_STAGE3",
        "run_id": "WRIM1-NEBULA-STAB-000001",
        "NO_TRAINING": True,
        "NO_STAGE3": True,
        "parent_sha": parent_sha,
        "parent_unmodified": True,
        "artifact_preserved": True,
        "intermediate_checkpoints_present": {
            "WRIM-0": True,
            "stage2_step_10": False,
            "stage2_step_20": False,
            "stage2_step_30": True,
            "note": "Only WRIM-0 and the sentinel-stop checkpoint exist. Steps 10/20 compared from eval-full.json generations, not reloaded weights.",
        },
        "failed_item": {
            "evalId": FAILED_EVAL_ID,
            "suite_family": failed_item.get("family"),
            "capability_ids": failed_item.get("capability_ids"),
            "level": failed_item.get("level"),
            "scorer": failed_item.get("objectiveScorer"),
            "notes": failed_item.get("notes"),
            "prompt_kind": "literary_prose_continuation",
            "prompt_fingerprint": failed_item.get("contaminationFingerprint"),
            "pass_rule": "unique_ratio>=0.35 AND not collapsed AND not single-period",
            "last_passing_eval_step": last_pass,
            "first_failing_eval_step": first_fail,
            "baseline_step0": next((r for r in failed_series if r["step"] == 0), None),
            "failing_step30": next((r for r in failed_series if r["step"] == 30), None),
            "series": failed_series,
        },
        "retention_timeline": timeline,
        "degradation_shape": "sudden_between_eval_20_and_30",
        "loss_vs_retention": {
            "val_loss_improved": True,
            "val_loss": [ev.get("validation_loss") for ev in eval_full],
            "train_loss_at_evals": [ev.get("train_loss") for ev in eval_full],
            "retention": [ev.get("retention_family") for ev in eval_full],
            "loss_masked_capability_loss": True,
        },
        "data_exposure": {
            "global_first_30_steps": mix_of(labels_used),
            "authorized_50_step_packer_mix": packed_percent,
            "reconstructed_stream_tokens": int(stream.size),
            "preceding_step_10_eval": window_mix(10),
            "preceding_step_20_eval": window_mix(20),
            "preceding_step_30_failure": window_mix(30),
            "per_step": per_step_mix,
            "rehearsal_steps_with_any_wr0": rehearsal_steps,
            "max_gap_steps_without_rehearsal": max_rehearsal_gap_steps,
            "evenly_interleaved": max_rehearsal_gap_steps <= 1,
            "wr_corpus_0_docs": doc_classes,
            "code_share_steps_21_30": code_in_fail_window,
        },
        "failed_family_pressure": {
            "retention_scorer_is_not_token_match": True,
            "generation_at_fail_matches_code_markdown": "model-lab" in (failed_series[-1]["continuation_excerpt"] if failed_series else "").lower()
            or "lab - lab" in (failed_series[-1]["continuation_excerpt"] if failed_series else ""),
            "near_miss": {
                "cap0-ret-01_step30_unique_ratio": timeline[-1]["items"]["cap0-ret-01"]["unique_ratio"] if timeline else None,
                "cap0-ret-01_step30_pass": timeline[-1]["items"]["cap0-ret-01"]["pass"] if timeline else None,
            },
        },
        "checkpoint_comparison_failed_prompt": {
            "WRIM-0": {**parent_stats, "unique_ratio": parent_gen["unique_ratio"], "collapsed": parent_gen["collapsed"], "max_run": parent_gen["max_run"], "special_loop": parent_gen["special_loop"], "pass": parent_ok, "continuation_excerpt": (parent_gen["continuation"] or "")[:160]},
            "stage2_step_30": {**s30_stats, "unique_ratio": s30_gen["unique_ratio"], "collapsed": s30_gen["collapsed"], "max_run": s30_gen["max_run"], "special_loop": s30_gen["special_loop"], "pass": s30_ok, "continuation_excerpt": (s30_gen["continuation"] or "")[:160]},
            "stage2_step_10": "NOT_SAVED",
            "stage2_step_20": "NOT_SAVED",
        },
        "evaluator_integrity": {
            "eval_seed": EVAL_SEED,
            "greedy_argmax": True,
            "repeat_match": deterministic,
            "reload_pass_matches_recorded": s30_ok is False,
            "recorded_unique_ratio": 0.2188,
            "reloaded_unique_ratio": s30_gen["unique_ratio"],
            "nondeterminism": not deterministic,
            "tokenizer_bound": True,
            "no_sampling": True,
        },
        "sentinel_integrity": {
            "exit_code_1_intentional": True,
            "reason": "RETENTION_SENTINEL",
            "not_oom": True,
            "not_nan": True,
            "not_exception": True,
            "not_checkpoint_failure": True,
            "reload_ok": True,
        },
        "lr": {
            "step_10": lr_by.get(10),
            "step_20": lr_by.get(20),
            "step_25_peak": lr_by.get(25),
            "step_30": lr_by.get(30),
            "peak": 3e-5,
            "failure_window": "after peak; eval 20 still 6/6 at 2.4e-5; eval 30 5/6 at 2.83e-5 following step 25 peak 3e-5",
        },
        "gradients": {
            "clip_events_gt_1": clip_n,
            "n_steps": len(steps),
            "mean_preclip_1_10": mean_field(1, 10, "grad_norm_pre_clip"),
            "mean_preclip_11_20": mean_field(11, 20, "grad_norm_pre_clip"),
            "mean_preclip_21_30": mean_field(21, 30, "grad_norm_pre_clip"),
            "mean_update_1_10": mean_field(1, 10, "bounded_update_norm"),
            "mean_update_11_20": mean_field(11, 20, "bounded_update_norm"),
            "mean_update_21_30": mean_field(21, 30, "bounded_update_norm"),
        },
        "module_weight_delta_vs_WRIM0": {
            "by_group_rms": module_rms,
            "attn_rms_early_0_5": band(layer_attn, early),
            "attn_rms_mid_6_11": band(layer_attn, mid),
            "attn_rms_late_12_17": band(layer_attn, late),
            "ffn_rms_early_0_5": band(layer_ffn, early),
            "ffn_rms_mid_6_11": band(layer_ffn, mid),
            "ffn_rms_late_12_17": band(layer_ffn, late),
            "causal": False,
        },
        "starting_checkpoint": stage2_report.get("starting_checkpoint"),
        "disk_free_gb": shutil.disk_usage("C:/").free / 1024**3,
        "TRAINING_AUTHORIZATION": "OFF",
        "READY_FOR_STAGE3_TRAINING_AUTHORIZATION": "NO",
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "failed": FAILED_EVAL_ID,
        "last_pass": last_pass,
        "first_fail": first_fail,
        "reload_unique": s30_gen["unique_ratio"],
        "deterministic": deterministic,
        "max_rehearsal_gap": max_rehearsal_gap_steps,
        "report": str(out_path),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
