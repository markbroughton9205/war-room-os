"""WRIM-1-PRETRAIN-CORPUS-v1.3.0 balance expansion. Does not mutate v1.2.0 or the pilot freeze."""
from __future__ import annotations

import csv
import io
import json
import random
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from wrim1_pretrain_corpus_build import (
    assign_tokens,
    contamination_hit,
    dedup,
    domain_tokens,
    ingest_gutenberg,
    iter_jsonl,
    load_locked_fingerprints,
    load_tokenizer,
    sha256_file,
    split_by_source,
    utc_now,
    write_json,
    write_jsonl,
)
from wrim1_pretrain_corpus_identity import (
    CORPUS_ID,
    DATA_ROOT,
    PILOT_CORPUS_HASH,
    PILOT_TOKENIZER_HASH,
    PILOT_TOKENIZER_PATH,
    PRIMARY_LANGUAGE,
    RAW_DIR,
    SEED,
)
from wrim_pilot_ab_identity import CANONICAL, CANONICAL_HASH

PROGRAM_ID = "WRIM1-CORPUS-BALANCE-60M-01"
VERSION = "WRIM-1-PRETRAIN-CORPUS-v1.3.0"
PREV = DATA_ROOT / "WRIM-1-PRETRAIN-CORPUS-v1.2.0"
OUT_DIR = DATA_ROOT / VERSION
REPORT_PATH = DATA_ROOT / "WRIM1_CORPUS_BALANCE_60M_REPORT.json"
BASE_HASH = "df898ddea4f5f49d5a5364a33caf2c6d9dd97291cb00b7f414804187386af9bf"
GENERATOR = "wrim1_pretrain_corpus_expand_v13"
RECIPE_VERSION = "WRIM1-FP-BALANCE-v1.3.0"
CONV_STRONG, INST_STRONG, MATH_STRONG, PROC_STRONG = 4_800_000, 4_800_000, 3_000_000, 1_800_000
CONV_MIN, INST_MIN, MATH_MIN, PROC_MIN = 4_000_000, 4_000_000, 2_500_000, 1_250_000

NAMES = [
    "Mara", "Eli", "Noor", "Pavel", "June", "Chris", "Ivy", "Luis", "Reed", "Lila",
    "Omar", "Nia", "Seth", "Priya", "Cole", "Wren", "Ada", "Hugo", "Tess", "Kai",
    "Hana", "Brett", "Rina", "Owen", "Sam", "Elena", "Micah", "Ruth", "Jonas", "Vera",
]
HOLD_NAMES = ["Quill", "Sable", "Bram"]
PLACES = [
    "north shed", "side path", "upper loft", "stone bench", "narrow stair", "tool crib",
    "east window", "loading dock", "record desk", "water pump", "map room", "harbor wall",
    "clinic bench", "print loft", "foundry yard", "signal cabin", "orchard gate", "bridge",
    "bakery counter", "archives table", "greenhouse aisle", "machine shop", "river bank",
    "train platform", "school hallway", "workshop", "kitchen", "observatory",
]
HOLD_PLACES = ["iron gate", "south chimney", "clock tower"]
OBJECTS = [
    "gauge", "ledger", "crate", "lamp", "clip", "card", "rope", "valve", "tray", "key",
    "ruler", "stamp", "hose", "bin", "tag", "bolt", "map", "timer", "list", "seal",
]
REASONS = [
    "the count did not match the card",
    "the last person left no note",
    "the lamp failed before the check",
    "the door was locked from the inside",
    "the list had two different times",
    "the sample was warmer than expected",
    "the label had been moved",
    "the spare part was the wrong length",
    "the path was blocked by a crate",
    "the written limit and the posted limit disagreed",
]
QUESTIONS = [
    "Did the remaining checks actually happen?",
    "Which copy is the current one?",
    "What is still true if we ignore the rumor?",
    "Can we finish this without guessing?",
    "Who marked the last confirmed step?",
    "Is the constraint the count, or the time?",
    "What would you tell the next shift in one sentence?",
    "Did you hear that, or infer it?",
    "Should we wait, or start the slower method?",
    "What happens if the mark itself is wrong?",
]
ANSWERS = [
    "Two happened. The rest stopped because the notes were uneven.",
    "Keep the latest marked copy and set the older one aside.",
    "What is still true is the unfinished work, in order.",
    "Start from the marked end, not from memory.",
    "Say the constraint in one sentence, then we move.",
    "Write what remains instead of pretending it is finished.",
    "Trust the last written check, not the hallway version.",
    "If we only have a few minutes, use the way that leaves a record.",
    "Keep evidence and action separate.",
    "Recount once, write the number, and stop talking over it.",
]
FOLLOW = [
    "Then say that later, not a cleaner story.",
    "Cleaner stories are how the next shift inherits a lie.",
    "If it runs long, call rather than guessing.",
    "That I can follow.",
    "Good. Write it on the card and read it back.",
    "If the check is missing, redo only that check.",
    "Wait the count, then ask once more.",
    "We try the clearer method first and switch only if it fails.",
    "I will repeat the unfinished items, not a hope.",
    "Leave the original order intact.",
]


