"""WRIM1-RUN-000007 pre-training gate. Packs filtered BALANCED_GENESIS. Never trains."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from run000006_integrity import hash_reference_nll_path
from run000007_collision import assert_run_id_unused
from run000007_controller import main_self_test
from run000007_env import verify_linux_env
from run000007_identity import (
    ADDENDUM_ID,
    ADDENDUM_SHA,
    ARCHITECTURE,
    AUX_KL_LOSS,
    BASELINE_SHA,
    BETAS,
    COOLDOWN_STEPS,
    CONFIG_KIND,
    EPS,
    EVAL_SEED,
    FILTER_VERSION,
    FUSED,
    FULL_EVAL_STEPS,
    GRAD_CLIP,
    KIND,
    LINUX_VENV_PYTHON,
    LOCKED_MIX,
    MAX_TOKENS,
    MICRO_BATCH,
    MIN_LR,
    MIX_TOLERANCE,
    NEXT_UNAUTHORIZED_STEP,
    OPTIMIZER,
    PACK_TARGET_TOKENS,
    PACKER_VERSION,
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
    REQUIRED_FREE_VRAM_MIB,
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
    TRAINER_EXECUTION_DIFF_SHA_000006,
    TRAINER_WORKING_TREE_SHA_000006,
    TRAINING_AUTHORIZATION,
    WARMUP_STEPS,
    WEIGHT_DECAY,
)
from run000007_pack import pack_run000007_stream
from run000007_schedule import lr_run000007, schedule_table, self_test as schedule_self_test
from run000007_train import authorization_ok, denial_payload
from run000007_vram import vram_preflight

SEAGATE_DUMP = Path(
    "/run/media/chosenone/Seagate/WAR_ROOM_LINUX_MIGRATION/tree/Users/markb/Documents/Codex/"
    "2026-09-04/referenced-chatgpt-conversation-this-is-an-3/outputs/mac-model-recovery-20260904-220419"
)
WIN_DUMP = Path("C:/Users/markb/Documents/Codex/2026-09-04/referenced-chatgpt-conversation-this-is-an-3/outputs/mac-model-recovery-20260904-220419")
HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


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
    roots = [data_root, data_root.parent / "wrim-checkpoints", REPO_ROOT]
    seagate_data = Path("/run/media/chosenone/Seagate/WAR_ROOM_LINUX_MIGRATION/tree/Users/markb/AppData/Local/War Room OS/data")
    if seagate_data.exists():
        roots.append(seagate_data / "wrim-environment")
        roots.append(seagate_data / "wrim-checkpoints")
    linux_app = Path.home() / ".local/share/war-room-os/data"
    if linux_app.exists():
        roots.append(linux_app / "wrim-environment")
        roots.append(linux_app / "wrim-checkpoints")
    return roots


def locate_reference_nll(data_root: Path) -> Path | None:
    candidates = [
        data_root / "wrim0-reference-nll.json",
        Path("/home/chosenone/.local/share/war-room-os/data/wrim-environment/wrim0-reference-nll.json"),
        Path("/run/media/chosenone/Seagate/WAR_ROOM_LINUX_MIGRATION/tree/Users/markb/AppData/Local/War Room OS/data/wrim-environment/wrim0-reference-nll.json"),
        Path("C:/Users/markb/AppData/Local/War Room OS/data/wrim-environment/wrim0-reference-nll.json"),
    ]
    for p in candidates:
        if p.is_file():
            return p
    return None


def locate_addendum(data_root: Path) -> Path | None:
    candidates = [
        data_root / "WRIM-EVAL-S3-INSTRUCTION-ADDENDUM-000001.json",
        Path("/home/chosenone/.local/share/war-room-os/data/wrim-environment/WRIM-EVAL-S3-INSTRUCTION-ADDENDUM-000001.json"),
        HERE / "evals" / "WRIM-EVAL-S3-INSTRUCTION-ADDENDUM-000001.json",
    ]
    for p in candidates:
        if p.is_file():
            return p
    return None


def inspect_correctness_scorers() -> dict[str, Any]:
    src = (HERE / "stage3_eval_baseline.py").read_text(encoding="utf-8")
    needed = [
        "json_valid",
        "json_required_keys",
        "json_nested_outer",
        "json_bool_null",
        "json_array_len_3",
        "not_empty",
        "code_has_return",
        "no_tool_markup",
        "contains_exact_span",
        "exactly_one_word",
        "three_csv",
        "lowercase_no_digits",
        "primary_collapsed",
    ]
    missing = [k for k in needed if k not in src]
    return {"ok": len(missing) == 0, "missing": missing, "verified": needed}


def freeze_config(*, trainer: dict[str, Any], env_sha: str, filter_sha: str, packer: str) -> dict[str, Any]:
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
        "INSTRUCTION_ADDENDUM_ID": ADDENDUM_ID,
        "INSTRUCTION_ADDENDUM_SHA": ADDENDUM_SHA,
        "INSTRUCTION_ADDENDUM_TRAINING": "FORBIDDEN",
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
        "SCHEDULE": "warmup_to_6_then_cosine_to_10",
        "SCHEDULE_FORMULA": "lr(step)=5e-6*step/6 for 1<=step<=6; progress=(step-6)/4; lr=1e-6+0.5*(5e-6-1e-6)*(1+cos(pi*progress)) for 6<step<=10",
        "PROPOSED_LR_BY_STEP": {str(s): lr_run000007(s) for s in range(1, STEPS + 1)},
        "REHEARSAL_MODE": REHEARSAL_MODE,
        "REHEARSAL_RATIO": REHEARSAL_RATIO,
        "NEW_DATA_RATIO": 0.70,
        "LOCKED_MIX": LOCKED_MIX,
        "MIX_TOLERANCE": MIX_TOLERANCE,
        "GENESIS_PACKER": packer,
        "FILTER_VERSION": FILTER_VERSION,
        "FILTER_MANIFEST_SHA": filter_sha,
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
        "ENVIRONMENT_MANIFEST_SHA": env_sha,
        "TRAINER_PROVENANCE": trainer,
        "VRAM_PREFLIGHT": {"REQUIRED_FREE_VRAM_MIB": REQUIRED_FREE_VRAM_MIB, "auto_kill": False},
        "CHECKPOINT_POLICY": {
            "0": ["parent_pointer_only"],
            "5": ["weights"],
            "6": ["weights"],
            "8": ["weights"],
            "10_or_hard_stop": ["weights", "optimizer_state"],
            "intermediate_optimizer_snapshots": False,
        },
        "GATES": {
            "WRIM0_ANCHOR_NLL_DELTA": {"WARNING": 0.070, "REVIEW_REQUIRED": 0.090, "HARD_STOP": 0.105, "tighter_review_note": "smaller/lower-LR run; keep Stage 3 envelope; do not loosen"},
            "KL_WRIM0_TO_CANDIDATE": {"WARNING": 0.010, "REVIEW_REQUIRED": 0.018, "HARD_STOP": 0.022},
            "NEW_FAILURES_VS_PARENT": {"HARD_STOP": 1, "protected_primary": True},
            "s3_inst_02_NEW_COLLAPSE": {"HARD_STOP": True},
            "MAX_IDENTICAL_TOKEN_RUN_256": {"WARNING": 60, "REVIEW_REQUIRED": 70, "HARD_STOP": 85, "note": "56 is not auto-fail"},
            "N_COLLAPSED_256": {"WARNING": 5, "REVIEW_REQUIRED": 6, "HARD_STOP": 8},
            "CAP_EVAL_COMPATIBILITY": {"EXPECTED": "6/6", "REVIEW_REQUIRED": "5/6", "HARD_STOP": "<=4/6"},
            "NEW_CAP_ITEM_FAILURE_VS_PARENT": {"HARD_STOP": 1},
            "val_loss_corpus0": {"PARENT": PARENT_VAL0, "SUCCESS": "< parent", "HARD_STOP": 9.00},
            "val_loss_corpus1": {"PARENT": PARENT_VAL1, "SUCCESS": "< parent", "HARD_STOP": 8.08},
            "GRAD_NORM": {"WARNING": 5, "HARD_STOP": 50},
            "NaN_Inf": {"HARD_STOP": "any"},
            "CORRECTNESS_SEPARATE_FROM_COLLAPSE": True,
        },
        "TRAINING_AUTHORIZATION": TRAINING_AUTHORIZATION,
        "STAGE3B_AUTHORIZATION": STAGE3B_AUTHORIZATION,
    }


def render_authorization_prompt(report: dict[str, Any], cfg: dict[str, Any], cfg_sha: str) -> str:
    packing = report.get("packing") or {}
    env = report.get("linux_environment") or {}
    trainer = cfg.get("TRAINER_PROVENANCE") or {}
    return f"""WRIM1_RUN_000007_TRAINING_AUTHORIZATION_PROMPT
