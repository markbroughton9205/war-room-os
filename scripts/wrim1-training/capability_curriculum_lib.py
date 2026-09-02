"""WRIM-1.1 capability curriculum + clean held-out eval (DESIGN/TEST_ONLY, no training)."""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from typing import Any


CURRICULUM_ID = "WR-CORPUS-1.1-CAPABILITY-CANDIDATE"
EVAL_ID = "WRIM-1.1-CAP-EVAL-0"
LINEAGE_STATUS = "TEST_DESIGN_ONLY_NOT_OFFICIAL"
NOW = "2026-08-31T09:00:00.000Z"

FORBIDDEN_HABIT = re.compile(r"^(pass|PASS|confirmed|acknowledged)\s*$")

DESIGN_FLOORS = {
    "instruction_response_target": 11_000,
    "structured_json_target": 6_000,
    "tool_use_target": 4_000,
    "war_room_concept_target": 4_000,
    "evidence_uncertainty_target": 4_000,
    "correction_target": 2_000,
    "code_supervised_target": 4_000,
    "total_supervised_target": 36_000,
    "floor_kind": "DESIGN_FLOOR_ENGINEERING_HYPOTHESIS",
}


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def example_id(prefix: str, payload: str) -> str:
    return f"{prefix}_{sha256_text(payload)[:20]}"


def normalize_prompt(text: str) -> str:
    collapsed = unicodedata.normalize("NFKC", text)
    collapsed = collapsed.casefold()
    collapsed = re.sub(r"\s+", " ", collapsed).strip()
    collapsed = re.sub(r"[\"'`]+", "", collapsed)
    return collapsed


def distinctive_phrases(text: str, min_len: int = 40) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    out = []
    for part in parts:
        p = re.sub(r"\s+", " ", part).strip()
        if len(p) >= min_len:
            out.append(p)
    if len(text) >= min_len:
        out.append(re.sub(r"\s+", " ", text.strip())[:180])
    return out


def render_supervised(
    *,
    fmt: str,
    commander: str,
    assistant: str,
    system_extra: str = "",
    schema_block: str | None = None,
    evidence_block: str | None = None,
    tool_result_block: str | None = None,
) -> str:
    """Tool JSON belongs AFTER <|assistant|> so it receives gradient. No new specials."""
    system = (
        "You are WRIM, a small native War Room language model. "
        f"Format={fmt}. Use observable evidence. Do not emit hidden reasoning. "
        "Do not execute tools. "
        + system_extra
    ).strip()
    blocks = ["<|bos|>", "<|system|>", system, "<|commander|>", commander.strip()]
    if evidence_block:
        blocks.extend(["<|evidence|>", evidence_block.strip()])
    if schema_block:
        blocks.extend(["Available tools / schema:", schema_block.strip()])
    if tool_result_block:
        blocks.extend(["Observed tool result (not a generation target):", tool_result_block.strip()])
    blocks.extend(["<|assistant|>", assistant.strip(), "<|eos|>"])
    return "\n".join(blocks)


def provenance(
    *,
    source_type: str,
    source_identity: str,
    synthetic: bool,
    generated_by: str,
    capability_family: str,
    license_name: str = "Commander-owned, private",
    transformation: str,
) -> dict[str, Any]:
    return {
        "source_type": source_type,
        "source_identity": source_identity,
        "license_ownership_status": license_name,
        "synthetic_vs_observed": "synthetic" if synthetic else "observed",
        "generated_by": generated_by,
        "capability_family": capability_family,
        "train_eval_designation": "train",
        "commander_correction": False,
        "retrieved_at": NOW,
        "transformation": transformation,
    }


def _base_ex(
    *,
    family: str,
    fmt: str,
    capability_ids: list[str],
    input_text: str,
    target: str,
    rendered: str,
    source_type: str,
    source_identity: str,
    synthetic: bool,
    generated_by: str,
    scorer: str,
    expected: Any,
    quality_notes: str = "",
) -> dict[str, Any]:
    if FORBIDDEN_HABIT.match(target.strip()):
        raise ValueError(f"forbidden habit target in {family}: {target!r}")
    eid = example_id("wr11cap", rendered)
    return {
        "exampleId": eid,
        "EXCLUDE_FROM_TRAINING": False,
        "lineage_status": LINEAGE_STATUS,
        "curriculum_id": CURRICULUM_ID,
        "format": fmt,
        "capability_family": family,
        "capability_ids": capability_ids,
        "qualityTier": "A",
        "trainability": "positive_training",
        "sourceClass": "TEST_ONLY",
        "input": input_text,
        "response": target,
        "renderedTrainingText": rendered,
        "renderedHash": sha256_text(rendered),
        "contentHash": sha256_text(rendered),
        "validator": {"type": scorer, "expected": expected},
        "quality_notes": quality_notes,
        "provenance": provenance(
            source_type=source_type,
            source_identity=source_identity,
            synthetic=synthetic,
            generated_by=generated_by,
            capability_family=family,
            transformation="capability-curriculum-v1",
        ),
    }


# --- TRAIN GENERATORS -------------------------------------------------------

_FACTS = [
    ("dock crane 4", "offline", "07:12 UTC", "maintenance log ML-441"),
    ("river gauge Keel", "2.4 meters", "04:00 UTC", "Gauge A"),
    ("warehouse B", "sealed", "Monday", "yard clerk note"),
    ("radio net 7", "quiet", "night watch", "operator transcript"),
    ("pump 12", "running", "shift 2", "telemetry ticket T-90"),
    ("gate west", "locked", "after 22:00", "security round"),
    ("lab fridge 3", "4 C", "morning", "inventory sheet"),
    ("ferry slip", "fog delay", "06:30", "harbor log"),
    ("archive room", "humidity 41%", "Tuesday", "facilities report"),
    ("pad C", "clear", "launch window", "range status"),
]


def _build_instruction() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    templates = [
        (
            "Case {i}: Answer in full sentences. What status was recorded for {subj}?",
            "Recorded status for {subj} is {val}, noted at {when} in {src}. "
            "That reading is local to the attached note. Further plant-wide claims are UNKNOWN. "
            "Next bounded action is to keep {src} as the SOURCE and not invent extra sensors. "
            "Do not answer with a single acknowledgement token.",
        ),
        (
            "Case {i}: Explain why {src} is the place to look for {subj}.",
            "{src} is the attached record that mentions {subj} at {when}. It is the available SOURCE for the {val} status. "
            "PROVENANCE stops at that note. CONFIDENCE should stay modest because only one document is present. "
            "If a later note conflicts, mark the conflict as OBSERVED and the true value as UNKNOWN.",
        ),
        (
            "Case {i}: Interpret this request and state the next bounded action: summarize {subj} for the Commander.",
            "Request interpretation: produce a two-sentence status for {subj}. "
            "Next action: copy {val} at {when} from {src} only. Do not add weather, motive, or personnel. "
            "If the Commander later asks for causes, answer UNKNOWN unless a new SOURCE appears.",
        ),
        (
            "Case {i}: Give a concise War Room status paragraph for {subj}.",
            "STATUS {subj}: {val} at {when}; source={src}; class=OBSERVED from that source alone. "
            "This is not a Council verdict and not a promotion of any checkpoint. "
            "If operators ask whether the system is healthy overall, that broader claim is UNKNOWN.",
        ),
        (
            "Case {i}: The Commander asked: is {subj} healthy? Use only the attached note.",
            "The attached note says {subj} is {val} at {when} ({src}). That is not a general health certificate. "
            "Health beyond the note is UNKNOWN. Keep the known-good fact {val} and do not fill gaps with stories.",
        ),
        (
            "Case {i}: Rewrite the fact about {subj} as a shift handoff of at least three sentences.",
            "Handoff item {i}: {subj} was {val} as of {when}, according to {src}. "
            "Continue watching the same SOURCE. Do not treat this file as a live production promotion. "
            "If the next shift lacks {src}, report NO_COVERAGE rather than repeating {val} from memory.",
        ),
        (
            "Case {i}: What should an operator say if asked for extra detail beyond {src}?",
            "Say that {src} covers {subj} as {val} at {when}, and that further detail is UNKNOWN without another source. "
            "Do not raise CONFIDENCE. Do not answer 'confirmed'. Point to PROVENANCE of the single note.",
        ),
        (
            "Case {i}: Produce a short briefing of {subj} for someone new to the mission.",
            "Briefing {i}: {subj} appears in {src}. At {when} the recorded value was {val}. "
            "Treat that as a local OBSERVED line, not a Council decision. "
            "A MISSION here is only to report the note faithfully and stop.",
        ),
    ]
    for i, (subj, val, when, src) in enumerate(_FACTS * 10):
        q_t, a_t = templates[i % len(templates)]
        q = q_t.format(i=i, subj=subj, val=val, when=when, src=src)
        a = a_t.format(i=i, subj=subj, val=val, when=when, src=src)
        rendered = render_supervised(fmt="instruction_response", commander=q, assistant=a)
        out.append(
            _base_ex(
                family="instruction_response",
                fmt="instruction_response",
                capability_ids=["CAP-02", "CAP-01", "CAP-10"],
                input_text=q,
                target=a,
                rendered=rendered,
                source_type="SYNTHETIC_CURRICULUM",
                source_identity=f"synth:instruct:{i:03d}",
                synthetic=True,
                generated_by="capability_curriculum_lib.v1",
                scorer="bounded-prose",
                expected={"must_include": [subj.split()[0], val.split()[0]]},
            )
        )
    extras = [
        (
            "Define COMMANDER in three sentences as used in War Room operations.",
            "The COMMANDER is the human authority who approves gated actions. Models and the Council do not replace that approval. "
            "A saved checkpoint is still waiting on COMMANDER promotion before it can be treated as live.",
        ),
        (
            "What is a MISSION in this system? Write a short paragraph.",
            "A MISSION is a bounded objective with evidence and stop conditions, not an open-ended license to act. "
            "It names what will be observed and when work must halt. Expanding the mission silently is a process failure.",
        ),
        (
            "How should WRIM answer when the user asks for a next action after a failed check?",
            "State the failed check in a complete sentence. Preserve any still-valid facts. "
            "Propose one bounded next action that does not repeat the failed step. Do not emit 'acknowledged' as the whole reply.",
        ),
        (
            "User: 'ack'. What does that mean here? Answer in two sentences.",
            "Treat 'ack' as a receipt, not as proof that work succeeded. "
            "Reply with the current status in a full sentence rather than repeating 'acknowledged'.",
        ),
        (
            "User wants a numbered plan with two steps only, each a complete sentence.",
            "1. Restate the request in one sentence so the MISSION boundary is visible.\n"
            "2. Name the single next bounded action and the SOURCE it needs.",
        ),
        (
            "Explain evaluation versus training in three sentences.",
            "Training is optimizer updates and requires authorization. Evaluation measures a frozen checkpoint and must not leak prompts into the corpus. "
            "Finishing a training job is not promotion.",
        ),
        (
            "Give a status report: optimizer idle, design curriculum only, no official run.",
            "STATUS: optimizer idle. The current work is curriculum and held-out design. "
            "Official candidate training has not started. Promotion remains false.",
        ),
    ]
    ops = []
    topics = [
        ("rehearsal", "WR-CORPUS-0 literary prefix is retention, not proof of new skill"),
        ("interleave", "2048-token windows mix families so rehearsal cannot hide leftover collapse"),
        ("masking", "gradient belongs on tokens after the assistant marker"),
        ("held-out", "eval prompts must never be packed into train shards"),
        ("KL", "small KL is not capability acquisition"),
        ("loss", "falling loss is not a better-than-WRIM-0 proof"),
        ("duration", "step counts must come from unique tokens and planned exposures"),
        ("LR", "peak 3e-5 is the current safe boundary from Recovery-007"),
        ("capacity", "19.2M is not proven too small until curriculum evidence says so"),
        ("tools", "predicting a tool_call is not live tool competence"),
    ]
    for i, (topic, line) in enumerate(topics * 4):
        q = (
            f"Ops brief {i:02d} on {topic}: the Commander wants a four-sentence explanation "
            f"usable in a status channel. Mention {topic} explicitly."
        )
        a = (
            f"Ops brief {i:02d}: {line}. "
            f"The topic {topic} is a process fact, not a promotion. "
            f"WRIM should answer in complete sentences and avoid the habit of saying pass. "
            f"If evidence for further claims is missing, label those claims UNKNOWN."
        )
        ops.append((q, a))
    extras.extend(ops)
    for i, (q, a) in enumerate(extras):
        rendered = render_supervised(fmt="instruction_response", commander=q, assistant=a)
        out.append(
            _base_ex(
                family="instruction_response",
                fmt="instruction_response",
                capability_ids=["CAP-02", "CAP-05"],
                input_text=q,
                target=a,
                rendered=rendered,
                source_type="SYNTHETIC_CURRICULUM",
                source_identity=f"synth:instruct-extra:{i:03d}",
                synthetic=True,
                generated_by="capability_curriculum_lib.v1",
                scorer="bounded-prose",
                expected={"must_include": ["the"]},
            )
        )
    return out


