"""Phase 2 primary training grid. WRIM1-NEBULA-STABILITY-GRID-000001.

40 TEST_ONLY runs: NATURAL_BASELINE vs BALANCED_GENESIS × {3e-5, 2e-5} × seeds 1001-1010.
accum=1, micro_batch=8, effective_batch=8, 50 steps, FP32, TF32 off.
No interpolation. No Stage 3. Any hard-stop aborts the entire grid.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import statistics
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn.functional as F
from safetensors.torch import load_file, save_file
from tokenizers import Tokenizer

from experiment_pack import (
    CODE_SHARE_TARGET,
    CORPUS0_SHARE_TARGET,
    GRAD_ACCUM,
    LOCKED_MIX,
    MICRO_BATCH,
    NEEDED_TRAIN_TOKENS,
    STEPS,
    TOKENS_PER_STEP,
    TRAIN_PREFIX_TOKENS,
    encode_raw_families,
    genesis_doc_id,
    genesis_token_audit,
    pack_train_stream,
)
from safetensors_model import load_model_state_from_safetensors
from stage1_pack import SEQ_LEN, causal_batch_audit, slice_contiguous_batches
from stage2_eval import (
    EVAL_SEED,
    PERIOD_ID,
    SPECIAL_IDS,
    greedy_generate,
    load_diagnostic_items,
    load_retention_items,
    score_retention,
)
from stage2_pack import encode_corpus1_val_units, encode_rehearsal_val_units
from wrim_g20m import VOCAB_SIZE, WRIM0Model, expected_torch_keys

PARENT_SHA = "d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015"
TOKENIZER_SHA = "47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7"
HARNESS_SHA = "4e89902ac8adbb3fce45a705ea50a8056dc3279cbc06c2ecb2de2870d6dcc9b5"
FROZEN_NLL_SHA = "43c57b52610cbdaf7a6edf4791b05e2d360936b3341a0b6ca1838d940dd27dfe"
EXPERIMENT_ID = "WRIM1-NEBULA-STABILITY-GRID-000001"
EXPECTED_PARAMS = 19_217_152
WARMUP = 25
BETAS = (0.9, 0.95)
EPS = 1e-8
WEIGHT_DECAY = 0.1
GRAD_CLIP = 1.0
DISK_STOP_GB = 32
DISK_WARN_GB = 64
EVAL_STEPS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]
STRATEGIES = ["NATURAL_BASELINE", "BALANCED_GENESIS"]
PEAK_LRS = [3e-5, 2e-5]
SEEDS = list(range(1001, 1011))
LR_LABEL = {3e-5: "LR_HIGH", 2e-5: "LR_LOW"}
VAL_CORPUS0_BASELINE = 8.890125
VAL_CORPUS1_BASELINE = 7.971308
VAL_BASELINE_ABS_TOL = 1e-4
HIGHRES_TOKENS = 256
HISTORICAL_TOKENS = 32
BOS_ID = 1
EOS_ID = 2
SUPERSEDED_RUNS = [
    "SKEWED_BASELINE__3e-5__s1337",
    "SKEWED_BASELINE__3e-5__s7331",
]
PARAM_COUNT = EXPECTED_PARAMS


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_json_text(path: Path) -> str:
    return hashlib.sha256(path.read_text(encoding="utf-8").encode("utf-8")).hexdigest()


def tensors_sha256(state: dict[str, torch.Tensor]) -> str:
    h = hashlib.sha256()
    for k in sorted(state):
        t = state[k].detach().contiguous().cpu().float().numpy().tobytes()
        h.update(k.encode("utf-8"))
        h.update(t)
    return h.hexdigest()


def token_id_sha256(ids: list[int]) -> str:
    return hashlib.sha256((" ".join(str(i) for i in ids)).encode("utf-8")).hexdigest()


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def append_jsonl(path: Path, row: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, separators=(",", ":")) + "\n")
        f.flush()


def disk_gb(path: Path) -> float:
    path.mkdir(parents=True, exist_ok=True)
    return shutil.disk_usage(path).free / (1024**3)


def disable_tf32() -> None:
    if torch.cuda.is_available():
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        torch.backends.cudnn.benchmark = False
        torch.backends.cudnn.deterministic = True
    if hasattr(torch, "set_float32_matmul_precision"):
        torch.set_float32_matmul_precision("highest")


def lr_at_step(step: int, peak_lr: float) -> float:
    """Same warmup-cosine family for both LR arms. 0-indexed. min_lr = peak/10."""
    min_lr = peak_lr / 10.0
    if step < WARMUP:
        return peak_lr * (step + 1) / WARMUP
    progress = (step - WARMUP) / max(1, STEPS - WARMUP)
    progress = min(1.0, max(0.0, progress))
    cosine = 0.5 * (1.0 + math.cos(math.pi * progress))
    return min_lr + (peak_lr - min_lr) * cosine


def cell_id(strategy: str, peak_lr: float, seed: int) -> str:
    lr_key = "3e-5" if abs(peak_lr - 3e-5) < 1e-12 else "2e-5"
    return f"{strategy}__{lr_key}__s{seed}"


def factor_cell_id(strategy: str, peak_lr: float) -> str:
    lr_key = "3e-5" if abs(peak_lr - 3e-5) < 1e-12 else "2e-5"
    return f"{strategy}__{lr_key}"


def concat_units(units) -> np.ndarray:
    if not units:
        return np.zeros((0,), dtype=np.int32)
    return np.concatenate([u.tokens for u in units]).astype(np.int32)


def measure_val_loss(model: WRIM0Model, stream: np.ndarray, device: torch.device) -> float | None:
    """Phase 1 protocol: 4 batches × micro_batch 8 wrapping contiguous stream."""
    if stream.size < SEQ_LEN + 1:
        return None
    was = model.training
    model.eval()
    offset = 0
    losses = []
    usable = int(stream.size) - SEQ_LEN - 1
    with torch.inference_mode():
        for _ in range(4):
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
                if was:
                    model.train()
                return None
            losses.append(float(loss.item()))
    if was:
        model.train()
    return float(sum(losses) / len(losses)) if losses else None


def encode_prompt_ids(tokenizer: Tokenizer, prompt: str) -> list[int]:
    bos = tokenizer.token_to_id("<|bos|>")
    body = tokenizer.encode(prompt, add_special_tokens=False).ids
    return [int(bos), *body]


def special_metrics(new_ids: list[int]) -> dict[str, Any]:
    freq = {str(i): int(sum(1 for t in new_ids if t == i)) for i in range(9)}
    count = int(sum(freq.values()))
    n = max(1, len(new_ids))
    return {
        "special_token_count_0_8": count,
        "special_token_rate_0_8": float(count / n),
        "special_token_id_frequency": freq,
        "eos_stopping_position": next((i for i, t in enumerate(new_ids) if t == EOS_ID), None),
        "unique_count": len(set(new_ids)),
        "period_count": int(sum(1 for t in new_ids if t == PERIOD_ID)),
    }


def rescore_prefix(new_ids: list[int], template: dict[str, Any], tokenizer: Tokenizer) -> dict[str, Any]:
    """Historical 32-token metrics from the greedy 256-token prefix (argmax+EOS identical)."""
    max_run = 1
    run = 1
    for a, b in zip(new_ids, new_ids[1:]):
        run = run + 1 if a == b else 1
        max_run = max(max_run, run)
    uniq = (len(set(new_ids)) / len(new_ids)) if new_ids else None
    collapsed = bool(new_ids) and max_run >= max(6, len(new_ids) // 3)
    special_loop = False
    spec_run = 0
    last_spec = None
    for tid in new_ids:
        if tid in SPECIAL_IDS:
            spec_run = spec_run + 1 if tid == last_spec else 1
            last_spec = tid
            if spec_run >= 4:
                special_loop = True
                break
        else:
            spec_run = 0
            last_spec = None
    punct_dom = False
    if new_ids:
        punct = sum(1 for t in new_ids[:8] if t in (PERIOD_ID, *range(11, 23)))
        punct_dom = (new_ids[0] == PERIOD_ID) and (punct >= 6)
    continuation = tokenizer.decode(new_ids, skip_special_tokens=True)
    return {
        "new_ids": new_ids,
        "continuation": continuation,
        "n_new": len(new_ids),
        "finite": template.get("finite"),
        "entropy": template.get("entropy"),
        "argmax_id": template.get("argmax_id"),
        "argmax_prob": template.get("argmax_prob"),
        "p_period": template.get("p_period"),
        "unique_ratio": round(uniq, 4) if uniq is not None else None,
        "max_run": max_run,
        "collapsed": collapsed,
        "special_loop": special_loop,
        "period_first": bool(new_ids) and new_ids[0] == PERIOD_ID,
        "punct_dominated": punct_dom,
        "single_punct": bool(new_ids) and all(t == PERIOD_ID for t in new_ids),
    }


def continuation_entropy(new_ids: list[int]) -> float | None:
    if not new_ids:
        return None
    counts = Counter(new_ids)
    n = float(len(new_ids))
    h = 0.0
    for c in counts.values():
        p = c / n
        h -= p * math.log(p)
    return float(h)


def teacher_force_anchor(
    model: WRIM0Model,
    prompt_ids: list[int],
    target_ids: list[int],
    device: torch.device,
    wrim0_logp: torch.Tensor | None,
) -> dict[str, Any]:
    """Teacher-forced WRIM0_ANCHOR_NLL / KL on frozen WRIM-0 reference tokens."""
    ids = prompt_ids + target_ids
    if len(ids) < 2 or not target_ids:
        return {
            "wrim0_anchor_nll": float("nan"),
            "mean_token_prob": float("nan"),
            "first_token_rank": None,
            "first_token_probability": float("nan"),
            "kl_wrim0_to_candidate": float("nan"),
            "log_softmax": None,
        }
    was = model.training
    model.eval()
    x = torch.tensor([ids[:-1]], dtype=torch.long, device=device)
    with torch.inference_mode():
        logits = model(x)[0]
        start = len(prompt_ids) - 1
        tlogits = logits[start : start + len(target_ids)].float()
        logq = F.log_softmax(tlogits, dim=-1)
        tgt = torch.tensor(target_ids, dtype=torch.long, device=device)
        idx = torch.arange(len(target_ids), device=device)
        tok_nll = -logq[idx, tgt]
        first = logq[0]
        first_id = int(target_ids[0])
        first_p = float(torch.exp(first[first_id]).item())
        first_rank = int((torch.exp(first) > torch.exp(first[first_id])).sum().item()) + 1
        kl = None
        out_logp = None
        if wrim0_logp is None:
            out_logp = logq.detach().cpu()
        else:
            p0 = wrim0_logp.to(device)
            kl_t = (p0.exp() * (p0 - logq)).sum(dim=-1)
            kl = float(kl_t.mean().item())
    if was:
        model.train()
    return {
        "wrim0_anchor_nll": float(tok_nll.mean().item()),
        "mean_token_prob": float(torch.exp(-tok_nll).mean().item()),
        "first_token_rank": first_rank,
        "first_token_probability": first_p,
        "kl_wrim0_to_candidate": kl,
        "log_softmax": out_logp,
    }


def param_groups(named: list[tuple[str, torch.Tensor]]) -> dict[str, list[tuple[str, torch.Tensor]]]:
    groups: dict[str, list[tuple[str, torch.Tensor]]] = {
        "total": [],
        "embeddings": [],
        "attention": [],
        "ffn": [],
        "block_norms": [],
        "final_norm": [],
    }
    for name, t in named:
        groups["total"].append((name, t))
        if name.startswith("tok_emb"):
            groups["embeddings"].append((name, t))
        elif ".attn." in name:
            groups["attention"].append((name, t))
        elif ".ffn." in name:
            groups["ffn"].append((name, t))
        elif name.startswith("layers.") and name.endswith("_norm.weight"):
            groups["block_norms"].append((name, t))
        elif name.startswith("norm_f"):
            groups["final_norm"].append((name, t))
    return groups


def relative_l2(cand: dict[str, torch.Tensor], parent: dict[str, torch.Tensor], names: list[str]) -> float:
    num = 0.0
    den = 0.0
    for n in names:
        c = cand[n].detach().float().cpu()
        p = parent[n].detach().float().cpu()
        num += float((c - p).pow(2).sum().item())
        den += float(p.pow(2).sum().item())
    if den <= 0:
        return 0.0
    return float(math.sqrt(num) / math.sqrt(den))


def parameter_displacement(model: WRIM0Model, parent_cpu: dict[str, torch.Tensor]) -> dict[str, float]:
    named = [(n, p.detach()) for n, p in model.named_parameters()]
    groups = param_groups(named)
    cand = dict(named)
    return {g: relative_l2(cand, parent_cpu, [n for n, _ in pairs]) for g, pairs in groups.items()}


def annotate_stream(units) -> tuple[list[str], list[str]]:
    buckets: list[str] = []
    docs: list[str] = []
    for u in units:
        n = int(u.tokens.size)
        b = str(u.bucket)
        d = genesis_doc_id(u) if b == "wr_corpus_0" else ""
        buckets.extend([b] * n)
        docs.extend([d] * n)
    return buckets, docs


def step_token_contrib(buckets: list[str], docs: list[str], step: int, all_docs: list[str]) -> dict[str, Any]:
    start = (step - 1) * TOKENS_PER_STEP
    end = start + TOKENS_PER_STEP
    c0 = 0
    c1 = 0
    code = 0
    by_doc = {d: 0 for d in all_docs}
    for i in range(start, min(end, len(buckets))):
        b = buckets[i]
        if b == "wr_corpus_0":
            c0 += 1
            did = docs[i]
            if did in by_doc:
                by_doc[did] += 1
        else:
            c1 += 1
            if b == "code":
                code += 1
    return {
        "corpus0_tokens": c0,
        "corpus1_tokens": c1,
        "code_tokens": code,
        "genesis_document_token_contributions": by_doc,
    }


def diagnostic0_snapshot(model: WRIM0Model, tokenizer: Tokenizer, device: torch.device, dump_root: Path) -> dict[str, Any] | None:
    """Canonical STAB DIAGNOSTIC-0 probes. Used only for existing collapse/special-loop hard-stop."""
    try:
        items = load_diagnostic_items(dump_root)
    except Exception:
        return None
    if not items:
        return None
    collapsed = 0
    special_loops = 0
    punct_dom = 0
    ents = []
    max_runs = []
    for item in items:
        g = greedy_generate(model, tokenizer, item["input"], device, max_new=HISTORICAL_TOKENS)
        if g["collapsed"]:
            collapsed += 1
        if g["special_loop"]:
            special_loops += 1
        if g.get("punct_dominated"):
            punct_dom += 1
        if g.get("entropy") is not None:
            ents.append(float(g["entropy"]))
        max_runs.append(int(g.get("max_run") or 0))
    return {
        "collapsed_probes": collapsed,
        "special_token_loops": special_loops,
        "punct_dominated_count": punct_dom,
        "n_probes": len(items),
        "mean_entropy": float(sum(ents) / len(ents)) if ents else None,
        "max_token_run": int(max(max_runs) if max_runs else 0),
        "source": "WRIM-RECOVERY-DIAGNOSTIC-0-EXTENDED",
    }


def hard_stop_decision(step0: dict, now: dict, history: list[dict]) -> tuple[bool, str | None, str | None]:
    """Binary 6/6→5/6 is RETENTION_WARNING, not automatic stop."""
    warning = None
    ret0 = int(step0.get("historical_pass_count") or 0)
    ret = int(now.get("historical_pass_count") or 0)
    if ret < ret0:
        warning = f"RETENTION_WARNING binary {ret}/{now.get('historical_total')} vs step-0 {ret0}"

    d0_now = now.get("diagnostic0") or {}
    d0_0 = step0.get("diagnostic0") or {}
    floor = int(d0_0.get("collapsed_probes") or 0)
    collapse = int(d0_now.get("collapsed_probes") or 0)
    if collapse >= floor + 4:
        return True, "extreme repetition collapse: DIAGNOSTIC-0 collapsed_probes >= WRIM-0 floor + 4", warning
    if int(d0_now.get("special_token_loops") or 0) > 0:
        return True, "severe special-token loop (DIAGNOSTIC-0)", warning
    if int(now.get("retention_special_loops") or 0) > 0:
        return True, "severe special-token loop (retention continuation)", warning
    if int(d0_now.get("max_token_run") or 0) >= 24 and int(d0_now.get("punct_dominated_count") or 0) >= 4:
        return True, "extreme repetition collapse: max_token_run>=24 and punct_dominated>=4", warning
    ent = d0_now.get("mean_entropy")
    if ent is not None and float(ent) < 0.05 and collapse >= floor + 2:
        return True, "extreme entropy collapse with DIAGNOSTIC-0 repetition", warning

    prior = history[-2] if len(history) >= 2 else None
    if prior is not None:
        prior_d0 = prior.get("diagnostic0") or {}
        prior_collapse = int(prior_d0.get("collapsed_probes") or 0)
        nll = float(now.get("mean_wrim0_anchor_nll_delta") or 0.0)
        prior_nll = float(prior.get("mean_wrim0_anchor_nll_delta") or 0.0)
        if collapse >= floor + 2 and prior_collapse >= floor + 2 and nll > 0.75 and prior_nll > 0.75:
            return True, "severe collapse plus large continuous retention degradation", warning
    return False, None, warning


def save_model_only(ckpt_dir: Path, model: WRIM0Model, step: int, tokens: int) -> dict:
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    free = disk_gb(ckpt_dir)
    if free < DISK_STOP_GB:
        raise RuntimeError(f"disk safety violation free {free:.1f}GB < {DISK_STOP_GB}GB")
    if free < DISK_WARN_GB:
        print(f"[phase2] WARN disk {free:.1f}GB < {DISK_WARN_GB}GB", flush=True)
    model_cpu = {k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()}
    save_hash = tensors_sha256(model_cpu)
    model_path = ckpt_dir / "model.safetensors"
    save_file(model_cpu, str(model_path))
    meta = {
        "model_path": str(model_path),
        "model_sha256": sha256_file(model_path),
        "save_hash": save_hash,
        "step": step,
        "tokens": tokens,
        "kind": "TEST_ONLY",
        "promotion_candidate": False,
        "experiment_id": EXPERIMENT_ID,
        "free_disk_gb": round(free, 2),
    }
    write_json(ckpt_dir / "checkpoint.json", meta)
    reload_hash = tensors_sha256({k: v.detach().cpu().contiguous() for k, v in load_file(str(model_path)).items()})
    if reload_hash != save_hash:
        raise RuntimeError("checkpoint corruption")
    return meta


def load_parent_model(weights: Path, device: torch.device) -> tuple[WRIM0Model, str, int]:
    raw, _hdr = load_model_state_from_safetensors(weights)
    model = WRIM0Model()
    missing = [k for k in expected_torch_keys() if k not in raw]
    if missing:
        raise RuntimeError(f"parent missing keys: {missing[:8]}")
    model.load_state_dict(raw, strict=True)
    n = int(sum(p.numel() for p in model.parameters()))
    parent_hash = tensors_sha256({k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()})
    model = model.to(device)
    return model, parent_hash, n


def five_stats(xs: list[float]) -> dict[str, float | None]:
    clean = [float(x) for x in xs if x is not None and isinstance(x, (int, float)) and math.isfinite(float(x))]
    if not clean:
        return {"mean": None, "sd": None, "median": None, "min": None, "max": None, "n": 0}
    return {
        "mean": float(statistics.mean(clean)),
        "sd": float(statistics.stdev(clean) if len(clean) > 1 else 0.0),
        "median": float(statistics.median(clean)),
        "min": float(min(clean)),
        "max": float(max(clean)),
        "n": len(clean),
    }


def pearson(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) != len(ys) or len(xs) < 3:
        return None
    mx = statistics.mean(xs)
    my = statistics.mean(ys)
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    den = math.sqrt(sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys))
    if den <= 0:
        return None
    return float(num / den)


def validate_experiment_invariants(
    *,
    parent_sha: str,
    tokenizer_sha: str,
    harness_sha: str,
    frozen_nll_sha: str,
    n_params: int,
    strategy: str,
    peak_lr: float,
    audit: dict[str, Any],
    free_gb: float,
    phase0_blocking: bool,
    dropout_modules: int,
) -> tuple[bool, list[str]]:
    reasons = []
    checks = [
        (parent_sha == PARENT_SHA, "parent SHA mismatch"),
        (tokenizer_sha == TOKENIZER_SHA, "tokenizer SHA mismatch"),
        (harness_sha == HARNESS_SHA, "Phase 1 harness SHA mismatch"),
        (frozen_nll_sha == FROZEN_NLL_SHA, "WRIM0 anchor NLL artifact SHA mismatch"),
        (n_params == EXPECTED_PARAMS, f"param count {n_params} != {EXPECTED_PARAMS}"),
        (SEQ_LEN == 512, "seq_len != 512"),
        (MICRO_BATCH == 8, "micro_batch != 8"),
        (GRAD_ACCUM == 1, "grad_accum != 1"),
        (WARMUP == 25, "warmup_steps != 25"),
        (abs(peak_lr - 3e-5) < 1e-12 or abs(peak_lr - 2e-5) < 1e-12, "peak_lr not in {3e-5, 2e-5}"),
        (strategy in ("NATURAL_BASELINE", "BALANCED_GENESIS"), "rehearsal mode invalid"),
        (STEPS <= 50, "max_steps > 50"),
        (TRAIN_PREFIX_TOKENS <= 204800, "max_tokens > 204800"),
        (LOCKED_MIX.get("code") == CODE_SHARE_TARGET, "locked code mix drifted"),
        (bool(audit.get("packing_ok")), "packing_ok is false"),
        (bool((audit.get("mix_assertions") or {}).get("ok")), f"mix assertion failed: {(audit.get('mix_assertions') or {}).get('reasons')}"),
        (float((audit.get("mix_assertions") or {}).get("tool_use_share") or 0.0) == 0.0, "TOOL_USE != 0"),
        (not phase0_blocking, "Phase 0 leakage blocking failure"),
        (free_gb > DISK_STOP_GB, f"free disk {free_gb:.1f}GB <= {DISK_STOP_GB}GB"),
        (dropout_modules == 0, "dropout modules present"),
        (int(audit.get("bos_id") or BOS_ID) == BOS_ID, "BOS != 1"),
        (int(audit.get("eos_id") or EOS_ID) == EOS_ID, "EOS != 2"),
        (bool(audit.get("unit_token_order_preserved")), "per-token shuffle detected"),
    ]
    for ok, msg in checks:
        if not ok:
            reasons.append(msg)
    return (len(reasons) == 0), reasons


def load_frozen_targets(frozen_path: Path, tokenizer: Tokenizer, dump_root: Path) -> dict[str, Any]:
    frozen = json.loads(frozen_path.read_text(encoding="utf-8"))
    items = load_retention_items(dump_root)
    by_id = {it.get("evalId"): it for it in items}
    out = []
    for it in frozen.get("items") or []:
        eid = it["evalId"]
        prompt = it["prompt"]
        target_ids = [int(x) for x in it["new_ids_32"]]
        prompt_ids = encode_prompt_ids(tokenizer, prompt)
        out.append(
            {
                "evalId": eid,
                "prompt": prompt,
                "prompt_ids": prompt_ids,
                "target_ids": target_ids,
                "nll_wrim0": float(it["nll_32"]),
                "expected": (by_id.get(eid) or {}).get("expected") or {},
                "frozen_text_fp_32": it.get("continuation_fingerprint_32"),
            }
        )
    return {"items": out, "eval_seed": frozen.get("eval_seed")}


def eval_at(
    *,
    model: WRIM0Model,
    tokenizer: Tokenizer,
    device: torch.device,
    dump_root: Path,
    targets: dict[str, Any],
    wrim0_logp: dict[str, torch.Tensor],
    parent_cpu: dict[str, torch.Tensor],
    c0_stream: np.ndarray,
    c1_stream: np.ndarray,
    interleaved,
    all_docs: list[str],
    step: int,
    peak_lr: float,
    train_loss: float | None,
    tokens: int,
) -> dict[str, Any]:
    torch.manual_seed(EVAL_SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(EVAL_SEED)
    d0 = diagnostic0_snapshot(model, tokenizer, device, dump_root)
    rows = []
    deltas = []
    kls = []
    hist_pass = 0
    special_loops = 0
    for tgt in targets["items"]:
        prompt = tgt["prompt"]
        gen256 = greedy_generate(model, tokenizer, prompt, device, max_new=HIGHRES_TOKENS)
        ids256 = list(gen256["new_ids"])
        gen32 = rescore_prefix(ids256[:HISTORICAL_TOKENS], gen256, tokenizer)
        binary = score_retention(gen32, tgt.get("expected") or {})
        if binary:
            hist_pass += 1
        if gen32.get("special_loop") or gen256.get("special_loop"):
            special_loops += 1
        spec32 = special_metrics(list(gen32["new_ids"]))
        spec256 = special_metrics(ids256)
        bundle = teacher_force_anchor(model, tgt["prompt_ids"], tgt["target_ids"], device, wrim0_logp[tgt["evalId"]])
        delta = float(bundle["wrim0_anchor_nll"] - tgt["nll_wrim0"])
        deltas.append(delta)
        if bundle["kl_wrim0_to_candidate"] is not None:
            kls.append(float(bundle["kl_wrim0_to_candidate"]))
        rows.append(
            {
                "evalId": tgt["evalId"],
                "wrim0_anchor_nll": bundle["wrim0_anchor_nll"],
                "wrim0_anchor_nll_delta": delta,
                "mean_token_prob": bundle["mean_token_prob"],
                "first_token_rank": bundle["first_token_rank"],
                "first_token_probability": bundle["first_token_probability"],
                "kl_wrim0_to_candidate": bundle["kl_wrim0_to_candidate"],
                "historical_32": {
                    "role": "HISTORICAL_COMPATIBILITY_METRIC",
                    "binary_pass": binary,
                    "unique_count": spec32["unique_count"],
                    "unique_ratio": gen32.get("unique_ratio"),
                    "max_token_run": gen32.get("max_run"),
                    "collapsed": gen32.get("collapsed"),
                    "single_punct": gen32.get("single_punct"),
                    "entropy_first": gen32.get("entropy"),
                    "p_period": gen32.get("p_period"),
                    "token_id_sha256": token_id_sha256(list(gen32["new_ids"])),
                    "continuation_text_sha256": hashlib.sha256((gen32.get("continuation") or "").encode("utf-8")).hexdigest(),
                    "special_token_count_0_8": spec32["special_token_count_0_8"],
                    "special_token_rate_0_8": spec32["special_token_rate_0_8"],
                    "special_token_id_frequency": spec32["special_token_id_frequency"],
                    "n_new": gen32.get("n_new"),
                    "new_ids": list(gen32["new_ids"]),
                },
                "descriptive_256": {
                    "role": "DESCRIPTIVE_CONTINUOUS_METRIC",
                    "binary_0_35_gate_applied": False,
                    "unique_count": spec256["unique_count"],
                    "unique_ratio": gen256.get("unique_ratio"),
                    "entropy_first": gen256.get("entropy"),
                    "entropy_continuation": continuation_entropy(ids256),
                    "max_token_run": gen256.get("max_run"),
                    "p_period": gen256.get("p_period"),
                    "token_id_sha256": token_id_sha256(ids256),
                    "continuation_text_sha256": hashlib.sha256((gen256.get("continuation") or "").encode("utf-8")).hexdigest(),
                    "special_token_count_0_8": spec256["special_token_count_0_8"],
                    "special_token_rate_0_8": spec256["special_token_rate_0_8"],
                    "special_token_id_frequency": spec256["special_token_id_frequency"],
                    "n_new": gen256.get("n_new"),
                    "collapsed": gen256.get("collapsed"),
                    "special_loop": gen256.get("special_loop"),
                    "new_ids": ids256,
                },
            }
        )
    summary = {
        "mean": float(statistics.mean(deltas)) if deltas else float("nan"),
        "median": float(statistics.median(deltas)) if deltas else float("nan"),
        "worst": float(max(deltas)) if deltas else float("nan"),
        "std": float(statistics.pstdev(deltas)) if len(deltas) > 1 else 0.0,
    }
    prefix = max(0, step) * TOKENS_PER_STEP if step > 0 else 0
    gen_stats = genesis_token_audit(interleaved, prefix if prefix > 0 else 0, all_docs)
    v0 = measure_val_loss(model, c0_stream, device)
    v1 = measure_val_loss(model, c1_stream, device)
    disp = parameter_displacement(model, parent_cpu)
    return {
        "step": step,
        "tokens": tokens,
        "lr": lr_at_step(max(0, step - 1), peak_lr) if step > 0 else 0.0,
        "train_loss": train_loss,
        "val_loss_corpus0": v0,
        "val_loss_corpus1": v1,
        "items": rows,
        "mean_wrim0_anchor_nll_delta": summary["mean"],
        "median_wrim0_anchor_nll_delta": summary["median"],
        "worst_item_wrim0_anchor_nll_delta": summary["worst"],
        "std_wrim0_anchor_nll_delta": summary["std"],
        "mean_kl_wrim0_to_candidate": float(statistics.mean(kls)) if kls else None,
        "historical_pass_count": hist_pass,
        "historical_total": len(rows),
        "historical_binary": f"{hist_pass}/{len(rows)}",
        "retention_special_loops": special_loops,
        "parameter_displacement": disp,
        "genesis_rehearsal": gen_stats,
        "diagnostic0": d0,
    }


def abort_grid(root: Path, payload: dict) -> dict:
    payload = {
        **payload,
        "ok": False,
        "experiment_id": EXPERIMENT_ID,
        "TRAINING_AUTHORIZATION": "OFF",
        "stage3_started": False,
        "interpolation_executed": False,
        "promotion_candidate": False,
        "utc": utc_now(),
    }
    write_json(root / "ABORT.json", payload)
    print(json.dumps({"ABORT": True, **{k: payload.get(k) for k in ("run_id", "hard_stop_rule", "stopped_reason")}}, indent=2), flush=True)
    return payload


def run_one(
    *,
    strategy: str,
    peak_lr: float,
    seed: int,
    raw_families: dict,
    tokenizer: Tokenizer,
    dump_root: Path,
    weights: Path,
    out_root: Path,
    logs: dict[str, Path],
    device: torch.device,
    parent_hash: str,
    parent_cpu: dict[str, torch.Tensor],
    targets: dict[str, Any],
    wrim0_logp: dict[str, torch.Tensor],
    parent_mtime: int,
    tokenizer_sha: str,
    parent_file_sha: str,
    harness_sha: str,
    frozen_nll_sha: str,
    c0_stream: np.ndarray,
    c1_stream: np.ndarray,
    phase0_blocking: bool,
    n_params: int,
) -> dict[str, Any]:
    rid = cell_id(strategy, peak_lr, seed)
    run_dir = out_root / rid
    run_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    free0 = disk_gb(run_dir)
    warnings: list[str] = []
    if free0 < DISK_WARN_GB:
        warnings.append(f"disk warn {free0:.1f}GB < {DISK_WARN_GB}GB")
    packed = pack_train_stream(raw_families, tokenizer, strategy=strategy, seed=seed, dump_root=dump_root)
    audit = packed["audit"]
    write_json(run_dir / "packing-audit.json", audit)
    dropout_n = 0
    ok, reasons = validate_experiment_invariants(
        parent_sha=parent_file_sha,
        tokenizer_sha=tokenizer_sha,
        harness_sha=harness_sha,
        frozen_nll_sha=frozen_nll_sha,
        n_params=n_params,
        strategy=strategy,
        peak_lr=peak_lr,
        audit=audit,
        free_gb=free0,
        phase0_blocking=phase0_blocking,
        dropout_modules=dropout_n,
    )
    if not ok:
        payload = {
            "ok": False,
            "run_id": rid,
            "stopped_reason": "validate_experiment failed",
            "hard_stop_rule": "; ".join(reasons),
            "audit_mix": audit.get("mix_assertions"),
        }
        write_json(run_dir / "run.json", payload)
        return payload

    n_micro = STEPS * GRAD_ACCUM
    batches = slice_contiguous_batches(packed["stream"], n_micro, MICRO_BATCH, SEQ_LEN)
    batch_audit = causal_batch_audit(batches, packed["stream"])
    if not batch_audit.get("ok"):
        payload = {"ok": False, "run_id": rid, "stopped_reason": "packing violation", "hard_stop_rule": "causal_batch_audit failed"}
        write_json(run_dir / "run.json", payload)
        return payload

    all_docs = sorted({genesis_doc_id(u) for u in raw_families["wr_corpus_0"]})
    buckets, docs = annotate_stream(packed["interleaved"])

    torch.manual_seed(seed)
    np.random.seed(seed % (2**31))
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)

    model, loaded_hash, loaded_n = load_parent_model(weights, device)
    if loaded_hash != parent_hash or loaded_n != EXPECTED_PARAMS:
        payload = {"ok": False, "run_id": rid, "stopped_reason": "parent mismatch", "hard_stop_rule": "reloaded parent hash/param mismatch"}
        write_json(run_dir / "run.json", payload)
        return payload
    model.enable_training()
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=peak_lr,
        betas=BETAS,
        eps=EPS,
        weight_decay=WEIGHT_DECAY,
        fused=False,
    )
    prev = {n: p.detach().clone() for n, p in model.named_parameters()}

    def do_eval(step: int, train_loss: float | None, tokens: int) -> dict[str, Any]:
        return eval_at(
            model=model,
            tokenizer=tokenizer,
            device=device,
            dump_root=dump_root,
            targets=targets,
            wrim0_logp=wrim0_logp,
            parent_cpu=parent_cpu,
            c0_stream=c0_stream,
            c1_stream=c1_stream,
            interleaved=packed["interleaved"],
            all_docs=all_docs,
            step=step,
            peak_lr=peak_lr,
            train_loss=train_loss,
            tokens=tokens,
        )

    evals: list[dict] = []
    clip_events = 0
    pre_norms: list[float] = []
    post_norms: list[float] = []
    upd_norms: list[float] = []
    last_train_loss = None
    stopped_step = STEPS
    hard_stop_rule = None
    status = "COMPLETED"
    tokens = 0

    try:
        step0 = do_eval(0, None, 0)
        evals.append(step0)
        ck0 = save_model_only(run_dir / "step-0", model, 0, 0)
        append_jsonl(logs["checkpoints"], {"run_id": rid, **ck0})
        compact0 = compact_eval(rid, strategy, peak_lr, seed, step0)
        append_jsonl(logs["eval"], compact0)
        write_json(run_dir / "eval-step-0.json", step0)

        optimizer.zero_grad(set_to_none=True)
        for step in range(1, STEPS + 1):
            step_t0 = time.perf_counter()
            lr = lr_at_step(step - 1, peak_lr)
            for g in optimizer.param_groups:
                g["lr"] = lr
            x_np, y_np = batches[step - 1]
            x = torch.tensor(x_np, dtype=torch.long, device=device)
            y = torch.tensor(y_np, dtype=torch.long, device=device)
            logits = model(x)
            loss = F.cross_entropy(logits.reshape(-1, VOCAB_SIZE), y.reshape(-1))
            if not torch.isfinite(loss):
                hard_stop_rule = "NaN/Inf loss"
                status = "HARD_STOP"
                stopped_step = step
                break
            loss.backward()
            grads_ok = True
            for p in model.parameters():
                if p.grad is not None and not torch.isfinite(p.grad).all():
                    grads_ok = False
                    break
            if not grads_ok:
                hard_stop_rule = "NaN/Inf gradients"
                status = "HARD_STOP"
                stopped_step = step
                break
            pre = float(torch.nn.utils.clip_grad_norm_(model.parameters(), GRAD_CLIP).item())
            clip_fired = pre > GRAD_CLIP
            if clip_fired:
                clip_events += 1
            post = min(pre, GRAD_CLIP)
            with torch.no_grad():
                for n, p in model.named_parameters():
                    prev[n].copy_(p)
            optimizer.step()
            optimizer.zero_grad(set_to_none=True)
            upd_sq = 0.0
            with torch.no_grad():
                for n, p in model.named_parameters():
                    upd_sq += float((p - prev[n]).pow(2).sum().item())
            update_norm = math.sqrt(upd_sq)
            last_train_loss = float(loss.item())
            tokens += MICRO_BATCH * SEQ_LEN
            pre_norms.append(pre)
            post_norms.append(post)
            upd_norms.append(update_norm)
            contrib = step_token_contrib(buckets, docs, step, all_docs)
            elapsed_step = time.perf_counter() - step_t0
            mem = None
            if torch.cuda.is_available():
                mem = {
                    "allocated_gb": round(torch.cuda.memory_allocated() / (1024**3), 4),
                    "max_allocated_gb": round(torch.cuda.max_memory_allocated() / (1024**3), 4),
                }
            train_row = {
                "run_id": rid,
                "step": step,
                "tokens_seen": tokens,
                "lr": lr,
                "train_loss": last_train_loss,
                "grad_norm_pre_clip": pre,
                "grad_norm_post_clip": post,
                "clip_fired": clip_fired,
                "update_norm": update_norm,
                "elapsed_seconds": round(elapsed_step, 6),
                "tokens_per_sec": round(TOKENS_PER_STEP / max(elapsed_step, 1e-9), 3),
                "gpu_memory": mem,
                **contrib,
            }
            append_jsonl(logs["training"], train_row)

            if step in EVAL_STEPS:
                ev = do_eval(step, last_train_loss, tokens)
                evals.append(ev)
                write_json(run_dir / f"eval-step-{step}.json", ev)
                append_jsonl(logs["eval"], compact_eval(rid, strategy, peak_lr, seed, ev))
                ck = save_model_only(run_dir / f"step-{step}", model, step, tokens)
                append_jsonl(logs["checkpoints"], {"run_id": rid, **ck})
                stop, rule, warn = hard_stop_decision(step0, ev, evals)
                if warn:
                    warnings.append(f"step {step}: {warn}")
                    ev["retention_warning"] = True
                if stop:
                    hard_stop_rule = rule
                    status = "HARD_STOP"
                    stopped_step = step
                    save_model_only(run_dir / f"step-{step}-sentinel", model, step, tokens)
                    break

            free = disk_gb(run_dir)
            if free < DISK_STOP_GB:
                hard_stop_rule = f"disk safety violation free {free:.1f}GB < {DISK_STOP_GB}GB"
                status = "HARD_STOP"
                stopped_step = step
                break
    except Exception as exc:
        hard_stop_rule = f"runtime corruption: {type(exc).__name__}: {exc}"
        status = "HARD_STOP"

    parent_unmodified = weights.stat().st_mtime_ns == parent_mtime
    last_eval = evals[-1] if evals else {}
    if status == "COMPLETED" and int(last_eval.get("historical_pass_count") or 6) < int((evals[0] if evals else {}).get("historical_pass_count") or 6):
        status = "COMPLETED_WITH_RETENTION_WARNING"

    n_trained = len(pre_norms)
    payload = {
        "ok": status != "HARD_STOP",
        "run_id": rid,
        "experiment_id": EXPERIMENT_ID,
        "kind": "TEST_ONLY",
        "classification": "CONTROLLED_EXPERIMENT",
        "promotion_candidate": False,
        "stage3_started": False,
        "interpolation_executed": False,
        "rehearsal_strategy": strategy,
        "peak_lr": peak_lr,
        "lr_cell": LR_LABEL[peak_lr],
        "seed": seed,
        "seed_semantics": "DATA_ORDER_PACKING_VARIANCE",
        "status": status,
        "stopped_step": stopped_step,
        "hard_stop_rule": hard_stop_rule,
        "warnings": warnings,
        "n_steps_ran": n_trained,
        "tokens_seen": tokens,
        "effective_batch": MICRO_BATCH * GRAD_ACCUM,
        "micro_batch": MICRO_BATCH,
        "gradient_accumulation": GRAD_ACCUM,
        "sequence_length": SEQ_LEN,
        "warmup": WARMUP,
        "optimizer": {"name": "AdamW", "betas": list(BETAS), "eps": EPS, "weight_decay": WEIGHT_DECAY, "grad_clip": GRAD_CLIP, "fresh": True, "fused": False},
        "clip_rate": float(clip_events / n_trained) if n_trained else None,
        "mean_pre_clip_norm": float(statistics.mean(pre_norms)) if pre_norms else None,
        "mean_post_clip_norm": float(statistics.mean(post_norms)) if post_norms else None,
        "mean_update_norm": float(statistics.mean(upd_norms)) if upd_norms else None,
        "packing": {
            "packer_version": audit.get("packer_version"),
            "mix_assertions": audit.get("mix_assertions"),
            "genesis_prefix_audit": audit.get("genesis_prefix_audit"),
            "packing_ok": audit.get("packing_ok"),
            "tool_use_pct": 0.0,
        },
        "step0_binary": (evals[0] if evals else {}).get("historical_binary"),
        "final_binary": last_eval.get("historical_binary"),
        "final_mean_wrim0_anchor_nll_delta": last_eval.get("mean_wrim0_anchor_nll_delta"),
        "final_worst_item_wrim0_anchor_nll_delta": last_eval.get("worst_item_wrim0_anchor_nll_delta"),
        "final_mean_kl": last_eval.get("mean_kl_wrim0_to_candidate"),
        "final_val_loss_corpus0": last_eval.get("val_loss_corpus0"),
        "final_val_loss_corpus1": last_eval.get("val_loss_corpus1"),
        "final_gini": (last_eval.get("genesis_rehearsal") or {}).get("gini_coefficient"),
        "final_normalized_entropy": (last_eval.get("genesis_rehearsal") or {}).get("normalized_shannon_entropy"),
        "final_parameter_displacement_total": (last_eval.get("parameter_displacement") or {}).get("total"),
        "parent_unmodified": parent_unmodified,
        "tokenizer_unmodified": tokenizer_sha == TOKENIZER_SHA,
        "elapsed_s": round(time.perf_counter() - t0, 3),
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "RAEL": "NOT_IMPLEMENTED",
        "QWEN": "THIRD_PARTY_MODEL_RUNNING_LOCALLY",
        "READY_FOR_STAGE3_TRAINING_AUTHORIZATION": "NO",
        "TRAINING_AUTHORIZATION": "PHASE2_GRID_ONLY",
    }
    # Compact evals in run.json (no full token-id dumps)
    payload["evals"] = [compact_eval(rid, strategy, peak_lr, seed, e) for e in evals]
    write_json(run_dir / "run.json", payload)
    append_jsonl(logs["runs"], {k: v for k, v in payload.items() if k != "evals"})
    del model
    del optimizer
    del prev
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    print(json.dumps({"run_id": rid, "status": status, "final_binary": payload["final_binary"], "mean_delta": payload["final_mean_wrim0_anchor_nll_delta"]}, indent=2), flush=True)
    return payload


def compact_eval(rid: str, strategy: str, peak_lr: float, seed: int, ev: dict) -> dict:
    items = []
    for it in ev.get("items") or []:
        h = it.get("historical_32") or {}
        d = it.get("descriptive_256") or {}
        items.append(
            {
                "evalId": it.get("evalId"),
                "wrim0_anchor_nll": it.get("wrim0_anchor_nll"),
                "wrim0_anchor_nll_delta": it.get("wrim0_anchor_nll_delta"),
                "mean_token_prob": it.get("mean_token_prob"),
                "first_token_rank": it.get("first_token_rank"),
                "first_token_probability": it.get("first_token_probability"),
                "kl_wrim0_to_candidate": it.get("kl_wrim0_to_candidate"),
                "binary_pass_32": h.get("binary_pass"),
                "unique_ratio_32": h.get("unique_ratio"),
                "fp32": h.get("token_id_sha256"),
                "unique_ratio_256": d.get("unique_ratio"),
                "fp256": d.get("token_id_sha256"),
                "special_rate_32": h.get("special_token_rate_0_8"),
                "special_rate_256": d.get("special_token_rate_0_8"),
                "cap02_item": it.get("evalId") == "cap0-ret-02",
            }
        )
    g = ev.get("genesis_rehearsal") or {}
    return {
        "run_id": rid,
        "rehearsal_strategy": strategy,
        "peak_lr": peak_lr,
        "seed": seed,
        "step": ev.get("step"),
        "tokens": ev.get("tokens"),
        "lr": ev.get("lr"),
        "train_loss": ev.get("train_loss"),
        "val_loss_corpus0": ev.get("val_loss_corpus0"),
        "val_loss_corpus1": ev.get("val_loss_corpus1"),
        "mean_wrim0_anchor_nll_delta": ev.get("mean_wrim0_anchor_nll_delta"),
        "median_wrim0_anchor_nll_delta": ev.get("median_wrim0_anchor_nll_delta"),
        "worst_item_wrim0_anchor_nll_delta": ev.get("worst_item_wrim0_anchor_nll_delta"),
        "std_wrim0_anchor_nll_delta": ev.get("std_wrim0_anchor_nll_delta"),
        "mean_kl_wrim0_to_candidate": ev.get("mean_kl_wrim0_to_candidate"),
        "historical_binary": ev.get("historical_binary"),
        "historical_pass_count": ev.get("historical_pass_count"),
        "parameter_displacement": ev.get("parameter_displacement"),
        "gini": g.get("gini_coefficient"),
        "normalized_shannon_entropy": g.get("normalized_shannon_entropy"),
        "maximum_exposure_gap": g.get("maximum_exposure_gap"),
        "share_per_genesis_doc": g.get("share_per_genesis_doc"),
        "items": items,
        "retention_warning": ev.get("retention_warning", False),
    }


def warning_timeline(evals: list[dict]) -> list[int]:
    steps = []
    prev = None
    for ev in evals:
        cur = int(ev.get("historical_pass_count") or 6)
        if prev is not None and prev == 6 and cur == 5:
            steps.append(int(ev.get("step") or 0))
        prev = cur
    return steps


def analyze_grid(runs: list[dict], eval_path: Path) -> dict[str, Any]:
    healthy = [r for r in runs if r.get("ok") and r.get("run_id") not in SUPERSEDED_RUNS]
    evals_by_run: dict[str, list[dict]] = {}
    if eval_path.exists():
        with eval_path.open("r", encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                row = json.loads(line)
                evals_by_run.setdefault(row["run_id"], []).append(row)

    nat_high = [r for r in healthy if r.get("rehearsal_strategy") == "NATURAL_BASELINE" and abs(float(r.get("peak_lr") or 0) - 3e-5) < 1e-12]
    reproduced = []
    for r in nat_high:
        evs = evals_by_run.get(r["run_id"], r.get("evals") or [])
        steps = warning_timeline(evs)
        last = evs[-1] if evs else {}
        cap02 = None
        for it in last.get("items") or []:
            if it.get("evalId") == "cap0-ret-02" or it.get("cap02_item"):
                cap02 = it
                break
        hit = bool(steps) or int(last.get("historical_pass_count") or 6) < 6
        reproduced.append(
            {
                "run_id": r["run_id"],
                "warning": hit,
                "warning_steps": steps,
                "final_binary": last.get("historical_binary") or r.get("final_binary"),
                "cap0_ret_02_anchor_nll_delta": None if cap02 is None else cap02.get("wrim0_anchor_nll_delta"),
                "cap0_ret_02_kl": None if cap02 is None else cap02.get("kl_wrim0_to_candidate"),
                "cap0_ret_02_fp32": None if cap02 is None else cap02.get("fp32"),
                "cap0_ret_02_fp256": None if cap02 is None else cap02.get("fp256"),
            }
        )
    n_warn = sum(1 for x in reproduced if x["warning"])
    majority = n_warn >= 6
    reproduction = {
        "cell": "NATURAL_BASELINE + 3e-5",
        "n": len(nat_high),
        "n_historical_6_to_5_warning": n_warn,
        "majority_reproduces_STAB000001": majority,
        "runs": reproduced,
        "note": "Do not call STAB-000001 robustly reproduced unless a clear majority supports it.",
    }

    cells = {}
    for strategy in STRATEGIES:
        for lr in PEAK_LRS:
            cid = factor_cell_id(strategy, lr)
            subset = [r for r in healthy if r.get("rehearsal_strategy") == strategy and abs(float(r.get("peak_lr") or 0) - lr) < 1e-12]
            cells[cid] = {
                "n": len(subset),
                "final_mean_anchor_nll_delta": five_stats([float(r.get("final_mean_wrim0_anchor_nll_delta")) for r in subset if r.get("final_mean_wrim0_anchor_nll_delta") is not None]),
                "final_worst_item_anchor_nll_delta": five_stats([float(r.get("final_worst_item_wrim0_anchor_nll_delta")) for r in subset if r.get("final_worst_item_wrim0_anchor_nll_delta") is not None]),
                "final_mean_kl": five_stats([float(r.get("final_mean_kl")) for r in subset if r.get("final_mean_kl") is not None]),
                "val_loss_corpus0": five_stats([float(r.get("final_val_loss_corpus0")) for r in subset if r.get("final_val_loss_corpus0") is not None]),
                "val_loss_corpus1": five_stats([float(r.get("final_val_loss_corpus1")) for r in subset if r.get("final_val_loss_corpus1") is not None]),
                "binary_retention_count": five_stats([float(str(r.get("final_binary") or "0/6").split("/")[0]) for r in subset]),
                "gini": five_stats([float(r.get("final_gini")) for r in subset if r.get("final_gini") is not None]),
                "normalized_entropy": five_stats([float(r.get("final_normalized_entropy")) for r in subset if r.get("final_normalized_entropy") is not None]),
                "clip_rate": five_stats([float(r.get("clip_rate")) for r in subset if r.get("clip_rate") is not None]),
                "update_norm": five_stats([float(r.get("mean_update_norm")) for r in subset if r.get("mean_update_norm") is not None]),
                "parameter_displacement": five_stats([float(r.get("final_parameter_displacement_total")) for r in subset if r.get("final_parameter_displacement_total") is not None]),
            }

    def cell_mean(cid: str, key: str) -> float | None:
        m = (cells.get(cid) or {}).get(key) or {}
        return m.get("mean")

    nh = cell_mean("NATURAL_BASELINE__3e-5", "final_mean_anchor_nll_delta")
    nl = cell_mean("NATURAL_BASELINE__2e-5", "final_mean_anchor_nll_delta")
    bh = cell_mean("BALANCED_GENESIS__3e-5", "final_mean_anchor_nll_delta")
    bl = cell_mean("BALANCED_GENESIS__2e-5", "final_mean_anchor_nll_delta")
    noise_vals = [float((row.get("final_mean_anchor_nll_delta") or {}).get("sd") or 0.0) for row in cells.values()]
    noise = max(float(statistics.mean(noise_vals)) if noise_vals else 0.0, 1e-4)
    rehearsal_high = None if None in (bh, nh) else float(bh) - float(nh)
    rehearsal_low = None if None in (bl, nl) else float(bl) - float(nl)
    lr_nat = None if None in (nl, nh) else float(nl) - float(nh)
    lr_bal = None if None in (bl, bh) else float(bl) - float(bh)
    rehearsal_effect = None if None in (rehearsal_high, rehearsal_low) else statistics.mean([rehearsal_high, rehearsal_low])
    lr_effect = None if None in (lr_nat, lr_bal) else statistics.mean([lr_nat, lr_bal])
    interaction = None if None in (rehearsal_high, rehearsal_low) else rehearsal_high - rehearsal_low
    reh_matters = rehearsal_effect is not None and abs(rehearsal_effect) > 2.0 * noise
    lr_matters = lr_effect is not None and abs(lr_effect) > 2.0 * noise
    inter_uncertain = interaction is None or abs(interaction) <= 2.0 * noise

    ginis = [float(r["final_gini"]) for r in healthy if r.get("final_gini") is not None]
    ents = [float(r["final_normalized_entropy"]) for r in healthy if r.get("final_normalized_entropy") is not None]
    deltas = [float(r["final_mean_wrim0_anchor_nll_delta"]) for r in healthy if r.get("final_mean_wrim0_anchor_nll_delta") is not None]
    kls = [float(r["final_mean_kl"]) for r in healthy if r.get("final_mean_kl") is not None]
    warns = [1.0 if str(r.get("final_binary") or "6/6") != "6/6" else 0.0 for r in healthy]
    skew = {
        "pearson_gini_vs_mean_anchor_nll_delta": pearson(ginis, deltas) if len(ginis) == len(deltas) else None,
        "pearson_entropy_vs_mean_anchor_nll_delta": pearson(ents, deltas) if len(ents) == len(deltas) else None,
        "pearson_gini_vs_mean_kl": pearson(ginis, kls) if len(ginis) == len(kls) else None,
        "pearson_gini_vs_retention_warning": pearson(ginis, warns) if len(ginis) == len(warns) else None,
        "note": "Generic literary probes are synthetic/unmapped. No per-item source-document regression.",
    }

    clip_high = cell_mean("NATURAL_BASELINE__3e-5", "clip_rate")
    clip_low = cell_mean("NATURAL_BASELINE__2e-5", "clip_rate")
    upd_high = cell_mean("NATURAL_BASELINE__3e-5", "update_norm")
    upd_low = cell_mean("NATURAL_BASELINE__2e-5", "update_norm")
    clip_confound = False
    clip_note = "clip rates recorded per LR arm"
    if clip_high is not None and clip_low is not None and upd_high is not None and upd_low is not None:
        if clip_high > 0.5 and clip_low > 0.5 and abs(upd_high - upd_low) < 0.25 * max(abs(upd_high), abs(upd_low), 1e-9):
            clip_confound = True
            clip_note = "Both LR arms clipped heavily and realized update norms are similar; clipping weakened the effective LR contrast. Do not treat an LR null as strong evidence."

    v0_mean = statistics.mean([float(r["final_val_loss_corpus0"]) for r in healthy if r.get("final_val_loss_corpus0") is not None] or [VAL_CORPUS0_BASELINE])
    v1_mean = statistics.mean([float(r["final_val_loss_corpus1"]) for r in healthy if r.get("final_val_loss_corpus1") is not None] or [VAL_CORPUS1_BASELINE])
    tradeoff = (v0_mean - VAL_CORPUS0_BASELINE) > 0.05 and (VAL_CORPUS1_BASELINE - v1_mean) > 0.05

    label = "G"
    name = "INCONCLUSIVE"
    if not majority and not reh_matters and not lr_matters:
        label, name = "D", "ORIGINAL_RETENTION_EVENT_NOT_RELIABLY_REPRODUCED"
    elif tradeoff and (reh_matters or lr_matters):
        label, name = "F", "MULTIPLE_EFFECTS_OR_CAPACITY_TRADEOFF"
    elif reh_matters and lr_matters:
        label, name = "C", "BOTH_MATTER"
    elif lr_matters and not reh_matters:
        label, name = "A", "LR_EFFECT_DOMINANT"
    elif reh_matters and not lr_matters:
        label, name = "B", "REHEARSAL_POLICY_EFFECT_DOMINANT"
    if inter_uncertain and label in ("A", "B", "C"):
        interaction_note = "policy × LR interaction remains uncertain; absence of an obvious interaction is not proof of no interaction."
    else:
        interaction_note = "interaction assessed vs 2× within-cell SD; engineering estimate only."

    disp_mean = statistics.mean([float(r["final_parameter_displacement_total"]) for r in healthy if r.get("final_parameter_displacement_total") is not None] or [0.0])
    nll_mean = statistics.mean(deltas) if deltas else 0.0
    kl_mean = statistics.mean(kls) if kls else 0.0
    interp_worth = bool(disp_mean > 1e-3 and (abs(nll_mean) > 0.05 or kl_mean > 0.05) and (tradeoff or majority or reh_matters or lr_matters))
    stage3_design = bool(len(healthy) == 40 and (majority or reh_matters or lr_matters or tradeoff))

    return {
        "reproduction": reproduction,
        "cells": cells,
        "factor_effects": {
            "rehearsal_policy_effect_BALANCED_minus_NATURAL": rehearsal_effect,
            "peak_lr_effect_LOW_minus_HIGH": lr_effect,
            "policy_x_lr_interaction": interaction,
            "within_cell_sd_mean": noise,
            "rehearsal_matters": reh_matters,
            "lr_matters": lr_matters,
            "interaction_uncertain": inter_uncertain,
            "interaction_note": interaction_note,
            "seed_semantics": "DATA_ORDER_PACKING_VARIANCE",
        },
        "realized_skew": skew,
        "clip_confound": {"weakened_lr_contrast": clip_confound, "note": clip_note},
        "validation_tradeoff": {
            "mean_val_loss_corpus0": v0_mean,
            "mean_val_loss_corpus1": v1_mean,
            "baseline_corpus0": VAL_CORPUS0_BASELINE,
            "baseline_corpus1": VAL_CORPUS1_BASELINE,
            "upstream_worsened_downstream_improved": tradeoff,
        },
        "classification_code": label,
        "classification": name,
        "interpolation_recommendation": {
            "run_now": False,
            "worth_requesting_later": interp_worth,
            "reason": "Recommend only if displacement, anchor-NLL/KL drift, and validation tradeoff jointly justify a later Commander-authorized interpolation. Not executed.",
            "mean_parameter_displacement": disp_mean,
            "mean_anchor_nll_delta": nll_mean,
            "mean_kl": kl_mean,
        },
        "stage3_design_readiness": "YES" if stage3_design else "NO",
        "stage3_authorization": "NO",
        "n_healthy": len(healthy),
        "n_aborted": len(runs) - len(healthy),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--dump-root", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--ckpt-root", required=True)
    ap.add_argument("--frozen-nll", required=True)
    ap.add_argument("--harness", required=True)
    ap.add_argument("--phase0-report", required=True)
    ap.add_argument("--preregistration", required=True)
    ap.add_argument("--authorization", required=True)
    args = ap.parse_args()

    if args.authorization != "PHASE2_GRID_ONLY":
        print(json.dumps({"ok": False, "error": "authorization must be PHASE2_GRID_ONLY"}, indent=2))
        return 3

    weights = Path(args.weights)
    tokenizer_path = Path(args.tokenizer)
    dump_root = Path(args.dump_root)
    report_path = Path(args.report)
    ckpt_root = Path(args.ckpt_root)
    frozen_path = Path(args.frozen_nll)
    harness_path = Path(args.harness)
    phase0_path = Path(args.phase0_report)
    prereg_src = Path(args.preregistration)
    ckpt_root.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)

    if (ckpt_root / "GRID_COMPLETE.json").exists() and not (ckpt_root / "ABORT.json").exists():
        print(json.dumps({"ok": False, "error": "grid already complete; refusing extra training"}, indent=2))
        return 3

    disable_tf32()
    if not torch.cuda.is_available():
        payload = {"ok": False, "error": "CUDA required", "experiment_id": EXPERIMENT_ID}
        write_json(report_path, payload)
        return 2

    parent_mtime = weights.stat().st_mtime_ns
    parent_sha = sha256_file(weights)
    tok_sha = sha256_file(tokenizer_path)
    harness = json.loads(harness_path.read_text(encoding="utf-8"))
    harness_sha = str(harness.get("artifact_sha256") or "")
    frozen_sha = sha256_json_text(frozen_path)
    sidecar = harness_path.with_suffix(".sha256")
    sidecar_sha = sidecar.read_text(encoding="utf-8").strip() if sidecar.exists() else harness_sha
    if sidecar_sha != HARNESS_SHA or harness_sha != HARNESS_SHA:
        payload = {
            "ok": False,
            "error": "HASH_MISMATCH",
            "parent_sha": parent_sha,
            "tokenizer_sha": tok_sha,
            "harness_sha": harness_sha,
            "harness_sidecar_sha": sidecar_sha,
            "frozen_nll_sha": frozen_sha,
            "note": "Harness identity is the Phase 1 declared artifact_sha256 / sidecar, not a rehash of on-disk newlines.",
        }
        write_json(report_path, payload)
        return 2
    phase0 = json.loads(phase0_path.read_text(encoding="utf-8")) if phase0_path.exists() else {}
    phase0_blocking = bool((phase0.get("leakage_audit") or {}).get("blocking_failure"))
    if harness.get("verdict") != "PHASE1_GREEDY_DETERMINISM_PASS":
        payload = {"ok": False, "error": "Phase 1 harness PASS required", "verdict": harness.get("verdict")}
        write_json(report_path, payload)
        return 2
    if parent_sha != PARENT_SHA or tok_sha != TOKENIZER_SHA or frozen_sha != FROZEN_NLL_SHA:
        payload = {
            "ok": False,
            "error": "HASH_MISMATCH",
            "parent_sha": parent_sha,
            "tokenizer_sha": tok_sha,
            "harness_sha": harness_sha,
            "frozen_nll_sha": frozen_sha,
        }
        write_json(report_path, payload)
        return 2

    shutil.copy2(prereg_src, ckpt_root / "PREREGISTRATION.md")
    device = torch.device("cuda")
    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    dropout_n = sum(1 for m in WRIM0Model().modules() if isinstance(m, torch.nn.Dropout))
    if dropout_n != 0:
        payload = {"ok": False, "error": "dropout modules present", "n": dropout_n}
        write_json(report_path, payload)
        return 2

    parent_model, parent_hash, n_params = load_parent_model(weights, device)
    parent_model.freeze_inference()
    if n_params != EXPECTED_PARAMS:
        payload = {"ok": False, "error": "param count mismatch", "n": n_params}
        write_json(report_path, payload)
        return 2
    parent_cpu = {k: v.detach().cpu().contiguous() for k, v in parent_model.state_dict().items()}
    targets = load_frozen_targets(frozen_path, tokenizer, dump_root)
    wrim0_logp: dict[str, torch.Tensor] = {}
    print("[phase2] precomputing WRIM-0 log-softmax for KL", flush=True)
    for tgt in targets["items"]:
        bundle = teacher_force_anchor(parent_model, tgt["prompt_ids"], tgt["target_ids"], device, None)
        wrim0_logp[tgt["evalId"]] = bundle["log_softmax"]
        if abs(float(bundle["wrim0_anchor_nll"]) - float(tgt["nll_wrim0"])) > VAL_BASELINE_ABS_TOL:
            payload = {
                "ok": False,
                "error": "WRIM0_ANCHOR_NLL disagreement vs frozen artifact",
                "evalId": tgt["evalId"],
                "computed": bundle["wrim0_anchor_nll"],
                "frozen": tgt["nll_wrim0"],
            }
            write_json(report_path, payload)
            write_json(ckpt_root / "ABORT.json", payload)
            return 2

    print("[phase2] packing Phase-1-compatible separated val streams", flush=True)
    c0_stream = concat_units(encode_rehearsal_val_units(tokenizer, dump_root))
    c1_stream = concat_units(encode_corpus1_val_units(tokenizer, dump_root))
    v0 = measure_val_loss(parent_model, c0_stream, device)
    v1 = measure_val_loss(parent_model, c1_stream, device)
    if v0 is None or v1 is None or abs(v0 - VAL_CORPUS0_BASELINE) > VAL_BASELINE_ABS_TOL or abs(v1 - VAL_CORPUS1_BASELINE) > VAL_BASELINE_ABS_TOL:
        payload = {
            "ok": False,
            "error": "val_loss baseline disagreement vs Phase 1",
            "val_loss_corpus0": v0,
            "val_loss_corpus1": v1,
            "expected": [VAL_CORPUS0_BASELINE, VAL_CORPUS1_BASELINE],
        }
        write_json(report_path, payload)
        write_json(ckpt_root / "ABORT.json", payload)
        return 2

    del parent_model
    torch.cuda.empty_cache()

    print("[phase2] encoding families once", flush=True)
    raw = encode_raw_families(dump_root, tokenizer)

    hw = {
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
        "python": sys.version.split()[0],
        "fp32": True,
        "tf32": False,
        "dropout": 0,
        "replicate_factor": "DATA_ORDER_PACKING_VARIANCE",
        "additional_stochastic_sources": [
            "CUDA backward atomic reduction order is possible residual float noise; greedy generation was bit-identical in Phase 1.",
        ],
    }
    config = {
        "experiment_id": EXPERIMENT_ID,
        "classification": "TEST_ONLY / CONTROLLED_EXPERIMENT",
        "parent_sha256": PARENT_SHA,
        "tokenizer_sha256": TOKENIZER_SHA,
        "architecture": "WRIM-G-20M-v1-option-A",
        "parameters": EXPECTED_PARAMS,
        "phase1_harness_sha256": HARNESS_SHA,
        "wrim0_anchor_nll_artifact_sha256": FROZEN_NLL_SHA,
        "TRAINING_AUTHORIZATION": "PHASE2_GRID_ONLY",
        "factors": {"rehearsal": STRATEGIES, "peak_lr": PEAK_LRS, "seeds": SEEDS},
        "invariants": {
            "sequence_length": 512,
            "micro_batch": 8,
            "gradient_accumulation": 1,
            "effective_batch": 8,
            "precision": "FP32",
            "tf32": False,
            "max_steps": 50,
            "tokens_per_step": TOKENS_PER_STEP,
            "max_tokens_per_run": TRAIN_PREFIX_TOKENS,
            "optimizer": "fresh AdamW",
            "betas": list(BETAS),
            "eps": EPS,
            "weight_decay": WEIGHT_DECAY,
            "grad_clip": GRAD_CLIP,
            "warmup_steps": WARMUP,
            "schedule": "warmup_cosine",
            "packing": "contiguous_unit",
            "bos": BOS_ID,
            "eos": EOS_ID,
            "per_token_shuffle": False,
            "TOOL_USE": 0,
            "WR_CORPUS_ACTIVE": 0,
            "WR_CORPUS_0": 0.30,
            "WR_CORPUS_1": 0.70,
            "code_share_target": CODE_SHARE_TARGET,
        },
        "hardware": hw,
        "eval_steps": EVAL_STEPS,
        "denied": [
            "accum=4",
            "SKEWED_BASELINE",
            "interpolation",
            "Stage 3",
            "promotion",
            "Qwen replacement",
            "Ra'el",
            "sparse experts",
        ],
        "utc": utc_now(),
    }
    write_json(ckpt_root / "CONFIG.json", config)

    logs = {
        "runs": ckpt_root / "runs.jsonl",
        "eval": ckpt_root / "eval_metrics.jsonl",
        "training": ckpt_root / "training_metrics.jsonl",
        "checkpoints": ckpt_root / "checkpoints.jsonl",
    }

    print("[phase2] preflight packing all 40 cells before optimizer step 1", flush=True)
    for strategy in STRATEGIES:
        for peak_lr in PEAK_LRS:
            for seed in SEEDS:
                packed = pack_train_stream(raw, tokenizer, strategy=strategy, seed=seed, dump_root=dump_root)
                ok, reasons = validate_experiment_invariants(
                    parent_sha=parent_sha,
                    tokenizer_sha=tok_sha,
                    harness_sha=harness_sha,
                    frozen_nll_sha=frozen_sha,
                    n_params=n_params,
                    strategy=strategy,
                    peak_lr=peak_lr,
                    audit=packed["audit"],
                    free_gb=disk_gb(ckpt_root),
                    phase0_blocking=phase0_blocking,
                    dropout_modules=dropout_n,
                )
                rid = cell_id(strategy, peak_lr, seed)
                if not ok:
                    abort_grid(
                        ckpt_root,
                        {
                            "run_id": rid,
                            "stopped_reason": "preflight mix/validate_experiment failed BEFORE STEP 1",
                            "hard_stop_rule": "; ".join(reasons),
                            "mix": packed["audit"].get("mix_assertions"),
                        },
                    )
                    write_json(report_path, {"ok": False, "error": "preflight abort", "run_id": rid, "reasons": reasons})
                    return 2
                print(f"[phase2] preflight OK {rid} mix={packed['audit'].get('mix_assertions')}", flush=True)

    runs: list[dict] = []
    t_grid = time.perf_counter()
    for strategy in STRATEGIES:
        for peak_lr in PEAK_LRS:
            for seed in SEEDS:
                rid = cell_id(strategy, peak_lr, seed)
                print(f"[phase2] START {rid}", flush=True)
                row = run_one(
                    strategy=strategy,
                    peak_lr=peak_lr,
                    seed=seed,
                    raw_families=raw,
                    tokenizer=tokenizer,
                    dump_root=dump_root,
                    weights=weights,
                    out_root=ckpt_root,
                    logs=logs,
                    device=device,
                    parent_hash=parent_hash,
                    parent_cpu=parent_cpu,
                    targets=targets,
                    wrim0_logp=wrim0_logp,
                    parent_mtime=parent_mtime,
                    tokenizer_sha=tok_sha,
                    parent_file_sha=parent_sha,
                    harness_sha=harness_sha,
                    frozen_nll_sha=frozen_sha,
                    c0_stream=c0_stream,
                    c1_stream=c1_stream,
                    phase0_blocking=phase0_blocking,
                    n_params=n_params,
                )
                runs.append(row)
                if not row.get("ok"):
                    abort_grid(
                        ckpt_root,
                        {
                            "run_id": rid,
                            "stopped_reason": row.get("stopped_reason") or row.get("status"),
                            "hard_stop_rule": row.get("hard_stop_rule"),
                            "completed_before_abort": [r.get("run_id") for r in runs if r.get("ok")],
                        },
                    )
                    write_json(
                        report_path,
                        {
                            "ok": False,
                            "experiment_id": EXPERIMENT_ID,
                            "TRAINING_AUTHORIZATION": "OFF",
                            "runs_completed": sum(1 for r in runs if r.get("ok")),
                            "runs_aborted": 1,
                            "abort_run": rid,
                            "hard_stop_rule": row.get("hard_stop_rule"),
                            "stage3_started": False,
                            "interpolation_executed": False,
                        },
                    )
                    return 2

    analysis = analyze_grid(runs, logs["eval"])
    summary = {
        "ok": True,
        "experiment_id": EXPERIMENT_ID,
        "phase": 2,
        "kind": "TEST_ONLY",
        "runs_completed": len(runs),
        "runs_aborted": 0,
        "optimizer_steps_per_run": STEPS,
        "gradient_accumulation": 1,
        "micro_batch": 8,
        "effective_batch": 8,
        "parent_sha256": PARENT_SHA,
        "tokenizer_sha256": TOKENIZER_SHA,
        "harness_sha256": HARNESS_SHA,
        "wrim0_anchor_nll_artifact_sha256": FROZEN_NLL_SHA,
        "hardware": hw,
        "elapsed_s": round(time.perf_counter() - t_grid, 3),
        "analysis": analysis,
        "classification": analysis["classification"],
        "classification_code": analysis["classification_code"],
        "interpolation_executed": False,
        "stage3_started": False,
        "READY_FOR_STAGE3_TRAINING_AUTHORIZATION": "NO",
        "stage3_design_readiness": analysis["stage3_design_readiness"],
        "TRAINING_AUTHORIZATION": "OFF",
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "RAEL": "NOT_IMPLEMENTED",
        "QWEN": "THIRD_PARTY_MODEL_RUNNING_LOCALLY",
        "promotion_candidate": False,
        "parent_unmodified": weights.stat().st_mtime_ns == parent_mtime,
        "utc": utc_now(),
        "artifact_root": str(ckpt_root),
    }
    write_json(ckpt_root / "experiment_summary.json", summary)
    write_json(ckpt_root / "GRID_COMPLETE.json", {"ok": True, "utc": utc_now(), "runs": len(runs)})
    write_json(report_path, summary)
    print(json.dumps({"ok": True, "classification": analysis["classification"], "runs": len(runs)}, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