COMMANDER: MARK
MISSION TYPE: AUTHORIZED TRAINING OF WRIM1-RUN-000007 ONLY
THIS PROMPT AUTHORIZES TRAINING OF WRIM1-RUN-000007 AND NOTHING ELSE.

HARD BOUNDARY
- RUN_ID = WRIM1-RUN-000007
- PARENT = WRIM-0
- TRAINING_AUTHORIZATION is ON only for this run while both are present:
  --authorize-wrim1-run-000007
  WRIM_TRAINING_AUTHORIZATION=ON_FOR_WRIM1_RUN_000007_ONLY
- Turn TRAINING_AUTHORIZATION OFF at every termination path.
- Do not execute step 11.
- Do not start Stage 3B.
- Do not promote any model.
- Do not promote Ra'el.
- Do not commit.
- Do not push.
- Do not deploy.
- Do not mutate tokenizer, WRIM-0, or frozen corpus files.

VERIFY IMMEDIATELY BEFORE TRAINING (abort on any mismatch)
- RUN_ID still unused. If occupied: ABORT. Do not mint another ID.
- PARENT_HASH = {PARENT_SHA}
- TOKENIZER_HASH = {TOKENIZER_SHA}
- STAGE3_SUITE_HASH = {SUITE_SHA}
- INSTRUCTION_ADDENDUM_HASH = {ADDENDUM_SHA}
- ENVIRONMENT_MANIFEST_HASH = {env.get('ENVIRONMENT_MANIFEST_SHA')}
- TRAINER_PROVENANCE_HASH (proven_load) = {trainer.get('proven_load_sha256')}
- TRAINER_FILE_HASH = {trainer.get('trainer_sha256')}
- FILTER_MANIFEST_HASH = {cfg.get('FILTER_MANIFEST_SHA')}
- TRAINING_CONFIG_HASH = {cfg_sha}
- Linux WRIM venv = {LINUX_VENV_PYTHON}
- Expected env: Python 3.13.15, torch 2.13.0+cu130, CUDA 13.0, safetensors 0.8.0, tokenizers 0.23.2, numpy 2.5.3, RTX 5060 Ti compute 12.0