def _build_json() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    statuses = ["READY", "BLOCKED", "WATCH", "HOLD"]
    actions = ["review-log", "wait-source", "ask-commander", "re-read-note"]
    for i in range(60):
        subj, val, when, src = _FACTS[i % len(_FACTS)]
        obj = {
            "subject": subj,
            "status": statuses[i % 4],
            "observed_value": val,
            "observed_at": when,
            "source": src,
            "confidence": round(0.35 + (i % 5) * 0.1, 2),
            "next_action": actions[i % 4],
            "notes": (
                f"JSON-only card {i} for {subj}. This object is a structured status card, "
                f"not a metadata dump. Preserve source {src} and time {when}."
            ),
        }
        schema = (
            "Return JSON only. Keys: subject, status, observed_value, observed_at, source, "
            "confidence (number), next_action, notes. No markdown."
        )
        q = f"{schema}\nFacts: {subj} is {val} at {when} according to {src}."
        target = json.dumps(obj, ensure_ascii=True)
        rendered = render_supervised(
            fmt="structured_json",
            commander=q,
            assistant=target,
            system_extra="When JSON-only is requested, emit a single JSON object and no prose.",
        )
        out.append(
            _base_ex(
                family="structured_json",
                fmt="structured_json",
                capability_ids=["CAP-03", "CAP-02"],
                input_text=q,
                target=target,
                rendered=rendered,
                source_type="SYNTHETIC_CURRICULUM",
                source_identity=f"synth:json-status:{i:03d}",
                synthetic=True,
                generated_by="capability_curriculum_lib.v1",
                scorer="json-schema",
                expected={
                    "required_keys": [
                        "subject",
                        "status",
                        "observed_value",
                        "observed_at",
                        "source",
                        "confidence",
                        "next_action",
                        "notes",
                    ],
                    "types": {"confidence": "number", "status": "string"},
                },
            )
        )
    for i in range(24):
        obj = {
            "checkpoint": f"ckpt-design-{i:02d}",
            "training": False,
            "evaluation": True,
            "promotion": False,
            "reason": "DESIGN/TEST_ONLY curriculum card; not an official run.",
        }
        q = (
            "Return JSON only with keys checkpoint, training (boolean), evaluation (boolean), "
            f"promotion (boolean), reason. The checkpoint name is ckpt-design-{i:02d}. "
            "Training is not running. Evaluation design is in progress. Promotion is false."
        )
        target = json.dumps(obj, ensure_ascii=True)
        rendered = render_supervised(fmt="structured_json", commander=q, assistant=target)
        out.append(
            _base_ex(
                family="structured_json",
                fmt="structured_json",
                capability_ids=["CAP-03", "CAP-05"],
                input_text=q,
                target=target,
                rendered=rendered,
                source_type="SYNTHETIC_CURRICULUM",
                source_identity=f"synth:json-gate:{i:03d}",
                synthetic=True,
                generated_by="capability_curriculum_lib.v1",
                scorer="json-schema",
                expected={
                    "required_keys": ["checkpoint", "training", "evaluation", "promotion", "reason"],
                    "types": {"training": "boolean", "evaluation": "boolean", "promotion": "boolean"},
                },
            )
        )
    return out


_TOOL_SCHEMA = json.dumps(
    {
        "tools": [
            {
                "name": "sha256",
                "args": {"text": "string"},
                "purpose": "hash a Commander-owned phrase",
            },
            {
                "name": "lookup_note",
                "args": {"note_id": "string"},
                "purpose": "read a local note id",
            },
            {"name": "none", "args": {}, "purpose": "answer without a tool"},
        ]
    },
    ensure_ascii=True,
)


def _tool_call(name: str, arguments: dict[str, Any]) -> str:
    body = json.dumps({"tool": name, "arguments": arguments}, ensure_ascii=True)
    return f"<tool_call>\n{body}\n</tool_call>"


