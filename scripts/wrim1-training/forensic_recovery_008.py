#!/usr/bin/env python3
"""READ-ONLY forensics for TEST-WRIM1.1-RECOVERY-008. No training. No weight updates."""
from __future__ import annotations

import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import numpy as np
from safetensors.numpy import load_file

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(SCRIPT_DIR.parent / "sovereign-model-lab"))

from checkpoint_io import load_bundle, load_model_weights  # noqa: E402
from hashes import sha256_bytes, sha256_file, tensor_tree_sha256  # noqa: E402
from interleave_curriculum import build_span_index  # noqa: E402
from pack_wrim1_run_000002 import materialize_official_pack  # noqa: E402
from paths import repo_root  # noqa: E402
from run_recovery_experiment import load_tokenizer, masked_loss_fn  # noqa: E402
from diagnose_collapse import topk_diag, generate  # noqa: E402
from trainer_core import build_from_config  # noqa: E402
from training_config import official_training_config  # noqa: E402
from rng_state import lr_at_step  # noqa: E402

EXPERIMENT = "TEST-WRIM1.1-RECOVERY-008"
WORK_REL = "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-008"
OUT_REL = "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-008-FORENSICS"
OFFICIAL_REL = "model-lab/manifests/wrim1_1_official/WRIM1-RUN-000002"
R007_REL = "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-007"
CTX = 512
BATCH = 8
PEAK = 3e-5
WARMUP = 25
WINDOW = list(range(80, 126))
SEED = 20260830

ORIGIN_CLASS = {
    "wr_corpus_0": "REHEARSAL",
    "prose": "QUALITY_PROSE",
    "code": "QUALITY_CODE",
    "json": "JSON",
    "instruction_response": "INSTRUCTION",
    "structured_json": "JSON",
    "war_room_concepts": "WR_CONCEPT",
    "evidence_uncertainty": "EVIDENCE",
    "tool_use": "TOOL",
    "correction_failure": "CORRECTION_SYNTHETIC",
    "code_supervised": "CODE_SUPERVISED",
}


def dump(path: Path, obj: Any) -> None:
    path.write_text(json.dumps(obj, indent=2, default=str) + "\n")


def classify(bucket: str, origin: str) -> str:
    if bucket == "supervised":
        return ORIGIN_CLASS.get(origin, f"OTHER_SUP:{origin}")
    return ORIGIN_CLASS.get(bucket, f"OTHER:{bucket}")


def spans_for_range(spans, start, end):
    out = []
    for s in spans:
        lo = max(start, s["start"])
        hi = min(end, s["end"])
        if hi > lo:
            out.append({**s, "overlap": hi - lo, "lo": lo, "hi": hi})
    return out


def l2(arr: np.ndarray) -> float:
    a = arr.astype(np.float64).ravel()
    return float(np.sqrt(np.dot(a, a)))


def layer_of(name: str) -> str:
    if name.startswith("tok_emb") or "tok_emb" in name:
        return "tok_emb"
    if name.startswith("norm_f"):
        return "norm_f"
    if name.startswith("layers."):
        parts = name.split(".")
        if len(parts) >= 2 and parts[1].isdigit():
            return f"layers.{parts[1]}"
    return "other"


def load_metrics(path: Path) -> dict[int, dict]:
    out = {}
    if not path.is_file():
        return out
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        if rec.get("kind") == "train":
            out[int(rec["step"])] = rec
    return out


def load_diag_map(work: Path) -> dict[int, dict]:
    out = {}
    for p in sorted(work.glob("*-step-*.json")):
        if "cap-eval" in p.name:
            continue
        d = json.loads(p.read_text())
        if "collapsed_probes" in d:
            out[int(d["step"])] = d
    return out


def underscore_stats(ids: np.ndarray, tok_us: int, tok_lab: list[int]) -> dict:
    n = int(ids.size) or 1
    us = int(np.count_nonzero(ids == tok_us)) if tok_us is not None else 0
    lab = 0
    if len(tok_lab) == 1:
        lab = int(np.count_nonzero(ids == tok_lab[0]))
    return {"n_tokens": int(ids.size), "underscore_count": us, "underscore_frac": us / n, "lab_token_count": lab}


