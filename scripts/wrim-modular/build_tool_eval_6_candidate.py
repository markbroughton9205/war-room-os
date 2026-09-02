#!/usr/bin/env python3
"""Materialize WR-TOOL-EVAL-6-CANDIDATE. Held-out. Does not train. Does not touch V5."""
from __future__ import annotations

import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent / "wrim1-training"))
sys.path.insert(0, str(SCRIPT_DIR))

from capability_curriculum_lib import normalize_prompt  # noqa: E402
from eval6_cases import diagnostic_rows, six_way_rows  # noqa: E402
from exp004_support import CLASS_NAMES, CLASS_TO_ID, load_eval4_split, load_jsonl  # noqa: E402
from exp005_support import load_eval5_split, load_v5_train  # noqa: E402
from hashes import sha256_file  # noqa: E402
from paths import TOOL_EVAL_4_DIR, TOOL_EVAL_5_DIR, TOOL_EVAL_6_DIR, TOOL_EVAL_6_ID, V5_CANDIDATE_DIR, V5_TRAIN_HASH  # noqa: E402
from frozen_router_support import utcnow, write_json  # noqa: E402

SOURCE_TYPE = "TEST_FIXTURE"
HARD_PAIRS = {
    "WEB_vs_RESEARCH",
    "FILES_vs_MEMORY",
    "MEMORY_vs_NO_TOOL",
    "SHA256_vs_NO_TOOL",
    "WEB_vs_NO_TOOL",
    "FILES_vs_NO_TOOL",
    "RESEARCH_vs_NO_TOOL",
}


def eid(family_id: str, side: str, text: str) -> str:
    h = hashlib.sha256(f"{family_id}|{side}|{text}".encode()).hexdigest()[:20]
    return f"e6_{h}"


def gold_for(cls: str) -> dict[str, Any]:
    if cls == "NO_TOOL":
        return {"decision": "NO_TOOL", "tool_id": None, "arguments": {}}
    tool = {"WEB": "web", "MEMORY": "memory", "FILES": "files", "RESEARCH": "research", "SHA256": "sha256"}[cls]
    arg_key = "path" if cls == "FILES" else ("text" if cls == "SHA256" else "query")
    return {"decision": "TOOL", "tool_id": tool, "arguments": {arg_key: "eval6-semantic"}}


def finalize(raw: dict[str, Any], split: str) -> dict[str, Any]:
    cls = raw["semantic_class"]
    tags = list(raw.get("tags") or [])
    rec = {
        "example_id": eid(raw["family_id"], raw["pair_side"], raw["input"]),
        "input": raw["input"],
        "semantic_class": cls,
        "gold_class": cls if cls in CLASS_TO_ID else "NO_TOOL",
        "gold": gold_for(cls) if cls in CLASS_TO_ID else {"decision": "NO_TOOL", "tool_id": None, "arguments": {}},
        "family_id": raw["family_id"],
        "pair_kind": raw["pair_kind"],
        "pair_side": raw["pair_side"],
        "topic": raw["topic"],
        "counterfactual": raw["counterfactual"],
        "boundary_pair": raw["pair_kind"] if raw["pair_kind"] in HARD_PAIRS else "",
        "split": split,
        "lane": raw["lane"],
        "source_type": SOURCE_TYPE,
        "source_artifact": TOOL_EVAL_6_ID,
        "EXCLUDE_FROM_TRAINING": True,
        "EXCLUDE_FROM_EVAL_4": True,
        "EXCLUDE_FROM_EVAL_5": True,
        "privacy_classification": "development_lab",
        "quality_status": "SUPPORTED",
        "role": "routing_gold" if raw["lane"] == "SIX_WAY" else raw["lane"].lower(),
        "context_dependence": "CONTEXT_DEPENDENT" if "multi_turn" in tags or "Prior turn:" in raw["input"] else "STANDALONE",
        "tags": tags,
        "lexical_adversarial": "lexical_adversarial" in tags,
        "negation_trap": "negation_trap" in tags,
        "multi_turn": "multi_turn" in tags or raw["input"].startswith("Prior turn:"),
        "information_state": "information_state" in tags or "Prior turn:" in raw["input"],
        "execution_outcome": None,
        "argument_task": False,
    }
    if "abstention_codes" in raw:
        rec["abstention_codes"] = raw["abstention_codes"]
        rec["abstention_reason"] = raw["abstention_reason"]
    if "multi_tools" in raw:
        rec["multi_tools"] = raw["multi_tools"]
    return rec