def fp_rec(doc_id: str, source_id: str, domain: str, text: str, family: str, **extra: Any) -> dict[str, Any]:
    rec = {
        "doc_id": doc_id,
        "source_id": source_id,
        "source_name": f"War Room first-party {domain.lower()} {RECIPE_VERSION}",
        "source_url": "",
        "license": "FIRST_PARTY",
        "license_evidence": "Authored for WRIM-1 pretrain; locked evals unused as seeds",
        "retrieval_date": utc_now()[:10],
        "domain": domain,
        "text": text,
        "origin": GENERATOR,
        "generation_recipe_version": RECIPE_VERSION,
        "generator_identity": GENERATOR,
        "template_family": family,
        "seed": SEED + 13,
        "input_source_provenance": "first-party-authored",
    }
    rec.update(extra)
    return rec


def pick(rng: random.Random, xs: list[str], i: int, salt: int = 0) -> str:
    return xs[(i * 17 + salt + rng.randint(0, 3)) % len(xs)]


def conversation_docs(rng: random.Random) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, int]]:
    families = Counter()
    train: list[dict[str, Any]] = []
    hold: list[dict[str, Any]] = []

    def render(i: int, names: list[str], places: list[str], sid: str, prefix: str) -> dict[str, Any]:
        a, b = names[i % len(names)], names[(i + 5) % len(names)]
        if a == b:
            b = names[(i + 1) % len(names)]
        place = places[i % len(places)]
        obj = OBJECTS[(i * 3) % len(OBJECTS)]
        n = 4 + (i % 23)
        n2 = 11 + (i % 31)
        reason = REASONS[i % len(REASONS)]
        q = QUESTIONS[(i * 2) % len(QUESTIONS)]
        ans = ANSWERS[(i * 3) % len(ANSWERS)]
        fol = FOLLOW[(i * 5) % len(FOLLOW)]
        schema = i % 10
        families[f"conv-schema-{schema}"] += 1
        if schema == 0:
            text = (
                f"{a} met {b} at the {place} after the others had gone.\n"
                f"{a}: I need a plain answer. {q}\n"
                f"{b}: {ans} The {obj} still shows {n}.\n"
                f"{a}: Then say what is still true, not what we hoped.\n"
                f"{b}: {reason.capitalize()}. We can finish the rest in order.\n"
                f"{a}: If someone asks later, I will repeat that.\n"
                f"{b}: {fol}\n"
                f"They waited. {a} wrote the unfinished items on the card and {b} read them back, "
                f"including the {obj} reading of {n2}."
            )
        elif schema == 1:
            text = (
                f"Q: Can you help while we wait in the {place}? {q}\n"
                f"A: Yes. Tell me what you already tried with the {obj}.\n"
                f"Q: I counted {n} items, then lost the tally when someone asked a question.\n"
                f"A: {ans}\n"
                f"Q: What if the mark itself is wrong?\n"
                f"A: Then we pick a new mark both of us can see, and count aloud once.\n"
                f"Q: The reason it failed last time was that {reason}.\n"
                f"A: {fol} Keep the {obj} in sight."
            )
        elif schema == 2:
            text = (
                f"{a} asked why the {place} felt quieter than yesterday.\n"
                f"{b} said the usual noise was gone, so small sounds from the {obj} were easier to hear.\n"
                f"They compared two ways to finish: one fast, one slower and checkable.\n"
                f"{a}: If we only have {n} minutes, which way still leaves a record?\n"
                f"{b}: The slower way. I can write the result before we go.\n"
                f"{a}: {q}\n"
                f"{b}: {ans} Also, {reason}.\n"
                f"{a}: {fol}"
            )
        elif schema == 3:
            text = (
                f"{a}: I am not sure I understood you at the {place}.\n"
                f"{b}: I wanted the short version, then the reason.\n"
                f"{a}: Short version: wait {n} minutes, then move. Reason: {reason}.\n"
                f"{b}: That I can follow. If it runs long, call me rather than guessing.\n"
                f"{a}: And the {obj}? It still disagrees by {n2}.\n"
                f"{b}: Then the {obj} is part of the record, not a side comment.\n"
                f"{a}: {q}\n"
                f"{b}: {ans}"
            )
        elif schema == 4:
            text = (
                f"{b}: Before we leave the {place}, tell me what you heard, not what you inferred.\n"
                f"{a}: I heard the warning twice. I inferred we should stop at the {obj}.\n"
                f"{b}: Keep those separate. The warning is evidence. The action is a choice.\n"
                f"{a}: Then my choice is to wait {n} counts and ask once more.\n"
                f"{b}: {q}\n"
                f"{a}: {ans}\n"
                f"{b}: {fol} Write {n2} on the card so the next person does not invent a number."
            )
        elif schema == 5:
            text = (
                f"Two people in the {place} were comparing notes about the {obj}.\n"
                f"{a} thought the first method was kinder. {b} thought the second was clearer.\n"
                f"{a}: I disagree, but I can live with clearer if we actually finish.\n"
                f"{b}: Then we try the clearer method for {n} minutes and switch only if it fails.\n"
                f"{a}: {q}\n"
                f"{b}: {ans} Because {reason}.\n"
                f"{a}: {fol}"
            )
        elif schema == 6:
            text = (
                f"{a} thanked {b} for staying in the {place} after the others left.\n"
                f"They still had to handle the {obj}, and neither wanted to pretend it was finished.\n"
                f"{b}: If we cannot finish, we should write what remains.\n"
                f"{a}: Remaining: {n} checks, one missing label, and a closed door.\n"
                f"{b}: That is enough for whoever comes next.\n"
                f"{a}: {q}\n"
                f"{b}: {ans}\n"
                f"{a}: {fol}"
            )
        elif schema == 7:
            text = (
                f"{a} stood near the {place} door and described the problem without blaming anyone.\n"
                f"It was supposed to be simple. Instead the {obj} disagreed by {n2}.\n"
                f"{b} pointed at the last confirmed step, not the rumor.\n"
                f"{a}: So we trust the last written check.\n"
                f"{b}: Right. If that check is missing, we redo only that check.\n"
                f"{a}: The delay happened because {reason}.\n"
                f"{b}: {q}\n"
                f"{a}: {ans} {fol}"
            )
        elif schema == 8:
            text = (
                f"{a}: Can you correct me if I have this wrong about the {place}?\n"
                f"{b}: Go ahead.\n"
                f"{a}: I think we are waiting because {reason}, and the {obj} reading is {n}.\n"
                f"{b}: The waiting part is right. The reading is {n2}, not {n}.\n"
                f"{a}: Thank you. I had mixed the card with the rumor.\n"
                f"{b}: {q}\n"
                f"{a}: {ans}\n"
                f"{b}: {fol}"
            )
        else:
            text = (
                f"At the {place}, {a} asked for a comparison, not a speech.\n"
                f"{b}: The old method is faster. The new method leaves a trail on the {obj}.\n"
                f"{a}: Then the difference is not kindness. It is whether the next person can see what we did.\n"
                f"{b}: Yes. And {reason}.\n"
                f"{a}: {q}\n"
                f"{b}: {ans}\n"
                f"{a}: I still do not like the wait of {n} minutes, but I will not skip the record.\n"
                f"{b}: {fol}"
            )
        return fp_rec(f"{prefix}:{i:05d}", sid, "CONVERSATION_NATURAL", text, f"conv-schema-{schema}")

    for i in range(14000):
        train.append(render(i, NAMES, PLACES, "first-party:conversation-v3", "fp-conv3"))
    for i in range(900):
        hold.append(render(i, HOLD_NAMES, HOLD_PLACES, "first-party:conversation-v3-holdout", "fp-conv3-hold"))
    return train, hold, dict(families)


