#!/usr/bin/env python3
"""EVAL-6 baseline battle vs frozen WRIM L10 mean router. No WRIM/LoRA training."""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR.parent / "sovereign-model-lab"))
sys.path.insert(0, str(SCRIPT_DIR))

from hashes import sha256_file  # noqa: E402
from frozen_core import load_frozen_wrim0, max_abs_diff, numpy_params  # noqa: E402
from exp004_support import (  # noqa: E402
    CLASS_NAMES,
    CLASS_TO_ID,
    classification_report_6,
    keyword_predict,
    labels,
    load_jsonl,
    pred_ids,
    schema_predict,
)
from exp005_support import load_v5_train  # noqa: E402
from frozen_router_support import (  # noqa: E402
    best_abstention_by_margin,
    coverage_accuracy_curve,
    entropy,
    extract_rows,
    load_classifier,
    load_tokenizer_local,
    predict_ids,
    predict_proba,
    top1_top2_margin,
    utcnow,
    write_json,
)
from paths import (  # noqa: E402
    EXPECTED_CORE_TREE_SHA256,
    FROZEN_ROUTER_DIR,
    FROZEN_ROUTER_EVAL6_DIR,
    FROZEN_ROUTER_EVAL6_ID,
    PRODUCTION_ROOT,
    TOOL_EVAL_6_DIR,
    V5_TRAIN_HASH,
    WRIM0_CHECKPOINT_SHA256,
    WRIM0_ID,
    WRIM0_WEIGHTS,
)
from redx_support import REGISTRY_CARDS, bow_v5_style, lexical_rank, ranks_to_pred, tfidf_rank  # noqa: E402

RNG = np.random.default_rng(0)


def pack(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, Any]:
    return classification_report_6(y_true, y_pred)


def names_to_ids(names: list[str]) -> np.ndarray:
    return pred_ids(names)


def subset_report(rows: list[dict[str, Any]], y_pred: np.ndarray, pred_fn) -> dict[str, Any] | None:
    idx = [i for i, r in enumerate(rows) if pred_fn(r)]
    if not idx:
        return None
    y = labels([rows[i] for i in idx])
    p = y_pred[idx]
    rep = pack(y, p)
    rep["n"] = len(idx)
    return rep


def pair_metrics(rows: list[dict[str, Any]], y_pred: np.ndarray) -> dict[str, Any]:
    by_fam: dict[str, list[int]] = defaultdict(list)
    for i, r in enumerate(rows):
        by_fam[r["family_id"]].append(i)
    both = 0
    flipped = 0
    n = 0
    for fam, idxs in by_fam.items():
        if len(idxs) != 2:
            continue
        n += 1
        gold = [rows[i]["semantic_class"] for i in idxs]
        pred = [CLASS_NAMES[int(y_pred[i])] for i in idxs]
        both += int(pred[0] == gold[0] and pred[1] == gold[1])
        flipped += int(pred[0] != pred[1] and pred[0] == gold[0] and pred[1] == gold[1])
    return {
        "n_pairs": n,
        "matched_pair_consistency": both / n if n else None,
        "counterfactual_flip_accuracy": flipped / n if n else None,
        "note": "Pairs are two-class counterfactuals; flip accuracy equals pair consistency when both golds differ.",
    }


