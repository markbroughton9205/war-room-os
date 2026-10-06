"""P1 data-readiness / interleave packer / stop-rule hardening.

Zero optimizer steps. Does not mutate WR-CORPUS or the tokenizer. Does not train P2.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from tokenizers import Tokenizer

from foundational_p1_pack import (
    PACKER_MODE,
    PACKER_VERSION,
    P2_MIX,
    P2_STEPS,
    P2_TOKENS,
    SEED,
    TOKENS_PER_STEP,
    build_p2_diagnostic_stream,
    burst_stats,
    step_map,
)
from stop_policy import STOP_POLICY_VERSION, decide, simulate_boundary, snapshot_from_compact

P1_ID = "WRIM1-NEBULA-FOUNDATIONAL-P1-000001"
P2_RUN_ID_PROPOSAL = "WRIM1-RUN-000005"
PARENT_SHA = "d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015"
TOKENIZER_SHA = "47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7"
HISTORICAL_000004_STREAM_SHA = "50e26654ab26493000f3b0e26dc720a3b64da8b27ba93abcf6f9c91e2d28b29d"
EVAL_CADENCE = [0, 25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def load_compact(ckpt: Path, step: int) -> dict[str, Any]:
    p = ckpt / "evals" / f"step-{step}.compact.json"
    return json.loads(p.read_text(encoding="utf-8"))


def replay_000004(ckpt: Path) -> dict[str, Any]:
    parent = snapshot_from_compact(load_compact(ckpt, 0))
    by_step = {}
    first_block = None
    for step in (5, 10, 15, 20, 25):
        cand = snapshot_from_compact(load_compact(ckpt, step))
        decision = decide(parent, cand)
        by_step[str(step)] = {"snapshot": cand, **decision}
        if first_block is None and not decision["next_optimizer_step_allowed"]:
            first_block = {"step": step, "decision": decision["decision"], "hits": decision["hits"], "artifact": decision["artifact"]}
    return {
        "parent": parent,
        "by_step": by_step,
        "step15_soft_stop": by_step["15"]["decision"] == "SOFT_STOP",
        "step15_decision": by_step["15"]["decision"],
        "step20_soft_stop": by_step["20"]["decision"] == "SOFT_STOP",
        "step20_decision": by_step["20"]["decision"],
        "first_checkpoint_that_blocks_next_step": first_block,
        "step25_would_have_been_prevented": first_block is not None and int(first_block["step"]) < 25,
        "history_rewritten": False,
        "policy_version": STOP_POLICY_VERSION,
    }


def boundary_simulations(parent: dict[str, Any]) -> dict[str, Any]:
    two_deg = dict(parent)
    two_deg["looping"] = int(parent["looping"]) + 2
    two_deg["unique256"] = float(parent["unique256"]) - 0.06
    one_deg = dict(parent)
    one_deg["looping"] = int(parent["looping"]) + 2
    zero = dict(parent)
    floor_same = dict(parent)
    floor_same["json_valid"] = 0
    floor_same["instruction"] = 0
    left_floor = dict(parent)
    left_floor["json_valid"] = 1
    cases = {
        "two_degradations": simulate_boundary(parent, two_deg, checkpoint_n=100),
        "one_degradation": simulate_boundary(parent, one_deg, checkpoint_n=100),
        "zero_degradations": simulate_boundary(parent, zero, checkpoint_n=100),
        "json_remain_zero_not_a_hit": simulate_boundary(parent, floor_same, checkpoint_n=100),
        "json_leave_floor_not_a_generation_hit": simulate_boundary(parent, left_floor, checkpoint_n=100),
        "hard_nan": simulate_boundary(parent, {**parent, "nan_or_inf": True}, checkpoint_n=100),
    }
    proofs = {
        "two_hits_soft_stop": cases["two_degradations"]["decision"] == "SOFT_STOP" and cases["two_degradations"]["step_n_plus_1_blocked"] is True,
        "one_hit_review_blocks_next": cases["one_degradation"]["decision"] == "REVIEW_REQUIRED" and cases["one_degradation"]["step_n_plus_1_blocked"] is True,
        "zero_hits_continue_eligible": cases["zero_degradations"]["decision"] == "CONTINUE_ELIGIBLE" and cases["zero_degradations"]["next_optimizer_step_allowed"] is True,
        "floor_zero_not_degradation": cases["json_remain_zero_not_a_hit"]["hit_count"] == 0 and cases["json_remain_zero_not_a_hit"]["floor_metric_states"]["json_valid"] == "UNCHANGED_AT_FLOOR",
        "hard_abort_separate": cases["hard_nan"]["decision"] == "HARD_ABORT" and cases["hard_nan"]["step_n_plus_1_blocked"] is True,
    }
    return {"cases": cases, "proofs": proofs, "all_proofs_ok": all(proofs.values())}


def packing_quality(steps: list[dict[str, Any]], bursts: dict[str, Any], packed: dict[str, Any], target: dict[str, float]) -> dict[str, Any]:
    realized = packed["packed_token_counts"]
    total = int(sum(realized.values())) or 1
    realized_frac = {k: realized.get(k, 0) / total for k in target}
    drift = {k: round(abs(realized_frac[k] - target[k]), 4) for k in target}
    unavoidable_json = bursts["n_100pct_json"] > 0 and all(
        s.get("hundred_pct_json") and not any(fam != "json" and (s.get("mix") or {}).get(fam, 0) > 0 for fam in (s.get("mix") or {}))
        for s in steps if s.get("hundred_pct_json")
    )
    gates = {
        "A_no_100pct_json_unless_unavoidable": bursts["n_100pct_json"] == 0,
        "B_no_100pct_c0_unless_unavoidable": bursts["n_100pct_c0"] == 0,
        "C_dominant_burst_bounded": (
            int(bursts["longest_ge90_family_run_steps"]) <= 4
            and int(bursts["longest_same_family_excerpt_tokens"]) <= TOKENS_PER_STEP * 2
            and bursts.get("late_run_json_binge_like_000004") is False
            and bursts.get("late_run_mono_family_binge") is not True
        ),
        "D_allocation_converges": max(drift.values()) <= 0.04,
        "E_seed_reproducible": True,  # filled after second pack
        "F_eval_records_excluded": True,
        "G_provenance_complete": True,
        "H_no_corpus_mutation": packed.get("corpus_mutated") is False,
    }
    return {
        "realized_frac": {k: round(v, 4) for k, v in realized_frac.items()},
        "drift_from_target": drift,
        "max_drift": max(drift.values()),
        "unavoidable_json_claimed": unavoidable_json,
        "gates": gates,
    }


def classify_data(pool_tokens: dict[str, int], mix: dict[str, float]) -> str:
    unique_pool = int(sum(pool_tokens.values()))
    missing = [fam for fam, share in mix.items() if share > 0 and int(pool_tokens.get(fam, 0)) <= 0]
    if unique_pool <= 0 or missing:
        return "C. P2_EXISTING_DATA_INSUFFICIENT"
    reuse_needed = any(int(pool_tokens.get(fam, 0)) < P2_TOKENS * share for fam, share in mix.items())
    if not reuse_needed and unique_pool >= P2_TOKENS:
        return "A. P2_EXISTING_DATA_READY"
    return "B. P2_EXISTING_DATA_READY_WITH_CONTROLLED_REUSE"


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--weights", required=True)
    p.add_argument("--tokenizer", required=True)
    p.add_argument("--dump-root", required=True)
    p.add_argument("--ckpt-000004", required=True)
    p.add_argument("--design", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--report", required=True)
    args = p.parse_args()
    started = utc_now()
    weights = Path(args.weights)
    tok_path = Path(args.tokenizer)
    parent_sha = sha256_file(weights)
    tok_sha = sha256_file(tok_path)
    sha_ok = parent_sha == PARENT_SHA and tok_sha == TOKENIZER_SHA
    if not sha_ok:
        raise SystemExit(f"hash mismatch parent={parent_sha} tok={tok_sha}")
    ckpt = Path(args.ckpt_000004)
    historical_stream = ckpt / "corrective-stream.npy"
    historical_sha = hashlib.sha256(np.load(historical_stream).tobytes()).hexdigest() if historical_stream.exists() else None
    if historical_sha and historical_sha != HISTORICAL_000004_STREAM_SHA:
        raise SystemExit("refuses to rewrite or mismatch WRIM1-RUN-000004 frozen stream")

    design = json.loads(Path(args.design).read_text(encoding="utf-8")) if Path(args.design).exists() else {}
    tokenizer = Tokenizer.from_file(str(tok_path))
    print("[p1] pack diagnostic stream", flush=True)
    packed = build_p2_diagnostic_stream(dump_root=Path(args.dump_root), tokenizer=tokenizer)
    print("[p1] pack second pass for SHA", flush=True)
    packed2 = build_p2_diagnostic_stream(dump_root=Path(args.dump_root), tokenizer=tokenizer)
    sha_match = packed["stream_sha256"] == packed2["stream_sha256"]
    if not sha_match:
        raise SystemExit("DEFICIT_INTERLEAVE_FAMILIES is not deterministic")
    stream = packed.pop("stream")
    packed2.pop("stream", None)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    np.save(out_dir / "p2-diagnostic-stream.npy", stream)
    stream_sha = hashlib.sha256(stream.tobytes()).hexdigest()
    packed_ids_sha = hashlib.sha256("\n".join(packed["packed_source_ids"]).encode("utf-8")).hexdigest()
    print("[p1] step map", flush=True)
    steps = step_map(packed["unit_spans"])
    bursts = burst_stats(steps, packed["unit_spans"])
    quality = packing_quality(steps, bursts, packed, P2_MIX)
    quality["gates"]["E_seed_reproducible"] = sha_match and stream_sha == packed["stream_sha256"]
    quality["gates"]["F_eval_records_excluded"] = not any(
        any(m in str(s.get("unit_id")) or m in str(s.get("source_path")) for m in packed["eval_markers_checked"])
        for s in packed["unit_spans"]
    )
    quality["gates"]["G_provenance_complete"] = all(
        bool(s.get("bucket")) and bool(s.get("origin")) and bool(s.get("unit_id")) and s.get("source_path") is not None and int(s.get("n") or 0) > 0
        for s in packed["unit_spans"]
    )
    quality["all_packing_gates_ok"] = all(quality["gates"].values())

    doc_takes = packed.pop("doc_takes")
    doc_tokens = packed.pop("doc_tokens")
    spans = packed.pop("unit_spans")
    packed_source_sha = hashlib.sha256(
        "\n".join(f"{s['unit_id']}\t{s['n']}\t{s['bucket']}\t{s['origin']}" for s in spans).encode("utf-8")
    ).hexdigest()
    top_docs = sorted(doc_takes.items(), key=lambda kv: kv[1], reverse=True)[:15]
    max_reuse = max(doc_takes.values()) if doc_takes else 0
    unique_pool = int(sum(packed["pool_tokens"].values()))
    reuse_by_family = packed.get("reuse_by_family") or {}
    unique_exposure = int(sum(int(v.get("unique_exposure_est") or 0) for v in reuse_by_family.values()))
    repeated_exposure = int(sum(int(v.get("repeated_exposure_est") or 0) for v in reuse_by_family.values()))
    vocab_unique = int(len(np.unique(stream)))

    print("[p1] stop-policy replay", flush=True)
    replay = replay_000004(ckpt)
    parent_snap = replay["parent"]
    sims = boundary_simulations(parent_snap)
    sim_dir = out_dir / "stop-sim"
    sim_dir.mkdir(parents=True, exist_ok=True)
    two = sims["cases"]["two_degradations"]
    write_json(sim_dir / "SOFT_STOP.json", {"kind": "SOFT_STOP", "sim": True, **two})
    write_json(sim_dir / "REVIEW_REQUIRED.json", {"kind": "REVIEW_REQUIRED", "sim": True, **sims["cases"]["one_degradation"]})

    data_class = classify_data(packed["pool_tokens"], P2_MIX)
    packing_ok = quality["all_packing_gates_ok"]
    control_ok = sims["all_proofs_ok"]
    ready = packing_ok and control_ok and sha_ok and historical_sha == HISTORICAL_000004_STREAM_SHA
    p2_status = "READY_TO_REQUEST_AUTHORIZATION" if ready else "NOT_READY"
    p1_class = "P1_FOUNDATIONAL_READINESS_READY" if ready else "P1_FOUNDATIONAL_READINESS_BLOCKED"

    step_summary_path = out_dir / "p2-diagnostic-step-map.json"
    write_json(step_summary_path, {"n_steps": len(steps), "steps": steps})

    p2_artifact = {
        "P2_RUN_ID_PROPOSAL": P2_RUN_ID_PROPOSAL,
        "parent": "WRIM-0",
        "parent_sha256": parent_sha,
        "tokenizer_sha256": tok_sha,
        "packer_mode": PACKER_MODE,
        "packer_version": PACKER_VERSION,
        "seed": SEED,
        "stream_sha256": stream_sha,
        "packed_source_sha256": packed_source_sha,
        "packed_source_ids_sha256": packed_ids_sha,
        "target_token_count": P2_TOKENS,
        "step_count": P2_STEPS,
        "tokens_per_step": TOKENS_PER_STEP,
        "family_targets": P2_MIX,
        "realized_family_mix": quality["realized_frac"],
        "reuse_policy": {
            "wrap_epochs_allowed": True,
            "alice_cap_frac": 0.03,
            "max_single_doc_frac": 0.08,
            "max_single_doc_frac_hard_ceiling": 0.15,
            "max_family_frac_per_step": 0.55,
            "unique_is_not_claimed_for_repeated_tokens": True,
        },
        "stop_policy_version": STOP_POLICY_VERSION,
        "checkpoint_cadence_proposal": EVAL_CADENCE,
        "evaluation_cadence_proposal": EVAL_CADENCE,
        "eval_cadence_rationale": "RUN-000004 moved looping/unique within 5–10 steps. Eval every 200 would miss early degeneration on a 1000-step diagnostic. Proposed 0,25,50,100 then every 100. Estimate ~13 compact evals × 55.8s ≈ 12 min eval + ~2.5 min train if later authorized.",
        "READY_TO_REQUEST_AUTHORIZATION": ready,
        "status": p2_status,
        "AUTHORIZED": False,
        "TRAINING_AUTHORIZATION": "OFF",
    }
    write_json(out_dir / "p2-readiness-proposal.json", p2_artifact)

    payload = {
        "ok": ready,
        "kind": "WRIM_FOUNDATIONAL_P1_READINESS",
        "p1_id": P1_ID,
        "final_classification": p1_class,
        "optimizer_steps_this_pass": 0,
        "parameter_update_count_this_pass": 0,
        "AdamW_constructed": False,
        "start_timestamp": started,
        "end_timestamp": utc_now(),
        "source_remediation_design_id": design.get("design_id"),
        "source_remediation_classification": design.get("final_classification"),
        "parent_sha256": parent_sha,
        "tokenizer_sha256": tok_sha,
        "sha_ok": True,
        "historical_000004_stream_sha256": historical_sha,
        "historical_000004_stream_preserved": historical_sha == HISTORICAL_000004_STREAM_SHA,
        "document_major_contiguous_still_in_corrective_packer": True,
        "corpus_mutated": False,
        "tokenizer_mutated": False,
        "packing": {
            **{k: packed[k] for k in packed if k != "packed_source_ids"},
            "packed_source_sha256": packed_source_sha,
            "packed_source_id_count": len(packed["packed_source_ids"]),
            "packed_source_ids_sha256": packed_ids_sha,
            "stream_sha256": stream_sha,
            "second_pass_sha256": packed2["stream_sha256"],
            "deterministic": sha_match,
            "n_spans": len(spans),
        },
        "quality": quality,
        "bursts": bursts,
        "reuse": {
            "unique_pool_tokens": unique_pool,
            "packed_tokens": P2_TOKENS,
            "unique_token_exposure_est": unique_exposure,
            "repeated_token_exposure_est": repeated_exposure,
            "corpus_equivalent_passes_est": round(P2_TOKENS / max(1, unique_pool), 3),
            "distinct_token_ids_in_stream": vocab_unique,
            "max_document_take_count": max_reuse,
            "max_document_tokens": max(doc_tokens.values()) if doc_tokens else 0,
            "max_document_frac": round((max(doc_tokens.values()) if doc_tokens else 0) / P2_TOKENS, 4),
            "disproportionate_single_document": (max(doc_tokens.values()) if doc_tokens else 0) > int(P2_TOKENS * 0.15),
            "top_reused_documents": [{"unit_id": k, "takes": v, "tokens": doc_tokens.get(k, 0)} for k, v in top_docs],
            "n_documents_used": len(doc_takes),
            "by_family": reuse_by_family,
        },
        "data_readiness_class": data_class,
        "stop_policy_version": STOP_POLICY_VERSION,
        "run_000004_replay": {
            "step15_decision": replay["step15_decision"],
            "step15_soft_stop": replay["step15_soft_stop"],
            "step20_decision": replay["step20_decision"],
            "step20_soft_stop": replay["step20_soft_stop"],
            "first_historical_block": replay["first_checkpoint_that_blocks_next_step"],
            "step25_would_have_been_prevented": replay["step25_would_have_been_prevented"],
            "history_rewritten": False,
            "by_step_hits": {k: {"decision": v["decision"], "hits": v["hits"], "hit_count": v["hit_count"], "next_allowed": v["next_optimizer_step_allowed"]} for k, v in replay["by_step"].items()},
        },
        "boundary_sim": {"all_proofs_ok": sims["all_proofs_ok"], "proofs": sims["proofs"]},
        "eval_cadence_proposal": EVAL_CADENCE,
        "p2_artifact": p2_artifact,
        "TRAINING_AUTHORIZATION": "OFF",
        "STAGE3B_AUTHORIZATION": "NO",
        "STAGE3B_EXECUTION_READINESS": False,
        "ready_to_run_optimizer": False,
        "P2_AUTHORIZED": False,
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "QWEN_INTELLIGENCE_CLASS": "THIRD_PARTY_MODEL_RUNNING_LOCALLY",
        "RAEL_STATUS": "NOT_IMPLEMENTED",
        "nothing_pushed": True,
        "nothing_deployed": True,
        "step_map_path": str(step_summary_path),
        "stream_path": str(out_dir / "p2-diagnostic-stream.npy"),
    }
    write_json(Path(args.report), payload)
    print(
        json.dumps(
            {
                "ok": ready,
                "final_classification": p1_class,
                "p2_status": p2_status,
                "stream_sha256": stream_sha,
                "data_readiness_class": data_class,
                "optimizer_steps_this_pass": 0,
                "TRAINING_AUTHORIZATION": "OFF",
                "first_historical_block": replay["first_checkpoint_that_blocks_next_step"],
            },
            indent=2,
        ),
        flush=True,
    )
    return 0 if ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
