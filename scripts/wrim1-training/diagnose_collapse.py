#!/usr/bin/env python3
"""TEST_ONLY WRIM-1 collapse diagnosis. Does not train, promote, or write official checkpoints."""
from __future__ import annotations

import hashlib
import json
import math
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from tokenizers import Tokenizer, decoders

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(SCRIPT_DIR.parent / "sovereign-model-lab"))

from checkpoint_io import load_bundle, load_model_weights, load_parent_wrim0_weights  # noqa: E402
from constants import PARENT_CHECKPOINT_REL, PARENT_CHECKPOINT_SHA256, TOKENIZER_REL, TOKENIZER_SHA256  # noqa: E402
from hashes import sha256_file, tensor_tree_sha256  # noqa: E402
from paths import official_ckpt_dir, repo_root  # noqa: E402
from trainer_core import build_from_config  # noqa: E402
from training_config import official_training_config  # noqa: E402
from dataset_cursor import legacy_token_permutation_stream  # noqa: E402


PROBES_REL = "model-lab/manifests/wave9/test-only/WRIM-RECOVERY-DIAGNOSTIC-0.json"
OUT_DIR_REL = "model-lab/manifests/wave9/test-only/collapse-diagnosis"


def generate(model, tokenizer, prompt: str, max_new_tokens: int, temperature: float = 0.0) -> dict:
    import mlx.core as mx
    mx.random.seed(0)
    bos_id = tokenizer.token_to_id("<|bos|>")
    eos_id = tokenizer.token_to_id("<|eos|>")
    prompt_ids = tokenizer.encode(prompt).ids
    ids = [bos_id] + prompt_ids
    cache = model.fresh_cache()
    logits, cache = model(mx.array([ids]), cache=cache)
    generated = list(ids)
    new_ids = []
    for _ in range(max_new_tokens):
        last = logits[:, -1, :]
        if temperature and temperature > 0:
            probs = mx.softmax(last / temperature, axis=-1)
            next_id = int(mx.random.categorical(mx.log(probs)).item())
        else:
            next_id = int(mx.argmax(last, axis=-1).item())
        generated.append(next_id)
        new_ids.append(next_id)
        if next_id == eos_id:
            break
        logits, cache = model(mx.array([[next_id]]), cache=cache)
    full = tokenizer.decode(generated, skip_special_tokens=True)
    continuation = tokenizer.decode(new_ids, skip_special_tokens=True)
    return {
        "full_decode": full,
        "continuation": continuation,
        "new_ids": new_ids,
        "eos": eos_id in new_ids,
        "n_new": len(new_ids),
    }


