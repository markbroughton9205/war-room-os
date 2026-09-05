#!/usr/bin/env python3
"""TEST_ONLY forensic diagnosis for Recovery-004 steps 25–45.

Does NOT train. Does NOT mutate Recovery-001/002/003/004 checkpoints.
Writes only under TEST-WRIM1.1-RECOVERY-004-FORENSIC-STEP45/.
"""
from __future__ import annotations

import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from safetensors.numpy import load_file

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(SCRIPT_DIR.parent / "sovereign-model-lab"))

from contiguous_pack import materialize_recovery_mix  # noqa: E402
from dataset_cursor import initial_cursor, next_batch  # noqa: E402
from paths import repo_root  # noqa: E402
from rng_state import lr_at_step  # noqa: E402
from constants import TOKENIZER_REL, TOKENIZER_SHA256  # noqa: E402
from hashes import sha256_file  # noqa: E402
from tokenizers import Tokenizer, decoders  # noqa: E402

SRC = "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-004"
OUT = "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-004-FORENSIC-STEP45"
SEED = 20260830
BATCH = 8
CTX = 512
PEAK_LR = 3e-4
WARMUP = 25
SCHEDULER_TOTAL = 150
FLOOR_RATIO = 0.1
CLIP = 1.0
SECRET_RE = re.compile(
    r"(sk-[A-Za-z0-9_-]{8,}|api[_-]?key\s*[:=]\s*\S+|Bearer\s+[A-Za-z0-9._\-]+|"
    r"AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]+-----)",
    re.I,
)


def load_tokenizer(root: Path) -> Tokenizer:
    path = root / TOKENIZER_REL
    if sha256_file(path) != TOKENIZER_SHA256:
        raise RuntimeError("tokenizer hash mismatch")
    tok = Tokenizer.from_file(str(path))
    if tok.decoder is None:
        tok.decoder = decoders.ByteLevel()
    return tok


def redact(text: str) -> str:
    return SECRET_RE.sub("[REDACTED]", text or "")


def max_char_run(text: str) -> tuple[str, int]:
    best_ch, best_n, cur_ch, cur_n = "", 0, "", 0
    for c in text or "":
        if c == cur_ch:
            cur_n += 1
        else:
            cur_ch, cur_n = c, 1
        if cur_n > best_n:
            best_ch, best_n = cur_ch, cur_n
    return best_ch, best_n


def unusual_flags(text: str) -> list[str]:
    flags = []
    t = text or ""
    ch, n = max_char_run(t)
    if n >= 20:
        flags.append(f"char_run:{ch!r}x{n}")
    if t.count("|") >= 8:
        flags.append("pipe_dense")
    if t.count("_") >= 16:
        flags.append("underscore_dense")
    if t.count(":") >= 12:
        flags.append("colon_dense")
    if t.count("{") + t.count("}") >= 8:
        flags.append("brace_dense")
    if "\x00" in t or sum(1 for c in t if ord(c) < 9) > 4:
        flags.append("binary_looking")
    if t.count("\\u") >= 8 or t.count("\\x") >= 8:
        flags.append("escaped_blob")
    if "Traceback" in t or "Error:" in t:
        flags.append("stack_or_error")
    if "-----BEGIN" in t:
        flags.append("pem_blob")
    if len(t) > 80 and t.count(" ") / max(1, len(t)) < 0.04:
        flags.append("minified_or_dense")
    if t.count("|") >= 6 and "---" in t:
        flags.append("markdown_sep")
    return flags


def snippet(text: str, n: int = 240) -> str:
    t = redact(text).replace("\n", "\\n")
    return t[:n] + ("…" if len(t) > n else "")


def component_key(name: str) -> str:
    if "tok_emb" in name:
        return "tok_emb"
    if name.startswith("norm_f") or name == "norm_f.weight":
        return "norm_f"
    if ".attn.q." in name or name.endswith(".attn.q.weight"):
        return "attn_q"
    if ".attn.k." in name:
        return "attn_k"
    if ".attn.v." in name:
        return "attn_v"
    if ".attn.o." in name:
        return "attn_o"
    if ".ffn." in name or ".gate." in name or ".up." in name or ".down." in name:
        return "mlp"
    if ".attn_norm" in name or ".ffn_norm" in name:
        return "rmsnorm"
    if name.startswith("layers."):
        parts = name.split(".")
        if len(parts) >= 2 and parts[1].isdigit():
            return f"layers.{parts[1]}"
    return "other"


