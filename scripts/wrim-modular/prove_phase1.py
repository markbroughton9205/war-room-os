#!/usr/bin/env python3
"""Phase 1 modular intelligence Python proofs. Does not train WR-Tool. Does not promote."""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from paths import (  # noqa: E402
    PRODUCTION_ROOT,
    RECOVERY_010_DIR,
    ROOT,
    TEST_ONLY_ROOT,
    TOKENIZER_SHA256,
    WRIM0_CHECKPOINT_SHA256,
    WRIM0_ID,
    WRIM0_WEIGHTS,
)
from frozen_core import (  # noqa: E402
    load_frozen_wrim0,
    load_test_only_comparison_core,
    max_abs_diff,
)
from capability_module import (  # noqa: E402
    CompatibilityError,
    DummyClassifierHead,
    make_dummy_manifest,
)
from trainable_selection import partition_parameters, synthetic_isolated_step  # noqa: E402
from lora_feasibility import feasibility_report  # noqa: E402
from active_runtime import (  # noqa: E402
    attach_module_to_runtime,
    composed_runtime_id,
    default_active_runtime,
    detach_module_from_runtime,
)
from tool_intent import parse_compact_intent  # noqa: E402

EXPECTED = 22


class Harness:
    def __init__(self, expected: int):
        self.expected = expected
        self.results: list[dict] = []

    def check(self, name: str, fn) -> None:
        try:
            fn()
            self.results.append({"name": name, "ok": True})
            print(f"PASS {name}")
        except Exception as exc:  # noqa: BLE001
            self.results.append({"name": name, "ok": False, "detail": str(exc)})
            print(f"FAIL {name}: {exc}")

    def finish(self, extra: dict | None = None) -> int:
        passed = sum(1 for r in self.results if r["ok"])
        failed = [r for r in self.results if not r["ok"]]
        print(
            f"Phase 1 Python proofs: TOTAL={len(self.results)} EXPECTED={self.expected} "
            f"PASS={passed} FAIL={len(failed)}"
        )
        payload = {
            "expected": self.expected,
            "total": len(self.results),
            "passed": passed,
            "failed": failed,
            "results": self.results,
            "test_only": True,
            "official_training_started": False,
            **(extra or {}),
        }
        TEST_ONLY_ROOT.mkdir(parents=True, exist_ok=True)
        (TEST_ONLY_ROOT / "phase1-python-proof.json").write_text(
            json.dumps(payload, indent=2) + "\n", encoding="utf-8"
        )
        if failed or len(self.results) != self.expected:
            return 1
        print(f"Phase 1 Python proofs: {passed}/{self.expected} PASS")
        return 0


