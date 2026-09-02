"""TEST_ONLY observability for WRIM-1.1 recovery. Does not change training updates."""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np

from contiguous_pack import HELD_OUT_PROMPT_STRINGS, is_eval_infra_text, leak_hits
from dataset_cursor import initial_cursor, next_batch


def layer_key(name: str) -> str:
    if name.startswith("tok_emb") or "tok_emb" in name:
        return "tok_emb"
    if name.startswith("norm_f") or name == "norm_f.weight":
        return "norm_f"
    if name.startswith("layers."):
        parts = name.split(".")
        if len(parts) >= 2 and parts[1].isdigit():
            return f"layers.{parts[1]}"
    return "other"


def global_l2_from_leaves(leaves: list[tuple[str, Any]]) -> float:
    import mlx.core as mx
    acc = None
    for _, g in leaves:
        s = mx.sum(g.astype(mx.float32) ** 2)
        acc = s if acc is None else acc + s
    import mlx.core as mx2
    mx2.eval(acc)
    return float(np.sqrt(float(acc.item()))) if acc is not None else 0.0


def grad_instrumentation(grads) -> dict:
    import mlx.core as mx
    import mlx.utils
    leaves = [(k, g) for k, g in mlx.utils.tree_flatten(grads)]
    global_sq = None
    by_layer: dict[str, Any] = {}
    finite_acc = None
    for name, g in leaves:
        s = mx.sum(g.astype(mx.float32) ** 2)
        global_sq = s if global_sq is None else global_sq + s
        lk = layer_key(name)
        by_layer[lk] = s if lk not in by_layer else by_layer[lk] + s
        fin = mx.all(mx.isfinite(g))
        finite_acc = fin if finite_acc is None else (finite_acc & fin)
    eval_list = [global_sq, finite_acc, *by_layer.values()]
    mx.eval(*[x for x in eval_list if x is not None])
    per_layer = {k: float(np.sqrt(float(v.item()))) for k, v in sorted(by_layer.items())}
    return {
        "finite": bool(finite_acc.item()) if finite_acc is not None else True,
        "global_grad_l2": float(np.sqrt(float(global_sq.item()))) if global_sq is not None else 0.0,
        "per_layer_grad_l2": per_layer,
        "n_grad_tensors": len(leaves),
    }


def numpy_param_map(model) -> dict[str, np.ndarray]:
    import mlx.utils
    return {k: np.array(v) for k, v in mlx.utils.tree_flatten(model.parameters())}


def param_drift_vs_parent(current: dict[str, np.ndarray], parent: dict[str, np.ndarray]) -> dict:
    keys = sorted(set(current) & set(parent))
    delta_sq = 0.0
    parent_sq = 0.0
    by_layer_dot = defaultdict(float)
    by_layer_c = defaultdict(float)
    by_layer_p = defaultdict(float)
    by_layer_d = defaultdict(float)
    max_abs = 0.0
    for k in keys:
        a = parent[k].astype(np.float64).ravel()
        b = current[k].astype(np.float64).ravel()
        d = b - a
        delta_sq += float(np.dot(d, d))
        parent_sq += float(np.dot(a, a))
        max_abs = max(max_abs, float(np.max(np.abs(d))))
        lk = layer_key(k)
        by_layer_dot[lk] += float(np.dot(a, b))
        by_layer_c[lk] += float(np.dot(b, b))
        by_layer_p[lk] += float(np.dot(a, a))
        by_layer_d[lk] += float(np.dot(d, d))
    l2 = float(np.sqrt(delta_sq))
    parent_l2 = float(np.sqrt(parent_sq)) if parent_sq else 1.0
    per_layer_cosine = {}
    per_layer_l2 = {}
    for lk in sorted(by_layer_p):
        denom = float(np.sqrt(by_layer_p[lk]) * np.sqrt(by_layer_c[lk]))
        per_layer_cosine[lk] = (by_layer_dot[lk] / denom) if denom else None
        per_layer_l2[lk] = float(np.sqrt(by_layer_d[lk]))
    emb_keys = [k for k in keys if "tok_emb" in k]
    emb_l2 = 0.0
    for k in emb_keys:
        d = current[k].astype(np.float64) - parent[k].astype(np.float64)
        emb_l2 += float(np.sum(d ** 2))
    return {
        "global_param_l2_from_wrim0": l2,
        "relative_param_drift": l2 / parent_l2,
        "parent_param_l2": parent_l2,
        "max_abs_delta": max_abs,
        "per_layer_cosine_to_wrim0": per_layer_cosine,
        "per_layer_l2_from_wrim0": per_layer_l2,
        "embedding_param_l2_from_wrim0": float(np.sqrt(emb_l2)),
        "tied_embedding_output_head": True,
        "tied_output_head_drift_equals_embedding": True,
        "n_tensors": len(keys),
    }


