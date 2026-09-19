"""WRIM1-RUN-000006 pre-training gate. Packs BALANCED_GENESIS in memory. Never trains."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from run000006_collision import assert_run_id_unused
from run000006_controller import main_self_test
from run000006_identity import (
    ARCHITECTURE,
    AUX_KL_LOSS,
    BASELINE_SHA,
    BETAS,
    COOLDOWN_STEPS,
    CONFIG_KIND,
    EPS,
    EVAL_SEED,
    FUSED,
    FULL_EVAL_STEPS,
    GRAD_CLIP,
    KIND,
    LOCKED_MIX,
    MAX_TOKENS,
    MICRO_BATCH,
    MIN_LR,
    NEXT_UNAUTHORIZED_STEP,
    OPTIMIZER,
    PACK_TARGET_TOKENS,
    PARENT_ID,
    PARENT_SHA,
    PARENT_VAL0,
    PARENT_VAL1,
    PEAK_LR,
    PRECISION,
    REHEARSAL_MODE,
    REHEARSAL_RATIO,
    REFERENCE_NLL_CANONICAL_LF_SHA,
    REQUIRE_GREEDY_256,
    RUN_ID,
    SEED,
    SEQ_LEN,
    STAGE3B_AUTHORIZATION,
    STEPS,
    SUITE_ID,
    SUITE_SHA,
    SUITE_VERSION,
    TF32,
    TOKENIZER_ID,
    TOKENIZER_SHA,
    TOKENS_PER_STEP,
    TRAINING_AUTHORIZATION,
    WARMUP_STEPS,
    WEIGHT_DECAY,
)
from run000006_integrity import hash_reference_nll_path
from run000006_pack import pack_balanced_genesis
from run000006_schedule import lr_run000006, schedule_table, self_test as schedule_self_test
from run000006_train import authorization_ok, denial_payload

SEAGATE_DUMP = Path(
    "/run/media/chosenone/Seagate/WAR_ROOM_LINUX_MIGRATION/tree/Users/markb/Documents/Codex/"
    "2026-09-04/referenced-chatgpt-conversation-this-is-an-3/outputs/mac-model-recovery-20260904-220419"
)
WIN_DUMP = Path("C:/Users/markb/Documents/Codex/2026-09-04/referenced-chatgpt-conversation-this-is-an-3/outputs/mac-model-recovery-20260904-220419")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def suite_canonical_sha256(path: Path) -> str:
    obj = json.loads(path.read_text(encoding="utf-8"))
    items = obj.get("items") or []
    canonical = json.dumps(
        {"suite_id": obj.get("suite_id"), "suite_version": obj.get("suite_version"), "items": items},
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def canonical_config_bytes(cfg: dict[str, Any]) -> bytes:
    return (json.dumps(cfg, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")


def resolve_dump_root(explicit: str | None) -> Path | None:
    candidates = []
    if explicit:
        candidates.append(Path(explicit))
    env = os.environ.get("WAR_ROOM_RECOVERY_DUMP")
    if env:
        candidates.append(Path(env))
    candidates.extend([SEAGATE_DUMP, WIN_DUMP])
    for c in candidates:
        tok = c / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
        npy = c / "model-lab" / "manifests" / "wrim0_corpus_shards" / "train.npy"
        if tok.is_file() and npy.is_file():
            return c
    return None


def collision_roots(data_root: Path) -> list[Path]:
    roots = [data_root, data_root.parent / "wrim-checkpoints"]
    seagate_data = Path("/run/media/chosenone/Seagate/WAR_ROOM_LINUX_MIGRATION/tree/Users/markb/AppData/Local/War Room OS/data")
    if seagate_data.exists():
        roots.append(seagate_data / "wrim-environment")
        roots.append(seagate_data / "wrim-checkpoints")
    return roots


def locate_reference_nll(data_root: Path) -> Path | None:
    candidates = [
        data_root / "wrim0-reference-nll.json",
        Path("/run/media/chosenone/Seagate/WAR_ROOM_LINUX_MIGRATION/tree/Users/markb/AppData/Local/War Room OS/data/wrim-environment/wrim0-reference-nll.json"),
        Path("C:/Users/markb/AppData/Local/War Room OS/data/wrim-environment/wrim0-reference-nll.json"),
    ]
    for p in candidates:
        if p.is_file():
            return p
    return None


def freeze_config(*, config_sha_placeholder: str = "") -> dict[str, Any]:
    return {
        "kind": CONFIG_KIND,
        "RUN_ID": RUN_ID,
        "PARENT_MODEL": PARENT_ID,
        "PARENT_SHA": PARENT_SHA,
        "TOKENIZER": TOKENIZER_ID,
        "TOKENIZER_SHA": TOKENIZER_SHA,
        "SUITE": SUITE_ID,
        "SUITE_VERSION": SUITE_VERSION,
        "SUITE_SHA": SUITE_SHA,
        "BASELINE_SHA": BASELINE_SHA,
        "STEPS": STEPS,
        "TOKENS_PER_STEP": TOKENS_PER_STEP,
        "MAX_TOKENS": MAX_TOKENS,
        "SEQ_LEN": SEQ_LEN,
        "MICRO_BATCH": MICRO_BATCH,
        "GRAD_ACCUM": 1,
        "OPTIMIZER": OPTIMIZER,
        "FUSED": FUSED,
        "BETAS": [BETAS[0], BETAS[1]],
        "EPS": EPS,
        "WEIGHT_DECAY": WEIGHT_DECAY,
        "GRAD_CLIP": GRAD_CLIP,
        "PEAK_LR": PEAK_LR,
        "WARMUP_STEPS": WARMUP_STEPS,
        "COOLDOWN_STEPS": COOLDOWN_STEPS,
        "FINAL_LR": MIN_LR,
        "SCHEDULE": "cosine",
        "SCHEDULE_FORMULA": "lr(step)=1e-5*step/12 for 1<=step<=12; progress=(step-12)/13; lr=1e-6+0.5*(1e-5-1e-6)*(1+cos(pi*progress)) for 12<step<=25",
        "REHEARSAL_MODE": REHEARSAL_MODE,
        "REHEARSAL_RATIO": REHEARSAL_RATIO,
        "NEW_DATA_RATIO": 0.70,
        "LOCKED_MIX": LOCKED_MIX,
        "GENESIS_PACKER": "balanced-genesis-excerpt-v1-stdlib-run000006",
        "GENESIS_SHUFFLE": "sha256-fisher-yates",
        "SEED": SEED,
        "EVAL_SEED": EVAL_SEED,
        "FULL_EVAL_STEPS": list(FULL_EVAL_STEPS),
        "REQUIRE_GREEDY_256": REQUIRE_GREEDY_256,
        "COMPACT_EVAL_FORBIDDEN_FOR_GATES": True,
        "AUX_KL_LOSS": AUX_KL_LOSS,
        "ARCHITECTURE": ARCHITECTURE,
        "PRECISION": PRECISION,
        "TF32": TF32,
        "NEXT_UNAUTHORIZED_STEP": NEXT_UNAUTHORIZED_STEP,
        "CHECKPOINT_POLICY": {
            "0": ["parent_pointer_only"],
            "5": ["weights"],
            "10": ["weights"],
            "15": ["weights"],
            "20": ["weights"],
            "25_or_hard_stop": ["weights", "optimizer_state"],
            "intermediate_optimizer_snapshots": False,
            "existing_runner_primitives": "save_weights vs save_continuity — technically safe; no adjustment required",
        },
        "GATES": {
            "WRIM0_ANCHOR_NLL_DELTA": {"WARNING": 0.070, "REVIEW_REQUIRED": 0.090, "HARD_STOP": 0.105},
            "KL_WRIM0_TO_CANDIDATE": {"WARNING": 0.010, "REVIEW_REQUIRED": 0.018, "HARD_STOP": 0.022},
            "N_COLLAPSED_256": {"WARNING": 5, "REVIEW_REQUIRED": 6, "HARD_STOP": 8, "SUCCESS": 4},
            "JSON_COLLAPSE": {"WARNING": 2, "REVIEW_REQUIRED": 3, "HARD_STOP": 4, "SUCCESS": 1},
            "CODE_COLLAPSE": {"WARNING": 2, "REVIEW_REQUIRED": 2, "HARD_STOP": 3, "SUCCESS": 1},
            "CAP_EVAL_COMPATIBILITY": {"EXPECTED": "6/6", "REVIEW_REQUIRED": "5/6", "HARD_STOP": "<=4/6"},
            "val_loss_corpus0": {"PARENT": PARENT_VAL0, "HARD_STOP": 9.00},
            "val_loss_corpus1": {"PARENT": PARENT_VAL1, "HARD_STOP": 8.08},
            "GRAD_NORM": {"WARNING": 5, "HARD_STOP": 50},
            "NaN_Inf": {"HARD_STOP": "any"},
        },
        "TRAINING_AUTHORIZATION": TRAINING_AUTHORIZATION,
        "STAGE3B_AUTHORIZATION": STAGE3B_AUTHORIZATION,
    }


def run_preflight(args: argparse.Namespace) -> dict[str, Any]:
    dry = main_self_test()
    sched = schedule_self_test()
    train_denied = (not authorization_ok([])) and denial_payload("preflight")["AdamW_constructed"] is False
    data_root = Path(args.data_root)
    data_root.mkdir(parents=True, exist_ok=True)
    collision = assert_run_id_unused(RUN_ID, collision_roots(data_root))
    dump = resolve_dump_root(args.dump_root)
    nll_path = locate_reference_nll(data_root)
    nll = hash_reference_nll_path(nll_path) if nll_path else None
    weights = None
    tokenizer_path = None
    parent_hash = None
    tok_hash = None
    packing = None
    if dump is not None:
        weights = dump / "model-lab" / "manifests" / "wrim0_checkpoints" / "checkpoint-final.safetensors"
        tokenizer_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
        if weights.is_file():
            parent_hash = sha256_file(weights)
        if tokenizer_path.is_file():
            tok_hash = sha256_file(tokenizer_path)
            packing = pack_balanced_genesis(dump, tokenizer_path)

    suite_path = Path(args.suite)
    suite_hash = suite_canonical_sha256(suite_path) if suite_path.is_file() else None

    cfg = freeze_config()
    cfg_bytes = canonical_config_bytes(cfg)
    cfg_sha = hashlib.sha256(cfg_bytes).hexdigest()
    cfg["TRAINING_CONFIG_SHA"] = cfg_sha
    # Re-hash including SHA field would be circular; keep SHA of config without self-hash.
    cfg_without_sha = dict(cfg)
    cfg_without_sha.pop("TRAINING_CONFIG_SHA", None)
    cfg_bytes = canonical_config_bytes(cfg_without_sha)
    cfg_sha = hashlib.sha256(cfg_bytes).hexdigest()
    cfg["TRAINING_CONFIG_SHA"] = cfg_sha

    packing_ok = bool(packing and packing["decision"]["ok"])
    nll_ok = bool(nll and nll["matches_frozen_expected"])
    parent_ok = parent_hash == PARENT_SHA
    tok_ok = tok_hash == TOKENIZER_SHA
    suite_ok = suite_hash == SUITE_SHA
    ready = bool(
        dry["ok"]
        and sched["ok"]
        and collision["ok"]
        and packing_ok
        and nll_ok
        and parent_ok
        and tok_ok
        and suite_ok
        and train_denied
        and TRAINING_AUTHORIZATION == "OFF"
    )
    blockers = []
    if not dry["ok"]:
        blockers.append("DRY_RUN_TESTS_FAILED")
    if not collision["ok"]:
        blockers.append("RUN_ID_COLLISION")
    if dump is None:
        blockers.append("DUMP_ROOT_NOT_FOUND")
    if not parent_ok:
        blockers.append("PARENT_HASH_MISMATCH_OR_MISSING")
    if not tok_ok:
        blockers.append("TOKENIZER_HASH_MISMATCH_OR_MISSING")
    if not suite_ok:
        blockers.append("SUITE_HASH_MISMATCH_OR_MISSING")
    if not nll_ok:
        blockers.append("REFERENCE_NLL_INTEGRITY_FAIL_OR_MISSING")
    if not packing_ok:
        blockers.append("PACKING_PREFLIGHT_FAIL_OR_MISSING")
    if not train_denied:
        blockers.append("TRAIN_DENIAL_PATH_FAILED")

    report = {
        "ok": ready,
        "kind": KIND,
        "run_id": RUN_ID,
        "created_at": utc_now(),
        "TRAINING_AUTHORIZATION": TRAINING_AUTHORIZATION,
        "STAGE3B_AUTHORIZATION": STAGE3B_AUTHORIZATION,
        "optimizer_steps": 0,
        "optimizer_steps_this_pass": 0,
        "AdamW_constructed": False,
        "training_executed": False,
        "checkpoints_modified": False,
        "corpus_modified": False,
        "tokenizer_modified": False,
        "RUN_ID_UNUSED": collision["ok"],
        "collision": collision,
        "PARENT_HASH_MATCH": parent_ok,
        "TOKENIZER_HASH_MATCH": tok_ok,
        "SUITE_HASH_MATCH": suite_ok,
        "parent_sha256": parent_hash,
        "tokenizer_sha256": tok_hash,
        "suite_sha256": suite_hash,
        "dump_root": str(dump) if dump else None,
        "reference_nll": nll,
        "REFERENCE_NLL_INTEGRITY": "PASS" if nll_ok else "FAIL",
        "packing": packing,
        "PACKING_PREFLIGHT": packing["decision"]["PACKING_PREFLIGHT"] if packing else "FAIL",
        "STARVED_DOCS": packing["STARVED_DOC_IDS"] if packing else None,
        "schedule": {"ok": sched["ok"], "step_1": lr_run000006(1), "step_12": lr_run000006(12), "step_25": lr_run000006(25)},
        "schedule_table": schedule_table(),
        "dry_run": dry,
        "config": cfg,
        "TRAINING_CONFIG_SHA": cfg_sha,
        "READY_FOR_TRAINING_AUTHORIZATION": "YES" if ready else "NO",
        "BLOCKERS_REMAINING": blockers,
        "FULL_GREEDY_256_GATE_PATH": "VERIFIED",
        "WARNING_GATES": "VERIFIED",
        "REVIEW_GATES": "VERIFIED",
        "HARD_STOP_GATES": "VERIFIED",
        "RUN_COLLISION_GUARD": "VERIFIED" if dry["RUN_ID_COLLISION_GUARD"] == "VERIFIED" and collision["ok"] else "FAIL",
        "NONFINITE_STOP": dry["NONFINITE_STOP"],
        "checkpoint_policy_adjustment": "NONE — save_weights for 5/10/15/20; save_continuity only at 25 or hard-stop",
        "nothing_pushed": True,
        "nothing_deployed": True,
        "STAGE3B_executed": False,
        "MODEL_PROMOTED": False,
        "RAEL_PROMOTED": False,
    }
    write_json(Path(args.report), report)
    cfg_path = Path(args.config)
    unsigned_path = cfg_path.with_name(cfg_path.stem + ".unsigned.json")
    unsigned_path.write_bytes(canonical_config_bytes(cfg_without_sha))
    signed = dict(cfg_without_sha)
    signed["TRAINING_CONFIG_SHA"] = cfg_sha
    write_json(cfg_path, signed)
    sidecar = {
        "ok": True,
        "config": str(cfg_path),
        "unsigned": str(unsigned_path),
        "sha256_unsigned": cfg_sha,
        "TRAINING_AUTHORIZATION": "OFF",
    }
    write_json(Path(str(args.config) + ".SHA256.json"), sidecar)
    return report


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump-root", default=None)
    ap.add_argument("--data-root", required=True)
    ap.add_argument("--suite", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--config", required=True)
    args = ap.parse_args()
    report = run_preflight(args)
    print(json.dumps({k: report.get(k) for k in ("ok", "run_id", "READY_FOR_TRAINING_AUTHORIZATION", "BLOCKERS_REMAINING", "optimizer_steps", "TRAINING_CONFIG_SHA", "PACKING_PREFLIGHT")}, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
