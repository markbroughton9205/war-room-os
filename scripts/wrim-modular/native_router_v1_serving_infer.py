#!/usr/bin/env python3
"""Native Router V1 serving infer for the controlled single-tool pilot.

Uses the frozen CANDIDATE (det + information-state + lexical + schema + abstention).
Does not load WRIM. Does not train WRIM or LoRA. Does not execute tools.
Does not modify native_router_v1.py.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR))

import numpy as np  # noqa: E402

from hashes import sha256_file  # noqa: E402
from native_router_v1 import NativeRouterV1, parse_tool_registry_cards  # noqa: E402
from paths import (  # noqa: E402
    NATIVE_ROUTER_V1_DIR,
    NATIVE_ROUTER_V1_EXPECTED_LEXICAL_HASH,
    NATIVE_ROUTER_V1_ID,
)

CONFIDENT_ABSTAIN = {"ROUTE_CONFIDENT", "NO_TOOL_CONFIDENT"}
SIX = ("NO_TOOL", "WEB", "MEMORY", "FILES", "RESEARCH", "SHA256")
PATH_RE = re.compile(r"(docs/[^\s]+|lib/[^\s]+|scripts/[^\s]+|\S+\.(?:md|json|ts|py))", re.I)
QUOTE_RE = re.compile(r"['\"]([^'\"]{1,2048})['\"]")


def load_frozen_bow(path: Path) -> dict:
    z = np.load(path, allow_pickle=True)
    keys = [str(k) for k in z["vocab"].tolist()]
    vocab = {k: i for i, k in enumerate(keys)}
    return {"vocab": vocab, "weights": z["weights"], "hash": sha256_file(path), "type": "v5_style_l2_bow_ova"}


def suggested_compact(predicted: str, text: str) -> str | None:
    t = text.strip()[:2048]
    if predicted == "NO_TOOL":
        return "TOOL=none"
    if predicted == "WEB":
        return f"TOOL=web\nquery={t}" if len(t) >= 4 else None
    if predicted == "MEMORY":
        return f"TOOL=memory\nquery={t}" if len(t) >= 4 else None
    if predicted == "RESEARCH":
        return f"TOOL=research\nquery={t}" if len(t) >= 4 else None
    if predicted == "FILES":
        m = PATH_RE.search(text)
        return f"TOOL=files\npath={m.group(1)}" if m else None
    if predicted == "SHA256":
        m = QUOTE_RE.search(text)
        if not m:
            return None
        return f"TOOL=sha256\ntext={m.group(1)}"
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", action="append", dest="texts")
    args = parser.parse_args()
    texts = list(args.texts or [])
    if not texts:
        print(json.dumps({"error": "no_text"}))
        return 2
    bow_path = NATIVE_ROUTER_V1_DIR / "lexical-bow.npz"
    lex_hash = sha256_file(bow_path)
    if lex_hash != NATIVE_ROUTER_V1_EXPECTED_LEXICAL_HASH:
        print(json.dumps({"error": "lexical_hash_mismatch", "got": lex_hash}))
        return 3
    bow = load_frozen_bow(bow_path)
    router = NativeRouterV1(cards=parse_tool_registry_cards(), bow=bow)
    d = router.score(texts[0], mode="full", wrim_proba=None)
    predicted = str(d["predicted_class"])
    compact = suggested_compact(predicted, texts[0])
    schema = d.get("schema") or {}
    multi = d.get("multi_tool") or {}
    stage = str(d.get("decision_stage") or "")
    print(
        json.dumps(
            {
                "artifact": NATIVE_ROUTER_V1_ID,
                "predicted_class": predicted,
                "tool_id": d.get("tool_id"),
                "gate": d["gate"],
                "information_state": d["information_state"],
                "deterministic": d["components"]["deterministic"],
                "lexical": d["components"]["lexical"],
                "wrim": None,
                "wrim_in_serving": False,
                "confidence": d["confidence"],
                "margin": d["margin"],
                "abstain_state": d["abstain_state"],
                "disagreement": d["disagreement"],
                "decision_stage": stage,
                "lexical_fallback_used": "lexical" in stage or stage.startswith("family_then_lexical"),
                "deterministic_rule_match": bool(d["components"]["deterministic"]),
                "schema_ok": bool(schema.get("ok")),
                "schema_reason": schema.get("reason"),
                "multi_tool_required": bool(multi.get("multi_tool_required")),
                "multi_tool_families": multi.get("candidate_families") or [],
                "suggested_compact": compact,
                "serving_mode": "full_skip_wrim",
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
