#!/usr/bin/env python3
"""WRIM-0 random-initialization lineage proof (mission Phase 7 — mandatory).

Builds a randomly initialized WRIM-0 model from a seed and an architecture config sized to the
real, verified WR-TOKENIZER-0 vocabulary, writes checkpoint step-0, and writes an explicit lineage
manifest proving no pretrained weights were loaded. This script accepts NO argument that could name
a pretrained weights path — there is no such flag to pass, by construction, not by a runtime check
that could be bypassed. If you are looking for a way to warm-start WRIM-0 from another model's
weights, that is out of scope for this script and for the Genesis mission entirely.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path

import mlx.core as mx
from tokenizers import Tokenizer

from wrim0_architecture import WRIM0Config, build_model
from wrim0_checkpoint import save_checkpoint, sha256_file


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--tokenizer-json", required=True)
    ap.add_argument("--tokenizer-sha256", required=True, help="Expected hash — refuses to proceed on mismatch.")
    ap.add_argument("--corpus-jsonl-sha256", required=True)
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--d-model", type=int, default=256)
    ap.add_argument("--n-layers", type=int, default=18)
    ap.add_argument("--n-heads", type=int, default=4)
    ap.add_argument("--head-dim", type=int, default=64)
    ap.add_argument("--d-ff", type=int, default=768)
    ap.add_argument("--context-length", type=int, default=512)
    ap.add_argument("--output-dir", required=True)
    args = ap.parse_args()

    tokenizer_path = Path(args.tokenizer_json)
    actual_tok_hash = sha256_file(tokenizer_path)
    if actual_tok_hash != args.tokenizer_sha256:
        print(f"FATAL: tokenizer hash mismatch. expected={args.tokenizer_sha256} actual={actual_tok_hash}", file=sys.stderr)
        return 1

    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    vocab_size = tokenizer.get_vocab_size()

    config = WRIM0Config(
        vocab_size=vocab_size,
        d_model=args.d_model,
        n_layers=args.n_layers,
        n_heads=args.n_heads,
        head_dim=args.head_dim,
        d_ff=args.d_ff,
        context_length=args.context_length,
    )

    model, n_params = build_model(config, seed=args.seed)

    out_dir = Path(args.output_dir)
    metadata = {
        "modelId": "WRIM-0",
        "ownership": "war_room_native_artifact",
        "lineage": {
            "initializationAlgorithm": "MLX default per-layer init (nn.Linear: uniform fan-in scaled; nn.Embedding: normal(0, 1)); seeded via mx.random.seed before any parameter is created.",
            "seed": args.seed,
            "noPretrainedWeightsLoaded": True,
            "pretrainedWeightsPathArgument": None,
            "parentCheckpointId": None,
            "tokenizerJsonSha256": actual_tok_hash,
            "corpusJsonlSha256": args.corpus_jsonl_sha256,
        },
        "architectureConfig": config.__dict__,
        "architectureConfigHash": config.config_hash(),
        "parameterCount": n_params,
        "step": 0,
        "tokensSeen": 0,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "host": {
            "machine": platform.machine(),
            "system": platform.system(),
            "pythonVersion": platform.python_version(),
            "mlxVersion": mx.__version__ if hasattr(mx, "__version__") else "unknown",
        },
    }

    sidecar = save_checkpoint(out_dir, "checkpoint-0", model, None, metadata)

    lineage_manifest = {
        **metadata,
        "weightsFile": sidecar["weightsFile"],
        "weightsSha256": sidecar["weightsSha256"],
    }
    lineage_path = out_dir / "lineage-manifest.json"
    with open(lineage_path, "w", encoding="utf-8") as f:
        json.dump(lineage_manifest, f, indent=2)

    print(json.dumps({
        "vocabSize": vocab_size,
        "parameterCount": n_params,
        "configHash": config.config_hash(),
        "weightsSha256": sidecar["weightsSha256"],
        "checkpointDir": str(out_dir),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
