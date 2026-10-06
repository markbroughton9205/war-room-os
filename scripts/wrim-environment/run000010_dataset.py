"""WR-CORPUS-MODE-ENTRY-1-v1.0.0 generator and freeze.

Instruction + stopping only. Does not mutate Stage 3 / addendum / capability-1 / tokenizer.
Does not construct an optimizer.
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from run000008_dataset import (
    HARD_BANNED,
    join_prompt_target,
    load_heldout_strings,
    load_jsonl,
    normalize,
    quality_scan,
    scan_leakage,
    sha256_file,
    sha256_text,
    utc_now,
)
from run000008_identity import ADDENDUM_NEEDLES, BANNED_STAGE3_KEYS, LINUX_DATA_ROOT
from run000010_identity import MODE_ENTRY_DATASET_ID, MODE_ENTRY_DATASET_VERSION, SEED

DATASET_DIRNAME = MODE_ENTRY_DATASET_VERSION
TRAIN_NAME = f"{MODE_ENTRY_DATASET_VERSION}-TRAIN.jsonl"
VAL_NAME = f"{MODE_ENTRY_DATASET_VERSION}-VALIDATION.jsonl"
MANIFEST_NAME = f"{MODE_ENTRY_DATASET_VERSION}-MANIFEST.json"
SHA_NAME = f"{MODE_ENTRY_DATASET_VERSION}-SHA256.json"

TRAIN_TARGETS = {"instruction": 650, "stopping": 320}
VAL_TARGETS = {"instruction": 80, "stopping": 40}


def example_id(split: str, category: str, payload: str) -> str:
    return f"me1_{split}_{category}_{sha256_text(payload)[:20]}"


def make_ex(
    *,
    split: str,
    category: str,
    subtype: str,
    prompt: str,
    target: str,
    validator: dict[str, Any],
    notes: str = "",
) -> dict[str, Any]:
    text = join_prompt_target(prompt, target)
    eid = example_id(split, category, text)
    return {
        "example_id": eid,
        "dataset_id": MODE_ENTRY_DATASET_ID,
        "dataset_version": MODE_ENTRY_DATASET_VERSION,
        "split": split,
        "category": category,
        "subtype": subtype,
        "prompt": prompt,
        "target": target,
        "text": text,
        "validator": validator,
        "quality_notes": notes,
        "content_hash": sha256_text(text),
        "prompt_hash": sha256_text(prompt),
        "target_hash": sha256_text(target),
    }


def _pool(split: str) -> dict[str, Any]:
    if split == "train":
        return {
            "markers": [
                "MAPLE-LOCK-CHIT",
                "QUILL-BARN-TALLY",
                "CEDAR-SPIT-BADGE",
                "FENNEL-ARCH-CLIP",
                "ROWAN-KILN-DISK",
                "PINE-WHARF-SEAL",
                "SAGE-COVE-STAMP",
                "BIRCH-LANE-TOKEN",
                "ALDER-PIT-GLYPH",
                "WILLOW-DAM-MARK",
                "HAZEL-RIDGE-PIN",
                "ASPEN-FORD-BAND",
                "OLIVE-PIER-RING",
                "MYRTLE-HILL-TAB",
                "LAUREL-CUT-WEDGE",
                "HOLLY-BANK-CORE",
                "JUNIPER-BEND-PLATE",
                "CYPRESS-GAP-KNOT",
                "POPLAR-REST-CHIP",
                "YEW-SHELF-RUNE",
                "BEECH-GATE-DISK",
                "ELM-MARSH-SEAL",
                "ASH-HOLLOW-CLIP",
                "FIR-ORCHARD-TAG",
                "SPRUCE-WELL-PIN",
                "CEDAR-CROFT-BAND",
                "LINDEN-SPIT-MARK",
                "WALNUT-KILN-CHIT",
                "CHESTNUT-DAM-TALLY",
                "PECAN-WHARF-BADGE",
            ],
            "words": [
                "amber", "bramble", "cinder", "dapple", "ember", "flint", "gravel", "heather",
                "indigo", "jasper", "keel", "linen", "maple", "nacre", "ochre", "pebble",
                "quartz", "russet", "sienna", "tinder", "umber", "violet", "willow", "xylem",
                "yarrow", "zinnia", "barley", "clover", "drift", "elder",
            ],
            "nouns": [
                "cratelet", "hopper", "spool", "latch", "gasket", "pallet", "cleat", "rivet",
                "shackle", "bung", "flange", "toggle", "washer", "keelson", "thimble", "grommet",
                "hasp", "pintle", "fairlead", "clevis",
            ],
            "prefix": "ME10-",
            "seed_tag": "train1010",
        }
    return {
        "markers": [
            "IRON-MERE-CHIT",
            "SLATE-BARN-TALLY",
            "COPPER-SPIT-BADGE",
            "TIN-ARCH-CLIP",
            "BRASS-KILN-DISK",
            "LEAD-WHARF-SEAL",
            "ZINC-COVE-STAMP",
            "NICKEL-LANE-TOKEN",
            "CHROME-PIT-GLYPH",
            "COBALT-DAM-MARK",
            "SILVER-RIDGE-PIN",
            "GOLD-FORD-BAND",
            "PLATINUM-PIER-RING",
            "BRONZE-HILL-TAB",
            "STEEL-CUT-WEDGE",
            "PEWTER-BANK-CORE",
        ],
        "words": [
            "anvil", "bellows", "crucible", "dolly", "easel", "forge", "gantry", "hearth",
            "ingot", "jig", "kiln", "lathe", "mandrel", "nozzle", "anvilrest", "burr",
        ],
        "nouns": [
            "billet", "casting", "die", "ejector", "fixture", "guide", "holder", "insert",
            "jaw", "keeper", "liner", "mandrelcap", "nest", "orifice", "platen", "quill",
        ],
        "prefix": "ME10V-",
        "seed_tag": "val10101",
    }


def _uniq(out: list[dict[str, Any]], n: int, split: str, category: str, factory) -> list[dict[str, Any]]:
    seen = set()
    uniq = []
    for ex in out:
        if ex["content_hash"] in seen:
            continue
        seen.add(ex["content_hash"])
        uniq.append(ex)
    extra_i = 0
    while len(uniq) < n and extra_i <= n * 50:
        ex = factory(extra_i)
        extra_i += 1
        if ex["content_hash"] in seen:
            continue
        seen.add(ex["content_hash"])
        uniq.append(ex)
    return uniq[:n]


def gen_instruction(split: str, n: int) -> list[dict[str, Any]]:
    p = _pool(split)
    out: list[dict[str, Any]] = []

    def add(subtype: str, prompt: str, target: str, validator: dict[str, Any]) -> None:
        out.append(
            make_ex(
                split=split,
                category="instruction",
                subtype=subtype,
                prompt=prompt,
                target=target,
                validator=validator,
            )
        )

    for m in p["markers"]:
        add("exact_quote", f'Return only the quoted label and halt. Label: "{m}"', m, {"type": "exact_text", "expected": m})
        add("exact_marker", f"Emit this tag with zero extra characters: {m}", m, {"type": "exact_text", "expected": m})
        add("extract_only", f"Keep only the tag from: bay tag {m} rack west.", m, {"type": "span", "span": m, "max_words": 2})

    facts = [
        ("How many wheels does a bicycle have?", "2"),
        ("How many legs does a typical dog have?", "4"),
        ("How many hours are in half a day?", "12"),
        ("What is 3 plus 5?", "8"),
        ("What is 10 minus 3?", "7"),
        ("What is 6 times 2?", "12"),
        ("The antonym of hot is", "cold"),
        ("The antonym of night is", "day"),
        ("The antonym of wet is", "dry"),
        ("The antonym of left is", "right"),
        ("A triangle has how many sides?", "3"),
        ("A hexagon has how many sides?", "6"),
        ("The first day of a common week is", "Sunday") if split == "train" else ("A weekend day is", "Saturday"),
        ("Water freezes at zero degrees", "celsius") if split == "train" else ("Boiling water is", "steam"),
        ("The color of a ripe lemon is", "yellow"),
        ("The color of unoxidized copper roofs is often", "green") if split != "train" else ("The color of dry sand is", "tan"),
        ("One plus zero equals", "1"),
        ("Eight divided by two equals", "4"),
        ("A pair contains how many items?", "2"),
        ("A trio contains how many items?", "3"),
        ("North is opposite", "south"),
        ("East is opposite", "west"),
        ("True is the opposite of", "false"),
        ("On is the opposite of", "off"),
        ("Start is the opposite of", "stop"),
        ("The chemical symbol for oxygen is", "O") if split == "train" else ("The chemical symbol for hydrogen is", "H"),
        ("There are how many letters in the English word cat?", "3"),
        ("There are how many letters in the English word four?", "4"),
        ("A cube has how many faces?", "6"),
        ("A cube has how many corners?", "8"),
    ]
    for prompt, ans in facts:
        add("one_word", f"Answer with exactly one token, then halt. {prompt}", ans, {"type": "one_word", "accepted": [ans, ans.lower(), ans.upper()]})

    for i, w in enumerate(p["words"]):
        noun = p["nouns"][i % len(p["nouns"])]
        add("lowercase_only", f"Lowercase only, no digits. status of the {noun} is", "clear to move", {"type": "lowercase_no_digits"})
        add("uppercase_only", f"Uppercase this id and halt: {w}/{noun}", f"{w.upper()}/{noun.upper()}", {"type": "span", "span": f"{w.upper()}/{noun.upper()}"})
        add("one_line", f"One line only, no trailing comment: {w} {noun}", f"{w} {noun}", {"type": "exact_text", "expected": f"{w} {noun}"})

    csv_rows = [(p["words"][i], p["words"][(i + 3) % len(p["words"])], p["words"][(i + 7) % len(p["words"])]) for i in range(min(24, len(p["words"])))]
    for a, b, c in csv_rows:
        add("csv", f"Three tokens, commas only, no spaces around commas: {a},{b},{c}", f"{a},{b},{c}", {"type": "csv", "tokens": [a, b, c]})

    delims = [
        "NORTH/HOLD/SOUTH",
        "IN#WAIT#OUT",
        "A||B||C",
        "LOW::MID::HIGH",
        "GO~HOLD~STOP",
        "P1/P2/P3",
        "OPEN|SET|SHUT",
        "UP^LEVEL^DOWN",
        "ONE;TWO;THREE",
        "R0-R1-R2",
        "RED+GRN+BLU",
        "ON=WAIT=OFF",
        "LEFT<<HOLD<<RIGHT",
        "TOP.MID.BOT",
        "IN*HOLD*OUT",
        "RUN+IDLE+HALT",
        "YES/HOLD/NO",
        "MIN:NOM:MAX",
        "A>>B>>C",
        "L0_L1_L2",
    ]
    for d in delims:
        add("delimiter", f"Copy this delimiter string exactly, nothing else: {d}", d, {"type": "exact_text", "expected": d})

    for i, noun in enumerate(p["nouns"]):
        pref = f"{p['prefix']}{i:02d}-"
        add("exact_prefix", f"Begin with exactly {pref} then append {noun}. No other text.", f"{pref}{noun}", {"type": "prefix", "prefix": pref})
        add("exact_suffix", f"Write {noun} and end with exactly -HALT. No other text.", f"{noun}-HALT", {"type": "suffix", "suffix": "-HALT"})
        add(
            "no_prose_format",
            f"Two lines only:\nunit: {noun}\nslot: {i + 1}",
            f"unit: {noun}\nslot: {i + 1}",
            {"type": "key_value", "keys": ["unit", "slot"]},
        )
        add(
            "forbidden_token",
            f"Name the {noun} in one short sentence. Never write banana, PIPE=, or Alice.",
            f"The {noun} stayed on the bench after inspection.",
            {"type": "forbidden", "terms": ["banana", "alice"], "forbid_substrings": ["PIPE=", "<|", "```"]},
        )

    orders = [
        ("PACK", "SEAL"),
        ("RINSE", "STORE"),
        ("SCAN", "FILE"),
        ("WEIGH", "LABEL"),
        ("PRIME", "RUN"),
        ("CLAMP", "TEST"),
        ("READ", "STAMP"),
        ("OPEN", "SECURE"),
        ("BLEND", "FILL"),
        ("ALIGN", "LOCK"),
        ("COUNT", "CRATE"),
        ("DRAFT", "SIGN"),
        ("COOL", "BOX"),
        ("FOLD", "TIE"),
        ("CHECK", "PASS"),
        ("HEAT", "SET"),
        ("PUSH", "LATCH"),
        ("CALL", "LOG"),
        ("MARK", "SHIP"),
        ("WIPE", "COVER"),
    ]
    for a, b in orders:
        add("ordered", f"Write {a} before {b}. Do not reverse.", f"{a} {b}", {"type": "ordered", "terms": [a.lower(), b.lower()]})

    for i, w in enumerate(p["words"][:20]):
        items = [f"{w}-{k}" for k in range(1, 4)]
        add("fixed_list", f"Exactly three lines, each a hyphenated label from base {w}.", "\n".join(items), {"type": "line_count", "n": 3})
        add("stop_after", f"Reply with only {w} then halt immediately.", w, {"type": "exact_text", "expected": w})
        noun = p["nouns"][i % len(p["nouns"])]
        add(
            "multi_constraint",
            f"Exactly two lowercase words, no digits: {w} {noun}",
            f"{w} {noun}",
            {"type": "multi", "required_terms": [w, noun], "max_words": 2, "lowercase_no_digits": True},
        )

    casing = [
        ("Emit the word Ready in Title case only.", "Ready"),
        ("Emit the word idle in lowercase only.", "idle"),
        ("Emit the word STOP in uppercase only.", "STOP"),
        ("Emit the word Hold in Title case only.", "Hold"),
        ("Emit the word clear in lowercase only.", "clear"),
        ("Emit the word WAIT in uppercase only.", "WAIT"),
        ("Emit the word Done in Title case only.", "Done"),
        ("Emit the word skip in lowercase only.", "skip"),
    ]
    for prompt, target in casing:
        add("casing", f"{prompt} No other text.", target, {"type": "exact_text", "expected": target})

    def factory(i: int) -> dict[str, Any]:
        m = p["markers"][i % len(p["markers"])]
        w = p["words"][(i // len(p["markers"])) % len(p["words"])]
        noun = p["nouns"][(i // (len(p["markers"]) * len(p["words"]))) % len(p["nouns"])]
        templates = (
            (f"Print only {m}#{w} and halt.", f"{m}#{w}"),
            (f"Emit {w}|{noun} with no other characters.", f"{w}|{noun}"),
            (f"Write exactly {m} then stop. No prose.", m),
        )
        prompt, target = templates[i % len(templates)]
        return make_ex(
            split=split,
            category="instruction",
            subtype="pair_halt",
            prompt=prompt,
            target=target,
            validator={"type": "exact_text", "expected": target},
        )

    return _uniq(out, n, split, "instruction", factory)


def gen_stopping(split: str, n: int) -> list[dict[str, Any]]:
    p = _pool(split)
    out: list[dict[str, Any]] = []

    def add(subtype: str, prompt: str, target: str, validator: dict[str, Any]) -> None:
        out.append(
            make_ex(
                split=split,
                category="stopping",
                subtype=subtype,
                prompt=prompt,
                target=target,
                validator=validator,
            )
        )

    for w in p["words"]:
        add("short_exact", f"Output {w} once, then stop. No second word.", w, {"type": "stopping", "exact": w, "max_words": 1})
        add("stop_after_one", f"One item only: {w}. Stop after that item.", w, {"type": "stopping", "exact": w, "max_words": 1})
        add("once_stop", f"Say {w} a single time.", w, {"type": "stopping", "exact": w, "max_words": 1})

    for m in p["markers"]:
        add("eos_after", f"Print {m} once. No commentary after it.", m, {"type": "stopping", "exact": m, "max_words": 3})

    for noun in p["nouns"]:
        add("no_commentary", f"Output the noun {noun} only.", noun, {"type": "stopping", "exact": noun, "max_words": 1})

    add("no_repeat_punct", "Print a single exclamation mark and stop.", "!", {"type": "stopping", "exact": "!", "max_words": 1, "no_repeat_punct": True})
    add("no_underscore_loop", "Print HALT once. Do not print underscores.", "HALT", {"type": "stopping", "exact": "HALT", "forbid": ["___"]})
    add("no_colon_lead", "Do not start with a colon. Reply ready.", "ready", {"type": "stopping", "exact": "ready", "forbid": [":"]})
    add("no_tokenizer_chatter", "Do not mention tokenizers. Reply ok.", "ok", {"type": "stopping", "exact": "ok", "forbid": ["tokenizer", "TOKENIZER"]})
    add("no_schema_chatter", "Do not emit a schema. Reply idle.", "idle", {"type": "stopping", "exact": "idle", "forbid": ["tokenizer", "properties"]})
    add("no_literary", "Do not continue a story. Reply closed.", "closed", {"type": "stopping", "exact": "closed", "forbid": ["alice", "gryphon"]})

    for i, w in enumerate(p["words"][:18]):
        line = f"{w} complete"
        add("no_line_loop", f"Write this line once and stop: {line}", line, {"type": "stopping", "exact": line, "no_line_repeat": True})

    def factory(i: int) -> dict[str, Any]:
        w = p["words"][i % len(p["words"])]
        noun = p["nouns"][(i // len(p["words"])) % len(p["nouns"])]
        m = p["markers"][(i // (len(p["words"]) * len(p["nouns"]))) % len(p["markers"])]
        variants = (
            (f"Return {w} and stop immediately.", w),
            (f"Output {noun} once. Halt.", noun),
            (f"Print {m} and do not continue.", m),
            (f"Give only {w}-{noun} then stop.", f"{w}-{noun}"),
        )
        prompt, target = variants[i % len(variants)]
        return make_ex(
            split=split,
            category="stopping",
            subtype="once_stop",
            prompt=prompt,
            target=target,
            validator={"type": "stopping", "exact": target, "max_words": 3},
        )

    return _uniq(out, n, split, "stopping", factory)


def generate_split(split: str) -> list[dict[str, Any]]:
    targets = TRAIN_TARGETS if split == "train" else VAL_TARGETS
    rows = []
    rows.extend(gen_instruction(split, targets["instruction"]))
    rows.extend(gen_stopping(split, targets["stopping"]))
    return rows


def counts(rows: list[dict[str, Any]]) -> dict[str, int]:
    c = Counter(ex["category"] for ex in rows)
    return {"instruction": int(c.get("instruction") or 0), "stopping": int(c.get("stopping") or 0)}


def default_paths() -> dict[str, Path]:
    data = Path(LINUX_DATA_ROOT)
    here = Path(__file__).resolve().parent
    return {
        "out_dir": data / DATASET_DIRNAME,
        "suite": here / "evals" / "WRIM-EVAL-S3-000001.json",
        "addendum": data / "WRIM-EVAL-S3-INSTRUCTION-ADDENDUM-000001.json",
        "cap1_val": data / "WR-CORPUS-CAPABILITY-1-v1.0.0" / "WR-CORPUS-CAPABILITY-1-v1.0.0-VALIDATION.jsonl",
        "cap1_train": data / "WR-CORPUS-CAPABILITY-1-v1.0.0" / "WR-CORPUS-CAPABILITY-1-v1.0.0-TRAIN.jsonl",
    }


def extra_overlap_hits(rows: list[dict[str, Any]], other_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    other_hash = {ex.get("content_hash") for ex in other_rows}
    other_norm = {normalize(ex.get("text") or "") for ex in other_rows}
    hits = []
    for ex in rows:
        if ex["content_hash"] in other_hash or normalize(ex["text"]) in other_norm:
            hits.append({"example_id": ex["example_id"], "reason": "text_overlap"})
    return hits


def freeze_dataset(*, out_dir: Path | None = None, suite_path: Path | None = None, addendum_path: Path | None = None) -> dict[str, Any]:
    paths = default_paths()
    out_dir = Path(out_dir or paths["out_dir"])
    suite_path = Path(suite_path or paths["suite"])
    addendum_path = Path(addendum_path or paths["addendum"])
    train = generate_split("train")
    val = generate_split("validation")
    train_hash = {ex["content_hash"] for ex in train}
    train_norm = {normalize(t["text"]) for t in train}
    val = [ex for ex in val if ex["content_hash"] not in train_hash and normalize(ex["text"]) not in train_norm]
    if len(val) < sum(VAL_TARGETS.values()):
        extra = generate_split("validation")
        seen = {ex["content_hash"] for ex in val} | train_hash
        for ex in extra:
            if ex["content_hash"] in seen or normalize(ex["text"]) in train_norm:
                continue
            val.append(ex)
            seen.add(ex["content_hash"])
        trimmed = []
        used = Counter()
        for ex in val:
            if used[ex["category"]] >= VAL_TARGETS[ex["category"]]:
                continue
            trimmed.append(ex)
            used[ex["category"]] += 1
        val = trimmed

    cap_rows = []
    for pth in (paths["cap1_val"], paths["cap1_train"]):
        if pth.is_file():
            cap_rows.extend(load_jsonl(pth))
    cap_hash = {ex.get("content_hash") for ex in cap_rows}
    cap_norm = {normalize(ex.get("text") or "") for ex in cap_rows}

    def drop_cap1(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [ex for ex in rows if ex["content_hash"] not in cap_hash and normalize(ex["text"]) not in cap_norm]

    train = drop_cap1(train)
    val = drop_cap1(val)
    all_rows = train + val
    heldout = load_heldout_strings(suite_path, addendum_path)
    leak = scan_leakage(all_rows, heldout)
    qual = quality_scan(all_rows)
    cap_hits = extra_overlap_hits(all_rows, cap_rows)
    banned_hits = []
    banned = set(HARD_BANNED) | set(ADDENDUM_NEEDLES) | set(BANNED_STAGE3_KEYS)
    for ex in all_rows:
        blob = f"{ex.get('prompt')}\n{ex.get('target')}\n{ex.get('text')}"
        found = [b for b in banned if b and b in blob]
        if found:
            banned_hits.append({"example_id": ex["example_id"], "needles": found})
    if leak["STAGE3_LEAKAGE"] != 0 or leak["INSTRUCTION_ADDENDUM_LEAKAGE"] != 0:
        raise RuntimeError(f"leakage freeze abort: {leak}")
    if cap_hits:
        raise RuntimeError(f"capability1 overlap abort: {cap_hits[:8]}")
    if banned_hits:
        raise RuntimeError(f"banned needle abort: {banned_hits[:8]}")
    if qual["EXACT_DUPLICATES"] or qual["NORMALIZED_DUPLICATES"]:
        raise RuntimeError(f"duplicate freeze abort: {qual}")
    tc = counts(train)
    vc = counts(val)
    if tc["instruction"] < 500 or tc["stopping"] < 250:
        raise RuntimeError(f"train count below target band: {tc}")
    if vc["instruction"] < 40 or vc["stopping"] < 20:
        raise RuntimeError(f"validation count below target band: {vc}")

    out_dir.mkdir(parents=True, exist_ok=True)
    train_path = out_dir / TRAIN_NAME
    val_path = out_dir / VAL_NAME
    with train_path.open("w", encoding="utf-8") as f:
        for ex in train:
            f.write(json.dumps(ex, ensure_ascii=False) + "\n")
    with val_path.open("w", encoding="utf-8") as f:
        for ex in val:
            f.write(json.dumps(ex, ensure_ascii=False) + "\n")
    train_sha = sha256_file(train_path)
    val_sha = sha256_file(val_path)
    ds_hash = sha256_text(train_sha + val_sha)
    manifest = {
        "kind": "WR_CORPUS_MODE_ENTRY_1_MANIFEST",
        "dataset_id": MODE_ENTRY_DATASET_ID,
        "dataset_version": MODE_ENTRY_DATASET_VERSION,
        "frozen": True,
        "freeze_timestamp": utc_now(),
        "generator": "scripts/wrim-environment/run000010_dataset.py",
        "generator_sha256": sha256_file(Path(__file__).resolve()),
        "seed_train": SEED,
        "seed_validation": 10101,
        "format": "raw_lm_continuation_prompt_plus_target",
        "wrap": "BOS_body_EOS_at_pack_time",
        "MODE_ENTRY_TRAIN_COUNT": len(train),
        "MODE_ENTRY_VALIDATION_COUNT": len(val),
        "train_category_counts": counts(train),
        "validation_category_counts": counts(val),
        "EXACT_DUPLICATES": qual["EXACT_DUPLICATES"],
        "NORMALIZED_DUPLICATES": qual["NORMALIZED_DUPLICATES"],
        "NEAR_DUPLICATES": qual["NEAR_DUPLICATES"],
        "STAGE3_LEAKAGE": leak["STAGE3_LEAKAGE"],
        "INSTRUCTION_ADDENDUM_LEAKAGE": leak["INSTRUCTION_ADDENDUM_LEAKAGE"],
        "CAPABILITY1_OVERLAP": 0,
        "JSON_EXAMPLE_COUNT": 0,
        "CODE_EXAMPLE_COUNT": 0,
        "train_path": str(train_path),
        "validation_path": str(val_path),
        "train_sha256": train_sha,
        "validation_sha256": val_sha,
        "MODE_ENTRY_DATASET_HASH": ds_hash,
        "stage3_mutated": False,
        "instruction_addendum_mutated": False,
        "capability_dataset_mutated": False,
    }
    man_path = out_dir / MANIFEST_NAME
    man_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    sha_doc = {
        "dataset_id": MODE_ENTRY_DATASET_ID,
        "dataset_version": MODE_ENTRY_DATASET_VERSION,
        "files": {
            TRAIN_NAME: train_sha,
            VAL_NAME: val_sha,
            MANIFEST_NAME: sha256_file(man_path),
        },
        "MODE_ENTRY_DATASET_HASH": ds_hash,
    }
    sha_path = out_dir / SHA_NAME
    sha_path.write_text(json.dumps(sha_doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    sha_doc["files"][SHA_NAME] = sha256_file(sha_path)
    sha_path.write_text(json.dumps(sha_doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return {
        "ok": True,
        "manifest": manifest,
        "sha": sha_doc,
        "MODE_ENTRY_DATASET_HASH": ds_hash,
        "train_count": len(train),
        "validation_count": len(val),
        "STAGE3_LEAKAGE": leak["STAGE3_LEAKAGE"],
        "INSTRUCTION_ADDENDUM_LEAKAGE": leak["INSTRUCTION_ADDENDUM_LEAKAGE"],
    }


if __name__ == "__main__":
    print(json.dumps({k: freeze_dataset().get(k) for k in ("ok", "MODE_ENTRY_DATASET_HASH", "train_count", "validation_count", "STAGE3_LEAKAGE", "INSTRUCTION_ADDENDUM_LEAKAGE")}, indent=2))
