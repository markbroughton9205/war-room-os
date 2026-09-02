"""WR-TOOL-PI-EXP-001 helpers: labels, family split, pooling, metrics, dry-run router."""
from __future__ import annotations

import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import numpy as np

from paths import ROOT, WRIM1
from tool_intent import parse_compact_intent

sys.path.insert(0, str(WRIM1))
from capability_curriculum_lib import leak_scan, normalize_prompt, sha256_text  # noqa: E402
from hashes import sha256_json  # noqa: E402

CLASS_NAMES = ("NO_TOOL", "SHA256", "LOOKUP_NOTE")
CLASS_TO_ID = {n: i for i, n in enumerate(CLASS_NAMES)}
TOOL_NAME_TO_CLASS = {"none": "NO_TOOL", "sha256": "SHA256", "lookup_note": "LOOKUP_NOTE"}
CLASS_TO_TOOL = {"NO_TOOL": "none", "SHA256": "sha256", "LOOKUP_NOTE": "lookup_note"}

ASSISTANT_MARK = "<|assistant|>"
POOLING_STRATEGY = "assistant_boundary_last_token"
POOLING_RATIONALE = (
    "V2 rendered text is chat-formatted: special tokens through <|assistant|> then gold TOOL= lines. "
    "The classifier must not see gold target tokens. Hidden states come from FrozenWRIMCore.forward_hidden "
    "on the prompt prefix ending at <|assistant|> plus its following newline. The feature is the last "
    "sequence position (no padding in this dataset). Mean pooling and last-non-pad-of-full-pack are "
    "future ablations, not used here."
)

COMPACT_CATALOG = {
    "sha256": {"required": ["text"], "provider": "agi_gym_sha256"},
    "lookup_note": {"required": ["note_id"], "provider": "mock"},
}


def prompt_template_family(input_text: str) -> str:
    t = input_text
    t = re.sub(r"'[^']+'", "'<PHRASE>'", t)
    t = re.sub(r"NOTE-[A-Za-z]*\d+", "NOTE-<ID>", t)
    t = re.sub(r"text=[A-Za-z0-9_-]+", "text=<PHRASE>", t)
    t = re.sub(r"\b\d+\b", "<N>", t)
    return re.sub(r"\s+", " ", t).strip()


def semantic_family(source_identity: str) -> str:
    if ":" not in source_identity:
        return source_identity
    return source_identity.rsplit(":", 1)[0]


def gold_class_from_expected(expected: dict[str, Any]) -> str:
    tool = (expected or {}).get("tool")
    if tool not in TOOL_NAME_TO_CLASS:
        raise ValueError(f"unsupported gold tool {tool!r}; refusing to invent OTHER_TOOL")
    return TOOL_NAME_TO_CLASS[tool]


def prompt_prefix(rendered: str) -> str:
    idx = rendered.find(ASSISTANT_MARK)
    if idx < 0:
        raise ValueError("renderedTrainingText missing <|assistant|> boundary")
    end = idx + len(ASSISTANT_MARK)
    if end < len(rendered) and rendered[end] == "\n":
        end += 1
    return rendered[:end]


