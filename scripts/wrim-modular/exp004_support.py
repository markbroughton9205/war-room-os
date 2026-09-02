"""WR-TOOL EXP-004 design helpers: 6-class map, V4/EVAL-4 loaders, metrics, baselines.

No training. No optimizer.
"""
from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np

from exp001_support import ASSISTANT_MARK, confusion_matrix, per_class_metrics, prompt_prefix
from paths import (
    FROZEN_V4_TRAIN_HASH,
    TOOL_EVAL_2_ITEMS,
    TOOL_EVAL_3_DIR,
    TOOL_EVAL_4_DIR,
    V4_CANDIDATE_DIR,
)

# Canonical EXP-004 class order. Not the EXP-003 8-way map.
CLASS_NAMES = ("NO_TOOL", "WEB", "MEMORY", "FILES", "RESEARCH", "SHA256")
CLASS_TO_ID = {n: i for i, n in enumerate(CLASS_NAMES)}
N_CLASSES = 6
FORBIDDEN_CLASSES = ("LOOKUP_NOTE", "ECHO_INT")
EXPECTED_LORA_PARAMS = 36_864
EXPECTED_HEAD_PARAMS = 1_542  # 256*6 + 6
EXPECTED_TRAINABLE = 38_406
V4_TRAIN_N = 26
EVAL4_VAL_N = 16
EVAL4_TEST_N = 16
EVAL4_BUNDLE = "f905036c4bafeed776de492f95e0fea1d60e4594e0c5ecf4e915ec19b697a1a2"

SCHEMA_BLOCK_6 = (
    "Use compact TOOL=<name> metadata later; this record is semantic labels only. "
    "Permitted routing names: web (query), memory (query), files (path), "
    "research (query), sha256 (text), or none. "
    "Do not emit XML. Do not emit runtime JSON. Do not execute. "
    "lookup_note and echo_int are not operator classroom classes."
)

RENDER_SYSTEM = (
    "You are WRIM, a small native War Room language model. Format=tool_use. "
    "Use observable evidence. Do not emit hidden reasoning. Do not execute tools. "
    "Semantic routing labels only; runtime JSON is not a generation target."
)

URL_RE = re.compile(r"https?://[^\s]+", re.I)
CLASS_WORD_RE = re.compile(
    r"\b(web|memory|files?|research|sha256|sha-256|hasher|digest)\b",
    re.I,
)
HARD_BOUNDARY_PAIRS = frozenset(
    {"WEB_vs_RESEARCH", "FILES_vs_MEMORY", "MEMORY_vs_NO_TOOL", "WEB_vs_NO_TOOL"}
)
FAILURE_ROLES = frozenset({"execution_failure", "routing_failure", "no_match"})
FAILURE_OUTCOMES = frozenset(
    {"TAVILY_401", "NO_MATCH", "MISSING_ARGUMENT", "MEMORY_NO_MATCH", "SHA256_MISSING_ARGUMENT"}
)


def sha_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def render_prefix(user_text: str) -> str:
    """Same assistant-boundary contract as V3, 6-class schema, no gold response."""
    rendered = "\n".join(
        [
            "<|bos|>",
            "<|system|>",
            RENDER_SYSTEM,
            "<|commander|>",
            user_text,
            "Available tools / schema:",
            SCHEMA_BLOCK_6,
            "<|assistant|>",
            "",
        ]
    )
    return prompt_prefix(rendered)


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def routing_label(row: dict[str, Any]) -> str:
    gold = row.get("gold") if isinstance(row.get("gold"), dict) else {}
    cls = row.get("semantic_class") or (
        "NO_TOOL" if gold.get("decision") == "NO_TOOL" or not gold.get("tool_id") else str(gold["tool_id"]).upper()
    )
    if cls in FORBIDDEN_CLASSES:
        raise ValueError(f"legacy class in EXP004 stream: {cls}")
    if cls not in CLASS_TO_ID:
        raise ValueError(f"unknown class {cls}")
    return cls


def load_v4_train() -> list[dict[str, Any]]:
    path = V4_CANDIDATE_DIR / "train.jsonl"
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != FROZEN_V4_TRAIN_HASH:
        raise ValueError(f"V4 train hash mismatch: {digest}")
    rows = load_jsonl(path)
    if len(rows) != V4_TRAIN_N:
        raise ValueError(f"V4 train n={len(rows)}")
    fams: dict[str, int] = Counter()
    out = []
    for r in rows:
        if r.get("EXCLUDE_FROM_TRAINING"):
            raise ValueError(f"EXCLUDE_FROM_TRAINING in train: {r.get('example_id')}")
        if r.get("split") != "train":
            raise ValueError(f"unexpected split {r.get('split')}")
        cls = routing_label(r)
        # Failure rows keep routing label (WEB/MEMORY/SHA256), not NO_TOOL.
        out.append(
            {
                "example_id": r["example_id"],
                "input": r["input"],
                "prompt_prefix": render_prefix(r["input"]),
                "gold_class": cls,
                "family_id": r["family_id"],
                "source_type": r.get("source_type"),
                "execution_outcome": r.get("execution_outcome"),
                "role": r.get("role"),
                "split": "train",
                "EXCLUDE_FROM_TRAINING": False,
            }
        )
        fams[r["family_id"]] += 1
    return out