def _build_tools() -> list[dict[str, Any]]:
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
    ]
    for i, phrase in enumerate(phrases * 3):
        q = (
            f"Hash the Commander-owned phrase {phrase!r} with the bounded sha256 tool. "
            "Emit a tool_call JSON after the assistant marker. Do not run the hash yourself."
        )
        target = _tool_call("sha256", {"text": phrase}) + (
            f"\nPredicted next action only. Do not execute. Local phrase id T-{i:03d}."
        )
        rendered = render_supervised(
            fmt="tool_use",
            commander=q,
            assistant=target,
            schema_block=_TOOL_SCHEMA,
        )
        out.append(
            _base_ex(
                family="tool_use",
                fmt="tool_use",
                capability_ids=["CAP-08", "CAP-03"],
                input_text=q,
                target=target,
                rendered=rendered,
                source_type="SYNTHETIC_CURRICULUM",
                source_identity=f"synth:tool-select-sha:{i:03d}",
                synthetic=True,
                generated_by="capability_curriculum_lib.v1",
                scorer="tool-call",
                expected={"tool": "sha256", "arguments": {"text": phrase}},
            )
        )
    notes = [f"NOTE-{n:03d}" for n in range(18)]
    for i, note_id in enumerate(notes):
        q = f"Read local note {note_id}. Choose lookup_note with that note_id."
        target = _tool_call("lookup_note", {"note_id": note_id}) + (
            f"\nPredicted lookup only. Note {note_id} is local. Not live execution."
        )
        rendered = render_supervised(fmt="tool_use", commander=q, assistant=target, schema_block=_TOOL_SCHEMA)
        out.append(
            _base_ex(
                family="tool_use",
                fmt="tool_use",
                capability_ids=["CAP-08"],
                input_text=q,
                target=target,
                rendered=rendered,
                source_type="SYNTHETIC_CURRICULUM",
                source_identity=f"synth:tool-lookup:{i:03d}",
                synthetic=True,
                generated_by="capability_curriculum_lib.v1",
                scorer="tool-call",
                expected={"tool": "lookup_note", "arguments": {"note_id": note_id}},
            )
        )
    for i, (subj, val, when, src) in enumerate(_FACTS[:16]):
        q = (
            f"The user asked: what color is the sky in this chat? No tool can help. "
            f"Ignore the unused plant note about {subj} being {val} at {when} ({src})."
        )
        target = _tool_call("none", {"reason": "The sky-color question needs no listed tool; answer from ordinary language if at all."}) + (
            f"\nNo listed tool is required. Unused plant fragment {subj}/{val} is not a tool argument."
        )
        rendered = render_supervised(fmt="tool_use", commander=q, assistant=target, schema_block=_TOOL_SCHEMA)
        out.append(
            _base_ex(
                family="tool_use",
                fmt="tool_use",
                capability_ids=["CAP-08", "CAP-09"],
                input_text=q,
                target=target,
                rendered=rendered,
                source_type="SYNTHETIC_CURRICULUM",
                source_identity=f"synth:tool-none:{i:03d}",
                synthetic=True,
                generated_by="capability_curriculum_lib.v1",
                scorer="tool-call",
                expected={"tool": "none"},
            )
        )
    for i in range(12):
        q = (
            "A previous step tried tool curl against an external URL and was rejected. "
            f"Now hash the local phrase 'recovery-fixture-{i:02d}' with sha256 instead."
        )
        target = _tool_call("sha256", {"text": f"recovery-fixture-{i:02d}"}) + (
            "\nDo not repeat the rejected external fetch. Predicted sha256 only."
        )
        rendered = render_supervised(fmt="tool_use", commander=q, assistant=target, schema_block=_TOOL_SCHEMA)
        out.append(
            _base_ex(
                family="tool_use",
                fmt="tool_use",
                capability_ids=["CAP-08", "CAP-09"],
                input_text=q,
                target=target,
                rendered=rendered,
                source_type="GYM_DERIVED_SYNTHETIC",
                source_identity=f"synth:tool-fail-redirect:{i:03d}",
                synthetic=True,
                generated_by="capability_curriculum_lib.v1",
                scorer="tool-call",
                expected={"tool": "sha256", "arguments": {"text": f"recovery-fixture-{i:02d}"}},
                quality_notes="Inspired by Wave 8.1 unsafe-curl gym; not a Commander correction; not live execution.",
            )
        )
    for i, phrase in enumerate(phrases[:12]):
        digest_prefix = sha256_text(phrase)[:12]
        q = (
            f"Tool sha256 returned prefix {digest_prefix} for input {phrase!r}. "
            "Interpret the result in one sentence. Do not call another tool."
        )
        a = (
            f"The bounded sha256 tool returned prefix {digest_prefix} for the local phrase {phrase}. "
            "That is an OBSERVED hash prefix, not a Council conclusion."
        )
        rendered = render_supervised(
            fmt="tool_use",
            commander=q,
            assistant=a,
            tool_result_block=json.dumps({"tool": "sha256", "prefix": digest_prefix}, ensure_ascii=True),
        )
        out.append(
            _base_ex(
                family="tool_use",
                fmt="tool_use",
                capability_ids=["CAP-08", "CAP-06"],
                input_text=q,
                target=a,
                rendered=rendered,
                source_type="SYNTHETIC_CURRICULUM",
                source_identity=f"synth:tool-interpret:{i:03d}",
                synthetic=True,
                generated_by="capability_curriculum_lib.v1",
                scorer="bounded-prose",
                expected={"must_include": [digest_prefix, "OBSERVED"]},
            )
        )
    return out


def _build_wr_concepts() -> list[dict[str, Any]]:
    pairs = [
        ("COMMANDER", "human approval authority over gated work"),
        ("COUNCIL", "multi-model advisory group, not an independent executive"),
        ("MISSION", "bounded objective with evidence and a stop rule"),
        ("APPROVAL", "explicit Commander permission required before gated action"),
        ("SOURCE", "identified origin of a datum"),
        ("PROVENANCE", "trace of how a datum was obtained and transformed"),
        ("CONFIDENCE", "stated certainty, never a substitute for a source"),
        ("OBSERVED", "directly present in attached evidence"),
        ("INFERENCE", "derived claim that must be labeled as derived"),
        ("UNKNOWN", "not established by attached evidence"),
        ("NO_COVERAGE", "no observation in scope; not the same as value zero"),
        ("checkpoint", "saved weights and run state, not a promotion"),
        ("training", "optimizer updates; must be authorized"),
        ("evaluation", "measurement that must not leak into training text"),
        ("promotion", "separate Commander decision after evaluation"),
    ]
    out: list[dict[str, Any]] = []
    for i, (term, gloss) in enumerate(pairs * 3):
        q = (
            f"Scene {i}: In War Room usage, apply the term {term} when a junior operator "
            f"tries to treat a saved weight file named weights-{i:02d}.safetensors as live production. "
            f"Write four sentences that use {term} correctly and mention checkpoint versus promotion."
        )
        a = (
            f"{term} means {gloss}. The file weights-{i:02d}.safetensors is a checkpoint, not a live model. "
            f"Promotion is a separate COMMANDER decision after evaluation. "
            f"Training authorization is also separate; finding a file on disk is not APPROVAL. "
            f"If asked whether production already changed, the honest answer is UNKNOWN without an explicit promotion record."
        )
        rendered = render_supervised(fmt="instruction_response", commander=q, assistant=a)
        out.append(
            _base_ex(
                family="war_room_concepts",
                fmt="instruction_response",
                capability_ids=["CAP-05", "CAP-02"],
                input_text=q,
                target=a,
                rendered=rendered,
                source_type="SYNTHETIC_CURRICULUM",
                source_identity=f"synth:wr-term:{term}:{i:03d}",
                synthetic=True,
                generated_by="capability_curriculum_lib.v1",
                scorer="bounded-prose",
                expected={"must_include": [term]},
            )
        )
    return out


def _build_evidence() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    scenarios = [
        (
            "Note A says pump 12 is running. No other note is attached.",
            "OBSERVED",
            "The running state is OBSERVED in Note A. Wider plant health is UNKNOWN.",
        ),
        (
            "Note A says 2.1 m. Note B says 4.8 m for the same gauge-hour. Neither is verified.",
            "UNKNOWN",
            "The crest is UNKNOWN as a single truth. The conflict is OBSERVED; picking a winner would be an unlabeled INFERENCE.",
        ),
        (
            "No gauge file is attached. Someone asks for the crest as 0.0.",
            "NO_COVERAGE",
            "This is NO_COVERAGE. Missing data is not the number 0.0.",
        ),
        (
            "From two matching local logs you guess the delay was weather. Logs never say weather.",
            "INFERENCE",
            "Weather is INFERENCE. The logs are SOURCE material; they do not OBSERVE weather.",
        ),
        (
            "A hash prefix is printed by the bounded sha256 tool for a local string.",
            "OBSERVED",
            "The prefix is OBSERVED from the tool result. Meaning of the string remains a separate claim.",
        ),
        (
            "The user asks who is at fault. Attached files are silent.",
            "UNKNOWN",
            "Fault is UNKNOWN. Do not invent a person of interest.",
        ),
        (
            "Terra-like request: no live observation packet is attached.",
            "NO_COVERAGE",
            "Spatial/temporal answers have NO_COVERAGE without an observation packet. Do not fabricate coordinates.",
        ),
        (
            "Source S1 is named; confidence is written as 0.9 by a template with no new evidence.",
            "INFERENCE",
            "High CONFIDENCE without new SOURCE work is not OBSERVED truth. Treat 0.9 as an INFERENCE about certainty.",
        ),
    ]
    places = ["pier 19", "yard north", "lab annex", "radio loft", "pump house", "gate cabin"]
    for i, (scene, label, answer) in enumerate(scenarios * 8):
        place = places[i % len(places)]
        q = (
            f"Incident card {i} at {place}. Classify the main claim. "
            "Reply with CLASS=<LABEL> on the first line using OBSERVED, INFERENCE, UNKNOWN, or NO_COVERAGE, then a short paragraph.\n"
            f"Scenario: {scene} Marker={place}."
        )
        a = (
            f"CLASS={label}\n{answer} Location tag {place} does not add evidence. "
            "Preserve SOURCE names if present. Do not raise CONFIDENCE without evidence. "
            "If coverage is missing, prefer NO_COVERAGE over inventing zero."
        )
        rendered = render_supervised(fmt="source_grounded_research", commander=q, assistant=a)
        out.append(
            _base_ex(
                family="evidence_uncertainty",
                fmt="source_grounded_research",
                capability_ids=["CAP-06", "CAP-07"],
                input_text=q,
                target=a,
                rendered=rendered,
                source_type="SYNTHETIC_CURRICULUM",
                source_identity=f"synth:evidence:{i:03d}",
                synthetic=True,
                generated_by="capability_curriculum_lib.v1",
                scorer="class-label",
                expected={"class": label},
            )
        )
    return out