def build_retention_windows(
    *,
    root: Path,
    tokenizer,
    n_windows: int = 16,
    win: int = 64,
    seed: int = 20260830,
) -> dict:
    """Frozen contiguous WR-CORPUS-0 windows (Alice/held-out dropped). TEST_ONLY."""
    wrim0 = np.load(root / "model-lab/manifests/wrim0_corpus_shards/train.npy")
    man = json.loads((root / "model-lab/manifests/wrim0_corpus_shards/shard-manifest.json").read_text())
    offset = 0
    clean_spans = []
    dropped = 0
    for doc in man.get("trainDocs") or []:
        n = int(doc["tokenCount"])
        sl = np.array(wrim0[offset:offset + n], dtype=np.int32)
        offset += n
        decoded = tokenizer.decode(sl.tolist(), skip_special_tokens=True)
        if is_eval_infra_text(decoded, "WR-CORPUS-0"):
            dropped += 1
            continue
        clean_spans.append(sl)
    stream = np.concatenate(clean_spans) if clean_spans else np.zeros((0,), dtype=np.int32)
    rng = np.random.default_rng(seed)
    usable = stream.size - win
    windows = []
    if usable > 0:
        starts = rng.choice(usable, size=min(n_windows, usable), replace=False)
        starts = np.sort(starts)
        for s in starts:
            windows.append(np.array(stream[int(s):int(s) + win], dtype=np.int32))
    hits = []
    for w in windows:
        h = leak_hits(tokenizer.decode(w.tolist(), skip_special_tokens=True))
        if h:
            hits.append(h)
    stacked = np.stack(windows) if windows else np.zeros((0, win), dtype=np.int32)
    return {
        "windows": stacked,
        "n_windows": int(stacked.shape[0]),
        "win": win,
        "positions": int(stacked.shape[0] * max(0, win - 1)),
        "alice_docs_dropped": dropped,
        "leak_hits": hits,
        "stream_tokens_clean": int(stream.size),
    }


def logits_for_windows(model, windows: np.ndarray) -> np.ndarray:
    """Return float32 logits [N, T-1, V] for next-token positions."""
    import mlx.core as mx
    x = mx.array(windows[:, :-1])
    logits = model(x)
    mx.eval(logits)
    return np.array(logits, dtype=np.float32)


def kl_mean_from_logits(parent: np.ndarray, current: np.ndarray) -> dict:
    """Observational KL. parent/current: [N, S, V]. Not a universal threshold."""
    def softmax(z):
        z = z.astype(np.float64)
        z = z - z.max(axis=-1, keepdims=True)
        e = np.exp(z)
        return e / e.sum(axis=-1, keepdims=True)

    p = softmax(parent)
    q = softmax(current)
    p = np.clip(p, 1e-12, 1.0)
    q = np.clip(q, 1e-12, 1.0)
    kl_pq = (p * (np.log(p) - np.log(q))).sum(axis=-1)
    kl_qp = (q * (np.log(q) - np.log(p))).sum(axis=-1)
    abs_logit = np.mean(np.abs(parent.astype(np.float64) - current.astype(np.float64)))
    return {
        "mean_kl_wrim0_to_current": float(np.mean(kl_pq)),
        "mean_kl_current_to_wrim0": float(np.mean(kl_qp)),
        "mean_abs_logit_delta": float(abs_logit),
        "n_positions": int(kl_pq.size),
        "finite": bool(np.isfinite(kl_pq).all() and np.isfinite(kl_qp).all()),
        "observational_not_universal_threshold": True,
    }


