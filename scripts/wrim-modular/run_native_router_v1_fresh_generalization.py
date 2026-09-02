#!/usr/bin/env python3
"""Frozen Native Router V1 fresh generalization exam. No training. No rule edits. No promotion."""
from __future__ import annotations

import json
import math
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR.parent / "sovereign-model-lab"))
sys.path.insert(0, str(SCRIPT_DIR))

from build_fresh_generalization_corpus import build_corpus, dump_jsonl  # noqa: E402
from exp004_support import CLASS_NAMES, CLASS_TO_ID, classification_report_6, labels, pred_ids  # noqa: E402
from freeze_native_router_v1_generalization import SOURCE_FILES, main as freeze_main  # noqa: E402
from frozen_core import load_frozen_wrim0, max_abs_diff, numpy_params  # noqa: E402
from frozen_router_support import extract_rows, load_classifier, load_tokenizer_local, predict_proba, utcnow, write_json  # noqa: E402
from hashes import sha256_file, sha256_json  # noqa: E402
from native_router_v1 import FAMILY_TO_EVAL6, NativeRouterV1, RULE_SPECS, parse_tool_registry_cards, registry_snapshot_hash  # noqa: E402
from paths import (  # noqa: E402
    EXPECTED_CORE_TREE_SHA256,
    FROZEN_ROUTER_DIR,
    NATIVE_ROUTER_V1_FRESH_GEN_DIR,
    NATIVE_ROUTER_V1_FRESH_GEN_ID,
    NATIVE_ROUTER_V1_FROZEN_GEN_DIR,
    NATIVE_ROUTER_V1_FROZEN_GEN_ID,
    NATIVE_ROUTER_V1_ID,
    PRODUCTION_ROOT,
    ROOT,
    WRIM0_CHECKPOINT_SHA256,
    WRIM0_WEIGHTS,
)

LOCKED_GATES = {
    "balanced_accuracy": 0.90,
    "macro_f1": 0.88,
    "min_class_recall": 0.75,
    "tool_vs_no_tool": 0.92,
    "conditional_tool_id": 0.90,
    "information_state": 0.90,
    "multi_turn": 0.85,
    "lexical_adversarial": 0.75,
    "unknown_unsupported_abstention": 0.85,
    "wrong_confident_rate": 0.05,
}

CONFIDENT_ABSTAIN = {"ROUTE_CONFIDENT", "NO_TOOL_CONFIDENT"}


def load_frozen_bow(path: Path) -> dict[str, Any]:
    z = np.load(path, allow_pickle=True)
    keys = [str(k) for k in z["vocab"].tolist()]
    vocab = {k: i for i, k in enumerate(keys)}
    return {"vocab": vocab, "weights": z["weights"], "hash": sha256_file(path), "type": "v5_style_l2_bow_ova"}


def pack_names(y_true_names: list[str], y_pred_names: list[str]) -> dict[str, Any]:
    y = np.array([CLASS_TO_ID[n] for n in y_true_names], dtype=np.int64)
    p = pred_ids(y_pred_names)
    return classification_report_6(y, p)


def subset_acc(rows: list[dict[str, Any]], pred: list[str], key: str) -> dict[str, Any] | None:
    idx = [i for i, r in enumerate(rows) if r.get("strata", {}).get(key) or key in (r.get("tags") or [])]
    if key == "information_state":
        idx = [i for i, r in enumerate(rows) if r.get("strata", {}).get("information_state") and "real_test_compact" not in (r.get("tags") or [])]
    if not idx:
        return {"n": 0, "accuracy": None}
    ok = sum(int(pred[i] == rows[i]["gold_route"]) for i in idx)
    return {"n": len(idx), "accuracy": ok / len(idx)}


def pair_metrics(rows: list[dict[str, Any]], pred: list[str]) -> dict[str, Any]:
    by: dict[str, list[int]] = defaultdict(list)
    for i, r in enumerate(rows):
        fid = r.get("family_id")
        if fid:
            by[fid].append(i)
    both = flipped = n = 0
    families = {}
    for fam, idxs in by.items():
        if len(idxs) != 2:
            continue
        n += 1
        gold = [rows[i]["gold_route"] for i in idxs]
        pr = [pred[i] for i in idxs]
        ok_both = pr[0] == gold[0] and pr[1] == gold[1]
        ok_flip = pr[0] != pr[1] and ok_both
        both += int(ok_both)
        flipped += int(ok_flip)
        families[fam] = {"gold": gold, "pred": pr, "consistent": ok_both, "flipped": ok_flip}
    return {
        "n_pairs": n,
        "matched_pair_consistency": both / n if n else None,
        "counterfactual_flip_accuracy": flipped / n if n else None,
        "n_pair_members": n * 2,
    }