def _build_corrections() -> list[dict[str, Any]]:
    """Synthetic system-failure patterns. Commander correction count remains 0."""
    out: list[dict[str, Any]] = []
    rows = [
        (
            "Earlier answer said the crest was 3.1 m. The only attached note actually says 2.4 m. Correct it.",
            "Correction: the attached note states 2.4 m, not 3.1 m. The 3.1 m figure is withdrawn. CLASS=OBSERVED for 2.4 m only.",
        ),
        (
            "A prior step called curl and failed. Do not repeat curl. Hash local phrase 'do-not-repeat-curl'.",
            _tool_call("sha256", {"text": "do-not-repeat-curl"}),
        ),
        (
            "Two notes disagree (12:00 vs 18:00). Previous text picked 12:00. Fix the error.",
            "Correction: do not pick a winner. CLASS=UNKNOWN for the true time. The disagreement itself is OBSERVED.",
        ),
        (
            "Previous JSON included a prose apology before the object. Repair: JSON only with keys ok (boolean) and error (string).",
            json.dumps({"ok": False, "error": "prior-output-had-prose"}, ensure_ascii=True),
        ),
        (
            "The model claimed promotion occurred. Training never ran. Correct the record.",
            "Correction: promotion is false. No official candidate training occurred. A checkpoint is not a promotion.",
        ),
        (
            "Missing evidence was filled with a plausible story. Stop and label it.",
            "Correction: that story is withdrawn. CLASS=UNKNOWN. Plausible narrative is not SOURCE.",
        ),
    ]
    expanded_rows = []
    for k in range(8):
        for q, a in rows:
            qq = f"Repair ticket {k:02d}. {q} Ticket-id COR-{k:02d}."
            if a.startswith("Correction:"):
                aa = a + f" Ticket COR-{k:02d} is closed only for this repair; no promotion occurred."
            elif a.startswith("{") or "<tool_call>" in a:
                aa = a
            else:
                aa = a + f" Ticket COR-{k:02d}."
            expanded_rows.append((qq, aa))
    for i, (q, a) in enumerate(expanded_rows):
        fmt = "tool_use" if "<tool_call>" in a else "instruction_response"
        if a.startswith("{"):
            fmt = "structured_json"
        rendered = render_supervised(fmt=fmt, commander=q, assistant=a, schema_block=_TOOL_SCHEMA if fmt == "tool_use" else None)
        item = _base_ex(
            family="correction_failure",
            fmt=fmt,
            capability_ids=["CAP-09", "CAP-07"],
            input_text=q,
            target=a,
            rendered=rendered,
            source_type="SYNTHETIC_SYSTEM_FAILURE",
            source_identity=f"synth:correction:{i:03d}",
            synthetic=True,
            generated_by="capability_curriculum_lib.v1",
            scorer="bounded-prose",
            expected={"must_include": ["Correction"] if a.startswith("Correction") else ["tool"]},
        )
        item["provenance"]["commander_correction"] = False
        item["quality_notes"] = "SYNTHETIC_SYSTEM_FAILURE — not a Commander correction. Real Commander correction count is 0."
        out.append(item)
    return out


def _build_code() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    specs = []
    for n in range(40):
        specs.append(
            (
                f"Implement file drill_{n}.py as a tiny helper: define cap_add_{n}(a, b) adding two ints. "
                "Include a one-line docstring mentioning drill id. Output the function, not a test harness.",
                f"def cap_add_{n}(a: int, b: int) -> int:\n"
                f"    \"\"\"Drill {n}: add two integers for curriculum practice.\"\"\"\n"
                f"    return a + b\n",
                f"cap_add_{n}",
            )
        )
    extras = [
        (
            "Implement clamp01 in a small module comment-free except a docstring. Clip float x into [0, 1].",
            "def clamp01(x: float) -> float:\n"
            "    \"\"\"Clip x into the closed unit interval.\"\"\"\n"
            "    if x < 0:\n        return 0.0\n    if x > 1:\n        return 1.0\n    return float(x)\n",
            "clamp01",
        ),
        (
            "Create label_unknown helper used by epistemic drills; it must return the token UNKNOWN.",
            'def label_unknown() -> str:\n    """Fixed epistemic token for missing proof."""\n    return "UNKNOWN"\n',
            "label_unknown",
        ),
        (
            "Helper required_keys(d, keys) reports whether every listed field exists on dict d.",
            "def required_keys(d: dict, keys: list[str]) -> bool:\n"
            "    \"\"\"True iff each required field is present.\"\"\"\n"
            "    return all(k in d for k in keys)\n",
            "required_keys",
        ),
        (
            "Helper no_prose_json(text) is true when stripped text is a single object wrapper.",
            "def no_prose_json(text: str) -> bool:\n"
            "    \"\"\"Reject leading commentary around an object.\"\"\"\n"
            "    s = text.strip()\n    return s.startswith('{') and s.endswith('}')\n",
            "no_prose_json",
        ),
    ]
    for n in range(30):
        specs.append(
            (
                f"Module tally_{n}: implement cap_span_{n}(xs: list[int]) -> int as max(xs)-min(xs) or 0 if empty. Docstring required.",
                f"def cap_span_{n}(xs: list[int]) -> int:\n"
                f"    \"\"\"Tally {n}: range of a list, zero if empty.\"\"\"\n"
                f"    if not xs:\n        return 0\n    return max(xs) - min(xs)\n",
                f"cap_span_{n}",
            )
        )
    for i, (q, a, name) in enumerate(specs):
        rendered = render_supervised(fmt="code", commander=q, assistant=a)
        out.append(
            _base_ex(
                family="code_supervised",
                fmt="code",
                capability_ids=["CAP-04", "CAP-02"],
                input_text=q,
                target=a,
                rendered=rendered,
                source_type="SYNTHETIC_CURRICULUM",
                source_identity=f"synth:code:{name}:{i:03d}",
                synthetic=True,
                generated_by="capability_curriculum_lib.v1",
                scorer="python-syntax",
                expected={"fn": name},
            )
        )
    return out


def build_training_examples() -> list[dict[str, Any]]:
    examples = []
    examples.extend(_build_instruction())
    examples.extend(_build_json())
    examples.extend(_build_tools())
    examples.extend(_build_wr_concepts())
    examples.extend(_build_evidence())
    examples.extend(_build_corrections())
    examples.extend(_build_code())
    # de-dupe by rendered hash
    seen: set[str] = set()
    uniq = []
    for ex in examples:
        h = ex["renderedHash"]
        if h in seen:
            continue
        seen.add(h)
        uniq.append(ex)
    return uniq


# --- EVAL SUITE (independent wording; not slot-copies of train) -------------

def _eval_item(
    *,
    eval_id: str,
    family: str,
    capability_ids: list[str],
    level: int,
    prompt: str,
    scorer: str,
    expected: Any,
    wrim0_support: str,
    notes: str,
) -> dict[str, Any]:
    return {
        "evalId": eval_id,
        "EXCLUDE_FROM_TRAINING": True,
        "suite_id": EVAL_ID,
        "lineage_status": LINEAGE_STATUS,
        "family": family,
        "capability_ids": capability_ids,
        "level": level,
        "prompt": prompt,
        "generation_prompt": prompt,
        "objectiveScorer": scorer,
        "expected": expected,
        "wrim0Support": wrim0_support,
        "notes": notes,
        "contaminationFingerprint": sha256_text(prompt),
        "normalizedFingerprint": sha256_text(normalize_prompt(prompt)),
        "kind": "CAPABILITY_HELDOUT",
        "held_out": True,
        "diagnostic_only": False,
    }