def build_expanded_prompts(*, root: Path, tokenizer, n: int = 87, seed: int = 20260830) -> list[dict]:
    wrim0 = np.load(root / "model-lab/manifests/wrim0_corpus_shards/train.npy")
    man = json.loads((root / "model-lab/manifests/wrim0_corpus_shards/shard-manifest.json").read_text())
    offset = 0
    clean = []
    for doc in man.get("trainDocs") or []:
        ntok = int(doc["tokenCount"])
        sl = np.array(wrim0[offset:offset + ntok], dtype=np.int32)
        offset += ntok
        decoded = tokenizer.decode(sl.tolist(), skip_special_tokens=True)
        if is_eval_infra_text(decoded, "WR-CORPUS-0"):
            continue
        clean.append(sl)
    stream = np.concatenate(clean) if clean else np.zeros((0,), dtype=np.int32)
    rng = np.random.default_rng(seed + 17)
    items = []
    plen = 12
    tries = 0
    used = set()
    while len(items) < n and tries < n * 40 and stream.size > plen + 8:
        tries += 1
        start = int(rng.integers(0, stream.size - plen))
        if start in used:
            continue
        used.add(start)
        ids = stream[start:start + plen].tolist()
        text = tokenizer.decode(ids, skip_special_tokens=True).strip()
        if len(text) < 8:
            continue
        if any(p in text for p in HELD_OUT_PROMPT_STRINGS):
            continue
        if leak_hits(text):
            continue
        items.append({
            "id": f"x87-{len(items):03d}",
            "category": "wrim0_distribution_prefix",
            "input": text,
            "frozen": True,
            "test_only": True,
        })
    return items


def unit_behavior_mask_audit(train_units, tokenizer) -> dict:
    assistant_id = tokenizer.token_to_id("<|assistant|>")
    lm_full = 0
    lm_not_full = 0
    beh_ok = 0
    beh_bad = 0
    n_beh = 0
    for u in train_units:
        mask = np.asarray(u.loss_mask)
        if u.bucket != "behavior":
            if int(np.sum(mask == 1)) == mask.size:
                lm_full += 1
            else:
                lm_not_full += 1
            continue
        n_beh += 1
        ids = u.tokens.tolist()
        if assistant_id is None or assistant_id not in ids:
            beh_bad += mask.size
            continue
        apos = ids.index(assistant_id)
        for i, m in enumerate(mask.tolist()):
            expect = 1 if i > apos else 0
            if int(m) == expect:
                beh_ok += 1
            else:
                beh_bad += 1
    return {
        "passed": beh_bad == 0 and lm_not_full == 0 and n_beh > 0,
        "behavior_units": n_beh,
        "behavior_mask_tokens_ok": beh_ok,
        "behavior_mask_tokens_bad": beh_bad,
        "lm_units_full_causal": lm_full,
        "lm_units_not_full_causal": lm_not_full,
    }


