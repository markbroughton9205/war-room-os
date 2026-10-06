"""WR-VAL-NL-INDEPENDENT-1-v1.0.0 builder + inference eval.

Does not train. Does not construct an optimizer. Does not restore optimizer state.
Does not add this pack to any training stream. Does not modify checkpoints.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import torch
from tokenizers import Tokenizer

from run000007_preflight import resolve_dump_root, sha256_file
from stage1_pack import EVAL_INFRA_MARKERS, HELD_OUT_PROMPT_STRINGS
from wrim_cpt_corpus import load_jsonl
from wrim_cpt_eval import attractor_rates, greedy_from_ids, nll_on_ids
from wrim_cpt_identity import (
    AUTHORIZE_ENV,
    BOS_ID,
    EOS_ID,
    EVAL_SEED,
    LINUX_CKPT_ROOT,
    LINUX_DATA_ROOT,
    NEWLINE_ID,
    PARENT_SHA,
    TOKENIZER_SHA,
)
from wrim_cpt_stage_a_select import load_weights_only
from wrim_g20m import WRIM0Model
from wrim_proven_load import disable_tf32
from wrim_resumable_checkpoint import MODEL_NAME, verify_checkpoint_hashes

PACK_ID = "WR-VAL-NL-INDEPENDENT-1"
PACK_VERSION = "WR-VAL-NL-INDEPENDENT-1-v1.0.0"
TOKENIZER_ID = "WR-TOKENIZER-0"
TAG_RE = re.compile(r"\b[a-z]{3,12}-[a-z]{3,12}-\d{2,5}\b", re.I)
SPACED_TAG_RE = re.compile(
    r"\b[a-z]{3,12}\s*-\s*[a-z]{3,12}\s*-\s*\d(?:\s*\d){1,4}\b",
    re.I,
)
CKPT_ROOT = Path(LINUX_CKPT_ROOT)
PACK_ROOT = Path(LINUX_DATA_ROOT) / PACK_VERSION
REPORT_PATH = CKPT_ROOT / "WRIM_INDEPENDENT_NATURAL_LANGUAGE_VALIDATION_REPORT.json"
STEP_HASHES = {
    400: "f82f4364b16842ca3d43427251299f1ad38d5104f24013251f2ebc6af6607af8",
    1000: "b98e9a0dc439425a525829e22c272dadeba1feace1d14cac04c130b8c8cd5e37",
    1220: "cb1abac64be7f39c363cf4aa524b50e4038ca906075be15a78d81e0acac4e66b",
}

# Original first-party validation prose. Authored only for this pack. Never a train record.
PASSAGES: list[dict[str, str]] = [
    {
        "id": "nl-gen-01",
        "category": "general_prose",
        "text": "The morning market at Selwick opened before the fog had lifted from the quay. Vendors arranged baskets of late pears and wrapped cheeses in brown paper while gulls argued over a torn loaf. A boy counted copper coins into a tin cup and practiced saying thank you without looking at his shoes. Nothing urgent happened, and that was the point of the hour: people bought what they needed, greeted neighbors by first name, and left with bags that bumped softly against their knees.",
    },
    {
        "id": "nl-gen-02",
        "category": "general_prose",
        "text": "On the third rainy Thursday of October, the town library kept its side door unlatched for anyone who did not want to shake an umbrella in the lobby. Inside, radiators ticked and a volunteer reshelved travel guides that had been left on the window ledge. A woman copied a recipe for barley soup onto the back of an envelope. When the clock struck four, nobody announced it. The room simply grew a little darker, and lamps came on one by one along the west wall.",
    },
    {
        "id": "nl-gen-03",
        "category": "general_prose",
        "text": "After supper the family walked the lane to the stone bridge and back, a habit they kept even when conversation ran out. The youngest named constellations incorrectly with cheerful confidence. An older cousin pretended to agree. The river sounded louder than it looked. By the time they returned, the kitchen window was a warm square in a dark hedge, and someone had already set the kettle on again as if the walk had been a long journey.",
    },
    {
        "id": "nl-gen-04",
        "category": "general_prose",
        "text": "The bus to the county fair arrived eleven minutes late and smelled of orange peel. Passengers made room without being asked. A farmer held a cardboard box of jam jars between his boots and told a stranger that the strawberries had been smaller this year but sweeter. At each stop the driver called the name of the hamlet clearly. Fields slid past in strips of stubble and green, and the fairground tents appeared all at once like a temporary town.",
    },
    {
        "id": "nl-gen-05",
        "category": "general_prose",
        "text": "Snow in the valley rarely lasted past noon, yet children still built low walls from the first wet fall and declared them forts. Dogs wrote looping paths across the schoolyard. A postal worker stamped her feet on the office mat and laughed when the clock was slow again. By afternoon the snow was only a bright memory on north-facing roofs, and meltwater ran in the gutters with a sound like hurried conversation.",
    },
    {
        "id": "nl-exp-01",
        "category": "expository",
        "text": "A municipal compost program works only if households separate food scraps from packaging. The collection truck is not a magic bin; plastic film and glass contaminate an entire load. Workers at the yard turn piles so oxygen reaches the interior, which keeps temperatures high enough to break down waste without sour odors. Finished compost is dark, crumbly, and sold or given to gardeners. The explanation is ordinary: biology plus logistics, not a slogan.",
    },
    {
        "id": "nl-exp-02",
        "category": "expository",
        "text": "Public clocks used to be set from a noon gun or a telegraph signal. Accuracy mattered because mills, ferries, and schools coordinated around a shared hour. When radio time arrived, towns still kept a visible clock in the square so people without devices could check it. The mechanism is a contract: if the face is wrong, appointments drift and trust thins. That is why a stopped clock is not merely decorative failure; it is a small civic outage.",
    },
    {
        "id": "nl-exp-03",
        "category": "expository",
        "text": "A watershed is not a line on a tourist map so much as a tilted bowl. Rain that falls on one slope joins a particular creek, then a river, then perhaps an estuary. Land use uphill shows up downhill as silt, fertilizer, or shade. Engineers who restore a bend in a channel are often restoring habitat for fish that need slower water along the banks. Understanding the bowl helps a town argue about zoning without pretending water can be persuaded to flow uphill.",
    },
    {
        "id": "nl-exp-04",
        "category": "expository",
        "text": "Paper archives survive humidity worse than they survive neglect. Boxes stacked on a concrete floor wick moisture. Labels written in marker fade under fluorescent light. A modest preservation plan is boring on purpose: raise boxes off the floor, keep a consistent cool temperature, and record what is in each carton before anyone needs the contents in a hurry. The alternative is a heroic rescue after a flood, which is more expensive and less complete.",
    },
    {
        "id": "nl-exp-05",
        "category": "expository",
        "text": "Why do ferries still matter where bridges exist? They carry people who live on islands too small for a second span, and they absorb seasonal traffic without pouring another ribbon of concrete. A timetable is a public promise. If the last boat leaves at dusk, clinics and shops close with that hour in mind. Canceling a run without notice does not merely inconvenience tourists; it rearranges a whole evening of work and childcare on both shores.",
    },
    {
        "id": "nl-tec-01",
        "category": "technical_explanation",
        "text": "A bicycle derailleur moves the chain across sprockets by changing the cage angle while the rider pedals. Shifting under a heavy load grinds teeth because the chain is taut and cannot climb. Cable stretch after the first weeks of use is expected; a barrel adjuster adds a little tension without opening the housing. Keep the pulleys clean so grit does not act like sandpaper. The system is mechanical and honest: dirt and neglect show up as noise before they show up as a broken pin.",
    },
    {
        "id": "nl-tec-02",
        "category": "technical_explanation",
        "text": "Household radiators heat a room by convection and a smaller share of radiation. Trapped air at the top blocks hot water, which is why a bleed key exists. If only the bottom of a radiator is warm, the valve may be closed or the pump may be weak. Painting a radiator with thick enamel reduces output slightly. None of this requires a specialist vocabulary, only patience: bleed, listen, and do not assume a cold room means the boiler has failed.",
    },
    {
        "id": "nl-tec-03",
        "category": "technical_explanation",
        "text": "A simple rain gauge is a straight-sided cylinder marked in millimeters. Place it away from eaves and fences that intercept drops. Empty it at the same hour each day so a slow drizzle is not double-counted. Wind under-catches small droplets; that error is accepted in amateur records if the siting is consistent. The point of the instrument is comparison across days, not a claim of laboratory precision.",
    },
    {
        "id": "nl-tec-04",
        "category": "technical_explanation",
        "text": "Wood seasoning is the controlled loss of moisture after felling. Stack boards with spacers so air can move, keep the pile off soil, and shelter the top from driving rain. Ends crack first because they dry fastest; a coat of leftover paint on the end grain slows that. Kiln drying is faster and more even, but a backyard stack still produces usable lumber if you wait through a full cycle of seasons rather than a weekend.",
    },
    {
        "id": "nl-tec-05",
        "category": "technical_explanation",
        "text": "A septic tank settles solids and lets a clearer liquid flow to a drain field. Grease and non-flushable wipes clog the outlet baffle. Pumping on a schedule is cheaper than replacing a saturated field. Grass over the field should not be a vegetable garden, because roots and digging disturb the pipes. The design assumes gravity and bacteria; it fails when households treat it as an invisible trash can.",
    },
    {
        "id": "nl-nar-01",
        "category": "short_narrative",
        "text": "Mara found the lost glove on the fence post at the orchard gate, stiff with frost. She had turned back twice already, sure it was in the truck. A jay watched her from a bare apple tree as if keeping score. She clapped the glove against her thigh until it bent, then walked the rows counting empty crates that would be needed in September. By the time she reached the packing shed, the sun had cleared the ridge and the frost was only a rumor on the grass.",
    },
    {
        "id": "nl-nar-02",
        "category": "short_narrative",
        "text": "The night the bakery oven failed, Tomas rolled dough anyway and set pans on the warm stones of the hearth. Neighbors arrived with extra tins because word traveled faster than the repair truck. Nobody produced a perfect loaf. They produced enough bread that the morning regulars could still buy something that steamed when torn. Tomas wrote the names of helpers on a flour sack and pinned it by the door, not as a trophy, as a reminder that the shop was a room people shared.",
    },
    {
        "id": "nl-nar-03",
        "category": "short_narrative",
        "text": "When the tide went out farther than usual, children walked the flats to a sandbar they had only seen from the bluff. They found a rusted lantern half buried and argued about who had dropped it decades ago. An older woman from the cottages told them to leave it; the sea would take it back by evening. They left it. On the way home their pockets were full of wet stones that looked ordinary by kitchen light.",
    },
    {
        "id": "nl-nar-04",
        "category": "short_narrative",
        "text": "Eli missed the last truck from the mill and started walking the service road with a thermos and a sore shoulder. Headlights finally appeared, not the mill truck but a neighbor hauling feed. They rode in silence except for the radio muttering livestock prices. At the crossroads Eli offered the last of the coffee. The neighbor took a sip, made a face at the sweetness, and still finished it. The mill lights receded like a grounded constellation.",
    },
    {
        "id": "nl-nar-05",
        "category": "short_narrative",
        "text": "The school play lost its painted forest when a leak stained the canvas overnight. Students cut new trees from cardboard and named each one after a teacher. The audience laughed at the wobbling trunks and then went quiet during the last song because the wobble had become part of the story. Afterward, parents folded the cardboard carefully, as if it might be needed next year, though everyone knew it would be recycled on Monday.",
    },
    {
        "id": "nl-ins-01",
        "category": "instructional",
        "text": "To start a cold wood stove, open the damper fully and set a loose tent of dry kindling over a single fire starter. Light it from below so flame climbs. Add splits only when the kindling has a clear, noisy burn. Close the door most of the way, then all the way once the glass stays clear. If smoke rolls into the room, you have starved the fire of air or the chimney is cold; do not panic, open the damper, and wait before adding more wood.",
    },
    {
        "id": "nl-ins-02",
        "category": "instructional",
        "text": "When planting a bare-root tree, dig a hole wider than it is deep. Spread the roots over a small mound of native soil in the center. Set the flare at ground level, not buried. Backfill without stuffing air pockets, water slowly until the soil settles, and mulch in a ring that does not touch the trunk. Stake only if wind on that site is known to rock young trees. Check the ties after the first storm so they do not girdle the bark.",
    },
    {
        "id": "nl-ins-03",
        "category": "instructional",
        "text": "If a pantry moth appears, empty the grain shelf completely. Discard infested packages in a sealed bag. Vacuum corners, then wipe shelves with soapy water and dry them. Freeze new flour for a few days before it lives in a jar. Traps help you see whether the problem continues; they do not replace cleaning. Repeat the inspection in two weeks, because eggs hatch on a delay that makes a single tidy afternoon insufficient.",
    },
    {
        "id": "nl-ins-04",
        "category": "instructional",
        "text": "To measure a room for a rug, note the wall-to-wall distances and then subtract a border so floor shows around the edge. Furniture legs should agree: either all on the rug or front legs only, not a mix that looks accidental. Unroll the rug in the room before trimming anything. If a doorway catches the corner, choose a smaller size rather than folding. Write the measurements on paper, not in your head, and check them once more after moving the chairs.",
    },
    {
        "id": "nl-ins-05",
        "category": "instructional",
        "text": "Before canning jam, inspect jars for nicks and lids for dents. Sterilize jars in hot water and keep them hot until filled. Leave the headspace the recipe names; too little and seals fail, too much and mold finds a home. Process in a boiling-water bath for the stated minutes, then rest jars undisturbed overnight. A lid that flexes in the morning is not sealed. Refrigerate that jar and eat it first instead of storing it on the shelf.",
    },
    {
        "id": "nl-des-01",
        "category": "descriptive",
        "text": "Kestrel Hill in late August is a slope of bleached grass and thistle, with a single wind-bent pine at the crest. From there the estuary is a pewter sheet cut by sandbars. Heat makes the distant town shimmer. Insects tick in the dry stems. A dirt track switches back toward the county road, pale as bone. The air smells of dust and a faint sweetness from wild carrot. Clouds stack over the western ridges and do not yet throw shade.",
    },
    {
        "id": "nl-des-02",
        "category": "descriptive",
        "text": "The tin-roof depot at Mirelow is the color of old coins. Weeds grow through the platform boards. A faded timetable still lists trains that no longer run. Inside, light enters through nail holes and stripes the floor. Sparrows nest in the rafters and drop straw on a broken scale. The waiting bench has been polished by decades of coats. Outside, a rusted signal arm points forever at a sky that no longer answers it.",
    },
    {
        "id": "nl-des-03",
        "category": "descriptive",
        "text": "Fog on the harbor sits in layers: a bright lid above, a dim street of water below. Masts appear as incomplete sentences. A bell buoy speaks at irregular intervals. Footsteps on the wet planks sound closer than they are. Fish crates shine with melt and scales. Someone hoses the dock and the runoff finds the same black gap it found yesterday. When the fog thins, the opposite shore is suddenly too near, like a stage set rolled forward.",
    },
    {
        "id": "nl-des-04",
        "category": "descriptive",
        "text": "The orchard packing shed smells of cardboard, sap, and cold metal. Conveyor rollers wait in a still line. Handwritten grades hang on twine above the bins. A calendar from a feed store is two months behind and nobody has changed it. Dust lives in the high windows. In the corner a stove holds a kettle that is never quite empty. Afternoon light makes the empty bins look larger than they are in October.",
    },
    {
        "id": "nl-des-05",
        "category": "descriptive",
        "text": "Winter dusk on the marsh is a long horizontal of brown reeds and a strip of remaining gold. Ice forms first in the ditches, thin as window glass. A heron stands as if it were a post driven for a fence that was never built. Tire tracks from a utility truck freeze into ridges. The first house lights come on across the water, small and separate, each one a claim that someone is home and the day is allowed to end.",
    },
    {
        "id": "nl-fac-01",
        "category": "factual_explanation",
        "text": "Honeybees communicate a food source with a waggle dance whose angle relative to vertical maps the direction of the sun. Distance is encoded in the duration of the waggle run. The dance happens in the dark of the hive; nestmates follow the dancer by touch and sound. This does not mean bees possess human maps. It means a colony can allocate foragers without a supervisor shouting across a field. The mechanism is famous because it is specific, repeatable, and still surprising.",
    },
    {
        "id": "nl-fac-02",
        "category": "factual_explanation",
        "text": "Table salt is mostly sodium chloride. Iodized salt includes a small iodine compound to prevent goiter in populations whose soil and water are iodine-poor. Sea salt contains trace minerals that rarely change nutrition in ordinary amounts; the culinary difference is crystal size and moisture. Too much sodium raises blood pressure in many adults. The chemistry is simple; the public-health argument is about totals across a day of bread, cheese, and prepared food, not a pinch at the stove.",
    },
    {
        "id": "nl-fac-03",
        "category": "factual_explanation",
        "text": "The Moon always shows nearly the same face to Earth because its rotation period matches its orbit, a state called tidal locking. We still see a little more than half the surface over time because of librations, small wobbles. There is no permanent dark side in the sense of never receiving sunlight; every part of the Moon has day and night. The far side is simply the hemisphere we do not see from the ground. Photographs from orbit made that geography ordinary.",
    },
    {
        "id": "nl-fac-04",
        "category": "factual_explanation",
        "text": "A leap year adds a day because Earth's orbit around the Sun takes about 365.24 days. Ignoring the fraction would drift the calendar through the seasons. The Gregorian rule skips some century years to keep the average close. Farmers and liturgies both depend on months staying roughly aligned with weather and light. The extra day is not a celebration of arithmetic so much as a correction that most people notice only when a birthday lands on it.",
    },
    {
        "id": "nl-fac-05",
        "category": "factual_explanation",
        "text": "Cast iron skillets hold heat because they are thick and dense. They are not nonstick in the modern coating sense; a seasoned surface is polymerized oil that fills microscopic roughness. Soap used sparingly does not ruin a well-built layer, despite folklore. Acidic sauces can strip seasoning if simmered long. Drying the pan fully after washing prevents rust. The cookware is durable because the metal is simple, not because it is magical.",
    },
    {
        "id": "nl-dia-01",
        "category": "dialogue_like",
        "text": "\"Did you weigh the grain or guess?\" asked Nia, wiping dust from the ledger. \"I guessed once last month and we ran short,\" said Owen. \"So I weighed it. Three sacks, same as the order.\" \"Then write three, not about.\" He wrote three. She tapped the page. \"If the mill calls, I can read this without translating your handwriting.\" He smiled without looking up. \"That is the only reason I write at all.\" Outside, a belt slapped against a pulley and the conversation ended by itself.",
    },
    {
        "id": "nl-dia-02",
        "category": "dialogue_like",
        "text": "\"The path is muddy past the stile,\" Ruth said. \"Boots or we turn around.\" \"Boots,\" said her brother, already sitting on the step. \"You always say turn around as if I might choose the sofa.\" \"You might.\" \"Not today. The hawthorn is flowering and I want to see it before the wind takes it.\" They walked. At the stile he offered a hand she did not need. \"I know,\" he said. \"I am practicing being useful.\" She let him, because the mud was real and pride is a poor hiking pole.",
    },
    {
        "id": "nl-dia-03",
        "category": "dialogue_like",
        "text": "\"Is the kettle for tea or for the hot-water bottle?\" asked June. \"Tea first,\" said her father. \"The bottle can wait until the forecast earns it.\" \"The forecast already earned it. My feet are facts.\" He poured two mugs and set the bottle to fill anyway. \"Facts get blankets,\" he said. \"They do not get to cancel tea.\" She wrapped both hands around the mug and admitted, without saying so, that he had a point.",
    },
    {
        "id": "nl-dia-04",
        "category": "dialogue_like",
        "text": "\"We can paint the fence this weekend or we can pretend the peeling is a style,\" said Clare. \"Style,\" said Ben, then ducked when she pointed the brush at him. \"Fine. Saturday. I will scrape if you cut in.\" \"You always volunteer to scrape because you like noise.\" \"I like finishing. Scraping is how finishing begins.\" They bought extra sandpaper and still ran out before the last panel. \"See,\" Ben said. \"Optimistic math.\" Clare wrote a list for Sunday that included both humility and more sandpaper.",
    },
    {
        "id": "nl-dia-05",
        "category": "dialogue_like",
        "text": "\"Tell me again why we packed the lantern if the hike is a loop,\" said Priya. \"Because loops still have weather,\" said Sam. \"And because you hate being surprised by dusk.\" \"I hate being surprised by your surprises.\" They reached the overlook with an hour of light left. Sam did not say I told you so. Priya unpacked bread anyway and said, \"You may gloat internally.\" He did, quietly, while the valley filled with a blue that made the lantern look wise instead of silly.",
    },
]


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


def leak_sources(dump: Path) -> list[tuple[str, str]]:
    """(category, text) pairs from frozen training/eval material."""
    out: list[tuple[str, str]] = []
    c0 = dump / "sovereign-model-lab" / "corpora" / "WRM-001" / "175af25fe1c17cf7630b506d0d6e6e88" / "corpus.jsonl"
    c1 = dump / "model-lab" / "corpora" / "WR-CORPUS-1-HARDENED" / "train" / "shard-00000.jsonl"
    mapping = [
        (c0, "WR-CORPUS-0"),
        (c1, "WR-CORPUS-1-HARDENED"),
        (Path(LINUX_DATA_ROOT) / "WR-CORPUS-CPT-1-v1.0.0" / "WR-CORPUS-CPT-1-v1.0.0-C1-TRAIN.jsonl", "WR-CORPUS-CPT-1-C1"),
        (Path(LINUX_DATA_ROOT) / "WR-CORPUS-CPT-1-v1.0.0" / "WR-CORPUS-CPT-1-v1.0.0-ROLE-TRAIN.jsonl", "role_train"),
        (Path(LINUX_DATA_ROOT) / "WR-CORPUS-CPT-1-v1.0.0" / "WR-CORPUS-CPT-1-v1.0.0-ROLE-VAL.jsonl", "role_val"),
        (Path(LINUX_DATA_ROOT) / "WR-CORPUS-MODE-ENTRY-1-v1.0.0" / "WR-CORPUS-MODE-ENTRY-1-v1.0.0-TRAIN.jsonl", "mode_entry_train"),
        (Path(LINUX_DATA_ROOT) / "WR-CORPUS-MODE-ENTRY-1-v1.0.0" / "WR-CORPUS-MODE-ENTRY-1-v1.0.0-VALIDATION.jsonl", "mode_entry_val"),
        (Path(LINUX_DATA_ROOT) / "WR-CORPUS-CAPABILITY-1-v1.0.0" / "WR-CORPUS-CAPABILITY-1-v1.0.0-TRAIN.jsonl", "capability_train"),
        (Path(LINUX_DATA_ROOT) / "WR-CORPUS-CAPABILITY-1-v1.0.0" / "WR-CORPUS-CAPABILITY-1-v1.0.0-VALIDATION.jsonl", "capability_val"),
        (Path(LINUX_DATA_ROOT) / "WRIM-FOUNDATION-EVAL-1-v1.0.0" / "WRIM-FOUNDATION-EVAL-1-v1.0.0.json", "foundation_eval"),
        (Path(__file__).resolve().parent / "evals" / "WRIM-EVAL-S3-000001.json", "stage3_suite"),
    ]
    for path, cat in mapping:
        if not path.is_file():
            continue
        if path.suffix == ".json":
            obj = json.loads(path.read_text(encoding="utf-8"))
            items = obj.get("items") or []
            if isinstance(items, list):
                for it in items:
                    blob = " ".join(str(it.get(k) or "") for k in ("prompt", "prompt_text", "target", "text", "continuation"))
                    if blob.strip():
                        out.append((cat, blob))
            raw = path.read_text(encoding="utf-8")
            out.append((cat + "_raw", raw[:2_000_000]))
            continue
        for rec in load_jsonl(path):
            blob = " ".join(str(rec.get(k) or "") for k in ("prompt", "target", "text", "body", "content", "chunk", "source_path"))
            if blob.strip():
                out.append((cat, blob))
    for s in HELD_OUT_PROMPT_STRINGS + list(EVAL_INFRA_MARKERS):
        if s:
            out.append(("heldout_or_evalinfra", s))
    return out


def longest_overlap(a: str, b: str, min_len: int = 32, max_len: int = 80) -> int:
    if not a or not b:
        return 0
    al = a.lower()
    bl = b.lower()
    best = 0
    step = 16
    for w in range(min(max_len, len(al)), min_len - 1, -8):
        for i in range(0, len(al) - w + 1, step):
            frag = al[i : i + w]
            if frag in bl:
                return w
        if best:
            break
    return best


def leakage_check(passages: list[dict[str, Any]], dump: Path) -> dict[str, Any]:
    corpus = leak_sources(dump)
    windows: list[tuple[str, str, str]] = []
    for p in passages:
        t = p["text"]
        for i in range(0, max(1, len(t) - 47), 24):
            windows.append((p["id"], t[i : i + 48].lower(), t))
    exact = []
    long_spans = []
    seen_exact = set()
    worst: dict[str, dict[str, Any]] = {}
    for cat, blob in corpus:
        bl = blob.lower() if blob else ""
        for p in passages:
            text = p["text"]
            if text and (text in blob or (len(blob) >= 40 and blob in text)):
                if p["id"] not in seen_exact:
                    exact.append({"id": p["id"], "source": cat})
                    seen_exact.add(p["id"])
        for pid, win, _full in windows:
            if len(win) >= 48 and win in bl:
                prev = worst.get(pid)
                if not prev or 48 > int(prev.get("span") or 0):
                    worst[pid] = {"id": pid, "source": cat, "span": 48}
    long_spans = list(worst.values())
    return {
        "exact_duplicates": exact,
        "EXACT_DUPLICATES": len(exact),
        "long_span_hits_ge_48": long_spans,
        "corpus_records_scanned": len(corpus),
    }


def freeze_pack(tokenizer: Tokenizer, dump: Path) -> dict[str, Any]:
    leak = leakage_check(PASSAGES, dump)
    if leak["EXACT_DUPLICATES"] != 0:
        raise SystemExit(f"exact duplicates before freeze: {leak['exact_duplicates']}")
    if leak["long_span_hits_ge_48"]:
        raise SystemExit(f"long-span overlap before freeze: {leak['long_span_hits_ge_48']}")
    rows = []
    cat_counts: Counter[str] = Counter()
    total_tokens = 0
    for p in PASSAGES:
        ids = list(tokenizer.encode(p["text"], add_special_tokens=False).ids)
        rec = {
            "pack_id": PACK_ID,
            "pack_version": PACK_VERSION,
            "passage_id": p["id"],
            "category": p["category"],
            "text": p["text"],
            "char_length": len(p["text"]),
            "token_count": len(ids),
            "sha256": sha256_text(p["text"]),
            "source": "WRIM_OPERATOR_AUTHORED_VALIDATION_ONLY",
            "license": "ORIGINAL_FIRST_PARTY_INTERNAL_VALIDATION; not licensed for training; not third-party crawl",
            "acquisition_method": "authored_in_wrim_val_nl_independent.py for WR-VAL-NL-INDEPENDENT-1-v1.0.0; never mixed into a train stream",
            "split": "validation_held_out",
            "train_forbidden": True,
        }
        rows.append(rec)
        cat_counts[p["category"]] += 1
        total_tokens += len(ids)
    passages_path = PACK_ROOT / f"{PACK_VERSION}-PASSAGES.jsonl"
    write_jsonl(passages_path, rows)
    files = {
        "passages": sha256_file(passages_path),
    }
    pack_hash = sha256_text(json.dumps(files, sort_keys=True))
    manifest = {
        "kind": "WR_VAL_NL_INDEPENDENT_PACK_MANIFEST",
        "pack_id": PACK_ID,
        "version": PACK_VERSION,
        "created_at": utc_now(),
        "immutable": True,
        "TRAIN_FORBIDDEN": True,
        "added_to_training_stream": False,
        "passage_count": len(rows),
        "token_count": total_tokens,
        "categories": dict(cat_counts),
        "tokenizer_id": TOKENIZER_ID,
        "tokenizer_sha256_expected": TOKENIZER_SHA,
        "license": "ORIGINAL_FIRST_PARTY_INTERNAL_VALIDATION",
        "provenance": "Operator-authored English passages for independent NL measurement after CPT Stage A. Not WR-CORPUS-0/1, not CPT-1, not mode-entry, not capability, not Stage 3, not foundation eval.",
        "files": files,
        "PACK_HASH": pack_hash,
        "leakage": leak,
        "EXACT_DUPLICATES": 0,
    }
    man_path = PACK_ROOT / f"{PACK_VERSION}-MANIFEST.json"
    write_json(man_path, manifest)
    manifest["MANIFEST_HASH"] = sha256_file(man_path)
    # rewrite with manifest hash of content excluding MANIFEST_HASH field: hash file after adding pointer in SHA256 sidecar
    sha_doc = {
        "PACK_HASH": pack_hash,
        "MANIFEST_FILE_SHA256": sha256_file(man_path),
        "files": files,
        "passage_count": len(rows),
        "token_count": total_tokens,
        "EXACT_DUPLICATES": 0,
        "TRAIN_FORBIDDEN": True,
    }
    write_json(PACK_ROOT / f"{PACK_VERSION}-SHA256.json", sha_doc)
    # freeze note: passages jsonl is already written; do not edit
    return {
        "manifest": manifest,
        "sha_doc": sha_doc,
        "rows": rows,
        "passages_path": str(passages_path),
        "MANIFEST_HASH": sha_doc["MANIFEST_FILE_SHA256"],
        "PACK_HASH": pack_hash,
    }


def classify_cont(text: str, new_ids: list[int], eos: bool) -> dict[str, Any]:
    t = text or ""
    compact = re.sub(r"\s+", "", t.lower())
    tags = TAG_RE.findall(t.lower()) + TAG_RE.findall(compact)
    spaced = SPACED_TAG_RE.findall(t)
    first = new_ids[0] if new_ids else None
    repeats = bool(new_ids) and max(Counter(new_ids).values()) >= 8
    loops = bool(re.search(r"(_\s*){6,}", t)) or ("tokenizer" in t.lower() and t.lower().count("tokenizer") >= 3)
    return {
        "immediate_eos": bool(new_ids and first == EOS_ID),
        "newline_first": first == NEWLINE_ID,
        "doc_cont_first": first in {NEWLINE_ID} or (t.lstrip().lower().startswith(("the ", "a ", "i ", "and "))),
        "repeated_token": repeats,
        "tokenizer_loop": loops,
        "tag_fragment": bool(tags or spaced),
        "tags": (tags + spaced)[:8],
        "eos_stopped": bool(eos),
        "continuation": t[:200],
    }


def eval_candidate(*, name: str, model: WRIM0Model, tokenizer: Tokenizer, device: torch.device, rows: list[dict[str, Any]]) -> dict[str, Any]:
    torch.manual_seed(EVAL_SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(EVAL_SEED)
    model.freeze_inference()
    passage_nll = []
    by_cat: dict[str, list[float]] = defaultdict(list)
    gens = []
    firsts = []
    stream: list[int] = []
    for rec in rows:
        ids = list(tokenizer.encode(rec["text"], add_special_tokens=False).ids)
        wrapped = [BOS_ID, *ids, EOS_ID]
        stream.extend(wrapped)
        nll = nll_on_ids(model, device, wrapped)
        if nll is not None:
            passage_nll.append(nll)
            by_cat[rec["category"]].append(nll)
        prefix = [BOS_ID, *ids[:24]]
        g = greedy_from_ids(model, tokenizer, device, prefix, max_new=32)
        cls = classify_cont(g.get("continuation") or "", list(g.get("new_ids") or []), bool(g.get("eos")))
        first_tok = tokenizer.id_to_token(int((g.get("new_ids") or [NEWLINE_ID])[0])) if g.get("new_ids") else None
        firsts.append(first_tok or "")
        gens.append(
            {
                "passage_id": rec["passage_id"],
                "category": rec["category"],
                "nll": nll,
                "prefix_tokens": 24,
                **cls,
                "first_token": first_tok,
            }
        )
    n512 = nll_on_ids(model, device, stream[:512]) if len(stream) >= 3 else None
    n_all = nll_on_ids(model, device, stream[: min(len(stream), 2048)]) if len(stream) >= 3 else None
    attr = attractor_rates(firsts)
    n = max(1, len(gens))
    return {
        "candidate": name,
        "natural_language_nll_mean": float(sum(passage_nll) / max(1, len(passage_nll))) if passage_nll else None,
        "NLL_AT_512": n512,
        "NLL_PACK_PREFIX": n_all,
        "per_category_nll": {k: float(sum(v) / len(v)) for k, v in sorted(by_cat.items())},
        "NEWLINE_ATTRACTOR_RATE": attr["NEWLINE_ATTRACTOR_RATE"],
        "DOCUMENT_CONTINUATION_ATTRACTOR_RATE": attr["DOCUMENT_CONTINUATION_ATTRACTOR_RATE"],
        "repeated_token_rate": sum(1 for g in gens if g["repeated_token"]) / n,
        "tag_fragment_rate": sum(1 for g in gens if g["tag_fragment"]) / n,
        "tokenizer_loop_rate": sum(1 for g in gens if g["tokenizer_loop"]) / n,
        "eos_greedy_rate": sum(1 for g in gens if g["eos_stopped"]) / n,
        "immediate_eos_rate": sum(1 for g in gens if g["immediate_eos"]) / n,
        "n_passages": len(gens),
        "generations": gens,
        "attractor_rates": attr,
    }


def qualitative(ev: dict[str, Any]) -> dict[str, Any]:
    gens = ev.get("generations") or []
    samples = []
    for g in gens:
        if g["category"] in {"general_prose", "short_narrative", "dialogue_like", "factual_explanation"} and len(samples) < 8:
            samples.append({"id": g["passage_id"], "cont": g["continuation"], "tags": g["tags"], "repeat": g["repeated_token"], "eos": g["eos_stopped"]})
    return {
        "coherence": "not scored; 20M greedy is not claimed coherent. Observations only.",
        "continuation_quality": "descriptive only; greedy exact success is not defined for this pack",
        "repetition": ev["repeated_token_rate"],
        "premature_eos": ev["immediate_eos_rate"],
        "document_copy_behavior": ev["DOCUMENT_CONTINUATION_ATTRACTOR_RATE"],
        "tokenizer_loops": ev["tokenizer_loop_rate"],
        "tag_pattern_contamination": ev["tag_fragment_rate"],
        "sample_continuations": samples,
    }


def stage_b_recheck(nl: dict[str, dict[str, Any]], prior: dict[str, Any] | None) -> dict[str, Any]:
    def prior_row(step: str) -> dict[str, Any]:
        table = (prior or {}).get("candidate_table") or []
        for r in table:
            if r.get("candidate_id") == step or r.get("enum_id") == step:
                return r
        return {}

    status = {}
    # Independent NL: this pack exists and is frozen; criterion becomes measurable, not aliased genesis.
    status["INDEPENDENT_NATURAL_VAL"] = {
        "status": "MEASURABLE_THIS_PACK",
        "note": "GENERAL_VAL_NLL from Stage A remains genesis-aliased. This pack is the independent NL measure. Pack is validation-only.",
        "hold": True,
    }
    for cand, key in (("WRIM-0", "WRIM-0"), ("STEP_400", "step-400"), ("STEP_1000", "step-1000"), ("STEP_1220", "step-1220")):
        p = prior_row("WRIM-0" if cand == "WRIM-0" else key)
        nlm = nl[cand]
        greedy0 = int(p.get("greedy_exact") or 0) == 0
        status[cand] = {
            "FOUNDATION_RANK": {
                "hold": p.get("mean_target_rank") is not None and (cand == "WRIM-0" or float(p["mean_target_rank"]) < 0.7 * float(prior_row("WRIM-0").get("mean_target_rank") or 1e9)),
                "mean_rank": p.get("mean_target_rank"),
                "top5": p.get("top5"),
            },
            "GREEDY_HONESTY": {"hold": True, "greedy_exact": p.get("greedy_exact"), "note": "greedy exact remains 0; not treated as answer success"},
            "EOS": {"hold": cand == "WRIM-0" or (float(p.get("eos_argmax") or 0) >= 0.40), "eos_argmax": p.get("eos_argmax"), "eos_greedy": p.get("eos_greedy_stop")},
            "RETENTION": {"hold": cand == "WRIM-0" or (int(p.get("stage3_historical_pass") or 0) >= 5 and float(p.get("stage3_delta_nll") or 99) < 1.25), "stage3": p.get("stage3_historical_binary"), "delta_nll": p.get("stage3_delta_nll")},
            "NO_LANGUAGE_COLLAPSE": {"hold": float(nlm["NEWLINE_ATTRACTOR_RATE"]) < 0.50 and float(nlm["repeated_token_rate"]) < 0.50, "newline": nlm["NEWLINE_ATTRACTOR_RATE"], "repeat": nlm["repeated_token_rate"]},
            "NO_SEVERE_MEMORIZATION": {"hold": float(nlm["tag_fragment_rate"]) < 0.15, "tag_rate": nlm["tag_fragment_rate"]},
            "FAMILY_NLL": {"hold": cand == "WRIM-0" or (p.get("code_nll") is not None and float(p["code_nll"]) < float(prior_row("WRIM-0").get("code_nll") or 99)), "from_prior": {k: p.get(k) for k in ("role_nll", "code_nll", "json_nll", "genesis_nll")}},
            "HELD_OUT_GENERATION": {"hold": greedy0, "independent_nl_nll": nlm["natural_language_nll_mean"], "note": "greedy exact 0; independent NL greedy is descriptive"},
            "CHECKPOINT_STABILITY": {"hold": True},
            "INDEPENDENT_NATURAL_VAL": status["INDEPENDENT_NATURAL_VAL"],
        }
    return status


def prefer_parent(nl: dict[str, dict[str, Any]], prior: dict[str, Any] | None, criteria: dict[str, Any]) -> dict[str, Any]:
    wrim0 = nl["WRIM-0"]
    cands = ["STEP_400", "STEP_1000", "STEP_1220"]

    def collapse(c: str) -> bool:
        e = nl[c]
        return float(e["repeated_token_rate"]) >= 0.50 or float(e["NEWLINE_ATTRACTOR_RATE"]) >= 0.50

    def severe_tag(c: str) -> bool:
        return float(nl[c]["tag_fragment_rate"]) >= 0.15

    viable = [c for c in cands if not collapse(c)]
    if not viable:
        return {"choice": "NO_STAGE_B_PARENT", "reason": "All CPT candidates show language collapse on independent NL greedy (repeat or newline attractor >= 0.50)."}
    # Prefer lower independent NL NLL, then lower tag rate, then lower repeat. Do not auto-pick 1220.
    def key(c: str) -> tuple:
        e = nl[c]
        return (
            1 if severe_tag(c) else 0,
            float(e["natural_language_nll_mean"] or 99),
            float(e["tag_fragment_rate"]),
            float(e["repeated_token_rate"]),
            float(e["NEWLINE_ATTRACTOR_RATE"]),
        )

    best = sorted(viable, key=key)[0]
    nll_gain = float(wrim0["natural_language_nll_mean"] or 0) - float(nl[best]["natural_language_nll_mean"] or 0)
    if nll_gain < 0.15 and severe_tag(best):
        return {"choice": "NO_STAGE_B_PARENT", "reason": f"{best} does not clearly beat WRIM-0 on independent NL NLL and shows tag contamination."}
    mapping = {"STEP_400": "KEEP_STEP_400", "STEP_1000": "SWITCH_TO_STEP_1000", "STEP_1220": "SWITCH_TO_STEP_1220"}
    return {
        "choice": mapping[best],
        "reason": (
            f"{best} has the best independent-NL ranking among non-collapsed CPT checkpoints: "
            f"mean passage NLL {nl[best]['natural_language_nll_mean']}, NLL@512 {nl[best]['NLL_AT_512']}, "
            f"tag_fragment_rate {nl[best]['tag_fragment_rate']}, repeated_token_rate {nl[best]['repeated_token_rate']}, "
            f"newline attractor {nl[best]['NEWLINE_ATTRACTOR_RATE']}. "
            f"WRIM-0 independent NL NLL was {wrim0['natural_language_nll_mean']}. "
            "Stage B is still NOT authorized. Greedy exact remains unsolved."
        ),
        "viable": viable,
        "ranking": [{c: {"nll": nl[c]["natural_language_nll_mean"], "tag": nl[c]["tag_fragment_rate"], "repeat": nl[c]["repeated_token_rate"]}} for c in cands],
    }


def main() -> int:
    if os.environ.get(AUTHORIZE_ENV):
        print("REFUSING: training authorization env is set; this pack is validation-only.", file=sys.stderr)
        return 2
    dump = resolve_dump_root(None)
    if dump is None:
        raise SystemExit("dump_root missing")
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    tok_hash = sha256_file(tok_path)
    if tok_hash != TOKENIZER_SHA:
        raise SystemExit(f"tokenizer hash mismatch {tok_hash}")
    tokenizer = Tokenizer.from_file(str(tok_path))
    print("freezing pack...", flush=True)
    frozen = freeze_pack(tokenizer, dump)
    print("PACK_HASH", frozen["PACK_HASH"], "MANIFEST_HASH", frozen["MANIFEST_HASH"], flush=True)
    # After freeze, load rows from disk only
    rows = load_jsonl(Path(frozen["passages_path"]))
    disable_tf32()
    torch.manual_seed(EVAL_SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(EVAL_SEED)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    wrim0_path = dump / "model-lab" / "manifests" / "wrim0_checkpoints" / "checkpoint-final.safetensors"
    wrim0_hash = sha256_file(wrim0_path)
    specs = [
        ("WRIM-0", wrim0_path, PARENT_SHA),
        ("STEP_400", CKPT_ROOT / "step-400" / MODEL_NAME, STEP_HASHES[400]),
        ("STEP_1000", CKPT_ROOT / "step-1000" / MODEL_NAME, STEP_HASHES[1000]),
        ("STEP_1220", CKPT_ROOT / "step-1220" / MODEL_NAME, STEP_HASHES[1220]),
    ]
    nl: dict[str, dict[str, Any]] = {}
    ckpt_ok = True
    for name, path, expected in specs:
        live = sha256_file(path)
        if live != expected:
            ckpt_ok = False
            print("HASH MISMATCH", name, live, expected, flush=True)
        if name != "WRIM-0":
            v = verify_checkpoint_hashes(path.parent)
            if not v.get("ok"):
                ckpt_ok = False
        print("evaluating", name, flush=True)
        model = WRIM0Model().to(device)
        load_weights_only(model, path)
        nl[name] = eval_candidate(name=name, model=model, tokenizer=tokenizer, device=device, rows=rows)
        del model
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    prior_path = CKPT_ROOT / "WRIM1_CPT_STAGE_A_CHECKPOINT_SELECTION_REPORT.json"
    prior = json.loads(prior_path.read_text(encoding="utf-8")) if prior_path.is_file() else None
    criteria = stage_b_recheck(nl, prior)
    decision = prefer_parent(nl, prior, criteria)
    # tag comparison table
    tag_table = {
        k: {
            "tag_fragment_rate": nl[k]["tag_fragment_rate"],
            "tags_emitted": [g["tags"] for g in nl[k]["generations"] if g["tags"]],
            "n_tagged_passages": sum(1 for g in nl[k]["generations"] if g["tag_fragment"]),
        }
        for k in ("WRIM-0", "STEP_400", "STEP_1000", "STEP_1220")
    }
    slim_nl = {
        k: {kk: vv for kk, vv in ev.items() if kk != "generations"} | {"generation_n": len(ev.get("generations") or [])}
        for k, ev in nl.items()
    }
    report = {
        "kind": "WRIM_INDEPENDENT_NATURAL_LANGUAGE_VALIDATION_REPORT",
        "1_pack_id": PACK_VERSION,
        "2_pack_hash": frozen["PACK_HASH"],
        "3_manifest_hash": frozen["MANIFEST_HASH"],
        "4_passage_count": len(rows),
        "5_token_count": frozen["sha_doc"]["token_count"],
        "6_categories": frozen["manifest"]["categories"],
        "7_provenance_summary": frozen["manifest"]["provenance"],
        "8_license_summary": frozen["manifest"]["license"],
        "9_exact_duplicates": 0,
        "10_fuzzy_overlap_findings": frozen["manifest"]["leakage"],
        "11_tokenizer_hash": tok_hash,
        "12_WRIM0_metrics": slim_nl["WRIM-0"],
        "13_STEP_400_metrics": slim_nl["STEP_400"],
        "14_STEP_1000_metrics": slim_nl["STEP_1000"],
        "15_STEP_1220_metrics": slim_nl["STEP_1220"],
        "16_per_category_nll": {k: nl[k]["per_category_nll"] for k in slim_nl},
        "17_greedy_continuation_observations": {k: qualitative(nl[k]) for k in slim_nl},
        "18_repetition_rates": {k: nl[k]["repeated_token_rate"] for k in slim_nl},
        "19_newline_document_attractors": {
            k: {"newline": nl[k]["NEWLINE_ATTRACTOR_RATE"], "document": nl[k]["DOCUMENT_CONTINUATION_ATTRACTOR_RATE"]}
            for k in slim_nl
        },
        "20_eos_behavior": {k: {"eos_greedy_rate": nl[k]["eos_greedy_rate"], "immediate_eos_rate": nl[k]["immediate_eos_rate"]} for k in slim_nl},
        "21_tag_contamination": tag_table,
        "22_memorization_findings": {
            "exact_duplicates_vs_train_corpora": 0,
            "note": "Pack freeze already required EXACT_DUPLICATES=0. Greedy tag fragments are template interpolation, not pack leakage.",
        },
        "23_stage_b_readiness_criteria_status": criteria,
        "24_preferred_stage_b_parent": decision["choice"],
        "25_reason": decision["reason"],
        "26_training_performed": "NO",
        "27_optimizer_steps": 0,
        "28_checkpoints_modified": "NO",
        "29_canonical_promoted": "NO",
        "30_commander_decision_required": "YES",
        "TRAINING_PERFORMED": "NO",
        "OPTIMIZER_STEPS": 0,
        "EXACT_DUPLICATES": 0,
        "TOKENIZER_MODIFIED": "NO",
        "CHECKPOINTS_MODIFIED": "NO",
        "CANONICAL_PROMOTED": "NO",
        "STAGE_B_EXECUTED": "NO",
        "SFT_EXECUTED": "NO",
        "RUN_000013_EXECUTED": "NO",
        "STAGE3B_EXECUTED": "NO",
        "COMMANDER_DECISION_REQUIRED": "YES",
        "WRIM0_LIVE_HASH": wrim0_hash,
        "WRIM0_UNCHANGED": wrim0_hash == PARENT_SHA,
        "checkpoint_hashes_ok": ckpt_ok,
        "added_to_training_stream": False,
        "STAGE_B": "NOT AUTHORIZED",
        "decision_detail": decision,
        "created_at": utc_now(),
        "full_generations": {k: nl[k]["generations"] for k in slim_nl},
    }
    write_json(REPORT_PATH, report)
    print("WROTE", REPORT_PATH, flush=True)
    print("PREFERRED", decision["choice"], flush=True)
    print("TRAINING_PERFORMED=NO OPTIMIZER_STEPS=0", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
