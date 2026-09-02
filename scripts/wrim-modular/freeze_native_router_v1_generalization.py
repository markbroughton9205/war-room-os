#!/usr/bin/env python3
"""Snapshot Native Router V1 as a frozen generalization baseline. Does not train or edit rules."""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR))

from hashes import sha256_file, sha256_json  # noqa: E402
from native_router_v1 import (  # noqa: E402
    ABSTAIN_STATES,
    CAPABILITY_FAMILIES,
    EVAL6_TO_FAMILY,
    EVAL6_TO_TOOL_ID,
    FAMILY_TO_EVAL6,
    GATE_STATES,
    INFO_STATES,
    RULE_SPECS,
    STATE_TO_FAMILY,
    parse_tool_registry_cards,
    registry_snapshot_hash,
)
from paths import (  # noqa: E402
    FROZEN_ROUTER_DIR,
    NATIVE_ROUTER_V1_DIR,
    NATIVE_ROUTER_V1_FROZEN_GEN_DIR,
    NATIVE_ROUTER_V1_FROZEN_GEN_ID,
    NATIVE_ROUTER_V1_ID,
    ROOT,
    WRIM0_CHECKPOINT_SHA256,
    WRIM0_WEIGHTS,
)
from frozen_router_support import utcnow, write_json  # noqa: E402

SOURCE_FILES = {
    "native_router_v1.py": SCRIPT_DIR / "native_router_v1.py",
    "native_router_v1_infer.py": SCRIPT_DIR / "native_router_v1_infer.py",
    "run_native_router_v1.py": SCRIPT_DIR / "run_native_router_v1.py",
    "nativeRouterV1Shadow.ts": ROOT / "lib" / "modular-intelligence" / "nativeRouterV1Shadow.ts",
    "nativeRouterV1Gate.ts": ROOT / "lib" / "modular-intelligence" / "nativeRouterV1Gate.ts",
    "nativeRouterV1Shadow.validation.ts": ROOT / "lib" / "modular-intelligence" / "nativeRouterV1Shadow.validation.ts",
    "toolRouter.ts": ROOT / "lib" / "modular-intelligence" / "toolRouter.ts",
    "toolRegistry.ts": ROOT / "lib" / "tools" / "toolRegistry.ts",
    "confidence-policy.json": NATIVE_ROUTER_V1_DIR / "confidence-policy.json",
    "hybrid-policy.json": NATIVE_ROUTER_V1_DIR / "hybrid-policy.json",
    "registry-bindings.json": NATIVE_ROUTER_V1_DIR / "registry-bindings.json",
    "deterministic-rules.json": NATIVE_ROUTER_V1_DIR / "deterministic-rules.json",
    "lexical-bow.npz": NATIVE_ROUTER_V1_DIR / "lexical-bow.npz",
    "wrim0.safetensors": WRIM0_WEIGHTS,
    "frozen-l10-classifier.npz": FROZEN_ROUTER_DIR / "classifier.npz",
}