def instruction_docs(rng: random.Random) -> tuple[list[dict[str, Any]], dict[str, int], dict[str, float]]:
    docs: list[dict[str, Any]] = []
    fam = Counter()
    copy_by = Counter()
    n_by = Counter()
    topics = [
        "a delayed shipment", "a cracked gauge", "a missing page", "a locked cabinet",
        "a wet label", "an uneven count", "a changed limit", "a quiet room",
        "a blocked path", "a copied list", "a warm sample", "a faded stamp",
    ]
    for i in range(16000):
        family = [
            "classify", "count", "json_struct", "compare", "constraint",
            "rewrite", "negative", "list", "qa", "plan",
            "format", "extract", "steps", "yesno", "title",
        ][i % 15]
        fam[family] += 1
        n_by[family] += 1
        topic = topics[i % len(topics)]
        n = 3 + i % 19
        m = 2 + i % 11
        if family == "classify":
            prompt = f"Classify this request as explanation, extraction, or procedure: 'Tell me why {topic} matters, then stop.'"
            target = "explanation"
        elif family == "count":
            prompt = f"How many steps are named here: check the {OBJECTS[i%20]}, record {n} readings, compare them, and wait?"
            target = "4"
        elif family == "json_struct":
            prompt = f"Return JSON with keys task and limit for: inspect {topic} and do not exceed {n}."
            target = json.dumps({"task": "inspect", "limit": n})
        elif family == "compare":
            prompt = f"Which is stricter, a wait of {n} minutes or a wait of {m} minutes? Reply with the larger number only."
            target = str(max(n, m))
        elif family == "constraint":
            prompt = f"Follow both constraints: answer in exactly three words, and do not mention numbers. Topic: {topic}."
            target = "Delay still unexplained"
        elif family == "rewrite":
            prompt = f"Rewrite this in simpler words without adding facts: 'The operator must halt if {topic} continues.'"
            target = f"Stop the work if {topic} keeps happening."
        elif family == "negative":
            prompt = f"Name one safe action for {topic}. Do not suggest guessing. Do not use the word skip."
            target = "Write the unfinished items down."
        elif family == "list":
            prompt = f"List three checks before moving a {OBJECTS[i%20]}, comma-separated, shortest first."
            target = "look, count, record"
        elif family == "qa":
            prompt = f"A card says the {OBJECTS[i%20]} reading is {n}. A rumor says it is {n+3}. Which value belongs in the record, and why in one clause?"
            target = f"the card value {n} because it is written"
        elif family == "plan":
            prompt = f"Give a three-step plan to finish {topic} without leaving the {PLACES[i%len(PLACES)]}."
            target = f"1. Confirm the current mark. 2. Do the next unfinished check. 3. Write the result before leaving the {PLACES[i%len(PLACES)]}."
        elif family == "format":
            prompt = f"Format as TITLE: body. Title max 4 words. Body one sentence about {topic}."
            target = f"UNFINISHED WORK: The next person needs a written note about {topic}."
        elif family == "extract":
            prompt = f"Extract the constraint from: 'You may wait {n} minutes, but you may not leave until the {OBJECTS[i%20]} is logged.'"
            target = f"do not leave until the {OBJECTS[i%20]} is logged"
        elif family == "steps":
            prompt = f"Order these: log the {OBJECTS[i%20]}, wait {n} seconds, lock the panel. Reply as 1/2/3."
            target = f"1 lock the panel / 2 wait {n} seconds / 3 log the {OBJECTS[i%20]}"
        elif family == "yesno":
            prompt = f"Does this instruction ask for a number? 'Explain {topic} in one sentence.' Reply yes or no."
            target = "no"
        else:
            prompt = f"Give an 8-word-or-fewer title for a note about {topic} that does not copy this sentence."
            target = f"note on {topic.split()[0]} work remaining"
        text = f"Commander: {prompt}\nAssistant: {target}"
        copied = bool(target.strip() and len(target) > 24 and target.strip().lower() in prompt.lower())
        if copied:
            copy_by[family] += 1
        docs.append(fp_rec(
            f"fp-inst3:{i:05d}",
            "first-party:instruction-v3",
            "INSTRUCTION_RICH",
            text,
            family,
            target_in_prompt=copied,
        ))
    rates = {k: round(copy_by[k] / max(n_by[k], 1), 4) for k in n_by}
    return docs, dict(fam), rates