def opt_stats(path: Path) -> dict:
    tensors = load_file(str(path))
    m_vals = []
    v_vals = []
    keys = sorted(tensors)
    for k, arr in tensors.items():
        a = np.asarray(arr).astype(np.float64).ravel()
        lk = k.lower()
        if lk.endswith(".m") or ".m." in lk or lk.endswith("m") and "moment" in lk:
            m_vals.append(a)
        elif lk.endswith(".v") or ".v." in lk or "second" in lk:
            v_vals.append(a)
        elif "exp_avg_sq" in lk or lk.endswith("v"):
            v_vals.append(a)
        elif "exp_avg" in lk and "sq" not in lk:
            m_vals.append(a)
    # MLX AdamW often stores nested m/v under state
    if not m_vals or not v_vals:
        grouped = defaultdict(list)
        for k, arr in tensors.items():
            grouped[k.split(".")[-1]].append(np.asarray(arr).astype(np.float64).ravel())
        for last, parts in grouped.items():
            cat = np.concatenate(parts) if parts else np.zeros(1)
            if last in ("m", "0") and cat.size > 1000:
                m_vals.append(cat)
            if last in ("v", "1") and cat.size > 1000:
                v_vals.append(cat)
    def summarize(chunks: list[np.ndarray], label: str) -> dict:
        if not chunks:
            return {"present": False, "label": label}
        x = np.concatenate(chunks)
        ax = np.abs(x)
        return {
            "present": True,
            "label": label,
            "n": int(x.size),
            "mean_abs": float(ax.mean()),
            "median_abs": float(np.median(ax)),
            "max_abs": float(ax.max()),
            "mean": float(x.mean()),
            "std": float(x.std()),
            "finite": bool(np.isfinite(x).all()),
        }
    return {
        "n_tensors": len(tensors),
        "key_suffix_counts": dict(Counter(k.split(".")[-1] for k in keys)),
        "key_sample": keys[:20],
        "m": summarize(m_vals, "first_moment"),
        "v": summarize(v_vals, "second_moment"),
    }


def build_span_index(units) -> list[dict]:
    spans = []
    pos = 0
    for u in units:
        n = int(u.tokens.size)
        spans.append({
            "start": pos,
            "end": pos + n,
            "unit_id": u.unit_id,
            "bucket": u.bucket,
            "origin": u.origin,
            "source_path": u.source_path,
            "n_tokens": n,
            "n_eos": int(u.n_eos),
            "truncated": bool(u.truncated),
            "mask_ones": int(np.count_nonzero(u.loss_mask)),
            "mask_zeros": int(n - np.count_nonzero(u.loss_mask)),
        })
        pos += n
    return spans


def lookup_spans(spans: list[dict], start: int, end: int) -> list[dict]:
    hit = []
    for s in spans:
        lo = max(start, s["start"])
        hi = min(end, s["end"])
        if hi > lo:
            hit.append({**s, "overlap_tokens": hi - lo, "overlap_start": lo, "overlap_end": hi})
    return hit


def composition(hits: list[dict]) -> dict:
    tot = sum(h["overlap_tokens"] for h in hits) or 1
    by = defaultdict(int)
    for h in hits:
        by[h["bucket"]] += h["overlap_tokens"]
    return {k: round(100.0 * v / tot, 2) for k, v in sorted(by.items())}


def window_rehearsal(batches: list[dict], lo: int, hi: int) -> dict:
    rows = [b for b in batches if lo <= b["step"] <= hi]
    if not rows:
        return {"window": [lo, hi], "n_batches": 0}
    tot = sum(b["n_tokens"] for b in rows)
    reh = sum(int(round(b["composition_pct"].get("wr_corpus_0", 0) / 100.0 * b["n_tokens"])) for b in rows)
    # more accurate: use token counts
    by = defaultdict(int)
    for b in rows:
        for fam, n in b["token_counts"].items():
            by[fam] += n
    tot2 = sum(by.values()) or 1
    return {
        "window": [lo, hi],
        "n_batches": len(rows),
        "token_counts": dict(by),
        "pct": {k: round(100.0 * v / tot2, 2) for k, v in sorted(by.items())},
        "rehearsal_pct": round(100.0 * by.get("wr_corpus_0", 0) / tot2, 2),
    }


