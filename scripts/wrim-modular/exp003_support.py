"""WR-TOOL-PI-EXP-003 helpers: V3 8-class labels, metrics, dry-run router, geometry."""
from __future__ import annotations

import json
import math
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np

from exp001_support import (
    POOLING_RATIONALE,
    POOLING_STRATEGY,
    confusion_matrix,
    input_ids_hash,
    leakage_report,
    per_class_metrics,
    prompt_prefix,
    softmax_np,
)
from exp002_support import compare_attached_vs_detached, generation_degeneration, pairwise_mean_l2
from tool_catalog_v3 import CLASS_NAMES, CLASS_TO_TOOL, TOOL_TO_CLASS, UNIFIED_TOOLS, dry_run_execute, validate_normalized
from tool_intent import parse_compact_intent

CLASS_TO_ID = {n: i for i, n in enumerate(CLASS_NAMES)}
N_CLASSES = len(CLASS_NAMES)
EXPECTED_V3_HASH = "204ce6e78bb301fd8a0bc590b02d9369ec075c7c7e8e8ad7e50d9f8c56775173"
EXPECTED_EVAL2_HASH = "026aa2f4937f3580833a37529a4fd57618f675deeb3770f608289f03e6d414d5"
EXPECTED_LORA_PARAMS = 36_864
EXPECTED_HEAD_PARAMS = 2_056
EXPECTED_TRAINABLE = 38_920

HEURISTIC_EVAL2 = {
    "majority_accuracy": 0.122,
    "random_accuracy": 0.125,
    "keyword_accuracy": 0.626,
    "keyword_macro_f1": 0.653,
    "schema_accuracy": 0.565,
    "schema_macro_f1": 0.491,
    "bow_accuracy": 0.617,
    "bow_macro_f1": 0.709,
}


def class_entropy(labels: list[str]) -> float:
    n = len(labels)
    if n == 0:
        return 0.0
    counts = Counter(labels)
    ent = 0.0
    for c in counts.values():
        p = c / n
        if p > 0:
            ent -= p * math.log2(p)
    return float(ent)


