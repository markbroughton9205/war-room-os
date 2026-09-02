#!/usr/bin/env python3
"""Development-only frozen-router inference. Never selects tools. No WRIM training."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR.parent / "sovereign-model-lab"))
sys.path.insert(0, str(SCRIPT_DIR))

from exp004_support import CLASS_NAMES  # noqa: E402
from frozen_core import load_frozen_wrim0  # noqa: E402
from frozen_router_support import (  # noqa: E402
    extract_rows,
    load_classifier,
    load_tokenizer_local,
    predict_proba,
)
from paths import FROZEN_ROUTER_DIR, FROZEN_ROUTER_ID  # noqa: E402


def infer_texts(texts: list[str]) -> list[dict]:
    core = load_frozen_wrim0()
    tokenizer = load_tokenizer_local()
    clf = load_classifier(FROZEN_ROUTER_DIR / "classifier.npz")
    x = extract_rows(core.model, tokenizer, [{"input": t} for t in texts])
    proba = predict_proba(clf, x)
    out = []
    for p in proba:
        order = np.argsort(-p)
        top1 = int(order[0])
        top2 = int(order[1])
        out.append(
            {
                "artifact": FROZEN_ROUTER_ID,
                "predicted_class": CLASS_NAMES[top1],
                "predicted_id": top1,
                "probability": float(p[top1]),
                "top2_class": CLASS_NAMES[top2],
                "top2_probability": float(p[top2]),
                "margin": float(p[top1] - p[top2]),
                "entropy": float(-np.sum(np.clip(p, 1e-12, 1) * np.log(np.clip(p, 1e-12, 1)))),
                "proba": {CLASS_NAMES[i]: float(p[i]) for i in range(len(CLASS_NAMES))},
                "alters_routing": False,
            }
        )
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", action="append", dest="texts")
    parser.add_argument("--jsonl")
    args = parser.parse_args()
    texts: list[str] = list(args.texts or [])
    if args.jsonl:
        for line in Path(args.jsonl).read_text(encoding="utf-8").splitlines():
            if line.strip():
                rec = json.loads(line)
                texts.append(rec.get("input") or rec.get("text") or rec.get("request_text"))
    if not texts and not sys.stdin.isatty():
        raw = sys.stdin.read().strip()
        if raw:
            try:
                obj = json.loads(raw)
                if isinstance(obj, dict) and "text" in obj:
                    texts.append(str(obj["text"]))
                elif isinstance(obj, list):
                    texts.extend(str(x) for x in obj)
            except json.JSONDecodeError:
                texts.append(raw)
    if not texts:
        print(json.dumps({"error": "no_text"}))
        return 2
    print(json.dumps(infer_texts(texts), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
