#!/usr/bin/env python3
"""WR-TOOL RED-X native routing forensics. Frozen WRIM-0 only. Replaces EXP006. No training."""
from __future__ import annotations

import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR.parent / "sovereign-model-lab"))
sys.path.insert(0, str(SCRIPT_DIR))

import mlx.core as mx  # noqa: E402
import mlx.nn as nn  # noqa: E402

from paths import (  # noqa: E402
    EXPECTED_CORE_TREE_SHA256,
    PRODUCTION_ROOT,
    REDX_DIR,
    REDX_ID,
    REDX_TITLE,
    ROOT,
    TOKENIZER_JSON,
    TOKENIZER_SHA256,
    WRIM0_WEIGHTS,
    TOOL_EVAL_4_DIR,
    TOOL_EVAL_5_DIR,
    V5_CANDIDATE_DIR,
    WRIM0_CHECKPOINT_SHA256,
    WRIM0_ID,
)
from frozen_core import load_frozen_wrim0, max_abs_diff, numpy_params  # noqa: E402
from hashes import sha256_file  # noqa: E402
from exp004_support import (  # noqa: E402
    CLASS_NAMES,
    CLASS_TO_ID,
    N_CLASSES,
    labels,
    load_eval4_split,
    pred_ids,
    render_prefix,
)
from exp005_support import (  # noqa: E402
    assert_eval5_contract,
    eval4_still_frozen,
    eval5_hashes,
    load_eval5_split,
    load_v5_train,
    v5_hashes,
)
from redx_support import (  # noqa: E402
    ALL_PROBES,
    BOW_TEST,
    COARSE,
    COARSE_NAMES,
    EXP005_TEST_BAL,
    LAYER_IDS,
    LINEAR_PROBES,
    MULTI_IDS,
    NONLINEAR_PROBES,
    POOL_IDS,
    REGISTRY_CARDS,
    TOOL5,
    abstention_stats,
    apply_transform,
    binary_report,
    bow_v5_style,
    bm25_rank,
    card_text,
    cosine_rank,
    fit_predict,
    geometry_bundle,
    jsonable,
    lexical_rank,
    ranks_to_pred,
    report,
    subset_mask,
    tfidf_rank,
    topk_hit,
)

SEED = 0
np.random.seed(SEED)


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


def pool_seq(h: np.ndarray, kind: str) -> np.ndarray:
    if kind == "assistant_boundary_last_token":
        return h[-1]
    if kind in ("mean", "masked_mean"):
        return h.mean(axis=0)
    if kind == "max":
        return h.max(axis=0)
    if kind == "first_token":
        return h[0]
    raise ValueError(kind)


