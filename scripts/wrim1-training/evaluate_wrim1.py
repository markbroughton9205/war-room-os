#!/usr/bin/env python3
"""Held-out evaluation for official WRIM-1 checkpoints. Does not promote."""
from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path

import mlx.core as mx
from tokenizers import Tokenizer, decoders

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(SCRIPT_DIR.parent / "sovereign-model-lab"))

from checkpoint_io import load_bundle, load_model_weights  # noqa: E402
from constants import PARENT_CHECKPOINT_SHA256, RUN_ID, TOKENIZER_REL, TOKENIZER_SHA256  # noqa: E402
from hashes import sha256_file  # noqa: E402
from paths import official_ckpt_dir, repo_root, wave9_dir  # noqa: E402
from run_status import persist_promotion  # noqa: E402
from trainer_core import build_from_config  # noqa: E402
from training_config import official_training_config  # noqa: E402


def generate(model, tokenizer: Tokenizer, prompt: str, max_new_tokens: int) -> str:
    mx.random.seed(0)
    bos_id = tokenizer.token_to_id("<|bos|>")
    eos_id = tokenizer.token_to_id("<|eos|>")
    ids = [bos_id] + tokenizer.encode(prompt).ids
    cache = model.fresh_cache()
    logits, cache = model(mx.array([ids]), cache=cache)
    generated = list(ids)
    for _ in range(max_new_tokens):
        last_logits = logits[:, -1, :]
        next_id = int(mx.argmax(last_logits, axis=-1).item())
        generated.append(next_id)
        if next_id == eos_id:
            break
        logits, cache = model(mx.array([[next_id]]), cache=cache)
    return tokenizer.decode(generated, skip_special_tokens=True)


