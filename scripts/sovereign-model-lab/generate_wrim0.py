#!/usr/bin/env python3
"""WRIM-0 GENESIS OUTPUT — reload-and-generate proof.

Run as a brand-new process (never imports any state from the training process) to prove the
checkpoint reload path is real: load architecture config from the checkpoint sidecar, verify the
weights-file hash matches before trusting it, rebuild the model, and greedy/temperature-sample
completions from the real trained WR-TOKENIZER-0. This is a calibration-stage smoke model trained
on ~317K tokens for ~2M training tokens seen (see the Genesis report) — outputs are not expected to
be fluent; the point is that the pipeline reloads and runs at all.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import mlx.core as mx
from tokenizers import Tokenizer, decoders

from wrim0_architecture import WRIM0Config
from wrim0_checkpoint import load_checkpoint


def generate(model, tokenizer: Tokenizer, prompt: str, max_new_tokens: int, temperature: float, seed: int) -> str:
    mx.random.seed(seed)
    bos_id = tokenizer.token_to_id("<|bos|>")
    eos_id = tokenizer.token_to_id("<|eos|>")
    ids = [bos_id] + tokenizer.encode(prompt).ids

    cache = model.fresh_cache()
    tokens = mx.array([ids])
    logits, cache = model(tokens, cache=cache)
    generated = list(ids)

    for _ in range(max_new_tokens):
        last_logits = logits[:, -1, :]
        if temperature <= 0:
            next_id = int(mx.argmax(last_logits, axis=-1).item())
        else:
            probs = mx.softmax(last_logits / temperature, axis=-1)
            next_id = int(mx.random.categorical(mx.log(probs)).item())
        generated.append(next_id)
        if next_id == eos_id:
            break
        logits, cache = model(mx.array([[next_id]]), cache=cache)

    return tokenizer.decode(generated, skip_special_tokens=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--checkpoint-dir", required=True)
    ap.add_argument("--checkpoint-name", required=True)
    ap.add_argument("--tokenizer-json", required=True)
    ap.add_argument("--prompt", action="append", required=True)
    ap.add_argument("--max-new-tokens", type=int, default=60)
    ap.add_argument("--temperature", type=float, default=0.8)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    ckpt_dir = Path(args.checkpoint_dir)
    with open(ckpt_dir / f"{args.checkpoint_name}.json", "r", encoding="utf-8") as f:
        meta = json.load(f)
    config = WRIM0Config(**meta["architectureConfig"])
    assert config.config_hash() == meta["architectureConfigHash"], "architecture config hash mismatch"

    model, _opt_state, sidecar = load_checkpoint(ckpt_dir, args.checkpoint_name, config)
    tokenizer = Tokenizer.from_file(args.tokenizer_json)
    if tokenizer.decoder is None:
        # train_wrm001_tokenizer.py sets a ByteLevel pre-tokenizer but never pairs it with a
        # ByteLevel decoder, so raw decode() leaves Ġ/Ċ byte-level markers instead of real
        # whitespace/newlines. Applied here at load time only — does not mutate the saved artifact.
        tokenizer.decoder = decoders.ByteLevel()

    print(f"=== WRIM-0 GENESIS OUTPUT ===")
    print(f"checkpoint: {args.checkpoint_name} (weightsSha256={sidecar['weightsSha256']})")
    print(f"step={meta.get('step')} tokensSeen={meta.get('tokensSeen')} params={meta.get('parameterCount')}")
    print(f"reload verified: weights-file hash matched sidecar record (see wrim0_checkpoint.load_checkpoint)")
    print()

    for i, prompt in enumerate(args.prompt):
        text = generate(model, tokenizer, prompt, args.max_new_tokens, args.temperature, args.seed + i)
        print(f"--- sample {i + 1} ---")
        print(f"prompt: {prompt!r}")
        print(f"output: {text!r}")
        print()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
