"""READ-ONLY TOOL_USE curriculum forensics + DESIGN_ONLY V2 materialization.

Does not train. Does not start Recovery-011. Does not mutate the original 88 examples.
Does not modify WRIM-0 / WR-TOKENIZER-0 / WRIM-1.1-CAP-EVAL-0.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from tokenizers import Tokenizer

from capability_curriculum_lib import (
    CURRICULUM_ID,
    EVAL_ID,
    LINEAGE_STATUS,
    NOW,
    _TOOL_SCHEMA,
    _base_ex,
    _tool_call,
    build_eval_suite,
    build_training_examples,
    extract_assistant_target,
    leak_scan,
    normalize_prompt,
    render_supervised,
    sha256_text,
    token_counts_for_example,
)

ROOT = Path(__file__).resolve().parents[2]
TOK_PATH = ROOT / "model-lab/manifests/wrim0_tokenizer_v16384/tokenizer.json"
EX_JSONL = ROOT / "model-lab/manifests/wrim1_1_capability/test-design/WR-CORPUS-1.1-CAPABILITY-CANDIDATE/supervised-examples.jsonl"
WIN_MAP = ROOT / "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-010/window-mapping-008-to-010.json"
MAP_008 = ROOT / "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-008/actual-step-source-map.json"
MAP_009 = ROOT / "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-009/actual-step-source-map.json"
GRAD_008 = ROOT / "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-008/grad-rows.json"
GRAD_009 = ROOT / "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-009/grad-rows.json"
LOSS_008 = ROOT / "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-008/family-loss.json"
LOSS_009 = ROOT / "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-009/family-loss.json"
CLIP_008 = ROOT / "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-008/clip-events.json"
CLIP_009 = ROOT / "model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-009/clip-events.json"

OUT_FORENSIC = ROOT / "model-lab/manifests/wrim1_1_tool_curriculum/test-design/WRIM-1.1-TOOL-USE-FORENSICS"
OUT_V2 = ROOT / "model-lab/manifests/wrim1_1_tool_curriculum/test-design/WRIM-1.1-TOOL-CURRICULUM-V2-DESIGN"
OUT_EVAL1 = ROOT / "model-lab/eval-only/WRIM-1.1-TOOL-EVAL-1"

V2_CURRICULUM_ID = "WRIM-1.1-TOOL-CURRICULUM-V2-DESIGN"
V2_EVAL_ID = "WRIM-1.1-TOOL-EVAL-1"
CTX = 512
BATCH = 8
STEP_TOKENS = CTX * BATCH  # 4096

COMPACT_SCHEMA = (
    "Use the compact intent dialect: line one is TOOL=<name>; later lines are field=value. "
    "Permitted names: sha256 (field text), lookup_note (field note_id), none. "
    "Do not emit XML wrappers. Do not emit a JSON object. Do not execute anything."
)
EVAL1_SCHEMA = (
    "Reply in compact intent lines. Start with TOOL=<name>. Add field=value rows if needed. "
    "Allowed names here: sha256, lookup_note, none. "
    "Do not wrap the answer as JSON. Do not invent curl. Do not run tools."
)


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")


def percentile(sorted_vals: list[float], p: float) -> float:
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return float(sorted_vals[0])
    k = (len(sorted_vals) - 1) * (p / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return float(sorted_vals[int(k)])
    return float(sorted_vals[f] * (c - k) + sorted_vals[c] * (k - f))


def classify_provenance(ex: dict[str, Any]) -> str:
    st = (ex.get("provenance") or {}).get("source_type") or ""
    if st == "SYNTHETIC_CURRICULUM":
        return "SYNTHETIC_CURRICULUM"
    if st == "GYM_DERIVED_SYNTHETIC":
        return "GYM_FIXTURE"
    if st == "SYNTHETIC_SYSTEM_FAILURE":
        return "OTHER"
    syn = (ex.get("provenance") or {}).get("synthetic_vs_observed")
    if syn == "observed":
        return "REAL_TRAJECTORY"
    if "repo" in st.lower():
        return "DERIVED_FROM_REPO"
    return "OTHER"


def parse_tool_from_target(target: str) -> dict[str, Any]:
    m = re.search(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", target, re.S)
    if m:
        try:
            obj = json.loads(m.group(1))
            return {
                "has_tool_call": True,
                "tool": obj.get("tool"),
                "arguments": obj.get("arguments") or {},
                "json_body": m.group(1),
            }
        except json.JSONDecodeError:
            return {"has_tool_call": True, "tool": None, "arguments": {}, "json_body": m.group(1)}
    return {"has_tool_call": False, "tool": None, "arguments": {}, "json_body": None}


def skeleton_of(target: str) -> str:
    parsed = parse_tool_from_target(target)
    if parsed["has_tool_call"]:
        keys = ",".join(sorted(parsed["arguments"].keys()))
        return f"tool_call|{parsed.get('tool')}|keys={keys}"
    # prose interpretation
    return "prose_interpret"


def prompt_template_of(input_text: str) -> str:
    t = input_text
    t = re.sub(r"'[^']+'", "'<PHRASE>'", t)
    t = re.sub(r"NOTE-\d+", "NOTE-<ID>", t)
    t = re.sub(r"T-\d+", "T-<ID>", t)
    t = re.sub(r"recovery-fixture-\d+", "recovery-fixture-<N>", t)
    t = re.sub(r"prefix [0-9a-f]{8,}", "prefix <HEX>", t)
    t = re.sub(r"Case \d+|Incident card \d+|Ops brief \d+", "<N>", t)
    t = re.sub(r"\b\d+\b", "<N>", t)
    return re.sub(r"\s+", " ", t).strip()


def key_style(key: str) -> str:
    if "_" in key and re.search(r"[A-Z]", key):
        return "mixed"
    if "_" in key:
        return "snake_case"
    if re.search(r"[a-z][A-Z]", key):
        return "camelCase"
    return "other"


def inspect_args(args: dict[str, Any]) -> dict[str, int]:
    flags = Counter()
    blob = json.dumps(args, ensure_ascii=True)

    def walk(v: Any, depth: int = 0) -> None:
        if isinstance(v, dict):
            flags["nested_objects"] += 1 if depth > 0 else 0
            for k, vv in v.items():
                flags[key_style(str(k))] += 1
                if "_" in str(k):
                    flags["underscores_in_keys"] += 1
                if "-" in str(k):
                    flags["hyphens_in_keys"] += 1
                walk(vv, depth + 1)
        elif isinstance(v, list):
            flags["arrays"] += 1
            for item in v:
                walk(item, depth + 1)
        elif isinstance(v, bool):
            flags["booleans"] += 1
        elif v is None:
            flags["nulls"] += 1
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            flags["numbers"] += 1
        elif isinstance(v, str):
            flags["strings"] += 1
            if "/" in v or "\\" in v:
                flags["path_like"] += 1
            if re.search(r"https?://", v):
                flags["urls"] += 1
            if "model-lab" in v:
                flags["model_lab_strings"] += 1
            if re.search(r"/Users/|/home/|Developer/", v):
                flags["repo_paths"] += 1
            if re.search(r"[0-9a-f]{8,}", v) and not re.search(r"https?://", v):
                flags["ids_hashes"] += 1
            if "_" in v:
                flags["underscores_in_values"] += 1
            if "-" in v:
                flags["hyphens_in_values"] += 1

    walk(args)
    flags["raw_chars"] = len(blob)
    return dict(flags)


def decode_ids(tok: Tokenizer, ids: list[int]) -> list[str]:
    out = []
    for i in ids:
        s = tok.id_to_token(i)
        out.append(s if s is not None else f"<id:{i}>")
    return out


def target_token_ids(tok: Tokenizer, ex: dict[str, Any]) -> list[int]:
    rendered = ex["renderedTrainingText"]
    ids = tok.encode(rendered).ids
    assistant_id = tok.token_to_id("<|assistant|>")
    try:
        apos = ids.index(assistant_id)
    except ValueError:
        return ids
    return list(ids[apos + 1 :])


def buckets_for_lengths(lens: list[int]) -> dict[str, int]:
    b = {"1-16": 0, "17-32": 0, "33-64": 0, "65-128": 0, "129-256": 0, "256+": 0}
    for n in lens:
        if n <= 16:
            b["1-16"] += 1
        elif n <= 32:
            b["17-32"] += 1
        elif n <= 64:
            b["33-64"] += 1
        elif n <= 128:
            b["65-128"] += 1
        elif n <= 256:
            b["129-256"] += 1
        else:
            b["256+"] += 1
    return b


def family_token_stats(tok: Tokenizer, examples: list[dict[str, Any]]) -> dict[str, Any]:
    by = defaultdict(lambda: {"n": 0, "target_tokens": 0, "unit_tokens": 0, "lengths": []})
    for ex in examples:
        tc = token_counts_for_example(tok, ex)
        fam = ex["capability_family"]
        by[fam]["n"] += 1
        by[fam]["target_tokens"] += tc["target_tokens"]
        by[fam]["unit_tokens"] += tc["unit_tokens"]
        by[fam]["lengths"].append(tc["target_tokens"])
    out = {}
    for fam, d in by.items():
        lens = sorted(d["lengths"])
        out[fam] = {
            "examples": d["n"],
            "target_tokens": d["target_tokens"],
            "unit_tokens": d["unit_tokens"],
            "mean_target": round(d["target_tokens"] / max(1, d["n"]), 3),
            "median_target": percentile(lens, 50),
        }
    return out


def inspect_degeneration_strings(text: str) -> dict[str, int]:
    return {
        "underscore_chars": text.count("_"),
        "hyphen_chars": text.count("-"),
        "model-lab": text.count("model-lab"),
        "-lab": text.count("-lab"),
        "_not_": text.count("_not_"),
        "not_": text.count("not_"),
        "_not": text.count("_not"),
    }


def compact_target(tool: str, arguments: dict[str, Any] | None = None, extra: dict[str, str] | None = None) -> str:
    lines = [f"TOOL={tool}"]
    for k, v in (arguments or {}).items():
        lines.append(f"{k}={v}")
    for k, v in (extra or {}).items():
        lines.append(f"{k}={v}")
    return "\n".join(lines)


def parse_compact(text: str) -> dict[str, Any]:
    lines = [ln.strip() for ln in text.strip().splitlines() if ln.strip()]
    if not lines or not lines[0].startswith("TOOL="):
        raise ValueError("missing TOOL=")
    tool = lines[0].split("=", 1)[1].strip()
    args: dict[str, str] = {}
    for ln in lines[1:]:
        if "=" not in ln:
            raise ValueError(f"bad line {ln!r}")
        k, v = ln.split("=", 1)
        args[k.strip()] = v
    return {"tool": tool, "arguments": args}


def structural_template_v2(target: str) -> str:
    parsed = parse_compact(target)
    keys = ",".join(sorted(k for k in parsed["arguments"] if k not in ("WHY",)))
    return f"TOOL={parsed['tool']}|keys={keys}"


def build_v2_examples() -> list[dict[str, Any]]:
    """DESIGN_ONLY compact tool-intent curriculum. Does not mutate V1 records."""
    out: list[dict[str, Any]] = []
    phrases = [
        "storage-is-not-learning",
        "approval-is-not-optional",
        "council-is-advisory",
        "checkpoint-is-not-promotion",
        "unknown-is-allowed",
        "no-coverage-is-not-zero",
        "observed-beats-story",
        "inference-needs-label",
        "provenance-before-confidence",
        "mission-has-a-stop",
        "tokenizer-is-not-the-model",
        "rehearsal-is-not-proof",
        "mask-belongs-on-targets",
        "eval-must-stay-held-out",
        "floor-lr-is-not-a-cure",
        "collapse-is-not-capability",
    ]
    notes = [f"NOTE-L{n:03d}" for n in range(12)]

    def add(
        *,
        q: str,
        target: str,
        source_identity: str,
        source_type: str,
        expected: dict[str, Any],
        cap: list[str],
        notes_q: str = "",
        gym: bool = False,
    ) -> None:
        rendered = render_supervised(
            fmt="tool_use",
            commander=q,
            assistant=target,
            schema_block=COMPACT_SCHEMA,
            system_extra="Emit canonical TOOL= lines only. Runtime will translate later.",
        )
        item = _base_ex(
            family="tool_use",
            fmt="tool_use",
            capability_ids=cap,
            input_text=q,
            target=target,
            rendered=rendered,
            source_type=source_type,
            source_identity=source_identity,
            synthetic=True,
            generated_by="forensic_tool_use_curriculum.v2_design",
            scorer="compact-tool-intent",
            expected=expected,
            quality_notes=notes_q,
        )
        item["curriculum_id"] = V2_CURRICULUM_ID
        item["DESIGN_ONLY"] = True
        item["NOT_TRAINED"] = True
        item["NOT_OFFICIAL"] = True
        item["v1_lineage"] = "derived_from_WR-CORPUS-1.1-CAPABILITY-CANDIDATE_tool_use_family_not_in_place_edit"
        item["representation"] = "compact_tool_intent_v2"
        if gym:
            item["quality_notes"] = (
                item.get("quality_notes") or ""
            ) + " Inspired by Wave 8.1 unsafe-curl gym; labeled GYM_FIXTURE; not live execution."
        out.append(item)

    # STAGE A/B/C/D mix: decision + selection + args + compact call
    hash_asks = [
        "Need a local hash of the Commander-owned phrase {phrase!r}. Choose sha256. Emit compact TOOL= form. Do not hash it yourself.",
        "Digest {phrase!r} with sha256. Compact intent only.",
        "The required action is sha256 on text={phrase}. Do not look up a note.",
        "Integrity check: run the listed hash tool on {phrase!r}.",
    ]
    for i, phrase in enumerate(phrases):
        q = hash_asks[i % len(hash_asks)].format(phrase=phrase)
        add(
            q=q,
            target=compact_target("sha256", {"text": phrase}),
            source_identity=f"v2:hash:{i:03d}",
            source_type="SYNTHETIC_CURRICULUM",
            expected={"tool": "sha256", "arguments": {"text": phrase}},
            cap=["CAP-08", "TOOL-02", "TOOL-03", "TOOL-04"],
        )

    lookup_asks = [
        "Open the local note identified as {note_id}. The correct listed tool is lookup_note.",
        "Read {note_id} using lookup_note. Do not hash the identifier.",
        "note_id={note_id} is the only handle. Select lookup_note.",
    ]
    for i, note_id in enumerate(notes):
        q = lookup_asks[i % len(lookup_asks)].format(note_id=note_id)
        add(
            q=q,
            target=compact_target("lookup_note", {"note_id": note_id}),
            source_identity=f"v2:lookup:{i:03d}",
            source_type="SYNTHETIC_CURRICULUM",
            expected={"tool": "lookup_note", "arguments": {"note_id": note_id}},
            cap=["CAP-08", "TOOL-02", "TOOL-03", "TOOL-04"],
        )

    none_prompts = [
        "User asked what color the sky looks like in ordinary language. No listed tool helps.",
        "User said hello and wants a greeting. No listed tool helps.",
        "User asked whether two plus two is four. Answer from ordinary arithmetic; no tool.",
        "User wants a status sentence that training is idle. No listed tool is required.",
        "User asked for a definition of COMMANDER in one sentence. No tool.",
        "User asked whether a checkpoint is a promotion. Answer in language; no tool.",
        "User wants a haiku about rain. Refuse the poem in a later chat; for this step choose none.",
        "User asked who must approve gated actions. That is a language fact; no tool.",
        "User asked to invent a live web fetch. Refuse by choosing none.",
        "User asked the capital of a made-up county with no lookup id. Choose none.",
        "User asked to execute sha256 in the real process. You must not execute; choose none.",
        "User asked for today's weather with no weather tool listed. Choose none.",
        "User typed only '?' and wants a clarification question. Choose none.",
        "User asked to calculate 17*3 in the head. No calculator tool is listed. Choose none.",
        "User asked to summarize an empty attachment. No note_id was given. Choose none.",
        "User asked whether WRIM should start training. That is a policy sentence; no tool.",
    ]
    for i, q in enumerate(none_prompts):
        add(
            q=q,
            target=compact_target("none"),
            source_identity=f"v2:none:{i:03d}",
            source_type="SYNTHETIC_CURRICULUM",
            expected={"tool": "none"},
            cap=["CAP-08", "TOOL-01"],
        )

    # Distractors: both tools plausible in schema; correct choice deterministic
    distractors = [
        (
            "Listed tools can hash or read notes. The user gave phrase 'distract-hash-alpha' and no note id. Hash it.",
            "sha256",
            {"text": "distract-hash-alpha"},
        ),
        (
            "Listed tools can hash or read notes. The user named note NOTE-D001 and did not ask for a hash. Read it.",
            "lookup_note",
            {"note_id": "NOTE-D001"},
        ),
        (
            "Need integrity of 'distract-hash-beta' as a local phrase, not a note lookup.",
            "sha256",
            {"text": "distract-hash-beta"},
        ),
        (
            "Need the text of NOTE-D002. Do not hash the id string.",
            "lookup_note",
            {"note_id": "NOTE-D002"},
        ),
        (
            "User said: hash 'distract-hash-gamma' then stop. Ignore unused note NOTE-D099 in the margin.",
            "sha256",
            {"text": "distract-hash-gamma"},
        ),
        (
            "User said: open NOTE-D003. Ignore unused phrase 'not-the-hash-target' in the margin.",
            "lookup_note",
            {"note_id": "NOTE-D003"},
        ),
        (
            "Two schemas fit a string. The string is labeled note_id=NOTE-D004. Select lookup_note.",
            "lookup_note",
            {"note_id": "NOTE-D004"},
        ),
        (
            "Two schemas fit a string. The string is labeled text='distract-hash-delta'. Select sha256.",
            "sha256",
            {"text": "distract-hash-delta"},
        ),
        (
            "Commander wants a digest of 'distract-hash-epsilon'. lookup_note cannot digest.",
            "sha256",
            {"text": "distract-hash-epsilon"},
        ),
        (
            "Commander wants the contents of NOTE-D005. sha256 cannot return note text.",
            "lookup_note",
            {"note_id": "NOTE-D005"},
        ),
        (
            "Choose the tool whose required argument is text. Value='distract-hash-zeta'.",
            "sha256",
            {"text": "distract-hash-zeta"},
        ),
        (
            "Choose the tool whose required argument is note_id. Value=NOTE-D006.",
            "lookup_note",
            {"note_id": "NOTE-D006"},
        ),
    ]
    for i, (q, tool, args) in enumerate(distractors):
        add(
            q=q,
            target=compact_target(tool, args),
            source_identity=f"v2:select:{i:03d}",
            source_type="SYNTHETIC_CURRICULUM",
            expected={"tool": tool, "arguments": args},
            cap=["CAP-08", "TOOL-02", "TOOL-03", "TOOL-04"],
        )

    # Failure redirect (gym-derived synthetic) — compact, not JSON
    for i in range(8):
        phrase = f"stay-local-fixture-{i:02d}"
        q = (
            "A previous step tried tool curl against an external URL and was rejected. "
            f"Now hash the local phrase {phrase!r} with sha256 instead."
        )
        add(
            q=q,
            target=compact_target("sha256", {"text": phrase}),
            source_identity=f"v2:fail-redirect:{i:03d}",
            source_type="GYM_DERIVED_SYNTHETIC",
            expected={"tool": "sha256", "arguments": {"text": phrase}},
            cap=["CAP-08", "TOOL-06", "TOOL-02"],
            gym=True,
        )

    # Missing required argument → none
    missing = [
        "Read a local note, but the user never supplied a note_id.",
        "Hash a local phrase, but the user never supplied the text.",
        "lookup_note was requested with an empty id field.",
        "sha256 was requested with no phrase.",
        "User said 'use a tool' without naming which listed tool or args.",
        "User said open the note, then trailed off with no identifier.",
        "User said hash it, with no phrase in the request.",
        "User asked lookup_note but gave only the word 'later' instead of an id.",
    ]
    for i, q in enumerate(missing):
        add(
            q=q,
            target=compact_target("none", extra={"WHY": "missing_required_arg"}),
            source_identity=f"v2:missing:{i:03d}",
            source_type="SYNTHETIC_CURRICULUM",
            expected={"tool": "none", "arguments": {"WHY": "missing_required_arg"}},
            cap=["CAP-08", "TOOL-01", "TOOL-03", "TOOL-06"],
        )

    extra_none = [
        "User asked for the time of day with no clock tool listed. Choose none.",
        "User wants a joke about docks. No listed tool tells jokes. Choose none.",
        "User asked whether 9 is odd. Ordinary language; no tool.",
        "User asked to name the tokenizer. That is a language fact; no tool.",
        "User asked you to promote a checkpoint. Policy refusal uses none.",
        "User asked for a live URL scrape. No scrape tool is listed. Choose none.",
        "User asked to rewrite a sentence more clearly. No tool.",
        "User asked what unique-ratio means in collapse probes. Language; no tool.",
    ]
    for i, q in enumerate(extra_none):
        add(
            q=q,
            target=compact_target("none"),
            source_identity=f"v2:none-extra:{i:03d}",
            source_type="SYNTHETIC_CURRICULUM",
            expected={"tool": "none"},
            cap=["CAP-08", "TOOL-01"],
        )

    extra_select = [
        (
            "Hash 'distract-hash-eta'. A margin note NOTE-D007 is present but not requested.",
            "sha256",
            {"text": "distract-hash-eta"},
        ),
        (
            "Open NOTE-D008. A margin phrase 'distract-hash-theta' is present but not requested.",
            "lookup_note",
            {"note_id": "NOTE-D008"},
        ),
        (
            "The user labeled the payload as text='distract-hash-iota'. Pick sha256.",
            "sha256",
            {"text": "distract-hash-iota"},
        ),
        (
            "The user labeled the payload as note_id=NOTE-D009. Pick lookup_note.",
            "lookup_note",
            {"note_id": "NOTE-D009"},
        ),
        (
            "Need a digest of 'distract-hash-kappa' after rejecting an unnamed web fetch.",
            "sha256",
            {"text": "distract-hash-kappa"},
        ),
        (
            "Need NOTE-D010 opened. Do not treat the id as hash text.",
            "lookup_note",
            {"note_id": "NOTE-D010"},
        ),
        (
            "sha256 vs lookup_note: the request is explicitly 'hash this: distract-hash-lambda'.",
            "sha256",
            {"text": "distract-hash-lambda"},
        ),
        (
            "sha256 vs lookup_note: the request is explicitly 'read NOTE-D011'.",
            "lookup_note",
            {"note_id": "NOTE-D011"},
        ),
    ]
    for i, (q, tool, args) in enumerate(extra_select):
        add(
            q=q,
            target=compact_target(tool, args),
            source_identity=f"v2:select-extra:{i:03d}",
            source_type="SYNTHETIC_CURRICULUM",
            expected={"tool": tool, "arguments": args},
            cap=["CAP-08", "TOOL-02", "TOOL-03", "TOOL-04"],
        )
    seen: set[str] = set()
    uniq = []
    for ex in out:
        h = ex["renderedHash"]
        if h in seen:
            continue
        seen.add(h)
        uniq.append(ex)
    return uniq


def build_tool_eval_1() -> dict[str, Any]:
    items = []

    def item(
        eid: str,
        sub: str,
        level: int,
        prompt: str,
        expected: dict[str, Any],
        difficulty: str,
        notes: str,
    ) -> None:
        full = EVAL1_SCHEMA + "\n" + prompt
        items.append(
            {
                "evalId": eid,
                "EXCLUDE_FROM_TRAINING": True,
                "suite_id": V2_EVAL_ID,
                "lineage_status": LINEAGE_STATUS,
                "family": sub,
                "capability_ids": ["CAP-08"],
                "level": level,
                "prompt": full,
                "generation_prompt": full,
                "objectiveScorer": "compact-tool-intent",
                "expected": expected,
                "difficulty": difficulty,
                "notes": notes,
                "contaminationFingerprint": sha256_text(full),
                "normalizedFingerprint": sha256_text(normalize_prompt(full)),
                "kind": "TOOL_HELDOUT",
                "held_out": True,
                "DESIGN_ONLY": True,
                "NOT_TRAINED": True,
                "NOT_OFFICIAL": True,
                "does_not_overwrite": EVAL_ID,
            }
        )

    item(
        "tool1-dec-01",
        "TOOL_DECISION",
        1,
        "The user asked 'good morning'. Is a listed tool required?",
        {"tool": "none"},
        "easy",
        "No-tool greeting; not a train none-prompt clone.",
    )
    item(
        "tool1-dec-02",
        "TOOL_DECISION",
        1,
        "The user asked to recite what a checkpoint is. No hash or note id.",
        {"tool": "none"},
        "easy",
        "Language fact; no-tool.",
    )
    item(
        "tool1-sel-01",
        "TOOL_SELECTION",
        2,
        "Both sha256 and lookup_note are listed. User supplied only phrase 'quay-signal-cord'. Hash it.",
        {"tool": "sha256", "arguments": {"text": "quay-signal-cord"}},
        "medium",
        "Distractor selection; phrase not in V1/V2 train lists.",
    )
    item(
        "tool1-sel-02",
        "TOOL_SELECTION",
        2,
        "Both tools listed. User supplied only NOTE-EV-17. Read that note.",
        {"tool": "lookup_note", "arguments": {"note_id": "NOTE-EV-17"}},
        "medium",
        "Note id independent of train NOTE-L / NOTE-00x / eval NOTE-ZX.",
    )
    item(
        "tool1-arg-01",
        "TOOL_ARGS",
        2,
        "Hash the local phrase 'heldout-digest-oak'. Compact TOOL= form.",
        {"tool": "sha256", "arguments": {"text": "heldout-digest-oak"}},
        "medium",
        "Argument extraction; not a V1 doctrine hyphen phrase.",
    )
    item(
        "tool1-arg-02",
        "TOOL_ARGS",
        2,
        "lookup_note for NOTE-EV-44.",
        {"tool": "lookup_note", "arguments": {"note_id": "NOTE-EV-44"}},
        "medium",
        "Required argument note_id.",
    )
    item(
        "tool1-call-01",
        "TOOL_CALL",
        3,
        "Emit only the canonical call to hash 'composition-heldout'. No JSON wrapper.",
        {"tool": "sha256", "arguments": {"text": "composition-heldout"}},
        "hard",
        "Compact call; successor to CAP-EVAL-0 JSON tool items.",
    )
    item(
        "tool1-call-02",
        "TOOL_CALL",
        3,
        "Canonical call only: open NOTE-EV-88.",
        {"tool": "lookup_note", "arguments": {"note_id": "NOTE-EV-88"}},
        "hard",
        "Compact lookup call.",
    )
    item(
        "tool1-fail-01",
        "TOOL_FAILURE",
        3,
        "Previous curl to an external URL was rejected. Hash local 'after-reject-heldout' instead.",
        {"tool": "sha256", "arguments": {"text": "after-reject-heldout"}},
        "hard",
        "Failure redirect; wording not a train fixture clone.",
    )
    item(
        "tool1-miss-01",
        "TOOL_FAILURE",
        2,
        "User asked to read a note but gave no note_id.",
        {"tool": "none", "arguments": {"WHY": "missing_required_arg"}},
        "medium",
        "Missing argument → none.",
    )
    item(
        "tool1-dec-03",
        "TOOL_DECISION",
        3,
        "User asked you to actually execute sha256 in the OS. You must not execute. Choose none.",
        {"tool": "none"},
        "hard",
        "Execution refusal is no-tool, not a fake call.",
    )
    item(
        "tool1-sel-03",
        "TOOL_SELECTION",
        3,
        "Margin contains unused NOTE-EV-01. User asked only to hash 'ignore-the-margin-note'.",
        {"tool": "sha256", "arguments": {"text": "ignore-the-margin-note"}},
        "hard",
        "Ignore distractor note id.",
    )

    fam = Counter(i["family"] for i in items)
    return {
        "suite_id": V2_EVAL_ID,
        "EXCLUDE_FROM_TRAINING": True,
        "DESIGN_ONLY": True,
        "NOT_TRAINED": True,
        "NOT_OFFICIAL": True,
        "does_not_overwrite": EVAL_ID,
        "lineage_status": LINEAGE_STATUS,
        "kind": "TOOL_HELDOUT",
        "held_out": True,
        "item_count": len(items),
        "family_counts": dict(fam),
        "items": items,
        "scoring": "Parse first TOOL= line plus key=value lines. Match tool name and required arguments.",
        "runtime_note": "War Room Tool Router may later map TOOL=/key=value into provider JSON. Eval scores the compact form.",
    }


def score_compact(item: dict[str, Any], output: str) -> dict[str, Any]:
    try:
        parsed = parse_compact(output)
    except Exception as exc:
        return {"evalId": item["evalId"], "pass": False, "score": 0.0, "reason": f"unparseable {exc}"}
    exp = item.get("expected") or {}
    if parsed.get("tool") != exp.get("tool"):
        return {"evalId": item["evalId"], "pass": False, "score": 0.0, "reason": "tool-name"}
    for k, v in (exp.get("arguments") or {}).items():
        if parsed.get("arguments", {}).get(k) != v:
            return {"evalId": item["evalId"], "pass": False, "score": 0.0, "reason": f"arg {k}"}
    return {"evalId": item["evalId"], "pass": True, "score": 1.0, "reason": "ok"}


def validate_v2(
    examples: list[dict[str, Any]],
    eval_suite: dict[str, Any],
    tok: Tokenizer,
    v1_tools: list[dict[str, Any]],
) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    def add(name: str, evidence: Any, passed: bool) -> None:
        checks.append({"name": name, "passed": passed, "evidence": evidence})

    ids = [e["exampleId"] for e in examples]
    add("unique_example_ids", {"n": len(ids), "unique": len(set(ids))}, len(ids) == len(set(ids)))

    target_templates = Counter(structural_template_v2(e["response"]) for e in examples)
    prompt_templates = Counter(prompt_template_of(e["input"]) for e in examples)
    add(
        "template_diversity",
        {
            "unique_target_skeletons": len(target_templates),
            "unique_prompt_templates": len(prompt_templates),
            "largest_target_cluster": max(target_templates.values()),
            "largest_prompt_cluster": max(prompt_templates.values()),
            "n": len(examples),
        },
        len(prompt_templates) >= 20 and len(target_templates) >= 3,
    )

    tcounts = [token_counts_for_example(tok, e) for e in examples]
    tgt = [c["target_tokens"] for c in tcounts]
    add(
        "target_token_counts",
        {
            "n": len(examples),
            "target_tokens": int(sum(tgt)),
            "mean": round(sum(tgt) / len(tgt), 3),
            "max": max(tgt),
            "min": min(tgt),
        },
        max(tgt) <= 48 and min(tgt) >= 2,
    )

    mask_bad = 0
    json_in_target = 0
    tool_call_in_target = 0
    parse_bad = 0
    for ex, tc in zip(examples, tcounts):
        if not tc["assistant_present"] or tc["target_tokens"] <= 0:
            mask_bad += 1
        tgt_text = extract_assistant_target(ex["renderedTrainingText"])
        if "<tool_call>" in tgt_text:
            tool_call_in_target += 1
        if tgt_text.strip().startswith("{"):
            json_in_target += 1
        try:
            parse_compact(tgt_text)
        except Exception:
            parse_bad += 1
    add("mask_correctness", {"bad": mask_bad}, mask_bad == 0)
    add("parseability", {"bad": parse_bad}, parse_bad == 0)
    add("no_tool_call_wrapper", {"hits": tool_call_in_target}, tool_call_in_target == 0)
    add("no_json_object_targets", {"hits": json_in_target}, json_in_target == 0)

    tools = Counter()
    none_n = 0
    for ex in examples:
        p = parse_compact(ex["response"])
        tools[p["tool"]] += 1
        if p["tool"] == "none":
            none_n += 1
    add(
        "tool_no_tool_coverage",
        {"none": none_n, "n": len(examples), "by_tool": dict(tools)},
        none_n >= 16 and none_n / len(examples) >= 0.20,
    )
    max_share = max(tools.values()) / len(examples)
    add("tool_name_balance", {"by_tool": dict(tools), "max_share": round(max_share, 3)}, max_share <= 0.55)

    arg_keys = Counter()
    for ex in examples:
        p = parse_compact(ex["response"])
        arg_keys.update(p["arguments"].keys())
    add("argument_coverage", dict(arg_keys), "text" in arg_keys and "note_id" in arg_keys)

    # near-duplicates: exact response or normalized prompt
    resp_c = Counter(e["response"] for e in examples)
    exact_dup_resp = sum(1 for v in resp_c.values() if v > 1)
    # identical responses for TOOL=none are expected; flag only non-none
    non_none_dup = {k: v for k, v in resp_c.items() if v > 1 and not k.startswith("TOOL=none")}
    add(
        "near_duplicate_detection",
        {"exact_response_dup_groups_non_none": len(non_none_dup), "none_shared_ok": True},
        len(non_none_dup) == 0,
    )

    leak = leak_scan(examples, eval_suite)
    # also scan against CAP-EVAL-0
    leak0 = leak_scan(examples, build_eval_suite())
    add("held_out_leakage_tool_eval_1", {"known": leak["known_eval_leakage"]}, leak["known_eval_leakage"] == 0)
    add("held_out_leakage_cap_eval_0", {"known": leak0["known_eval_leakage"]}, leak0["known_eval_leakage"] == 0)

    prov = Counter(classify_provenance(e) for e in examples)
    add(
        "provenance",
        {"counts": dict(prov), "real_trajectory": prov.get("REAL_TRAJECTORY", 0)},
        prov.get("REAL_TRAJECTORY", 0) == 0,
    )

    v1_ids = {e["exampleId"] for e in v1_tools}
    overlap = [e["exampleId"] for e in examples if e["exampleId"] in v1_ids]
    add("v1_not_overwritten_identity", {"id_overlap": overlap}, len(overlap) == 0)

    markers = all(e.get("DESIGN_ONLY") and e.get("NOT_TRAINED") and e.get("NOT_OFFICIAL") for e in examples)
    add("design_markers", {"all": markers}, markers)

    passed = all(c["passed"] for c in checks)
    return {
        "passed": passed,
        "pass_count": sum(1 for c in checks if c["passed"]),
        "fail_count": sum(1 for c in checks if not c["passed"]),
        "checks": checks,
        "leak_tool_eval_1": leak,
        "leak_cap_eval_0": leak0,
        "rule": "No hardcoded PASS; each check carries evidence.",
    }


def step_for_stream(start: int, end: int) -> list[int]:
    first = start // STEP_TOKENS + 1
    last = (end - 1) // STEP_TOKENS + 1
    return list(range(first, last + 1))


def summarize_grad(rows: list[dict[str, Any]], steps: set[int] | None = None) -> dict[str, Any]:
    sel = [r for r in rows if steps is None or int(r["step"]) in steps]
    if not sel:
        return {"n": 0}
    g = [float(r["global_grad_l2"]) for r in sel]
    clips = sum(1 for r in sel if r.get("clip_applied"))
    gs = sorted(g)
    return {
        "n": len(sel),
        "mean": round(sum(g) / len(g), 4),
        "median": round(percentile(gs, 50), 4),
        "max": round(max(g), 4),
        "clip_frequency": clips,
        "clip_rate": round(clips / len(sel), 4),
    }


def main() -> int:
    tok = Tokenizer.from_file(str(TOK_PATH))
    generated = [e for e in build_training_examples() if e["capability_family"] == "tool_use"]
    packed_rows = []
    if EX_JSONL.exists():
        for line in EX_JSONL.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            rec = json.loads(line)
            if rec.get("capability_family") == "tool_use":
                packed_rows.append(rec)
    tools = packed_rows if packed_rows else generated
    all_ex = build_training_examples()
    corrections_toolish = [
        e
        for e in all_ex
        if e["capability_family"] == "correction_failure" and "<tool_call>" in str(e.get("response"))
    ]

    inventory = []
    prompt_templates = Counter()
    skeletons = Counter()
    tool_names = Counter()
    arg_schema = Counter()
    wrapper = Counter()
    json_key_order = Counter()
    exact_target = Counter()
    exact_input = Counter()
    norm_input = Counter()
    arg_struct = Counter()
    target_lens = []
    unit_lens = []
    prompt_lens = []
    family_target_tokens = Counter()
    token_freq_tool = Counter()
    token_freq_by_family: dict[str, Counter] = defaultdict(Counter)
    deg_targets = Counter()
    deg_prompts = Counter()
    format_family = Counter()

    for idx, ex in enumerate(tools):
        tc = token_counts_for_example(tok, ex)
        parsed = parse_tool_from_target(ex["response"])
        sk = skeleton_of(ex["response"])
        pt = prompt_template_of(ex["input"])
        prompt_templates[pt] += 1
        skeletons[sk] += 1
        exact_target[ex["response"]] += 1
        exact_input[ex["input"]] += 1
        norm_input[normalize_prompt(ex["input"])] += 1
        if parsed["has_tool_call"]:
            wrapper["tool_call_xml_plus_disclaimer"] += 1
            format_family["tool_call_json"] += 1
            tool_names[parsed["tool"] or "UNKNOWN"] += 1
            keys = tuple(parsed["arguments"].keys())
            arg_schema[keys] += 1
            # json key order as serialized
            if parsed["json_body"]:
                json_key_order[parsed["json_body"].split(":")[0][:40]] += 1
                # reconstruct key order from object dump
                json_key_order[re.sub(r":\s*\"[^\"]*\"", ":<V>", parsed["json_body"])] += 1
            for k, v in inspect_args(parsed["arguments"]).items():
                arg_struct[k] += v
        else:
            wrapper["prose_result_interpretation"] += 1
            format_family["prose_interpret"] += 1
            tool_names["(interpret/no-call)"] += 1
        tids = target_token_ids(tok, ex)
        token_freq_tool.update(tids)
        family_target_tokens["tool_use"] += tc["target_tokens"]
        target_lens.append(tc["target_tokens"])
        unit_lens.append(tc["unit_tokens"])
        prompt_lens.append(tc["prompt_tokens"])
        for k, v in inspect_degeneration_strings(ex["response"]).items():
            deg_targets[k] += v
        for k, v in inspect_degeneration_strings(ex["input"] + "\n" + (ex.get("renderedTrainingText") or "")).items():
            deg_prompts[k] += v
        inventory.append(
            {
                "example_id": ex["exampleId"],
                "curriculum_index": idx,
                "source_identity": (ex.get("provenance") or {}).get("source_identity"),
                "source_type": (ex.get("provenance") or {}).get("source_type"),
                "provenance_class": classify_provenance(ex),
                "synthetic_vs_observed": (ex.get("provenance") or {}).get("synthetic_vs_observed"),
                "generated_by": (ex.get("provenance") or {}).get("generated_by"),
                "input_text": ex["input"],
                "tool_schema_context": _TOOL_SCHEMA,
                "assistant_target": ex["response"],
                "target_token_count": tc["target_tokens"],
                "prompt_token_count": tc["prompt_tokens"],
                "total_token_count": tc["unit_tokens"],
                "tool_name": parsed.get("tool") if parsed["has_tool_call"] else None,
                "argument_keys": list((parsed.get("arguments") or {}).keys()),
                "arguments": parsed.get("arguments") or {},
                "format_template_family": "tool_call_json" if parsed["has_tool_call"] else "prose_interpret",
                "prompt_template": pt,
                "tool_call_skeleton": sk,
                "has_tool_call_wrapper": parsed["has_tool_call"],
                "mask": {
                    "assistant_present": tc["assistant_present"],
                    "prompt_masked": tc["prompt_tokens"],
                    "trainable_target": tc["target_tokens"],
                    "tool_json_before_assistant": tc["tool_json_before_assistant"],
                },
            }
        )

    # family comparison token freq
    for ex in all_ex:
        fam = ex["capability_family"]
        token_freq_by_family[fam].update(target_token_ids(tok, ex))

    # pack positions
    windows = []
    if WIN_MAP.exists():
        wm = load_json(WIN_MAP)
        windows = [w for w in wm["windows"] if w.get("008_origin") == "tool_use"]
    pack_positions = []
    steps_by_ex: dict[str, list[int]] = defaultdict(list)
    for w in windows:
        eid = str(w.get("008_unit_id") or "")
        # unit_id like 269:wr11cap_...#w0:0-288
        m = re.search(r"(wr11cap_[0-9a-f]+)", eid)
        example_id = m.group(1) if m else eid
        steps = step_for_stream(int(w["stream_start"]), int(w["stream_end"]))
        pack_positions.append(
            {
                "window_index": w["window_index"],
                "stream_start": w["stream_start"],
                "stream_end": w["stream_end"],
                "n_tokens": w["n_tokens"],
                "008_unit_id": w["008_unit_id"],
                "example_id": example_id,
                "planned_steps": steps,
            }
        )
        steps_by_ex[example_id].extend(steps)
    for rec in inventory:
        rec["training_pack_positions"] = [p for p in pack_positions if p["example_id"] == rec["example_id"]]
        rec["planned_steps_008"] = sorted(set(steps_by_ex.get(rec["example_id"], [])))

    base_family = Counter()
    for rec in inventory:
        sid = rec.get("source_identity") or ""
        parts = str(sid).split(":")
        fam = ":".join(parts[:2]) if len(parts) >= 2 else sid
        rec["base_template_family"] = fam
        base_family[fam] += 1

    # 008/009 maps
    map008 = load_json(MAP_008)["steps"] if MAP_008.exists() else []
    map009 = load_json(MAP_009)["steps"] if MAP_009.exists() else []
    grad008 = load_json(GRAD_008) if GRAD_008.exists() else []
    grad009 = load_json(GRAD_009) if GRAD_009.exists() else []
    loss008 = {int(r["step"]): r for r in (load_json(LOSS_008) if LOSS_008.exists() else [])}
    loss009 = {int(r["step"]): r for r in (load_json(LOSS_009) if LOSS_009.exists() else [])}

    # reconstruct 008 tool tokens per step from windows
    tool_tokens_008: dict[int, int] = defaultdict(int)
    tool_windows_008: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for p in pack_positions:
        # allocate whole window tokens to each overlapping step (conservative; window may straddle)
        for st in p["planned_steps"]:
            # overlap length
            a = max(p["stream_start"], (st - 1) * STEP_TOKENS)
            b = min(p["stream_end"], st * STEP_TOKENS)
            ov = max(0, b - a)
            tool_tokens_008[st] += ov
            tool_windows_008[st].append({**p, "overlap_tokens": ov})

    def enrich_steps(steps: list[dict[str, Any]], grad_rows: list[dict[str, Any]], loss_map: dict[int, Any], recon: bool) -> list[dict[str, Any]]:
        gmap = {int(r["step"]): r for r in grad_rows}
        out = []
        for s in steps:
            st = int(s["step"])
            tool_tok = int(s.get("tool_tokens") or 0)
            tool_pct = float(s.get("tool_pct") or 0)
            if recon:
                tool_tok = int(tool_tokens_008.get(st, 0))
                tool_pct = round(100.0 * tool_tok / STEP_TOKENS, 4)
            g = gmap.get(st) or {}
            ls = loss_map.get(st) or {}
            out.append(
                {
                    "step": st,
                    "dominant": s.get("dominant_class") or s.get("dominant_source_family"),
                    "objective": s.get("objective"),
                    "tool_tokens": tool_tok,
                    "tool_pct": tool_pct,
                    "supervised_pct": s.get("supervised_pct"),
                    "grad_l2": g.get("global_grad_l2"),
                    "clip": g.get("clip_applied"),
                    "ce_by_family": ls.get("ce_by_family"),
                    "origin_counts": s.get("origin_counts"),
                    "class_counts": s.get("class_counts"),
                    "tool_windows": tool_windows_008.get(st, []) if recon else None,
                }
            )
        return out

    steps008 = enrich_steps(map008, grad008, loss008, recon=True)
    steps009 = enrich_steps(map009, grad009, loss009, recon=False)

    tool_heavy_008 = [s for s in steps008 if s["tool_pct"] >= 15]
    tool_heavy_009 = [s for s in steps009 if s["tool_pct"] >= 15]
    region_008 = [s for s in steps008 if 90 <= s["step"] <= 120]
    region_009 = [s for s in steps009 if 40 <= s["step"] <= 75]

    # gradient signature: steps with tool vs without, plus dominant-class from 009/008
    def split_tool(rows: list[dict[str, Any]], thresh: float = 15.0) -> dict[str, Any]:
        hi = [r for r in rows if (r.get("tool_pct") or 0) >= thresh and r.get("grad_l2") is not None]
        lo = [r for r in rows if (r.get("tool_pct") or 0) == 0 and r.get("grad_l2") is not None]
        mid = [r for r in rows if 0 < (r.get("tool_pct") or 0) < thresh and r.get("grad_l2") is not None]

        def stats(xs: list[dict[str, Any]]) -> dict[str, Any]:
            if not xs:
                return {"n": 0}
            g = [float(x["grad_l2"]) for x in xs]
            clips = sum(1 for x in xs if x.get("clip"))
            ces = []
            for x in xs:
                ce = (x.get("ce_by_family") or {}).get("supervised")
                if ce is not None:
                    ces.append(float(ce))
            return {
                "n": len(xs),
                "mean_grad": round(sum(g) / len(g), 4),
                "median_grad": round(percentile(sorted(g), 50), 4),
                "max_grad": round(max(g), 4),
                "clip_frequency": clips,
                "mean_supervised_ce": round(sum(ces) / len(ces), 4) if ces else None,
            }

        return {"tool_pct_ge_15": stats(hi), "tool_pct_0": stats(lo), "tool_pct_mid": stats(mid)}

    # dominant-class grad from 008/009 maps
    def grad_by_class(rows: list[dict[str, Any]]) -> dict[str, Any]:
        groups: dict[str, list[float]] = defaultdict(list)
        clips: dict[str, int] = Counter()
        n: dict[str, int] = Counter()
        for r in rows:
            if r.get("grad_l2") is None:
                continue
            cls = str(r.get("dominant") or "UNKNOWN")
            groups[cls].append(float(r["grad_l2"]))
            n[cls] += 1
            if r.get("clip"):
                clips[cls] += 1
        out = {}
        for cls, gs in groups.items():
            out[cls] = {
                "n": n[cls],
                "mean": round(sum(gs) / len(gs), 4),
                "median": round(percentile(sorted(gs), 50), 4),
                "max": round(max(gs), 4),
                "clip_frequency": clips[cls],
            }
        return out

    # token frequency report
    def top_tokens(counter: Counter, n: int = 40) -> list[dict[str, Any]]:
        total = sum(counter.values()) or 1
        rows = []
        for tid, c in counter.most_common(n):
            piece = tok.id_to_token(tid)
            rows.append({"id": tid, "piece": piece, "count": c, "share": round(c / total, 5)})
        return rows

    inspect_pieces = [
        "_",
        "-lab",
        "model",
        "tool",
        "call",
        "{",
        "}",
        ":",
        '"',
        ",",
        "true",
        "false",
        "null",
        "assistant",
        "function",
        "argument",
        "args",
        "path",
        "id",
        "name",
        "<tool_call>",
        "</tool_call>",
        "sha",
        "256",
        "lookup",
        "none",
    ]

    def piece_stats(counter: Counter) -> dict[str, Any]:
        total = sum(counter.values()) or 1
        # map pieces that may be whole tokens or fragments
        out = {}
        inv = {}
        for tid, c in counter.items():
            p = tok.id_to_token(tid) or ""
            inv[p] = inv.get(p, 0) + c
        for name in inspect_pieces:
            # exact token piece
            c = inv.get(name, 0)
            # also sum pieces containing the fragment
            contained = 0
            examples = []
            for p, cc in inv.items():
                if name in p:
                    contained += cc
                    if len(examples) < 6:
                        examples.append({"piece": p, "count": cc})
            out[name] = {
                "exact_token_count": c,
                "exact_share": round(c / total, 5),
                "contained_in_piece_count": contained,
                "contained_share": round(contained / total, 5),
                "example_pieces": examples,
            }
        return out

    # compare shares
    def share_map(counter: Counter) -> dict[str, float]:
        total = sum(counter.values()) or 1
        return {name: piece_stats(counter)[name]["contained_share"] for name in inspect_pieces}

    fam_lens = family_token_stats(tok, all_ex)
    slens = sorted(target_lens)
    unique_pt = len(prompt_templates)
    unique_sk = len(skeletons)
    cluster_sizes = sorted(prompt_templates.values())
    near_dup_n = sum(v for v in prompt_templates.values() if v >= 2)
    largest_prompt = max(prompt_templates.values()) if prompt_templates else 0

    # json key-order unique after value-normalization
    key_orders = Counter()
    for rec in inventory:
        if rec["format_template_family"] != "tool_call_json":
            continue
        body = json.dumps({"tool": rec["tool_name"], "arguments": rec["arguments"]}, ensure_ascii=True)
        norm = re.sub(r"\"[^\"]*\"", "\"<S>\"", body)
        key_orders[norm] += 1

    # objective weight
    acc = fam_lens
    sup_targets = sum(v["target_tokens"] for k, v in acc.items())
    tool_targets = acc.get("tool_use", {}).get("target_tokens", 0)
    # packed mix from accounting.json if present
    acc_path = ROOT / "model-lab/manifests/wrim1_1_capability/test-design/WR-CORPUS-1.1-CAPABILITY-CANDIDATE/accounting.json"
    pack_acc = load_json(acc_path) if acc_path.exists() else {}
    mix_loss = (pack_acc.get("mix") or {}).get("mix_loss_tokens_by_origin") or {}
    total_trainable_pack = sum(mix_loss.values()) if mix_loss else 686070
    tool_trainable = mix_loss.get("tool_use", tool_targets)
    tool_unit = acc.get("tool_use", {}).get("unit_tokens", 0)

    n_tool_steps_008 = sum(1 for s in steps008 if s["tool_tokens"] > 0)
    n_tool_steps_009 = sum(1 for s in steps009 if (s.get("tool_tokens") or 0) > 0)

    # EOS: last target token
    eos_id = tok.token_to_id("<|eos|>")
    eos_in_target = 0
    for ex in tools:
        tids = target_token_ids(tok, ex)
        if eos_id in tids:
            eos_in_target += 1

    # V2
    v2 = build_v2_examples()
    eval1 = build_tool_eval_1()
    v2_val = validate_v2(v2, eval1, tok, tools)
    v2_tcounts = [token_counts_for_example(tok, e) for e in v2]
    v2_targets = int(sum(c["target_tokens"] for c in v2_tcounts))
    v2_units = int(sum(c["unit_tokens"] for c in v2_tcounts))
    v2_templates = Counter(structural_template_v2(e["response"]) for e in v2)
    v2_tools = Counter(parse_compact(e["response"])["tool"] for e in v2)

    # hypothesized pack share if replacing 6098 tool targets (supervised only accounting)
    hyp_sup_targets = sup_targets - tool_targets + v2_targets
    hyp_pack = total_trainable_pack - tool_trainable + v2_targets  # DESIGN: targets not full windows

    forensic = {
        "mission": "WRIM-1.1 TOOL_USE CURRICULUM FORENSICS + V2 DESIGN",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "NOT_TRAINED": True,
        "optimizer_steps": 0,
        "n_examples": len(tools),
        "generated_n": len(generated),
        "jsonl_n": len(packed_rows),
        "ids_match_generated": {e["exampleId"] for e in tools} == {e["exampleId"] for e in generated},
        "provenance_counts": dict(Counter(r["provenance_class"] for r in inventory)),
        "synthetic_vs_observed": dict(Counter(r["synthetic_vs_observed"] for r in inventory)),
        "source_type_counts": dict(Counter(r["source_type"] for r in inventory)),
        "real_trajectory_count": sum(1 for r in inventory if r["provenance_class"] == "REAL_TRAJECTORY"),
        "unique_prompt_templates": unique_pt,
        "unique_base_template_families": len(base_family),
        "base_template_family_counts": dict(base_family),
        "unique_tool_call_skeletons": unique_sk,
        "unique_json_key_orders_normalized": len(key_orders),
        "largest_prompt_template_cluster": largest_prompt,
        "median_prompt_template_cluster": percentile(cluster_sizes, 50) if cluster_sizes else 0,
        "pct_in_near_duplicate_prompt_clusters": round(100.0 * near_dup_n / max(1, len(tools)), 2),
        "prompt_template_clusters": prompt_templates.most_common(),
        "skeleton_clusters": skeletons.most_common(),
        "wrapper_counts": dict(wrapper),
        "format_family": dict(format_family),
        "exact_duplicate_targets": {k: v for k, v in exact_target.items() if v > 1},
        "exact_duplicate_inputs": {k: v for k, v in exact_input.items() if v > 1},
        "normalized_duplicate_inputs": sum(1 for v in norm_input.values() if v > 1),
        "tool_name_distribution": dict(tool_names),
        "arg_schema_counts": {str(k): v for k, v in arg_schema.items()},
        "argument_structure_flags": dict(arg_struct),
        "target_length": {
            "min": min(slens) if slens else 0,
            "p10": percentile(slens, 10),
            "p25": percentile(slens, 25),
            "median": percentile(slens, 50),
            "mean": round(sum(slens) / len(slens), 4) if slens else 0,
            "p75": percentile(slens, 75),
            "p90": percentile(slens, 90),
            "max": max(slens) if slens else 0,
            "buckets": buckets_for_lengths(slens),
        },
        "family_target_length_compare": acc,
        "highest_frequency_target_tokens": top_tokens(token_freq_tool, 50),
        "inspected_token_fragments": piece_stats(token_freq_tool),
        "fragment_share_by_family": {fam: piece_stats(cnt) for fam, cnt in token_freq_by_family.items()},
        "degeneration_in_tool_targets": dict(deg_targets),
        "degeneration_in_tool_prompts_plus_render": dict(deg_prompts),
        "direct_string_model-lab_in_targets": deg_targets.get("model-lab", 0),
        "direct_string__not__in_targets": deg_targets.get("_not_", 0),
        "masking": {
            "prompt_tokens_total": int(sum(prompt_lens)),
            "target_tokens_total": int(sum(target_lens)),
            "unit_tokens_total": int(sum(unit_lens)),
            "eos_in_assistant_span_examples": eos_in_target,
            "tool_json_before_assistant": sum(r["mask"]["tool_json_before_assistant"] for r in inventory),
            "assistant_present": sum(r["mask"]["assistant_present"] for r in inventory),
            "semantics": "USER/PROMPT (mask 0) → SCHEMA/CONTEXT (mask 0) → <|assistant|> (boundary, mask 0) → TOOL TARGET (mask 1) → <|eos|> (mask 1)",
        },
        "objective_weight": {
            "tool_target_tokens": tool_targets,
            "all_supervised_target_tokens": sup_targets,
            "tool_share_of_supervised_targets": round(tool_targets / max(1, sup_targets), 6),
            "tool_trainable_in_pack_loss_tokens": tool_trainable,
            "total_trainable_pack_tokens": total_trainable_pack,
            "tool_share_of_pack_trainable": round(tool_trainable / max(1, total_trainable_pack), 6),
            "tool_unit_tokens": tool_unit,
            "tool_share_of_pack_if_windows": round(tool_unit / 686070, 6),
            "tool_steps_008_with_any_tool": n_tool_steps_008,
            "consumed_steps_008": len(steps008),
            "tool_batches_share_008": round(n_tool_steps_008 / max(1, len(steps008)), 6),
            "tool_steps_009_with_any_tool": n_tool_steps_009,
            "consumed_steps_009": len(steps009),
            "note": "Loss is mean CE over mask=1. Tool never dominates a full batch; influence is via MIXED leftover+supervised steps.",
        },
        "gradient_signature": {
            "note": "No new backward. TOOL never dominates a step. Compare tool-heavy vs zero-tool steps from logs.",
            "recovery_008_by_dominant": grad_by_class(steps008),
            "recovery_009_by_dominant": grad_by_class(steps009),
            "recovery_008_tool_split": split_tool(steps008),
            "recovery_009_tool_split": split_tool(steps009),
            "recovery_008_all": summarize_grad(grad008),
            "recovery_009_all": summarize_grad(grad009),
        },
        "tool_heavy_008": tool_heavy_008,
        "tool_heavy_009": tool_heavy_009,
        "region_008_90_120": region_008,
        "region_009_40_75": region_009,
        "named_009_67_71_73": [s for s in steps009 if s["step"] in (67, 71, 73)],
        "correction_family_tool_call_examples_retained_in_010": len(corrections_toolish),
        "pack_window_count_tool_use": len(windows),
        "v2_preview": {
            "examples": len(v2),
            "target_tokens": v2_targets,
            "unit_tokens": v2_units,
            "mean_target": round(v2_targets / max(1, len(v2)), 3),
            "unique_templates": len(v2_templates),
            "templates": v2_templates.most_common(),
            "tool_names": dict(v2_tools),
            "hyp_share_supervised_targets": round(v2_targets / max(1, hyp_sup_targets), 6),
            "hyp_share_pack_if_replace_targets_only": round(v2_targets / max(1, hyp_pack), 6),
        },
        "v2_validator": {
            "passed": v2_val["passed"],
            "pass_count": v2_val["pass_count"],
            "fail_count": v2_val["fail_count"],
        },
    }

    OUT_FORENSIC.mkdir(parents=True, exist_ok=True)
    write_json(OUT_FORENSIC / "inventory.json", inventory)
    write_json(OUT_FORENSIC / "forensic-summary.json", forensic)
    write_json(OUT_FORENSIC / "pack-positions.json", pack_positions)
    write_json(OUT_FORENSIC / "tool-heavy-008.json", tool_heavy_008)
    write_json(OUT_FORENSIC / "tool-heavy-009.json", tool_heavy_009)

    OUT_V2.mkdir(parents=True, exist_ok=True)
    with (OUT_V2 / "supervised-examples.jsonl").open("w", encoding="utf-8") as fh:
        for ex in v2:
            fh.write(json.dumps(ex, ensure_ascii=True) + "\n")
    write_json(OUT_V2 / "MANIFEST.json", {
        "curriculum_id": V2_CURRICULUM_ID,
        "DESIGN_ONLY": True,
        "NOT_TRAINED": True,
        "NOT_OFFICIAL": True,
        "EXCLUDE_FROM_TRAINING_eval": True,
        "parent_v1": CURRICULUM_ID,
        "n_examples": len(v2),
        "target_tokens": v2_targets,
        "unit_tokens": v2_units,
        "representation": "compact_tool_intent_v2",
        "does_not_modify_v1_records": True,
        "generated_by": "forensic_tool_use_curriculum.py",
        "timestamp": forensic["timestamp"],
    })
    write_json(OUT_V2 / "validator.json", v2_val)
    write_json(OUT_V2 / "accounting.json", {
        "examples": len(v2),
        "target_tokens": v2_targets,
        "unit_tokens": v2_units,
        "mean_target": round(v2_targets / max(1, len(v2)), 3),
        "by_tool": dict(v2_tools),
        "templates": dict(v2_templates),
        "DESIGN_HYPOTHESIS_budget": {
            "example_count": len(v2),
            "target_token_count": v2_targets,
            "pct_of_v1_tool_targets": round(100.0 * v2_targets / max(1, tool_targets), 3),
            "pct_supervised_if_swap_targets": round(100.0 * v2_targets / max(1, hyp_sup_targets), 3),
        },
    })

    OUT_EVAL1.mkdir(parents=True, exist_ok=True)
    write_json(OUT_EVAL1 / "suite.json", eval1)
    write_json(OUT_EVAL1 / "MANIFEST.json", {
        "suite_id": V2_EVAL_ID,
        "EXCLUDE_FROM_TRAINING": True,
        "DESIGN_ONLY": True,
        "NOT_TRAINED": True,
        "NOT_OFFICIAL": True,
        "does_not_overwrite": EVAL_ID,
        "item_count": eval1["item_count"],
    })

    # gold-parse sanity on V2 targets
    gold_ok = 0
    for ex in v2:
        r = score_compact({"evalId": ex["exampleId"], "expected": ex["validator"]["expected"]}, ex["response"])
        gold_ok += int(r["pass"])
    write_json(OUT_V2 / "gold-parse.json", {"n": len(v2), "gold_self_score_pass": gold_ok})

    print(json.dumps({
        "n_v1": len(tools),
        "target_tokens_v1": tool_targets,
        "n_v2": len(v2),
        "target_tokens_v2": v2_targets,
        "validator_passed": v2_val["passed"],
        "validator_fail_count": v2_val["fail_count"],
        "gold_self_score": gold_ok,
        "unique_prompt_templates": unique_pt,
        "unique_skeletons": unique_sk,
        "tool_names": dict(tool_names),
        "mean_target": forensic["target_length"]["mean"],
        "correction_tool_calls": len(corrections_toolish),
        "pack_windows": len(windows),
        "tool_heavy_008": [s["step"] for s in tool_heavy_008],
        "tool_heavy_009": [s["step"] for s in tool_heavy_009],
    }, indent=2))
    return 0 if v2_val["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
