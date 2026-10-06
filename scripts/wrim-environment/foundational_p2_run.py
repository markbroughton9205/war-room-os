"""WRIM1-RUN-000005 P2 sovereign foundational CLM diagnostic gate.

Commander authorized this run on seed 2303 only. Training-critical optimizer
and scheduler fields are not frozen in the foundational remediation design.
Do not guess. Do not construct an optimizer. Do not train.

Does not mutate WR-CORPUS, tokenizer, parent weights, P1, seed-2302, or seed-2303.
"""
from __future__ import annotations

import argparse
import json
import platform
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from foundational_p1_refine import npy_payload_sha, sha256_file, write_json
from stop_policy import STOP_POLICY_VERSION

RUN_ID = "WRIM1-RUN-000005"
KIND = "WRIM_FOUNDATIONAL_P2_DIAGNOSTIC"
PARENT_ID = "WRIM-0"
PARENT_SHA = "d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015"
TOKENIZER_ID = "WR-TOKENIZER-0"
TOKENIZER_SHA = "47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7"
SOVEREIGN_SEED = 2303
SOVEREIGN_STREAM_SHA = "5bf8951e364ed9a7f02889d4d96e44c7a9d3a2e6a78464c8fe4b43c9bbe22db5"
SOVEREIGN_PACKED_SOURCE_SHA = "83e9478376386fd2e1d02a26891fab0ec6714063445e5915bbb06376a7ca5011"
FORBIDDEN_P1_STREAM = "166139473acf7edc5d12210cfa3b456b3bcbc2b56efb0674671da7e8a09796ed"
FORBIDDEN_2302_STREAM = "a783785a579f6983f25d4157ab801d6d7b6f331edf4b2aedc4c9127070734ba0"
FORBIDDEN_2302_PACKED = "9844a37624de63b8da441dea8abe7582e274183632b151cced565e66d217c46f"
PACKER_MODE = "DEFICIT_INTERLEAVE_FAMILIES"
PACKER_VERSION = "deficit-interleave-families-v1"
MAX_STEPS = 1000
MAX_TOKENS = 4_096_000
TOKENS_PER_STEP = 4096
COMPACT_CADENCE = [0, 5, 10, 25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
FULL_CADENCE = [0, 100, 500, 1000]
EXCLUDED_DOCS = [
    "CLAUDE.md",
    "docs/ENGINEERING_COMPLETION_STANDARD.md",
    "docs/WAVE_3_ACTIVE_LEARNING_REPORT.md",
]
MISSING_CRITICAL = [
    "peak_lr",
    "min_lr",
    "warmup_steps",
    "scheduler_formula_for_1000_steps",
    "betas",
    "eps",
    "weight_decay",
    "grad_clip",
    "precision",
    "tf32",
    "micro_batch",
    "grad_accum",
    "checkpoint_save_policy",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def probe_hardware() -> dict[str, Any]:
    info: dict[str, Any] = {
        "cpu": platform.processor() or platform.machine(),
        "machine": platform.machine(),
        "os": f"{platform.system()} {platform.release()}",
        "python": platform.python_version(),
        "hostname": platform.node(),
    }
    try:
        import ctypes

        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        stat = MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
        info["ram_bytes"] = int(stat.ullTotalPhys)
        info["ram_available_bytes"] = int(stat.ullAvailPhys)
    except Exception as exc:  # pragma: no cover
        info["ram_probe_error"] = str(exc)
    try:
        import torch

        info["pytorch"] = torch.__version__
        info["cuda_compiled"] = str(getattr(torch.version, "cuda", None))
        info["cuda_available"] = bool(torch.cuda.is_available())
        if torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            info["gpu"] = torch.cuda.get_device_name(0)
            info["vram_bytes"] = int(props.total_memory)
            info["cuda_capability"] = [int(props.major), int(props.minor)]
            info["device_selected"] = "cuda:0"
        else:
            info["gpu"] = None
            info["device_selected"] = "cpu"
    except Exception as exc:
        info["torch_probe_error"] = str(exc)
        info["device_selected"] = "unprobed"
    return info


def extract_defined_p2_fields(design: dict[str, Any]) -> dict[str, Any]:
    phases = design.get("development_phases") or []
    p2 = next((p for p in phases if p.get("id") == "P2_BASE_PRETRAINING_PILOT"), {})
    decoding = design.get("decoding_policy") or {}
    return {
        "optimizer_algorithm": "AdamW",
        "optimizer_fresh": True,
        "parent": PARENT_ID,
        "tokens_per_step": TOKENS_PER_STEP,
        "max_authorized_steps": MAX_STEPS,
        "max_authorized_tokens": MAX_TOKENS,
        "official_eval_decoder": decoding.get("official_eval_decoder"),
        "repetition_penalty": decoding.get("repetition_penalty"),
        "stop_policy_version": STOP_POLICY_VERSION,
        "packer": PACKER_MODE,
        "packer_version": PACKER_VERSION,
        "seed": SOVEREIGN_SEED,
        "compact_generation_check_cadence": COMPACT_CADENCE,
        "full_evaluation_cadence": FULL_CADENCE,
        "design_checkpoint_cadence": p2.get("checkpoint_cadence"),
        "design_authorized_changes": p2.get("authorized_changes"),
        "design_token_budget_range": p2.get("token_budget_range"),
        "peak_lr_in_design": None,
        "warmup_steps_in_design": None,
        "scheduler_in_design": None,
        "betas_in_design": None,
        "weight_decay_in_design": None,
        "grad_clip_in_design": None,
        "precision_in_design": None,
        "micro_batch_in_design": None,
        "grad_accum_in_design": None,
    }


def missing_from_design(design: dict[str, Any]) -> list[str]:
    p2 = next((p for p in (design.get("development_phases") or []) if p.get("id") == "P2_BASE_PRETRAINING_PILOT"), {})
    p2_blob = json.dumps(p2).lower()
    present = {
        "peak_lr": "peak_lr" in p2_blob or "1e-5" in p2_blob or "2e-5" in p2_blob or "3e-5" in p2_blob,
        "min_lr": "min_lr" in p2_blob,
        "warmup_steps": "warmup" in p2_blob,
        "scheduler_formula_for_1000_steps": "cosine" in p2_blob or "scheduler" in p2_blob,
        "betas": "betas" in p2_blob,
        "eps": '"eps"' in p2_blob,
        "weight_decay": "weight_decay" in p2_blob,
        "grad_clip": "clip" in p2_blob,
        "precision": "fp32" in p2_blob or "precision" in p2_blob,
        "tf32": "tf32" in p2_blob,
        "micro_batch": "micro_batch" in p2_blob,
        "grad_accum": "grad_accum" in p2_blob or "accumulation" in p2_blob,
        "checkpoint_save_policy": False,
    }
    return [key for key in MISSING_CRITICAL if not present.get(key)]


def ledger_has_excluded(ledger: dict[str, Any]) -> list[str]:
    hits: list[str] = []
    for doc in ledger.get("documents") or []:
        path = str(doc.get("source_path") or doc.get("document_id") or "")
        for banned in EXCLUDED_DOCS:
            if path == banned or path.endswith("/" + banned) or path.endswith("\\" + banned):
                hits.append(path)
    return hits


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--weights", required=True)
    p.add_argument("--tokenizer", required=True)
    p.add_argument("--sovereignty-report", required=True)
    p.add_argument("--design", required=True)
    p.add_argument("--stream", required=True)
    p.add_argument("--ledger", required=True)
    p.add_argument("--refine-npy", required=True)
    p.add_argument("--p1-npy", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--report", required=True)
    args = p.parse_args()
    started = utc_now()

    weights = Path(args.weights)
    tokenizer = Path(args.tokenizer)
    stream_path = Path(args.stream)
    ledger_path = Path(args.ledger)
    refine_npy = Path(args.refine_npy)
    p1_npy = Path(args.p1_npy)
    design = json.loads(Path(args.design).read_text(encoding="utf-8"))
    sovereignty = json.loads(Path(args.sovereignty_report).read_text(encoding="utf-8"))
    ledger = json.loads(ledger_path.read_text(encoding="utf-8")) if ledger_path.exists() else {"documents": []}

    parent_sha = sha256_file(weights)
    tok_sha = sha256_file(tokenizer)
    stream_sha = npy_payload_sha(stream_path) if stream_path.exists() else ""
    refine_sha = npy_payload_sha(refine_npy) if refine_npy.exists() else ""
    p1_sha = npy_payload_sha(p1_npy) if p1_npy.exists() else ""
    packed_source_sha = str((sovereignty.get("new_stream") or {}).get("packed_source_sha256") or "")
    seed = int((sovereignty.get("new_stream") or {}).get("seed") or 0)

    identity_ok = (
        parent_sha == PARENT_SHA
        and tok_sha == TOKENIZER_SHA
        and stream_sha == SOVEREIGN_STREAM_SHA
        and packed_source_sha == SOVEREIGN_PACKED_SOURCE_SHA
        and seed == SOVEREIGN_SEED
        and stream_sha not in {FORBIDDEN_P1_STREAM, FORBIDDEN_2302_STREAM}
        and packed_source_sha != FORBIDDEN_2302_PACKED
        and refine_sha == FORBIDDEN_2302_STREAM
        and p1_sha == FORBIDDEN_P1_STREAM
    )
    excluded_hits = ledger_has_excluded(ledger)
    sovereignty_exclusions = list(sovereignty.get("exclusions_applied") or [])
    claude_absent = "CLAUDE.md" not in excluded_hits and "CLAUDE.md" in sovereignty_exclusions
    operational_absent = all(doc in sovereignty_exclusions for doc in EXCLUDED_DOCS[1:]) and not excluded_hits

    hard_abort = False
    abort_reason = None
    if stream_sha == FORBIDDEN_2302_STREAM or packed_source_sha == FORBIDDEN_2302_PACKED or seed == 2302:
        hard_abort = True
        abort_reason = "FORBIDDEN_SEED_2302_STREAM"
    elif stream_sha == FORBIDDEN_P1_STREAM:
        hard_abort = True
        abort_reason = "FORBIDDEN_HISTORICAL_P1_STREAM"
    elif stream_sha != SOVEREIGN_STREAM_SHA or packed_source_sha != SOVEREIGN_PACKED_SOURCE_SHA:
        hard_abort = True
        abort_reason = "UNEXPECTED_STREAM_SHA"
    elif parent_sha != PARENT_SHA or tok_sha != TOKENIZER_SHA:
        hard_abort = True
        abort_reason = "PARENT_OR_TOKENIZER_HASH_MISMATCH"

    defined = extract_defined_p2_fields(design)
    missing = missing_from_design(design)
    audit_peak_range = "1e-5 to 3e-5 (Recovery-006 order); not 3e-3"

    classification = "P2_AUTHORIZED_BUT_CONFIGURATION_INCOMPLETE"
    terminal_reason = "CONFIGURATION_INCOMPLETE"
    if hard_abort:
        classification = "P2_FOUNDATIONAL_DIAGNOSTIC_STOPPED_BY_POLICY"
        terminal_reason = abort_reason
        missing = missing  # still report, but identity abort wins

    hardware = probe_hardware()
    resolved = {
        **defined,
        "missing_training_critical_fields": missing,
        "peak_lr": None,
        "min_lr": None,
        "warmup_steps": None,
        "scheduler": None,
        "betas": None,
        "eps": None,
        "weight_decay": None,
        "grad_clip": None,
        "precision": None,
        "tf32": None,
        "micro_batch": None,
        "grad_accum": None,
        "complete": False,
        "improvised": False,
        "note": (
            "P2_BASE_PRETRAINING_PILOT freezes Fresh AdamW, WRIM-0 parent, 4,096,000 tokens / 1000 steps, "
            "and greedy eval. It does not freeze peak LR, warmup, cosine length, betas, weight decay, "
            "clip, precision, batching, or checkpoint-save policy. Root-cause audit only records a "
            f"peak_lr_design_range of {audit_peak_range}. Stretching a 25- or 50-step historical "
            "schedule across 1000 steps would invent a different recipe. Commander forbade guessing."
        ),
    }

    payload = {
        "ok": True,
        "kind": KIND,
        "run_id": RUN_ID,
        "final_classification": classification,
        "commander_authorization": "AUTHORIZED",
        "commander_authorized_stream_sha256": SOVEREIGN_STREAM_SHA,
        "P2_AUTHORIZED": True,
        "P2_EXECUTION_STARTED": False,
        "P2_EXECUTION_BLOCKED": "CONFIGURATION_INCOMPLETE" if not hard_abort else abort_reason,
        "TRAINING_AUTHORIZATION": "OFF",
        "ready_to_run_optimizer": False,
        "optimizer_steps": 0,
        "optimizer_steps_this_pass": 0,
        "parameter_update_count_this_pass": 0,
        "AdamW_constructed": False,
        "tokens_trained": 0,
        "terminal_checkpoint": None,
        "terminal_reason": terminal_reason,
        "start_timestamp": started,
        "end_timestamp": utc_now(),
        "parent_identity": PARENT_ID,
        "parent_sha256": parent_sha,
        "tokenizer_identity": TOKENIZER_ID,
        "tokenizer_sha256": tok_sha,
        "corpus_identities": {
            "WR-CORPUS-0": "WRM-001 / 175af25fe1c17cf7630b506d0d6e6e88",
            "WR-CORPUS-1": "WR-CORPUS-1-HARDENED",
            "mutated": False,
        },
        "seed": seed,
        "stream_path": str(stream_path),
        "stream_sha256": stream_sha,
        "packed_source_sha256": packed_source_sha,
        "forbidden_streams_untouched": {
            "historical_p1": p1_sha,
            "seed_2302": refine_sha,
            "seed_2302_not_trained": True,
            "historical_p1_not_trained": True,
        },
        "identity_ok": identity_ok,
        "hard_abort": hard_abort,
        "abort_reason": abort_reason,
        "sovereignty_policy_proof": {
            "audit_classification": sovereignty.get("final_classification"),
            "exclusions_applied": sovereignty_exclusions,
            "training_eligibility_layer": True,
            "claude_md_class": (sovereignty.get("claude_md") or {}).get("semantic_class"),
            "claude_md_on_disk_untouched": True,
        },
        "excluded_document_proof": {
            "required": EXCLUDED_DOCS,
            "present_in_ledger": excluded_hits,
            "claude_md_absent_from_packed_lineage": claude_absent and not excluded_hits,
            "operational_absent_from_packed_lineage": operational_absent,
        },
        "resolved_training_configuration": resolved,
        "scheduler_configuration": None,
        "hardware": hardware,
        "step0_baseline": None,
        "step0_reason": "Not executed. Incomplete optimizer/scheduler configuration blocks training-state creation.",
        "compact_trajectory": [],
        "full_eval_trajectory": [],
        "stop_policy_version": STOP_POLICY_VERSION,
        "stop_policy_unchanged": True,
        "stop_policy_decisions": [],
        "STAGE3B_AUTHORIZATION": "NO",
        "STAGE3B_EXECUTION_READINESS": False,
        "P3_AUTHORIZED": False,
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "promotion_candidate": False,
        "nothing_pushed": True,
        "nothing_deployed": True,
        "corpus_mutated": False,
        "tokenizer_mutated": False,
        "stream_mutated": False,
        "local_commit_created": False,
    }
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    write_json(out_dir / "run-manifest.json", payload)
    write_json(Path(args.report), payload)
    print(
        json.dumps(
            {
                "ok": True,
                "final_classification": classification,
                "run_id": RUN_ID,
                "optimizer_steps": 0,
                "missing_training_critical_fields": missing,
                "stream_sha256": stream_sha,
                "packed_source_sha256": packed_source_sha,
                "hard_abort": hard_abort,
                "TRAINING_AUTHORIZATION": "OFF",
            },
            indent=2,
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
