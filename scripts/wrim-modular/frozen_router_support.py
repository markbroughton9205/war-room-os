"""WR-TOOL frozen native router: RED-X layers.10 mean-pool + L2 logistic.

Does not train WRIM. Does not train LoRA. Intercepts post-block residual at
layers.10 during the same transformer pass that forward_hidden uses; the
representation is not the final RMSNorm tensor.
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from exp004_support import CLASS_NAMES, CLASS_TO_ID, N_CLASSES, classification_report_6, labels, render_prefix
from paths import (
    EXPECTED_CORE_TREE_SHA256,
    FROZEN_ROUTER_DIR,
    FROZEN_ROUTER_ID,
    REDX_LOCKED_TEST,
    TOKENIZER_JSON,
    TOKENIZER_SHA256,
    V5_TRAIN_HASH,
    WRIM0_CHECKPOINT_SHA256,
    WRIM0_ID,
)
from redx_support import fit_predict, jsonable

LAYER = "layers.10"
POOLING = "mean"
NORMALIZATION = "raw"
CLASSIFIER = "l2_logistic"
LAYER_INDEX = 10
REPRO_TOL = 5e-4
LOGISTIC_KW = dict(C=1.0, penalty="l2", solver="lbfgs", max_iter=800, random_state=0)


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(jsonable(obj), indent=2, sort_keys=True, ensure_ascii=True) + "\n", encoding="utf-8")


def load_tokenizer_local():
    from tokenizers import Tokenizer, decoders

    tok = Tokenizer.from_file(str(TOKENIZER_JSON))
    if tok.decoder is None:
        tok.decoder = decoders.ByteLevel()
    return tok


def encode_prefix(tokenizer, prefix: str) -> list[int]:
    ids = tokenizer.encode(prefix).ids
    if not ids:
        raise ValueError("empty token ids")
    if len(ids) > 512:
        ids = ids[-512:]
    return ids


def collect_hiddens(model, ids: list[int]) -> dict[str, np.ndarray]:
    """Exact RED-X hidden collection. Causal mask. No padding."""
    import mlx.core as mx
    import mlx.nn as nn

    idx = mx.array(np.array(ids, dtype=np.int32)[None, :])
    x = model.tok_emb(idx)
    s = int(idx.shape[1])
    mask = nn.MultiHeadAttention.create_additive_causal_mask(s).astype(x.dtype)
    out = {"tok_emb": x}
    for i, layer in enumerate(model.layers):
        x, _ = layer(x, mask, None)
        out[f"layers.{i}"] = x
    out["norm_f"] = model.norm_f(x)
    mx.eval(*out.values())
    return {k: np.array(mx.stop_gradient(v).astype(mx.float32))[0] for k, v in out.items()}


def pool_mean(h: np.ndarray) -> np.ndarray:
    """Masked mean over valid prompt tokens. RED-X: no pad tokens, mean == masked_mean."""
    return h.mean(axis=0)


def extract_l10_mean(model, ids: list[int]) -> np.ndarray:
    hids = collect_hiddens(model, ids)
    vec = pool_mean(hids[LAYER])
    if vec.ndim != 1:
        raise ValueError(f"expected 1d feature, got {vec.shape}")
    return vec.astype(np.float32)


def extract_rows(model, tokenizer, rows: list[dict[str, Any]]) -> np.ndarray:
    vecs = []
    for r in rows:
        prefix = r.get("prompt_prefix") or render_prefix(r["input"])
        ids = encode_prefix(tokenizer, prefix)
        vecs.append(extract_l10_mean(model, ids))
    return np.stack(vecs, axis=0)


def fit_l2_logistic(xtr: np.ndarray, ytr: np.ndarray):
    pred, proba, model = fit_predict(CLASSIFIER, xtr, ytr, xtr[:1])
    del pred, proba
    return model


def predict_proba(clf, x: np.ndarray) -> np.ndarray:
    return np.asarray(clf.predict_proba(x), dtype=np.float64)


def predict_ids(clf, x: np.ndarray) -> np.ndarray:
    return np.asarray(clf.predict(x), dtype=np.int32)


def round4(x: float) -> float:
    return float(f"{x:.4f}")


def metrics_match_redx(rep: dict[str, Any], tol: float = REPRO_TOL) -> dict[str, Any]:
    keys = ("accuracy", "balanced_accuracy", "macro_f1")
    diffs = {k: abs(float(rep[k]) - REDX_LOCKED_TEST[k]) for k in keys}
    ok = all(v <= tol for v in diffs.values())
    return {
        "ok": ok,
        "tolerance": tol,
        "locked": REDX_LOCKED_TEST,
        "observed": {k: float(rep[k]) for k in keys},
        "observed_rounded4": {k: round4(rep[k]) for k in keys},
        "abs_diff": diffs,
    }


def entropy(p: np.ndarray) -> np.ndarray:
    clipped = np.clip(p, 1e-12, 1.0)
    return -np.sum(clipped * np.log(clipped), axis=1)


def top1_top2_margin(p: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    part = np.partition(p, -2, axis=1)
    top1 = p.max(axis=1)
    top2 = part[:, -2]
    return top1, top1 - top2


def coverage_accuracy_curve(y_true: np.ndarray, y_pred: np.ndarray, scores: np.ndarray, covers: tuple[float, ...] = (1.0, 0.9, 0.75, 0.5)) -> list[dict[str, Any]]:
    n = len(y_true)
    order = np.argsort(-scores)
    out = []
    for cov in covers:
        k = max(1, int(math.ceil(cov * n))) if cov < 1.0 else n
        idx = order[:k]
        acc = float(np.mean(y_true[idx] == y_pred[idx])) if k else None
        out.append({"coverage": cov, "n": int(k), "selective_accuracy": acc})
    return out


def best_abstention_by_margin(y_true: np.ndarray, y_pred: np.ndarray, margin: np.ndarray) -> dict[str, Any]:
    """Scan unique margins; maximize selective accuracy with coverage >= 0.5, then coverage."""
    n = len(y_true)
    if n == 0:
        return {"threshold": None, "coverage": 0.0, "selective_accuracy": None}
    uniq = np.unique(margin)
    best = {"threshold": float(uniq.min()) - 1.0, "coverage": 1.0, "selective_accuracy": float(np.mean(y_true == y_pred)), "n_kept": n}
    for t in uniq:
        keep = margin >= t
        k = int(keep.sum())
        if k == 0:
            continue
        cov = k / n
        acc = float(np.mean(y_true[keep] == y_pred[keep]))
        better = acc > best["selective_accuracy"] + 1e-12 and cov >= 0.5
        tie = abs(acc - best["selective_accuracy"]) <= 1e-12 and cov > best["coverage"] and cov >= 0.5
        if better or tie:
            best = {"threshold": float(t), "coverage": cov, "selective_accuracy": acc, "n_kept": k}
    return best


def dump_classifier(path: Path, clf, feature_dim: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(
        path,
        coef=np.asarray(clf.coef_, dtype=np.float64),
        intercept=np.asarray(clf.intercept_, dtype=np.float64),
        classes=np.asarray(clf.classes_, dtype=np.int32),
        feature_dim=np.array([feature_dim], dtype=np.int32),
    )


def load_classifier(path: Path):
    from sklearn.linear_model import LogisticRegression

    data = np.load(path)
    clf = LogisticRegression(**LOGISTIC_KW)
    clf.coef_ = data["coef"]
    clf.intercept_ = data["intercept"]
    clf.classes_ = data["classes"]
    clf.n_features_in_ = int(data["feature_dim"][0])
    return clf


def classifier_param_count(clf) -> int:
    return int(clf.coef_.size + clf.intercept_.size)


def artifact_bytes_hash(paths: list[Path]) -> str:
    h = hashlib.sha256()
    for p in sorted(paths, key=lambda x: str(x)):
        h.update(p.name.encode())
        h.update(p.read_bytes())
    return h.hexdigest()


def identity_payload() -> dict[str, Any]:
    return {
        "identity": FROZEN_ROUTER_ID,
        "lifecycle": "SHADOW",
        "promoted": False,
        "active_modules_must_remain": [],
        "wrim_id": WRIM0_ID,
        "wrim_sha": WRIM0_CHECKPOINT_SHA256,
        "core_tree_sha": EXPECTED_CORE_TREE_SHA256,
        "tokenizer_sha": TOKENIZER_SHA256,
        "representation": {
            "layer": LAYER,
            "layer_index": LAYER_INDEX,
            "pooling": POOLING,
            "normalization": NORMALIZATION,
            "masked_mean_equals_mean": True,
            "note": "layers.10 post-block residual intercepted during transformer forward; not forward_hidden/norm_f",
        },
        "classifier": CLASSIFIER,
        "classifier_kwargs": LOGISTIC_KW,
        "class_map": {str(i): n for i, n in enumerate(CLASS_NAMES)},
        "n_classes": N_CLASSES,
        "v5_train_hash": V5_TRAIN_HASH,
        "dir": str(FROZEN_ROUTER_DIR),
    }