def family_split(families: list[str], seed: bytes = b"eval6-family-split-v1") -> dict[str, str]:
    scored = []
    for fam in families:
        h = hashlib.sha256(seed + fam.encode()).hexdigest()
        scored.append((h, fam))
    scored.sort()
    assign: dict[str, str] = {}
    for i, (_, fam) in enumerate(scored):
        assign[fam] = "validation" if i % 2 == 0 else "test"
    return assign


def classes_ok(rows: list[dict[str, Any]]) -> bool:
    present = {r["semantic_class"] for r in rows}
    return all(c in present for c in CLASS_NAMES)


def repair_split(six: list[dict[str, Any]], assign: dict[str, str]) -> dict[str, str]:
    """Swap families until both splits have all six classes. Deterministic."""
    assign = dict(assign)
    by_fam = defaultdict(list)
    for r in six:
        by_fam[r["family_id"]].append(r)

    def split_rows(name: str) -> list[dict[str, Any]]:
        return [r for r in six if assign[r["family_id"]] == name]

    def missing(name: str) -> list[str]:
        have = {r["semantic_class"] for r in split_rows(name)}
        return [c for c in CLASS_NAMES if c not in have]

    # Try swapping a family that supplies a missing class.
    for _ in range(64):
        mv = missing("validation")
        mt = missing("test")
        if not mv and not mt:
            return assign
        target_split = "validation" if mv else "test"
        need = (mv or mt)[0]
        donor_split = "test" if target_split == "validation" else "validation"
        donors = sorted(
            fam
            for fam, rows in by_fam.items()
            if assign[fam] == donor_split and any(r["semantic_class"] == need for r in rows)
        )
        if not donors:
            raise RuntimeError(f"cannot supply {need} to {target_split}")
        assign[donors[0]] = target_split
    raise RuntimeError("split repair failed")


def overlap_report(eval_rows: list[dict[str, Any]]) -> dict[str, Any]:
    v5 = load_v5_train()
    e5 = load_eval5_split("validation") + load_eval5_split("test")
    e4 = load_eval4_split("validation") + load_eval4_split("test")

    def texts(rows: list[dict[str, Any]]) -> set[str]:
        return {r["input"] for r in rows}

    def norms(rows: list[dict[str, Any]]) -> set[str]:
        return {normalize_prompt(r["input"]) for r in rows}

    def fams(rows: list[dict[str, Any]]) -> set[str]:
        return {r["family_id"] for r in rows}

    def template(s: str) -> str:
        t = normalize_prompt(s)
        t = re.sub(r"\b\d+\b", "<N>", t)
        t = re.sub(r"[a-z0-9._-]{12,}", "<ID>", t)
        return t

    eval_main = [r for r in eval_rows if r["lane"] == "SIX_WAY"]
    out = {}
    for name, prior in (("v5_train", v5), ("eval5", e5), ("eval4", e4)):
        exact = texts(eval_main) & texts(prior)
        norm = norms(eval_main) & norms(prior)
        family = fams(eval_main) & fams(prior)
        tmpl_e = {template(r["input"]) for r in eval_main}
        tmpl_p = {template(r["input"]) for r in prior}
        tmpl = tmpl_e & tmpl_p
        # fact overlap: shared topic tokens of length >= 12 appearing as whole phrases in both
        facts = []
        prior_blob = " ".join(norms(prior))
        for r in eval_main:
            topic = normalize_prompt(r.get("topic") or "")
            if topic and len(topic) >= 8 and topic in prior_blob:
                facts.append({"example_id": r["example_id"], "topic": r["topic"]})
        out[name] = {
            "exact_overlap_n": len(exact),
            "exact_overlap": sorted(exact),
            "normalized_overlap_n": len(norm),
            "normalized_overlap": sorted(norm),
            "family_overlap_n": len(family),
            "family_overlap": sorted(family),
            "template_overlap_n": len(tmpl),
            "template_overlap_sample": sorted(tmpl)[:12],
            "underlying_fact_overlap_n": len(facts),
            "underlying_fact_overlap": facts[:12],
        }
    return out