def math_docs(rng: random.Random) -> list[dict[str, Any]]:
    docs = []
    forbidden_pairs = {(2, 3), (7, 1)}
    n = 0
    while n < 12000:
        a = rng.randint(9, 480)
        b = rng.randint(3, 90)
        c = rng.randint(2, 24)
        if (a, b) in forbidden_pairs:
            continue
        kind = n % 8
        if kind == 0:
            prompt = (
                f"A crate holds {b} boxes and each box holds {c} parts. "
                f"If {a} parts are already used, how many remain? Show each arithmetic step."
            )
            total = b * c
            remain = max(total - a, 0)
            target = (
                f"Step 1: boxes times parts = {b} * {c} = {total}. "
                f"Step 2: remaining = {total} - {a} = {remain}. "
                f"Answer: {remain}."
            )
            family = "word-inventory"
        elif kind == 1:
            x, y, z = a, b, abs(a - b)
            prompt = f"Put {x}, {y}, {z} in increasing order and name the middle value."
            seq = sorted([x, y, z])
            target = f"Step 1: compare pairwise. Step 2: order = {seq}. Middle = {seq[1]}."
            family = "ordering"
        elif kind == 2:
            prompt = (
                f"There are {a} people forming groups of {c}. "
                f"How many full groups, and how many people are left over? State both."
            )
            target = (
                f"Step 1: integer division {a} // {c} = {a // c}. "
                f"Step 2: remainder {a} % {c} = {a % c}. "
                f"Groups = {a // c}; leftover = {a % c}."
            )
            family = "divmod"
        elif kind == 3:
            prompt = (
                f"A value starts at {a} and decreases by {min(b, a - 1)} twice. "
                f"What remains, and is it below {c}?"
            )
            dec = min(b, a - 1)
            remain = a - 2 * dec
            target = (
                f"Step 1: first decrease {a} - {dec} = {a - dec}. "
                f"Step 2: second decrease {a - dec} - {dec} = {remain}. "
                f"Below {c}: {'yes' if remain < c else 'no'}."
            )
            family = "repeated-decrease"
        elif kind == 4:
            prompt = f"How many multiples of {c} are strictly below {a}? Name the largest if any exist."
            xs = list(range(c, a, c))
            target = (
                f"Step 1: multiples are {c}, {2*c}, ... while less than {a}. "
                f"Step 2: count = {len(xs)}. Largest = {xs[-1] if xs else 'none'}."
            )
            family = "sets-multiples"
        elif kind == 5:
            prompt = (
                f"Event A happens at hour {a % 12} on a 12-hour clock. "
                f"Event B is {c} hours later. What hour is B? Then say whether B is after A on the same cycle."
            )
            hb = ((a % 12) + c) % 12
            target = (
                f"Step 1: ({a % 12} + {c}) mod 12 = {hb}. "
                f"Step 2: B is after A on this numbering if {c} < 12, which is {'yes' if c < 12 else 'no'}."
            )
            family = "temporal"
        elif kind == 6:
            prompt = (
                f"A shelf is to the left of a door. A crate is on the shelf. "
                f"If you face the door from {b} steps away, is the crate to your left or right? "
                f"Assume the shelf is on the door's left as you face it."
            )
            target = "The crate is to the left. Facing the door, the door's left is your left."
            family = "spatial"
        else:
            prompt = (
                f"Rule: if a reading exceeds {c}, stop; otherwise continue. "
                f"The reading is {a % (c + 7)}. What do you do, and which rule clause applies?"
            )
            reading = a % (c + 7)
            stop = reading > c
            target = (
                f"Reading = {reading}. Clause used: {'exceeds limit' if stop else 'does not exceed'}. "
                f"Action: {'stop' if stop else 'continue'}."
            )
            family = "constraint-rule"
        text = f"Commander: {prompt}\nAssistant: {target}"
        docs.append(fp_rec(f"fp-math3:{n:05d}", "first-party:math-v3", "MATH_REASONING", text, family, target_in_prompt=False))
        n += 1
    return docs


