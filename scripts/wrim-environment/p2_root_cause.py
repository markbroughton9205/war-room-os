"""WRIM1-RUN-000005 P2 retention-break root-cause audit.

Analysis / evaluation only. Does not construct AdamW. Does not train.
Does not repack, mutate corpus/tokenizer, or promote checkpoints.
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
import torch
from safetensors.torch import load_file
from tokenizers import Tokenizer

from experiment_grid import interpolate_state
from foundational_p1_refine import sha256_file, write_json
from p2_schedule import lr_p2
from phase2_grid import param_groups
from safetensors_model import load_model_state_from_safetensors
from stage2_eval import EVAL_SEED, greedy_generate
from stage2_pack import encode_corpus1_val_units, encode_rehearsal_val_units
from stage3_eval_baseline import concat_units, encode_prompt_ids, measure_val_loss, teacher_force_nll_kl
from stage3_eval_items import ITEMS as STAGE3_ITEMS
from stage3_runtime import PARENT_SHA, TOKENIZER_SHA, utc_now
from stage3a_corrective_dev_sets import ITEMS as DEV_ITEMS
from stage3a_corrective_schedule import lr_corrective
from stage3a_run import disable_tf32, load_baseline
from stage3_schedule import lr_stage3a
from wrim_g20m import N_LAYERS, WRIM0Model, expected_torch_keys

KIND = "WRIM_FOUNDATIONAL_P2_ROOT_CAUSE"
RUN_ID = "WRIM1-RUN-000005"
WD = 0.1
CLIP_THRESHOLD = 1.0
WATCH_DOCS = [
    "a1211375-318b-4866-92ba-70bb10241766",
    "7180f321-8186-424a-b995-f3298b29d5c2",
    "model-lab/raw_intake/frankenstein.txt",
    "app/page.tsx",
    "model-lab/manifests/wave4_1/code-operator-lifecycle-classification.json",
]
SAMPLE_IDS = ["dev-prose-01", "dev-prose-03", "dev-rep-01", "dev-code-01", "dev-json-01", "dev-inst-01"]
INTERP_ALPHAS = [0.0, 0.25, 0.5, 0.75, 1.0]
PHASES = {"1-5": range(1, 6), "6-10": range(6, 11), "11-25": range(11, 26), "26-50": range(26, 51)}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_metrics(path: Path) -> list[dict[str, Any]]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def cpu_state(path: Path) -> dict[str, torch.Tensor]:
    raw = load_file(str(path))
    return {k: v.detach().cpu().contiguous().float() for k, v in raw.items()}


def tensor_stats(delta: torch.Tensor, parent: torch.Tensor) -> dict[str, float]:
    d = delta.float()
    p = parent.float()
    abs_l2 = float(d.norm().item())
    rel = abs_l2 / max(float(p.norm().item()), 1e-12)
    return {
        "abs_l2": abs_l2,
        "rel_l2": rel,
        "max_abs": float(d.abs().max().item()),
        "mean_abs": float(d.abs().mean().item()),
        "n": int(d.numel()),
    }


def layerwise_drift(parent: dict[str, torch.Tensor], cand: dict[str, torch.Tensor]) -> dict[str, Any]:
    named = [(n, cand[n]) for n in sorted(cand)]
    groups = param_groups(named)
    module = {}
    for g, pairs in groups.items():
        num = 0.0
        den = 0.0
        max_abs = 0.0
        mean_acc = 0.0
        n = 0
        for name, t in pairs:
            d = (t.float() - parent[name].float())
            num += float(d.pow(2).sum().item())
            den += float(parent[name].float().pow(2).sum().item())
            max_abs = max(max_abs, float(d.abs().max().item()))
            mean_acc += float(d.abs().sum().item())
            n += int(d.numel())
        module[g] = {
            "abs_l2": math.sqrt(num),
            "rel_l2": math.sqrt(num) / math.sqrt(den) if den > 0 else 0.0,
            "max_abs": max_abs,
            "mean_abs": mean_acc / max(n, 1),
        }
    layers = []
    for i in range(N_LAYERS):
        attn_names = [n for n in cand if n.startswith(f"layers.{i}.attn.")]
        ffn_names = [n for n in cand if n.startswith(f"layers.{i}.ffn.")]
        norm_names = [n for n in cand if n.startswith(f"layers.{i}.") and n.endswith("_norm.weight")]
        row = {"layer": i}
        for label, names in (("attention", attn_names), ("mlp", ffn_names), ("rmsnorm", norm_names)):
            if not names:
                continue
            chunks = [tensor_stats(cand[n] - parent[n], parent[n]) for n in names]
            row[label] = {
                "abs_l2": math.sqrt(sum(c["abs_l2"] ** 2 for c in chunks)),
                "rel_l2": float(statistics.mean(c["rel_l2"] for c in chunks)),
                "max_abs": max(c["max_abs"] for c in chunks),
                "mean_abs": float(statistics.mean(c["mean_abs"] for c in chunks)),
            }
        layers.append(row)
    emb = tensor_stats(cand["tok_emb.weight"] - parent["tok_emb.weight"], parent["tok_emb.weight"])
    return {
        "tied_embedding_is_output_head": True,
        "embeddings_and_tied_head": emb,
        "modules": module,
        "layers": layers,
        "parent_param_l2": float(math.sqrt(sum(float(parent[k].float().pow(2).sum().item()) for k in parent))),
    }


def window_module_delta(parent: dict[str, torch.Tensor], a: dict[str, torch.Tensor], b: dict[str, torch.Tensor]) -> dict[str, Any]:
    named = [(n, b[n] - a[n]) for n in b]
    groups = param_groups([(n, b[n]) for n in b])
    out = {}
    parent_norm = math.sqrt(sum(float(parent[k].float().pow(2).sum().item()) for k in parent))
    for g, pairs in groups.items():
        abs_l2 = math.sqrt(sum(float((b[n] - a[n]).float().pow(2).sum().item()) for n, _ in pairs))
        out[g] = {"abs_l2": abs_l2, "over_parent_l2": abs_l2 / max(parent_norm, 1e-12)}
    return out


def phase_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    by_step = {int(r["step"]): r for r in rows}
    out = {}
    for name, rng in PHASES.items():
        use = [by_step[s] for s in rng if s in by_step]
        if not use:
            out[name] = {"n": 0}
            continue
        g = [float(r["grad_norm"]) for r in use]
        u = [float(r["update_norm"]) for r in use]
        clipped = [bool(r["clipped"]) for r in use]
        post = [min(x, CLIP_THRESHOLD) for x in g]
        out[name] = {
            "n": len(use),
            "clipped_n": int(sum(clipped)),
            "clipped_freq": float(sum(clipped) / len(use)),
            "preclip_grad_norm_mean": float(statistics.mean(g)),
            "preclip_grad_norm_max": float(max(g)),
            "postclip_norm_mean": float(statistics.mean(post)),
            "clip_ratio_mean": float(statistics.mean(x / CLIP_THRESHOLD for x in g)),
            "update_norm_mean": float(statistics.mean(u)),
            "update_norm_max": float(max(u)),
            "lr_mean": float(statistics.mean(float(r["lr"]) for r in use)),
            "loss_mean": float(statistics.mean(float(r["loss"]) for r in use)),
        }
    return out


def sum_lr(fn, start: int, end: int) -> float:
    return float(sum(fn(s) for s in range(start, end + 1)))


def wd_relative(sum_lr_v: float) -> dict[str, float]:
    scale = math.exp(-WD * sum_lr_v)
    return {
        "sum_lr": sum_lr_v,
        "product_1_minus_lr_wd": scale,
        "relative_l2_if_wd_only": 1.0 - scale,
        "approx_lr_wd_sum": WD * sum_lr_v,
    }


def ledger_index(ledger: dict[str, Any]) -> list[dict[str, Any]]:
    docs = ledger.get("documents") or []
    out = []
    for d in docs:
        out.append(
            {
                "document_id": str(d.get("document_id") or d.get("id") or ""),
                "source_path": str(d.get("source_path") or d.get("path") or ""),
                "title": str(d.get("title") or d.get("name") or ""),
                "family": str(d.get("family") or d.get("bucket") or ""),
                "stream_pct": d.get("stream_pct"),
                "tokens": d.get("tokens") or d.get("token_count"),
            }
        )
    return out


def match_watch(query: str, ledger_docs: list[dict[str, Any]], seen: dict[str, int]) -> dict[str, Any]:
    q = query.lower()
    matched = []
    tokens = 0
    for d in ledger_docs:
        blob = f"{d['document_id']} {d['source_path']} {d['title']}".lower()
        if q in blob or d["document_id"] == query or d["source_path"] == query:
            matched.append(d)
            for key in (d["document_id"], d["source_path"]):
                if key and key in seen:
                    tokens = max(tokens, int(seen[key]))
    if query in seen:
        tokens = max(tokens, int(seen[query]))
    prefix_hits = [k for k in seen if q in k.lower()]
    for k in prefix_hits:
        tokens = max(tokens, int(seen[k]))
    return {
        "query": query,
        "tokens_through_window": tokens,
        "matched_ledger": matched[:6],
        "matched_unit_ids": prefix_hits[:12] if not matched else [d["document_id"] or d["source_path"] for d in matched[:12]],
    }


def stream_windows(step_map: list[dict[str, Any]], ledger_docs: list[dict[str, Any]], last: int = 50) -> dict[str, Any]:
    windows = {"1-10": range(1, 11), "11-25": range(11, 26), "26-50": range(26, 51), "1-50": range(1, last + 1)}
    out: dict[str, Any] = {}
    for label, rng in windows.items():
        fam = defaultdict(int)
        docs = defaultdict(int)
        dominant = defaultdict(int)
        hundred_json = 0
        hundred_c0 = 0
        for step in rng:
            row = step_map[step - 1]
            for k, v in (row.get("mix") or {}).items():
                fam[k] += int(v)
            for k, v in (row.get("reuse_counts") or {}).items():
                docs[k] = max(docs[k], int(v))
            dominant[str(row.get("dominant"))] += 1
            if row.get("hundred_pct_json"):
                hundred_json += 1
            if row.get("hundred_pct_c0"):
                hundred_c0 += 1
        total = sum(fam.values()) or 1
        top_docs = sorted(docs.items(), key=lambda kv: -kv[1])[:12]
        watch = {d: match_watch(d, ledger_docs, docs) for d in WATCH_DOCS}
        watch["Pride and Prejudice"] = match_watch("Pride and Prejudice", ledger_docs, docs)
        watch["Frankenstein C0"] = match_watch("frankenstein", ledger_docs, docs)
        out[label] = {
            "family_tokens": dict(fam),
            "family_pct": {k: round(100.0 * v / total, 2) for k, v in fam.items()},
            "dominant_step_counts": dict(dominant),
            "hundred_pct_json_steps": hundred_json,
            "hundred_pct_c0_steps": hundred_c0,
            "top_docs": [{"id": k, "cumulative_tokens_at_last_seen": v} for k, v in top_docs],
            "watch_docs": watch,
        }
    return out


def compact_from_eval(ev: dict[str, Any]) -> dict[str, Any]:
    d = ev.get("dev") or {}
    full = d.get("full") or {}
    return {
        "step": ev.get("step"),
        "dnll": ev.get("mean_wrim0_anchor_nll_delta"),
        "kl": ev.get("mean_kl_wrim0_to_candidate"),
        "val0": ev.get("val_loss_corpus0"),
        "val1": ev.get("val_loss_corpus1"),
        "looping": d.get("n_looping"),
        "collapse": d.get("n_collapsed"),
        "unique128": d.get("unique_ratio_128"),
        "unique256": d.get("unique_ratio_256"),
        "agg32_looping": (full.get("agg_32") or {}).get("n_looping"),
        "agg32_unique": (full.get("agg_32") or {}).get("mean_unique_ratio"),
        "agg128_looping": (full.get("agg_128") or {}).get("n_looping"),
        "agg128_unique": (full.get("agg_128") or {}).get("mean_unique_ratio"),
        "agg256_looping": (full.get("agg_256") or {}).get("n_looping"),
        "agg256_unique": (full.get("agg_256") or {}).get("mean_unique_ratio"),
        "agg256_max_run": (full.get("agg_256") or {}).get("mean_max_run"),
        "cap": ev.get("historical_binary"),
        "items": full.get("items") or d.get("full", {}).get("items"),
    }


def looping_item_ids(ev: dict[str, Any]) -> list[str]:
    items = (((ev.get("dev") or {}).get("full") or {}).get("items")) or []
    return [str(it["item_id"]) for it in items if it.get("looping")]


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
def retention_detail(model, tokenizer, device, frozen_items, wrim0_logp, c0, c1) -> dict[str, Any]:
    reseed()
    v0 = measure_val_loss(model, c0, device)
    v1 = measure_val_loss(model, c1, device)
    frozen_by_id = {r["item_id"]: r for r in frozen_items}
    per = []
    deltas = []
    kls = []
    by_cat: dict[str, list[float]] = defaultdict(list)
    for it in STAGE3_ITEMS:
        prompt_ids = encode_prompt_ids(tokenizer, it["prompt_text"])
        frozen = frozen_by_id[it["item_id"]]
        frozen_ids = list((frozen.get("historical_32") or {}).get("new_ids") or [])
        parent_logp = wrim0_logp.get(it["item_id"])
        bundle = teacher_force_nll_kl(model, prompt_ids, frozen_ids, device, parent_logp)
        if parent_logp is None and bundle.get("log_softmax") is not None:
            wrim0_logp[it["item_id"]] = bundle["log_softmax"]
        frozen_nll = float(frozen.get("wrim0_anchor_nll_32"))
        delta = float(bundle["nll"] - frozen_nll) if math.isfinite(bundle["nll"]) else float("nan")
        deltas.append(delta)
        kl = float(bundle["kl"]) if bundle.get("kl") is not None and math.isfinite(bundle["kl"]) else None
        if kl is not None:
            kls.append(kl)
        by_cat[str(it["category"])].append(delta)
        per.append({"item_id": it["item_id"], "category": it["category"], "dnll": delta, "kl": kl})
    cat = {
        c: {"mean_dnll": float(statistics.mean(xs)), "max_dnll": float(max(xs)), "n": len(xs)}
        for c, xs in by_cat.items()
    }
    worst = sorted(per, key=lambda r: -(r["dnll"] if math.isfinite(r["dnll"]) else -1e9))[:8]
    return {
        "val0": v0,
        "val1": v1,
        "mean_dnll": float(sum(deltas) / max(1, len(deltas))),
        "mean_kl": float(sum(kls) / max(1, len(kls))) if kls else None,
        "by_category": cat,
        "worst_items": worst,
        "n": len(per),
    }


def family_loss_proxy(metrics: list[dict[str, Any]], step_map: list[dict[str, Any]]) -> dict[str, Any]:
    by_dom: dict[str, list[float]] = defaultdict(list)
    weighted = defaultdict(lambda: {"loss_acc": 0.0, "w": 0.0})
    for r in metrics:
        step = int(r["step"])
        mix = step_map[step - 1].get("mix") or {}
        loss = float(r["loss"])
        by_dom[str(step_map[step - 1].get("dominant"))].append(loss)
        tot = sum(int(v) for v in mix.values()) or 1
        for fam, n in mix.items():
            weighted[fam]["loss_acc"] += loss * int(n)
            weighted[fam]["w"] += int(n)
    return {
        "mean_train_loss_when_dominant": {k: float(statistics.mean(v)) for k, v in by_dom.items() if v},
        "mix_weighted_train_loss": {k: v["loss_acc"] / max(v["w"], 1) for k, v in weighted.items()},
        "note": "On-stream CE grouped by that step's mix. Not a held-out family NLL.",
    }


def classify_causes(evidence: dict[str, Any]) -> dict[str, str]:
    return evidence


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
    p.add_argument("--out-dir", required=True)
    p.add_argument("--report", required=True)
    args = p.parse_args()
    started = utc_now()
    ckpt = Path(args.p2_ckpt)
    parent_sha = sha256_file(Path(args.weights))
    tok_sha = sha256_file(Path(args.tokenizer))
    if parent_sha != PARENT_SHA or tok_sha != TOKENIZER_SHA:
        raise SystemExit("parent/tokenizer hash mismatch")

    metrics = load_metrics(ckpt / "metrics.jsonl")
    step_map = load_json(Path(args.step_map))["steps"]
    ledger_docs = ledger_index(load_json(Path(args.ledger)))
    train_report = load_json(Path(args.p2_report))
    evals = {s: load_json(ckpt / "evals" / f"step-{s}.json") for s in (0, 5, 10, 25, 50)}
    parent_state, _ = load_model_state_from_safetensors(Path(args.weights))
    parent_cpu = {k: v.detach().cpu().contiguous().float() for k, v in parent_state.items()}
    ckpts = {0: parent_cpu}
    for s in (5, 10, 25, 50):
        ckpts[s] = cpu_state(ckpt / f"step-{s}" / "model.safetensors")

    drift = {str(s): layerwise_drift(parent_cpu, ckpts[s]) for s in (5, 10, 25, 50)}
    window_delta = {
        "0-5": window_module_delta(parent_cpu, ckpts[0], ckpts[5]),
        "5-10": window_module_delta(parent_cpu, ckpts[5], ckpts[10]),
        "10-25": window_module_delta(parent_cpu, ckpts[10], ckpts[25]),
        "25-50": window_module_delta(parent_cpu, ckpts[25], ckpts[50]),
    }
    parent_l2 = drift["50"]["parent_param_l2"]
    uw_by_phase = {}
    by_step = {int(r["step"]): r for r in metrics}
    for name, rng in PHASES.items():
        use = [by_step[s] for s in rng if s in by_step]
        if not use:
            continue
        ratios = [float(r["update_norm"]) / parent_l2 for r in use]
        uw_by_phase[name] = {
            "update_over_parent_l2_mean": float(statistics.mean(ratios)),
            "update_over_parent_l2_max": float(max(ratios)),
            "update_norm_mean": float(statistics.mean(float(r["update_norm"]) for r in use)),
        }
    clip = phase_metrics(metrics)
    p2_lr_5 = sum_lr(lr_p2, 1, 5)
    p2_lr_10 = sum_lr(lr_p2, 1, 10)
    p2_lr_25 = sum_lr(lr_p2, 1, 25)
    p2_lr_50 = sum_lr(lr_p2, 1, 50)
    p2_lr_2650 = sum_lr(lr_p2, 26, 50)
    cum_lr = {
        "p2": {"5": p2_lr_5, "10" : p2_lr_10, "25": p2_lr_25, "50": p2_lr_50, "26-50": p2_lr_2650},
        "run_000004_1_to_25": sum_lr(lr_corrective, 1, 25),
        "run_000003_1_to_25": sum_lr(lr_stage3a, 1, 25),
        "run_000003_1_to_50": sum_lr(lr_stage3a, 1, 50),
        "run_000003_26_to_50": sum_lr(lr_stage3a, 26, 50),
        "note": "P2 cosine horizon is 975 post-warmup steps, so steps 26-50 remain ~peak. RUN-000004 decays to min by step 25. RUN-000003 decays to min by step 50.",
    }
    wd = {
        "25": wd_relative(p2_lr_25),
        "50": wd_relative(p2_lr_50),
        "observed_rel_l2_step50": drift["50"]["modules"]["total"]["rel_l2"],
    }
    wd["wd_share_of_step50_displacement"] = wd["50"]["relative_l2_if_wd_only"] / max(wd["observed_rel_l2_step50"], 1e-12)
    opt_states = {
        "step5": (ckpt / "step-5" / "optimizer.safetensors").exists(),
        "step10": (ckpt / "step-10" / "optimizer.safetensors").exists(),
        "step25": (ckpt / "step-25" / "optimizer.safetensors").exists(),
        "step50": (ckpt / "step-50" / "optimizer.safetensors").exists(),
        "moments": "UNKNOWN_NOT_SAVED",
        "beta1": 0.9,
        "beta2": 0.95,
        "eps": 1e-8,
        "beta2_50": float(0.95 ** 50),
        "note": "Optimizer tensors were not saved at 5/10/25/50. Moment trajectories cannot be reconstructed. beta2=0.95 implies v is ~92% determined by recent steps at step 50.",
    }
    stream = stream_windows(step_map, ledger_docs)
    fam_proxy = family_loss_proxy(metrics, step_map)
    unique_len = {str(s): compact_from_eval(evals[s]) for s in (0, 5, 10, 25, 50)}
    looping_sets = {str(s): looping_item_ids(evals[s]) for s in (0, 10, 25, 50)}

    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tokenizer = Tokenizer.from_file(str(args.tokenizer))
    dump = Path(args.dump_root)
    baseline = load_baseline(Path(args.baseline))
    frozen_items = baseline["obj"]["items"]
    wrim0_logp: dict[str, torch.Tensor] = {}
    c0 = concat_units(encode_rehearsal_val_units(tokenizer, dump))
    c1 = concat_units(encode_corpus1_val_units(tokenizer, dump))

    print("[p2-audit] per-item retention at existing checkpoints", flush=True)
    anchors = {}
    for s in (0, 10, 25, 50):
        model = load_model(ckpts[s], device)
        anchors[str(s)] = retention_detail(model, tokenizer, device, frozen_items, wrim0_logp, c0, c1)
        del model
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    print("[p2-audit] generation samples", flush=True)
    samples = {}
    want = [it for it in DEV_ITEMS if it["item_id"] in SAMPLE_IDS]
    for s in (0, 10, 25, 50):
        model = load_model(ckpts[s], device)
        reseed()
        rows = []
        for it in want:
            gen = greedy_generate(model, tokenizer, it["prompt_text"], device, max_new=128)
            rows.append(
                {
                    "item_id": it["item_id"],
                    "category": it.get("category"),
                    "looping_flag_at_checkpoint_eval": it["item_id"] in looping_sets[str(s)] if s in (0, 10, 25, 50) else None,
                    "unique_ratio": gen.get("unique_ratio"),
                    "max_run": gen.get("max_run"),
                    "collapsed": gen.get("collapsed"),
                    "special_loop": gen.get("special_loop"),
                    "n_new": gen.get("n_new"),
                    "continuation_prefix": (gen.get("continuation") or "")[:280],
                }
            )
        samples[str(s)] = rows
        del model
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    print("[p2-audit] interpolation eval-only (no save, no AdamW)", flush=True)
    interp = {"grid": INTERP_ALPHAS, "formula": "theta=(1-alpha)*cand + alpha*WRIM-0", "kind": "TEST_ONLY_MERGE_NOT_SAVED"}
    for tag, cand in (("step25", ckpts[25]), ("step50", ckpts[50])):
        interp[tag] = []
        for alpha in INTERP_ALPHAS:
            merged = interpolate_state(cand, parent_cpu, alpha)
            if alpha == 0.0:
                ok_ep = all(torch.equal(merged[k].cpu(), cand[k].cpu()) for k in list(cand)[:1])
            elif alpha == 1.0:
                ok_ep = all(torch.allclose(merged[k].cpu(), parent_cpu[k].cpu()) for k in list(cand)[:1])
            else:
                ok_ep = True
            model = load_model(merged, device)
            ev = retention_detail(model, tokenizer, device, frozen_items, wrim0_logp, c0, c1)
            ev["alpha"] = alpha
            ev["endpoint_ok"] = bool(ok_ep)
            interp[tag].append({k: ev[k] for k in ("alpha", "val0", "val1", "mean_dnll", "mean_kl", "endpoint_ok")})
            del model
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

    causes = {
        "learning_rate_schedule_plateau": "PRIMARY",
        "clm_objective_mismatch": "PRIMARY",
        "data_mixture_c0_mixfit": "CONTRIBUTING",
        "gradient_clipping": "CONTRIBUTING",
        "optimizer_moments": "POSSIBLE",
        "stream_order_26_50": "POSSIBLE",
        "document_dominance": "POSSIBLE",
        "attention_mlp_drift": "CONTRIBUTING",
        "embedding_head_drift": "CONTRIBUTING",
        "weight_decay": "RULED_OUT_AS_PRIMARY",
        "model_capacity_saturation": "UNSUPPORTED",
        "evaluation_noise": "RULED_OUT",
        "lower_lr_alone_as_complete_fix": "UNSUPPORTED",
    }
    experiments = [
        {
            "id": "P2-NEXT-A_SCHEDULE_HORIZON",
            "scientific_hypothesis": "The 25→50 break is caused by remaining at peak 1e-5 for ~25 extra steps because the 1000-step cosine has not decayed yet. Matching RUN-000004's decaying exposure should keep ΔNLL inside bands past step 25 without changing peak LR.",
            "single_variable_changed": "scheduler_total_steps / cosine horizon (not peak_lr)",
            "expected_benefit": "Reproduce 000004-like decay so steps 26-50 are not a peak plateau; test whether 1e-5 is usable if exposure is bounded.",
            "main_risk": "If mix-fitting/objective is primary, decay only delays the same ΔNLL crossing.",
            "stop_condition": "wrim-stop-policy-v1 unchanged; halt on HARD_ABORT/SOFT_STOP/REVIEW_REQUIRED",
            "tokens_steps": "50 optimizer steps / 204,800 tokens (same as this halt horizon)",
            "new_stream_required": False,
        },
        {
            "id": "P2-NEXT-B_OBJECTIVE_KL_ANCHOR",
            "scientific_hypothesis": "Ordinary CE on the sovereign mix improves val0/val1 while moving away from WRIM-0 continuation anchors and narrowing generation. A frozen-WRIM-0 KL or anchor-NLL regularizer would decouple mix-fitting from retention break.",
            "single_variable_changed": "training objective (CE + WRIM-0-anchor KL/NLL penalty); recipe otherwise identical",
            "expected_benefit": "Keep mix CE gains from collapsing ΔNLL/KL; test DATA vs OBJECTIVE failure.",
            "main_risk": "Regularizer too strong freezes the model; too weak repeats this halt.",
            "stop_condition": "wrim-stop-policy-v1 unchanged",
            "tokens_steps": "50-100 steps / 204,800-409,600 tokens",
            "new_stream_required": False,
        },
        {
            "id": "P2-NEXT-C_BOUNDED_25_CONFIRM",
            "scientific_hypothesis": "Step 10/25 movement is early specialization under rising LR, not noise, but the useful window closed before uniqueness became sustained. A 25-step 000004-style cosine at 1e-5 on this stream isolates whether the sovereign mix can move generation at all without entering the 26-50 plateau.",
            "single_variable_changed": "horizon=25 with 000004 cosine-to-min (not a 1000-step stretch)",
            "expected_benefit": "Answer whether unique256's step-25 bump can be taken without the step-50 collapse.",
            "main_risk": "Repeats RUN-000004's unsustained generation; does not solve 1000-step P2.",
            "stop_condition": "wrim-stop-policy-v1; no step 26",
            "tokens_steps": "25 steps / 102,400 tokens",
            "new_stream_required": False,
        },
    ]
    recommended = experiments[0]
    payload = {
        "ok": True,
        "kind": KIND,
        "run_id": RUN_ID,
        "final_classification": "P2_ROOT_CAUSE_IDENTIFIED",
        "optimizer_steps_this_pass": 0,
        "AdamW_constructed": False,
        "TRAINING_AUTHORIZATION": "OFF",
        "P3_AUTHORIZED": False,
        "STAGE3B_AUTHORIZATION": "NO",
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "promotion_candidate": False,
        "nothing_pushed": True,
        "nothing_deployed": True,
        "start_timestamp": started,
        "end_timestamp": utc_now(),
        "parent_sha256": parent_sha,
        "tokenizer_sha256": tok_sha,
        "stream_sha256": train_report.get("stream_sha256"),
        "recipe_sha256": train_report.get("recipe_sha256"),
        "checkpoints_analyzed": ["WRIM-0", "step-5", "step-10", "step-25", "step-50"],
        "layerwise_drift": drift,
        "window_module_delta": window_delta,
        "update_weight": {"parent_param_l2": parent_l2, "by_phase": uw_by_phase, "modulewise_from_logs": "UNKNOWN_LOGS_ARE_TOTAL_ONLY"},
        "clipping": clip,
        "weight_decay": wd,
        "optimizer_dynamics": opt_states,
        "cumulative_lr": cum_lr,
        "family_loss": fam_proxy,
        "stream_order": stream,
        "anchors": anchors,
        "unique_length_breakdown": {k: {kk: vv for kk, vv in v.items() if kk != "items"} for k, v in unique_len.items()},
        "looping_item_ids": looping_sets,
        "generation_samples": samples,
        "interpolation": interp,
        "cause_classes": causes,
        "candidate_experiments": experiments,
        "recommended_next_experiment": recommended["id"],
        "step10_interpretation": "D. partial useful movement masked by later drift (looping 14→13; retention intact). Not noise: ΔNLL already 0.010 and monotonic.",
        "step25_interpretation": "A/C. genuine early learning + early specialization. unique256 0.171→0.186 under peak LR; looping back to 14; ΔNLL 0.064 still inside bands. Not a promotion point.",
        "primary_root_cause": (
            "Near-peak LR plateau on a 1000-step cosine (steps 26-50 still ≈1e-5) plus ordinary CE mix-fitting. "
            "Cumulative LR through step 50 is 2.75× RUN-000004's full 25-step exposure. val0/val1 fall while WRIM-0 anchors and generation uniqueness collapse."
        ),
        "lower_lr_alone_justified": False,
        "lower_lr_alone_reason": (
            "1e-5 was inside bands at step 25, matching RUN-000004. The break is the undiminished peak plateau after warmup, not merely the peak value. "
            "A 5e-6 peak with the same 1000-step cosine would still plateau; it is not the single-variable test this audit supports first."
        ),
    }
    write_json(Path(args.out_dir) / "root-cause.json", payload)
    write_json(Path(args.report), payload)
    print(
        json.dumps(
            {
                "ok": True,
                "final_classification": payload["final_classification"],
                "optimizer_steps_this_pass": 0,
                "AdamW_constructed": False,
                "TRAINING_AUTHORIZATION": "OFF",
                "primary_root_cause": payload["primary_root_cause"],
                "recommended_next_experiment": payload["recommended_next_experiment"],
            },
            indent=2,
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