def coverage_curve(correct: np.ndarray, scores: np.ndarray, covers: tuple[float, ...]) -> list[dict[str, Any]]:
    n = len(correct)
    order = np.argsort(-scores)
    out = []
    for cov in covers:
        k = n if cov >= 1.0 else max(1, int(math.ceil(cov * n)))
        idx = order[:k]
        out.append({"coverage": cov, "n": int(k), "selective_accuracy": float(np.mean(correct[idx])) if k else None})
    return out


def balanced_prefix(rows: list[dict[str, Any]], n: int) -> list[dict[str, Any]]:
    by: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        by[r["gold_route"]].append(r)
    for c in CLASS_NAMES:
        by[c].sort(key=lambda x: x["request_id"])
    out: list[dict[str, Any]] = []
    i = 0
    while len(out) < min(n, len(rows)):
        progressed = False
        for c in CLASS_NAMES:
            if i < len(by[c]):
                out.append(by[c][i])
                progressed = True
                if len(out) >= n:
                    break
        if not progressed:
            break
        i += 1
    return out


def info_state_acc(rows: list[dict[str, Any]], decisions: list[dict[str, Any]]) -> dict[str, Any]:
    idx = [i for i, r in enumerate(rows) if r.get("lane") == "SIX_WAY" and "real_test_compact" not in (r.get("tags") or [])]
    if not idx:
        return {"n": 0, "accuracy": None}
    ok = sum(int(decisions[i]["information_state"] == rows[i]["gold_information_state"]) for i in idx)
    return {"n": len(idx), "accuracy": ok / len(idx)}


def distractor_cards(base: list[dict[str, Any]], n: int) -> list[dict[str, Any]]:
    cards = [dict(c) for c in base]
    i = 0
    while len(cards) < n:
        src = base[i % len(base)]
        clone = dict(src)
        clone["tool_id"] = f"{src['tool_id']}__distractor_{i:02d}"
        clone["canonical_name"] = f"{src['canonical_name']} distractor {i}"
        clone["analysis_only"] = True
        clone["in_tool_registry"] = False
        clone["authority"] = "analysis_only_clone_of_existing_registry_entry"
        cards.append(clone)
        i += 1
    return cards[:n]


def score_many(router: NativeRouterV1, texts: list[str], mode: str, wrim_map: dict[str, np.ndarray] | None) -> list[dict[str, Any]]:
    out = []
    for t in texts:
        wp = None if wrim_map is None else wrim_map.get(t)
        t0 = time.perf_counter()
        d = router.score(t, mode=mode, wrim_proba=wp)
        d["latency_ms"] = (time.perf_counter() - t0) * 1000
        out.append(d)
    return out


def six_metrics(rows: list[dict[str, Any]], decisions: list[dict[str, Any]]) -> dict[str, Any]:
    gold = [r["gold_route"] for r in rows]
    pred = [d["predicted_class"] for d in decisions]
    rep = pack_names(gold, pred)
    recs = {c: rep["per_class"][c]["recall"] for c in CLASS_NAMES}
    correct = np.array([int(g == p) for g, p in zip(gold, pred)], dtype=np.float64)
    conf = np.array([d["confidence"] for d in decisions], dtype=np.float64)
    margin = np.array([d["margin"] for d in decisions], dtype=np.float64)
    ok = correct.astype(bool)
    wrong = ~ok
    abstain = [d["abstain_state"] not in CONFIDENT_ABSTAIN for d in decisions]
    abstain_n = sum(int(a) for a in abstain)
    wrong_conf = sum(int(wrong[i] and not abstain[i]) for i in range(len(rows)))
    pred_arr = pred
    return {
        "report": rep,
        "recalls": recs,
        "pair": pair_metrics(rows, pred_arr),
        "natural_paraphrase": subset_acc(rows, pred_arr, "natural_paraphrase"),
        "multi_turn": subset_acc(rows, pred_arr, "multi_turn"),
        "information_state_route": subset_acc(rows, pred_arr, "information_state"),
        "information_state_label": info_state_acc(rows, decisions),
        "lexical_adversarial": subset_acc(rows, pred_arr, "lexical_adversary"),
        "no_tool_trap": subset_acc(rows, pred_arr, "no_tool_trap"),
        "web_vs_research": subset_acc(rows, pred_arr, "web_vs_research"),
        "memory_vs_files": subset_acc(rows, pred_arr, "memory_vs_files"),
        "current_vs_memory": subset_acc(rows, pred_arr, "current_vs_memory"),
        "sha256_vs_no_tool": subset_acc(rows, pred_arr, "sha256_vs_no_tool"),
        "registry_distractor": subset_acc(rows, pred_arr, "registry_distractor"),
        "disagreement_rate": float(np.mean([int(d["disagreement"]) for d in decisions])) if decisions else 0.0,
        "abstention_rate": abstain_n / len(decisions) if decisions else 0.0,
        "coverage": 1.0 - (abstain_n / len(decisions) if decisions else 0.0),
        "wrong_confident_rate": wrong_conf / len(rows) if rows else 0.0,
        "confidence_correct_mean": float(np.mean(conf[ok])) if np.any(ok) else None,
        "confidence_incorrect_mean": float(np.mean(conf[wrong])) if np.any(wrong) else None,
        "margin_correct_mean": float(np.mean(margin[ok])) if np.any(ok) else None,
        "margin_incorrect_mean": float(np.mean(margin[wrong])) if np.any(wrong) else None,
        "coverage_accuracy_curve": coverage_curve(correct, conf, (1.0, 0.95, 0.90, 0.80, 0.75, 0.50)),
        "selective_accuracy_full": float(np.mean(correct)),
        "false_abstention_rate": sum(int(ok[i] and abstain[i]) for i in range(len(rows))) / len(rows) if rows else 0.0,
        "abstention_precision": (
            sum(int(wrong[i] and abstain[i]) for i in range(len(rows))) / abstain_n if abstain_n else None
        ),
        "provenance": provenance_acc(rows, pred_arr),
        "mean_serving_latency_ms": float(np.mean([d["latency_ms"] for d in decisions])) if decisions else None,
    }


