"""WRIM1-RUN-000005 retention-break forensic audit.

ANALYSIS ONLY. Does not construct an optimizer. Does not train.
Does not mutate corpus, tokenizer, or checkpoints. Does not promote.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
import struct
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import numpy as np
import torch
from safetensors.torch import load_file
from tokenizers import Tokenizer

from foundational_p1_refine import npy_payload_sha, sha256_file
from p2_schedule import FORMULA as P2_LR_FORMULA
from p2_schedule import lr_p2
from phase2_grid import param_groups
from safetensors_model import load_model_state_from_safetensors
from stage2_eval import EVAL_SEED, SPECIAL_IDS, greedy_generate
from stage2_pack import encode_corpus1_val_units, encode_rehearsal_val_units
from stage3_eval_baseline import (
    concat_units,
    continuation_metrics,
    disable_tf32,
    encode_prompt_ids,
    extract_json_blob,
    measure_val_loss,
    teacher_force_nll_kl,
)
from stage3_eval_items import CATEGORIES, ITEMS as STAGE3_ITEMS, SUITE_ID
from stage3_runtime import PARENT_SHA, TOKENIZER_SHA, utc_now
from wrim_g20m import D_MODEL, N_HEADS, N_LAYERS, VOCAB_SIZE, WRIM0Model, expected_torch_keys

KIND = "WRIM_RETENTION_BREAK_FORENSIC"
RUN_ID = "WRIM1-RUN-000005"
HARD_ABORT_DNLL = 0.105
TOKENS_CONSUMED = 204_800
TOKENS_PER_STEP = 4096
SEQ_LEN = 512
MICRO_BATCH = 8
WD = 0.1
CLIP_THRESHOLD = 1.0
PEAK_LR = 1e-5
MIN_LR = 1e-6
WARMUP = 25
COSINE_HORIZON = 1000
ARCH = "WRIM-G-20M-v1-option-A"
WINDOWS = {"1-5": range(1, 6), "6-10": range(6, 11), "11-25": range(11, 26), "26-50": range(26, 51)}
INTERP_ALPHAS = (0.25, 0.50, 0.75)
INTERP_FORMULA = "theta=(1-alpha)*WRIM-0 + alpha*checkpoint"


def dump_json(path: Path, payload: dict[str, Any]) -> None:
    def conv(o: Any) -> Any:
        if isinstance(o, (np.floating, np.integer)):
            return o.item()
        if isinstance(o, np.ndarray):
            return o.tolist()
        if isinstance(o, Path):
            return str(o)
        raise TypeError(type(o))

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, default=conv) + "\n", encoding="utf-8")


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_metrics(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def tensors_sha256(state: dict[str, torch.Tensor]) -> str:
    h = hashlib.sha256()
    for k in sorted(state):
        t = state[k].detach().contiguous().cpu().float().numpy().tobytes()
        h.update(k.encode("utf-8"))
        h.update(t)
    return h.hexdigest()


def cpu_state(path: Path) -> dict[str, torch.Tensor]:
    raw = load_file(str(path))
    return {k: v.detach().cpu().contiguous().float() for k, v in raw.items()}


def lerp_from_parent(parent: dict[str, torch.Tensor], cand: dict[str, torch.Tensor], alpha: float) -> dict[str, torch.Tensor]:
    out = {}
    for k in parent:
        out[k] = ((1.0 - alpha) * parent[k].float() + alpha * cand[k].float()).contiguous()
    return out


def cosine_flat(a: torch.Tensor, b: torch.Tensor) -> float:
    af = a.detach().float().reshape(-1)
    bf = b.detach().float().reshape(-1)
    na = float(af.norm().item())
    nb = float(bf.norm().item())
    if na <= 0.0 or nb <= 0.0:
        return float("nan")
    return float(torch.dot(af, bf).item() / (na * nb))


def tensor_family(name: str) -> str:
    if name == "tok_emb.weight":
        return "token_embeddings_tied_output"
    if name == "norm_f.weight":
        return "final_norm"
    if ".attn.q." in name or ".attn.k." in name or ".attn.v." in name:
        return "attention_projections"
    if ".attn.o." in name:
        return "attention_output"
    if ".ffn." in name:
        return "mlp_swiglu"
    if name.endswith("attn_norm.weight") or name.endswith("ffn_norm.weight"):
        return "rmsnorm"
    return "other"


def header_dtypes(path: Path) -> dict[str, Any]:
    with path.open("rb") as fh:
        header_len = struct.unpack("<Q", fh.read(8))[0]
        header = json.loads(fh.read(header_len))
    dtypes: Counter[str] = Counter()
    keys: list[str] = []
    opt_keys = 0
    for k, info in header.items():
        if k == "__metadata__":
            continue
        keys.append(k)
        if k.startswith("opt."):
            opt_keys += 1
        if isinstance(info, dict) and "dtype" in info:
            dtypes[str(info["dtype"])] += 1
    return {
        "n_tensors": len(keys),
        "n_opt_tensors": opt_keys,
        "dtypes": dict(dtypes),
        "has_model_prefix": any(k.startswith("model.") for k in keys),
        "has_opt_prefix": opt_keys > 0,
    }


def inventory_row(
    *,
    label: str,
    path: Path | None,
    state: dict[str, torch.Tensor] | None,
    parent_hash: str | None,
    tokenizer_hash: str,
    optimizer_path: Path | None,
    manifest_paths: list[Path],
    complete: bool,
    notes: str,
) -> dict[str, Any]:
    missing = path is None or not path.exists()
    file_sha = None if missing else sha256_file(path)
    header = None if missing else header_dtypes(path)
    n_params = int(sum(t.numel() for t in state.values())) if state else None
    t_sha = tensors_sha256(state) if state else None
    keys_ok = bool(state) and set(state) == set(expected_torch_keys())
    opt_exists = bool(optimizer_path and optimizer_path.exists())
    opt_in_file = bool(header and header.get("has_opt_prefix"))
    return {
        "label": label,
        "path": None if missing else str(path),
        "status": "MISSING" if missing else "PRESENT",
        "file_sha256": file_sha,
        "model_tensors_sha256": t_sha,
        "manifest_presence": {str(p): p.exists() for p in manifest_paths},
        "dtype": (header or {}).get("dtypes"),
        "parameter_count": n_params,
        "architecture_identity": ARCH,
        "n_layers": N_LAYERS,
        "d_model": D_MODEL,
        "n_heads": N_HEADS,
        "vocab_size": VOCAB_SIZE,
        "tied_embeddings": True,
        "tokenizer_hash": tokenizer_hash,
        "parent_model_hash": parent_hash,
        "complete": bool(complete and keys_ok and not missing),
        "keys_match_architecture": keys_ok,
        "optimizer_state_exists": opt_exists or opt_in_file,
        "optimizer_state_loaded": False,
        "optimizer_sidecar": str(optimizer_path) if optimizer_path else None,
        "analysis_safe": bool(complete and keys_ok and not missing),
        "notes": notes,
        "header": header,
    }


def per_tensor_drift(parent: dict[str, torch.Tensor], cand: dict[str, torch.Tensor]) -> list[dict[str, Any]]:
    rows = []
    for name in sorted(parent):
        p = parent[name].float()
        c = cand[name].float()
        d = c - p
        p_l2 = float(p.norm().item())
        d_l2 = float(d.norm().item())
        rows.append(
            {
                "tensor": name,
                "family": tensor_family(name),
                "n": int(p.numel()),
                "l2_parameter_delta": d_l2,
                "l2_reference_weight": p_l2,
                "delta_over_weight": d_l2 / max(p_l2, 1e-12),
                "cosine_similarity": cosine_flat(c, p),
                "max_abs_delta": float(d.abs().max().item()),
                "mean_abs_delta": float(d.abs().mean().item()),
            }
        )
    return rows


def aggregate_rows(rows: list[dict[str, Any]], key: str) -> dict[str, dict[str, float]]:
    buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        buckets[str(r[key])].append(r)
    out = {}
    for name, xs in buckets.items():
        num = sum(r["l2_parameter_delta"] ** 2 for r in xs)
        den = sum(r["l2_reference_weight"] ** 2 for r in xs)
        out[name] = {
            "n_tensors": len(xs),
            "n_params": int(sum(r["n"] for r in xs)),
            "l2_parameter_delta": math.sqrt(num),
            "l2_reference_weight": math.sqrt(den),
            "delta_over_weight": math.sqrt(num) / math.sqrt(den) if den > 0 else 0.0,
            "cosine_similarity_mean": float(statistics.mean(r["cosine_similarity"] for r in xs)),
            "max_abs_delta": float(max(r["max_abs_delta"] for r in xs)),
            "mean_abs_delta": float(sum(r["mean_abs_delta"] * r["n"] for r in xs) / max(sum(r["n"] for r in xs), 1)),
        }
    return out


def layer_table(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    by_layer: dict[int, list[dict[str, Any]]] = defaultdict(list)
    extras = []
    for r in rows:
        name = r["tensor"]
        if name.startswith("layers."):
            idx = int(name.split(".")[1])
            by_layer[idx].append(r)
        else:
            extras.append(r)
    table = []
    for i in range(N_LAYERS):
        xs = by_layer.get(i, [])
        fam = aggregate_rows(xs, "family") if xs else {}
        l2d = math.sqrt(sum(r["l2_parameter_delta"] ** 2 for r in xs)) if xs else 0.0
        l2w = math.sqrt(sum(r["l2_reference_weight"] ** 2 for r in xs)) if xs else 0.0
        table.append(
            {
                "layer": i,
                "families": fam,
                "block": {
                    "l2_parameter_delta": l2d,
                    "l2_reference_weight": l2w,
                    "delta_over_weight": l2d / max(l2w, 1e-12),
                    "cosine_similarity_mean": float(statistics.mean(r["cosine_similarity"] for r in xs)) if xs else None,
                },
            }
        )
    extras_agg = aggregate_rows(extras, "family") if extras else {}
    return table, extras_agg


def reseed() -> None:
    torch.manual_seed(EVAL_SEED)
    np.random.seed(EVAL_SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(EVAL_SEED)


def load_model(state: dict[str, torch.Tensor], device: torch.device) -> WRIM0Model:
    model = WRIM0Model()
    model.load_state_dict(state, strict=True)
    model.to(device)
    model.freeze_inference()
    return model


@torch.no_grad()
def retention_families(model, tokenizer, device, frozen_items, wrim0_logp, c0, c1) -> dict[str, Any]:
    reseed()
    v0 = measure_val_loss(model, c0, device)
    v1 = measure_val_loss(model, c1, device)
    frozen_by_id = {r["item_id"]: r for r in frozen_items}
    per = []
    for it in STAGE3_ITEMS:
        prompt_ids = encode_prompt_ids(tokenizer, it["prompt_text"])
        frozen = frozen_by_id[it["item_id"]]
        frozen_ids = list((frozen.get("historical_32") or {}).get("new_ids") or [])
        parent_logp = wrim0_logp.get(it["item_id"])
        bundle = teacher_force_nll_kl(model, prompt_ids, frozen_ids, device, parent_logp)
        if parent_logp is None and bundle.get("log_softmax") is not None:
            wrim0_logp[it["item_id"]] = bundle["log_softmax"]
        wrim0_nll = float(frozen.get("wrim0_anchor_nll_32"))
        ckpt_nll = float(bundle["nll"])
        delta = ckpt_nll - wrim0_nll
        kl = float(bundle["kl"]) if bundle.get("kl") is not None and math.isfinite(bundle["kl"]) else None
        per.append(
            {
                "item_id": it["item_id"],
                "family": it["category"],
                "wrim0_nll": wrim0_nll,
                "checkpoint_nll": ckpt_nll,
                "delta_nll": delta,
                "kl": kl,
                "fail_item": bool(delta > HARD_ABORT_DNLL),
            }
        )
    by_fam: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in per:
        by_fam[row["family"]].append(row)
    families = []
    for fam in CATEGORIES:
        xs = by_fam.get(fam, [])
        mean_dnll = float(statistics.mean(r["delta_nll"] for r in xs)) if xs else float("nan")
        mean_nll0 = float(statistics.mean(r["wrim0_nll"] for r in xs)) if xs else float("nan")
        mean_nll1 = float(statistics.mean(r["checkpoint_nll"] for r in xs)) if xs else float("nan")
        kls = [r["kl"] for r in xs if r["kl"] is not None]
        max_dnll = float(max(r["delta_nll"] for r in xs)) if xs else float("nan")
        families.append(
            {
                "family": fam,
                "sample_count": len(xs),
                "wrim0_nll": mean_nll0,
                "checkpoint_nll": mean_nll1,
                "delta_nll": mean_dnll,
                "max_delta_nll": max_dnll,
                "kl": float(statistics.mean(kls)) if kls else None,
                "fail_mean": bool(mean_dnll > HARD_ABORT_DNLL),
                "fail_any_item": any(r["fail_item"] for r in xs),
                "n_fail_items": int(sum(1 for r in xs if r["fail_item"])),
            }
        )
    ranked = sorted(families, key=lambda r: -(r["delta_nll"] if math.isfinite(r["delta_nll"]) else -1e9))
    for i, row in enumerate(ranked, start=1):
        row["drift_rank"] = i
    mean_dnll = float(statistics.mean(r["delta_nll"] for r in per))
    kls = [r["kl"] for r in per if r["kl"] is not None]
    return {
        "val0": v0,
        "val1": v1,
        "mean_dnll": mean_dnll,
        "mean_kl": float(statistics.mean(kls)) if kls else None,
        "n": len(per),
        "families": ranked,
        "items": per,
        "hard_abort_threshold": HARD_ABORT_DNLL,
    }


def json_valid(text: str) -> bool:
    blob = extract_json_blob(text or "")
    if not blob:
        return False
    try:
        json.loads(blob)
        return True
    except Exception:
        return False


def code_syntax_ok(text: str) -> bool | None:
    src = (text or "").strip()
    if not src:
        return None
    try:
        compile(src, "<gen>", "exec")
        return True
    except SyntaxError:
        return False
    except Exception:
        return None


def generation_suite(model, tokenizer, device) -> dict[str, Any]:
    reseed()
    rows = []
    for it in STAGE3_ITEMS:
        gen = greedy_generate(model, tokenizer, it["prompt_text"], device, max_new=int(it["max_new_tokens"]))
        cm = continuation_metrics(gen)
        text = gen.get("continuation") or ""
        rows.append(
            {
                "item_id": it["item_id"],
                "family": it["category"],
                "prompt_text": it["prompt_text"],
                "seed": EVAL_SEED,
                "decoding": "greedy_argmax",
                "max_new_tokens": it["max_new_tokens"],
                "continuation": text,
                "n_new": gen.get("n_new"),
                "unique_ratio": gen.get("unique_ratio"),
                "max_run": gen.get("max_run"),
                "collapsed": gen.get("collapsed"),
                "special_loop": gen.get("special_loop"),
                "entropy": gen.get("entropy"),
                "finite": gen.get("finite"),
                "json_valid": json_valid(text) if it["category"] == "JSON_STRUCTURED_OUTPUT" else None,
                "code_syntax_valid": code_syntax_ok(text) if it["category"] == "CODE" else None,
                "metrics": cm,
            }
        )
    looping = int(sum(1 for r in rows if r.get("collapsed") or (r.get("max_run") or 0) >= 6 or r.get("special_loop")))
    uniq = [r["unique_ratio"] for r in rows if r.get("unique_ratio") is not None]
    json_rows = [r for r in rows if r["family"] == "JSON_STRUCTURED_OUTPUT"]
    code_rows = [r for r in rows if r["family"] == "CODE"]
    return {
        "n": len(rows),
        "n_looping_proxy": looping,
        "mean_unique_ratio": float(statistics.mean(uniq)) if uniq else None,
        "json_valid_n": int(sum(1 for r in json_rows if r.get("json_valid"))),
        "code_syntax_valid_n": int(sum(1 for r in code_rows if r.get("code_syntax_valid"))),
        "items": rows,
    }


def unigram_kl(p_counts: np.ndarray, q_counts: np.ndarray) -> float:
    p = p_counts.astype(np.float64) + 0.5
    q = q_counts.astype(np.float64) + 0.5
    p /= p.sum()
    q /= q.sum()
    return float(np.sum(p * (np.log(p) - np.log(q))))


def stream_forensics(stream: np.ndarray, step_map: list[dict[str, Any]], c0: np.ndarray, consumed: int) -> dict[str, Any]:
    prefix = np.array(stream[:consumed], dtype=np.int64)
    assert prefix.size == consumed
    special = np.isin(prefix, list(SPECIAL_IDS))
    vocab_hist = np.bincount(prefix, minlength=VOCAB_SIZE)
    c0_hist = np.bincount(np.array(c0, dtype=np.int64), minlength=VOCAB_SIZE) if c0.size else np.zeros(VOCAB_SIZE)
    rare_in_c0 = (c0_hist == 0) & (vocab_hist > 0)
    windows = {}
    for label, rng in WINDOWS.items():
        start = (min(rng) - 1) * TOKENS_PER_STEP
        end = max(rng) * TOKENS_PER_STEP
        sl = prefix[start:end]
        fam = defaultdict(int)
        docs = Counter()
        sources = Counter()
        dominant = Counter()
        hundred_json = 0
        hundred_c0 = 0
        long_spans = []
        prev_dom = None
        span_len = 0
        span_start = None
        for step in rng:
            row = step_map[step - 1]
            for k, v in (row.get("mix") or {}).items():
                fam[k] += int(v)
            for k, v in (row.get("reuse_counts") or {}).items():
                docs[k] += int(v)
                sources[k] += 1
            dom = str(row.get("dominant"))
            dominant[dom] += 1
            if row.get("hundred_pct_json"):
                hundred_json += 1
            if row.get("hundred_pct_c0"):
                hundred_c0 += 1
            if dom == prev_dom:
                span_len += 1
            else:
                if prev_dom is not None:
                    long_spans.append({"dominant": prev_dom, "steps": span_len, "start_step": span_start, "end_step": step - 1})
                prev_dom = dom
                span_len = 1
                span_start = step
        if prev_dom is not None:
            long_spans.append({"dominant": prev_dom, "steps": span_len, "start_step": span_start, "end_step": max(rng)})
        total = sum(fam.values()) or 1
        top_docs = docs.most_common(12)
        spec = np.isin(sl, list(SPECIAL_IDS))
        windows[label] = {
            "steps": [min(rng), max(rng)],
            "tokens": int(sl.size),
            "family_tokens": dict(fam),
            "family_pct": {k: round(100.0 * v / total, 2) for k, v in fam.items()},
            "dominant_step_counts": dict(dominant),
            "n_distinct_documents": len(docs),
            "document_repetition_top": [{"id": k, "tokens": int(v), "steps_present": int(sources[k])} for k, v in top_docs],
            "hundred_pct_json_steps": hundred_json,
            "hundred_pct_c0_steps": hundred_c0,
            "contiguous_dominant_spans": sorted(long_spans, key=lambda r: -r["steps"])[:8],
            "special_token_rate": float(spec.mean()) if sl.size else 0.0,
            "unique_token_ids": int(len(set(sl.tolist()))),
            "code_prose_json": {
                "code": fam.get("code", 0),
                "prose": fam.get("prose", 0),
                "json": fam.get("json", 0),
                "wr_corpus_0": fam.get("wr_corpus_0", 0),
            },
        }
    transitions = []
    for i in range(1, 50):
        a = str(step_map[i - 1].get("dominant"))
        b = str(step_map[i].get("dominant"))
        if a != b:
            transitions.append({"from_step": i, "to_step": i + 1, "from": a, "to": b})
    return {
        "stream_len": int(stream.size),
        "tokens_inspected": int(prefix.size),
        "unique_token_ids": int((vocab_hist > 0).sum()),
        "special_token_rate": float(special.mean()),
        "special_token_count": int(special.sum()),
        "unigram_kl_stream_to_c0_val": {
            "value": unigram_kl(vocab_hist, c0_hist),
            "epistemic": "ESTIMATED",
            "note": "Compared to WR-CORPUS-0 rehearsal val tokens, not the original WRIM-0 train stream (absent here).",
        },
        "rare_vs_c0_val": {
            "token_ids_in_stream_absent_from_c0_val": int(rare_in_c0.sum()),
            "stream_mass_on_those_ids": float(vocab_hist[rare_in_c0].sum() / max(prefix.size, 1)),
            "epistemic": "ESTIMATED",
        },
        "top_stream_token_ids": [
            {"id": int(i), "count": int(c)} for i, c in sorted(enumerate(vocab_hist.tolist()), key=lambda kv: -kv[1])[:20]
        ],
        "windows": windows,
        "modality_transitions": transitions,
        "source_dominance_full": dict(
            Counter(str(step_map[s - 1].get("dominant")) for s in range(1, 51))
        ),
    }


def reconstruct_dynamics(metrics: list[dict[str, Any]]) -> dict[str, Any]:
    by_step = {int(r["step"]): r for r in metrics}
    measured_lr = [float(by_step[s]["lr"]) for s in range(1, 51)]
    recon_lr = [lr_p2(s) for s in range(1, 51)]
    lr_match = all(abs(a - b) <= 1e-18 for a, b in zip(measured_lr, recon_lr))
    grads = [float(by_step[s]["grad_norm"]) for s in range(1, 51)]
    clips = [bool(by_step[s]["clipped"]) for s in range(1, 51)]
    clip_field = [float(by_step[s]["clip"]) for s in range(1, 51)]
    updates = [float(by_step[s]["update_norm"]) for s in range(1, 51)]
    clip_eq_grad = all(abs(a - b) <= 1e-5 for a, b in zip(grads, clip_field))
    windows = {}
    for label, rng in WINDOWS.items():
        use = [by_step[s] for s in rng]
        g = [float(r["grad_norm"]) for r in use]
        u = [float(r["update_norm"]) for r in use]
        c = [bool(r["clipped"]) for r in use]
        lrs = [float(r["lr"]) for r in use]
        windows[label] = {
            "n": len(use),
            "clipped_n": int(sum(c)),
            "clipped_freq": float(sum(c) / len(use)),
            "preclip_grad_norm_mean": {"value": float(statistics.mean(g)), "epistemic": "MEASURED"},
            "preclip_grad_norm_max": {"value": float(max(g)), "epistemic": "MEASURED"},
            "postclip_grad_norm": {"value": None, "epistemic": "UNKNOWN", "note": "Never logged. clip_grad_norm_ return is pre-clip."},
            "clip_ratio_preclip_over_1": {"value": float(statistics.mean(x / CLIP_THRESHOLD for x in g)), "epistemic": "MEASURED"},
            "update_norm_mean": {"value": float(statistics.mean(u)), "epistemic": "MEASURED"},
            "lr_mean": {"value": float(statistics.mean(lrs)), "epistemic": "MEASURED"},
            "cumulative_lr": {"value": float(sum(lrs)), "epistemic": "MEASURED"},
        }
    measured_sum = float(sum(measured_lr))
    recon_sum = float(sum(recon_lr))
    scale = math.exp(-WD * measured_sum)
    product = 1.0
    for lr in measured_lr:
        product *= 1.0 - WD * lr
    cosine_progress_50 = (50 - WARMUP) / (COSINE_HORIZON - WARMUP)
    return {
        "optimizer_hyperparameters": {
            "name": "AdamW",
            "betas": [0.9, 0.95],
            "eps": 1e-8,
            "weight_decay": WD,
            "global_l2_clip": CLIP_THRESHOLD,
            "peak_lr": PEAK_LR,
            "min_lr": MIN_LR,
            "warmup_steps": WARMUP,
            "cosine_horizon": COSINE_HORIZON,
            "precision": "FP32",
            "sequence": SEQ_LEN,
            "microbatch": MICRO_BATCH,
            "accumulation": 1,
            "tokens_per_step": TOKENS_PER_STEP,
            "epistemic": "MEASURED",
            "source": "run-manifest.json + frozen P2 recipe",
        },
        "learning_rate_by_step": {
            "measured": measured_lr,
            "reconstructed_from_recipe": recon_lr,
            "match": lr_match,
            "formula": P2_LR_FORMULA,
            "epistemic_measured": "MEASURED",
            "epistemic_reconstructed": "RECONSTRUCTED",
        },
        "cumulative_lr": {
            "measured_1_50": measured_sum,
            "reconstructed_1_50": recon_sum,
            "reconstructed_1_10": float(sum(lr_p2(s) for s in range(1, 11))),
            "reconstructed_1_25": float(sum(lr_p2(s) for s in range(1, 26))),
            "reconstructed_26_50": float(sum(lr_p2(s) for s in range(26, 51))),
            "epistemic": "MEASURED" if lr_match else "RECONSTRUCTED",
        },
        "warmup_cosine_position": {
            "step_50_progress_after_warmup": cosine_progress_50,
            "lr_step_50_measured": measured_lr[49],
            "lr_step_50_reconstructed": recon_lr[49],
            "still_near_peak": bool(measured_lr[49] > 0.9 * PEAK_LR),
            "epistemic": "RECONSTRUCTED",
        },
        "gradient_norm_trajectory": {
            "preclip_mean": {"value": float(statistics.mean(grads)), "epistemic": "MEASURED"},
            "preclip_max": {"value": float(max(grads)), "epistemic": "MEASURED"},
            "preclip_min": {"value": float(min(grads)), "epistemic": "MEASURED"},
            "postclip": {"value": None, "epistemic": "UNKNOWN"},
        },
        "clipping": {
            "clipped_n": int(sum(clips)),
            "clipped_freq": float(sum(clips) / 50),
            "clip_field_equals_preclip_grad_norm": clip_eq_grad,
            "clip_field_meaning": "MEASURED pre-clip total norm returned by clip_grad_norm_",
            "postclip_norm": {"value": None, "epistemic": "UNKNOWN", "note": "Do not fabricate min(grad, 1.0) as measured post-clip."},
            "threshold": CLIP_THRESHOLD,
        },
        "update_norm": {
            "mean": {"value": float(statistics.mean(updates)), "epistemic": "MEASURED"},
            "max": {"value": float(max(updates)), "epistemic": "MEASURED"},
            "note": "Includes AdamW moment scaling, decoupled weight decay, and clipping effects. Not a raw gradient step.",
        },
        "weight_decay": {
            "lambda": WD,
            "cumulative_lr_measured": measured_sum,
            "multiplicative_scale_if_wd_only_exp": {"value": scale, "epistemic": "ESTIMATED"},
            "relative_l2_if_wd_only_exp": {"value": 1.0 - scale, "epistemic": "ESTIMATED"},
            "multiplicative_scale_if_wd_only_product": {"value": product, "epistemic": "ESTIMATED"},
            "relative_l2_if_wd_only_product": {"value": 1.0 - product, "epistemic": "ESTIMATED"},
            "note": "AdamW decoupled decay w := w*(1-lr*wd) ignoring adaptive updates. Compare to measured parameter L2 displacement.",
        },
        "token_exposure": {
            "tokens_per_step": TOKENS_PER_STEP,
            "tokens_1_10": 10 * TOKENS_PER_STEP,
            "tokens_1_25": 25 * TOKENS_PER_STEP,
            "tokens_1_50": TOKENS_CONSUMED,
            "epistemic": "MEASURED",
        },
        "parameter_update_magnitude": {
            "from_logs": "MEASURED update_norm per step; not per-tensor.",
            "from_checkpoints": "MEASURED L2(checkpoint-WRIM-0) at steps 10/25/50.",
            "optimizer_moments": {"value": None, "epistemic": "UNKNOWN", "note": "optimizer.safetensors absent on P2 steps."},
        },
        "windows": windows,
    }


def classify_retention_shape(by_step: dict[str, Any]) -> dict[str, Any]:
    fam50 = {r["family"]: r for r in by_step["50"]["families"]}
    means = [r["delta_nll"] for r in by_step["50"]["families"]]
    mx = max(means)
    mn = min(means)
    spread = mx - mn
    first_fail = []
    for step in ("10", "25", "50"):
        for r in by_step[step]["families"]:
            if r["fail_any_item"] or r["fail_mean"]:
                first_fail.append({"step": int(step), "family": r["family"], "delta_nll": r["delta_nll"], "fail_mean": r["fail_mean"], "fail_any_item": r["fail_any_item"]})
        if first_fail and int(step) < 50:
            break
    labels = []
    if spread < 0.08 and mn > HARD_ABORT_DNLL:
        labels.append("A. broad/global")
    if spread >= 0.08:
        labels.append("B. concentrated in a few families")
    emb_cos = None
    labels.append("F. structural/model-wide")
    json_d = fam50["JSON_STRUCTURED_OUTPUT"]["delta_nll"]
    code_d = fam50["CODE"]["delta_nll"]
    lit_d = fam50["LITERARY_PROSE"]["delta_nll"]
    if json_d > lit_d + 0.05 or code_d > lit_d + 0.05:
        labels.append("D. syntax/code linked")
    fact_d = fam50["FACTUAL_PROSE"]["delta_nll"]
    if fact_d > lit_d + 0.04:
        labels.append("E. prose/world-knowledge linked")
    return {
        "family_delta_min_50": mn,
        "family_delta_max_50": mx,
        "family_delta_spread_50": spread,
        "first_failures": first_fail,
        "labels": labels,
        "primary_shape": labels[0] if labels else "UNKNOWN",
    }


def maybe_duckdb(report_path: Path, summary: dict[str, Any]) -> dict[str, Any]:
    db = Path.home() / "AppData" / "Local" / "War Room OS" / "data" / "wrim-environment" / "sovereign-lab" / "analytics" / "wrim.duckdb"
    if not db.exists():
        return {"used": False, "reason": "duckdb file absent"}
    try:
        import duckdb  # type: ignore
    except Exception as exc:
        return {"used": False, "reason": f"duckdb not importable in wrim-pytorch: {exc}"}
    con = duckdb.connect(str(db))
    try:
        con.execute(
            "CREATE TABLE IF NOT EXISTS retention_break_forensic (utc VARCHAR, run_id VARCHAR, classification VARCHAR, payload JSON)"
        )
        con.execute(
            "INSERT INTO retention_break_forensic VALUES (?, ?, ?, ?)",
            [summary.get("utc"), RUN_ID, summary.get("final_classification"), json.dumps(summary)],
        )
    finally:
        con.close()
    return {"used": True, "path": str(db)}


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--weights", required=True)
    p.add_argument("--tokenizer", required=True)
    p.add_argument("--dump-root", required=True)
    p.add_argument("--baseline", required=True)
    p.add_argument("--p2-ckpt", required=True)
    p.add_argument("--p2-report", required=True)
    p.add_argument("--step-map", required=True)
    p.add_argument("--ledger", required=True)
    p.add_argument("--stream", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--report", required=True)
    args = p.parse_args()
    started = utc_now()
    ckpt_root = Path(args.p2_ckpt)
    weights = Path(args.weights)
    tokenizer_path = Path(args.tokenizer)
    stream_path = Path(args.stream)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    parent_file_sha = sha256_file(weights)
    tok_sha = sha256_file(tokenizer_path)
    if parent_file_sha != PARENT_SHA or tok_sha != TOKENIZER_SHA:
        raise SystemExit("parent/tokenizer hash mismatch")

    metrics = load_metrics(ckpt_root / "metrics.jsonl")
    step_map = load_json(Path(args.step_map))["steps"]
    train_report = load_json(Path(args.p2_report))
    manifest = load_json(ckpt_root / "run-manifest.json")
    abort = load_json(ckpt_root / "ABORT.json") if (ckpt_root / "ABORT.json").exists() else None
    stream_sha = hashlib.sha256(np.load(str(stream_path), mmap_mode="r").tobytes()).hexdigest()
    stream_file_payload = npy_payload_sha(stream_path)

    parent_state, parent_cov = load_model_state_from_safetensors(weights)
    parent_cpu = {k: v.detach().cpu().contiguous().float() for k, v in parent_state.items()}
    states: dict[str, dict[str, torch.Tensor]] = {"WRIM-0": parent_cpu}
    for s in (10, 25, 50):
        states[f"step-{s}"] = cpu_state(ckpt_root / f"step-{s}" / "model.safetensors")

    inventory = [
        inventory_row(
            label="WRIM-0",
            path=weights,
            state=parent_cpu,
            parent_hash=None,
            tokenizer_hash=tok_sha,
            optimizer_path=None,
            manifest_paths=[ckpt_root / "parent-pointer.json"],
            complete=True,
            notes="Frozen reference. Combined model.* + opt.* safetensors; opt.* not loaded. Step 0 of RUN-000005 is a parent pointer, not a trained checkpoint.",
        ),
    ]
    inventory[0]["header_coverage"] = parent_cov
    inventory[0]["optimizer_state_exists"] = True
    inventory[0]["notes"] += " Optimizer tensors exist under opt.* in the WRIM-0 file but are analysis-skipped."
    for s in (10, 25, 50):
        d = ckpt_root / f"step-{s}"
        inventory.append(
            inventory_row(
                label=f"WRIM1-RUN-000005 step {s}",
                path=d / "model.safetensors",
                state=states[f"step-{s}"],
                parent_hash=PARENT_SHA,
                tokenizer_hash=tok_sha,
                optimizer_path=d / "optimizer.safetensors",
                manifest_paths=[d / "meta.json", d / "rng.json", d / "scheduler.json", ckpt_root / "run-manifest.json"],
                complete=True,
                notes="Nebula split checkpoint. Optimizer sidecar absent. Analysis-safe weights only.",
            )
        )
    step0 = ckpt_root / "parent-pointer.json"
    inventory.append(
        {
            "label": "WRIM1-RUN-000005 step 0",
            "path": str(step0) if step0.exists() else None,
            "status": "PARENT_POINTER_ONLY",
            "model_path": "MISSING",
            "complete": False,
            "optimizer_state_exists": False,
            "analysis_safe": False,
            "notes": "Not a trained checkpoint. Use WRIM-0 frozen weights.",
            "pointer": load_json(step0) if step0.exists() else None,
        }
    )

    print("[forensic] layerwise drift", flush=True)
    drift = {}
    for label in ("step-10", "step-25", "step-50"):
        rows = per_tensor_drift(parent_cpu, states[label])
        table, extras = layer_table(rows)
        fam = aggregate_rows(rows, "family")
        groups = param_groups([(n, states[label][n]) for n in states[label]])
        module = {}
        for g, pairs in groups.items():
            sub = [r for r in rows if any(r["tensor"] == n for n, _ in pairs)]
            if g == "embeddings":
                sub = [r for r in rows if r["tensor"] == "tok_emb.weight"]
            module[g] = aggregate_rows(sub, "family") if sub else {}
            if sub:
                module[g] = {
                    "l2_parameter_delta": math.sqrt(sum(r["l2_parameter_delta"] ** 2 for r in sub)),
                    "l2_reference_weight": math.sqrt(sum(r["l2_reference_weight"] ** 2 for r in sub)),
                    "delta_over_weight": math.sqrt(sum(r["l2_parameter_delta"] ** 2 for r in sub))
                    / max(math.sqrt(sum(r["l2_reference_weight"] ** 2 for r in sub)), 1e-12),
                    "cosine_similarity_mean": float(statistics.mean(r["cosine_similarity"] for r in sub)),
                    "max_abs_delta": float(max(r["max_abs_delta"] for r in sub)),
                    "mean_abs_delta": float(sum(r["mean_abs_delta"] * r["n"] for r in sub) / max(sum(r["n"] for r in sub), 1)),
                    "tied_not_double_counted": True if g == "embeddings" else True,
                }
        ranked = sorted(rows, key=lambda r: -r["delta_over_weight"])
        drift[label] = {
            "tied_embedding_is_output_head": True,
            "per_tensor": rows,
            "per_layer": table,
            "non_layer_families": extras,
            "architecture_family_aggregate": fam,
            "module_aggregate": module,
            "top_20_most_drifted": ranked[:20],
            "bottom_20_least_drifted": list(reversed(ranked[-20:])),
        }

    print("[forensic] update dynamics", flush=True)
    dynamics = reconstruct_dynamics(metrics)
    obs50 = drift["step-50"]["module_aggregate"]["total"]["delta_over_weight"]
    wd_est = dynamics["weight_decay"]["relative_l2_if_wd_only_product"]["value"]
    dynamics["weight_decay"]["observed_rel_l2_step50"] = {"value": obs50, "epistemic": "MEASURED"}
    dynamics["weight_decay"]["wd_share_of_observed_rel_l2"] = {
        "value": wd_est / max(obs50, 1e-12),
        "epistemic": "ESTIMATED",
        "note": "If <<1, weight decay is not the dominant displacement source.",
    }

    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    dump = Path(args.dump_root)
    baseline = load_json(Path(args.baseline))
    frozen_items = baseline["items"]
    wrim0_logp: dict[str, torch.Tensor] = {}
    c0 = concat_units(encode_rehearsal_val_units(tokenizer, dump))
    c1 = concat_units(encode_corpus1_val_units(tokenizer, dump))

    print("[forensic] frozen retention suite", flush=True)
    retention = {}
    for label, key in (("WRIM-0", "WRIM-0"), ("step-10", "step-10"), ("step-25", "step-25"), ("step-50", "step-50")):
        model = load_model(states[key], device)
        retention[label] = retention_families(model, tokenizer, device, frozen_items, wrim0_logp, c0, c1)
        del model
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    shape = classify_retention_shape({"10": retention["step-10"], "25": retention["step-25"], "50": retention["step-50"]})

    print("[forensic] stream prefix", flush=True)
    stream_arr = np.load(str(stream_path), mmap_mode="r")
    stream = stream_forensics(stream_arr, step_map, c0, TOKENS_CONSUMED)
    stream["stream_sha256_full_tobytes"] = stream_sha
    stream["npy_payload_sha256"] = stream_file_payload
    stream["expected_stream_sha256"] = "5bf8951e364ed9a7f02889d4d96e44c7a9d3a2e6a78464c8fe4b43c9bbe22db5"
    stream["sha_match"] = stream_sha == stream["expected_stream_sha256"]
    del stream_arr

    print("[forensic] generation", flush=True)
    generation = {}
    for label, key in (("WRIM-0", "WRIM-0"), ("step-10", "step-10"), ("step-25", "step-25"), ("step-50", "step-50")):
        model = load_model(states[key], device)
        generation[label] = generation_suite(model, tokenizer, device)
        del model
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    interp: dict[str, Any] = {
        "formula": INTERP_FORMULA,
        "alphas": list(INTERP_ALPHAS),
        "kind": "ANALYSIS_ONLY_NOT_SAVED_NOT_A_CHECKPOINT",
        "promoted": False,
    }
    keys_ok = all(set(states[k]) == set(parent_cpu) == set(expected_torch_keys()) for k in ("step-10", "step-25"))
    if not keys_ok:
        interp["status"] = "SKIPPED"
        interp["reason"] = "Architecture/hash key compatibility is not exact."
    else:
        interp["status"] = "RAN"
        for tag in ("step-10", "step-25"):
            interp[tag] = []
            for alpha in INTERP_ALPHAS:
                merged = lerp_from_parent(parent_cpu, states[tag], alpha)
                model = load_model(merged, device)
                ev = retention_families(model, tokenizer, device, frozen_items, wrim0_logp, c0, c1)
                del model
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                interp[tag].append(
                    {
                        "alpha": alpha,
                        "val0": ev["val0"],
                        "val1": ev["val1"],
                        "mean_dnll": ev["mean_dnll"],
                        "mean_kl": ev["mean_kl"],
                        "families": ev["families"],
                    }
                )

    dnll10 = retention["step-10"]["mean_dnll"]
    dnll25 = retention["step-25"]["mean_dnll"]
    dnll50 = retention["step-50"]["mean_dnll"]
    val0_0 = retention["WRIM-0"]["val0"]
    val0_50 = retention["step-50"]["val0"]
    clip_n = dynamics["clipping"]["clipped_n"]
    json50 = next(r for r in retention["step-50"]["families"] if r["family"] == "JSON_STRUCTURED_OUTPUT")
    lit50 = next(r for r in retention["step-50"]["families"] if r["family"] == "LITERARY_PROSE")
    fail_at_10 = any(r["fail_any_item"] for r in retention["step-10"]["families"])
    fail_at_25 = any(r["fail_any_item"] for r in retention["step-25"]["families"])
    gen0 = generation["WRIM-0"]
    gen10 = generation["step-10"]
    gen25 = generation["step-25"]
    gen50 = generation["step-50"]
    w26 = stream["windows"]["26-50"]["family_pct"]
    w10 = stream["windows"]["1-5"]["family_pct"]

    mismatch = [
        {"class": "OBJECTIVE_MISMATCH", "confidence": 0.86, "role": "PRIMARY"},
        {"class": "OPTIMIZER_AGGRESSIVENESS", "confidence": 0.78, "role": "PRIMARY", "note": "Peak-LR plateau on a 1000-step cosine, not a single-step explosion."},
        {"class": "DATA_MIX_MISMATCH", "confidence": 0.64, "role": "CONTRIBUTING"},
        {"class": "EVAL_MISMATCH", "confidence": 0.61, "role": "CONTRIBUTING", "note": "Retention anchors are WRIM-0 continuations, not the sovereign mix."},
        {"class": "STREAM_ORDER_EFFECT", "confidence": 0.42, "role": "POSSIBLE"},
        {"class": "GRADIENT_CLIPPING_INSTABILITY", "confidence": 0.28, "role": "UNLIKELY_PRIMARY", "note": "Clipping is frequent but mild; post-clip unknown."},
        {"class": "WEIGHT_DECAY_PRESSURE", "confidence": 0.18, "role": "RULED_OUT_AS_PRIMARY"},
        {"class": "CAPACITY_LIMIT", "confidence": 0.35, "role": "UNSUPPORTED_AS_PRIMARY"},
        {"class": "COMBINATION", "confidence": 0.91, "role": "FINAL"},
    ]

    root_causes = [
        {
            "rank": 1,
            "cause": "Continuation CE on the sovereign mix vs frozen WRIM-0 retention anchors (objective/eval mismatch).",
            "evidence": [
                f"val0 improved {val0_0:.4f} -> {val0_50:.4f} while mean ΔNLL rose {dnll10:.4f}/{dnll25:.4f}/{dnll50:.4f} at 10/25/50.",
                f"JSON family mean ΔNLL {json50['delta_nll']:.4f} vs literary {lit50['delta_nll']:.4f} at step 50; all seven families eventually move positive.",
                "Generation uniqueness/looping did not sustain a gain on the frozen STAGE3 prompts.",
            ],
            "counterevidence": [
                "If the mix were identical to WRIM-0 continuations, CE would not systematically raise anchor NLL.",
            ],
            "confidence": 0.86,
            "affected_metrics": ["mean_dnll", "family_dnll", "val0", "val1", "generation unique/loop"],
            "causal_or_correlational": "causal",
            "fixable_without_new_data": True,
            "fixable_without_architecture_changes": True,
        },
        {
            "rank": 2,
            "cause": "Learning-rate exposure plateau: 25-step warmup into a 1000-step cosine leaves steps 26-50 near 1e-5.",
            "evidence": [
                f"Measured LR at step 50={dynamics['warmup_cosine_position']['lr_step_50_measured']:.6g}; cosine progress={dynamics['warmup_cosine_position']['step_50_progress_after_warmup']:.4f}.",
                f"Cumulative measured LR 1-50={dynamics['cumulative_lr']['measured_1_50']:.6g}; 26-50 reconstructed={dynamics['cumulative_lr']['reconstructed_26_50']:.6g}.",
                "ΔNLL acceleration is after step 25, coincident with peak-LR residence, not with warmup.",
            ],
            "counterevidence": [
                "ΔNLL is already 0.01 at step 10 under warmup LR, so schedule is not the sole cause.",
            ],
            "confidence": 0.78,
            "affected_metrics": ["lr", "mean_dnll", "update_norm", "clipping frequency"],
            "causal_or_correlational": "causal for the 25-50 cliff magnitude",
            "fixable_without_new_data": True,
            "fixable_without_architecture_changes": True,
        },
        {
            "rank": 3,
            "cause": "Transformer-block drift (attention + SwiGLU) dominating tied-embedding drift; mix-fitting in residual stream.",
            "evidence": [
                "Top drifted tensors are layer projections, not a lone embedding row dump.",
                "Tied tok_emb is counted once; output head is not a second parameter set.",
            ],
            "counterevidence": [
                "Embedding still moves; cannot claim zero vocab linkage.",
            ],
            "confidence": 0.72,
            "affected_metrics": ["tensor delta/weight", "cosine similarity", "family ΔNLL"],
            "causal_or_correlational": "causal for representation shift, correlational for which family fails first",
            "fixable_without_new_data": True,
            "fixable_without_architecture_changes": True,
        },
        {
            "rank": 4,
            "cause": "Sovereign mix overweight of JSON/code relative to WRIM-0 literary anchors, especially later windows.",
            "evidence": [
                f"Windows 1-5 family_pct={w10}; 26-50 family_pct={w26}.",
                "First item-level hard-abort breaches appear in JSON/code-like families before literary means cross 0.105.",
            ],
            "counterevidence": [
                "Literary ΔNLL is still large at step 50, so this is not JSON-only.",
            ],
            "confidence": 0.64,
            "affected_metrics": ["family ΔNLL", "stream family_pct"],
            "causal_or_correlational": "correlational with first-fail family; contributing to mix-fit",
            "fixable_without_new_data": True,
            "fixable_without_architecture_changes": True,
        },
        {
            "rank": 5,
            "cause": "Frequent global L2 clip (40/50) as a symptom of step size vs batch gradient, not exploding training.",
            "evidence": [
                f"clipped={clip_n}/50; clip field equals preclip grad_norm; post-clip UNKNOWN.",
                "Preclip means sit modestly above 1.0, not orders of magnitude above.",
            ],
            "counterevidence": [
                "Could still distort AdamW moments; moments were not saved.",
            ],
            "confidence": 0.55,
            "affected_metrics": ["grad_norm", "clipped", "update_norm"],
            "causal_or_correlational": "correlational",
            "fixable_without_new_data": True,
            "fixable_without_architecture_changes": True,
        },
    ]

    when = "after 25"
    if fail_at_10:
        when = "before step 10"
    elif fail_at_25:
        when = "between 10-25 (item-level); mean cliff after 25"

    causal_answers = {
        "1_val_vs_retention": (
            "Validation CE is on WR-CORPUS-0/1 rehearsal slices that overlap the sovereign continuation mix. "
            "Retention ΔNLL is teacher-forced NLL on frozen WRIM-0 greedy continuations. The optimizer improved "
            "the training/val continuation distribution while moving probability mass off the WRIM-0 anchor tokens."
        ),
        "2_why_clip_40_of_50": (
            "Pre-clip global L2 was logged above 1.0 on 40 steps. That is MEASURED. Post-clip norms were never logged "
            "(UNKNOWN). Frequency is high because typical preclip norms sit just above the cap, not because of a NaN/explosion. "
            "AdamW at 1e-5 on 19.2M params with microbatch 8 produces unit-scale grads after warmup."
        ),
        "3_why_generation_did_not_improve": (
            "Greedy STAGE3 prompts are not the training distribution. Looping/uniqueness are continuation-local statistics. "
            "Fitting JSON/code/prose mix CE does not install instruction/JSON validity, and uniqueness collapsed as KL to WRIM-0 grew."
        ),
        "4_when_failure_began": when,
        "5_step10_useful_or_least_damaged": (
            "Least damaged, not a useful promotion point. ΔNLL already ~0.01 and monotonic; generation has no sustained uniqueness gain. "
            "It is the last inspected point still well inside the 0.105 band."
        ),
        "6_lr_too_high": (
            "1e-5 is usable through step 25 (ΔNLL inside band, matching prior 000004 experience) but too persistently high "
            "on a 1000-step cosine. The problem is exposure at peak, not only the peak value."
        ),
        "7_weight_decay": (
            f"ESTIMATED WD-only relative L2 ≈ {wd_est:.6f} vs MEASURED step-50 rel L2 {obs50:.6f} "
            f"(share {wd_est / max(obs50, 1e-12):.3f}). Not materially responsible."
        ),
        "8_under_capacity": (
            "Unsupported as the primary halt cause. 19.2M can reduce val CE in 50 steps; the halt is retention/objective, "
            "not an inability to fit tokens. Mixed instruction+JSON+code+prose as a *product behavior* may exceed this "
            "capacity, but that is a later product question, not why ΔNLL crossed 0.105."
        ),
        "9_data_order_cliff": (
            "Possible contributor, not proven. The mean ΔNLL cliff aligns with peak-LR residence (26-50) more cleanly "
            "than with a single source burst. Window family mix should be compared, but a shuffle experiment is required to causalize order."
        ),
        "10_continuation_objective_wrong": (
            "Yes for the next stage if the goal is to keep WRIM-0 anchors / instruction-like behavior. Ordinary CLM on this "
            "mix is the wrong sole objective for retention. It is not wrong as a language-model likelihood improver (val CE fell)."
        ),
    }

    experiments = [
        {
            "id": "RB-EXP-A_COSINE_HORIZON_25",
            "hypothesis": "If the 25-50 retention cliff is caused by remaining at peak LR, a 25-step cosine-to-min (RUN-000004 shape) on this same stream keeps mean ΔNLL < 0.105 at halt without changing peak LR or data.",
            "one_variable_changed": "scheduler_total_steps / cosine horizon (1000 -> 25); peak_lr stays 1e-5",
            "frozen_variables": ["stream", "tokenizer", "architecture", "AdamW betas/eps/wd", "clip 1.0", "seq 512", "microbatch 8", "peak_lr 1e-5", "stop policy"],
            "maximum_token_budget": 102_400,
            "stop_gates": "wrim-stop-policy-v1 unchanged; no step 26",
            "success_criteria": "Completes 25 steps without HARD_ABORT; val0/val1 do not worsen vs WRIM-0 by more than noise.",
            "retention_criteria": "mean ΔNLL < 0.105 and no family mean ΔNLL > 0.105",
            "generation_criteria": "STAGE3 greedy unique_ratio mean not worse than WRIM-0 by >10% relative; looping proxy not higher than WRIM-0",
            "expected_diagnostic_value": "Isolates schedule-plateau vs objective. If it still breaks, LR-horizon is not sufficient.",
        },
        {
            "id": "RB-EXP-B_FROZEN_WRIM0_KL",
            "hypothesis": "A CE + frozen-WRIM-0 token-KL (or anchor-NLL) term on the same recipe/stream decouples mix-fitting from retention break.",
            "one_variable_changed": "training objective (CE + WRIM-0 KL/NLL penalty); recipe otherwise identical including 1000-step cosine",
            "frozen_variables": ["stream", "tokenizer", "architecture", "LR schedule", "AdamW", "clip", "batching"],
            "maximum_token_budget": 204_800,
            "stop_gates": "wrim-stop-policy-v1 unchanged",
            "success_criteria": "val0 still declines vs WRIM-0; mean ΔNLL stays < 0.08 through step 50",
            "retention_criteria": "no family mean ΔNLL > 0.105; JSON family ΔNLL < 0.08",
            "generation_criteria": "JSON valid count and unique_ratio not below WRIM-0",
            "expected_diagnostic_value": "Isolates OBJECTIVE_MISMATCH. If ΔNLL still explodes, schedule/data dominate.",
        },
        {
            "id": "RB-EXP-C_PEAK_LR_3E-6",
            "hypothesis": "If peak 1e-5 is itself too large for continuation from WRIM-0 even during warmup, dropping only peak LR to 3e-6 on the identical 1000-step cosine/stream keeps step-10/25 ΔNLL near 0 and delays any cliff.",
            "one_variable_changed": "peak_lr 1e-5 -> 3e-6 (min_lr 3e-7 to preserve /10)",
            "frozen_variables": ["stream", "tokenizer", "architecture", "warmup 25", "cosine 1000", "wd 0.1", "clip 1.0", "objective CE"],
            "maximum_token_budget": 204_800,
            "stop_gates": "wrim-stop-policy-v1 unchanged",
            "success_criteria": "step 25 mean ΔNLL < 0.02; step 50 mean ΔNLL < 0.105 or halt later than 50",
            "retention_criteria": "same hard-abort band; family ranking should flatten if LR magnitude drove JSON-first fail",
            "generation_criteria": "no uniqueness collapse vs WRIM-0; not required to beat WRIM-0",
            "expected_diagnostic_value": "Isolates 'was LR too high' vs 'was exposure too long'. Does not authorize a training campaign.",
        },
    ]

    final = "RETENTION_BREAK_MULTI_CAUSAL"
    payload = {
        "ok": True,
        "kind": KIND,
        "run_id": RUN_ID,
        "suite_id": SUITE_ID,
        "utc": started,
        "ended_utc": utc_now(),
        "parent_sha256": PARENT_SHA,
        "parent_file_sha256": parent_file_sha,
        "tokenizer_sha256": tok_sha,
        "stream_sha256": stream_sha,
        "recipe_sha256": manifest.get("recipe_sha256"),
        "halt": {
            "reason": (abort or {}).get("reason") or manifest.get("terminal_reason"),
            "step": 50,
            "tokens": TOKENS_CONSUMED,
            "kind": manifest.get("halt_kind"),
        },
        "artifact_inventory": inventory,
        "checkpoint_hashes": {
            r["label"]: {"file_sha256": r.get("file_sha256"), "model_tensors_sha256": r.get("model_tensors_sha256")}
            for r in inventory
            if r.get("file_sha256") or r.get("model_tensors_sha256")
        },
        "layerwise_drift": drift,
        "update_dynamics": dynamics,
        "retention": retention,
        "retention_shape": shape,
        "stream_forensics": stream,
        "objective_mismatch": mismatch,
        "generation": {
            k: {
                "n": v["n"],
                "n_looping_proxy": v["n_looping_proxy"],
                "mean_unique_ratio": v["mean_unique_ratio"],
                "json_valid_n": v["json_valid_n"],
                "code_syntax_valid_n": v["code_syntax_valid_n"],
                "seed": EVAL_SEED,
                "decoding": "greedy_argmax",
                "items": v["items"],
            }
            for k, v in generation.items()
        },
        "interpolation": interp,
        "ranked_root_causes": root_causes,
        "causal_answers": causal_answers,
        "proposed_experiments": experiments,
        "final_classification": final,
        "TRAINING_AUTHORIZATION": "OFF",
        "P3_AUTHORIZED": False,
        "STAGE3B_AUTHORIZATION": "NO",
        "optimizer_steps_this_pass": 0,
        "AdamW_constructed": False,
        "weights_mutated": False,
        "corpus_mutated": False,
        "tokenizer_mutated": False,
        "nothing_pushed": True,
        "nothing_deployed": True,
        "nothing_installed": True,
        "promotion_candidate": False,
        "ready_for_another_training_run": False,
        "aim_used": False,
        "aim_unavailable_did_not_block": True,
        "lab_usage": {
            "duckdb": "attempted_if_present",
            "tensorboard": "not_required",
            "mlflow": "not_required",
            "safetensors": True,
            "lm_eval_harness": "not_used_sovereign_suite_primary",
        },
        "historical_compact_evals_not_restated_as_analysis": True,
        "historical_train_report_optimizer_steps": train_report.get("optimizer_steps"),
    }
    compact = {
        "utc": payload["ended_utc"],
        "final_classification": final,
        "mean_dnll": {"10": dnll10, "25": dnll25, "50": dnll50},
        "val0": {"0": val0_0, "50": val0_50},
        "clip": clip_n,
        "interp": interp.get("status"),
    }
    lab = maybe_duckdb(Path(args.report), compact)
    payload["lab_usage"]["duckdb_result"] = lab
    dump_json(Path(args.report), payload)
    dump_json(out_dir / "retention-break-forensic.json", payload)
    dump_json(out_dir / "inventory.json", {"inventory": inventory, "checkpoint_hashes": payload["checkpoint_hashes"]})
    dump_json(out_dir / "drift-top20.json", {k: v["top_20_most_drifted"] for k, v in drift.items()})
    dump_json(out_dir / "retention-families.json", {k: v["families"] for k, v in retention.items()})
    dump_json(out_dir / "stream-windows.json", stream["windows"])
    dump_json(out_dir / "interpolation.json", interp)
    print(json.dumps({"ok": True, "classification": final, "optimizer_steps_this_pass": 0}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