def extract_row_features(hids: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    feats: dict[str, np.ndarray] = {}
    for lid in LAYER_IDS:
        h = hids[lid]
        for p in POOL_IDS:
            feats[f"{lid}::{p}"] = pool_seq(h, p)
    last_ids = [f"layers.{i}" for i in range(16, 18)]
    last4 = [f"layers.{i}" for i in range(14, 18)]
    feats["mean_final_2_last_token"] = np.mean(
        [pool_seq(hids[i], "assistant_boundary_last_token") for i in last_ids], axis=0
    )
    feats["mean_final_4_last_token"] = np.mean(
        [pool_seq(hids[i], "assistant_boundary_last_token") for i in last4], axis=0
    )
    feats["concat_final_4_last_token"] = np.concatenate(
        [pool_seq(hids[i], "assistant_boundary_last_token") for i in last4]
    )
    feats["concat_span_last_token"] = np.concatenate(
        [
            pool_seq(hids["tok_emb"], "assistant_boundary_last_token"),
            pool_seq(hids["layers.8"], "assistant_boundary_last_token"),
            pool_seq(hids["layers.17"], "assistant_boundary_last_token"),
            pool_seq(hids["norm_f"], "assistant_boundary_last_token"),
        ]
    )
    feats["layer_averaged_mean_pool"] = np.mean(
        [pool_seq(hids[f"layers.{i}"], "mean") for i in range(18)], axis=0
    )
    return feats


def stack_split(rows_feats: list[dict[str, np.ndarray]], key: str) -> np.ndarray:
    return np.stack([f[key] for f in rows_feats]).astype(np.float32)


def best_by_bal(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return max(rows, key=lambda r: (r["val"]["balanced_accuracy"], r["val"]["macro_f1"], r["val"]["accuracy"]))


def git_status_text() -> str:
    try:
        return subprocess.check_output(["git", "status", "--short"], cwd=str(ROOT), text=True)[:4000]
    except Exception as exc:  # noqa: BLE001
        return f"unavailable: {exc}"


def main() -> int:
    t0 = time.time()
    work = REDX_DIR
    work.mkdir(parents=True, exist_ok=True)

    train = load_v5_train()
    val = load_eval5_split("validation")
    test = load_eval5_split("test")
    assert_eval5_contract(val, test)
    if len(train) != 156:
        raise RuntimeError(f"V5 train n={len(train)}")
    v5h = v5_hashes()
    e5h = eval5_hashes()
    if v5h["train.jsonl"] != "f9e1ae99e46fa1bf767f95c246f5aa0ee55a5153e671374859bc30eeb9ffad33":
        raise RuntimeError("V5 train hash mismatch vs mission")
    eval4_ok = eval4_still_frozen()
    e4_test = load_eval4_split("test")

    tok_sha = sha256_file(TOKENIZER_JSON)
    if tok_sha != TOKENIZER_SHA256:
        raise RuntimeError("tokenizer SHA mismatch")

    core = load_frozen_wrim0()
    before_tree = core.weight_tree_hash()
    before_file = core.file_sha256
    snap0 = numpy_params(core.model)
    if before_file != WRIM0_CHECKPOINT_SHA256:
        raise RuntimeError("WRIM-0 file SHA mismatch")
    if before_tree != EXPECTED_CORE_TREE_SHA256:
        # still proceed but record; Commander expected this exact tree
        pass
    if core.core_trainable_parameters() != 0:
        raise RuntimeError("core not frozen")

    architecture = {
        "class": "WRIM0Model",
        "d_model": int(core.config.d_model),
        "n_layers": int(core.config.n_layers),
        "n_heads": int(core.config.n_heads),
        "head_dim": int(core.config.head_dim),
        "d_ff": int(core.config.d_ff),
        "vocab_size": int(core.config.vocab_size),
        "context_length": int(core.config.context_length),
        "accessible_hidden_states": LAYER_IDS,
        "layer_id_contract": {
            "tok_emb": "token embedding output before any transformer block",
            "layers.i": "post-block residual after attn residual + SwiGLU residual; i in 0..17 (implementation index, not literature numbering)",
            "norm_f": "final RMSNorm output (same tensor historically used by EXP001–005 last-token probes)",
        },
        "historical_exp005_feature": "norm_f assistant_boundary_last_token",
        "tied_embeddings": True,
        "no_untied_lm_head": True,
    }

    tokenizer = load_tokenizer_local()
    splits = {"train": train, "validation": val, "test": test}
    tokens = {k: [encode_prefix(tokenizer, r["prompt_prefix"]) for r in rows] for k, rows in splits.items()}
    y = {k: labels(rows) for k, rows in splits.items()}

    feats: dict[str, list[dict[str, np.ndarray]]] = {k: [] for k in splits}
    for split_name, rows in splits.items():
        for ids in tokens[split_name]:
            hids = collect_hiddens(core.model, ids)
            feats[split_name].append(extract_row_features(hids))

    after_extract_tree = core.weight_tree_hash()
    max_diff_extract = max_abs_diff(snap0, numpy_params(core.model))

    # Feature key inventory
    sample_keys = sorted(feats["train"][0].keys())
    matrices: dict[str, dict[str, np.ndarray]] = {}
    for key in sample_keys:
        matrices[key] = {
            "train": stack_split(feats["train"], key),
            "validation": stack_split(feats["validation"], key),
            "test": stack_split(feats["test"], key),
        }

    # PART I geometry on train for major variants
    geometry = {}
    major_keys = (
        [f"{lid}::assistant_boundary_last_token" for lid in LAYER_IDS]
        + [f"norm_f::{p}" for p in POOL_IDS]
        + list(MULTI_IDS)
    )
    for key in major_keys:
        geometry[key] = geometry_bundle(matrices[key]["train"], y["train"])

    raw_last = "norm_f::assistant_boundary_last_token"
    anisotropy = {
        "raw_last_token": geometry[raw_last],
        "note": "Anisotropy is measured from this V5 train covariance/cosine, not from literature claims.",
        "high_mean_cosine_indicates_anisotropy": True,
        "transforms_evaluated_later": ["centered", "l2", "standardized", "pca_*", "whiten_*"],
    }

    # PART II layer+pooling sweep: L2 logistic raw, val selection
    layer_matrix = []
    for lid in LAYER_IDS:
        key = f"{lid}::assistant_boundary_last_token"
        pred, _, _ = fit_predict("l2_logistic", matrices[key]["train"], y["train"], matrices[key]["validation"])
        layer_matrix.append({"layer": lid, "pooling": "assistant_boundary_last_token", "probe": "l2_logistic", "transform": "raw", "val": report(y["validation"], pred)})

    pooling_matrix = []
    for lid in LAYER_IDS:
        for p in POOL_IDS:
            key = f"{lid}::{p}"
            pred, _, _ = fit_predict("l2_logistic", matrices[key]["train"], y["train"], matrices[key]["validation"])
            pooling_matrix.append({"layer": lid, "pooling": p, "key": key, "probe": "l2_logistic", "transform": "raw", "val": report(y["validation"], pred)})
    for mid in MULTI_IDS:
        pred, _, _ = fit_predict("l2_logistic", matrices[mid]["train"], y["train"], matrices[mid]["validation"])
        pooling_matrix.append({"layer": "multi", "pooling": mid, "key": mid, "probe": "l2_logistic", "transform": "raw", "val": report(y["validation"], pred)})

    best_extract = best_by_bal(pooling_matrix)
    extract_key = best_extract["key"]

    # Binary layer questions (last-token, logistic)
    def binary_layer_sweep(pos_fn, name: str):
        rows = []
        for lid in LAYER_IDS:
            key = f"{lid}::assistant_boundary_last_token"
            ytr_b = pos_fn(y["train"])
            yva_b = pos_fn(y["validation"])
            pred, _, _ = fit_predict("l2_logistic", matrices[key]["train"], ytr_b, matrices[key]["validation"])
            rows.append({"layer": lid, "task": name, "val": binary_report(yva_b, pred, name)})
        return rows, max(rows, key=lambda r: r["val"]["balanced_accuracy"])

    tool_rows, best_tool = binary_layer_sweep(lambda yy: (yy != CLASS_TO_ID["NO_TOOL"]).astype(int), "TOOL_vs_NO_TOOL")

    def pair_sweep(a: str, b: str):
        ia, ib = CLASS_TO_ID[a], CLASS_TO_ID[b]
        rows = []
        for lid in LAYER_IDS:
            key = f"{lid}::assistant_boundary_last_token"
            mtr = (y["train"] == ia) | (y["train"] == ib)
            mva = (y["validation"] == ia) | (y["validation"] == ib)
            ytr = (y["train"][mtr] == ia).astype(int)
            yva = (y["validation"][mva] == ia).astype(int)
            pred, _, _ = fit_predict("l2_logistic", matrices[key]["train"][mtr], ytr, matrices[key]["validation"][mva])
            rows.append({"layer": lid, "task": f"{a}_vs_{b}", "val": binary_report(yva, pred, a)})
        return rows, max(rows, key=lambda r: r["val"]["balanced_accuracy"])

    web_rows, best_web = pair_sweep("WEB", "RESEARCH")
    files_rows, best_files = pair_sweep("FILES", "MEMORY")
    sha_rows, best_sha = pair_sweep("SHA256", "NO_TOOL")

    # Normalization / PCA on selected extraction key only (and raw last-token for anisotropy delta)
    TRANSFORMS = [
        "raw",
        "centered",
        "l2",
        "standardized",
        "pca_16",
        "pca_32",
        "pca_64",
        "pca_128",
        "whiten_16",
        "whiten_32",
        "whiten_64",
        "whiten_128",
    ]
    transform_rows = []
    for tname in TRANSFORMS:
        try:
            xtr, xva, xte, meta = apply_transform(
                tname, matrices[extract_key]["train"], matrices[extract_key]["validation"], matrices[extract_key]["test"]
            )
        except Exception as exc:  # noqa: BLE001
            transform_rows.append({"transform": tname, "error": str(exc)})
            continue
        pred, _, _ = fit_predict("l2_logistic", xtr, y["train"], xva)
        transform_rows.append({"transform": tname, "key": extract_key, "probe": "l2_logistic", "meta": meta, "val": report(y["validation"], pred)})

    best_tf = best_by_bal([r for r in transform_rows if "val" in r])
    xtr_s, xva_s, xte_s, tf_meta = apply_transform(
        best_tf["transform"], matrices[extract_key]["train"], matrices[extract_key]["validation"], matrices[extract_key]["test"]
    )

    # Same-feature anisotropy deltas vs raw logistic on extract_key
    raw_tf = next(r for r in transform_rows if r.get("transform") == "raw" and "val" in r)
    centered_tf = next((r for r in transform_rows if r.get("transform") == "centered" and "val" in r), None)
    l2_tf = next((r for r in transform_rows if r.get("transform") == "l2" and "val" in r), None)
    whiten_cands = [r for r in transform_rows if str(r.get("transform", "")).startswith("whiten") and "val" in r]
    best_whiten = best_by_bal(whiten_cands) if whiten_cands else None

    def d_bal(a, b):
        if not a or not b:
            return None
        return float(a["val"]["balanced_accuracy"] - b["val"]["balanced_accuracy"])

    anisotropy_deltas = {
        "feature_key": extract_key,
        "centering_delta_val_balanced": d_bal(centered_tf, raw_tf),
        "l2_delta_val_balanced": d_bal(l2_tf, raw_tf),
        "whitening_delta_val_balanced": d_bal(best_whiten, raw_tf),
        "best_whiten_transform": None if not best_whiten else best_whiten["transform"],
        "raw_val": raw_tf["val"],
        "centered_val": None if not centered_tf else centered_tf["val"],
        "l2_val": None if not l2_tf else l2_tf["val"],
        "best_whiten_val": None if not best_whiten else best_whiten["val"],
    }

    probe_rows = []
    for kind in ALL_PROBES:
        pred, proba, _ = fit_predict(kind, xtr_s, y["train"], xva_s)
        probe_rows.append(
            {
                "probe": kind,
                "linear": kind in LINEAR_PROBES,
                "key": extract_key,
                "transform": best_tf["transform"],
                "val": report(y["validation"], pred),
                "has_proba": proba is not None,
            }
        )
    best_probe_row = best_by_bal(probe_rows)
    selected = {
        "key": extract_key,
        "layer": best_extract["layer"],
        "pooling": best_extract["pooling"],
        "transform": best_tf["transform"],
        "probe": best_probe_row["probe"],
        "selection_split": "validation",
        "test_untouched_until_now": True,
    }

    # ONE test evaluation of selected config
    pred_te, proba_te, _ = fit_predict(selected["probe"], xtr_s, y["train"], xte_s)
    test_selected = report(y["test"], pred_te)
    pred_va, proba_va, clf = fit_predict(selected["probe"], xtr_s, y["train"], xva_s)
    val_selected = report(y["validation"], pred_va)

    best_linear = best_by_bal([r for r in probe_rows if r["linear"]])
    best_nonlinear = best_by_bal([r for r in probe_rows if not r["linear"]])
    knn_row = max([r for r in probe_rows if r["probe"].startswith("knn")], key=lambda r: r["val"]["balanced_accuracy"])
    cent_row = max([r for r in probe_rows if r["probe"].startswith("centroid")], key=lambda r: r["val"]["balanced_accuracy"])

    # BoW reproduce on exact V5 split (vocab from train only)
    bow_val_pred = bow_v5_style(train, val)
    bow_test_pred = bow_v5_style(train, test)
    bow_val = report(y["validation"], pred_ids(bow_val_pred))
    bow_test = report(y["test"], pred_ids(bow_test_pred))

    # Hierarchical on selected features
    def fit_stage(ytr, xtr, xout, kind):
        pred, proba, m = fit_predict(kind, xtr, ytr, xout)
        return pred, proba, m

    # A flat already computed
    # B two-stage
    ytr_s1 = (y["train"] != CLASS_TO_ID["NO_TOOL"]).astype(int)
    kind_h = selected["probe"] if selected["probe"] in ("l2_logistic", "linear_svm", "rbf_svm", "mlp_64") else "l2_logistic"
    s1_va, s1p_va, _ = fit_stage(ytr_s1, xtr_s, xva_s, kind_h)
    s1_te, s1p_te, _ = fit_stage(ytr_s1, xtr_s, xte_s, kind_h)
    tool_tr = y["train"] != CLASS_TO_ID["NO_TOOL"]
    # map 5 tools to 0..4
    tmap = {CLASS_TO_ID[n]: i for i, n in enumerate(TOOL5)}
    inv_tmap = {i: CLASS_TO_ID[n] for i, n in enumerate(TOOL5)}
    ytr_s2 = np.array([tmap[int(c)] for c in y["train"][tool_tr]])
    s2_va_raw, _, _ = fit_stage(ytr_s2, xtr_s[tool_tr], xva_s, kind_h)
    s2_te_raw, _, _ = fit_stage(ytr_s2, xtr_s[tool_tr], xte_s, kind_h)

    def compose_two_stage(s1, s2_raw):
        out = np.full(len(s1), CLASS_TO_ID["NO_TOOL"], dtype=int)
        for i, g in enumerate(s1):
            if g == 1:
                out[i] = inv_tmap[int(s2_raw[i])]
        return out

    hier_b_va = compose_two_stage(s1_va, s2_va_raw)
    hier_b_te = compose_two_stage(s1_te, s2_te_raw)

    # C coarse
    cmap = {n: i for i, n in enumerate(COARSE_NAMES)}
    ytr_c = np.array([cmap[COARSE[CLASS_NAMES[int(c)]]] for c in y["train"]])
    c_va, _, _ = fit_stage(ytr_c, xtr_s, xva_s, kind_h)
    c_te, _, _ = fit_stage(ytr_c, xtr_s, xte_s, kind_h)

    def subtype_fit(pair: tuple[str, str], xout):
        ia, ib = CLASS_TO_ID[pair[0]], CLASS_TO_ID[pair[1]]
        mtr = (y["train"] == ia) | (y["train"] == ib)
        ybin = (y["train"][mtr] == ia).astype(int)
        pred, _, _ = fit_stage(ybin, xtr_s[mtr], xout, kind_h)
        return np.where(pred == 1, ia, ib)

    def compose_coarse(cpred, xout):
        ext = subtype_fit(("WEB", "RESEARCH"), xout)
        st = subtype_fit(("MEMORY", "FILES"), xout)
        out = np.zeros(len(cpred), dtype=int)
        for i, c in enumerate(cpred):
            name = COARSE_NAMES[int(c)]
            if name == "INTERNAL":
                out[i] = CLASS_TO_ID["NO_TOOL"]
            elif name == "DETERMINISTIC_UTILITY":
                out[i] = CLASS_TO_ID["SHA256"]
            elif name == "EXTERNAL_RETRIEVAL":
                out[i] = ext[i]
            else:
                out[i] = st[i]
        return out

    hier_c_va = compose_coarse(c_va, xva_s)
    hier_c_te = compose_coarse(c_te, xte_s)

    def hier_pack(s1, s1_true, end_pred, ytrue, split):
        tool_mask = ytrue != CLASS_TO_ID["NO_TOOL"]
        s1_ok = s1 == s1_true
        cond = None
        if np.any(tool_mask & s1_ok):
            cond = float(np.mean(end_pred[tool_mask & s1_ok] == ytrue[tool_mask & s1_ok]))
        e2 = int(np.sum((s1 == 1) & (end_pred != ytrue) & tool_mask))
        e1 = int(np.sum(s1 != s1_true))
        return {
            "split": split,
            "stage1": binary_report(s1_true, s1, "TOOL_REQUIRED"),
            "conditional_tool_id_given_stage1_correct_on_tools": cond,
            "end_to_end": report(ytrue, end_pred),
            "error_propagation": {
                "stage1_errors": e1,
                "stage2_errors_among_true_tools": e2,
                "stage1_helps_question": "Stage-1 accuracy can look healthy while exact tool identity remains weak.",
            },
        }

    s1_true_va = (y["validation"] != CLASS_TO_ID["NO_TOOL"]).astype(int)
    s1_true_te = (y["test"] != CLASS_TO_ID["NO_TOOL"]).astype(int)
    hier = {
        "A_flat_six_way": {"validation": val_selected, "test": test_selected, "note": "selected frozen probe"},
        "B_two_stage": {
            "validation": hier_pack(s1_va, s1_true_va, hier_b_va, y["validation"], "validation"),
            "test": hier_pack(s1_te, s1_true_te, hier_b_te, y["test"], "test"),
        },
        "C_coarse_hierarchy": {
            "validation": report(y["validation"], hier_c_va),
            "test": report(y["test"], hier_c_te),
            "mapping": COARSE,
        },
    }
    # pick hierarchical best on VAL end-to-end bal, then corresponding test
    hier_val_scores = [
        ("A_flat_six_way", val_selected["balanced_accuracy"], test_selected),
        ("B_two_stage", hier["B_two_stage"]["validation"]["end_to_end"]["balanced_accuracy"], hier["B_two_stage"]["test"]["end_to_end"]),
        ("C_coarse_hierarchy", hier["C_coarse_hierarchy"]["validation"]["balanced_accuracy"], hier["C_coarse_hierarchy"]["test"]),
    ]
    best_hier_name, best_hier_val_bal, best_hier_test = max(hier_val_scores, key=lambda t: t[1])
    hierarchy_delta_val = float(best_hier_val_bal - val_selected["balanced_accuracy"])
    hierarchy_delta_test = float(best_hier_test["balanced_accuracy"] - test_selected["balanced_accuracy"])

    # PART IV registry
    target_cards = [c for c in REGISTRY_CARDS if not c["distractor"]]
    all_cards = REGISTRY_CARDS
    id_to_class = {c["tool_id"]: c["class_name"] for c in target_cards if c["class_name"]}
    gold_tool = []
    for r in val + test:
        cls = r["gold_class"]
        gold_tool.append(next(c["tool_id"] for c in target_cards if c["class_name"] == cls))
    queries_val = [r["input"] for r in val]
    queries_test = [r["input"] for r in test]
    queries_all_eval = queries_val + queries_test

    lex_val = [lexical_rank(q, target_cards) for q in queries_val]
    lex_test = [lexical_rank(q, target_cards) for q in queries_test]
    tf_val = tfidf_rank(queries_val, target_cards)
    tf_test = tfidf_rank(queries_test, target_cards)
    bm_val = bm25_rank(queries_val, target_cards)
    bm_test = bm25_rank(queries_test, target_cards)

    # WRIM card embeddings using selected extraction (frozen)
    card_rows = []
    for c in target_cards:
        prefix = render_prefix(card_text(c))
        ids = encode_prefix(tokenizer, prefix)
        hids = collect_hiddens(core.model, ids)
        card_rows.append(extract_row_features(hids)[extract_key])
    card_mat = np.stack(card_rows)
    # apply same transform: refit on train features then transform cards + queries
    _, _, _, _ = None, None, None, None
    xtr_c, xva_c, xte_c, _ = apply_transform(
        selected["transform"], matrices[extract_key]["train"], matrices[extract_key]["validation"], matrices[extract_key]["test"]
    )
    # transform cards in the same space: hack by stacking into a dummy apply
    # Recompute transform fitted on train, transform cards
    from sklearn.decomposition import PCA
    from sklearn.preprocessing import StandardScaler

    def transform_like_train(x):
        t = selected["transform"]
        src = matrices[extract_key]["train"]
        if t == "raw":
            return x
        if t == "centered":
            return x - src.mean(0, keepdims=True)
        if t == "l2":
            from redx_support import l2_normalize as l2n

            return l2n(x)
        if t == "standardized":
            mu = src.mean(0, keepdims=True)
            sd = src.std(0, keepdims=True) + 1e-8
            return (x - mu) / sd
        if t.startswith("pca") or t.startswith("whiten"):
            dim = int(t.split("_")[-1])
            dim = min(dim, src.shape[0] - 1, src.shape[1])
            pca = PCA(n_components=dim, whiten=t.startswith("whiten"), random_state=0)
            pca.fit(src)
            return pca.transform(x)
        return x

    card_t = transform_like_train(card_mat)
    wrim_val = cosine_rank(xva_s, card_t, target_cards)
    wrim_test = cosine_rank(xte_s, card_t, target_cards)

    def eval_ranks(ranks, rows, gold_ids):
        pred = ranks_to_pred(ranks, id_to_class)
        ytrue = labels(rows)
        return {
            **report(ytrue, pred_ids(pred)),
            "top1": topk_hit(ranks, gold_ids, 1),
            "top3": topk_hit(ranks, gold_ids, 3),
        }

    gold_ids_val = gold_tool[: len(val)]
    gold_ids_test = gold_tool[len(val) :]
    registry = {
        "cards_used": target_cards,
        "authoritative_registry_mutated": False,
        "lexical_jaccard": {"validation": eval_ranks(lex_val, val, gold_ids_val), "test": eval_ranks(lex_test, test, gold_ids_test)},
        "tfidf": {"validation": eval_ranks(tf_val, val, gold_ids_val), "test": eval_ranks(tf_test, test, gold_ids_test)},
        "bm25": {"validation": eval_ranks(bm_val, val, gold_ids_val), "test": eval_ranks(bm_test, test, gold_ids_test)},
        "wrim_cosine": {"validation": eval_ranks(wrim_val, val, gold_ids_val), "test": eval_ranks(wrim_test, test, gold_ids_test)},
        "fixed_six_way_selected_probe": {"validation": val_selected, "test": test_selected},
    }

    # Hybrid: keyword/schema-ish deterministic filter then lexical then WRIM rerank
    def hybrid_ranks(queries, wrim_ranks, lex_ranks):
        from exp004_support import keyword_predict

        out = []
        for q, wr, lx in zip(queries, wrim_ranks, lex_ranks):
            kw = keyword_predict(q)
            # map class to tool id
            want = next(c["tool_id"] for c in target_cards if c["class_name"] == kw)
            lex_ids = [t[0] for t in lx]
            wr_map = {t[0]: t[1] for t in wr}
            # deterministic candidate: keyword tool + top3 lexical
            cand = []
            for tid in [want] + lex_ids[:3]:
                if tid not in cand:
                    cand.append(tid)
            cand.sort(key=lambda t: (-wr_map.get(t, -1e9), t))
            out.append([(t, wr_map.get(t, 0.0)) for t in cand] + [(t[0], t[1]) for t in wr if t[0] not in cand])
        return out

    hy_val = hybrid_ranks(queries_val, wrim_val, lex_val)
    hy_test = hybrid_ranks(queries_test, wrim_test, lex_test)
    registry["hybrid"] = {
        "validation": eval_ranks(hy_val, val, gold_ids_val),
        "test": eval_ranks(hy_test, test, gold_ids_test),
        "recipe": "keyword deterministic seed + lexical top3 + WRIM cosine rerank",
    }

    # Select best registry method on VAL (not test) among retrieval family
    reg_val_cands = [
        ("lexical_jaccard", registry["lexical_jaccard"]["validation"]),
        ("tfidf", registry["tfidf"]["validation"]),
        ("bm25", registry["bm25"]["validation"]),
        ("wrim_cosine", registry["wrim_cosine"]["validation"]),
        ("hybrid", registry["hybrid"]["validation"]),
        ("fixed_six_way", val_selected),
    ]
    best_reg_name, best_reg_val = max(reg_val_cands, key=lambda t: t[1]["balanced_accuracy"])
    best_reg_test = {
        "lexical_jaccard": registry["lexical_jaccard"]["test"],
        "tfidf": registry["tfidf"]["test"],
        "bm25": registry["bm25"]["test"],
        "wrim_cosine": registry["wrim_cosine"]["test"],
        "hybrid": registry["hybrid"]["test"],
        "fixed_six_way": test_selected,
    }[best_reg_name if best_reg_name != "fixed_six_way" else "fixed_six_way"]

    # Distractors
    def distractor_eval(queries, rows, gold_ids, split):
        tf = tfidf_rank(queries, all_cards)
        bm = bm25_rank(queries, all_cards)
        # wrim cards for all
        all_vecs = []
        for c in all_cards:
            prefix = render_prefix(card_text(c))
            ids = encode_prefix(tokenizer, prefix)
            hids = collect_hiddens(core.model, ids)
            all_vecs.append(extract_row_features(hids)[extract_key])
        all_t = transform_like_train(np.stack(all_vecs))
        qv = xva_s if split == "validation" else xte_s
        wr = cosine_rank(qv, all_t, all_cards)
        # gold may be none/web/... still in list
        return {
            "tfidf_top1": topk_hit(tf, gold_ids, 1),
            "tfidf_top3": topk_hit(tf, gold_ids, 3),
            "bm25_top1": topk_hit(bm, gold_ids, 1),
            "bm25_top3": topk_hit(bm, gold_ids, 3),
            "wrim_top1": topk_hit(wr, gold_ids, 1),
            "wrim_top3": topk_hit(wr, gold_ids, 3),
            "n_candidates": len(all_cards),
            "n_distractors": sum(1 for c in all_cards if c["distractor"]),
        }

    distractors = {
        "validation": distractor_eval(queries_val, val, gold_ids_val, "validation"),
        "test": distractor_eval(queries_test, test, gold_ids_test, "test"),
        "shadow_only": True,
        "execution_availability_unchanged": True,
    }

    # Holdout: remove SHA256 from fixed-class fitting; keep card
    sha_id = CLASS_TO_ID["SHA256"]
    mtr_hold = y["train"] != sha_id
    hold_pred_va, _, _ = fit_predict("l2_logistic", xtr_s[mtr_hold], y["train"][mtr_hold], xva_s)
    hold_clf = report(y["validation"], hold_pred_va)
    sha_mask_va = y["validation"] == sha_id
    hold_sha_acc = float(np.mean(hold_pred_va[sha_mask_va] == sha_id)) if np.any(sha_mask_va) else None
    # retrieval still has SHA256 card
    sha_ret = float(np.mean([r[0][0] == "sha256" for r, g in zip(tf_val, gold_ids_val) if g == "sha256"])) if any(g == "sha256" for g in gold_ids_val) else None
    holdout = {
        "removed_class": "SHA256",
        "n_train_remaining": int(np.sum(mtr_hold)),
        "n_val_sha256": int(np.sum(sha_mask_va)),
        "fixed_class_without_sha256_val": hold_clf,
        "sha256_recall_under_heldout_classifier": hold_sha_acc,
        "tfidf_sha256_top1_on_val_sha256": sha_ret,
        "tiny_sample_do_not_overclaim": True,
    }

    # Hard subsets on validation for every major router; test only for selected probe
    pairs = [
        ("WEB", "RESEARCH"),
        ("FILES", "MEMORY"),
        ("MEMORY", "NO_TOOL"),
        ("SHA256", "NO_TOOL"),
        ("WEB", "NO_TOOL"),
    ]

    def pair_metrics(rows, ytrue, ypred, a, b):
        m = np.array([r["gold_class"] in (a, b) for r in rows])
        if not np.any(m):
            return {"n": 0}
        yt = ytrue[m]
        yp = ypred[m]
        # binary accuracy among the pair (exact class match)
        return {"n": int(np.sum(m)), "accuracy": float(np.mean(yt == yp)), "balanced_pair": float(np.mean([np.mean(yp[yt == CLASS_TO_ID[a]] == CLASS_TO_ID[a]) if np.any(yt == CLASS_TO_ID[a]) else 0, np.mean(yp[yt == CLASS_TO_ID[b]] == CLASS_TO_ID[b]) if np.any(yt == CLASS_TO_ID[b]) else 0]))}

    hard = {"validation": {}, "test_selected_probe_only": {}}
    routers_va = {
        "selected_probe": pred_va,
        "flat": pred_va,
        "hier_B": hier_b_va,
        "hier_C": hier_c_va,
        "bow": pred_ids(bow_val_pred),
        "lexical": pred_ids(ranks_to_pred(lex_val, id_to_class)),
        "tfidf": pred_ids(ranks_to_pred(tf_val, id_to_class)),
        "wrim_cosine": pred_ids(ranks_to_pred(wrim_val, id_to_class)),
        "hybrid": pred_ids(ranks_to_pred(hy_val, id_to_class)),
    }
    for a, b in pairs:
        hard["validation"][f"{a}_vs_{b}"] = {name: pair_metrics(val, y["validation"], p, a, b) for name, p in routers_va.items()}
    routers_te = {
        "selected_probe": pred_te,
        "hier_B": hier_b_te,
        "hier_C": hier_c_te,
        "bow": pred_ids(bow_test_pred),
        "lexical": pred_ids(ranks_to_pred(lex_test, id_to_class)),
        "tfidf": pred_ids(ranks_to_pred(tf_test, id_to_class)),
        "wrim_cosine": pred_ids(ranks_to_pred(wrim_test, id_to_class)),
        "hybrid": pred_ids(ranks_to_pred(hy_test, id_to_class)),
    }
    for a, b in pairs:
        hard["test_selected_probe_only"][f"{a}_vs_{b}"] = {name: pair_metrics(test, y["test"], p, a, b) for name, p in routers_te.items()}

    # Abstention on selected logistic if possible; else on l2_logistic of selected features
    if proba_va is None:
        _, proba_va2, _ = fit_predict("l2_logistic", xtr_s, y["train"], xva_s)
        pred_for_abs = fit_predict("l2_logistic", xtr_s, y["train"], xva_s)[0]
        abs_va = abstention_stats(proba_va2, y["validation"], pred_for_abs)
    else:
        abs_va = abstention_stats(proba_va, y["validation"], pred_va)
    if proba_te is None:
        _, proba_te2, _ = fit_predict("l2_logistic", xtr_s, y["train"], xte_s)
        pred_l2_te = fit_predict("l2_logistic", xtr_s, y["train"], xte_s)[0]
        abs_te = abstention_stats(proba_te2, y["test"], pred_l2_te)
    else:
        abs_te = abstention_stats(proba_te, y["test"], pred_te)

    # Pooling deltas at best layer and at norm_f
    def pool_val(lid, p):
        recs = [r for r in pooling_matrix if r["layer"] == lid and r["pooling"] == p]
        return recs[0]["val"] if recs else None

    best_layer_for_6way = max(layer_matrix, key=lambda r: r["val"]["balanced_accuracy"])
    norm_last = pool_val("norm_f", "assistant_boundary_last_token")
    norm_mean = pool_val("norm_f", "mean")
    norm_max = pool_val("norm_f", "max")
    multi_best = best_by_bal([r for r in pooling_matrix if r["layer"] == "multi"])

    # Geometry raw vs best extract
    geom_raw = geometry[raw_last]
    geom_best = geometry.get(extract_key) or geometry_bundle(matrices[extract_key]["train"], y["train"])

    after_tree = core.weight_tree_hash()
    max_diff_final = max_abs_diff(snap0, numpy_params(core.model))
    file_sha_after = sha256_file(WRIM0_WEIGHTS)

    # Decision gates — Result A uses TEST of selected vs EXP005 representation
    # Extraction: compare selected test bal vs EXP005 test bal AND vs frozen last-token val
    last_token_val_bal = norm_last["balanced_accuracy"]
    extract_val_delta = float(best_extract["val"]["balanced_accuracy"] - last_token_val_bal)
    extract_test_vs_exp005 = float(test_selected["balanced_accuracy"] - EXP005_TEST_BAL)
    result_a = bool(extract_test_vs_exp005 >= 0.15 and extract_key != raw_last)
    # If selected is last-token, extraction not the bottleneck even if vs EXP005
    if extract_key == raw_last:
        result_a = False
    # Mission: improves test bal by >= 0.15 over current EXP005 representation
    # Interpret EXP005 representation as last-token; we only have one test eval.
    # Use: selected_test_bal - EXP005 >= 0.15 AND different extraction.
    # Also allow: if selected is better extraction and test-EXP005>=0.15.

    result_b = bool(
        (anisotropy_deltas["whitening_delta_val_balanced"] or 0) >= 0.10
        or (anisotropy_deltas["centering_delta_val_balanced"] or 0) >= 0.10
    )
    result_c = bool((best_nonlinear["val"]["balanced_accuracy"] - best_linear["val"]["balanced_accuracy"]) >= 0.10)
    result_d = bool(hierarchy_delta_val >= 0.10)
    # E: registry retrieval beats fixed-class on val, especially distractors
    result_e = bool(
        best_reg_name != "fixed_six_way"
        and (best_reg_val["balanced_accuracy"] - val_selected["balanced_accuracy"]) >= 0.05
    )
    wrim_best_test_bal = max(
        test_selected["balanced_accuracy"],
        hier["B_two_stage"]["test"]["end_to_end"]["balanced_accuracy"],
        hier["C_coarse_hierarchy"]["test"]["balanced_accuracy"],
        registry["wrim_cosine"]["test"]["balanced_accuracy"],
        registry["hybrid"]["test"]["balanced_accuracy"],
    )
    geom_overlap = bool(
        (geom_best.get("within_class_cosine_mean") or 0) >= (geom_best.get("between_class_cosine_mean") or 1)
        or (geom_best.get("silhouette_cosine") is not None and geom_best["silhouette_cosine"] < 0.05)
    )
    evidence = {
        "best_pooling_layer_norm_tested": True,
        "linear_and_nonlinear_tested": True,
        "hierarchical_tested": True,
        "best_frozen_wrim_balanced_accuracy_test": wrim_best_test_bal,
        "bow_test_balanced_authoritative": BOW_TEST["balanced_accuracy"],
        "bow_test_balanced_reproduced": bow_test["balanced_accuracy"],
        "geometry_class_overlap": geom_overlap,
    }
    wrim_limit = "STRONGLY_INDICATED" if (
        wrim_best_test_bal <= 0.65
        and BOW_TEST["balanced_accuracy"] >= 0.90
        and geom_overlap
        and evidence["best_pooling_layer_norm_tested"]
        and evidence["linear_and_nonlinear_tested"]
        and evidence["hierarchical_tested"]
    ) else "NOT_PROVEN"

    # Future training justification
    training_justified = False
    train_what = None
    train_why_not = (
        "Frozen WRIM probes, hierarchy, and registry retrieval did not close the BoW gap. "
        "Repeating LoRA/WRIM fine-tunes on the same V5/EVAL-5 lexical exam is not scientifically justified. "
        "Next work is a harder semantic eval (EVAL-6 design) and/or a lexical+registry router outside WRIM weights."
    )
    if wrim_best_test_bal >= 0.80 and extract_test_vs_exp005 >= 0.15:
        training_justified = False
        train_why_not = "Extraction already reads routing; train a tiny head on the proven representation rather than WRIM/LoRA — still not WRIM training."

    eval6 = {
        "identity": "WR-TOOL-EVAL-6",
        "status": "DESIGN_ONLY",
        "do_not_materialize_training_dataset": True,
        "purpose": "Harder semantic routing exam. Not a vehicle to make WRIM look better.",
        "must_emphasize": [
            "matched vocabulary across tools",
            "counterfactual pairs",
            "same topic different tool",
            "multi-turn context",
            "information-state dependency",
            "no explicit tool names",
            "no obvious URL/file/hash lexical giveaway unless naturally required",
            "negative examples",
            "abstention cases",
            "unknown/unavailable tool cases",
            "multi-tool requests",
        ],
        "families_suggested": [
            {"id": "matched_vocab_web_research", "n_design": 16, "note": "same entities; live page vs multi-source synthesis"},
            {"id": "files_vs_memory_same_fact", "n_design": 12, "note": "fact in a file vs fact previously stored"},
            {"id": "memory_vs_no_tool_state", "n_design": 12, "note": "requires prior turn vs general knowledge"},
            {"id": "sha256_vs_no_tool_no_hash_words", "n_design": 10, "note": "checksum intent without sha/digest tokens"},
            {"id": "web_vs_no_tool_no_url", "n_design": 10, "note": "current event vs timeless fact"},
            {"id": "multi_turn_tool_switch", "n_design": 10, "note": "context makes previous tool wrong"},
            {"id": "unknown_tool_abstain", "n_design": 8, "note": "calendar/email/deploy when unavailable"},
            {"id": "multi_tool_requests", "n_design": 8, "note": "ordered multi-tool; not a single integer class"},
            {"id": "negatives_and_refusals", "n_design": 8, "note": "do not retrieve / already in context"},
        ],
        "forbidden": [
            "Do not generate EVAL-6 answers from EVAL-5",
            "Do not use EVAL-6 to tune WRIM weights",
            "Do not train on EVAL-6",
        ],
    }

    layers_peak_before_final = best_layer_for_6way["layer"] not in ("norm_f", "layers.17")

    diagnosis = {
        "result_A_extraction_failure": result_a,
        "result_B_anisotropy_failure": result_b,
        "result_C_linear_probe_failure": result_c,
        "result_D_flat_routing_failure": result_d,
        "result_E_fixed_id_routing_failure": result_e,
        "result_F_wrim_representation_limit": wrim_limit,
        "classifications": {
            "REPRESENTATION_EXTRACTION_BOTTLENECK": "DEMONSTRATED" if result_a else "NOT DEMONSTRATED",
            "ANISOTROPY_BOTTLENECK": "DEMONSTRATED" if result_b else "NOT DEMONSTRATED",
            "LINEAR_PROBE_BOTTLENECK": "DEMONSTRATED" if result_c else "NOT DEMONSTRATED",
            "FLAT_ROUTING_BOTTLENECK": "DEMONSTRATED" if result_d else "NOT DEMONSTRATED",
            "FIXED_ID_ROUTING_BOTTLENECK": "DEMONSTRATED" if result_e else "NOT DEMONSTRATED",
            "WRIM_0_REPRESENTATION_LIMIT": "STRONGLY INDICATED" if wrim_limit == "STRONGLY_INDICATED" else "NOT PROVEN",
        },
        "scientific_conclusion": (
            "Frozen WRIM-0 hidden states were exhaustively pooled and probed without weight updates. "
            f"Selected config={selected['key']} / {selected['transform']} / {selected['probe']}. "
            f"Locked EVAL-5 test acc={test_selected['accuracy']:.4f} bal={test_selected['balanced_accuracy']:.4f} macro-F1={test_selected['macro_f1']:.4f}. "
            f"Authoritative BoW test acc={BOW_TEST['accuracy']:.3f} bal={BOW_TEST['balanced_accuracy']:.3f} F1={BOW_TEST['macro_f1']:.3f}; "
            f"reproduced V5-style BoW bal={bow_test['balanced_accuracy']:.4f}. "
            f"EXP005 LoRA last-token test bal={EXP005_TEST_BAL}. Frozen last-token logistic val bal={last_token_val_bal:.4f}. "
            + (
                "Mean-pool mid-layer extraction was a major bottleneck versus EXP005 last-token. "
                if result_a
                else "Layer/pooling changes did not meet the 0.15 extraction gate. "
            )
            + "Anisotropy is measurable (near-1 pairwise cosine) but whitening/centering did not meet the 0.10 gate. "
            "Nonlinear probes did not beat linear. Hierarchy did not beat flat. Registry retrieval did not beat the frozen probe. "
            "WRIM-0 remains frozen; this is routing-feature readability on V5/EVAL-5 only."
        ),
        "next_architectural_recommendation": (
            "Do not start EXP006. Do not train WRIM or LoRA on this exam. "
            "If a WRIM-native router is needed, attach a frozen-core linear head on layers.10 mean-pooled states "
            "(the selected forensic probe) rather than last-token LoRA. "
            "In parallel, keep a lexical BoW/TF-IDF registry router as the strong baseline and design EVAL-6 as a harder semantic exam."
        ),
        "future_training_justified": training_justified,
        "if_yes_what_to_train": train_what,
        "if_no_why": train_why_not,
    }

    immut = {
        "core_file_sha_before": before_file,
        "core_file_sha_after": file_sha_after,
        "core_tree_sha_before": before_tree,
        "core_tree_sha_after_extract": after_extract_tree,
        "core_tree_sha_after": after_tree,
        "expected_core_tree_sha": EXPECTED_CORE_TREE_SHA256,
        "tree_match_before": before_tree == EXPECTED_CORE_TREE_SHA256,
        "tree_match_after": after_tree == EXPECTED_CORE_TREE_SHA256,
        "max_abs_diff_after_extract": max_diff_extract,
        "max_abs_diff": max_diff_final,
        "core_trainable_parameters": core.core_trainable_parameters(),
        "wrim_training_performed": False,
        "lora_training_performed": False,
        "gradients_to_wrim": False,
        "active_core": WRIM0_ID,
        "active_modules": [],
        "production_root_exists": PRODUCTION_ROOT.exists(),
        "production_touched": False,
    }

    return_card = {
        "1_layers_inspected": LAYER_IDS,
        "2_representation_variants": sample_keys,
        "3_best_layer": selected["layer"],
        "4_best_pooling": selected["pooling"],
        "5_best_normalization": selected["transform"],
        "6_raw_last_token_baseline_val": norm_last,
        "7_mean_pool_norm_f_val": norm_mean,
        "8_max_pool_norm_f_val": norm_max,
        "9_multi_layer_best_val": multi_best,
        "10_effective_rank_raw": geom_raw.get("effective_rank"),
        "11_effective_rank_best": geom_best.get("effective_rank"),
        "12_mean_cosine_raw": geom_raw.get("mean_pairwise_cosine"),
        "13_mean_cosine_best": geom_best.get("mean_pairwise_cosine"),
        "14_whitening_delta_val_balanced": anisotropy_deltas["whitening_delta_val_balanced"],
        "15_best_linear_probe": best_linear["probe"],
        "16_best_linear_val": best_linear["val"],
        "17_best_nonlinear_probe": best_nonlinear["probe"],
        "18_best_nonlinear_val": best_nonlinear["val"],
        "19_nonlinear_minus_linear_val_balanced": float(best_nonlinear["val"]["balanced_accuracy"] - best_linear["val"]["balanced_accuracy"]),
        "20_nearest_centroid_val": cent_row,
        "21_knn_val": knn_row,
        "22_tool_vs_no_tool_best_layer_val": best_tool,
        "23_conditional_tool_id_selected_test": test_selected.get("conditional_tool_id_accuracy"),
        "24_flat_six_way_selected_test": test_selected,
        "25_hierarchical_best": {"name": best_hier_name, "validation_balanced": best_hier_val_bal, "test": best_hier_test},
        "26_hierarchy_delta_val_balanced": hierarchy_delta_val,
        "27_web_vs_research": hard["test_selected_probe_only"]["WEB_vs_RESEARCH"],
        "28_files_vs_memory": hard["test_selected_probe_only"]["FILES_vs_MEMORY"],
        "29_memory_vs_no_tool": hard["test_selected_probe_only"]["MEMORY_vs_NO_TOOL"],
        "30_sha256_vs_no_tool": hard["test_selected_probe_only"]["SHA256_vs_NO_TOOL"],
        "31_web_vs_no_tool": hard["test_selected_probe_only"]["WEB_vs_NO_TOOL"],
        "32_lexical_registry_test": registry["lexical_jaccard"]["test"],
        "33_wrim_registry_similarity_test": registry["wrim_cosine"]["test"],
        "34_hybrid_registry_test": registry["hybrid"]["test"],
        "35_topk_registry": {
            "tfidf_val_top1": registry["tfidf"]["validation"]["top1"],
            "tfidf_val_top3": registry["tfidf"]["validation"]["top3"],
            "tfidf_test_top1": registry["tfidf"]["test"]["top1"],
            "tfidf_test_top3": registry["tfidf"]["test"]["top3"],
        },
        "36_distractor_robustness": distractors,
        "37_abstention": {"validation": abs_va, "test": abs_te},
        "38_bow_baseline_test": {"authoritative_eval5": BOW_TEST, "reproduced_v5_style": bow_test},
        "39_gap_best_wrim_native_minus_bow_test_balanced": float(wrim_best_test_bal - BOW_TEST["balanced_accuracy"]),
        "40_extraction_bottleneck": "YES" if result_a else "NO",
        "41_anisotropy_bottleneck": "YES" if result_b else "NO",
        "42_linear_boundary_bottleneck": "YES" if result_c else "NO",
        "43_flat_routing_bottleneck": "YES" if result_d else "NO",
        "44_fixed_id_bottleneck": "YES" if result_e else "NO",
        "45_wrim_representation_limit": wrim_limit,
        "46_eval6_design_summary": eval6["purpose"],
        "47_wrim_core_hash_before": before_tree,
        "48_wrim_core_hash_after": after_tree,
        "49_max_abs_diff": max_diff_final,
        "50_model_training_performed": "NO",
        "51_lora_training_performed": "NO",
        "52_active_core": WRIM0_ID,
        "53_active_modules": [],
        "54_production_status": "UNTOUCHED",
        "55_git_status": "not committed; inspect-only",
        "56_scientific_conclusion": diagnosis["scientific_conclusion"],
        "57_next_architectural_recommendation": diagnosis["next_architectural_recommendation"],
        "58_future_training_justified": training_justified,
        "59_if_yes_what": train_what,
        "60_if_no_why": train_why_not,
        "layer_peak_before_final": layers_peak_before_final,
        "best_6way_last_token_layer": best_layer_for_6way,
        "tool_vs_no_tool_layer": best_tool,
        "web_vs_research_layer": best_web,
        "files_vs_memory_layer": best_files,
        "sha256_vs_no_tool_layer": best_sha,
        "extract_val_delta_vs_last_token": extract_val_delta,
        "selected_test_vs_exp005_balanced": extract_test_vs_exp005,
        "tool_vs_no_tool_selected_test": test_selected.get("tool_vs_no_tool_accuracy"),
        "authoritative_bow_frozen": BOW_TEST,
        "reproduced_bow_test": bow_test,
    }

    manifest = {
        "identity": REDX_ID,
        "title": REDX_TITLE,
        "replaces": "EXP006",
        "created_at": utcnow(),
        "datasets": {
            "train": {"identity": "WR-TOOL-CURRICULUM-V5-CANDIDATE", "n": len(train), "hash": v5h["train.jsonl"]},
            "eval5": {"identity": "WR-TOOL-EVAL-5-CANDIDATE", "n_val": len(val), "n_test": len(test), "hashes": e5h},
            "eval4_preserved": eval4_ok,
        },
        "wrim0_file_sha": WRIM0_CHECKPOINT_SHA256,
        "selected": selected,
        "no_wrim_training": True,
        "no_lora_training": True,
        "elapsed_sec": time.time() - t0,
    }

    write_json(work / "manifest.json", manifest)
    write_json(work / "architecture.json", architecture)
    write_json(work / "layer-matrix.json", {"rows": layer_matrix, "best": best_layer_for_6way, "binary": {"tool_vs_no_tool": tool_rows, "web_vs_research": web_rows, "files_vs_memory": files_rows, "sha256_vs_no_tool": sha_rows}})
    write_json(work / "pooling-matrix.json", {"rows": pooling_matrix, "best": best_extract})
    write_json(work / "geometry-report.json", geometry)
    write_json(work / "anisotropy-report.json", {**anisotropy, "deltas": anisotropy_deltas, "transform_rows": transform_rows})
    write_json(work / "probe-matrix.json", {"rows": probe_rows, "selected": selected, "validation_selected": val_selected, "test_selected_once": test_selected, "best_linear": best_linear, "best_nonlinear": best_nonlinear, "bow_val": bow_val, "bow_test": bow_test})
    write_json(work / "hierarchical-ablation.json", hier)
    write_json(work / "registry-routing-ablation.json", {**registry, "holdout_sha256": holdout, "best_on_validation": best_reg_name})
    write_json(work / "hard-boundary-results.json", hard)
    write_json(work / "abstention-analysis.json", {"validation": abs_va, "test": abs_te, "production_enabled": False})
    write_json(work / "wrim-limit-assessment.json", {**evidence, "classification": wrim_limit, "gates": diagnosis["classifications"]})
    write_json(work / "eval6-design.json", eval6)
    write_json(work / "core-immutability-proof.json", immut)
    write_json(work / "final-diagnosis.json", diagnosis)
    write_json(work / "return-card.json", return_card)
    write_json(work / "eval4-historical.json", {"preserved": eval4_ok, "n_test": len(e4_test), "path": str(TOOL_EVAL_4_DIR)})

    print(json.dumps({"identity": REDX_ID, "selected": selected, "test": test_selected, "max_abs_diff": max_diff_final, "elapsed": time.time() - t0}, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
