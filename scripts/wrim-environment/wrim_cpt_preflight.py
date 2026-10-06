"""WRIM1-CPT-000001 pretraining readiness. Does not construct AdamW. Does not train."""
from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path
from typing import Any

from run000007_env import verify_linux_env
from run000007_preflight import collision_roots, resolve_dump_root, sha256_file
from run000007_vram import vram_preflight
from wrim_cpt_collision import assert_run_id_unused, inspect_existing_run, resume_decision
from wrim_cpt_corpus import CORPUS_VERSION, corpus_root, eval_root, freeze_corpus
from wrim_cpt_identity import (
    ADDENDUM_SHA,
    ARCHITECTURE,
    AUTHORIZE_ENV,
    AUTHORIZE_ENV_VALUE,
    AUTHORIZE_FLAG,
    BASELINE_SHA,
    BETAS,
    CORPUS_ID,
    CPT_RUN_ID,
    EPS,
    FOUNDATION_EVAL_VERSION,
    GRAD_CLIP,
    LINUX_CKPT_ROOT,
    LINUX_DATA_ROOT,
    LINUX_VENV_PYTHON,
    LOCKED_MIX,
    MAX_ADDITIONAL_TOKENS_CAP,
    MAX_TOKENS,
    MICRO_BATCH,
    MIN_LR,
    MISSION_ORIGIN,
    MIX_TOLERANCE,
    ORIGINAL_PRETRAIN_RECIPE,
    PACK_TARGET_TOKENS,
    PARAM_COUNT,
    PARENT_ID,
    PARENT_SHA,
    PEAK_LR,
    SEQ_LEN,
    STAGE,
    STEPS,
    SUITE_SHA,
    TOKENIZER_SHA,
    TOKENS_PER_STEP,
    TRAINING_AUTHORIZATION,
    WARMUP_STEPS,
    WEIGHT_DECAY,
)
from wrim_cpt_pack import pack_cpt_stream
from wrim_cpt_schedule import self_test as schedule_self_test
from wrim_resumable_checkpoint import disk_preflight


HERE = Path(__file__).resolve().parent


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def jsonable(obj: dict[str, Any]) -> dict[str, Any]:
    out = {}
    for k, v in obj.items():
        if str(k).startswith("_"):
            continue
        try:
            json.dumps(v)
            out[k] = v
        except TypeError:
            out[k] = str(v)
    return out


def locate_suite() -> Path:
    return HERE / "evals" / "WRIM-EVAL-S3-000001.json"


def locate_baseline(data_root: Path) -> Path | None:
    names = (
        "wrim-eval-s3-000001-wrim0-baseline.json",
        "wrim-eval-s3-000001-wrim0-baseline-linux.json",
    )
    dirs = [
        data_root,
        data_root / "linux-parity-000001",
        HERE / "evals",
        Path("/home/chosenone/.local/share/war-room-os/data/wrim-environment"),
        Path("/home/chosenone/.local/share/war-room-os/data/wrim-environment/linux-parity-000001"),
    ]
    for d in dirs:
        for n in names:
            p = d / n
            if p.is_file():
                return p
    return None


def locate_addendum(data_root: Path) -> Path | None:
    for p in (
        data_root / "WRIM-EVAL-S3-INSTRUCTION-ADDENDUM-000001.json",
        HERE / "evals" / "WRIM-EVAL-S3-INSTRUCTION-ADDENDUM-000001.json",
    ):
        if p.is_file():
            return p
    return None


