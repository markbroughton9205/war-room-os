"""WR-TOOL-PI-EXP-002 helpers: EXP-001 split reuse, separability, attached-probe degeneration."""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np

from exp001_support import CLASS_NAMES, CLASS_TO_ID
from paths import EXP001_DIR


def load_exp001_split_assignment() -> dict[str, Any]:
    split = json.loads((EXP001_DIR / "dataset-split.json").read_text(encoding="utf-8"))
    by_id = {e["example_id"]: e for e in split["examples"]}
    return {"raw": split, "by_id": by_id}


def apply_exact_exp001_split(records: list[dict[str, Any]]) -> dict[str, Any]:
    packed = load_exp001_split_assignment()
    split = packed["raw"]
    by_id = packed["by_id"]
    rec_ids = {r["example_id"] for r in records}
    exp_ids = set(by_id)
    if rec_ids != exp_ids:
        missing = sorted(exp_ids - rec_ids)
        extra = sorted(rec_ids - exp_ids)
        raise RuntimeError(f"dataset ID mismatch vs EXP-001 missing={missing[:5]} extra={extra[:5]}")
    label_mismatch = []
    for rec in records:
        gold = by_id[rec["example_id"]]
        rec["split"] = gold["split"]
        if rec["gold_class"] != gold["gold_class"]:
            label_mismatch.append(rec["example_id"])
        if rec["template_family"] != gold["template_family"]:
            label_mismatch.append(rec["example_id"] + ":template")
    if label_mismatch:
        raise RuntimeError(f"EXP-001 label/template mismatch: {label_mismatch[:8]}")
    counts = Counter(r["split"] for r in records)
    proof = {
        "source": str(EXP001_DIR / "dataset-split.json"),
        "reused_exact_example_ids": True,
        "train_count": counts["train"],
        "validation_count": counts["val"],
        "test_count": counts["test"],
        "expected_train": split["train_count"],
        "expected_validation": split["validation_count"],
        "expected_test": split["test_count"],
        "train_ids": sorted(r["example_id"] for r in records if r["split"] == "train"),
        "validation_ids": sorted(r["example_id"] for r in records if r["split"] == "val"),
        "test_ids": sorted(r["example_id"] for r in records if r["split"] == "test"),
        "exp001_train_ids": sorted(e["example_id"] for e in split["examples"] if e["split"] == "train"),
        "class_counts_by_split": {
            sp: dict(Counter(r["gold_class"] for r in records if r["split"] == sp))
            for sp in ("train", "val", "test")
        },
        "label_mapping_identical": True,
        "id_sets_equal": True,
    }
    if proof["train_ids"] != proof["exp001_train_ids"]:
        raise RuntimeError("train example IDs differ from EXP-001")
    if counts["train"] != split["train_count"] or counts["val"] != split["validation_count"] or counts["test"] != split["test_count"]:
        raise RuntimeError("split counts differ from EXP-001")
    return proof


def pairwise_mean_l2(xs: np.ndarray) -> float:
    n = len(xs)
    if n < 2:
        return 0.0
    d = 0.0
    c = 0
    for i in range(n):
        diff = xs[i + 1 :] - xs[i]
        if len(diff):
            d += float(np.sqrt((diff * diff).sum(axis=1)).mean())
            c += 1
    return d / max(1, c)


def class_geometry(features: np.ndarray, y: np.ndarray) -> dict[str, Any]:
    centroids = {}
    within = {}
    for i, name in enumerate(CLASS_NAMES):
        xs = features[y == i]
        if len(xs) == 0:
            centroids[name] = None
            within[name] = {"n": 0, "mean_pairwise_l2": None, "std_from_centroid": None}
            continue
        c = xs.mean(axis=0)
        centroids[name] = c
        dist = np.sqrt(((xs - c) ** 2).sum(axis=1))
        within[name] = {
            "n": int(len(xs)),
            "mean_pairwise_l2": pairwise_mean_l2(xs),
            "std_from_centroid": float(dist.std()),
            "mean_from_centroid": float(dist.mean()),
        }

    def centroid_l2(a: str, b: str) -> float | None:
        ca, cb = centroids[a], centroids[b]
        if ca is None or cb is None:
            return None
        return float(np.linalg.norm(ca - cb))

    def fisher(a: str, b: str) -> float | None:
        ca, cb = centroids[a], centroids[b]
        if ca is None or cb is None:
            return None
        sa = within[a]["std_from_centroid"] or 0.0
        sb = within[b]["std_from_centroid"] or 0.0
        denom = (sa * sa) + (sb * sb)
        if denom <= 0:
            return None
        return float((np.linalg.norm(ca - cb) ** 2) / denom)

    between = {
        "NO_TOOL__SHA256": centroid_l2("NO_TOOL", "SHA256"),
        "NO_TOOL__LOOKUP_NOTE": centroid_l2("NO_TOOL", "LOOKUP_NOTE"),
        "SHA256__LOOKUP_NOTE": centroid_l2("SHA256", "LOOKUP_NOTE"),
    }
    fisher_ratios = {
        "NO_TOOL__SHA256": fisher("NO_TOOL", "SHA256"),
        "NO_TOOL__LOOKUP_NOTE": fisher("NO_TOOL", "LOOKUP_NOTE"),
        "SHA256__LOOKUP_NOTE": fisher("SHA256", "LOOKUP_NOTE"),
    }
    serial_centroids = {
        k: (v.tolist() if isinstance(v, np.ndarray) else None) for k, v in centroids.items()
    }
    return {
        "within_class": within,
        "centroid_l2": between,
        "fisher_ratio": fisher_ratios,
        "centroids_omitted_from_report_files": True,
        "_centroids": serial_centroids,
    }


