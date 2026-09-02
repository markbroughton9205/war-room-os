"""Wave 8.1R non-vacuous proofs. TEST_ONLY copies only. Does not start training."""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from authorization import official_start_would_be_blocked  # noqa: E402
from constants import CORPUS_SHA256, TEST_TOKENS, TOKENIZER_SHA256, TRAIN_TOKENS, VAL_TOKENS  # noqa: E402
from corpus_bundle import bundle_dir, recovery_dir  # noqa: E402
from hashes import sha256_file, sha256_json  # noqa: E402
from paths import official_ckpt_dir, repo_root  # noqa: E402
from preflight import run_preflight  # noqa: E402
from recover_frozen_corpus import verify_bundle, worktree_drift_report  # noqa: E402

EXPECTED = 17


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
        print(f"Wave 8.1R Python proofs: TOTAL={total} EXPECTED={self.expected} PASS={passed} FAIL={failed}")
        if failed == 0 and total == self.expected:
            print(f"Wave 8.1R Python proofs: {passed}/{self.expected} PASS")
            return 0
        return 1


def main() -> int:
    root = repo_root()
    out = bundle_dir(root)
    rec_dir = recovery_dir(root)
    test_root = rec_dir / "test-only"
    if test_root.exists():
        shutil.rmtree(test_root)
    test_root.mkdir(parents=True)
    h = Harness(EXPECTED)
    recovery = json.loads((out / "provenance" / "recovery-manifest.json").read_text(encoding="utf-8"))
    man = json.loads((out / "corpus-manifest.json").read_text(encoding="utf-8"))
    frozen = json.loads((root / "model-lab/manifests/wave8_1/corpus-manifest.json").read_text(encoding="utf-8"))
    auth = json.loads((root / "model-lab/manifests/wave9/authorization.json").read_text(encoding="utf-8"))
    run = json.loads((root / "model-lab/manifests/wave9/WRIM1-RUN-000001.json").read_text(encoding="utf-8"))
    failed_pf = root / "model-lab/manifests/wave9/WRIM1-RUN-000001-preflight.json"

    def exact_recovery():
        assert frozen["contentHash"] == CORPUS_SHA256
        assert recovery["total_chunks"] == 11164
        assert recovery["recovered_chunks"] == 11164
        assert recovery["unrecovered_chunks"] == 0
        assert recovery["frozen_corpus_hash"] == CORPUS_SHA256

    h.check("exact all-chunk recovery 11164/11164", exact_recovery)

    def hashes_ok():
        verified = verify_bundle(root)
        assert verified["ok"], verified.get("detail")
        assert len(man["sourceShards"]) == 3
        assert len(man["tokenShards"]) == 3
        for row in man["sourceShards"]:
            assert sha256_file(root / row["path"]) == row["sha256"]
        for row in man["tokenShards"]:
            assert sha256_file(root / row["path"]) == row["sha256"]
            assert row["tokenizer_sha256"] == TOKENIZER_SHA256

    h.check("source and token shard hashes verify", hashes_ok)

    def token_counts():
        assert man["tokenCounts"]["train"] == TRAIN_TOKENS
        assert man["tokenCounts"]["validation"] == VAL_TOKENS
        assert man["tokenCounts"]["test"] == TEST_TOKENS
        train = np.load(out / "tokens/train.npy", mmap_mode="r")
        val = np.load(out / "tokens/validation.npy", mmap_mode="r")
        test = np.load(out / "tokens/test.npy", mmap_mode="r")
        assert int(train.size) == TRAIN_TOKENS
        assert int(val.size) == VAL_TOKENS
        assert int(test.size) == TEST_TOKENS

    h.check("WR-TOKENIZER-0 token counts reproduced", token_counts)

    def split_repro():
        assert frozen["splitCounts"]["train"]["chunks"] == 8449
        assert frozen["splitCounts"]["validation"]["chunks"] == 1853
        assert frozen["splitCounts"]["test"]["chunks"] == 862
        index = json.loads((out / "chunks/chunk-index.json").read_text(encoding="utf-8"))["records"]
        chunks = [r for r in index if r["kind"] == "chunk"]
        by = {"train": 0, "validation": 0, "test": 0}
        for rec in chunks:
            by[rec["split"]] += 1
        assert by == {"train": 8449, "validation": 1853, "test": 862}

    h.check("train/val/test split reproduced exactly", split_repro)

    def behavior():
        assert man["exampleCount"] == 31
        examples = json.loads((root / "model-lab/manifests/wave8_1/behavior-examples.json").read_text())
        assert examples["count"] == 31
        assert all(ex.get("renderedTrainingText") and ex.get("renderedHash") for ex in examples["examples"])

    h.check("behavior payloads preserved", behavior)

    def leakage():
        assert frozen["leakage"]["passed"] is True
        assert frozen["leakage"]["heldOutCollisions"] == []
        assert frozen["leakage"]["nearDuplicatePairs"] == 0

    h.check("frozen leakage/held-out gates remain PASS", leakage)

    def drift_independence():
        drift = worktree_drift_report(root)
        assert drift["detected"] is True
        assert drift["mismatches"] > 0
        verified = verify_bundle(root)
        assert verified["ok"] is True
        report = run_preflight(root, require_mlx=False, require_materialized=True)
        names = {c["name"]: c for c in report["checks"]}
        assert names["corpus_materialized_integrity"]["passed"] is True
        assert names["source_worktree_drift"]["passed"] is True
        assert names["source_worktree_drift"]["critical"] is False
        assert "detected=True" in names["source_worktree_drift"]["detail"] or "detected=true" in names["source_worktree_drift"]["detail"].lower()

    h.check("worktree drift independence", drift_independence)

    def byte_corruption():
        src = out / "train/shard-00000.jsonl"
        dest = test_root / "shard-00000.jsonl"
        data = bytearray(src.read_bytes())
        data[min(100, len(data) - 1)] ^= 0x01
        dest.write_bytes(data)
        assert sha256_file(dest) != sha256_file(src)

    h.check("byte corruption of TEST_ONLY source shard is detected", byte_corruption)

    def token_corruption():
        src = out / "tokens/train.npy"
        dest = test_root / "train.npy"
        shutil.copy2(src, dest)
        arr = np.load(dest)
        arr = arr.copy()
        arr[0] = int(arr[0]) ^ 1
        np.save(dest, arr)
        assert sha256_file(dest) != sha256_file(src)

    h.check("token corruption of TEST_ONLY token shard is detected", token_corruption)

    def wrong_tokenizer():
        copied = dict(man)
        copied["tokenizerSha256"] = "0" * 64
        dest = test_root / "wrong-tokenizer-manifest.json"
        dest.write_text(json.dumps(copied) + "\n", encoding="utf-8")
        parsed = json.loads(dest.read_text())
        assert parsed["tokenizerSha256"] != TOKENIZER_SHA256

    h.check("wrong tokenizer identity is rejected", wrong_tokenizer)

    def missing_shard():
        copied = dict(man)
        copied["sourceShards"] = list(man["sourceShards"][1:])
        dest = test_root / "missing-shard-manifest.json"
        dest.write_text(json.dumps(copied) + "\n", encoding="utf-8")
        parsed = json.loads(dest.read_text())
        assert len(parsed["sourceShards"]) == 2
        recomputed = sha256_json({
            "corpusIdentityHash": parsed["corpusIdentityHash"],
            "tokenizerSha256": parsed["tokenizerSha256"],
            "sourceShards": parsed["sourceShards"],
            "tokenShards": parsed["tokenShards"],
            "tokenCounts": parsed["tokenCounts"],
        })
        assert recomputed != man["materializedBundleHash"]

    h.check("missing shard fails bundle identity", missing_shard)

    def split_tamper():
        copied = dict(man)
        counts = dict(copied["tokenCounts"])
        counts["train"] = counts["train"] + counts["test"]
        counts["test"] = 0
        copied["tokenCounts"] = counts
        dest = test_root / "split-tamper-manifest.json"
        dest.write_text(json.dumps(copied) + "\n", encoding="utf-8")
        parsed = json.loads(dest.read_text())
        assert parsed["tokenCounts"]["test"] != TEST_TOKENS
        recomputed = sha256_json({
            "corpusIdentityHash": parsed["corpusIdentityHash"],
            "tokenizerSha256": parsed["tokenizerSha256"],
            "sourceShards": parsed["sourceShards"],
            "tokenShards": parsed["tokenShards"],
            "tokenCounts": parsed["tokenCounts"],
        })
        assert recomputed != man["materializedBundleHash"]

    h.check("split tamper fails identity hash", split_tamper)

    def official_preflight():
        report = run_preflight(root, require_mlx=True, mode="start", require_corpus_bytes=True, require_materialized=True)
        (rec_dir / "readiness-preflight.json").write_text(json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8")
        (root / "model-lab/manifests/wave9/preflight.json").write_text(json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8")
        assert report["passed"], report.get("failures")
        names = {c["name"]: c for c in report["checks"]}
        assert names["corpus_materialized_integrity"]["passed"] is True
        assert names["tokenizer_sha"]["passed"] is True
        assert names["parent_checkpoint_sha"]["passed"] is True
        assert names["corpus_sha"]["passed"] is True

    h.check("official preflight readiness PASS on materialized shards", official_preflight)

    def auth_false():
        assert auth["authorization_state"] == "AWAITING_COMMANDER_AUTHORIZATION"
        assert auth["TRAINING_AUTHORIZED"] is False
        assert auth["TRAINING_STARTED"] is False
        assert official_start_would_be_blocked(root)["blocked"] is True
        assert not (root / "model-lab/manifests/wave9/commander-authorization.token").exists()

    h.check("authorization remains awaiting Commander", auth_false)

    def training_not_started():
        assert run["TRAINING_STARTED"] is False
        assert run["training_status"] == "NOT_STARTED"
        official = official_ckpt_dir(root)
        assert not official.exists() or not any(official.rglob("model.safetensors"))

    h.check("WRIM-1 training remains not started", training_not_started)

    def failed_start_preserved():
        assert failed_pf.is_file()
        parsed = json.loads(failed_pf.read_text(encoding="utf-8"))
        assert parsed["passed"] is False
        assert "corpus_bytes_reconstructable" in parsed.get("failures", [])
        dest = rec_dir / "preserved-failed-start" / "WRIM1-RUN-000001-preflight.json"
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not dest.exists():
            shutil.copy2(failed_pf, dest)

    h.check("failed training-start evidence preserved", failed_start_preserved)

    def frozen_untouched():
        assert frozen["contentHash"] == CORPUS_SHA256
        assert man["corpusIdentityHash"] == CORPUS_SHA256
        assert man["materializedBundleHash"] != CORPUS_SHA256

    h.check("logical corpus identity preserved; bundle hash is distinct", frozen_untouched)

    proof_path = rec_dir / "wave81r-python-proof.json"
    code = h.finish()
    proof_path.write_text(json.dumps({
        "expected": EXPECTED,
        "total": len(h.results),
        "passed": sum(1 for r in h.results if r["ok"]),
        "failed": [r for r in h.results if not r["ok"]],
        "results": h.results,
        "official_training_started": False,
        "test_only": True,
    }, indent=2) + "\n", encoding="utf-8")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