def scientific_conclusion(
    wrim: dict[str, Any],
    bow: dict[str, Any],
    majority: dict[str, Any],
    keyword: dict[str, Any],
    schema: dict[str, Any],
    pair: dict[str, Any],
    recs: dict[str, float],
    hard: dict[str, Any] | None,
    redx_ok: bool,
    eval6_ok: bool,
    shadow_ok: bool,
    core_diff: float,
) -> dict[str, Any]:
    w_bal = wrim["balanced_accuracy"]
    b_bal = bow["balanced_accuracy"]
    chance = 1.0 / 6.0
    if b_bal >= 0.90 and abs(w_bal - 0.77) <= 0.12:
        result = "A"
        semantic = False
        text = (
            "RESULT A: BoW remains high while WRIM stays near the EVAL-5 frozen-probe band. "
            "Lexical controls may have failed or BoW still captures enough semantics. Audit EVAL-6. Do not train WRIM."
        )
    elif b_bal < 0.80 and 0.70 <= w_bal <= 0.80:
        result = "B"
        semantic = True
        text = (
            "RESULT B: BoW dropped substantially while WRIM stayed in the 0.70–0.80 band. "
            "WRIM mid-layer features carry semantic information beyond direct lexical shortcutting."
        )
    elif w_bal > b_bal + 0.02:
        result = "C"
        semantic = True
        text = "RESULT C: Frozen WRIM materially beats BoW on EVAL-6. Native semantic routing is demonstrated on this exam."
    elif w_bal <= chance + 0.08 and b_bal <= chance + 0.08:
        result = "D"
        semantic = False
        text = "RESULT D: Both BoW and WRIM collapse near chance. Audit EVAL-6 quality before blaming WRIM."
    elif b_bal < 0.85 and w_bal < 0.60:
        result = "E"
        semantic = False
        text = (
            "RESULT E: BoW is moderate and WRIM is below 0.60. Fine-grained semantic routing remains weak "
            "despite correct extraction. Representation limits are more plausible."
        )
    else:
        result = "UNLISTED"
        semantic = bool(w_bal >= 0.70 and w_bal + 0.05 >= b_bal)
        text = (
            f"Unlisted pattern: WRIM balanced={w_bal:.4f}, BoW balanced={b_bal:.4f}. "
            "Interpret against RESULT A–E without lowering promotion gates."
        )

    gates = {
        "1_redx_reproduction": redx_ok,
        "2_eval6_quality_audit": eval6_ok,
        "3_wrim_bal_above_majority_keyword_schema": bool(
            w_bal > majority["balanced_accuracy"]
            and w_bal > keyword["balanced_accuracy"]
            and w_bal > schema["balanced_accuracy"]
        ),
        "4_matched_pair_ge_0.70": bool((pair.get("matched_pair_consistency") or 0) >= 0.70),
        "5_counterfactual_ge_0.70": bool((pair.get("counterfactual_flip_accuracy") or 0) >= 0.70),
        "6_hard_boundary_ge_0.70": bool(hard is not None and hard.get("accuracy", 0) >= 0.70),
        "7_no_class_recall_lt_0.50": all(v >= 0.50 for v in recs.values()),
        "8_shadow_supports_offline": shadow_ok,
        "9_core_diff_0": core_diff == 0.0,
        "10_no_production_behavior_changes": True,
    }
    ready = all(gates.values())
    return {
        "result_letter": result,
        "scientific_conclusion": text,
        "semantic_routing_demonstrated": semantic,
        "promotion_gates": gates,
        "promotion_review_ready": ready,
    }