def probe_forward_throughput(dump: Path) -> dict[str, Any]:
    """Forward-only timing. Does not construct an optimizer. Does not train."""
    import numpy as np
    import torch
    from wrim_g20m import WRIM0Model
    from wrim_proven_load import disable_tf32, load_parent_into_model

    weights = dump / "model-lab" / "manifests" / "wrim0_checkpoints" / "checkpoint-final.safetensors"
    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = WRIM0Model()
    load_parent_into_model(model, weights)
    model.to(device)
    model.eval()
    x = torch.randint(0, 15126, (MICRO_BATCH, SEQ_LEN), device=device)
    if device.type == "cuda":
        torch.cuda.synchronize()
    t0 = time.perf_counter()
    n = 6
    with torch.inference_mode():
        for _ in range(n):
            _ = model(x)
    if device.type == "cuda":
        torch.cuda.synchronize()
    elapsed = max(1e-6, time.perf_counter() - t0)
    tokens = n * MICRO_BATCH * SEQ_LEN
    fwd = tokens / elapsed
    # backward+AdamW historically ~0.35–0.55 of forward-only on this 20M decoder
    train_est = fwd * 0.42
    return {
        "ok": True,
        "device": str(device),
        "FORWARD_TOKENS_PER_SECOND": fwd,
        "TOKENS_PER_SECOND_ESTIMATE": train_est,
        "ESTIMATED_20M_TRAINING_TIME_SEC": 20_000_000 / train_est,
        "ESTIMATED_50M_TRAINING_TIME_SEC": 50_000_000 / train_est,
        "ESTIMATED_100M_TRAINING_TIME_SEC": 100_000_000 / train_est,
        "ESTIMATED_STAGE_A_SEC": MAX_TOKENS / train_est,
        "VRAM_REQUIREMENT": ">=4096 MiB free (AdamW FP32 19.2M + 8x512 activations); historical OOM under ollama 14b",
        "RAM_REQUIREMENT": ">=8 GiB process headroom",
        "DISK_REQUIREMENT": "8 full checkpoints ~0.4 GiB each + evals ~2 GiB + stream ~20 MiB",
        "CHECKPOINT_REQUIREMENT": "atomic resumable v1 at steps 0,100,200,400,610,800,1000,1220",
        "probe_optimizer_constructed": False,
        "probe_trained": False,
    }