def build_eval_suite() -> dict[str, Any]:
    items: list[dict[str, Any]] = []

    lang = [
        ("cap0-lang-01", 1, "The lantern on the north quay went out just after the tide turned, and the keeper"),
        ("cap0-lang-02", 1, "When the brass clock in the map room struck four, nobody spoke because"),
        ("cap0-lang-03", 2, "Continue this scene in ordinary English, no lists: A courier arrived with a damp envelope."),
        ("cap0-lang-04", 2, "Write three coherent sentences about a closed archive that still smells of paper and rain."),
        ("cap0-lang-05", 3, "Continue without repeating the last five words: The hillside road narrowed until the cart could barely"),
        ("cap0-lang-06", 3, "Finish a paragraph about waiting for a signal lamp, using complete sentences only."),
        ("cap0-lang-07", 1, "The kitchen garden had gone to seed, yet the well still gave cold water, so"),
        ("cap0-lang-08", 2, "Describe a quiet radio watch in full sentences. Do not output a single punctuation mark as the whole answer."),
    ]
    for eid, level, prompt in lang:
        items.append(
            _eval_item(
                eval_id=eid,
                family="EVAL-LANG",
                capability_ids=["CAP-01", "CAP-10"],
                level=level,
                prompt=prompt,
                scorer="language-diagnostics",
                expected={"min_unique_ratio": 0.35, "forbid_single_punct": True},
                wrim0_support="SUPPORTED",
                notes="Coherent continuation; not a collapse probe clone.",
            )
        )

    instruct = [
        ("cap0-ins-01", 1, "Answer with one sentence: name the human who must approve gated War Room actions.", "exact-contains", {"any": ["Commander", "COMMANDER"]}),
        ("cap0-ins-02", 1, "Reply with exactly two sentences explaining what a checkpoint is not.", "exact-contains", {"any": ["promotion", "live"]}),
        ("cap0-ins-03", 2, "The user typed only 'status?'. Interpret and give a full-sentence status that training is not running.", "exact-contains", {"any": ["not running", "not training", "Training is not"]}),
        ("cap0-ins-04", 2, "Give a next action for missing logs: one sentence, no word 'pass'.", "forbid-tokens", {"forbid": ["pass", "PASS", "acknowledged"]}),
        ("cap0-ins-05", 3, "Request: 'summarize then wait'. Produce a 2-step numbered plan. Each step a complete sentence.", "regex", {"pattern": r"1[.).].+\n2[.).].+"}),
        ("cap0-ins-06", 1, "In one sentence, what should WRIM do instead of repeating 'confirmed'?", "exact-contains", {"any": ["status", "evidence", "sentence"]}),
        ("cap0-ins-07", 2, "Paraphrase this order as a question you would ask: freeze weights until review.", "exact-contains", {"any": ["checkpoint", "promotion", "review", "freeze"]}),
        ("cap0-ins-08", 3, "Compose a handoff: mention HOLD, mention missing source, do not claim the job is done.", "exact-contains", {"all": ["HOLD"]}),
        ("cap0-ins-09", 1, "Answer directly: is promotion automatic after a checkpoint save? Yes or no plus a clause.", "exact-contains", {"any": ["No", "not"]}),
        ("cap0-ins-10", 2, "The user asks for a haiku about optimizer steps. Refuse with a complete sentence offering a status line instead.", "forbid-tokens", {"forbid": ["pass"]}),
        ("cap0-ins-11", 3, "Combine: explain UNKNOWN and then state the next action is to attach a source.", "exact-contains", {"all": ["UNKNOWN"]}),
        ("cap0-ins-12", 1, "What is the Council relative to the Commander? One sentence.", "exact-contains", {"any": ["advisory", "advise", "does not replace", "not replace"]}),
    ]
    for eid, level, prompt, scorer, expected in instruct:
        items.append(
            _eval_item(
                eval_id=eid,
                family="EVAL-INSTRUCT",
                capability_ids=["CAP-02"],
                level=level,
                prompt=prompt,
                scorer=scorer,
                expected=expected,
                wrim0_support="SUPPORTED",
                notes="Instruction following with diverse targets.",
            )
        )

    json_items = [
        (
            "cap0-json-01",
            1,
            "Return JSON only with keys mission (string) and open (boolean). mission=night-watch, open=false.",
            {"required_keys": ["mission", "open"], "types": {"open": "boolean"}, "json_only": True},
        ),
        (
            "cap0-json-02",
            1,
            "Return JSON only: keys ok (boolean), remaining (number). ok=true, remaining=3.",
            {"required_keys": ["ok", "remaining"], "types": {"ok": "boolean", "remaining": "number"}, "json_only": True},
        ),
        (
            "cap0-json-03",
            2,
            "JSON only. Keys: vessel, berth, delayed. vessel is 'osprey', berth is 9 as number, delayed is true.",
            {"required_keys": ["vessel", "berth", "delayed"], "types": {"berth": "number", "delayed": "boolean"}, "json_only": True},
        ),
        (
            "cap0-json-04",
            2,
            "Emit one object keys label, score. label='WATCH', score=0.25. JSON only, no commentary.",
            {"required_keys": ["label", "score"], "types": {"score": "number"}, "json_only": True},
        ),
        (
            "cap0-json-05",
            3,
            "JSON only with keys claim, class, source. claim='door sealed', class='OBSERVED', source='yard-note'.",
            {"required_keys": ["claim", "class", "source"], "equals": {"class": "OBSERVED"}, "json_only": True},
        ),
        (
            "cap0-json-06",
            3,
            "JSON only keys a,b,c all numbers: a=1,b=2,c=3.",
            {"required_keys": ["a", "b", "c"], "types": {"a": "number", "b": "number", "c": "number"}, "json_only": True},
        ),
        (
            "cap0-json-07",
            1,
            "JSON only: {\"ready\": false, \"reason\": \"no-source\"} with those keys.",
            {"required_keys": ["ready", "reason"], "types": {"ready": "boolean"}, "json_only": True},
        ),
        (
            "cap0-json-08",
            2,
            "Return JSON only keys training, evaluation, promotion all booleans false,false,false.",
            {"required_keys": ["training", "evaluation", "promotion"], "equals": {"training": False, "evaluation": False, "promotion": False}, "json_only": True},
        ),
        (
            "cap0-json-09",
            3,
            "JSON only. Nested allowed: meta.kind must be 'card' and meta.n must be 2. Also top-level id='e9'.",
            {"required_keys": ["id", "meta"], "json_only": True, "nested": {"meta.kind": "card", "meta.n": 2}},
        ),
        (
            "cap0-json-10",
            2,
            "JSON only keys path and exists. path='/tmp/none', exists=false.",
            {"required_keys": ["path", "exists"], "types": {"exists": "boolean"}, "json_only": True},
        ),
    ]
    for eid, level, prompt, expected in json_items:
        items.append(
            _eval_item(
                eval_id=eid,
                family="EVAL-JSON",
                capability_ids=["CAP-03"],
                level=level,
                prompt=prompt,
                scorer="json-schema",
                expected=expected,
                wrim0_support="SUPPORTED",
                notes="Structured generation, not metadata-dump completion.",
            )
        )

    code = [
        ("cap0-code-01", 1, "Write a complete Python function named cap_mul(a: int, b: int) -> int that returns a*b. Code only.", "python-exec", {"fn": "cap_mul", "tests": [[[2, 3], 6], [[0, 4], 0]]}),
        ("cap0-code-02", 1, "Write complete Python named is_blank(s: str) -> bool, True when s.strip() is empty. Code only.", "python-exec", {"fn": "is_blank", "tests": [[["  "], True], [["x"], False]]}),
        ("cap0-code-03", 2, "Complete Python: def starts_json(s: str) -> bool: true if stripped s starts with '{'.", "python-exec", {"fn": "starts_json", "tests": [[["{}"], True], [["no"], False]]}),
        ("cap0-code-04", 2, "Python function named triple(n: int) -> int returning n*3. Code only.", "python-exec", {"fn": "triple", "tests": [[[5], 15]]}),
        ("cap0-code-05", 3, "Python function named pick_class(text: str) -> str returning 'UNKNOWN' if 'silent' in text else 'OBSERVED'.", "python-exec", {"fn": "pick_class", "tests": [[["silent room"], "UNKNOWN"], [["noise"], "OBSERVED"]]}),
        ("cap0-code-06", 1, "Python syntax only: def ping() -> str: return 'pong'", "python-syntax", {"fn": "ping"}),
        ("cap0-code-07", 3, "Write Python named merge_status(a: str, b: str) -> str that returns 'CONFLICT' if a!=b else a.", "python-exec", {"fn": "merge_status", "tests": [[["A", "B"], "CONFLICT"], [["A", "A"], "A"]]}),
        ("cap0-code-08", 2, "Python named count_keys(d: dict) -> int returning len(d). Code only.", "python-exec", {"fn": "count_keys", "tests": [[{"x": 1}, 1]]}),
    ]
    # fix tests encoding for dict arg
    code[7] = (
        "cap0-code-08",
        2,
        "Python named count_keys(d: dict) -> int returning len(d). Code only.",
        "python-exec",
        {"fn": "count_keys", "tests": [[[{"x": 1}], 1]]},
    )
    for eid, level, prompt, scorer, expected in code:
        items.append(
            _eval_item(
                eval_id=eid,
                family="EVAL-CODE",
                capability_ids=["CAP-04"],
                level=level,
                prompt=prompt,
                scorer=scorer,
                expected=expected,
                wrim0_support="SUPPORTED",
                notes="Simple generation/completion; independent of train function names.",
            )
        )

    wr = [
        ("cap0-wr-01", 1, "One word plus a period: who is the human approval role?", "exact-contains", {"any": ["Commander", "COMMANDER"]}),
        ("cap0-wr-02", 1, "True or false in a sentence: a checkpoint is a promotion.", "exact-contains", {"any": ["false", "False", "not"]}),
        ("cap0-wr-03", 2, "Someone saved weights and wants them in production tonight. Name the missing decision.", "exact-contains", {"any": ["promotion", "COMMANDER", "Commander"]}),
        ("cap0-wr-04", 2, "Paraphrase: the multi-model group advises but does not command. Which term?", "exact-contains", {"any": ["COUNCIL", "Council"]}),
        ("cap0-wr-05", 3, "A job has no stop rule and no evidence list. Which term is being violated?", "exact-contains", {"any": ["MISSION", "mission"]}),
        ("cap0-wr-06", 1, "What label means no observation is in scope, as distinct from numeric zero?", "exact-contains", {"any": ["NO_COVERAGE", "no coverage", "NO COVERAGE"]}),
        ("cap0-wr-07", 3, "Apply: intern treats eval prompts as training text. Which activity was violated?", "exact-contains", {"any": ["evaluation", "held-out", "leak"]}),
        ("cap0-wr-08", 2, "Is APPROVAL optional for gated payment-like actions? Answer with a clause.", "exact-contains", {"any": ["not optional", "required", "not"]}),
        ("cap0-wr-09", 1, "Name the trace of how a datum was obtained.", "exact-contains", {"any": ["PROVENANCE", "provenance"]}),
        ("cap0-wr-10", 2, "CONFIDENCE 0.99 with empty SOURCE. What is wrong in one sentence?", "exact-contains", {"any": ["SOURCE", "source", "evidence"]}),
        ("cap0-wr-11", 3, "Map this: optimizer is idle, a file of weights exists, no Commander memo. Fill training/evaluation/promotion as words.", "exact-contains", {"any": ["training"]}),
        ("cap0-wr-12", 1, "What is UNKNOWN for in epistemic labeling?", "exact-contains", {"any": ["not established", "evidence", "UNKNOWN"]}),
    ]
    for eid, level, prompt, scorer, expected in wr:
        items.append(
            _eval_item(
                eval_id=eid,
                family="EVAL-WR",
                capability_ids=["CAP-05"],
                level=level,
                prompt=prompt,
                scorer=scorer,
                expected=expected,
                wrim0_support="SUPPORTED",
                notes="Unseen paraphrases of native terms; not constitution recitation of storage-is-not-learning.",
            )
        )

    evid = [
        ("cap0-ev-01", 1, "CLASS=? first token after CLASS=. A single attached log says the door is sealed.", "class-label", {"class": "OBSERVED"}),
        ("cap0-ev-02", 1, "CLASS=? No file is attached and the user wants a coordinate.", "class-label", {"class": "NO_COVERAGE"}),
        ("cap0-ev-03", 2, "CLASS=? Two logs disagree on a time; user wants the true time.", "class-label", {"class": "UNKNOWN"}),
        ("cap0-ev-04", 2, "CLASS=? You conclude rain caused a delay though logs never mention rain.", "class-label", {"class": "INFERENCE"}),
        ("cap0-ev-05", 3, "Harbor note lists fog. User asks if the captain was negligent. CLASS=?", "class-label", {"class": "UNKNOWN"}),
        ("cap0-ev-06", 3, "Tool printed a hash prefix. User asks what the original poem meant. CLASS for the meaning?", "class-label", {"class": "UNKNOWN"}),
        ("cap0-ev-07", 1, "CLASS=? Attached telemetry says pump running.", "class-label", {"class": "OBSERVED"}),
        ("cap0-ev-08", 2, "User wants 0.0 fill-in because the sensor is missing. CLASS=?", "class-label", {"class": "NO_COVERAGE"}),
        ("cap0-ev-09", 3, "Source named, confidence copied from a template. CLASS for the confidence number as truth?", "class-label", {"class": "INFERENCE"}),
        ("cap0-ev-10", 1, "First line CLASS= for empty provenance and a requested URL citation.", "class-label", {"class": "UNKNOWN"}),
        ("cap0-ev-11", 2, "Logs match on a crest height. CLASS for that height?", "class-label", {"class": "OBSERVED"}),
        ("cap0-ev-12", 3, "Apply: story invented to connect two timestamps. CLASS for the story?", "class-label", {"class": "INFERENCE"}),
    ]
    for eid, level, prompt, scorer, expected in evid:
        prompt_full = (
            "Reply with CLASS=<LABEL> on the first line. Labels: OBSERVED, INFERENCE, UNKNOWN, NO_COVERAGE.\n"
            + prompt
        )
        items.append(
            _eval_item(
                eval_id=eid,
                family="EVAL-EVIDENCE",
                capability_ids=["CAP-06", "CAP-07"],
                level=level,
                prompt=prompt_full,
                scorer=scorer,
                expected=expected,
                wrim0_support="SUPPORTED",
                notes="Applied classification, not dictionary recitation.",
            )
        )

    tools = [
        ("cap0-tool-01", 1, "Use sha256 on local phrase 'harbor-quay-lamp'. Emit <tool_call> JSON.", "tool-call", {"tool": "sha256", "arguments": {"text": "harbor-quay-lamp"}}),
        ("cap0-tool-02", 1, "Read note NOTE-ZX-11 with lookup_note.", "tool-call", {"tool": "lookup_note", "arguments": {"note_id": "NOTE-ZX-11"}}),
        ("cap0-tool-03", 2, "User asks the capital of a fictional county with no tool that searches the web. Choose none.", "tool-call", {"tool": "none"}),
        ("cap0-tool-04", 2, "Previous curl failed. Hash 'after-curl-failure' with sha256.", "tool-call", {"tool": "sha256", "arguments": {"text": "after-curl-failure"}}),
        ("cap0-tool-05", 3, "Need a hash of 'composition-token' then stop. Only the tool_call.", "tool-call", {"tool": "sha256", "arguments": {"text": "composition-token"}}),
        ("cap0-tool-06", 1, "lookup_note for NOTE-QQ-02.", "tool-call", {"tool": "lookup_note", "arguments": {"note_id": "NOTE-QQ-02"}}),
        ("cap0-tool-07", 3, "The question is 'hello'. No tool required.", "tool-call", {"tool": "none"}),
        ("cap0-tool-08", 2, "Hash 'eval-not-train' using sha256. Do not execute.", "tool-call", {"tool": "sha256", "arguments": {"text": "eval-not-train"}}),
        ("cap0-tool-09", 1, "Refuse inventing curl. If you must pick a listed tool for a local hash of 'stay-local', use sha256.", "tool-call", {"tool": "sha256", "arguments": {"text": "stay-local"}}),
        ("cap0-tool-10", 3, "lookup_note NOTE-AA-99 because the user asked to open that id.", "tool-call", {"tool": "lookup_note", "arguments": {"note_id": "NOTE-AA-99"}}),
    ]
    schema_prefix = "Listed tools: sha256(text), lookup_note(note_id), none.\n"
    for eid, level, prompt, scorer, expected in tools:
        items.append(
            _eval_item(
                eval_id=eid,
                family="EVAL-TOOL",
                capability_ids=["CAP-08"],
                level=level,
                prompt=schema_prefix + prompt,
                scorer=scorer,
                expected=expected,
                wrim0_support="SUPPORTED",
                notes="Understanding of next action representation; not live execution.",
            )
        )

    corr = [
        ("cap0-cor-01", 1, "You previously said 9.2 m. The only note says 1.1 m. Correct in two sentences.", "exact-contains", {"all": ["1.1"]}),
        ("cap0-cor-02", 2, "You picked a winner between 09:00 and 21:00 with no verifier. Fix the claim class.", "class-label", {"class": "UNKNOWN"}),
        ("cap0-cor-03", 2, "You repeated a failed curl. Next output must be a sha256 tool_call for 'stop-curl'.", "tool-call", {"tool": "sha256", "arguments": {"text": "stop-curl"}}),
        ("cap0-cor-04", 1, "Withdraw a fabricated person of interest. State what remains known.", "exact-contains", {"any": ["UNKNOWN", "withdraw"]}),
        ("cap0-cor-05", 3, "Prior JSON had commentary. Emit JSON only keys fixed (boolean true) and prior (string 'prose').", "json-schema", {"required_keys": ["fixed", "prior"], "equals": {"fixed": True}, "json_only": True}),
        ("cap0-cor-06", 3, "Keep the known-good fact that the gate was locked; drop the guessed motive.", "exact-contains", {"any": ["locked", "gate"]}),
        ("cap0-cor-07", 1, "Say you were wrong about promotion. Training never started.", "exact-contains", {"any": ["not", "never", "false"]}),
        ("cap0-cor-08", 2, "Missing evidence was treated as zero. Name the correct class.", "class-label", {"class": "NO_COVERAGE"}),
    ]
    for row in corr:
        eid, level, prompt, scorer, expected = row
        if scorer == "class-label":
            prompt = "Reply with CLASS=<LABEL> on the first line.\n" + prompt
        items.append(
            _eval_item(
                eval_id=eid,
                family="EVAL-CORRECTION",
                capability_ids=["CAP-09"],
                level=level,
                prompt=prompt,
                scorer=scorer,
                expected=expected,
                wrim0_support="SUPPORTED",
                notes="Synthetic failure handling eval; not labeled as Commander corrections.",
            )
        )

    retention = [
        ("cap0-ret-01", 1, "Continue literary English: The small parlour was empty, except for a needle-book left on the sill, and"),
        ("cap0-ret-02", 1, "Continue: Rain stitched the windows of the coaching inn while the horses"),
        ("cap0-ret-03", 2, "In complete sentences, continue a quiet domestic evening by the fire, without bullet lists."),
        ("cap0-ret-04", 2, "Continue this period-neutral prose: She folded the letter twice before she trusted herself to"),
        ("cap0-ret-05", 3, "Write four coherent sentences of ordinary narrative about walking a muddy lane at dusk."),
        ("cap0-ret-06", 1, "Continue: The clock in the hall had a habit of gathering silence after each strike, as if"),
    ]
    for eid, level, prompt in retention:
        items.append(
            _eval_item(
                eval_id=eid,
                family="EVAL-RETENTION",
                capability_ids=["CAP-01", "CAP-10"],
                level=level,
                prompt=prompt,
                scorer="language-diagnostics",
                expected={"min_unique_ratio": 0.35, "forbid_single_punct": True},
                wrim0_support="SUPPORTED",
                notes="Retention-style prose not copied from Wave 8.1 Alice prompt.",
            )
        )

    family_counts = Counter(i["family"] for i in items)
    return {
        "suite_id": EVAL_ID,
        "EXCLUDE_FROM_TRAINING": True,
        "lineage_status": LINEAGE_STATUS,
        "kind": "CAPABILITY_HELDOUT",
        "held_out": True,
        "not_a_collapse_diagnostic": True,
        "wave81_reuse_forbidden": True,
        "item_count": len(items),
        "family_counts": dict(family_counts),
        "items": items,
    }


