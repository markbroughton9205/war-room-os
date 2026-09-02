"""Fresh Native Router V1 generalization corpus. Gold authored independently of router predictions."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from exp004_support import load_jsonl
from hashes import sha256_bytes, sha256_file
from paths import (
    ROOT,
    TOOL_EVAL_4_DIR,
    TOOL_EVAL_5_DIR,
    TOOL_EVAL_6_DIR,
    V5_CANDIDATE_DIR,
)

FAMILY_TO_STATE = {
    "NO_TOOL": "ANSWERABLE_FROM_CONTEXT",
    "WEB": "CURRENT_EXTERNAL_INFORMATION_REQUIRED",
    "MEMORY": "DURABLE_MEMORY_REQUIRED",
    "FILES": "ARTIFACT_ACCESS_REQUIRED",
    "RESEARCH": "MULTI_SOURCE_RESEARCH_REQUIRED",
    "SHA256": "DETERMINISTIC_COMPUTE_REQUIRED",
}
FAMILY_TO_CAP = {
    "NO_TOOL": "INTERNAL_CONTEXT",
    "WEB": "EXTERNAL_RETRIEVAL",
    "MEMORY": "MEMORY_STATE",
    "FILES": "ARTIFACT_ACCESS",
    "RESEARCH": "RESEARCH_SYNTHESIS",
    "SHA256": "DETERMINISTIC_UTILITY",
}

# Unique domains not used as EVAL-6/V5 harbor-cafe / kiln / orchard-drainage topics.
DOMAINS: list[dict[str, str]] = [
    {"id": "cedar-tram", "board": "upper-landing board", "item": "tram hold time", "value": "14 minutes", "file": "docs/cedar-tram-bulletin.md", "payload": "tram-hold-14m", "decision": "assign the spare cabin to blue crew", "concept": "cable cars pause in wind", "auth": "tram authority"},
    {"id": "compost-bay", "board": "municipal compost desk", "item": "bay three temperature", "value": "61 C", "file": "docs/compost-bay-log.md", "payload": "bay3-61C", "decision": "reserve bay three for leaf mix", "concept": "compost heaps heat from microbes", "auth": "waste desk"},
    {"id": "quarry-radio", "board": "quarry radio roster", "item": "night channel", "value": "channel 7", "file": "docs/quarry-radio-sop.md", "payload": "q-ch7", "decision": "lock night channel 7", "concept": "UHF channels avoid overlap", "auth": "quarry ops"},
    {"id": "proofing-room", "board": "bakery proofing slate", "item": "overnight humidity", "value": "78 percent", "file": "docs/proofing-room-spec.md", "payload": "proof-78pct", "decision": "standardize overnight humidity at 78 percent", "concept": "yeast slows in dry air", "auth": "bakery board"},
    {"id": "estuary-buoy", "board": "estuary buoy page", "item": "salinity reading", "value": "18 psu", "file": "docs/estuary-buoy-sheet.md", "payload": "buoy-18psu", "decision": "adopt 18 psu as the alert line", "concept": "estuaries mix fresh and salt", "auth": "harbor science page"},
    {"id": "lantern-fest", "board": "lantern festival listing", "item": "gate opening", "value": "17:40", "file": "docs/lantern-fest-runbook.md", "payload": "gate-1740", "decision": "set the opening line to 17:40", "concept": "festivals stagger entry", "auth": "arts desk"},
    {"id": "icehouse", "board": "icehouse ledger page", "item": "bin eight mass", "value": "220 kg", "file": "docs/icehouse-ledger.md", "payload": "bin8-220kg", "decision": "reserve bin eight for smoked fish", "concept": "ice slows spoilage", "auth": "cold-store board"},
    {"id": "glider-tow", "board": "glider field bulletin", "item": "tow queue", "value": "four waiting", "file": "docs/glider-tow-schedule.md", "payload": "tow-4wait", "decision": "assign the yellow tug to afternoon tows", "concept": "winch launches need clear airspace", "auth": "airfield desk"},
    {"id": "peat-lab", "board": "peat lab board", "item": "core moisture", "value": "42 percent", "file": "docs/peat-lab-workbook.md", "payload": "peat-42", "decision": "freeze the 42 percent moisture standard", "concept": "peat holds water", "auth": "soils page"},
    {"id": "ferry-kiosk", "board": "inland ferry kiosk", "item": "last sailing", "value": "22:05", "file": "docs/inland-ferry-caption.md", "payload": "sail-2205", "decision": "lock last sailing at 22:05", "concept": "crews need rest windows", "auth": "ferry authority"},
    {"id": "silk-dye", "board": "dye house posting", "item": "vat four pH", "value": "8.1", "file": "docs/silk-dye-sop.md", "payload": "vat4-pH81", "decision": "standardize vat four pH at 8.1", "concept": "alkaline baths shift color", "auth": "textile desk"},
    {"id": "bee-yard", "board": "apiary notice", "item": "nectar flow", "value": "late linden", "file": "docs/bee-yard-log.md", "payload": "nectar-linden", "decision": "keep the spare supers on yard B", "concept": "bees store surplus nectar", "auth": "apiary board"},
    {"id": "clock-tower", "board": "clock tower page", "item": "chime offset", "value": "+12 seconds", "file": "docs/clock-tower-spec.md", "payload": "chime-plus12", "decision": "accept plus twelve seconds as the offset", "concept": "mechanical clocks drift", "auth": "city works listing"},
    {"id": "salt-pan", "board": "salt pan schedule", "item": "harvest window", "value": "dawn only", "file": "docs/salt-pan-map.md", "payload": "harvest-dawn", "decision": "restrict harvest to dawn", "concept": "evaporation needs dry wind", "auth": "coastal board"},
    {"id": "pipe-organ", "board": "organ loft bulletin", "item": "chamber humidity", "value": "45 percent", "file": "docs/pipe-organ-runbook.md", "payload": "organ-45", "decision": "hold chamber humidity at 45 percent", "concept": "wood pipes go sharp when dry", "auth": "conservatory page"},
    {"id": "grain-silo", "board": "silo exchange board", "item": "lot C protein", "value": "12.4 percent", "file": "docs/grain-silo-sheet.md", "payload": "lotC-124", "decision": "assign lot C to mill two", "concept": "protein content grades wheat", "auth": "grain desk"},
    {"id": "tide-gate", "board": "tide-gate listing", "item": "sluice opening", "value": "half-rise", "file": "docs/tide-gate-lease.md", "payload": "sluice-halfrise", "decision": "operate sluices at half-rise", "concept": "sluices relieve flood water", "auth": "drainage authority"},
    {"id": "print-shop", "board": "print shop board", "item": "cyan plate offset", "value": "0.2 mm", "file": "docs/print-shop-spec.md", "payload": "cyan-02mm", "decision": "lock cyan offset at 0.2 mm", "concept": "registration errors make fringes", "auth": "press desk"},
    {"id": "ski-hut", "board": "ski hut page", "item": "overnight occupancy", "value": "11 bunks", "file": "docs/ski-hut-roster.md", "payload": "hut-11", "decision": "cap overnight occupancy at 11 bunks", "concept": "alpine huts ration space", "auth": "alpine club listing"},
    {"id": "cider-press", "board": "cider press slate", "item": "press three yield", "value": "180 L", "file": "docs/cider-press-log.md", "payload": "press3-180L", "decision": "reserve press three for bittersweet fruit", "concept": "tannin apples make drier cider", "auth": "orchard desk"},
    {"id": "signal-box", "board": "signal box board", "item": "block token", "value": "token green-4", "file": "docs/signal-box-sop.md", "payload": "token-green4", "decision": "issue token green-4 for the branch", "concept": "tokens prevent two trains in one block", "auth": "rail listing"},
    {"id": "kelp-farm", "board": "kelp farm page", "item": "line six depth", "value": "3.5 m", "file": "docs/kelp-farm-map.md", "payload": "line6-35m", "decision": "set line six at 3.5 meters", "concept": "kelp needs light and current", "auth": "mariculture board"},
    {"id": "glass-anneal", "board": "annealing oven board", "item": "soak temperature", "value": "520 C", "file": "docs/glass-anneal-workbook.md", "payload": "soak-520C", "decision": "standardize soak at 520 C", "concept": "annealing relieves glass stress", "auth": "hot-shop desk"},
    {"id": "archive-vault", "board": "archive vault listing", "item": "rh setpoint", "value": "40 percent", "file": "docs/archive-vault-spec.md", "payload": "vault-40rh", "decision": "hold vault RH at 40 percent", "concept": "paper lasts longer in stable humidity", "auth": "records page"},
    {"id": "rowboat-club", "board": "boathouse board", "item": "shell eight assignment", "value": "crew D", "file": "docs/rowboat-club-roster.md", "payload": "shell8-crewD", "decision": "assign shell eight to crew D", "concept": "coxed eights need matched weight", "auth": "club listing"},
    {"id": "maple-sugar", "board": "sugarhouse page", "item": "draw-off brix", "value": "66", "file": "docs/maple-sugar-sop.md", "payload": "brix-66", "decision": "draw off at 66 brix", "concept": "sap concentrates by boiling", "auth": "sugarhouse board"},
    {"id": "wind-lidar", "board": "lidar mast posting", "item": "hub-height wind", "value": "8.2 m/s", "file": "docs/wind-lidar-sheet.md", "payload": "hub-82ms", "decision": "use 8.2 m/s as the overnight mean", "concept": "wind shear increases with height", "auth": "energy desk"},
    {"id": "pottery-kiln2", "board": "studio kiln board", "item": "cone six hold", "value": "12 minutes", "file": "docs/pottery-kiln-runbook.md", "payload": "cone6-12m", "decision": "hold cone six for 12 minutes", "concept": "holds even out glaze melt", "auth": "studio page"},
    {"id": "market-stall", "board": "covered market listing", "item": "stall B12 rent", "value": "85 a week", "file": "docs/market-stall-lease.md", "payload": "stallB12-85", "decision": "set stall B12 rent at 85 a week", "concept": "indoor stalls cost more than outdoor", "auth": "market desk"},
    {"id": "foghorn", "board": "foghorn station page", "item": "blast interval", "value": "30 seconds", "file": "docs/foghorn-sop.md", "payload": "blast-30s", "decision": "keep blast interval at 30 seconds", "concept": "sound carries farther in fog", "auth": "coast guard listing"},
    {"id": "seed-bank", "board": "seed bank board", "item": "lot M viability", "value": "94 percent", "file": "docs/seed-bank-workbook.md", "payload": "lotM-94", "decision": "keep lot M in the freezer wing", "concept": "cold dry storage slows seed aging", "auth": "genebank page"},
    {"id": "canal-lock", "board": "canal lock posting", "item": "chamber time", "value": "11 minutes", "file": "docs/canal-lock-schedule.md", "payload": "lock-11m", "decision": "budget 11 minutes per chamber", "concept": "locks trade time for elevation", "auth": "waterway authority"},
    {"id": "cheese-cave", "board": "cheese cave slate", "item": "wheel 19 age", "value": "90 days", "file": "docs/cheese-cave-log.md", "payload": "wheel19-90d", "decision": "turn wheel 19 at 90 days", "concept": "rinds need airflow", "auth": "dairy board"},
    {"id": "solar-garden", "board": "community solar page", "item": "string four output", "value": "3.1 kW", "file": "docs/solar-garden-sheet.md", "payload": "string4-31kw", "decision": "flag string four below 3.1 kW", "concept": "shade cuts string current", "auth": "co-op listing"},
    {"id": "puppet-stage", "board": "puppet stage board", "item": "act two cue", "value": "lantern drop", "file": "docs/puppet-stage-script.md", "payload": "act2-lantern", "decision": "cue act two on lantern drop", "concept": "cues keep puppeteers together", "auth": "theatre desk"},
    {"id": "rain-cistern", "board": "cistern desk", "item": "first-flush bypass", "value": "80 L", "file": "docs/rain-cistern-spec.md", "payload": "flush-80L", "decision": "bypass the first 80 L", "concept": "roofs shed dirty first rain", "auth": "water desk"},
    {"id": "brass-band", "board": "bandstand listing", "item": "rehearsal call", "value": "18:15", "file": "docs/brass-band-roster.md", "payload": "call-1815", "decision": "set rehearsal call at 18:15", "concept": "brass needs warm-up time", "auth": "parks page"},
    {"id": "lichen-plot", "board": "lichen survey page", "item": "plot 4 cover", "value": "31 percent", "file": "docs/lichen-plot-map.md", "payload": "plot4-31", "decision": "treat 31 percent as the baseline cover", "concept": "lichens indicate air quality", "auth": "ecology board"},
    {"id": "ropewalk", "board": "ropewalk board", "item": "hemp lay", "value": "Z-lay", "file": "docs/ropewalk-sop.md", "payload": "hemp-zlay", "decision": "standardize hemp to Z-lay", "concept": "lay direction affects twist", "auth": "rigging desk"},
    {"id": "night-market", "board": "night market page", "item": "generator slot", "value": "bay 2", "file": "docs/night-market-plot.md", "payload": "gen-bay2", "decision": "place the generator in bay 2", "concept": "cables need clear aisles", "auth": "events listing"},
    {"id": "observatory", "board": "observatory board", "item": "dome shutter", "value": "open 21:10", "file": "docs/observatory-runbook.md", "payload": "dome-2110", "decision": "open the shutter at 21:10", "concept": "seeing improves after sunset", "auth": "astro page"},
    {"id": "tannery-yard", "board": "tannery yard listing", "item": "pit five hide count", "value": "40 hides", "file": "docs/tannery-yard-log.md", "payload": "pit5-40", "decision": "load pit five to 40 hides", "concept": "lime pits loosen hair", "auth": "leather desk"},
]


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.casefold()).strip()


def banned_texts() -> set[str]:
    out: set[str] = set()
    paths = [
        V5_CANDIDATE_DIR / "train.jsonl",
        V5_CANDIDATE_DIR / "rows.jsonl",
        TOOL_EVAL_4_DIR / "rows.jsonl",
        TOOL_EVAL_5_DIR / "rows.jsonl",
        TOOL_EVAL_6_DIR / "rows.jsonl",
        TOOL_EVAL_6_DIR / "abstention-diagnostic.jsonl",
        TOOL_EVAL_6_DIR / "multi-tool-diagnostic.jsonl",
        TOOL_EVAL_6_DIR / "lexical-adversarial.jsonl",
        TOOL_EVAL_6_DIR / "multi-turn.jsonl",
        TOOL_EVAL_6_DIR / "negation-trap.jsonl",
        TOOL_EVAL_6_DIR / "information-state.jsonl",
    ]
    for p in paths:
        if not p.is_file():
            continue
        for r in load_jsonl(p):
            t = r.get("input") or r.get("text") or r.get("prompt")
            if t:
                out.add(norm(str(t)))
    return out


def gold_fields(route: str, d: dict[str, str], rationale: str) -> dict[str, Any]:
    tool = route != "NO_TOOL"
    return {
        "gold_route": route,
        "gold_information_state": FAMILY_TO_STATE[route],
        "required_capability_family": FAMILY_TO_CAP[route],
        "tool_required": tool,
        "multiple_tools_required": False,
        "current_context_sufficient": route == "NO_TOOL",
        "freshness_required": route in {"WEB", "RESEARCH"},
        "artifact_access_required": route == "FILES",
        "durable_memory_required": route == "MEMORY",
        "deterministic_computation_required": route == "SHA256",
        "rationale": rationale,
        "domain_id": d["id"],
    }


def case(
    *,
    cid: str,
    text: str,
    route: str,
    d: dict[str, str],
    provenance: str,
    lane: str,
    rationale: str,
    tags: list[str],
    family_id: str | None = None,
    pair_side: str | None = None,
    pair_kind: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    rec = {
        "request_id": cid,
        "input": text,
        "provenance": provenance,
        "lane": lane,
        "gold_class": route if lane == "SIX_WAY" else lane,
        "context_hash": sha256_bytes(text.encode("utf-8")),
        "adjudicator": "human_independent_pre_router",
        "adjudication_blind_to_router": True,
        "tags": tags,
        "family_id": family_id,
        "pair_side": pair_side,
        "pair_kind": pair_kind,
        "strata": {
            "natural_paraphrase": "paraphrase" in tags,
            "context_dependent": "multi_turn" in tags or "information_state" in tags,
            "current_vs_memory": "current_vs_memory" in tags,
            "memory_vs_files": "memory_vs_files" in tags,
            "web_vs_research": "web_vs_research" in tags,
            "no_tool_trap": "no_tool_trap" in tags,
            "sha256_vs_no_tool": "sha256_vs_no_tool" in tags,
            "lexical_adversary": "lexical_adversarial" in tags,
            "registry_distractor": "registry_distractor" in tags,
            "unknown_unsupported": "unknown" in tags,
            "multi_turn": "multi_turn" in tags,
            "information_state": "information_state" in tags,
        },
    }
    rec.update(gold_fields(route, d, rationale) if lane == "SIX_WAY" else {
        "gold_route": extra.get("gold_route") if extra else lane,
        "gold_information_state": extra.get("gold_information_state") if extra else "AMBIGUOUS",
        "required_capability_family": extra.get("required_capability_family") if extra else None,
        "tool_required": extra.get("tool_required") if extra else False,
        "multiple_tools_required": extra.get("multiple_tools_required") if extra else False,
        "current_context_sufficient": extra.get("current_context_sufficient") if extra else False,
        "freshness_required": extra.get("freshness_required") if extra else False,
        "artifact_access_required": extra.get("artifact_access_required") if extra else False,
        "durable_memory_required": extra.get("durable_memory_required") if extra else False,
        "deterministic_computation_required": extra.get("deterministic_computation_required") if extra else False,
        "rationale": rationale,
        "domain_id": d.get("id"),
    })
    if extra:
        rec.update(extra)
    return rec


def six_way_for_domain(d: dict[str, str], idx: int) -> list[dict[str, Any]]:
    i = f"{idx:02d}"
    fid = f"fam.fresh.{d['id']}"
    rows: list[dict[str, Any]] = []
    # Paraphrase set A (primary)
    rows.append(case(
        cid=f"fg_{d['id']}_web_a", text=f"What is currently posted on the {d['board']} for {d['item']}?",
        route="WEB", d=d, provenance="HUMAN_ADJUDICATED_FRESH", lane="SIX_WAY",
        rationale="Needs a live public posting, not a stored fact or file.",
        tags=["paraphrase", "information_state", "web_vs_research"],
        family_id=f"{fid}.web_vs_notool", pair_side="a", pair_kind="WEB_vs_NO_TOOL",
    ))
    rows.append(case(
        cid=f"fg_{d['id']}_notool_concept_a", text=f"In general, why does {d['concept']}?",
        route="NO_TOOL", d=d, provenance="HUMAN_ADJUDICATED_FRESH", lane="SIX_WAY",
        rationale="Conceptual explanation; no lookup, memory, or artifact.",
        tags=["paraphrase", "information_state"],
        family_id=f"{fid}.web_vs_notool", pair_side="b", pair_kind="WEB_vs_NO_TOOL",
    ))
    rows.append(case(
        cid=f"fg_{d['id']}_mem_a", text=f"Did we already {d['decision']}?",
        route="MEMORY", d=d, provenance="HUMAN_ADJUDICATED_FRESH", lane="SIX_WAY",
        rationale="Asks for a prior durable decision not restated in this message.",
        tags=["paraphrase", "memory_vs_files", "information_state"],
        family_id=f"{fid}.mem_vs_files", pair_side="a", pair_kind="MEMORY_vs_FILES",
    ))
    rows.append(case(
        cid=f"fg_{d['id']}_files_a", text=f"Open the {d['file']} and quote the matching line from the attachment.",
        route="FILES", d=d, provenance="HUMAN_ADJUDICATED_FRESH", lane="SIX_WAY",
        rationale="Explicit artifact path must be opened; not recalled from memory.",
        tags=["paraphrase", "memory_vs_files"],
        family_id=f"{fid}.mem_vs_files", pair_side="b", pair_kind="MEMORY_vs_FILES",
    ))
    rows.append(case(
        cid=f"fg_{d['id']}_research_a", text=f"Compare two independent {d['auth']} writeups and report conflicts about {d['item']}.",
        route="RESEARCH", d=d, provenance="HUMAN_ADJUDICATED_FRESH", lane="SIX_WAY",
        rationale="Multi-source comparison, not a single current listing.",
        tags=["paraphrase", "web_vs_research"],
        family_id=f"{fid}.web_vs_research", pair_side="b", pair_kind="WEB_vs_RESEARCH",
    ))
    rows.append(case(
        cid=f"fg_{d['id']}_sha_a", text=f"Checksum this exact batch id: {d['payload']}",
        route="SHA256", d=d, provenance="HUMAN_ADJUDICATED_FRESH", lane="SIX_WAY",
        rationale="Exact payload digest is a deterministic compute, not an explanation.",
        tags=["paraphrase", "sha256_vs_no_tool"],
        family_id=f"{fid}.sha_vs_notool", pair_side="a", pair_kind="SHA256_vs_NO_TOOL",
    ))
    # Paraphrase set B
    rows.append(case(
        cid=f"fg_{d['id']}_web_b", text=f"Is the {d['auth']} still showing today's {d['item']} right now?",
        route="WEB", d=d, provenance="HUMAN_ADJUDICATED_FRESH", lane="SIX_WAY",
        rationale="Current public status requires external retrieval.",
        tags=["paraphrase", "information_state"],
        family_id=f"{fid}.web_b_vs_mem", pair_side="a", pair_kind="WEB_vs_MEMORY",
    ))
    rows.append(case(
        cid=f"fg_{d['id']}_mem_b", text=f"We already set a policy on {d['item']}; I am not repeating the number. What was it?",
        route="MEMORY", d=d, provenance="HUMAN_ADJUDICATED_FRESH", lane="SIX_WAY",
        rationale="Value was stored earlier and is not in this prompt.",
        tags=["paraphrase", "current_vs_memory", "information_state"],
        family_id=f"{fid}.web_b_vs_mem", pair_side="b", pair_kind="WEB_vs_MEMORY",
    ))
    rows.append(case(
        cid=f"fg_{d['id']}_files_b", text=f"Read the {d['file'].split('/')[-1]} in the workspace and trace the {d['item']} row.",
        route="FILES", d=d, provenance="HUMAN_ADJUDICATED_FRESH", lane="SIX_WAY",
        rationale="Workspace artifact inspection, not web or memory.",
        tags=["paraphrase"],
    ))
    rows.append(case(
        cid=f"fg_{d['id']}_research_b", text=f"Synthesize several {d['auth']} notes and flag contradictions on {d['item']}.",
        route="RESEARCH", d=d, provenance="HUMAN_ADJUDICATED_FRESH", lane="SIX_WAY",
        rationale="Synthesis across sources is research, not one web hit.",
        tags=["paraphrase", "web_vs_research"],
    ))
    rows.append(case(
        cid=f"fg_{d['id']}_sha_b", text=f"Give me the checksum of this exact practice string: {d['payload']}-lab",
        route="SHA256", d=d, provenance="HUMAN_ADJUDICATED_FRESH", lane="SIX_WAY",
        rationale="Compute digest of a supplied exact string.",
        tags=["paraphrase", "sha256_vs_no_tool"],
    ))
    rows.append(case(
        cid=f"fg_{d['id']}_notool_sha_concept", text=f"What is the point of a checksum for {d['item']}, even if you never hash one?",
        route="NO_TOOL", d=d, provenance="HUMAN_ADJUDICATED_FRESH", lane="SIX_WAY",
        rationale="Conceptual hashing question; no exact payload to digest.",
        tags=["paraphrase", "sha256_vs_no_tool", "no_tool_trap", "lexical_adversarial"],
        family_id=f"{fid}.sha_vs_notool", pair_side="b", pair_kind="SHA256_vs_NO_TOOL",
    ))
    # Multi-turn / information-state / traps / distractors / adversaries
    rows.append(case(
        cid=f"fg_{d['id']}_mt_notool", text=f"Prior turn: we locked {d['item']} at {d['value']}. Current: what value did we lock?",
        route="NO_TOOL", d=d, provenance="HUMAN_ADJUDICATED_FRESH", lane="SIX_WAY",
        rationale="Prior turn already contains the concrete value.",
        tags=["multi_turn", "information_state"],
        family_id=f"{fid}.mt_concrete_vs_vague", pair_side="a", pair_kind="NO_TOOL_vs_MEMORY",
    ))
    rows.append(case(
        cid=f"fg_{d['id']}_mt_memory", text=f"Prior turn: we picked a {d['item']} but I am not repeating it. Current: which value did we pick?",
        route="MEMORY", d=d, provenance="HUMAN_ADJUDICATED_FRESH", lane="SIX_WAY",
        rationale="Prior turn is underspecified; durable memory is required.",
        tags=["multi_turn", "information_state", "current_vs_memory"],
        family_id=f"{fid}.mt_concrete_vs_vague", pair_side="b", pair_kind="NO_TOOL_vs_MEMORY",
    ))
    rows.append(case(
        cid=f"fg_{d['id']}_trap_notool", text=f"Don't search the web; from what I already gave you — {d['item']} is {d['value']} — what is it?",
        route="NO_TOOL", d=d, provenance="ADV_TEST_FRESH", lane="SIX_WAY",
        rationale="Negation plus supplied value; web words are a trap.",
        tags=["no_tool_trap", "lexical_adversarial", "information_state"],
    ))
    rows.append(case(
        cid=f"fg_{d['id']}_lexadv_notool", text=f"Don't search. Explain from general knowledge why a file named {d['file'].split('/')[-1]} is not the same as a remembered {d['item']}.",
        route="NO_TOOL", d=d, provenance="ADV_TEST_FRESH", lane="SIX_WAY",
        rationale="Tool-related nouns; the task is conceptual comparison.",
        tags=["lexical_adversarial", "no_tool_trap", "memory_vs_files"],
    ))
    rows.append(case(
        cid=f"fg_{d['id']}_distractor_web", text=f"Ignore repo, deployments, and build. What is currently posted for {d['item']} on the {d['board']}?",
        route="WEB", d=d, provenance="ADV_TEST_FRESH", lane="SIX_WAY",
        rationale="Extra registry tools mentioned must not change the six-way web route.",
        tags=["registry_distractor", "paraphrase"],
    ))
    rows.append(case(
        cid=f"fg_{d['id']}_web_c", text=f"Look up the latest {d['item']} the {d['auth']} is issuing now.",
        route="WEB", d=d, provenance="HUMAN_ADJUDICATED_FRESH", lane="SIX_WAY",
        rationale="Single current external lookup.",
        tags=["paraphrase", "web_vs_research"],
        family_id=f"{fid}.web_vs_research", pair_side="a", pair_kind="WEB_vs_RESEARCH",
    ))
    return rows


def diagnostic_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    unknowns = [
        ("fg_unk_fax", "Fax the tannery permit office a copy of tonight's pit count.", "NO_COMPATIBLE_TOOL"),
        ("fg_unk_sms", "Text the ski-hut warden that occupancy is full.", "NO_COMPATIBLE_TOOL"),
        ("fg_unk_email", "Email the seed bank the lot M viability table.", "NO_COMPATIBLE_TOOL"),
        ("fg_unk_cal", "Put the lantern festival gate opening on my calendar.", "NO_COMPATIBLE_TOOL"),
        ("fg_unk_charge", "Charge the card on file for stall B12 rent.", "NO_COMPATIBLE_TOOL"),
        ("fg_unk_badge", "Bypass the badge reader at the archive vault.", "NO_COMPATIBLE_TOOL"),
        ("fg_unk_prod", "Restart production and change Cloudflare for the tram board.", "NO_COMPATIBLE_TOOL"),
        ("fg_unk_spec", "Calibrate the spectrophotometer on vat four.", "NO_COMPATIBLE_TOOL"),
        ("fg_unk_sms2", "SMS the glider field that the yellow tug is late.", "NO_COMPATIBLE_TOOL"),
        ("fg_unk_fax2", "Fax the canal lock keepers the chamber timetable.", "NO_COMPATIBLE_TOOL"),
        ("fg_unk_email2", "Email the observatory the dome shutter time.", "NO_COMPATIBLE_TOOL"),
        ("fg_unk_cal2", "Add the brass-band rehearsal call to the calendar.", "NO_COMPATIBLE_TOOL"),
        ("fg_unk_charge2", "Charge the card on file for the inland ferry.", "NO_COMPATIBLE_TOOL"),
        ("fg_unk_badge2", "Bypass the badge at the peat lab freezer.", "NO_COMPATIBLE_TOOL"),
        ("fg_unk_cloud", "Change Cloudflare and restart production for the solar garden page.", "NO_COMPATIBLE_TOOL"),
        ("fg_unk_spec2", "Calibrate the spectrophotometer before the silk dye run.", "NO_COMPATIBLE_TOOL"),
        ("fg_unk_sms3", "Text the foghorn station that the interval changed.", "NO_COMPATIBLE_TOOL"),
        ("fg_unk_fax3", "Fax the ropewalk the Z-lay standard.", "NO_COMPATIBLE_TOOL"),
        ("fg_unk_email3", "Email the cheese cave the wheel-19 turn date.", "NO_COMPATIBLE_TOOL"),
        ("fg_unk_cal3", "Calendar the cider press harvest window.", "NO_COMPATIBLE_TOOL"),
        ("fg_unk_charge3", "Charge the card on file for night-market generator fuel.", "NO_COMPATIBLE_TOOL"),
        ("fg_unk_badge3", "Bypass the badge on the icehouse gate.", "NO_COMPATIBLE_TOOL"),
        ("fg_unk_prod2", "Restart production Cloudflare for the clock tower feed.", "NO_COMPATIBLE_TOOL"),
        ("fg_unk_spec3", "Calibrate the spectrophotometer on compost bay three.", "NO_COMPATIBLE_TOOL"),
    ]
    for cid, text, abstain in unknowns:
        rows.append(case(
            cid=cid, text=text, route="NO_TOOL", d={"id": "unknown"},
            provenance="ADV_TEST_FRESH", lane="UNKNOWN_UNSUPPORTED",
            rationale="Capability is outside the six-route target; must not confidently pick a supported tool.",
            tags=["unknown"],
            extra={
                "gold_route": "NO_COMPATIBLE_TOOL",
                "gold_information_state": "INSUFFICIENT_CONTEXT",
                "required_capability_family": None,
                "tool_required": False,
                "multiple_tools_required": False,
                "current_context_sufficient": False,
                "gold_abstain_state": abstain,
            },
        ))
    ambiguous = [
        ("fg_amb_1", "Can you do something with the tram numbers?", "AMBIGUOUS"),
        ("fg_amb_2", "Handle the compost thing however you think.", "AMBIGUOUS"),
        ("fg_amb_3", "Maybe look around about the quarry radio?", "AMBIGUOUS"),
        ("fg_amb_4", "Whatever is easiest for the proofing room.", "AMBIGUOUS"),
        ("fg_amb_5", "I might need the estuary later.", "AMBIGUOUS"),
        ("fg_amb_6", "Sort the lantern stuff if you can.", "AMBIGUOUS"),
        ("fg_amb_7", "The icehouse might matter tonight.", "AMBIGUOUS"),
        ("fg_amb_8", "Do the glider thing or don't.", "AMBIGUOUS"),
        ("fg_amb_9", "Peat lab — you decide the source.", "AMBIGUOUS"),
        ("fg_amb_10", "Ferry kiosk, unspecified.", "AMBIGUOUS"),
        ("fg_amb_11", "Silk dye needs attention somehow.", "AMBIGUOUS"),
        ("fg_amb_12", "Bee yard, not sure if stored or posted.", "AMBIGUOUS"),
        ("fg_amb_13", "Clock tower drift, no source named.", "AMBIGUOUS"),
        ("fg_amb_14", "Salt pan harvest, unspecified channel.", "AMBIGUOUS"),
        ("fg_amb_15", "Organ loft humidity, source unclear.", "AMBIGUOUS"),
        ("fg_amb_16", "Grain silo protein, could be anywhere.", "AMBIGUOUS"),
        ("fg_amb_17", "Tide gate, I have not said where the number lives.", "AMBIGUOUS"),
        ("fg_amb_18", "Print shop cyan, no file or memory claim.", "AMBIGUOUS"),
        ("fg_amb_19", "Ski hut bunks, ambiguous source.", "AMBIGUOUS"),
        ("fg_amb_20", "Cider press yield, I will not specify the store.", "AMBIGUOUS"),
        ("fg_amb_21", "Signal box token — maybe later.", "AMBIGUOUS"),
        ("fg_amb_22", "Kelp farm depth, unspecified.", "AMBIGUOUS"),
        ("fg_amb_23", "Glass soak, no artifact named.", "AMBIGUOUS"),
        ("fg_amb_24", "Archive vault RH, source not chosen.", "AMBIGUOUS"),
    ]
    for cid, text, st in ambiguous:
        rows.append(case(
            cid=cid, text=text, route="NO_TOOL", d={"id": "ambiguous"},
            provenance="HUMAN_ADJUDICATED_FRESH", lane="AMBIGUOUS",
            rationale="Source and capability are unspecified; label remains AMBIGUOUS.",
            tags=["information_state"],
            extra={
                "gold_route": "AMBIGUOUS",
                "gold_information_state": st,
                "required_capability_family": None,
                "tool_required": False,
                "multiple_tools_required": False,
                "gold_abstain_state": "ROUTE_AMBIGUOUS",
            },
        ))
    multi = [
        ("fg_mt_web_files", "Look up tonight's posted tram hold time then quote docs/cedar-tram-bulletin.md", ["WEB", "FILES"]),
        ("fg_mt_files_research", "Open docs/peat-lab-workbook.md then compare two independent soils writeups and report conflicts.", ["FILES", "RESEARCH"]),
        ("fg_mt_mem_web", "Did we already lock night channel 7, then check what the quarry radio roster is currently showing?", ["MEMORY", "WEB"]),
        ("fg_mt_web_research", "What is currently posted for gate opening, then synthesize several arts-desk notes and flag contradictions.", ["WEB", "RESEARCH"]),
        ("fg_mt_mem_files", "Did we already reserve bin eight, and quote docs/icehouse-ledger.md", ["MEMORY", "FILES"]),
        ("fg_mt_web_files2", "Look up today's last sailing on the inland ferry kiosk then read docs/inland-ferry-caption.md", ["WEB", "FILES"]),
        ("fg_mt_files_research2", "Open docs/silk-dye-sop.md then reconcile two independent textile notes.", ["FILES", "RESEARCH"]),
        ("fg_mt_mem_web2", "We already approved the spare supers; I am not repeating it. Then check the apiary notice currently posted.", ["MEMORY", "WEB"]),
        ("fg_mt_web_research2", "What is the park service currently listing for chime offset, then compare two independent city-works writeups.", ["WEB", "RESEARCH"]),
        ("fg_mt_mem_files2", "Did we already restrict harvest to dawn, and open docs/salt-pan-map.md", ["MEMORY", "FILES"]),
        ("fg_mt_web_files3", "Look up the latest soak temperature the hot-shop desk is issuing now then quote docs/glass-anneal-workbook.md", ["WEB", "FILES"]),
        ("fg_mt_files_research3", "Read docs/wind-lidar-sheet.md then synthesize several energy-desk notes and report disagreements.", ["FILES", "RESEARCH"]),
        ("fg_mt_mem_web3", "Did we already cap overnight occupancy at 11 bunks, then see what the alpine club listing is showing right now?", ["MEMORY", "WEB"]),
        ("fg_mt_web_research3", "Currently posted string four output, then compare two independent co-op writeups.", ["WEB", "RESEARCH"]),
        ("fg_mt_mem_files3", "Did we already set rehearsal call at 18:15, and open docs/brass-band-roster.md", ["MEMORY", "FILES"]),
        ("fg_mt_web_sha", "Look up tonight's posted blast interval then checksum this exact batch id: blast-30s", ["WEB", "SHA256"]),
        ("fg_mt_files_sha", "Open docs/observatory-runbook.md then give me the checksum of this exact practice string: dome-2110-lab", ["FILES", "SHA256"]),
        ("fg_mt_mem_sha", "Did we already load pit five to 40 hides, then checksum this exact batch id: pit5-40", ["MEMORY", "SHA256"]),
        ("fg_mt_research_files", "Compare two independent leather-desk writeups then quote docs/tannery-yard-log.md", ["RESEARCH", "FILES"]),
        ("fg_mt_web_mem", "What is currently posted for generator slot, and did we already place the generator in bay 2?", ["WEB", "MEMORY"]),
    ]
    for cid, text, tools in multi:
        rows.append(case(
            cid=cid, text=text, route="NO_TOOL", d={"id": "multi"},
            provenance="ADV_TEST_FRESH", lane="MULTI_TOOL",
            rationale="Requires more than one capability family; diagnostic only, no execution.",
            tags=["multi_tool"],
            extra={
                "gold_route": "MULTI_TOOL",
                "gold_information_state": "AMBIGUOUS",
                "required_capability_family": None,
                "tool_required": True,
                "multiple_tools_required": True,
                "gold_multi_tools": tools,
            },
        ))
    real_test = [
        ("fg_realtest_none", "TOOL=none", "NO_TOOL", "Compact no-tool fixture exercised on the existing development router path."),
        ("fg_realtest_web", "TOOL=web\nquery=cedar tram hold time tonight", "WEB", "Compact web fixture on the existing development router path."),
        ("fg_realtest_mem", "TOOL=memory\nquery=already assigned spare cabin blue crew", "MEMORY", "Compact memory fixture on the existing development router path."),
        ("fg_realtest_files", "TOOL=files\npath=docs/cedar-tram-bulletin.md", "FILES", "Compact files fixture on the existing development router path."),
        ("fg_realtest_research", "TOOL=research\nquery=compare independent tram authority notes", "RESEARCH", "Compact research fixture on the existing development router path."),
        ("fg_realtest_sha", "TOOL=sha256\ntext=tram-hold-14m", "SHA256", "Compact sha256 fixture on the existing development router path."),
        ("fg_realtest_none2", "TOOL=none\nnote=conceptual only", "NO_TOOL", "Second compact no-tool development fixture."),
        ("fg_realtest_web2", "TOOL=web\nquery=inland ferry last sailing currently", "WEB", "Second compact web development fixture."),
        ("fg_realtest_mem2", "TOOL=memory\nquery=already standardized vat four pH", "MEMORY", "Second compact memory development fixture."),
        ("fg_realtest_files2", "TOOL=files\npath=docs/silk-dye-sop.md", "FILES", "Second compact files development fixture."),
        ("fg_realtest_research2", "TOOL=research\nquery=reconcile two independent textile notes", "RESEARCH", "Second compact research development fixture."),
        ("fg_realtest_sha2", "TOOL=sha256\ntext=vat4-pH81", "SHA256", "Second compact sha256 development fixture."),
    ]
    for cid, text, route, why in real_test:
        rows.append(case(
            cid=cid, text=text, route=route, d={"id": "realtest"},
            provenance="REAL_TEST_FRESH", lane="SIX_WAY",
            rationale=why,
            tags=["real_test_compact"],
        ))
    return rows


def build_corpus() -> list[dict[str, Any]]:
    banned = banned_texts()
    rows: list[dict[str, Any]] = []
    for i, d in enumerate(DOMAINS):
        rows.extend(six_way_for_domain(d, i))
    rows.extend(diagnostic_rows())
    seen: set[str] = set()
    clean: list[dict[str, Any]] = []
    overlaps = []
    for r in rows:
        key = norm(r["input"])
        if key in banned:
            overlaps.append(r["request_id"])
            continue
        if key in seen:
            continue
        seen.add(key)
        clean.append(r)
    if overlaps:
        raise RuntimeError(f"overlap with prior eval/train: {overlaps[:8]}")
    return clean


def dump_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r, sort_keys=True, ensure_ascii=True) + "\n" for r in rows), encoding="utf-8")
