"""WR-CORPUS-CAPABILITY-1-v1.0.0 generator and freeze.

Leakage-safe positive curriculum. Does not mutate frozen Stage 3 / addendum / WR-CORPUS-0/1.
Does not construct an optimizer.
"""
from __future__ import annotations

import ast
import hashlib
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from run000008_identity import (
    ADDENDUM_NEEDLES,
    BANNED_STAGE3_KEYS,
    DATASET_ID,
    DATASET_VERSION,
    LINUX_DATA_ROOT,
    SEED,
)

DATASET_DIRNAME = DATASET_VERSION
TRAIN_NAME = f"{DATASET_VERSION}-TRAIN.jsonl"
VAL_NAME = f"{DATASET_VERSION}-VALIDATION.jsonl"
MANIFEST_NAME = f"{DATASET_VERSION}-MANIFEST.json"
SHA_NAME = f"{DATASET_VERSION}-SHA256.json"

TRAIN_TARGETS = {"instruction": 300, "json": 300, "code": 300, "stopping": 150}
VAL_TARGETS = {"instruction": 34, "json": 34, "code": 34, "stopping": 17}

# Distinctive held-out answer tokens / keys that must never appear in training.
HARD_BANNED = set(ADDENDUM_NEEDLES) | {
    "KELVARRE",
    "Kelvarre",
    "kelvarre",
    "Quindle",
    "Noxhollow",
    "tally_quayside",
    "quay_id",
    "crate_count",
    "inner_flag",
    "VESPER-OXIDE-BADGE",
    "NOK-17",
    "NIMBUS-WICK",
    "OX-4417",
    "BEGIN|MID|END",
    "alpha, bravo, charlie",
    "copper lantern",
    "wooden peg",
    "clay token",
    "brass tag",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def normalize(text: str) -> str:
    collapsed = unicodedata.normalize("NFKC", text or "")
    collapsed = collapsed.casefold()
    collapsed = re.sub(r"\s+", " ", collapsed).strip()
    collapsed = re.sub(r"[\"'`]+", "", collapsed)
    return collapsed


def example_id(split: str, category: str, payload: str) -> str:
    return f"cap1_{split}_{category}_{sha256_text(payload)[:20]}"


def join_prompt_target(prompt: str, target: str) -> str:
    if prompt.endswith(("\n", "=", " ", "\t")):
        return prompt + target
    return prompt + "\n" + target


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
        "dataset_id": DATASET_ID,
        "dataset_version": DATASET_VERSION,
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


# ---------------------------------------------------------------------------
# Payload pools — train vs val are independently authored, disjoint strings.
# ---------------------------------------------------------------------------

TRAIN_MARKERS = [
    "ORRIS-FEN-SIGIL",
    "TALBOT-SPIRE-TOKEN",
    "ZELN-DOCK-BADGE",
    "PLOVER-HOLT-GLYPH",
    "AMBERWICK-SEAL",
    "SILTMERE-STAMP",
    "GANT-HOLLOW-CHIP",
    "REDKETTLE-MARK",
    "MOSSBARROW-TAG",
    "IVYBRAKE-RUNE",
    "CINDER-WELL-PIN",
    "FARROW-BEND-CLIP",
    "LUMEN-RIDGE-DISK",
    "THORN-MERE-BAND",
    "OSPREY-CUT-PLATE",
    "WELD-MARSH-KNOT",
    "BRINE-SHELF-RING",
    "HAZEL-FORD-WEDGE",
    "PEBBLE-GATE-CORE",
    "DUSK-ORCHARD-TAB",
]

VAL_MARKERS = [
    "MIRROR-BIRCH-SIGIL",
    "COBALT-STAIR-TOKEN",
    "FENNEC-ARCH-BADGE",
    "WILLOW-CROWN-GLYPH",
    "SABLE-POND-SEAL",
    "NUTMEG-HILL-STAMP",
    "ORBIT-LANE-CHIP",
    "FLINT-GROVE-MARK",
    "VELVET-PIER-TAG",
    "HARROW-MILL-RUNE",
    "QUINCE-BARN-PIN",
    "SOD-BRIDGE-CLIP",
    "EMBER-LOFT-DISK",
    "TALLOW-RIDGE-BAND",
    "NICKEL-SHADE-PLATE",
    "PRISM-HUT-KNOT",
    "CEDAR-SPIT-RING",
    "LAGOON-POST-WEDGE",
    "MARL-OVEN-CORE",
    "INDIGO-FIELD-TAB",
]

TRAIN_WORDS = [
    "amber", "silver", "copper", "violet", "indigo", "scarlet", "umber", "ivory",
    "cobalt", "saffron", "olive", "maroon", "teal", "coral", "pearl", "onyx",
    "hazel", "russet", "azure", "jade", "topaz", "flint", "maple", "cedar",
    "aspen", "willow", "birch", "poplar", "spruce", "hemlock",
]
VAL_WORDS = [
    "ginger", "mustard", "orchid", "linen", "pewter", "bronze", "ivory", "sienna",
    "chartreuse", "mauve", "taupe", "crimson", "navy", "slate", "fog", "moss",
    "pine", "oak", "elm", "beech", "alder", "larch", "yew", "holly",
    "iris", "lotus", "peony", "aster", "dahlia", "tulip",
]

TRAIN_NOUNS = [
    "pebble", "twine", "ledger", "spool", "hinge", "bucket", "mallet", "stencil",
    "ribbon", "socket", "funnel", "plank", "rivet", "gasket", "pulley", "clamp",
    "trowel", "anvil", "chisel", "pegboard",
]
VAL_NOUNS = [
    "washer", "dowel", "sprocket", "beaker", "ladle", "apron", "pallet", "shingle",
    "rafter", "winch", "flange", "nozzle", "bellows", "yoke", "cleat", "grommet",
    "hasp", "toggle", "shim", "ferrule",
]

TRAIN_CSV = [
    ("delta", "echo", "foxtrot"),
    ("helium", "lithium", "boron"),
    ("maple", "spruce", "cedar"),
    ("north", "south", "inland"),
    ("solid", "liquid", "vapor"),
    ("open", "hold", "close"),
    ("read", "copy", "store"),
    ("left", "center", "right"),
    ("small", "medium", "large"),
    ("seed", "sprout", "canopy"),
    ("iron", "tin", "zinc"),
    ("dawn", "noon", "dusk"),
    ("row", "slot", "bin"),
    ("ink", "paper", "press"),
    ("hot", "warm", "cool"),
    ("first", "second", "third"),
    ("redact", "review", "file"),
    ("gather", "sort", "bind"),
    ("measure", "mark", "cut"),
    ("prime", "load", "fire"),
]
VAL_CSV = [
    ("kilo", "lima", "mike"),
    ("sodium", "potassium", "calcium"),
    ("ridge", "slope", "basin"),
    ("in", "through", "out"),
    ("dry", "damp", "wet"),
    ("start", "pause", "halt"),
    ("scan", "parse", "emit"),
    ("upper", "middle", "lower"),
    ("thin", "thick", "dense"),
    ("root", "stem", "leaf"),
    ("gold", "lead", "nickel"),
    ("week", "month", "year"),
    ("bay", "aisle", "rack"),
    ("wax", "wick", "flame"),
    ("fast", "steady", "slow"),
    ("alpha2", "beta2", "gamma2"),
    ("draft", "revise", "lock"),
    ("pick", "pack", "ship"),
    ("align", "clamp", "weld"),
    ("arm", "aim", "release"),
]

TRAIN_FUNCS = [
    "count_bins", "fold_labels", "trim_edges", "map_slots", "filter_odd",
    "parse_pair", "swap_ends", "scale_ints", "join_tags", "split_csv",
    "clamp_span", "uniq_keep", "sum_positive", "mask_zeros", "title_slug",
    "wrap_token", "shift_left", "rev_words", "pick_even", "merge_dicts",
    "norm_space", "first_upper", "last_digit", "safe_div", "repeat_n",
    "drop_empty", "zip_keys", "min_abs", "max_len", "is_palindrome",
]
VAL_FUNCS = [
    "tally_slots", "fold_names", "shave_edges", "map_bins", "filter_even",
    "parse_triple", "swap_mid", "scale_odds", "join_codes", "split_pipe",
    "clamp_range", "uniq_drop", "sum_negative", "mask_nines", "kebab_slug",
    "wrap_badge", "shift_right", "rev_chars", "pick_odd", "merge_maps",
    "norm_tabs", "last_upper", "first_digit", "safe_mod", "repeat_k",
    "drop_space", "zip_vals", "min_len", "max_abs", "is_mirror",
]


def _pool(split: str) -> dict[str, Any]:
    if split == "train":
        return {
            "markers": TRAIN_MARKERS,
            "words": TRAIN_WORDS,
            "nouns": TRAIN_NOUNS,
            "csv": TRAIN_CSV,
            "funcs": TRAIN_FUNCS,
            "prefix": "T",
            "seed_tag": "train8008",
        }
    return {
        "markers": VAL_MARKERS,
        "words": VAL_WORDS,
        "nouns": VAL_NOUNS,
        "csv": VAL_CSV,
        "funcs": VAL_FUNCS,
        "prefix": "V",
        "seed_tag": "val80081",
    }


def gen_instruction(split: str, n: int) -> list[dict[str, Any]]:
    p = _pool(split)
    out: list[dict[str, Any]] = []

    def add(subtype: str, prompt: str, target: str, validator: dict[str, Any]) -> None:
        out.append(make_ex(split=split, category="instruction", subtype=subtype, prompt=prompt, target=target, validator=validator))

    for i, m in enumerate(p["markers"]):
        add("exact_quote_repeat", f'Echo the quoted identifier once and halt. Identifier: "{m}"', m, {"type": "span", "span": m, "max_words": 3})
        add("exact_marker", f"Print this identifier with no extra text: {m}", m, {"type": "exact_text", "expected": m})
        add("copy_span", f"Copy this span with no extra words: {m}-OK", f"{m}-OK", {"type": "span", "span": f"{m}-OK", "max_words": 2})

    one_word = [
        ("The color of ripe bananas is", "yellow"),
        ("The color of a clear noon sky is", "blue"),
        ("The color of fresh grass is", "green"),
        ("The color of clean snow is", "white"),
        ("The color of charcoal is", "black"),
        ("The number of hours in one day is", "24"),
        ("The number of minutes in one hour is", "60"),
        ("The number of days in one week is", "7"),
        ("A square has how many equal sides?", "4"),
        ("A pentagon has how many sides?", "5"),
        ("Ice is the solid form of", "water"),
        ("The opposite of up is", "down"),
        ("The opposite of empty is", "full"),
        ("The opposite of open is", "closed"),
        ("The opposite of yes is", "no"),
        ("The first month of the year is", "January") if split == "train" else ("The last month of the year is", "December"),
        ("A dozen is how many?", "12"),
        ("Half of ten is", "5"),
        ("Two plus two equals", "4"),
        ("Nine minus one equals", "8"),
    ]
    for prompt, ans in one_word[:20]:
        add("one_word", f"Give a single-word answer, then halt. {prompt}", ans, {"type": "one_word", "accepted": [ans, ans.lower(), ans.upper()]})

    for i, w in enumerate(p["words"][:18]):
        add("lowercase_only", f"Use lowercase letters only and no numerals. the {p['nouns'][i % len(p['nouns'])]} beside the {w} shelf is", f"ready for pickup", {"type": "lowercase_no_digits"})
        add("uppercase_only", f"Uppercase this slug and stop: {w}-{p['nouns'][i % len(p['nouns'])]}", f"{w.upper()}-{p['nouns'][i % len(p['nouns'])].upper()}", {"type": "span", "span": f"{w.upper()}-{p['nouns'][i % len(p['nouns'])].upper()}"})

    for a, b, c in p["csv"][:20]:
        add("csv", f"Emit three comma-separated words only: {a}, {b}, {c}", f"{a}, {b}, {c}", {"type": "csv", "tokens": [a, b, c]})

    delims = [
        ("HEAD/BODY/TAIL", "HEAD/BODY/TAIL"),
        ("OPEN#HOLD#SHUT", "OPEN#HOLD#SHUT"),
        ("A>>B>>C", "A>>B>>C"),
        ("L1::L2::L3", "L1::L2::L3"),
        ("START~MID~STOP", "START~MID~STOP"),
        ("P0/P1/P2", "P0/P1/P2"),
        ("IN|HOLD|OUT", "IN|HOLD|OUT"),
        ("UP^FLAT^DOWN", "UP^FLAT^DOWN"),
        ("ONE;TWO;THREE", "ONE;TWO;THREE"),
        ("W0-W1-W2", "W0-W1-W2"),
        ("R+G+B", "R+G+B"),
        ("ON=SET=OFF", "ON=SET=OFF"),
        ("LEFT<<MID<<RIGHT", "LEFT<<MID<<RIGHT"),
        ("TOP.MID.BOT", "TOP.MID.BOT"),
        ("IN*HOLD*OUT", "IN*HOLD*OUT"),
        ("GO+WAIT+REST", "GO+WAIT+REST"),
        ("YES/MAYBE/NO", "YES/MAYBE/NO"),
        ("LOW:MID:HIGH", "LOW:MID:HIGH"),
    ]
    for d, t in delims[:18]:
        add("delimiter", f"Reproduce this delimited line with no extra characters: {d}", t, {"type": "exact_text", "expected": t})

    for i, noun in enumerate(p["nouns"][:16]):
        pref = f"{p['prefix']}{i:02d}-"
        add("exact_prefix", f"Write the code starting with exactly {pref} then the noun {noun}. No other prose.", f"{pref}{noun}", {"type": "prefix", "prefix": pref})
        add("exact_suffix", f"Write the noun {noun} ending with exactly -OK. No other prose.", f"{noun}-OK", {"type": "suffix", "suffix": "-OK"})

    orders = [
        ("LOAD", "CHECK"),
        ("WASH", "DRY"),
        ("SORT", "BIND"),
        ("MEASURE", "CUT"),
        ("PRIME", "FIRE"),
        ("LOCK", "STOW"),
        ("READ", "WRITE"),
        ("OPEN", "CLOSE"),
        ("MIX", "POUR"),
        ("CLAMP", "WELD"),
        ("COUNT", "FILE"),
        ("SKETCH", "INK"),
        ("TASTE", "BOTTLE"),
        ("FOLD", "STACK"),
        ("ALIGN", "PIN"),
        ("HEAT", "COOL"),
        ("PUSH", "HOLD"),
        ("CALL", "WAIT"),
    ]
    for a, b in orders[:18]:
        add("ordered", f"Write {a} then {b} in that order. Do not reverse them.", f"{a} {b}", {"type": "ordered", "terms": [a.lower(), b.lower()]})

    for i in range(16):
        items = [f"{p['words'][i % len(p['words'])]}-{k}" for k in range(1, 4)]
        add("fixed_list", f"Output a list of exactly three hyphenated labels, one per line, using base {p['words'][i % len(p['words'])]}.", "\n".join(items), {"type": "line_count", "n": 3})

    for i, noun in enumerate(p["nouns"][:16]):
        add(
            "no_prose_format",
            f"Return exactly two lines and stop:\nitem: {noun}\nqty: {i + 2}",
            f"item: {noun}\nqty: {i + 2}",
            {"type": "key_value", "keys": ["item", "qty"]},
        )

    for i, noun in enumerate(p["nouns"][:16]):
        add(
            "forbidden_token",
            f"Describe a {noun} in one plain sentence. Never write banana, PIPE=, or Marvin.",
            f"The {noun} sat on the workbench until the shift ended.",
            {"type": "forbidden", "terms": ["banana", "marvin"], "forbid_substrings": ["PIPE=", "<|", "```"]},
        )

    for i, m in enumerate(p["markers"][:18]):
        sent = f"The field tag is {m} on the west ramp."
        add("extract_only", f"From this sentence extract only the id: {sent}", m, {"type": "span", "span": m, "max_words": 2})

    for i, w in enumerate(p["words"][:16]):
        add("stop_after", f"Reply with only {w} and stop.", w, {"type": "exact_text", "expected": w})

    for i in range(16):
        w = p["words"][i % len(p["words"])]
        noun = p["nouns"][i % len(p["nouns"])]
        add(
            "multi_constraint",
            f"Write exactly two lowercase words and no digits: {w} {noun}",
            f"{w} {noun}",
            {"type": "multi", "required_terms": [w, noun], "max_words": 2, "lowercase_no_digits": True},
        )

    # trim / pad to exact n with extra unique variants if needed
    seen = set()
    uniq = []
    for ex in out:
        if ex["content_hash"] in seen:
            continue
        seen.add(ex["content_hash"])
        uniq.append(ex)
    extra_i = 0
    while len(uniq) < n:
        m = p["markers"][extra_i % len(p["markers"])]
        w = p["words"][extra_i % len(p["words"])]
        prompt = f"Print only the pair {m}/{w} and stop."
        target = f"{m}/{w}"
        ex = make_ex(split=split, category="instruction", subtype="pair_stop", prompt=prompt, target=target, validator={"type": "exact_text", "expected": target})
        extra_i += 1
        if ex["content_hash"] in seen:
            continue
        seen.add(ex["content_hash"])
        uniq.append(ex)
    return uniq[:n]


def gen_json(split: str, n: int) -> list[dict[str, Any]]:
    p = _pool(split)
    out: list[dict[str, Any]] = []

    def add(subtype: str, prompt: str, obj: Any, validator: dict[str, Any]) -> None:
        target = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
        json.loads(target)
        out.append(make_ex(split=split, category="json", subtype=subtype, prompt=prompt, target=target, validator=validator))

    for i in range(40):
        k1, k2 = "dock_code", "bin_count"
        obj = {k1: f"{p['prefix']}{i}", k2: i + 3}
        add(
            "object_required_keys",
            f"Emit compact JSON only. Required keys {k1} (string) and {k2} (number). Instance {i}. JSON=",
            obj,
            {"type": "json_schema", "required_keys": [k1, k2], "types": {k1: "str", k2: "number"}},
        )
    for i in range(30):
        obj = {"hull": {"latch_set": bool(i % 2 == 0), "depth": i + 1}}
        add(
            "nested_object",
            f"Return compact JSON only. Nested object hull.latch_set must be boolean and hull.depth must be {i + 1}. JSON=",
            obj,
            {"type": "json_nested", "parent": "hull", "nested_key": "latch_set"},
        )
    for i in range(30):
        arr = [f"{p['nouns'][j % len(p['nouns'])]}-{i}" for j in range(3)]
        add(
            "array_exact_len",
            f"Emit a JSON array of length 3 whose strings name bench tools, instance {i}. JSON=",
            arr,
            {"type": "json_array", "len": 3, "element": "str"},
        )
    for i in range(25):
        obj = {"armed": bool(i % 2 == 0), "memo": None}
        add(
            "boolean_null",
            "Return only a JSON object with keys armed and memo. armed must be a boolean. memo must be null. JSON=",
            obj,
            {"type": "json_schema", "required_keys": ["armed", "memo"], "types": {"armed": "bool", "memo": "null"}},
        )
    for i in range(25):
        obj = {"label": p["words"][i % len(p["words"])], "mass": round(0.5 + i * 0.25, 2)}
        add(
            "numbers_strings",
            "Return only a JSON object with keys label and mass. label is a string. mass is a number. JSON=",
            obj,
            {"type": "json_schema", "required_keys": ["label", "mass"], "types": {"label": "str", "mass": "number"}},
        )
    enums = ["idle", "busy", "done"]
    for i in range(20):
        obj = {"state": enums[i % 3], "slot": i}
        add(
            "enum_value",
            'Return only a JSON object. state must be one of idle, busy, done. Include slot as a number. JSON=',
            obj,
            {"type": "json_enum", "key": "state", "allowed": enums},
        )
    for i in range(25):
        obj = {"ok": True, "n": i}
        add(
            "compact_only",
            "Return only compact JSON with keys ok and n. No spaces. No prose. JSON=",
            obj,
            {"type": "json_schema", "required_keys": ["ok", "n"], "compact": True, "types": {"ok": "bool", "n": "number"}},
        )
    for i in range(25):
        obj = {"id": f"{p['prefix']}X{i}"}
        if i % 2 == 0:
            obj["note_opt"] = p["nouns"][i % len(p["nouns"])]
        add(
            "omit_optional",
            "Return only a JSON object. Required key: id (string). Optional key note_opt (string) only if instructed to include it. "
            + ("Include note_opt. JSON=" if i % 2 == 0 else "Omit note_opt. JSON="),
            obj,
            {"type": "json_optional", "required_keys": ["id"], "optional_present": i % 2 == 0, "optional_key": "note_opt"},
        )
    for i in range(25):
        obj = {"route": {"inner": {"code": f"R{i}"}}}
        add(
            "nested_path",
            "Return only JSON with nested key path route.inner.code as a string. JSON=",
            obj,
            {"type": "json_path", "path": ["route", "inner", "code"]},
        )
    for i in range(30):
        obj = {"schema": "slot-v1", "items": [i, i + 1], "live": False}
        add(
            "schema_specific",
            'Return only JSON matching schema slot-v1 with keys schema, items (array of two numbers), live (boolean). JSON=',
            obj,
            {"type": "json_schema", "required_keys": ["schema", "items", "live"], "types": {"schema": "str", "live": "bool"}},
        )
    for i in range(25):
        obj = {"name": p["nouns"][i % len(p["nouns"])], "n": i, "ok": True, "hint": None}
        add(
            "mixed_types",
            "Return only a JSON object with name (string), n (number), ok (boolean), hint (null). JSON=",
            obj,
            {"type": "json_schema", "required_keys": ["name", "n", "ok", "hint"], "types": {"name": "str", "n": "number", "ok": "bool", "hint": "null"}},
        )

    seen = set()
    uniq = []
    for ex in out:
        if ex["content_hash"] in seen:
            continue
        seen.add(ex["content_hash"])
        uniq.append(ex)
    extra = 0
    while len(uniq) < n:
        obj = {"k": extra, "s": p["words"][extra % len(p["words"])]}
        prompt = f"Return only a JSON object with keys k (number) and s (string). JSON="
        ex = make_ex(
            split=split,
            category="json",
            subtype="pad_object",
            prompt=prompt,
            target=json.dumps(obj, separators=(",", ":")),
            validator={"type": "json_schema", "required_keys": ["k", "s"]},
        )
        extra += 1
        if ex["content_hash"] in seen:
            continue
        seen.add(ex["content_hash"])
        uniq.append(ex)
    return uniq[:n]


def gen_code(split: str, n: int) -> list[dict[str, Any]]:
    p = _pool(split)
    out: list[dict[str, Any]] = []

    def add(subtype: str, prompt: str, target: str, validator: dict[str, Any], ast_ok: bool = False) -> None:
        if ast_ok:
            ast.parse(target)
        out.append(make_ex(split=split, category="code", subtype=subtype, prompt=prompt, target=target, validator=validator))

    for i, fn in enumerate(p["funcs"][:30]):
        body = f"def {fn}(n):\n    if n % 8 != 0:\n        return 0\n    return n // 8"
        add(
            "exact_function_name",
            f"Write a Python function named {fn} that returns n//8 if n is a multiple of 8 else 0. No markdown.",
            body,
            {"type": "code_contains", "must": [f"def {fn}(", "return"], "forbid": ["```", "TOOL="], "ast": True},
            ast_ok=True,
        )
    for i, fn in enumerate(p["funcs"][:25]):
        body = f"def {fn}(items):\n    return [x for x in items if x]"
        add(
            "exact_args",
            f"Write a Python function {fn}(items) that returns a list of truthy items. Argument name must be items. No markdown.",
            body,
            {"type": "code_contains", "must": [f"def {fn}(items)", "return"], "forbid": ["```"], "ast": True},
            ast_ok=True,
        )
    for i, fn in enumerate(p["funcs"][5:30]):
        body = f"def {fn}(x):\n    return x"
        add(
            "exact_return",
            f"Write Python function {fn}(x) that returns x unchanged. No markdown.",
            body,
            {"type": "code_contains", "must": [f"def {fn}(x)", "return x"], "forbid": ["```"], "ast": True},
            ast_ok=True,
        )
    for i, fn in enumerate(p["funcs"][:30]):
        body = f"def {fn}(xs):\n    total = 0\n    for x in xs:\n        total += x\n    return total"
        add(
            "simple_loop",
            f"Write {fn}(xs) summing xs with a for-loop. No markdown.",
            body,
            {"type": "code_contains", "must": ["for ", "return"], "forbid": ["```"], "ast": True},
            ast_ok=True,
        )
    for i, fn in enumerate(p["funcs"][:30]):
        body = f"def {fn}(n):\n    if n < 0:\n        return -1\n    return n"
        add(
            "condition",
            f"Write {fn}(n) returning -1 if n is negative else n. No markdown.",
            body,
            {"type": "code_contains", "must": ["if n < 0", "return"], "forbid": ["```"], "ast": True},
            ast_ok=True,
        )
    for i, fn in enumerate(p["funcs"][:25]):
        body = f"def {fn}(xs):\n    return [x * 2 for x in xs if x > 0]"
        add(
            "map_filter",
            f"Write {fn}(xs) doubling positive numbers with a list comprehension. No markdown.",
            body,
            {"type": "code_contains", "must": ["for x in xs", "if x > 0"], "forbid": ["```"], "ast": True},
            ast_ok=True,
        )
    for i, fn in enumerate(p["funcs"][:25]):
        body = f"def {fn}(s):\n    a, b = s.split(',')\n    return (a.strip(), b.strip())"
        add(
            "parse",
            f"Write {fn}(s) splitting on comma into a two-tuple of stripped strings. No markdown.",
            body,
            {"type": "code_contains", "must": ["split", "return"], "forbid": ["```"], "ast": True},
            ast_ok=True,
        )
    for i, fn in enumerate(p["funcs"][:30]):
        body = f"def {fn}(s):\n    return s.strip().lower()"
        add(
            "string_transform",
            f"Write {fn}(s) returning s stripped and lowercased. No markdown.",
            body,
            {"type": "code_contains", "must": ["strip", "lower"], "forbid": ["```"], "ast": True},
            ast_ok=True,
        )
    for i, fn in enumerate(p["funcs"][:25]):
        body = f"def {fn}(d):\n    return {{k: str(v) for k, v in d.items()}}"
        add(
            "object_transform",
            f"Write {fn}(d) mapping dict values to strings. No markdown.",
            body,
            {"type": "code_contains", "must": ["for k, v in d.items()", "str(v)"], "forbid": ["```"], "ast": True},
            ast_ok=True,
        )
    literals = ["READY", "LOCKED", "CLEAR", "HOLD", "STOW"]
    for i, fn in enumerate(p["funcs"][:25]):
        lit = literals[i % len(literals)]
        body = f'def {fn}():\n    return "{lit}"'
        add(
            "required_literal",
            f'Write {fn}() that returns the exact string {lit}. No markdown.',
            body,
            {"type": "code_contains", "must": [f'"{lit}"', f"def {fn}("], "forbid": ["```"], "ast": True},
            ast_ok=True,
        )
    for i, fn in enumerate(p["funcs"][:30]):
        prompt = f"def {fn}(n):\n    # return n if n > 0 else 0\n    "
        target = "return n if n > 0 else 0"
        add(
            "no_markdown",
            prompt,
            target,
            {"type": "code_contains", "must": ["return"], "forbid": ["```", "TOOL=", "<|"]},
            ast_ok=False,
        )

    seen = set()
    uniq = []
    for ex in out:
        if ex["content_hash"] in seen:
            continue
        seen.add(ex["content_hash"])
        uniq.append(ex)
    extra = 0
    while len(uniq) < n:
        fn = f"{p['prefix'].lower()}extra_{extra}"
        body = f"def {fn}(x):\n    return x + 1"
        ex = make_ex(
            split=split,
            category="code",
            subtype="inc",
            prompt=f"Write {fn}(x) returning x+1. No markdown.",
            target=body,
            validator={"type": "code_contains", "must": [f"def {fn}(", "return x + 1"], "forbid": ["```"], "ast": True},
        )
        extra += 1
        if ex["content_hash"] in seen:
            continue
        seen.add(ex["content_hash"])
        uniq.append(ex)
    return uniq[:n]


def gen_stopping(split: str, n: int) -> list[dict[str, Any]]:
    p = _pool(split)
    out: list[dict[str, Any]] = []

    def add(subtype: str, prompt: str, target: str, validator: dict[str, Any]) -> None:
        out.append(make_ex(split=split, category="stopping", subtype=subtype, prompt=prompt, target=target, validator=validator))

    shorts = p["words"][:20]
    for w in shorts:
        add("short_exact", f"Reply with only {w} and then stop.", w, {"type": "stopping", "exact": w, "max_words": 1})
    for m in p["markers"][:15]:
        add("eos_after", f"Print {m} once and stop. No commentary.", m, {"type": "stopping", "exact": m, "max_words": 3})
    for noun in p["nouns"][:15]:
        add("no_commentary", f"Output the noun {noun} only.", noun, {"type": "stopping", "exact": noun, "max_words": 1})
    for i in range(15):
        add("no_repeat_punct", f"Print a single period and stop.", ".", {"type": "stopping", "exact": ".", "max_words": 1, "no_repeat_punct": True})
    for i in range(15):
        add("no_underscore_loop", f"Print DONE once. Do not print underscores.", "DONE", {"type": "stopping", "exact": "DONE", "forbid": ["___", "tokenizer_tokenizer"]})
    for i in range(14):
        add("no_schema_chatter", f"Return only the word schema if asked to chatter about schemas. Asked: give the status word idle.", "idle", {"type": "stopping", "exact": "idle", "forbid": ["tokenizer", "special token"]})
    for i in range(14):
        add("no_tokenizer_chatter", f"Do not mention tokenizers. Reply yes.", "yes", {"type": "stopping", "exact": "yes", "forbid": ["tokenizer", "TOKENIZER"]})
    for i in range(14):
        line = f"{p['nouns'][i % len(p['nouns'])]} ready"
        add("no_line_loop", f"Write this line once and stop: {line}", line, {"type": "stopping", "exact": line, "no_line_repeat": True})
    for i, w in enumerate(p["words"][:14]):
        add("stop_after_one", f"List one item only: {w}. Stop after that item.", w, {"type": "stopping", "exact": w, "max_words": 1})
    for i in range(14):
        block = json.dumps({"ok": True}, separators=(",", ":"))
        add("stop_after_block", "Return only {\"ok\":true} and stop. No extra keys. JSON=", block, {"type": "stopping", "exact": block, "json": True})

    seen = set()
    uniq = []
    for ex in out:
        if ex["content_hash"] in seen:
            continue
        seen.add(ex["content_hash"])
        uniq.append(ex)
    extra = 0
    while len(uniq) < n:
        w = p["words"][extra % len(p["words"])]
        k = extra
        prompt = f"Say {w}{k} once and stop."
        target = f"{w}{k}"
        ex = make_ex(split=split, category="stopping", subtype="once_stop", prompt=prompt, target=target, validator={"type": "stopping", "exact": target, "max_words": 1})
        extra += 1
        if ex["content_hash"] in seen:
            continue
        seen.add(ex["content_hash"])
        uniq.append(ex)
    return uniq[:n]


def generate_split(split: str) -> list[dict[str, Any]]:
    targets = TRAIN_TARGETS if split == "train" else VAL_TARGETS
    rows = []
    rows.extend(gen_instruction(split, targets["instruction"]))
    rows.extend(gen_json(split, targets["json"]))
    rows.extend(gen_code(split, targets["code"]))
    rows.extend(gen_stopping(split, targets["stopping"]))
    return rows


def load_heldout_strings(suite_path: Path, addendum_path: Path) -> dict[str, Any]:
    prompts: list[str] = []
    spans: list[str] = []
    keys: list[str] = []
    blobs: list[str] = []
    for path in (suite_path, addendum_path):
        obj = json.loads(path.read_text(encoding="utf-8"))
        for it in obj.get("items") or []:
            pt = str(it.get("prompt_text") or "")
            if pt:
                prompts.append(pt)
                blobs.append(pt)
            payload = it.get("reference_payload") or {}
            if payload.get("span"):
                spans.append(str(payload["span"]))
            for t in payload.get("tokens") or []:
                spans.append(str(t))
            for t in payload.get("accepted_words") or []:
                spans.append(str(t))
            for k in payload.get("required_keys") or []:
                keys.append(str(k))
            if payload.get("nested_key"):
                keys.append(str(payload["nested_key"]))
            for t in payload.get("must_contain_any") or []:
                spans.append(str(t))
            for t in payload.get("ordered_terms") or []:
                spans.append(str(t))
            for t in payload.get("required_terms") or []:
                spans.append(str(t))
    distinctive = []
    for s in spans + keys:
        t = str(s)
        if t in HARD_BANNED or t in ADDENDUM_NEEDLES or t in BANNED_STAGE3_KEYS:
            distinctive.append(t)
            continue
        if re.search(r"[A-Z]{2,}", t) and ("-" in t or "|" in t):
            distinctive.append(t)
            continue
        if t in {"quay_id", "crate_count", "inner_flag", "tally_quayside"}:
            distinctive.append(t)
    needles = sorted({n for n in list(HARD_BANNED) + list(ADDENDUM_NEEDLES) + list(BANNED_STAGE3_KEYS) + distinctive if n and len(str(n)) >= 3})
    return {"prompts": prompts, "spans": spans, "keys": keys, "needles": needles, "blobs": blobs}


def scan_leakage(rows: list[dict[str, Any]], heldout: dict[str, Any]) -> dict[str, Any]:
    stage3_hits = []
    addendum_hits = []
    needle_hits = []
    prompt_overlap = []
    for ex in rows:
        blob = "\n".join([ex.get("prompt") or "", ex.get("target") or "", ex.get("text") or ""])
        for needle in heldout["needles"]:
            if needle and needle in blob:
                rec = {"example_id": ex["example_id"], "needle": needle, "category": ex["category"]}
                needle_hits.append(rec)
                if needle in ADDENDUM_NEEDLES or needle in {
                    "VESPER-OXIDE-BADGE",
                    "NOK-17",
                    "NIMBUS-WICK",
                    "OX-4417",
                    "BEGIN|MID|END",
                    "KELVARRE-QUAY-MARKER",
                    "copper lantern",
                    "wooden peg",
                    "clay token",
                }:
                    addendum_hits.append(rec)
                else:
                    stage3_hits.append(rec)
        nprompt = normalize(ex.get("prompt") or "")
        for hp in heldout["prompts"]:
            nh = normalize(hp)
            if not nh:
                continue
            if nprompt == nh or (len(nh) >= 24 and nh in nprompt) or (len(nprompt) >= 24 and nprompt in nh):
                prompt_overlap.append({"example_id": ex["example_id"], "heldout_prompt": hp[:80]})
    return {
        "STAGE3_LEAKAGE": len(stage3_hits) + len(prompt_overlap),
        "INSTRUCTION_ADDENDUM_LEAKAGE": len(addendum_hits),
        "stage3_hits": stage3_hits[:20],
        "addendum_hits": addendum_hits[:20],
        "prompt_overlap": prompt_overlap[:20],
        "needle_hit_count": len(needle_hits),
    }


def quality_scan(rows: list[dict[str, Any]]) -> dict[str, Any]:
    exact = defaultdict(list)
    norm = defaultdict(list)
    malformed_json = 0
    code_ast_fail = 0
    for ex in rows:
        exact[ex["content_hash"]].append(ex["example_id"])
        norm[normalize(ex["text"])].append(ex["example_id"])
        if ex["category"] == "json":
            try:
                json.loads(ex["target"])
            except Exception:
                malformed_json += 1
        if ex["category"] == "code" and (ex.get("validator") or {}).get("ast"):
            try:
                ast.parse(ex["target"])
            except Exception:
                code_ast_fail += 1
    exact_dups = {k: v for k, v in exact.items() if len(v) > 1}
    norm_dups = {k: v for k, v in norm.items() if len(v) > 1}

    def tokens(s: str) -> set[str]:
        return set(re.findall(r"[a-z0-9_\-]+", normalize(s)))

    near = []
    by_cat: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for ex in rows:
        by_cat[ex["category"]].append(ex)
    for cat, items in by_cat.items():
        toks = [(ex, tokens(ex["text"])) for ex in items]
        for i in range(len(toks)):
            ti = toks[i][1]
            if len(ti) < 6:
                continue
            for j in range(i + 1, min(i + 8, len(toks))):
                tj = toks[j][1]
                inter = len(ti & tj)
                union = len(ti | tj) or 1
                jac = inter / union
                if jac >= 0.92 and toks[i][0]["content_hash"] != toks[j][0]["content_hash"]:
                    near.append((toks[i][0]["example_id"], toks[j][0]["example_id"], round(jac, 3)))
    return {
        "EXACT_DUPLICATES": len(exact_dups),
        "NORMALIZED_DUPLICATES": len(norm_dups),
        "NEAR_DUPLICATES": len(near),
        "malformed_json": malformed_json,
        "code_ast_fail": code_ast_fail,
        "exact_dup_ids": list(exact_dups.values())[:5],
        "near_pairs": near[:8],
    }


def counts(rows: list[dict[str, Any]]) -> dict[str, int]:
    c = Counter(ex["category"] for ex in rows)
    return {k: int(c.get(k, 0)) for k in ("instruction", "json", "code", "stopping")}


def default_paths() -> dict[str, Path]:
    data = Path(LINUX_DATA_ROOT)
    here = Path(__file__).resolve().parent
    return {
        "out_dir": data / DATASET_DIRNAME,
        "suite": here / "evals" / "WRIM-EVAL-S3-000001.json",
        "addendum": data / "WRIM-EVAL-S3-INSTRUCTION-ADDENDUM-000001.json",
    }


def freeze_dataset(*, out_dir: Path | None = None, suite_path: Path | None = None, addendum_path: Path | None = None) -> dict[str, Any]:
    paths = default_paths()
    out_dir = Path(out_dir or paths["out_dir"])
    suite_path = Path(suite_path or paths["suite"])
    addendum_path = Path(addendum_path or paths["addendum"])
    train = generate_split("train")
    val = generate_split("validation")
    # train/val exact overlap forbidden
    train_hash = {ex["content_hash"] for ex in train}
    val = [ex for ex in val if ex["content_hash"] not in train_hash and normalize(ex["text"]) not in {normalize(t["text"]) for t in train}]
    # refill val if filter removed items
    if len(val) < sum(VAL_TARGETS.values()):
        extra = generate_split("validation")
        seen = {ex["content_hash"] for ex in val} | train_hash
        train_norm = {normalize(t["text"]) for t in train}
        for ex in extra:
            if ex["content_hash"] in seen:
                continue
            if normalize(ex["text"]) in train_norm:
                continue
            val.append(ex)
            seen.add(ex["content_hash"])
        # trim per category
        trimmed = []
        used = Counter()
        for ex in val:
            if used[ex["category"]] >= VAL_TARGETS[ex["category"]]:
                continue
            trimmed.append(ex)
            used[ex["category"]] += 1
        val = trimmed

    all_rows = train + val
    heldout = load_heldout_strings(suite_path, addendum_path)
    leak = scan_leakage(all_rows, heldout)
    qual = quality_scan(all_rows)
    if leak["STAGE3_LEAKAGE"] != 0 or leak["INSTRUCTION_ADDENDUM_LEAKAGE"] != 0:
        raise RuntimeError(f"leakage freeze abort: {leak}")
    if qual["malformed_json"] or qual["code_ast_fail"]:
        raise RuntimeError(f"quality freeze abort: {qual}")
    if qual["EXACT_DUPLICATES"] or qual["NORMALIZED_DUPLICATES"]:
        raise RuntimeError(f"duplicate freeze abort: {qual}")

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
    train_tok_est = sum(len(ex["text"].split()) for ex in train)
    val_tok_est = sum(len(ex["text"].split()) for ex in val)
    manifest = {
        "kind": "WR_CORPUS_CAPABILITY_1_MANIFEST",
        "dataset_id": DATASET_ID,
        "dataset_version": DATASET_VERSION,
        "frozen": True,
        "freeze_timestamp": utc_now(),
        "generator": "scripts/wrim-environment/run000008_dataset.py",
        "generator_sha256": sha256_file(Path(__file__).resolve()),
        "seed_train": SEED,
        "seed_validation": 80081,
        "format": "raw_lm_continuation_prompt_plus_target",
        "wrap": "BOS_body_EOS_at_pack_time",
        "CAPABILITY_TRAIN_COUNT": len(train),
        "CAPABILITY_VALIDATION_COUNT": len(val),
        "INSTRUCTION_EXAMPLE_COUNT": counts(all_rows)["instruction"],
        "JSON_EXAMPLE_COUNT": counts(all_rows)["json"],
        "CODE_EXAMPLE_COUNT": counts(all_rows)["code"],
        "STOPPING_EXAMPLE_COUNT": counts(all_rows)["stopping"],
        "train_category_counts": counts(train),
        "validation_category_counts": counts(val),
        "EXACT_DUPLICATES": qual["EXACT_DUPLICATES"],
        "NORMALIZED_DUPLICATES": qual["NORMALIZED_DUPLICATES"],
        "NEAR_DUPLICATES": qual["NEAR_DUPLICATES"],
        "STAGE3_LEAKAGE": leak["STAGE3_LEAKAGE"],
        "INSTRUCTION_ADDENDUM_LEAKAGE": leak["INSTRUCTION_ADDENDUM_LEAKAGE"],
        "malformed_json": qual["malformed_json"],
        "code_ast_fail": qual["code_ast_fail"],
        "approx_word_count_train": train_tok_est,
        "approx_word_count_validation": val_tok_est,
        "train_path": str(train_path),
        "validation_path": str(val_path),
        "train_sha256": train_sha,
        "validation_sha256": val_sha,
        "frozen_corpus_mutated": False,
        "stage3_mutated": False,
        "instruction_addendum_mutated": False,
    }
    man_path = out_dir / MANIFEST_NAME
    man_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    sha_doc = {
        "dataset_id": DATASET_ID,
        "dataset_version": DATASET_VERSION,
        "files": {
            TRAIN_NAME: train_sha,
            VAL_NAME: val_sha,
            MANIFEST_NAME: sha256_file(man_path),
        },
        "CAPABILITY_DATASET_HASH": sha256_text(train_sha + val_sha),
    }
    sha_path = out_dir / SHA_NAME
    sha_path.write_text(json.dumps(sha_doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    sha_doc["files"][SHA_NAME] = sha256_file(sha_path)
    sha_path.write_text(json.dumps(sha_doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    manifest["sha_doc"] = sha_doc
    return {
        "ok": True,
        "manifest": manifest,
        "sha": sha_doc,
        "leak": leak,
        "quality": qual,
        "out_dir": str(out_dir),
    }


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


if __name__ == "__main__":
    report = freeze_dataset()
    print(json.dumps({k: report[k] if k != "manifest" else {kk: report["manifest"][kk] for kk in ("CAPABILITY_TRAIN_COUNT", "CAPABILITY_VALIDATION_COUNT", "STAGE3_LEAKAGE", "INSTRUCTION_ADDENDUM_LEAKAGE", "train_category_counts", "validation_category_counts", "EXACT_DUPLICATES", "NORMALIZED_DUPLICATES", "NEAR_DUPLICATES")} for k in ("ok", "out_dir", "manifest", "sha")}, indent=2))
