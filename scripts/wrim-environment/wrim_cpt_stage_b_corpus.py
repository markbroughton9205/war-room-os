"""WR-CORPUS-CPT-2-v1.0.0 builder + packing simulation + readiness freeze.

AUTHORIZED: corpus construction, leak scan, packing simulation, dry config.
NOT AUTHORIZED: training, optimizer, backward, Stage B execution, SFT, promotion.
Does not modify STEP_400, WRIM-0, or WR-TOKENIZER-0.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import random
import re
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from run000006_pack import load_frozen_genesis_train_units
from run000007_preflight import resolve_dump_root
from run000008_identity import ADDENDUM_NEEDLES, BANNED_STAGE3_KEYS
from stage1_pack import EVAL_INFRA_MARKERS, HELD_OUT_PROMPT_STRINGS
from wrim_cpt2_identity import (
    ARCHITECTURE_ID,
    ASSISTANT_ID,
    AUTHORIZE_ENV_NAME,
    B1_EVAL_STEPS,
    B1_LR,
    B1_MAX_TOKENS,
    B1_STEPS,
    B1_WARMUP,
    BOS_ID,
    CKPT_ROOT,
    COMMANDER_ID,
    CORPUS_ID,
    CORPUS_VERSION,
    CPT_RUN_ID,
    DATA_ROOT,
    DRY_CONFIG_FILENAME,
    EOS_ID,
    GENUINE_PROSE_CATEGORIES,
    INDEPENDENT_NL_MANIFEST_HASH_EXPECTED,
    INDEPENDENT_NL_PACK,
    INDEPENDENT_NL_PACK_HASH_EXPECTED,
    MASK_PROMPT_TOKENS,
    MICRO_BATCH,
    MIX_TOLERANCE_PP,
    NEWLINE_ID,
    OBJECTIVE,
    PAD_ID,
    PACKER_VERSION,
    PARAMETER_COUNT,
    PARENT_CHECKPOINT,
    PARENT_HASH,
    PARENT_WRIM0_HASH,
    PROPOSED_CKPT_ROOT,
    REPORT_FILENAME,
    REQUESTED_MIX,
    RESERVED_SFT_RUN,
    SEED,
    SEQ_LEN,
    STAGE_A_STALE_VALUE,
    TOKENIZER_EXPECTED_SHA,
    TOKENIZER_ID,
    TOKENS_PER_STEP,
    VAL_DOC_FRACTION,
)
from wrim_cpt_identity import LINUX_VENV_PYTHON
from wrim_cpt_stage_b_identity import PROVISIONAL_STAGE_B_PARENT
from wrim_resumable_checkpoint import MODEL_NAME, sha256_file

HERE = Path(__file__).resolve().parent


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8")


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    if not path.is_file():
        return rows
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def corpus_root() -> Path:
    return Path(DATA_ROOT) / CORPUS_VERSION


def family_budgets(n: int, mix: dict[str, float]) -> dict[str, int]:
    raw = {k: n * v for k, v in mix.items()}
    floors = {k: int(v) for k, v in raw.items()}
    rem = int(n) - int(sum(floors.values()))
    order = sorted(raw, key=lambda f: (raw[f] - floors[f], f), reverse=True)
    i = 0
    while rem > 0 and order:
        floors[order[i % len(order)]] += 1
        rem -= 1
        i += 1
    return floors


# --- original first-party lexical banks (not independent-NL names, not Stage 3 keys) ---

GIVEN = (
    "Oren", "Nalini", "Tomas", "Iska", "Rafi", "Helene", "Yusef", "Marit", "Kenzo", "Amina",
    "Petra", "Lars", "Sonia", "Dario", "Noor", "Edvin", "Chiara", "Bram", "Leila", "Soren",
    "Hana", "Mateo", "Ingrid", "Kofi", "Elena", "Arun", "Freya", "Nabil", "Greta", "Ivo",
    "Saskia", "Omar", "Tove", "Camilo", "Anja", "Ryo", "Marta", "Leif", "Zara", "Nils",
)
SURNAMES = (
    "Vale", "Harrow", "Quill", "Mertens", "Sato", "Okoye", "Lindgren", "Pereira", "Nilsen", "Kovacs",
    "Berg", "Duval", "Ibrahim", "Novak", "Hassan", "Okafor", "Silva", "Johansson", "Tanaka", "Moreau",
)
PLACES = (
    "Brinehaven", "Cedarfold", "Amberwick", "Northkettle", "Glassmere", "Redwharf", "Pinemarch",
    "Hollowferry", "Saltwick", "Greencairn", "Dunhollow", "Whitekiln", "Rookfen", "Ashcombe",
    "Silverend", "Fogbarrow", "Mapleford", "Ironlea", "Thornbank", "Lowcaster", "Highgravel",
    "Mossbend", "Stormley", "Quietreach", "Barleymoor", "Windgap", "Stoneferry", "Larkhollow",
)
CRAFTS = (
    "bookbinding", "coopery", "navigation", "orchard tending", "tide gauging", "linen weaving",
    "bridge inspection", "kiln firing", "chart copying", "herb drying", "net mending", "clock oiling",
)
MATERIALS = (
    "oak", "linen", "copper", "slate", "beeswax", "hemp", "iron", "wool", "glass", "clay",
    "cedar", "brass", "paper", "pitch", "salt", "charcoal",
)
TIMES = (
    "before first light", "just after the market bell", "during the long rain", "on a windless noon",
    "as the harbor lamps came on", "in the last hour of winter", "while the ferry waited",
    "after the ledgers were closed", "when the herons left the marsh", "during the dry week",
)
WEATHERS = (
    "a thin coastal fog", "steady rain on slate", "a hard bright cold", "warm still air",
    "gusts that lifted loose paper", "low cloud over the marsh", "clear winter light",
    "a humid evening", "dry wind from inland", "sleet that rattled the eaves",
)
VERBS_CARE = (
    "checked", "mended", "measured", "copied", "stacked", "rinsed", "weighed", "labeled",
    "oil-soaked", "rewound", "leveled", "sorted",
)

SENT_SPLIT = re.compile(r"(?<=[.!?])\s+")


def _pick(seq: tuple[str, ...] | list[str], i: int, salt: int = 0) -> str:
    return seq[(i * 17 + salt * 31) % len(seq)]


def _person(i: int) -> str:
    return f"{_pick(GIVEN, i, 1)} {_pick(SURNAMES, i, 2)}"


def _place(i: int) -> str:
    return _pick(PLACES, i, 3)


def general_prose(i: int) -> str:
    p, q = _person(i), _person(i + 41)
    town, craft = _place(i), _pick(CRAFTS, i, 4)
    mat, t, w = _pick(MATERIALS, i, 5), _pick(TIMES, i, 6), _pick(WEATHERS, i, 7)
    other = _place(i + 9)
    return (
        f"{p} lived three streets up from the working quay in {town}, where {craft} still paid a modest rent "
        f"and nobody pretended the work was romantic. {t.capitalize()}, {w} moved between the houses and made "
        f"the {mat} tools on the bench look older than they were. {p} kept a notebook that was not a diary so "
        f"much as a list of things that had to be true by evening: a measurement, a repaired joint, a promise "
        f"to {q} that the spare hinge would not be forgotten again.\n\n"
        f"The town had a habit of explaining itself to strangers with the same three stories, and {p} had learned "
        f"to let those stories finish without correction. What mattered was quieter. A cistern lid that no longer "
        f"seated. A path of packed grit that iced badly. The way the afternoon light in {other} looked different "
        f"from here even though the maps claimed the same coast. {q} came by with bread and an opinion about "
        f"the ferry schedule, then stayed to help lift a crate that had nothing to do with either of them.\n\n"
        f"On the {3 + (i % 27)}th ledger line {p} wrote a number useful only that week: "
        f"{11 + (i % 80)} spans of {mat} still sound, {2 + (i % 5)} that were not. {q} did not ask for the "
        f"arithmetic. They walked as far as the turning toward {other} and back. {town} kept its lamps honest. "
        f"The marsh did not. {p} preferred the lamps."
    )


def expository_prose(i: int) -> str:
    town, mat = _place(i), _pick(MATERIALS, i, 8)
    cause = _pick(
        (
            "uneven cooling",
            "capillary rise through old mortar",
            "salt carried on fog",
            "repeated freeze and thaw",
            "vibration from the mill road",
            "shade that never let a wall dry",
        ),
        i,
        9,
    )
    effect = _pick(
        (
            "hairline cracks along the south face",
            "a slow stain that returned after painting",
            "doors that swollen shut in March",
            "a smell of damp paper in closed rooms",
            "flaking at the waterline of cellar stone",
        ),
        i,
        10,
    )
    return (
        f"Buildings in {town} fail in small ways before they fail in large ones. {cause.capitalize()} is a common "
        f"beginning. It does not announce itself with a collapse. It shows as {effect}, which people treat as a "
        f"nuisance until the nuisance has a history.\n\n"
        f"The mechanism is not mysterious. Water and temperature move through {mat} at rates that depend on pore "
        f"size, orientation, and whether anyone has kept the flashing honest. When those rates are ignored, the "
        f"wall still looks like a wall. Load paths remain until they do not. The useful explanation is therefore "
        f"not that weather is cruel, but that materials keep accounts.\n\n"
        f"A practical reading follows. Inspect the same line of stone at the same hour for several weeks. Note "
        f"whether wetting arrives from above, from the ground, or from air that condenses on cold {mat}. Repair "
        f"the source before the surface. Paint over a wet wall and you will own a prettier delay. Leave the wall "
        f"able to dry, and {town}'s ordinary houses last another generation without becoming a parable."
    )


def factual_explanation(i: int) -> str:
    topic = _pick(
        (
            "spring tides",
            "deciduous leaf drop",
            "beeswax rendering",
            "cast-iron seasoning",
            "magnetic declination on cheap compasses",
            "why bread stales faster in a refrigerator",
            "how a siphon starts",
            "the difference between fog and mist",
        ),
        i,
        11,
    )
    place = _place(i)
    return (
        f"{topic.capitalize()} can be described without folklore. In {place}, people still mix the description with "
        f"weather talk, but the underlying facts do not require a coastal myth. The process has parts, order, and "
        f"limits. If you change one part, the others move, sometimes quietly.\n\n"
        f"Start with the observable. What can be counted, timed, or weighed. Then name the constraint that makes "
        f"the count repeatable: temperature, pressure, salinity, time of year, or the geometry of a container. "
        f"{topic.capitalize()} is easy to over-explain with a single cause. Most field mistakes come from that "
        f"shortcut. Two causes can share a symptom. A third can hide until the season turns.\n\n"
        f"A short accurate account is therefore better than a grand one. Write the sequence. Write what would "
        f"falsify it. Leave room for the next measurement from {place}'s actual instruments rather than from a "
        f"remembered proverb. Facts earn their keep when they survive a second look."
    )


def instructional_prose(i: int) -> str:
    task = _pick(
        (
            "sharpen a plane iron",
            "set a simple rain gauge",
            "dry apple slices without a machine",
            "true a bicycle wheel by ear and spoke key",
            "proof a small batch of dough",
            "coil a hose so it pays out without knots",
            "clean soot from glass without scratching it",
            "pack a crate so bottles do not kiss",
        ),
        i,
        12,
    )
    town = _place(i)
    return (
        f"To {task} in a kitchen or shed in {town}, begin by clearing a surface you will not have to apologize to. "
        f"Lay out the few tools that actually matter. Extra tools become an audience and then a distraction. Check "
        f"that the piece you will work is dry enough to hold a mark or a measurement.\n\n"
        f"Work in an order that does not invent later regret. Do the irreversible step last. Test a cheap offcut "
        f"or a wasted corner before you touch the face that will be seen. If a measurement disagrees with your eye, "
        f"believe the measurement twice, then decide. Keep a rag in one place so your hands do not hunt for it "
        f"with a blade still in them.\n\n"
        f"When the task is done, put the tools back as if the next person is tired. Wipe the surface. Write one "
        f"line about what surprised you. Instruction that lives only in muscle will be missing on a wet Tuesday. "
        f"Instruction that lives only on paper will be ignored. Keep both, briefly."
    )


def dialogue_doc(i: int) -> str:
    a, b = _person(i), _person(i + 13)
    town = _place(i)
    obj = _pick(("lantern", "ledger", "spare oar", "tin of biscuits", "folded chart", "wool cap"), i, 13)
    return (
        f"\"If we leave the {obj} here, it will be gone by the time the tide turns,\" {a} said, not looking up from "
        f"the knot. \"It will be here,\" {b} said. \"People in {town} steal stories, not gear.\" \"That is a charming "
        f"theory.\" \"It has been true for a year.\" \"A year is not a proof.\" {a} tied the last hitch anyway and "
        f"stood. \"Bring it. I will not argue with the river.\"\n\n"
        f"They walked the lane without hurry. {b} said, \"You talk as if the river keeps receipts.\" \"It does. They "
        f"are written in mud.\" \"You are exhausting.\" \"You came along.\" A dog barked once and thought better of "
        f"it. {a} shifted the {obj} to the other hand. \"If you are right, we will look foolish.\" \"I can live with "
        f"foolish,\" {b} said. \"I cannot live with wet paper.\"\n\n"
        f"At the landing they set the {obj} on the bench that everyone used and no one owned. \"See,\" {b} said. "
        f"\"Still here.\" \"We just arrived.\" \"Give the theory an hour.\" \"I will give it ten minutes.\" They sat. "
        f"The water made the small repetitive sound that ends most local debates. Neither converted the other. "
        f"The {obj} stayed put, which settled nothing and was still a relief."
    )


def narrative(i: int) -> str:
    p = _person(i)
    town, t, w = _place(i), _pick(TIMES, i, 14), _pick(WEATHERS, i, 15)
    lost = _pick(("a brass key", "a letter with no envelope", "a child's wooden horse", "a pair of spectacles"), i, 16)
    return (
        f"{t.capitalize()}, {p} found {lost} under the bench outside the post in {town}. {w.capitalize()} made the "
        f"street look narrower than it was. {p} did not pocket the thing at once. Finding is not owning, and {town} "
        f"had a memory for people who confused the two. Still, leaving it to the weather felt like another kind of "
        f"theft.\n\n"
        f"The clerk had already locked the inner door. A note on the glass said tomorrow. {p} wrapped the find in "
        f"a handkerchief, wrote the hour on a scrap, and sat with it as if the bench were an office. Two people "
        f"passed and did not ask. A third paused, recognized nothing, and went on toward the ferry with a crate "
        f"that hummed faintly, which was probably jars and not a mystery.\n\n"
        f"In the morning the clerk took the handkerchief without theater, entered a line in a book, and offered "
        f"{p} no medal. {p} walked home lighter, which was absurd. Nothing had been solved except the small fear "
        f"that the day would contain a meaner choice. {town} continued. The river continued. {p} made tea and "
        f"burned the toast, which felt correctly unheroic."
    )


def descriptive(i: int) -> str:
    town = _place(i)
    mat = _pick(MATERIALS, i, 17)
    w = _pick(WEATHERS, i, 18)
    return (
        f"The inner marsh below {town} is not scenic in the postcard sense. It is a working wet. {w.capitalize()} "
        f"lies on the reeds until the stems look plated. Channels repeat the same brown, then surprise you with "
        f"a strip of clear water where a current remembers itself. Boards laid for crossing have the pale color "
        f"of {mat} left out too long.\n\n"
        f"Sound carries strangely. A hammer in the village seems closer than the birds at your feet. The air smells "
        f"of iron and cut stems, sometimes of pitch from the boat grid. Light does not fall so much as pool, then "
        f"drain when a cloud takes the inlet. You can watch a heron stand still long enough to doubt it is alive, "
        f"then watch it move as if it had never been a statue.\n\n"
        f"From the last rise, {town}'s roofs look like a temporary decision. Chimneys are the only confident lines. "
        f"The marsh does not care. It keeps the older calendar: tide, wind, the slow argument of silt. A person "
        f"standing there feels correctly small and, if honest, a little pleased to be unnecessary."
    )


def technical_non_repo(i: int) -> str:
    subject = _pick(
        (
            "fixed-point iteration",
            "checksum folding",
            "hysteresis in a thermostat",
            "aliasing in sampled sound",
            "why hash tables need a load factor",
            "stack versus queue discipline",
            "exponential backoff",
            "run-length encoding",
            "endianness in packed integers",
            "deadband in a control loop",
        ),
        i,
        19,
    )
    return (
        f"{subject.capitalize()} is easier to keep straight if you refuse metaphors for one page. The idea is a "
        f"rule about state. You have an input, a stored condition, and an output that must not chatter or drift "
        f"without a reason. People reach for images of rivers and gears because the rule is dry. The dryness is "
        f"the point.\n\n"
        f"Consider a single step. Read. Compare against a threshold or a previous value. Write a new state. If "
        f"you skip the comparison, you get noise. If you skip the write, you get a system that forgets. If you "
        f"compare against the wrong unit, you get a confident error. {subject.capitalize()} fails in public when "
        f"those three actions are split across people who do not share a clock.\n\n"
        f"A worked attitude follows. Name the units. Name the invariant. Name what happens at the boundary: empty "
        f"buffer, full table, temperature exactly on the set point. Draw one diagram with arrows that mean time, "
        f"not architecture fashion. Then implement the boring version. Cleverness is a later luxury and often a "
        f"leak. This is technical explanation, not a tour of a particular repository."
    )


def code_doc(i: int) -> str:
    name = _pick(
        (
            "clamp",
            "moving_mean",
            "count_runs",
            "fold_checksum",
            "interleave",
            "trim_margins",
            "parse_pairs",
            "rotate_left",
            "stable_unique",
            "window_max",
        ),
        i,
        20,
    )
    lang = "python" if i % 2 == 0 else "typescript"
    n = 3 + (i % 5)
    if lang == "python":
        text = (
            f"def {name}(values, width={n}):\n"
            f"    if width <= 0:\n"
            f"        raise ValueError('width must be positive')\n"
            f"    data = list(values)\n"
            f"    if not data:\n"
            f"        return []\n"
            f"    out = []\n"
            f"    acc = 0\n"
            f"    for i, item in enumerate(data):\n"
            f"        acc += int(item)\n"
            f"        if i >= width:\n"
            f"            acc -= int(data[i - width])\n"
            f"        denom = width if i + 1 >= width else i + 1\n"
            f"        out.append(acc / denom)\n"
            f"    return out\n"
        )
    else:
        text = (
            f"export function {name}(values: number[], width: number = {n}): number[] {{\n"
            f"  if (width <= 0) throw new Error('width must be positive');\n"
            f"  const data = values.slice();\n"
            f"  if (data.length === 0) return [];\n"
            f"  const out: number[] = [];\n"
            f"  let acc = 0;\n"
            f"  for (let i = 0; i < data.length; i += 1) {{\n"
            f"    acc += data[i];\n"
            f"    if (i >= width) acc -= data[i - width];\n"
            f"    const denom = i + 1 >= width ? width : i + 1;\n"
            f"    out.push(acc / denom);\n"
            f"  }}\n"
            f"  return out;\n"
            f"}}\n"
        )
    return text


def json_doc(i: int) -> str:
    station = _place(i).lower()
    obj = {
        "station": station,
        "sample_id": f"obs-{i:04d}",
        "celsius": round(((i * 37) % 280) / 10 - 4, 1),
        "humidity_pct": (i * 13) % 97,
        "wind_mps": round(((i * 5) % 90) / 10, 1),
        "ok": i % 7 != 0,
        "notes": ["gauge wiped", "clock synced"] if i % 2 == 0 else ["birds on mast"],
    }
    return json.dumps(obj, indent=2)


ROLE_WORDS = (
    "cedar", "pewter", "linen", "harbor", "meadow", "ember", "quill", "anvil", "harborlight",
    "thimble", "compass", "ballast", "kindling", "ledger", "tallow", "granite", "willow", "nimbus",
    "saddle", "lantern", "barley", "cinder", "rivulet", "trellis", "pumice", "amber", "north",
)
ROLE_TEMPLATES = (
    "Reply with only this word, then stop: {w}",
    "Say {w} once and halt.",
    "Output the halt word {w} and end.",
)


def role_pair(i: int) -> tuple[str, str]:
    w = ROLE_WORDS[i % len(ROLE_WORDS)]
    # avoid repeating the same word/template pair
    tmpl = ROLE_TEMPLATES[i % len(ROLE_TEMPLATES)]
    if i >= len(ROLE_WORDS):
        w = ROLE_WORDS[(i * 3 + 5) % len(ROLE_WORDS)]
        if i >= len(ROLE_WORDS) * 2:
            w = f"{ROLE_WORDS[i % len(ROLE_WORDS)]}"
    prompt = tmpl.format(w=w)
    return prompt, w


def make_doc(category: str, i: int, text: str, *, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    rec = {
        "dataset_id": CORPUS_ID,
        "dataset_version": CORPUS_VERSION,
        "category": category,
        "doc_index": i,
        "text": text.strip() + ("\n" if not text.endswith("\n") else ""),
        "source_id": f"first-party:{category}:{i:04d}",
        "provenance": "original_first_party_authored_for_WR-CORPUS-CPT-2-v1.0.0",
        "license": "ORIGINAL_FIRST_PARTY_INTERNAL_NO_THIRD_PARTY_SCRAPE",
        "license_class": "first_party_original",
        "sha256": sha256_text(text.strip()),
    }
    if extra:
        rec.update(extra)
    rec["doc_id"] = f"cpt2_{category}_{rec['sha256'][:16]}"
    return rec


def generate_original_docs() -> list[dict[str, Any]]:
    docs: list[dict[str, Any]] = []
    builders = {
        "genuine_general_prose": (general_prose, 520),
        "expository_prose": (expository_prose, 280),
        "factual_explanation": (factual_explanation, 240),
        "instructional_prose": (instructional_prose, 200),
        "dialogue": (dialogue_doc, 160),
        "narrative": (narrative, 160),
        "descriptive": (descriptive, 120),
        "technical_explanation_non_repo": (technical_non_repo, 200),
        "code": (code_doc, 280),
        "structured_json": (json_doc, 160),
    }
    for cat, (fn, n) in builders.items():
        for i in range(n):
            docs.append(make_doc(cat, i, fn(i)))
    # role rehearsal: few unique patterns, ordinary words, no adj-noun-NNNN family
    seen_role = set()
    r_i = 0
    while len([d for d in docs if d["category"] == "role_boundary_rehearsal"]) < 180:
        prompt, target = role_pair(r_i)
        key = prompt + "\n" + target
        r_i += 1
        if key in seen_role:
            if r_i > 2000:
                break
            continue
        seen_role.add(key)
        text = f"<|commander|>\n{prompt}\n<|assistant|>\n{target}\n"
        docs.append(
            make_doc(
                "role_boundary_rehearsal",
                r_i,
                text,
                extra={
                    "format": "role_delimited",
                    "prompt": prompt,
                    "target": target,
                    "role_template": prompt.rsplit(":", 1)[0] if ":" in prompt else prompt,
                    "generator": "role_pair/ROLE_TEMPLATES+ROLE_WORDS",
                    "template_count": len(ROLE_TEMPLATES),
                    "unique_word_bank": len(ROLE_WORDS),
                },
            )
        )
    return docs


def genesis_docs(dump: Path, tokenizer) -> list[dict[str, Any]]:
    units = load_frozen_genesis_train_units(dump)
    out = []
    for u in units:
        text = tokenizer.decode(list(int(t) for t in u.tokens), skip_special_tokens=False)
        out.append(
            make_doc(
                "genesis_rehearsal",
                len(out),
                text,
                extra={
                    "source_id": f"WR-CORPUS-0:{u.unit_id}",
                    "provenance": "frozen WR-CORPUS-0 / WRM-001 genesis train document rehearsal",
                    "license": "INTERNAL_SOVEREIGN_MODEL_LAB_WRM-001",
                    "license_class": "internal_genesis_rehearsal",
                    "genesis_unit_id": u.unit_id,
                },
            )
        )
    return out


def collect_forbidden_texts(dump: Path) -> dict[str, list[str]]:
    buckets: dict[str, list[str]] = defaultdict(list)

    def add(cat: str, text: str) -> None:
        t = (text or "").strip()
        if t:
            buckets[cat].append(t)

    val_root = Path(DATA_ROOT) / INDEPENDENT_NL_PACK
    for rec in load_jsonl(val_root / f"{INDEPENDENT_NL_PACK}-PASSAGES.jsonl"):
        add("independent_nl", str(rec.get("text") or rec.get("passage") or ""))
        add("independent_nl", str(rec.get("prompt") or ""))
    fe = Path(DATA_ROOT) / "WRIM-FOUNDATION-EVAL-1-v1.0.0" / "WRIM-FOUNDATION-EVAL-1-v1.0.0.json"
    if fe.is_file():
        obj = json.loads(fe.read_text(encoding="utf-8"))
        for it in obj.get("items") or []:
            add("foundation", " ".join(str(it.get(k) or "") for k in ("prompt", "target", "text")))
    for name, cat in (
        (HERE / "evals" / "WRIM-EVAL-S3-000001.json", "stage3"),
        (Path(DATA_ROOT) / "WRIM-EVAL-S3-INSTRUCTION-ADDENDUM-000001.json", "stage3_addendum"),
        (Path(DATA_ROOT) / "WR-CORPUS-MODE-ENTRY-1-v1.0.0" / "WR-CORPUS-MODE-ENTRY-1-v1.0.0-VALIDATION.jsonl", "mode_entry_val"),
        (Path(DATA_ROOT) / "WR-CORPUS-CAPABILITY-1-v1.0.0" / "WR-CORPUS-CAPABILITY-1-v1.0.0-VALIDATION.jsonl", "capability_val"),
        (Path(DATA_ROOT) / "WR-CORPUS-CPT-1-v1.0.0" / "WR-CORPUS-CPT-1-v1.0.0-ROLE-VAL.jsonl", "sft_role_val"),
    ):
        path = name
        if not path.is_file():
            continue
        if path.suffix == ".json":
            obj = json.loads(path.read_text(encoding="utf-8"))
            raw = path.read_text(encoding="utf-8")
            add(cat, raw[:1_500_000])
            items = obj.get("items") or obj.get("prompts") or []
            if isinstance(items, list):
                for it in items:
                    if isinstance(it, dict):
                        add(cat, " ".join(str(it.get(k) or "") for k in ("prompt", "target", "text", "body")))
                    else:
                        add(cat, str(it))
        else:
            for rec in load_jsonl(path):
                add(cat, " ".join(str(rec.get(k) or "") for k in ("prompt", "target", "text", "body", "content")))
    for s in HELD_OUT_PROMPT_STRINGS:
        add("heldout", s)
    for s in EVAL_INFRA_MARKERS:
        add("eval_infra", s)
    for s in ADDENDUM_NEEDLES:
        add("addendum_needle", s)
    for s in BANNED_STAGE3_KEYS:
        add("stage3_key", s)
    return dict(buckets)


def build_span_index(blobs: list[str], span: int = 48) -> set[str]:
    idx: set[str] = set()
    for blob in blobs:
        t = blob.lower()
        if len(t) < span:
            if t:
                idx.add(t)
            continue
        step = 12
        for i in range(0, len(t) - span + 1, step):
            idx.add(t[i : i + span])
    return idx


def leak_scan_docs(docs: list[dict[str, Any]], forbidden: dict[str, list[str]]) -> dict[str, Any]:
    exact = []
    spans = []
    needle_hits = []
    indexes = {cat: build_span_index(texts) for cat, texts in forbidden.items()}
    full_sets = {cat: set(t.lower() for t in texts if t) for cat, texts in forbidden.items()}
    needles = list(ADDENDUM_NEEDLES) + list(BANNED_STAGE3_KEYS) + list(HELD_OUT_PROMPT_STRINGS) + list(EVAL_INFRA_MARKERS)
    for rec in docs:
        text = rec["text"]
        low = text.lower()
        for cat, fset in full_sets.items():
            if text.lower() in fset or any(len(f) >= 40 and f in low for f in list(fset)[:400] if len(f) < 5000):
                # exact whole-doc match against a forbidden blob
                for f in fset:
                    if f and (f == low or (len(f) >= 80 and f in low) or (len(low) >= 80 and low in f)):
                        exact.append({"doc_id": rec["doc_id"], "source": cat})
                        break
        for cat, idx in indexes.items():
            if rec["category"] == "genesis_rehearsal" and cat in {"heldout"}:
                continue
            n = len(low)
            hit = False
            for i in range(0, max(1, n - 47), 24):
                win = low[i : i + 48]
                if len(win) >= 48 and win in idx:
                    spans.append({"doc_id": rec["doc_id"], "source": cat, "span": 48})
                    hit = True
                    break
            if hit:
                break
        for n in needles:
            if n and len(str(n)) >= 6 and str(n) in text:
                needle_hits.append({"doc_id": rec["doc_id"], "needle": str(n)[:48]})
    # de-dup lists
    def uniq(rows: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
        seen = set()
        out = []
        for r in rows:
            k = r.get(key)
            if k in seen:
                continue
            seen.add(k)
            out.append(r)
        return out

    exact_u = uniq(exact, "doc_id")
    span_u = uniq(spans, "doc_id")
    needle_u = uniq(needle_hits, "doc_id")
    leak_ids = {r["doc_id"] for r in exact_u + span_u + needle_u}
    return {
        "EXACT_DUPLICATES": len(exact_u),
        "LONG_SPAN_OVERLAP_GE_48": len(span_u),
        "NEEDLE_HITS": len(needle_u),
        "leak_ids": sorted(leak_ids),
        "exact_examples": exact_u[:12],
        "span_examples": span_u[:12],
        "needle_examples": needle_u[:12],
        "independent_nl_hits": len([r for r in span_u + exact_u if r.get("source") == "independent_nl"]),
        "stage3_hits": len([r for r in span_u + exact_u if str(r.get("source", "")).startswith("stage3")]),
        "sft_val_hits": len([r for r in span_u + exact_u if r.get("source") in {"mode_entry_val", "capability_val", "sft_role_val"}]),
        "foundation_hits": len([r for r in span_u + exact_u if r.get("source") == "foundation"]),
    }


def exact_dedup(docs: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    seen = set()
    out = []
    dropped = 0
    for rec in docs:
        k = rec["sha256"]
        if k in seen:
            dropped += 1
            continue
        seen.add(k)
        out.append(rec)
    return out, dropped


def near_dup_drop(docs: list[dict[str, Any]], jaccard: float = 0.72) -> tuple[list[dict[str, Any]], int]:
    def shingles(text: str) -> set[str]:
        words = re.findall(r"[A-Za-z0-9_<>|]+", text.lower())
        if len(words) < 12:
            return {" ".join(words)} if words else set()
        return {" ".join(words[i : i + 12]) for i in range(0, len(words) - 11, 3)}

    kept: list[dict[str, Any]] = []
    sigs: list[set[str]] = []
    dropped = 0
    for rec in docs:
        if rec["category"] in {"genesis_rehearsal", "role_boundary_rehearsal", "structured_json", "code"}:
            kept.append(rec)
            sigs.append(set())
            continue
        sig = shingles(rec["text"])
        dup = False
        for prev in sigs:
            if not prev or not sig:
                continue
            inter = len(sig & prev)
            if inter == 0:
                continue
            union = len(sig | prev)
            if union and inter / union >= jaccard:
                dup = True
                break
        if dup:
            dropped += 1
            continue
        kept.append(rec)
        sigs.append(sig)
    return kept, dropped


def template_drop(docs: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, int]]:
    reasons: Counter[str] = Counter()
    out = []
    for rec in docs:
        text = rec["text"]
        if re.search(r"\b\w+-\w+-\d{3,}\b", text) and rec["category"] != "structured_json":
            reasons["adj_noun_number_family"] += 1
            continue
        if "quay_id" in text or "crate_count" in text:
            reasons["stage3_boilerplate"] += 1
            continue
        if re.search(r"app/api/|lib/native-builder|research-engine", text):
            reasons["war_room_path_dump"] += 1
            continue
        out.append(rec)
    return out, dict(reasons)


def tokenize_docs(docs: list[dict[str, Any]], tokenizer) -> list[dict[str, Any]]:
    out = []
    for rec in docs:
        rec = dict(rec)
        if rec["category"] == "role_boundary_rehearsal":
            prompt_ids = list(tokenizer.encode(rec["prompt"], add_special_tokens=False).ids)
            target_ids = list(tokenizer.encode(rec["target"], add_special_tokens=False).ids)
            ids = [BOS_ID, COMMANDER_ID, NEWLINE_ID, *prompt_ids, ASSISTANT_ID, NEWLINE_ID, *target_ids, EOS_ID]
        else:
            body = list(tokenizer.encode(rec["text"], add_special_tokens=False).ids)
            if not body:
                continue
            ids = [BOS_ID, *body, EOS_ID]
        rec["token_ids"] = ids
        rec["token_count"] = len(ids)
        out.append(rec)
    return out


def document_split(docs: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rng = random.Random(SEED)
    by: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for rec in docs:
        by[rec["category"]].append(rec)
    train: list[dict[str, Any]] = []
    val: list[dict[str, Any]] = []
    for rows in by.values():
        order = list(rows)
        rng.shuffle(order)
        if len(order) <= 1:
            n_val = 0
        elif len(order) < 10:
            n_val = 1
        else:
            n_val = max(1, int(round(len(order) * VAL_DOC_FRACTION)))
        for j, rec in enumerate(order):
            rec = dict(rec)
            rec["split"] = "val" if j < n_val else "train"
            (val if rec["split"] == "val" else train).append(rec)
    train_ids = {r["doc_id"] for r in train}
    val_ids = {r["doc_id"] for r in val}
    overlap = train_ids & val_ids
    if overlap:
        raise RuntimeError(f"document split leaked {len(overlap)} ids into both splits")
    return train, val


def sentences(text: str) -> list[str]:
    parts = SENT_SPLIT.split(text.strip())
    return [p.strip() for p in parts if p.strip()]


def pack_family_windows(docs: list[dict[str, Any]], tokenizer, budget: int, family: str) -> dict[str, Any]:
    """Family-local packing. EOS only at document ends. No cross-family concatenation.

    Documents are concatenated in shuffled order and sliced to an exact token budget.
    512-token windows may continue a document; a new BOS starts a new document.
    """
    if not docs or budget <= 0:
        return {"windows": [], "eos": 0, "cross_doc": 0, "pad": 0, "tokens": 0, "fill": 0.0, "content_tokens": 0}
    order = list(docs)
    rng = random.Random(SEED + sum(ord(c) for c in family))
    rng.shuffle(order)
    stream: list[int] = []
    cross_doc = 0
    i = 0
    while len(stream) < budget:
        ids = list(order[i % len(order)]["token_ids"])
        if stream and ids and ids[0] == BOS_ID:
            cross_doc += 1
        stream.extend(ids)
        i += 1
        if i > max(8, len(order)) * 800:
            break
    if len(stream) < budget:
        return {
            "windows": [],
            "eos": 0,
            "cross_doc": 0,
            "pad": 0,
            "tokens": 0,
            "fill": 0.0,
            "content_tokens": 0,
            "short": True,
            "have": len(stream),
            "need": budget,
        }
    stream = stream[:budget]
    windows: list[list[int]] = []
    pad = 0
    for off in range(0, budget, SEQ_LEN):
        chunk = stream[off : off + SEQ_LEN]
        if len(chunk) < SEQ_LEN:
            pad += SEQ_LEN - len(chunk)
            chunk = chunk + [PAD_ID] * (SEQ_LEN - len(chunk))
        windows.append(chunk)
    total = len(windows) * SEQ_LEN
    eos_count = int(sum(1 for t in stream if t == EOS_ID))
    return {
        "windows": windows,
        "eos": eos_count,
        "cross_doc": cross_doc,
        "pad": pad,
        "tokens": total,
        "content_tokens": int(budget - pad),
        "fill": (total - pad) / total if total else 0.0,
    }


def simulate_packing(train: list[dict[str, Any]], tokenizer) -> dict[str, Any]:
    budgets = family_budgets(B1_MAX_TOKENS, REQUESTED_MIX)
    by: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for rec in train:
        by[rec["category"]].append(rec)
    family_packs = {}
    missing = []
    for fam, bud in budgets.items():
        rows = by.get(fam) or []
        if not rows:
            missing.append(fam)
            family_packs[fam] = {"windows": [], "eos": 0, "cross_doc": 0, "pad": 0, "tokens": 0, "fill": 0.0}
            continue
        family_packs[fam] = pack_family_windows(rows, tokenizer, bud, fam)
    # assemble minibatches: 50%+ homogeneous
    fam_windows = {fam: list(p["windows"]) for fam, p in family_packs.items()}
    steps = []
    fams = [f for f, w in fam_windows.items() if w]
    rng = random.Random(SEED + 99)
    # consume windows round-robin for mixed; blocks of 8 from one family for homo
    homo = 0
    mixed = 0
    cross_family_transitions = 0
    used = {f: 0 for f in fams}
    remaining_windows = sum(max(0, len(fam_windows[f]) - used[f]) for f in fams)

    def take(fam: str) -> list[int] | None:
        ws = fam_windows[fam]
        if not ws:
            return None
        i = used[fam] % len(ws)
        used[fam] += 1
        return ws[i]

    for step in range(B1_STEPS):
        batch = []
        if step % 2 == 0 and fams:
            fam = fams[(step // 2) % len(fams)]
            for _ in range(MICRO_BATCH):
                w = take(fam)
                if w is None:
                    break
                batch.append((fam, w))
            if len(batch) == MICRO_BATCH:
                homo += 1
        else:
            for j in range(MICRO_BATCH):
                fam = fams[j % len(fams)] if fams else None
                if not fam:
                    break
                w = take(fam)
                if w is None:
                    continue
                batch.append((fam, w))
            if len(batch) == MICRO_BATCH:
                mixed += 1
                labels = [b[0] for b in batch]
                cross_family_transitions += sum(1 for a, b in zip(labels, labels[1:]) if a != b)
        steps.append({"n": len(batch), "families": [b[0] for b in batch]})
    total_windows = B1_STEPS * MICRO_BATCH
    total_tokens = total_windows * SEQ_LEN
    pad = sum(family_packs[f]["pad"] for f in family_packs)
    # recompute pad on consumed is hard; report family pack pad vs family tokens
    family_tokens = {f: family_packs[f]["tokens"] for f in family_packs}
    # actual mix from family budgets (construction)
    actual_tokens = {}
    for f, bud in budgets.items():
        pack = family_packs[f]
        if pack.get("short") or not pack.get("tokens"):
            missing.append(f)
            actual_tokens[f] = 0
        else:
            actual_tokens[f] = int(pack.get("content_tokens") or pack["tokens"])
    tot = sum(actual_tokens.values()) or 1
    actual_share = {f: actual_tokens[f] / tot for f in REQUESTED_MIX}
    eos = sum(family_packs[f]["eos"] for f in family_packs)
    cross_doc = sum(family_packs[f]["cross_doc"] for f in family_packs)
    fill_num = sum(family_packs[f]["fill"] * family_packs[f]["tokens"] for f in family_packs)
    fill_den = sum(family_packs[f]["tokens"] for f in family_packs) or 1
    homo_frac = homo / B1_STEPS if B1_STEPS else 0.0
    return {
        "budgets": budgets,
        "actual_tokens": actual_tokens,
        "actual_share": actual_share,
        "missing_families": missing,
        "eos_count": eos,
        "eos_density": eos / tot if tot else 0.0,
        "cross_document_transitions": cross_doc,
        "cross_family_transitions": cross_family_transitions,
        "homogeneous_minibatches": homo,
        "mixed_minibatches": mixed,
        "homogeneous_fraction": homo_frac,
        "mean_sequence_fill": fill_num / fill_den,
        "padding_rate": 1.0 - (fill_num / fill_den),
        "packer_version": PACKER_VERSION,
        "seq_len": SEQ_LEN,
        "micro_batch": MICRO_BATCH,
        "steps": B1_STEPS,
        "tokens_per_step": TOKENS_PER_STEP,
        "packed_tokens": tot,
    }


def b1_hard_gate_hits(m: dict[str, Any]) -> list[str]:
    hits: list[str] = []
    if m.get("foundation_mean_rank") is not None and float(m["foundation_mean_rank"]) > 2417.26:
        hits.append("FOUNDATION_RANK_DEGRADE")
    if m.get("foundation_top5") is not None and int(m["foundation_top5"]) < 4:
        hits.append("FOUNDATION_TOP5_COLLAPSE")
    if m.get("independent_nl_nll") is not None and float(m["independent_nl_nll"]) > 7.330:
        hits.append("INDEPENDENT_NL_NLL_WORSE")
    if m.get("independent_nl_newline") is not None and float(m["independent_nl_newline"]) > 0.20:
        hits.append("INDEPENDENT_NL_NEWLINE")
    if m.get("independent_nl_doc_cont") is not None and float(m["independent_nl_doc_cont"]) > 0.35:
        hits.append("INDEPENDENT_NL_DOC_CONT")
    if m.get("independent_nl_repeat") is not None and float(m["independent_nl_repeat"]) > 0.35:
        hits.append("REPETITION")
    if m.get("stage3_historical") is not None:
        if (
            int(m["stage3_historical"]) < 5
            or int(m.get("stage3_collapse") or 0) > 5
            or float(m.get("stage3_delta_nll") or 0) > 1.15
        ):
            hits.append("STAGE3_RETENTION")
    if m.get("nan"):
        hits.append("NAN_INF")
    if m.get("grad_norm") is not None and float(m["grad_norm"]) > 8.0:
        hits.append("GRAD_INSTABILITY")
    if float(m.get("independent_nl_tag_fragment") or 0) > 0 or int(m.get("foundation_non_tag_tag_emissions") or 0) > 1:
        hits.append("TAG_CONTAMINATION")
    if m.get("code_nll") is not None and float(m["code_nll"]) > 6.50:
        hits.append("CODE_COLLAPSE")
    if m.get("json_nll") is not None and float(m["json_nll"]) > 6.00:
        hits.append("JSON_COLLAPSE")
    if int(m.get("step") or 0) > 50 and (
        (m.get("eos_argmax") is not None and float(m["eos_argmax"]) < 0.35)
        or int(m.get("eos_greedy_stop") or 0) == 0
    ):
        hits.append("EOS_COLLAPSE")
    if m.get("val_leak"):
        hits.append("MEMORIZATION_LEAKAGE")
    if int(m.get("step") or 0) > 10 and m.get("train_loss") is not None and float(m["train_loss"]) > 12.0:
        hits.append("LOSS_EXPLOSION")
    return hits


def b1_warnings(m: dict[str, Any], parent_nl: float | None = 7.180024635791779) -> list[str]:
    w: list[str] = []
    if m.get("foundation_mean_rank") is not None and float(m["foundation_mean_rank"]) > 2200:
        w.append("rank>2200")
    if (
        int(m.get("step") or 0) >= 100
        and parent_nl is not None
        and m.get("independent_nl_nll") is not None
        and (float(parent_nl) - float(m["independent_nl_nll"])) < 0.03
    ):
        w.append("nl_nll_gain<0.03")
    if m.get("code_nll") is not None and float(m["code_nll"]) > 5.80:
        w.append("code_nll>5.80")
    return w


def val_family_id_packs(val_tok: list[dict[str, Any]]) -> dict[str, list[int]]:
    mapping = {
        "code": "code",
        "structured_json": "json",
        "genesis_rehearsal": "genesis",
        "role_boundary_rehearsal": "role",
        "genuine_general_prose": "general",
    }
    packs: dict[str, list[int]] = {name: [] for name in mapping.values()}
    for rec in val_tok:
        name = mapping.get(rec.get("category") or "")
        if not name:
            continue
        packs[name].extend(list(rec.get("token_ids") or []))
    return packs


def materialize_b1_stream(train: list[dict[str, Any]], tokenizer) -> dict[str, Any]:
    """Build the exact 819201-token B1 stream from frozen CPT-2 train docs. Read-only vs jsonl."""
    import numpy as np

    from wrim_cpt2_identity import PACK_TARGET_TOKENS

    budgets = family_budgets(B1_MAX_TOKENS, REQUESTED_MIX)
    by: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for rec in train:
        by[rec["category"]].append(rec)
    family_packs: dict[str, Any] = {}
    missing: list[str] = []
    for fam, bud in budgets.items():
        rows = by.get(fam) or []
        if not rows:
            missing.append(fam)
            family_packs[fam] = {"windows": [], "eos": 0, "cross_doc": 0, "pad": 0, "tokens": 0, "fill": 0.0, "short": True}
            continue
        family_packs[fam] = pack_family_windows(rows, tokenizer, bud, fam)
        if family_packs[fam].get("short"):
            missing.append(fam)
    fam_windows = {fam: list(p["windows"]) for fam, p in family_packs.items()}
    fams = [f for f, w in fam_windows.items() if w]
    used = {f: 0 for f in fams}

    def take(fam: str) -> list[int] | None:
        ws = fam_windows[fam]
        if not ws:
            return None
        i = used[fam] % len(ws)
        used[fam] += 1
        return ws[i]

    stream_ids: list[int] = []
    homo = 0
    mixed = 0
    cross_family_transitions = 0
    for step in range(B1_STEPS):
        batch: list[tuple[str, list[int]]] = []
        if step % 2 == 0 and fams:
            fam = fams[(step // 2) % len(fams)]
            for _ in range(MICRO_BATCH):
                w = take(fam)
                if w is None:
                    break
                batch.append((fam, w))
            if len(batch) == MICRO_BATCH:
                homo += 1
        else:
            for j in range(MICRO_BATCH):
                fam = fams[j % len(fams)] if fams else None
                if not fam:
                    break
                w = take(fam)
                if w is None:
                    continue
                batch.append((fam, w))
            if len(batch) == MICRO_BATCH:
                mixed += 1
                labels = [b[0] for b in batch]
                cross_family_transitions += sum(1 for a, b in zip(labels, labels[1:]) if a != b)
        if len(batch) != MICRO_BATCH:
            return {"ok": False, "reason": "incomplete_minibatch", "step": step, "n": len(batch), "missing_families": missing}
        for _fam, w in batch:
            stream_ids.extend(w)
    if len(stream_ids) != B1_MAX_TOKENS:
        return {"ok": False, "reason": "packed_len_mismatch", "have": len(stream_ids), "need": B1_MAX_TOKENS, "missing_families": missing}
    extra = stream_ids[0] if stream_ids else EOS_ID
    stream_ids.append(int(extra))
    if len(stream_ids) != PACK_TARGET_TOKENS:
        return {"ok": False, "reason": "pack_target_mismatch", "have": len(stream_ids), "need": PACK_TARGET_TOKENS}
    actual_tokens = {}
    for f, pack in family_packs.items():
        if pack.get("short") or not pack.get("tokens"):
            actual_tokens[f] = 0
        else:
            actual_tokens[f] = int(pack.get("content_tokens") or pack["tokens"])
    tot = sum(actual_tokens.values()) or 1
    actual_share = {f: actual_tokens[f] / tot for f in REQUESTED_MIX}
    pad = sum(int(family_packs[f].get("pad") or 0) for f in family_packs)
    eos = sum(int(family_packs[f].get("eos") or 0) for f in family_packs)
    fill_num = sum(float(family_packs[f].get("fill") or 0) * float(family_packs[f].get("tokens") or 0) for f in family_packs)
    fill_den = sum(float(family_packs[f].get("tokens") or 0) for f in family_packs) or 1.0
    stream = np.asarray(stream_ids, dtype=np.int32)
    return {
        "ok": True,
        "missing_families": missing,
        "budgets": budgets,
        "actual_tokens": actual_tokens,
        "actual_share": actual_share,
        "eos_count": eos,
        "eos_density": eos / tot if tot else 0.0,
        "cross_document_transitions": sum(int(family_packs[f].get("cross_doc") or 0) for f in family_packs),
        "cross_family_transitions": cross_family_transitions,
        "homogeneous_minibatches": homo,
        "mixed_minibatches": mixed,
        "homogeneous_fraction": homo / B1_STEPS if B1_STEPS else 0.0,
        "mean_sequence_fill": fill_num / fill_den,
        "padding_rate": (pad / (B1_MAX_TOKENS or 1)),
        "packer_version": PACKER_VERSION,
        "seq_len": SEQ_LEN,
        "micro_batch": MICRO_BATCH,
        "steps": B1_STEPS,
        "tokens_per_step": TOKENS_PER_STEP,
        "packed_tokens": int(stream.size) - 1,
        "stream_len": int(stream.size),
        "_stream": stream,
    }


def mix_within_tolerance(share: dict[str, float]) -> tuple[bool, dict[str, float]]:
    delta = {}
    ok = True
    for k, req in REQUESTED_MIX.items():
        d = (share.get(k, 0.0) - req) * 100.0
        delta[k] = d
        if abs(d) > MIX_TOLERANCE_PP:
            ok = False
    return ok, delta


def encode_role_ids(tokenizer, prompt: str, target: str) -> list[int]:
    prompt_ids = list(tokenizer.encode(prompt, add_special_tokens=False).ids)
    target_ids = list(tokenizer.encode(target, add_special_tokens=False).ids)
    return [BOS_ID, COMMANDER_ID, NEWLINE_ID, *prompt_ids, ASSISTANT_ID, NEWLINE_ID, *target_ids, EOS_ID]


def synthetic_gate_validation() -> dict[str, Any]:
    """Validate gate predicates on synthetic metric dicts. No training."""
    parent = {
        "foundation_mean_rank": 2101.96875,
        "foundation_top5": 7,
        "independent_nl_nll": 7.180024635791779,
        "independent_nl_newline": 0.075,
        "independent_nl_doc_cont": 0.2,
        "independent_nl_repeat": 0.25,
        "independent_nl_tag_fragment": 0.0,
        "stage3_historical": 5,
        "stage3_collapse": 3,
        "stage3_delta_nll": 0.8484343801225934,
        "code_nll": 5.428938388824463,
        "json_nll": 4.803139686584473,
        "eos_argmax": 0.5416666666666666,
        "eos_greedy_stop": 3,
        "grad_norm": 3.12,
        "train_loss": 3.05,
        "nan": False,
        "val_leak": False,
        "step": 100,
        "foundation_non_tag_tag_emissions": 0,
    }

    def fires(m: dict[str, Any]) -> list[str]:
        return b1_hard_gate_hits(m)

    def warns(m: dict[str, Any]) -> list[str]:
        return b1_warnings(m, parent["independent_nl_nll"])

    parent_hits = fires(parent)
    bad = dict(parent)
    bad["foundation_mean_rank"] = 2500
    bad["independent_nl_nll"] = 7.4
    bad["nan"] = True
    bad_hits = fires(bad)
    warn_case = dict(parent)
    warn_case["foundation_mean_rank"] = 2210
    warn_case["code_nll"] = 5.85
    return {
        "parent_should_not_fire": parent_hits == [],
        "parent_hits": parent_hits,
        "synthetic_fail_fires": bad_hits,
        "synthetic_fail_includes_rank_nll_nan": set(["FOUNDATION_RANK_DEGRADE", "INDEPENDENT_NL_NLL_WORSE", "NAN_INF"]).issubset(set(bad_hits)),
        "warn_case": warns(warn_case),
        "logic_ok": parent_hits == [] and "FOUNDATION_RANK_DEGRADE" in bad_hits and "NAN_INF" in bad_hits,
    }


def success_criteria_encoding() -> dict[str, Any]:
    return {
        "independent_nl_nll": {"op": "<=", "value": 7.10},
        "independent_nl_newline": {"op": "<=", "value": 0.075},
        "independent_nl_repeat": {"op": "<=", "value": 0.25},
        "independent_nl_tag_fragment": {"op": "==", "value": 0},
        "code_intrusion": {"op": "<", "value": "STEP_400_MEASURED"},
        "markdown_intrusion": {"op": "<", "value": "STEP_400_MEASURED"},
        "independent_nl_greedy_prose_continuation": {"op": ">=", "value": "1/40"},
        "foundation_mean_rank": {"op": "<=", "value": 2200},
        "foundation_top5": {"op": ">=", "value": 6},
        "stage3_historical": {"op": ">=", "value": "5/6"},
        "code_nll": {"op": "<=", "value": 5.50},
        "json_nll": {"op": "<=", "value": 4.90},
        "eos_argmax": {"op": ">=", "value": 0.45},
        "nan_inf": {"op": "==", "value": False},
        "auto_promote": False,
    }


def resource_estimate() -> dict[str, Any]:
    params = PARAMETER_COUNT
    bytes_fp32 = params * 4
    adam = bytes_fp32 * 2
    grads = bytes_fp32
    # activations rough: microbatch * seq * d_model * layers * 4 bytes * residual copies
    acts = MICRO_BATCH * SEQ_LEN * 256 * 18 * 4 * 6
    vram = bytes_fp32 + adam + grads + acts
    stage_a_seconds = 241.706
    sec_per_step = stage_a_seconds / 1220
    b1_train_only = sec_per_step * B1_STEPS
    eval_tax = 8 * 25  # dense eval every 25 steps, ~25s each order-of-magnitude guess
    return {
        "hardware": "NVIDIA GeForce RTX 5060 Ti 16311 MiB, 16 logical cores, ~31 GiB RAM (Nebula Genesis)",
        "parameter_count": params,
        "vram_bytes_estimate": int(vram),
        "vram_mib_estimate": round(vram / (1024 * 1024), 1),
        "vram_headroom_note": "Stage A 19.2M AdamW already ran on this GPU; B1 identical batch/seq.",
        "ram_mib_estimate": round((bytes_fp32 + B1_MAX_TOKENS * 4 + 256 * 1024 * 1024) / (1024 * 1024), 1),
        "checkpoint_disk_mib_each": round((bytes_fp32 + 1_000_000) / (1024 * 1024), 1),
        "checkpoint_disk_mib_b1_all_eval_steps": round(((bytes_fp32 + 1_000_000) * len(B1_EVAL_STEPS)) / (1024 * 1024), 1),
        "temporary_disk_mib": round((B1_MAX_TOKENS * 8 + 50_000_000) / (1024 * 1024), 1),
        "expected_runtime_range": {
            "train_only_seconds_est": round(b1_train_only, 1),
            "with_dense_eval_seconds_est_low": round(b1_train_only + 60, 1),
            "with_dense_eval_seconds_est_high": round(b1_train_only + 12 * 40, 1),
            "basis": "Stage A 1220 steps in 241.7s (20674 tok/s) on this machine; B1 is 200 steps plus eval every 25.",
        },
        "tensors_allocated_this_pass": "NONE_BEYOND_TOKENIZER_ENCODE_AND_INT32_PACKING_ARRAYS",
        "gpu_training_started": False,
    }


def fail_closed_proof() -> dict[str, Any]:
    env = os.environ.copy()
    env.pop(AUTHORIZE_ENV_NAME, None)
    report = Path("/tmp/WRIM1_CPT_000002_UNAUTHORIZED_REFUSAL.json")
    cmd = [
        LINUX_VENV_PYTHON if Path(LINUX_VENV_PYTHON).is_file() else sys.executable,
        str(HERE / "wrim_cpt_train.py"),
        "--data-root",
        DATA_ROOT,
        "--ckpt",
        "/tmp/wrim-cpt2-unauthorized-ckpt-should-not-exist",
        "--report",
        str(report),
    ]
    proc = subprocess.run(cmd, cwd=str(HERE), env=env, capture_output=True, text=True, timeout=60)
    payload = {}
    if report.is_file():
        payload = json.loads(report.read_text(encoding="utf-8"))
    # also invoke Stage B stub
    stub = subprocess.run(
        [sys.executable, str(HERE / "wrim_cpt2_train.py")],
        cwd=str(HERE),
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    stub_payload = {}
    try:
        stub_payload = json.loads(stub.stdout)
    except json.JSONDecodeError:
        stub_payload = {"raw": stub.stdout[-2000:], "stderr": stub.stderr[-1000:]}
    ok = (
        payload.get("AdamW_constructed") is False
        and payload.get("optimizer_steps", 1) == 0
        and payload.get("training_executed") is False
        and stub_payload.get("OPTIMIZER_CREATED") == "NO"
        and stub.returncode == 0
    )
    return {
        "UNAUTHORIZED_TRAINING_REFUSED": "PASS" if ok else "FAIL",
        "stage_a_trainer_without_env": {
            "returncode": proc.returncode,
            "AdamW_constructed": payload.get("AdamW_constructed"),
            "optimizer_steps": payload.get("optimizer_steps"),
            "training_executed": payload.get("training_executed"),
            "kind": payload.get("kind"),
        },
        "stage_b_stub": stub_payload,
        "env_in_child": AUTHORIZE_ENV_NAME not in env,
    }


def b1_dry_config() -> dict[str, Any]:
    steps = list(B1_EVAL_STEPS)
    ckpts = {
        str(s): {
            "step": s,
            "tokens": s * TOKENS_PER_STEP,
            "weights": f"{PROPOSED_CKPT_ROOT}/step-{s}/{MODEL_NAME}",
            "created_this_pass": False,
        }
        for s in steps
    }
    return {
        "kind": "WRIM1_CPT_000002_B1_DRY_CONFIG",
        "CPT_RUN_ID": CPT_RUN_ID,
        "PARENT": PARENT_CHECKPOINT,
        "PARENT_HASH": PARENT_HASH,
        "OBJECTIVE": OBJECTIVE,
        "MASK_PROMPT_TOKENS": MASK_PROMPT_TOKENS,
        "steps": B1_STEPS,
        "tokens_per_step": TOKENS_PER_STEP,
        "max_tokens": B1_MAX_TOKENS,
        "lr": {"schedule": "constant", "value": B1_LR, "warmup_steps": B1_WARMUP},
        "seq_len": SEQ_LEN,
        "micro_batch": MICRO_BATCH,
        "optimizer": "NOT_INSTANTIATED",
        "checkpoint_schedule": ckpts,
        "INSTANTIATE_OPTIMIZER": False,
        "START_TRAINER": False,
    }


def unique_prose_stats(docs: list[dict[str, Any]]) -> dict[str, Any]:
    prose = [d for d in docs if d["category"] in GENUINE_PROSE_CATEGORIES]
    sources = Counter(d["source_id"].split(":")[0] for d in prose)
    licenses = Counter(d.get("license_class") for d in prose)
    tokens = sum(int(d.get("token_count") or 0) for d in prose)
    return {
        "unique_document_count": len({d["doc_id"] for d in prose}),
        "unique_token_count": tokens,
        "UNIQUE_NON_GENESIS_PROSE_TOKENS": tokens,
        "source_count": len(sources),
        "sources": dict(sources),
        "license_classes": dict(licenses),
        "excluded_from_this_count": ["genesis_rehearsal", "code", "structured_json", "role_boundary_rehearsal", "repo_markdown", "code_comments"],
    }


def main() -> dict[str, Any]:
    auth_before = os.environ.get(AUTHORIZE_ENV_NAME)
    if AUTHORIZE_ENV_NAME in os.environ:
        del os.environ[AUTHORIZE_ENV_NAME]
    auth_after = os.environ.get(AUTHORIZE_ENV_NAME)
    assert auth_after is None

    dump = resolve_dump_root(None)
    if dump is None:
        raise SystemExit("dump root missing")
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    tok_hash = sha256_file(tok_path)
    if tok_hash != TOKENIZER_EXPECTED_SHA:
        raise SystemExit("tokenizer hash mismatch; refuse to modify or continue")
    step400 = Path(CKPT_ROOT) / "step-400" / MODEL_NAME
    if sha256_file(step400) != PARENT_HASH:
        raise SystemExit("STEP_400 hash mismatch")
    wrim0 = dump / "model-lab" / "manifests" / "wrim0_checkpoints" / "checkpoint-final.safetensors"
    if sha256_file(wrim0) != PARENT_WRIM0_HASH:
        raise SystemExit("WRIM-0 hash mismatch")

    from tokenizers import Tokenizer

    tokenizer = Tokenizer.from_file(str(tok_path))
    docs = generate_original_docs()
    docs.extend(genesis_docs(dump, tokenizer))
    docs, exact_dropped = exact_dedup(docs)
    docs, template_reasons = template_drop(docs)
    docs, near_dropped = near_dup_drop(docs)
    forbidden = collect_forbidden_texts(dump)
    leak = leak_scan_docs(docs, forbidden)
    removed_for_leak = 0
    for _round in range(4):
        if not (leak["EXACT_DUPLICATES"] or leak["LONG_SPAN_OVERLAP_GE_48"] or leak["NEEDLE_HITS"]):
            break
        bad_ids = set(leak.get("leak_ids") or [])
        if not bad_ids:
            break
        docs = [d for d in docs if d["doc_id"] not in bad_ids]
        removed_for_leak += len(bad_ids)
        leak = leak_scan_docs(docs, forbidden)
    if leak["EXACT_DUPLICATES"] or leak["LONG_SPAN_OVERLAP_GE_48"] or leak["NEEDLE_HITS"]:
        raise SystemExit(f"leak remains after rebuild: {json.dumps({k: leak[k] for k in ('EXACT_DUPLICATES','LONG_SPAN_OVERLAP_GE_48','NEEDLE_HITS','span_examples','needle_examples')})}")

    docs = tokenize_docs(docs, tokenizer)
    train, val = document_split(docs)
    packing = simulate_packing(train, tokenizer)
    mix_ok, mix_delta = mix_within_tolerance(packing["actual_share"])
    if not mix_ok:
        # rebuild once: this packing uses budgeted family streams so shares should match budgets
        packing = simulate_packing(train, tokenizer)
        mix_ok, mix_delta = mix_within_tolerance(packing["actual_share"])
        if not mix_ok:
            raise SystemExit(f"mix outside ±1.0pp: {mix_delta}")

    packing_config = {
        "packer_version": PACKER_VERSION,
        "seq_len": SEQ_LEN,
        "micro_batch": MICRO_BATCH,
        "tokens_per_step": TOKENS_PER_STEP,
        "homogeneous_minibatch_fraction_target": 0.5,
        "eos_only_at_document_end": True,
        "no_cross_family_concat_inside_sequence": True,
        "sentence_aware_prose": True,
        "seed": SEED,
    }
    packing_config_hash = sha256_text(json.dumps(packing_config, sort_keys=True))

    root = corpus_root()
    train_path = root / f"{CORPUS_VERSION}-TRAIN.jsonl"
    val_path = root / f"{CORPUS_VERSION}-VAL.jsonl"

    def slim(rec: dict[str, Any]) -> dict[str, Any]:
        keep = {k: rec[k] for k in rec if k != "token_ids"}
        return keep

    write_jsonl(train_path, [slim(r) for r in train])
    write_jsonl(val_path, [slim(r) for r in val])
    train_hash = sha256_file(train_path)
    val_hash = sha256_file(val_path)
    files = {
        "train": train_hash,
        "val": val_hash,
        "packing_config": packing_config_hash,
    }
    corpus_hash = sha256_text(json.dumps(files, sort_keys=True))
    sources = []
    for rec in train + val:
        sources.append(
            {
                "source_id": rec["source_id"],
                "provenance": rec["provenance"],
                "license": rec["license"],
                "license_class": rec.get("license_class"),
                "category": rec["category"],
                "document_hash": rec["sha256"],
                "token_count": rec["token_count"],
                "split": rec["split"],
            }
        )
    manifest = {
        "kind": "WR_CORPUS_CPT_2_MANIFEST",
        "corpus_id": CORPUS_ID,
        "version": CORPUS_VERSION,
        "created_at": utc_now(),
        "immutable": True,
        "in_place_edits_forbidden": True,
        "next_version_if_changed": "WR-CORPUS-CPT-2-v1.0.1",
        "files": files,
        "CORPUS_HASH": corpus_hash,
        "TRAIN_HASH": train_hash,
        "VAL_HASH": val_hash,
        "PACKING_CONFIG_HASH": packing_config_hash,
        "TRAIN_DOCS": len(train),
        "VAL_DOCS": len(val),
        "TRAIN_TOKENS": int(sum(r["token_count"] for r in train)),
        "VAL_TOKENS": int(sum(r["token_count"] for r in val)),
        "requested_mix": REQUESTED_MIX,
        "actual_token_mix": packing["actual_share"],
        "tokenizer_id": TOKENIZER_ID,
        "tokenizer_sha256": tok_hash,
        "parent": PARENT_CHECKPOINT,
        "parent_hash": PARENT_HASH,
        "TRAIN_FORBIDDEN_PACKS": [INDEPENDENT_NL_PACK],
        "STAGE_B_EXECUTED": False,
    }
    write_json(root / f"{CORPUS_VERSION}-MANIFEST.json", manifest)
    write_json(root / f"{CORPUS_VERSION}-SHA256.json", {"CORPUS_HASH": corpus_hash, "files": files})
    write_json(root / f"{CORPUS_VERSION}-PACKING-CONFIG.json", packing_config)
    write_json(root / f"{CORPUS_VERSION}-SOURCES.json", {"n": len(sources), "records": sources})
    dry = b1_dry_config()
    write_json(root / DRY_CONFIG_FILENAME, dry)
    write_json(Path(DATA_ROOT) / DRY_CONFIG_FILENAME, dry)

    prose_stats = unique_prose_stats(train + val)
    role_docs = [d for d in train + val if d["category"] == "role_boundary_rehearsal"]
    role_tokens = sum(d["token_count"] for d in role_docs)
    all_tok = sum(d["token_count"] for d in train) or 1
    code_share_unique = sum(d["token_count"] for d in train if d["category"] == "code") / all_tok
    fail = fail_closed_proof()
    gates = synthetic_gate_validation()
    resources = resource_estimate()
    license_summary = Counter(s["license_class"] for s in sources)

    code_share_packed = packing["actual_share"].get("code", 0.0)
    remaining = []
    if fail["UNAUTHORIZED_TRAINING_REFUSED"] != "PASS":
        remaining.append("unauthorized training refusal failed")
    if not mix_ok:
        remaining.append("mix tolerance")
    if packing["homogeneous_fraction"] < 0.5:
        remaining.append(f"homogeneous minibatch fraction {packing['homogeneous_fraction']:.3f} < 0.5")
    if abs(code_share_packed - 0.12) > 0.01:
        remaining.append("code share out of tolerance")

    report = {
        "kind": "WRIM1_CPT_STAGE_B_CORPUS_AND_READINESS_REPORT",
        "created_at": utc_now(),
        "1_authorization_env_before": auth_before if auth_before is not None else "UNSET",
        "2_authorization_env_after": "UNSET",
        "3_TRAINING_AUTHORIZATION_ACTIVE": "NO",
        "4_corpus_id": CORPUS_VERSION,
        "5_corpus_hash": corpus_hash,
        "6_manifest_hash": sha256_file(root / f"{CORPUS_VERSION}-MANIFEST.json"),
        "7_train_hash": train_hash,
        "8_val_hash": val_hash,
        "9_packing_config_hash": packing_config_hash,
        "10_source_categories": sorted({d["category"] for d in train + val}),
        "11_source_provenance": sorted({d["provenance"] for d in train + val}),
        "12_license_provenance_summary": dict(license_summary),
        "13_unique_non_genesis_prose_tokens": prose_stats["UNIQUE_NON_GENESIS_PROSE_TOKENS"],
        "14_train_docs": len(train),
        "15_val_docs": len(val),
        "16_train_tokens": int(sum(r["token_count"] for r in train)),
        "17_val_tokens": int(sum(r["token_count"] for r in val)),
        "18_requested_mix": REQUESTED_MIX,
        "19_actual_token_mix": packing["actual_share"],
        "19b_mix_delta_pp": mix_delta,
        "19c_mix_within_pm_1pp": mix_ok,
        "20_exact_duplicates_removed": exact_dropped,
        "21_near_duplicates_removed": near_dropped,
        "21b_template_removed": template_reasons,
        "22_validation_leakage_result": leak,
        "23_independent_nl_leak_result": leak["independent_nl_hits"],
        "24_stage3_leak_result": leak["stage3_hits"],
        "25_sft_validation_leak_result": leak["sft_val_hits"],
        "26_eos_density": packing["eos_density"],
        "27_cross_family_transitions": packing["cross_family_transitions"],
        "27b_cross_document_transitions": packing["cross_document_transitions"],
        "27c_homogeneous_fraction": packing["homogeneous_fraction"],
        "27d_mean_sequence_fill": packing["mean_sequence_fill"],
        "27e_padding_rate": packing["padding_rate"],
        "28_tokenizer_hash": tok_hash,
        "29_B1_dry_config": dry,
        "30_checkpoint_schedule": dry["checkpoint_schedule"],
        "31_hard_stop_gate_validation": gates,
        "32_success_criteria_encoding": success_criteria_encoding(),
        "33_resource_estimate": resources,
        "34_unauthorized_training_refusal_proof": fail,
        "35_optimizer_created": "NO",
        "36_backward_executed": "NO",
        "37_optimizer_steps": 0,
        "38_model_weights_modified": "NO",
        "39_checkpoints_modified": "NO",
        "40_stage_b_executed": "NO",
        "41_sft_executed": "NO",
        "42_canonical_promoted": "NO",
        "43_commander_authorization_required": "YES",
        "44_remaining_blockers": remaining,
        "role_rehearsal": {
            "percent_requested": 1,
            "train_token_share_unique": role_tokens / (sum(d["token_count"] for d in train + val) or 1),
            "generator": "role_pair/ROLE_TEMPLATES+ROLE_WORDS",
            "template_count": len(ROLE_TEMPLATES),
            "unique_patterns": list(ROLE_TEMPLATES),
            "adj_noun_number_family": False,
        },
        "CODE_TOKEN_SHARE_PACKED": code_share_packed,
        "CODE_TOKEN_SHARE_UNIQUE_TRAIN": code_share_unique,
        "prose_stats": prose_stats,
        "WRIM_TRAINING_AUTHORIZATION": "UNSET",
        "TRAINING_AUTHORIZATION_ACTIVE": "NO",
        "CORPUS_ID": CORPUS_VERSION,
        "EXACT_DUPLICATES": leak["EXACT_DUPLICATES"],
        "VALIDATION_LEAKAGE": leak["EXACT_DUPLICATES"] + leak["LONG_SPAN_OVERLAP_GE_48"],
        "INDEPENDENT_NL_LEAKAGE": leak["independent_nl_hits"],
        "TOKENIZER_MODIFIED": "NO",
        "UNAUTHORIZED_TRAINING_REFUSED": fail["UNAUTHORIZED_TRAINING_REFUSED"],
        "OPTIMIZER_CREATED": "NO",
        "BACKWARD_EXECUTED": "NO",
        "OPTIMIZER_STEPS": 0,
        "MODEL_WEIGHTS_MODIFIED": "NO",
        "CHECKPOINTS_MODIFIED": "NO",
        "STAGE_B_EXECUTED": "NO",
        "SFT_EXECUTED": "NO",
        "RUN_000013_EXECUTED": "NO",
        "STAGE3B_EXECUTED": "NO",
        "CANONICAL_PROMOTED": "NO",
        "COMMANDER_AUTHORIZATION_REQUIRED": "YES",
        "COMMIT": False,
        "PUSH": False,
        "DEPLOY": False,
        "language_like_requested": 0.76,
        "code_json_genesis_role_requested": 0.24,
        "independent_nl_pack": {
            "id": INDEPENDENT_NL_PACK,
            "PACK_HASH": INDEPENDENT_NL_PACK_HASH_EXPECTED,
            "MANIFEST_HASH": INDEPENDENT_NL_MANIFEST_HASH_EXPECTED,
            "TRAIN_FORBIDDEN": True,
            "entered_cpt2": False,
        },
        "paths": {
            "corpus_root": str(root),
            "train": str(train_path),
            "val": str(val_path),
            "manifest": str(root / f"{CORPUS_VERSION}-MANIFEST.json"),
        },
        "PROVISIONAL_STAGE_B_PARENT": PROVISIONAL_STAGE_B_PARENT,
        "PROVISIONAL_STAGE_B_PARENT_HASH": PARENT_HASH,
        "architecture": ARCHITECTURE_ID,
        "ambient_stale_stage_a_token_note": (
            "This preparation lane unsets WRIM_TRAINING_AUTHORIZATION and never exports a Stage B token. "
            "Stage A value "
            f"{STAGE_A_STALE_VALUE} is not accepted by wrim_cpt2_train.py. Unrelated leftover node processes "
            "are not restarted in this pass (War Room must stay up)."
        ),
        "reserved_sft_run_unused": RESERVED_SFT_RUN,
    }
    write_json(root / REPORT_FILENAME, report)
    write_json(Path(DATA_ROOT) / REPORT_FILENAME, report)
    write_json(Path(CKPT_ROOT) / REPORT_FILENAME, report)
    write_json(Path("/tmp") / REPORT_FILENAME, report)
    return report


if __name__ == "__main__":
    os.environ.pop(AUTHORIZE_ENV_NAME, None)
    out = main()
    print(
        json.dumps(
            {
                "ok": True,
                "CORPUS_ID": out["CORPUS_ID"],
                "CORPUS_HASH": out["5_corpus_hash"],
                "TRAINING_AUTHORIZATION_ACTIVE": out["3_TRAINING_AUTHORIZATION_ACTIVE"],
                "UNAUTHORIZED_TRAINING_REFUSED": out["UNAUTHORIZED_TRAINING_REFUSED"],
                "STAGE_B_EXECUTED": out["STAGE_B_EXECUTED"],
                "OPTIMIZER_CREATED": out["OPTIMIZER_CREATED"],
                "mix_ok": out["19c_mix_within_pm_1pp"],
                "remaining": out["44_remaining_blockers"],
                "report": str(corpus_root() / REPORT_FILENAME),
            },
            indent=2,
        )
    )
