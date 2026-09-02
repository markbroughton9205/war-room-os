"""War Room Native Router V1 — development/shadow hybrid router.

Does not train WRIM. Does not train LoRA. Does not execute tools.
Reuses TOOL_REGISTRY metadata, frozen L10 mean features, and V5-style BoW.
Integer class ids are EVAL-6 compatibility only; routing keys are tool/capability strings.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from exp004_support import CLASS_NAMES, CLASS_TO_ID, N_CLASSES
from paths import ROOT
from redx_support import tokenize

TOOL_REGISTRY_TS = ROOT / "lib" / "tools" / "toolRegistry.ts"
TOOL_CATALOG_TS = ROOT / "lib" / "modular-intelligence" / "toolCatalog.ts"

INFO_STATES = (
    "ANSWERABLE_FROM_CONTEXT",
    "DURABLE_MEMORY_REQUIRED",
    "ARTIFACT_ACCESS_REQUIRED",
    "CURRENT_EXTERNAL_INFORMATION_REQUIRED",
    "MULTI_SOURCE_RESEARCH_REQUIRED",
    "DETERMINISTIC_COMPUTE_REQUIRED",
    "INSUFFICIENT_CONTEXT",
    "AMBIGUOUS",
)

GATE_STATES = (
    "NO_TOOL_CONFIDENT",
    "TOOL_REQUIRED_CONFIDENT",
    "TOOL_OPTIONAL",
    "AMBIGUOUS",
    "INSUFFICIENT_CONTEXT",
)

ABSTAIN_STATES = (
    "ROUTE_CONFIDENT",
    "ROUTE_AMBIGUOUS",
    "NO_COMPATIBLE_TOOL",
    "INSUFFICIENT_CONTEXT",
    "TOOL_OPTIONAL",
    "NO_TOOL_CONFIDENT",
)

CAPABILITY_FAMILIES = (
    "INTERNAL_CONTEXT",
    "EXTERNAL_RETRIEVAL",
    "MEMORY_STATE",
    "ARTIFACT_ACCESS",
    "RESEARCH_SYNTHESIS",
    "DETERMINISTIC_UTILITY",
)

FAMILY_TO_EVAL6 = {
    "INTERNAL_CONTEXT": "NO_TOOL",
    "EXTERNAL_RETRIEVAL": "WEB",
    "MEMORY_STATE": "MEMORY",
    "ARTIFACT_ACCESS": "FILES",
    "RESEARCH_SYNTHESIS": "RESEARCH",
    "DETERMINISTIC_UTILITY": "SHA256",
}

EVAL6_TO_FAMILY = {v: k for k, v in FAMILY_TO_EVAL6.items()}

EVAL6_TO_TOOL_ID = {
    "NO_TOOL": None,
    "WEB": "web",
    "MEMORY": "memory",
    "FILES": "files",
    "RESEARCH": "research",
    "SHA256": "sha256",
}

TOOL_ID_TO_EVAL6 = {v: k for k, v in EVAL6_TO_TOOL_ID.items() if v}

STATE_TO_FAMILY = {
    "ANSWERABLE_FROM_CONTEXT": "INTERNAL_CONTEXT",
    "DURABLE_MEMORY_REQUIRED": "MEMORY_STATE",
    "ARTIFACT_ACCESS_REQUIRED": "ARTIFACT_ACCESS",
    "CURRENT_EXTERNAL_INFORMATION_REQUIRED": "EXTERNAL_RETRIEVAL",
    "MULTI_SOURCE_RESEARCH_REQUIRED": "RESEARCH_SYNTHESIS",
    "DETERMINISTIC_COMPUTE_REQUIRED": "DETERMINISTIC_UTILITY",
}

CATALOG_ARG_OVERLAY = {
    "web": [{"name": "query", "type": "string", "required": True}],
    "memory": [{"name": "query", "type": "string", "required": True}],
    "files": [{"name": "path", "type": "string", "required": True}],
    "research": [{"name": "query", "type": "string", "required": True}],
    "repo": [{"name": "action", "type": "string", "required": True}],
    "deployments": [{"name": "action", "type": "string", "required": True}],
    "build": [{"name": "title", "type": "string", "required": True}],
}

GYM_SHA256_CARD_META = {
    "tool_id": "sha256",
    "canonical_name": "Bounded SHA-256",
    "aliases": ["sha256", "sha-256", "digest", "checksum"],
    "description": "Bounded SHA-256 hash utility from gym catalog (not TOOL_REGISTRY).",
    "capability_family": "DETERMINISTIC_UTILITY",
    "argument_schema": [{"name": "text", "type": "string", "required": True}],
    "result_type": "unavailable",
    "freshness_semantics": "unavailable",
    "read_write_behavior": "unavailable",
    "availability": True,
    "reliability": "unavailable",
    "cost_latency": "unavailable",
    "authority": "agi_gym_bounded",
    "in_tool_registry": False,
}

PRIOR_SPLIT = re.compile(r"prior turn:\s*(.*?)\s*current:\s*(.*)\s*$", re.I | re.S)
VAGUE_STORE = re.compile(
    r"\b(we (picked|chose|set|locked|froze|settled|reserved|adopted|accepted|assigned|decided|"
    r"standardized|talked about)|i am not (repeating|quoting)|did not restate|not quoting again)\b",
    re.I,
)
CONCRETE_VALUE = re.compile(
    r"(\d|['\"].+['\"]|uses |wear |covers |runs |opening line is |hold time is |ceiling is )",
    re.I,
)
OPEN_VERB_ARTIFACT = re.compile(
    r"\b(open|read|quote)\b.{0,80}\b("
    r"roster|sheet|map|spec|sop|log|draft|workbook|attachment|plot|menu|budget|"
    r"lease|caption|schedule|file|document|runbook|bulletin"
    r")\b",
    re.I,
)
NEGATE_WEB = re.compile(
    r"\b(don'?t search|do not search|don'?t look up|do not retrieve|from what i already gave|"
    r"already gave you|without (searching|looking up))\b",
    re.I,
)
MISSING_GIVEN = re.compile(r"\b(i did not give|not in (this|the) (prompt|message)|i am not repeating)\b", re.I)
OPEN_ARTIFACT = re.compile(
    r"\b(open the|open our|open tonight|open yesterday|read the|quote the matching line from|"
    r"in the (workspace|repo))\b",
    re.I,
)
WITHOUT_OPEN = re.compile(r"\b(without opening|do not open|don't open)\b", re.I)
PUBLIC_PAGE_OPEN = re.compile(r"\bopen the .{0,60}(page|site|listing)\b", re.I)
MEMORY_ALREADY = re.compile(
    r"\b(did we already|we already (approve|decide|assign|reserve|set|agree|log|adopt)|"
    r"already (approve|decide|assign|reserve|set|agree|log))\b",
    re.I,
)
DIGEST_ACT = re.compile(
    r"\b(checksum|digest|fingerprint|hash this exact|compute the checksum|give me the checksum|"
    r"i need the checksum)\b",
    re.I,
)
EXACT_PAYLOAD = re.compile(
    r"\b(this exact|exact (practice string|banner|json|text|batch id|config|payload|characters)|"
    r"including the spaces|these exact)\b",
    re.I,
)
CONCEPTUAL = re.compile(
    r"\b(in general|conceptually|what is the point|what makes a |explain (how|why)|"
    r"why (do|does|would|can|might)|even if you never hash|without looking one up|"
    r"what is an? [a-z].*(conceptually|for, without|doing in))\b",
    re.I,
)
RESEARCH_CUE = re.compile(
    r"\b(compare|reconcile|synthesize|report conflicts|disagreements?|independent |"
    r"two (independent |legal |arts |commodity |flood |tracking )|"
    r"several |flag contradictions|where they diverge|explain the gaps)\b",
    re.I,
)
WEB_FRESH = re.compile(
    r"\b(currently|current|posted|posting|tonight|this evening|this afternoon|this week'?s|today|"
    r"latest|issuing now|still running|right now|showing right now|"
    r"public (schedule|page|listing)|exchange board|park service currently|"
    r"publish(es|ed|ing)?)\b",
    re.I,
)
THEN_JOIN = re.compile(r"\bthen\b|\band (then )?check\b|\band quote\b|\band checksum\b", re.I)
INCOMPATIBLE = re.compile(
    r"\b(fax |text the|sms|email |calendar|charge the|card on file|bypass the badge|"
    r"restart production|cloudflare|spectrophotometer|calibrate the)\b",
    re.I,
)
PATH_LIKE = re.compile(r"(docs/|lib/|scripts/|\.md\b|\.json\b|path\s*=)", re.I)

RULE_SPECS = [
    {
        "id": "R01_supplied_context_negation",
        "then": "NO_TOOL",
        "requires": ["negation_or_supplied_context", "not_missing_given"],
    },
    {
        "id": "R02_prior_turn_concrete",
        "then": "NO_TOOL",
        "requires": ["multi_turn", "prior_concrete", "not_open_artifact"],
    },
    {
        "id": "R03_prior_turn_underspecified",
        "then": "MEMORY",
        "requires": ["multi_turn", "prior_underspecified"],
    },
    {
        "id": "R04_open_public_page_web",
        "then": "WEB",
        "requires": ["public_page_open", "not_path_like"],
    },
    {
        "id": "R04_open_artifact",
        "then": "FILES",
        "requires": ["open_artifact", "not_without_open", "not_digest_exact", "not_public_page_open"],
    },
    {
        "id": "R05_durable_already",
        "then": "MEMORY",
        "requires": ["memory_already", "not_open_artifact"],
    },
    {
        "id": "R06_digest_exact",
        "then": "SHA256",
        "requires": ["digest_act", "exact_payload", "not_conceptual"],
    },
    {
        "id": "R07_research_multi_source",
        "then": "RESEARCH",
        "requires": ["research_cue", "not_open_artifact"],
    },
    {
        "id": "R08_fresh_public_lookup",
        "then": "WEB",
        "requires": ["web_fresh", "not_research_cue", "not_negation_web", "not_open_artifact", "not_conceptual"],
    },
    {
        "id": "R09_conceptual_no_tool",
        "then": "NO_TOOL",
        "requires": ["conceptual", "not_open_artifact", "not_digest_exact", "not_research_cue", "not_web_fresh"],
    },
]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def parse_tool_registry_cards() -> list[dict[str, Any]]:
    """Derive cards from lib/tools/toolRegistry.ts. Do not invent reliability/cost/freshness."""
    text = TOOL_REGISTRY_TS.read_text(encoding="utf-8")
    cards = []
    for m in re.finditer(
        r"\{\s*id:\s*'(\w+)',\s*name:\s*'([^']+)',\s*status:\s*'[^']+',\s*"
        r"description:\s*'([^']+)',\s*requiresAuth:\s*(true|false),\s*endpoint:\s*'([^']+)'",
        text,
    ):
        tool_id, name, desc, auth, endpoint = m.groups()
        family = {
            "web": "EXTERNAL_RETRIEVAL",
            "memory": "MEMORY_STATE",
            "files": "ARTIFACT_ACCESS",
            "research": "RESEARCH_SYNTHESIS",
            "repo": "ARTIFACT_ACCESS",
            "deployments": "ARTIFACT_ACCESS",
            "build": "ARTIFACT_ACCESS",
        }.get(tool_id)
        args = CATALOG_ARG_OVERLAY.get(tool_id, [])
        cards.append(
            {
                "tool_id": tool_id,
                "canonical_name": name,
                "aliases": [tool_id, name.lower()],
                "description": desc,
                "capability_family": family,
                "argument_schema": args,
                "result_type": "unavailable",
                "freshness_semantics": "unavailable",
                "read_write_behavior": "unavailable",
                "availability": True,
                "enabled": True,
                "requires_auth": auth == "true",
                "endpoint": endpoint,
                "reliability": "unavailable",
                "cost_latency": "unavailable",
                "authority": "war_room_tool_registry",
                "in_tool_registry": True,
                "schema_specified": bool(args),
            }
        )
    cards.append(dict(GYM_SHA256_CARD_META, enabled=True, schema_specified=True, requires_auth=False, endpoint=None))
    return cards


def registry_snapshot_hash(cards: list[dict[str, Any]]) -> str:
    blob = json.dumps(cards, sort_keys=True, ensure_ascii=True).encode("utf-8")
    return sha256_bytes(blob)


def split_prior_current(text: str) -> tuple[str | None, str | None, str]:
    m = PRIOR_SPLIT.search(text.strip())
    if not m:
        return None, None, text
    return m.group(1).strip(), m.group(2).strip(), text


def evidence_flags(text: str) -> dict[str, bool]:
    prior, current, raw = split_prior_current(text)
    multi = prior is not None
    prior_u = prior or ""
    body = current if current else raw
    vague = bool(multi and VAGUE_STORE.search(prior_u))
    concrete_hit = bool(multi and CONCRETE_VALUE.search(prior_u))
    prior_underspecified = bool(multi and vague and not concrete_hit)
    prior_concrete = bool(multi and ((not vague) or concrete_hit) and len(prior_u) > 12)
    digest = bool(DIGEST_ACT.search(raw))
    exact = bool(EXACT_PAYLOAD.search(raw) or (digest and re.search(r":\s+\S+", raw)))
    return {
        "multi_turn": multi,
        "prior_concrete": prior_concrete,
        "prior_underspecified": prior_underspecified,
        "negation_or_supplied_context": bool(NEGATE_WEB.search(raw)),
        "not_missing_given": not bool(MISSING_GIVEN.search(raw)),
        "missing_given": bool(MISSING_GIVEN.search(raw)),
        "open_artifact": bool(OPEN_ARTIFACT.search(raw) or OPEN_VERB_ARTIFACT.search(raw)),
        "not_open_artifact": not bool(OPEN_ARTIFACT.search(raw) or OPEN_VERB_ARTIFACT.search(raw)),
        "not_without_open": not bool(WITHOUT_OPEN.search(raw)),
        "without_open": bool(WITHOUT_OPEN.search(raw)),
        "memory_already": bool(MEMORY_ALREADY.search(raw)),
        "digest_act": digest,
        "exact_payload": exact,
        "not_digest_exact": not (digest and exact),
        "conceptual": bool(CONCEPTUAL.search(raw)),
        "not_conceptual": not bool(CONCEPTUAL.search(raw)),
        "research_cue": bool(RESEARCH_CUE.search(raw)),
        "not_research_cue": not bool(RESEARCH_CUE.search(raw)),
        "web_fresh": bool(
            WEB_FRESH.search(raw)
            or (
                re.search(r"\bwhat (is|time|yield|germination|overnight|surge|wait)\b", body, re.I)
                and re.search(r"\b(post|list|desk|board|page|schedule|ferry|tide|toll|bulletin|authority)\b", raw, re.I)
                and not multi
            )
        ),
        "not_web_fresh": not bool(WEB_FRESH.search(raw)),
        "not_negation_web": not bool(NEGATE_WEB.search(raw)),
        "incompatible": bool(INCOMPATIBLE.search(raw)),
        "then_join": bool(THEN_JOIN.search(raw)),
        "public_page_open": bool(PUBLIC_PAGE_OPEN.search(raw) and not PATH_LIKE.search(raw)),
        "not_public_page_open": not bool(PUBLIC_PAGE_OPEN.search(raw) and not PATH_LIKE.search(raw)),
        "not_path_like": not bool(PATH_LIKE.search(raw)),
        "path_like": bool(PATH_LIKE.search(raw)),
    }


def classify_information_state(text: str, flags: dict[str, bool] | None = None) -> dict[str, Any]:
    f = flags or evidence_flags(text)
    reasons: list[str] = []
    state = "AMBIGUOUS"
    if f["incompatible"]:
        state = "INSUFFICIENT_CONTEXT"
        reasons.append("incompatible_or_unlisted_capability")
    elif f["digest_act"] and f["exact_payload"] and f["not_conceptual"]:
        state = "DETERMINISTIC_COMPUTE_REQUIRED"
        reasons.append("exact_digest_payload")
    elif f.get("public_page_open"):
        state = "CURRENT_EXTERNAL_INFORMATION_REQUIRED"
        reasons.append("open_public_page")
    elif f["open_artifact"] and f["not_without_open"] and f["not_digest_exact"] and f.get("not_public_page_open", True):
        state = "ARTIFACT_ACCESS_REQUIRED"
        reasons.append("explicit_open_or_attachment")
    elif f["research_cue"]:
        state = "MULTI_SOURCE_RESEARCH_REQUIRED"
        reasons.append("compare_or_multi_source")
    elif f["negation_or_supplied_context"] and f["not_missing_given"]:
        state = "ANSWERABLE_FROM_CONTEXT"
        reasons.append("negation_plus_supplied_or_forbid_web")
    elif f["prior_concrete"] and f["not_open_artifact"]:
        state = "ANSWERABLE_FROM_CONTEXT"
        reasons.append("prior_turn_contains_value")
    elif f["prior_underspecified"] or (f["memory_already"] and f["not_open_artifact"]):
        state = "DURABLE_MEMORY_REQUIRED"
        reasons.append("durable_recall_without_restated_value")
    elif f["conceptual"] and f["not_open_artifact"] and f["not_digest_exact"] and f["not_research_cue"]:
        state = "ANSWERABLE_FROM_CONTEXT"
        reasons.append("conceptual_or_general_knowledge")
    elif f["web_fresh"] and f["not_research_cue"] and f["not_negation_web"]:
        state = "CURRENT_EXTERNAL_INFORMATION_REQUIRED"
        reasons.append("fresh_public_lookup")
    elif f["missing_given"] and not f["prior_concrete"]:
        state = "CURRENT_EXTERNAL_INFORMATION_REQUIRED"
        reasons.append("value_not_in_context")
    elif f["multi_turn"] and not f["prior_concrete"] and not f["prior_underspecified"]:
        state = "AMBIGUOUS"
        reasons.append("multi_turn_unclear_supply")
    else:
        state = "AMBIGUOUS"
        reasons.append("no_high_precision_state")
    family = STATE_TO_FAMILY.get(state)
    return {
        "information_state": state,
        "capability_family": family,
        "reason_codes": reasons,
        "flags": {k: bool(v) for k, v in f.items()},
    }


def apply_deterministic_rules(text: str, flags: dict[str, bool] | None = None) -> dict[str, Any]:
    f = flags or evidence_flags(text)
    fired: list[dict[str, Any]] = []
    for spec in RULE_SPECS:
        if all(f.get(req, False) for req in spec["requires"]):
            fired.append({"id": spec["id"], "then": spec["then"], "requires": spec["requires"]})
    if not fired:
        return {
            "high_confidence": False,
            "predicted_class": None,
            "rules_fired": [],
            "reason_codes": ["no_deterministic_rule"],
        }
    # Priority: first matching spec in RULE_SPECS order.
    chosen = fired[0]
    return {
        "high_confidence": True,
        "predicted_class": chosen["then"],
        "rules_fired": fired,
        "reason_codes": [chosen["id"]],
    }


def tool_needed_gate(state: dict[str, Any], det: dict[str, Any]) -> dict[str, Any]:
    info = state["information_state"]
    if det["high_confidence"] and det["predicted_class"] == "NO_TOOL":
        return {"gate": "NO_TOOL_CONFIDENT", "confidence": 0.92, "reason_codes": det["reason_codes"] + state["reason_codes"]}
    if det["high_confidence"] and det["predicted_class"] != "NO_TOOL":
        return {"gate": "TOOL_REQUIRED_CONFIDENT", "confidence": 0.9, "reason_codes": det["reason_codes"] + state["reason_codes"]}
    if info == "ANSWERABLE_FROM_CONTEXT":
        return {"gate": "NO_TOOL_CONFIDENT", "confidence": 0.78, "reason_codes": state["reason_codes"]}
    if info in {
        "DURABLE_MEMORY_REQUIRED",
        "ARTIFACT_ACCESS_REQUIRED",
        "CURRENT_EXTERNAL_INFORMATION_REQUIRED",
        "MULTI_SOURCE_RESEARCH_REQUIRED",
        "DETERMINISTIC_COMPUTE_REQUIRED",
    }:
        return {"gate": "TOOL_REQUIRED_CONFIDENT", "confidence": 0.8, "reason_codes": state["reason_codes"]}
    if info == "INSUFFICIENT_CONTEXT":
        return {"gate": "INSUFFICIENT_CONTEXT", "confidence": 0.55, "reason_codes": state["reason_codes"]}
    if info == "AMBIGUOUS":
        return {"gate": "AMBIGUOUS", "confidence": 0.4, "reason_codes": state["reason_codes"]}
    return {"gate": "TOOL_OPTIONAL", "confidence": 0.45, "reason_codes": ["weak_state"]}


def detect_multi_tool(text: str, flags: dict[str, bool], state: dict[str, Any]) -> dict[str, Any]:
    families: list[str] = []
    if flags["open_artifact"]:
        families.append("ARTIFACT_ACCESS")
    if flags["memory_already"] or flags["prior_underspecified"] or re.search(r"\brecall\b", text, re.I):
        families.append("MEMORY_STATE")
    if flags["research_cue"]:
        families.append("RESEARCH_SYNTHESIS")
    if flags["web_fresh"] or (flags["missing_given"] and not flags["prior_concrete"]):
        families.append("EXTERNAL_RETRIEVAL")
    if flags["digest_act"] and flags["exact_payload"]:
        families.append("DETERMINISTIC_UTILITY")
    uniq = []
    for fam in families:
        if fam not in uniq:
            uniq.append(fam)
    joined = bool(flags["then_join"] and len(uniq) >= 2)
    compare_two_caps = len(uniq) >= 2 and (flags["research_cue"] or flags["then_join"] or ("and" in text.casefold() and flags["open_artifact"]))
    required = joined or (len(uniq) >= 2 and flags["then_join"])
    return {
        "multi_tool_required": bool(required or (joined and len(uniq) >= 2)),
        "candidate_families": uniq if (required or compare_two_caps and flags["then_join"]) else (uniq if required else []),
        "reason_codes": ["THEN_JOIN_MULTI_CAPABILITY"] if required else [],
    }


def fit_bow_v5(train: list[dict[str, Any]]) -> dict[str, Any]:
    vocab: dict[str, int] = {}
    for r in train:
        for t in tokenize(r["input"]):
            if t not in vocab and len(vocab) < 4000:
                vocab[t] = len(vocab)

    def mat(rows: list[dict[str, Any]]):
        x = np.zeros((len(rows), len(vocab)), dtype=np.float64)
        y = np.zeros(len(rows), dtype=np.int64)
        for i, r in enumerate(rows):
            y[i] = CLASS_TO_ID[r["gold_class"]]
            for t in tokenize(r["input"]):
                j = vocab.get(t)
                if j is not None:
                    x[i, j] += 1.0
            nrm = np.linalg.norm(x[i])
            if nrm:
                x[i] /= nrm
        return x, y

    xtr, ytr = mat(train)
    w = np.zeros((N_CLASSES, xtr.shape[1]))
    for c in range(N_CLASSES):
        yb = (ytr == c).astype(np.float64) * 2 - 1
        for _ in range(120):
            w[c] -= 0.35 * (xtr.T @ (xtr @ w[c] - yb)) / max(len(train), 1)
    payload = json.dumps(list(vocab.keys()), separators=(",", ":")).encode("utf-8") + w.tobytes()
    return {"vocab": vocab, "weights": w, "hash": sha256_bytes(payload), "type": "v5_style_l2_bow_ova"}


def bow_vector(text: str, vocab: dict[str, int]) -> np.ndarray:
    x = np.zeros(len(vocab), dtype=np.float64)
    for t in tokenize(text):
        j = vocab.get(t)
        if j is not None:
            x[j] += 1.0
    nrm = np.linalg.norm(x)
    if nrm:
        x /= nrm
    return x


def bow_scores(text: str, model: dict[str, Any]) -> np.ndarray:
    return model["weights"] @ bow_vector(text, model["vocab"])


def softmax(z: np.ndarray) -> np.ndarray:
    z = z - np.max(z)
    e = np.exp(z)
    s = e.sum()
    return e / s if s else np.ones_like(z) / len(z)


def top2_from_scores(scores: np.ndarray) -> tuple[str, str, float, float, float]:
    order = np.argsort(-scores)
    i1, i2 = int(order[0]), int(order[1])
    p = softmax(scores.astype(np.float64))
    return CLASS_NAMES[i1], CLASS_NAMES[i2], float(p[i1]), float(p[i1] - p[i2]), float(p[i1])


def schema_fit(pred_class: str, text: str, flags: dict[str, bool], cards: list[dict[str, Any]]) -> dict[str, Any]:
    tool_id = EVAL6_TO_TOOL_ID.get(pred_class)
    if pred_class == "NO_TOOL" or tool_id is None:
        return {"ok": True, "reason": "no_tool_has_no_schema", "removed": False}
    card = next((c for c in cards if c["tool_id"] == tool_id), None)
    if card is None:
        return {"ok": False, "reason": "unknown_tool", "removed": True}
    if not card.get("availability", True) or not card.get("enabled", True):
        return {"ok": False, "reason": "unavailable", "removed": True}
    args = card.get("argument_schema") or []
    required = [a["name"] for a in args if a.get("required")]
    missing = []
    if "path" in required and not (flags.get("path_like") or flags.get("open_artifact")):
        missing.append("path")
    if "text" in required and not (flags.get("exact_payload") or flags.get("digest_act")):
        missing.append("text")
    if "query" in required and len(text.strip()) < 4:
        missing.append("query")
    if missing:
        return {"ok": False, "reason": f"required_not_expressible:{','.join(missing)}", "removed": True}
    return {"ok": True, "reason": "schema_expressible_or_inferable", "removed": False}


def shortlist_from_state(state: dict[str, Any], gate: dict[str, Any]) -> list[str]:
    if gate["gate"] == "NO_TOOL_CONFIDENT":
        return ["NO_TOOL"]
    fam = state.get("capability_family")
    if fam and fam in FAMILY_TO_EVAL6:
        mapped = FAMILY_TO_EVAL6[fam]
        # Allow NO_TOOL as competitor only at the gate, not inside exact-tool ranking.
        if mapped != "NO_TOOL":
            return [mapped]
        return ["NO_TOOL"]
    if gate["gate"] == "TOOL_REQUIRED_CONFIDENT":
        return [c for c in CLASS_NAMES if c != "NO_TOOL"]
    return list(CLASS_NAMES)


def combine_route(
    text: str,
    *,
    lexical_scores: np.ndarray | None,
    wrim_proba: np.ndarray | None,
    cards: list[dict[str, Any]],
    mode: str,
    margin_threshold: float = 0.12,
) -> dict[str, Any]:
    flags = evidence_flags(text)
    state = classify_information_state(text, flags)
    det = apply_deterministic_rules(text, flags)
    gate = tool_needed_gate(state, det)
    multi = detect_multi_tool(text, flags, state)

    lex_pred = lex_top2 = None
    lex_conf = lex_margin = 0.0
    if lexical_scores is not None:
        lex_pred, lex_top2, lex_conf, lex_margin, _ = top2_from_scores(lexical_scores)
    wrim_pred = wrim_top2 = None
    wrim_conf = wrim_margin = 0.0
    if wrim_proba is not None:
        wrim_pred, wrim_top2, wrim_conf, wrim_margin, _ = top2_from_scores(np.log(np.clip(wrim_proba, 1e-12, 1.0)))

    use_det = mode in {"det", "det_lex", "det_wrim", "full"}
    use_lex = mode in {"lex", "det_lex", "lex_wrim", "full"}
    use_wrim = mode in {"wrim", "det_wrim", "lex_wrim", "full"}
    use_schema = mode == "full"
    use_state_shortlist = mode in {"det", "det_lex", "det_wrim", "full"}

    reason: list[str] = []
    predicted = None
    decision_stage = "none"

    if use_det and det["high_confidence"]:
        predicted = det["predicted_class"]
        decision_stage = "deterministic_high_confidence"
        reason.append("deterministic_wins")
    elif use_state_shortlist and gate["gate"] == "NO_TOOL_CONFIDENT" and mode != "lex" and mode != "wrim" and mode != "lex_wrim":
        predicted = "NO_TOOL"
        decision_stage = "no_tool_gate"
        reason.append("gate_no_tool")
    else:
        shortlist = shortlist_from_state(state, gate) if use_state_shortlist and mode not in {"lex", "wrim", "lex_wrim"} else list(CLASS_NAMES)
        if mode in {"lex", "wrim", "lex_wrim"}:
            shortlist = list(CLASS_NAMES)
        if mode == "lex":
            predicted = lex_pred or "NO_TOOL"
            decision_stage = "lexical_only"
        elif mode == "wrim":
            predicted = wrim_pred or "NO_TOOL"
            decision_stage = "wrim_only"
        elif mode == "lex_wrim":
            if lex_margin >= 0.18:
                predicted = lex_pred
                decision_stage = "lex_margin"
            elif wrim_pred == lex_pred:
                predicted = lex_pred
                decision_stage = "lex_wrim_agree"
            elif wrim_margin >= 0.25 and lex_margin < 0.08:
                predicted = wrim_pred
                decision_stage = "wrim_tiebreak"
            else:
                predicted = lex_pred
                decision_stage = "lex_default_vs_wrim"
        else:
            # Cascade after det/gate: family shortlist, then lexical, then WRIM.
            def pick_from(scores: np.ndarray | None, fallback: str) -> str:
                if scores is None:
                    return fallback
                masked = np.full_like(scores, -1e9, dtype=np.float64)
                for name in shortlist:
                    masked[CLASS_TO_ID[name]] = scores[CLASS_TO_ID[name]]
                return CLASS_NAMES[int(np.argmax(masked))]

            lex_choice = pick_from(lexical_scores, shortlist[0]) if use_lex else shortlist[0]
            wrim_choice = pick_from(np.log(np.clip(wrim_proba, 1e-12, 1.0)), shortlist[0]) if use_wrim and wrim_proba is not None else None
            if use_lex and (not use_wrim or lexical_scores is None or lex_margin >= 0.12 or wrim_choice == lex_choice or wrim_choice is None):
                predicted = lex_choice
                decision_stage = "family_then_lexical"
            elif use_wrim and wrim_choice is not None and (not use_lex or lex_margin < 0.12):
                predicted = wrim_choice
                decision_stage = "family_then_wrim"
            elif use_lex:
                predicted = lex_choice
                decision_stage = "family_then_lexical_fallback"
            else:
                predicted = FAMILY_TO_EVAL6.get(state.get("capability_family") or "", "NO_TOOL")
                decision_stage = "state_family_only"
        reason.append(decision_stage)

    if predicted is None:
        predicted = "NO_TOOL"
        reason.append("null_fallback")

    schema = {"ok": True, "reason": "skipped", "removed": False}
    if use_schema:
        schema = schema_fit(predicted, text, flags, cards)
        if schema["removed"]:
            reason.append("schema_removed_candidate")
            # Next-best lexical among remaining.
            if lexical_scores is not None:
                order = np.argsort(-lexical_scores)
                for idx in order:
                    cand = CLASS_NAMES[int(idx)]
                    if cand == predicted:
                        continue
                    alt = schema_fit(cand, text, flags, cards)
                    if alt["ok"]:
                        predicted = cand
                        schema = alt
                        decision_stage = "schema_rerank"
                        break
            if schema["removed"]:
                predicted = "NO_TOOL"
                decision_stage = "schema_abstain_no_tool"

    components = {
        "deterministic": det["predicted_class"],
        "deterministic_confidence": 0.95 if det["high_confidence"] else 0.0,
        "lexical": lex_pred,
        "lexical_confidence": lex_conf,
        "lexical_top2": lex_top2,
        "wrim": wrim_pred,
        "wrim_confidence": wrim_conf,
        "wrim_top2": wrim_top2,
        "state": state["information_state"],
        "gate": gate["gate"],
    }
    preds = [p for p in (det["predicted_class"] if det["high_confidence"] else None, lex_pred, wrim_pred) if p]
    disagreement = len(set(preds)) > 1 if len(preds) >= 2 else False

    # Final confidence from the deciding component.
    if decision_stage.startswith("deterministic"):
        conf, margin = 0.93, 0.5
        top2 = lex_top2 or wrim_top2 or "NO_TOOL"
    elif use_lex and lexical_scores is not None:
        _, top2, conf, margin, _ = top2_from_scores(lexical_scores)
        if predicted != lex_pred:
            conf = max(conf * 0.7, 0.35)
    elif wrim_proba is not None:
        _, top2, conf, margin, _ = top2_from_scores(np.log(np.clip(wrim_proba, 1e-12, 1.0)))
    else:
        conf, margin, top2 = 0.55, 0.1, "NO_TOOL"

    abstain = "ROUTE_CONFIDENT"
    if flags["incompatible"]:
        abstain = "NO_COMPATIBLE_TOOL"
    elif gate["gate"] == "INSUFFICIENT_CONTEXT":
        abstain = "INSUFFICIENT_CONTEXT"
    elif gate["gate"] == "NO_TOOL_CONFIDENT" and predicted == "NO_TOOL":
        abstain = "NO_TOOL_CONFIDENT"
    elif gate["gate"] == "TOOL_OPTIONAL":
        abstain = "TOOL_OPTIONAL"
    elif disagreement and margin < margin_threshold:
        abstain = "ROUTE_AMBIGUOUS"
    elif gate["gate"] == "AMBIGUOUS" and not det["high_confidence"]:
        abstain = "ROUTE_AMBIGUOUS"

    # Six-way always emits a class; abstain is parallel diagnostic (no execution).
    tool_id = EVAL6_TO_TOOL_ID.get(predicted)
    return {
        "predicted_class": predicted,
        "tool_id": tool_id,
        "decision": "NO_TOOL" if predicted == "NO_TOOL" else "TOOL",
        "capability_family": EVAL6_TO_FAMILY.get(predicted),
        "candidate_tools": [EVAL6_TO_TOOL_ID[c] for c in shortlist_from_state(state, gate) if EVAL6_TO_TOOL_ID.get(c)],
        "confidence": float(conf),
        "margin": float(margin),
        "top2_class": top2,
        "reason_codes": reason + det["reason_codes"] + state["reason_codes"] + gate["reason_codes"],
        "information_state": state["information_state"],
        "gate": gate["gate"],
        "abstain_state": abstain,
        "decision_stage": decision_stage,
        "components": components,
        "disagreement": disagreement,
        "schema": schema,
        "multi_tool": multi,
        "alters_routing": False,
        "mode": mode,
    }


@dataclass
class NativeRouterV1:
    cards: list[dict[str, Any]]
    bow: dict[str, Any] | None = None
    margin_threshold: float = 0.12
    wrim_probas: dict[str, np.ndarray] = field(default_factory=dict)

    def score(self, text: str, mode: str = "full", wrim_proba: np.ndarray | None = None) -> dict[str, Any]:
        lex = bow_scores(text, self.bow) if self.bow is not None else None
        wp = wrim_proba
        if wp is None:
            wp = self.wrim_probas.get(text)
        return combine_route(
            text,
            lexical_scores=lex if mode in {"lex", "det_lex", "lex_wrim", "full"} else None,
            wrim_proba=wp if mode in {"wrim", "det_wrim", "lex_wrim", "full"} else None,
            cards=self.cards,
            mode=mode,
            margin_threshold=self.margin_threshold,
        )