def causal_and_mask_audit(
    *,
    train_stream: np.ndarray,
    train_mask: np.ndarray,
    tokenizer,
    ctx: int,
    batch: int,
    seed: int,
    n_batches: int = 8,
) -> dict:
    eos_id = tokenizer.token_to_id("<|eos|>")
    bos_id = tokenizer.token_to_id("<|bos|>")
    assistant_id = tokenizer.token_to_id("<|assistant|>")
    cursor = initial_cursor(train_stream.size, ctx, batch, seed)
    mismatches = 0
    inspected = 0
    eos_contexts = 0
    bos_after_eos = 0
    behavior_windows = 0
    mask_ok = 0
    mask_bad = 0
    examples = []
    for b_i in range(n_batches):
        x, y, w, cursor = next_batch(train_stream, cursor, loss_mask=train_mask)
        inspected += int(x.shape[0])
        for i in range(x.shape[0]):
            if not np.array_equal(y[i, :-1], x[i, 1:]):
                mismatches += 1
            if eos_id is not None and eos_id in x[i].tolist():
                eos_contexts += 1
                pos = int(np.where(x[i] == eos_id)[0][0])
                if pos + 1 < x.shape[1] and bos_id is not None and int(x[i, pos + 1]) == int(bos_id):
                    bos_after_eos += 1
                if pos < y.shape[1] and pos + 1 < x.shape[1]:
                    if int(y[i, pos]) != int(x[i, pos + 1]):
                        mismatches += 1
            if assistant_id is not None and assistant_id in x[i].tolist():
                behavior_windows += 1
                apos_in_stream_window = int(np.where(x[i] == assistant_id)[0][0])
                # target index t predicts stream[start+1+t]; mask[t] should be 1 iff that position > assistant
                for t in range(w.shape[1]):
                    stream_target_index = t + 1
                    should = 1.0 if stream_target_index > apos_in_stream_window else 0.0
                    if abs(float(w[i, t]) - should) < 1e-6:
                        mask_ok += 1
                    else:
                        mask_bad += 1
        if len(examples) < 6:
            examples.append({
                "batch": b_i,
                "x0_decoded_prefix": tokenizer.decode(x[0, :48].tolist(), skip_special_tokens=False),
                "has_eos": bool(eos_id in x[0].tolist()) if eos_id is not None else False,
                "has_assistant": bool(assistant_id in x[0].tolist()) if assistant_id is not None else False,
                "causal_ok_row0": bool(np.array_equal(y[0, :-1], x[0, 1:])),
            })
    # Guarantee a behavior-window check even if early batches miss <|assistant|>.
    if assistant_id is not None:
        hits = np.where(train_stream == assistant_id)[0]
        if hits.size:
            start = max(0, int(hits[0]) - 8)
            if start + ctx + 1 < train_stream.size:
                xw = train_stream[start:start + ctx]
                yw = train_stream[start + 1:start + ctx + 1]
                ww = train_mask[start + 1:start + ctx + 1]
                apos = int(np.where(xw == assistant_id)[0][0])
                behavior_windows += 1
                for t in range(ctx):
                    stream_target_index = t + 1
                    should = 1.0 if stream_target_index > apos else 0.0
                    if abs(float(ww[t]) - should) < 1e-6:
                        mask_ok += 1
                    else:
                        mask_bad += 1
                if not np.array_equal(yw[:-1], xw[1:]):
                    mismatches += 1
                examples.append({
                    "batch": "forced-assistant-window",
                    "assistant_stream_index": int(hits[0]),
                    "causal_ok": bool(np.array_equal(yw[:-1], xw[1:])),
                })
    passed = mismatches == 0
    return {
        "passed": passed,
        "n_batches": n_batches,
        "rows_inspected": inspected,
        "causal_y_equals_x_shift_mismatches": mismatches,
        "windows_containing_eos": eos_contexts,
        "eos_followed_by_bos_in_window": bos_after_eos,
        "behavior_windows_with_assistant": behavior_windows,
        "behavior_mask_positions_ok": mask_ok,
        "behavior_mask_positions_bad": mask_bad,
        "mixed_window_mask_check_observational": True,
        "examples": examples,
        "note": (
            "Hard gate is causal y[t]==x[t+1]. Mixed-window mask counts are observational "
            "(windows may include prior LM tokens before <|assistant|>)."
        ),
    }