def main() -> int:
    root = repo_root()
    work = root / WORK_REL
    out = root / OUT_REL
    out.mkdir(parents=True, exist_ok=True)
    official = root / OFFICIAL_REL
    r007 = root / R007_REL

    tokenizer = load_tokenizer(root)
    eos_id = tokenizer.token_to_id("<|eos|>")
    us_id = tokenizer.token_to_id("_")
    pipe_id = tokenizer.token_to_id("|")
    b_id = tokenizer.token_to_id("B")
    lab_ids = tokenizer.encode("-lab").ids
    not_ids = tokenizer.encode("_not_").ids
    token_ids = {
        "_": us_id,
        "|": pipe_id,
        "B": b_id,
        "-lab": lab_ids,
        "_not_": not_ids,
    }

    print("materializing pack for span/example identity (no training)...", flush=True)
    packed = materialize_official_pack(root=root, tokenizer=tokenizer)
    train = packed["train_stream"]
    mask = packed["train_mask"]
    train_sha = sha256_file(work / "train.npy")
    # identity vs frozen npy
    frozen = np.load(work / "train.npy")
    frozen_mask = np.load(work / "train-mask.npy")
    if not np.array_equal(train, frozen) or not np.array_equal(mask, frozen_mask):
        dump(out / "FAIL.json", {"reason": "rematerialize != frozen 008 stream", "train_sha": train_sha})
        print("STOP: stream identity failed")
        return 2
    spans = build_span_index(packed["train_units"])
    dump(out / "stream-identity.json", {
        "train_npy_sha256": train_sha,
        "array_equal_frozen_008": True,
        "n_tokens": int(train.size),
        "n_units": len(packed["train_units"]),
        "READ_ONLY": True,
        "NO_TRAINING": True,
    })

    planned = json.loads((work / "planned-step-source-map.json").read_text())["steps"]
    fam_loss = {int(r["step"]): r for r in json.loads((work / "family-loss.json").read_text())}
    grads = {int(r["step"]): r for r in json.loads((work / "grad-rows.json").read_text())}
    metrics = load_metrics(work / "metrics.jsonl")
    diags = load_diag_map(work)
    official_planned = json.loads((official / "planned-step-source-map.json").read_text())["steps"]
    official_metrics = load_metrics(official / "metrics.jsonl")
    r007_metrics = load_metrics(r007 / "metrics.jsonl")
    r007_fam = {int(r["step"]): r for r in json.loads((r007 / "family-loss.json").read_text())} if (r007 / "family-loss.json").is_file() else {}
    r007_grads = {}
    if (r007 / "metrics.jsonl").is_file():
        pass

    table = []
    family_seq = []
    densities = []
    region_units = []
    for step in WINDOW:
        prow = planned[step - 1] if step - 1 < len(planned) else None
        consumed = step <= 120
        row: dict[str, Any] = {
            "step": step,
            "consumed_in_008": consumed,
            "learning_rate": lr_at_step(min(step - 1, 150), 150, PEAK, WARMUP, 0.1) if step >= 1 else None,
        }
        if prow is None:
            table.append(row)
            continue
        starts = list(prow["seq_starts"])
        batch_tokens = BATCH * CTX
        # loss mask over y positions: stream[start+1 : start+1+ctx]
        trainable = 0
        masked = 0
        eos_n = 0
        unit_hits = []
        origin_tok = Counter()
        class_tok = Counter()
        us_n = 0
        lab_n = 0
        snake = 0
        model_lab_hits = 0
        decoded_bits = []
        for st in starts:
            sl = train[st:st + CTX]
            ml = mask[st + 1:st + 1 + CTX] if st + 1 + CTX <= mask.size else mask[st:st + CTX]
            if ml.size < CTX:
                ml = np.pad(ml, (0, CTX - ml.size))
            trainable += int(np.sum(ml > 0))
            masked += int(np.sum(ml <= 0))
            eos_n += int(np.count_nonzero(sl == eos_id))
            if us_id is not None:
                us_n += int(np.count_nonzero(sl == us_id))
            if lab_ids:
                lab_n += int(np.count_nonzero(sl == lab_ids[0]))
            hits = spans_for_range(spans, st, st + CTX)
            for h in hits:
                origin_tok[h["origin"]] += h["overlap"]
                cls = classify(h["bucket"], h["origin"])
                class_tok[cls] += h["overlap"]
                unit_hits.append({
                    "unit_id": h["unit_id"],
                    "bucket": h["bucket"],
                    "origin": h["origin"],
                    "overlap": h["overlap"],
                    "class": cls,
                    "source_path": h.get("source_path"),
                })
            text = tokenizer.decode(sl.tolist(), skip_special_tokens=False)
            decoded_bits.append(text[:80])
            snake += text.count("_")
            if "model-lab" in text or "model_lab" in text:
                model_lab_hits += 1
        density = trainable / batch_tokens
        dominant_class = max(class_tok, key=class_tok.get) if class_tok else "OTHER"
        objective = "SUPERVISED" if class_tok.get("INSTRUCTION", 0) + class_tok.get("JSON", 0) + class_tok.get("WR_CONCEPT", 0) + class_tok.get("EVIDENCE", 0) + class_tok.get("TOOL", 0) + class_tok.get("CORRECTION_SYNTHETIC", 0) + class_tok.get("CODE_SUPERVISED", 0) >= batch_tokens * 0.15 else "CAUSAL"
        if (prow.get("pct") or {}).get("supervised", 0) >= 15:
            objective = "MIXED_SUPERVISED" if objective == "CAUSAL" else "SUPERVISED"
        if (prow.get("supervised_pct") or 0) >= 15:
            objective = "SUPERVISED" if (prow.get("supervised_pct") or 0) >= 50 else "MIXED"
        m = metrics.get(step, {})
        g = grads.get(step, {})
        fl = fam_loss.get(step, {})
        dg = diags.get(step)
        row.update({
            "seq_starts": starts,
            "source_family_dominant": prow.get("dominant_source_family"),
            "objective_style": objective,
            "dominant_class": dominant_class,
            "class_token_counts": dict(class_tok),
            "origin_token_counts": dict(origin_tok),
            "unit_ids": sorted({u["unit_id"] for u in unit_hits}),
            "unit_hits": unit_hits[:24],
            "rehearsal_pct": prow.get("rehearsal_pct"),
            "prose_pct": prow.get("prose_pct"),
            "code_pct": prow.get("code_pct"),
            "supervised_pct": prow.get("supervised_pct") or (prow.get("pct") or {}).get("supervised"),
            "prompt_or_masked_tokens": masked,
            "trainable_target_tokens": trainable,
            "total_batch_tokens": batch_tokens,
            "target_token_density": density,
            "eos_count": eos_n,
            "underscore_token_count": us_n,
            "lab_token_count": lab_n,
            "underscore_chars_in_decode": snake,
            "model_lab_seq_hits": model_lab_hits,
            "train_loss": m.get("train_loss"),
            "source_local_ce": fl.get("ce_by_family"),
            "global_grad_l2": g.get("global_grad_l2") or m.get("global_grad_l2"),
            "clip_event": g.get("clip_applied") or m.get("clip_applied"),
            "approx_param_update_scale": g.get("approx_param_update_scale"),
            "collapse_probes": None if dg is None else dg.get("collapsed_probes"),
            "unique_ratio": None if dg is None else dg.get("mean_unique_ratio"),
            "p_period": None if dg is None else (dg.get("logits") or {}).get("p_period"),
            "p_pipe": None if dg is None else (dg.get("logits") or {}).get("p_pipe"),
            "p_underscore": None if dg is None else (dg.get("logits") or {}).get("p_underscore"),
            "entropy": None if dg is None else (dg.get("logits") or {}).get("entropy"),
            "underscore_run": None if dg is None else dg.get("underscore_run"),
            "symbol_run": None if dg is None else dg.get("symbol_run"),
            "kl": None if dg is None else (dg.get("kl_to_wrim0") or {}).get("mean_kl_wrim0_to_current"),
            "param_l2": None if dg is None else (dg.get("param_drift") or {}).get("global_param_l2_from_wrim0"),
            "official_same_seq_starts": (
                step <= len(official_planned) and official_planned[step - 1].get("seq_starts") == starts
            ),
            "official_consumed": step <= 100,
        })
        table.append(row)
        family_seq.append({
            "step": step,
            "class": dominant_class,
            "objective_style": row["objective_style"],
            "supervised_pct": row["supervised_pct"],
            "consumed_in_008": consumed,
        })
        densities.append({
            "step": step,
            "trainable_target_tokens": trainable,
            "masked_tokens": masked,
            "density": density,
            "supervised_pct": row["supervised_pct"],
            "kind": "sparse" if density < 0.85 else ("dense" if density >= 0.98 else "moderate"),
        })
        region_units.extend(unit_hits)

    dump(out / "step_80_125_table.json", {"steps": table, "note": "steps 121-125 planned but not consumed (008 stopped at 120)"})
    dump(out / "family_sequence.json", {
        "ordered": [f"{r['step']} {r['class']}" for r in family_seq],
        "rows": family_seq,
    })
    dump(out / "mask_density.json", {
        "per_step": densities,
        "lm_reference": "ordinary causal-LM batches have density ~1.0 (all next tokens trained)",
        "window_mean_density": float(np.mean([d["density"] for d in densities if d["step"] <= 120])),
        "supervised_like": [d for d in densities if d["step"] <= 120 and (d["supervised_pct"] or 0) >= 15],
    })

    # region hash 80-120 consumed
    start80 = planned[79]["seq_starts"][0]
    end120 = planned[119]["seq_starts"][-1] + CTX
    region = train[start80:end120]
    region_mask = mask[start80:end120]
    dump(out / "official_vs_008_region_compare.json", {
        "packed_stream_sha256": train_sha,
        "identical_stream_to_000002": True,
        "first100_seq_starts_equal": all(
            planned[i]["seq_starts"] == official_planned[i]["seq_starts"] for i in range(100)
        ),
        "steps_80_100_same_examples": True,
        "steps_101_120": {
            "consumed_by_008": True,
            "consumed_by_000002": False,
            "reason": "official early-stopped at 100; same packed bytes still exist in 000002 plan",
            "seq_start_range": [planned[100]["seq_starts"][0], planned[119]["seq_starts"][-1]],
            "region_sha256": sha256_bytes(region.tobytes()),
            "n_tokens": int(region.size),
        },
        "steps_80_100_region_sha256": sha256_bytes(train[start80:planned[99]["seq_starts"][-1] + CTX].tobytes()),
        "unique_unit_ids_80_120": sorted(set(u["unit_id"] for u in region_units)),
        "unique_origins_80_120": sorted(set(u["origin"] for u in region_units)),
    })

    # grad by family in 80-120
    by_fam = defaultdict(list)
    for row in table:
        if not row.get("consumed_in_008"):
            continue
        fam = row.get("dominant_class") or "OTHER"
        g = row.get("global_grad_l2")
        if g is not None:
            by_fam[fam].append(float(g))
    grad_by = {}
    for fam, xs in sorted(by_fam.items()):
        arr = np.array(xs, dtype=np.float64)
        clips = sum(1 for r in table if r.get("dominant_class") == fam and r.get("clip_event") and r.get("consumed_in_008"))
        grad_by[fam] = {
            "n": int(arr.size),
            "mean": float(arr.mean()),
            "median": float(np.median(arr)),
            "max": float(arr.max()),
            "clip_count": clips,
        }
    dump(out / "gradient_by_family.json", {
        "window": "steps 80-120 consumed",
        "grouping": "dominant_class of the batch",
        "families": grad_by,
        "sample_size_note": "n is number of steps where that class dominated; small n is flagged",
    })

    # loss by family CE from family-loss rows
    ce_acc = defaultdict(list)
    for row in table:
        if not row.get("consumed_in_008"):
            continue
        for k, v in (row.get("source_local_ce") or {}).items():
            if v is not None:
                ce_acc[k].append(float(v))
    dump(out / "loss_by_family.json", {
        "window_80_120": {k: {"n": len(v), "mean": float(np.mean(v)), "last": v[-1]} for k, v in ce_acc.items()},
        "early_run_1_25": None,
    })
    early_ce = defaultdict(list)
    for s, rec in fam_loss.items():
        if 1 <= s <= 25:
            for k, v in (rec.get("ce_by_family") or {}).items():
                if v is not None:
                    early_ce[k].append(float(v))
    late_ce = defaultdict(list)
    for s, rec in fam_loss.items():
        if 90 <= s <= 100:
            for k, v in (rec.get("ce_by_family") or {}).items():
                if v is not None:
                    late_ce[k].append(float(v))
    dump(out / "loss_by_family.json", {
        "steps_1_25_mean": {k: float(np.mean(v)) for k, v in early_ce.items()},
        "steps_90_100_mean": {k: float(np.mean(v)) for k, v in late_ce.items()},
        "steps_80_120_mean": {k: {"n": len(v), "mean": float(np.mean(v))} for k, v in ce_acc.items()},
        "delta_early_to_100": {
            k: (float(np.mean(late_ce[k])) - float(np.mean(early_ce[k])))
            for k in set(early_ce) & set(late_ce)
        },
    })

    # update magnitude by family (approx scale)
    upd_by = defaultdict(list)
    for row in table:
        if row.get("consumed_in_008") and row.get("approx_param_update_scale") is not None:
            upd_by[row["dominant_class"]].append(float(row["approx_param_update_scale"]))
    dump(out / "update_magnitude_by_family.json", {
        "definition": "approx_param_update_scale = lr * min(global_grad_l2, clip=1.0); not full parameter delta",
        "families": {k: {"n": len(v), "mean": float(np.mean(v)), "max": float(np.max(v))} for k, v in upd_by.items()},
        "checkpoint_l2_deltas": "see layer_drift.json",
    })

    # short targets + mask boundaries for supervised units overlapping 80-120
    sup_lens = []
    short_strings = Counter()
    boundaries = []
    us_early = 0
    us_win = 0
    n_early = 0
    n_win = 0
    # early region steps 1-40
    early_start = planned[0]["seq_starts"][0]
    early_end = planned[39]["seq_starts"][-1] + CTX
    us_early = int(np.count_nonzero(train[early_start:early_end] == us_id)) if us_id is not None else 0
    n_early = int(early_end - early_start)
    us_win = int(np.count_nonzero(region == us_id)) if us_id is not None else 0
    n_win = int(region.size)
    lab_early = int(np.count_nonzero(train[early_start:early_end] == lab_ids[0])) if lab_ids else 0
    lab_win = int(np.count_nonzero(region == lab_ids[0])) if lab_ids else 0

    assistant_id = tokenizer.token_to_id("<|assistant|>")
    seen_sup = set()
    for u in packed["train_units"]:
        if u.bucket != "supervised":
            continue
        # overlap window?
        # find span
    span_by_id = {s["unit_id"]: s for s in spans}
    for uid in sorted(set(x["unit_id"] for x in region_units)):
        sp = span_by_id.get(uid)
        if not sp or sp["bucket"] != "supervised":
            continue
        if uid in seen_sup:
            continue
        seen_sup.add(uid)
        u = next(x for x in packed["train_units"] if x.unit_id == uid)
        ids = u.tokens.tolist()
        msk = np.asarray(u.loss_mask).tolist()
        apos = ids.index(assistant_id) if assistant_id in ids else None
        tgt = [i for i, m in enumerate(msk) if int(m) == 1]
        n_tgt = len(tgt)
        sup_lens.append(n_tgt)
        tgt_ids = [ids[i] for i in tgt]
        tgt_text = tokenizer.decode(tgt_ids, skip_special_tokens=False)
        key = tgt_text.strip()[:80]
        if n_tgt <= 16:
            short_strings[key] += 1
        if len(boundaries) < 8:
            boundaries.append({
                "exampleId": uid,
                "origin": u.origin,
                "n_tokens": int(u.tokens.size),
                "assistant_index": apos,
                "n_prompt_masked": int(sum(1 for m in msk if int(m) == 0)),
                "n_target": n_tgt,
                "target_preview": tgt_text[:200],
                "prompt_preview": tokenizer.decode(ids[: (apos or 8) + 1], skip_special_tokens=False)[:200],
                "ends_eos": bool(eos_id in ids[-2:]),
            })
    bins = {"1-4": 0, "5-16": 0, "17-64": 0, "65+": 0}
    for n in sup_lens:
        if n <= 4:
            bins["1-4"] += 1
        elif n <= 16:
            bins["5-16"] += 1
        elif n <= 64:
            bins["17-64"] += 1
        else:
            bins["65+"] += 1
    dump(out / "short_targets.json", {
        "supervised_units_in_window": len(sup_lens),
        "target_length_bins": bins,
        "mean_target_tokens": float(np.mean(sup_lens)) if sup_lens else None,
        "repeated_short_targets": short_strings.most_common(20),
    })
    dump(out / "mask_boundaries.json", {"samples": boundaries})
    dump(out / "underscore_exposure.json", {
        "token_id_underscore": us_id,
        "token_id_lab0": None if not lab_ids else lab_ids[0],
        "steps_1_40": {"n": n_early, "underscore": us_early, "frac": us_early / max(1, n_early), "lab0": lab_early},
        "steps_80_120": {"n": n_win, "underscore": us_win, "frac": us_win / max(1, n_win), "lab0": lab_win},
        "decode_model_lab_steps": [r["step"] for r in table if r.get("model_lab_seq_hits")],
    })

    # layer drift + optimizer + output tokens from checkpoints
    cfg = official_training_config()
    cfg.update({"learning_rate": PEAK, "warmup_steps": WARMUP, "total_steps": 150, "seed": SEED})

    def model_np(step: int) -> dict:
        ck = work / f"checkpoint-step-{step:06d}"
        return load_file(str(ck / "model.safetensors"))

    def opt_np(step: int) -> dict:
        ck = work / f"checkpoint-step-{step:06d}"
        return load_file(str(ck / "optimizer.safetensors"))

    def delta_l2(a, b) -> dict:
        by = defaultdict(lambda: 0.0)
        glob = 0.0
        for k in a:
            d = a[k].astype(np.float64) - b[k].astype(np.float64)
            n = float(np.sqrt(np.sum(d * d)))
            glob += n * n
            by[layer_of(k)] += n * n
        return {"global": float(math.sqrt(glob)), "per_layer": {k: float(math.sqrt(v)) for k, v in sorted(by.items())}}

    m75 = model_np(75)
    m100 = model_np(100)
    m120 = model_np(120)
    drift = {
        "75_to_100": delta_l2(m100, m75),
        "100_to_120": delta_l2(m120, m100),
        "75_to_120": delta_l2(m120, m75),
    }
    dump(out / "layer_drift.json", drift)

    def token_row(model_map, tid):
        if tid is None:
            return None
        w = model_map.get("tok_emb.weight")
        if w is None:
            # maybe nested name
            for k in model_map:
                if "tok_emb" in k and k.endswith("weight"):
                    w = model_map[k]
                    break
        if w is None:
            return None
        vec = w[int(tid)].astype(np.float64)
        return {"l2": float(np.sqrt(np.dot(vec, vec))), "mean": float(vec.mean())}

    def tok_delta(a, b, tid):
        if tid is None:
            return None
        wa = None
        wb = None
        for k in a:
            if "tok_emb" in k and "weight" in k:
                wa = a[k]
                wb = b[k]
                break
        if wa is None:
            return None
        d = wa[int(tid)].astype(np.float64) - wb[int(tid)].astype(np.float64)
        return float(np.sqrt(np.dot(d, d)))

    emb_keys = [k for k in m100 if "tok_emb" in k]
    dump(out / "output_token_drift.json", {
        "tok_emb_keys": emb_keys,
        "token_ids": {k: (v if not isinstance(v, list) else v) for k, v in token_ids.items()},
        "l2_75": {name: token_row(m75, (ids[0] if isinstance(ids, list) else ids)) for name, ids in token_ids.items()},
        "delta_75_100": {name: tok_delta(m100, m75, (ids[0] if isinstance(ids, list) else ids)) for name, ids in token_ids.items()},
        "delta_100_120": {name: tok_delta(m120, m100, (ids[0] if isinstance(ids, list) else ids)) for name, ids in token_ids.items()},
        "median_tok_delta_75_100": None,
    })
    # median over vocab of row deltas 75->100 vs degeneration tokens
    w75 = next(m75[k] for k in m75 if "tok_emb" in k and "weight" in k)
    w100 = next(m100[k] for k in m100 if "tok_emb" in k and "weight" in k)
    w120 = next(m120[k] for k in m120 if "tok_emb" in k and "weight" in k)
    d75100 = np.sqrt(np.sum((w100.astype(np.float64) - w75.astype(np.float64)) ** 2, axis=1))
    d100120 = np.sqrt(np.sum((w120.astype(np.float64) - w100.astype(np.float64)) ** 2, axis=1))
    out_tok = json.loads((out / "output_token_drift.json").read_text())
    out_tok["median_tok_delta_75_100"] = float(np.median(d75100))
    out_tok["p90_tok_delta_75_100"] = float(np.percentile(d75100, 90))
    out_tok["median_tok_delta_100_120"] = float(np.median(d100120))
    out_tok["underscore_delta_75_100"] = float(d75100[us_id]) if us_id is not None else None
    out_tok["underscore_delta_100_120"] = float(d100120[us_id]) if us_id is not None else None
    out_tok["lab0_delta_75_100"] = float(d75100[lab_ids[0]]) if lab_ids else None
    out_tok["lab0_delta_100_120"] = float(d100120[lab_ids[0]]) if lab_ids else None
    dump(out / "output_token_drift.json", out_tok)

    def adam_stats(step: int, lr: float) -> dict:
        st = opt_np(step)
        m_l2 = 0.0
        v_l2 = 0.0
        adam_l2 = 0.0
        wd_l2 = 0.0
        md = model_np(step)
        beta1, beta2 = 0.9, 0.95
        t = int(np.array(st.get("step", np.array(step))).reshape(-1)[0]) if "step" in st else step
        b1t = 1 - beta1 ** max(t, 1)
        b2t = 1 - beta2 ** max(t, 1)
        for k, arr in st.items():
            if k.endswith(".m"):
                m_l2 += float(np.sum(arr.astype(np.float64) ** 2))
            elif k.endswith(".v"):
                v_l2 += float(np.sum(arr.astype(np.float64) ** 2))
        # pair m/v with weights
        for k, arr in st.items():
            if not k.endswith(".m"):
                continue
            base = k[:-2]
            v = st.get(base + ".v")
            wkey = None
            for cand in (base, base.replace(".weight", "") ):
                if cand in md:
                    wkey = cand
                    break
            # model keys match without .m
            wk = base
            if wk not in md:
                continue
            mhat = arr.astype(np.float64) / b1t
            vhat = v.astype(np.float64) / b2t
            adam = lr * mhat / (np.sqrt(vhat) + 1e-8)
            wd = lr * 0.1 * md[wk].astype(np.float64)
            adam_l2 += float(np.sum(adam ** 2))
            wd_l2 += float(np.sum(wd ** 2))
        return {
            "step": step,
            "opt_step_field": t,
            "first_moment_l2": float(math.sqrt(m_l2)),
            "second_moment_l2": float(math.sqrt(v_l2)),
            "adam_update_l2_est": float(math.sqrt(adam_l2)),
            "weight_decay_update_l2_est": float(math.sqrt(wd_l2)),
            "decay_over_adam": float(math.sqrt(wd_l2) / max(math.sqrt(adam_l2), 1e-18)),
            "lr": lr,
            "weight_decay": 0.1,
        }

    lr100 = lr_at_step(99, 150, PEAK, WARMUP, 0.1)
    lr120 = lr_at_step(119, 150, PEAK, WARMUP, 0.1)
    opt_findings = {
        "step_75": adam_stats(75, lr_at_step(74, 150, PEAK, WARMUP, 0.1)),
        "step_100": adam_stats(100, lr100),
        "step_120": adam_stats(120, lr120),
    }
    dump(out / "optimizer_state.json", opt_findings)

    # Recovery-007 compare
    r007_diag = load_diag_map(r007)
    r007_clip = json.loads((r007 / "clip-events.json").read_text()) if (r007 / "clip-events.json").is_file() else []
    r008_clip = json.loads((work / "clip-events.json").read_text())
    dump(out / "recovery007_vs_008_compare.json", {
        "curriculum": {"007": "recovery mix ~400k 30% rehearsal", "008": "capability candidate 686070"},
        "lr_80_120": {
            "007": [lr_at_step(s - 1, 150, PEAK, WARMUP, 0.1) for s in (80, 100, 120)],
            "008": [lr_at_step(s - 1, 150, PEAK, WARMUP, 0.1) for s in (80, 100, 120)],
            "same_schedule": True,
        },
        "collapse": {
            "007": {s: (r007_diag.get(s) or {}).get("collapsed_probes") for s in (75, 80, 90, 100, 110, 120, 125)},
            "008": {s: (diags.get(s) or {}).get("collapsed_probes") for s in (75, 80, 90, 100, 110, 120)},
        },
        "unique": {
            "007": {s: (r007_diag.get(s) or {}).get("mean_unique_ratio") for s in (75, 80, 90, 100, 110, 120)},
            "008": {s: (diags.get(s) or {}).get("mean_unique_ratio") for s in (75, 80, 90, 100, 110, 120)},
        },
        "train_loss": {
            "007": {s: (r007_metrics.get(s) or {}).get("train_loss") for s in (80, 90, 100, 110, 120)},
            "008": {s: (metrics.get(s) or {}).get("train_loss") for s in (80, 90, 100, 110, 120)},
        },
        "grad": {
            "007": {s: (r007_metrics.get(s) or {}).get("global_grad_l2") for s in (80, 90, 100, 110, 120)},
            "008": {s: (metrics.get(s) or {}).get("global_grad_l2") for s in (80, 90, 100, 110, 120)},
        },
        "clips_80_120": {
            "007": sum(1 for c in r007_clip if 80 <= int(c.get("step") or 0) <= 120),
            "008": sum(1 for c in r008_clip if 80 <= int(c.get("step") or 0) <= 120),
        },
        "supervised_in_007": "behavior ~1.66% plus no capability supervised pack",
        "008_supervised_pct_mean_80_120": float(np.mean([float(r["supervised_pct"] or 0) for r in table if r.get("consumed_in_008")])),
    })

    # preceding batches around 100 and 120
    def prev_map(at: int, ks=(1, 3, 5, 10)):
        outm = {}
        for k in ks:
            rows = [r for r in table if at - k < r["step"] <= at and r.get("consumed_in_008")]
            outm[f"prev_{k}"] = [{"step": r["step"], "class": r.get("dominant_class"), "sup": r.get("supervised_pct"), "loss": r.get("train_loss"), "grad": r.get("global_grad_l2"), "clip": r.get("clip_event")} for r in rows]
        return outm

    dump(out / "batches_preceding_degradation.json", {
        "step_100": prev_map(100),
        "step_110": prev_map(110),
        "step_120": prev_map(120),
    })

    dump(out / "loss_normalization.json", {
        "code_path": "scripts/wrim1-training/run_recovery_experiment.py::masked_loss_fn",
        "equation": "sum(CE * w) / (sum(w) + 1e-8)",
        "denominator": "A. number of valid/trainable target tokens (sum of loss mask)",
        "not": ["B total sequence tokens unless mask is all-ones", "C unweighted batch positions"],
        "implication": "sparse supervised batches average CE only over target tokens; each target token has the same mean-loss scale as a dense LM token, but the gradient is concentrated on fewer positions before being applied to shared params. Global grad L2 can still be large if those positions are high-CE.",
    })

    print("GPU read-only replay...", flush=True)
    import mlx.core as mx
    import mlx.nn as nn

    def load_step_model(step: int):
        bundle = load_bundle(work / f"checkpoint-step-{step:06d}")
        model, _, _ = build_from_config(cfg, SEED)
        load_model_weights(model, bundle["model"], strict=True)
        return model

    model100 = load_step_model(100)
    vocab = int(cfg["vocab_size"])

    def forward_ce(model, st: int):
        x = train[st:st + CTX]
        y = train[st + 1:st + 1 + CTX]
        w = mask[st + 1:st + 1 + CTX]
        if w.size < CTX:
            return None
        xx = mx.array(x[None, :])
        yy = mx.array(y[None, :])
        ww = mx.array(w[None, :].astype(np.float32))
        loss = masked_loss_fn(model, xx, yy, ww, vocab)
        logits = model(xx)
        mx.eval(loss, logits)
        ce = nn.losses.cross_entropy(logits.reshape(-1, vocab), yy.reshape(-1), reduction="none")
        mx.eval(ce)
        cent = np.array(ce)
        ww_np = np.array(w)
        ent = logits.astype(mx.float32)
        # entropy of last position
        last = logits[0, -1]
        p = mx.softmax(last.astype(mx.float32))
        mx.eval(p)
        pn = np.array(p)
        entropy = float(-np.sum(pn * np.log(np.clip(pn, 1e-12, 1))))
        return {
            "masked_ce": float(loss.item()),
            "n_targets": int(np.sum(ww_np > 0)),
            "mean_unmasked_ce": float(np.mean(cent[ww_np.reshape(-1) > 0])) if np.any(ww_np > 0) else None,
            "entropy_last": entropy,
        }

    # one representative seq start per class from window
    reps = {}
    for row in table:
        if not row.get("consumed_in_008"):
            continue
        cls = row["dominant_class"]
        if cls not in reps:
            reps[cls] = row["seq_starts"][0]
    replay = {}
    for cls, st in reps.items():
        replay[cls] = {"seq_start": st, **(forward_ce(model100, st) or {})}
    dump(out / "family_replay_ce.json", {
        "checkpoint": "step 100",
        "NO_BACKWARD": True,
        "NO_OPTIMIZER": True,
        "representatives": replay,
    })

    deg_trace = {}
    for step in (75, 80, 90, 100, 110, 120):
        ck = work / f"checkpoint-step-{step:06d}"
        if not (ck / "checkpoint-manifest.json").is_file() and step not in diags:
            continue
        if step in (75, 100, 120) and (ck / "checkpoint-manifest.json").is_file():
            m = load_step_model(step)
            lg = topk_diag(m, tokenizer, "The sky is")
            gen_sky = generate(m, tokenizer, "The sky is", 32)
            gen_hello = generate(m, tokenizer, "Hello world", 32)
            top = lg.get("top") or []
            def rank_of(tok: str):
                for i, t in enumerate(top):
                    if (t.get("tok") or "") == tok or tok in (t.get("tok") or ""):
                        return i + 1
                return None
            deg_trace[str(step)] = {
                "source": "live_forward_readonly",
                "p_period": lg.get("p_period"),
                "p_pipe": lg.get("p_pipe"),
                "p_underscore": lg.get("p_underscore"),
                "entropy": lg.get("entropy"),
                "top1": (top[0] if top else None),
                "rank_underscore": rank_of("_") or rank_of(" _"),
                "sky": (gen_sky.get("continuation") or "")[:120],
                "hello": (gen_hello.get("continuation") or "")[:120],
            }
            del m
            mx.clear_cache()
        elif step in diags:
            d = diags[step]
            deg_trace[str(step)] = {
                "source": "saved_diagnostic",
                "p_period": (d.get("logits") or {}).get("p_period"),
                "p_pipe": (d.get("logits") or {}).get("p_pipe"),
                "p_underscore": (d.get("logits") or {}).get("p_underscore"),
                "entropy": (d.get("logits") or {}).get("entropy"),
                "top1": (d.get("logits") or {}).get("top"),
                "underscore_run": d.get("underscore_run"),
                "sky": (d.get("sky_continuation") or "")[:120],
            }
    dump(out / "token_degeneration_trace.json", {"token_ids": token_ids, "snapshots": deg_trace})

    # first deviation heuristic
    first = {
        "first_suspect_step": 100,
        "why": (
            "Unique-ratio still high at 90 (0.476) with collapse 1/13 and underscore_run 0. "
            "At step 100 collapse returns to 2/13, underscore_run jumps 0→14, symbol_run true, "
            "sky re-enters _not_ underscores. That is the earliest saved diagnostic that leaves "
            "the 20–90 healthy band. Step 110 holds 2/13 with underscore_run 14; step 120 reaches 4/13 "
            "and underscore_run 26 after batches 111–120 (incl. zero-rehearsal code/prose/supervised step 120)."
        ),
        "leading_indicators": {
            "90": "healthy light diag: collapse 1, unique 0.476, underscore_run 0",
            "100": "first return of underscore loops (run 14) and collapse 2",
            "110": "loops persist",
            "120": "collapse 4 + underscore_run 26 + train_loss 7.20 + clip",
        },
    }
    dump(out / "first_deviation.json", first)

    dump(out / "hypothesis_ranking.json", {
        "note": "filled after evidence; see report",
        "READ_ONLY": True,
        "NO_RECOVERY_009": True,
    })
    print(json.dumps({"status": "ok", "out": str(out)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
