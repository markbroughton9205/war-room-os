#!/usr/bin/env python3
"""Record development-only shadow observations. Does not change routing. Reuses observer fields."""
from __future__ import annotations

import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR.parent / "sovereign-model-lab"))
sys.path.insert(0, str(SCRIPT_DIR))

from exp004_support import load_jsonl  # noqa: E402
from frozen_core import load_frozen_wrim0, max_abs_diff, numpy_params  # noqa: E402
from frozen_router_support import utcnow, write_json  # noqa: E402
from hashes import sha256_file  # noqa: E402
from paths import (  # noqa: E402
    FROZEN_ROUTER_EVAL6_DIR,
    FROZEN_ROUTER_SHADOW_DIR,
    FROZEN_ROUTER_SHADOW_ID,
    PRODUCTION_ROOT,
    TOOL_EVAL_6_DIR,
    WRIM0_CHECKPOINT_SHA256,
    WRIM0_ID,
    WRIM0_WEIGHTS,
)
from shadow_frozen_router_infer import infer_texts  # noqa: E402


def class_from_router_raw(raw: str) -> str:
    """Map compact TOOL= observations without executing. Shadow never overrides this."""
    low = raw.strip().splitlines()[0].strip().lower() if raw.strip() else ""
    if low.startswith("tool="):
        name = low.split("=", 1)[1].strip()
        return {
            "none": "NO_TOOL",
            "web": "WEB",
            "memory": "MEMORY",
            "files": "FILES",
            "research": "RESEARCH",
            "sha256": "SHA256",
        }.get(name, "NO_TOOL")
    return "UNKNOWN"


def main() -> int:
    work = FROZEN_ROUTER_SHADOW_DIR
    work.mkdir(parents=True, exist_ok=True)
    test = load_jsonl(TOOL_EVAL_6_DIR / "test.jsonl")
    core = load_frozen_wrim0()
    snap0 = numpy_params(core.model)
    before = core.weight_tree_hash()
    preds = infer_texts([r["input"] for r in test])
    peak = max_abs_diff(snap0, numpy_params(core.model))
    after = core.weight_tree_hash()
    rows = []
    agree = 0
    for rec, pred in zip(test, preds):
        current = rec["semantic_class"]
        match = pred["predicted_class"] == current
        agree += int(match)
        rows.append(
            {
                "request_text": rec["input"],
                "current_route": current,
                "frozen_router_predicted_route": pred["predicted_class"],
                "confidence": pred["probability"],
                "top2_margin": pred["margin"],
                "matches_observed": match,
                "alters_routing": False,
                "source": "EVAL-6-test-offline-shadow",
                "example_id": rec["example_id"],
            }
        )
    compact_fixtures = [
        "TOOL=none",
        "TOOL=web\nquery=harbor tide",
        "TOOL=sha256\ntext=quiet-room-7",
    ]
    compact_preds = infer_texts(compact_fixtures)
    compact_rows = []
    for raw, pred in zip(compact_fixtures, compact_preds):
        current = class_from_router_raw(raw)
        compact_rows.append(
            {
                "request_text": raw,
                "current_route": current,
                "frozen_router_predicted_route": pred["predicted_class"],
                "confidence": pred["probability"],
                "top2_margin": pred["margin"],
                "matches_observed": pred["predicted_class"] == current,
                "alters_routing": False,
                "source": "compact-TOOL-fixture-shadow",
            }
        )
    acc = agree / len(rows) if rows else 0.0
    eval6_wrim = json.loads((FROZEN_ROUTER_EVAL6_DIR / "wrim-results.json").read_text())
    offline_acc = eval6_wrim["test"]["accuracy"]
    supports = abs(acc - offline_acc) <= 1e-9
    conc_path = FROZEN_ROUTER_EVAL6_DIR / "scientific-conclusion.json"
    if conc_path.is_file():
        conc = json.loads(conc_path.read_text())
        conc["promotion_gates"]["8_shadow_supports_offline"] = supports
        conc["promotion_review_ready"] = all(conc["promotion_gates"].values())
        write_json(conc_path, conc)
    path = work / "observations.jsonl"
    path.write_text("".join(json.dumps(r, sort_keys=True) + "\n" for r in rows + compact_rows), encoding="utf-8")
    write_json(
        work / "core-immutability-proof.json",
        {
            "core_tree_sha_before": before,
            "core_tree_sha_after": after,
            "max_abs_diff": peak,
            "file_sha": sha256_file(WRIM0_WEIGHTS),
            "wrim_training_performed": False,
            "lora_training_performed": False,
        },
    )
    write_json(
        work / "manifest.json",
        {
            "identity": FROZEN_ROUTER_SHADOW_ID,
            "created_at": utcnow(),
            "n_eval6_test_observations": len(rows),
            "n_compact_fixtures": len(compact_rows),
            "shadow_agreement_accuracy": acc,
            "offline_eval6_accuracy": offline_acc,
            "shadow_supports_offline": supports,
            "alters_routing": False,
            "production_untouched": str(PRODUCTION_ROOT),
            "active_core": WRIM0_ID,
            "active_modules": [],
            "feature_flag": "WR_TOOL_FROZEN_ROUTER_SHADOW",
            "default_off": True,
        },
    )
    print(json.dumps({"n": len(rows), "agreement": acc, "supports_offline": supports, "core_diff": peak}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
