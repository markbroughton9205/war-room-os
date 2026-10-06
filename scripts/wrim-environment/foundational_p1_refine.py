"""P1 final stream reuse / diversity refinement.

Dry-run only. Does not rewrite the P1 report or the historical P1 stream.
Does not train. Does not mutate WR-CORPUS or the tokenizer.
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

from foundational_p1 import packing_quality
from foundational_p1_pack import (
    PACKER_MODE,
    PACKER_VERSION,
    P2_MIX as P1_MIX,
    P2_STEPS,
    P2_TOKENS,
    TOKENS_PER_STEP,
    build_p2_diagnostic_stream,
    burst_stats,
    step_map,
)
from stop_policy import STOP_POLICY_VERSION

REFINE_ID = "WRIM1-NEBULA-FOUNDATIONAL-P1-STREAM-REFINE-000001"
P1_ID = "WRIM1-NEBULA-FOUNDATIONAL-P1-000001"
P2_RUN_ID_PROPOSAL = "WRIM1-RUN-000005"
PARENT_SHA = "d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015"
TOKENIZER_SHA = "47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7"
HISTORICAL_000004_STREAM_SHA = "50e26654ab26493000f3b0e26dc720a3b64da8b27ba93abcf6f9c91e2d28b29d"
HISTORICAL_P1_STREAM_SHA = "166139473acf7edc5d12210cfa3b456b3bcbc2b56efb0674671da7e8a09796ed"
HISTORICAL_P1_PACKED_SOURCE_SHA = "46cd1fca1cbfedc548035af45ae7db9c82112f70b1c607ce3b72c8de478ce86e"
STOP_POLICY_PATH = Path(__file__).with_name("stop_policy.json")
REFINE_SEED = 2302
REFINE_MIX = {
    "wr_corpus_0": 0.20,
    "prose": 0.25,
    "code": 0.47,
    "json": 0.077,
    "behavior": 0.003,
}
MAX_EPOCHS = {
    "behavior": 2.0,
    "json": 2.0,
    "wr_corpus_0": 2.5,
    "prose": 2.0,
    "code": 1.0,
}
DOC_CAP = 0.05
CODE_CEILING = 0.55
COMPACT_CADENCE = [0, 5, 10, 25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
FULL_CADENCE = [0, 100, 500, 1000]
BEHAVIOR_DECISION = "C. CONTROLLED_MAXIMUM_REPEAT_EPOCHS"
BEHAVIOR_DECISION_RATIONALE = (
    "Behavior unique mass is 5,425 tokens (25 documents). A 3% CLM allocation requires ~22.7 "
    "epochs and would memorize a tiny template pool, confounding looping/uniqueness diagnostics. "
    "The family is not removed: it remains as a trace of War Room behavior format for later SFT. "
    "Hard cap 2.0 epochs (~0.26% of the 4.096M stream)."
)
DOC_DOMINANCE_DECISION = "HARD_CAP_5_PERCENT"
DOC_DOMINANCE_RATIONALE = (
    "frankenstein.txt was 10.24% of the P1 stream. One novel at that share can dominate "
    "generation style. 8% still allows a single book to be the largest stylistic prior. "
    "5% (204,800 tokens) is the diagnostic cap. Mix is not allowed to raise it."
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def npy_payload_sha(path: Path) -> str:
    buf = path.read_bytes()
    if buf[:6] != b"\x93NUMPY":
        raise ValueError(f"not npy: {path}")
    major = buf[6]
    offset = (10 + int.from_bytes(buf[8:10], "little")) if major == 1 else (12 + int.from_bytes(buf[8:12], "little"))
    return hashlib.sha256(buf[offset:]).hexdigest()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--weights", required=True)
    p.add_argument("--tokenizer", required=True)
    p.add_argument("--dump-root", required=True)
    p.add_argument("--ckpt-000004", required=True)
    p.add_argument("--p1-report", required=True)
    p.add_argument("--p1-dir", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--report", required=True)
    args = p.parse_args()
    started = utc_now()

    p1_report_path = Path(args.p1_report)
    if not p1_report_path.exists():
        raise SystemExit("P1 report missing; refuse to refine without preserved P1")
    p1 = json.loads(p1_report_path.read_text(encoding="utf-8"))
    if p1.get("final_classification") != "P1_FOUNDATIONAL_READINESS_READY":
        raise SystemExit("P1 is not READY; refuse to refine")
    p1_stream_sha = ((p1.get("packing") or {}).get("stream_sha256") or p1.get("p2_artifact", {}).get("stream_sha256"))
    p1_packed_sha = ((p1.get("packing") or {}).get("packed_source_sha256") or p1.get("p2_artifact", {}).get("packed_source_sha256"))
    if p1_stream_sha != HISTORICAL_P1_STREAM_SHA or p1_packed_sha != HISTORICAL_P1_PACKED_SOURCE_SHA:
        raise SystemExit("P1 stream identity mismatch; refuse to rewrite P1")
    p1_npy = Path(args.p1_dir) / "p2-diagnostic-stream.npy"
    if p1_npy.exists() and npy_payload_sha(p1_npy) != HISTORICAL_P1_STREAM_SHA:
        raise SystemExit("on-disk P1 stream SHA changed; refuse")

    parent_sha = sha256_file(Path(args.weights))
    tok_sha = sha256_file(Path(args.tokenizer))
    if parent_sha != PARENT_SHA or tok_sha != TOKENIZER_SHA:
        raise SystemExit(f"hash mismatch parent={parent_sha} tok={tok_sha}")
    historical_stream = Path(args.ckpt_000004) / "corrective-stream.npy"
    historical_sha = npy_payload_sha(historical_stream) if historical_stream.exists() else None
    if historical_sha != HISTORICAL_000004_STREAM_SHA:
        raise SystemExit("RUN-000004 stream mismatch")

    stop_json = json.loads(STOP_POLICY_PATH.read_text(encoding="utf-8"))
    stop_unchanged = str(stop_json.get("version")) == STOP_POLICY_VERSION == "wrim-stop-policy-v1"

    p1_reuse = p1.get("reuse") or {}
    old_unique = int(p1_reuse.get("unique_token_exposure_est") or 0)
    old_repeated = int(p1_reuse.get("repeated_token_exposure_est") or 0)

    tokenizer = Tokenizer.from_file(str(args.tokenizer))
    print("[refine] pack candidate stream seed=2302", flush=True)
    packed = build_p2_diagnostic_stream(
        dump_root=Path(args.dump_root),
        tokenizer=tokenizer,
        seed=REFINE_SEED,
        mix=REFINE_MIX,
        max_single_doc_frac=DOC_CAP,
        max_doc_hard_ceiling=DOC_CAP,
        raise_doc_cap_to_hit_mix=False,
        max_epochs=MAX_EPOCHS,
        code_ceiling_frac=CODE_CEILING,
        mix_is_ranking_only=True,
        progress_tag="refine",
        document_group_by="source_path",
    )
    print("[refine] second pass", flush=True)
    packed2 = build_p2_diagnostic_stream(
        dump_root=Path(args.dump_root),
        tokenizer=tokenizer,
        seed=REFINE_SEED,
        mix=REFINE_MIX,
        max_single_doc_frac=DOC_CAP,
        max_doc_hard_ceiling=DOC_CAP,
        raise_doc_cap_to_hit_mix=False,
        max_epochs=MAX_EPOCHS,
        code_ceiling_frac=CODE_CEILING,
        mix_is_ranking_only=True,
        progress_tag="refine2",
        document_group_by="source_path",
    )
    sha_match = packed["stream_sha256"] == packed2["stream_sha256"]
    if not sha_match:
        raise SystemExit("refined DEFICIT_INTERLEAVE_FAMILIES is not deterministic")
    if packed["stream_sha256"] == HISTORICAL_P1_STREAM_SHA:
        raise SystemExit("refined stream collided with frozen P1 stream identity")

    stream = packed.pop("stream")
    packed2.pop("stream", None)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    np.save(out_dir / "refined-p2-diagnostic-stream.npy", stream)
    stream_sha = hashlib.sha256(stream.tobytes()).hexdigest()
    packed_ids_sha = hashlib.sha256("\n".join(packed["packed_source_ids"]).encode("utf-8")).hexdigest()
    steps = step_map(packed["unit_spans"])
    bursts = burst_stats(steps, packed["unit_spans"])
    quality = packing_quality(steps, bursts, packed, packed.get("mix_target") or REFINE_MIX)
    quality["gates"]["E_seed_reproducible"] = sha_match and stream_sha == packed["stream_sha256"]
    quality["gates"]["F_eval_records_excluded"] = not any(
        any(m in str(s.get("unit_id")) or m in str(s.get("source_path")) for m in packed["eval_markers_checked"])
        for s in packed["unit_spans"]
    )
    quality["gates"]["G_provenance_complete"] = all(
        bool(s.get("bucket")) and bool(s.get("origin")) and bool(s.get("unit_id")) and s.get("source_path") is not None and int(s.get("n") or 0) > 0
        for s in packed["unit_spans"]
    )
    code_frac = float(quality["realized_frac"].get("code", 0))
    quality["gates"]["D_allocation_converges"] = quality["max_drift"] <= 0.08 and code_frac <= CODE_CEILING + 1e-9
    quality["all_packing_gates_ok"] = all(quality["gates"].values())

    documents = packed.pop("documents")
    packed.pop("doc_takes")
    packed.pop("doc_tokens")
    spans = packed.pop("unit_spans")
    packed_source_sha = hashlib.sha256(
        "\n".join(f"{s['unit_id']}\t{s['n']}\t{s['bucket']}\t{s['origin']}" for s in spans).encode("utf-8")
    ).hexdigest()
    reuse_by_family = packed.get("reuse_by_family") or {}
    unique_exposure = int(sum(int(v.get("unique_exposure_est") or 0) for v in reuse_by_family.values()))
    repeated_exposure = int(sum(int(v.get("repeated_exposure_est") or 0) for v in reuse_by_family.values()))
    max_doc = documents[0] if documents else {}
    max_doc_frac = float(max_doc.get("stream_pct") or 0) / 100.0
    behavior = reuse_by_family.get("behavior") or {}
    behavior_class = behavior.get("repeat_class")
    excessive = [fam for fam, row in reuse_by_family.items() if row.get("repeat_class") == "EXCESSIVE_REUSE"]
    high = [fam for fam, row in reuse_by_family.items() if row.get("repeat_class") == "HIGH_REUSE"]

    unique_gain = unique_exposure - old_unique
    unique_gain_pct = round(100.0 * unique_gain / max(1, old_unique), 2)
    repeated_reduction = old_repeated - repeated_exposure
    repeated_reduction_pct = round(100.0 * repeated_reduction / max(1, old_repeated), 2)

    packing_ok = quality["all_packing_gates_ok"]
    behavior_ok = behavior_class in ("LOW_REUSE", "CONTROLLED_REUSE") and not behavior.get("exceeds_recommended_max_epochs")
    doc_ok = max_doc_frac <= DOC_CAP + 1e-9
    stop_ok = stop_unchanged
    p1_preserved = p1_npy.exists() and npy_payload_sha(p1_npy) == HISTORICAL_P1_STREAM_SHA
    ready = packing_ok and behavior_ok and doc_ok and stop_ok and p1_preserved and not excessive and sha_match
    # Known reuse remains (C0 HIGH, prose wrap). Honest class is B when ready.
    if not ready:
        data_class = "C. P2_STREAM_NOT_READY"
        p1_class = "P1_FINAL_STREAM_BLOCKED"
        p2_status = "NOT_READY"
    elif high:
        data_class = "B. P2_STREAM_READY_WITH_KNOWN_REUSE_RISK"
        p1_class = "P1_FINAL_STREAM_READY"
        p2_status = "READY_TO_REQUEST_AUTHORIZATION"
    else:
        data_class = "A. P2_STREAM_READY_FOR_AUTHORIZATION_REQUEST"
        p1_class = "P1_FINAL_STREAM_READY"
        p2_status = "READY_TO_REQUEST_AUTHORIZATION"

    write_json(out_dir / "refined-p2-diagnostic-step-map.json", {"n_steps": len(steps), "steps": steps})
    write_json(out_dir / "refined-document-ledger.json", {"n": len(documents), "documents": documents})

    p2_artifact = {
        "P2_RUN_ID_PROPOSAL": P2_RUN_ID_PROPOSAL,
        "stream_identity": "REFINED_CANDIDATE",
        "replaces_p1_stream": False,
        "parent": "WRIM-0",
        "parent_sha256": parent_sha,
        "tokenizer_sha256": tok_sha,
        "packer_mode": PACKER_MODE,
        "packer_version": PACKER_VERSION,
        "seed": REFINE_SEED,
        "stream_sha256": stream_sha,
        "packed_source_sha256": packed_source_sha,
        "packed_source_ids_sha256": packed_ids_sha,
        "target_token_count": P2_TOKENS,
        "step_count": P2_STEPS,
        "tokens_per_step": TOKENS_PER_STEP,
        "family_targets": REFINE_MIX,
        "realized_family_mix": quality["realized_frac"],
        "p1_family_targets_preserved_as_history_only": P1_MIX,
        "reuse_policy": {
            "wrap_epochs_allowed": True,
            "max_epochs": MAX_EPOCHS,
            "alice_cap_frac": 0.03,
            "max_single_doc_frac": DOC_CAP,
            "code_ceiling_frac": CODE_CEILING,
            "unique_is_not_claimed_for_repeated_tokens": True,
        },
        "stop_policy_version": STOP_POLICY_VERSION,
        "compact_generation_check_cadence": COMPACT_CADENCE,
        "full_evaluation_cadence": FULL_CADENCE,
        "eval_cadence_rationale": (
            "RUN-000004 looping/unique256 moved by step 5–10. Compact generation checks at 0,5,10,25,50,100 "
            "then every 100. Full eval (retention/JSON/instruction) at 0,100,500,1000 only — JSON may remain 0. "
            "P2 purpose is looping/unique128/unique256/coherence, not SFT or production."
        ),
        "READY_TO_REQUEST_AUTHORIZATION": p2_status == "READY_TO_REQUEST_AUTHORIZATION",
        "status": p2_status,
        "AUTHORIZED": False,
        "TRAINING_AUTHORIZATION": "OFF",
    }
    write_json(out_dir / "p2-refined-readiness-proposal.json", p2_artifact)

    payload = {
        "ok": ready,
        "kind": "WRIM_FOUNDATIONAL_P1_STREAM_REFINEMENT",
        "refine_id": REFINE_ID,
        "p1_id": P1_ID,
        "p1_report_rewritten": False,
        "final_classification": p1_class,
        "data_readiness_class": data_class,
        "optimizer_steps_this_pass": 0,
        "parameter_update_count_this_pass": 0,
        "AdamW_constructed": False,
        "start_timestamp": started,
        "end_timestamp": utc_now(),
        "parent_sha256": parent_sha,
        "tokenizer_sha256": tok_sha,
        "sha_ok": True,
        "corpus_mutated": False,
        "tokenizer_mutated": False,
        "historical_000004_stream_preserved": historical_sha == HISTORICAL_000004_STREAM_SHA,
        "p1_stream_preserved": p1_preserved,
        "p1_stream_sha256": HISTORICAL_P1_STREAM_SHA,
        "p1_packed_source_sha256": HISTORICAL_P1_PACKED_SOURCE_SHA,
        "behavior_decision": BEHAVIOR_DECISION,
        "behavior_decision_rationale": BEHAVIOR_DECISION_RATIONALE,
        "document_dominance_decision": DOC_DOMINANCE_DECISION,
        "document_dominance_rationale": DOC_DOMINANCE_RATIONALE,
        "previous_family_mix": P1_MIX,
        "refined_family_mix_target": REFINE_MIX,
        "refined_family_mix_effective": packed.get("mix_target"),
        "refined_family_mix_realized": quality["realized_frac"],
        "packable_tokens": packed.get("packable_tokens"),
        "document_group_by": packed.get("document_group_by"),
        "code_ceiling_raised_to_fill": packed.get("code_ceiling_raised_to_fill"),
        "exposure": {
            "previous_unique_exposure": old_unique,
            "refined_unique_exposure": unique_exposure,
            "unique_gain": unique_gain,
            "unique_gain_pct": unique_gain_pct,
            "previous_repeated_exposure": old_repeated,
            "refined_repeated_exposure": repeated_exposure,
            "repeated_reduction": repeated_reduction,
            "repeated_reduction_pct": repeated_reduction_pct,
        },
        "reuse_by_family": reuse_by_family,
        "repeat_risk_classifications": {fam: row.get("repeat_class") for fam, row in reuse_by_family.items()},
        "excessive_reuse_families": excessive,
        "high_reuse_families": high,
        "max_document_share": round(max_doc_frac, 4),
        "max_document": max_doc,
        "high_dominance_documents": [d for d in documents if d.get("high_dominance")][:20],
        "n_documents_used": len(documents),
        "quality": quality,
        "bursts": bursts,
        "packing": {
            **{k: packed[k] for k in packed if k != "packed_source_ids"},
            "packed_source_id_count": len(packed["packed_source_ids"]),
            "packed_source_sha256": packed_source_sha,
            "packed_source_ids_sha256": packed_ids_sha,
            "stream_sha256": stream_sha,
            "second_pass_sha256": packed2["stream_sha256"],
            "deterministic": sha_match,
            "n_spans": len(spans),
        },
        "compact_generation_check_cadence": COMPACT_CADENCE,
        "full_evaluation_cadence": FULL_CADENCE,
        "stop_policy_version": STOP_POLICY_VERSION,
        "stop_policy_unchanged": stop_ok,
        "p2_purpose": {
            "in_scope": ["looping resistance", "unique128", "unique256", "basic coherence"],
            "unacceptable": ["retention loss", "collapse", "instability"],
            "out_of_scope": ["instruction following", "JSON instruction compliance", "full SFT", "production readiness"],
            "json_may_remain_zero": True,
        },
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
        "stream_path": str(out_dir / "refined-p2-diagnostic-stream.npy"),
    }
    write_json(Path(args.report), payload)
    print(
        json.dumps(
            {
                "ok": ready,
                "final_classification": p1_class,
                "data_readiness_class": data_class,
                "stream_sha256": stream_sha,
                "unique_gain_pct": unique_gain_pct,
                "repeated_reduction_pct": repeated_reduction_pct,
                "max_document_share": round(max_doc_frac, 4),
                "behavior_class": behavior_class,
                "repeat_classes": payload["repeat_risk_classifications"],
                "optimizer_steps_this_pass": 0,
                "TRAINING_AUTHORIZATION": "OFF",
                "P2_AUTHORIZED": False,
            },
            indent=2,
        ),
        flush=True,
    )
    return 0 if ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