def load_v3_records(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        gold = rec["semantic_class"]
        if gold not in CLASS_TO_ID:
            raise ValueError(f"unexpected V3 class {gold!r}")
        tool_name = rec.get("gold_tool_id")
        rows.append({
            "example_id": rec["exampleId"],
            "prompt": rec["input"],
            "rendered": rec["renderedTrainingText"],
            "prompt_prefix": prompt_prefix(rec["renderedTrainingText"]),
            "response": rec["response"],
            "gold_class": gold,
            "gold_tool": None if gold == "NO_TOOL" else tool_name,
            "gold_decision": rec["gold"]["decision"],
            "gold_arguments": rec.get("gold_arguments") or {},
            "provenance": rec["provenance"]["source_type"],
            "example_class": rec.get("example_class"),
            "source_identity": rec["provenance"]["source_identity"],
            "family_id": rec["family_id"],
            "split": rec["split"],
            "distractor": bool(rec.get("distractor")),
            "real_wording": bool(rec.get("real_wording")),
            "argument_task": bool(rec.get("argument_task")),
            "ambiguity": bool(rec.get("ambiguity")),
            "unsupported_or_unavailable": bool(rec.get("unsupported_or_unavailable")),
            "capability_ids": rec.get("capability_ids") or [],
            "gold_payload": rec["gold"],
        })
    return rows


def load_eval2_records(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        gold = rec["semantic_class"]
        if gold not in CLASS_TO_ID:
            raise ValueError(f"unexpected EVAL-2 class {gold!r}")
        if rec.get("EXCLUDE_FROM_TRAINING") is not True:
            raise ValueError(f"EVAL-2 item {rec.get('exampleId')} missing EXCLUDE_FROM_TRAINING")
        rows.append({
            "example_id": rec["exampleId"],
            "prompt": rec["input"],
            "rendered": rec["renderedTrainingText"],
            "prompt_prefix": prompt_prefix(rec["renderedTrainingText"]),
            "gold_class": gold,
            "gold_tool": rec.get("gold_tool_id"),
            "gold_arguments": rec.get("gold_arguments") or {},
            "family_id": rec["family_id"],
            "eval_section": rec.get("eval_section"),
            "distractor": bool(rec.get("distractor")),
            "real_wording": bool(rec.get("real_wording")),
            "argument_task": bool(rec.get("argument_task")),
            "ambiguity": bool(rec.get("ambiguity")),
            "unsupported_or_unavailable": bool(rec.get("unsupported_or_unavailable")),
            "example_class": rec.get("example_class"),
            "gold_payload": rec["gold"],
        })
    return rows


def apply_official_v3_split(records: list[dict[str, Any]]) -> dict[str, Any]:
    counts = Counter(r["split"] for r in records)
    if counts["train"] != 313 or counts["val"] != 66 or counts["test"] != 62:
        raise RuntimeError(f"V3 split counts drifted: {dict(counts)}")
    train_f = {r["family_id"] for r in records if r["split"] == "train"}
    val_f = {r["family_id"] for r in records if r["split"] == "val"}
    test_f = {r["family_id"] for r in records if r["split"] == "test"}
    return {
        "train_count": counts["train"],
        "validation_count": counts["val"],
        "test_count": counts["test"],
        "split_method": "official WR-TOOL-CURRICULUM-V3 family split; not re-split",
        "train_test_family_overlap": sorted(train_f & test_f),
        "train_val_family_overlap": sorted(train_f & val_f),
        "val_test_family_overlap": sorted(val_f & test_f),
        "class_counts_by_split": {
            sp: dict(Counter(r["gold_class"] for r in records if r["split"] == sp))
            for sp in ("train", "val", "test")
        },
        "class_entropy_by_split": {
            sp: class_entropy([r["gold_class"] for r in records if r["split"] == sp])
            for sp in ("train", "val", "test")
        },
        "class_entropy_all": class_entropy([r["gold_class"] for r in records]),
        "example_class_counts": dict(Counter(r["example_class"] for r in records)),
        "synthetic_share": float(sum(1 for r in records if r["example_class"] == "SYNTHETIC") / len(records)),
    }


def dataset_content_hash(records: list[dict[str, Any]]) -> str:
    from hashes import sha256_json  # type: ignore

    payload = [{"id": r["example_id"], "input": r["prompt"], "gold": r["gold_payload"]} for r in records]
    return sha256_json(payload)


def classification_report(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, Any]:
    n = N_CLASSES
    acc = float(np.mean(y_true == y_pred)) if len(y_true) else 0.0
    pcm = per_class_metrics(y_true, y_pred, CLASS_NAMES)
    recalls = [pcm[c]["recall"] for c in CLASS_NAMES]
    f1s = [pcm[c]["f1"] for c in CLASS_NAMES]
    no_tool = CLASS_TO_ID["NO_TOOL"]
    gold_bin = (y_true != no_tool).astype(int)
    pred_bin = (y_pred != no_tool).astype(int)
    tool_mask = y_true != no_tool
    cond = float(np.mean(y_true[tool_mask] == y_pred[tool_mask])) if np.any(tool_mask) else None
    return {
        "accuracy": acc,
        "balanced_accuracy": float(np.mean(recalls)),
        "macro_f1": float(np.mean(f1s)),
        "per_class": pcm,
        "confusion_matrix": confusion_matrix(y_true, y_pred, n),
        "confusion_matrix_labels": list(CLASS_NAMES),
        "no_tool_accuracy": pcm["NO_TOOL"]["recall"],
        "tool_vs_no_tool_accuracy": float(np.mean(gold_bin == pred_bin)) if len(y_true) else 0.0,
        "conditional_tool_id_accuracy": cond,
        "n": int(len(y_true)),
        "collapsed_classes": [c for c in CLASS_NAMES if pcm[c]["support"] > 0 and pcm[c]["recall"] == 0.0],
    }


def apply_threshold(logits: np.ndarray, tau: float) -> np.ndarray:
    e = np.exp(logits - logits.max(axis=1, keepdims=True))
    prob = e / e.sum(axis=1, keepdims=True)
    pred = np.argmax(prob, axis=1)
    tool_mass = 1.0 - prob[:, CLASS_TO_ID["NO_TOOL"]]
    override = (pred != CLASS_TO_ID["NO_TOOL"]) & (tool_mass < tau)
    pred = pred.copy()
    pred[override] = CLASS_TO_ID["NO_TOOL"]
    return pred


def choose_threshold(val_logits: np.ndarray, y_val: np.ndarray) -> dict[str, Any]:
    best_tau = 0.0
    best = classification_report(y_val, np.argmax(val_logits, axis=1))
    best_score = best["tool_vs_no_tool_accuracy"]
    for tau in [i / 20 for i in range(0, 16)]:
        pred = apply_threshold(val_logits, tau)
        rep = classification_report(y_val, pred)
        score = rep["tool_vs_no_tool_accuracy"]
        if score > best_score + 1e-12:
            best_score = score
            best_tau = tau
            best = rep
    return {
        "tau": best_tau,
        "derived_from": "validation_only",
        "metric": "tool_vs_no_tool_accuracy",
        "val_tool_vs_no_tool_at_tau": best_score,
        "confidence_method": "raw_softmax_probability_NOT_calibrated",
    }


def compact_from_class(cls_name: str, arguments: dict[str, Any] | None = None) -> str:
    tool = CLASS_TO_TOOL[cls_name]
    lines = [f"TOOL={tool}"]
    if cls_name != "NO_TOOL" and arguments:
        for k, v in arguments.items():
            if k == "WHY":
                continue
            lines.append(f"{k}={v}")
    return "\n".join(lines)


def python_route_dry_run(raw: str, *, source_module: str | None = "WR-TOOL-HEAD-003") -> dict[str, Any]:
    intent = parse_compact_intent(raw, source_model="WRIM-0", source_module=source_module)
    if intent["parse_status"] == "MALFORMED":
        return {
            "intent": intent,
            "validation": "INVALID",
            "normalized": None,
            "executed": False,
            "stageReached": "parse",
            "execution_mode": None,
            "errors": intent["errors"],
        }
    if intent["decision"] == "NO_TOOL":
        return {
            "intent": {**intent, "validation_status": "VALID"},
            "validation": "VALID",
            "normalized": None,
            "executed": False,
            "stageReached": "execution_boundary",
            "execution_mode": "dry_run",
            "errors": [],
        }
    checked = validate_normalized(intent["tool_id"], intent["arguments"])
    dry = dry_run_execute(checked.get("normalized"))
    executed = False
    if str(dry.get("provenance", {}).get("executed", "false")).lower() in ("true", "1"):
        executed = True
    return {
        "intent": {**intent, "validation_status": checked["code"]},
        "validation": checked["code"],
        "normalized": checked.get("normalized"),
        "executed": executed,
        "stageReached": "execution_boundary" if checked["code"] == "VALID" else "validate",
        "execution_mode": "dry_run",
        "dry_run_result": dry,
        "errors": checked.get("errors") or [],
        "schema_tool": UNIFIED_TOOLS.get(intent["tool_id"] or ""),
    }


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

    between = {}
    fisher_ratios = {}
    nearest = None
    for i, a in enumerate(CLASS_NAMES):
        for b in CLASS_NAMES[i + 1 :]:
            key = f"{a}__{b}"
            d = centroid_l2(a, b)
            between[key] = d
            fisher_ratios[key] = fisher(a, b)
            if d is not None and (nearest is None or d < nearest[2]):
                nearest = (a, b, d)
    serial_centroids = {
        k: (v.tolist() if isinstance(v, np.ndarray) else None) for k, v in centroids.items()
    }
    return {
        "within_class": within,
        "centroid_l2": between,
        "fisher_ratio": fisher_ratios,
        "nearest_centroid_pair": None if nearest is None else {"a": nearest[0], "b": nearest[1], "l2": nearest[2]},
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
        "nearest_frozen": frozen.get("nearest_centroid_pair"),
        "nearest_adapted": adapted.get("nearest_centroid_pair"),
    }


def worst_confusion_pair(cm: list[list[int]], labels: list[str]) -> dict[str, Any] | None:
    best = None
    for i, row in enumerate(cm):
        for j, n in enumerate(row):
            if i == j:
                continue
            if best is None or n > best["count"]:
                best = {"gold": labels[i], "pred": labels[j], "count": int(n)}
    return best


def subset_report(y: np.ndarray, pred: np.ndarray, mask: list[bool] | np.ndarray) -> dict[str, Any] | None:
    m = np.array(mask, dtype=bool)
    if not np.any(m):
        return None
    return classification_report(y[m], pred[m])


def capability_verdict(
    *,
    isolation_pass: bool,
    eval2: dict[str, Any],
    test_rep: dict[str, Any],
    attached_deg: dict[str, Any],
    train_acc: float,
    overfit_note: str,
) -> tuple[str, str]:
    if attached_deg.get("adapter_created_broad_degeneration"):
        return (
            "WR-TOOL V3 LoRA-R2 — CAPABILITY ACQUISITION NOT DEMONSTRATED",
            "Attached LoRA created broad language degeneration versus detached WRIM-0.",
        )
    h = HEURISTIC_EVAL2
    acc = eval2["accuracy"]
    f1 = eval2["macro_f1"]
    bal = eval2["balanced_accuracy"]
    beats_majority = acc > h["majority_accuracy"] + 0.05 and acc > h["random_accuracy"] + 0.05
    beats_keyword = acc > h["keyword_accuracy"] + 1e-6 and f1 > h["keyword_macro_f1"] + 1e-6
    beats_schema = acc > h["schema_accuracy"] + 1e-6 and f1 > h["schema_macro_f1"] + 1e-6
    beats_bow = acc > h["bow_accuracy"] + 1e-6 and f1 > h["bow_macro_f1"] + 1e-6
    collapsed = eval2.get("collapsed_classes") or []
    real = (eval2.get("real_wording") or {}).get("accuracy")
    dist = (eval2.get("distractor") or {}).get("accuracy")
    real_ok = real is None or real > h["random_accuracy"] + 0.05
    if not isolation_pass:
        return (
            "WR-TOOL V3 LoRA-R2 — CAPABILITY ACQUISITION NOT DEMONSTRATED",
            "Isolation proofs failed; capability is not interpretable.",
        )
    if train_acc >= 0.98 and acc <= h["keyword_accuracy"] + 0.02:
        return (
            "WR-TOOL V3 LoRA-R2 — CAPABILITY ACQUISITION NOT DEMONSTRATED",
            "Train accuracy near 1.0 while EVAL-2 remains at or below keyword heuristic — overfitting on 94.3% synthetic V3.",
        )
    if beats_majority and beats_keyword and beats_schema and not collapsed and real_ok:
        extra = " Also beat bag-of-words logistic." if beats_bow else " Did not clearly beat bag-of-words logistic on both accuracy and macro F1."
        if beats_bow or (bal >= 0.70 and dist is not None and dist >= h["keyword_accuracy"] - 0.05):
            return (
                "WR-TOOL V3 LoRA-R2 — CAPABILITY ACQUISITION DEMONSTRATED",
                "EVAL-2 beat majority/random plus keyword and schema heuristics with no fully collapsed class." + extra,
            )
        return (
            "WR-TOOL V3 LoRA-R2 — CAPABILITY ACQUISITION INCONCLUSIVE",
            "Beat keyword/schema but not BoW on both aggregates; H1 is only partially supported." + extra,
        )
    if beats_majority and (beats_keyword or beats_schema) and not collapsed:
        return (
            "WR-TOOL V3 LoRA-R2 — CAPABILITY ACQUISITION INCONCLUSIVE",
            "Some heuristic wins without a clean dual win on keyword and schema; do not treat as demonstrated.",
        )
    return (
        "WR-TOOL V3 LoRA-R2 — CAPABILITY ACQUISITION NOT DEMONSTRATED",
        overfit_note or "EVAL-2 did not beat simple heuristics on the 8-class surface.",
    )