def run_preflight() -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    def add(name: str, ok: bool, detail: Any = None) -> None:
        checks.append({"name": name, "ok": bool(ok), "detail": detail})

    data_root = Path(LINUX_DATA_ROOT)
    ckpt_root = Path(LINUX_CKPT_ROOT)
    dump = resolve_dump_root(None)
    add("dump_root", dump is not None, str(dump) if dump else None)
    env = verify_linux_env(python_bin=LINUX_VENV_PYTHON)
    add("linux_env", bool(env.get("ok")), env.get("mismatches") or env.get("error"))
    vram = vram_preflight()
    add("vram_free", bool(vram.get("ok")), {"free_mib": vram.get("FREE_VRAM_MIB"), "required": vram.get("REQUIRED_FREE_VRAM_MIB")})
    disk = disk_preflight(
        ckpt_root,
        n_full_checkpoints=9,
        bytes_per_checkpoint=400_000_000,
        eval_bytes=1_000_000_000,
        extra_bytes=1_000_000_000,
    )
    add("disk", bool(disk.get("ok")), disk)

    coll = assert_run_id_unused(CPT_RUN_ID, collision_roots(data_root))
    inspect = inspect_existing_run(ckpt_root)
    decision = resume_decision(inspect, coll)
    add("collision_or_resume", bool(decision.get("ok")), decision)

    sched = schedule_self_test()
    add("lr_schedule", bool(sched.get("ok")), {k: sched.get(k) for k in ("peak", "final")})

    frozen = None
    man_p = corpus_root() / f"{CORPUS_VERSION}-MANIFEST.json"
    if man_p.is_file():
        frozen = {"ok": True, "manifest": json.loads(man_p.read_text(encoding="utf-8")), "reused": True, "root": str(corpus_root())}
    else:
        frozen = freeze_corpus()
    add("corpus_frozen", bool(frozen.get("ok")), {"root": frozen.get("root"), "reason": frozen.get("reason")})
    manifest = (frozen.get("manifest") or {}) if frozen.get("ok") else {}
    inventory = manifest.get("inventory") or {}
    role_tok = manifest.get("role_token_validation") or {}
    add("role_tokens_special", bool(role_tok.get("ok")), role_tok)

    packing = {"ok": False}
    if dump is not None and frozen.get("ok"):
        packing = pack_cpt_stream(dump)
    add("pack_ok", bool(packing.get("ok")), packing.get("reason") or packing.get("mix_check"))
    mix = packing.get("mix_check") or {}
    shares = packing.get("shares") or {}
    mix_soft = True
    if shares:
        for fam, tgt in LOCKED_MIX.items():
            if abs(float(shares.get(fam) or 0) - tgt) > 0.08:
                mix_soft = False
    add("mix_within_0.08", mix_soft and bool(shares), shares)

    fe_p = eval_root() / f"{FOUNDATION_EVAL_VERSION}.json"
    fe_leak = []
    if fe_p.is_file():
        fe = json.loads(fe_p.read_text(encoding="utf-8"))
        fe_leak = list(fe.get("leakage_hits") or [])
    add("foundation_eval_exists", fe_p.is_file(), str(fe_p))
    add("foundation_eval_leakage_none", len(fe_leak) == 0, fe_leak[:12])

    parent_ok = False
    tok_ok = False
    parent_hash = None
    tok_hash = None
    if dump is not None:
        weights = dump / "model-lab" / "manifests" / "wrim0_checkpoints" / "checkpoint-final.safetensors"
        tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
        if weights.is_file():
            parent_hash = sha256_file(weights)
            parent_ok = parent_hash == PARENT_SHA
        if tok_path.is_file():
            tok_hash = sha256_file(tok_path)
            tok_ok = tok_hash == TOKENIZER_SHA
    add("parent_wrim0_hash", parent_ok, parent_hash)
    add("tokenizer_unmodified", tok_ok, tok_hash)

    suite_p = locate_suite()
    add("stage3_suite_present_observe_only", suite_p.is_file(), str(suite_p))
    baseline_p = locate_baseline(data_root)
    add("stage3_baseline_present_observe_only", baseline_p is not None, str(baseline_p) if baseline_p else None)

    throughput = {"ok": False, "reason": "skipped_dump_or_env"}
    if dump is not None and env.get("ok") and vram.get("ok"):
        try:
            throughput = probe_forward_throughput(dump)
        except Exception as exc:
            throughput = {"ok": False, "reason": f"throughput_probe_failed:{type(exc).__name__}:{exc}"}
    add("throughput_probe", bool(throughput.get("ok")), {k: throughput.get(k) for k in ("TOKENS_PER_SECOND_ESTIMATE", "ESTIMATED_STAGE_A_SEC", "reason") if k in throughput or True})

    recipe = {
        "ORIGINAL_PRETRAIN_RECIPE": ORIGINAL_PRETRAIN_RECIPE,
        "CONTINUED_PRETRAIN_RECIPE": {
            "parent": PARENT_ID,
            "optimizer": "AdamW",
            "fused": False,
            "betas": list(BETAS),
            "eps": EPS,
            "weight_decay": WEIGHT_DECAY,
            "grad_clip": GRAD_CLIP,
            "peak_lr": PEAK_LR,
            "min_lr": MIN_LR,
            "warmup_steps": WARMUP_STEPS,
            "steps": STEPS,
            "max_tokens": MAX_TOKENS,
            "cap": MAX_ADDITIONAL_TOKENS_CAP,
            "tokens_per_step": TOKENS_PER_STEP,
            "objective": "full_stream_next_token_ce",
            "mask_prompt": False,
            "justification": (
                "WRIM-0 finished cosine at 3e-4 after 2.048M tokens. Continued pretraining "
                "re-enters at that final LR (not from-scratch 3e-3) with a short 60-step warmup "
                "and cosine to 3e-5 over 1220 steps / 4,997,120 tokens. Weight decay 0.1 and "
                "clip 1.0 match the later WRIM1 AdamW standard because the recovered Mac log "
                "did not name those hyperparameters."
            ),
        },
        "architecture": ARCHITECTURE,
        "parameter_count": PARAM_COUNT,
        "tokenizer_mutated": False,
        "architecture_mutated": False,
    }

    blocking = [c for c in checks if not c["ok"] and c["name"] not in {"mix_within_0.08"}]
    # mix_within_tolerance 0.03 is preferred; 0.08 is the abort line already encoded
    if not mix_soft:
        blocking.append({"name": "mix_hard_fail", "ok": False, "detail": shares})
    ok = len(blocking) == 0
    report = {
        "kind": "WRIM1_CPT_000001_PRETRAINING_READINESS_REPORT",
        "ok": ok,
        "decision": "PASS" if ok else "PRETRAIN_ABORT",
        "CPT_RUN_ID": CPT_RUN_ID,
        "STAGE": STAGE,
        "MISSION_ORIGIN": MISSION_ORIGIN,
        "TRAINING_AUTHORIZATION": TRAINING_AUTHORIZATION,
        "authorize_required": {"flag": AUTHORIZE_FLAG, "env": AUTHORIZE_ENV, "value": AUTHORIZE_ENV_VALUE},
        "PARENT": PARENT_ID,
        "PARENT_HASH": parent_hash,
        "TOKENIZER_HASH": tok_hash,
        "CORPUS_ID": CORPUS_ID,
        "CORPUS_HASH": manifest.get("CORPUS_HASH"),
        "CORPUS_INVENTORY": inventory,
        "CORPUS_MIX_TARGET": LOCKED_MIX,
        "CORPUS_MIX_ACTUAL": shares,
        "CORPUS_MIX_TOLERANCE": MIX_TOLERANCE,
        "PACKING": jsonable(packing),
        "EOS_DENSITY": packing.get("EOS_DENSITY"),
        "COMMANDER_TOKEN_DENSITY": packing.get("COMMANDER_TOKEN_DENSITY"),
        "ASSISTANT_TOKEN_DENSITY": packing.get("ASSISTANT_TOKEN_DENSITY"),
        "FOUNDATION_EVAL": str(fe_p) if fe_p.is_file() else None,
        "FOUNDATION_EVAL_LEAKAGE": fe_leak,
        "STAGE3_SUITE_SHA_EXPECTED": SUITE_SHA,
        "STAGE3_BASELINE_SHA_EXPECTED": BASELINE_SHA,
        "ADDENDUM_SHA_EXPECTED": ADDENDUM_SHA,
        "STAGE3_USE": "OBSERVE_ONLY_NOT_TRAIN_TARGET",
        "LICENSE_PROVENANCE": {
            "WR-CORPUS-0": (inventory.get("WR-CORPUS-0") or {}).get("LICENSE_STATUS"),
            "WR-CORPUS-1-HARDENED": (inventory.get("WR-CORPUS-1-HARDENED") or {}).get("LICENSE_STATUS"),
            "ROLE": "ORIGINAL_SYNTHETIC_INTERNAL_CPT_SHORT_RESPONSE",
            "MODE-ENTRY": "EXCLUDED_FROZEN_SFT",
            "CAPABILITY": "EXCLUDED_FROZEN_SFT",
        },
        "DEDUP": {"role_exact_dropped": manifest.get("exact_duplicates_dropped_from_role")},
        "LEAKAGE_AUDIT": {
            "c1_skipped": (inventory.get("WR-CORPUS-1-HARDENED") or {}).get("SKIPPED"),
            "foundation_eval_hits": fe_leak,
            "stage3_prompts_in_cpt_train": "SCANNED_VIA_leak_blob_AND_HARD_BANNED",
        },
        "ORIGINAL_PRETRAIN_RECIPE": ORIGINAL_PRETRAIN_RECIPE,
        "CONTINUED_PRETRAIN_RECIPE": recipe["CONTINUED_PRETRAIN_RECIPE"],
        "RUNTIME_ESTIMATES": throughput,
        "CHECKPOINT_PLAN": {
            "contract": "wrim_resumable_checkpoint.v1",
            "root": str(ckpt_root),
            "eval_steps": [0, 100, 200, 400, 610, 800, 1000, 1220],
            "stage3_observe_steps": [0, 610, 1220],
            "max_tokens": MAX_TOKENS,
            "hard_cap": MAX_ADDITIONAL_TOKENS_CAP,
        },
        "EVALUATION_PLAN": {
            "general_val_nll": True,
            "genesis_val_nll": True,
            "code_val_nll": True,
            "json_val_nll": True,
            "role_response_val_nll": True,
            "short_response_val_nll": True,
            "eos_metrics": True,
            "assistant_boundary": True,
            "foundation_eval": FOUNDATION_EVAL_VERSION,
            "stage3": "observe_only",
        },
        "env": env,
        "vram": {"ok": vram.get("ok"), "FREE_VRAM_MIB": vram.get("FREE_VRAM_MIB"), "apps": vram.get("apps")},
        "disk": disk,
        "collision": coll,
        "inspect": inspect,
        "resume_decision": decision,
        "schedule_self_test": sched,
        "checks": checks,
        "blocking": blocking,
        "PACK_TARGET_TOKENS": PACK_TARGET_TOKENS,
        "MAX_TOKENS": MAX_TOKENS,
        "STAGE_B_EXECUTED": False,
        "canonical_promoted": False,
    }
    out_path = data_root / "WRIM1-CPT-000001-PRETRAINING-READINESS.json"
    write_json(out_path, report)
    write_json(ckpt_root / "preflight.json", report)
    report["report_path"] = str(out_path)
    return report


def main() -> int:
    argparse.ArgumentParser().parse_args()
    report = run_preflight()
    slim = {
        "ok": report.get("ok"),
        "decision": report.get("decision"),
        "CPT_RUN_ID": report.get("CPT_RUN_ID"),
        "CORPUS_HASH": report.get("CORPUS_HASH"),
        "blocking": report.get("blocking"),
        "TOKENS_PER_SECOND_ESTIMATE": (report.get("RUNTIME_ESTIMATES") or {}).get("TOKENS_PER_SECOND_ESTIMATE"),
        "ESTIMATED_STAGE_A_SEC": (report.get("RUNTIME_ESTIMATES") or {}).get("ESTIMATED_STAGE_A_SEC"),
        "report_path": report.get("report_path"),
    }
    print(json.dumps(slim, indent=2, default=str))
    return 0 if report.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
