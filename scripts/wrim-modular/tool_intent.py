"""Python compact tool-intent dialect (must match lib/modular-intelligence/toolIntent.ts)."""
from __future__ import annotations

import re
from typing import Any, Literal

Decision = Literal["TOOL", "NO_TOOL"]
ParseStatus = Literal["PARSED", "MALFORMED"]

TOOL_ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")
KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,31}$")
NO_TOOL_IDS = frozenset({"none", "NO_TOOL", "no_tool", "NONE"})
MAX_ARGS = 16
MAX_VALUE_LEN = 2048
MAX_RAW_LEN = 8192


def parse_compact_intent(raw: str, *, source_model: str = "WRIM-0", source_module: str | None = None) -> dict[str, Any]:
    raw_source = raw
    if not isinstance(raw, str):
        return _malformed(raw_source, ["raw intent is not a string"], source_model, source_module)
    if len(raw) > MAX_RAW_LEN:
        return _malformed(raw_source, ["raw intent exceeds bound"], source_model, source_module)
    if "<tool_call>" in raw or raw.strip().startswith("{") or raw.strip().startswith("["):
        return _malformed(raw_source, ["runtime JSON / XML tool wrappers are not accepted in the model dialect"], source_model, source_module)

    lines = [ln.strip() for ln in raw.replace("\r\n", "\n").split("\n") if ln.strip()]
    if not lines:
        return _malformed(raw_source, ["empty intent"], source_model, source_module)
    if not lines[0].startswith("TOOL="):
        return _malformed(raw_source, ["first non-empty line must be TOOL=<id>"], source_model, source_module)
    if lines[0].count("=") < 1:
        return _malformed(raw_source, ["missing TOOL id"], source_model, source_module)
    tool_id = lines[0].split("=", 1)[1].strip()
    if tool_id == "":
        return _malformed(raw_source, ["empty tool id; refusing to hallucinate"], source_model, source_module)

    args: dict[str, str] = {}
    errors: list[str] = []
    for ln in lines[1:]:
        if "=" not in ln:
            errors.append(f"malformed argument line {ln!r}")
            continue
        key, value = ln.split("=", 1)
        key = key.strip()
        if not KEY_RE.match(key):
            errors.append(f"invalid argument key {key!r}")
            continue
        if key in args:
            errors.append(f"duplicate argument {key}")
            continue
        if len(args) >= MAX_ARGS:
            errors.append("too many arguments")
            continue
        if len(value) > MAX_VALUE_LEN:
            errors.append(f"argument {key} exceeds value bound")
            continue
        args[key] = value

    if errors:
        return _malformed(raw_source, errors, source_model, source_module)

    if tool_id in NO_TOOL_IDS:
        extra = [k for k in args if k != "WHY"]
        if extra:
            return _malformed(raw_source, [f"NO_TOOL does not accept arguments {extra}"], source_model, source_module)
        return {
            "decision": "NO_TOOL",
            "tool_id": None,
            "arguments": {},
            "confidence": None,
            "source_model": source_model,
            "source_module": source_module,
            "raw_intent": raw_source,
            "parse_status": "PARSED",
            "validation_status": "UNVALIDATED",
            "errors": [],
        }

    if not TOOL_ID_RE.match(tool_id):
        return _malformed(raw_source, [f"invalid tool id {tool_id!r}"], source_model, source_module)

    return {
        "decision": "TOOL",
        "tool_id": tool_id,
        "arguments": args,
        "confidence": None,
        "source_model": source_model,
        "source_module": source_module,
        "raw_intent": raw_source,
        "parse_status": "PARSED",
        "validation_status": "UNVALIDATED",
        "errors": [],
    }


def format_tool_observation(tool_id: str, status: str, value: str, *, max_value: int = 512) -> str:
    clipped = value if len(value) <= max_value else value[:max_value]
    return f"TOOL_RESULT={tool_id}\nstatus={status}\nvalue={clipped}"


def _malformed(raw: str, errors: list[str], source_model: str, source_module: str | None) -> dict[str, Any]:
    return {
        "decision": "NO_TOOL",
        "tool_id": None,
        "arguments": {},
        "confidence": None,
        "source_model": source_model,
        "source_module": source_module,
        "raw_intent": raw,
        "parse_status": "MALFORMED",
        "validation_status": "INVALID",
        "errors": errors,
    }