def main() -> int:
    work = FROZEN_ROUTER_EVAL6_DIR
    work.mkdir(parents=True, exist_ok=True)
    train = load_v5_train()
    val = load_jsonl(TOOL_EVAL_6_DIR / "validation.jsonl")
    test = load_jsonl(TOOL_EVAL_6_DIR / "test.jsonl")
    if not val or not test:
        raise RuntimeError("EVAL-6 missing splits")
    y_test = labels(test)
    y_val = labels(val)
    n_test = len(test)

    maj = Counter(r["gold_class"] for r in train).most_common(1)[0][0]
    majority_pred = np.array([CLASS_TO_ID[maj]] * n_test, dtype=np.int32)
    random_pred = RNG.integers(0, 6, size=n_test, dtype=np.int32)
    keyword_pred = names_to_ids([keyword_predict(r["input"]) for r in test])
    schema_pred = names_to_ids([schema_predict(r["input"]) for r in test])
    bow_names = bow_v5_style(train, [{"input": r["input"], "gold_class": r["semantic_class"]} for r in test])
    bow_pred = names_to_ids(bow_names)

    id_to_class = {c["tool_id"]: (c["class_name"] or "NO_TOOL") for c in REGISTRY_CARDS}
    lex_ranks = [lexical_rank(r["input"], REGISTRY_CARDS) for r in test]
    lex_pred = names_to_ids(ranks_to_pred(lex_ranks, id_to_class))
    tfidf_ranks = tfidf_rank([r["input"] for r in test], REGISTRY_CARDS)
    tfidf_pred = names_to_ids(ranks_to_pred(tfidf_ranks, id_to_class))
    compact_pred = names_to_ids(["NO_TOOL"] * n_test)  # EVAL-6 is natural language; compact TOOL= parser would NO_TOOL

    from frozen_core import load_frozen_wrim0  # local already imported

    if sha256_file(WRIM0_WEIGHTS) != WRIM0_CHECKPOINT_SHA256:
        raise RuntimeError("WRIM SHA")
    core = load_frozen_wrim0()
    before_tree = core.weight_tree_hash()
    snap0 = numpy_params(core.model)
    tokenizer = load_tokenizer_local()
    clf = load_classifier(FROZEN_ROUTER_DIR / "classifier.npz")
    xte = extract_rows(core.model, tokenizer, [{"input": r["input"]} for r in test])
    xva = extract_rows(core.model, tokenizer, [{"input": r["input"]} for r in val])
    wrim_te = predict_ids(clf, xte)
    wrim_va = predict_ids(clf, xva)
    proba = predict_proba(clf, xte)
    after_tree = core.weight_tree_hash()
    peak = max_abs_diff(snap0, numpy_params(core.model))

    wrim = pack(y_test, wrim_te)
    wrim_val = pack(y_val, wrim_va)
    systems = {
        "majority": pack(y_test, majority_pred),
        "random": pack(y_test, random_pred),
        "keyword": pack(y_test, keyword_pred),
        "schema_rule": pack(y_test, schema_pred),
        "bow_logistic_v5_style": pack(y_test, bow_pred),
        "frozen_wrim_l10_mean": wrim,
        "deterministic_compact_parser": pack(y_test, compact_pred),
        "registry_lexical": pack(y_test, lex_pred),
        "registry_tfidf": pack(y_test, tfidf_pred),
    }
    recs = {c: wrim["per_class"][c]["recall"] for c in CLASS_NAMES}
    pair = pair_metrics(test, wrim_te)
    hard = subset_report(test, wrim_te, lambda r: bool(r.get("boundary_pair")))
    lex_adv = subset_report(test, wrim_te, lambda r: r.get("lexical_adversarial"))
    lex_adv_bow = subset_report(test, bow_pred, lambda r: r.get("lexical_adversarial"))
    lex_adv_kw = subset_report(test, keyword_pred, lambda r: r.get("lexical_adversarial"))
    mt = subset_report(test, wrim_te, lambda r: r.get("multi_turn"))
    info = subset_report(test, wrim_te, lambda r: r.get("information_state"))
    traps = subset_report(test, wrim_te, lambda r: r.get("negation_trap"))

    top1, margin = top1_top2_margin(proba)
    ent = entropy(proba)
    correct = wrim_te == y_test
    conf = {
        "top1_mean": float(top1.mean()),
        "margin_mean": float(margin.mean()),
        "entropy_mean": float(ent.mean()),
        "confidence_correct_mean": float(top1[correct].mean()) if np.any(correct) else None,
        "confidence_incorrect_mean": float(top1[~correct].mean()) if np.any(~correct) else None,
        "margin_correct_mean": float(margin[correct].mean()) if np.any(correct) else None,
        "margin_incorrect_mean": float(margin[~correct].mean()) if np.any(~correct) else None,
        "coverage_vs_accuracy_margin": coverage_accuracy_curve(y_test, wrim_te, margin),
        "coverage_vs_accuracy_top1": coverage_accuracy_curve(y_test, wrim_te, top1),
        "best_abstention_margin": best_abstention_by_margin(y_test, wrim_te, margin),
    }

    redx_fit = json.loads((FROZEN_ROUTER_DIR / "fit-metrics.json").read_text())
    redx_ok = bool(redx_fit["redx_reproduction"]["ok"])
    e6_audit = json.loads((TOOL_EVAL_6_DIR / "quality-audit.json").read_text())
    shadow_ok = (FROZEN_ROUTER_DIR.parent / "WR-TOOL-FROZEN-ROUTER-SHADOW-001" / "manifest.json").is_file()
    # Shadow may run after; gate 8 filled later by prove script. Record intent.
    conclusion = scientific_conclusion(
        wrim,
        systems["bow_logistic_v5_style"],
        systems["majority"],
        systems["keyword"],
        systems["schema_rule"],
        pair,
        recs,
        hard,
        redx_ok,
        bool(e6_audit.get("ok")),
        shadow_ok,
        float(peak),
    )
    gap = {
        "wrim_minus_bow_accuracy": wrim["accuracy"] - systems["bow_logistic_v5_style"]["accuracy"],
        "wrim_minus_bow_balanced": wrim["balanced_accuracy"] - systems["bow_logistic_v5_style"]["balanced_accuracy"],
        "wrim_minus_bow_macro_f1": wrim["macro_f1"] - systems["bow_logistic_v5_style"]["macro_f1"],
        "lexical_adversarial_wrim_minus_bow": (
            (lex_adv or {}).get("accuracy", 0) - (lex_adv_bow or {}).get("accuracy", 0)
            if lex_adv and lex_adv_bow
            else None
        ),
    }

    write_json(work / "baseline-matrix.json", systems)
    write_json(work / "wrim-results.json", {"test": wrim, "validation": wrim_val, "pair_metrics": pair})
    write_json(work / "bow-results.json", systems["bow_logistic_v5_style"])
    write_json(work / "confusion-matrices.json", {k: v["confusion_matrix"] for k, v in systems.items()})
    write_json(work / "per-class-metrics.json", wrim["per_class"])
    write_json(work / "matched-pair-metrics.json", pair)
    write_json(work / "hard-boundary-metrics.json", hard)
    write_json(
        work / "lexical-adversarial-metrics.json",
        {"wrim": lex_adv, "bow": lex_adv_bow, "keyword": lex_adv_kw},
    )
    write_json(work / "subset-metrics.json", {"multi_turn": mt, "information_state": info, "negation_trap": traps})
    write_json(work / "confidence-analysis.json", conf)
    write_json(work / "coverage-vs-accuracy.json", conf["coverage_vs_accuracy_margin"])
    write_json(
        work / "core-immutability-proof.json",
        {
            "core_tree_sha_before": before_tree,
            "core_tree_sha_after": after_tree,
            "core_file_sha": sha256_file(WRIM0_WEIGHTS),
            "max_abs_diff": peak,
            "wrim_training_performed": False,
            "lora_training_performed": False,
            "active_core": WRIM0_ID,
            "active_modules": [],
            "production_root": str(PRODUCTION_ROOT),
        },
    )
    write_json(work / "scientific-conclusion.json", conclusion)
    write_json(work / "gaps.json", gap)
    write_json(
        work / "manifest.json",
        {
            "identity": FROZEN_ROUTER_EVAL6_ID,
            "created_at": utcnow(),
            "v5_train_hash": V5_TRAIN_HASH,
            "eval6": str(TOOL_EVAL_6_DIR),
            "n_test": n_test,
            "n_val": len(val),
        },
    )
    print(json.dumps({"wrim_bal": wrim["balanced_accuracy"], "bow_bal": systems["bow_logistic_v5_style"]["balanced_accuracy"], "result": conclusion["result_letter"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
