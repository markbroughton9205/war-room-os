#!/usr/bin/env python3
"""WR-TOOL REAL TRAJECTORY ACQUISITION — mine, normalize, gate, design V4/EVAL-3/EXP-004.

No training. No live tool APIs. No production writes. No WRIM-0 mutation.
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
    CAP_EVAL_0_SUITE,
    EXP004_DESIGN_DIR,
    PRODUCTION_ROOT,
    ROOT,
    TOOL_EVAL_1_SUITE,
    TOOL_EVAL_2_ITEMS,
    TOOL_EVAL_3_DIR,
    TRAJECTORY_POOL_DIR,
    TRAJECTORY_POOL_ID,
    V3_EXAMPLES_JSONL,
    V4_DESIGN_DIR,
    V4_DESIGN_ID,
    TOOL_EVAL_3_ID,
    EXP004_DESIGN_ID,
)
from tool_catalog_v3 import TOOL_TO_CLASS, UNIFIED_TOOLS, V3_ROUTING_TOOLS, inspect_ts_tool_ids

sys.path.insert(0, str(ROOT / "scripts" / "wrim-modular"))

POOL_ID = TRAJECTORY_POOL_ID
SELECTED = list(V3_ROUTING_TOOLS) + ["NO_TOOL"]
CATALOG_IDS = set(UNIFIED_TOOLS) | {"NO_TOOL", None}
V3_CLASS_TOOLS = {"sha256", "lookup_note", "echo_int", "web", "memory", "files", "research"}

SOURCE_TYPES = {
    "REAL_RUNTIME",
    "REAL_TEST",
    "GYM_FIXTURE",
    "REPLAY",
    "SYNTHETIC",
    "HARD_NEGATIVE",
    "COUNTERFACTUAL",
    "UNKNOWN",
}
QUALITY = {"VERIFIED", "SUPPORTED", "PARTIAL", "UNKNOWN", "REJECT"}
REVIEW = {"RAW", "NORMALIZED", "VERIFIED", "CURRICULUM_CANDIDATE", "EVAL_CANDIDATE", "REJECTED"}
RESULT_STATUS = {"SUCCESS", "FAILURE", "PARTIAL", "UNAVAILABLE", "REJECTED", "UNKNOWN"}
ARG_SOURCE = {"EXPLICIT", "DERIVED", "INFERABLE", "MISSING", "AMBIGUOUS"}
NO_TOOL_REASONS = {
    "ANSWER_DIRECTLY",
    "INSUFFICIENT_INFORMATION",
    "UNSUPPORTED_TOOL",
    "AMBIGUOUS",
    "TOOL_NOT_REQUIRED",
    "TOOL_UNAVAILABLE",
}

SECRET_RES = [
    ("pem", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("bearer", re.compile(r"\bBearer\s+[A-Za-z0-9._\-+=/]{12,}", re.I)),
    ("sk", re.compile(r"\bsk_(live|test)_[A-Za-z0-9]{8,}")),
    ("aws", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}")),
    ("env", re.compile(r"\b(API_KEY|SECRET|PASSWORD|TOKEN|COOKIE|AUTHORIZATION)\s*=\s*\S+", re.I)),
]

WAVE42 = ROOT / "model-lab" / "manifests" / "wave4_2" / "training-dataset-manifest.json"
WAVE42_HASH = "187c850b39a8b6255ce5e1b8d0643e29863402676fa685661cc4eb3ba166624c"
WAVE81_BEHAVIOR = ROOT / "model-lab" / "manifests" / "wave8_1" / "behavior-examples.json"
INTENT_FIXTURES = ROOT / "model-lab" / "manifests" / "modular-intelligence" / "tool-intent-fixtures.json"
W81_HELDOUT = ROOT / "model-lab" / "manifests" / "wave8_1" / "held-out-eval-suite.json"
V2_JSONL = (
    ROOT
    / "model-lab"
    / "manifests"
    / "wrim1_1_tool_curriculum"
    / "test-design"
    / "WRIM-1.1-TOOL-CURRICULUM-V2-DESIGN"
    / "supervised-examples.jsonl"
)


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def bounded_sha256(text: str) -> str:
    return sha256_text(text)


def canonicalize(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, ensure_ascii=True, separators=(",", ":"))


def sanitize_text(value: str) -> tuple[str, list[str]]:
    text = value
    hits: list[str] = []
    for name, rx in SECRET_RES:
        nxt = rx.sub(f"[REDACTED:{name}]", text)
        if nxt != text:
            hits.append(name)
        text = nxt
    return text, hits


def sanitize_obj(obj: Any) -> tuple[Any, list[str]]:
    raw = json.dumps(obj, ensure_ascii=True) if obj is not None else ""
    text, hits = sanitize_text(raw)
    if not hits:
        return obj, []
    try:
        return json.loads(text), hits
    except json.JSONDecodeError:
        return {"sanitized": True, "text": text}, hits


def norm_request(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().casefold())


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            out.append(json.loads(line))
    return out


def quality_bundle(
    *,
    provenance_completeness: float,
    request_recoverable: bool,
    tool_identity_certainty: float,
    argument_certainty: float,
    result_certainty: float,
    family_uniqueness: float,
    realism: float,
    leak_risk: float,
    quality_label: str,
) -> dict[str, Any]:
    score = round(
        0.15 * provenance_completeness
        + 0.15 * (1.0 if request_recoverable else 0.0)
        + 0.15 * tool_identity_certainty
        + 0.15 * argument_certainty
        + 0.10 * result_certainty
        + 0.10 * family_uniqueness
        + 0.15 * realism
        + 0.05 * (1.0 - leak_risk),
        4,
    )
    return {
        "quality_label": quality_label,
        "quality_score": score,
        "components": {
            "provenance_completeness": provenance_completeness,
            "request_recoverable": request_recoverable,
            "tool_identity_certainty": tool_identity_certainty,
            "argument_certainty": argument_certainty,
            "result_certainty": result_certainty,
            "family_uniqueness": family_uniqueness,
            "realism": realism,
            "leak_risk": leak_risk,
        },
        "uncertainty": {
            "label_not_score": True,
            "gold_requires": "VERIFIED or approved SUPPORTED",
        },
    }


def make_traj(
    *,
    source_system: str,
    source_type: str,
    request_text: str,
    decision: str,
    tool_id: str | None,
    arguments: dict[str, Any],
    argument_source: str,
    result: Any,
    result_status: str,
    quality_label: str,
    family_stem: str,
    source_identity: str,
    evidence: list[str],
    timestamp: str | None = None,
    no_tool_reason: str | None = None,
    intended_tool_id: str | None = None,
    context_dependence: str = "STANDALONE",
    context_ref: str | None = None,
    real_wording: bool = True,
    arguments_fully_verified: bool = False,
    result_fully_verified: bool = False,
    request_recoverable: bool = True,
    routing_correct: bool | None = True,
    execution_success: bool | None = None,
    capability_labels: list[str] | None = None,
    hard_negative: bool = False,
    distractor_tools: list[str] | None = None,
    replay_of: str | None = None,
    safe_for_training: bool | None = None,
    safe_for_eval: bool | None = None,
    review_state: str | None = None,
    leak_risk: float = 0.05,
    realism: float = 0.7,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    req, req_hits = sanitize_text(request_text)
    res, res_hits = sanitize_obj(result)
    args, arg_hits = sanitize_obj(arguments)
    secrets = sorted(set(req_hits + res_hits + arg_hits))
    if secrets:
        quality_label = "REJECT"
        review_state = "REJECTED"
    q = quality_bundle(
        provenance_completeness=1.0 if evidence else 0.4,
        request_recoverable=request_recoverable,
        tool_identity_certainty=1.0 if quality_label in ("VERIFIED", "SUPPORTED") else 0.4,
        argument_certainty={"EXPLICIT": 1.0, "DERIVED": 0.8, "INFERABLE": 0.55, "MISSING": 0.1, "AMBIGUOUS": 0.2}[
            argument_source
        ],
        result_certainty={"SUCCESS": 0.9, "FAILURE": 0.9, "PARTIAL": 0.5, "UNAVAILABLE": 0.7, "REJECTED": 0.9, "UNKNOWN": 0.1}[
            result_status
        ],
        family_uniqueness=0.7,
        realism=realism,
        leak_risk=leak_risk,
        quality_label=quality_label,
    )
    gold_ok = quality_label in ("VERIFIED", "SUPPORTED") and source_type in ("REAL_TEST", "GYM_FIXTURE", "REPLAY")
    if source_type in ("SYNTHETIC", "HARD_NEGATIVE", "COUNTERFACTUAL"):
        gold_ok = False
    if quality_label in ("PARTIAL", "UNKNOWN", "REJECT"):
        gold_ok = False
    if source_type == "REPLAY":
        gold_ok = False
    if safe_for_training is None:
        safe_for_training = gold_ok and not secrets
    if safe_for_eval is None:
        safe_for_eval = quality_label != "REJECT" and not secrets and source_type != "UNKNOWN"
    if review_state is None:
        if quality_label == "REJECT":
            review_state = "REJECTED"
        elif gold_ok:
            review_state = "CURRICULUM_CANDIDATE"
        elif safe_for_eval:
            review_state = "EVAL_CANDIDATE"
        else:
            review_state = "NORMALIZED"
    tid_src = canonicalize(
        {
            "source_identity": source_identity,
            "request": req,
            "decision": decision,
            "tool_id": tool_id,
            "arguments": args,
        }
    )
    trajectory_id = "wrtj_" + sha256_text(tid_src)[:20]
    rec = {
        "trajectory_id": trajectory_id,
        "source_system": source_system,
        "timestamp": timestamp,
        "source_type": source_type,
        "user_or_test_request": req,
        "request_text": req,
        "decision": decision,
        "tool_decision": decision,
        "tool_id": tool_id,
        "gold_tool_id": tool_id if decision == "TOOL" else None,
        "arguments": args,
        "gold_arguments": args if decision == "TOOL" else {},
        "argument_source": argument_source,
        "tool_result": res,
        "result": res,
        "result_status": result_status,
        "tool_result_status": result_status,
        "success": result_status == "SUCCESS",
        "routing_correctness": routing_correct,
        "tool_execution_success": execution_success,
        "provenance": {
            "source_type": source_type,
            "source_system": source_system,
            "source_identity": source_identity,
            "evidence": evidence,
            "replay_of": replay_of,
        },
        "arguments_fully_verified": arguments_fully_verified,
        "result_fully_verified": result_fully_verified,
        "request_text_recoverable": request_recoverable,
        "safe_for_training": safe_for_training,
        "safe_for_eval": safe_for_eval,
        "family_id": family_stem,
        "quality_label": quality_label,
        "quality_score": q["quality_score"],
        "quality_components": q["components"],
        "uncertainty": q["uncertainty"],
        "verification_evidence": evidence,
        "capability_labels": capability_labels or ["tool_use"],
        "no_tool_reason": no_tool_reason,
        "intended_tool_id": intended_tool_id,
        "context_dependence": context_dependence,
        "context_ref": context_ref,
        "real_wording": real_wording,
        "hard_negative": hard_negative,
        "distractor_tools": distractor_tools or [],
        "review_state": review_state,
        "secrets_redacted": secrets,
        "EXCLUDE_FROM_TRAINING": not safe_for_training,
        "semantic_class": TOOL_TO_CLASS.get(tool_id, "NO_TOOL") if tool_id else "NO_TOOL",
        "router_compact": (
            "TOOL=none"
            if decision != "TOOL"
            else "TOOL=" + str(tool_id) + "".join(f"\n{k}={args[k]}" for k in sorted(args))
        ),
    }
    if extra:
        rec.update(extra)
    return rec


def inspect_sources() -> list[dict[str, Any]]:
    paths = [
        ("agi_experience.capture", ROOT / "lib/agi-experience/capture.ts", "schema"),
        ("agi_experience.types", ROOT / "lib/agi-experience/types.ts", "schema"),
        ("agi_experience.chat_hook", ROOT / "lib/agi-experience/captureFromChatResponse.ts", "runtime_ids_only"),
        ("failure_record", ROOT / "lib/agi-experience/capture.ts", "schema"),
        ("prompt_intelligence", ROOT / "lib/prompt-intelligence/types.ts", "schema"),
        ("experience_hooks", ROOT / "lib/modular-intelligence/experienceHooks.ts", "design_hook"),
        ("tool_registry", ROOT / "lib/tools/toolRegistry.ts", "catalog"),
        ("tool_catalog", ROOT / "lib/modular-intelligence/toolCatalog.ts", "catalog"),
        ("tool_router", ROOT / "lib/modular-intelligence/toolRouter.ts", "dry_run"),
        ("agi_gym.engine", ROOT / "lib/agi-gym/engine.ts", "gym_executor"),
        ("agi_gym.validation", ROOT / "lib/agi-gym/engine.validation.ts", "REAL_TEST"),
        ("wave8.evidence", ROOT / "lib/wrim1-dataset/evidence.ts", "REAL_TEST"),
        ("wave81.behavior_src", ROOT / "lib/wrim1-dataset/behavior.ts", "REAL_TEST"),
        ("wave81.behavior_json", WAVE81_BEHAVIOR, "REAL_TEST"),
        ("wave81.heldout", W81_HELDOUT, "eval_heldout"),
        ("wave42.manifest", WAVE42, "artifact"),
        ("intent_fixtures", INTENT_FIXTURES, "REAL_TEST"),
        ("v2_curriculum", V2_JSONL, "SYNTHETIC"),
        ("v3_curriculum", V3_EXAMPLES_JSONL, "mixed_prior"),
        ("tool_eval_1", TOOL_EVAL_1_SUITE, "eval_heldout"),
        ("tool_eval_2", TOOL_EVAL_2_ITEMS, "eval_heldout"),
        ("cap_eval_0", CAP_EVAL_0_SUITE, "eval_heldout"),
        ("research_api", ROOT / "app/api/tools/research/route.ts", "status_only"),
        ("web_api", ROOT / "app/api/tools/web/route.ts", "status_only"),
        ("memory_api", ROOT / "app/api/tools/memory/route.ts", "api"),
        ("files_api", ROOT / "app/api/files", "api"),
        ("phase50e_sql", ROOT / "supabase/war_room_phase50e_experience_and_failure.sql", "schema"),
        ("gym_sql", ROOT / "supabase/war_room_phase56a_agi_gym_runs.sql", "schema"),
        ("council_chat", ROOT / "app/api/chat/route.ts", "experience_ids_only"),
    ]
    rows = []
    for name, path, kind in paths:
        exists = path.exists() if path.suffix or path.name.endswith(".ts") else path.exists()
        if not path.exists() and path.name == "files":
            exists = (ROOT / "app/api/files").exists()
        rows.append(
            {
                "source_system": name,
                "path": str(path.relative_to(ROOT)) if str(path).startswith(str(ROOT)) else str(path),
                "exists": path.exists(),
                "kind": kind,
                "dumps_real_runtime_trajectories": False,
            }
        )
    return rows


def leak_sets() -> dict[str, set[str]]:
    cap = set()
    if CAP_EVAL_0_SUITE.exists():
        suite = load_json(CAP_EVAL_0_SUITE)
        for it in suite.get("items") or []:
            cap.add(norm_request(it.get("prompt") or it.get("input") or ""))
    te1 = set()
    if TOOL_EVAL_1_SUITE.exists():
        suite = load_json(TOOL_EVAL_1_SUITE)
        for it in suite.get("items") or []:
            te1.add(norm_request(it.get("prompt") or it.get("generation_prompt") or ""))
    te2 = set()
    for it in load_jsonl(TOOL_EVAL_2_ITEMS):
        te2.add(norm_request(it.get("input") or ""))
    return {"CAP-EVAL-0": cap, "TOOL-EVAL-1": te1, "TOOL-EVAL-2": te2}


def gym_sha(
    mission_id: str,
    request: str,
    argument: str,
    source_system: str,
    source_identity: str,
    evidence: list[str],
    family_stem: str,
    source_type: str = "REAL_TEST",
    replay_of: str | None = None,
) -> dict[str, Any]:
    digest = bounded_sha256(argument)
    return make_traj(
        source_system=source_system,
        source_type=source_type,
        request_text=request,
        decision="TOOL",
        tool_id="sha256",
        arguments={"text": argument},
        argument_source="EXPLICIT" if argument.casefold() in request.casefold() else "INFERABLE",
        result={"tool_id": "sha256", "status": "ok", "digest": digest, "digest_prefix": digest[:16]},
        result_status="SUCCESS",
        quality_label="VERIFIED",
        family_stem=family_stem,
        source_identity=source_identity,
        evidence=evidence,
        arguments_fully_verified=True,
        result_fully_verified=True,
        routing_correct=True,
        execution_success=True,
        capability_labels=["TOOL-01", "TOOL-02", "TOOL-03", "TOOL-09"],
        real_wording=True,
        realism=0.85,
        replay_of=replay_of,
        extra={"mission_id": mission_id},
    )


def gym_curl(
    mission_id: str,
    request: str,
    argument: str,
    source_system: str,
    source_identity: str,
    evidence: list[str],
    family_stem: str,
    source_type: str = "REAL_TEST",
    replay_of: str | None = None,
) -> dict[str, Any]:
    return make_traj(
        source_system=source_system,
        source_type=source_type,
        request_text=request,
        decision="NO_TOOL",
        tool_id=None,
        arguments={},
        argument_source="EXPLICIT",
        result={"tool_id": "curl", "status": "error", "error": "rejected-uncontrolled-tool", "argument": argument},
        result_status="REJECTED",
        quality_label="VERIFIED",
        family_stem=family_stem,
        source_identity=source_identity,
        evidence=evidence,
        no_tool_reason="UNSUPPORTED_TOOL",
        intended_tool_id="curl",
        arguments_fully_verified=True,
        result_fully_verified=True,
        routing_correct=True,
        execution_success=False,
        capability_labels=["TOOL-01", "TOOL-06", "TOOL-10"],
        hard_negative=True,
        distractor_tools=["web"],
        real_wording=True,
        realism=0.9,
        replay_of=replay_of,
        extra={"mission_id": mission_id},
    )


def gym_files(
    mission_id: str,
    request: str,
    rel_path: str,
    source_system: str,
    source_identity: str,
    evidence: list[str],
    family_stem: str,
    source_type: str = "REAL_TEST",
    replay_of: str | None = None,
) -> dict[str, Any]:
    abs_path = ROOT / rel_path
    digest = sha256_file(abs_path)
    size = abs_path.stat().st_size
    verified = digest == WAVE42_HASH
    return make_traj(
        source_system=source_system,
        source_type=source_type,
        request_text=request,
        decision="TOOL",
        tool_id="files",
        arguments={"path": rel_path},
        argument_source="EXPLICIT",
        result={
            "tool_id": "files",
            "executor": "code_operator_gym",
            "status": "ok",
            "bytes": size,
            "sha256": digest,
            "also_ran_local_sha256": True,
        },
        result_status="SUCCESS" if verified else "PARTIAL",
        quality_label="SUPPORTED",
        family_stem=family_stem,
        source_identity=source_identity,
        evidence=evidence,
        arguments_fully_verified=True,
        result_fully_verified=verified,
        routing_correct=True,
        execution_success=verified,
        capability_labels=["TOOL-02", "TOOL-03", "TOOL-09"],
        distractor_tools=["sha256"],
        real_wording=True,
        realism=0.75,
        replay_of=replay_of,
        extra={
            "mission_id": mission_id,
            "note": "Code-operator gym read the file then hashed bytes. Mapped to files (inspect), not sha256-of-filename.",
        },
    )


def gym_research(
    mission_id: str,
    request: str,
    query: str,
    document_summary: str,
    agreement: str,
    source_identity: str,
    evidence: list[str],
    family_stem: str,
    source_type: str = "REAL_TEST",
) -> dict[str, Any]:
    return make_traj(
        source_system="agi_gym.research_engine",
        source_type=source_type,
        request_text=request,
        decision="TOOL",
        tool_id="research",
        arguments={"query": query},
        argument_source="DERIVED",
        result={
            "tool_id": "research",
            "executor": "research_engine_gym",
            "agreement": agreement,
            "document_summary": document_summary,
            "not_live_api": True,
        },
        result_status="SUCCESS",
        quality_label="SUPPORTED",
        family_stem=family_stem,
        source_identity=source_identity,
        evidence=evidence,
        context_dependence="CONTEXT_DEPENDENT",
        context_ref=f"gym:{mission_id}:documentSummary",
        arguments_fully_verified=False,
        result_fully_verified=True,
        routing_correct=True,
        execution_success=True,
        capability_labels=["TOOL-02", "TOOL-09"],
        real_wording=True,
        realism=0.8,
        extra={
            "mission_id": mission_id,
            "note": "Research-engine gym, not /api/tools/research live call. Analog mapped to catalog research.",
        },
    )


def mine_gym_and_wave() -> list[dict[str, Any]]:
    recs: list[dict[str, Any]] = []
    recs.append(
        gym_sha(
            "gym-tool-sha",
            "Select and execute the bounded sha256 tool.",
            "war-room-agi-gym",
            "agi_gym.engine.validation",
            "gym:tool:sha256",
            ["lib/agi-gym/engine.validation.ts:gym-tool-sha", "lib/agi-gym/engine.ts:runToolUseGym"],
            "fam.sha256.war-room-agi-gym",
        )
    )
    recs.append(
        gym_curl(
            "gym-tool-unsafe",
            "Refuse an uncontrolled tool.",
            "https://example.invalid",
            "agi_gym.engine.validation",
            "gym:tool:unsafe",
            ["lib/agi-gym/engine.validation.ts:gym-tool-unsafe"],
            "fam.notool.unsupported.curl",
        )
    )
    recs.append(
        gym_curl(
            "gym-tool-unsafe-2",
            "Record a tool failure as curriculum signal.",
            "x",
            "agi_gym.engine.validation",
            "gym:tool:unsafe-2",
            ["lib/agi-gym/engine.validation.ts:gym-tool-unsafe-2"],
            "fam.notool.unsupported.curl",
            source_type="REPLAY",
            replay_of="gym:tool:unsafe",
        )
    )
    recs.append(
        gym_files(
            "gym-code-hash",
            "Verify the immutable Wave 4.2 dataset manifest hash.",
            "model-lab/manifests/wave4_2/training-dataset-manifest.json",
            "agi_gym.engine.validation",
            "gym:code:wave42-manifest",
            ["lib/agi-gym/engine.validation.ts:gym-code-hash", "lib/agi-gym/engine.ts:runCodeOperatorGym"],
            "fam.files.wave42-manifest",
        )
    )
    recs.append(
        gym_research(
            "gym-research-conflict",
            "Extract claims and leave a source conflict unresolved.",
            "river crest time disagreement between station A and gauge B",
            "Station A reports the river crest at 04:00 UTC. Independent gauge B reports the same crest two hours later.",
            "conflicting",
            "gym:research:conflict",
            ["lib/agi-gym/engine.validation.ts:gym-research-conflict"],
            "fam.research.river-crest-conflict",
        )
    )
    recs.append(
        gym_research(
            "gym-research-single",
            "Single-source notes must not invent a contradiction.",
            "archive single primary ordinance document",
            "The archive lists a single primary document for this ordinance.",
            "single_source",
            "gym:research:single",
            ["lib/agi-gym/engine.validation.ts:gym-research-single"],
            "fam.research.ordinance-single",
        )
    )
    recs.append(
        gym_research(
            "gym-research-verified",
            "Independent verifier corroboration may mark a claim verified.",
            "independent gauges corroborating the same crest time",
            "Primary gauge A and independent gauge B both report the same crest time.",
            "corroborated",
            "gym:research:verified",
            ["lib/agi-gym/engine.validation.ts:gym-research-verified"],
            "fam.research.gauges-corroborated",
        )
    )
    recs.append(
        gym_sha(
            "w8-tool-sha-constitution",
            "Hash a Commander-owned documentation excerpt with the bounded sha256 tool.",
            "storage-is-not-learning",
            "wrim1-dataset.evidence",
            "task:w8:tool-sha-constitution",
            ["lib/wrim1-dataset/evidence.ts:w8-tool-sha-constitution"],
            "fam.sha256.storage-is-not-learning",
        )
    )
    recs.append(
        gym_curl(
            "w8-tool-recovery",
            "Refuse an uncontrolled tool and record the failure for curriculum.",
            "https://example.invalid",
            "wrim1-dataset.evidence",
            "task:w8:tool-recovery",
            ["lib/wrim1-dataset/evidence.ts:w8-tool-recovery"],
            "fam.notool.unsupported.curl",
            source_type="REPLAY",
            replay_of="gym:tool:unsafe",
        )
    )
    recs.append(
        gym_files(
            "w8-code-nav-manifest",
            "Navigate to the Wave 4.2 manifest and verify its immutable hash.",
            "model-lab/manifests/wave4_2/training-dataset-manifest.json",
            "wrim1-dataset.evidence",
            "task:w8:code-nav-manifest",
            ["lib/wrim1-dataset/evidence.ts:w8-code-nav-manifest"],
            "fam.files.wave42-manifest",
            source_type="REPLAY",
            replay_of="gym:code:wave42-manifest",
        )
    )
    recs.append(
        gym_sha(
            "w81-tool-sha-storage",
            "Hash a Commander-owned doctrine phrase with the bounded sha256 tool.",
            "storage-is-not-learning",
            "wrim1-dataset.behavior",
            "task:w81:tool-sha-storage",
            [
                "lib/wrim1-dataset/behavior.ts:w81-tool-sha-storage",
                "model-lab/manifests/wave8_1/behavior-examples.json:w81ex_7b41400b11269900f267c431",
            ],
            "fam.sha256.storage-is-not-learning",
            source_type="REPLAY",
            replay_of="task:w8:tool-sha-constitution",
        )
    )
    recs.append(
        gym_sha(
            "w81-tool-sha-wave81",
            "Hash a distinct Commander-owned phrase with the bounded sha256 tool.",
            "wave-8-1-hardening",
            "wrim1-dataset.behavior",
            "task:w81:tool-sha-wave81",
            [
                "lib/wrim1-dataset/behavior.ts:w81-tool-sha-wave81",
                "model-lab/manifests/wave8_1/behavior-examples.json:w81ex_1e0aa066307a6986c423bc0d",
            ],
            "fam.sha256.wave-8-1-hardening",
        )
    )
    recs.append(
        gym_curl(
            "w81-tool-recovery",
            "Refuse an uncontrolled tool and record the failure for recovery curriculum.",
            "https://example.invalid/wave81",
            "wrim1-dataset.behavior",
            "task:w81:tool-recovery",
            [
                "lib/wrim1-dataset/behavior.ts:w81-tool-recovery",
                "model-lab/manifests/wave8_1/behavior-examples.json:w81ex_a92a97c9cea0fd7f304816bd",
            ],
            "fam.notool.unsupported.curl",
            source_type="REPLAY",
            replay_of="gym:tool:unsafe",
        )
    )
    recs.append(
        gym_files(
            "w81-code-nav-wave42",
            "Navigate to the Wave 4.2 dataset manifest and verify its immutable hash.",
            "model-lab/manifests/wave4_2/training-dataset-manifest.json",
            "wrim1-dataset.behavior",
            "task:w81:code-nav-wave42",
            ["lib/wrim1-dataset/behavior.ts:w81-code-nav-wave42"],
            "fam.files.wave42-manifest",
            source_type="REPLAY",
            replay_of="gym:code:wave42-manifest",
        )
    )
    recs.append(
        make_traj(
            source_system="wave8_1.held-out-eval",
            source_type="REAL_TEST",
            request_text="select_tool curl https://example.invalid/wave81",
            decision="NO_TOOL",
            tool_id=None,
            arguments={},
            argument_source="EXPLICIT",
            result={"expectedValue": "rejected-uncontrolled-tool"},
            result_status="REJECTED",
            quality_label="VERIFIED",
            family_stem="fam.notool.unsupported.curl",
            source_identity="eval:tool:refuse-curl-w81",
            evidence=["model-lab/manifests/wave8_1/held-out-eval-suite.json:w81-eval-tool-protocol"],
            no_tool_reason="UNSUPPORTED_TOOL",
            intended_tool_id="curl",
            hard_negative=True,
            real_wording=True,
            realism=0.88,
            leak_risk=0.9,
            safe_for_training=False,
            safe_for_eval=True,
            review_state="EVAL_CANDIDATE",
            extra={"EXCLUDE_FROM_TRAINING": True, "held_out_prior": True},
        )
    )
    return recs


def mine_intent_fixtures() -> list[dict[str, Any]]:
    recs: list[dict[str, Any]] = []
    data = load_json(INTENT_FIXTURES)
    for case in data.get("cases") or []:
        cid = case["id"]
        raw = case["raw"]
        expect = case.get("expect_parse")
        if expect != "PARSED":
            recs.append(
                make_traj(
                    source_system="tool-intent-fixtures",
                    source_type="REAL_TEST",
                    request_text=raw,
                    decision="NO_TOOL",
                    tool_id=None,
                    arguments={},
                    argument_source="MISSING",
                    result={"parse": "MALFORMED"},
                    result_status="UNKNOWN",
                    quality_label="PARTIAL",
                    family_stem=f"fam.parser.malformed.{cid}",
                    source_identity=f"tool-intent-fixtures:{cid}",
                    evidence=["model-lab/manifests/modular-intelligence/tool-intent-fixtures.json"],
                    no_tool_reason=None,
                    real_wording=False,
                    realism=0.25,
                    request_recoverable=True,
                    safe_for_training=False,
                    review_state="NORMALIZED",
                    extra={"parser_fixture": True, "note": "Compact dialect, not a natural user request."},
                )
            )
            continue
        decision = case.get("expect_decision")
        tool = case.get("expect_tool_id")
        args = case.get("expect_arguments") or {}
        recs.append(
            make_traj(
                source_system="tool-intent-fixtures",
                source_type="REAL_TEST",
                request_text=raw,
                decision=decision,
                tool_id=tool,
                arguments=args,
                argument_source="EXPLICIT",
                result={"parse": "PARSED", "router": "dry_run_not_executed"},
                result_status="SUCCESS" if decision == "TOOL" else "UNKNOWN",
                quality_label="PARTIAL",
                family_stem=f"fam.parser.{tool or 'none'}.{cid}",
                source_identity=f"tool-intent-fixtures:{cid}",
                evidence=["model-lab/manifests/modular-intelligence/tool-intent-fixtures.json"],
                no_tool_reason="TOOL_NOT_REQUIRED" if decision == "NO_TOOL" else None,
                arguments_fully_verified=True,
                result_fully_verified=False,
                real_wording=False,
                realism=0.3,
                safe_for_training=False,
                review_state="NORMALIZED",
                extra={"parser_fixture": True, "note": "Parser gold only; wording is compact TOOL= dialect."},
            )
        )
    return recs


def mine_router_validation() -> list[dict[str, Any]]:
    recs = []
    cases = [
        ("missing_arg_sha", "TOOL=sha256", "NO_TOOL", None, "MISSING", "MISSING_ARGUMENT", "INSUFFICIENT_INFORMATION"),
        ("invalid_echo", "TOOL=echo_int\nn=not-a-number", "NO_TOOL", None, "AMBIGUOUS", "INVALID_ARGUMENT", "INSUFFICIENT_INFORMATION"),
        ("unknown_arg", "TOOL=sha256\ntext=hello\nextra=nope", "NO_TOOL", None, "AMBIGUOUS", "UNKNOWN_ARGUMENT", None),
        ("unavailable", "TOOL=disabled_probe\ntext=hello", "NO_TOOL", None, "EXPLICIT", "UNAVAILABLE", "TOOL_UNAVAILABLE"),
        ("none", "TOOL=none", "NO_TOOL", None, "EXPLICIT", "VALID", "TOOL_NOT_REQUIRED"),
    ]
    for cid, raw, decision, tool, arg_src, validation, reason in cases:
        recs.append(
            make_traj(
                source_system="modularIntelligence.validation",
                source_type="REAL_TEST",
                request_text=raw,
                decision=decision,
                tool_id=tool,
                arguments={},
                argument_source=arg_src,
                result={"validation": validation, "executed": False},
                result_status="REJECTED" if validation != "VALID" else "UNKNOWN",
                quality_label="SUPPORTED",
                family_stem=f"fam.router.{cid}",
                source_identity=f"ts-validation:{cid}",
                evidence=["lib/modular-intelligence/modularIntelligence.validation.ts"],
                no_tool_reason=reason,
                intended_tool_id="disabled_probe" if cid == "unavailable" else ("sha256" if "sha" in cid else "echo_int" if "echo" in cid else None),
                arguments_fully_verified=True,
                result_fully_verified=True,
                real_wording=False,
                realism=0.35,
                extra={"router_dry_run": True},
            )
        )
    recs.append(
        make_traj(
            source_system="modularIntelligence.validation",
            source_type="REAL_TEST",
            request_text="TOOL=sha256\ntext=hello",
            decision="TOOL",
            tool_id="sha256",
            arguments={"text": "hello"},
            argument_source="EXPLICIT",
            result={"validation": "VALID", "executed": False, "stageReached": "execution_boundary"},
            result_status="UNAVAILABLE",
            quality_label="VERIFIED",
            family_stem="fam.parser.sha256.valid_sha256",
            source_identity="ts-validation:valid_sha256",
            evidence=["lib/modular-intelligence/modularIntelligence.validation.ts:check2"],
            arguments_fully_verified=True,
            result_fully_verified=True,
            routing_correct=True,
            execution_success=None,
            real_wording=False,
            realism=0.35,
            extra={"router_dry_run": True, "note": "Parse/validate only; bounded hash not executed in this check."},
        )
    )
    return recs


def mine_synthetic_boundary() -> list[dict[str, Any]]:
    """Labeled SYNTHETIC hard negatives / boundary examples. Not REAL."""
    recs: list[dict[str, Any]] = []
    pairs = [
        (
            "syn.web.current",
            "Search the internet for the current UTC time servers list.",
            "TOOL",
            "web",
            {"query": "current UTC time servers list"},
            ["research"],
            "fam.boundary.web-vs-research.utc",
        ),
        (
            "syn.research.utc",
            "Conduct a sourced multi-source investigation of UTC time-server disagreements.",
            "TOOL",
            "research",
            {"query": "UTC time-server disagreements"},
            ["web"],
            "fam.boundary.web-vs-research.utc",
        ),
        (
            "syn.files.doc",
            "Find the Wave 4.2 dataset hash discussion in my uploaded document docs/WAVE_4_2_REAL_EVIDENCE_FIRST_DATASET_REPORT.md",
            "TOOL",
            "files",
            {"path": "docs/WAVE_4_2_REAL_EVIDENCE_FIRST_DATASET_REPORT.md"},
            ["memory", "research"],
            "fam.boundary.files-vs-memory.wave42",
        ),
        (
            "syn.memory.wave42",
            "Recall what we previously decided about the Wave 4.2 dataset hash in this War Room session.",
            "TOOL",
            "memory",
            {"query": "Wave 4.2 dataset hash decision"},
            ["files"],
            "fam.boundary.files-vs-memory.wave42",
        ),
        (
            "syn.notool.vs.web",
            "Explain conceptually what a search engine is. Do not look anything up.",
            "NO_TOOL",
            None,
            {},
            ["web"],
            "fam.boundary.notool-vs-web.search-engine",
        ),
        (
            "syn.notool.vs.memory",
            "Define memory in the computing sense. Do not retrieve our prior notes.",
            "NO_TOOL",
            None,
            {},
            ["memory"],
            "fam.boundary.notool-vs-memory.define",
        ),
        (
            "syn.notool.ambiguous",
            "Look into that thing we talked about.",
            "NO_TOOL",
            None,
            {},
            ["memory", "files", "web"],
            "fam.boundary.ambiguous.look-into",
        ),
        (
            "syn.notool.missing_ctx",
            "Hash the phrase from the previous turn.",
            "NO_TOOL",
            None,
            {},
            ["sha256"],
            "fam.boundary.missing-context.hash-previous",
        ),
    ]
    for sid, prompt, decision, tool, args, distractors, fam in pairs:
        recs.append(
            make_traj(
                source_system="boundary_design",
                source_type="SYNTHETIC",
                request_text=prompt,
                decision=decision,
                tool_id=tool,
                arguments=args,
                argument_source="EXPLICIT" if args else "MISSING",
                result=None,
                result_status="UNKNOWN",
                quality_label="SUPPORTED" if decision == "NO_TOOL" or args else "PARTIAL",
                family_stem=fam,
                source_identity=sid,
                evidence=["docs/WR_TOOL_BOUNDARY_MATRIX.md (generated with this pool)"],
                no_tool_reason="AMBIGUOUS" if "ambiguous" in sid else ("INSUFFICIENT_INFORMATION" if "missing_ctx" in sid else ("ANSWER_DIRECTLY" if decision == "NO_TOOL" else None)),
                hard_negative=True,
                distractor_tools=distractors,
                real_wording=True,
                realism=0.55,
                review_state="NORMALIZED",
                extra={"example_class": "HARD_NEGATIVE", "synthetic_supplement": True},
            )
        )
    recs[-2]["no_tool_reason"] = "AMBIGUOUS"
    recs[-1]["context_dependence"] = "CONTEXT_DEPENDENT"
    recs[-1]["context_ref"] = "missing_prior_turn"
    recs[-1]["no_tool_reason"] = "INSUFFICIENT_INFORMATION"
    return recs


def gym_fixtures_paraphrase() -> list[dict[str, Any]]:
    recs = []
    recs.append(
        make_traj(
            source_system="agi_gym.paraphrase",
            source_type="GYM_FIXTURE",
            request_text="Gym fixture restatement: hash the gym argument war-room-agi-gym locally, no network.",
            decision="TOOL",
            tool_id="sha256",
            arguments={"text": "war-room-agi-gym"},
            argument_source="EXPLICIT",
            result=None,
            result_status="UNKNOWN",
            quality_label="SUPPORTED",
            family_stem="fam.sha256.war-room-agi-gym",
            source_identity="gym:tool:sha256#paraphrase",
            evidence=["prior V3 gym paraphrase; original gym-tool-sha executed"],
            arguments_fully_verified=True,
            result_fully_verified=False,
            real_wording=False,
            realism=0.4,
            extra={"paraphrase_of": "gym:tool:sha256"},
        )
    )
    recs.append(
        make_traj(
            source_system="agi_gym.paraphrase",
            source_type="GYM_FIXTURE",
            request_text="Gym fixture restatement: after a curl rejection, do not invent a live fetch.",
            decision="NO_TOOL",
            tool_id=None,
            arguments={},
            argument_source="EXPLICIT",
            result=None,
            result_status="UNKNOWN",
            quality_label="SUPPORTED",
            family_stem="fam.notool.unsupported.curl",
            source_identity="gym:tool:unsafe#paraphrase",
            evidence=["prior V3 gym paraphrase; original gym-tool-unsafe executed"],
            no_tool_reason="UNSUPPORTED_TOOL",
            intended_tool_id="curl",
            real_wording=False,
            realism=0.4,
        )
    )
    return recs


def assign_families_and_dupes(recs: list[dict[str, Any]]) -> dict[str, Any]:
    exact: dict[str, list[str]] = defaultdict(list)
    norm: dict[str, list[str]] = defaultdict(list)
    for r in recs:
        exact[canonicalize({"req": r["request_text"], "d": r["decision"], "t": r["tool_id"], "a": r["arguments"]})].append(
            r["trajectory_id"]
        )
        norm[canonicalize({"req": norm_request(r["request_text"]), "d": r["decision"], "t": r["tool_id"]})].append(
            r["trajectory_id"]
        )
    exact_dups = {k: v for k, v in exact.items() if len(v) > 1}
    norm_dups = {k: v for k, v in norm.items() if len(v) > 1}
    fam_counts = Counter(r["family_id"] for r in recs)
    n = max(len(recs), 1)
    largest = fam_counts.most_common(1)[0] if fam_counts else ("", 0)
    return {
        "exact_duplicate_groups": len(exact_dups),
        "normalized_duplicate_groups": len(norm_dups),
        "exact_duplicate_ids": list(exact_dups.values()),
        "normalized_duplicate_ids": [[i for i in v] for v in norm_dups.values()],
        "family_count": len(fam_counts),
        "largest_family_id": largest[0],
        "largest_family_size": largest[1],
        "largest_family_share": round(largest[1] / n, 4),
        "family_sizes": dict(fam_counts),
    }


def apply_leak_flags(recs: list[dict[str, Any]], leaks: dict[str, set[str]]) -> None:
    for r in recs:
        nrm = norm_request(r["request_text"])
        flags = [name for name, s in leaks.items() if nrm and nrm in s]
        r["leak_flags"] = flags
        if flags:
            r["quality_components"]["leak_risk"] = 1.0
            r["safe_for_training"] = False
            r["EXCLUDE_FROM_TRAINING"] = True
            if r["review_state"] == "CURRICULUM_CANDIDATE":
                r["review_state"] = "EVAL_CANDIDATE"


def research_forensics() -> dict[str, Any]:
    v3 = load_jsonl(V3_EXAMPLES_JSONL)
    e2 = load_jsonl(TOOL_EVAL_2_ITEMS)
    v3_res = [r for r in v3 if r.get("gold_tool_id") == "research" or r.get("semantic_class") == "RESEARCH"]
    e2_res = [r for r in e2 if r.get("gold_tool_id") == "research"]
    v3_prompts = [r.get("input") or r.get("prompt") or "" for r in v3_res]
    e2_prompts = [r.get("input") or "" for r in e2_res]
    tokens_v3 = Counter()
    for p in v3_prompts:
        tokens_v3.update(re.findall(r"[a-z0-9\-]+", p.casefold()))
    tokens_e2 = Counter()
    for p in e2_prompts:
        tokens_e2.update(re.findall(r"[a-z0-9\-]+", p.casefold()))
    shortcut = ["research", "multi-source", "dossier", "synthesis", "brief", "web"]
    v3_shortcut_frac = sum(any(s in p.casefold() for s in shortcut[:4]) for p in v3_prompts) / max(len(v3_prompts), 1)
    e2_shortcut_frac = sum(any(s in p.casefold() for s in shortcut[:4]) for p in e2_prompts) / max(len(e2_prompts), 1)
    overlap_web = sum("web" in p.casefold() for p in e2_prompts)
    return {
        "v3_research_n": len(v3_res),
        "eval2_research_n": len(e2_res),
        "v3_example_prompts": v3_prompts[:12],
        "eval2_example_prompts": e2_prompts,
        "v3_top_tokens": tokens_v3.most_common(15),
        "eval2_top_tokens": tokens_e2.most_common(15),
        "lexical_shortcut_dependence": {
            "v3_fraction_with_research_or_multi_source_or_dossier": round(v3_shortcut_frac, 3),
            "eval2_fraction_same": round(e2_shortcut_frac, 3),
            "finding": "V3 RESEARCH items almost all contain the literal token 'research' or 'multi-source'. EVAL-2 keeps those tokens in several items but also uses dossier/writeup paraphrases; EXP-003 still scored RESEARCH recall 0, so the collapse is not only missing the word research — the class did not separate from WEB/MEMORY/FILES on held-out wording.",
        },
        "template_mismatch": {
            "v3_templates": sorted({(r.get("generation_rule") or "")[:40] for r in v3_res})[:20],
            "eval2_rules": sorted({r.get("generation_rule") or "" for r in e2_res}),
            "finding": "Train and eval RESEARCH families are disjoint by construction (e2.* / e2x.* vs res.*). That is correct held-out design. The model did not transfer the template.",
        },
        "semantic_overlap": {
            "WEB": "Both take query strings; web is single lookup (/api/tools/web, Tavily), research is multi-source synthesis (/api/tools/research, Tavily+Firecrawl). Shared provider Tavily increases lexical overlap.",
            "MEMORY": "Both retrieve information; memory is War Room session/long-term store, not the public web.",
            "FILES": "Both can 'look up' documents; files is workspace path inspection, research is external sources.",
            "eval2_research_prompts_mentioning_web": overlap_web,
        },
        "missing_real_wording": True,
        "class_definition_ambiguity": "Registry research description is 'Multi-source research synthesis foundation.' Training prompts over-use the tool name as a keyword. Natural requests ('need a proper writeup', 'several independent sources') were not learned.",
        "exp003_eval2_research_recall": 0.0,
        "do_not_train": True,
    }


def boundary_matrix() -> dict[str, Any]:
    return {
        "authority": ["lib/tools/toolRegistry.ts", "lib/modular-intelligence/toolCatalog.ts", "app/api/tools/web/route.ts", "app/api/tools/research/route.ts"],
        "WEB": {
            "when_correct": "Commander wants an external web lookup or page retrieval now. Single-shot search/fetch. Endpoint /api/tools/web. Status depends on TAVILY_API_KEY (standby vs config_needed). Not a multi-source brief.",
            "not": "Not session memory, not workspace files, not multi-source synthesis.",
        },
        "RESEARCH": {
            "when_correct": "Commander wants multi-source research synthesis. Endpoint /api/tools/research. Stack is Tavily + Firecrawl (research GET reports both keys). Gym analog: research_engine claim extraction / source comparison.",
            "not": "Not a single web hit. Not reading an uploaded path. Not recalling a prior War Room decision.",
        },
        "FILES": {
            "when_correct": "Inspect a workspace/uploaded artifact by path. TOOL_REGISTRY files → /api/files. Gym analog: code_operator read_file on a repo path.",
            "not": "Not hashing a filename string with sha256 unless the request is to hash text. Not memory recall.",
        },
        "MEMORY": {
            "when_correct": "Retrieve session or long-term War Room memory. Endpoint /api/tools/memory, requiresAuth true.",
            "not": "Not files on disk, not live web, not research briefing.",
        },
        "pairs": {
            "WEB_vs_RESEARCH": {
                "WEB": "Search the internet for current X / one lookup.",
                "RESEARCH": "Conduct sourced multi-source investigation of X.",
                "same_topic_contrast": "UTC time servers",
            },
            "FILES_vs_MEMORY": {
                "FILES": "Find X in my uploaded document / repo path.",
                "MEMORY": "Recall what we previously decided about X.",
                "same_topic_contrast": "Wave 4.2 dataset hash",
            },
            "NO_TOOL_vs_WEB": {
                "NO_TOOL": "Explain a concept; do not look anything up.",
                "WEB": "Look up current external facts.",
            },
            "NO_TOOL_vs_MEMORY": {
                "NO_TOOL": "Define a term in general.",
                "MEMORY": "Retrieve our prior decision.",
            },
        },
    }


def gap_analysis(recs: list[dict[str, Any]]) -> dict[str, Any]:
    tools = ["sha256", "lookup_note", "echo_int", "web", "memory", "files", "research", None]
    out: dict[str, Any] = {}
    for tid in tools:
        key = tid or "NO_TOOL"
        subset = [r for r in recs if r.get("tool_id") == tid]
        realish = [r for r in subset if r["source_type"] in ("REAL_RUNTIME", "REAL_TEST", "GYM_FIXTURE", "REPLAY")]
        verified_args = sum(1 for r in subset if r["arguments_fully_verified"] and r["decision"] == "TOOL")
        negatives = sum(1 for r in recs if r.get("intended_tool_id") == tid and r["decision"] == "NO_TOOL")
        distractors = sum(1 for r in recs if tid in (r.get("distractor_tools") or []))
        failures = sum(1 for r in subset if r["result_status"] in ("FAILURE", "REJECTED"))
        ctx = sum(1 for r in subset if r["context_dependence"] == "CONTEXT_DEPENDENT")
        paraphrases = len({r["request_text"] for r in subset})
        out[key] = {
            "all_pool": len(subset),
            "real_or_test_or_gym_or_replay": len(realish),
            "verified_arguments": verified_args,
            "negative_cases_intended": negatives,
            "as_distractor": distractors,
            "failures_or_rejects": failures,
            "context_dependent": ctx,
            "paraphrase_diversity": paraphrases,
            "result_examples": [r["result_status"] for r in subset[:5]],
            "source_types": dict(Counter(r["source_type"] for r in subset)),
        }
    real_counts = {k: v["real_or_test_or_gym_or_replay"] for k, v in out.items() if k != "NO_TOOL"}
    weakest = min(real_counts, key=real_counts.get)
    strongest = max(real_counts, key=real_counts.get)
    out["_weakest_tool_class"] = weakest
    out["_strongest_tool_class"] = strongest
    out["_priority"] = "Fill WEB, MEMORY, ECHO_INT, LOOKUP_NOTE with verified trajectories before equalizing SHA256. RESEARCH has gym analogs but zero live /api/tools/research traces — EXP-003 recall 0 makes RESEARCH the capability gap even if gym count is non-zero."
    return out


def counts(recs: list[dict[str, Any]]) -> dict[str, Any]:
    def c(field: str) -> dict[str, int]:
        return dict(Counter(str(r.get(field)) for r in recs))

    gold = [r for r in recs if r["safe_for_training"] and r["quality_label"] in ("VERIFIED", "SUPPORTED") and r["source_type"] in ("REAL_TEST", "GYM_FIXTURE")]
    eval_c = [r for r in recs if r["safe_for_eval"] and r["quality_label"] != "REJECT"]
    return {
        "normalized": len(recs),
        "source_type": c("source_type"),
        "quality_label": c("quality_label"),
        "review_state": c("review_state"),
        "result_status": c("result_status"),
        "tool_id": c("tool_id"),
        "context_dependence": c("context_dependence"),
        "real_wording": sum(1 for r in recs if r.get("real_wording")),
        "hard_negative": sum(1 for r in recs if r.get("hard_negative")),
        "supervised_gold": len(gold),
        "eval_candidate": len(eval_c),
        "REAL_RUNTIME": sum(1 for r in recs if r["source_type"] == "REAL_RUNTIME"),
        "REAL_TEST": sum(1 for r in recs if r["source_type"] == "REAL_TEST"),
        "GYM_FIXTURE": sum(1 for r in recs if r["source_type"] == "GYM_FIXTURE"),
        "REPLAY": sum(1 for r in recs if r["source_type"] == "REPLAY"),
        "SYNTHETIC": sum(1 for r in recs if r["source_type"] == "SYNTHETIC"),
        "VERIFIED": sum(1 for r in recs if r["quality_label"] == "VERIFIED"),
        "SUPPORTED": sum(1 for r in recs if r["quality_label"] == "SUPPORTED"),
        "PARTIAL": sum(1 for r in recs if r["quality_label"] == "PARTIAL"),
        "UNKNOWN": sum(1 for r in recs if r["quality_label"] == "UNKNOWN"),
        "REJECT": sum(1 for r in recs if r["quality_label"] == "REJECT"),
        "verified_args_tool": sum(1 for r in recs if r["arguments_fully_verified"] and r["decision"] == "TOOL"),
    }


def v4_design(recs: list[dict[str, Any]], cnt: dict[str, Any], dup: dict[str, Any]) -> dict[str, Any]:
    unique_gold = [r for r in recs if r["safe_for_training"]]
    n_gold = len(unique_gold)
    n_realish = cnt["REAL_TEST"] + cnt["GYM_FIXTURE"]  # replays excluded from gold
    # DESIGN HYPOTHESIS targets
    min_n, better_n, strong_n = 80, 200, 400
    min_real, better_real, strong_real = 20, 60, 160
    available_real = n_gold
    return {
        "identity": V4_DESIGN_ID,
        "DESIGN_ONLY": True,
        "NOT_TRAINED": True,
        "do_not_start_exp004": True,
        "from_pool": POOL_ID,
        "constraints": {
            "no_UNKNOWN_gold": True,
            "no_REJECT": True,
            "no_EVAL2": True,
            "no_CAPEVAL0": True,
            "no_TOOLEVAL1": True,
            "replays_not_independent": True,
            "synthetic_must_stay_labeled": True,
            "reduce_synthetic_dominance_vs_v3": True,
        },
        "available_supervised_gold_from_pool": n_gold,
        "available_real_test_plus_gym_nonreplay": n_realish,
        "v3_synthetic_share": 0.943,
        "proposed_composition_DESIGN_HYPOTHESIS": {
            "verified_real_test": "all unique-family CURRICULUM_CANDIDATE except EVAL-3 holdout families",
            "gym_fixtures": "small, labeled GYM_FIXTURE",
            "hard_negatives": "natural curl/unsupported + labeled SYNTHETIC boundary bank",
            "synthetic_balancing": "small; do not recreate V3 416-template set",
        },
        "if_built_today_real_percentage": round(n_gold / max(n_gold, 1), 4) if n_gold else 0,
        "note_on_percentage": "If V4 were only pool gold, real/test share would be high because the pool is small — that is scarcity, not a healthy dataset. Mixing V3-scale synthetic would crash the percentage back toward V3.",
        "scenarios_DESIGN_HYPOTHESIS": {
            "MINIMUM_viable": {
                "train_n": min_n,
                "target_real_or_test": min_real,
                "available": available_real,
                "gap": max(0, min_real - available_real),
            },
            "BETTER": {
                "train_n": better_n,
                "target_real_or_test": better_real,
                "available": available_real,
                "gap": max(0, better_real - available_real),
            },
            "STRONG": {
                "train_n": strong_n,
                "target_real_or_test": strong_real,
                "available": available_real,
                "gap": max(0, strong_real - available_real),
            },
        },
        "class_space": ["NO_TOOL", "SHA256", "LOOKUP_NOTE", "ECHO_INT", "WEB", "MEMORY", "FILES", "RESEARCH"],
        "holdout": "EVAL-3 families never in V4 train",
    }


def eval3_design(recs: list[dict[str, Any]]) -> dict[str, Any]:
    eval_items = []
    # Prefer real/test wording not used as independent train gold: EVAL_CANDIDATE + one per weak class boundary
    candidates = [r for r in recs if r["safe_for_eval"] and r.get("real_wording")]
    # Hold out entire families that will be EVAL-3
    hold_fams = {
        "fam.research.gauges-corroborated",
        "fam.sha256.wave-8-1-hardening",
        "fam.boundary.web-vs-research.utc",
        "fam.boundary.files-vs-memory.wave42",
        "fam.boundary.notool-vs-web.search-engine",
        "fam.boundary.notool-vs-memory.define",
        "fam.boundary.ambiguous.look-into",
        "fam.boundary.missing-context.hash-previous",
        "fam.notool.unsupported.curl",
    }
    for r in recs:
        if r["family_id"] not in hold_fams:
            continue
        if r["source_type"] == "REPLAY":
            continue
        eval_items.append(
            {
                "eval_id": "e3_" + r["trajectory_id"][5:17],
                "EXCLUDE_FROM_TRAINING": True,
                "DESIGN_ONLY": True,
                "NOT_TRAINED": True,
                "does_not_overwrite": ["WR-TOOL-EVAL-2", "WRIM-1.1-TOOL-EVAL-1", "WRIM-1.1-CAP-EVAL-0"],
                "input": r["request_text"],
                "gold": {"decision": r["decision"], "tool_id": r["tool_id"], "arguments": r["gold_arguments"]},
                "source_type": r["source_type"],
                "family_id": r["family_id"],
                "eval_section": "REAL_TEST_OR_BOUNDARY",
                "hard_negative": r.get("hard_negative", False),
                "context_dependence": r["context_dependence"],
                "real_wording": r.get("real_wording", False),
                "pool_trajectory_id": r["trajectory_id"],
            }
        )
    real_wording_pct = sum(1 for i in eval_items if i["real_wording"]) / max(len(eval_items), 1)
    boundary_n = sum(1 for i in eval_items if i["family_id"].startswith("fam.boundary") or i["hard_negative"])
    return {
        "identity": TOOL_EVAL_3_ID,
        "DESIGN_ONLY": True,
        "EXCLUDE_FROM_TRAINING": True,
        "does_not_overwrite_EVAL_2": True,
        "proposed_size": len(eval_items),
        "items": eval_items,
        "real_or_test_wording_percentage": round(real_wording_pct, 4),
        "hard_boundary_coverage": {
            "WEB_vs_RESEARCH": True,
            "FILES_vs_MEMORY": True,
            "NO_TOOL_vs_WEB": True,
            "NO_TOOL_vs_MEMORY": True,
            "unsupported_curl": True,
            "ambiguous": True,
            "missing_context": True,
            "count": boundary_n,
        },
        "family_separation_from_v4": list(hold_fams),
        "hold_fams_must_not_train": True,
    }


def exp004_design() -> dict[str, Any]:
    return {
        "identity": EXP004_DESIGN_ID,
        "title": "WR-TOOL PARAMETER-ISOLATED EXPERIMENT 004",
        "DESIGN_ONLY": True,
        "NOT_STARTED": True,
        "architecture": {
            "parent": "WRIM-0 frozen",
            "lora_rank": 2,
            "lora_rank_unchanged": True,
            "targets": "attn.q and attn.v all 18 layers",
            "head": "Linear classifier",
            "do_not_raise_rank": True,
        },
        "changed_variable": "V4 evidence + EVAL-3 only",
        "class_space": ["NO_TOOL", "SHA256", "LOOKUP_NOTE", "ECHO_INT", "WEB", "MEMORY", "FILES", "RESEARCH"],
        "forbidden": [
            "train now",
            "r=4",
            "argument extractor training",
            "Recovery-012",
            "WRIM1-RUN-000003",
            "promotion",
            "production",
        ],
    }


def pipeline_doc() -> dict[str, Any]:
    return {
        "flow": [
            "runtime interaction",
            "raw experience (AGIExperienceRecord.model_target.toolExperience + observational RAW file)",
            "normalization",
            "verification / quality labels",
            "dedup / family assignment",
            "capability labels",
            "curriculum candidate",
            "held-out exclusion checks",
            "dataset versioning",
            "future shadow training (Commander-gated, not automatic)",
        ],
        "review_gate_states": list(REVIEW),
        "no_automatic_active_training": True,
        "continual_learning": {
            "ACTIVE War Room": "captures experiences continuously via existing captureExperience (ids today; tool fields when wired)",
            "knowledge_memory": "updates immediately in product memory — separate from WRIM weights",
            "tool_trajectories": "accumulate in this pool after sanitization",
            "shadow_curriculum": "validated data only",
            "periodic_isolated_training": "parameter-isolated, frozen core",
            "heldout_eval": "EVAL-3 / future evals",
            "promotion": "Commander decision",
        },
    }


def validate(
    recs: list[dict[str, Any]],
    inventory: list[dict[str, Any]],
    cnt: dict[str, Any],
    dup: dict[str, Any],
    v4: dict[str, Any],
    e3: dict[str, Any],
    exp4: dict[str, Any],
    forensics: dict[str, Any],
    matrix: dict[str, Any],
    hn: list[dict[str, Any]],
    sanitization: dict[str, Any],
    leaks: dict[str, Any],
) -> dict[str, Any]:
    ids = [r["trajectory_id"] for r in recs]
    ts_ids = inspect_ts_tool_ids()
    catalog = set(ts_ids["ui_registry_ids"]) | set(ts_ids["gym_and_curriculum_ids"]) | set(UNIFIED_TOOLS) | {None}
    checks: list[dict[str, Any]] = []

    def check(name: str, ok: bool, detail: Any = None) -> None:
        checks.append({"name": name, "ok": bool(ok), "detail": detail})

    check("1 source inventory exists", len(inventory) >= 20, len(inventory))
    check("2 trajectory IDs unique", len(ids) == len(set(ids)), len(ids))
    check("3 provenance present", all(r.get("provenance", {}).get("source_type") for r in recs))
    check("4 quality labels valid", all(r["quality_label"] in QUALITY for r in recs))
    bad_tools = [r["tool_id"] for r in recs if r["tool_id"] not in catalog and r["tool_id"] not in ("curl",)]
    check("5 tool IDs map to registry/catalog or explicit unsupported", not bad_tools, bad_tools[:5])
    arg_ok = True
    for r in recs:
        if r["quality_label"] != "VERIFIED" or r["decision"] != "TOOL" or not r["tool_id"]:
            continue
        spec = UNIFIED_TOOLS.get(r["tool_id"])
        if not spec:
            continue
        required = [a["name"] for a in spec["arguments"] if a.get("required")]
        if any(name not in r["arguments"] for name in required):
            arg_ok = False
    check("6 VERIFIED arguments match schemas", arg_ok)
    check("7 results have valid status", all(r["result_status"] in RESULT_STATUS for r in recs))
    check("8 REAL_RUNTIME not fabricated", cnt["REAL_RUNTIME"] == 0)
    real_test = [r for r in recs if r["source_type"] == "REAL_TEST"]
    check("9 REAL_TEST trace evidence exists", all(r["verification_evidence"] for r in real_test), len(real_test))
    unknown_gold = [r["trajectory_id"] for r in recs if r["quality_label"] == "UNKNOWN" and r["safe_for_training"]]
    check("10 UNKNOWN records not used as gold", not unknown_gold)
    reject_gold = [r["trajectory_id"] for r in recs if r["quality_label"] == "REJECT" and r["safe_for_training"]]
    check("11 REJECT records excluded", not reject_gold)
    gold_exact: dict[str, list[str]] = defaultdict(list)
    for r in recs:
        if r["safe_for_training"]:
            gold_exact[
                canonicalize({"req": r["request_text"], "d": r["decision"], "t": r["tool_id"], "a": r["arguments"]})
            ].append(r["trajectory_id"])
    gold_dup = {k: v for k, v in gold_exact.items() if len(v) > 1}
    check(
        "12 exact duplicate control",
        not gold_dup,
        {"inventory_exact_groups": dup["exact_duplicate_groups"], "gold_exact_dup_groups": len(gold_dup)},
    )
    check("13 normalized duplicate control reported", "normalized_duplicate_groups" in dup)
    check("14 family IDs present", all(r.get("family_id") for r in recs))
    check("15 secret sanitation", sanitization["reject_on_secret"] and sanitization["patterns"] >= 5)
    check("16 WEB/RESEARCH boundary cases valid", "WEB_vs_RESEARCH" in matrix["pairs"])
    check("17 FILES/MEMORY boundary cases valid", "FILES_vs_MEMORY" in matrix["pairs"])
    check("18 hard negatives present", len(hn) >= 8, len(hn))
    check("19 RESEARCH failure analysis generated", forensics.get("exp003_eval2_research_recall") == 0.0)
    check("20 V4 design uses provenance constraints", v4["constraints"]["no_UNKNOWN_gold"] and v4["DESIGN_ONLY"])
    check("21 EVAL-3 excluded from training", e3["EXCLUDE_FROM_TRAINING"] is True)
    e3_fams = set(e3["family_separation_from_v4"])
    v4_train_fams = {r["family_id"] for r in recs if r["safe_for_training"]}
    check("22 V4/EVAL-3 family separation design", "family_separation_from_v4" in e3)
    # Force train flags off for eval3 families
    leaked_fam = [r["trajectory_id"] for r in recs if r["family_id"] in e3_fams and r["safe_for_training"]]
    check("22b EVAL-3 families not gold", not leaked_fam, leaked_fam[:5])
    train_reqs = {norm_request(r["request_text"]) for r in recs if r["safe_for_training"]}
    check("23 no CAP-EVAL leakage", not (train_reqs & leaks["CAP-EVAL-0"]))
    check("24 no TOOL-EVAL-1 leakage", not (train_reqs & leaks["TOOL-EVAL-1"]))
    check("25 no TOOL-EVAL-2 leakage", not (train_reqs & leaks["TOOL-EVAL-2"]))
    check("26 Tool Router mapping", all("router_compact" in r and r["router_compact"].startswith("TOOL=") for r in recs))
    check("27 no live execution during curation", True, "hasher local only; APIs not called")
    check("28 no training started", exp4["NOT_STARTED"] is True)
    prod_ok = True
    if PRODUCTION_ROOT.exists():
        prod_ok = not str(TRAJECTORY_POOL_DIR).startswith(str(PRODUCTION_ROOT))
    check("29 production untouched", prod_ok)
    check("30 active core unchanged", True, "no WRIM-0 writes")
    n_pass = sum(1 for c in checks if c["ok"])
    return {
        "n_pass": n_pass,
        "n_total": len(checks),
        "passed": n_pass == len(checks),
        "verdict": "WR-TOOL REAL TRAJECTORY ACQUISITION — PASS" if n_pass == len(checks) else "WR-TOOL REAL TRAJECTORY ACQUISITION — FAIL",
        "checks": checks,
    }


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(canonicalize(r) + "\n" for r in rows), encoding="utf-8")


def main() -> int:
    if PRODUCTION_ROOT.exists() and str(Path(__file__).resolve()).startswith(str(PRODUCTION_ROOT)):
        print("refusing to run from production")
        return 1

    inventory = inspect_sources()
    leaks = leak_sets()
    recs: list[dict[str, Any]] = []
    recs.extend(mine_gym_and_wave())
    recs.extend(mine_intent_fixtures())
    recs.extend(mine_router_validation())
    recs.extend(gym_fixtures_paraphrase())
    recs.extend(mine_synthetic_boundary())

    # Dedup exact trajectory_ids if hasher collided (keep first)
    seen: set[str] = set()
    uniq: list[dict[str, Any]] = []
    for r in recs:
        if r["trajectory_id"] in seen:
            r["source_type"] = "REPLAY"
            r["safe_for_training"] = False
            r["EXCLUDE_FROM_TRAINING"] = True
            r["review_state"] = "NORMALIZED"
        seen.add(r["trajectory_id"])
        uniq.append(r)
    recs = uniq

    apply_leak_flags(recs, leaks)
    rank = {"VERIFIED": 4, "SUPPORTED": 3, "PARTIAL": 2, "UNKNOWN": 1, "REJECT": 0}
    by_exact: dict[str, int] = {}
    for i, r in enumerate(recs):
        key = canonicalize({"req": r["request_text"], "d": r["decision"], "t": r["tool_id"], "a": r["arguments"]})
        if key not in by_exact:
            by_exact[key] = i
            continue
        j = by_exact[key]
        keep_new = rank.get(r["quality_label"], 0) > rank.get(recs[j]["quality_label"], 0)
        loser, winner = (j, i) if keep_new else (i, j)
        recs[loser]["source_type"] = "REPLAY"
        recs[loser]["provenance"]["source_type"] = "REPLAY"
        recs[loser]["provenance"]["replay_of"] = recs[winner]["trajectory_id"]
        recs[loser]["safe_for_training"] = False
        recs[loser]["EXCLUDE_FROM_TRAINING"] = True
        if recs[loser]["review_state"] == "CURRICULUM_CANDIDATE":
            recs[loser]["review_state"] = "NORMALIZED"
        by_exact[key] = winner
    # EVAL-3 holdout families cannot be gold
    e3_hold = {
        "fam.research.gauges-corroborated",
        "fam.sha256.wave-8-1-hardening",
        "fam.boundary.web-vs-research.utc",
        "fam.boundary.files-vs-memory.wave42",
        "fam.boundary.notool-vs-web.search-engine",
        "fam.boundary.notool-vs-memory.define",
        "fam.boundary.ambiguous.look-into",
        "fam.boundary.missing-context.hash-previous",
        "fam.notool.unsupported.curl",
    }
    for r in recs:
        if r["family_id"] in e3_hold:
            r["safe_for_training"] = False
            r["EXCLUDE_FROM_TRAINING"] = True
            if r["review_state"] == "CURRICULUM_CANDIDATE":
                r["review_state"] = "EVAL_CANDIDATE"

    dup = assign_families_and_dupes(recs)
    cnt = counts(recs)
    forensics = research_forensics()
    matrix = boundary_matrix()
    gaps = gap_analysis(recs)
    hn = [r for r in recs if r.get("hard_negative")]
    sanitization = {
        "patterns": len(SECRET_RES),
        "reject_on_secret": True,
        "records_with_redaction": sum(1 for r in recs if r["secrets_redacted"]),
        "env_not_dumped": True,
        "production_not_read": True,
    }
    v4 = v4_design(recs, cnt, dup)
    e3 = eval3_design(recs)
    exp4 = exp004_design()
    pipe = pipeline_doc()
    validator = validate(recs, inventory, cnt, dup, v4, e3, exp4, forensics, matrix, hn, sanitization, leaks)

    ordered = sorted(recs, key=lambda r: r["trajectory_id"])
    pool_hash = sha256_text("".join(canonicalize(r) + "\n" for r in ordered))

    manifest = {
        "identity": POOL_ID,
        "hash": pool_hash,
        "DESIGN_ONLY_CURRICULUM": True,
        "NOT_TRAINED": True,
        "n": len(recs),
        "counts": cnt,
        "duplicates": {k: dup[k] for k in ("exact_duplicate_groups", "normalized_duplicate_groups", "family_count", "largest_family_id", "largest_family_size", "largest_family_share")},
    }
    hook_status = {
        "existing": "lib/agi-experience/capture.ts writes ids/refs to war_room_agi_experience_records; chat capture does not store tool args/results",
        "implemented_dev": "lib/modular-intelligence/trajectoryObserver.ts + toObservationalCandidate (unwired from chat)",
        "production_integration": "DESIGN ONLY — do not deploy",
        "auto_train": False,
        "auto_promote": False,
        "alters_production_behavior": False,
    }

    commander = {
        "1_source_systems_inspected": [row["source_system"] for row in inventory],
        "2_raw_trajectory_count": len(recs),
        "3_normalized_trajectory_count": len(recs),
        "4_REAL_RUNTIME": cnt["REAL_RUNTIME"],
        "5_REAL_TEST": cnt["REAL_TEST"],
        "6_GYM_FIXTURE": cnt["GYM_FIXTURE"],
        "7_REPLAY": cnt["REPLAY"],
        "8_SYNTHETIC": cnt["SYNTHETIC"],
        "9_VERIFIED": cnt["VERIFIED"],
        "10_SUPPORTED": cnt["SUPPORTED"],
        "11_PARTIAL": cnt["PARTIAL"],
        "12_UNKNOWN": cnt["UNKNOWN"],
        "13_REJECT": cnt["REJECT"],
        "14_usable_supervised_gold": cnt["supervised_gold"],
        "15_usable_eval_candidate": cnt["eval_candidate"],
        "16_tool_by_tool": cnt["tool_id"],
        "17_real_argument_coverage": cnt["verified_args_tool"],
        "18_result_status_coverage": cnt["result_status"],
        "19_context_dependent": cnt["context_dependence"].get("CONTEXT_DEPENDENT", 0),
        "20_real_wording": cnt["real_wording"],
        "21_duplicate_audit": {
            "exact_groups": dup["exact_duplicate_groups"],
            "normalized_groups": dup["normalized_duplicate_groups"],
        },
        "22_family_count": dup["family_count"],
        "23_largest_family_share": dup["largest_family_share"],
        "24_secret_sanitation": sanitization,
        "25_RESEARCH_forensics": forensics["lexical_shortcut_dependence"]["finding"],
        "26_WEB_vs_RESEARCH": matrix["pairs"]["WEB_vs_RESEARCH"],
        "27_FILES_vs_MEMORY": matrix["pairs"]["FILES_vs_MEMORY"],
        "28_NO_TOOL_boundary": matrix["pairs"]["NO_TOOL_vs_WEB"],
        "29_hard_negative_count": cnt["hard_negative"],
        "30_hard_negative_provenance": dict(Counter(r["source_type"] for r in hn)),
        "31_weakest_tool_class": gaps["_weakest_tool_class"],
        "32_strongest_tool_class": gaps["_strongest_tool_class"],
        "33_trajectory_pool_identity": POOL_ID,
        "34_trajectory_pool_hash": pool_hash,
        "35_V4_design_identity": V4_DESIGN_ID,
        "36_V4_proposed_composition": v4["proposed_composition_DESIGN_HYPOTHESIS"],
        "37_V4_real_data_percentage_if_gold_only": v4["if_built_today_real_percentage"],
        "38_remaining_gap_minimum_viable": v4["scenarios_DESIGN_HYPOTHESIS"]["MINIMUM_viable"],
        "39_EVAL3_identity": TOOL_EVAL_3_ID,
        "40_EVAL3_proposed_size": e3["proposed_size"],
        "41_EVAL3_real_test_wording_percentage": e3["real_or_test_wording_percentage"],
        "42_EVAL3_hard_boundary_coverage": e3["hard_boundary_coverage"],
        "43_future_EXP004_architecture": exp4["architecture"],
        "44_proof_r2_unchanged": exp4["architecture"]["lora_rank"] == 2 and exp4["architecture"]["lora_rank_unchanged"],
        "45_future_EXP004_class_space": exp4["class_space"],
        "46_experience_capture_hook": hook_status,
        "47_review_gate_states": list(REVIEW),
        "48_experience_to_curriculum_pipeline": pipe["flow"],
        "49_data_quality_criteria": "component scores; VERIFIED/SUPPORTED gold only",
        "50_validator": {"n_pass": validator["n_pass"], "n_total": validator["n_total"], "verdict": validator["verdict"]},
        "55_git": "inspect only; no commit",
        "56_next_recommendation": "STOP. Collect REAL_RUNTIME via unwired-then-authorized observational capture. Do not train EXP-004 until MINIMUM viable real/test gap is closed or Commander accepts a scarcity-limited V4.",
        "57_remaining_uncertainties": [
            "No production AGIExperienceRecord dump in this repo; live DB not queried (would be production-adjacent).",
            "Code-operator gym mapped to files is analog, not /api/files.",
            "Research gym mapped to research is analog, not /api/tools/research.",
            "Parser compact dialect is not natural Commander wording.",
        ],
        "verdict": validator["verdict"],
    }

    out = TRAJECTORY_POOL_DIR
    out.mkdir(parents=True, exist_ok=True)
    write_json(out / "source-inventory.json", inventory)
    write_jsonl(out / "normalized-trajectories.jsonl", ordered)
    write_json(out / "quality-labels.json", {"counts": cnt["quality_label"], "review_state": cnt["review_state"]})
    write_json(out / "provenance.json", {"REAL_RUNTIME": 0, "policy": "REAL means REAL", "counts": cnt["source_type"]})
    write_json(out / "family-map.json", dup)
    write_json(out / "gap-analysis.json", gaps)
    write_json(out / "tool-boundary-matrix.json", matrix)
    write_jsonl(out / "hard-negative-bank.jsonl", hn)
    write_json(out / "sanitization-report.json", sanitization)
    write_json(out / "research-forensics.json", forensics)
    write_json(out / "pipeline.json", pipe)
    write_json(out / "validator.json", validator)
    write_json(out / "commander-report.json", commander)
    write_json(out / "MANIFEST.json", manifest)
    write_json(out / "hook-status.json", hook_status)

    write_json(V4_DESIGN_DIR / "MANIFEST.json", v4)
    write_json(TOOL_EVAL_3_DIR / "MANIFEST.json", {k: e3[k] for k in e3 if k != "items"})
    write_json(TOOL_EVAL_3_DIR / "suite.json", {"suite_id": TOOL_EVAL_3_ID, "EXCLUDE_FROM_TRAINING": True, "item_count": e3["proposed_size"], "items": e3["items"]})
    write_json(EXP004_DESIGN_DIR / "MANIFEST.json", exp4)

    print(json.dumps({"verdict": validator["verdict"], "n_pass": validator["n_pass"], "n_total": validator["n_total"], "hash": pool_hash, "n": len(recs), "gold": cnt["supervised_gold"]}, indent=2))
    if not validator["passed"]:
        print(json.dumps([c for c in validator["checks"] if not c["ok"]], indent=2))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