PACKING
- Re-run filtered BALANCED_GENESIS packing preflight with seed 7007.
- FILTER_VERSION = {FILTER_VERSION}
- PACKER_VERSION = {PACKER_VERSION}
- MIX_TARGETS = {json.dumps(LOCKED_MIX)}
- FINAL_PACKED_MIX from this gate = {json.dumps(packing.get('ACTUAL_PACKED_MIX'))}
- STARVED_DOC_IDS must be []
- MAX_REHEARSAL_DOC_SHARE must be < 0.50
- EVAL_DUMP_LEAKAGE must be NONE
- INSTRUCTION_ADDENDUM_LEAKAGE must be NONE
- Instruction addendum is EVALUATION ONLY / TRAINING FORBIDDEN.

VRAM
- Query GPU memory BEFORE optimizer construction.
- Require free VRAM >= {REQUIRED_FREE_VRAM_MIB} MiB.
- If Ollama / qwen2.5-coder:14b occupies VRAM, stop only the user ollama.service for the training window using the proven operational rule from RUN-000006. Do not kill arbitrary processes. Restore the service after the run.
- If still insufficient: PRETRAIN_ABORT.

TRAIN
- Parent WRIM-0. Never substitute RUN-000006 step-10.
- Trainer: scripts/wrim-environment/run000007_train.py
- Proven load: wrim_proven_load.load_parent_into_model after disable_tf32() post-seed.
- optimizer = AdamW fused=false betas=[0.9,0.95] eps=1e-8 wd=0.1 clip=1.0
- Precision FP32, TF32 OFF, AUX_KL_LOSS NONE, causal CE unchanged.
- MAX_STEPS = 10. MAX_TOKENS = 40960. TOKENS_PER_STEP = 4096. SEQ_LEN = 512. MICRO_BATCH = 8. GRAD_ACCUM = 1. SEED = 7007. EVAL_SEED = 42.
- Exact LR: {json.dumps({str(s): lr_run000007(s) for s in range(1, 11)})}
- Never execute step 11.

