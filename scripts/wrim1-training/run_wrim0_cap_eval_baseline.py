#!/usr/bin/env python3
"""Inference-only WRIM-0 baseline on WRIM-1.1-CAP-EVAL-0. Does not train or write weights."""
from __future__ import annotations

import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(SCRIPT_DIR.parent / "sovereign-model-lab"))

from capability_curriculum_lib import EVAL_ID, score_output  # noqa: E402
from checkpoint_io import load_parent_wrim0_weights  # noqa: E402
from constants import PARENT_CHECKPOINT_REL, PARENT_CHECKPOINT_SHA256, TOKENIZER_REL, TOKENIZER_SHA256  # noqa: E402
from hashes import sha256_file  # noqa: E402
from paths import repo_root  # noqa: E402
from trainer_core import build_from_config  # noqa: E402
from training_config import official_training_config  # noqa: E402


def generate(model, tokenizer, prompt: str, max_new_tokens: int) -> dict:
    import mlx.core as mx
    from tokenizers import decoders

    if tokenizer.decoder is None:
        tokenizer.decoder = decoders.ByteLevel()
    mx.random.seed(0)
    bos_id = tokenizer.token_to_id("<|bos|>")
    eos_id = tokenizer.token_to_id("<|eos|>")
    ids = [bos_id] + tokenizer.encode(prompt).ids
    cache = model.fresh_cache()
    logits, cache = model(mx.array([ids]), cache=cache)
    generated = list(ids)
    new_ids = []
    for _ in range(max_new_tokens):
        last = logits[:, -1, :]
        next_id = int(mx.argmax(last, axis=-1).item())
        generated.append(next_id)
        new_ids.append(next_id)
        if next_id == eos_id:
            break
        logits, cache = model(mx.array([[next_id]]), cache=cache)
    continuation = tokenizer.decode(new_ids, skip_special_tokens=True)
    return {"continuation": continuation, "n_new": len(new_ids), "new_ids": new_ids}


def main() -> int:
    from tokenizers import Tokenizer, decoders

    root = repo_root()
    suite_path = root / "model-lab/eval-only" / EVAL_ID / "suite.json"
    if not suite_path.exists():
        print(json.dumps({"error": "eval suite missing; materialize first"}))
        return 2
    suite = json.loads(suite_path.read_text(encoding="utf-8"))
    tok_path = root / TOKENIZER_REL
    ckpt = root / PARENT_CHECKPOINT_REL
    before = sha256_file(ckpt)
    if sha256_file(tok_path) != TOKENIZER_SHA256 or before != PARENT_CHECKPOINT_SHA256:
        print(json.dumps({"error": "tokenizer or parent hash mismatch"}))
        return 2

    tokenizer = Tokenizer.from_file(str(tok_path))
    if tokenizer.decoder is None:
        tokenizer.decoder = decoders.ByteLevel()
    cfg = official_training_config()
    model, _arch, nparams = build_from_config(cfg, int(cfg["seed"]))
    load_parent_wrim0_weights(model, ckpt, PARENT_CHECKPOINT_SHA256)
    after = sha256_file(ckpt)
    if after != before:
        print(json.dumps({"error": "parent checkpoint mutated"}))
        return 3

    results = []
    family_stats: dict[str, dict[str, int]] = {}
    for item in suite["items"]:
        gen = generate(model, tokenizer, item["generation_prompt"], 64)
        scored = score_output(item, gen["continuation"])
        fam = item["family"]
        family_stats.setdefault(fam, {"n": 0, "pass": 0, "fail": 0})
        family_stats[fam]["n"] += 1
        if scored["pass"]:
            family_stats[fam]["pass"] += 1
        else:
            family_stats[fam]["fail"] += 1
        results.append(
            {
                "evalId": item["evalId"],
                "family": fam,
                "level": item["level"],
                "capability_ids": item["capability_ids"],
                "output": gen["continuation"][:500],
                "n_new": gen["n_new"],
                **{k: v for k, v in scored.items() if k != "evalId"},
            }
        )

    out_dir = root / "model-lab/eval-only" / EVAL_ID
    payload = {
        "suite_id": EVAL_ID,
        "EXCLUDE_FROM_TRAINING": True,
        "model_id": "WRIM-0",
        "parent_checkpoint_sha256": PARENT_CHECKPOINT_SHA256,
        "checkpoint_unchanged": after == before == PARENT_CHECKPOINT_SHA256,
        "parameter_count": nparams,
        "optimizer_steps": 0,
        "family_stats": family_stats,
        "pass_count": sum(1 for r in results if r["pass"]),
        "item_count": len(results),
        "results": results,
        "note": "Frozen WRIM-0 baseline for WRIM-1.1-CAP-EVAL-0. Not a training run.",
    }
    (out_dir / "wrim0-baseline.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "suite_id": EVAL_ID,
                "model_id": "WRIM-0",
                "pass_count": payload["pass_count"],
                "item_count": payload["item_count"],
                "family_stats": family_stats,
                "checkpoint_unchanged": payload["checkpoint_unchanged"],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
