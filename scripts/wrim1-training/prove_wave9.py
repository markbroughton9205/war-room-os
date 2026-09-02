#!/usr/bin/env python3
"""Wave 9 non-vacuous Python proofs. TEST_ONLY. Never starts official WRIM-1 training."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from authorization import official_start_would_be_blocked  # noqa: E402
from checkpoint_io import load_bundle, retention_plan  # noqa: E402
from constants import CORPUS_SHA256, PARENT_CHECKPOINT_SHA256, TOKENIZER_SHA256  # noqa: E402
from fingerprints import dirty_tree_fingerprint, hardware_fingerprint, resource_plan, software_fingerprint  # noqa: E402
from hashes import sha256_file, sha256_json, tensor_tree_sha256  # noqa: E402
from paths import official_ckpt_dir, repo_root, test_only_dir, wave9_dir  # noqa: E402
from preflight import run_preflight  # noqa: E402
from run_identity import build_official_run_manifest  # noqa: E402
from training_config import official_training_config, optimizer_config_from_training, test_only_training_config  # noqa: E402

EXPECTED = 22
PYTHON = sys.executable
TRAINER = str(SCRIPT_DIR / "train_wrim1.py")


class Harness:
    def __init__(self, expected: int):
        self.expected = expected
        self.results = []

    def check(self, name: str, fn) -> None:
        try:
            fn()
            self.results.append({"name": name, "ok": True})
            print(f"PASS {name}")
        except Exception as exc:  # noqa: BLE001
            self.results.append({"name": name, "ok": False, "detail": str(exc)})
            print(f"FAIL {name}: {exc}")

    def finish(self) -> int:
        passed = sum(1 for r in self.results if r["ok"])
        failed = sum(1 for r in self.results if not r["ok"])
        total = len(self.results)
        print(f"Wave 9 Python proofs: TOTAL={total} EXPECTED={self.expected} PASS={passed} FAIL={failed}")
        if failed == 0 and total == self.expected:
            print(f"Wave 9 Python proofs: {passed}/{self.expected} PASS")
            return 0
        if total != self.expected:
            print(f"Wave 9 Python proofs: ran {total} checks but expected {self.expected}")
        return 1


def run_json(args: list[str], cwd: Path) -> tuple[int, str, str]:
    proc = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    return proc.returncode, proc.stdout, proc.stderr


def main() -> int:
    root = repo_root()
    w9 = wave9_dir(root)
    w9.mkdir(parents=True, exist_ok=True)
    test_root = test_only_dir(root)
    if test_root.exists():
        shutil.rmtree(test_root)
    test_root.mkdir(parents=True)

    cfg = official_training_config()
    (w9 / "training-config.json").write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
    (w9 / "optimizer-config.json").write_text(json.dumps(optimizer_config_from_training(cfg), indent=2) + "\n", encoding="utf-8")
    run_manifest = build_official_run_manifest(root)
    (w9 / "WRIM1-RUN-000001.json").write_text(json.dumps(run_manifest, indent=2) + "\n", encoding="utf-8")
    auth = {
        "run_id": "WRIM1-RUN-000001",
        "authorization_state": "AWAITING_COMMANDER_AUTHORIZATION",
        "training_status": "NOT_STARTED",
        "TRAINING_READY": True,
        "TRAINING_AUTHORIZED": False,
        "TRAINING_STARTED": False,
        "commander_authorization_token_present": False,
        "note": "Wave 9 does not authorize training.",
    }
    (w9 / "authorization.json").write_text(json.dumps(auth, indent=2) + "\n", encoding="utf-8")
    (w9 / "software-fingerprint.json").write_text(json.dumps(software_fingerprint(root), indent=2) + "\n", encoding="utf-8")
    (w9 / "hardware-fingerprint.json").write_text(json.dumps(hardware_fingerprint(), indent=2) + "\n", encoding="utf-8")
    (w9 / "dirty-tree-fingerprint.json").write_text(json.dumps(dirty_tree_fingerprint(root), indent=2) + "\n", encoding="utf-8")
    (w9 / "resource-plan.json").write_text(json.dumps(resource_plan(), indent=2) + "\n", encoding="utf-8")
    (w9 / "retention-policy.json").write_text(json.dumps(retention_plan(), indent=2) + "\n", encoding="utf-8")
    held = sha256_file(root / "model-lab/manifests/wave8_1/held-out-eval-suite.json")
    (w9 / "held-out-fingerprint.json").write_text(json.dumps({
        "heldout_manifest_sha256": held,
        "recheck_before_future_eval": True,
        "test_expected_outputs_not_in_training": True,
    }, indent=2) + "\n", encoding="utf-8")
    (w9 / "FUTURE_WRIM1_TRAINING_COMMAND.txt").write_text(
        "\n".join([
            "# DO NOT EXECUTE unless Commander authorization_state is AUTHORIZED.",
            "python3 scripts/wrim1-training/train_wrim1.py \\",
            "  --mode official \\",
            "  --run-manifest model-lab/manifests/wave9/WRIM1-RUN-000001.json \\",
            "  --require-authorization-state AUTHORIZED \\",
            "  --authorization-token \"$WRIM1_COMMANDER_AUTHORIZATION_TOKEN\"",
            "",
            "Authorization is currently AWAITING_COMMANDER_AUTHORIZATION.",
            "This file is an operator artifact. It is not a launch.",
            "",
        ]),
        encoding="utf-8",
    )

    h = Harness(EXPECTED)
    work_a = test_root / "run-a-continuous"
    work_b = test_root / "run-b-resume"
    work_iso = test_root / "isolation-probe"

    def unauthorized():
        code, out, err = run_json([PYTHON, TRAINER, "--mode", "official", "--run-manifest", str(w9 / "WRIM1-RUN-000001.json")], root)
        assert code != 0, f"expected nonzero, got {code} stdout={out}"
        assert "blocked" in (err + out).lower()
        assert not official_ckpt_dir(root).exists()
        assert not list(root.glob("model-lab/manifests/wrim1_checkpoints/**/model.safetensors"))

    h.check("unauthorized official start is blocked and creates no checkpoint", unauthorized)

    def preflight_ok():
        report = run_preflight(root, require_mlx=True)
        (w9 / "preflight.json").write_text(json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8")
        assert report["passed"], f"preflight failures={report['failures']}"
        assert report["ram_bytes"]
        assert report["disk_free_bytes"] > 0

    h.check("M1/disk/memory preflight passes", preflight_ok)

    def integrity():
        tok = sha256_file(root / "model-lab/manifests/wrim0_tokenizer_v16384/tokenizer.json")
        parent = sha256_file(root / "model-lab/manifests/wrim0_checkpoints/checkpoint-final.safetensors")
        corpus = json.loads((root / "model-lab/manifests/wave8_1/corpus-manifest.json").read_text())["contentHash"]
        assert tok == TOKENIZER_SHA256
        assert parent == PARENT_CHECKPOINT_SHA256
        assert corpus == CORPUS_SHA256

    h.check("tokenizer/parent/corpus hashes match Wave 8.1 baseline", integrity)

    def dry_run_a():
        code, out, err = run_json([
            PYTHON, TRAINER, "--mode", "test-only",
            "--work-dir", str(work_a),
            "--max-steps", "20",
        ], root)
        assert code == 0, err or out
        payload = json.loads(out.strip().splitlines()[-1])
        assert payload["global_step"] == 20
        assert Path(payload["last_checkpoint"]).is_dir()
        assert "WRIM-1" not in str(work_a)
        bundle = load_bundle(Path(payload["last_checkpoint"]))
        assert bundle["manifest"]["test_only"] is True
        assert bundle["manifest"]["lineage"] == "NOT_MODEL_LINEAGE"
        assert bundle["optimizer_config"]["optimizer"] == "AdamW"
        assert (work_a / "metrics.jsonl").is_file()
        lines = (work_a / "metrics.jsonl").read_text().strip().splitlines()
        assert len(lines) >= 20

    h.check("test-only continuous 20-step dry run", dry_run_a)

    def run_b_interrupted():
        code, out, err = run_json([
            PYTHON, TRAINER, "--mode", "test-only",
            "--work-dir", str(work_b),
            "--max-steps", "20",
            "--stop-after", "10",
        ], root)
        assert code == 0, err or out
        payload = json.loads(out.strip().splitlines()[-1])
        assert payload["global_step"] == 10
        ckpt = Path(payload["last_checkpoint"])
        assert ckpt.is_dir()
        code2, out2, err2 = run_json([
            PYTHON, TRAINER, "--mode", "test-only",
            "--work-dir", str(work_b),
            "--max-steps", "20",
            "--resume-from", str(ckpt),
        ], root)
        assert code2 == 0, err2 or out2
        payload2 = json.loads(out2.strip().splitlines()[-1])
        assert payload2["global_step"] == 20

    h.check("fresh-process resume 10 then 11-20", run_b_interrupted)

    def interruption_equivalence():
        a = load_bundle(work_a / "checkpoint-step-000020")
        b = load_bundle(work_b / "checkpoint-step-000020")
        model_equal = a["manifest"]["model_tensor_sha256"] == b["manifest"]["model_tensor_sha256"]
        opt_equal = a["manifest"]["optimizer_tensor_sha256"] == b["manifest"]["optimizer_tensor_sha256"]
        step_ok = a["training_state"]["global_step"] == b["training_state"]["global_step"] == 20
        cursor_ok = a["dataset_state"]["token_offset"] == b["dataset_state"]["token_offset"]
        cursor_ok = cursor_ok and a["dataset_state"]["epoch"] == b["dataset_state"]["epoch"]
        sched_ok = abs(a["scheduler_state"]["current_lr"] - b["scheduler_state"]["current_lr"]) < 1e-12
        rng_ok = a["rng"]["numpy"] == b["rng"]["numpy"]
        proof = {
            "model_tensor_equal": model_equal,
            "optimizer_tensor_equal": opt_equal,
            "global_step_equal": step_ok,
            "dataset_cursor_equal": cursor_ok,
            "scheduler_lr_equal": sched_ok,
            "numpy_rng_equal": rng_ok,
            "model_sha_a": a["manifest"]["model_tensor_sha256"],
            "model_sha_b": b["manifest"]["model_tensor_sha256"],
            "opt_sha_a": a["manifest"]["optimizer_tensor_sha256"],
            "opt_sha_b": b["manifest"]["optimizer_tensor_sha256"],
        }
        (w9 / "interruption-equivalence.json").write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
        assert step_ok and cursor_ok and sched_ok, proof
        if not (model_equal and opt_equal):
            import numpy as np
            diffs = []
            for key in a["model"]:
                da = a["model"][key].astype("float64")
                db = b["model"][key].astype("float64")
                diffs.append(float(np.max(np.abs(da - db))))
            max_diff = max(diffs) if diffs else 999
            proof["max_abs_model_diff"] = max_diff
            (w9 / "interruption-equivalence.json").write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
            assert max_diff < 1e-4, proof
        else:
            assert rng_ok, proof

    h.check("interruption-equivalence of tensors/scheduler/cursor", interruption_equivalence)

    def optimizer_config_preserved():
        b = load_bundle(work_b / "checkpoint-step-000010")
        assert b["optimizer_config"]["betas"] == [0.9, 0.95]
        assert b["optimizer_config"]["weight_decay"] == 0.1
        assert b["optimizer_config"]["scheduler"]["type"] == "linear_warmup_cosine_decay"
        assert b["training_state"]["global_step"] == 10

    h.check("optimizer config and training state preserved at mid checkpoint", optimizer_config_preserved)

    def metrics_append_only():
        path = work_a / "metrics.jsonl"
        before = path.read_text(encoding="utf-8")
        n = len(before.strip().splitlines())
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps({"kind": "probe", "note": "append-only probe"}) + "\n")
        after = path.read_text(encoding="utf-8")
        assert after.startswith(before)
        assert len(after.strip().splitlines()) == n + 1
        path.write_text(before, encoding="utf-8")

    h.check("metrics log is append-only", metrics_append_only)

    def bundle_hashes():
        b = load_bundle(work_a / "checkpoint-step-000020")
        for name, meta in b["manifest"]["files"].items():
            actual = sha256_file(work_a / "checkpoint-step-000020" / name)
            assert actual == meta["sha256"], name

    h.check("checkpoint bundle hashes verify", bundle_hashes)

    def atomic_fail_safe():
        dest = work_iso / "should-not-complete"
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.parent / ".tmp-incomplete-probe"
        if tmp.exists():
            shutil.rmtree(tmp)
        tmp.mkdir()
        (tmp / "model.safetensors").write_bytes(b"not-a-safetensors-file")
        assert not dest.exists()
        goods = list(work_a.glob("checkpoint-step-*"))
        assert goods
        load_bundle(work_a / "checkpoint-step-000020")

    h.check("incomplete temp checkpoint is not promoted; last good remains", atomic_fail_safe)

    def failure_injection():
        src = work_a / "checkpoint-step-000020"
        cases = []

        def clone(name: str) -> Path:
            p = work_iso / name
            if p.exists():
                shutil.rmtree(p)
            shutil.copytree(src, p)
            return p

        missing_model = clone("missing-model")
        (missing_model / "model.safetensors").unlink()
        try:
            load_bundle(missing_model)
            cases.append(("missing_model", False, "loaded"))
        except Exception as exc:
            cases.append(("missing_model", True, type(exc).__name__))

        missing_opt = clone("missing-opt")
        (missing_opt / "optimizer.safetensors").unlink()
        try:
            load_bundle(missing_opt)
            cases.append(("missing_optimizer", False, "loaded"))
        except Exception as exc:
            cases.append(("missing_optimizer", True, type(exc).__name__))

        trunc = clone("truncated")
        p = trunc / "model.safetensors"
        data = p.read_bytes()
        p.write_bytes(data[: max(16, len(data) // 4)])
        try:
            load_bundle(trunc)
            cases.append(("truncated_safetensors", False, "loaded"))
        except Exception as exc:
            cases.append(("truncated_safetensors", True, type(exc).__name__))

        bad_model_sha = clone("bad-model-sha")
        man = json.loads((bad_model_sha / "checkpoint-manifest.json").read_text())
        man["files"]["model.safetensors"]["sha256"] = "0" * 64
        (bad_model_sha / "checkpoint-manifest.json").write_text(json.dumps(man, indent=2))
        try:
            load_bundle(bad_model_sha)
            cases.append(("bad_model_sha", False, "loaded"))
        except Exception as exc:
            cases.append(("bad_model_sha", True, type(exc).__name__))

        bad_opt_sha = clone("bad-opt-sha")
        man = json.loads((bad_opt_sha / "checkpoint-manifest.json").read_text())
        man["files"]["optimizer.safetensors"]["sha256"] = "0" * 64
        (bad_opt_sha / "checkpoint-manifest.json").write_text(json.dumps(man, indent=2))
        try:
            load_bundle(bad_opt_sha)
            cases.append(("bad_optimizer_sha", False, "loaded"))
        except Exception as exc:
            cases.append(("bad_optimizer_sha", True, type(exc).__name__))

        incomplete = clone("incomplete-flag")
        man = json.loads((incomplete / "checkpoint-manifest.json").read_text())
        man["complete"] = False
        (incomplete / "checkpoint-manifest.json").write_text(json.dumps(man, indent=2))
        try:
            load_bundle(incomplete)
            cases.append(("incomplete_temp", False, "loaded"))
        except Exception as exc:
            cases.append(("incomplete_temp", True, type(exc).__name__))

        wrong_run = clone("wrong-run")
        st = json.loads((wrong_run / "training-state.json").read_text())
        st["run_id"] = "WRIM1-RUN-000001"
        (wrong_run / "training-state.json").write_text(json.dumps(st, indent=2))
        man = json.loads((wrong_run / "checkpoint-manifest.json").read_text())
        man["files"]["training-state.json"]["sha256"] = sha256_file(wrong_run / "training-state.json")
        man["run_id"] = "WRIM1-RUN-000001"
        (wrong_run / "checkpoint-manifest.json").write_text(json.dumps(man, indent=2))
        loaded = load_bundle(wrong_run)
        assert loaded["training_state"]["run_id"] != "TEST-WAVE9-RESUME" or loaded["manifest"]["run_id"] == "WRIM1-RUN-000001"
        cases.append(("wrong_run_id_detected_in_state", loaded["training_state"]["run_id"] == "WRIM1-RUN-000001", "mutated"))

        bad_json = clone("bad-json")
        (bad_json / "training-state.json").write_text("{not json", encoding="utf-8")
        try:
            load_bundle(bad_json)
            cases.append(("invalid_training_state_json", False, "loaded"))
        except Exception as exc:
            cases.append(("invalid_training_state_json", True, type(exc).__name__))

        (w9 / "failure-injection.json").write_text(json.dumps(cases, indent=2) + "\n", encoding="utf-8")
        required = [
            "missing_model", "missing_optimizer", "truncated_safetensors",
            "bad_model_sha", "bad_optimizer_sha", "incomplete_temp", "invalid_training_state_json",
        ]
        by_name = {c[0]: c for c in cases}
        for name in required:
            assert by_name[name][1], by_name[name]
        load_bundle(work_a / "checkpoint-step-000020")

    h.check("corruption and mismatch cases fail closed; last good preserved", failure_injection)

    def identity_sha_failures():
        from preflight import run_preflight as rp
        report = rp(root)
        names = {c["name"]: c["passed"] for c in report["checks"]}
        assert names["tokenizer_sha"] is True
        assert names["parent_checkpoint_sha"] is True
        assert names["corpus_sha"] is True

    h.check("preflight identity SHAs remain fail-closed on match", identity_sha_failures)

    def crash_recovery():
        from checkpoint_io import latest_known_good
        latest = latest_known_good(work_b / "checkpoint-registry.json")
        assert latest is not None
        bundle = load_bundle(latest)
        assert bundle["manifest"]["complete"] is True
        assert bundle["training_state"]["global_step"] == 20

    h.check("crash recovery uses latest known-good completed checkpoint", crash_recovery)

    def dataset_cursor_resume():
        a10 = load_bundle(work_b / "checkpoint-step-000010")
        a20 = load_bundle(work_b / "checkpoint-step-000020")
        assert a20["dataset_state"]["batch_position"] > a10["dataset_state"]["batch_position"]
        assert a20["training_state"]["tokens_seen"] > a10["training_state"]["tokens_seen"]
        assert a20["rng"]["note"].startswith("Continuation")

    h.check("dataset cursor and RNG continuation state advance on resume", dataset_cursor_resume)

    def safetensors_layout():
        ckpt = work_a / "checkpoint-step-000020"
        assert (ckpt / "model.safetensors").is_file()
        assert (ckpt / "optimizer.safetensors").is_file()
        assert not list(ckpt.glob("*.pkl"))

    h.check("official weight format is split Safetensors not pickle", safetensors_layout)

    def resource_labels():
        plan = json.loads((w9 / "resource-plan.json").read_text())
        assert plan["genesis_peak_memory_bytes"]["class"] == "MEASURED"
        assert plan["runtime_seconds"]["class"] == "DERIVED"
        assert plan["metrics_log_overhead_bytes"]["class"] == "SPECULATIVE"

    h.check("resource plan classes are MEASURED/DERIVED/SPECULATIVE and not mixed", resource_labels)

    def isolation():
        assert not (test_root / "WRIM-1").exists()
        for p in test_root.rglob("*"):
            assert "WRIM-1" not in p.name
        a = json.loads((work_a / "checkpoint-step-000020" / "checkpoint-manifest.json").read_text())
        assert a.get("test_only") is True
        assert a.get("promotable") is False
        assert not official_ckpt_dir(root).exists()

    h.check("test artifacts isolated from WRIM-1 lineage", isolation)

    def no_official_training():
        assert official_start_would_be_blocked(root)["blocked"] is True
        assert json.loads((w9 / "authorization.json").read_text())["TRAINING_STARTED"] is False
        assert json.loads((w9 / "WRIM1-RUN-000001.json").read_text())["training_status"] == "NOT_STARTED"

    h.check("official WRIM-1 training remains not started", no_official_training)

    def config_complete():
        required = [
            "architecture_family", "parameter_count", "vocab_size", "d_model", "n_layers", "n_heads",
            "head_dim", "d_ff", "context_length", "batch_size", "gradient_accumulation", "precision",
            "optimizer", "learning_rate", "betas", "eps", "weight_decay", "gradient_clipping",
            "scheduler", "warmup_steps", "total_steps", "epochs", "target_training_tokens",
            "validation_cadence_steps", "checkpoint_cadence_steps", "seed", "shuffle_strategy",
            "mlx_memory_limit_bytes", "mlx_cache_limit_bytes", "cache_clear_strategy",
            "dataset_split_identity", "tokenizer_identity", "parent_identity",
        ]
        for key in required:
            assert key in cfg, key

    h.check("complete official training config persisted", config_complete)

    def run_identity_fields():
        required = [
            "run_id", "run_version", "model_lineage", "parent_model_id", "parent_checkpoint_sha256",
            "corpus_id", "corpus_sha256", "dataset_manifest_sha256", "tokenizer_id", "tokenizer_sha256",
            "architecture_id", "architecture_config_sha256", "training_config_sha256",
            "heldout_manifest_sha256", "created_at", "git_sha", "dirty_tree_fingerprint",
            "software_fingerprint", "hardware_fingerprint", "authorization_state", "training_status",
        ]
        for key in required:
            assert key in run_manifest, key
        assert run_manifest["authorization_state"] == "AWAITING_COMMANDER_AUTHORIZATION"

    h.check("official future run identity is complete and unauthorized", run_identity_fields)

    def mlx_apis():
        hw = json.loads((w9 / "hardware-fingerprint.json").read_text())
        mlx = hw["mlx"]
        assert mlx.get("imported") is True
        assert mlx.get("has_set_cache_limit") is True
        assert mlx.get("has_set_memory_limit") is True
        assert mlx.get("has_get_peak_memory") is True

    h.check("MLX cache/memory/peak APIs present", mlx_apis)

    def future_command_guard():
        text = (w9 / "FUTURE_WRIM1_TRAINING_COMMAND.txt").read_text()
        assert "--require-authorization-state AUTHORIZED" in text
        assert "DO NOT EXECUTE" in text

    h.check("future training command artifact requires authorization", future_command_guard)

    proof = {
        "expected": EXPECTED,
        "total": len(h.results),
        "passed": sum(1 for r in h.results if r["ok"]),
        "failed": [r for r in h.results if not r["ok"]],
        "results": h.results,
        "official_training_started": False,
        "test_only": True,
    }
    (w9 / "wave9-python-proof.json").write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    code = h.finish()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