def provenance_acc(rows: list[dict[str, Any]], pred: list[str]) -> dict[str, Any]:
    out = {}
    for p in ("REAL_RUNTIME_FRESH", "REAL_TEST_FRESH", "HUMAN_ADJUDICATED_FRESH", "ADV_TEST_FRESH"):
        idx = [i for i, r in enumerate(rows) if r["provenance"] == p]
        if not idx:
            out[p] = {"n": 0, "accuracy": None}
        else:
            out[p] = {"n": len(idx), "accuracy": sum(int(pred[i] == rows[i]["gold_route"]) for i in idx) / len(idx)}
    return out


def gate_eval(bundle: dict[str, Any], unknown_acc: float | None) -> dict[str, Any]:
    rep = bundle["report"]
    recs = bundle["recalls"]
    info = (bundle["information_state_label"] or {}).get("accuracy")
    mt = (bundle["multi_turn"] or {}).get("accuracy")
    lex = (bundle["lexical_adversarial"] or {}).get("accuracy")
    checks = {
        "balanced_accuracy": (rep["balanced_accuracy"], LOCKED_GATES["balanced_accuracy"], rep["balanced_accuracy"] >= LOCKED_GATES["balanced_accuracy"]),
        "macro_f1": (rep["macro_f1"], LOCKED_GATES["macro_f1"], rep["macro_f1"] >= LOCKED_GATES["macro_f1"]),
        "min_class_recall": (min(recs.values()), LOCKED_GATES["min_class_recall"], all(v >= LOCKED_GATES["min_class_recall"] for v in recs.values())),
        "tool_vs_no_tool": (rep["tool_vs_no_tool_accuracy"], LOCKED_GATES["tool_vs_no_tool"], rep["tool_vs_no_tool_accuracy"] >= LOCKED_GATES["tool_vs_no_tool"]),
        "conditional_tool_id": (rep["conditional_tool_id_accuracy"], LOCKED_GATES["conditional_tool_id"], (rep["conditional_tool_id_accuracy"] or 0) >= LOCKED_GATES["conditional_tool_id"]),
        "information_state": (info, LOCKED_GATES["information_state"], (info or 0) >= LOCKED_GATES["information_state"]),
        "multi_turn": (mt, LOCKED_GATES["multi_turn"], (mt or 0) >= LOCKED_GATES["multi_turn"]),
        "lexical_adversarial": (lex, LOCKED_GATES["lexical_adversarial"], (lex or 0) >= LOCKED_GATES["lexical_adversarial"]),
        "unknown_unsupported_abstention": (unknown_acc, LOCKED_GATES["unknown_unsupported_abstention"], (unknown_acc or 0) >= LOCKED_GATES["unknown_unsupported_abstention"]),
        "wrong_confident_rate": (bundle["wrong_confident_rate"], LOCKED_GATES["wrong_confident_rate"], bundle["wrong_confident_rate"] <= LOCKED_GATES["wrong_confident_rate"]),
    }
    return {
        "gates": LOCKED_GATES,
        "results": {k: {"observed": a, "threshold": b, "pass": c} for k, (a, b, c) in checks.items()},
        "all_pass": all(c for _, _, c in checks.values()),
    }


def classify_failure(row: dict[str, Any], d: dict[str, Any]) -> str:
    gold = row["gold_route"]
    pred = d["predicted_class"]
    if row["lane"] == "MULTI_TOOL":
        return "MULTI_TOOL"
    if row["lane"] in {"UNKNOWN_UNSUPPORTED", "AMBIGUOUS"}:
        if row["lane"] == "UNKNOWN_UNSUPPORTED":
            return "UNKNOWN_CAPABILITY"
        return "LABEL_AMBIGUITY"
    if d["decision_stage"].startswith("deterministic") and pred != gold:
        return "RULE_GENERALIZATION"
    if d["components"]["lexical"] == pred and pred != gold:
        return "LEXICAL_GENERALIZATION"
    if d["information_state"] != row.get("gold_information_state"):
        return "STATE_CLASSIFICATION"
    if d.get("schema", {}).get("removed"):
        return "REGISTRY_SCHEMA"
    if d["abstain_state"] not in CONFIDENT_ABSTAIN and pred != gold:
        return "ABSTENTION"
    if "multi_turn" in (row.get("tags") or []):
        return "CONTEXT_ASSEMBLY"
    return "OTHER"


