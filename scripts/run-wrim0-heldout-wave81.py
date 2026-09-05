#!/usr/bin/env python3
"""Run WRIM-0 (read-only) against Wave 8.1 held-out prompts. Does not train or write checkpoints."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import mlx.core as mx
from tokenizers import Tokenizer, decoders

sys.path.insert(0, str(Path(__file__).resolve().parent / "sovereign-model-lab"))
from wrim0_architecture import WRIM0Config  # noqa: E402
from wrim0_checkpoint import load_checkpoint  # noqa: E402
from generate_wrim0 import generate  # noqa: E402


def main() -> int:
    repo = Path(__file__).resolve().parents[1]
    suite_path = repo / "model-lab/manifests/wave8_1/held-out-eval-suite.json"
    out_path = repo / "model-lab/manifests/wave8_1/wrim0-heldout-run.json"
    ckpt_dir = repo / "model-lab/manifests/wrim0_checkpoints"
    tokenizer_json = repo / "model-lab/manifests/wrim0_tokenizer_v16384/tokenizer.json"
    suite = json.loads(suite_path.read_text(encoding="utf-8"))
    items = suite["items"]
    meta = json.loads((ckpt_dir / "checkpoint-final.json").read_text(encoding="utf-8"))
    config = WRIM0Config(**meta["architectureConfig"])
    model, _opt, sidecar = load_checkpoint(ckpt_dir, "checkpoint-final", config)
    tokenizer = Tokenizer.from_file(str(tokenizer_json))
    if tokenizer.decoder is None:
        tokenizer.decoder = decoders.ByteLevel()
    results = []
    for item in items:
        if item.get("wrim0Support") != "SUPPORTED":
            results.append({
                "evalId": item["evalId"],
                "support": "UNSUPPORTED",
                "output": None,
                "outputSha256": None,
                "note": "unsupported_by_current_wrim0_runtime",
            })
            continue
        text = generate(model, tokenizer, item["input"], 40, temperature=0.0, seed=0)
        results.append({
            "evalId": item["evalId"],
            "support": "SUPPORTED",
            "output": text,
            "outputSha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        })
    payload = {
        "checkpointName": "checkpoint-final",
        "weightsSha256": sidecar["weightsSha256"],
        "trainingStarted": False,
        "results": results,
    }
    out_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"wrote": str(out_path), "supported": sum(1 for row in results if row["support"] == "SUPPORTED")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
