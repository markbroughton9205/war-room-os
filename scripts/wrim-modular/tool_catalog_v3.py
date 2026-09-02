"""Python schema view of War Room tools for WR-TOOL-CURRICULUM-V3.

Mirrors lib/modular-intelligence/toolCatalog.ts + lib/tools/toolRegistry.ts.
Does not invent tools. Dry-run / mock / bounded-sha256 only.
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any

from paths import ROOT

TOOL_REGISTRY_TS = ROOT / "lib" / "tools" / "toolRegistry.ts"
TOOL_CATALOG_TS = ROOT / "lib" / "modular-intelligence" / "toolCatalog.ts"

# Authoritative compact schemas copied from toolCatalog.ts inspection (2026-08-31).
UNIFIED_TOOLS: dict[str, dict[str, Any]] = {
    "web": {
        "displayName": "Web",
        "human_purpose": "External web lookup and page retrieval foundation.",
        "enabled": True,
        "available": True,
        "authority": "war_room_tool_registry",
        "requiresAuth": False,
        "executionProvider": "war_room_api",
        "endpoint": "/api/tools/web",
        "arguments": [{"name": "query", "type": "string", "required": True}],
        "schemaSpecified": True,
        "side_effect_class": "network_read",
        "safe_for_training_examples": True,
        "safe_for_dry_run_evaluation": True,
        "deterministic_verify": False,
        "selected_for_v3": True,
        "exclude_reason": None,
    },
    "memory": {
        "displayName": "Memory",
        "human_purpose": "Session and long-term memory retrieval foundation.",
        "enabled": True,
        "available": True,
        "authority": "war_room_tool_registry",
        "requiresAuth": True,
        "executionProvider": "war_room_api",
        "endpoint": "/api/tools/memory",
        "arguments": [{"name": "query", "type": "string", "required": True}],
        "schemaSpecified": True,
        "side_effect_class": "auth_read",
        "safe_for_training_examples": True,
        "safe_for_dry_run_evaluation": True,
        "deterministic_verify": False,
        "selected_for_v3": True,
        "exclude_reason": None,
    },
    "files": {
        "displayName": "Files",
        "human_purpose": "Workspace file inspection and artifact handling foundation.",
        "enabled": True,
        "available": True,
        "authority": "war_room_tool_registry",
        "requiresAuth": True,
        "executionProvider": "war_room_api",
        "endpoint": "/api/files",
        "arguments": [{"name": "path", "type": "string", "required": True}],
        "schemaSpecified": True,
        "side_effect_class": "auth_read",
        "safe_for_training_examples": True,
        "safe_for_dry_run_evaluation": True,
        "deterministic_verify": False,
        "selected_for_v3": True,
        "exclude_reason": None,
    },
    "research": {
        "displayName": "Research",
        "human_purpose": "Multi-source research synthesis foundation.",
        "enabled": True,
        "available": True,
        "authority": "war_room_tool_registry",
        "requiresAuth": False,
        "executionProvider": "war_room_api",
        "endpoint": "/api/tools/research",
        "arguments": [{"name": "query", "type": "string", "required": True}],
        "schemaSpecified": True,
        "side_effect_class": "network_read",
        "safe_for_training_examples": True,
        "safe_for_dry_run_evaluation": True,
        "deterministic_verify": False,
        "selected_for_v3": True,
        "exclude_reason": None,
    },
    "repo": {
        "displayName": "Repo",
        "human_purpose": "Repository status, diffs, patches, and commit workflow foundation.",
        "enabled": True,
        "available": True,
        "authority": "war_room_tool_registry",
        "requiresAuth": True,
        "executionProvider": "war_room_api",
        "endpoint": "/api/tools/repo",
        "arguments": [{"name": "action", "type": "string", "required": True}],
        "schemaSpecified": True,
        "side_effect_class": "auth_write_capable",
        "safe_for_training_examples": False,
        "safe_for_dry_run_evaluation": True,
        "deterministic_verify": False,
        "selected_for_v3": False,
        "exclude_reason": "Commit/patch workflow is not read-only; excluded from V3 routing classes to avoid high-risk variety.",
    },
    "deployments": {
        "displayName": "Deployments",
        "human_purpose": "Deployment status and release workflow foundation.",
        "enabled": True,
        "available": True,
        "authority": "war_room_tool_registry",
        "requiresAuth": True,
        "executionProvider": "war_room_api",
        "endpoint": "/api/tools/deployments",
        "arguments": [{"name": "action", "type": "string", "required": True}],
        "schemaSpecified": True,
        "side_effect_class": "auth_write_capable",
        "safe_for_training_examples": False,
        "safe_for_dry_run_evaluation": True,
        "deterministic_verify": False,
        "selected_for_v3": False,
        "exclude_reason": "Release workflow is high-risk; not included merely for class count.",
    },
    "build": {
        "displayName": "Build",
        "human_purpose": "Build request queue persistence and drafting.",
        "enabled": True,
        "available": True,
        "authority": "war_room_tool_registry",
        "requiresAuth": True,
        "executionProvider": "war_room_api",
        "endpoint": "/api/build-requests",
        "arguments": [{"name": "title", "type": "string", "required": True}],
        "schemaSpecified": True,
        "side_effect_class": "auth_write_capable",
        "safe_for_training_examples": False,
        "safe_for_dry_run_evaluation": True,
        "deterministic_verify": False,
        "selected_for_v3": False,
        "exclude_reason": "Persists build drafts; not a deterministic read-only utility.",
    },
    "sha256": {
        "displayName": "Bounded SHA-256",
        "human_purpose": "Local reversible SHA-256 of a text payload (AGI gym bounded executor).",
        "enabled": True,
        "available": True,
        "authority": "agi_gym_bounded",
        "requiresAuth": False,
        "executionProvider": "agi_gym_sha256",
        "endpoint": None,
        "arguments": [{"name": "text", "type": "string", "required": True}],
        "schemaSpecified": True,
        "side_effect_class": "pure_local",
        "safe_for_training_examples": True,
        "safe_for_dry_run_evaluation": True,
        "deterministic_verify": True,
        "selected_for_v3": True,
        "exclude_reason": None,
    },
    "lookup_note": {
        "displayName": "Curriculum note lookup (synthetic)",
        "human_purpose": "Retrieve a curriculum note by note_id (mock/dry-run only).",
        "enabled": True,
        "available": True,
        "authority": "curriculum_synthetic",
        "requiresAuth": False,
        "executionProvider": "mock",
        "endpoint": None,
        "arguments": [{"name": "note_id", "type": "string", "required": True}],
        "schemaSpecified": True,
        "side_effect_class": "mock_read",
        "safe_for_training_examples": True,
        "safe_for_dry_run_evaluation": True,
        "deterministic_verify": False,
        "selected_for_v3": True,
        "exclude_reason": None,
    },
    "echo_int": {
        "displayName": "Phase 1 schema fixture (integer arg)",
        "human_purpose": "Echo an integer argument (schema-type fixture, mock/dry-run).",
        "enabled": True,
        "available": True,
        "authority": "curriculum_synthetic",
        "requiresAuth": False,
        "executionProvider": "mock",
        "endpoint": None,
        "arguments": [{"name": "n", "type": "integer", "required": True}],
        "schemaSpecified": True,
        "side_effect_class": "pure_local",
        "safe_for_training_examples": True,
        "safe_for_dry_run_evaluation": True,
        "deterministic_verify": True,
        "selected_for_v3": True,
        "exclude_reason": None,
    },
    "disabled_probe": {
        "displayName": "Phase 1 unavailable fixture",
        "human_purpose": "Unavailable probe used to test UNAVAILABLE validation.",
        "enabled": False,
        "available": False,
        "authority": "curriculum_synthetic",
        "requiresAuth": False,
        "executionProvider": "none",
        "endpoint": None,
        "arguments": [{"name": "text", "type": "string", "required": True}],
        "schemaSpecified": True,
        "side_effect_class": "none",
        "safe_for_training_examples": True,
        "safe_for_dry_run_evaluation": True,
        "deterministic_verify": True,
        "selected_for_v3": False,
        "exclude_reason": "Not a routing class. Used only as TOOL-06 unavailable target (gold remains NO_TOOL).",
    },
}

V3_ROUTING_TOOLS = [k for k, v in UNIFIED_TOOLS.items() if v["selected_for_v3"]]
CLASS_NAMES = ("NO_TOOL",) + tuple(t.upper() for t in V3_ROUTING_TOOLS)
# Stable explicit order for Experiment 003 head
CLASS_NAMES = (
    "NO_TOOL",
    "SHA256",
    "LOOKUP_NOTE",
    "ECHO_INT",
    "WEB",
    "MEMORY",
    "FILES",
    "RESEARCH",
)
TOOL_TO_CLASS = {
    "sha256": "SHA256",
    "lookup_note": "LOOKUP_NOTE",
    "echo_int": "ECHO_INT",
    "web": "WEB",
    "memory": "MEMORY",
    "files": "FILES",
    "research": "RESEARCH",
}
CLASS_TO_TOOL = {v: k for k, v in TOOL_TO_CLASS.items()}
CLASS_TO_TOOL["NO_TOOL"] = "none"


def inspect_ts_tool_ids() -> dict[str, Any]:
    registry = TOOL_REGISTRY_TS.read_text(encoding="utf-8")
    catalog = TOOL_CATALOG_TS.read_text(encoding="utf-8")
    ui_ids = re.findall(r"id: '([a-z]+)'", registry)
    catalog_ids = re.findall(r"toolId: '([a-z0-9_]+)'", catalog)
    overlay_keys = re.findall(r"^  ([a-z]+): \[\{ name:", catalog, flags=re.M)
    return {
        "ui_registry_ids": ui_ids,
        "gym_and_curriculum_ids": catalog_ids,
        "overlay_keys": overlay_keys,
        "unified_python_ids": sorted(UNIFIED_TOOLS),
        "registry_path": str(TOOL_REGISTRY_TS.relative_to(ROOT)),
        "catalog_path": str(TOOL_CATALOG_TS.relative_to(ROOT)),
        "catalog_sha256": hashlib.sha256(catalog.encode("utf-8")).hexdigest(),
        "registry_sha256": hashlib.sha256(registry.encode("utf-8")).hexdigest(),
    }


def catalog_fingerprint() -> str:
    rows = []
    for tid in sorted(UNIFIED_TOOLS):
        spec = UNIFIED_TOOLS[tid]
        rows.append(
            {
                "toolId": tid,
                "arguments": spec["arguments"],
                "enabled": spec["enabled"],
                "available": spec["available"],
                "executionProvider": spec["executionProvider"],
            }
        )
    blob = repr(rows).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def coerce_argument(raw: str, typ: str) -> tuple[bool, Any, str | None]:
    if typ == "string":
        return True, raw, None
    if typ == "boolean":
        if raw in ("true", "false"):
            return True, raw == "true", None
        return False, None, f"expected boolean got {raw}"
    if typ == "integer":
        if not re.fullmatch(r"-?\d+", raw):
            return False, None, f"expected integer got {raw}"
        return True, int(raw), None
    if typ == "number":
        try:
            n = float(raw)
        except ValueError:
            return False, None, f"expected number got {raw}"
        if n != n or n in (float("inf"), float("-inf")):
            return False, None, f"expected number got {raw}"
        return True, n, None
    return False, None, "unknown type"


def validate_normalized(tool_id: str | None, arguments: dict[str, Any]) -> dict[str, Any]:
    """Schema validation matching toolRouter.validateToolIntent (string-valued args)."""
    if tool_id in (None, "none", "NO_TOOL", "no_tool", "NONE"):
        return {"code": "VALID", "errors": [], "coerced": {}, "normalized": None}
    defn = UNIFIED_TOOLS.get(tool_id or "")
    if not defn:
        return {"code": "INVALID_TOOL", "errors": [f"unknown tool {tool_id}"], "coerced": {}, "normalized": None}
    if not defn["enabled"] or not defn["available"]:
        return {"code": "UNAVAILABLE", "errors": [f"tool {tool_id} unavailable"], "coerced": {}, "normalized": None}
    if not defn["schemaSpecified"]:
        return {
            "code": "SCHEMA_INCOMPATIBLE",
            "errors": [f"tool {tool_id} has no compact schema"],
            "coerced": {},
            "normalized": None,
        }
    errors: list[str] = []
    code = "VALID"
    coerced: dict[str, Any] = {}
    known = {a["name"] for a in defn["arguments"]}
    str_args = {str(k): str(v) if not isinstance(v, str) else v for k, v in arguments.items()}
    for key, raw in str_args.items():
        if key not in known:
            errors.append(f"unknown argument {key}")
            code = "UNKNOWN_ARGUMENT"
            continue
        schema = next(a for a in defn["arguments"] if a["name"] == key)
        ok, value, reason = coerce_argument(raw, schema["type"])
        if not ok:
            errors.append(f"invalid argument {key}: {reason}")
            code = "INVALID_ARGUMENT"
            continue
        coerced[key] = value
    for schema in defn["arguments"]:
        if schema["required"] and schema["name"] not in str_args:
            errors.append(f"missing required argument {schema['name']}")
            code = "MISSING_ARGUMENT"
    normalized = {"tool": tool_id, "arguments": coerced} if code == "VALID" else None
    return {"code": code, "errors": errors, "coerced": coerced, "normalized": normalized}


def dry_run_execute(normalized: dict[str, Any] | None) -> dict[str, Any]:
    if normalized is None:
        return {
            "status": "not_executed",
            "result": None,
            "error": None,
            "provenance": {"mode": "dry_run", "executed": "false", "boundary": "execution_boundary"},
        }
    defn = UNIFIED_TOOLS[normalized["tool"]]
    return {
        "tool_id": normalized["tool"],
        "status": "dry_run",
        "result": {"would_call": defn["executionProvider"], "arguments": normalized["arguments"]},
        "error": None,
        "provenance": {"mode": "dry_run", "authority": defn["authority"], "executed": "false"},
    }


def bounded_sha256(text: str) -> dict[str, Any]:
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return {
        "tool_id": "sha256",
        "status": "ok",
        "result": {"digest": digest},
        "error": None,
        "provenance": {"mode": "bounded_sha256", "authority": "agi_gym_bounded", "reversible": "true"},
    }
