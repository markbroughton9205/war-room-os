"""Phase 3A post-hoc WRIM-0 interpolation. ZERO optimizer steps.

Select one typical step-50 candidate per Phase 2 cell, lerp toward WRIM-0,
evaluate TEST_ONLY_MERGE artifacts. No training. No Stage 3. No promotion.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import statistics
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch
from safetensors.torch import load_file, save_file
from tokenizers import Tokenizer

from phase2_grid import (
    DISK_STOP_GB,
    DISK_WARN_GB,
    EXPECTED_PARAMS,
    FROZEN_NLL_SHA,
    HARNESS_SHA,
    PARENT_SHA,
    PEAK_LRS,
    STRATEGIES,
    TOKENIZER_SHA,
    VAL_BASELINE_ABS_TOL,
    VAL_CORPUS0_BASELINE,
    VAL_CORPUS1_BASELINE,
    concat_units,
    disable_tf32,
    disk_gb,
    eval_at,
    load_frozen_targets,
    load_parent_model,
    parameter_displacement,
    sha256_file,
    sha256_json_text,
    teacher_force_anchor,
    tensors_sha256,
    utc_now,
    write_json,
)
from stage2_eval import EVAL_SEED, greedy_generate, json_valid_from, load_diagnostic_items
from stage2_pack import encode_corpus1_val_units, encode_rehearsal_val_units
from wrim_g20m import WRIM0Model, expected_torch_keys

EXPERIMENT_ID = "WRIM1-NEBULA-STABILITY-GRID-000001"
PHASE = "3A"
ALPHAS = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 1.0]
SELECT_METRICS = (
    ("final_mean_wrim0_anchor_nll_delta", "anchor_nll_delta"),
    ("final_mean_kl", "kl"),
    ("final_val_loss_corpus0", "val_loss_corpus0"),
    ("final_val_loss_corpus1", "val_loss_corpus1"),
)
CELLS = [
    ("NATURAL_BASELINE", 3e-5, "NATURAL_BASELINE__3e-5"),
    ("NATURAL_BASELINE", 2e-5, "NATURAL_BASELINE__2e-5"),
    ("BALANCED_GENESIS", 3e-5, "BALANCED_GENESIS__3e-5"),
    ("BALANCED_GENESIS", 2e-5, "BALANCED_GENESIS__2e-5"),
]
DISP_ABS_TOL = 5e-5
ENDPOINT_HASH_NOTE = "lerp(0)/lerp(1) must match endpoint tensor SHA256 exactly"


def alpha_key(alpha: float) -> str:
    return f"{alpha:.1f}"


def load_runs(runs_path: Path) -> list[dict[str, Any]]:
    rows = []
    with runs_path.open("r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            rows.append(json.loads(line))
    return rows


def cell_runs(runs: list[dict[str, Any]], strategy: str, peak_lr: float) -> list[dict[str, Any]]:
    out = []
    for r in runs:
        if not r.get("ok"):
            continue
        if r.get("rehearsal_strategy") != strategy:
            continue
        if abs(float(r.get("peak_lr") or 0) - peak_lr) > 1e-12:
            continue
        if int(r.get("stopped_step") or 0) != 50:
            continue
        if r.get("hard_stop_rule"):
            continue
        out.append(r)
    return out


def standardized_median_distance(runs: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, float], dict[str, float]]:
    scored = []
    medians: dict[str, float] = {}
    sds: dict[str, float] = {}
    for src, _alias in SELECT_METRICS:
        xs = [float(r[src]) for r in runs]
        medians[src] = float(statistics.median(xs))
        sds[src] = float(statistics.stdev(xs) if len(xs) > 1 else 0.0)
    for r in runs:
        acc = 0.0
        zparts = {}
        for src, alias in SELECT_METRICS:
            x = float(r[src])
            sd = sds[src]
            term = 0.0 if sd <= 1e-12 else (x - medians[src]) / sd
            zparts[alias] = term
            acc += term * term
        dist = math.sqrt(acc)
        scored.append(
            {
                "run_id": r["run_id"],
                "seed": int(r["seed"]),
                "distance_to_cell_median": dist,
                "metrics": {alias: float(r[src]) for src, alias in SELECT_METRICS},
                "standardized_offset": zparts,
                "phase2_parameter_displacement_total": r.get("final_parameter_displacement_total"),
                "final_binary": r.get("final_binary"),
            }
        )
    scored.sort(key=lambda x: (x["distance_to_cell_median"], x["seed"], x["run_id"]))
    return scored, medians, sds


def select_representatives(runs: list[dict[str, Any]]) -> dict[str, Any]:
    cells = []
    for strategy, peak_lr, cid in CELLS:
        subset = cell_runs(runs, strategy, peak_lr)
        if len(subset) != 10:
            raise RuntimeError(f"{cid} expected 10 healthy step-50 runs, got {len(subset)}")
        ranked, medians, sds = standardized_median_distance(subset)
        chosen = ranked[0]
        cells.append(
            {
                "cell_id": cid,
                "rehearsal_strategy": strategy,
                "peak_lr": peak_lr,
                "n": len(subset),
                "cell_medians": {alias: medians[src] for src, alias in SELECT_METRICS},
                "cell_sd": {alias: sds[src] for src, alias in SELECT_METRICS},
                "selected": chosen,
                "ranked_run_ids": [x["run_id"] for x in ranked],
                "reason": (
                    "Nearest cell median on equal-weight standardized composite of "
                    "anchor-NLL delta, KL, val_loss_corpus0, val_loss_corpus1. "
                    "Tie-break: lowest seed, then run_id. Typical-cell representative, not best-run."
                ),
            }
        )
    return {
        "ok": True,
        "phase": PHASE,
        "experiment_id": EXPERIMENT_ID,
        "kind": "TEST_ONLY",
        "selection_rule": "STANDARDIZED_DISTANCE_TO_CELL_MEDIAN",
        "metrics": [alias for _src, alias in SELECT_METRICS],
        "formula": "d = sqrt(sum_m ((x_m - median_m) / sd_m)^2); sd_m==0 => term 0; argmin d; tie seed then run_id",
        "written_before_interpolation": True,
        "optimizer_steps": 0,
        "cells": cells,
        "utc": utc_now(),
    }


def load_candidate_state(path: Path) -> dict[str, torch.Tensor]:
    state = load_file(str(path))
    return {k: v.contiguous() for k, v in state.items()}


def lerp_state(cand: dict[str, torch.Tensor], parent: dict[str, torch.Tensor], alpha: float) -> dict[str, torch.Tensor]:
    if abs(alpha) < 1e-15:
        return {k: v.clone() for k, v in cand.items()}
    if abs(alpha - 1.0) < 1e-15:
        return {k: v.clone() for k, v in parent.items()}
    out = {}
    a = float(alpha)
    oma = 1.0 - a
    for k in parent:
        out[k] = (oma * cand[k].float() + a * parent[k].float()).contiguous()
    return out


def verify_endpoint_keys(cand: dict[str, torch.Tensor], parent: dict[str, torch.Tensor]) -> tuple[bool, list[str]]:
    reasons = []
    exp = set(expected_torch_keys())
    ck = set(cand)
    pk = set(parent)
    if ck != pk:
        reasons.append("tensor keys differ between candidate and WRIM-0")
    if ck != exp or pk != exp:
        reasons.append("tensor keys differ from architecture expected_torch_keys")
    for k in sorted(exp):
        if k not in cand or k not in parent:
            continue
        if tuple(cand[k].shape) != tuple(parent[k].shape):
            reasons.append(f"shape mismatch {k}: {tuple(cand[k].shape)} vs {tuple(parent[k].shape)}")
    return (len(reasons) == 0), reasons


def load_into_model(state: dict[str, torch.Tensor], device: torch.device) -> WRIM0Model:
    model = WRIM0Model()
    model.load_state_dict(state, strict=True)
    model.freeze_inference()
    return model.to(device)


def strip_item_ids(ev: dict[str, Any]) -> dict[str, Any]:
    items = []
    for it in ev.get("items") or []:
        row = dict(it)
        h32 = dict(row.get("historical_32") or {})
        h256 = dict(row.get("descriptive_256") or {})
        h32.pop("new_ids", None)
        h256.pop("new_ids", None)
        row["historical_32"] = h32
        row["descriptive_256"] = h256
        items.append(row)
    out = dict(ev)
    out["items"] = items
    return out


def structured_output_probe(model: WRIM0Model, tokenizer: Tokenizer, device: torch.device, dump_root: Path) -> dict[str, Any]:
    items = load_diagnostic_items(dump_root)
    d0 = next((it for it in items if it.get("id") == "d0-json"), None)
    if d0 is None:
        return {"source": "WRIM-RECOVERY-DIAGNOSTIC-0-EXTENDED", "id": "d0-json", "present": False}
    g = greedy_generate(model, tokenizer, d0["input"], device, max_new=32)
    valid = json_valid_from("d0-json", d0["input"], g.get("continuation") or "")
    return {
        "source": "WRIM-RECOVERY-DIAGNOSTIC-0-EXTENDED",
        "id": "d0-json",
        "present": True,
        "json_valid": valid,
        "unique_ratio": g.get("unique_ratio"),
        "collapsed": g.get("collapsed"),
        "token_id_sha256": hashlib.sha256((" ".join(str(i) for i in (g.get("new_ids") or []))).encode("utf-8")).hexdigest(),
        "note": "Canonical DIAGNOSTIC-0 JSON probe only. No new test suite.",
    }


def evaluate_state(
    *,
    state: dict[str, torch.Tensor],
    tokenizer: Tokenizer,
    device: torch.device,
    dump_root: Path,
    targets: dict[str, Any],
    wrim0_logp: dict[str, torch.Tensor],
    parent_cpu: dict[str, torch.Tensor],
    c0_stream: np.ndarray,
    c1_stream: np.ndarray,
    label: str,
    alpha: float,
) -> dict[str, Any]:
    torch.manual_seed(EVAL_SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(EVAL_SEED)
    model = load_into_model(state, device)
    ev = eval_at(
        model=model,
        tokenizer=tokenizer,
        device=device,
        dump_root=dump_root,
        targets=targets,
        wrim0_logp=wrim0_logp,
        parent_cpu=parent_cpu,
        c0_stream=c0_stream,
        c1_stream=c1_stream,
        interleaved=[],
        all_docs=[],
        step=50,
        peak_lr=0.0,
        train_loss=None,
        tokens=204800,
    )
    ev["structured_output"] = structured_output_probe(model, tokenizer, device, dump_root)
    ev["label"] = label
    ev["alpha"] = alpha
    ev["parameter_displacement"] = parameter_displacement(model, parent_cpu)
    ev["tensor_sha256"] = tensors_sha256({k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()})
    del model
    torch.cuda.empty_cache()
    return strip_item_ids(ev)


def save_merge(path: Path, state: dict[str, torch.Tensor], meta: dict[str, Any]) -> dict[str, Any]:
    path.mkdir(parents=True, exist_ok=True)
    free = disk_gb(path)
    if free < DISK_STOP_GB:
        raise RuntimeError(f"disk safety violation free {free:.1f}GB < {DISK_STOP_GB}GB")
    if free < DISK_WARN_GB:
        print(f"[phase3a] WARN disk {free:.1f}GB", flush=True)
    model_path = path / "model.safetensors"
    save_file(state, str(model_path))
    payload = {
        **meta,
        "model_path": str(model_path),
        "model_sha256": sha256_file(model_path),
        "save_hash": tensors_sha256(state),
        "kind": "TEST_ONLY_MERGE",
        "promotion_candidate": False,
        "free_disk_gb": round(free, 2),
    }
    write_json(path / "checkpoint.json", payload)
    return payload


def metric_row(ev: dict[str, Any]) -> dict[str, Any]:
    items = ev.get("items") or []
    return {
        "alpha": ev.get("alpha"),
        "mean_wrim0_anchor_nll_delta": ev.get("mean_wrim0_anchor_nll_delta"),
        "median_wrim0_anchor_nll_delta": ev.get("median_wrim0_anchor_nll_delta"),
        "worst_item_wrim0_anchor_nll_delta": ev.get("worst_item_wrim0_anchor_nll_delta"),
        "mean_kl_wrim0_to_candidate": ev.get("mean_kl_wrim0_to_candidate"),
        "val_loss_corpus0": ev.get("val_loss_corpus0"),
        "val_loss_corpus1": ev.get("val_loss_corpus1"),
        "historical_binary": ev.get("historical_binary"),
        "historical_pass_count": ev.get("historical_pass_count"),
        "per_item_anchor_nll_delta": {it["evalId"]: it.get("wrim0_anchor_nll_delta") for it in items},
        "per_item_kl": {it["evalId"]: it.get("kl_wrim0_to_candidate") for it in items},
        "fp32": {it["evalId"]: (it.get("historical_32") or {}).get("token_id_sha256") for it in items},
        "fp256": {it["evalId"]: (it.get("descriptive_256") or {}).get("token_id_sha256") for it in items},
        "unique_ratio_32": {it["evalId"]: (it.get("historical_32") or {}).get("unique_ratio") for it in items},
        "unique_ratio_256": {it["evalId"]: (it.get("descriptive_256") or {}).get("unique_ratio") for it in items},
        "entropy_256": {it["evalId"]: (it.get("descriptive_256") or {}).get("entropy_continuation") for it in items},
        "max_token_run_256": {it["evalId"]: (it.get("descriptive_256") or {}).get("max_token_run") for it in items},
        "p_period_256": {it["evalId"]: (it.get("descriptive_256") or {}).get("p_period") for it in items},
        "special_rate_256": {it["evalId"]: (it.get("descriptive_256") or {}).get("special_token_rate_0_8") for it in items},
        "structured_output": ev.get("structured_output"),
        "parameter_displacement": ev.get("parameter_displacement"),
        "tensor_sha256": ev.get("tensor_sha256"),
    }


def dominates(a: dict[str, float], b: dict[str, float], keys: tuple[str, ...]) -> bool:
    le = all(a[k] <= b[k] + 1e-12 for k in keys)
    lt = any(a[k] < b[k] - 1e-12 for k in keys)
    return le and lt


def pareto_analysis(points: list[dict[str, Any]]) -> dict[str, Any]:
    keys = ("mean_wrim0_anchor_nll_delta", "mean_kl_wrim0_to_candidate", "val_loss_corpus0", "val_loss_corpus1")
    usable = []
    for p in points:
        row = {k: p.get(k) for k in keys}
        if any(v is None or not math.isfinite(float(v)) for v in row.values()):
            continue
        usable.append({**p, **{k: float(row[k]) for k in keys}})
    frontier = []
    for p in usable:
        if any(dominates(q, p, keys) for q in usable if q is not p):
            continue
        frontier.append(p)
    zs = {k: [] for k in keys}
    for p in usable:
        for k in keys:
            zs[k].append(p[k])
    means = {k: statistics.mean(zs[k]) for k in keys}
    sds = {k: (statistics.stdev(zs[k]) if len(zs[k]) > 1 else 1.0) for k in keys}

    def zsum(p: dict[str, Any]) -> float:
        acc = 0.0
        for k in keys:
            sd = sds[k] if sds[k] > 1e-12 else 1.0
            acc += (p[k] - means[k]) / sd
        return acc

    best_ret = min(frontier, key=lambda p: (p["mean_kl_wrim0_to_candidate"], p["mean_wrim0_anchor_nll_delta"])) if frontier else None
    best_c1 = min(frontier, key=lambda p: (p["val_loss_corpus1"], p["mean_kl_wrim0_to_candidate"])) if frontier else None
    best_bal = min(frontier, key=zsum) if frontier else None
    return {
        "objectives": list(keys),
        "sense": "MINIMIZE",
        "n_points": len(usable),
        "frontier": [
            {
                "run_id": p.get("run_id"),
                "alpha": p.get("alpha"),
                "mean_wrim0_anchor_nll_delta": p["mean_wrim0_anchor_nll_delta"],
                "mean_kl_wrim0_to_candidate": p["mean_kl_wrim0_to_candidate"],
                "val_loss_corpus0": p["val_loss_corpus0"],
                "val_loss_corpus1": p["val_loss_corpus1"],
                "historical_binary": p.get("historical_binary"),
            }
            for p in frontier
        ],
        "best_retention_preserving": None if best_ret is None else {"run_id": best_ret.get("run_id"), "alpha": best_ret.get("alpha")},
        "best_corpus1_preserving": None if best_c1 is None else {"run_id": best_c1.get("run_id"), "alpha": best_c1.get("alpha")},
        "best_balanced_pareto": None if best_bal is None else {"run_id": best_bal.get("run_id"), "alpha": best_bal.get("alpha")},
        "promotion_candidate": False,
    }


def classify_binary_trajectory(rows: list[dict[str, Any]]) -> str:
    ordered = sorted(rows, key=lambda r: float(r["alpha"]))
    binaries = [int(r.get("historical_pass_count") or 0) for r in ordered]
    kls = [float(r["mean_kl_wrim0_to_candidate"]) for r in ordered]
    deltas = [float(r["mean_wrim0_anchor_nll_delta"]) for r in ordered]
    kl_mono = all(b <= a + 1e-6 for a, b in zip(kls, kls[1:]))
    d_mono = all(b <= a + 1e-6 for a, b in zip(deltas, deltas[1:]))
    bin_nondec = all(b >= a for a, b in zip(binaries, binaries[1:]))
    bin_changes = sum(1 for a, b in zip(binaries, binaries[1:]) if a != b)
    if not bin_nondec:
        return "NON_MONOTONIC"
    if kl_mono and d_mono and bin_changes == 0:
        return "MONOTONIC_WITH_CONTINUOUS_RETENTION"
    if kl_mono and d_mono and bin_changes == 1:
        return "THRESHOLD_CLIFF"
    if kl_mono and d_mono and bin_changes > 1:
        return "THRESHOLD_CLIFF"
    return "MIXED"


def curve_nonmonotonic(xs: list[float]) -> bool:
    if len(xs) < 3:
        return False
    diffs = [b - a for a, b in zip(xs, xs[1:])]
    return any(d > 1e-8 for d in diffs) and any(d < -1e-8 for d in diffs)


def classify_interpolation(traj_classes: list[str], nonmono_any: bool, useful: bool) -> dict[str, Any]:
    uniq = sorted(set(traj_classes))
    binary_brittle = any(c in uniq for c in ("THRESHOLD_CLIFF", "NON_MONOTONIC", "MIXED"))
    if useful and binary_brittle:
        code, name = "E", "MULTIPLE_FINDINGS"
    elif uniq == ["THRESHOLD_CLIFF"]:
        code, name = "D", "BINARY_SCORER_THRESHOLD_BRITTLE"
    elif nonmono_any:
        code, name = "C", "INTERPOLATION_NON_MONOTONIC"
    elif useful:
        code, name = "A", "INTERPOLATION_USEFUL"
    elif uniq == ["MONOTONIC_WITH_CONTINUOUS_RETENTION"] and not useful:
        code, name = "B", "INTERPOLATION_INERT"
    else:
        code, name = "F", "INCONCLUSIVE"
    return {"classification_code": code, "classification": name, "trajectory_classes": uniq}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--dump-root", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--ckpt-root", required=True)
    ap.add_argument("--frozen-nll", required=True)
    ap.add_argument("--harness", required=True)
    ap.add_argument("--preregistration", required=True)
    ap.add_argument("--authorization", required=True)
    args = ap.parse_args()

    if args.authorization != "PHASE3A_INTERPOLATION_ONLY":
        print(json.dumps({"ok": False, "error": "authorization must be PHASE3A_INTERPOLATION_ONLY"}, indent=2))
        return 3

    ckpt_root = Path(args.ckpt_root)
    interp_root = ckpt_root / "INTERPOLATION"
    report_path = Path(args.report)
    if not (ckpt_root / "GRID_COMPLETE.json").exists():
        print(json.dumps({"ok": False, "error": "Phase 2 GRID_COMPLETE.json missing"}, indent=2))
        return 2
    if (ckpt_root / "ABORT.json").exists():
        print(json.dumps({"ok": False, "error": "Phase 2 ABORT.json present"}, indent=2))
        return 2

    disable_tf32()
    if not torch.cuda.is_available():
        print(json.dumps({"ok": False, "error": "CUDA required"}, indent=2))
        return 2
    interp_root.mkdir(parents=True, exist_ok=True)
    shutil.copy2(Path(args.preregistration), interp_root / "INTERPOLATION_PREREGISTRATION.md")
    disk0 = disk_gb(interp_root)
    t0 = time.perf_counter()

    runs = load_runs(ckpt_root / "runs.jsonl")
    selection = select_representatives(runs)
    write_json(interp_root / "INTERPOLATION_SELECTION.json", selection)
    print("[phase3a] INTERPOLATION_SELECTION.json written before any merge", flush=True)

    weights = Path(args.weights)
    tokenizer_path = Path(args.tokenizer)
    dump_root = Path(args.dump_root)
    frozen_path = Path(args.frozen_nll)
    harness_path = Path(args.harness)

    parent_sha = sha256_file(weights)
    tok_sha = sha256_file(tokenizer_path)
    harness = json.loads(harness_path.read_text(encoding="utf-8"))
    harness_sha = str(harness.get("artifact_sha256") or "")
    frozen_sha = sha256_json_text(frozen_path)
    if parent_sha != PARENT_SHA or tok_sha != TOKENIZER_SHA or harness_sha != HARNESS_SHA or frozen_sha != FROZEN_NLL_SHA:
        payload = {"ok": False, "error": "HASH_MISMATCH", "parent_sha": parent_sha, "tokenizer_sha": tok_sha, "harness_sha": harness_sha, "frozen_nll_sha": frozen_sha}
        write_json(interp_root / "INTERPOLATION_ENDPOINT_FAILURE.json", payload)
        write_json(report_path, payload)
        return 2
    if harness.get("verdict") != "PHASE1_GREEDY_DETERMINISM_PASS":
        payload = {"ok": False, "error": "Phase 1 harness PASS required"}
        write_json(report_path, payload)
        return 2

    device = torch.device("cuda")
    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    parent_model, parent_hash, n_params = load_parent_model(weights, device)
    if n_params != EXPECTED_PARAMS:
        payload = {"ok": False, "error": "param count mismatch", "n": n_params}
        write_json(interp_root / "INTERPOLATION_ENDPOINT_FAILURE.json", payload)
        return 2
    parent_cpu = {k: v.detach().cpu().contiguous() for k, v in parent_model.state_dict().items()}
    parent_state = {k: v.clone() for k, v in parent_cpu.items()}
    targets = load_frozen_targets(frozen_path, tokenizer, dump_root)
    wrim0_logp: dict[str, torch.Tensor] = {}
    print("[phase3a] WRIM-0 log-softmax + val baselines", flush=True)
    for tgt in targets["items"]:
        bundle = teacher_force_anchor(parent_model, tgt["prompt_ids"], tgt["target_ids"], device, None)
        wrim0_logp[tgt["evalId"]] = bundle["log_softmax"]
    c0_stream = concat_units(encode_rehearsal_val_units(tokenizer, dump_root))
    c1_stream = concat_units(encode_corpus1_val_units(tokenizer, dump_root))
    del parent_model
    torch.cuda.empty_cache()

    print("[phase3a] evaluate WRIM-0 alpha=1 endpoint", flush=True)
    parent_eval = evaluate_state(
        state=parent_state,
        tokenizer=tokenizer,
        device=device,
        dump_root=dump_root,
        targets=targets,
        wrim0_logp=wrim0_logp,
        parent_cpu=parent_cpu,
        c0_stream=c0_stream,
        c1_stream=c1_stream,
        label="WRIM-0",
        alpha=1.0,
    )
    if abs(float(parent_eval["mean_wrim0_anchor_nll_delta"])) > VAL_BASELINE_ABS_TOL:
        payload = {"ok": False, "error": "WRIM-0 alpha=1 anchor delta not ~0", "mean_delta": parent_eval["mean_wrim0_anchor_nll_delta"]}
        write_json(interp_root / "INTERPOLATION_ENDPOINT_FAILURE.json", payload)
        write_json(report_path, payload)
        print(json.dumps(payload, indent=2), flush=True)
        return 2
    if abs(float(parent_eval["val_loss_corpus0"]) - VAL_CORPUS0_BASELINE) > VAL_BASELINE_ABS_TOL or abs(float(parent_eval["val_loss_corpus1"]) - VAL_CORPUS1_BASELINE) > VAL_BASELINE_ABS_TOL:
        payload = {"ok": False, "error": "WRIM-0 val baseline disagreement", "val0": parent_eval["val_loss_corpus0"], "val1": parent_eval["val_loss_corpus1"]}
        write_json(interp_root / "INTERPOLATION_ENDPOINT_FAILURE.json", payload)
        write_json(report_path, payload)
        print(json.dumps(payload, indent=2), flush=True)
        return 2

    trajectories = []
    all_points = []
    endpoint_ok = True
    for cell in selection["cells"]:
        rid = cell["selected"]["run_id"]
        cand_path = ckpt_root / rid / "step-50" / "model.safetensors"
        meta_path = ckpt_root / rid / "step-50" / "checkpoint.json"
        if not cand_path.exists():
            payload = {"ok": False, "error": "missing step-50 checkpoint", "run_id": rid}
            write_json(interp_root / "INTERPOLATION_ENDPOINT_FAILURE.json", payload)
            return 2
        cand_meta = json.loads(meta_path.read_text(encoding="utf-8"))
        cand_state = load_candidate_state(cand_path)
        ok_keys, key_reasons = verify_endpoint_keys(cand_state, parent_state)
        if not ok_keys:
            payload = {"ok": False, "error": "endpoint key/shape failure", "run_id": rid, "reasons": key_reasons}
            write_json(interp_root / "INTERPOLATION_ENDPOINT_FAILURE.json", payload)
            write_json(report_path, payload)
            print(json.dumps(payload, indent=2), flush=True)
            return 2
        lerp0 = lerp_state(cand_state, parent_state, 0.0)
        lerp1 = lerp_state(cand_state, parent_state, 1.0)
        h_cand = tensors_sha256(cand_state)
        h_par = tensors_sha256(parent_state)
        h0 = tensors_sha256(lerp0)
        h1 = tensors_sha256(lerp1)
        if h0 != h_cand or h1 != h_par:
            payload = {
                "ok": False,
                "error": "ENDPOINT_HASH_MISMATCH",
                "run_id": rid,
                "note": ENDPOINT_HASH_NOTE,
                "candidate_sha": h_cand,
                "lerp0_sha": h0,
                "parent_sha": h_par,
                "lerp1_sha": h1,
            }
            write_json(interp_root / "INTERPOLATION_ENDPOINT_FAILURE.json", payload)
            write_json(report_path, payload)
            print(json.dumps(payload, indent=2), flush=True)
            return 2
        if sha256_file(cand_path) != cand_meta.get("model_sha256"):
            payload = {"ok": False, "error": "candidate file SHA mismatch vs checkpoint.json", "run_id": rid}
            write_json(interp_root / "INTERPOLATION_ENDPOINT_FAILURE.json", payload)
            return 2

        print(f"[phase3a] evaluate {rid} alpha=0 candidate", flush=True)
        cand_eval = evaluate_state(
            state=cand_state,
            tokenizer=tokenizer,
            device=device,
            dump_root=dump_root,
            targets=targets,
            wrim0_logp=wrim0_logp,
            parent_cpu=parent_cpu,
            c0_stream=c0_stream,
            c1_stream=c1_stream,
            label=rid,
            alpha=0.0,
        )
        rec_disp = float(cell["selected"].get("phase2_parameter_displacement_total") or 0.0)
        live_disp = float((cand_eval.get("parameter_displacement") or {}).get("total") or 0.0)
        if abs(live_disp - rec_disp) > DISP_ABS_TOL:
            payload = {"ok": False, "error": "displacement mismatch vs Phase 2", "run_id": rid, "phase2": rec_disp, "live": live_disp}
            write_json(interp_root / "INTERPOLATION_ENDPOINT_FAILURE.json", payload)
            write_json(report_path, payload)
            print(json.dumps(payload, indent=2), flush=True)
            return 2

        cell_dir = interp_root / rid
        cell_dir.mkdir(parents=True, exist_ok=True)
        write_json(cell_dir / "source-pointer.json", {"source_checkpoint": str(cand_path), "copied": False, "alpha": 0.0})
        write_json(cell_dir / "parent-pointer.json", {"source_checkpoint": str(weights), "copied": False, "alpha": 1.0})

        alpha_rows = [metric_row(cand_eval)]
        write_json(cell_dir / "eval-alpha-0.0.json", cand_eval)
        all_points.append({"run_id": rid, **metric_row(cand_eval)})

        for alpha in ALPHAS:
            if alpha in (0.0, 1.0):
                continue
            print(f"[phase3a] merge {rid} alpha={alpha}", flush=True)
            merged = lerp_state(cand_state, parent_state, alpha)
            meta = save_merge(
                cell_dir / f"alpha-{alpha_key(alpha)}",
                merged,
                {
                    "run_id": rid,
                    "alpha": alpha,
                    "formula": "(1-alpha)*candidate + alpha*WRIM0",
                    "experiment_id": EXPERIMENT_ID,
                    "kind": "TEST_ONLY_MERGE",
                    "optimizer_steps": 0,
                },
            )
            ev = evaluate_state(
                state=merged,
                tokenizer=tokenizer,
                device=device,
                dump_root=dump_root,
                targets=targets,
                wrim0_logp=wrim0_logp,
                parent_cpu=parent_cpu,
                c0_stream=c0_stream,
                c1_stream=c1_stream,
                label=f"{rid}__a{alpha_key(alpha)}",
                alpha=alpha,
            )
            write_json(cell_dir / f"eval-alpha-{alpha_key(alpha)}.json", ev)
            write_json(cell_dir / f"alpha-{alpha_key(alpha)}" / "eval.json", {"checkpoint": meta, "eval": metric_row(ev)})
            alpha_rows.append(metric_row(ev))
            all_points.append({"run_id": rid, **metric_row(ev)})

        parent_row = metric_row(parent_eval)
        alpha_rows.append(parent_row)
        all_points.append({"run_id": rid, **parent_row})
        write_json(cell_dir / "eval-alpha-1.0.json", parent_eval)
        bin_class = classify_binary_trajectory(alpha_rows)
        kl_curve = [float(r["mean_kl_wrim0_to_candidate"]) for r in sorted(alpha_rows, key=lambda x: float(x["alpha"]))]
        d_curve = [float(r["mean_wrim0_anchor_nll_delta"]) for r in sorted(alpha_rows, key=lambda x: float(x["alpha"]))]
        v0_curve = [float(r["val_loss_corpus0"]) for r in sorted(alpha_rows, key=lambda x: float(x["alpha"]))]
        v1_curve = [float(r["val_loss_corpus1"]) for r in sorted(alpha_rows, key=lambda x: float(x["alpha"]))]
        traj = {
            "run_id": rid,
            "cell_id": cell["cell_id"],
            "seed": cell["selected"]["seed"],
            "candidate_file_sha256": cand_meta.get("model_sha256"),
            "candidate_tensor_sha256": h_cand,
            "parent_tensor_sha256": h_par,
            "endpoint_ok": True,
            "displacement": cand_eval.get("parameter_displacement"),
            "phase2_displacement_total": rec_disp,
            "binary_scorer_class": bin_class,
            "kl_nonmonotonic": curve_nonmonotonic(kl_curve),
            "anchor_nll_nonmonotonic": curve_nonmonotonic(d_curve),
            "val0_nonmonotonic": curve_nonmonotonic(v0_curve),
            "val1_nonmonotonic": curve_nonmonotonic(v1_curve),
            "alphas": alpha_rows,
        }
        write_json(cell_dir / "trajectory.json", traj)
        trajectories.append(traj)
        print(json.dumps({"run_id": rid, "endpoint_ok": True, "binary_class": bin_class}, indent=2), flush=True)

    pareto = pareto_analysis(all_points)
    traj_classes = [t["binary_scorer_class"] for t in trajectories]
    nonmono = any(
        t["kl_nonmonotonic"] or t["anchor_nll_nonmonotonic"] or t["val0_nonmonotonic"] or t["val1_nonmonotonic"]
        for t in trajectories
    )
    # Useful if some interior alpha sits on frontier and improves KL vs alpha=0 while keeping val1 below WRIM-0.
    useful = False
    wrim0_v1 = VAL_CORPUS1_BASELINE
    for p in pareto["frontier"]:
        if p["alpha"] not in (0.0, 1.0) and p["val_loss_corpus1"] < wrim0_v1 - 1e-4:
            useful = True
    interp_class = classify_interpolation(traj_classes, nonmono, useful)

    overall_binary = "MIXED" if len(set(traj_classes)) > 1 else traj_classes[0]
    if overall_binary == "THRESHOLD_CLIFF" and nonmono:
        overall_binary = "MIXED"

    lr_kl = {}
    for t in trajectories:
        a0 = next(r for r in t["alphas"] if abs(float(r["alpha"]) - 0.0) < 1e-12)
        lr_kl[t["cell_id"]] = float(a0["mean_kl_wrim0_to_candidate"])
    lower_lr_less_drift = (lr_kl["NATURAL_BASELINE__2e-5"] < lr_kl["NATURAL_BASELINE__3e-5"]) and (
        lr_kl["BALANCED_GENESIS__2e-5"] < lr_kl["BALANCED_GENESIS__3e-5"]
    )
    bal_vs_nat_high = abs(lr_kl["BALANCED_GENESIS__3e-5"] - lr_kl["NATURAL_BASELINE__3e-5"])
    bal_vs_nat_low = abs(lr_kl["BALANCED_GENESIS__2e-5"] - lr_kl["NATURAL_BASELINE__2e-5"])
    balanced_meaningful = max(bal_vs_nat_high, bal_vs_nat_low) > 0.005

    recover_both = False
    for p in pareto["frontier"]:
        if (
            p["alpha"] not in (1.0,)
            and p["mean_kl_wrim0_to_candidate"] < 0.01
            and p["val_loss_corpus0"] < VAL_CORPUS0_BASELINE - 0.01
            and p["val_loss_corpus1"] < VAL_CORPUS1_BASELINE - 0.01
        ):
            recover_both = True

    design_q = {
        "1_lower_lr_reduces_distribution_drift": lower_lr_less_drift,
        "2_balanced_genesis_meaningful_after_data_order": balanced_meaningful,
        "3_interpolation_recovers_parent_while_keeping_both_val_improvements": recover_both,
        "4_historical_binary_tracks_or_thresholds": overall_binary,
        "5_clear_pareto_region_for_stage3_design": bool(pareto["frontier"]) and useful,
    }
    stage3_design_ready = "YES" if (lower_lr_less_drift or useful) else "NO"

    disk1 = disk_gb(interp_root)
    summary = {
        "ok": True,
        "phase": PHASE,
        "experiment_id": EXPERIMENT_ID,
        "kind": "TEST_ONLY_MERGE",
        "optimizer_steps": 0,
        "interpolation_executed": True,
        "logit_ensembling_executed": False,
        "stage3_started": False,
        "promotion_candidate": False,
        "TRAINING_AUTHORIZATION": "OFF",
        "READY_FOR_STAGE3_TRAINING_AUTHORIZATION": "NO",
        "stage3_authorization": "NO",
        "stage3_design_readiness": stage3_design_ready,
        "selection": {c["cell_id"]: c["selected"]["run_id"] for c in selection["cells"]},
        "endpoint_ok": endpoint_ok,
        "trajectories": [{k: t[k] for k in t if k != "alphas"} | {"alphas": t["alphas"]} for t in trajectories],
        "pareto": pareto,
        "binary_scorer_robustness": {
            "per_trajectory": {t["run_id"]: t["binary_scorer_class"] for t in trajectories},
            "overall": overall_binary,
        },
        "interpolation_classification": interp_class,
        "design_questions": design_q,
        "retention_set_expansion": {
            "RETENTION_SET_EXPANSION": "YES",
            "build_now": False,
            "reason": "Six synthetic literary stems are a parent-behavior instrument, not a capability suite. Phase 2/3A cannot speak to code/JSON/instruction/long-form retention.",
            "recommended_categories_only": [
                "literary prose",
                "factual prose",
                "code",
                "JSON / structured output",
                "instruction following",
                "long-form continuity",
                "special-token stability",
            ],
        },
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "RAEL": "NOT_IMPLEMENTED",
        "QWEN": "THIRD_PARTY_MODEL_RUNNING_LOCALLY",
        "ROADMAP_22": "CLOSED",
        "ROADMAP_23": "ACTIVE",
        "disk_free_gb_before": round(disk0, 2),
        "disk_free_gb_after": round(disk1, 2),
        "disk_delta_gb": round(disk0 - disk1, 3),
        "elapsed_s": round(time.perf_counter() - t0, 3),
        "artifact_root": str(interp_root),
        "utc": utc_now(),
    }
    write_json(interp_root / "INTERPOLATION_SUMMARY.json", summary)
    write_json(interp_root / "PHASE3A_COMPLETE.json", {"ok": True, "utc": utc_now(), "classification": interp_class["classification"]})
    write_json(report_path, summary)
    print(json.dumps({"ok": True, "classification": interp_class["classification"], "overall_binary": overall_binary, "stage3_design": stage3_design_ready}, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