def quality_audit(six: list[dict[str, Any]], diag: list[dict[str, Any]], leaks: dict[str, Any]) -> dict[str, Any]:
    counts = Counter(r["semantic_class"] for r in six)
    pair_counts = Counter(r["pair_kind"] for r in six)
    families = {r["family_id"] for r in six}
    pair_fams = defaultdict(set)
    for r in six:
        if r["pair_side"] in ("a", "b"):
            pair_fams[r["pair_kind"]].add(r["family_id"])
    issues = []
    if len(six) < 120:
        issues.append("below minimum 120")
    for c in CLASS_NAMES:
        if counts[c] < 20:
            issues.append(f"{c} below 20 ({counts[c]})")
    required_pair_n = {
        "WEB_vs_RESEARCH": 15,
        "FILES_vs_MEMORY": 15,
        "MEMORY_vs_NO_TOOL": 15,
        "SHA256_vs_NO_TOOL": 15,
        "WEB_vs_NO_TOOL": 15,
    }
    for k, n in required_pair_n.items():
        if len(pair_fams[k]) < n:
            issues.append(f"{k} families {len(pair_fams[k])} < {n}")
    for name, block in leaks.items():
        if block["exact_overlap_n"] or block["normalized_overlap_n"] or block["family_overlap_n"]:
            issues.append(f"leak vs {name}")
    lexical = [r for r in six if r["lexical_adversarial"]]
    traps = [r for r in six if r["negation_trap"]]
    mt = [r for r in six if r["multi_turn"]]
    info = [r for r in six if r["information_state"]]
    abst = [r for r in diag if r["lane"] == "ABSTENTION_DIAGNOSTIC"]
    multi = [r for r in diag if r["lane"] == "MULTI_TOOL_DIAGNOSTIC"]
    if not lexical:
        issues.append("no lexical adversarial")
    if not traps:
        issues.append("no negation traps")
    if not mt:
        issues.append("no multi-turn")
    if not info:
        issues.append("no information-state")
    if not abst:
        issues.append("no abstention")
    if not multi:
        issues.append("no multi-tool")
    val = [r for r in six if r["split"] == "validation"]
    test = [r for r in six if r["split"] == "test"]
    if not classes_ok(val) or not classes_ok(test):
        issues.append("class missing in a split")
    return {
        "ok": not issues,
        "issues": issues,
        "n_six_way": len(six),
        "n_validation": len(val),
        "n_test": len(test),
        "class_counts": dict(counts),
        "pair_kind_row_counts": dict(pair_counts),
        "pair_family_counts": {k: len(v) for k, v in pair_fams.items()},
        "n_families": len(families),
        "n_lexical_adversarial": len(lexical),
        "n_negation_trap": len(traps),
        "n_multi_turn": len(mt),
        "n_information_state": len(info),
        "n_abstention": len(abst),
        "n_multi_tool": len(multi),
        "provenance": {"TEST_FIXTURE": len(six) + len(diag), "REAL_RUNTIME": 0, "REAL_TEST": 0, "EVAL_SYNTHETIC": 0},
        "honest_label": "TEST_FIXTURE; not REAL_RUNTIME",
    }


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r, sort_keys=True, ensure_ascii=True) + "\n" for r in rows), encoding="utf-8")


