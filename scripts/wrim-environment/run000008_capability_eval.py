"""Internal held-out capability validation for WRIM1-RUN-000008.

Does not train. Scores WR-CORPUS-CAPABILITY-1 validation examples.
"""
from __future__ import annotations

import ast
import json
import re
from typing import Any

from stage2_eval import greedy_generate
from stage3_eval_baseline import extract_json_blob


CONSTRAINT_SKIP = {"primary_collapsed", "primary_special_loop", "special_rate_ok"}


def _words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z0-9_\-]+", text or "")


def _json_type_ok(value: Any, expected: str) -> bool:
    if expected == "str":
        return isinstance(value, str)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "bool":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    if expected == "array":
        return isinstance(value, list)
    if expected == "object":
        return isinstance(value, dict)
    return True


def score_validator(ex: dict[str, Any], continuation: str, gen: dict[str, Any]) -> dict[str, Any]:
    v = dict(ex.get("validator") or {})
    kind = str(v.get("type") or "")
    text = continuation or ""
    low = text.lower()
    scores: dict[str, Any] = {}
    collapsed = bool(gen.get("collapsed"))
    eos = 2 in list(gen.get("new_ids") or [])
    n_words = len(_words(text))
    max_run = int(gen.get("max_run") or gen.get("max_token_run") or 0)

    def forbid_ok() -> bool:
        terms = [str(t).lower() for t in (v.get("forbid") or v.get("terms") or [])]
        subs = list(v.get("forbid_substrings") or [])
        if any(t and t in low for t in terms):
            return False
        if any(s and s in text for s in subs):
            return False
        return True

    if kind in {"exact_text", "stopping"}:
        expected = str(v.get("expected") or v.get("exact") or "")
        scores["exact"] = text.strip() == expected or text.strip().startswith(expected)
        if v.get("max_words") is not None:
            scores["max_words"] = n_words <= int(v["max_words"])
        if v.get("no_repeat_punct"):
            scores["no_repeat_punct"] = not re.search(r"([.!?_])\1{2,}", text)
        if v.get("no_line_repeat"):
            lines = [ln for ln in text.splitlines() if ln.strip()]
            scores["no_line_repeat"] = len(lines) <= 1 or len(set(lines)) == len(lines)
        scores["forbid_ok"] = forbid_ok()
        scores["stopped"] = bool(eos) or n_words <= max(1, int(v.get("max_words") or 8))
        if v.get("json"):
            blob = extract_json_blob(text)
            scores["json_valid"] = False
            if blob:
                try:
                    json.loads(blob)
                    scores["json_valid"] = True
                except Exception:
                    scores["json_valid"] = False
    elif kind == "span":
        span = str(v.get("span") or "")
        scores["contains_span"] = span in text
        if v.get("max_words") is not None:
            scores["max_words"] = n_words <= int(v["max_words"])
    elif kind == "one_word":
        accepted = set(v.get("accepted") or [])
        words = _words(text)
        scores["exactly_one_word"] = len(words) == 1
        scores["accepted_word"] = bool(words) and words[0] in accepted
    elif kind == "csv":
        want = [str(t).lower() for t in (v.get("tokens") or [])]
        parts = [p.strip().lower() for p in text.replace("\n", " ").split(",") if p.strip()]
        scores["csv"] = parts[: len(want)] == want and len(parts) >= len(want)
    elif kind == "lowercase_no_digits":
        scores["lowercase_no_digits"] = bool(text) and text == text.lower() and not re.search(r"\d", text)
    elif kind == "prefix":
        scores["prefix"] = text.strip().startswith(str(v.get("prefix") or ""))
    elif kind == "suffix":
        scores["suffix"] = str(v.get("suffix") or "") in text
    elif kind == "ordered":
        pos = 0
        ok = True
        for term in [str(t).lower() for t in (v.get("terms") or [])]:
            i = low.find(term, pos)
            if i < 0:
                ok = False
                break
            pos = i + len(term)
        scores["ordered"] = ok
    elif kind == "line_count":
        lines = [ln for ln in text.splitlines() if ln.strip()]
        scores["line_count"] = len(lines) == int(v.get("n") or 0)
    elif kind == "key_value":
        keys = [k.lower() for k in (v.get("keys") or [])]
        found = set()
        for ln in text.splitlines():
            if ":" not in ln:
                continue
            left = ln.split(":", 1)[0].strip().lower()
            found.add(left)
        scores["key_value"] = set(keys).issubset(found)
    elif kind == "forbidden":
        scores["forbid_ok"] = forbid_ok()
        scores["not_empty"] = bool(text.strip())
    elif kind == "multi":
        terms = [str(t).lower() for t in (v.get("required_terms") or [])]
        scores["required_terms"] = all(t in low for t in terms)
        if v.get("max_words") is not None:
            scores["max_words"] = n_words <= int(v["max_words"])
        if v.get("lowercase_no_digits"):
            scores["lowercase_no_digits"] = bool(text) and text == text.lower() and not re.search(r"\d", text)
    elif kind.startswith("json"):
        blob = extract_json_blob(text)
        parsed = None
        valid = False
        if blob:
            try:
                parsed = json.loads(blob)
                valid = True
            except Exception:
                valid = False
        scores["json_valid"] = valid
        if kind == "json_schema":
            keys = list(v.get("required_keys") or [])
            scores["required_keys"] = bool(valid and isinstance(parsed, dict) and all(k in parsed for k in keys))
            types = dict(v.get("types") or {})
            type_ok = True
            if valid and isinstance(parsed, dict):
                for k, t in types.items():
                    if k in parsed and not _json_type_ok(parsed.get(k), t):
                        type_ok = False
            scores["types"] = bool(valid and type_ok)
            if v.get("compact"):
                scores["no_prose"] = bool(text.strip().startswith("{") or text.strip().startswith("["))
        elif kind == "json_nested":
            parent = v.get("parent")
            nested_key = v.get("nested_key")
            nested = parsed.get(parent) if valid and isinstance(parsed, dict) else None
            scores["nested"] = bool(isinstance(nested, dict) and nested_key in nested)
        elif kind == "json_array":
            n = int(v.get("len") or 0)
            scores["array_len"] = bool(valid and isinstance(parsed, list) and len(parsed) == n)
        elif kind == "json_enum":
            key = v.get("key")
            allowed = set(v.get("allowed") or [])
            scores["enum"] = bool(valid and isinstance(parsed, dict) and parsed.get(key) in allowed)
        elif kind == "json_optional":
            keys = list(v.get("required_keys") or [])
            scores["required_keys"] = bool(valid and isinstance(parsed, dict) and all(k in parsed for k in keys))
            opt = v.get("optional_key")
            present = bool(valid and isinstance(parsed, dict) and opt in parsed)
            scores["optional"] = present is bool(v.get("optional_present"))
        elif kind == "json_path":
            cur = parsed
            ok = valid
            for part in v.get("path") or []:
                if not isinstance(cur, dict) or part not in cur:
                    ok = False
                    break
                cur = cur[part]
            scores["path"] = ok
    elif kind == "code_contains":
        must = list(v.get("must") or [])
        scores["must"] = all(m in text for m in must)
        scores["forbid_ok"] = forbid_ok()
        if v.get("ast"):
            try:
                ast.parse(text)
                scores["ast"] = True
            except Exception:
                # completion-style bodies may be fragments; require must-tokens instead
                scores["ast"] = False
    else:
        scores["not_empty"] = bool(text.strip())

    constraint_keys = [k for k in scores if k not in CONSTRAINT_SKIP]
    correct = (not collapsed) and (all(bool(scores[k]) for k in constraint_keys) if constraint_keys else False)
    return {
        "scores": scores,
        "correct": correct,
        "collapsed": collapsed,
        "eos": eos,
        "n_words": n_words,
        "max_run": max_run,
        "continuation": text[:240],
    }