def extract_assistant_target(rendered: str) -> str:
    marker = "<|assistant|>"
    if marker not in rendered:
        return ""
    after = rendered.split(marker, 1)[1]
    after = after.replace("<|eos|>", "").strip()
    return after


def token_counts_for_example(tokenizer, ex: dict[str, Any]) -> dict[str, int]:
    rendered = ex["renderedTrainingText"]
    ids = tokenizer.encode(rendered).ids
    assistant_id = tokenizer.token_to_id("<|assistant|>")
    mask = [0] * len(ids)
    try:
        apos = ids.index(assistant_id)
        for i in range(len(ids)):
            if i > apos:
                mask[i] = 1
    except ValueError:
        mask = [1] * len(ids)
    return {
        "unit_tokens": len(ids),
        "prompt_tokens": int(sum(1 for m in mask if m == 0)),
        "target_tokens": int(sum(mask)),
        "assistant_present": int(assistant_id in ids) if assistant_id is not None else 0,
        "tool_json_before_assistant": int("<|tool|>" in rendered.split("<|assistant|>")[0] if "<|assistant|>" in rendered else False),
    }


def account_training(examples: list[dict[str, Any]], tokenizer) -> dict[str, Any]:
    by_family: dict[str, dict[str, int]] = defaultdict(lambda: {"examples": 0, "prompt_tokens": 0, "target_tokens": 0, "unit_tokens": 0})
    mask_ok = 0
    mask_bad = 0
    tool_masked_wrong = 0
    habit = 0
    for ex in examples:
        tc = token_counts_for_example(tokenizer, ex)
        fam = ex["capability_family"]
        by_family[fam]["examples"] += 1
        by_family[fam]["prompt_tokens"] += tc["prompt_tokens"]
        by_family[fam]["target_tokens"] += tc["target_tokens"]
        by_family[fam]["unit_tokens"] += tc["unit_tokens"]
        if tc["assistant_present"] and tc["target_tokens"] > 0:
            mask_ok += 1
        else:
            mask_bad += 1
        if tc["tool_json_before_assistant"]:
            tool_masked_wrong += 1
        if FORBIDDEN_HABIT.match(str(ex.get("response", "")).strip()):
            habit += 1
    totals = {
        "examples": len(examples),
        "prompt_tokens": sum(v["prompt_tokens"] for v in by_family.values()),
        "target_tokens": sum(v["target_tokens"] for v in by_family.values()),
        "unit_tokens": sum(v["unit_tokens"] for v in by_family.values()),
    }
    commander_corrections = sum(1 for ex in examples if ex["provenance"].get("commander_correction"))
    terra = sum(1 for ex in examples if "terra" in ex["capability_ids"] or "terra" in ex["capability_family"])
    return {
        "by_family": dict(by_family),
        "totals": totals,
        "mask_ok_examples": mask_ok,
        "mask_bad_examples": mask_bad,
        "tool_json_before_assistant_count": tool_masked_wrong,
        "habit_pass_targets": habit,
        "commander_correction_count": commander_corrections,
        "terra_training_observations": terra,
        "design_floors": DESIGN_FLOORS,
    }