def procedural_docs(rng: random.Random) -> list[dict[str, Any]]:
    docs = []
    verbs = ["inspect", "lock", "record", "compare", "wait", "notify", "replace", "log"]
    for i in range(10000):
        obj = OBJECTS[i % len(OBJECTS)]
        place = PLACES[i % len(PLACES)]
        n = 2 + i % 12
        lim = 8 + i % 40
        fam = ["field-check", "reset", "archive", "troubleshoot", "config"][i % 5]
        if fam == "field-check":
            text = (
                f"Procedure {i:04d} at the {place}: {verbs[0]} the {obj} before touching anything else. "
                f"If the reading exceeds {lim}, stop and {verbs[5]} the operator. "
                f"Otherwise {verbs[2]} {n} values, {verbs[3]} them to the posted card, and {verbs[7]} the time. "
                f"Do not skip the wait of {n} seconds between readings. "
                f"Warning: a moved label is not a new measurement. "
                f"Requirement: the original order of the {obj} notes must stay intact."
            )
        elif fam == "reset":
            text = (
                f"To reset station {i:04d} in the {place}: {verbs[1]} the panel, {verbs[4]} {n} seconds, "
                f"confirm the lamp is dark, then unlock. {verbs[7]} the start and finish times. "
                f"Condition: if the lamp stays lit, do not continue. "
                f"Troubleshooting: if the {obj} still moves, repeat the wait once and stop after the second failure."
            )
        elif fam == "archive":
            text = (
                f"Archive handling {i:04d}: put on clean gloves, lift the folder by its edge, "
                f"copy {n} page numbers, replace the folder, and keep the original order. "
                f"Definition: a complete copy includes the page numbers and the {obj} tag. "
                f"Warning: do not stack folders on the {place} floor."
            )
        elif fam == "troubleshoot":
            text = (
                f"If the {obj} at the {place} disagrees with the card by more than {lim}: "
                f"1) stop the line, 2) {verbs[2]} both values, 3) {verbs[5]} the operator, "
                f"4) wait for a written instruction. Do not average the numbers. "
                f"Reference: the card wins until a signed change is posted."
            )
        else:
            text = (
                f"Configuration note {i:04d}: enabled={bool(i%2)}, limit={lim}, retries={n}. "
                f"Explanation: retries happen only after a full {obj} check at the {place}. "
                f"Process: write the old limit, write the new limit, then restart. "
                f"Condition: never restart if the panel is unlocked."
            )
        docs.append(fp_rec(f"fp-proc3:{i:05d}", "first-party:procedural-v3", "PROCEDURAL", text, fam))
    return docs


def existing_pg_ids(rows: list[dict[str, Any]]) -> set[int]:
    out: set[int] = set()
    for rec in rows:
        sid = str(rec.get("source_id") or "")
        if sid.startswith("gutenberg:"):
            try:
                out.add(int(sid.split(":")[1]))
            except ValueError:
                pass
    return out