def main() -> int:
    work = TOOL_EVAL_6_DIR
    work.mkdir(parents=True, exist_ok=True)
    raw_six = six_way_rows()
    families = sorted({r["family_id"] for r in raw_six})
    assign = repair_split(raw_six, family_split(families))
    six = [finalize(r, assign[r["family_id"]]) for r in raw_six]
    six.sort(key=lambda r: r["example_id"])
    diag = [finalize(r, "diagnostic") for r in diagnostic_rows()]
    diag.sort(key=lambda r: r["example_id"])
    val = [r for r in six if r["split"] == "validation"]
    test = [r for r in six if r["split"] == "test"]
    all_rows = six + diag
    leaks = overlap_report(all_rows)
    audit = quality_audit(six, diag, leaks)
    if not audit["ok"]:
        write_json(work / "quality-audit-FAIL.json", audit)
        raise RuntimeError(f"EVAL-6 quality audit failed: {audit['issues']}")

    write_jsonl(work / "rows.jsonl", all_rows)
    write_jsonl(work / "validation.jsonl", val)
    write_jsonl(work / "test.jsonl", test)
    write_jsonl(work / "abstention-diagnostic.jsonl", [r for r in diag if r["lane"] == "ABSTENTION_DIAGNOSTIC"])
    write_jsonl(work / "multi-tool-diagnostic.jsonl", [r for r in diag if r["lane"] == "MULTI_TOOL_DIAGNOSTIC"])
    write_jsonl(work / "lexical-adversarial.jsonl", [r for r in six if r["lexical_adversarial"]])
    write_jsonl(work / "negation-trap.jsonl", [r for r in six if r["negation_trap"]])
    write_jsonl(work / "multi-turn.jsonl", [r for r in six if r["multi_turn"]])
    write_jsonl(work / "information-state.jsonl", [r for r in six if r["information_state"]])

    pair_map = defaultdict(lambda: {"family_id": "", "members": [], "pair_kind": "", "split": ""})
    for r in six:
        m = pair_map[r["family_id"]]
        m["family_id"] = r["family_id"]
        m["pair_kind"] = r["pair_kind"]
        m["split"] = r["split"]
        m["members"].append({"example_id": r["example_id"], "side": r["pair_side"], "class": r["semantic_class"]})
    write_json(work / "matched-pair-map.json", dict(pair_map))
    cf_map = {}
    for fid, members in pair_map.items():
        sample = next(r for r in six if r["family_id"] == fid)
        cf_map[fid] = {
            "counterfactual": sample["counterfactual"],
            "pair_kind": sample["pair_kind"],
            "split": sample["split"],
            "classes": [m["class"] for m in members["members"]],
        }
    write_json(work / "counterfactual-map.json", cf_map)
    write_json(
        work / "hard-boundary-map.json",
        {k: [r["example_id"] for r in six if r["boundary_pair"] == k] for k in sorted(HARD_PAIRS)},
    )
    write_json(
        work / "family-map.json",
        {fid: [r["example_id"] for r in all_rows if r["family_id"] == fid] for fid in sorted({r["family_id"] for r in all_rows})},
    )
    write_json(
        work / "provenance.json",
        {
            "all_source_type": SOURCE_TYPE,
            "honest": True,
            "not_called_real": True,
            "counts": audit["provenance"],
        },
    )
    write_json(work / "leakage-audit.json", leaks)
    write_json(work / "quality-audit.json", audit)
    write_json(work / "class-map.json", {str(i): n for i, n in enumerate(CLASS_NAMES)})
    hashes = {
        "rows.jsonl": sha256_file(work / "rows.jsonl"),
        "validation.jsonl": sha256_file(work / "validation.jsonl"),
        "test.jsonl": sha256_file(work / "test.jsonl"),
        "v5_train.jsonl_frozen": V5_TRAIN_HASH,
        "eval5_dir": str(TOOL_EVAL_5_DIR),
        "eval4_dir": str(TOOL_EVAL_4_DIR),
        "v5_dir": str(V5_CANDIDATE_DIR),
    }
    blob = hashlib.sha256(
        (hashes["rows.jsonl"] + hashes["validation.jsonl"] + hashes["test.jsonl"]).encode()
    ).hexdigest()
    hashes["combined_bundle"] = blob
    write_json(work / "HASHES.json", hashes)
    write_json(
        work / "dataset-card.json",
        {
            "identity": TOOL_EVAL_6_ID,
            "purpose": "Harder semantic routing exam. Not a vehicle to raise WRIM scores.",
            "source_type": SOURCE_TYPE,
            "n_six_way": len(six),
            "n_validation": len(val),
            "n_test": len(test),
            "n_diagnostic": len(diag),
            "held_out": True,
            "do_not_train": True,
            "family_isolated_split": True,
        },
    )
    write_json(
        work / "MANIFEST.json",
        {
            "identity": TOOL_EVAL_6_ID,
            "HELD_OUT": True,
            "created_at": utcnow(),
            "hashes": hashes,
            "quality_ok": True,
            "do_not_train_wrim": True,
        },
    )
    print(json.dumps({"identity": TOOL_EVAL_6_ID, "n_six": len(six), "val": len(val), "test": len(test), "audit": audit["ok"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