def floors_report(account: dict[str, Any]) -> dict[str, Any]:
    fam = account["by_family"]
    mapping = {
        "instruction_response_target": fam.get("instruction_response", {}).get("target_tokens", 0),
        "structured_json_target": fam.get("structured_json", {}).get("target_tokens", 0),
        "tool_use_target": fam.get("tool_use", {}).get("target_tokens", 0),
        "war_room_concept_target": fam.get("war_room_concepts", {}).get("target_tokens", 0),
        "evidence_uncertainty_target": fam.get("evidence_uncertainty", {}).get("target_tokens", 0),
        "correction_target": fam.get("correction_failure", {}).get("target_tokens", 0),
        "code_supervised_target": fam.get("code_supervised", {}).get("target_tokens", 0),
        "total_supervised_target": account["totals"]["target_tokens"],
    }
    checks = {}
    all_ok = True
    for key, floor in DESIGN_FLOORS.items():
        if key == "floor_kind":
            continue
        val = mapping[key]
        ok = val >= int(floor)
        checks[key] = {"actual": val, "floor": floor, "passed": ok, "kind": DESIGN_FLOORS["floor_kind"]}
        all_ok = all_ok and ok
    return {"passed": all_ok, "checks": checks}


_NEAR_STOP = {
    "a", "an", "the", "and", "or", "to", "of", "in", "on", "for", "with", "that", "this",
    "is", "are", "be", "as", "at", "by", "from", "not", "no", "yes", "only", "code",
    "write", "complete", "python", "function", "named", "returns", "return", "json",
    "keys", "key", "boolean", "number", "string", "reply", "first", "line", "class",
    "tool", "tools", "sha256", "lookup_note", "none", "emit", "use", "using", "do",
    "one", "two", "sentence", "sentences", "true", "false", "must", "should", "when",
    "asked", "user", "commander", "war", "room", "format", "object",
}


def leak_scan(train_examples: list[dict[str, Any]], eval_suite: dict[str, Any], extra_texts: list[str] | None = None) -> dict[str, Any]:
    items = eval_suite["items"]
    train_blobs = []
    train_prompts = []
    train_responses = []
    for ex in train_examples:
        train_blobs.append(ex["renderedTrainingText"])
        train_prompts.append(ex["input"])
        train_responses.append(str(ex["response"]))
    if extra_texts:
        train_blobs.extend(extra_texts)

    exact_prompt = []
    norm_prompt = []
    response_hits = []
    substring_hits = []
    template_hits = []
    near = []

    train_prompt_set = set(train_prompts)
    train_norm = {normalize_prompt(p) for p in train_prompts}
    train_resp_set = set(train_responses)
    blob = "\n".join(train_blobs)

    for item in items:
        p = item["prompt"]
        if p in train_prompt_set or p in blob:
            exact_prompt.append(item["evalId"])
        if normalize_prompt(p) in train_norm:
            norm_prompt.append(item["evalId"])
        for phrase in distinctive_phrases(p, 40):
            if phrase in blob:
                substring_hits.append({"evalId": item["evalId"], "phrase": phrase[:80]})
                break
        exp = item.get("expected") or {}
        if isinstance(exp, dict) and exp.get("arguments"):
            dumped = json.dumps(exp["arguments"], ensure_ascii=True)
            if dumped in blob and dumped not in ("{}",):
                # argument values reused — flag only if the distinctive eval phrase also matches tool text
                if any(v for v in exp["arguments"].values() if isinstance(v, str) and len(str(v)) >= 12 and str(v) in blob):
                    template_hits.append(item["evalId"])

    # response match: eval expected strings that equal a full train response
    for item in items:
        exp = item.get("expected")
        if isinstance(exp, str) and exp in train_resp_set:
            response_hits.append(item["evalId"])

    def tokens(s: str) -> set[str]:
        return {t for t in re.findall(r"[a-z0-9_]+", normalize_prompt(s)) if t not in _NEAR_STOP and len(t) > 2}

    train_tok = [(ex["exampleId"], tokens(ex["input"])) for ex in train_examples]
    for item in items:
        et = tokens(item["prompt"])
        if len(et) < 5:
            continue
        for tid, tt in train_tok:
            if len(tt) < 5:
                continue
            shared = et & tt
            if len(shared) < 4:
                continue
            j = len(shared) / max(1, len(et | tt))
            if j >= 0.55:
                near.append({"evalId": item["evalId"], "trainId": tid, "jaccard": round(j, 3), "shared": sorted(shared)[:8]})

    hits = {
        "exact_prompt_matches": sorted(set(exact_prompt)),
        "normalized_prompt_matches": sorted(set(norm_prompt)),
        "response_matches": sorted(set(response_hits)),
        "substring_collisions": substring_hits,
        "template_collisions": sorted(set(template_hits)),
        "near_duplicate_pairs": near,
    }
    known = (
        len(hits["exact_prompt_matches"])
        + len(hits["normalized_prompt_matches"])
        + len(hits["substring_collisions"])
        + len(hits["near_duplicate_pairs"])
    )
    return {
        "known_eval_leakage": known,
        "passed": known == 0,
        "details": hits,
        "rule": "Training must not start if known eval leakage > 0.",
    }