def repetition_stats(token_ids: list[int]) -> dict:
    if len(token_ids) < 4:
        return {"collapsed": False, "max_run": 0, "unique_token_ratio": None}
    max_run = 1
    run = 1
    for a, b in zip(token_ids, token_ids[1:]):
        run = run + 1 if a == b else 1
        max_run = max(max_run, run)
    unique_ratio = len(set(token_ids)) / len(token_ids)
    return {
        "collapsed": max_run >= max(6, len(token_ids) // 3),
        "max_run": max_run,
        "unique_token_ratio": round(unique_ratio, 3),
    }


def json_valid(prompt: str, output: str) -> bool:
    for candidate in (prompt + output, output):
        try:
            parsed = json.loads(candidate)
            return isinstance(parsed, dict)
        except Exception:
            continue
    return False


def load_model_from_ckpt(ckpt: Path):
    bundle = load_bundle(ckpt)
    if bundle["run_manifest"].get("run_id") != RUN_ID:
        raise RuntimeError("checkpoint run_id is not WRIM1-RUN-000001")
    cfg = official_training_config()
    model, arch, nparams = build_from_config(cfg, int(cfg["seed"]))
    load_model_weights(model, bundle["model"], strict=True)
    return model, bundle, arch, nparams


def select_best(registry: dict) -> dict:
    goods = [e for e in registry.get("checkpoints", []) if e.get("status") == "complete" and not e.get("corrupted")]
    if not goods:
        raise RuntimeError("no complete official checkpoints")
    def key(entry):
        val = (entry.get("validation_metrics") or {}).get("validation_loss")
        val = float(val) if isinstance(val, (int, float)) and math.isfinite(val) else 1e9
        return (val, -int(entry.get("step", 0)))
    goods.sort(key=key)
    return goods[0]


def main() -> int:
    root = repo_root()
    work = official_ckpt_dir(root)
    registry = json.loads((work / "checkpoint-registry.json").read_text(encoding="utf-8"))
    best = select_best(registry)
    final_entries = [e for e in registry["checkpoints"] if e.get("step") == 1893 and e.get("status") == "complete"]
    final = final_entries[-1] if final_entries else registry["checkpoints"][-1]
    tokenizer_path = root / TOKENIZER_REL
    if sha256_file(tokenizer_path) != TOKENIZER_SHA256:
        raise RuntimeError("tokenizer hash mismatch at eval")
    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    if tokenizer.decoder is None:
        tokenizer.decoder = decoders.ByteLevel()
    held = json.loads((root / "model-lab/manifests/wave8_1/held-out-eval-suite.json").read_text(encoding="utf-8"))
    wrim0 = json.loads((root / "model-lab/manifests/wave8_1/wrim0-heldout-run.json").read_text(encoding="utf-8"))
    wrim0_by_id = {row["evalId"]: row for row in wrim0["results"]}

    persist_promotion(root, "EVALUATING")
    model, bundle, _arch, nparams = load_model_from_ckpt(Path(best["path"]))
    results = []
    for item in held["items"]:
        output = generate(model, tokenizer, item["input"], 48)
        ids = tokenizer.encode(output).ids
        support = item["wrim0Support"]
        score = None
        if support == "SUPPORTED" and item["objectiveScorer"] == "json-validity":
            score = 1 if json_valid(item["input"], output) else 0
        elif support == "SUPPORTED" and item["objectiveScorer"] == "exact-string":
            score = 1 if item["expectedValue"] and item["expectedValue"] in output else 0
        row = {
            "evalId": item["evalId"],
            "capability": item["capability"],
            "support": support,
            "objectiveScorer": item["objectiveScorer"],
            "input": item["input"],
            "output": output,
            "outputSha256": hashlib.sha256(output.encode("utf-8")).hexdigest(),
            "score": None if support == "UNSUPPORTED" else score,
            "unsupported": support == "UNSUPPORTED",
            "repetition": repetition_stats(ids),
            "checkpoint_id": best["checkpoint_id"],
            "checkpoint_sha": best["sha"],
        }
        results.append(row)

    comparison = []
    regressions = []
    improvements = []
    unsupported_domains = []
    for row in results:
        base = wrim0_by_id.get(row["evalId"], {})
        wrim0_score = base.get("score") if "score" in base else None
        if base.get("support") == "UNSUPPORTED":
            wrim0_score = None
        delta = None
        if row["score"] is not None and wrim0_score is not None:
            delta = row["score"] - wrim0_score
        improved = bool(delta is not None and delta > 0)
        regressed = bool(delta is not None and delta < 0)
        if row["unsupported"]:
            unsupported_domains.append(row["capability"])
        if row["repetition"].get("collapsed") and row["support"] == "SUPPORTED":
            regressions.append(row["evalId"] + ":repetition_collapse")
            regressed = True
        if improved:
            improvements.append(row["evalId"])
        if regressed:
            regressions.append(row["evalId"])
        comparison.append({
            "evalId": row["evalId"],
            "capability": row["capability"],
            "wrim0Result": wrim0_score,
            "wrim0Support": base.get("support") or row["support"],
            "wrim1Result": None if row["unsupported"] else row["score"],
            "wrim1OutputSha256": row["outputSha256"],
            "delta": delta,
            "improvement": improved,
            "regression": regressed,
            "unsupported": row["unsupported"],
            "evidenceRefs": [
                f"heldout:{row['evalId']}",
                f"wrim0:{base.get('outputSha256') or 'null'}",
                f"wrim1:{row['outputSha256']}",
                f"checkpoint:{best['sha']}",
            ],
        })

    language = next(r for r in results if r["evalId"] == "w81-eval-language-alice")
    json_row = next(r for r in results if r["evalId"] == "w81-eval-json-schema")
    catastrophic = language["repetition"].get("collapsed") is True
    recommend = (not catastrophic) and not any(x.endswith(":repetition_collapse") for x in regressions)
    promotion_state = "AWAITING_COMMANDER_PROMOTION" if recommend else "PROMOTION_REJECTED"
    persist_promotion(
        root,
        promotion_state,
        recommendation="PROMOTION_RECOMMENDED" if recommend else "PROMOTION_REJECTED",
        best_checkpoint_sha256=best["sha"],
        final_checkpoint_sha256=final.get("sha"),
        parent_checkpoint_sha256=PARENT_CHECKPOINT_SHA256,
        parameter_count=nparams,
    )
    payload = {
        "run_id": RUN_ID,
        "best_checkpoint": best,
        "final_checkpoint": final,
        "reload_ok": True,
        "parameter_count": nparams,
        "parent_checkpoint_sha256": PARENT_CHECKPOINT_SHA256,
        "results": results,
        "comparison": comparison,
        "regressions": sorted(set(regressions)),
        "improvements": improvements,
        "unsupported_domains": sorted(set(unsupported_domains)),
        "promotion_state": promotion_state,
        "json_valid": json_valid(json_row["input"], json_row["output"]),
        "language_collapsed": language["repetition"].get("collapsed"),
    }
    out = work / "held-out-results.json"
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    (wave9_dir(root) / "wrim0-vs-wrim1.json").write_text(json.dumps({"rows": comparison, "run_id": RUN_ID}, indent=2) + "\n", encoding="utf-8")
    (work / "best-checkpoint.json").write_text(json.dumps({
        "run_id": RUN_ID,
        "checkpoint_id": best["checkpoint_id"],
        "sha256": best["sha"],
        "path": best["path"],
        "step": best["step"],
        "newest_is_not_automatically_best": True,
    }, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "best_sha": best["sha"],
        "final_sha": final.get("sha"),
        "promotion_state": promotion_state,
        "regressions": payload["regressions"],
        "reload_ok": True,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
