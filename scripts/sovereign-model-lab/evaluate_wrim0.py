#!/usr/bin/env python3
"""WRIM-0 Genesis evaluation suite (mission Phase 11) — calibration, not a capability claim.

Standard benchmarks (MMLU/GSM8K/ARC/HellaSwag) are near-chance below ~100M parameters per the Kimi
research (dim08) and are not run here. This suite establishes honest baselines for a 19.2M-param,
~2M-training-token model: validation perplexity (already logged by train_wrim0.py), repeated-token
collapse, JSON structural validity, basic arithmetic-format recognition, and OBSERVED/INFERENCE/
UNKNOWN format recognition against WR-TOKENIZER-0's actual special tokens. All prompts and outputs
are logged verbatim (with hashes) so later WRIM generations can be compared on the same fixed set.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

import mlx.core as mx
from tokenizers import Tokenizer, decoders

from wrim0_architecture import WRIM0Config
from wrim0_checkpoint import load_checkpoint
from generate_wrim0 import generate

FIXED_PROMPTS = [
    {"id": "completion_01", "kind": "basic_completion", "prompt": "Alice was beginning to"},
    {"id": "completion_02", "kind": "basic_completion", "prompt": "Mr. Darcy was"},
    {"id": "arithmetic_01", "kind": "arithmetic_probe", "prompt": "2 + 2 ="},
    {"id": "arithmetic_02", "kind": "arithmetic_probe", "prompt": "One plus one equals"},
    {"id": "json_01", "kind": "json_structure_probe", "prompt": "{\"name\":"},
    {"id": "repetition_01", "kind": "repetition_probe", "prompt": "The"},
]


def repeated_token_collapse_score(token_ids: list[int]) -> dict:
    if len(token_ids) < 4:
        return {"collapsed": False, "max_run": 0}
    max_run = 1
    run = 1
    for a, b in zip(token_ids, token_ids[1:]):
        run = run + 1 if a == b else 1
        max_run = max(max_run, run)
    unique_ratio = len(set(token_ids)) / len(token_ids)
    return {"collapsed": max_run >= max(6, len(token_ids) // 3), "max_run": max_run, "unique_token_ratio": round(unique_ratio, 3)}


def is_valid_json_prefix_completion(text: str) -> bool:
    try:
        json.loads(text)
        return True
    except Exception:
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--checkpoint-dir", required=True)
    ap.add_argument("--checkpoint-name", required=True)
    ap.add_argument("--tokenizer-json", required=True)
    ap.add_argument("--output-json", required=True)
    ap.add_argument("--max-new-tokens", type=int, default=40)
    args = ap.parse_args()

    ckpt_dir = Path(args.checkpoint_dir)
    with open(ckpt_dir / f"{args.checkpoint_name}.json", "r", encoding="utf-8") as f:
        meta = json.load(f)
    config = WRIM0Config(**meta["architectureConfig"])
    model, _opt, sidecar = load_checkpoint(ckpt_dir, args.checkpoint_name, config)
    tokenizer = Tokenizer.from_file(args.tokenizer_json)
    if tokenizer.decoder is None:
        tokenizer.decoder = decoders.ByteLevel()

    results = []
    for case in FIXED_PROMPTS:
        text = generate(model, tokenizer, case["prompt"], args.max_new_tokens, temperature=0.0, seed=0)
        ids = tokenizer.encode(text).ids
        entry = {
            **case,
            "output": text,
            "outputSha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        }
        if case["kind"] == "repetition_probe":
            entry["repetitionAnalysis"] = repeated_token_collapse_score(ids)
        if case["kind"] == "json_structure_probe":
            entry["validJson"] = is_valid_json_prefix_completion(case["prompt"] + text)
        results.append(entry)

    # Special-token format recognition: does the model, when prompted right after a role token,
    # produce a plausible continuation rather than immediately emitting <|unk|> or collapsing?
    special_probe_results = []
    for tok in ["<|system|>", "<|commander|>", "<|assistant|>", "<|evidence|>"]:
        text = generate(model, tokenizer, tok, args.max_new_tokens // 2, temperature=0.0, seed=0)
        special_probe_results.append({"specialToken": tok, "continuation": text})

    summary = {
        "checkpointName": args.checkpoint_name,
        "weightsSha256": sidecar["weightsSha256"],
        "step": meta.get("step"),
        "tokensSeen": meta.get("tokensSeen"),
        "parameterCount": meta.get("parameterCount"),
        "fixedPromptResults": results,
        "specialTokenFormatProbe": special_probe_results,
        "honestyNote": "Standard benchmarks (MMLU/GSM8K/ARC/HellaSwag) are not run — near-chance below ~100M params per the Kimi research (dim08). This suite measures pipeline/format behavior, not capability.",
    }

    out_path = Path(args.output_json)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    print(json.dumps({k: v for k, v in summary.items() if k not in ("fixedPromptResults", "specialTokenFormatProbe")}, indent=2))
    for r in results:
        print(f"[{r['kind']}] {r['id']}: prompt={r['prompt']!r} -> output={r['output']!r}")
    for r in special_probe_results:
        print(f"[special_token_probe] {r['specialToken']} -> {r['continuation']!r}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