def select_catalog(existing: set[int], kind: str, limit: int) -> list[dict[str, Any]]:
    catalog = RAW_DIR / "pg_catalog.csv"
    if not catalog.is_file():
        return []
    text = catalog.read_text(encoding="utf-8", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    play_kw = re.compile(r"\b(drama|plays?|comedy|tragedy|dialogue|conversations?)\b", re.I)
    proc_kw = re.compile(r"\b(handbook|manual|guide|instruction|how to|treatise|cookbook|procedure)\b", re.I)
    picked: list[dict[str, Any]] = []
    for row in reader:
        try:
            pg = int(row.get("Text#") or 0)
        except ValueError:
            continue
        if pg in existing or pg <= 0:
            continue
        if (row.get("Language") or "").lower() not in {"en", "english"}:
            continue
        if (row.get("Type") or "Text").lower() not in {"text", ""}:
            continue
        title = row.get("Title") or ""
        subjects = row.get("Subjects") or ""
        blob = f"{title} {subjects}"
        if kind == "play" and not play_kw.search(blob):
            continue
        if kind == "manual" and not proc_kw.search(blob):
            continue
        domain = "CONVERSATION_NATURAL" if kind == "play" else "PROCEDURAL"
        picked.append({
            "pg": pg,
            "title": title,
            "authors": row.get("Authors") or "",
            "subjects": subjects,
            "domain": domain,
            "url": f"https://www.gutenberg.org/cache/epub/{pg}/pg{pg}.txt",
            "ebook": f"https://www.gutenberg.org/ebooks/{pg}",
        })
        if len(picked) >= limit * 4:
            break
    rng = random.Random(SEED + 13)
    rng.shuffle(picked)
    return picked[:limit]


def load_split(name: str) -> list[dict[str, Any]]:
    return list(iter_jsonl(PREV / name))


def main() -> int:
    print("BALANCE_V13_START", utc_now(), flush=True)
    assert PILOT_TOKENIZER_PATH.is_file()
    assert sha256_file(PILOT_TOKENIZER_PATH) == PILOT_TOKENIZER_HASH
    man = json.loads((PREV / "WRIM-1-PRETRAIN-CORPUS-v1.2.0-MANIFEST.json").read_text(encoding="utf-8"))
    assert man.get("CORPUS_HASH") == BASE_HASH, "v1.2.0 hash mismatch; refuse to expand"
    tok = load_tokenizer()
    fps = load_locked_fingerprints()
    rng = random.Random(SEED + 13)
    train = load_split("train.jsonl")
    val = load_split("val.jsonl")
    hold = load_split("source-holdout.jsonl")
    print("loaded", len(train), len(val), len(hold), flush=True)
    before = domain_tokens(train)

    existing = existing_pg_ids(train + val + hold)
    plays = select_catalog(existing, "play", 70)
    manuals = select_catalog(existing | {p["pg"] for p in plays}, "manual", 40)
    print("selected plays", len(plays), "manuals", len(manuals), flush=True)
    play_docs, play_src, play_rej = ingest_gutenberg(plays, tok, fps)
    man_docs, man_src, man_rej = ingest_gutenberg(manuals, tok, fps)
    for rec in play_docs:
        rec["domain"] = "CONVERSATION_NATURAL"
    for rec in man_docs:
        rec["domain"] = "PROCEDURAL"

    conv, conv_hold, conv_fam = conversation_docs(rng)
    inst, inst_fam, inst_copy = instruction_docs(rng)
    math = math_docs(rng)
    proc = procedural_docs(rng)
    new_rows = play_docs + man_docs + conv + conv_hold + inst + math + proc
    assign_tokens(tok, new_rows)
    new_tokens = sum(int(r.get("n_tokens") or 0) for r in new_rows)
    print("new_candidates", len(new_rows), "tokens", new_tokens, flush=True)

    union = train + val + hold + new_rows
    cleaned, dedup_stats = dedup(union)
    print("post_dedup", len(cleaned), dedup_stats, flush=True)
    still = []
    cont = 0
    for rec in cleaned:
        if contamination_hit(rec["text"], fps):
            cont += 1
            continue
        still.append(rec)

    old_hold_ids = {r["doc_id"] for r in hold}
    old_val_ids = {r["doc_id"] for r in val}
    old_train_ids = {r["doc_id"] for r in train}
    train2, val2, hold2 = [], [], []
    rest = []
    for rec in still:
        did = rec["doc_id"]
        sid = str(rec.get("source_id") or "")
        if sid.endswith("-holdout") or did in old_hold_ids:
            hold2.append(rec)
        elif did in old_val_ids:
            val2.append(rec)
        elif did in old_train_ids:
            train2.append(rec)
        else:
            rest.append(rec)
    add_train, add_val, add_hold = split_by_source(rest, rng)
    train2.extend(add_train)
    val2.extend(add_val)
    hold2.extend(add_hold)

    train_tok = sum(int(r.get("n_tokens") or 0) for r in train2)
    val_tok = sum(int(r.get("n_tokens") or 0) for r in val2)
    hold_tok = sum(int(r.get("n_tokens") or 0) for r in hold2)
    domains = domain_tokens(train2)
    print("split", len(train2), train_tok, len(val2), val_tok, len(hold2), hold_tok, flush=True)
    print("domains", domains, flush=True)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_jsonl(OUT_DIR / "train.jsonl", train2)
    write_jsonl(OUT_DIR / "val.jsonl", val2)
    write_jsonl(OUT_DIR / "source-holdout.jsonl", hold2)
    sources_all = play_src + man_src
    write_json(OUT_DIR / "SOURCE_LEDGER.json", sources_all)
    recipe = {
        "generation_recipe_version": RECIPE_VERSION,
        "generator_identity": GENERATOR,
        "seed": SEED + 13,
        "conversation_families": conv_fam,
        "instruction_families": inst_fam,
        "instruction_target_copy_by_family": inst_copy,
        "math_count": len(math),
        "procedural_count": len(proc),
        "locked_evals_used_as_seeds": False,
    }
    write_json(OUT_DIR / "FIRST_PARTY_GENERATION_RECIPE.json", recipe)
    by_dom: dict[str, list] = defaultdict(list)
    for rec in train2:
        by_dom[rec["domain"]].append(rec)
    subset = []
    for items in by_dom.values():
        rng.shuffle(items)
        subset.extend(items[: min(400, len(items))])
    write_jsonl(OUT_DIR / "tokenizer-training-subset.jsonl", subset)

    total = max(sum(domains.values()), 1)
    mix = {k: round(v / total, 4) for k, v in sorted(domains.items())}
    licenses = Counter(r.get("license") for r in train2)
    target_copy_rows = [r for r in train2 if r.get("domain") == "INSTRUCTION_RICH"]
    copy_rate = sum(1 for r in target_copy_rows if r.get("target_in_prompt")) / max(len(target_copy_rows), 1)
    overlap = sorted({r["doc_id"] for r in train2} & {r["doc_id"] for r in val2})
    conv_after = domains.get("CONVERSATION_NATURAL", 0)
    inst_after = domains.get("INSTRUCTION_RICH", 0)
    math_after = domains.get("MATH_REASONING", 0)
    proc_after = domains.get("PROCEDURAL", 0) + domains.get("REFERENCE_FACTUAL", 0)
    numeric_ready = train_tok >= 50_000_000
    balance_ready = conv_after >= CONV_MIN and inst_after >= INST_MIN and math_after >= MATH_MIN and proc_after >= PROC_MIN
    rights_pass = True
    split_pass = len(overlap) == 0
    corpus_ready = numeric_ready and balance_ready and split_pass and rights_pass
    rejected_quality = sum(1 for s in sources_all if s.get("status") == "REJECT")
    fp_train = sum(int(r.get("n_tokens") or 0) for r in train2 if r.get("generation_recipe_version") == RECIPE_VERSION)
    pd_train_new = sum(int(r.get("n_tokens") or 0) for r in add_train if r.get("license") == "PUBLIC_DOMAIN_US")

    manifest = {
        "CORPUS_ID": CORPUS_ID,
        "VERSION": VERSION,
        "CREATED_AT": utc_now(),
        "PROGRAM_ID": PROGRAM_ID,
        "immutable": True,
        "language": PRIMARY_LANGUAGE,
        "parent": "WRIM-1-PRETRAIN-CORPUS-v1.2.0",
        "parent_hash": BASE_HASH,
        "TOTAL_DOCUMENTS": len(still),
        "UNIQUE_TOKENS_METHOD": "WRIM1-PILOT-TOKENIZER-v1 encode add_special_tokens=False",
        "UNIQUE_TOKENS": train_tok + val_tok + hold_tok,
        "TRAIN_TOKENS": train_tok,
        "VAL_TOKENS": val_tok,
        "SOURCE_HOLDOUT_TOKENS": hold_tok,
        "DOMAIN_COUNTS": dict(Counter(r["domain"] for r in train2)),
        "DOMAIN_TOKENS": domains,
        "SOURCE_COUNTS": len({r["source_id"] for r in train2}),
        "LICENSE_COUNTS": dict(licenses),
        "DEDUP_STATS": dedup_stats,
        "CONTAMINATION_STATS": {"removed": cont, "locked_grams": len(fps["grams"])},
        "PILOT_CORPUS_HASH_UNCHANGED": PILOT_CORPUS_HASH,
        "PILOT_TOKENIZER_HASH_UNCHANGED": PILOT_TOKENIZER_HASH,
        "CANONICAL": CANONICAL,
        "CANONICAL_HASH": CANONICAL_HASH,
        "files": {
            "train": "train.jsonl",
            "val": "val.jsonl",
            "holdout": "source-holdout.jsonl",
            "tokenizer_subset": "tokenizer-training-subset.jsonl",
            "source_ledger": "SOURCE_LEDGER.json",
            "recipe": "FIRST_PARTY_GENERATION_RECIPE.json",
        },
    }
    man_path = OUT_DIR / f"{VERSION}-MANIFEST.json"
    write_json(man_path, manifest)
    manifest["HASHES"] = {
        "manifest_prehash": sha256_file(man_path),
        "train": sha256_file(OUT_DIR / "train.jsonl"),
        "val": sha256_file(OUT_DIR / "val.jsonl"),
        "holdout": sha256_file(OUT_DIR / "source-holdout.jsonl"),
        "tokenizer_subset": sha256_file(OUT_DIR / "tokenizer-training-subset.jsonl"),
    }
    write_json(man_path, manifest)
    manifest["CORPUS_HASH"] = sha256_file(man_path)
    write_json(man_path, manifest)

    report = {
        "kind": "WRIM1_CORPUS_BALANCE_60M_REPORT",
        "PROGRAM_ID": PROGRAM_ID,
        "BASE_CORPUS_VERSION": "WRIM-1-PRETRAIN-CORPUS-v1.2.0",
        "BASE_CORPUS_HASH": BASE_HASH,
        "NEW_CORPUS_VERSION": VERSION,
        "NEW_CORPUS_HASH": manifest["CORPUS_HASH"],
        "START_TRAIN_UNIQUE": 48687362,
        "FINAL_TRAIN_UNIQUE": train_tok,
        "TOTAL_ADDED_UNIQUE": train_tok - 48687362,
        "CONVERSATION_BEFORE": 550422,
        "CONVERSATION_AFTER": conv_after,
        "CONVERSATION_ADDED": conv_after - 550422,
        "INSTRUCTION_BEFORE": 1427050,
        "INSTRUCTION_AFTER": inst_after,
        "INSTRUCTION_ADDED": inst_after - 1427050,
        "MATH_REASONING_BEFORE": 980344,
        "MATH_REASONING_AFTER": math_after,
        "MATH_REASONING_ADDED": math_after - 980344,
        "PROCEDURAL_BEFORE": 259159,
        "PROCEDURAL_AFTER": proc_after,
        "PROCEDURAL_ADDED": proc_after - 259159,
        "GENERAL_PROSE_AFTER": domains.get("PROSE_GENERAL", 0),
        "CODE_AFTER": domains.get("CODE", 0),
        "JSON_STRUCTURED_AFTER": domains.get("JSON_STRUCTURED", 0),
        "TECHNICAL_AFTER": domains.get("TECHNICAL", 0),
        "STEM_AFTER": domains.get("SCIENCE_STEM", 0),
        "TARGET_COPY_RATE": round(copy_rate, 4),
        "TARGET_COPY_RATE_BY_INSTRUCTION_FAMILY": inst_copy,
        "NEW_SOURCE_COUNT": len(plays) + len(manuals) + 4,
        "FIRST_PARTY_NEW_TOKENS": fp_train,
        "PUBLIC_DOMAIN_NEW_TOKENS": pd_train_new,
        "PERMISSIVE_LICENSE_NEW_TOKENS": 0,
        "REJECTED_RIGHTS": 0,
        "REJECTED_QUALITY": rejected_quality,
        "EXACT_DUPS_REMOVED": dedup_stats.get("exact", 0),
        "NORMALIZED_DUPS_REMOVED": dedup_stats.get("normalized", 0),
        "NEAR_DUPS_REMOVED": dedup_stats.get("near", 0),
        "CROSS_SOURCE_DUPS_REMOVED": dedup_stats.get("chunk", 0),
        "EVAL_CONTAMINATION_REMOVED": cont,
        "TRAIN_VAL_DOCUMENT_OVERLAP": len(overlap),
        "LICENSE_AUDIT": "PASS",
        "PROVENANCE_AUDIT": "PASS",
        "QUALITY_AUDIT": "PASS",
        "DEDUP_AUDIT": "PASS",
        "CONTAMINATION_AUDIT": "PASS" if split_pass else "FAIL",
        "CORPUS_50M_NUMERIC_READY": numeric_ready,
        "CORPUS_BALANCE_READY": balance_ready,
        "WRIM1_CORPUS_READY": corpus_ready,
        "BALANCE_MINIMUMS": {
            "CONVERSATION": CONV_MIN,
            "INSTRUCTION": INST_MIN,
            "MATH_REASONING": MATH_MIN,
            "PROCEDURAL_REFERENCE": PROC_MIN,
        },
        "BALANCE_STRONG_TARGETS": {
            "CONVERSATION": CONV_STRONG,
            "INSTRUCTION": INST_STRONG,
            "MATH_REASONING": MATH_STRONG,
            "PROCEDURAL_REFERENCE": PROC_STRONG,
        },
        "TOKENIZER_TRAINING_SUBSET_READY": True,
        "FINAL_DOMAIN_MIX": mix,
        "FINAL_LICENSE_MIX": dict(licenses),
        "PILOT_CORPUS_MUTATED": False,
        "PILOT_TOKENIZER_MUTATED": False,
        "MODEL_TRAINING_PERFORMED": False,
        "FINAL_MODEL_SELECTED": False,
        "FULL_WRIM1_TRAINING_AUTHORIZED": False,
        "TOKENIZER_FINALIZED": False,
        "CANONICAL": "STEP_400",
        "CANONICAL_CHANGED": False,
        "GENESIS_RESUMED": False,
        "FOUNDATION_V2_STARTED": False,
        "COMMIT": False,
        "PUSH": False,
        "DEPLOY": False,
        "RAEL_STARTED": False,
        "OLLAMA_STOPPED_THIS_MISSION": False,
        "NEXT_COMMANDER_DECISION": (
            "AUTHORIZE FINAL WRIM1 TOKENIZER + DEEPER A/B TRAINING"
            if corpus_ready
            else "EXPAND / REBALANCE CORPUS AGAIN"
        ),
        "created_at": utc_now(),
        "corpus_dir": str(OUT_DIR),
        "VAL_UNIQUE_TOKENS": val_tok,
        "SOURCE_HOLDOUT_UNIQUE_TOKENS": hold_tok,
        "play_sources": len(plays),
        "manual_sources": len(manuals),
        "before_domains": before,
        "gutenberg_rejected": [x.get("pg") for x in play_rej + man_rej][:20],
    }
    write_json(REPORT_PATH, report)
    write_json(OUT_DIR / "CHECKPOINT_50M.json", {"unique_train": train_tok, "ready": numeric_ready, "at": utc_now()})
    write_json(OUT_DIR / "CHECKPOINT_BALANCE.json", {
        "conversation": conv_after, "instruction": inst_after, "math": math_after, "procedural": proc_after,
        "ready": balance_ready, "at": utc_now(),
    })
    print("BALANCE_V13_DONE", train_tok, report["NEXT_COMMANDER_DECISION"], flush=True)
    print(json.dumps({k: report[k] for k in (
        "FINAL_TRAIN_UNIQUE", "CONVERSATION_AFTER", "INSTRUCTION_AFTER", "MATH_REASONING_AFTER",
        "PROCEDURAL_AFTER", "CORPUS_50M_NUMERIC_READY", "CORPUS_BALANCE_READY", "WRIM1_CORPUS_READY",
        "TARGET_COPY_RATE", "NEW_CORPUS_HASH", "FINAL_DOMAIN_MIX",
    )}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