def eval_capability_items(*, model, tokenizer, device, items: list[dict[str, Any]], max_new: int = 64) -> dict[str, Any]:
    rows = []
    by_cat: dict[str, list[bool]] = {"instruction": [], "json": [], "code": [], "stopping": []}
    for ex in items:
        gen = greedy_generate(model, tokenizer, ex["prompt"], device, max_new=max_new)
        scored = score_validator(ex, gen.get("continuation") or "", gen)
        cat = str(ex.get("category") or "")
        row = {
            "example_id": ex.get("example_id"),
            "category": cat,
            "subtype": ex.get("subtype"),
            **scored,
        }
        rows.append(row)
        if cat in by_cat:
            by_cat[cat].append(bool(scored["correct"]))
    def rate(vals: list[bool]) -> dict[str, Any]:
        n = len(vals)
        c = int(sum(1 for x in vals if x))
        return {"correct": c, "total": n, "rate": (c / n) if n else None}

    summary = {cat: rate(vals) for cat, vals in by_cat.items()}
    all_flags = [r["correct"] for r in rows]
    return {
        "n": len(rows),
        "PASS_COUNT": int(sum(1 for x in all_flags if x)),
        "FAIL_COUNT": int(sum(1 for x in all_flags if not x)),
        "PASS_RATE": (sum(1 for x in all_flags if x) / len(all_flags)) if all_flags else None,
        "by_category": summary,
        "INSTRUCTION_VALIDATION": summary["instruction"],
        "JSON_VALIDATION": summary["json"],
        "CODE_VALIDATION": summary["code"],
        "STOPPING_VALIDATION": summary["stopping"],
        "items": rows,
    }
