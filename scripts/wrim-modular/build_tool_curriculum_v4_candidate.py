#!/usr/bin/env python3
"""Materialize WR-TOOL-CURRICULUM-V4-CANDIDATE.

Dataset construction only. No Experiment 004. No LoRA. No production.
Does not overwrite V3, EVAL-2, EVAL-3, or prior trajectory ledgers.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from paths import (
    PRODUCTION_ROOT,
    ROOT,
    TOOL_EVAL_2_ITEMS,
    TOOL_EVAL_2_SUITE,
    TOOL_EVAL_3_DIR,
    TRAJECTORY_POOL_DIR,
    V3_CURRICULUM_DIR,
    V3_EXAMPLES_JSONL,
    V4_CANDIDATE_DIR,
    V4_CANDIDATE_ID,
    WRIM0_CHECKPOINT_SHA256,
    WRIM0_ID,
    WRIM0_WEIGHTS,
)

sys.path.insert(0, str(ROOT / "scripts" / "wrim1-training"))
from hashes import sha256_file, sha256_json  # noqa: E402

SEED = 20260831
HISTORICAL_8 = (
    "NO_TOOL",
    "SHA256",
    "LOOKUP_NOTE",
    "ECHO_INT",
    "WEB",
    "MEMORY",
    "FILES",
    "RESEARCH",
)
# OPTION B — operator-facing 5 + SHA256 bounded utility
V4_CLASSES = ("NO_TOOL", "WEB", "MEMORY", "FILES", "RESEARCH", "SHA256")
TEST_ONLY_CLASSES = ("LOOKUP_NOTE", "ECHO_INT")
REALISH = {"REAL_RUNTIME", "REAL_TEST"}
JWT_RE = re.compile(r"eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}")

LEDGER_CLASS_DIV = ROOT / "model-lab/manifests/wr_tool_trajectories/REAL-RUNTIME-CLASS-DIVERSITY-V1"
LEDGER_MEMORY = ROOT / "model-lab/manifests/wr_tool_trajectories/REAL-RUNTIME-MEMORY-V1"
LEDGER_OBSERVER = ROOT / "model-lab/manifests/wr_tool_trajectories/REAL-RUNTIME-OBSERVER-DEV-V1"


def sha_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def norm_text(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def quality_map(path: Path) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for rec in load_jsonl(path):
        tid = rec.get("trajectory_id")
        if tid:
            out[str(tid)] = rec
    return out


def semantic_class(decision: str | None, tool_id: str | None) -> str:
    if decision == "NO_TOOL" or not tool_id:
        return "NO_TOOL"
    return str(tool_id).upper()


def compact_args(arguments: dict[str, Any] | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in (arguments or {}).items():
        if v is None:
            continue
        out[str(k)] = str(v)
    return out


def arg_labels_present(cls: str, arguments: dict[str, str]) -> bool:
    need = {
        "WEB": ["query"],
        "MEMORY": ["query"],
        "FILES": ["path"],
        "RESEARCH": ["query"],
        "SHA256": ["text"],
        "NO_TOOL": [],
    }.get(cls, [])
    return all(k in arguments and str(arguments[k]).strip() for k in need)


def dump_inventory_row(row: dict[str, Any]) -> dict[str, Any]:
    """Phase A fields; omit giant tool_result."""
    return {
        "source_artifact": row["source_artifact"],
        "source_type": row["source_type"],
        "review_state": row.get("review_state"),
        "quality_status": row.get("quality_status"),
        "tool_class": row.get("tool_class"),
        "semantic_family": row.get("family_id"),
        "request_text": row.get("request_text"),
        "argument_labels": sorted((row.get("arguments") or {}).keys()),
        "result_status": row.get("result_status"),
        "context_dependence": row.get("context_dependence"),
        "duplicate_id_exact": row.get("exact_hash"),
        "duplicate_id_normalized": row.get("norm_hash"),
        "eval_exclusion_status": row.get("eval_exclusion"),
        "training_exclusion_status": row.get("exclude_reason") or "pending",
        "trajectory_id": row.get("trajectory_id"),
        "role": row.get("role"),
    }


def from_runtime_raw(
    rec: dict[str, Any],
    artifact: str,
    qmap: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    tid = rec.get("trajectory_id") or ""
    q = qmap.get(tid, {})
    tool = rec.get("selected_tool")
    decision = rec.get("decision")
    cls = semantic_class(decision, tool)
    prov = rec.get("provenance") if isinstance(rec.get("provenance"), dict) else {}
    family = prov.get("family_id") or rec.get("family_id") or f"fam.runtime.{cls.lower()}.{tid[-8:]}"
    args = compact_args(rec.get("arguments") if isinstance(rec.get("arguments"), dict) else {})
    req = str(rec.get("request") or rec.get("request_text") or "")
    tr = rec.get("tool_result") if isinstance(rec.get("tool_result"), dict) else {}
    status_code = tr.get("statusCode")
    exec_outcome = None
    if status_code == 401:
        exec_outcome = "TAVILY_401"
    if tr.get("intendedFailure") or rec.get("provenance", {}).get("intended_failure") == "true":
        exec_outcome = "NO_MATCH"
    if rec.get("router_validation_status") == "INVALID_TOOL":
        exec_outcome = "INVALID_TOOL"
    if rec.get("router_validation_status") == "MISSING_ARGUMENT":
        exec_outcome = "MISSING_ARGUMENT"
    return {
        "trajectory_id": tid,
        "source_artifact": artifact,
        "source_type": rec.get("source_type") or "other",
        "review_state": rec.get("review_state"),
        "quality_status": q.get("quality_label") or "UNKNOWN",
        "usable_supervised_gold": bool(q.get("usable_supervised_gold")),
        "tool_class": cls,
        "decision": decision,
        "tool_id": tool,
        "family_id": family,
        "request_text": req,
        "arguments": args,
        "result_status": rec.get("tool_result_status") or rec.get("result_status"),
        "context_dependence": rec.get("context_dependence") or "UNKNOWN",
        "boundary_pair": prov.get("boundary_pair") or "",
        "exact_hash": sha_text(req),
        "norm_hash": sha_text(norm_text(req)),
        "eval_exclusion": False,
        "execution_outcome": exec_outcome,
        "real_wording": "TOOL=" not in req[:8],
        "router_validation_status": rec.get("router_validation_status"),
    }


def from_pool(rec: dict[str, Any]) -> dict[str, Any]:
    req = str(rec.get("request_text") or rec.get("user_or_test_request") or "")
    cls = rec.get("semantic_class") or semantic_class(rec.get("decision"), rec.get("tool_id"))
    args = compact_args(rec.get("arguments") or rec.get("gold_arguments"))
    return {
        "trajectory_id": rec.get("trajectory_id"),
        "source_artifact": "WR-TOOL-REAL-TRAJECTORY-POOL-V1",
        "source_type": rec.get("source_type") or "other",
        "review_state": rec.get("review_state"),
        "quality_status": rec.get("quality_label") or "UNKNOWN",
        "usable_supervised_gold": rec.get("quality_label") in ("VERIFIED", "SUPPORTED")
        and rec.get("source_type") != "REPLAY",
        "tool_class": cls,
        "decision": rec.get("decision") or rec.get("tool_decision"),
        "tool_id": rec.get("tool_id") or rec.get("gold_tool_id"),
        "family_id": rec.get("family_id"),
        "request_text": req,
        "arguments": args,
        "result_status": rec.get("result_status") or rec.get("tool_result_status"),
        "context_dependence": rec.get("context_dependence") or "UNKNOWN",
        "boundary_pair": "",
        "exact_hash": sha_text(req),
        "norm_hash": sha_text(norm_text(req)),
        "eval_exclusion": bool(rec.get("EXCLUDE_FROM_TRAINING")),
        "execution_outcome": None,
        "real_wording": bool(rec.get("real_wording")),
        "pool_safe_for_training": bool(rec.get("safe_for_training")),
        "router_validation_status": None,
    }


def leak_against(rows: list[dict[str, Any]], eval_texts: list[str], eval_norms: set[str], eval_fams: set[str]) -> dict[str, Any]:
    exact = []
    normalized = []
    family = []
    eval_exact = {t for t in eval_texts}
    for r in rows:
        req = r["request_text"]
        if req in eval_exact:
            exact.append({"id": r["trajectory_id"], "text": req[:80]})
        if r["norm_hash"] in eval_norms or norm_text(req) in {norm_text(t) for t in eval_texts}:
            if req not in eval_exact:
                normalized.append({"id": r["trajectory_id"], "norm": r["norm_hash"][:12]})
            elif {"id": r["trajectory_id"]} not in [{"id": x["id"]} for x in exact]:
                pass
        if r.get("family_id") in eval_fams:
            family.append({"id": r["trajectory_id"], "family_id": r["family_id"]})
    # exact via hash
    eval_exact_hashes = {sha_text(t) for t in eval_texts}
    exact = [r for r in rows if r["exact_hash"] in eval_exact_hashes]
    eval_norm_hashes = {sha_text(norm_text(t)) for t in eval_texts}
    normalized = [r for r in rows if r["norm_hash"] in eval_norm_hashes]
    family = [r for r in rows if r.get("family_id") in eval_fams]
    return {
        "exact_n": len(exact),
        "normalized_n": len(normalized),
        "family_n": len(family),
        "exact_ids": [r["trajectory_id"] for r in exact],
        "normalized_ids": [r["trajectory_id"] for r in normalized],
        "family_ids": sorted({r["family_id"] for r in family}),
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
    if re.search(r"path\s*=|docs/|lib/|scripts/", p):
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


def accuracy(y_true: list[str], y_pred: list[str]) -> float:
    if not y_true:
        return 0.0
    return sum(a == b for a, b in zip(y_true, y_pred)) / len(y_true)


def bow_logreg(train: list[dict[str, Any]], test: list[dict[str, Any]], classes: tuple[str, ...]) -> dict[str, Any] | None:
    try:
        import numpy as np
    except Exception:
        return None
    vocab: dict[str, int] = {}

    def toks(s: str) -> list[str]:
        return re.findall(r"[a-z0-9_]+", s.casefold())

    for r in train:
        for t in toks(r["request_text"]):
            if t not in vocab and len(vocab) < 2000:
                vocab[t] = len(vocab)
    if not vocab or not train or not test:
        return None
    idx = {c: i for i, c in enumerate(classes)}
    n_c = len(classes)

    def mat(rows: list[dict[str, Any]]) -> tuple[Any, Any]:
        x = np.zeros((len(rows), len(vocab)), dtype=np.float64)
        y = np.zeros(len(rows), dtype=np.int64)
        for i, r in enumerate(rows):
            y[i] = idx[r["tool_class"]]
            for t in toks(r["request_text"]):
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
    xte, yte = mat(test)
    logits = xte @ w.T
    pred = logits.argmax(axis=1)
    return {
        "model": "numpy_one_vs_rest_linear",
        "accuracy": float((pred == yte).mean()) if len(yte) else 0.0,
        "n_test": int(len(yte)),
        "vocab": len(vocab),
    }


def family_split(rows: list[dict[str, Any]]) -> dict[str, str]:
    """Assign each family to one split. Deterministic. No family spans splits."""
    by_class: dict[str, list[str]] = defaultdict(list)
    for r in rows:
        fid = r["family_id"]
        if fid not in by_class[r["tool_class"]]:
            by_class[r["tool_class"]].append(fid)
    assign: dict[str, str] = {}
    for cls in V4_CLASSES:
        fams = sorted(by_class.get(cls, []))
        n = len(fams)
        if n == 0:
            continue
        if n == 1:
            assign[fams[0]] = "train"
        elif n == 2:
            assign[fams[0]] = "train"
            assign[fams[1]] = "validation"
        else:
            # ~70/15/15 by family index
            for i, fid in enumerate(fams):
                r = i / n
                if r < 0.70:
                    assign[fid] = "train"
                elif r < 0.85:
                    assign[fid] = "validation"
                else:
                    assign[fid] = "test"
            if "validation" not in assign.values():
                assign[fams[-1]] = "validation"
            if n >= 4 and "test" not in {assign[f] for f in fams}:
                assign[fams[-1]] = "test"
    return assign


def decide_eligibility(row: dict[str, Any], eval3_fams: set[str], eval3_exact: set[str], eval3_norm: set[str]) -> tuple[bool, str, str]:
    """Return (include_routing_gold, role, exclude_reason)."""
    cls = row["tool_class"]
    if cls in TEST_ONLY_CLASSES:
        return False, "catalog_only", "test_only_class"
    if cls not in V4_CLASSES:
        if row.get("execution_outcome") == "INVALID_TOOL":
            return False, "routing_failure", "invalid_tool_not_v4_class"
        return False, "out_of_space", f"class_{cls}"
    if row["source_type"] == "REPLAY":
        return False, "inventory_only", "replay_not_independent"
    if JWT_RE.search(row["request_text"] or "") or "Bearer " in (row["request_text"] or ""):
        return False, "rejected", "secret_like_request"
    req = row["request_text"]
    if sha_text(req) in eval3_exact or row["norm_hash"] in eval3_norm or row["family_id"] in eval3_fams:
        return False, "eval_holdout", "eval3_leak"
    # latency probe / compact dialect inflation
    if req.startswith("TOOL=none\nlatency-probe"):
        return False, "inventory_only", "latency_probe_template"
    if req.startswith("TOOL=") and cls == "NO_TOOL" and req in ("TOOL=none",):
        return False, "inventory_only", "compact_dialect_low_realism"
    if cls == "SHA256" and req.startswith("TOOL=sha256"):
        # keep at most via later cap; mark template family
        row["template_family"] = "compact_sha256"
    if row.get("execution_outcome") == "TAVILY_401":
        return True, "execution_failure", ""
    if row.get("execution_outcome") == "NO_MATCH":
        return True, "no_match", ""
    if row.get("execution_outcome") == "MISSING_ARGUMENT":
        return True, "routing_failure", ""
    if row.get("execution_outcome") == "INVALID_TOOL":
        return True, "routing_failure", ""
    if row["quality_status"] not in ("VERIFIED", "SUPPORTED"):
        return False, "inventory_only", f"quality_{row['quality_status']}"
    if row["source_type"] == "SYNTHETIC":
        return False, "inventory_only", "synthetic_not_used_for_v4_gold"
    if row["source_type"] == "GYM_FIXTURE":
        # dry-run WEB/MEMORY/RESEARCH not live retrieve
        return False, "inventory_only", "gym_dry_run_not_live"
    if row["source_type"] not in REALISH:
        return False, "inventory_only", f"source_{row['source_type']}"
    if row["decision"] == "TOOL" and not arg_labels_present(cls, row.get("arguments") or {}):
        if cls != "NO_TOOL":
            return False, "inventory_only", "missing_required_arguments"
    if not row.get("result_status"):
        return False, "inventory_only", "missing_result_status"
    return True, "routing_gold", ""


def materialize() -> dict[str, Any]:
    if PRODUCTION_ROOT.exists() and str(PRODUCTION_ROOT) in str(Path(__file__).resolve()):
        raise SystemExit("refusing production tree")

    eval2_items = load_jsonl(TOOL_EVAL_2_ITEMS)
    eval2_suite = json.loads(TOOL_EVAL_2_SUITE.read_text(encoding="utf-8"))
    eval3 = json.loads((TOOL_EVAL_3_DIR / "suite.json").read_text(encoding="utf-8"))
    eval2_texts = [str(i.get("prompt") or i.get("generation_prompt") or "") for i in eval2_items]
    eval2_texts += [str(i.get("prompt") or "") for i in eval2_suite.get("items", [])]
    eval2_fams = {str(i.get("family_id") or "") for i in eval2_items} | {
        str(i.get("family_id") or "") for i in eval2_suite.get("items", [])
    }
    eval2_fams.discard("")
    eval3_texts = [str(i.get("input") or "") for i in eval3.get("items", [])]
    eval3_fams = {str(i.get("family_id") or "") for i in eval3.get("items", [])}
    eval3_fams.discard("")
    eval3_exact = {sha_text(t) for t in eval3_texts}
    eval3_norm = {sha_text(norm_text(t)) for t in eval3_texts}
    eval2_exact = {sha_text(t) for t in eval2_texts if t}
    eval2_norm = {sha_text(norm_text(t)) for t in eval2_texts if t}

    q_div = quality_map(LEDGER_CLASS_DIV / "quality-results.jsonl")
    q_mem = quality_map(LEDGER_MEMORY / "quality-results.jsonl")
    q_obs: dict[str, dict[str, Any]] = {}
    qg_path = LEDGER_OBSERVER / "quality-gate.json"
    if qg_path.exists():
        qg = json.loads(qg_path.read_text(encoding="utf-8"))
        q_obs = {r["trajectory_id"]: r for r in qg.get("results", [])}

    inventory: list[dict[str, Any]] = []
    for rec in load_jsonl(LEDGER_CLASS_DIV / "raw-trajectories.jsonl"):
        inventory.append(from_runtime_raw(rec, "REAL-RUNTIME-CLASS-DIVERSITY-V1", q_div))
    for rec in load_jsonl(LEDGER_MEMORY / "raw-trajectories.jsonl"):
        inventory.append(from_runtime_raw(rec, "REAL-RUNTIME-MEMORY-V1", q_mem))
    for rec in load_jsonl(LEDGER_OBSERVER / "raw-trajectories.jsonl"):
        inventory.append(from_runtime_raw(rec, "REAL-RUNTIME-OBSERVER-DEV-V1", q_obs))
    for rec in load_jsonl(TRAJECTORY_POOL_DIR / "normalized-trajectories.jsonl"):
        inventory.append(from_pool(rec))

    v3_n = sum(1 for _ in V3_EXAMPLES_JSONL.read_text(encoding="utf-8").splitlines() if _.strip()) if V3_EXAMPLES_JSONL.exists() else 0

    # eligibility
    for row in inventory:
        ok, role, reason = decide_eligibility(row, eval3_fams, eval3_exact, eval3_norm)
        row["include"] = ok
        row["role"] = role
        row["exclude_reason"] = reason
        # EVAL-2 leak also blocks gold
        if ok and (row["exact_hash"] in eval2_exact or row["norm_hash"] in eval2_norm or row["family_id"] in eval2_fams):
            row["include"] = False
            row["role"] = "eval_holdout"
            row["exclude_reason"] = "eval2_leak"

    # exact/normalized duplicate control among included routing_gold
    gold_pool = [r for r in inventory if r["include"] and r["role"] == "routing_gold"]
    seen_exact: set[str] = set()
    seen_norm: set[str] = set()
    exact_removed = 0
    norm_removed = 0
    # prefer class-diversity > memory > observer > pool
    rank = {
        "REAL-RUNTIME-CLASS-DIVERSITY-V1": 0,
        "REAL-RUNTIME-MEMORY-V1": 1,
        "REAL-RUNTIME-OBSERVER-DEV-V1": 2,
        "WR-TOOL-REAL-TRAJECTORY-POOL-V1": 3,
    }
    gold_pool.sort(key=lambda r: (rank.get(r["source_artifact"], 9), r["trajectory_id"]))
    keep_ids: set[str] = set()
    for r in gold_pool:
        if r["exact_hash"] in seen_exact:
            r["include"] = False
            r["role"] = "duplicate"
            r["exclude_reason"] = "exact_duplicate"
            exact_removed += 1
            continue
        if r["norm_hash"] in seen_norm:
            r["include"] = False
            r["role"] = "duplicate"
            r["exclude_reason"] = "normalized_duplicate"
            norm_removed += 1
            continue
        seen_exact.add(r["exact_hash"])
        seen_norm.add(r["norm_hash"])
        keep_ids.add(r["trajectory_id"])

    # SHA256 cap: at most 3 routing_gold, prefer natural wording then first ids
    sha_rows = [
        r
        for r in inventory
        if r["include"] and r["role"] == "routing_gold" and r["tool_class"] == "SHA256"
    ]
    sha_rows.sort(key=lambda r: (0 if r.get("real_wording") else 1, r["trajectory_id"]))
    for extra in sha_rows[3:]:
        extra["include"] = False
        extra["role"] = "sha256_cap"
        extra["exclude_reason"] = "sha256_oversample_cap"

    # MEMORY: never clone; both gold rows stay; no synthetic
    mem_gold = [
        r
        for r in inventory
        if r["include"] and r["role"] == "routing_gold" and r["tool_class"] == "MEMORY"
    ]

    included = [r for r in inventory if r["include"]]
    routing = [r for r in included if r["role"] == "routing_gold"]
    failures = [r for r in included if r["role"] in ("execution_failure", "no_match", "routing_failure")]

    assign = family_split(routing)
    for r in routing:
        r["split"] = assign.get(r["family_id"], "train")
    # failures follow their family if gold family exists, else train
    for r in failures:
        r["split"] = assign.get(r["family_id"], "train")

    train = [r for r in included if r["split"] == "train"]
    val = [r for r in included if r["split"] == "validation"]
    test = [r for r in included if r["split"] == "test"]

    def src_counts(rows: list[dict[str, Any]]) -> dict[str, int]:
        return dict(Counter(r["source_type"] for r in rows))

    routing_src = src_counts(routing)
    real_n = sum(routing_src.get(k, 0) for k in REALISH)
    row_real_pct = (100.0 * real_n / len(routing)) if routing else 0.0
    fam_real: dict[str, bool] = {}
    for r in routing:
        fam_real[r["family_id"]] = fam_real.get(r["family_id"], False) or r["source_type"] in REALISH
    fam_real_pct = (100.0 * sum(1 for v in fam_real.values() if v) / len(fam_real)) if fam_real else 0.0

    class_counts = dict(Counter(r["tool_class"] for r in routing))
    mem_fams = sorted({r["family_id"] for r in mem_gold})

    # argument coverage
    arg_cov = {}
    for c in V4_CLASSES:
        rs = [r for r in routing if r["tool_class"] == c]
        labeled = sum(1 for r in rs if arg_labels_present(c, r.get("arguments") or {}))
        arg_cov[c] = {"n": len(rs), "with_required_args": labeled, "coverage": (labeled / len(rs) if rs else None)}

    # baselines on routing only, family-safe val
    y_val = [r["tool_class"] for r in val if r["role"] == "routing_gold"]
    y_test = [r["tool_class"] for r in test if r["role"] == "routing_gold"]
    train_r = [r for r in train if r["role"] == "routing_gold"]
    maj = Counter(r["tool_class"] for r in train_r).most_common(1)
    maj_cls = maj[0][0] if maj else "NO_TOOL"
    majority_acc = accuracy(y_val, [maj_cls] * len(y_val)) if y_val else 0.0
    random_acc = 1.0 / len(V4_CLASSES)
    keyword_acc = accuracy(y_val, [keyword_predict(r["request_text"]) for r in val if r["role"] == "routing_gold"]) if y_val else 0.0
    schema_acc = accuracy(y_val, [schema_predict(r["request_text"]) for r in val if r["role"] == "routing_gold"]) if y_val else 0.0
    bow = bow_logreg(train_r, [r for r in val if r["role"] == "routing_gold"], V4_CLASSES)

    # family overlap across splits
    split_fams = {
        "train": {r["family_id"] for r in train},
        "validation": {r["family_id"] for r in val},
        "test": {r["family_id"] for r in test},
    }
    fam_overlap = {
        "train_val": sorted(split_fams["train"] & split_fams["validation"]),
        "train_test": sorted(split_fams["train"] & split_fams["test"]),
        "val_test": sorted(split_fams["validation"] & split_fams["test"]),
    }

    leak_e2 = leak_against(included, eval2_texts, eval2_norm, eval2_fams)
    leak_e3 = leak_against(included, eval3_texts, eval3_norm, eval3_fams)

    boundaries = Counter(r.get("boundary_pair") or "" for r in routing if r.get("boundary_pair"))
    provider_fail = [
        {
            "trajectory_id": r["trajectory_id"],
            "class": r["tool_class"],
            "outcome": r.get("execution_outcome"),
            "routing_target": r["tool_class"],
        }
        for r in failures
    ]

    wrim_ok = WRIM0_WEIGHTS.exists() and sha256_file(WRIM0_WEIGHTS) == WRIM0_CHECKPOINT_SHA256

    V4_CANDIDATE_DIR.mkdir(parents=True, exist_ok=True)

    def write_shard(name: str, rows: list[dict[str, Any]]) -> str:
        path = V4_CANDIDATE_DIR / name
        slim = []
        for r in rows:
            slim.append(
                {
                    "example_id": r["trajectory_id"],
                    "input": r["request_text"],
                    "semantic_class": r["tool_class"],
                    "gold": {
                        "decision": r["decision"],
                        "tool_id": None if r["tool_class"] == "NO_TOOL" else (r["tool_id"] or r["tool_class"].lower()),
                        "arguments": r.get("arguments") or {},
                    },
                    "role": r["role"],
                    "split": r["split"],
                    "source_type": r["source_type"],
                    "source_artifact": r["source_artifact"],
                    "family_id": r["family_id"],
                    "quality_status": r["quality_status"],
                    "context_dependence": r["context_dependence"],
                    "execution_outcome": r.get("execution_outcome"),
                    "EXCLUDE_FROM_EVAL_2": True,
                    "EXCLUDE_FROM_EVAL_3": True,
                    "argument_task": False,
                }
            )
        slim.sort(key=lambda x: x["example_id"])
        path.write_text("".join(json.dumps(x, sort_keys=True, ensure_ascii=True) + "\n" for x in slim), encoding="utf-8")
        return sha256_file(path)

    all_included_sorted = sorted(included, key=lambda r: r["trajectory_id"] or "")
    rows_hash = write_shard("rows.jsonl", all_included_sorted)
    train_hash = write_shard("train.jsonl", sorted(train, key=lambda r: r["trajectory_id"] or ""))
    val_hash = write_shard("validation.jsonl", sorted(val, key=lambda r: r["trajectory_id"] or ""))
    test_hash = write_shard("test.jsonl", sorted(test, key=lambda r: r["trajectory_id"] or ""))

    provenance = {
        "identity": V4_CANDIDATE_ID,
        "sources": [
            "WR-TOOL-REAL-TRAJECTORY-POOL-V1",
            "REAL-RUNTIME-OBSERVER-DEV-V1",
            "REAL-RUNTIME-CLASS-DIVERSITY-V1",
            "REAL-RUNTIME-MEMORY-V1",
        ],
        "held_out": ["WR-TOOL-EVAL-2", "WR-TOOL-EVAL-3"],
        "not_overwritten": [
            "WR-TOOL-CURRICULUM-V3",
            "WR-TOOL-EVAL-2",
            "WR-TOOL-EVAL-3",
            "WR-TOOL-REAL-TRAJECTORY-POOL-V1",
        ],
        "v3_examples_inspected_not_imported": v3_n,
        "class_space_option": "B",
        "v4_classes": list(V4_CLASSES),
        "test_only_excluded": list(TEST_ONLY_CLASSES),
    }
    (V4_CANDIDATE_DIR / "provenance.json").write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    prov_hash = sha256_file(V4_CANDIDATE_DIR / "provenance.json")

    family_map = defaultdict(list)
    for r in included:
        family_map[r["family_id"]].append(r["trajectory_id"])
    (V4_CANDIDATE_DIR / "family-map.json").write_text(
        json.dumps({k: sorted(v) for k, v in sorted(family_map.items())}, indent=2) + "\n",
        encoding="utf-8",
    )
    (V4_CANDIDATE_DIR / "class-map.json").write_text(
        json.dumps(
            {
                "option": "B",
                "historical_8": list(HISTORICAL_8),
                "v4_train_classes": list(V4_CLASSES),
                "excluded_from_train": list(TEST_ONLY_CLASSES),
                "counts_routing_gold": class_counts,
                "rationale": (
                    "LOOKUP_NOTE and ECHO_INT are curriculum_synthetic / not TOOL_REGISTRY operator tools. "
                    "SHA256 is a bounded WRIM utility with VERIFIED REAL_RUNTIME. "
                    "Operator-facing classroom is NO_TOOL/WEB/MEMORY/FILES/RESEARCH."
                ),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    duplicate_report = {
        "raw_inventory": len(inventory),
        "exact_removed": exact_removed,
        "normalized_removed": norm_removed,
        "sha256_capped": sum(1 for r in inventory if r.get("exclude_reason") == "sha256_oversample_cap"),
        "largest_family_share_routing": (
            max(Counter(r["family_id"] for r in routing).values()) / len(routing) if routing else 0
        ),
        "family_collisions_across_splits": fam_overlap,
    }
    (V4_CANDIDATE_DIR / "duplicate-audit.json").write_text(json.dumps(duplicate_report, indent=2) + "\n", encoding="utf-8")
    (V4_CANDIDATE_DIR / "leakage-audit.json").write_text(
        json.dumps({"EVAL-2": leak_e2, "EVAL-3": leak_e3}, indent=2) + "\n", encoding="utf-8"
    )
    (V4_CANDIDATE_DIR / "boundary-audit.json").write_text(
        json.dumps({"pairs_in_routing_gold": dict(boundaries), "provider_failures": provider_fail}, indent=2)
        + "\n",
        encoding="utf-8",
    )
    (V4_CANDIDATE_DIR / "quality-audit.json").write_text(
        json.dumps(
            {
                "inventory_quality": dict(Counter(r["quality_status"] for r in inventory)),
                "routing_gold_quality": dict(Counter(r["quality_status"] for r in routing)),
                "roles": dict(Counter(r["role"] for r in included)),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    inv_path = V4_CANDIDATE_DIR / "inventory.jsonl"
    inv_path.write_text(
        "".join(json.dumps(dump_inventory_row(r), sort_keys=True) + "\n" for r in sorted(inventory, key=lambda x: str(x.get("trajectory_id"))))
        + "",
        encoding="utf-8",
    )

    card = {
        "name": V4_CANDIDATE_ID,
        "version": "V4-CANDIDATE",
        "purpose": "Honest routing curriculum for future EXP-004 review. Not a trained model.",
        "scope": "Operator-facing tools plus SHA256. LOOKUP_NOTE/ECHO_INT excluded from train shards.",
        "class_space": list(V4_CLASSES),
        "source_artifacts": provenance["sources"],
        "source_type_counts_routing_gold": routing_src,
        "quality_counts_routing_gold": dict(Counter(r["quality_status"] for r in routing)),
        "row_level_real_test_pct": row_real_pct,
        "family_level_real_test_pct": fam_real_pct,
        "per_class_counts": class_counts,
        "MEMORY_caveat": (
            "VALID BUT NARROW: 2 SUPPORTED retrieves, 2 request families, 3 store rows / 2 unique texts, "
            "decree category only, overlapping hits. Not oversampled. No synthetic MEMORY clones."
        ),
        "known_weak_classes": ["MEMORY"],
        "known_provider_failures": ["TAVILY_401 on live web search; WEB gold is HTTPS fetch not Tavily"],
        "eval_exclusions": ["WR-TOOL-EVAL-2", "WR-TOOL-EVAL-3"],
        "privacy_controls": "No secrets; memory content omitted at capture; JWT/Bearer scan on requests.",
        "limitations": [
            "Small n",
            "MEMORY cannot fill all splits",
            "SHA256 capped to avoid observer restatements",
            "6-class head differs from EXP-003 8-class Linear(256→8)",
        ],
        "intended_Experiment_004_use": "Candidate only. Do not train until Commander authorizes after review.",
        "prohibited_interpretations": [
            "Do not treat 2 MEMORY gold as broad memory competence",
            "Do not treat Tavily 401 as wrong WEB routing",
            "Do not mix LOOKUP_NOTE/ECHO_INT into operator classroom",
        ],
    }
    (V4_CANDIDATE_DIR / "dataset-card.json").write_text(json.dumps(card, indent=2) + "\n", encoding="utf-8")

    baselines = {
        "split": "validation_routing_gold",
        "n_val_routing": len(y_val),
        "majority": {"class": maj_cls, "accuracy": majority_acc},
        "random": {"accuracy": random_acc, "n_classes": len(V4_CLASSES)},
        "keyword": {"accuracy": keyword_acc},
        "schema_rule": {"accuracy": schema_acc},
        "bow_logistic": bow,
        "test_routing_n": len(y_test),
    }
    (V4_CANDIDATE_DIR / "baselines.json").write_text(json.dumps(baselines, indent=2) + "\n", encoding="utf-8")

    exp004 = {
        "architecture_unchanged": {
            "frozen_WRIM-0": True,
            "lora_r": 2,
            "sites": "layers.0-17 attn.q and attn.v",
        },
        "compatibility": "DATASET/LOADER CHANGE REQUIRED",
        "head_was": "Linear(256→8) CLASS_NAMES 8-way EXP-003",
        "head_required_for_v4_option_b": "Linear(256→6) on V4_CLASSES order NO_TOOL,WEB,MEMORY,FILES,RESEARCH,SHA256",
        "output_dimension": 6,
        "lookup_note_echo_int": "not in head; catalog-only",
        "do_not_modify_architecture_this_mission": True,
    }
    (V4_CANDIDATE_DIR / "exp004-compatibility.json").write_text(json.dumps(exp004, indent=2) + "\n", encoding="utf-8")

    materialization_pass = (
        leak_e2["exact_n"] == 0
        and leak_e3["exact_n"] == 0
        and leak_e3["family_n"] == 0
        and len(fam_overlap["train_val"]) == 0
        and len(fam_overlap["train_test"]) == 0
        and len(fam_overlap["val_test"]) == 0
        and class_counts.get("MEMORY", 0) == 2
        and wrim_ok
        and all(class_counts.get(c, 0) >= 1 for c in ("NO_TOOL", "WEB", "MEMORY", "FILES", "RESEARCH"))
    )
    # EXP004 review: materialization can PASS while EXP004 is still not ready to run
    exp_ready = False
    readiness = "WR-TOOL V4 — NOT READY FOR EXPERIMENT 004 REVIEW"
    if materialization_pass:
        # Ready for Commander *review* of EXP004, not authorization to train.
        # Still NOT READY to *start* EXP004 because of MEMORY scarcity + loader change.
        readiness = "WR-TOOL V4 — NOT READY FOR EXPERIMENT 004 REVIEW"
        reasons_not = [
            "MEMORY gold n=2 from a 2-text decree store; cannot occupy train/val/test",
            "DATASET/LOADER CHANGE REQUIRED (8-class head → 6-class)",
            "Routing gold volume is scarcity-limited; EXP-003 overfit 94% synthetic — do not paper over with clones",
        ]
    else:
        reasons_not = ["materialization validation failed"]

    hashes = {
        "rows.jsonl": rows_hash,
        "train.jsonl": train_hash,
        "validation.jsonl": val_hash,
        "test.jsonl": test_hash,
        "provenance.json": prov_hash,
    }
    bundle_src = json.dumps(hashes, sort_keys=True, separators=(",", ":"))
    bundle_hash = sha_text(bundle_src)
    hashes["combined_bundle"] = bundle_hash
    (V4_CANDIDATE_DIR / "HASHES.json").write_text(json.dumps(hashes, indent=2) + "\n", encoding="utf-8")

    summary = {
        "identity": V4_CANDIDATE_ID,
        "seed": SEED,
        "total_candidate_source_rows_inspected": len(inventory) + v3_n,
        "inventory_rows": len(inventory),
        "v3_rows_inspected_not_imported": v3_n,
        "raw_eligible_routing_before_dedup_notes": "see duplicate-audit",
        "final_included_rows": len(included),
        "routing_gold": len(routing),
        "failure_examples": len(failures),
        "excluded_inventory": len(inventory) - len(included),
        "exact_duplicate_removals": exact_removed,
        "normalized_duplicate_removals": norm_removed,
        "class_space_option": "B",
        "class_counts_routing": class_counts,
        "source_counts_routing": routing_src,
        "row_level_real_test_pct": round(row_real_pct, 2),
        "family_level_real_test_pct": round(fam_real_pct, 2),
        "MEMORY_effective_diversity": {
            "gold_rows": len(mem_gold),
            "request_families": mem_fams,
            "store": "3 rows / 2 unique texts / decree only / overlapping hits",
            "synthetic_clones": 0,
        },
        "splits": {
            "train": len(train),
            "validation": len(val),
            "test": len(test),
            "family_overlap": fam_overlap,
        },
        "leakage": {"EVAL-2": leak_e2, "EVAL-3": leak_e3},
        "argument_label_coverage": arg_cov,
        "baselines": baselines,
        "hashes": hashes,
        "exp004": exp004,
        "wrim0_unchanged": wrim_ok,
        "active_modules": [],
        "training_invoked": False,
        "experiment_004": False,
        "production_untouched": True,
        "materialization_verdict": "WR-TOOL CURRICULUM V4 MATERIALIZATION — PASS"
        if materialization_pass
        else "WR-TOOL CURRICULUM V4 MATERIALIZATION — FAIL",
        "experiment_readiness_verdict": readiness,
        "readiness_reasons": reasons_not,
        "synthetic_additions": 0,
    }
    (V4_CANDIDATE_DIR / "session-summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    (V4_CANDIDATE_DIR / "readiness-verdict.json").write_text(
        json.dumps(
            {
                "materialization": summary["materialization_verdict"],
                "experiment_004": readiness,
                "reasons": reasons_not,
                "do_not_start_experiment_004": True,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    manifest = {
        "identity": V4_CANDIDATE_ID,
        "FINAL": False,
        "CANDIDATE": True,
        "NOT_TRAINED": True,
        "does_not_overwrite": provenance["not_overwritten"],
        "hashes": hashes,
        "n_included": len(included),
        "n_routing_gold": len(routing),
        "classes": list(V4_CLASSES),
    }
    (V4_CANDIDATE_DIR / "MANIFEST.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return summary


def rebuild_proof(summary: dict[str, Any]) -> dict[str, Any]:
    first = json.loads((V4_CANDIDATE_DIR / "HASHES.json").read_text(encoding="utf-8"))
    summary2 = materialize()
    second = json.loads((V4_CANDIDATE_DIR / "HASHES.json").read_text(encoding="utf-8"))
    match = first == second
    proof = {"rebuilds": 2, "hashes_identical": match, "first": first, "second": second}
    (V4_CANDIDATE_DIR / "determinism-proof.json").write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    return proof


def validate(summary: dict[str, Any], proof: dict[str, Any]) -> None:
    checks = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"name": name, "ok": ok, "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + (f": {detail}" if detail and not ok else ""))

    check("01 source artifacts inventoried", (V4_CANDIDATE_DIR / "inventory.jsonl").exists())
    check("02 provenance retained", (V4_CANDIDATE_DIR / "provenance.json").exists())
    check("03 MEMORY n==2 gold", summary["MEMORY_effective_diversity"]["gold_rows"] == 2)
    check("04 MEMORY not cloned", summary["synthetic_additions"] == 0)
    check("05 EVAL-3 exact leak 0", summary["leakage"]["EVAL-3"]["exact_n"] == 0)
    check("06 EVAL-3 family leak 0", summary["leakage"]["EVAL-3"]["family_n"] == 0)
    check("07 EVAL-2 exact leak 0", summary["leakage"]["EVAL-2"]["exact_n"] == 0)
    check("08 family overlap empty", all(len(v) == 0 for v in summary["splits"]["family_overlap"].values()))
    check("09 LOOKUP_NOTE/ECHO_INT not in class counts", "LOOKUP_NOTE" not in summary["class_counts_routing"] and "ECHO_INT" not in summary["class_counts_routing"])
    check("10 operator classes present", all(summary["class_counts_routing"].get(c, 0) >= 1 for c in ("NO_TOOL", "WEB", "MEMORY", "FILES", "RESEARCH")))
    check("11 determinism", proof["hashes_identical"])
    check("12 hashes present", all(k in summary["hashes"] for k in ("train.jsonl", "validation.jsonl", "test.jsonl", "combined_bundle")))
    check("13 WRIM-0 unchanged", summary["wrim0_unchanged"] is True)
    check("14 EXP-004 off", summary["experiment_004"] is False)
    check("15 no training", summary["training_invoked"] is False)
    v3_hash_before = None
    if (V3_CURRICULUM_DIR / "MANIFEST.json").exists():
        v3_hash_before = True
    check("16 V3 still present", v3_hash_before is True)
    check("17 EVAL-3 still 13", json.loads((TOOL_EVAL_3_DIR / "suite.json").read_text())["item_count"] == 13)
    check("18 no EXP-004 train dir", not (ROOT / "model-lab/manifests/modular-intelligence/WR-TOOL-PI-EXP-004").joinpath("weights").exists())
    passed = sum(1 for c in checks if c["ok"])
    (V4_CANDIDATE_DIR / "validator.json").write_text(
        json.dumps({"n_pass": passed, "n_total": len(checks), "passed": passed == len(checks), "checks": checks}, indent=2)
        + "\n",
        encoding="utf-8",
    )
    if passed != len(checks):
        raise SystemExit(1)


def main() -> int:
    print("estimate_runtime_minutes=5")
    summary = materialize()
    proof = rebuild_proof(summary)
    # rebuild_proof re-ran materialize; reload summary
    summary = json.loads((V4_CANDIDATE_DIR / "session-summary.json").read_text(encoding="utf-8"))
    validate(summary, proof)
    print(json.dumps({
        "identity": V4_CANDIDATE_ID,
        "included": summary["final_included_rows"],
        "routing_gold": summary["routing_gold"],
        "materialization": summary["materialization_verdict"],
        "exp004_readiness": summary["experiment_readiness_verdict"],
        "bundle": summary["hashes"]["combined_bundle"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