def main() -> int:
    skip_mlx = "--skip-mlx" in sys.argv
    mlx_only = "--mlx-only" in sys.argv
    root = repo_root()
    src = root / SRC
    out = root / OUT
    out.mkdir(parents=True, exist_ok=True)
    assert src.is_dir()
    assert out.resolve() != src.resolve()

    metrics = [json.loads(l) for l in (src / "metrics.jsonl").read_text().splitlines() if l.strip()]
    summary = json.loads((src / "experiment-summary.json").read_text())
    cfg = json.loads((src / "training-config.json").read_text())
    registry = json.loads((src / "checkpoint-registry.json").read_text())

    # ---- recorded timeline ----
    timeline = []
    for rec in metrics:
        step = int(rec["step"])
        g = float(rec.get("global_grad_l2") or 0)
        pre = g
        clipped = pre > CLIP
        post = min(pre, CLIP) if clipped else pre
        # clip formula uses 1.0/(g+1e-6)
        coef = min(1.0, CLIP / (pre + 1e-6))
        timeline.append({
            "step": step,
            "lr_logged": rec["learning_rate"],
            "lr_formula": lr_at_step(step - 1, SCHEDULER_TOTAL, PEAK_LR, WARMUP, FLOOR_RATIO),
            "train_loss": rec["train_loss"],
            "validation_loss": rec.get("validation_loss"),
            "global_grad_l2_preclip": pre,
            "clip_applied": bool(coef < 1.0 - 1e-12),
            "clip_coef": coef,
            "global_grad_l2_postclip_est": pre * coef,
            "tokens_seen": rec["tokens_seen"],
            "timestamp": rec["timestamp"],
        })
    grad_hist = summary.get("grad_instrumentation") or []
    grad_by_step = {int(g["step"]): g for g in grad_hist}
    for row in timeline:
        g = grad_by_step.get(row["step"])
        if g:
            row["per_layer_grad_l2"] = g.get("per_layer_grad_l2")
            row["grad_finite"] = g.get("finite")
            # finer not historically recorded
    (out / "timeline-25-45.json").write_text(json.dumps(
        [r for r in timeline if 25 <= r["step"] <= 45], indent=2
    ) + "\n")
    (out / "timeline-all.json").write_text(json.dumps(timeline, indent=2) + "\n")

    losses = {r["step"]: r["train_loss"] for r in timeline}
    first_abnormal = None
    healthy = [losses[s] for s in range(25, 41) if s in losses]
    healthy_mean = float(np.mean(healthy))
    healthy_std = float(np.std(healthy))
    for s in range(25, 46):
        if s not in losses:
            continue
        if losses[s] > healthy_mean + 3 * max(healthy_std, 0.05) and losses[s] > 5.0:
            first_abnormal = s
            break
    peak_loss_step = max((s for s in losses if 25 <= s <= 45), key=lambda s: losses[s])

    # ---- rematerialize packing (read-only vs saved npy) ----
    tokenizer = load_tokenizer(root)
    packed = materialize_recovery_mix(
        root=root,
        tokenizer=tokenizer,
        seed=SEED,
        target_tokens=400_000,
        rehearsal_frac=0.30,
        mix_profile="recovery_004_001_relative",
    )
    train = np.load(src / "train.npy")
    mask = np.load(src / "train-mask.npy")
    rem_train = packed["train_stream"]
    rem_mask = packed["train_mask"]
    stream_match = {
        "train_equal": bool(np.array_equal(train, rem_train)),
        "mask_equal": bool(np.array_equal(mask, rem_mask)),
        "saved_len": int(train.size),
        "rematerialized_len": int(rem_train.size),
    }
    units = packed["train_units"]
    spans = build_span_index(units)
    (out / "unit-spans.json").write_text(json.dumps(spans, indent=2) + "\n")
    eos_id = tokenizer.token_to_id("<|eos|>")
    bos_id = tokenizer.token_to_id("<|bos|>")

    # shuffle clustering: consecutive same-bucket runs after permute
    buckets_order = [u.bucket for u in units]
    runs = []
    i = 0
    while i < len(buckets_order):
        j = i
        while j < len(buckets_order) and buckets_order[j] == buckets_order[i]:
            j += 1
        runs.append({"bucket": buckets_order[i], "n_units": j - i, "start_unit": i})
        i = j

    cursor = initial_cursor(train.size, CTX, BATCH, SEED)
    batches = []
    decode_pack = {"healthy_30_35": [], "transition_38_42": [], "failure_43_45": []}
    for step in range(1, 46):
        x, y, w, cursor = next_batch(train, cursor, loss_mask=mask)
        token_counts = defaultdict(int)
        seq_meta = []
        unusual = []
        for bi in range(BATCH):
            start = (step - 1) * BATCH * CTX + bi * CTX
            end = start + CTX
            hits = lookup_spans(spans, start, end + 1)  # include y last token
            for h in hits:
                token_counts[h["bucket"]] += h["overlap_tokens"]
            ids = x[bi].tolist()
            decoded = tokenizer.decode(ids, skip_special_tokens=False)
            flags = unusual_flags(decoded)
            eos_pos = [i for i, t in enumerate(ids) if t == eos_id]
            bos_pos = [i for i, t in enumerate(ids) if t == bos_id]
            n_mask = int(np.count_nonzero(w[bi]))
            seq_meta.append({
                "seq": bi,
                "stream_start": start,
                "n_eos": len(eos_pos),
                "n_bos": len(bos_pos),
                "eos_positions": eos_pos[:12],
                "masked_token_count": int(CTX - n_mask),
                "effective_loss_tokens": n_mask,
                "units": [
                    {
                        "unit_id": h["unit_id"],
                        "bucket": h["bucket"],
                        "origin": h["origin"],
                        "source_path": h["source_path"],
                        "overlap_tokens": h["overlap_tokens"],
                        "truncated": h["truncated"],
                    }
                    for h in hits
                ],
                "flags": flags,
                "max_char_run": list(max_char_run(decoded)),
            })
            if flags:
                unusual.append({"seq": bi, "flags": flags, "snippet": snippet(decoded)})
            bucket = "healthy_30_35" if 30 <= step <= 35 else (
                "transition_38_42" if 38 <= step <= 42 else (
                    "failure_43_45" if 43 <= step <= 45 else None
                )
            )
            if bucket and bi in (0, 3, 7):
                decode_pack[bucket].append({
                    "step": step,
                    "seq": bi,
                    "snippet": snippet(decoded, 360),
                    "flags": flags,
                    "units": seq_meta[-1]["units"],
                })
        tot = sum(token_counts.values()) or 1
        batches.append({
            "step": step,
            "optimizer_step": step,
            "n_tokens": int(x.size),
            "n_eos": int(sum(s["n_eos"] for s in seq_meta)),
            "n_bos": int(sum(s["n_bos"] for s in seq_meta)),
            "masked_token_count": int(sum(s["masked_token_count"] for s in seq_meta)),
            "effective_loss_tokens": int(sum(s["effective_loss_tokens"] for s in seq_meta)),
            "token_counts": dict(token_counts),
            "composition_pct": {k: round(100.0 * v / tot, 2) for k, v in sorted(token_counts.items())},
            "unit_ids": sorted({u["unit_id"] for s in seq_meta for u in s["units"]}),
            "sequences": seq_meta,
            "unusual": unusual,
            "causal_mismatch": int(np.count_nonzero(y[:, :-1] != x[:, 1:])),
        })
    (out / "batches-1-45.json").write_text(json.dumps(batches, indent=2) + "\n")
    (out / "decoded-snippets-redacted.json").write_text(json.dumps(decode_pack, indent=2) + "\n")
    (out / "stream-match.json").write_text(json.dumps(stream_match, indent=2) + "\n")
    (out / "shuffle-runs.json").write_text(json.dumps({
        "n_units": len(units),
        "n_bucket_runs": len(runs),
        "longest_runs": sorted(runs, key=lambda r: -r["n_units"])[:15],
        "global_unit_bucket_counts": dict(Counter(buckets_order)),
    }, indent=2) + "\n")

    windows = [
        window_rehearsal(batches, 25, 30),
        window_rehearsal(batches, 31, 35),
        window_rehearsal(batches, 36, 40),
        window_rehearsal(batches, 41, 45),
        window_rehearsal(batches, 1, 45),
    ]
    (out / "local-rehearsal-windows.json").write_text(json.dumps(windows, indent=2) + "\n")

    # ---- optimizer at last full checkpoint (25) ----
    opt25 = opt_stats(src / "checkpoint-step-000025" / "optimizer.safetensors")
    opt0 = opt_stats(src / "checkpoint-step-000000" / "optimizer.safetensors")
    (out / "optimizer-stats.json").write_text(json.dumps({
        "note": "Optimizer tensors exist only at full checkpoints 0/10/25. Steps 35/40/45 were light diagnostics; no optimizer snapshot.",
        "step_0": opt0,
        "step_25": opt25,
    }, indent=2) + "\n")

    if skip_mlx:
        (out / "eval-only-replay-step25.json").write_text(json.dumps({
            "skipped": True,
            "reason": "Metal GPU not available in this process; run with --mlx-only outside sandbox",
        }, indent=2) + "\n")
        findings = {
            "stream_match": stream_match,
            "first_abnormal_loss_step": first_abnormal,
            "peak_loss_step": peak_loss_step,
            "peak_loss": losses.get(peak_loss_step),
            "loss_25_45": {str(s): losses[s] for s in range(25, 46) if s in losses},
            "lr_formula_matches_log": all(
                abs(r["lr_logged"] - r["lr_formula"]) < 1e-15 for r in timeline if 25 <= r["step"] <= 45
            ),
            "clip_events_25_45": [r["step"] for r in timeline if 25 <= r["step"] <= 45 and r["clip_applied"]],
            "windows": windows,
        }
        (out / "findings-preview.json").write_text(json.dumps(findings, indent=2) + "\n")
        print(json.dumps({"out": str(out), "mode": "skip-mlx", **findings, "windows": windows}, indent=2, default=str)[:4000])
        return 0

    # ---- EVAL-ONLY replay on step-25 weights (no update) ----
    from checkpoint_io import load_model_weights  # noqa: WPS433
    from recovery_instrumentation import grad_instrumentation  # noqa: WPS433
    from run_recovery_experiment import masked_loss_fn, run_suite  # noqa: WPS433
    from trainer_core import apply_mlx_limits, build_from_config  # noqa: WPS433

    replay = {"note": "Historical weights for steps 35/40/45 were not checkpointed. Replay uses step-25 weights only. No optimizer step."}
    import mlx.core as mx
    import mlx.nn as nn
    import mlx.utils
    apply_mlx_limits(cfg)
    model, arch, nparams = build_from_config(cfg, SEED)
    weights = load_file(str(src / "checkpoint-step-000025" / "model.safetensors"))
    load_model_weights(model, weights, strict=True)
    mx.eval(model.parameters())
    vocab = int(cfg["vocab_size"])
    loss_and_grad = nn.value_and_grad(model, lambda m, x, y, w: masked_loss_fn(m, x, y, w, vocab))

    # reset cursor and skip to step 25 batches? We want 30-45 against step-25 model
    cursor = initial_cursor(train.size, CTX, BATCH, SEED)
    replay_rows = []
    top_tokens = []
    for step in range(1, 46):
        x_np, y_np, w_np, cursor = next_batch(train, cursor, loss_mask=mask)
        if step < 30:
            continue
        x = mx.array(x_np)
        y = mx.array(y_np)
        w = mx.array(w_np)
        logits = model(x)
        ce = nn.losses.cross_entropy(logits.reshape(-1, vocab), y.reshape(-1), reduction="none")
        ww = w.reshape(-1)
        mx.eval(ce)
        ce_np = np.array(ce)
        w_flat = np.array(w_np).reshape(-1)
        y_flat = y_np.reshape(-1)
        x_flat = x_np.reshape(-1)
        masked = ce_np[w_flat > 0]
        seq_losses = []
        for bi in range(BATCH):
            sl = ce_np[bi * CTX:(bi + 1) * CTX]
            sw = w_flat[bi * CTX:(bi + 1) * CTX]
            denom = float(sw.sum()) + 1e-8
            seq_losses.append(float((sl * sw).sum() / denom))
        # top contributing tokens in this batch
        idx = np.where(w_flat > 0)[0]
        if idx.size:
            order = idx[np.argsort(-ce_np[idx])[:8]]
            for j in order:
                tok_id = int(y_flat[j])
                try:
                    tok_txt = tokenizer.decode([tok_id], skip_special_tokens=False)
                except Exception:
                    tok_txt = f"<id:{tok_id}>"
                pos = int(j)
                seq_i = pos // CTX
                pos_in = pos % CTX
                stream_pos = (step - 1) * BATCH * CTX + seq_i * CTX + pos_in
                fam = "unknown"
                for h in lookup_spans(spans, stream_pos, stream_pos + 1):
                    fam = h["bucket"]
                boundary = tok_id in (eos_id, bos_id)
                rec_tok = {
                    "step": step,
                    "seq": seq_i,
                    "pos": pos_in,
                    "loss": float(ce_np[j]),
                    "token_id": tok_id,
                    "token_text": redact(tok_txt),
                    "source_family": fam,
                    "eos_or_bos": boundary,
                    "target_is_eos": tok_id == eos_id,
                }
                top_tokens.append(rec_tok)
        loss_val, grads = loss_and_grad(model, x, y, w)
        ginfo = grad_instrumentation(grads)
        leaves = [(k, g) for k, g in mlx.utils.tree_flatten(grads)]
        by_comp = defaultdict(lambda: None)
        import mlx.core as mx2
        accs = {}
        for name, g in leaves:
            ck = component_key(name)
            s = mx2.sum(g.astype(mx2.float32) ** 2)
            accs[ck] = s if ck not in accs else accs[ck] + s
        mx2.eval(*accs.values())
        comp = {k: float(np.sqrt(float(v.item()))) for k, v in sorted(accs.items())}
        gnorm = float(ginfo["global_grad_l2"])
        replay_rows.append({
            "step": step,
            "eval_only_on": "checkpoint-step-000025",
            "mean_masked_ce": float(masked.mean()) if masked.size else None,
            "batch_loss_replay": float(loss_val.item()),
            "historical_train_loss": losses.get(step),
            "per_sequence_loss": seq_losses,
            "global_grad_l2_replay_step25": gnorm,
            "historical_global_grad_l2": next((t["global_grad_l2_preclip"] for t in timeline if t["step"] == step), None),
            "clip_would_apply_at_step25": gnorm > CLIP,
            "per_layer_grad_l2": ginfo.get("per_layer_grad_l2"),
            "per_component_grad_l2": comp,
            "composition_pct": next((b["composition_pct"] for b in batches if b["step"] == step), None),
        })
        mx.clear_cache()
        # prove weights unchanged: checksum a leaf
    # weight mutation check
    w_after = load_file(str(src / "checkpoint-step-000025" / "model.safetensors"))
    # compare live model vs file
    live = {k: np.array(v) for k, v in mlx.utils.tree_flatten(model.parameters())}
    max_abs = 0.0
    for k, a in w_after.items():
        b = live.get(k)
        if b is not None:
            max_abs = max(max_abs, float(np.max(np.abs(a.astype(np.float64) - b.astype(np.float64)))))
    replay["weights_unchanged_max_abs_vs_checkpoint"] = max_abs
    replay["rows"] = replay_rows
    replay["top_loss_tokens"] = sorted(top_tokens, key=lambda r: -r["loss"])[:40]
    (out / "eval-only-replay-step25.json").write_text(json.dumps(replay, indent=2) + "\n")

    # frozen 13-probe replay on step 25 only
    suite = json.loads((src / "WRIM-RECOVERY-DIAGNOSTIC-0-EXTENDED.json").read_text())
    suite_out = run_suite(model, tokenizer, suite["items"], 32)
    hist25 = json.loads((src / "diagnostic-step-000025.json").read_text())
    replay_suite = {
        "checkpoint": "checkpoint-step-000025",
        "replay_collapsed": suite_out["collapsed_probes"],
        "historical_collapsed": hist25.get("collapsed_probes"),
        "replay_unique": suite_out.get("mean_unique_ratio"),
        "historical_unique": hist25.get("mean_unique_ratio"),
        "match_collapsed": suite_out["collapsed_probes"] == hist25.get("collapsed_probes"),
        "language_outputs": {it["id"]: it.get("continuation") for it in suite_out.get("items", suite_out.get("items", []))},
        "missing_checkpoints": [35, 40, 45],
        "note": "Cannot fresh-load steps 35/40/45: no full checkpoint bundles. Light JSON is the historical record.",
    }
    # items from run_suite
    if "items" in suite_out:
        replay_suite["language_outputs"] = {it["id"]: it.get("continuation") for it in suite_out["items"]}
    else:
        # run_suite returns gens inside; inspect
        replay_suite["suite_keys"] = list(suite_out.keys())
        replay_suite["language_outputs"] = suite_out.get("language_outputs") or {}
    (out / "checkpoint-replay-step25.json").write_text(json.dumps(replay_suite, indent=2, default=str) + "\n")

    inventory = {
        "full_checkpoints": [c["step"] for c in registry["checkpoints"]],
        "full_checkpoint_missing_requested": [35, 40, 45],
        "light_diagnostics": [5, 15, 20, 30, 35, 40, 45],
        "full_diagnostics": [0, 10, 25],
        "metrics_jsonl_steps": [r["step"] for r in timeline],
        "grad_instrumentation_steps": sorted(grad_by_step),
        "per_step_recorded": {
            "train_loss": True,
            "lr": True,
            "global_grad_l2": True,
            "per_layer_grad_l2": True,
            "clip_flag_explicit": False,
            "clip_inferable_from_norm_gt_1": True,
            "source_family_per_batch": False,
            "reconstructed_here": True,
            "sequence_ids": False,
            "reconstructed_unit_ids": True,
            "eos_per_batch": False,
            "reconstructed": True,
            "masked_token_count": False,
            "reconstructed": True,
            "optimizer_step": "equals logged step; tensors only at 0/10/25",
            "parameter_drift_delta_per_step": False,
            "parameter_drift_at_light_steps": True,
            "kl_at_0_10_25_35_40_45": True,
            "entropy_at_diag_and_light": True,
            "generation_diagnostics_light": True,
            "per_token_loss_historical": False,
            "per_token_loss_eval_only_on_step25": True,
            "per_head_grad": False,
            "per_component_grad_historical": False,
            "adamw_state_at_failure": False,
            "adamw_state_at_step25": True,
        },
        "tmp_incomplete_dirs_preserved": [
            ".tmp-checkpoint-step-000000-46862",
            ".tmp-checkpoint-step-000010-46862",
            ".tmp-checkpoint-step-000025-46862",
        ],
        "no_step35_40_45_weight_files": True,
        "did_not_modify_src": True,
    }
    (out / "inventory.json").write_text(json.dumps(inventory, indent=2) + "\n")

    findings = {
        "stream_match": stream_match,
        "first_abnormal_loss_step": first_abnormal,
        "peak_loss_step": peak_loss_step,
        "peak_loss": losses.get(peak_loss_step),
        "loss_25_45": {str(s): losses[s] for s in range(25, 46) if s in losses},
        "lr_formula_matches_log": all(
            abs(r["lr_logged"] - r["lr_formula"]) < 1e-15 for r in timeline if 25 <= r["step"] <= 45
        ),
        "clip_events_25_45": [r["step"] for r in timeline if 25 <= r["step"] <= 45 and r["clip_applied"]],
        "windows": windows,
        "nparams": nparams,
        "replay_weight_delta": max_abs,
    }
    (out / "findings-preview.json").write_text(json.dumps(findings, indent=2) + "\n")
    print(json.dumps({
        "out": str(out),
        "first_abnormal": first_abnormal,
        "peak_loss_step": peak_loss_step,
        "stream_match": stream_match,
        "clip_events_25_45": findings["clip_events_25_45"],
        "replay_weight_delta": max_abs,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