def geometry_delta(frozen: dict[str, Any], adapted: dict[str, Any]) -> dict[str, Any]:
    def sub(a, b):
        if a is None or b is None:
            return None
        return float(b - a)

    return {
        "centroid_l2_delta_adapted_minus_frozen": {
            k: sub(frozen["centroid_l2"][k], adapted["centroid_l2"][k]) for k in frozen["centroid_l2"]
        },
        "fisher_ratio_delta_adapted_minus_frozen": {
            k: sub(frozen["fisher_ratio"][k], adapted["fisher_ratio"][k]) for k in frozen["fisher_ratio"]
        },
        "sha256_lookup_centroid_l2_frozen": frozen["centroid_l2"]["SHA256__LOOKUP_NOTE"],
        "sha256_lookup_centroid_l2_adapted": adapted["centroid_l2"]["SHA256__LOOKUP_NOTE"],
        "sha256_lookup_fisher_frozen": frozen["fisher_ratio"]["SHA256__LOOKUP_NOTE"],
        "sha256_lookup_fisher_adapted": adapted["fisher_ratio"]["SHA256__LOOKUP_NOTE"],
    }


def generation_degeneration(items: list[dict[str, Any]], tokenizer) -> dict[str, Any]:
    collapsed = 0
    unique_vals: list[float] = []
    underscore_runs: list[int] = []
    traces = []
    for g in items:
        ids = g.get("new_ids") or []
        t = g.get("continuation") or ""
        uniq = (len(set(ids)) / len(ids)) if ids else None
        max_run = 1
        run = 1
        for a, b in zip(ids, ids[1:]):
            run = run + 1 if a == b else 1
            max_run = max(max_run, run)
        is_collapsed = bool(ids) and max_run >= max(6, len(ids) // 3)
        us = 0
        cur = 0
        for c in t:
            if c == "_":
                cur += 1
                us = max(us, cur)
            else:
                cur = 0
        if is_collapsed:
            collapsed += 1
        if uniq is not None:
            unique_vals.append(float(uniq))
        underscore_runs.append(us)
        traces.append({
            "id": g["id"],
            "continuation": t,
            "collapsed": is_collapsed,
            "unique_ratio": round(uniq, 3) if uniq is not None else None,
            "max_run": max_run,
            "underscore_run": us,
            "lab_hits": t.count("-lab") + t.count("model-lab"),
            "not_token_hits": t.count("_not_"),
        })
    mean_unique = float(np.mean(unique_vals)) if unique_vals else None
    absolute_noisy = collapsed >= 6 or (mean_unique is not None and mean_unique < 0.35) or max(underscore_runs or [0]) >= 8
    return {
        "collapse_count": collapsed,
        "n_probes": len(items),
        "mean_unique_ratio": mean_unique,
        "max_underscore_run": int(max(underscore_runs) if underscore_runs else 0),
        "lab_loop_items": [t["id"] for t in traces if t["lab_hits"] >= 3],
        "not_token_items": [t["id"] for t in traces if t["not_token_hits"] >= 2],
        "absolute_collapse_style_flags": absolute_noisy,
        "adapter_created_broad_degeneration": False,
        "items": traces,
    }


def compare_attached_vs_detached(detached_items: list[dict[str, Any]], attached: dict[str, Any]) -> dict[str, Any]:
    def tok_n(rows):
        return sum(1 for g in rows if "tokenizer" in (g.get("continuation") or ""))

    det_tok = tok_n(detached_items)
    att_tok = tok_n(attached.get("items") or [])
    created = (
        att_tok >= det_tok + 4
        or int(attached.get("collapse_count") or 0) >= 10
        or (attached.get("mean_unique_ratio") is not None and attached["mean_unique_ratio"] < 0.2)
    )
    attached["adapter_created_broad_degeneration"] = created
    attached["detached_tokenizer_probe_count"] = det_tok
    attached["attached_tokenizer_probe_count"] = att_tok
    attached["comparison_note"] = (
        "WRIM-0 already emits tokenizer/underscore collapse on several probes. "
        "Adapter-created degeneration requires a large increase versus that baseline, "
        "not the same collapse style the frozen core already shows."
    )
    return attached