def main() -> int:
    work = NATIVE_ROUTER_V1_FROZEN_GEN_DIR
    work.mkdir(parents=True, exist_ok=True)
    cards = parse_tool_registry_cards()
    source_hashes = {name: sha256_file(path) for name, path in SOURCE_FILES.items() if path.is_file()}
    missing = [name for name, path in SOURCE_FILES.items() if not path.is_file()]
    rule_hash = sha256_json(RULE_SPECS)
    policy = {
        "information_states": list(INFO_STATES),
        "gate_states": list(GATE_STATES),
        "abstain_states": list(ABSTAIN_STATES),
        "capability_families": list(CAPABILITY_FAMILIES),
        "family_to_eval6": dict(FAMILY_TO_EVAL6),
        "eval6_to_family": dict(EVAL6_TO_FAMILY),
        "eval6_to_tool_id": {k: v for k, v in EVAL6_TO_TOOL_ID.items()},
        "state_to_family": dict(STATE_TO_FAMILY),
        "margin_threshold": 0.12,
        "serving_candidate": [
            "INFORMATION_STATE",
            "DETERMINISTIC_PRE_ROUTER",
            "LEXICAL_FALLBACK",
            "REGISTRY_SCHEMA_VALIDATION",
            "CONFIDENCE_ABSTENTION",
        ],
        "wrim_l10": "TELEMETRY_ONLY",
        "multi_tool": "DIAGNOSTIC_ONLY",
        "lifecycle": "SHADOW",
        "no_online_tuning": True,
    }
    conf_path = NATIVE_ROUTER_V1_DIR / "confidence-policy.json"
    confidence_policy = json.loads(conf_path.read_text(encoding="utf-8"))
    confidence_policy_hash = sha256_json(confidence_policy)
    hybrid_policy = json.loads((NATIVE_ROUTER_V1_DIR / "hybrid-policy.json").read_text(encoding="utf-8"))
    hybrid_policy_hash = sha256_json(hybrid_policy)
    registry_hash = registry_snapshot_hash(cards)
    lexical_hash = source_hashes.get("lexical-bow.npz")
    bow_src = NATIVE_ROUTER_V1_DIR / "lexical-bow.npz"
    if bow_src.is_file():
        shutil.copy2(bow_src, work / "lexical-bow.npz")
    clf_src = FROZEN_ROUTER_DIR / "classifier.npz"
    if clf_src.is_file():
        shutil.copy2(clf_src, work / "frozen-l10-classifier.npz")
    shutil.copy2(SCRIPT_DIR / "native_router_v1.py", work / "native_router_v1.py.snapshot")
    write_json(work / "frozen-rule-set.json", {"count": len(RULE_SPECS), "hash": rule_hash, "rules": RULE_SPECS})
    write_json(work / "frozen-policy.json", policy)
    write_json(work / "frozen-source-hashes.json", source_hashes)
    write_json(
        work / "baseline-manifest.json",
        {
            "identity": NATIVE_ROUTER_V1_FROZEN_GEN_ID,
            "source_candidate": NATIVE_ROUTER_V1_ID,
            "lifecycle": "SHADOW",
            "frozen_at": utcnow(),
            "artifact_hash": None,
            "source_file_hashes": source_hashes,
            "missing_source_files": missing,
            "configuration_hash": sha256_json(policy),
            "rule_hash": rule_hash,
            "lexical_model_hash": lexical_hash,
            "confidence_policy_hash": confidence_policy_hash,
            "hybrid_policy_hash": hybrid_policy_hash,
            "registry_snapshot_hash": registry_hash,
            "registry_binding_hash": registry_hash,
            "wrim0_file_hash": sha256_file(WRIM0_WEIGHTS),
            "wrim0_expected_hash": WRIM0_CHECKPOINT_SHA256,
            "n_deterministic_rules": len(RULE_SPECS),
            "alters_routing": False,
            "feature_flag": "WR_NATIVE_ROUTER_V1_SHADOW",
            "feature_flag_default": "OFF",
            "no_wrim_training": True,
            "no_lora_training": True,
            "no_exp006": True,
            "no_red_x_2": True,
        },
    )
    # Fill artifact hash after all JSON except this field is written: hash the freeze directory file set.
    freeze_files = sorted(p for p in work.iterdir() if p.is_file() and p.name != "baseline-manifest.json")
    blob = "".join(f"{p.name}:{sha256_file(p)}\n" for p in freeze_files)
    artifact_hash = __import__("hashlib").sha256(blob.encode("utf-8")).hexdigest()
    man = json.loads((work / "baseline-manifest.json").read_text(encoding="utf-8"))
    man["artifact_hash"] = artifact_hash
    man["freeze_file_blob"] = blob
    write_json(work / "baseline-manifest.json", man)
    print(json.dumps({"identity": NATIVE_ROUTER_V1_FROZEN_GEN_ID, "artifact_hash": artifact_hash, "rule_hash": rule_hash}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