def load_v2_records(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        expected = rec["validator"]["expected"]
        gold = gold_class_from_expected(expected)
        tool_name = expected["tool"]
        decision = "NO_TOOL" if gold == "NO_TOOL" else "TOOL"
        sem = semantic_family(rec["provenance"]["source_identity"])
        tmpl = prompt_template_family(rec["input"])
        distractor = sem in ("v2:select", "v2:select-extra")
        rows.append({
            "example_id": rec["exampleId"],
            "prompt": rec["input"],
            "rendered": rec["renderedTrainingText"],
            "prompt_prefix": prompt_prefix(rec["renderedTrainingText"]),
            "response": rec["response"],
            "gold_class": gold,
            "gold_tool": None if gold == "NO_TOOL" else tool_name,
            "gold_decision": decision,
            "gold_arguments": expected.get("arguments") or {},
            "provenance": rec["provenance"]["source_type"],
            "source_identity": rec["provenance"]["source_identity"],
            "semantic_family": sem,
            "template_family": tmpl,
            "family_key": f"{sem}::{tmpl}",
            "distractor": distractor,
            "capability_ids": rec.get("capability_ids") or [],
        })
    return rows


def family_aware_split(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Assign whole prompt-template families so train/test cannot share a skeleton."""
    buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for rec in records:
        buckets[rec["template_family"]].append(rec)

    by_class: dict[str, list[str]] = defaultdict(list)
    for fam, members in buckets.items():
        maj = Counter(m["gold_class"] for m in members).most_common(1)[0][0]
        by_class[maj].append(fam)

    split_of: dict[str, str] = {}
    order = ("train", "train", "train", "val", "test")
    for cls in CLASS_NAMES:
        fams = sorted(by_class[cls])
        for i, fam in enumerate(fams):
            split_of[fam] = order[i % len(order)]

    for rec in records:
        rec["split"] = split_of[rec["template_family"]]

    counts = Counter(r["split"] for r in records)
    train_f = {r["template_family"] for r in records if r["split"] == "train"}
    val_f = {r["template_family"] for r in records if r["split"] == "val"}
    test_f = {r["template_family"] for r in records if r["split"] == "test"}
    train_norm = {normalize_prompt(r["prompt"]) for r in records if r["split"] == "train"}
    test_norm = {normalize_prompt(r["prompt"]) for r in records if r["split"] == "test"}
    val_norm = {normalize_prompt(r["prompt"]) for r in records if r["split"] == "val"}
    return {
        "train_count": counts["train"],
        "validation_count": counts["val"],
        "test_count": counts["test"],
        "family_count": len(buckets),
        "split_method": (
            "whole normalized prompt-template family to one split; "
            "round-robin train/train/train/val/test stratified by majority gold class of the family"
        ),
        "train_template_families": sorted(train_f),
        "validation_template_families": sorted(val_f),
        "test_template_families": sorted(test_f),
        "train_test_template_overlap": sorted(train_f & test_f),
        "train_val_template_overlap": sorted(train_f & val_f),
        "val_test_template_overlap": sorted(val_f & test_f),
        "train_test_normalized_prompt_overlap": sorted(train_norm & test_norm),
        "train_val_normalized_prompt_overlap": sorted(train_norm & val_norm),
        "class_counts_by_split": {
            split: dict(Counter(r["gold_class"] for r in records if r["split"] == split))
            for split in ("train", "val", "test")
        },
    }


def records_as_leak_examples(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "exampleId": r["example_id"],
            "input": r["prompt"],
            "response": r["response"],
            "renderedTrainingText": r["rendered"],
        }
        for r in records
    ]


def leakage_report(train_records: list[dict[str, Any]], eval_suite: dict[str, Any]) -> dict[str, Any]:
    return leak_scan(records_as_leak_examples(train_records), eval_suite)


def keyword_predict(prompt: str) -> str:
    p = prompt.lower()
    none_cues = (
        "choose none",
        "no listed tool",
        "no tool.",
        "no tool ",
        "; no tool",
        "must not execute",
        "you must not execute",
        "missing required",
        "gave no note_id",
        "gave no note",
        "no note_id",
        "invent a live web",
        "refuse by choosing none",
    )
    if any(c in p for c in none_cues):
        return "NO_TOOL"
    mentions_sha = "sha256" in p or "hash tool" in p or "digest '" in p or "local hash" in p
    mentions_lookup = "lookup_note" in p or "note_id=" in p or bool(re.search(r"note-[a-z]*\d+", p))
    if "both" in p and mentions_sha and mentions_lookup:
        if "hash it" in p or "hash the" in p or "hash local" in p or "hash '" in p:
            return "SHA256"
        if "read that note" in p or "open the local note" in p or "read note" in p:
            return "LOOKUP_NOTE"
    if mentions_lookup and not mentions_sha:
        return "LOOKUP_NOTE"
    if mentions_sha and not mentions_lookup:
        return "SHA256"
    if mentions_lookup:
        return "LOOKUP_NOTE"
    if mentions_sha:
        return "SHA256"
    return "NO_TOOL"


def majority_class(train_records: list[dict[str, Any]]) -> str:
    return Counter(r["gold_class"] for r in train_records).most_common(1)[0][0]


def confusion_matrix(y_true: np.ndarray, y_pred: np.ndarray, n: int) -> list[list[int]]:
    cm = np.zeros((n, n), dtype=int)
    for t, p in zip(y_true.tolist(), y_pred.tolist()):
        cm[int(t), int(p)] += 1
    return cm.tolist()


def per_class_metrics(y_true: np.ndarray, y_pred: np.ndarray, names: tuple[str, ...]) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    for i, name in enumerate(names):
        tp = int(np.sum((y_true == i) & (y_pred == i)))
        fp = int(np.sum((y_true != i) & (y_pred == i)))
        fn = int(np.sum((y_true == i) & (y_pred != i)))
        support = int(np.sum(y_true == i))
        prec = tp / (tp + fp) if (tp + fp) else 0.0
        rec = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = (2 * prec * rec / (prec + rec)) if (prec + rec) else 0.0
        out[name] = {
            "precision": prec,
            "recall": rec,
            "f1": f1,
            "support": support,
        }
    return out


def classification_report(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, Any]:
    n = len(CLASS_NAMES)
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
    }


def apply_threshold(logits: np.ndarray, tau: float) -> np.ndarray:
    """If predicted TOOL but softmax mass on tool classes < tau, override to NO_TOOL."""
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


def softmax_np(logits: np.ndarray) -> np.ndarray:
    e = np.exp(logits - logits.max(axis=-1, keepdims=True))
    return e / e.sum(axis=-1, keepdims=True)


def compact_from_class(cls_name: str, arguments: dict[str, Any] | None = None) -> str:
    tool = CLASS_TO_TOOL[cls_name]
    lines = [f"TOOL={tool}"]
    if cls_name != "NO_TOOL" and arguments:
        for k, v in arguments.items():
            lines.append(f"{k}={v}")
    return "\n".join(lines)


def python_route_dry_run(raw: str, *, source_module: str | None = "WR-TOOL-HEAD-001") -> dict[str, Any]:
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
    tool_id = intent["tool_id"]
    spec = COMPACT_CATALOG.get(tool_id or "")
    if not spec:
        return {
            "intent": {**intent, "validation_status": "INVALID_TOOL"},
            "validation": "INVALID_TOOL",
            "normalized": None,
            "executed": False,
            "stageReached": "validate",
            "execution_mode": None,
            "errors": [f"unknown tool {tool_id}"],
        }
    missing = [a for a in spec["required"] if a not in intent["arguments"]]
    if missing:
        return {
            "intent": {**intent, "validation_status": "MISSING_ARGUMENT"},
            "validation": "MISSING_ARGUMENT",
            "normalized": None,
            "executed": False,
            "stageReached": "validate",
            "execution_mode": None,
            "errors": [f"missing required argument {m}" for m in missing],
        }
    normalized = {"tool": tool_id, "arguments": intent["arguments"]}
    return {
        "intent": {**intent, "validation_status": "VALID"},
        "validation": "VALID",
        "normalized": normalized,
        "executed": False,
        "stageReached": "execution_boundary",
        "execution_mode": "dry_run",
        "dry_run_result": {"would_call": spec["provider"], "arguments": intent["arguments"]},
        "errors": [],
    }


def map_tool_eval_item(item: dict[str, Any]) -> dict[str, Any]:
    expected = item.get("expected") or {}
    tool = expected.get("tool")
    compatible = tool in TOOL_NAME_TO_CLASS
    needs_args = bool(expected.get("arguments")) and tool not in ("none",)
    why = (expected.get("arguments") or {}).get("WHY")
    return {
        "eval_id": item["evalId"],
        "family": item.get("family"),
        "prompt": item["prompt"],
        "compatible_for_classifier_label": compatible,
        "incompatible_reason": None if compatible else "gold tool not in observed V2 class set",
        "classifier_gold_class": TOOL_NAME_TO_CLASS.get(tool),
        "original_scorer_requires_arguments": needs_args,
        "original_scorer_requires_why": bool(why),
        "classifier_does_not_score": (
            ["argument values"] if needs_args else []
        ) + (["WHY field"] if why else []),
        "distractor": item.get("family") == "TOOL_SELECTION",
        "no_tool_subset": tool == "none",
        "tool_selection_subset": item.get("family") == "TOOL_SELECTION",
    }


def feature_hash(features: np.ndarray) -> str:
    return hashlib.sha256(features.astype(np.float32).tobytes()).hexdigest()


def input_ids_hash(rows: list[list[int]]) -> str:
    return sha256_json(rows)