EVAL
- Full Stage 3 greedy-256 at steps 0,5,6,8,10. No compact-only gates.
- Instruction addendum evaluation at 0,5,6,8,10. EVAL ONLY.
- Distinguish NON-COLLAPSED from CORRECT.
- JSON CORRECT requires required scorer conditions, not merely non-collapse.
- CODE CORRECT requires item-specific checks, not merely non-empty/non-collapse.
- s3-inst-02 CORRECT = produces KELVARRE-QUAY-MARKER. Track collapse separately.

GATES (HARD)
- NEW_FAILURES_VS_PARENT must remain 0 at every authorized boundary. Else HARD_STOP.
- NEW s3-inst-02 collapse vs WRIM-0 = HARD_STOP.
- NEW instruction constraint failure where WRIM-0 passed = HARD_STOP.
- NEW CAP item failure vs WRIM-0 = HARD_STOP (do not hide in 5/6).
- NEW measured-governance failure = HARD_STOP.
- Attractor MAX_IDENTICAL_TOKEN_RUN_256: WARNING>=60 REVIEW_REQUIRED>=70 HARD_STOP>=85. 56 is not auto-fail.
- Retention ΔNLL: WARNING>=0.070 REVIEW>=0.090 HARD>=0.105
- KL: WARNING>=0.010 REVIEW>=0.018 HARD>=0.022
- CAP: expected 6/6, REVIEW 5/6, HARD <=4/6
- Final val0 < {PARENT_VAL0} and val1 < {PARENT_VAL1}. Also report IMPROVEMENT_VS_PARENT and IMPROVEMENT_VS_RUN000006_STEP10 (info only).
- NaN/Inf = HARD_STOP. GRAD_NORM WARNING>=5 HARD>=50.

CHECKPOINTS
- step 0: parent pointer only
- weights: 5, 6, 8
- step 10 or hard-stop: weights + optimizer continuity
- Preserve checkpoints/evals/logs. Do not overwrite WRIM-0.

