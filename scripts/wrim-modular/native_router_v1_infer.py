#!/usr/bin/env python3
"""Development-only Native Router V1 inference. Never selects tools. No WRIM training."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR.parent / "sovereign-model-lab"))
sys.path.insert(0, str(SCRIPT_DIR))

from exp005_support import load_v5_train  # noqa: E402
from native_router_v1 import NativeRouterV1, fit_bow_v5, parse_tool_registry_cards  # noqa: E402
from paths import NATIVE_ROUTER_V1_ID  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", action="append", dest="texts")
    parser.add_argument("--skip-wrim", action="store_true")
    args = parser.parse_args()
    texts = list(args.texts or [])
    if not texts:
        print(json.dumps({"error": "no_text"}))
        return 2
    train = load_v5_train()
    bow = fit_bow_v5([{"input": r["input"], "gold_class": r["gold_class"]} for r in train])
    router = NativeRouterV1(cards=parse_tool_registry_cards(), bow=bow)
    # Per-request shadow uses skip-wrim so observer latency stays practical.
    d = router.score(texts[0], mode="full", wrim_proba=None)
    print(
        json.dumps(
            {
                "artifact": NATIVE_ROUTER_V1_ID,
                "predicted_class": d["predicted_class"],
                "gate": d["gate"],
                "information_state": d["information_state"],
                "deterministic": d["components"]["deterministic"],
                "lexical": d["components"]["lexical"],
                "wrim": d["components"]["wrim"],
                "confidence": d["confidence"],
                "margin": d["margin"],
                "abstain_state": d["abstain_state"],
                "disagreement": d["disagreement"],
                "alters_routing": False,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