def load_eval4_split(name: str) -> list[dict[str, Any]]:
    path = TOOL_EVAL_4_DIR / f"{name}.jsonl"
    rows = load_jsonl(path)
    out = []
    for r in rows:
        if not r.get("EXCLUDE_FROM_TRAINING"):
            raise ValueError(f"EVAL-4 row missing EXCLUDE_FROM_TRAINING: {r.get('example_id')}")
        if r.get("split") != name:
            raise ValueError(f"split mismatch {r.get('split')} vs {name}")
        cls = routing_label(r)
        out.append(
            {
                "example_id": r["example_id"],
                "input": r["input"],
                "prompt_prefix": render_prefix(r["input"]),
                "gold_class": cls,
                "family_id": r["family_id"],
                "source_type": r.get("source_type"),
                "execution_outcome": r.get("execution_outcome"),
                "role": r.get("role"),
                "split": name,
                "boundary_pair": r.get("boundary_pair"),
                "EXCLUDE_FROM_TRAINING": True,
            }
        )
    return out


def assert_eval4_contract(val: list[dict[str, Any]], test: list[dict[str, Any]]) -> None:
    if len(val) != EVAL4_VAL_N or len(test) != EVAL4_TEST_N:
        raise ValueError(f"EVAL-4 sizes {len(val)}/{len(test)}")
    hashes = json.loads((TOOL_EVAL_4_DIR / "HASHES.json").read_text())
    if hashes["combined_bundle"] != EVAL4_BUNDLE:
        raise ValueError("EVAL-4 bundle hash mismatch")
    for split, rows in (("validation", val), ("test", test)):
        present = {r["gold_class"] for r in rows}
        missing = [c for c in CLASS_NAMES if c not in present]
        if missing:
            raise ValueError(f"{split} missing classes {missing}")


def family_leak(train: list[dict[str, Any]], eval_rows: list[dict[str, Any]]) -> list[str]:
    tf = {r["family_id"] for r in train}
    return sorted({r["family_id"] for r in eval_rows if r["family_id"] in tf})


def classification_report_6(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, Any]:
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
        "tool_vs_no_tool_accuracy": float(np.mean(gold_bin == pred_bin)) if len(y_true) else 0.0,
        "conditional_tool_id_accuracy": cond,
        "n": int(len(y_true)),
    }


def keyword_predict(prompt: str) -> str:
    p = prompt.casefold()
    scores = {
        "SHA256": sum(k in p for k in ("sha256", "sha-256", "digest", "hash ", "hasher")),
        "WEB": sum(k in p for k in ("web", "look up", "lookup", "https://", "search the")),
        "MEMORY": sum(k in p for k in ("memory", "recall", "previously", "decree", "stored")),
        "FILES": sum(k in p for k in ("docs/", "file", "document", "path=", ".md")),
        "RESEARCH": sum(k in p for k in ("research", "multi-source", "investigation", "sources")),
        "NO_TOOL": sum(k in p for k in ("explain", "do not retrieve", "in general", "plus two", "hello")),
    }
    best = max(scores, key=lambda k: scores[k])
    if scores[best] == 0:
        return "NO_TOOL"
    return best


def schema_predict(prompt: str) -> str:
    p = prompt
    if re.search(r"path\s*=|docs/|lib/|scripts/", p) or "CLAUDE.md" in p:
        return "FILES"
    if "sha256" in p.casefold() or re.search(r"text\s*=", p):
        return "SHA256"
    if re.search(r"query\s*=", p):
        if "research" in p.casefold():
            return "RESEARCH"
        if "memory" in p.casefold() or "decree" in p.casefold():
            return "MEMORY"
        return "WEB"
    if "recall" in p.casefold() or "previously" in p.casefold():
        return "MEMORY"
    return "NO_TOOL"