def main() -> int:
    h = Harness(EXPECTED)
    extras: dict = {}

    core = load_frozen_wrim0()
    before_hash = core.weight_tree_hash()
    before_snap = core.snapshot_params()
    proof = core.proof()
    extras["frozen_core_proof"] = proof.__dict__
    extras["weight_tree_sha_before"] = before_hash

    h.check("1 WRIM-0 exact load + file SHA", lambda: (
        (_eq(core.file_sha256, WRIM0_CHECKPOINT_SHA256)),
        (_eq(core.core_id, WRIM0_ID)),
        (_eq(core.lineage_role, "OFFICIAL_FROZEN_CORE")),
        (_eq(WRIM0_WEIGHTS.is_file(), True)),
    ))

    h.check("2 tokenizer SHA", lambda: _eq(core.tokenizer_sha256, TOKENIZER_SHA256))

    h.check("3 frozen-core parameter count", lambda: (
        (_eq(core.core_total_parameters(), 19_217_152)),
        (_eq(proof.core_total_parameters, 19_217_152)),
    ))

    h.check("4 trainable-core parameter count is 0", lambda: (
        (_eq(core.core_trainable_parameters(), 0)),
        (_eq(proof.core_trainable_parameters, 0)),
        (_eq("trainable_parameters()" in proof.freeze_mechanism, True)),
    ))

    dummy = DummyClassifierHead(make_dummy_manifest())
    attached = dummy.attach(core)
    part = partition_parameters(core, dummy)
    extras["parameter_partition"] = {k: part[k] for k in part if not k.endswith("parameters") or "count" in k or "total" in k or "trainable" in k}
    extras["parameter_partition"] = {
        "core_total_parameters": part["core_total_parameters"],
        "core_trainable_count": part["core_trainable_count"],
        "capability_total_parameters": part["capability_total_parameters"],
        "capability_trainable_count": part["capability_trainable_count"],
        "capability_keys": part["capability_parameters"],
    }

    h.check("5 dummy attach + isolated params", lambda: (
        (_eq(part["core_trainable_count"], 0)),
        (_gt(part["capability_trainable_count"], 0)),
        (_eq(part["capability_trainable_count"], dummy.manifest.trainable_parameter_count)),
        (_eq(dummy.manifest.module_type, "CLASSIFIER_HEAD")),
    ))

    import mlx.core as mx
    idx = mx.array([[1, 2, 3, 4]], dtype=mx.int32)
    logits, head_out = attached.forward(idx)
    h.check("6 dummy forward uses hidden states", lambda: (
        (_eq(len(logits.shape) >= 2, True)),
        (_eq(int(head_out.shape[-1]), 4)),
    ))

    art_dir = TEST_ONLY_ROOT / "WR-DUMMY-CAP-001"
    if art_dir.exists():
        shutil.rmtree(art_dir)
    dummy.save_artifact(art_dir)
    loaded = DummyClassifierHead.load_artifact(art_dir)
    attached.detach()
    dummy.detach()

    h.check("7 dummy save/load + detach", lambda: (
        (_eq(loaded.manifest.module_id, "WR-DUMMY-CAP-001")),
        (_eq((art_dir / "weights.safetensors").is_file(), True)),
        (_eq((art_dir / "wrim0-weights.safetensors").exists(), False)),
        (_eq(core.weight_tree_hash(), before_hash)),
    ))

    after_hash = core.weight_tree_hash()
    extras["weight_tree_sha_after"] = after_hash
    extras["core_max_abs_diff_after_lifecycle"] = max_abs_diff(before_snap, core.snapshot_params())

    h.check("8 core hash before/after lifecycle identical + max_abs_diff 0", lambda: (
        (_eq(before_hash, after_hash)),
        (_eq(extras["core_max_abs_diff_after_lifecycle"], 0.0)),
    ))

    def _wrong_base():
        bad = DummyClassifierHead(make_dummy_manifest(base_model_id="NOT-WRIM-0", base_checkpoint_sha="0" * 64))
        try:
            bad.attach(core)
        except CompatibilityError as exc:
            if "wrong base" not in str(exc):
                raise
            return
        raise AssertionError("wrong-base module attached")

    h.check("9 wrong-base compatibility rejection", _wrong_base)

    def _wrong_dim():
        bad = DummyClassifierHead(make_dummy_manifest(d_model=128))
        try:
            bad.attach(core)
        except CompatibilityError as exc:
            if "dimension" not in str(exc):
                raise
            return
        raise AssertionError("wrong-dimension module attached")

    h.check("10 wrong-dimension compatibility rejection", _wrong_dim)

    synth = synthetic_isolated_step(core, dummy)
    extras["optimizer_isolation"] = synth
    h.check("11 optimizer isolation synthetic step", lambda: (
        (_eq(synth["core_max_abs_diff"], 0.0)),
        (_eq(synth["core_trainable_parameters"], 0)),
        (_gt(synth["capability_max_abs_diff"], 0.0)),
        (_eq(core.weight_tree_hash(), before_hash)),
    ))

    feas = feasibility_report(core)
    extras["lora_feasibility"] = {
        "custom_lora_required": feas["custom_lora_required"],
        "huggingface_q_proj_exists": feas["huggingface_q_proj_exists"],
        "lora_q_and_v": feas["lora_q_and_v"],
        "lora_qkv_o": feas["lora_qkv_o"],
        "lora_attn_and_swiglu": feas["lora_attn_and_swiglu"],
        "classifier_head": feas["classifier_head"],
        "linear_paths": feas["linear_paths"],
    }
    (TEST_ONLY_ROOT / "lora-feasibility.json").write_text(json.dumps(feas, indent=2) + "\n", encoding="utf-8")

    h.check("12 LoRA counts derived from actual Linear shapes", lambda: (
        (_eq(feas["huggingface_q_proj_exists"], False)),
        (_eq(feas["custom_lora_required"], True)),
        (_eq(feas["lora_q_and_v"]["1"] > 0, True)),
        (_eq(feas["lora_q_and_v"]["2"], feas["lora_q_and_v"]["1"] * 2)),
        (_eq(feas["lora_q_and_v"]["4"], feas["lora_q_and_v"]["1"] * 4)),
        (_eq(feas["lora_q_and_v"]["8"], feas["lora_q_and_v"]["1"] * 8)),
        (_eq(any(p.endswith("attn.q") for p in feas["linear_paths"]), True)),
        (_eq(any(p.endswith("ffn.gate") for p in feas["linear_paths"]), True)),
    ))

    rt = default_active_runtime()
    composed = attach_module_to_runtime(rt, "WR-DUMMY-CAP-001")
    detached = detach_module_from_runtime(composed, "WR-DUMMY-CAP-001")
    extras["composed_runtime"] = composed.to_dict()
    h.check("13 composed-runtime identity is not a merged checkpoint", lambda: (
        (_eq(composed.kind, "COMPOSED_RUNTIME")),
        (_eq(composed.active_core_id, WRIM0_ID)),
        (_eq(composed.active_core_checkpoint_sha, WRIM0_CHECKPOINT_SHA256)),
        (_eq(composed.composed_runtime_id, composed_runtime_id(WRIM0_ID, ["WR-DUMMY-CAP-001"]))),
        (_eq(detached.active_module_ids, [])),
        (_eq("merged" in composed.notes.lower() and "not" in composed.notes.lower(), True)),
    ))

    h.check("14 Recovery-010 TEST_ONLY comparison load without promotion", lambda: _recovery010())

    fixtures = json.loads(
        (ROOT / "model-lab/manifests/modular-intelligence/tool-intent-fixtures.json").read_text(encoding="utf-8")
    )
    parsed_ok = parse_compact_intent("TOOL=sha256\ntext=hello")
    none_ok = parse_compact_intent("TOOL=none")
    malformed = parse_compact_intent("not a tool")

    def _fixtures():
        for case in fixtures["cases"]:
            got = parse_compact_intent(case["raw"])
            if got["parse_status"] != case["expect_parse"]:
                raise AssertionError(f"{case['id']} parse {got['parse_status']} != {case['expect_parse']} {got.get('errors')}")
            if case["expect_parse"] == "PARSED":
                if got["decision"] != case["expect_decision"]:
                    raise AssertionError(case["id"])
                if case.get("expect_tool_id", "absent") != "absent" and got["tool_id"] != case["expect_tool_id"]:
                    raise AssertionError(f"{case['id']} tool_id")
                if "expect_arguments" in case and got["arguments"] != case["expect_arguments"]:
                    raise AssertionError(f"{case['id']} args")

    h.check("15 compact intent fixtures (python parser)", _fixtures)
    h.check("16 valid TOOL parse + NO_TOOL + malformed rejection", lambda: (
        (_eq(parsed_ok["parse_status"], "PARSED")),
        (_eq(parsed_ok["tool_id"], "sha256")),
        (_eq(none_ok["decision"], "NO_TOOL")),
        (_eq(malformed["parse_status"], "MALFORMED")),
        (_eq(malformed["tool_id"], None)),
    ))

    h.check("17 production path not written", lambda: (
        (_eq(str(PRODUCTION_ROOT) in str(art_dir), False)),
        (_eq(art_dir.resolve().is_relative_to(ROOT), True)),
        (_eq(TEST_ONLY_ROOT.resolve().is_relative_to(ROOT), True)),
    ))

    h.check("18 core still frozen after optimizer test", lambda: _eq(core.core_trainable_parameters(), 0))

    h.check("19 dummy artifact excludes core checkpoint bytes", lambda: (
        (_eq((art_dir / "weights.safetensors").stat().st_size < 100_000, True)),
        (_eq(WRIM0_WEIGHTS.stat().st_size > 100_000_000, True)),
    ))

    h.check("20 FrozenWRIMCore inference still returns logits", lambda: _eq(int(core.logits(idx).shape[-1]), 15126))

    h.check("21 no official lineage from dummy module", lambda: (
        (_eq(dummy.manifest.test_only, True)),
        (_eq(dummy.manifest.provenance["not_wr_tool"], True)),
        (_eq(synth["official_lineage"], False)),
    ))

    h.check("22 freeze mechanism is MLX trainable_parameters not a boolean flag", lambda: (
        (_eq(proof.freeze_mechanism.startswith("mlx.nn.Module.freeze"), True)),
        (_eq(hasattr(core, "frozen") and getattr(core, "frozen") is True, False)),
    ))

    return h.finish(extras)


def _recovery010() -> None:
    if not (RECOVERY_010_DIR / "model.safetensors").is_file():
        raise AssertionError("Recovery-010 comparison checkpoint missing")
    cmp_core = load_test_only_comparison_core(RECOVERY_010_DIR)
    if cmp_core.lineage_role != "TEST_ONLY_COMPARISON":
        raise AssertionError(cmp_core.lineage_role)
    if cmp_core.core_id == WRIM0_ID and cmp_core.lineage_role == "OFFICIAL_FROZEN_CORE":
        raise AssertionError("Recovery-010 was treated as official core")
    if cmp_core.file_sha256 == WRIM0_CHECKPOINT_SHA256:
        raise AssertionError("Recovery-010 weights unexpectedly equal WRIM-0 file SHA (different file format expected)")
    if cmp_core.core_trainable_parameters() != 0:
        raise AssertionError("comparison core not frozen")


def _eq(a, b):
    if a != b:
        raise AssertionError(f"{a!r} != {b!r}")
    return True


def _gt(a, b):
    if not (a > b):
        raise AssertionError(f"{a!r} <= {b!r}")
    return True


if __name__ == "__main__":
    raise SystemExit(main())
