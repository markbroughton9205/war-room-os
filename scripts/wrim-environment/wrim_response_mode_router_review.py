"""MOD-02 response-mode router architecture review.

Read-only separability + routing-cost analysis. No production router.
No WRIM optimizer. Canonical remains STEP_400.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import torch
from safetensors.torch import load_file as load_safetensors_file
from tokenizers import Tokenizer

from run000007_preflight import resolve_dump_root, sha256_file
from wrim_arch_uh1_ac1_train import _write
from wrim_cpt_eval import greedy_from_ids
from wrim_g20m import D_MODEL
from wrim_g20m_ra1 import PLACEMENT_B, WRIMRA1Model, frozen_parameter_hash, module_parameter_hash
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT
from wrim_plm1_encode import prefix_ids_for_inference
from wrim_proven_load import disable_tf32
from wrim_ra1_conflict_lib import natural_span_eval
from wrim_ra1_grad_corpus import NAT_DIR, PHRASE_ALIGN_DIR
from wrim_ra1_phrase_school import _score_loaded, load_rows
from wrim_resumable_checkpoint import MODEL_NAME

PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-EA1-000010" / "step-25"
EXPECT = "8e6505954602961d7b432362b67633aa1cc798f7a7b4262624edb3ed213323fb"
REPORT = Path(DATA_ROOT) / "WRIM_GENESIS_RESPONSE_MODE_ROUTER_REVIEW.json"
DETAIL = Path(DATA_ROOT) / "WRIM_RESPONSE_MODE_ROUTER_REVIEW_DETAIL.json"
TT_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-TWO-TOKEN-1-v1.0.0" / "val.jsonl"
T3_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-THREE-TOKEN-ALIGN-1-v1.0.0" / "val.jsonl"
GEN_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-GENERALIZATION-EVAL-1-v1.0.0" / "val.jsonl"
FEATURES = ("pre_ea1", "post_ea1", "residual", "last_prompt")


def load_parent(device: torch.device) -> WRIMRA1Model:
    src = load_safetensors_file(str(PARENT / MODEL_NAME))
    model = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32, ea1=True, na1=True)
    missing, unexpected = model.load_state_dict(src, strict=False)
    extra = set(missing) - {n for n, _ in model.named_parameters() if n.startswith(("ea1.", "ra1.", "na1."))} - {"assistant_stop_ctrl"}
    if extra or unexpected:
        raise RuntimeError(f"load mismatch extra={extra} unexpected={unexpected}")
    if model.na1 is not None:
        model.na1.reset_zero_init()
    model.set_entry_route("ea1")
    model.set_span_route("ra1")
    return model.to(device).eval()


def extract_features(model: WRIMRA1Model, tok: Tokenizer, device: torch.device, rec: dict[str, Any]) -> dict[str, np.ndarray]:
    prefix = prefix_ids_for_inference(tok, rec["prompt"])
    idx = torch.tensor([prefix], dtype=torch.long, device=device)
    with torch.inference_mode():
        pre = model.hidden_pre_adapters(idx)[0]
        entry = pre[-1]
        last_prompt = pre[-2] if pre.shape[0] >= 2 else pre[-1]
        residual = model.ea1.delta(entry.unsqueeze(0).unsqueeze(0))[0, 0] if model.ea1 is not None else torch.zeros_like(entry)
        post = entry + residual
    return {
        "pre_ea1": entry.detach().float().cpu().numpy(),
        "post_ea1": post.detach().float().cpu().numpy(),
        "residual": residual.detach().float().cpu().numpy(),
        "last_prompt": last_prompt.detach().float().cpu().numpy(),
        "prompt": rec.get("prompt"),
        "family": rec.get("family") or rec.get("first_token_class"),
        "target": rec.get("target"),
        "example_id": rec.get("example_id"),
    }


def pack(rows: list[dict[str, Any]], key: str) -> np.ndarray:
    return np.stack([r[key] for r in rows]).astype(np.float64)


def unit(x: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(x, axis=-1, keepdims=True)
    return x / np.clip(n, 1e-12, None)


def centroid(x: np.ndarray) -> np.ndarray:
    return x.mean(axis=0)


def pairwise_cos(a: np.ndarray, b: np.ndarray | None = None) -> list[float]:
    ua = unit(a)
    ub = ua if b is None else unit(b)
    if b is None:
        vals = []
        for i in range(len(ua)):
            dots = ua[i] @ ua[i + 1 :].T
            vals.extend(float(v) for v in np.atleast_1d(dots))
        return vals
    return [float(x) for x in (ua @ ub.T).ravel()]


def nearest_centroid_acc(x: np.ndarray, y: np.ndarray, c0: np.ndarray, c1: np.ndarray) -> dict[str, Any]:
    d0 = np.linalg.norm(x - c0, axis=1)
    d1 = np.linalg.norm(x - c1, axis=1)
    pred = (d1 < d0).astype(np.int64)
    return class_report(y, pred)


def class_report(y: np.ndarray, pred: np.ndarray) -> dict[str, Any]:
    y = y.astype(np.int64)
    pred = pred.astype(np.int64)
    n = max(1, len(y))
    acc = float((pred == y).mean())
    nat_t = int((y == 1).sum())
    str_t = int((y == 0).sum())
    nat_rec = float(((pred == 1) & (y == 1)).sum() / max(1, nat_t))
    str_rec = float(((pred == 0) & (y == 0)).sum() / max(1, str_t))
    false_nat = float(((pred == 1) & (y == 0)).sum() / max(1, str_t))
    false_str = float(((pred == 0) & (y == 1)).sum() / max(1, nat_t))
    return {
        "n": int(len(y)),
        "n_structured": str_t,
        "n_natural": nat_t,
        "accuracy": acc,
        "natural_recall": nat_rec,
        "structured_recall": str_rec,
        "false_natural_rate": false_nat,
        "false_structured_rate": false_str,
        "correct": int((pred == y).sum()),
    }


def fit_linear_probe(x: np.ndarray, y: np.ndarray, seed: int = 8101) -> tuple[np.ndarray, np.ndarray]:
    """Analysis-only logistic probe. Not a WRIM checkpoint."""
    xt = torch.tensor(x, dtype=torch.float32)
    yt = torch.tensor(y, dtype=torch.long)
    layer = torch.nn.Linear(x.shape[1], 2)
    torch.manual_seed(seed)
    with torch.no_grad():
        layer.weight.zero_()
        layer.bias.zero_()
    opt = torch.optim.Adam(layer.parameters(), lr=0.05)
    n1 = max(1, int((y == 1).sum()))
    n0 = max(1, int((y == 0).sum()))
    w = torch.tensor([1.0, n0 / n1], dtype=torch.float32)
    loss_fn = torch.nn.CrossEntropyLoss(weight=w)
    layer.train()
    for _ in range(250):
        opt.zero_grad(set_to_none=True)
        loss = loss_fn(layer(xt), yt)
        loss.backward()
        opt.step()
    with torch.no_grad():
        W = layer.weight.detach().cpu().numpy()
        b = layer.bias.detach().cpu().numpy()
    return W, b


def probe_predict(x: np.ndarray, W: np.ndarray, b: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    logits = x @ W.T + b
    logits = logits - logits.max(axis=1, keepdims=True)
    e = np.exp(logits)
    p = e / e.sum(axis=1, keepdims=True)
    return p[:, 1], (p[:, 1] >= 0.5).astype(np.int64)


def geom_pair(xs: np.ndarray, xn: np.ndarray) -> dict[str, Any]:
    cs = centroid(xs)
    cn = centroid(xn)
    within_s = pairwise_cos(xs)
    within_n = pairwise_cos(xn)
    between = pairwise_cos(xs, xn)
    return {
        "centroid_l2": float(np.linalg.norm(cs - cn)),
        "within_structured_cosine_mean": float(np.mean(within_s)) if within_s else None,
        "within_natural_cosine_mean": float(np.mean(within_n)) if within_n else None,
        "between_cosine_mean": float(np.mean(between)) if between else None,
        "structured_centroid_norm": float(np.linalg.norm(cs)),
        "natural_centroid_norm": float(np.linalg.norm(cn)),
    }


def score_route(model: WRIMRA1Model, tok: Tokenizer, device: torch.device, rows: list[dict[str, Any]], entry: str, span: str) -> dict[str, Any]:
    model.set_entry_route(entry)
    model.set_span_route(span)
    return _score_loaded(model, tok, device, rows)


def leakage_audit(struct_train: list[dict[str, Any]], nat_train: list[dict[str, Any]], nat_val: list[dict[str, Any]], extra: list[dict[str, Any]], phrase_val: list[dict[str, Any]]) -> dict[str, Any]:
    def prompts(rows: list[dict[str, Any]]) -> set[str]:
        return {str(r.get("prompt") or "") for r in rows}

    nat_tr_p = prompts(nat_train)
    nat_va_p = prompts(nat_val)
    extra_p = prompts(extra)
    ph_tr_p = prompts(struct_train)
    ph_va_p = prompts(phrase_val)
    overlap_tv = sorted(nat_tr_p & nat_va_p)
    overlap_te = sorted(nat_tr_p & extra_p)
    overlap_ve = sorted(nat_va_p & extra_p)
    overlap_sp = sorted(ph_tr_p & nat_tr_p)
    shared_templates = []
    for needle in ("yes or no", "and halt", "and stop", "as your whole reply", "Reply ", "Say ", "Print ", "Write "):
        n_nat = sum(needle.lower() in p.lower() for p in nat_tr_p | nat_va_p)
        n_ph = sum(needle.lower() in p.lower() for p in ph_tr_p | ph_va_p)
        if n_nat or n_ph:
            shared_templates.append({"pattern": needle, "natural": n_nat, "structured": n_ph})
    target_in_prompt_nat = sum(str(r.get("target") or "") and str(r["target"]) in str(r.get("prompt") or "") for r in nat_train + nat_val)
    target_in_prompt_ph = sum(str(r.get("target") or "") and str(r["target"]) in str(r.get("prompt") or "") for r in struct_train + phrase_val)
    return {
        "prompt_overlap_natural_train_val": len(overlap_tv),
        "prompt_overlap_natural_train_extra": len(overlap_te),
        "prompt_overlap_natural_val_extra": len(overlap_ve),
        "prompt_overlap_phrase_train_natural_train": len(overlap_sp),
        "shared_surface_templates": shared_templates,
        "natural_targets_copied_into_prompt_trainval": target_in_prompt_nat,
        "phrase_targets_copied_into_prompt_trainval": target_in_prompt_ph,
        "metadata_must_not_be_inputs": ["example_id", "family", "first_token_class", "provenance", "split", "file path"],
        "runtime_ok_inputs": ["prompt token ids", "hidden state at <|assistant|>", "hidden state of last prompt token"],
        "risk": "MEDIUM",
        "risk_reason": (
            "No split IDs leak into hidden state, but both corpora embed targets in prompts and share reply/say/print/halt templates. "
            "A router could overfit those curriculum shortcuts. Extra-unseen must be the hard gate. "
            "first_token_class 'no' exists on both natural one-word no and phrase 'no thank you sir'."
        ),
    }


def main() -> dict[str, Any]:
    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dump = resolve_dump_root(None)
    if dump is None:
        raise SystemExit("dump_root_missing")
    if sha256_file(PARENT / MODEL_NAME) != EXPECT:
        raise SystemExit("parent_hash_mismatch")
    tok = Tokenizer.from_file(str(dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"))
    model = load_parent(device)
    hashes = {
        "FROZEN": frozen_parameter_hash(model),
        "EA1": module_parameter_hash(model, "ea1."),
        "RA1": module_parameter_hash(model, "ra1."),
    }

    phrase_train = load_rows(PHRASE_ALIGN_DIR / "train.jsonl")
    phrase_val = load_rows(PHRASE_ALIGN_DIR / "val.jsonl")
    nat_train = load_rows(NAT_DIR / "train.jsonl")
    nat_val = load_rows(NAT_DIR / "val.jsonl")
    extra = natural_span_eval()
    tt_val = load_rows(TT_VAL) if TT_VAL.is_file() else []
    t3_val = load_rows(T3_VAL) if T3_VAL.is_file() else []
    para_val = load_rows(GEN_VAL) if GEN_VAL.is_file() else []

    leak = leakage_audit(phrase_train, nat_train, nat_val, extra, phrase_val)

    buckets = {
        "struct_train": phrase_train,
        "nat_train": nat_train,
        "struct_heldout": phrase_val,
        "nat_heldout": nat_val,
        "nat_extra": extra,
    }
    feats: dict[str, list[dict[str, Any]]] = {k: [extract_features(model, tok, device, r) for r in rows] for k, rows in buckets.items()}

    y_train = np.array([0] * len(feats["struct_train"]) + [1] * len(feats["nat_train"]))
    splits_y = {
        "train": y_train,
        "heldout": np.array([0] * len(feats["struct_heldout"]) + [1] * len(feats["nat_heldout"])),
        "extra_unseen": np.array([1] * len(feats["nat_extra"])),
        "nat_heldout": np.array([1] * len(feats["nat_heldout"])),
        "struct_heldout": np.array([0] * len(feats["struct_heldout"])),
    }

    feature_report: dict[str, Any] = {}
    best_name = None
    best_score = -1.0
    for name in FEATURES:
        xs_tr = pack(feats["struct_train"], name)
        xn_tr = pack(feats["nat_train"], name)
        xs_ho = pack(feats["struct_heldout"], name)
        xn_ho = pack(feats["nat_heldout"], name)
        xn_ex = pack(feats["nat_extra"], name)
        x_tr = np.concatenate([xs_tr, xn_tr], axis=0)
        x_ho = np.concatenate([xs_ho, xn_ho], axis=0)
        c0, c1 = centroid(xs_tr), centroid(xn_tr)
        W, b = fit_linear_probe(x_tr, y_train)
        p_tr, pred_tr = probe_predict(x_tr, W, b)
        p_ho, pred_ho = probe_predict(x_ho, W, b)
        p_ex, pred_ex = probe_predict(xn_ex, W, b)
        p_nh, pred_nh = probe_predict(xn_ho, W, b)
        rec = {
            "dim": int(x_tr.shape[1]),
            "linear_params": int(W.size + b.size),
            "geometry_train": geom_pair(xs_tr, xn_tr),
            "geometry_heldout": geom_pair(xs_ho, xn_ho),
            "nearest_centroid_train": nearest_centroid_acc(x_tr, y_train, c0, c1),
            "nearest_centroid_heldout": nearest_centroid_acc(x_ho, splits_y["heldout"], c0, c1),
            "nearest_centroid_extra": nearest_centroid_acc(xn_ex, splits_y["extra_unseen"], c0, c1),
            "linear_probe_train": class_report(y_train, pred_tr),
            "linear_probe_heldout": class_report(splits_y["heldout"], pred_ho),
            "linear_probe_nat_heldout": class_report(splits_y["nat_heldout"], pred_nh),
            "linear_probe_extra_unseen": class_report(splits_y["extra_unseen"], pred_ex),
            "mean_p_natural_extra": float(p_ex.mean()) if len(p_ex) else None,
            "mean_p_natural_heldout": float(p_nh.mean()) if len(p_nh) else None,
            "mean_p_structured_heldout": float(probe_predict(xs_ho, W, b)[0].mean()),
        }
        feature_report[name] = rec
        score = (
            rec["linear_probe_heldout"]["natural_recall"]
            + rec["linear_probe_heldout"]["structured_recall"]
            + rec["linear_probe_extra_unseen"]["natural_recall"]
        )
        if score > best_score:
            best_score = score
            best_name = name

    best = feature_report[best_name]
    linear_ok_ho = (
        best["linear_probe_heldout"]["natural_recall"] >= 0.5
        and best["linear_probe_heldout"]["structured_recall"] >= 0.5
        and best["linear_probe_heldout"]["accuracy"] >= 0.7
    )
    linear_ok_ex = best["linear_probe_extra_unseen"]["natural_recall"] >= 0.5
    architecture_ready = bool(linear_ok_ho and linear_ok_ex)
    train_router = bool(architecture_ready)

    # Error costs
    phrase_ra1 = score_route(model, tok, device, phrase_val, "ea1", "ra1")
    phrase_bypass = score_route(model, tok, device, phrase_val, "ea1", "bypass")
    nat_ra1 = score_route(model, tok, device, nat_val, "ea1", "ra1")
    nat_bypass = score_route(model, tok, device, nat_val, "ea1", "bypass")
    extra_ra1 = score_route(model, tok, device, extra, "ea1", "ra1")
    extra_bypass = score_route(model, tok, device, extra, "ea1", "bypass")
    para_ra1 = score_route(model, tok, device, para_val, "ea1", "ra1") if para_val else {}
    para_bypass = score_route(model, tok, device, para_val, "ea1", "bypass") if para_val else {}
    tt_ra1 = score_route(model, tok, device, tt_val, "ea1", "ra1") if tt_val else {}
    tt_bypass = score_route(model, tok, device, tt_val, "ea1", "bypass") if tt_val else {}

    oracle_cap = {
        "structured_phrase_exact": phrase_ra1.get("short_phrase_exact"),
        "structured_paraphrase_exact": para_ra1.get("short_phrase_exact"),
        "structured_two_token": tt_ra1.get("short_phrase_exact") or tt_ra1.get("greedy_three_token_exact"),
        "natural_official_exact": nat_bypass.get("short_phrase_exact"),
        "natural_extra_exact": extra_bypass.get("short_phrase_exact"),
        "note": "Perfect mode routing cannot exceed EA1+RA1 on structured or EA1+BYPASS on natural. Official natural ceiling remains 3; extra-unseen ceiling remains 1.",
    }
    struct_to_bypass = {
        "phrase_exact_ra1": phrase_ra1.get("short_phrase_exact"),
        "phrase_exact_bypass": phrase_bypass.get("short_phrase_exact"),
        "phrase_delta": int(phrase_bypass.get("short_phrase_exact") or 0) - int(phrase_ra1.get("short_phrase_exact") or 0),
        "paraphrase_ra1": para_ra1.get("short_phrase_exact"),
        "paraphrase_bypass": para_bypass.get("short_phrase_exact"),
        "two_token_ra1": tt_ra1.get("short_phrase_exact"),
        "two_token_bypass": tt_bypass.get("short_phrase_exact"),
        "stopping_ra1": phrase_ra1.get("greedy_stopping"),
        "stopping_bypass": phrase_bypass.get("greedy_stopping"),
        "ramble_ra1": phrase_ra1.get("ramble_rate"),
        "ramble_bypass": phrase_bypass.get("ramble_rate"),
        "empty_ra1": phrase_ra1.get("empty_response_rate"),
        "empty_bypass": phrase_bypass.get("empty_response_rate"),
    }
    nat_to_ra1 = {
        "official_bypass": nat_bypass.get("short_phrase_exact"),
        "official_ra1": nat_ra1.get("short_phrase_exact"),
        "official_delta": int(nat_ra1.get("short_phrase_exact") or 0) - int(nat_bypass.get("short_phrase_exact") or 0),
        "extra_bypass": extra_bypass.get("short_phrase_exact"),
        "extra_ra1": extra_ra1.get("short_phrase_exact"),
        "extra_delta": int(extra_ra1.get("short_phrase_exact") or 0) - int(extra_bypass.get("short_phrase_exact") or 0),
        "stopping_bypass": nat_bypass.get("greedy_stopping"),
        "stopping_ra1": nat_ra1.get("greedy_stopping"),
        "ramble_bypass": nat_bypass.get("ramble_rate"),
        "ramble_ra1": nat_ra1.get("ramble_rate"),
        "empty_bypass": nat_bypass.get("empty_response_rate"),
        "empty_ra1": nat_ra1.get("empty_response_rate"),
    }

    # Threshold design: calibrate on train+heldout structured, never extra-unseen.
    xs_ho = pack(feats["struct_heldout"], best_name)
    xn_tr = pack(feats["nat_train"], best_name)
    x_tr_best = np.concatenate([pack(feats["struct_train"], best_name), pack(feats["nat_train"], best_name)])
    W, bvec = fit_linear_probe(x_tr_best, y_train)
    p_struct_ho = probe_predict(xs_ho, W, bvec)[0]
    p_nat_tr = probe_predict(xn_tr, W, bvec)[0]
    # Favor STRUCTURED: threshold above the 90th percentile of held-out structured P(NATURAL)
    thr_candidate = float(np.quantile(p_struct_ho, 0.9)) if len(p_struct_ho) else 0.5
    thr_candidate = min(0.9, max(0.5, thr_candidate))
    confidence_policy = {
        "rule": "NATURAL iff P(NATURAL) >= threshold else STRUCTURED",
        "calibrate_on": "train fit; threshold from held-out STRUCTURED P(NATURAL) quantile, never extra-unseen or test natural",
        "recommended_initial_threshold_design": "held-out structured 90th percentile of P(NATURAL), clipped to [0.5, 0.9]",
        "heldout_structured_p_natural_p90": float(np.quantile(p_struct_ho, 0.9)) if len(p_struct_ho) else None,
        "illustrative_threshold_not_test_fit": thr_candidate,
        "train_natural_mean_p": float(p_nat_tr.mean()) if len(p_nat_tr) else None,
        "bias": "FAVOR_STRUCTURED until natural mode is more capable than official 3 / extra 1",
        "reason": "False NATURAL drops phrase continuation; false STRUCTURED only returns the known RA1 natural penalty (3→1 official, 1→0 extra).",
    }

    linear_params = int(2 * D_MODEL + 2)
    mlp_8 = 256 * 8 + 8 + 8 * 2 + 2
    next_dec = (
        "Response-mode routing is the correct next architecture: STRUCTURED=EA1+RA1, NATURAL=EA1+BYPASS, fail-closed to STRUCTURED. "
        "Do not include NA1. Do not implement NE1 yet. "
        + (
            "Held-out and extra-unseen features separate well enough that MOD-02A router-only training is scientifically justified as a bounded experiment, not a production install. "
            if train_router
            else "Separability is not yet strong enough on held-out/extra-unseen to authorize MOD-02A training. Improve the router dataset or accept always-structured until then. "
        )
        + "Canonical remains STEP_400. Do not promote."
    )

    report = {
        "kind": "WRIM_GENESIS_RESPONSE_MODE_ROUTER_REVIEW",
        "PROGRAM_STATUS": "REVIEW_COMPLETE_NO_TRAINING",
        "CANONICAL": "STEP_400",
        "PARENT": "WRIM1-UH1-AC2-EA1-000010/step-25",
        "STRUCTURED_ROUTE": "EA1 + RA1",
        "NATURAL_ROUTE": "EA1 + BYPASS",
        "NA1_IN_ROUTE_TABLE": "NO",
        "NE1_STATUS": "FUTURE_OPTIONAL",
        "ROUTER_INPUT_CANDIDATES": {
            "A_assistant_entry_before_EA1": "AVAILABLE: hidden_pre_adapters at <|assistant|>. Includes frozen AC1 add (constant vector, no prompt-specific routing by itself).",
            "B_assistant_entry_after_EA1": "AVAILABLE: pre_ea1 + ea1.delta.",
            "C_EA1_residual": "AVAILABLE: ea1.delta at entry.",
            "D_last_prompt_hidden": "AVAILABLE: hidden_pre_adapters at prefix[-2].",
            "AC1_vector": "EXISTS but CONSTANT across examples; not a discriminator.",
            "AC2_span_ctrl": "NOT ACTIVE at entry (span mask false). Too late for a pre-span decision if applied only on token2+.",
            "pooled_prompt": "Can be mean-pooled from hidden_pre_adapters without a new encoder; not required if A/B/C separate.",
            "forbidden": ["task-group label", "example_id", "family", "target", "split", "file name"],
        },
        "BEST_ROUTER_INPUT": best_name,
        "BEST_ROUTER_INPUT_DIM": D_MODEL,
        "LINEAR_SEPARABILITY_TRAIN": best["linear_probe_train"],
        "LINEAR_SEPARABILITY_HELDOUT": best["linear_probe_heldout"],
        "LINEAR_SEPARABILITY_EXTRA_UNSEEN": best["linear_probe_extra_unseen"],
        "NEAREST_CENTROID": {
            "train": best["nearest_centroid_train"],
            "heldout": best["nearest_centroid_heldout"],
            "extra_unseen": best["nearest_centroid_extra"],
        },
        "FEATURE_REPORT": feature_report,
        "ROUTER_LABEL_LEAKAGE_RISK": leak,
        "ROUTER_ARCHITECTURE_RECOMMENDATION": "Linear(256→2)+bias" if architecture_ready or best["linear_probe_heldout"]["accuracy"] >= 0.75 else "Linear first; tiny MLP(256→8→2) only if MOD-02A linear fails held-out",
        "ROUTER_PARAMETER_COUNT": linear_params,
        "ROUTER_PARAMETER_CEILING": 4096,
        "TINY_MLP_8_PARAM_COUNT": mlp_8,
        "ROUTER_OUTPUTS": "STRUCTURED / NATURAL",
        "ROUTING_GRANULARITY": "PER_RESPONSE",
        "ROUTER_LATCH_UNTIL_EOS": "YES",
        "FAIL_CLOSED_DEFAULT": "STRUCTURED",
        "ORACLE_RESPONSE_MODE_CAPABILITY": oracle_cap,
        "STRUCTURED_TO_BYPASS_ERROR_COST": struct_to_bypass,
        "NATURAL_TO_RA1_ERROR_COST": nat_to_ra1,
        "ROUTER_CONFIDENCE_POLICY_RECOMMENDATION": confidence_policy,
        "MULTI_TURN_STATE_MACHINE": {
            "steps": [
                "process prompt tokens",
                "reach <|assistant|> entry hidden (pre-EA1)",
                "compute router input from runtime hidden only",
                "choose STRUCTURED or NATURAL; unknown/low-confidence → STRUCTURED",
                "apply EA1 for token1 in both modes",
                "STRUCTURED: RA1 on token2+; NATURAL: RA1 off, NA1 off, base to lm_head",
                "latch mode until EOS or role reset",
                "generate until EOS",
                "clear latch",
                "next assistant response computes a new decision",
            ],
            "tests": [
                "turn1 NATURAL, EOS, turn2 STRUCTURED, no latch leak",
                "turn1 STRUCTURED, EOS, turn2 NATURAL, no latch leak",
                "missing router / NaN probs fail closed to STRUCTURED",
            ],
        },
        "CHECKPOINT_FORMAT_RECOMMENDATION": {
            "architecture_id": "WRIM-G-20M-v1-option-A-UH1-AC2-EA1-RA1-RMR1",
            "router_architecture_id": "Linear-256-2-bias",
            "router_input_type": best_name,
            "router_hash": "sha256 of router tensors only",
            "router_threshold": "calibrated on held-out structured, stored as float",
            "mode_labels": ["STRUCTURED", "NATURAL"],
            "fallback_policy": "FAIL_CLOSED_STRUCTURED",
            "base_hash": "frozen WRIM body",
            "ea1_hash": True,
            "ra1_hash": True,
            "routing_version": "MOD-02A-RESPONSE-MODE-v1",
            "do_not_store": "task-group labels as runtime inputs",
        },
        "MOD_02A_DESIGN": "Train Linear(256→2) on STRUCTURED vs NATURAL labels with runtime hidden inputs only. Frozen WRIM. Compare ALWAYS STRUCTURED / ALWAYS BYPASS / ORACLE / LEARNED. Success is end-to-end generation, not classification accuracy.",
        "MOD_02A_TRAINABLE_MODULES": "ROUTER_ONLY",
        "MOD_02A_FROZEN_MODULES": ["base", "tok_emb", "lm_head", "AC1", "AC2", "EA1", "RA1", "NA1", "norms", "attention", "ffn"],
        "MOD_02A_DATA_SPLIT": {
            "train_structured": "phrase train (and optionally two/three/para train, no prompt overlap with val)",
            "train_natural": "NAT_DIR train.jsonl only",
            "heldout_structured": "phrase val",
            "heldout_natural": "NAT_DIR val.jsonl",
            "extra_unseen": "natural_span_eval / extra-unseen; never used for threshold or early stopping",
            "no_prompt_duplicates": True,
            "labels_are_targets_only": True,
        },
        "MOD_02A_BASELINES": ["ALWAYS_STRUCTURED", "ALWAYS_NATURAL_BYPASS", "ORACLE_MODE", "LEARNED_ROUTER"],
        "MOD_02A_SUCCESS_CRITERIA": [
            "structured EA1+RA1 phrase identity remains useful (prefer exact 17/3/5/5/4/6/10/3)",
            "end-to-end official natural beats always-RA1 (parent 1) by routing to bypass",
            "EOS/stopping controlled; ramble/empty not worse than parent",
            "fail-closed STRUCTURED works",
            "latch/reset works across turns",
        ],
        "MOD_02A_EXTRA_UNSEEN_CRITERIA": "extra-unseen routing recall above chance and extra-unseen greedy at least matches oracle-bypass (1), not merged into official val",
        "END_TO_END_ROUTER_PROOF_REQUIRED": "YES",
        "RESPONSE_MODE_ROUTER_ARCHITECTURE_READY": "YES" if architecture_ready else "NO",
        "ROUTER_TRAINING_AUTHORIZATION_RECOMMENDED": "YES" if train_router else "NO",
        "NE1_REVIEW_AFTER_ROUTER": "YES",
        "SPARSE_EXPERT_FIT": "RA1 is an optional response specialist; BYPASS means no specialist. Route only when specialization helps. Not a full MoE.",
        "NATURAL_ENTRY_LIMITATION_PRESERVED": "Router cannot exceed official natural 3 / extra-unseen 1. Gold token1 still unlocks 6 / 9. NE1 remains future-optional after routing.",
        "ANALYSIS_PROBE_ONLY": "Linear probe was fit in-memory for separability. It is not a WRIM checkpoint and was not wired into runtime.",
        "CHECKPOINT_HASHES": hashes,
        "MODEL_PROMOTED": "NO",
        "CANONICAL_CHANGED": "NO",
        "TRAINING_PERFORMED": "NO",
        "ROUTER_IMPLEMENTED": "NO",
        "NA1_RETRAINED": "NO",
        "NE1_IMPLEMENTED": "NO",
        "BODY_UNFROZEN": "NO",
        "LM_HEAD_TRAINED": "NO",
        "TOKENIZER_CHANGED": "NO",
        "COMMIT": "NO",
        "PUSH": "NO",
        "DEPLOY": "NO",
        "TRAINING_AUTHORIZATION_FINAL": "OFF",
        "NEXT_COMMANDER_DECISION": next_dec,
    }
    slim_feats = {
        k: [{"example_id": r["example_id"], "family": r["family"], "prompt": r["prompt"]} for r in v]
        for k, v in feats.items()
    }
    _write(DETAIL, json.loads(json.dumps({"features_index": slim_feats, "feature_report": feature_report, "error_cost": {"struct_to_bypass": struct_to_bypass, "nat_to_ra1": nat_to_ra1}}, default=str)))
    _write(REPORT, json.loads(json.dumps(report, default=str)))
    print(json.dumps({
        "BEST_ROUTER_INPUT": best_name,
        "params": linear_params,
        "train": best["linear_probe_train"],
        "heldout": best["linear_probe_heldout"],
        "extra": best["linear_probe_extra_unseen"],
        "nc_heldout": best["nearest_centroid_heldout"],
        "nc_extra": best["nearest_centroid_extra"],
        "phrase_ra1": phrase_ra1.get("short_phrase_exact"),
        "phrase_bypass": phrase_bypass.get("short_phrase_exact"),
        "nat_bypass": nat_bypass.get("short_phrase_exact"),
        "nat_ra1": nat_ra1.get("short_phrase_exact"),
        "extra_bypass": extra_bypass.get("short_phrase_exact"),
        "extra_ra1": extra_ra1.get("short_phrase_exact"),
        "architecture_ready": architecture_ready,
        "train_router": train_router,
        "leakage": leak["risk"],
    }, indent=2, default=str))
    return report


if __name__ == "__main__":
    main()
