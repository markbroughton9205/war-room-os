"""Phase 1 greedy harness determinism. Frozen WRIM-0 only. ZERO optimizer steps.

10 repeats of all 6 CAP-EVAL-0 retention prompts, 32-token historical scorer
and 256-token descriptive continuation. No training. No grid. No interpolation.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn.functional as F
from tokenizers import Tokenizer

from safetensors_model import load_model_state_from_safetensors
from stage1_pack import SEQ_LEN
from stage2_eval import (
    EVAL_SEED,
    GEN_TOKENS,
    PERIOD_ID,
    SPECIAL_IDS,
    greedy_generate,
    load_retention_items,
    score_retention,
)
from stage2_pack import encode_corpus1_val_units, encode_rehearsal_val_units
from wrim_g20m import VOCAB_SIZE, WRIM0Model, expected_torch_keys

PARENT_SHA = "d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015"
TOKENIZER_SHA = "47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7"
FROZEN_NLL_SHA = "43c57b52610cbdaf7a6edf4791b05e2d360936b3341a0b6ca1838d940dd27dfe"
HISTORICAL_GEN_TOKENS = 32
HIGHRES_GEN_TOKENS = 256
REPEATS = 10
MICRO_BATCH = 8
VAL_BATCHES = 4
EOS_ID = 2
SUPERSEDED_RUNS = [
    "SKEWED_BASELINE__3e-5__s1337",
    "SKEWED_BASELINE__3e-5__s7331",
]


def sha256_json_text(path: Path) -> str:
    """Hash decoded JSON text after universal-newline translation (LF).

    On-disk bytes may contain CRLF; Phase 0 published the in-memory LF SHA
    43c57b52.... Do not rewrite the frozen file for that encoding difference.
    """
    text = path.read_text(encoding="utf-8")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def disable_tf32() -> None:
    if torch.cuda.is_available():
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        torch.backends.cudnn.benchmark = False
    if hasattr(torch, "set_float32_matmul_precision"):
        torch.set_float32_matmul_precision("highest")


def encode_prompt_ids(tokenizer: Tokenizer, prompt: str) -> list[int]:
    bos = tokenizer.token_to_id("<|bos|>")
    body = tokenizer.encode(prompt, add_special_tokens=False).ids
    return [int(bos), *body]


def wrim0_anchor_nll(model: WRIM0Model, prompt_ids: list[int], target_ids: list[int], device: torch.device) -> dict[str, float]:
    """Teacher-forced NLL of fixed WRIM-0 generated reference tokens. Not gold-label NLL."""
    ids = prompt_ids + target_ids
    if len(ids) < 2 or not target_ids:
        return {"wrim0_anchor_nll": float("nan"), "mean_token_prob": float("nan"), "entropy_tf": float("nan")}
    x = torch.tensor([ids[:-1]], dtype=torch.long, device=device)
    model.eval()
    with torch.inference_mode():
        logits = model(x)[0]
        start = len(prompt_ids) - 1
        tlogits = logits[start : start + len(target_ids)].float()
        logp = F.log_softmax(tlogits, dim=-1)
        idx = torch.arange(len(target_ids), device=device)
        tgt = torch.tensor(target_ids, dtype=torch.long, device=device)
        tok_nll = -logp[idx, tgt]
        probs = torch.exp(-tok_nll)
        ents = []
        for i in range(tlogits.size(0)):
            p = torch.softmax(tlogits[i], dim=-1)
            ents.append(float(-(p * torch.log(p.clamp_min(1e-12))).sum().item()))
    return {
        "wrim0_anchor_nll": float(tok_nll.mean().item()),
        "mean_token_prob": float(probs.mean().item()),
        "entropy_tf": float(sum(ents) / len(ents)),
    }


def special_metrics(new_ids: list[int]) -> dict[str, Any]:
    freq = {str(i): int(sum(1 for t in new_ids if t == i)) for i in range(9)}
    count = int(sum(freq.values()))
    n = max(1, len(new_ids))
    eos_pos = next((i for i, t in enumerate(new_ids) if t == EOS_ID), None)
    return {
        "special_token_count_0_8": count,
        "special_token_rate_0_8": float(count / n),
        "special_token_id_frequency": freq,
        "eos_stopping_position": eos_pos,
        "period_count": int(sum(1 for t in new_ids if t == PERIOD_ID)),
        "period_first": bool(new_ids) and new_ids[0] == PERIOD_ID,
        "single_punct": bool(new_ids) and all(t == PERIOD_ID for t in new_ids),
        "unique_count": len(set(new_ids)),
        "unique_ratio_raw": float(len(set(new_ids)) / n) if new_ids else None,
    }


def exact_keys(gen: dict[str, Any], spec: dict[str, Any], binary: bool | None) -> dict[str, Any]:
    ids = list(gen["new_ids"])
    cont = gen.get("continuation") or ""
    return {
        "new_ids": ids,
        "continuation_sha256": hashlib.sha256(cont.encode("utf-8")).hexdigest(),
        "unique_count": spec["unique_count"],
        "unique_ratio": gen.get("unique_ratio"),
        "historical_binary_pass": binary,
        "max_token_run": gen.get("max_run"),
        "period_first": spec["period_first"],
        "single_punct": spec["single_punct"],
        "period_count": spec["period_count"],
        "special_token_count_0_8": spec["special_token_count_0_8"],
        "eos_stopping_position": spec["eos_stopping_position"],
        "n_new": gen.get("n_new"),
    }


def concat_units(units) -> np.ndarray:
    if not units:
        return np.zeros((0,), dtype=np.int32)
    return np.concatenate([u.tokens for u in units]).astype(np.int32)


def measure_val_loss(model: WRIM0Model, stream: np.ndarray, device: torch.device) -> float | None:
    if stream.size < SEQ_LEN + 1:
        return None
    model.eval()
    offset = 0
    losses = []
    usable = int(stream.size) - SEQ_LEN - 1
    with torch.inference_mode():
        for _ in range(VAL_BATCHES):
            xs = []
            ys = []
            for _b in range(MICRO_BATCH):
                if offset > usable:
                    offset = 0
                xs.append(stream[offset : offset + SEQ_LEN])
                ys.append(stream[offset + 1 : offset + SEQ_LEN + 1])
                offset += SEQ_LEN
            x = torch.tensor(np.stack(xs), dtype=torch.long, device=device)
            y = torch.tensor(np.stack(ys), dtype=torch.long, device=device)
            logits = model(x)
            loss = F.cross_entropy(logits.reshape(-1, VOCAB_SIZE), y.reshape(-1))
            if not torch.isfinite(loss):
                return None
            losses.append(float(loss.item()))
    return float(sum(losses) / len(losses)) if losses else None


def spread(xs: list[float | None]) -> dict[str, float | None]:
    vals = [float(x) for x in xs if x is not None and isinstance(x, (int, float)) and np.isfinite(float(x))]
    if not vals:
        return {"min": None, "max": None, "mean": None, "max_abs_diff": None, "max_rel_diff": None, "n": 0}
    mn = min(vals)
    mx = max(vals)
    mean = float(sum(vals) / len(vals))
    abs_d = mx - mn
    mag = max(abs(mean), 1e-12)
    return {
        "min": mn,
        "max": mx,
        "mean": mean,
        "max_abs_diff": float(abs_d),
        "max_rel_diff": float(abs_d / mag),
        "n": len(vals),
    }


def mark_superseded(ckpt_root: Path) -> list[dict[str, Any]]:
    marked = []
    for rid in SUPERSEDED_RUNS:
        run_dir = ckpt_root / rid
        marker = {
            "run_id": rid,
            "status": "SUPERSEDED",
            "reasons": [
                "ACCUM4",
                "EXCLUDED_FROM_PRIMARY_GRID",
                "NOT_COMPARABILITY_EVIDENCE",
                "NOT_PROMOTION_CANDIDATE",
            ],
            "keep": True,
            "delete": False,
            "use_in_phase1_or_primary_aggregates": False,
            "gradient_accumulation": 4,
        }
        if run_dir.exists():
            write_json(run_dir / "SUPERSEDED.json", marker)
            marked.append({**marker, "path": str(run_dir), "present": True})
        else:
            marked.append({**marker, "path": str(run_dir), "present": False})
    incomplete = ckpt_root / "SKEWED_BASELINE__3e-5__s20260912"
    if incomplete.exists():
        extra = {
            "run_id": "SKEWED_BASELINE__3e-5__s20260912",
            "status": "SUPERSEDED",
            "reasons": ["ACCUM4", "INCOMPLETE_KILLED", "EXCLUDED_FROM_PRIMARY_GRID", "NOT_COMPARABILITY_EVIDENCE", "NOT_PROMOTION_CANDIDATE"],
            "keep": True,
            "delete": False,
            "note": "Commander named seeds 1337 and 7331. This third accum=4 partial run is also excluded.",
        }
        write_json(incomplete / "SUPERSEDED.json", extra)
        marked.append({**extra, "path": str(incomplete), "present": True})
    return marked


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--dump-root", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--frozen-nll", required=True)
    ap.add_argument("--ckpt-root", required=True)
    args = ap.parse_args()

    weights = Path(args.weights)
    tokenizer_path = Path(args.tokenizer)
    dump_root = Path(args.dump_root)
    report_path = Path(args.report)
    frozen_path = Path(args.frozen_nll)
    ckpt_root = Path(args.ckpt_root)
    report_path.parent.mkdir(parents=True, exist_ok=True)

    parent_mtime = weights.stat().st_mtime_ns
    parent_sha = sha256_file(weights)
    tok_sha = sha256_file(tokenizer_path)
    frozen_sha = sha256_json_text(frozen_path)
    frozen_sha_bytes = sha256_file(frozen_path)
    if parent_sha != PARENT_SHA or tok_sha != TOKENIZER_SHA:
        payload = {
            "ok": False,
            "phase": 1,
            "verdict": "PHASE1_GREEDY_DETERMINISM_FAIL",
            "error": "HASH_MISMATCH",
            "optimizer_steps": 0,
            "CLEAR_TO_RUN": False,
            "training_authorization": "OFF",
        }
        write_json(report_path, payload)
        print(json.dumps(payload, indent=2))
        return 2
    if frozen_sha != FROZEN_NLL_SHA:
        payload = {
            "ok": False,
            "phase": 1,
            "verdict": "PHASE1_GREEDY_DETERMINISM_FAIL",
            "error": "FROZEN_NLL_ARTIFACT_SHA_MISMATCH",
            "expected": FROZEN_NLL_SHA,
            "observed": frozen_sha,
            "optimizer_steps": 0,
            "CLEAR_TO_RUN": False,
            "note": "Frozen WRIM-0 reference NLL artifact was not rewritten. STOP.",
        }
        write_json(report_path, payload)
        print(json.dumps(payload, indent=2))
        return 2

    frozen = json.loads(frozen_path.read_text(encoding="utf-8"))
    frozen_items = {it["evalId"]: it for it in frozen.get("items") or []}
    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    items = load_retention_items(dump_root)
    if len(items) != 6:
        raise RuntimeError(f"expected 6 retention items, got {len(items)}")

    disable_tf32()
    if not torch.cuda.is_available():
        payload = {"ok": False, "verdict": "PHASE1_GREEDY_DETERMINISM_FAIL", "error": "CUDA required", "optimizer_steps": 0}
        write_json(report_path, payload)
        print(json.dumps(payload, indent=2))
        return 2
    device = torch.device("cuda")
    raw, _hdr = load_model_state_from_safetensors(weights)
    model = WRIM0Model()
    missing = [k for k in expected_torch_keys() if k not in raw]
    if missing:
        raise RuntimeError(f"parent missing keys {missing[:8]}")
    model.load_state_dict(raw, strict=True)
    model = model.to(device)
    model.freeze_inference()
    if any(p.requires_grad for p in model.parameters()):
        payload = {"ok": False, "verdict": "PHASE1_GREEDY_DETERMINISM_FAIL", "error": "parameters require_grad; optimizer-adjacent state forbidden", "optimizer_steps": 0}
        write_json(report_path, payload)
        print(json.dumps(payload, indent=2))
        return 3

    print("[phase1] packing separated validation streams", flush=True)
    c0_stream = concat_units(encode_rehearsal_val_units(tokenizer, dump_root))
    c1_stream = concat_units(encode_corpus1_val_units(tokenizer, dump_root))

    superseded = mark_superseded(ckpt_root)

    repeats: list[dict[str, Any]] = []
    blocking: list[str] = []
    frozen_id_mismatch = []

    for r in range(REPEATS):
        torch.manual_seed(EVAL_SEED)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(EVAL_SEED)
        row_items = []
        hist_pass = 0
        for it in items:
            eid = it.get("evalId")
            prompt = it.get("generation_prompt") or it["prompt"]
            prompt_ids = encode_prompt_ids(tokenizer, prompt)
            frozen_it = frozen_items[eid]
            target_ids = list(frozen_it["new_ids_32"])
            gen32 = greedy_generate(model, tokenizer, prompt, device, max_new=HISTORICAL_GEN_TOKENS)
            gen256 = greedy_generate(model, tokenizer, prompt, device, max_new=HIGHRES_GEN_TOKENS)
            spec32 = special_metrics(list(gen32["new_ids"]))
            spec256 = special_metrics(list(gen256["new_ids"]))
            binary = score_retention(gen32, it.get("expected") or {})
            if binary:
                hist_pass += 1
            anchor = wrim0_anchor_nll(model, prompt_ids, target_ids, device)
            exact32 = exact_keys(gen32, spec32, binary)
            exact256 = exact_keys(gen256, spec256, None)
            if list(gen32["new_ids"]) != target_ids:
                frozen_id_mismatch.append({"repeat": r, "evalId": eid, "reason": "32-token IDs != frozen WRIM-0 reference tokens"})
            if exact32["continuation_sha256"] != frozen_it.get("continuation_fingerprint_32"):
                frozen_id_mismatch.append({"repeat": r, "evalId": eid, "reason": "32-token fingerprint != frozen artifact"})
            row_items.append(
                {
                    "evalId": eid,
                    "wrim0_anchor_nll": anchor["wrim0_anchor_nll"],
                    "wrim0_anchor_nll_frozen": frozen_it["nll_32"],
                    "wrim0_anchor_nll_delta_vs_frozen": float(anchor["wrim0_anchor_nll"] - frozen_it["nll_32"]),
                    "mean_token_prob": anchor["mean_token_prob"],
                    "entropy_tf": anchor["entropy_tf"],
                    "entropy_first_32": gen32.get("entropy"),
                    "p_period_32": gen32.get("p_period"),
                    "historical": {
                        "role": "HISTORICAL_COMPATIBILITY_METRIC",
                        "gen_tokens": HISTORICAL_GEN_TOKENS,
                        **exact32,
                        "special_token_id_frequency": spec32["special_token_id_frequency"],
                        "special_token_rate_0_8": spec32["special_token_rate_0_8"],
                    },
                    "descriptive_256": {
                        "role": "DESCRIPTIVE_CONTINUOUS_METRIC",
                        "binary_0_35_gate_applied": False,
                        "gen_tokens": HIGHRES_GEN_TOKENS,
                        "entropy_first": gen256.get("entropy"),
                        "p_period": gen256.get("p_period"),
                        **exact256,
                        "special_token_id_frequency": spec256["special_token_id_frequency"],
                        "special_token_rate_0_8": spec256["special_token_rate_0_8"],
                    },
                }
            )
        v0 = measure_val_loss(model, c0_stream, device)
        v1 = measure_val_loss(model, c1_stream, device)
        repeats.append(
            {
                "repeat": r,
                "historical_binary": f"{hist_pass}/6",
                "historical_pass_count": hist_pass,
                "val_loss_corpus0": v0,
                "val_loss_corpus1": v1,
                "items": row_items,
            }
        )
        print(f"[phase1] repeat {r + 1}/{REPEATS} historical {hist_pass}/6", flush=True)

    if frozen_id_mismatch:
        blocking.append("PHASE1_BLOCKING_FAILURE: generated 32-token sequence/fingerprint diverged from frozen WRIM-0 reference artifact")

    identity_32 = {}
    identity_256 = {}
    for it in items:
        eid = it.get("evalId")
        recs = []
        recs256 = []
        for rep in repeats:
            h = next(x["historical"] for x in rep["items"] if x["evalId"] == eid)
            d = next(x["descriptive_256"] for x in rep["items"] if x["evalId"] == eid)
            recs.append(
                (
                    tuple(h["new_ids"]),
                    h["continuation_sha256"],
                    h["unique_count"],
                    h["unique_ratio"],
                    h["historical_binary_pass"],
                    h["max_token_run"],
                    h["period_first"],
                    h["single_punct"],
                    h["period_count"],
                    h["special_token_count_0_8"],
                    h["eos_stopping_position"],
                )
            )
            recs256.append(
                (
                    tuple(d["new_ids"]),
                    d["continuation_sha256"],
                    d["unique_count"],
                    d["unique_ratio"],
                    d["max_token_run"],
                    d["period_first"],
                    d["single_punct"],
                    d["period_count"],
                    d["special_token_count_0_8"],
                    d["eos_stopping_position"],
                    d["n_new"],
                )
            )
        ok32 = len(set(recs)) == 1
        ok256 = len(set(recs256)) == 1
        identity_32[eid] = {"identical_across_repeats": ok32, "n_distinct": len(set(recs))}
        identity_256[eid] = {"identical_across_repeats": ok256, "n_distinct": len(set(recs256)), "fingerprint": recs256[0][1] if recs256 else None}
        if not ok32:
            blocking.append(f"PHASE1_BLOCKING_FAILURE: 32-token identity failed for {eid}")
        if not ok256:
            blocking.append(f"PHASE1_BLOCKING_FAILURE: 256-token identity failed for {eid}")

    hist_all_66 = all(rep["historical_pass_count"] == 6 for rep in repeats)
    if not hist_all_66:
        blocking.append("PHASE1_BLOCKING_FAILURE: historical binary was not 6/6 on every repeat")

    nll_by_item = {
        it.get("evalId"): [rep["items"][idx]["wrim0_anchor_nll"] for rep in repeats]
        for idx, it in enumerate(items)
    }
    nll_spread = {eid: spread(vals) for eid, vals in nll_by_item.items()}
    entropy32 = spread([item["entropy_first_32"] for rep in repeats for item in rep["items"]])
    mean_p = spread([item["mean_token_prob"] for rep in repeats for item in rep["items"]])
    val0_spread = spread([rep["val_loss_corpus0"] for rep in repeats])
    val1_spread = spread([rep["val_loss_corpus1"] for rep in repeats])
    all_nll = [item["wrim0_anchor_nll"] for rep in repeats for item in rep["items"]]
    nll_global = spread(all_nll)
    nll_repeat_abs = max((row.get("max_abs_diff") or 0.0) for row in nll_spread.values())
    nll_repeat_rel = max((row.get("max_rel_diff") or 0.0) for row in nll_spread.values())
    vs_frozen = [abs(item["wrim0_anchor_nll_delta_vs_frozen"]) for rep in repeats for item in rep["items"]]
    frozen_spread = spread(vs_frozen)

    # Rank-order of items by anchor NLL must be stable if numeric noise is tiny
    ranks = []
    for rep in repeats:
        order = tuple(x["evalId"] for x in sorted(rep["items"], key=lambda z: z["wrim0_anchor_nll"]))
        ranks.append(order)
    rank_stable = len(set(ranks)) == 1

    token_ids_identical_32 = all(v["identical_across_repeats"] for v in identity_32.values())
    token_ids_identical_256 = all(v["identical_across_repeats"] for v in identity_256.values())
    numeric_pass = token_ids_identical_32 and token_ids_identical_256 and rank_stable
    if token_ids_identical_32 and token_ids_identical_256 and not rank_stable:
        blocking.append("PHASE1_BLOCKING_FAILURE: floating differences changed item NLL ranking")
        numeric_pass = False
    if frozen_spread.get("max_abs_diff") is not None and frozen_spread["max_abs_diff"] > 1e-3:
        blocking.append("PHASE1_BLOCKING_FAILURE: WRIM0_ANCHOR_NLL diverged from frozen artifact by > 1e-3 abs")
        numeric_pass = False

    parent_unmodified = weights.stat().st_mtime_ns == parent_mtime
    if not parent_unmodified:
        blocking.append("PHASE1_BLOCKING_FAILURE: WRIM-0 weights mutated")

    # Observed tolerance
    observed_tol = {
        "wrim0_anchor_nll_max_abs_diff_across_repeats": nll_repeat_abs,
        "wrim0_anchor_nll_max_rel_diff_across_repeats": nll_repeat_rel,
        "vs_frozen_max_abs_diff": frozen_spread.get("max_abs_diff"),
        "entropy_first_32_max_abs_diff_across_repeats": max(
            (spread([item["entropy_first_32"] for rep in repeats for item in rep["items"] if item["evalId"] == it.get("evalId")]).get("max_abs_diff") or 0.0)
            for it in items
        ),
        "mean_token_prob_max_abs_diff_across_repeats": max(
            (spread([item["mean_token_prob"] for rep in repeats for item in rep["items"] if item["evalId"] == it.get("evalId")]).get("max_abs_diff") or 0.0)
            for it in items
        ),
        "val_loss_corpus0_max_abs_diff": val0_spread.get("max_abs_diff"),
        "val_loss_corpus1_max_abs_diff": val1_spread.get("max_abs_diff"),
        "item_nll_rank_stable": rank_stable,
        "observed_repeat_tolerance": nll_repeat_abs,
        "note": "Across-repeat spreads. Between-item NLL range is not harness noise.",
    }

    gpu = torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
    first = repeats[0]
    special_baseline = {
        eid: {
            "rate_32": next(i["historical"]["special_token_rate_0_8"] for i in first["items"] if i["evalId"] == eid),
            "count_32": next(i["historical"]["special_token_count_0_8"] for i in first["items"] if i["evalId"] == eid),
            "freq_32": next(i["historical"]["special_token_id_frequency"] for i in first["items"] if i["evalId"] == eid),
            "rate_256": next(i["descriptive_256"]["special_token_rate_0_8"] for i in first["items"] if i["evalId"] == eid),
            "count_256": next(i["descriptive_256"]["special_token_count_0_8"] for i in first["items"] if i["evalId"] == eid),
            "freq_256": next(i["descriptive_256"]["special_token_id_frequency"] for i in first["items"] if i["evalId"] == eid),
        }
        for eid in (it.get("evalId") for it in items)
    }

    verdict = "PHASE1_GREEDY_DETERMINISM_PASS" if not blocking else "PHASE1_GREEDY_DETERMINISM_FAIL"
    payload = {
        "ok": verdict == "PHASE1_GREEDY_DETERMINISM_PASS",
        "phase": 1,
        "verdict": verdict,
        "CLEAR_TO_RUN": False,
        "training_authorization": "OFF",
        "optimizer_steps": 0,
        "optimizer_constructed": False,
        "stage3_started": False,
        "promotion_candidate": False,
        "interpolation_executed": False,
        "grid_executed": False,
        "retention_item_to_genesis_source_mapping": "UNMAPPED_NO_STEM_OVERLAP",
        "metric_names": {
            "wrim0_anchor_nll": "teacher-forced NLL of fixed WRIM-0 greedy 32-token reference tokens; not gold-label NLL",
            "wrim0_anchor_nll_delta": "NLL_candidate(fixed WRIM-0 tokens) - NLL_WRIM0(fixed WRIM-0 tokens)",
            "unique_ratio_32": "HISTORICAL_COMPATIBILITY_METRIC",
            "unique_ratio_256": "DESCRIPTIVE_CONTINUOUS_METRIC; no 0.35 binary gate",
        },
        "frozen_reference": {
            "path": str(frozen_path),
            "sha256_json_text_lf": frozen_sha,
            "sha256_on_disk_bytes": frozen_sha_bytes,
            "expected_sha256": FROZEN_NLL_SHA,
            "preserved": True,
            "rewritten": False,
            "newline_note": "On-disk bytes may be CRLF; published Phase 0 SHA is LF JSON text.",
        },
        "artifact_sha_verification": {
            "parent_sha256": parent_sha,
            "parent_match": parent_sha == PARENT_SHA,
            "tokenizer_sha256": tok_sha,
            "tokenizer_match": tok_sha == TOKENIZER_SHA,
            "parent_unmodified": parent_unmodified,
        },
        "hardware_software": {
            "torch": torch.__version__,
            "cuda": torch.version.cuda,
            "gpu": gpu,
            "dtype": "FP32",
            "tf32": False,
            "eval_seed": EVAL_SEED,
            "decoding": "greedy_argmax",
        },
        "repeat_count": REPEATS,
        "identity_32": identity_32,
        "identity_256": identity_256,
        "token_ids_identical_32": token_ids_identical_32,
        "token_ids_identical_256": token_ids_identical_256,
        "historical_binary_every_repeat": [rep["historical_binary"] for rep in repeats],
        "historical_6_of_6_every_repeat": hist_all_66,
        "wrim0_anchor_nll_spread_by_item": nll_spread,
        "wrim0_anchor_nll_repeat_spread": {
            "max_abs_diff_across_repeats": nll_repeat_abs,
            "max_rel_diff_across_repeats": nll_repeat_rel,
            "bit_identical_per_item": nll_repeat_abs == 0.0,
            "note": "Across 10 repeats of the SAME item. Between-item range is not repeat noise.",
        },
        "wrim0_anchor_nll_between_item_range": {**nll_global, "note": "Range across the 6 prompts, not across repeats."},
        "wrim0_anchor_nll_global_spread": {**nll_global, "note": "Pooled across items; not harness repeat noise. See wrim0_anchor_nll_repeat_spread."},
        "wrim0_anchor_nll_vs_frozen_spread": frozen_spread,
        "numerical_tolerance_observed": observed_tol,
        "NUMERIC_REPEATABILITY": "PASS" if numeric_pass and not blocking else "FAIL",
        "special_token_baseline": special_baseline,
        "val_loss_corpus0": {
            "baseline": val0_spread.get("mean"),
            "spread": val0_spread,
            "stream_tokens": int(c0_stream.size),
            "mixed_with_corpus1": False,
        },
        "val_loss_corpus1": {
            "baseline": val1_spread.get("mean"),
            "spread": val1_spread,
            "stream_tokens": int(c1_stream.size),
            "mixed_with_corpus0": False,
        },
        "superseded_accum4_runs": superseded,
        "blocking": blocking,
        "frozen_id_mismatch": frozen_id_mismatch,
        "repeats": repeats,
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "RAEL": "NOT_IMPLEMENTED",
        "QWEN": "THIRD_PARTY_MODEL_RUNNING_LOCALLY",
        "READY_FOR_STAGE3_TRAINING_AUTHORIZATION": "NO",
        "utc": datetime.now(timezone.utc).isoformat(),
    }
    canonical = json.dumps({k: v for k, v in payload.items() if k != "artifact_sha256"}, indent=2)
    artifact_sha = sha256_bytes(canonical.encode("utf-8"))
    payload["artifact_sha256"] = artifact_sha
    write_json(report_path, payload)
    report_path.with_suffix(".sha256").write_text(artifact_sha + "\n", encoding="utf-8")
    summary = {
        "verdict": verdict,
        "token_ids_identical_32": token_ids_identical_32,
        "token_ids_identical_256": token_ids_identical_256,
        "historical_6_of_6_every_repeat": hist_all_66,
        "NUMERIC_REPEATABILITY": payload["NUMERIC_REPEATABILITY"],
        "wrim0_anchor_nll_max_abs_diff": nll_global.get("max_abs_diff"),
        "val_loss_corpus0": val0_spread.get("mean"),
        "val_loss_corpus1": val1_spread.get("mean"),
        "artifact": str(report_path),
        "artifact_sha256": artifact_sha,
        "optimizer_steps": 0,
        "CLEAR_TO_RUN": False,
        "training_authorization": "OFF",
    }
    print(json.dumps(summary, indent=2))
    return 0 if verdict == "PHASE1_GREEDY_DETERMINISM_PASS" else 5


if __name__ == "__main__":
    sys.exit(main())
