#!/usr/bin/env python3
"""WRIM-1 training entrypoint. Official start remains authorization-gated."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from authorization import assert_official_resume_allowed, assert_official_start_allowed  # noqa: E402
from checkpoint_io import latest_known_good  # noqa: E402
from constants import PARENT_CHECKPOINT_REL, PARENT_CHECKPOINT_SHA256, RUN_ID  # noqa: E402
from hashes import sha256_json  # noqa: E402
from paths import official_ckpt_dir, repo_root, test_only_dir  # noqa: E402
from preflight import run_preflight  # noqa: E402
from run_status import clear_pid, persist_authorization, persist_promotion, persist_run_fields, write_pid  # noqa: E402
from trainer_core import train_loop  # noqa: E402
from training_config import official_training_config, test_only_training_config  # noqa: E402
from materialize_shards import load_split_arrays  # noqa: E402


def run_official(root: Path, args) -> int:
    auth_path = root / "model-lab/manifests/wave9/authorization.json"
    try:
        auth_state = json.loads(auth_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print("official WRIM-1 start blocked: authorization.json missing", file=sys.stderr)
        return 2
    if auth_state.get("run_id") != RUN_ID:
        print("official WRIM-1 start blocked: authorization is not for WRIM1-RUN-000001", file=sys.stderr)
        return 2
    if args.max_steps is not None or args.stop_after is not None:
        print("official WRIM-1 start blocked: refusing substituted step counts", file=sys.stderr)
        return 2
    if args.train_npy or args.val_npy:
        print("official WRIM-1 start blocked: refusing substituted dataset paths", file=sys.stderr)
        return 2
    work = official_ckpt_dir(root)
    resume = Path(args.resume_from) if args.resume_from else latest_known_good(work / "checkpoint-registry.json")
    starting = auth_state.get("TRAINING_STARTED") is True or resume is not None
    try:
        if starting:
            assert_official_resume_allowed(root, args.authorization_token)
        else:
            if auth_state.get("authorization_state") != args.require_authorization_state:
                print(
                    f"official WRIM-1 start blocked: authorization_state={auth_state.get('authorization_state')} "
                    f"required={args.require_authorization_state}",
                    file=sys.stderr,
                )
                return 2
            assert_official_start_allowed(root, args.authorization_token)
    except PermissionError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    report = run_preflight(
        root,
        mode="resume" if starting else "start",
        require_corpus_bytes=True,
        require_materialized=True,
    )
    (root / "model-lab/manifests/wave9/preflight.json").write_text(
        json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8"
    )
    if not report["passed"]:
        print(json.dumps({"status": "PREFLIGHT_FAIL", "failures": report["failures"]}), file=sys.stderr)
        return 2

    manifest_path = Path(args.run_manifest) if args.run_manifest else root / "model-lab/manifests/wave9/WRIM1-RUN-000001.json"
    run_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if run_manifest.get("run_id") != RUN_ID:
        print("official WRIM-1 start blocked: run manifest is not WRIM1-RUN-000001", file=sys.stderr)
        return 2
    cfg = official_training_config()
    if sha256_json(cfg) != run_manifest.get("training_config_sha256"):
        print("official WRIM-1 start blocked: training config hash mismatch", file=sys.stderr)
        return 2
    parent = root / PARENT_CHECKPOINT_REL
    identities = {
        "corpus_sha256": run_manifest["corpus_sha256"],
        "tokenizer_sha256": run_manifest["tokenizer_sha256"],
        "architecture_config_sha256": run_manifest["architecture_config_sha256"],
        "training_config_sha256": run_manifest["training_config_sha256"],
        "parent_checkpoint_path": str(parent),
        "parent_checkpoint_sha256": PARENT_CHECKPOINT_SHA256,
        "test_only": False,
        "lineage": "WRX-000001 -> WRIM-0 -> WRIM1-RUN-000001",
        "promotable": False,
    }
    try:
        train, val, _shard_manifest = load_split_arrays(root)
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        return 2
    persist_authorization(
        root,
        authorization_state="TRAINING",
        training_status="TRAINING",
        TRAINING_AUTHORIZED=True,
        TRAINING_STARTED=True,
        commander_authorization_token_present=True,
        note="WRIM1-RUN-000001 official training in progress.",
    )
    persist_run_fields(
        root,
        authorization_state="TRAINING",
        training_status="TRAINING",
        TRAINING_AUTHORIZED=True,
        TRAINING_STARTED=True,
    )
    persist_promotion(root, "TRAINING")
    write_pid(root)
    try:
        result = train_loop(
            work_dir=work,
            cfg=cfg,
            run_manifest=run_manifest,
            train_stream=train,
            val_stream=val,
            max_steps=int(cfg["total_steps"]),
            stop_after=None,
            resume_from=resume if starting else None,
            identities=identities,
            run_status_on_complete="TRAINED",
        )
    except Exception as exc:  # noqa: BLE001
        persist_authorization(root, authorization_state="FAILED", training_status="FAILED")
        persist_run_fields(root, authorization_state="FAILED", training_status="FAILED")
        print(str(exc), file=sys.stderr)
        return 1
    finally:
        clear_pid(root)

    if result.get("status") == "TRAINED":
        persist_authorization(root, authorization_state="COMPLETED", training_status="TRAINED")
        persist_run_fields(root, authorization_state="COMPLETED", training_status="TRAINED")
        persist_promotion(root, "TRAINED")
    elif result.get("status") == "INTERRUPTED":
        persist_authorization(root, authorization_state="TRAINING", training_status="INTERRUPTED")
        persist_run_fields(root, authorization_state="TRAINING", training_status="INTERRUPTED")
    print(json.dumps({k: v for k, v in result.items() if k != "authorization_token"}))
    return 0 if result.get("status") in ("TRAINED", "INTERRUPTED", "COMPLETED") else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--mode", choices=["official", "test-only", "preflight"], required=True)
    ap.add_argument("--run-manifest", default=None)
    ap.add_argument("--require-authorization-state", default="AUTHORIZED")
    ap.add_argument("--authorization-token", default=None)
    ap.add_argument("--work-dir", default=None)
    ap.add_argument("--resume-from", default=None)
    ap.add_argument("--stop-after", type=int, default=None)
    ap.add_argument("--max-steps", type=int, default=None)
    ap.add_argument("--train-npy", default=None)
    ap.add_argument("--val-npy", default=None)
    args = ap.parse_args()
    root = repo_root()

    if args.mode == "preflight":
        report = run_preflight(root, require_mlx=True, mode="start", require_corpus_bytes=True, require_materialized=True)
        (root / "model-lab/manifests/wave8_1_recovery").mkdir(parents=True, exist_ok=True)
        (root / "model-lab/manifests/wave8_1_recovery/readiness-preflight.json").write_text(
            json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8"
        )
        (root / "model-lab/manifests/wave9/preflight.json").write_text(
            json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8"
        )
        print(json.dumps({"passed": report["passed"], "failures": report["failures"], "mode": "readiness"}, indent=2))
        return 0 if report["passed"] else 2

    if args.mode == "official":
        return run_official(root, args)

    if args.mode == "test-only":
        import numpy as np
        work = Path(args.work_dir) if args.work_dir else test_only_dir(root) / "TEST-WAVE9-RESUME"
        if "WRIM-1" in str(work) or work.name.startswith("WRIM1"):
            print("refusing test-only path that looks like official WRIM-1 lineage", file=sys.stderr)
            return 2
        cfg = test_only_training_config()
        if args.max_steps is not None:
            cfg["total_steps"] = args.max_steps
        if args.train_npy:
            train = np.load(args.train_npy)
            val = np.load(args.val_npy) if args.val_npy else train[: max(64, train.size // 8)]
        else:
            rng = np.random.default_rng(cfg["seed"])
            train = rng.integers(0, cfg["vocab_size"], size=1024, dtype=np.int32)
            val = rng.integers(0, cfg["vocab_size"], size=256, dtype=np.int32)
        manifest_path = Path(args.run_manifest) if args.run_manifest else work / "run-manifest.json"
        if manifest_path.is_file():
            run_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        else:
            run_manifest = {
                "run_id": "TEST-WAVE9-RESUME",
                "run_version": "test-only",
                "authorization_state": "TEST_ONLY",
                "training_status": "TEST_ONLY",
                "test_only": True,
                "lineage": "NOT_MODEL_LINEAGE",
                "promotable": False,
                "training_config_sha256": "test-config",
            }
        identities = {
            "corpus_sha256": "test-synthetic",
            "tokenizer_sha256": "test-int-vocab",
            "architecture_config_sha256": "test-tiny",
            "training_config_sha256": run_manifest.get("training_config_sha256", "test-config"),
            "test_only": True,
            "lineage": "NOT_MODEL_LINEAGE",
        }
        resume = Path(args.resume_from) if args.resume_from else None
        result = train_loop(
            work_dir=work,
            cfg=cfg,
            run_manifest=run_manifest,
            train_stream=train,
            val_stream=val,
            max_steps=int(cfg["total_steps"]),
            stop_after=args.stop_after,
            resume_from=resume,
            identities=identities,
            run_status_on_complete="TEST_ONLY_COMPLETED",
        )
        print(json.dumps(result))
        return 0 if result["status"] in ("TEST_ONLY_COMPLETED", "INTERRUPTED", "COMPLETED") else 1

    print("unknown mode", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
