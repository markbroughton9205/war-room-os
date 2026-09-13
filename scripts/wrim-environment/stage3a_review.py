"""WRIM1-RUN-000003 STAGE3A Commander review. ZERO optimizer steps.

Read-only SHA verification, metric provenance, step-25 full eval, CAP-EVAL-0,
post-hoc WRIM-0 interpolation, Pareto. Does not train. Does not start STAGE3B.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
import torch
from safetensors.torch import load_file
from tokenizers import Tokenizer

from phase2_grid import FROZEN_NLL_SHA, parameter_displacement, sha256_json_text
from safetensors_model import load_model_state_from_safetensors
from phase3a_interpolation import ALPHAS, lerp_state, load_into_model, pareto_analysis, strip_item_ids, tensors_sha256, verify_endpoint_keys
from stage3_eval_baseline import concat_units
from stage3_runtime import (
    BASELINE_SHA,
    PARAM_COUNT,
    PARENT_SHA,
    REVIEW_BANDS,
    RUN_ID,
    SEED,
    SUITE_SHA,
    TOKENIZER_SHA,
    TRAINING_AUTHORIZATION,
    STAGE3_AUTHORIZATION,
    STAGE3B_AUTHORIZATION,
    authorization_gate,
    utc_now,
    write_json,
)
from stage3_schedule import lr_stage3a
from stage3a_run import (
    cap_eval_overlay,
    disable_tf32,
    evaluate_candidate,
    load_baseline,
    load_suite,
    review_band_crossings,
    sha256_file,
)
from stage2_pack import encode_corpus1_val_units, encode_rehearsal_val_units
from wrim_g20m import WRIM0Model, expected_torch_keys

EXPECTED_STEP25_SHA = "1d53486a98290fdbd3a43d6e8d7d7ec84b65ea08271ec0f8fb75a00f5542b5d1"
EXPECTED_STEP50_SHA = "e20e73347c9fc97a3b29fc26c3c13f79f0fc0cee9bbb7acf728cc395a543a11d"
VAL0_PARENT = 8.890125
VAL1_PARENT = 7.971308


def summarize_eval(ev: dict[str, Any]) -> dict[str, Any]:
    aggs = ev.get("category_aggregates") or {}
    return {
        "step": ev.get("step"),
        "mean_wrim0_anchor_nll_delta": ev.get("mean_wrim0_anchor_nll_delta"),
        "mean_kl_wrim0_to_candidate": ev.get("mean_kl_wrim0_to_candidate"),
        "val_loss_corpus0": ev.get("val_loss_corpus0"),
        "val_loss_corpus1": ev.get("val_loss_corpus1"),
        "historical_binary": ev.get("historical_binary"),
        "historical_pass_count": ev.get("historical_pass_count"),
        "n_collapsed": ev.get("n_collapsed"),
        "special_token_mean_rate": ev.get("special_token_mean_rate"),
        "json": aggs.get("JSON_STRUCTURED_OUTPUT"),
        "instruction": aggs.get("INSTRUCTION_FOLLOWING"),
        "long_form": aggs.get("LONG_FORM_CONTINUITY"),
        "special": aggs.get("SPECIAL_TOKEN_STABILITY"),
        "code": aggs.get("CODE"),
        "literary": aggs.get("LITERARY_PROSE"),
        "factual": aggs.get("FACTUAL_PROSE"),
        "cap_eval_0": {
            "status": (ev.get("cap_eval_0") or {}).get("status"),
            "historical_binary": (ev.get("cap_eval_0") or {}).get("historical_binary"),
            "items": (ev.get("cap_eval_0") or {}).get("items"),
        },
        "diagnostic_0_json": ev.get("diagnostic_0_json"),
        "parameter_displacement": ev.get("parameter_displacement"),
        "collapsed_item_ids": [
            r["item_id"]
            for r in (ev.get("items") or [])
            if (r.get("descriptive_256") or r.get("historical_32") or {}).get("collapsed")
        ],
    }


def reconstruct_metrics(metrics_path: Path) -> dict[str, Any]:
    rows = []
    if metrics_path.exists():
        for line in metrics_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                rows.append(json.loads(line))
    steps = [int(r.get("global_step") or 0) for r in rows]
    lrs = [float(r.get("lr") or 0.0) for r in rows]
    losses = [float(r.get("loss") or 0.0) for r in rows]
    expected_lr = [lr_stage3a(s) for s in range(1, 51)]
    lr_ok = len(lrs) == 50 and all(abs(a - b) <= 1e-15 for a, b in zip(lrs, expected_lr))
    tokens_ok = len(rows) == 50 and all(int(r.get("tokens_seen") or -1) == s * 4096 for s, r in zip(range(1, 51), rows))
    finite = all(math.isfinite(x) for x in losses) and all(math.isfinite(float(r.get("grad_norm") or 0.0)) for r in rows)
    return {
        "n_rows": len(rows),
        "steps": steps,
        "steps_1_through_50_consecutive": steps == list(range(1, 51)),
        "step_51_present": 51 in steps,
        "lr_matches_stage3a_formula": lr_ok,
        "tokens_seen_matches_4096_times_step": tokens_ok,
        "all_loss_and_grad_finite": finite,
        "clip_events": int(sum(1 for r in rows if r.get("clip_event"))),
        "clip_rate": (sum(1 for r in rows if r.get("clip_event")) / max(1, len(rows))),
        "step1": None if not rows else {"lr": rows[0].get("lr"), "loss": rows[0].get("loss"), "grad_norm": rows[0].get("grad_norm"), "tokens_seen": rows[0].get("tokens_seen")},
        "step25": None if len(rows) < 25 else {"lr": rows[24].get("lr"), "loss": rows[24].get("loss"), "grad_norm": rows[24].get("grad_norm"), "update_norm": rows[24].get("update_norm"), "tokens_seen": rows[24].get("tokens_seen"), "clip_event": rows[24].get("clip_event")},
        "step50": None if len(rows) < 50 else {"lr": rows[49].get("lr"), "loss": rows[49].get("loss"), "grad_norm": rows[49].get("grad_norm"), "update_norm": rows[49].get("update_norm"), "tokens_seen": rows[49].get("tokens_seen"), "clip_event": rows[49].get("clip_event")},
        "source": str(metrics_path),
        "ok": len(rows) == 50 and steps == list(range(1, 51)) and lr_ok and tokens_ok and finite and 51 not in steps,
    }


def load_frozen_inference(path: Path, device: torch.device) -> tuple[WRIM0Model, dict[str, torch.Tensor]]:
    raw = load_file(str(path))
    if set(raw) == set(expected_torch_keys()):
        state = {k: v.contiguous() for k, v in raw.items()}
    else:
        state, coverage = load_model_state_from_safetensors(path)
        if set(state) != set(expected_torch_keys()):
            raise RuntimeError(f"unexpected keys in {path}: {coverage}")
    cpu = {k: v.detach().cpu().contiguous() for k, v in state.items()}
    model = WRIM0Model()
    model.load_state_dict(state, strict=True)
    n = int(sum(p.numel() for p in model.parameters()))
    if n != PARAM_COUNT:
        raise RuntimeError(f"param count {n} != {PARAM_COUNT}")
    model.freeze_inference()
    return model.to(device), cpu


def run_review(
    *,
    weights: Path,
    tokenizer_path: Path,
    dump_root: Path,
    suite_path: Path,
    baseline_path: Path,
    nll_anchor_path: Path,
    ckpt_root: Path,
    report_path: Path,
) -> dict[str, Any]:
    if TRAINING_AUTHORIZATION != "OFF":
        raise SystemExit("TRAINING_AUTHORIZATION must remain OFF for this review")
    gate = authorization_gate(requested_mode="stage3a")
    if gate.get("allowed"):
        raise SystemExit("STAGE3A training gate must be closed during review")
    if STAGE3B_AUTHORIZATION != "NO":
        raise SystemExit("STAGE3B must remain unauthorized")

    step25 = ckpt_root / "step-25" / "model.safetensors"
    step50 = ckpt_root / "step-50" / "model.safetensors"
    missing = [str(p) for p in (weights, tokenizer_path, dump_root, suite_path, baseline_path, nll_anchor_path, step25, step50) if not p.exists()]
    if missing:
        payload = {"ok": False, "kind": "STAGE3A_REVIEW_BLOCKED", "reason": "missing_required_path", "missing": missing, "TRAINING_AUTHORIZATION": "OFF"}
        write_json(report_path, payload)
        return payload

    disable_tf32()
    parent_sha = sha256_file(weights)
    tok_sha = sha256_file(tokenizer_path)
    suite = load_suite(suite_path)
    baseline = load_baseline(baseline_path)
    nll_sha = sha256_json_text(nll_anchor_path)
    s25_sha = sha256_file(step25)
    s50_sha = sha256_file(step50)
    sha_ok = (
        parent_sha == PARENT_SHA
        and tok_sha == TOKENIZER_SHA
        and suite["hash_ok"]
        and baseline["hash_ok"]
        and nll_sha == FROZEN_NLL_SHA
        and s25_sha == EXPECTED_STEP25_SHA
        and s50_sha == EXPECTED_STEP50_SHA
    )
    provenance = reconstruct_metrics(ckpt_root / "metrics.jsonl")
    review_dir = ckpt_root / "review"
    review_dir.mkdir(parents=True, exist_ok=True)
    sha_block = {
        "parent": {"got": parent_sha, "expected": PARENT_SHA, "ok": parent_sha == PARENT_SHA},
        "tokenizer": {"got": tok_sha, "expected": TOKENIZER_SHA, "ok": tok_sha == TOKENIZER_SHA},
        "suite": {"got": suite["stored_hash"], "expected": SUITE_SHA, "ok": suite["hash_ok"]},
        "baseline": {"got": baseline["sha256"], "expected": BASELINE_SHA, "ok": baseline["hash_ok"]},
        "historical_nll_anchor": {"got": nll_sha, "expected": FROZEN_NLL_SHA, "ok": nll_sha == FROZEN_NLL_SHA, "path": str(nll_anchor_path)},
        "step25_model": {"got": s25_sha, "expected": EXPECTED_STEP25_SHA, "ok": s25_sha == EXPECTED_STEP25_SHA},
        "step50_model": {"got": s50_sha, "expected": EXPECTED_STEP50_SHA, "ok": s50_sha == EXPECTED_STEP50_SHA},
    }
    if not sha_ok or not provenance["ok"]:
        payload = {
            "ok": False,
            "kind": "STAGE3A_REVIEW_BLOCKED",
            "reason": "sha_or_metric_provenance_failure",
            "sha": sha_block,
            "metric_provenance": provenance,
            "TRAINING_AUTHORIZATION": "OFF",
            "optimizer_steps_this_pass": 0,
        }
        write_json(report_path, payload)
        write_json(review_dir / "REVIEW_BLOCKED.json", payload)
        return payload

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    parent_model, parent_cpu = load_frozen_inference(weights, device)
    cand25_state = {k: v.contiguous() for k, v in load_file(str(step25)).items()}
    cand50_state = {k: v.contiguous() for k, v in load_file(str(step50)).items()}
    keys_ok, key_reasons = verify_endpoint_keys(cand50_state, parent_cpu)
    if not keys_ok:
        payload = {"ok": False, "kind": "STAGE3A_REVIEW_BLOCKED", "reason": "interpolation_endpoint_keys", "details": key_reasons, "TRAINING_AUTHORIZATION": "OFF"}
        write_json(report_path, payload)
        return payload

    c0 = concat_units(encode_rehearsal_val_units(tokenizer, dump_root))
    c1 = concat_units(encode_corpus1_val_units(tokenizer, dump_root))
    suite_items = suite["obj"]["items"]
    frozen_items = baseline["obj"]["items"]
    frozen_special = float((baseline["obj"].get("special_token_baseline") or {}).get("mean_special_rate_256") or 0.0)
    wrim0_logp: dict[str, torch.Tensor] = {}

    print("[review] parent logp cache + CAP-EVAL-0 overlay", flush=True)
    parent_eval = evaluate_candidate(
        model=parent_model,
        tokenizer=tokenizer,
        device=device,
        dump_root=dump_root,
        suite_items=suite_items,
        frozen_items=frozen_items,
        wrim0_logp=wrim0_logp,
        parent_cpu=parent_cpu,
        c0=c0,
        c1=c1,
        greedy_256=False,
        step=0,
        train_loss=None,
        tokens=0,
        lr=None,
    )
    if len(wrim0_logp) != 35:
        payload = {"ok": False, "kind": "STAGE3A_REVIEW_BLOCKED", "reason": "parent_logp_cache_incomplete", "n": len(wrim0_logp)}
        write_json(report_path, payload)
        return payload

    print("[review] step-25 FULL Stage3 evaluation", flush=True)
    model25 = load_into_model(cand25_state, device)
    eval25_full = evaluate_candidate(
        model=model25,
        tokenizer=tokenizer,
        device=device,
        dump_root=dump_root,
        suite_items=suite_items,
        frozen_items=frozen_items,
        wrim0_logp=wrim0_logp,
        parent_cpu=parent_cpu,
        c0=c0,
        c1=c1,
        greedy_256=True,
        step=25,
        train_loss=None,
        tokens=102400,
        lr=lr_stage3a(25),
    )
    write_json(review_dir / "step-25-full.json", eval25_full)
    del model25

    print("[review] step-50 live compact verification", flush=True)
    model50 = load_into_model(cand50_state, device)
    eval50_live = evaluate_candidate(
        model=model50,
        tokenizer=tokenizer,
        device=device,
        dump_root=dump_root,
        suite_items=suite_items,
        frozen_items=frozen_items,
        wrim0_logp=wrim0_logp,
        parent_cpu=parent_cpu,
        c0=c0,
        c1=c1,
        greedy_256=False,
        step=50,
        train_loss=None,
        tokens=204800,
        lr=lr_stage3a(50),
    )
    stored50 = json.loads((ckpt_root / "evals" / "step-50.json").read_text(encoding="utf-8"))
    live_vs_stored = {
        "dnll_live": eval50_live.get("mean_wrim0_anchor_nll_delta"),
        "dnll_stored": stored50.get("mean_wrim0_anchor_nll_delta"),
        "kl_live": eval50_live.get("mean_kl_wrim0_to_candidate"),
        "kl_stored": stored50.get("mean_kl_wrim0_to_candidate"),
        "val0_live": eval50_live.get("val_loss_corpus0"),
        "val0_stored": stored50.get("val_loss_corpus0"),
        "val1_live": eval50_live.get("val_loss_corpus1"),
        "val1_stored": stored50.get("val_loss_corpus1"),
        "cap_live": eval50_live.get("historical_binary"),
        "cap_stored": stored50.get("historical_binary"),
    }
    need_full50 = False
    for a, b in (
        (live_vs_stored["dnll_live"], live_vs_stored["dnll_stored"]),
        (live_vs_stored["kl_live"], live_vs_stored["kl_stored"]),
        (live_vs_stored["val0_live"], live_vs_stored["val0_stored"]),
        (live_vs_stored["val1_live"], live_vs_stored["val1_stored"]),
    ):
        if abs(float(a) - float(b)) > 5e-4:
            need_full50 = True
    eval50_full = stored50
    if need_full50:
        print("[review] step-50 FULL reevaluation (live compact mismatched stored)", flush=True)
        eval50_full = evaluate_candidate(
            model=model50,
            tokenizer=tokenizer,
            device=device,
            dump_root=dump_root,
            suite_items=suite_items,
            frozen_items=frozen_items,
            wrim0_logp=wrim0_logp,
            parent_cpu=parent_cpu,
            c0=c0,
            c1=c1,
            greedy_256=True,
            step=50,
            train_loss=None,
            tokens=204800,
            lr=lr_stage3a(50),
        )
        write_json(review_dir / "step-50-full-reeval.json", eval50_full)
    else:
        write_json(review_dir / "step-50-live-compact.json", eval50_live)

    lerp0 = lerp_state(cand50_state, parent_cpu, 0.0)
    lerp1 = lerp_state(cand50_state, parent_cpu, 1.0)
    endpoint = {
        "lerp0_matches_candidate": tensors_sha256(lerp0) == tensors_sha256(cand50_state),
        "lerp1_matches_parent": tensors_sha256(lerp1) == tensors_sha256(parent_cpu),
    }
    if not endpoint["lerp0_matches_candidate"] or not endpoint["lerp1_matches_parent"]:
        fail = {"ok": False, "kind": "INTERPOLATION_ENDPOINT_FAILURE", "endpoint": endpoint, "TRAINING_AUTHORIZATION": "OFF", "optimizer_steps_this_pass": 0}
        write_json(review_dir / "INTERPOLATION_ENDPOINT_FAILURE.json", fail)
        write_json(report_path, fail)
        return fail

    print("[review] post-hoc interpolation alphas", ALPHAS, flush=True)
    interp_rows = []
    for alpha in ALPHAS:
        merged = lerp_state(cand50_state, parent_cpu, float(alpha))
        model = load_into_model(merged, device)
        ev = evaluate_candidate(
            model=model,
            tokenizer=tokenizer,
            device=device,
            dump_root=dump_root,
            suite_items=suite_items,
            frozen_items=frozen_items,
            wrim0_logp=wrim0_logp,
            parent_cpu=parent_cpu,
            c0=c0,
            c1=c1,
            greedy_256=False,
            step=50,
            train_loss=None,
            tokens=204800,
            lr=None,
        )
        row = {
            "run_id": RUN_ID,
            "alpha": float(alpha),
            "mean_wrim0_anchor_nll_delta": ev.get("mean_wrim0_anchor_nll_delta"),
            "mean_kl_wrim0_to_candidate": ev.get("mean_kl_wrim0_to_candidate"),
            "val_loss_corpus0": ev.get("val_loss_corpus0"),
            "val_loss_corpus1": ev.get("val_loss_corpus1"),
            "historical_binary": ev.get("historical_binary"),
            "historical_pass_count": ev.get("historical_pass_count"),
            "n_collapsed": ev.get("n_collapsed"),
            "special_token_mean_rate": ev.get("special_token_mean_rate"),
            "json_valid_count": ((ev.get("category_aggregates") or {}).get("JSON_STRUCTURED_OUTPUT") or {}).get("json_valid_count"),
            "displacement": parameter_displacement(model, parent_cpu),
            "review_band_crossings": review_band_crossings(ev, frozen_special),
        }
        interp_rows.append(row)
        write_json(review_dir / f"interp-alpha-{alpha:.1f}.json", {**row, "eval": strip_item_ids(ev)})
        print(json.dumps({"alpha": alpha, **{k: row[k] for k in ("mean_wrim0_anchor_nll_delta", "mean_kl_wrim0_to_candidate", "val_loss_corpus0", "val_loss_corpus1", "historical_binary")}}), flush=True)
        del model

    pareto = pareto_analysis(interp_rows)
    raw_crossings = review_band_crossings(eval50_full, frozen_special)
    inside_bands = len(raw_crossings) == 0
    healthy = inside_bands and float(eval50_full["val_loss_corpus0"]) < VAL0_PARENT and float(eval50_full["val_loss_corpus1"]) < VAL1_PARENT
    classification = "A. HEALTHY_FOR_CONTINUATION_REVIEW" if healthy else "B. REVIEW_REQUIRED_CONTINUOUS_DRIFT"
    if any("collapse" in c or "category" in c for c in raw_crossings) and not any(c.startswith("anchor_dnll") or c.startswith("kl") or c.startswith("val") for c in raw_crossings):
        classification = "C. REVIEW_REQUIRED_CATEGORY_REGRESSION"

    payload = {
        "ok": True,
        "kind": "STAGE3A_COMMANDER_REVIEW",
        "run_id": RUN_ID,
        "segment": "STAGE3A",
        "optimizer_steps_this_pass": 0,
        "parameter_update_count_this_pass": 0,
        "TRAINING_AUTHORIZATION": "OFF",
        "STAGE3_AUTHORIZATION": STAGE3_AUTHORIZATION,
        "STAGE3B_AUTHORIZATION": "NO",
        "STAGE3B_EXECUTION_READINESS": False,
        "promotion_candidate": False,
        "interpolation_executed": True,
        "interpolation_auto_promoted": False,
        "sha": sha_block,
        "metric_provenance": provenance,
        "endpoint": endpoint,
        "parent_eval_compact": summarize_eval(parent_eval),
        "step25_full": summarize_eval(eval25_full),
        "step50_stored_full": summarize_eval(stored50),
        "step50_live_compact": summarize_eval(eval50_live),
        "step50_live_vs_stored": live_vs_stored,
        "step50_full_reevaluated": need_full50,
        "historical_retention": {
            "parent_compact": parent_eval.get("historical_binary"),
            "step25_full": eval25_full.get("historical_binary"),
            "step50_stored": stored50.get("historical_binary"),
            "step50_live_compact": eval50_live.get("historical_binary"),
            "status": "COMPATIBILITY_ONLY",
        },
        "interpolation": interp_rows,
        "pareto": pareto,
        "raw_review_band_crossings": raw_crossings,
        "raw_inside_review_bands": inside_bands,
        "HEALTHY_FOR_CONTINUATION": healthy,
        "final_classification": classification,
        "candidate_state": "EVALUATION_CANDIDATE",
        "review_bands": REVIEW_BANDS["stage3a_step_50"],
        "seed": SEED,
        "device": str(device),
        "utc": utc_now(),
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "QWEN": "THIRD_PARTY_MODEL_RUNNING_LOCALLY",
        "RAEL": "NOT_IMPLEMENTED",
        "ROADMAP_22": "CLOSED",
        "ROADMAP_23": "ACTIVE",
    }
    write_json(report_path, payload)
    write_json(review_dir / "STAGE3A_REVIEW.json", payload)
    print(json.dumps({k: payload.get(k) for k in ("ok", "final_classification", "HEALTHY_FOR_CONTINUATION", "optimizer_steps_this_pass", "TRAINING_AUTHORIZATION", "raw_review_band_crossings")}, indent=2), flush=True)
    return payload


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--dump-root", required=True)
    ap.add_argument("--suite", required=True)
    ap.add_argument("--baseline", required=True)
    ap.add_argument("--nll-anchor", required=True)
    ap.add_argument("--ckpt-dir", required=True)
    ap.add_argument("--report", required=True)
    args = ap.parse_args()
    out = run_review(
        weights=Path(args.weights),
        tokenizer_path=Path(args.tokenizer),
        dump_root=Path(args.dump_root),
        suite_path=Path(args.suite),
        baseline_path=Path(args.baseline),
        nll_anchor_path=Path(args.nll_anchor),
        ckpt_root=Path(args.ckpt_dir),
        report_path=Path(args.report),
    )
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