def score_output(item: dict[str, Any], output: str) -> dict[str, Any]:
    scorer = item["objectiveScorer"]
    expected = item.get("expected") or {}
    text = output or ""
    stripped = text.strip()
    details: dict[str, Any] = {"scorer": scorer}

    def fail(reason: str) -> dict[str, Any]:
        return {"evalId": item["evalId"], "score": 0.0, "pass": False, "reason": reason, **details}

    def ok(reason: str = "ok") -> dict[str, Any]:
        return {"evalId": item["evalId"], "score": 1.0, "pass": True, "reason": reason, **details}

    if scorer == "language-diagnostics":
        ids_proxy = stripped.split()
        unique_ratio = (len(set(ids_proxy)) / len(ids_proxy)) if ids_proxy else 0.0
        collapsed = stripped in {".", "|", "_", ""} or len(set(stripped.replace(" ", ""))) <= 1
        details["unique_word_ratio"] = round(unique_ratio, 3)
        details["collapsed"] = collapsed
        details["n_chars"] = len(stripped)
        min_u = float(expected.get("min_unique_ratio", 0.35))
        passed = (not collapsed) and unique_ratio >= min_u and len(stripped) >= 20
        base = ok("language") if passed else fail("language-poor")
        base["pass"] = passed
        base["score"] = 1.0 if passed else 0.0
        return base

    if scorer == "exact-contains":
        low = text
        if expected.get("all"):
            if not all(s in low for s in expected["all"]):
                return fail("missing required substring")
        if expected.get("any"):
            if not any(s in low for s in expected["any"]):
                return fail("missing any-of substring")
        return ok()

    if scorer == "forbid-tokens":
        for tok in expected.get("forbid") or []:
            if re.search(rf"\b{re.escape(tok)}\b", text):
                return fail(f"forbidden {tok}")
        if len(stripped) < 8:
            return fail("too short")
        return ok()

    if scorer == "regex":
        if re.search(expected.get("pattern") or "", text, re.M):
            return ok()
        return fail("regex")

    if scorer == "class-label":
        m = re.search(r"CLASS\s*=\s*([A-Z_]+)", text)
        label = m.group(1) if m else ""
        details["parsed_class"] = label
        if label == expected.get("class"):
            return ok()
        return fail(f"class {label!r}")

    if scorer == "json-schema":
        candidate = stripped
        # strip fences
        candidate = re.sub(r"^```(?:json)?", "", candidate).strip()
        candidate = re.sub(r"```$", "", candidate).strip()
        if expected.get("json_only"):
            if not candidate.startswith("{") or not candidate.endswith("}"):
                return fail("prose-around-json")
        try:
            parsed = json.loads(candidate)
        except Exception:
            return fail("unparseable")
        if not isinstance(parsed, dict):
            return fail("not-object")
        for k in expected.get("required_keys") or []:
            if k not in parsed:
                return fail(f"missing key {k}")
        types = expected.get("types") or {}
        for k, t in types.items():
            v = parsed.get(k)
            if t == "boolean" and not isinstance(v, bool):
                return fail(f"type {k}")
            if t == "number" and (isinstance(v, bool) or not isinstance(v, (int, float))):
                return fail(f"type {k}")
            if t == "string" and not isinstance(v, str):
                return fail(f"type {k}")
        for k, val in (expected.get("equals") or {}).items():
            if parsed.get(k) != val:
                return fail(f"value {k}")
        for path, val in (expected.get("nested") or {}).items():
            cur: Any = parsed
            for part in path.split("."):
                if not isinstance(cur, dict) or part not in cur:
                    return fail(f"nested {path}")
                cur = cur[part]
            if cur != val:
                return fail(f"nested value {path}")
        return ok()

    if scorer == "tool-call":
        m = re.search(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", text, re.S)
        if not m:
            # bare json
            m2 = re.search(r"\{[^{}]*\"tool\"[^{}]*\}", text, re.S)
            raw = m2.group(0) if m2 else ""
        else:
            raw = m.group(1)
        try:
            parsed = json.loads(raw)
        except Exception:
            return fail("tool-unparseable")
        details["parsed"] = parsed
        if parsed.get("tool") != expected.get("tool"):
            return fail("tool-name")
        args = parsed.get("arguments") or {}
        for k, v in (expected.get("arguments") or {}).items():
            if args.get(k) != v:
                return fail(f"arg {k}")
        return ok()

    if scorer in ("python-syntax", "python-exec"):
        code = text
        code = re.sub(r"^```(?:python)?", "", code.strip())
        code = re.sub(r"```$", "", code.strip())
        fn = expected.get("fn")
        if fn and f"def {fn}" not in code:
            return fail("missing-def")
        try:
            compiled = compile(code, "<eval>", "exec")
        except SyntaxError as exc:
            return fail(f"syntax {exc}")
        if scorer == "python-syntax":
            return ok()
        ns: dict[str, Any] = {}
        try:
            exec(compiled, ns, ns)  # noqa: S102 — bounded eval of model-proposed tiny functions
        except Exception as exc:
            return fail(f"exec {exc}")
        func = ns.get(fn)
        if not callable(func):
            return fail("not-callable")
        for args, want in expected.get("tests") or []:
            try:
                got = func(*args)
            except Exception as exc:
                return fail(f"test {exc}")
            if got != want:
                return fail(f"want {want!r} got {got!r}")
        return ok()

    return fail("unknown-scorer")


def capability_registry() -> list[dict[str, Any]]:
    return [
        {
            "capability_id": "CAP-01",
            "name": "Natural-language continuation",
            "priority": "P0",
            "description": "Produce coherent English continuation without punctuation/symbol collapse.",
            "why_it_matters": "WRIM-0 is a small LM; WRIM-1.1 must keep that core while mixing domains.",
            "training_signal": "WR-CORPUS-0 rehearsal + quality prose leftovers; not status-report boilerplate.",
            "evaluation_method": "EVAL-LANG + EVAL-RETENTION language-diagnostics (unique ratio, collapse flags).",
            "wrim0_baseline_method": "Same prompts, greedy decode, freeze checkpoint-final.",
            "success_evidence": "Higher unique-ratio / fewer collapsed gens than WRIM-0 on held-out prose without 13-probe worsening.",
            "regression_evidence": "Unique-ratio < 0.5× WRIM-0 or suite-wide '.'/'|' loops.",
        },
        {
            "capability_id": "CAP-02",
            "name": "Instruction → direct response",
            "priority": "P0",
            "description": "Map a request to a diverse, context-correct answer rather than 'pass'.",
            "why_it_matters": "Current 31 examples teach a pass habit; 339 target tokens cannot move this.",
            "training_signal": "Supervised instruction family with gradient on assistant span; diverse targets.",
            "evaluation_method": "EVAL-INSTRUCT exact/regex/forbid-token scorers, levels 1–3.",
            "wrim0_baseline_method": "Same protocol on WRIM-0.",
            "success_evidence": "Material lift vs WRIM-0 on held-out instruction items (not train clones).",
            "regression_evidence": "Collapse to pass/ack or empty punctuation.",
        },
        {
            "capability_id": "CAP-03",
            "name": "Structured JSON generation",
            "priority": "P0",
            "description": "Instruction → valid JSON with required keys and types; JSON-only when asked.",
            "why_it_matters": "Hash-dump LM is not useful structured generation; WRIM-0 JSON probe already fails.",
            "training_signal": "JSON cards with assistant-span objects, not random metadata shards as the teacher.",
            "evaluation_method": "EVAL-JSON parse / keys / types / json_only.",
            "wrim0_baseline_method": "Same JSON items on WRIM-0.",
            "success_evidence": "More parseable schema matches than WRIM-0.",
            "regression_evidence": "All items unparseable plus language collapse.",
        },
        {
            "capability_id": "CAP-04",
            "name": "Simple code generation",
            "priority": "P1",
            "description": "Emit small complete functions that parse and, where specified, pass tiny tests.",
            "why_it_matters": "Useful native skill; leftover inventory is code-heavy but low quality.",
            "training_signal": "Supervised complete functions + quality-filtered code LM; deprioritize locks/minified/migrations.",
            "evaluation_method": "EVAL-CODE syntax/exec.",
            "wrim0_baseline_method": "Same items on WRIM-0.",
            "success_evidence": "Any exec pass lift vs WRIM-0 on held-out names.",
            "regression_evidence": "Tokenizer-loop non-code plus instruction regression.",
        },
        {
            "capability_id": "CAP-05",
            "name": "War Room native concepts",
            "priority": "P0",
            "description": "Apply COMMANDER, COUNCIL, MISSION, APPROVAL, checkpoint/training/evaluation/promotion, etc.",
            "why_it_matters": "WRIM-1.1 should be a stronger small native WR LM before imitating the whole Council.",
            "training_signal": "Applied examples, not dumping every repo constant.",
            "evaluation_method": "EVAL-WR paraphrases and applied scenes.",
            "wrim0_baseline_method": "Same paraphrases on WRIM-0.",
            "success_evidence": "Held-out paraphrase accuracy lift.",
            "regression_evidence": "Memorized definitions only on train wording; applied items fail harder.",
        },
        {
            "capability_id": "CAP-06",
            "name": "Evidence / provenance behavior",
            "priority": "P0",
            "description": "Preserve SOURCE/PROVENANCE/CONFIDENCE; refuse empty citation invention.",
            "why_it_matters": "Doctrine is core; Wave 8.1 research targets were tiny templates.",
            "training_signal": "Scenario → labeled explanation.",
            "evaluation_method": "EVAL-EVIDENCE class labels plus provenance language checks in notes.",
            "wrim0_baseline_method": "Same scenarios.",
            "success_evidence": "Class accuracy lift vs WRIM-0.",
            "regression_evidence": "Invented URLs or forced winners.",
        },
        {
            "capability_id": "CAP-07",
            "name": "OBSERVED vs INFERENCE vs UNKNOWN vs NO_COVERAGE",
            "priority": "P0",
            "description": "Epistemic classification on scenarios.",
            "why_it_matters": "Reciting definitions is not the skill.",
            "training_signal": "CLASS= labels with explanations.",
            "evaluation_method": "EVAL-EVIDENCE exact class.",
            "wrim0_baseline_method": "Same.",
            "success_evidence": "Accuracy lift on L2/L3 items, not only L1.",
            "regression_evidence": "Always UNKNOWN or always OBSERVED.",
        },
        {
            "capability_id": "CAP-08",
            "name": "Tool-use sequence understanding",
            "priority": "P1",
            "description": "Predict next tool_call JSON (select, args, none, failure redirect). Not live execution.",
            "why_it_matters": "Old format masked tool JSON; 16 target tokens cannot teach this.",
            "training_signal": "tool_call after <|assistant|>.",
            "evaluation_method": "EVAL-TOOL tool-call scorer.",
            "wrim0_baseline_method": "Same.",
            "success_evidence": "Tool-name/arg match lift; no claim of autonomous competence.",
            "regression_evidence": "curl/external invention or always none.",
        },
        {
            "capability_id": "CAP-09",
            "name": "Failure / correction handling",
            "priority": "P2",
            "description": "Withdraw errors, keep known-good facts, avoid repeating failed actions.",
            "why_it_matters": "Real Commander corrections are 0; only synthetic/system-failure patterns exist.",
            "training_signal": "Labeled SYNTHETIC_SYSTEM_FAILURE only.",
            "evaluation_method": "EVAL-CORRECTION.",
            "wrim0_baseline_method": "Same.",
            "success_evidence": "Optional; not required for official candidate pass.",
            "regression_evidence": "Repeating failed curl; inventing Commander quotes.",
        },
        {
            "capability_id": "CAP-10",
            "name": "Longer coherent completion without repetitive collapse",
            "priority": "P0",
            "description": "Multi-sentence completions that stay lexically diverse.",
            "why_it_matters": "Recovery-007 unique-ratio fell 0.397→0.310 with no NL gain.",
            "training_signal": "Coherent prose rehearsal + quality leftovers; interleaved mix.",
            "evaluation_method": "EVAL-LANG/RETENTION plus separate 13-probe collapse diagnostic.",
            "wrim0_baseline_method": "Diagnostics + new prose prompts.",
            "success_evidence": "No unique-ratio crash; preferably improvement on new prompts.",
            "regression_evidence": "13-probe ≥6/13 or unique-ratio <0.5× parent kill line.",
        },
    ]