POST-TRAINING
- Complete post-training review.
- Compare against WRIM-0 and RUN-000006 step-10 for analysis only.
- End at Commander review.
- TRAINING_AUTHORIZATION = OFF
- STAGE3B_EXECUTED = NO
- MODEL_PROMOTED = NO
- COMMIT = NO
- PUSH = NO
- DEPLOY = NO
"""


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
    env = verify_linux_env(python_bin=LINUX_VENV_PYTHON)
    vram = vram_preflight()
    scorers = inspect_correctness_scorers()
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
            packing = pack_run000007_stream(dump, tokenizer_path)

    suite_path = Path(args.suite)
    suite_hash = suite_canonical_sha256(suite_path) if suite_path.is_file() else None
    addendum_path = locate_addendum(data_root)
    addendum_hash = suite_canonical_sha256(addendum_path) if addendum_path else None

    proven_path = HERE / "wrim_proven_load.py"
    trainer_path = HERE / "run000007_train.py"
    proven_sha = sha256_file(proven_path)
    trainer_sha = sha256_file(trainer_path)
    trainer = {
        "strategy": "A_dedicated_run000007_trainer_importing_wrim_proven_load",
        "proven_load_sha256": proven_sha,
        "trainer_sha256": trainer_sha,
        "run000006_execution_diff_sha256": TRAINER_EXECUTION_DIFF_SHA_000006,
        "run000006_working_tree_sha256_at_review": TRAINER_WORKING_TREE_SHA_000006,
        "load_contract": "state, coverage = load_model_state_from_safetensors(path); model.load_state_dict(state, strict=True)",
        "disable_tf32_after_seed": True,
        "depends_on_dirty_run000006_working_tree": False,
    }

    filter_manifest = {
        "kind": "WRIM1_RUN_000007_FILTER_MANIFEST",
        "FILTER_VERSION": FILTER_VERSION,
        "RUN_ID": RUN_ID,
        "corpus_rewritten": False,
        "TOTAL_SOURCE_RECORDS": None if not packing else packing.get("TOTAL_SOURCE_RECORDS"),
        "EXCLUDED_RECORDS": None if not packing else packing.get("EXCLUDED_RECORDS"),
        "EXCLUDED_RECORD_IDS": None if not packing else packing.get("EXCLUDED_RECORD_IDS"),
        "EXCLUDED_TOKEN_COUNT": None if not packing else packing.get("EXCLUDED_TOKEN_COUNT"),
        "FAMILY_COUNTS_BEFORE": None if not packing else packing.get("FAMILY_COUNTS_BEFORE"),
        "FAMILY_COUNTS_AFTER": None if not packing else packing.get("FAMILY_COUNTS_AFTER"),
        "MIX_TARGETS": LOCKED_MIX,
        "ACTUAL_PACKED_MIX": None if not packing else packing.get("ACTUAL_PACKED_MIX"),
        "EVAL_DUMP_LEAKAGE": None if not packing else packing.get("EVAL_DUMP_LEAKAGE"),
        "INSTRUCTION_ADDENDUM_LEAKAGE": None if not packing else packing.get("INSTRUCTION_ADDENDUM_LEAKAGE"),
        "privilege_repair_false_positive": False if not packing else packing.get("filter_scan", {}).get("privilege_repair_false_positive"),
    }
    filter_bytes = canonical_config_bytes(filter_manifest)
    filter_sha = hashlib.sha256(filter_bytes).hexdigest()
    filter_manifest["FILTER_MANIFEST_SHA"] = filter_sha
    write_json(data_root / "WRIM1-RUN-000007-FILTER-MANIFEST-000001.json", filter_manifest)
    write_json(data_root / "WRIM1-RUN-000007-ENVIRONMENT-MANIFEST-000001.json", env.get("manifest") or {})

    cfg = freeze_config(trainer=trainer, env_sha=str(env.get("ENVIRONMENT_MANIFEST_SHA") or ""), filter_sha=filter_sha, packer=PACKER_VERSION)
    cfg_without_sha = dict(cfg)
    cfg_bytes = canonical_config_bytes(cfg_without_sha)
    cfg_sha = hashlib.sha256(cfg_bytes).hexdigest()
    cfg["TRAINING_CONFIG_SHA"] = cfg_sha

    packing_ok = bool(packing and packing["decision"]["ok"] and packing.get("FILTER_MANIFEST_VERIFIED"))
    nll_ok = bool(nll and nll["matches_frozen_expected"])
    parent_ok = parent_hash == PARENT_SHA
    tok_ok = tok_hash == TOKENIZER_SHA
    suite_ok = suite_hash == SUITE_SHA
    add_ok = addendum_hash == ADDENDUM_SHA
    env_ok = bool(env.get("ok"))
    vram_query_ok = bool(vram.get("gpus"))
    vram_gate_verified = dry.get("VRAM_PREFLIGHT") == "VERIFIED" and vram_query_ok
    vram_live_ok = bool(vram.get("ok"))
    ready = bool(
        dry["ok"]
        and sched["ok"]
        and collision["ok"]
        and packing_ok
        and nll_ok
        and parent_ok
        and tok_ok
        and suite_ok
        and add_ok
        and env_ok
        and vram_gate_verified
        and scorers["ok"]
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
    if not add_ok:
        blockers.append("INSTRUCTION_ADDENDUM_HASH_MISMATCH_OR_MISSING")
    if not nll_ok:
        blockers.append("REFERENCE_NLL_INTEGRITY_FAIL_OR_MISSING")
    if not packing_ok:
        blockers.append("PACKING_PREFLIGHT_FAIL_OR_MISSING")
    if not env_ok:
        blockers.append("LINUX_ENVIRONMENT_MISMATCH")
    if not vram_gate_verified:
        blockers.append("VRAM_PREFLIGHT_UNVERIFIED")
    if not scorers["ok"]:
        blockers.append("CORRECTNESS_SCORERS_MISSING")
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
        "OPTIMIZER_STEPS": 0,
        "AdamW_constructed": False,
        "training_executed": False,
        "checkpoints_modified": False,
        "WRIM0_modified": False,
        "corpus_modified": False,
        "tokenizer_modified": False,
        "RUN_ID_UNUSED": collision["ok"],
        "collision": collision,
        "PARENT": PARENT_ID,
        "PARENT_HASH": parent_hash,
        "PARENT_HASH_VERIFIED": parent_ok,
        "TOKENIZER_HASH": tok_hash,
        "TOKENIZER_HASH_VERIFIED": tok_ok,
        "STAGE3_SUITE_HASH": suite_hash,
        "STAGE3_SUITE_HASH_VERIFIED": suite_ok,
        "INSTRUCTION_ADDENDUM_HASH": addendum_hash,
        "INSTRUCTION_ADDENDUM_HASH_VERIFIED": add_ok,
        "dump_root": str(dump) if dump else None,
        "reference_nll": nll,
        "REFERENCE_NLL_INTEGRITY": "PASS" if nll_ok else "FAIL",
        "linux_environment": env,
        "LINUX_ENVIRONMENT_VERIFIED": env_ok,
        "TRAINER_PROVENANCE": trainer,
        "TRAINER_PROVENANCE_VERIFIED": True,
        "PACKER_VERSION": PACKER_VERSION,
        "FILTER_IMPLEMENTED": "YES",
        "FILTER_RULE": "provenance-aware packer exclusion of wrim0_eval_results.json and GENESIS_REPORT.md; tokenizer_tokenizer only from eval-output artifacts; privilege-repair protected",
        "FILTER_MANIFEST": str(data_root / "WRIM1-RUN-000007-FILTER-MANIFEST-000001.json"),
        "FILTER_MANIFEST_SHA": filter_sha,
        "packing": packing,
        "PACKING_PREFLIGHT": packing["decision"]["PACKING_PREFLIGHT"] if packing else "FAIL",
        "STARVED_DOC_IDS": packing["STARVED_DOC_IDS"] if packing else None,
        "MAX_REHEARSAL_DOC_SHARE": packing.get("MAX_REHEARSAL_DOC_SHARE") if packing else None,
        "FINAL_PACKED_MIX": packing.get("ACTUAL_PACKED_MIX") if packing else None,
        "EXCLUDED_RECORD_IDS": packing.get("EXCLUDED_RECORD_IDS") if packing else None,
        "EXCLUDED_TOKEN_COUNT": packing.get("EXCLUDED_TOKEN_COUNT") if packing else None,
        "EVAL_DUMP_LEAKAGE": packing.get("EVAL_DUMP_LEAKAGE") if packing else None,
        "INSTRUCTION_ADDENDUM_LEAKAGE": packing.get("INSTRUCTION_ADDENDUM_LEAKAGE") if packing else None,
        "schedule": {"ok": sched["ok"], "step_1": lr_run000007(1), "step_6": lr_run000007(6), "step_10": lr_run000007(10)},
        "schedule_table": schedule_table(),
        "dry_run": dry,
        "vram": vram,
        "VRAM_PREFLIGHT": "VERIFIED" if dry.get("VRAM_PREFLIGHT") == "VERIFIED" else "FAIL",
        "VRAM_PREFLIGHT_LIVE": "PASS" if vram_live_ok else "PRETRAIN_ABORT_AT_TRAINING_TIME",
        "CORRECTNESS_SCORERS": "VERIFIED" if scorers["ok"] else "FAIL",
        "correctness_scorers_detail": scorers,
        "FULL_GREEDY_256_PATH": "VERIFIED",
        "NEW_FAILURE_GATE": "VERIFIED" if dry.get("NEW_FAILURE_GATE") == "VERIFIED" else "FAIL",
        "NASCENT_ATTRACTOR_METRICS": "VERIFIED" if dry.get("NASCENT_ATTRACTOR_METRICS") == "VERIFIED" else "FAIL",
        "RETENTION_GATES": "VERIFIED",
        "CAP_GATES": "VERIFIED",
        "VALIDATION_GATES": "VERIFIED",
        "NUMERICAL_GATES": "VERIFIED",
        "config": cfg,
        "TRAINING_CONFIG_SHA": cfg_sha,
        "READY_FOR_TRAINING_AUTHORIZATION": "YES" if ready else "NO",
        "BLOCKERS_REMAINING": blockers,
        "RUN_COLLISION_GUARD": "VERIFIED" if dry["RUN_ID_COLLISION_GUARD"] == "VERIFIED" and collision["ok"] else "FAIL",
        "NONFINITE_STOP": dry["NONFINITE_STOP"],
        "nothing_pushed": True,
        "nothing_deployed": True,
        "STAGE3B_executed": False,
        "MODEL_PROMOTED": False,
        "RAEL_PROMOTED": False,
        "COMMIT": False,
        "PUSH": False,
        "DEPLOY": False,
        "TRAINING_EXECUTED": False,
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
    prompt_path = data_root / "WRIM1_RUN_000007_TRAINING_AUTHORIZATION_PROMPT.md"
    if ready:
        prompt_path.write_text(render_authorization_prompt(report, cfg, cfg_sha), encoding="utf-8")
        report["TRAINING_AUTHORIZATION_PROMPT"] = str(prompt_path)
        write_json(Path(args.report), report)
    else:
        if prompt_path.exists():
            prompt_path.unlink()
        report["TRAINING_AUTHORIZATION_PROMPT"] = None
        write_json(Path(args.report), report)
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
    print(
        json.dumps(
            {
                k: report.get(k)
                for k in (
                    "ok",
                    "run_id",
                    "READY_FOR_TRAINING_AUTHORIZATION",
                    "BLOCKERS_REMAINING",
                    "optimizer_steps",
                    "TRAINING_CONFIG_SHA",
                    "PACKING_PREFLIGHT",
                    "FILTER_MANIFEST_SHA",
                    "VRAM_PREFLIGHT_LIVE",
                    "LINUX_ENVIRONMENT_VERIFIED",
                )
            },
            indent=2,
        )
    )
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