def main() -> int:
    freeze_main()
    work = NATIVE_ROUTER_V1_FRESH_GEN_DIR
    work.mkdir(parents=True, exist_ok=True)
    frozen = NATIVE_ROUTER_V1_FROZEN_GEN_DIR
    man = json.loads((frozen / "baseline-manifest.json").read_text(encoding="utf-8"))
    source_before = dict(man["source_file_hashes"])
    router_hash_before = source_before["native_router_v1.py"]
    wrim_before = sha256_file(WRIM0_WEIGHTS)

    corpus = build_corpus()
    six = [r for r in corpus if r["lane"] == "SIX_WAY"]
    amb = [r for r in corpus if r["lane"] == "AMBIGUOUS"]
    unk = [r for r in corpus if r["lane"] == "UNKNOWN_UNSUPPORTED"]
    multi = [r for r in corpus if r["lane"] == "MULTI_TOOL"]
    dump_jsonl(work / "fresh-cases.jsonl", corpus)
    dump_jsonl(work / "gold-adjudications.jsonl", corpus)
    write_json(
        work / "fresh-corpus-manifest.json",
        {
            "identity": NATIVE_ROUTER_V1_FRESH_GEN_ID,
            "n_total": len(corpus),
            "n_six_way": len(six),
            "n_ambiguous": len(amb),
            "n_unknown": len(unk),
            "n_multi_tool": len(multi),
            "provenance_counts": {
                p: sum(1 for r in corpus if r["provenance"] == p)
                for p in ("REAL_RUNTIME_FRESH", "REAL_TEST_FRESH", "HUMAN_ADJUDICATED_FRESH", "ADV_TEST_FRESH")
            },
            "six_way_class_counts": {c: sum(1 for r in six if r["gold_route"] == c) for c in CLASS_NAMES},
            "honest_runtime_note": "Existing trajectory pools were used in V5/EVAL-4/EVAL-5. No unused REAL_RUNTIME_FRESH traffic was available. Compact TOOL= rows are REAL_TEST_FRESH only.",
            "gold_independent_of_router": True,
            "cases_hash": sha256_file(work / "fresh-cases.jsonl"),
        },
    )

    cards = parse_tool_registry_cards()
    bow = load_frozen_bow(frozen / "lexical-bow.npz")
    if bow["hash"] != man["lexical_model_hash"]:
        raise RuntimeError("frozen lexical hash mismatch")
    router = NativeRouterV1(cards=cards, bow=bow, margin_threshold=0.12)

    if sha256_file(WRIM0_WEIGHTS) != WRIM0_CHECKPOINT_SHA256:
        raise RuntimeError("WRIM SHA mismatch")
    core = load_frozen_wrim0()
    snap0 = numpy_params(core.model)
    tree_before = core.weight_tree_hash()
    tokenizer = load_tokenizer_local()
    clf = load_classifier(frozen / "frozen-l10-classifier.npz")
    uniq = []
    seen = set()
    for r in corpus:
        if r["input"] not in seen:
            seen.add(r["input"])
            uniq.append(r["input"])
    t0 = time.perf_counter()
    x = extract_rows(core.model, tokenizer, [{"input": t} for t in uniq])
    wrim_extract_s = time.perf_counter() - t0
    proba = predict_proba(clf, x)
    wrim_map = {t: proba[i] for i, t in enumerate(uniq)}
    wrim_after = sha256_file(WRIM0_WEIGHTS)
    peak = float(max_abs_diff(snap0, numpy_params(core.model)))
    tree_after = core.weight_tree_hash()

    texts6 = [r["input"] for r in six]
    serving = score_many(router, texts6, "full", None)
    det = score_many(router, texts6, "det", None)
    lex = score_many(router, texts6, "lex", None)
    det_lex = score_many(router, texts6, "det_lex", None)
    wrim_only = score_many(router, texts6, "wrim", wrim_map)
    hybrid = score_many(router, texts6, "full", wrim_map)

    b_serve = six_metrics(six, serving)
    b_det = six_metrics(six, det)
    b_lex = six_metrics(six, lex)
    b_dl = six_metrics(six, det_lex)
    b_wrim = six_metrics(six, wrim_only)
    b_hyb = six_metrics(six, hybrid)

    # Unknown / multi
    unk_dec = score_many(router, [r["input"] for r in unk], "full", None)
    unk_hits = sum(int(d["abstain_state"] == "NO_COMPATIBLE_TOOL") for d in unk_dec)
    unk_acc = unk_hits / len(unk) if unk else None
    unk_confident_hallucinate = sum(
        int(d["predicted_class"] in CLASS_NAMES and d["predicted_class"] != "NO_TOOL" and d["abstain_state"] in CONFIDENT_ABSTAIN)
        for d in unk_dec
    )

    mt_dec = score_many(router, [r["input"] for r in multi], "full", None)
    mt_pred_pos = [bool(d["multi_tool"]["multi_tool_required"]) for d in mt_dec]
    recall = sum(int(p) for p in mt_pred_pos) / len(multi) if multi else None
    # precision vs a negative control: six-way serving should mostly not fire multi
    six_multi_false = sum(int(d["multi_tool"]["multi_tool_required"]) for d in serving)
    precision_den = sum(int(p) for p in mt_pred_pos) + six_multi_false
    precision = (sum(int(p) for p in mt_pred_pos) / precision_den) if precision_den else None
    exact = 0
    collapse = 0
    for r, d in zip(multi, mt_dec):
        gold_set = set(r.get("gold_multi_tools") or [])
        fams = d["multi_tool"]["candidate_families"]
        mapped = {FAMILY_TO_EVAL6[f] for f in fams if f in FAMILY_TO_EVAL6}
        if d["multi_tool"]["multi_tool_required"] and mapped == gold_set:
            exact += 1
        if not d["multi_tool"]["multi_tool_required"]:
            collapse += 1
    mt_report = {
        "n": len(multi),
        "recall": recall,
        "precision_vs_sixway_negatives": precision,
        "exact_family_set_accuracy": exact / len(multi) if multi else None,
        "false_single_route_collapse_rate": collapse / len(multi) if multi else None,
        "historical_recall_reference": 0.40,
        "improves_over_0_40": (recall or 0) > 0.40,
        "planner_implemented": False,
        "execution_allowed": False,
    }

    amb_dec = score_many(router, [r["input"] for r in amb], "full", None)
    amb_ok = sum(int(d["abstain_state"] in {"ROUTE_AMBIGUOUS", "INSUFFICIENT_CONTEXT", "TOOL_OPTIONAL", "NO_COMPATIBLE_TOOL"}) for d in amb_dec)

    # Rule performance on serving six-way
    rule_stats: dict[str, dict[str, Any]] = {}
    for spec in RULE_SPECS:
        rid = spec["id"]
        trig = []
        for r, d in zip(six, serving):
            fired = d.get("reason_codes") or []
            if rid in fired or any(x.get("id") == rid for x in []):
                trig.append((r, d))
            # components don't include rules_fired; recompute via decision_stage + reason
            if rid in (d.get("reason_codes") or []):
                pass
        # Use native apply by checking deterministic match + reason
    from native_router_v1 import apply_deterministic_rules

    for spec in RULE_SPECS:
        rid = spec["id"]
        tp = fp = fn = 0
        triggers = 0
        routes: dict[str, int] = defaultdict(int)
        for r, d in zip(six, serving):
            det_one = apply_deterministic_rules(r["input"])
            ids = [x["id"] for x in det_one.get("rules_fired") or []]
            chosen = (det_one.get("rules_fired") or [{}])[0].get("id") if det_one.get("high_confidence") else None
            gold = r["gold_route"]
            if rid in ids:
                triggers += 1
                routes[det_one["predicted_class"]] += 1
                if chosen == rid:
                    if det_one["predicted_class"] == gold:
                        tp += 1
                    else:
                        fp += 1
            elif spec["then"] == gold and chosen is None:
                fn += 1
        prec = tp / (tp + fp) if (tp + fp) else None
        rule_stats[rid] = {
            "fresh_triggers": triggers,
            "precision_when_chosen_first": prec,
            "true_positive_chosen": tp,
            "false_positive_chosen": fp,
            "false_negative_untriggered_gold": fn,
            "route_distribution": dict(routes),
            "then": spec["then"],
        }

    n_det_solved = sum(int(d["decision_stage"].startswith("deterministic") and d["predicted_class"] == r["gold_route"]) for r, d in zip(six, serving))
    n_lex_fb = sum(int((not d["decision_stage"].startswith("deterministic")) and d["predicted_class"] == r["gold_route"]) for r, d in zip(six, serving))
    n_abstain = sum(int(d["abstain_state"] not in CONFIDENT_ABSTAIN) for d in serving)
    n_fail_without_rules = sum(int(serving[i]["predicted_class"] == six[i]["gold_route"] and lex[i]["predicted_class"] != six[i]["gold_route"]) for i in range(len(six)))

    # Registry growth on serving candidate (no WRIM)
    growth = {}
    for label, ncard in (("6", 6), ("10", 10), ("20", 20), ("all", len(cards))):
        if label == "all":
            rcards = cards
        elif ncard <= len(cards) and label == "6":
            keep = {"web", "memory", "files", "research", "sha256"}
            rcards = [c for c in cards if c["tool_id"] in keep]
            # pad with one extra existing card to reach 6 physical cards
            extra = [c for c in cards if c["tool_id"] not in keep]
            rcards = rcards + extra[: max(0, 6 - len(rcards))]
        else:
            rcards = distractor_cards(cards, ncard)
        rr = NativeRouterV1(cards=rcards, bow=bow, margin_threshold=0.12)
        dec = score_many(rr, texts6, "full", None)
        pred = [d["predicted_class"] for d in dec]
        gold = [r["gold_route"] for r in six]
        stable = sum(int(pred[i] == serving[i]["predicted_class"]) for i in range(len(six))) / len(six)
        growth[label] = {
            "n_cards": len(rcards),
            "top1_accuracy": pack_names(gold, pred)["accuracy"],
            "balanced_accuracy": pack_names(gold, pred)["balanced_accuracy"],
            "route_stability_vs_8card_serving": stable,
            "invented_production_tools": False,
        }

    misses = []
    taxonomy: dict[str, int] = defaultdict(int)
    remediations = []
    for r, d in zip(six, serving):
        ok = d["predicted_class"] == r["gold_route"]
        if not ok:
            cat = classify_failure(r, d)
            taxonomy[cat] += 1
            remediations.append(
                {
                    "id": r["request_id"],
                    "category": cat,
                    "gold": r["gold_route"],
                    "pred": d["predicted_class"],
                    "stage": d["decision_stage"],
                    "note": "POST_TEST_REMEDIATION_CANDIDATE — not applied",
                }
            )
        misses.append(ok)

    # Predictions jsonl
    pred_lines = []
    comp_lines = []
    for r, d, dw in zip(six, serving, wrim_only):
        pred_lines.append(
            {
                "request_id": r["request_id"],
                "provenance": r["provenance"],
                "context_hash": r["context_hash"],
                "registry_snapshot_hash": man["registry_snapshot_hash"],
                "gold_route": r["gold_route"],
                "gold_information_state": r["gold_information_state"],
                "router_route": d["predicted_class"],
                "router_information_state": d["information_state"],
                "gate_state": d["gate"],
                "deterministic_rule_match": next((c for c in d["reason_codes"] if str(c).startswith("R0")), None),
                "deterministic_prediction": d["components"]["deterministic"],
                "lexical_prediction": d["components"]["lexical"],
                "lexical_confidence": d["components"]["lexical_confidence"],
                "wrim_telemetry_prediction": dw["predicted_class"],
                "wrim_confidence": dw["components"]["wrim_confidence"],
                "registry_schema_result": d.get("schema"),
                "final_route": d["predicted_class"],
                "top1_confidence": d["confidence"],
                "top1_top2_margin": d["margin"],
                "abstention_state": d["abstain_state"],
                "component_disagreement": d["disagreement"],
                "latency_ms_serving_no_wrim": d["latency_ms"],
                "correct": d["predicted_class"] == r["gold_route"],
            }
        )
        comp_lines.append(
            {
                "request_id": r["request_id"],
                "deterministic": d["components"]["deterministic"],
                "lexical": d["components"]["lexical"],
                "wrim": dw["predicted_class"],
                "serving": d["predicted_class"],
                "hybrid_with_wrim": hybrid[len(comp_lines)]["predicted_class"] if False else None,
            }
        )
    for i, line in enumerate(comp_lines):
        line["hybrid_with_wrim"] = hybrid[i]["predicted_class"]
    dump_jsonl(work / "router-predictions.jsonl", pred_lines)
    dump_jsonl(work / "component-predictions.jsonl", comp_lines)

    def stage_report(n: int) -> dict[str, Any] | None:
        if len(six) < n and n not in {200, 500} and n > len(six):
            if n == 1000 and len(six) < 1000:
                sub = six
                dec = serving
                used = len(six)
            else:
                return None
        else:
            sub = balanced_prefix(six, n) if n <= len(six) else six
            idset = {r["request_id"] for r in sub}
            dec = [serving[i] for i, r in enumerate(six) if r["request_id"] in idset]
            # preserve sub order
            byid = {six[i]["request_id"]: serving[i] for i in range(len(six))}
            dec = [byid[r["request_id"]] for r in sub]
            used = len(sub)
        bun = six_metrics(sub, dec)
        ge = gate_eval(bun, unk_acc)
        if n <= 200:
            verdict = "CONTINUE" if bun["report"]["balanced_accuracy"] >= 0.80 else "STOP_GENERALIZATION_TEST"
        else:
            verdict = "PASS_GATES" if ge["all_pass"] else "FAIL_GATES"
            if n == 500 and bun["report"]["balanced_accuracy"] < 0.80:
                verdict = "STOP_GENERALIZATION_TEST"
        return {
            "n_requested": n,
            "n_used": used,
            "metrics": bun,
            "gates": ge,
            "verdict": verdict if n != 200 else ("CONTINUE" if bun["report"]["balanced_accuracy"] >= 0.80 else "STOP_GENERALIZATION_TEST"),
        }

    st200 = stage_report(200)
    st500 = stage_report(500) if len(six) >= 500 else None
    st1000 = None
    if len(six) >= 1000:
        st1000 = stage_report(1000)
    elif len(six) > 500:
        st1000 = {
            "n_requested": 1000,
            "n_used": len(six),
            "note": "High-confidence 1000 not reached; full corpus scored instead.",
            "metrics": b_serve,
            "gates": gate_eval(b_serve, unk_acc),
            "verdict": "NOT_REACHED_1000",
        }

    gates_full = gate_eval(b_serve, unk_acc)
    source_after = {name: sha256_file(path) for name, path in SOURCE_FILES.items() if path.is_file()}
    rules_unchanged = sha256_json(RULE_SPECS) == man["rule_hash"]
    lexical_unchanged = sha256_file(frozen / "lexical-bow.npz") == man["lexical_model_hash"]
    thresholds_unchanged = router.margin_threshold == 0.12
    integrity_ok = (
        source_after.get("native_router_v1.py") == router_hash_before
        and wrim_after == wrim_before == WRIM0_CHECKPOINT_SHA256
        and rules_unchanged
        and lexical_unchanged
        and thresholds_unchanged
        and peak == 0.0
        and tree_after == tree_before == EXPECTED_CORE_TREE_SHA256
    )

    write_json(work / "rule-performance.json", rule_stats)
    write_json(
        work / "generalization-metrics.json",
        {
            "serving_candidate": b_serve,
            "deterministic_only": b_det,
            "lexical_only": b_lex,
            "det_lexical": b_dl,
            "wrim_telemetry_only": b_wrim,
            "serving_plus_wrim_hypothetical": b_hyb,
            "n_six_way": len(six),
        },
    )
    write_json(
        work / "semantic-subsets.json",
        {
            "matched_pair": b_serve["pair"],
            "natural_paraphrase": b_serve["natural_paraphrase"],
            "multi_turn": b_serve["multi_turn"],
            "information_state": b_serve["information_state_label"],
            "lexical_adversarial": b_serve["lexical_adversarial"],
            "no_tool_trap": b_serve["no_tool_trap"],
            "web_vs_research": b_serve["web_vs_research"],
            "memory_vs_files": b_serve["memory_vs_files"],
            "memory_vs_no_tool": b_serve["current_vs_memory"],
            "sha256_vs_no_tool": b_serve["sha256_vs_no_tool"],
            "registry_distractor": b_serve["registry_distractor"],
        },
    )
    write_json(
        work / "abstention-analysis.json",
        {
            "abstention_rate": b_serve["abstention_rate"],
            "coverage": b_serve["coverage"],
            "wrong_confident_rate": b_serve["wrong_confident_rate"],
            "false_abstention_rate": b_serve["false_abstention_rate"],
            "abstention_precision": b_serve["abstention_precision"],
            "confidence_correct_mean": b_serve["confidence_correct_mean"],
            "confidence_incorrect_mean": b_serve["confidence_incorrect_mean"],
            "margin_correct_mean": b_serve["margin_correct_mean"],
            "margin_incorrect_mean": b_serve["margin_incorrect_mean"],
            "coverage_accuracy_curve": b_serve["coverage_accuracy_curve"],
            "ambiguous_lane": {"n": len(amb), "abstain_or_insufficient": amb_ok, "accuracy": amb_ok / len(amb) if amb else None},
        },
    )
    write_json(work / "registry-growth-test.json", {"unique_existing_tools": len(cards), "results": growth, "shadow_only": True})
    write_json(
        work / "unknown-capability-test.json",
        {
            "n": len(unk),
            "no_compatible_tool_accuracy": unk_acc,
            "confident_supported_tool_hallucinations": unk_confident_hallucinate,
        },
    )
    write_json(work / "multi-tool-diagnostic.json", mt_report)
    write_json(work / "stage-200-report.json", st200)
    if st500:
        write_json(work / "stage-500-report.json", st500)
    if st1000:
        write_json(work / "stage-1000-report.json", st1000)
    write_json(
        work / "failure-taxonomy.json",
        {
            "counts": dict(taxonomy),
            "largest": max(taxonomy, key=taxonomy.get) if taxonomy else None,
            "POST_TEST_REMEDIATION_CANDIDATE": remediations[:200],
            "n_remediation_candidates": len(remediations),
            "applied": False,
        },
    )
    write_json(
        work / "immutability-proof.json",
        {
            "router_source_hash_before": router_hash_before,
            "router_source_hash_after": source_after.get("native_router_v1.py"),
            "rules_unchanged": rules_unchanged,
            "lexical_model_unchanged": lexical_unchanged,
            "thresholds_unchanged": thresholds_unchanged,
            "confidence_policy_hash": man["confidence_policy_hash"],
            "registry_binding_hash": man["registry_binding_hash"],
            "wrim_hash_before": wrim_before,
            "wrim_hash_after": wrim_after,
            "wrim_expected": WRIM0_CHECKPOINT_SHA256,
            "core_tree_before": tree_before,
            "core_tree_after": tree_after,
            "max_abs_diff": peak,
            "model_training_performed": False,
            "lora_training_performed": False,
            "exp006_started": False,
            "red_x_2_performed": False,
            "integrity_ok": integrity_ok,
            "frozen_baseline_artifact_hash": man["artifact_hash"],
            "production_touched": False,
            "production_root": str(PRODUCTION_ROOT),
        },
    )
    precisions = {k: v["precision_when_chosen_first"] for k, v in rule_stats.items() if v["precision_when_chosen_first"] is not None}
    lowest_rule = min(precisions, key=precisions.get) if precisions else None
    highest_rule = max(precisions, key=precisions.get) if precisions else None
    ready = bool(gates_full["all_pass"] and integrity_ok)
    write_json(
        work / "promotion-review-readiness.json",
        {
            "ready_for_controlled_candidate_promotion_review": ready,
            "not_production_deployment": True,
            "multi_tool_ready": False,
            "planner_ready": False,
            "gates": gates_full,
            "lifecycle_remains": "SHADOW",
            "proposed_transition": "SHADOW → CANDIDATE" if ready else None,
            "requires_separate_commander_authorization": True,
        },
    )
    write_json(
        work / "return-card.json",
        {
            "frozen_baseline_artifact_id": NATIVE_ROUTER_V1_FROZEN_GEN_ID,
            "baseline_hash": man["artifact_hash"],
            "deterministic_rule_hash": man["rule_hash"],
            "lexical_model_hash": man["lexical_model_hash"],
            "confidence_policy_hash": man["confidence_policy_hash"],
            "registry_binding_hash": man["registry_binding_hash"],
            "n_fresh_adjudicated": len(corpus),
            "counts": {
                "REAL_RUNTIME_FRESH": sum(1 for r in corpus if r["provenance"] == "REAL_RUNTIME_FRESH"),
                "REAL_TEST_FRESH": sum(1 for r in corpus if r["provenance"] == "REAL_TEST_FRESH"),
                "HUMAN_ADJUDICATED_FRESH": sum(1 for r in corpus if r["provenance"] == "HUMAN_ADJUDICATED_FRESH"),
                "ADV_TEST_FRESH": sum(1 for r in corpus if r["provenance"] == "ADV_TEST_FRESH"),
                "six_way": len(six),
                "ambiguous": len(amb),
                "unknown": len(unk),
                "multi_tool": len(multi),
                **{c: sum(1 for r in six if r["gold_route"] == c) for c in CLASS_NAMES},
            },
            "serving": {
                "accuracy": b_serve["report"]["accuracy"],
                "balanced_accuracy": b_serve["report"]["balanced_accuracy"],
                "macro_f1": b_serve["report"]["macro_f1"],
                "recalls": b_serve["recalls"],
                "tool_vs_no_tool": b_serve["report"]["tool_vs_no_tool_accuracy"],
                "conditional_tool_id": b_serve["report"]["conditional_tool_id_accuracy"],
            },
            "ablations_balanced": {
                "deterministic_only": b_det["report"]["balanced_accuracy"],
                "lexical_only": b_lex["report"]["balanced_accuracy"],
                "det_lexical": b_dl["report"]["balanced_accuracy"],
                "serving_candidate": b_serve["report"]["balanced_accuracy"],
                "wrim_telemetry": b_wrim["report"]["balanced_accuracy"],
                "serving_plus_wrim": b_hyb["report"]["balanced_accuracy"],
            },
            "rule_dependence": {
                "pct_solved_by_deterministic": n_det_solved / len(six),
                "pct_requiring_lexical_fallback": n_lex_fb / len(six),
                "pct_abstain": n_abstain / len(six),
                "pct_would_fail_without_rules": n_fail_without_rules / len(six),
            },
            "stage_200_verdict": st200["verdict"] if st200 else None,
            "stage_500_verdict": st500["verdict"] if st500 else None,
            "stage_1000_verdict": st1000["verdict"] if st1000 else None,
            "n_post_test_remediation": len(remediations),
            "largest_failure_category": max(taxonomy, key=taxonomy.get) if taxonomy else None,
            "lowest_rule_precision": lowest_rule,
            "highest_rule_precision": highest_rule,
            "integrity_ok": integrity_ok,
            "gates_all_pass": gates_full["all_pass"],
            "wrim_extract_seconds": wrim_extract_s,
            "created_at": utcnow(),
            "candidate_identity": NATIVE_ROUTER_V1_ID,
        },
    )
    print(json.dumps({"six": len(six), "bal": b_serve["report"]["balanced_accuracy"], "gates": gates_full["all_pass"], "integrity": integrity_ok}, indent=2))
    return 0 if integrity_ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