def stats(prompt: str, gen: dict, tokenizer) -> dict:
    cont = gen["continuation"]
    ids = gen["new_ids"]
    period_id = tokenizer.token_to_id(".")
    if period_id is None:
        period_toks = sum(1 for t in tokenizer.encode(cont).ids if tokenizer.decode([t]) == ".")
        period_frac = None
    else:
        period_frac = (sum(1 for i in ids if i == period_id) / len(ids)) if ids else 0.0
    echo = 0.0
    if cont.startswith(prompt):
        echo = 1.0
    elif prompt and prompt in (gen["full_decode"] or ""):
        echo = 0.5
    uniq = (len(set(ids)) / len(ids)) if ids else None
    max_run = 1
    run = 1
    for a, b in zip(ids, ids[1:]):
        run = run + 1 if a == b else 1
        max_run = max(max_run, run)
    collapsed = bool(ids) and max_run >= max(6, len(ids) // 3)
    return {
        "prompt_echo": echo,
        "period_frac": period_frac,
        "unique_ratio": round(uniq, 3) if uniq is not None else None,
        "max_run": max_run,
        "collapsed": collapsed,
        "eos": gen["eos"],
        "n_new": gen["n_new"],
        "valid_decode": isinstance(cont, str),
    }


def topk_diag(model, tokenizer, prompt: str, k: int = 10) -> dict:
    import mlx.core as mx
    bos_id = tokenizer.token_to_id("<|bos|>")
    period_id = tokenizer.token_to_id(".")
    eos_id = tokenizer.token_to_id("<|eos|>")
    ids = [bos_id] + tokenizer.encode(prompt).ids
    logits = model(mx.array([ids]))[:, -1, :]
    mx.eval(logits)
    arr = np.array(logits[0])
    if not np.all(np.isfinite(arr)):
        return {"finite": False, "nan": bool(np.isnan(arr).any()), "inf": bool(np.isinf(arr).any())}
    probs = np.exp(arr - arr.max())
    probs = probs / probs.sum()
    entropy = float(-(probs * np.log(np.clip(probs, 1e-12, 1))).sum())
    top = np.argsort(-probs)[:k]
    decoded = []
    for tid in top:
        decoded.append({"id": int(tid), "p": float(probs[tid]), "tok": tokenizer.decode([int(tid)])})

    def p_for(*pieces: str) -> float:
        acc = 0.0
        seen = set()
        for piece in pieces:
            tid = tokenizer.token_to_id(piece)
            if tid is not None and tid not in seen:
                seen.add(tid)
                acc += float(probs[tid])
        return acc

    return {
        "finite": True,
        "entropy": entropy,
        "p_period": float(probs[period_id]) if period_id is not None else None,
        "p_eos": float(probs[eos_id]) if eos_id is not None else None,
        "p_pipe": p_for("|", " |", "Ġ|"),
        "p_underscore": p_for("_", " _", "Ġ_"),
        "top": decoded,
        "argmax_id": int(top[0]),
        "argmax_tok": tokenizer.decode([int(top[0])]),
    }


def load_wrim1(path: Path, cfg: dict):
    bundle = load_bundle(path)
    model, arch, nparams = build_from_config(cfg, int(cfg["seed"]))
    load_model_weights(model, bundle["model"], strict=True)
    return model, bundle, nparams


def load_wrim0_via_trainer(root: Path, cfg: dict):
    model, arch, nparams = build_from_config(cfg, int(cfg["seed"]))
    info = load_parent_wrim0_weights(model, root / PARENT_CHECKPOINT_REL, PARENT_CHECKPOINT_SHA256)
    return model, info, nparams


def param_summary(tensors: dict[str, np.ndarray]) -> dict:
    groups = {"emb": [], "attn": [], "mlp": [], "norm": [], "other": []}
    for k, arr in tensors.items():
        n = float(np.sqrt(np.mean(arr.astype(np.float64) ** 2)))
        if "tok_emb" in k:
            groups["emb"].append(n)
        elif any(s in k for s in (".q.", ".k.", ".v.", ".o.", "attn")):
            groups["attn"].append(n)
        elif any(s in k for s in ("gate", ".up.", ".down.", "ffn")):
            groups["mlp"].append(n)
        elif "norm" in k or "weight" in k and "emb" not in k and any(x in k for x in ("attn_norm", "ffn_norm", "norm_f")):
            groups["norm"].append(n)
        else:
            groups["other"].append(n)
    return {g: (float(np.mean(v)) if v else None) for g, v in groups.items()}


def delta_stats(a: dict, b: dict) -> dict:
    keys = sorted(set(a) & set(b))
    l2 = 0.0
    abs_sum = 0.0
    n = 0
    max_abs = 0.0
    by = {}
    for k in keys:
        d = b[k].astype(np.float64) - a[k].astype(np.float64)
        l2 += float(np.sum(d ** 2))
        abs_sum += float(np.mean(np.abs(d)))
        n += 1
        max_abs = max(max_abs, float(np.max(np.abs(d))))
    return {"n_tensors": n, "l2": math.sqrt(l2), "mean_abs_over_tensors": abs_sum / max(1, n), "max_abs": max_abs}


def corpus_analysis(root: Path, tokenizer) -> dict:
    train = np.load(root / "model-lab/corpora/WR-CORPUS-1-HARDENED/tokens/train.npy", mmap_mode="r")
    vocab = tokenizer.get_vocab_size()
    bos = tokenizer.token_to_id("<|bos|>")
    eos = tokenizer.token_to_id("<|eos|>")
    pad = tokenizer.token_to_id("<|pad|>")
    unk = tokenizer.token_to_id("<|unk|>")
    period = tokenizer.token_to_id(".")
    counts = {
        "n": int(train.size),
        "min_id": int(train.min()),
        "max_id": int(train.max()),
        "oob": bool(int(train.max()) >= vocab or int(train.min()) < 0),
        "bos": int(np.count_nonzero(train == bos)) if bos is not None else None,
        "eos": int(np.count_nonzero(train == eos)) if eos is not None else None,
        "pad": int(np.count_nonzero(train == pad)) if pad is not None else None,
        "unk": int(np.count_nonzero(train == unk)) if unk is not None else None,
        "period": int(np.count_nonzero(train == period)) if period is not None else None,
    }
    if period is not None:
        counts["period_frac"] = counts["period"] / train.size
    if eos is not None:
        counts["eos_frac"] = counts["eos"] / train.size
        counts["tokens_per_eos"] = (train.size / counts["eos"]) if counts["eos"] else None
    # packing: token permutation destroys adjacency
    orig_pairs = set(zip(train[:20000].tolist(), train[1:20001].tolist()))
    shuffled = legacy_token_permutation_stream(np.array(train[:20000]), 20260830, 0)
    shuf_pairs = set(zip(shuffled[:-1].tolist(), shuffled[1:].tolist()))
    counts["adjacency_overlap_20k"] = len(orig_pairs & shuf_pairs) / max(1, len(orig_pairs))
    counts["shuffle_is_token_level"] = True
    # domain from source jsonl tags
    domain = Counter()
    tokens_by = Counter()
    shard = root / "model-lab/corpora/WR-CORPUS-1-HARDENED/train/shard-00000.jsonl"
    for line in shard.read_text(encoding="utf-8").splitlines():
        rec = json.loads(line)
        n = int(rec.get("token_count") or 0)
        fmt = rec.get("format") or "unknown"
        kind = rec.get("kind") or "chunk"
        path = rec.get("source_path") or ""
        if kind == "behavior_example":
            bucket = "behavior"
        elif fmt in ("code",) or path.endswith((".ts", ".tsx", ".js", ".mjs", ".py")):
            bucket = "code"
        elif fmt in ("language_modeling", "language") or path.endswith(".md"):
            bucket = "prose_docs"
        elif "json" in (fmt or "") or path.endswith(".json"):
            bucket = "json"
        else:
            bucket = fmt or "other"
        domain[bucket] += 1
        tokens_by[bucket] += n
    counts["records_by_bucket"] = dict(domain)
    counts["tokens_by_bucket"] = dict(tokens_by)
    counts["token_pct"] = {k: round(100 * v / max(1, sum(tokens_by.values())), 2) for k, v in tokens_by.items()}
    # behavior share
    beh = json.loads((root / "model-lab/manifests/wave8_1/behavior-examples.json").read_text())
    counts["behavior_examples"] = beh.get("count") or len(beh.get("examples") or [])
    return counts


def wrim0_corpus_punct(root: Path, tokenizer) -> dict | None:
    cands = list((root / "model-lab").rglob("train.npy"))
    # prefer wrim0 / corpus-0 shards
    hits = [p for p in cands if "wrim0" in str(p).lower() or "corpus-0" in str(p).lower() or "WR-CORPUS-0" in str(p)]
    path = hits[0] if hits else None
    if path is None:
        return {"found": False}
    arr = np.load(path, mmap_mode="r")
    period = tokenizer.token_to_id(".")
    eos = tokenizer.token_to_id("<|eos|>")
    bos = tokenizer.token_to_id("<|bos|>")
    return {
        "found": True,
        "path": str(path),
        "n": int(arr.size),
        "period_frac": float(np.count_nonzero(arr == period) / arr.size) if period is not None else None,
        "eos_frac": float(np.count_nonzero(arr == eos) / arr.size) if eos is not None else None,
        "bos_frac": float(np.count_nonzero(arr == bos) / arr.size) if bos is not None else None,
    }


def tokenizer_roundtrip(tokenizer) -> dict:
    samples = [
        "Hello, world.",
        "The quick brown fox.",
        '{"ok": false, "n": 12}',
        "function add(a: number) { return a; }",
        "line1\nline2\tindent",
        "..........",
        "<|bos|>hello<|eos|>",
    ]
    rows = []
    ok = True
    for s in samples:
        ids = tokenizer.encode(s).ids
        dec = tokenizer.decode(ids, skip_special_tokens=False)
        again = tokenizer.encode(dec).ids
        rows.append({"text": s, "ids": ids[:24], "decode": dec, "reencode_match": again == ids})
        if again != ids and s != "<|bos|>hello<|eos|>":
            ok = False
    specials = {}
    for name in ("<|pad|>", "<|bos|>", "<|eos|>", "<|unk|>", "<|system|>", "<|commander|>", "<|assistant|>", "<|tool|>", "<|evidence|>", "."):
        specials[name] = tokenizer.token_to_id(name)
    ids = list(specials.values())
    alias = len(ids) != len(set(x for x in ids if x is not None))
    return {"roundtrip_ok_plain": ok, "samples": rows, "special_ids": specials, "special_id_collision": alias}


def main() -> int:
    root = repo_root()
    out = root / OUT_DIR_REL
    out.mkdir(parents=True, exist_ok=True)
    cfg = official_training_config()
    tok_path = root / TOKENIZER_REL
    assert sha256_file(tok_path) == TOKENIZER_SHA256
    tokenizer = Tokenizer.from_file(str(tok_path))
    if tokenizer.decoder is None:
        tokenizer.decoder = decoders.ByteLevel()

    suite = json.loads((root / PROBES_REL).read_text(encoding="utf-8"))
    probes = suite["items"]

    tok_rep = tokenizer_roundtrip(tokenizer)
    (out / "tokenizer-roundtrip.json").write_text(json.dumps(tok_rep, indent=2) + "\n")

    corpus = corpus_analysis(root, tokenizer)
    corpus["wrim0_shards"] = wrim0_corpus_punct(root, tokenizer)
    (out / "corpus-analysis.json").write_text(json.dumps(corpus, indent=2) + "\n")

    tying = {
        "architecture": "logits = hidden @ tok_emb.weight.T; no separate lm_head Module",
        "no_lm_head_param": True,
    }

    # parent vs reconstructed
    import mlx.utils
    m0, info, nparams = load_wrim0_via_trainer(root, cfg)
    tying["parent_load"] = info
    w0 = {k: np.array(v) for k, v in mlx.utils.tree_flatten(m0.parameters())}
    tying["reconstructed_nparams"] = nparams
    tying["has_lm_head_key"] = any("lm_head" in k for k in w0)

    models = [("WRIM-0-STEP0-RECONSTRUCTED", None, m0, None)]
    registry = json.loads((official_ckpt_dir(root) / "checkpoint-registry.json").read_text())
    ckpts = sorted(
        [e for e in registry["checkpoints"] if e.get("status") == "complete" and not e.get("corrupted")],
        key=lambda e: e["step"],
    )

    matrix = []
    logits_rows = []
    drift = []

    def run_model(label: str, step, model, sha):
        gens = []
        collapsed_n = 0
        for item in probes:
            g = generate(model, tokenizer, item["input"], 32, temperature=0.0)
            st = stats(item["input"], g, tokenizer)
            if st["collapsed"]:
                collapsed_n += 1
            gens.append({"id": item["id"], "category": item["category"], "input": item["input"], **gen_public(g), **st})
        # sampling on one probe
        samp = generate(model, tokenizer, "The sky is", 24, temperature=0.8)
        lg = topk_diag(model, tokenizer, "The sky is")
        logits_rows.append({"label": label, "step": step, "sha": sha, **lg})
        row = {
            "label": label,
            "step": step,
            "sha": sha,
            "collapsed_probes": collapsed_n,
            "n_probes": len(probes),
            "greedy": gens,
            "temp08_sky": {"continuation": samp["continuation"], "collapsed": stats("The sky is", samp, tokenizer)["collapsed"]},
        }
        matrix.append(row)
        return row

    def gen_public(g):
        return {"continuation": g["continuation"], "full_decode": g["full_decode"], "eos": g["eos"]}

    run_model("WRIM-0-STEP0-RECONSTRUCTED", 0, m0, PARENT_CHECKPOINT_SHA256)

    prev_w = w0
    for entry in ckpts:
        model, bundle, _ = load_wrim1(Path(entry["path"]), cfg)
        sha = entry["sha"]
        run_model(entry["checkpoint_id"], entry["step"], model, sha)
        w = {k: np.array(v) for k, v in mlx.utils.tree_flatten(model.parameters())}
        drift.append({
            "step": entry["step"],
            "vs_wrim0": delta_stats(w0, w),
            "vs_prev": delta_stats(prev_w, w),
            "rms_groups": param_summary(w),
        })
        prev_w = w
        del model

    (out / "diagnostic-matrix.json").write_text(json.dumps({"suite": suite["suite_id"], "rows": matrix}, indent=2) + "\n")
    (out / "logits.json").write_text(json.dumps(logits_rows, indent=2) + "\n")
    (out / "parameter-drift.json").write_text(json.dumps(drift, indent=2) + "\n")
    (out / "weight-tying.json").write_text(json.dumps(tying, indent=2) + "\n")

    # classify collapse onset
    def collapsed(row):
        return row["collapsed_probes"] >= 6

    last_healthy = None
    first_deg = None
    first_col = None
    for row in matrix:
        c = collapsed(row)
        if not c and first_col is None:
            last_healthy = row["label"]
        if row["collapsed_probes"] > 0 and first_deg is None:
            first_deg = row["label"]
        if c and first_col is None:
            first_col = row["label"]

    summary = {
        "test_only": True,
        "official_run_untouched": True,
        "last_healthy": last_healthy,
        "first_degraded": first_deg,
        "first_collapsed": first_col,
        "token_shuffle_adjacency_overlap_20k": corpus.get("adjacency_overlap_20k"),
        "wrim0_period_frac": (corpus.get("wrim0_shards") or {}).get("period_frac"),
        "wrim1_period_frac": corpus.get("period_frac"),
        "wrim1_eos_frac": corpus.get("eos_frac"),
        "special_id_collision": tok_rep["special_id_collision"],
        "parent_load_tensors": info.get("tensor_count"),
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
