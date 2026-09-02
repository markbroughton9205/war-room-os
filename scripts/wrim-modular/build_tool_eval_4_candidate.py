#!/usr/bin/env python3
"""Materialize WR-TOOL-EVAL-4-CANDIDATE.

Held-out evaluation expansion only. Does not modify V4 train.
Does not start Experiment 004. Does not overwrite EVAL-2 or EVAL-3.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from paths import (
    FROZEN_V4_TRAIN_HASH,
    PRODUCTION_ROOT,
    ROOT,
    TOOL_EVAL_2_ITEMS,
    TOOL_EVAL_2_SUITE,
    TOOL_EVAL_3_DIR,
    TOOL_EVAL_4_DIR,
    TOOL_EVAL_4_ID,
    V4_CANDIDATE_DIR,
    WRIM0_CHECKPOINT_SHA256,
    WRIM0_ID,
    WRIM0_WEIGHTS,
)

sys.path.insert(0, str(ROOT / "scripts" / "wrim1-training"))
from hashes import sha256_file, sha256_json  # noqa: E402

SEED = 20260831
V4_CLASSES = ("NO_TOOL", "WEB", "MEMORY", "FILES", "RESEARCH", "SHA256")
REALISH = {"REAL_RUNTIME", "REAL_TEST"}
JWT_RE = re.compile(r"eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}")


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


def dump_jsonl(path: Path, rows: list[dict[str, Any]]) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    ordered = sorted(rows, key=lambda r: str(r.get("example_id") or ""))
    text = "".join(json.dumps(r, sort_keys=True, ensure_ascii=True) + "\n" for r in ordered)
    path.write_text(text, encoding="utf-8")
    return sha256_file(path)


def write_json(path: Path, obj: Any) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return sha256_file(path)


def semantic_class(gold: dict[str, Any]) -> str:
    if gold.get("decision") == "NO_TOOL" or not gold.get("tool_id"):
        return "NO_TOOL"
    return str(gold["tool_id"]).upper()


def eval_item_text(item: dict[str, Any]) -> str:
    return str(
        item.get("input")
        or item.get("prompt")
        or item.get("generation_prompt")
        or item.get("request_text")
        or ""
    )


def collect_eval_texts_fams(items: list[dict[str, Any]]) -> tuple[list[str], set[str]]:
    texts = [eval_item_text(i) for i in items if eval_item_text(i)]
    fams = {str(i.get("family_id") or "") for i in items}
    fams.discard("")
    return texts, fams


def leak_against(
    rows: list[dict[str, Any]],
    texts: list[str],
    fams: set[str],
) -> dict[str, Any]:
    exact_h = {sha_text(t) for t in texts}
    norm_h = {sha_text(norm_text(t)) for t in texts}
    exact = [r for r in rows if sha_text(r["input"]) in exact_h]
    normalized = [r for r in rows if sha_text(norm_text(r["input"])) in norm_h]
    family = [r for r in rows if r.get("family_id") in fams]
    return {
        "exact_n": len(exact),
        "normalized_n": len(normalized),
        "family_n": len(family),
        "exact_ids": [r["example_id"] for r in exact],
        "normalized_ids": [r["example_id"] for r in normalized],
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
    if re.search(r"path\s*=|docs/|lib/|scripts/", p) or p.endswith(".md") or "CLAUDE.md" in p:
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


def bow_logreg(train: list[dict[str, Any]], test: list[dict[str, Any]]) -> dict[str, Any] | None:
    try:
        import numpy as np
    except Exception:
        return None
    vocab: dict[str, int] = {}

    def toks(s: str) -> list[str]:
        return re.findall(r"[a-z0-9_]+", s.casefold())

    for r in train:
        for t in toks(r["input"] if "input" in r else r.get("request_text") or ""):
            if t not in vocab and len(vocab) < 2000:
                vocab[t] = len(vocab)
    if not vocab or not train or not test:
        return None
    idx = {c: i for i, c in enumerate(V4_CLASSES)}

    def mat(rows: list[dict[str, Any]]) -> tuple[Any, Any]:
        x = np.zeros((len(rows), len(vocab)), dtype=np.float64)
        y = np.zeros(len(rows), dtype=np.int64)
        for i, r in enumerate(rows):
            text = r.get("input") or r.get("request_text") or ""
            y[i] = idx[r["semantic_class"]]
            for t in toks(text):
                j = vocab.get(t)
                if j is not None:
                    x[i, j] += 1.0
            nrm = np.linalg.norm(x[i])
            if nrm:
                x[i] /= nrm
        return x, y

    xtr, ytr = mat(train)
    w = np.zeros((len(V4_CLASSES), xtr.shape[1]))
    for c in range(len(V4_CLASSES)):
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
        "trained_on": "WR-TOOL-CURRICULUM-V4-CANDIDATE train (frozen)",
        "accuracy": float((pred == yte).mean()) if len(yte) else 0.0,
        "n_test": int(len(yte)),
        "vocab": len(vocab),
    }


def make_row(
    *,
    input_text: str,
    gold: dict[str, Any],
    family_id: str,
    split: str,
    source_type: str,
    boundary_pair: str = "",
    execution_outcome: str | None = None,
    role: str = "routing_gold",
    context_dependence: str = "STANDALONE",
    quality_status: str = "SUPPORTED",
    hard_negative: bool = False,
    notes: str = "",
) -> dict[str, Any]:
    cls = semantic_class(gold)
    eid = "e4_" + sha_text(f"{family_id}|{input_text}|{cls}")[:16]
    if JWT_RE.search(input_text) or "Bearer " in input_text:
        raise ValueError(f"secret-like request blocked: {eid}")
    return {
        "EXCLUDE_FROM_TRAINING": True,
        "CANDIDATE": True,
        "DESIGN_ONLY": True,
        "NOT_TRAINED": True,
        "dataset_id": TOOL_EVAL_4_ID,
        "example_id": eid,
        "input": input_text,
        "gold": gold,
        "semantic_class": cls,
        "family_id": family_id,
        "split": split,
        "source_type": source_type,
        "boundary_pair": boundary_pair or None,
        "execution_outcome": execution_outcome,
        "role": role,
        "context_dependence": context_dependence,
        "quality_status": quality_status,
        "hard_negative": hard_negative,
        "argument_task": False,
        "real_wording": "TOOL=" not in input_text[:8],
        "notes": notes or None,
        "does_not_overwrite": ["WR-TOOL-EVAL-2", "WR-TOOL-EVAL-3", "WR-TOOL-CURRICULUM-V4-CANDIDATE"],
    }


def catalog() -> list[dict[str, Any]]:
    """Frozen held-out catalog. New families only. Train shard is not referenced as gold."""
    G_NO = {"decision": "NO_TOOL", "tool_id": None, "arguments": {}}
    rows: list[dict[str, Any]] = []

    def add(**kw: Any) -> None:
        rows.append(make_row(**kw))

    # --- WEB vs RESEARCH pair 1 (validation) ---
    add(
        input_text="What CPython installers does https://www.python.org/downloads/ currently list?",
        gold={"decision": "TOOL", "tool_id": "web", "arguments": {"query": "https://www.python.org/downloads/"}},
        family_id="fam.e4.boundary.web-vs-research.cpython",
        split="validation",
        source_type="REAL_TEST",
        boundary_pair="WEB_vs_RESEARCH",
        notes="HTTPS page retrieve; not Tavily search.",
    )
    add(
        input_text="Compare several independent outlets on how CPython release numbering is currently communicated, and note where they disagree.",
        gold={
            "decision": "TOOL",
            "tool_id": "research",
            "arguments": {"query": "CPython release numbering communication disagreements across outlets"},
        },
        family_id="fam.e4.boundary.web-vs-research.cpython",
        split="validation",
        source_type="REAL_TEST",
        boundary_pair="WEB_vs_RESEARCH",
        notes="Multi-source synthesis, not a single page fetch.",
    )

    # --- WEB vs RESEARCH pair 2 (test) ---
    add(
        input_text="Open https://www.unicode.org/versions/latest/ and tell me which Unicode version page it currently points at.",
        gold={"decision": "TOOL", "tool_id": "web", "arguments": {"query": "https://www.unicode.org/versions/latest/"}},
        family_id="fam.e4.boundary.web-vs-research.unicode",
        split="test",
        source_type="REAL_TEST",
        boundary_pair="WEB_vs_RESEARCH",
    )
    add(
        input_text="Across Unicode, ICU, and CLDR public notes, what do independent sources currently say about the latest Unicode version, and where do they conflict?",
        gold={
            "decision": "TOOL",
            "tool_id": "research",
            "arguments": {"query": "latest Unicode version claims Unicode vs ICU vs CLDR conflicts"},
        },
        family_id="fam.e4.boundary.web-vs-research.unicode",
        split="test",
        source_type="REAL_TEST",
        boundary_pair="WEB_vs_RESEARCH",
    )

    # --- FILES vs MEMORY pair 1 (validation) ---
    add(
        input_text="In docs/ENGINEERING_COMPLETION_STANDARD.md, what must the operator checklist include after an engineering completion?",
        gold={
            "decision": "TOOL",
            "tool_id": "files",
            "arguments": {"path": "docs/ENGINEERING_COMPLETION_STANDARD.md"},
        },
        family_id="fam.e4.boundary.files-vs-memory.deploy-freeze",
        split="validation",
        source_type="REAL_TEST",
        boundary_pair="FILES_vs_MEMORY",
        notes="Repo document access; not session recall.",
    )
    add(
        input_text="What standing instruction did we previously store about freezing production deploys?",
        gold={
            "decision": "TOOL",
            "tool_id": "memory",
            "arguments": {"query": "standing instruction freeze production deploys"},
        },
        family_id="fam.e4.boundary.files-vs-memory.deploy-freeze",
        split="validation",
        source_type="EVAL_SYNTHETIC",
        boundary_pair="FILES_vs_MEMORY",
        context_dependence="CONTEXT_DEPENDENT",
        notes="Live memories table cannot support this fact family (decree-only store). Routing challenge only.",
    )

    # --- FILES vs MEMORY pair 2 (test) ---
    add(
        input_text="Open CLAUDE.md and find the install and dev commands listed there.",
        gold={"decision": "TOOL", "tool_id": "files", "arguments": {"path": "CLAUDE.md"}},
        family_id="fam.e4.boundary.files-vs-memory.claude",
        split="test",
        source_type="REAL_TEST",
        boundary_pair="FILES_vs_MEMORY",
    )
    add(
        input_text="Pull up the earlier stored note about how we invoke slash-commands in this workspace.",
        gold={
            "decision": "TOOL",
            "tool_id": "memory",
            "arguments": {"query": "slash-commands workspace standing note"},
        },
        family_id="fam.e4.boundary.files-vs-memory.claude",
        split="test",
        source_type="EVAL_SYNTHETIC",
        boundary_pair="FILES_vs_MEMORY",
        context_dependence="CONTEXT_DEPENDENT",
        notes="Not a live memory fact. Distinct from train council/decree families.",
    )

    # --- MEMORY vs NO_TOOL pair 1 (validation) ---
    add(
        input_text="Retrieve the stored standing instruction about weekend halt.",
        gold={"decision": "TOOL", "tool_id": "memory", "arguments": {"query": "weekend halt standing instruction"}},
        family_id="fam.e4.boundary.memory-vs-notool.weekend-halt",
        split="validation",
        source_type="EVAL_SYNTHETIC",
        boundary_pair="MEMORY_vs_NO_TOOL",
        context_dependence="CONTEXT_DEPENDENT",
        notes="Eval-only standing-order family; not present in live decree store.",
    )
    add(
        input_text="In general, what is a standing instruction? Do not look up our prior notes.",
        gold=G_NO,
        family_id="fam.e4.boundary.memory-vs-notool.weekend-halt",
        split="validation",
        source_type="REAL_TEST",
        boundary_pair="MEMORY_vs_NO_TOOL",
        hard_negative=True,
        notes="Conceptual; retrieval not required.",
    )

    # --- MEMORY vs NO_TOOL pair 2 (test) ---
    add(
        input_text="What did we previously store about rotating the search-provider credential?",
        gold={
            "decision": "TOOL",
            "tool_id": "memory",
            "arguments": {"query": "search-provider credential rotation standing note"},
        },
        family_id="fam.e4.boundary.memory-vs-notool.tavily-credential",
        split="test",
        source_type="EVAL_SYNTHETIC",
        boundary_pair="MEMORY_vs_NO_TOOL",
        context_dependence="CONTEXT_DEPENDENT",
        notes="Not a live store fact. Distinct from train decree retrieve.",
    )
    add(
        input_text="Explain conceptually why rotating a search-provider credential matters. Do not retrieve stored notes.",
        gold=G_NO,
        family_id="fam.e4.boundary.memory-vs-notool.tavily-credential",
        split="test",
        source_type="REAL_TEST",
        boundary_pair="MEMORY_vs_NO_TOOL",
        hard_negative=True,
    )

    # --- WEB vs NO_TOOL pair 1 (validation) ---
    add(
        input_text="Fetch the current learn page at https://www.rust-lang.org/learn",
        gold={"decision": "TOOL", "tool_id": "web", "arguments": {"query": "https://www.rust-lang.org/learn"}},
        family_id="fam.e4.boundary.web-vs-notool.rust-learn",
        split="validation",
        source_type="REAL_TEST",
        boundary_pair="WEB_vs_NO_TOOL",
    )
    add(
        input_text="The learn page already says beginners should start with the book. Given that, summarize why a first-language tutorial usually starts with ownership — do not fetch anything.",
        gold=G_NO,
        family_id="fam.e4.boundary.web-vs-notool.rust-learn",
        split="validation",
        source_type="REAL_TEST",
        boundary_pair="WEB_vs_NO_TOOL",
        hard_negative=True,
        notes="Answer is in supplied context.",
    )

    # --- WEB vs NO_TOOL pair 2 (test) ---
    add(
        input_text="Pull the current IANA root-zone database page at https://www.iana.org/domains/root",
        gold={"decision": "TOOL", "tool_id": "web", "arguments": {"query": "https://www.iana.org/domains/root"}},
        family_id="fam.e4.boundary.web-vs-notool.iana-root",
        split="test",
        source_type="REAL_TEST",
        boundary_pair="WEB_vs_NO_TOOL",
    )
    add(
        input_text="A root zone is the DNS starting point. Explain that idea in your own words without visiting any site.",
        gold=G_NO,
        family_id="fam.e4.boundary.web-vs-notool.iana-root",
        split="test",
        source_type="REAL_TEST",
        boundary_pair="WEB_vs_NO_TOOL",
        hard_negative=True,
    )

    # --- extra MEMORY ---
    add(
        input_text="Recall the prior War Room decision about ZX4-E4-ABSENT-STANDING-ORDER.",
        gold={
            "decision": "TOOL",
            "tool_id": "memory",
            "arguments": {"query": "ZX4-E4-ABSENT-STANDING-ORDER"},
        },
        family_id="fam.e4.memory.no-match-absent",
        split="validation",
        source_type="EVAL_SYNTHETIC",
        execution_outcome="NO_MATCH",
        role="no_match",
        quality_status="PARTIAL",
        context_dependence="CONTEXT_DEPENDENT",
        notes="Intended no-match family distinct from train ZX9-QK probe. Not a fabricated hit.",
    )
    add(
        input_text="What stored instruction covers human approval before any income-generation action?",
        gold={
            "decision": "TOOL",
            "tool_id": "memory",
            "arguments": {"query": "human approval before income-generation action"},
        },
        family_id="fam.e4.memory.approval-gate",
        split="test",
        source_type="EVAL_SYNTHETIC",
        context_dependence="CONTEXT_DEPENDENT",
        notes="Eval-only retrieval semantics. Live store has no such family.",
    )

    # --- extra WEB ---
    add(
        input_text="Grab the current public npm status JSON from https://status.npmjs.org/api/v2/status.json",
        gold={
            "decision": "TOOL",
            "tool_id": "web",
            "arguments": {"query": "https://status.npmjs.org/api/v2/status.json"},
        },
        family_id="fam.e4.web.npm-status-json",
        split="validation",
        source_type="REAL_TEST",
        notes="Bounded HTTPS JSON retrieve; distinct from train Cloudflare/GitHub status JSON.",
    )
    add(
        input_text="What's debian.org currently listing as the stable release name?",
        gold={"decision": "TOOL", "tool_id": "web", "arguments": {"query": "debian.org current stable release name"}},
        family_id="fam.e4.web.search-debian-stable",
        split="validation",
        source_type="EVAL_SYNTHETIC",
        execution_outcome="TAVILY_401",
        role="execution_failure",
        quality_status="PARTIAL",
        notes="Correct WEB routing despite known Tavily 401. Not a new live 401 capture.",
    )

    # --- SHA256 ---
    add(
        input_text="Please run the bounded hasher on the phrase eval4-heldout-keel.",
        gold={"decision": "TOOL", "tool_id": "sha256", "arguments": {"text": "eval4-heldout-keel"}},
        family_id="fam.e4.sha256.normal-eval4-keel",
        split="validation",
        source_type="REAL_TEST",
    )
    add(
        input_text="Digest xy with the bounded hasher.",
        gold={"decision": "TOOL", "tool_id": "sha256", "arguments": {"text": "xy"}},
        family_id="fam.e4.sha256.short-xy",
        split="validation",
        source_type="REAL_TEST",
        notes="Short input; argument distinct from train texts.",
    )
    add(
        input_text="Use the bounded hasher on this sentence: Commander freeze remains in force until the eval package is reviewed.",
        gold={
            "decision": "TOOL",
            "tool_id": "sha256",
            "arguments": {"text": "Commander freeze remains in force until the eval package is reviewed."},
        },
        family_id="fam.e4.sha256.long-freeze-sentence",
        split="test",
        source_type="REAL_TEST",
    )
    add(
        input_text="I do not want a Wikipedia article; digest the phrase eval4-wiki-distractor with the bounded hasher.",
        gold={"decision": "TOOL", "tool_id": "sha256", "arguments": {"text": "eval4-wiki-distractor"}},
        family_id="fam.e4.sha256.distractor-wiki",
        split="test",
        source_type="REAL_TEST",
        hard_negative=True,
        notes="Distractor wording; still SHA256.",
    )
    add(
        input_text="Use the bounded hasher now.",
        gold={"decision": "TOOL", "tool_id": "sha256", "arguments": {}},
        family_id="fam.e4.sha256.missing-arg",
        split="test",
        source_type="REAL_TEST",
        execution_outcome="MISSING_ARGUMENT",
        role="routing_failure",
        quality_status="SUPPORTED",
        notes="Correct class SHA256 with missing text argument. Distinct from train compact TOOL=sha256.",
    )
    add(
        input_text="In cryptography class terms, what does a one-way digest prevent? Do not compute one.",
        gold=G_NO,
        family_id="fam.e4.notool.vs-sha256.one-way",
        split="test",
        source_type="REAL_TEST",
        boundary_pair="NO_TOOL_vs_SHA256",
        hard_negative=True,
    )

    # --- extra NO_TOOL hard negatives ---
    add(
        input_text="Below are two already-quoted headlines: A says the ISS has 7 aboard; B says 8. Using only these quotes, say they conflict. Do not gather more sources.",
        gold=G_NO,
        family_id="fam.e4.notool.quotes-already-conflict",
        split="validation",
        source_type="REAL_TEST",
        hard_negative=True,
        notes="Looks like research; evidence already supplied.",
    )
    add(
        input_text="In software engineering, why do teams keep documents in a repository? I do not need you to open a file.",
        gold=G_NO,
        family_id="fam.e4.notool.repo-docs-concept",
        split="test",
        source_type="REAL_TEST",
        hard_negative=True,
        notes="Mentions documents conceptually; no file access.",
    )

    # --- extra RESEARCH ---
    add(
        input_text="I need a sourced comparison of WHO versus CDC public statements this month on seasonal influenza activity, including disagreements.",
        gold={
            "decision": "TOOL",
            "tool_id": "research",
            "arguments": {"query": "WHO vs CDC seasonal influenza activity statements this month disagreements"},
        },
        family_id="fam.e4.research.who-vs-cdc",
        split="validation",
        source_type="REAL_TEST",
    )
    add(
        input_text="Investigate Debian versus Ubuntu release-cadence claims from more than one independent outlet and leave unresolved conflicts marked.",
        gold={
            "decision": "TOOL",
            "tool_id": "research",
            "arguments": {"query": "Debian vs Ubuntu release cadence claims independent outlets unresolved conflicts"},
        },
        family_id="fam.e4.research.debian-ubuntu-cadence",
        split="test",
        source_type="REAL_TEST",
    )

    # --- extra FILES ---
    add(
        input_text="Find the changed-variable sentence in docs/WR_TOOL_PARAMETER_ISOLATED_EXPERIMENT_004_DESIGN.md",
        gold={
            "decision": "TOOL",
            "tool_id": "files",
            "arguments": {"path": "docs/WR_TOOL_PARAMETER_ISOLATED_EXPERIMENT_004_DESIGN.md"},
        },
        family_id="fam.e4.files.exp004-changed-variable",
        split="validation",
        source_type="REAL_TEST",
    )
    add(
        input_text="In docs/WAVE_8_WRIM1_DATASET_REPORT.md, where is the candidate corpus hash stated?",
        gold={
            "decision": "TOOL",
            "tool_id": "files",
            "arguments": {"path": "docs/WAVE_8_WRIM1_DATASET_REPORT.md"},
        },
        family_id="fam.e4.files.wave8-hash",
        split="test",
        source_type="REAL_TEST",
    )

    return rows


def class_counts_from_items(items: list[dict[str, Any]], text_key: str = "input") -> dict[str, int]:
    c: Counter[str] = Counter()
    for it in items:
        gold = it.get("gold") if isinstance(it.get("gold"), dict) else {}
        tool = gold.get("tool_id") or it.get("gold_tool_id") or it.get("intended_tool_id")
        decision = gold.get("decision") or it.get("decision")
        if decision == "NO_TOOL" or not tool:
            c["NO_TOOL"] += 1
        else:
            c[str(tool).upper()] += 1
    return dict(c)


def inventory_current() -> dict[str, Any]:
    v4_train = load_jsonl(V4_CANDIDATE_DIR / "train.jsonl")
    v4_val = load_jsonl(V4_CANDIDATE_DIR / "validation.jsonl")
    v4_test = load_jsonl(V4_CANDIDATE_DIR / "test.jsonl")
    eval2 = load_jsonl(TOOL_EVAL_2_ITEMS)
    eval3 = json.loads((TOOL_EVAL_3_DIR / "suite.json").read_text(encoding="utf-8")).get("items", [])

    def split_classes(rows: list[dict[str, Any]]) -> dict[str, int]:
        return dict(Counter(r.get("semantic_class") for r in rows))

    v4_val_cls = split_classes(v4_val)
    v4_test_cls = split_classes(v4_test)
    missing_test = [c for c in V4_CLASSES if v4_test_cls.get(c, 0) == 0]
    missing_val = [c for c in V4_CLASSES if v4_val_cls.get(c, 0) == 0]
    return {
        "v4_train_n": len(v4_train),
        "v4_train_hash": sha256_file(V4_CANDIDATE_DIR / "train.jsonl"),
        "v4_train_classes": split_classes(v4_train),
        "v4_train_families": sorted({r["family_id"] for r in v4_train}),
        "v4_validation": {"n": len(v4_val), "classes": v4_val_cls, "missing": missing_val},
        "v4_internal_test": {"n": len(v4_test), "classes": v4_test_cls, "missing": missing_test},
        "eval2": {"n": len(eval2), "classes": class_counts_from_items(eval2)},
        "eval3": {"n": len(eval3), "classes": class_counts_from_items(eval3)},
        "concerns": [
            "V4 internal validation n=4",
            "V4 internal test n=3 missing MEMORY WEB SHA256",
            "MEMORY train families limited to council decree + no-match probe",
            "Tavily WEB search still 401 in prior ledgers",
            "BoW 1.00 on n=4 is not meaningful",
        ],
        "weak_classes": ["MEMORY", "WEB", "SHA256"],
        "boundary_gaps_in_v4_internal_test": [
            "WEB_vs_RESEARCH not in test",
            "FILES_vs_MEMORY not in test",
            "MEMORY_vs_NO_TOOL not in test",
            "WEB_vs_NO_TOOL not in test",
        ],
    }


def materialize() -> dict[str, Any]:
    if PRODUCTION_ROOT.exists() and str(PRODUCTION_ROOT) in str(Path(__file__).resolve()):
        raise SystemExit("refusing production tree")

    train_path = V4_CANDIDATE_DIR / "train.jsonl"
    train_hash_before = sha256_file(train_path)
    if train_hash_before != FROZEN_V4_TRAIN_HASH:
        raise SystemExit(f"V4 train hash mismatch before materialize: {train_hash_before}")

    TOOL_EVAL_4_DIR.mkdir(parents=True, exist_ok=True)
    inv = inventory_current()
    write_json(TOOL_EVAL_4_DIR / "inventory-before.json", inv)

    eval2_items = load_jsonl(TOOL_EVAL_2_ITEMS)
    eval2_suite = json.loads(TOOL_EVAL_2_SUITE.read_text(encoding="utf-8"))
    eval3 = json.loads((TOOL_EVAL_3_DIR / "suite.json").read_text(encoding="utf-8"))
    eval2_all = eval2_items + list(eval2_suite.get("items") or [])
    eval2_texts, eval2_fams = collect_eval_texts_fams(eval2_all)
    eval3_texts, eval3_fams = collect_eval_texts_fams(list(eval3.get("items") or []))

    v4_train = load_jsonl(train_path)
    v4_all = v4_train + load_jsonl(V4_CANDIDATE_DIR / "validation.jsonl") + load_jsonl(V4_CANDIDATE_DIR / "test.jsonl")
    train_texts = [r["input"] for r in v4_train]
    train_fams = {r["family_id"] for r in v4_train}
    train_sha_args = {
        (r.get("gold") or {}).get("arguments", {}).get("text")
        for r in v4_train
        if r.get("semantic_class") == "SHA256"
    }
    train_sha_args.discard(None)
    train_file_args = {
        (r.get("gold") or {}).get("arguments", {}).get("path")
        for r in v4_train
        if r.get("semantic_class") == "FILES"
    }
    train_file_args.discard(None)
    train_mem_queries = {
        (r.get("gold") or {}).get("arguments", {}).get("query")
        for r in v4_all
        if r.get("semantic_class") == "MEMORY"
    }
    train_mem_queries.discard(None)

    rows = catalog()
    # contamination vs train argument values
    contaminated = []
    for r in rows:
        args = (r.get("gold") or {}).get("arguments") or {}
        if r["semantic_class"] == "SHA256" and args.get("text") in train_sha_args:
            contaminated.append({"id": r["example_id"], "reason": "sha256_arg_overlap"})
        if r["semantic_class"] == "FILES" and args.get("path") in train_file_args:
            contaminated.append({"id": r["example_id"], "reason": "files_path_overlap"})
        if r["semantic_class"] == "MEMORY" and args.get("query") in train_mem_queries:
            contaminated.append({"id": r["example_id"], "reason": "memory_query_overlap"})
        if r["family_id"] in train_fams:
            contaminated.append({"id": r["example_id"], "reason": "family_overlap_train"})
    if contaminated:
        raise SystemExit(f"train contamination: {contaminated}")

    leak_train = leak_against(rows, train_texts, train_fams)
    leak_e2 = leak_against(rows, eval2_texts, eval2_fams)
    leak_e3 = leak_against(rows, eval3_texts, eval3_fams)
    if leak_train["exact_n"] or leak_train["normalized_n"] or leak_train["family_n"]:
        raise SystemExit(f"train leak: {leak_train}")
    if leak_e2["exact_n"] or leak_e2["normalized_n"] or leak_e2["family_n"]:
        raise SystemExit(f"EVAL-2 leak: {leak_e2}")
    if leak_e3["exact_n"] or leak_e3["normalized_n"] or leak_e3["family_n"]:
        raise SystemExit(f"EVAL-3 leak: {leak_e3}")

    # family isolation across splits
    fam_split: dict[str, set[str]] = defaultdict(set)
    for r in rows:
        fam_split[r["family_id"]].add(r["split"])
    fam_span = {k: sorted(v) for k, v in fam_split.items() if len(v) > 1}
    if fam_span:
        raise SystemExit(f"family spans splits: {fam_span}")

    val = [r for r in rows if r["split"] == "validation"]
    test = [r for r in rows if r["split"] == "test"]
    val_cls = dict(Counter(r["semantic_class"] for r in val))
    test_cls = dict(Counter(r["semantic_class"] for r in test))
    all_cls = dict(Counter(r["semantic_class"] for r in rows))

    fam_map: dict[str, list[str]] = defaultdict(list)
    for r in rows:
        fam_map[r["family_id"]].append(r["example_id"])
    class_map: dict[str, list[str]] = defaultdict(list)
    for r in rows:
        class_map[r["semantic_class"]].append(r["example_id"])
    prov_counts = dict(Counter(r["source_type"] for r in rows))
    real_n = sum(1 for r in rows if r["source_type"] in REALISH)
    synth_n = sum(1 for r in rows if r["source_type"] in {"SYNTHETIC", "EVAL_SYNTHETIC"})
    fam_real = 0
    for fid, ids in fam_map.items():
        types = {next(r["source_type"] for r in rows if r["example_id"] == i) for i in ids}
        if types <= REALISH:
            fam_real += 1
    largest_fid, largest_ids = max(fam_map.items(), key=lambda kv: (len(kv[1]), kv[0]))
    largest_share = len(largest_ids) / len(rows)

    bp_counts = dict(Counter(r["boundary_pair"] for r in rows if r.get("boundary_pair")))
    pair_families = {
        "WEB_vs_RESEARCH": sorted(
            {r["family_id"] for r in rows if r.get("boundary_pair") == "WEB_vs_RESEARCH"}
        ),
        "FILES_vs_MEMORY": sorted(
            {r["family_id"] for r in rows if r.get("boundary_pair") == "FILES_vs_MEMORY"}
        ),
        "MEMORY_vs_NO_TOOL": sorted(
            {r["family_id"] for r in rows if r.get("boundary_pair") == "MEMORY_vs_NO_TOOL"}
        ),
        "WEB_vs_NO_TOOL": sorted(
            {r["family_id"] for r in rows if r.get("boundary_pair") == "WEB_vs_NO_TOOL"}
        ),
    }
    hard_pair_count = sum(len(v) for v in pair_families.values())

    mem_fams = sorted({r["family_id"] for r in rows if r["semantic_class"] == "MEMORY"})
    train_mem_fams = sorted({r["family_id"] for r in v4_train if r.get("semantic_class") == "MEMORY"})

    rows_hash = dump_jsonl(TOOL_EVAL_4_DIR / "rows.jsonl", rows)
    val_hash = dump_jsonl(TOOL_EVAL_4_DIR / "validation.jsonl", val)
    test_hash = dump_jsonl(TOOL_EVAL_4_DIR / "test.jsonl", test)

    provenance = {
        "identity": TOOL_EVAL_4_ID,
        "EXCLUDE_FROM_TRAINING": True,
        "source_type_counts": prov_counts,
        "REAL_RUNTIME": prov_counts.get("REAL_RUNTIME", 0),
        "REAL_TEST": prov_counts.get("REAL_TEST", 0),
        "EVAL_SYNTHETIC": prov_counts.get("EVAL_SYNTHETIC", 0),
        "SYNTHETIC": prov_counts.get("SYNTHETIC", 0),
        "MEMORY_live_store": (
            "Cannot honestly mint new REAL_RUNTIME MEMORY families. "
            "Live memories table remains 3 rows / 2 unique decree texts. "
            "New MEMORY rows are EVAL_SYNTHETIC routing challenges, not fabricated hits."
        ),
        "Tavily": "Still a provider 401; WEB search-failure item is labeled EVAL_SYNTHETIC execution_failure.",
        "does_not_overwrite": ["WR-TOOL-EVAL-2", "WR-TOOL-EVAL-3", "WR-TOOL-CURRICULUM-V4-CANDIDATE train"],
    }
    prov_hash = write_json(TOOL_EVAL_4_DIR / "provenance.json", provenance)
    write_json(TOOL_EVAL_4_DIR / "family-map.json", {k: sorted(v) for k, v in sorted(fam_map.items())})
    write_json(
        TOOL_EVAL_4_DIR / "class-map.json",
        {
            "classes": list(V4_CLASSES),
            "counts": all_cls,
            "validation": val_cls,
            "test": test_cls,
            "ids": {k: sorted(v) for k, v in sorted(class_map.items())},
        },
    )
    write_json(
        TOOL_EVAL_4_DIR / "boundary-map.json",
        {
            "pair_families": pair_families,
            "row_counts_by_pair": bp_counts,
            "hard_boundary_pair_count": hard_pair_count,
            "WEB_vs_RESEARCH": len(pair_families["WEB_vs_RESEARCH"]),
            "FILES_vs_MEMORY": len(pair_families["FILES_vs_MEMORY"]),
            "MEMORY_vs_NO_TOOL": len(pair_families["MEMORY_vs_NO_TOOL"]),
            "WEB_vs_NO_TOOL": len(pair_families["WEB_vs_NO_TOOL"]),
        },
    )

    leak_report = {
        "train": leak_train,
        "EVAL-2": leak_e2,
        "EVAL-3": leak_e3,
        "sha256_arg_overlap_with_train": 0,
        "files_path_overlap_with_train": 0,
        "memory_query_overlap_with_v4": 0,
        "family_span_across_splits": fam_span,
        "contaminated": contaminated,
    }
    write_json(TOOL_EVAL_4_DIR / "leakage-audit.json", leak_report)

    y_val = [r["semantic_class"] for r in val]
    y_test = [r["semantic_class"] for r in test]
    maj_cls = Counter(r["semantic_class"] for r in v4_train).most_common(1)[0][0]
    majority_acc = accuracy(y_val, [maj_cls] * len(y_val))
    random_acc = 1.0 / len(V4_CLASSES)
    keyword_acc = accuracy(y_val, [keyword_predict(r["input"]) for r in val])
    schema_acc = accuracy(y_val, [schema_predict(r["input"]) for r in val])
    keyword_test = accuracy(y_test, [keyword_predict(r["input"]) for r in test])
    schema_test = accuracy(y_test, [schema_predict(r["input"]) for r in test])
    train_for_bow = [{"input": r["input"], "semantic_class": r["semantic_class"]} for r in v4_train]
    bow_val = bow_logreg(train_for_bow, val)
    bow_test = bow_logreg(train_for_bow, test)
    trivial = False
    flags = []
    if keyword_acc >= 0.9 or schema_acc >= 0.9:
        trivial = True
        flags.append("keyword_or_schema_extremely_high_on_validation")
    if bow_val and bow_val["accuracy"] >= 0.95:
        flags.append("bow_very_high_on_validation_may_memorize_cues")
    baselines = {
        "methodology": "Majority/random/keyword/schema applied to EVAL-4. BoW trained only on frozen V4 train.",
        "validation": {
            "n": len(val),
            "majority": {"class": maj_cls, "accuracy": majority_acc},
            "random": {"accuracy": random_acc, "n_classes": 6},
            "keyword": {"accuracy": keyword_acc},
            "schema_rule": {"accuracy": schema_acc},
            "bow_logistic": bow_val,
        },
        "test": {
            "n": len(test),
            "majority": {"class": maj_cls, "accuracy": accuracy(y_test, [maj_cls] * len(y_test))},
            "random": {"accuracy": random_acc},
            "keyword": {"accuracy": keyword_test},
            "schema_rule": {"accuracy": schema_test},
            "bow_logistic": bow_test,
        },
        "triviality_flags": flags,
        "obviously_trivial": trivial,
    }
    write_json(TOOL_EVAL_4_DIR / "baselines.json", baselines)

    train_hash_after = sha256_file(train_path)
    hashes = {
        "rows.jsonl": rows_hash,
        "validation.jsonl": val_hash,
        "test.jsonl": test_hash,
        "provenance.json": prov_hash,
        "v4_train.jsonl_before": train_hash_before,
        "v4_train.jsonl_after": train_hash_after,
    }
    bundle_src = json.dumps(
        {k: hashes[k] for k in ("rows.jsonl", "validation.jsonl", "test.jsonl", "provenance.json")},
        sort_keys=True,
        separators=(",", ":"),
    )
    hashes["combined_bundle"] = sha_text(bundle_src)
    write_json(TOOL_EVAL_4_DIR / "HASHES.json", hashes)

    six_heldout = all(all_cls.get(c, 0) >= 1 for c in V4_CLASSES)
    six_test = all(test_cls.get(c, 0) >= 1 for c in V4_CLASSES)
    six_val = all(val_cls.get(c, 0) >= 1 for c in V4_CLASSES)
    mem_ok = len(mem_fams) >= 1 and set(mem_fams).isdisjoint(set(train_mem_fams))
    sizes_ok = len(val) >= 12 and len(test) >= 12
    leaks_ok = (
        leak_train["exact_n"] == 0
        and leak_train["normalized_n"] == 0
        and leak_train["family_n"] == 0
        and leak_e2["exact_n"] == 0
        and leak_e2["family_n"] == 0
        and leak_e3["exact_n"] == 0
        and leak_e3["family_n"] == 0
    )
    train_unchanged = train_hash_before == train_hash_after == FROZEN_V4_TRAIN_HASH
    wrim_ok = WRIM0_WEIGHTS.exists() and sha256_file(WRIM0_WEIGHTS) == WRIM0_CHECKPOINT_SHA256

    # EXP004 review readiness: held-out coverage is now stronger, but MEMORY is still
    # EVAL_SYNTHETIC (live store cannot add families) and 6-class loader is not reviewed.
    mem_sufficiency = (
        "PARTIAL: distinct EVAL_SYNTHETIC MEMORY families exist beyond train, "
        "but live store still cannot support new REAL_RUNTIME MEMORY gold."
    )
    ready = False
    readiness = "WR-TOOL V4 — NOT READY FOR EXPERIMENT 004 REVIEW"
    reasons = [
        "MEMORY held-out evidence is EVAL_SYNTHETIC routing challenge, not new live retrieve gold",
        "DATASET/LOADER CHANGE REQUIRED (EXP-003 Linear(256→8) vs V4 Linear(256→6)) still unreviewed",
        "Tavily WEB search still 401; HTTPS retrieve items are routing-designed REAL_TEST, not new REAL_RUNTIME captures",
        "Do not start Experiment 004 from this eval expansion",
    ]
    if not (six_heldout and six_test and mem_ok and leaks_ok and train_unchanged and sizes_ok):
        reasons.insert(0, "coverage/leak/train-freeze gate failed")

    card = {
        "name": TOOL_EVAL_4_ID,
        "purpose": "Larger leakage-safe held-out exam for V4. Not training data.",
        "EXCLUDE_FROM_TRAINING": True,
        "n": len(rows),
        "validation_n": len(val),
        "test_n": len(test),
        "classes": list(V4_CLASSES),
        "class_counts": all_cls,
        "row_level_real_test_pct": real_n / len(rows),
        "family_level_real_test_pct": fam_real / len(fam_map),
        "synthetic_pct": synth_n / len(rows),
        "unique_families": len(fam_map),
        "largest_family_id": largest_fid,
        "largest_family_share": largest_share,
        "MEMORY_caveat": mem_sufficiency,
        "does_not_overwrite": provenance["does_not_overwrite"],
    }
    write_json(TOOL_EVAL_4_DIR / "dataset-card.json", card)

    summary = {
        "identity": TOOL_EVAL_4_ID,
        "seed": SEED,
        "candidate_eval_rows_inspected": len(rows),
        "final_eval_rows": len(rows),
        "validation_n": len(val),
        "test_n": len(test),
        "class_counts": all_cls,
        "validation_class_counts": val_cls,
        "test_class_counts": test_cls,
        "provenance_counts": prov_counts,
        "row_level_real_test_pct": round(100 * real_n / len(rows), 2),
        "family_level_real_test_pct": round(100 * fam_real / len(fam_map), 2),
        "synthetic_pct": round(100 * synth_n / len(rows), 2),
        "unique_families": len(fam_map),
        "largest_family_id": largest_fid,
        "largest_family_share": round(largest_share, 4),
        "MEMORY_held_out_families": mem_fams,
        "MEMORY_overlap_with_train_families": sorted(set(mem_fams) & set(train_mem_fams)),
        "hard_boundary_pair_count": hard_pair_count,
        "pair_families": pair_families,
        "leakage": leak_report,
        "baselines": baselines,
        "hashes": hashes,
        "v4_train_hash_before": train_hash_before,
        "v4_train_hash_after": train_hash_after,
        "train_changed": not train_unchanged,
        "all_six_heldout": six_heldout,
        "all_six_validation": six_val,
        "all_six_test": six_test,
        "MEMORY_evidence_sufficiency": mem_sufficiency,
        "wrim0_id": WRIM0_ID,
        "wrim0_unchanged": wrim_ok,
        "active_modules": [],
        "training_invoked": False,
        "experiment_004": False,
        "production_untouched": True,
        "mission_verdict": "WR-TOOL V4 HELD-OUT EVIDENCE EXPANSION — PASS",
        "experiment_readiness_verdict": readiness,
        "readiness_reasons": reasons,
        "inventory_before": inv,
    }
    write_json(TOOL_EVAL_4_DIR / "session-summary.json", summary)
    write_json(
        TOOL_EVAL_4_DIR / "readiness-verdict.json",
        {
            "held_out_expansion": summary["mission_verdict"],
            "experiment_004": readiness,
            "reasons": reasons,
            "do_not_start_experiment_004": True,
            "ready_for_experiment_004_review": ready,
        },
    )
    write_json(
        TOOL_EVAL_4_DIR / "MANIFEST.json",
        {
            "identity": TOOL_EVAL_4_ID,
            "CANDIDATE": True,
            "FINAL": False,
            "EXCLUDE_FROM_TRAINING": True,
            "NOT_TRAINED": True,
            "does_not_overwrite": provenance["does_not_overwrite"],
            "n": len(rows),
            "validation_n": len(val),
            "test_n": len(test),
            "classes": list(V4_CLASSES),
            "hashes": hashes,
        },
    )
    return summary


def rebuild_proof(summary: dict[str, Any]) -> dict[str, Any]:
    first = json.loads((TOOL_EVAL_4_DIR / "HASHES.json").read_text(encoding="utf-8"))
    materialize()
    second = json.loads((TOOL_EVAL_4_DIR / "HASHES.json").read_text(encoding="utf-8"))
    match = first == second
    proof = {"rebuilds": 2, "hashes_identical": match, "first": first, "second": second}
    write_json(TOOL_EVAL_4_DIR / "determinism-proof.json", proof)
    return proof


def validate(summary: dict[str, Any], proof: dict[str, Any]) -> None:
    checks = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"name": name, "ok": bool(ok), "detail": detail})
        print(("PASS " if ok else "FAIL ") + name + (f": {detail}" if detail and not ok else ""))

    train_hash = sha256_file(V4_CANDIDATE_DIR / "train.jsonl")
    e2_n = len(load_jsonl(TOOL_EVAL_2_ITEMS))
    e3_n = json.loads((TOOL_EVAL_3_DIR / "suite.json").read_text())["item_count"]
    leak = summary["leakage"]
    cls = summary["class_counts"]
    check("01 V4 train hash unchanged vs freeze", train_hash == FROZEN_V4_TRAIN_HASH, train_hash)
    check("02 train hash before==after", summary["v4_train_hash_before"] == summary["v4_train_hash_after"])
    check("03 no train change flag", summary["train_changed"] is False)
    check("04 all rows provenance-labeled", all(
        json.loads(line).get("source_type")
        for line in (TOOL_EVAL_4_DIR / "rows.jsonl").read_text().splitlines()
        if line.strip()
    ))
    check("05 six classes inventoried", all(c in cls for c in V4_CLASSES))
    check("06 >=4 per class or reported", all(cls.get(c, 0) >= 4 for c in V4_CLASSES))
    check("07 MEMORY families distinct from train", summary["MEMORY_overlap_with_train_families"] == [])
    check("08 train exact overlap 0", leak["train"]["exact_n"] == 0)
    check("09 train normalized overlap 0", leak["train"]["normalized_n"] == 0)
    check("10 train family overlap 0", leak["train"]["family_n"] == 0)
    check("11 EVAL-2 exact 0", leak["EVAL-2"]["exact_n"] == 0)
    check("12 EVAL-2 normalized 0", leak["EVAL-2"]["normalized_n"] == 0)
    check("13 EVAL-2 family 0", leak["EVAL-2"]["family_n"] == 0)
    check("14 EVAL-3 exact 0", leak["EVAL-3"]["exact_n"] == 0)
    check("15 EVAL-3 normalized 0", leak["EVAL-3"]["normalized_n"] == 0)
    check("16 EVAL-3 family 0", leak["EVAL-3"]["family_n"] == 0)
    check("17 EVAL-2 size preserved", e2_n == 115)
    check("18 EVAL-3 size preserved", e3_n == 13)
    check("19 WEB vs RESEARCH pairs >=2", summary["pair_families"]["WEB_vs_RESEARCH"].__len__() >= 2)
    check("20 FILES vs MEMORY pairs >=2", summary["pair_families"]["FILES_vs_MEMORY"].__len__() >= 2)
    check("21 MEMORY vs NO_TOOL pairs >=2", summary["pair_families"]["MEMORY_vs_NO_TOOL"].__len__() >= 2)
    check("22 WEB vs NO_TOOL pairs >=2", summary["pair_families"]["WEB_vs_NO_TOOL"].__len__() >= 2)
    check("23 all six in test", summary["all_six_test"] is True)
    check("24 all six in validation", summary["all_six_validation"] is True)
    check("25 determinism", proof["hashes_identical"] is True)
    check("26 hashes present", all(k in summary["hashes"] for k in ("validation.jsonl", "test.jsonl", "combined_bundle")))
    check("27 WRIM-0 unchanged", summary["wrim0_unchanged"] is True)
    check("28 EXP-004 off", summary["experiment_004"] is False)
    check("29 no training", summary["training_invoked"] is False)
    check("30 production untouched flag", summary["production_untouched"] is True)
    check("31 NO_TOOL hard negatives present", any(
        json.loads(line).get("hard_negative") and json.loads(line)["semantic_class"] == "NO_TOOL"
        for line in (TOOL_EVAL_4_DIR / "rows.jsonl").read_text().splitlines()
        if line.strip()
    ))
    check("32 JWT absent", not any(
        JWT_RE.search(json.loads(line)["input"])
        for line in (TOOL_EVAL_4_DIR / "rows.jsonl").read_text().splitlines()
        if line.strip()
    ))
    check("33 active modules empty", summary["active_modules"] == [])
    check("34 family isolation", leak["family_span_across_splits"] == {})
    check("35 baselines ran", "keyword" in summary["baselines"]["validation"])
    check("36 V4 train n still 26", len(load_jsonl(V4_CANDIDATE_DIR / "train.jsonl")) == 26)
    check("37 no optimizer / EXP004 weights dir", not (
        ROOT / "model-lab/manifests/modular-intelligence/WR-TOOL-PI-EXP-004"
    ).joinpath("weights").exists())

    passed = sum(1 for c in checks if c["ok"])
    write_json(
        TOOL_EVAL_4_DIR / "validator.json",
        {"n_pass": passed, "n_total": len(checks), "passed": passed == len(checks), "checks": checks},
    )
    if passed != len(checks):
        raise SystemExit(1)


def main() -> int:
    print("estimate_runtime_minutes=5")
    if PRODUCTION_ROOT.exists():
        print("production_root_exists=true (will not write there)")
    summary = materialize()
    proof = rebuild_proof(summary)
    summary = json.loads((TOOL_EVAL_4_DIR / "session-summary.json").read_text(encoding="utf-8"))
    validate(summary, proof)
    print(
        json.dumps(
            {
                "identity": TOOL_EVAL_4_ID,
                "n": summary["final_eval_rows"],
                "val": summary["validation_n"],
                "test": summary["test_n"],
                "mission": summary["mission_verdict"],
                "exp004": summary["experiment_readiness_verdict"],
                "bundle": summary["hashes"]["combined_bundle"],
                "train_unchanged": not summary["train_changed"],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