def bow_predict(train: list[dict[str, Any]], test: list[dict[str, Any]]) -> list[str]:
    vocab: dict[str, int] = {}

    def toks(s: str) -> list[str]:
        return re.findall(r"[a-z0-9_]+", s.casefold())

    for r in train:
        for t in toks(r["input"]):
            if t not in vocab and len(vocab) < 2000:
                vocab[t] = len(vocab)
    idx = {c: i for i, c in enumerate(CLASS_NAMES)}
    n_c = len(CLASS_NAMES)

    def mat(rows: list[dict[str, Any]]) -> tuple[np.ndarray, np.ndarray]:
        x = np.zeros((len(rows), len(vocab)), dtype=np.float64)
        y = np.zeros(len(rows), dtype=np.int64)
        for i, r in enumerate(rows):
            y[i] = idx[r["gold_class"]]
            for t in toks(r["input"]):
                j = vocab.get(t)
                if j is not None:
                    x[i, j] += 1.0
            nrm = np.linalg.norm(x[i])
            if nrm:
                x[i] /= nrm
        return x, y

    xtr, ytr = mat(train)
    w = np.zeros((n_c, xtr.shape[1]))
    for c in range(n_c):
        yb = (ytr == c).astype(np.float64) * 2 - 1
        for _ in range(80):
            pred = xtr @ w[c]
            err = pred - yb
            w[c] -= 0.4 * (xtr.T @ err) / max(len(train), 1)
    xte, _ = mat(test)
    pred = (xte @ w.T).argmax(axis=1)
    return [CLASS_NAMES[int(i)] for i in pred]


def labels(rows: list[dict[str, Any]]) -> np.ndarray:
    return np.array([CLASS_TO_ID[r["gold_class"]] for r in rows], dtype=np.int32)


def pred_ids(names: list[str]) -> np.ndarray:
    return np.array([CLASS_TO_ID[n] for n in names], dtype=np.int32)


def subset(rows: list[dict[str, Any]], pred: list[str], fn) -> dict[str, Any] | None:
    idx = [i for i, r in enumerate(rows) if fn(r)]
    if not idx:
        return None
    y = labels([rows[i] for i in idx])
    p = pred_ids([pred[i] for i in idx])
    rep = classification_report_6(y, p)
    rep["n"] = len(idx)
    return rep


def mask_urls(text: str) -> str:
    return URL_RE.sub("[URL]", text)


def mask_class_tool_names(text: str) -> str:
    return CLASS_WORD_RE.sub("[MASK]", text)


def is_failure_row(row: dict[str, Any]) -> bool:
    outcome = row.get("execution_outcome")
    role = row.get("role")
    return bool(outcome) or role in FAILURE_ROLES or str(outcome or "") in FAILURE_OUTCOMES


def is_hard_boundary_row(row: dict[str, Any]) -> bool:
    return row.get("boundary_pair") in HARD_BOUNDARY_PAIRS


def map_historical_class(cls: str | None, tool_id: str | None = None) -> str | None:
    """Return a 6-class name, or None if NOT_COMPARABLE."""
    name = (cls or "").upper() if cls else ""
    if name in FORBIDDEN_CLASSES:
        return None
    if name in CLASS_TO_ID:
        return name
    tid = (tool_id or "").lower() if tool_id else ""
    mapping = {
        "none": "NO_TOOL",
        "web": "WEB",
        "memory": "MEMORY",
        "files": "FILES",
        "research": "RESEARCH",
        "sha256": "SHA256",
    }
    if tid in mapping:
        return mapping[tid]
    if not tid and name in {"NO_TOOL", ""}:
        return "NO_TOOL"
    return None


def lexical_views(rows: list[dict[str, Any]]) -> dict[str, Any]:
    url_rows = [r for r in rows if URL_RE.search(r["input"])]
    no_class_words = [r for r in rows if not CLASS_WORD_RE.search(r["input"])]
    boundary = [r for r in rows if r.get("boundary_pair") in HARD_BOUNDARY_PAIRS]
    return {
        "canonical_eval4_unmodified": True,
        "url_token_rows": [
            {"example_id": r["example_id"], "masked_input": mask_urls(r["input"]), "gold_class": r["gold_class"]}
            for r in url_rows
        ],
        "n_url_token_rows": len(url_rows),
        "no_class_or_tool_name_words": [r["example_id"] for r in no_class_words],
        "n_no_class_or_tool_name_words": len(no_class_words),
        "hard_boundary_ids": [r["example_id"] for r in boundary],
        "n_hard_boundary": len(boundary),
        "train_forbidden": True,
        "optimizer_forbidden": True,
    }


def eval2_eval3_protected() -> dict[str, Any]:
    e2 = load_jsonl(TOOL_EVAL_2_ITEMS)
    e3 = json.loads((TOOL_EVAL_3_DIR / "suite.json").read_text())
    return {
        "EVAL-2_n": len(e2),
        "EVAL-3_n": e3.get("item_count"),
        "EVAL-3_id": e3.get("suite_id"),
        "role": "secondary compatibility diagnostics only; never checkpoint; never train; never overwrite",
    }
