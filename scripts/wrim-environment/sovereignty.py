"""Deterministic WRIM foundational-training eligibility.

Does not delete or mutate repository/tooling files. Does not mutate WR-CORPUS.
Classifies source documents before packing. The packer must not infer
sovereignty from file extension alone.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

CLASS_A = "A. VENDOR_SPECIFIC_AI_INSTRUCTION"
CLASS_B = "B. WAR_ROOM_AGENT_OPERATIONAL_INSTRUCTION"
CLASS_C = "C. GENERIC_ENGINEERING_DOCUMENTATION"
CLASS_D = "D. GENERAL_KNOWLEDGE"
CLASS_E = "E. TRAINING_EXAMPLE_EXPLICITLY_INTENDED_FOR_MODEL_LEARNING"
CLASS_F = "F. AMBIGUOUS_REQUIRES_REVIEW"

ELIG_ALLOWED = "FOUNDATIONAL_ALLOWED"
ELIG_SFT = "SFT_ONLY"
ELIG_TOOLING = "TOOLING_ONLY"
ELIG_EVAL = "EVAL_ONLY"
ELIG_VENDOR = "EXCLUDED_VENDOR_SPECIFIC"
ELIG_OPS = "EXCLUDED_OPERATIONAL"
ELIG_REVIEW = "REVIEW_REQUIRED"

FOUNDATIONAL_EXCLUDE_CLASSES = {CLASS_A, CLASS_B, CLASS_F}

VENDOR_FILENAMES = {
    "claude.md",
    "agents.md",
    "gemini.md",
    "chatgpt.md",
    "codex.md",
    ".cursorrules",
    "copilot-instructions.md",
    "cursorrules",
}

VENDOR_PATH_MARKERS = (
    "/.cursor/",
    ".cursor/",
    "/.claude/",
    ".claude/",
    ".github/copilot",
    ".github/instructions/",
    "cursor/rules",
    "cursor/skills",
    "cursor/plugins",
    "/.codex/",
    ".codex/",
)

A_TEXT_MARKERS = (
    "guidance to Claude Code",
    "claude.ai/code",
    "this file provides guidance to claude",
    "you are claude",
    "you are chatgpt",
    "you are gemini",
    "you are github copilot",
    "github copilot",
    "cursor agent skills",
    "always apply this rule",
    "when working with code in this repository",
    "use this skill to create cursor",
    "the cursor canvas is a live react app",
)

B_TEXT_MARKERS = (
    "every implementation-completion summary in this repo",
    "## next steps for operator",
    "formatoperatornextstepsmarkdown",
    "war room trusted development policy",
    "this rule applies only when the active workspace",
)

CODE_EXT = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".sql", ".css"}
DOC_EXT = {".md", ".mdc", ".txt", ".rst"}
JSON_EXT = {".json", ".jsonl"}

# Distinctive CLAUDE.md fragments used for indirect-copy detection.
CLAUDE_FINGERPRINTS = (
    "This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.",
    "ported from `.cursor/rules/war-room-trusted-development.mdc`",
    "prefer `formatOperatorNextStepsMarkdown` / `buildNextStepsFromContext`",
    "Kimi/Moonshot is not installed and is not a War Room capability",
    "For module-specific conventions, add focused files under `.claude/rules/`",
)


def norm_path(path: str | None) -> str:
    return str(path or "").replace("\\", "/").strip()


def basename(path: str) -> str:
    p = norm_path(path)
    return p.rsplit("/", 1)[-1].lower() if p else ""


def class_to_eligibility(semantic_class: str) -> tuple[str, str]:
    if semantic_class == CLASS_A:
        return ELIG_VENDOR, "vendor_or_tool_instruction_artifact"
    if semantic_class == CLASS_B:
        return ELIG_OPS, "war_room_agent_operational_instruction"
    if semantic_class == CLASS_F:
        return ELIG_REVIEW, "ambiguous_requires_review"
    if semantic_class == CLASS_E:
        return ELIG_ALLOWED, "explicit_training_example"
    return ELIG_ALLOWED, "foundational_allowed"


def foundational_allowed(semantic_class: str) -> bool:
    return semantic_class not in FOUNDATIONAL_EXCLUDE_CLASSES


def _text_has_any(text: str, markers: tuple[str, ...]) -> str | None:
    low = text.lower()
    for m in markers:
        if m.lower() in low:
            return m
    return None


def classify_source(*, source_path: str = "", text: str = "", origin: str = "", kind: str = "") -> dict[str, Any]:
    """Filename-independent semantic classification with path priors."""
    path = norm_path(source_path)
    low_path = path.lower()
    name = basename(path)
    sample = (text or "")[:20000]
    ext = ""
    if "." in name:
        ext = "." + name.rsplit(".", 1)[-1]

    if kind == "behavior_example" or origin in ("behavior", "wave8_behavior"):
        return _result(CLASS_E, path, "explicit behavior training example")

    if name in VENDOR_FILENAMES or name.endswith(".mdc"):
        return _result(CLASS_A, path, f"vendor/tool instruction filename:{name}")
    for marker in VENDOR_PATH_MARKERS:
        if marker in low_path:
            return _result(CLASS_A, path, f"vendor/tool instruction path:{marker}")
    if name == "skill.md" and ("cursor" in low_path or "skill" in low_path):
        return _result(CLASS_A, path, "cursor/agent skill document")

    a_hit = _text_has_any(sample, A_TEXT_MARKERS)
    if a_hit and ext in DOC_EXT | JSON_EXT | {""}:
        return _result(CLASS_A, path, f"vendor instruction semantics:{a_hit}")
    if a_hit and ext in CODE_EXT:
        # Application code may quote vendor names; keep as engineering unless the file is a prompt-only module.
        codeish = sample.count("{") + sample.count("function ") + sample.count("export ")
        if codeish < 3 and len(sample) < 4000:
            return _result(CLASS_A, path, f"prompt-like source with vendor semantics:{a_hit}")

    b_hit = _text_has_any(sample, B_TEXT_MARKERS)
    if b_hit and ext in DOC_EXT:
        return _result(CLASS_B, path, f"war-room agent operational instruction:{b_hit}")

    if "you are a" in sample.lower()[:500] and ext in DOC_EXT:
        return _result(CLASS_F, path, "document opens as a role/system prompt")

    if origin in ("WR-CORPUS-0", "c0_alice", "c0_non_alice") and not path:
        if "alice was beginning to get very tired" in sample.lower():
            return _result(CLASS_D, path, "literary rehearsal (Alice)")
        if _looks_like_public_domain_prose(sample):
            return _result(CLASS_D, path, "literary/general-knowledge rehearsal")
        if a_hit or b_hit:
            return _result(CLASS_F, path, "unpathed C0 with instruction-like text")
        return _result(CLASS_D, path, "WR-CORPUS-0 rehearsal document")

    if "frankenstein" in low_path:
        return _result(CLASS_D, path, "named literary intake (composition audited separately)")

    if ext in CODE_EXT or "app/" in low_path or "lib/" in low_path:
        return _result(CLASS_C, path, "application/engineering source")
    if ext in JSON_EXT:
        return _result(CLASS_C, path, "structured engineering/data document")
    if ext in DOC_EXT:
        return _result(CLASS_C, path, "generic engineering/world documentation")
    if origin == "WR-CORPUS-1":
        return _result(CLASS_C, path, "hardened corpus-1 source")
    return _result(CLASS_F, path, "unrecognized source shape")


def _result(semantic_class: str, path: str, reason: str) -> dict[str, Any]:
    elig, elig_reason = class_to_eligibility(semantic_class)
    return {
        "source_path": path,
        "semantic_class": semantic_class,
        "TRAINING_ELIGIBILITY": elig,
        "EXCLUSION_REASON": None if elig == ELIG_ALLOWED else (elig_reason + ": " + reason),
        "reason": reason,
        "foundational_allowed": foundational_allowed(semantic_class),
    }


def _looks_like_public_domain_prose(sample: str) -> bool:
    low = sample.lower()
    return any(
        s in low
        for s in (
            "frankenstein, or the modern prometheus",
            "mary wollstonecraft shelley",
            "project gutenberg",
            "it was the best of times",
            "call me ishmael",
        )
    )


def fingerprints_present(text: str, prints: tuple[str, ...] = CLAUDE_FINGERPRINTS) -> list[str]:
    hits = [p for p in prints if p in (text or "")]
    if not hits:
        low = (text or "").lower()
        hits = [p for p in prints if p.lower() in low]
    return hits


def content_sha256(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8", errors="replace")).hexdigest()


def near_duplicate_score(a: str, b: str, window: int = 80) -> float:
    """Fraction of windows from a found in b. Cheap containment check."""
    if not a or not b:
        return 0.0
    a = a[:12000]
    b = b[:200000]
    if a in b:
        return 1.0
    n = 0
    hits = 0
    step = max(window // 2, 40)
    for i in range(0, max(0, len(a) - window), step):
        n += 1
        if a[i : i + window] in b:
            hits += 1
    return (hits / n) if n else 0.0


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def text_of_record(rec: dict[str, Any]) -> str:
    for k in ("text", "content", "body", "renderedTrainingText"):
        v = rec.get(k)
        if isinstance(v, str) and v.strip():
            return v
    chunks = rec.get("chunks")
    if isinstance(chunks, list):
        return "".join(str(c.get("text") or c.get("content") or "") for c in chunks if isinstance(c, dict))
    return json.dumps(rec, ensure_ascii=False)[:20000]
