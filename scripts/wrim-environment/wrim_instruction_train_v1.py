"""Build and freeze WRIM-INSTRUCTION-TRAIN-v1. First-party. Does not train.

Independent of locked Foundation eval and graduation suites.
"""
from __future__ import annotations

import hashlib
import json
import random
import re
from collections import Counter
from pathlib import Path
from typing import Any

from wrim_arch_uh1_ac1_train import _write
from wrim_hvu_identity import DATA_ROOT
from wrim_ra1_grad_corpus import GRAD_DIR

CORPUS_NAME = "WRIM-INSTRUCTION-TRAIN-v1"
CORPUS_VERSION = "v1.1.0"
CORPUS_ID = "WRIM-INSTRUCTION-TRAIN-v1.1.0"
SEED = 9009
ROOT = Path(DATA_ROOT) / CORPUS_ID
BUILD_REPORT = Path(DATA_ROOT) / "WRIM_INSTRUCTION_TRAIN_V1_BUILD_REPORT.json"
REGISTRY = Path(DATA_ROOT) / "WRIM_DATA_REGISTRY.jsonl"
LOCKED_EVAL = Path(DATA_ROOT) / "WRIM-FOUNDATION-EVAL-1-v1.0.0" / "WRIM-FOUNDATION-EVAL-1-v1.0.0.json"

VERBS_TRAIN = ["Give", "Return", "Provide", "State", "Write", "Identify", "Choose", "Extract", "Convert", "Classify", "Select", "Format"]
VERBS_HOLD = ["Report", "Emit", "Produce", "Specify", "Record", "Furnish", "Supply", "Draft"]

WORDS = ["willow", "copper", "pebble", "lantern", "meadow", "barley", "marble", "linen", "quartz", "fennel", "walnut", "orchid", "glacier", "ember", "cedarwood", "harbor", "velvet", "anvil", "bramble", "cinder"]
NAMES = ["Rina", "Tomas", "Leah", "Omar", "Nia", "Pavel", "Iris", "Jonas", "Hana", "Eli"]
NUMS = [3, 5, 6, 7, 8, 9, 11, 12, 13, 15, 16, 18, 21, 24, 27, 31, 36, 48, 64, 81]
LABELS = ["open", "shut", "warm", "cool", "live", "idle", "left", "right"]
JSON_KEYS = ["ok", "on", "flag", "open", "live", "n", "id"]

HOLDOUT_SUB = {
    "brief": {"one_sentence"},
    "explain": {"define"},
    "list": {"exactly_n"},
    "json": {"three_key"},
    "code": {"min_expr"},
    "classify": {"category"},
    "extract": {"number"},
    "transform": {"reverse"},
    "compare": {"same_diff"},
    "pos": {"exact_n_words"},
    "neg": {"no_punct"},
    "combo": {"json_keys"},
}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", str(s).strip().lower())


def _sha_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _sha_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def encode_instruction(tokenizer: Any, rec: dict[str, Any]) -> dict[str, Any]:
    """Prefix-LM encode that does not use str.format, so JSON braces stay intact."""
    import numpy as np

    from wrim_cpt_identity import ASSISTANT_ID, BOS_ID, COMMANDER_ID, EOS_ID
    from wrim_plm3_encode import MASK_CAP_FIRST
    from wrim_target_only_loss import MASK_CAP_EOS, MASK_CAP_TARGET, MASK_IGNORE

    prompt = str(rec["prompt"])
    target = str(rec["target"])
    raw = "<|commander|>\n" + prompt + "<|assistant|>" + target
    body = list(tokenizer.encode(raw, add_special_tokens=False).ids)
    tokens = [BOS_ID, *body, EOS_ID]
    if tokens[1] != COMMANDER_ID:
        raise ValueError(f"body must start with commander id 5, got {tokens[1:8]}")
    ast = [i for i, t in enumerate(tokens) if t == ASSISTANT_ID]
    if len(ast) != 1:
        raise ValueError(f"expected one assistant token, got {ast}")
    ast_i = ast[0]
    tgt_ids = list(tokenizer.encode(target, add_special_tokens=False).ids)
    after = tokens[ast_i + 1 : -1]
    if after != tgt_ids:
        raise ValueError("target id mismatch after assistant")
    if not tgt_ids:
        raise ValueError("empty target")
    mask = np.full(len(tokens), MASK_IGNORE, dtype=np.int8)
    for j in range(ast_i + 1, len(tokens) - 1):
        mask[j] = MASK_CAP_TARGET
    mask[ast_i + 1] = MASK_CAP_FIRST
    mask[-1] = MASK_CAP_EOS
    return {
        "example_id": rec["example_id"],
        "raw": raw,
        "tokens": np.asarray(tokens, dtype=np.int32),
        "mask": mask,
        "first_target_index": ast_i + 1,
        "first_target_id": int(tgt_ids[0]),
        "target_ids": tgt_ids,
        "first_token_class": rec.get("first_token_class") or rec.get("family"),
        "family": rec.get("family"),
    }


def _item(n: int, family: str, sub: str, level: int, mode: str, prompt: str, target: str, template: str, verb: str) -> dict[str, Any]:
    return {
        "example_id": f"wit-v1-{n:05d}",
        "family": family,
        "subfamily": sub,
        "level": int(level),
        "mode": mode,
        "prompt": prompt.strip(),
        "target": target,
        "template_id": template,
        "verb": verb,
        "provenance": "first-party-wrim-instruction-train-v1",
        "first_party": True,
    }


def generate() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []

    def add(family: str, sub: str, level: int, mode: str, prompt: str, target: str, template: str, verb: str) -> None:
        items.append(_item(len(items), family, sub, level, mode, prompt, target, template, verb))

    def verbs(hold: bool) -> list[str]:
        return list(VERBS_HOLD if hold else VERBS_TRAIN)

    for hold in (False, True):
        for v in verbs(hold):
            for w in WORDS[:16]:
                add("brief", "one_word", 1, "natural", f"{v} the requested word in one word only: {w}.", w, "brief.one_word", v)
            for a, b in zip(NUMS[::2], NUMS[1::2]):
                ans = "yes" if a < b else "no"
                add("brief", "yes_no", 2, "natural", f"{v} yes or no only. Is {a} less than {b}?", ans, "brief.yesno", v)
            for s in ("The kettle boiled.", "Frost covers the rail.", "A bell rang twice."):
                add("brief", "one_sentence", 1, "natural", f"{v} a one-sentence restatement of: {s}", s, "brief.sentence", v)

    defs = [
        ("ice", "frozen water"),
        ("dawn", "first light"),
        ("harbor", "sheltered port"),
        ("ember", "glowing coal"),
        ("meadow", "grassy field"),
        ("anvil", "smithing block"),
        ("velvet", "soft fabric"),
        ("glacier", "slow ice"),
    ]
    for hold in (False, True):
        for v in verbs(hold):
            for term, meaning in defs:
                add("explain", "define", 1, "natural", f"{v} a two-word definition of {term}.", meaning, "explain.define", v)
                add("explain", "reason", 2, "natural", f"{v} a short reason why ice is cold, one clause.", "it is frozen water", "explain.reason", v)
            add("explain", "simple", 1, "natural", f"{v} a simple two-word gloss for rain.", "falling water", "explain.simple", v)

    pairs = [("tea", "mint"), ("oak", "pine"), ("salt", "lime"), ("harp", "drum"), ("ink", "chalk")]
    triples = [("red", "gold", "teal"), ("wren", "moth", "seal"), ("Rina", "Omar", "Nia")]
    for hold in (False, True):
        for v in verbs(hold):
            for a, b in pairs:
                add("list", "two", 1, "structured", f"{v} a comma-separated list of these two items: {a} and {b}.", f"{a}, {b}", "list.two", v)
            for a, b, c in triples:
                add("list", "three", 1, "structured", f"{v} three examples comma-separated: {a}, {b}, then {c}.", f"{a}, {b}, {c}", "list.three", v)
            add("list", "exactly_n", 2, "structured", f"{v} exactly 2 items, comma-separated: barley and linen.", "barley, linen", "list.exact2", v)
            add("list", "exactly_n", 2, "structured", f"{v} exactly 3 items: copper, quartz, fennel.", "copper, quartz, fennel", "list.exact3", v)

    for hold in (False, True):
        for v in verbs(hold):
            for key in JSON_KEYS:
                for lit in ("true", "false"):
                    add("json", "bool", 2, "structured", f"{v} valid JSON with one boolean field {key} set to {lit}.", f'{{"{key}":{lit}}}', "json.bool", v)
            for n in (1, 2, 4, 8):
                add("json", "num", 2, "structured", f"{v} a JSON object whose only key is n with numeric value {n}.", f'{{"n":{n}}}', "json.num", v)
            for name in NAMES[:6]:
                add("json", "str", 2, "structured", f"{v} JSON with key name set to the string {name}.", f'{{"name":"{name}"}}', "json.str", v)
            add("json", "three_key", 3, "structured", f'{v} JSON with keys ok, n, id set to true, 3, and "a".', '{"ok":true,"n":3,"id":"a"}', "json.three", v)
            add("json", "three_key", 3, "structured", f'{v} JSON object using exact keys open, live, flag as true, false, true.', '{"open":true,"live":false,"flag":true}', "json.three2", v)

    for hold in (False, True):
        for v in verbs(hold):
            for a, b in ((1, 1), (2, 3), (4, 5), (7, 8)):
                add("code", "add", 1, "structured", f"{v} only the Python expression that adds {a} and {b}.", f"{a}+{b}", "code.add", v)
            add("code", "len", 1, "structured", f'{v} only code that takes the length of the string hi.', 'len("hi")', "code.len", v)
            add("code", "len", 2, "structured", f'{v} code-only: character count of ab.', 'len("ab")', "code.len2", v)
            add("code", "min_expr", 1, "structured", f"{v} only the expression for the smaller of 3 and 9.", "min(3,9)", "code.min", v)
            add("code", "min_expr", 1, "structured", f"{v} code-only minimum of 2 and 8.", "min(2,8)", "code.min2", v)
            add("code", "fn", 2, "structured", f"{v} a one-line Python function named f that returns 0.", "def f():\n    return 0", "code.fn", v)

    for hold in (False, True):
        for v in verbs(hold):
            for n in NUMS[:12]:
                lab = "even" if n % 2 == 0 else "odd"
                add("classify", "parity", 1, "natural", f"{v} one label, even or odd, for the integer {n}.", lab, "classify.parity", v)
            add("classify", "yesno", 1, "natural", f"{v} yes or no: does the token yes mean affirmation?", "yes", "classify.yesno", v)
            add("classify", "yesno", 1, "natural", f"{v} yes or no: does the token no mean affirmation?", "no", "classify.yesno2", v)
            for lab in LABELS:
                add("classify", "category", 2, "natural", f"{v} the category label that matches this token exactly: {lab}.", lab, "classify.cat", v)

    for hold in (False, True):
        for v in verbs(hold):
            for name in NAMES:
                add("extract", "name", 1, "natural", f"{v} only the person name from: bag {name} shelf west.", name, "extract.name", v)
            for n in NUMS[:10]:
                add("extract", "number", 1, "natural", f"{v} only the number in: crate {n} gate south.", str(n), "extract.num", v)
            for w in WORDS[:10]:
                add("extract", "word", 1, "natural", f"{v} the tagged word from: keep {w} inside the bracketed slot.", w, "extract.word", v)
            add("extract", "field", 2, "structured", f'{v} only the id field from {{"id":"q7","on":true}}.', "q7", "extract.field", v)

    for hold in (False, True):
        for v in verbs(hold):
            for w in WORDS[:12]:
                add("transform", "upper", 1, "structured", f"{v} the uppercase form of {w}.", w.upper(), "transform.upper", v)
                add("transform", "lower", 1, "structured", f"{v} lowercase for {w.upper()}.", w, "transform.lower", v)
            for w in ("tea", "oak", "rum"):
                add("transform", "reverse", 1, "structured", f"{v} the reversed spelling of {w}, no spaces.", w[::-1], "transform.rev", v)
            add("transform", "replace", 2, "natural", f"{v} rewrite 'the red lamp' by replacing red with teal.", "the teal lamp", "transform.repl", v)
            add("transform", "rewrite", 2, "natural", f"{v} a brief rewrite of 'halt now' as 'stop now'.", "stop now", "transform.rew", v)

    for hold in (False, True):
        for v in verbs(hold):
            for a, b in zip(NUMS[::2], NUMS[1::2]):
                add("compare", "larger", 1, "natural", f"{v} the larger number: {a} or {b}.", str(max(a, b)), "compare.large", v)
                add("compare", "smaller", 1, "natural", f"{v} which is smaller, {a} or {b}?", str(min(a, b)), "compare.small", v)
            for a, b, ans in (("willow", "willow", "same"), ("copper", "marble", "different"), ("teal", "teal", "same"), ("hare", "wren", "different")):
                add("compare", "same_diff", 1, "natural", f"{v} same or different: {a} vs {b}.", ans, "compare.same", v)

    for hold in (False, True):
        for v in verbs(hold):
            for w in WORDS[:8]:
                add("pos", "include", 2, "natural", f"{v} a two-word reply that includes {w}.", f"see {w}", "pos.include", v)
            for w in ("Yes", "Open", "Done"):
                add("pos", "start", 2, "natural", f"{v} a short reply that starts with {w}.", f"{w} now", "pos.start", v)
            add("pos", "exact_n_words", 2, "natural", f"{v} exactly three words: all is well.", "all is well", "pos.n3", v)
            add("pos", "exact_n_words", 3, "natural", f"{v} exactly two words in this format: ok then.", "ok then", "pos.n2", v)

    for hold in (False, True):
        for v in verbs(hold):
            add("neg", "no_explain", 2, "natural", f"{v} yes or no only, do not explain: is 8 even?", "yes", "neg.noexp", v)
            add("neg", "no_explain", 2, "natural", f"{v} one word, do not explain: is 9 even?", "no", "neg.noexp2", v)
            add("neg", "avoid_token", 2, "natural", f"{v} a one-word color that is not red: choose teal.", "teal", "neg.avoid", v)
            add("neg", "no_punct", 3, "natural", f"{v} the word yes with no punctuation.", "yes", "neg.nopunct", v)
            add("neg", "no_include", 3, "natural", f"{v} a one-word animal that is not dog: choose wren.", "wren", "neg.nodo", v)

    for hold in (False, True):
        for v in verbs(hold):
            add("combo", "brief_fmt", 3, "natural", f"{v} one word only, lowercase: the larger of 5 and 11.", "11", "combo.brief", v)
            add("combo", "list_n", 3, "structured", f"{v} exactly 2 items, comma-separated, no extra words: oat and rye.", "oat, rye", "combo.list", v)
            add("combo", "json_keys", 3, "structured", f"{v} JSON with exact keys ok and n: true and 1. No other keys.", '{"ok":true,"n":1}', "combo.json", v)
            add("combo", "brief_forbid", 3, "natural", f"{v} one word, do not use cat: name a bird, wren.", "wren", "combo.forbid", v)
            add("combo", "code_only", 3, "structured", f"{v} code only, no explanation: add 6 and 7.", "6+7", "combo.code", v)

    random.Random(SEED).shuffle(items)
    seen: set[tuple[str, str]] = set()
    uniq: list[dict[str, Any]] = []
    for it in items:
        k = (_norm(it["prompt"]), _norm(it["target"]))
        if k in seen:
            continue
        seen.add(k)
        it["example_id"] = f"wit-v1-{len(uniq):05d}"
        uniq.append(it)
    return uniq


def _locked_strings() -> dict[str, set[str]]:
    prompts: set[str] = set()
    targets: set[str] = set()
    pairs: set[tuple[str, str]] = set()

    def add_row(p: str, t: str) -> None:
        pn, tn = _norm(p), _norm(t)
        if pn:
            prompts.add(pn)
        if tn:
            targets.add(tn)
        if pn and tn:
            pairs.add((pn, tn))

    if LOCKED_EVAL.is_file():
        obj = json.loads(LOCKED_EVAL.read_text(encoding="utf-8"))
        for it in obj.get("items") or []:
            add_row(str(it.get("prompt") or ""), str(it.get("target") or ""))
    gpath = GRAD_DIR / "WRIM-FOUNDATION-GRADUATION-1-v1.0.0.json"
    if not gpath.is_file():
        gpath = GRAD_DIR / "val.jsonl"
    if gpath.is_file() and gpath.suffix == ".json":
        obj = json.loads(gpath.read_text(encoding="utf-8"))
        for it in obj.get("items") or []:
            add_row(str(it.get("prompt") or ""), str(it.get("target") or ""))
    elif gpath.is_file():
        for line in gpath.read_text(encoding="utf-8").splitlines():
            if line.strip():
                it = json.loads(line)
                add_row(str(it.get("prompt") or ""), str(it.get("target") or ""))
    return {"prompts": prompts, "targets": targets, "pairs": pairs}


def _near(a: str, b: str) -> bool:
    if a == b:
        return True
    if len(a) >= 24 and len(b) >= 24 and a[:24] == b[:24]:
        return True
    if a in b or b in a:
        if min(len(a), len(b)) >= 20 and abs(len(a) - len(b)) <= 12:
            return True
    return False


def split_and_audit(items: list[dict[str, Any]]) -> dict[str, Any]:
    family_hold: list[dict[str, Any]] = []
    templ_hold: list[dict[str, Any]] = []
    rest: list[dict[str, Any]] = []
    for it in items:
        sub_hold = it["subfamily"] in HOLDOUT_SUB.get(it["family"], set())
        verb_hold = it["verb"] in VERBS_HOLD
        row = dict(it)
        # Holdout verbs never enter train/validation, even if the subfamily is also held out.
        if verb_hold:
            row["split"] = "template_holdout"
            templ_hold.append(row)
        elif sub_hold:
            row["split"] = "family_holdout"
            family_hold.append(row)
        else:
            rest.append(row)
    rng = random.Random(SEED + 1)
    rng.shuffle(rest)
    n_val = max(200, int(0.12 * len(rest)))
    val = rest[:n_val]
    train = rest[n_val:]
    for it in train:
        it["split"] = "train"
    for it in val:
        it["split"] = "validation"

    def pairs(rows: list[dict[str, Any]]) -> set[tuple[str, str]]:
        return {(_norm(r["prompt"]), _norm(r["target"])) for r in rows}

    def prs(rows: list[dict[str, Any]]) -> set[str]:
        return {_norm(r["prompt"]) for r in rows}

    overlap_val = pairs(train) & pairs(val)
    overlap_fh = pairs(train) & pairs(family_hold)
    overlap_th = pairs(train) & pairs(templ_hold)
    prompt_overlap = prs(train) & (prs(val) | prs(family_hold) | prs(templ_hold))
    train_hold_verbs = [r["example_id"] for r in train + val if r["verb"] in VERBS_HOLD]
    train_hold_subs = [r["example_id"] for r in train + val if r["subfamily"] in HOLDOUT_SUB.get(r["family"], set())]
    exact_dup = [k for k, c in Counter((_norm(r["prompt"]), _norm(r["target"])) for r in train).items() if c > 1]
    norm_dup = [k for k, c in Counter(_norm(r["prompt"]) for r in train).items() if c > 1]
    norms = [_norm(r["prompt"]) for r in train]
    near = 0
    sample = norms[:800]
    for i, a in enumerate(sample):
        for b in sample[i + 1 : i + 12]:
            if a != b and _near(a, b):
                near += 1
    tgt_copy = 0
    copy_n = 0
    for r in train:
        if r["family"] == "extract":
            continue
        tn = _norm(r["target"])
        if tn and len(tn) >= 3 and tn in _norm(r["prompt"]):
            tgt_copy += 1
        copy_n += 1
    tmpl = Counter(r["template_id"] for r in train)
    top_t = tmpl.most_common(1)[0][1] / max(1, len(train))
    famc = Counter(r["family"] for r in train)
    locked = _locked_strings()
    lock_p = [r["example_id"] for r in train + val + family_hold + templ_hold if _norm(r["prompt"]) in locked["prompts"]]
    lock_pair = [r["example_id"] for r in train if (_norm(r["prompt"]), _norm(r["target"])) in locked["pairs"]]
    lock_near = 0
    locked_list = [p for p in locked["prompts"] if len(p) >= 16][:500]
    for r in train:
        pn = _norm(r["prompt"])
        if any(_near(pn, lp) and pn != lp for lp in locked_list):
            lock_near += 1
    leak_ok = (
        not lock_p
        and not lock_pair
        and lock_near == 0
        and not overlap_val
        and not overlap_fh
        and not overlap_th
        and not prompt_overlap
        and not exact_dup
        and not norm_dup
        and not train_hold_verbs
        and not train_hold_subs
    )
    return {
        "train": train,
        "validation": val,
        "family_holdout": family_hold,
        "template_holdout": templ_hold,
        "audit": {
            "EXACT_DUPLICATES": len(exact_dup),
            "NORMALIZED_DUPLICATES": len(norm_dup),
            "NEAR_DUPLICATES": near,
            "TARGET_COPY_RATE": round(tgt_copy / max(1, copy_n), 4),
            "TEMPLATE_CONCENTRATION": round(top_t, 4),
            "FAMILY_COUNTS": dict(famc),
            "TRAIN_VAL_OVERLAP": len(overlap_val),
            "TRAIN_FAMILY_HOLDOUT_OVERLAP": len(overlap_fh),
            "TRAIN_TEMPLATE_HOLDOUT_OVERLAP": len(overlap_th),
            "PROMPT_OVERLAP_ANY_HELD": len(prompt_overlap),
            "LOCKED_EVAL_EXACT_OVERLAP": len(lock_p),
            "LOCKED_EVAL_PAIR_OVERLAP": len(lock_pair),
            "LOCKED_EVAL_NEAR_OVERLAP": lock_near,
            "GRADUATION_EXACT_OVERLAP": 0 if not GRAD_DIR.is_dir() else len(lock_p),
            "GRADUATION_NEAR_OVERLAP": lock_near if GRAD_DIR.is_dir() else 0,
            "DATA_LEAKAGE_AUDIT": "PASS" if leak_ok else "FAIL",
            "leak_ok": leak_ok,
        },
    }


def length_bins(rows: list[dict[str, Any]], tok: Any | None) -> dict[str, int]:
    bins = {"very_short_1_4": 0, "short_5_12": 0, "moderate_13_32": 0, "long_33_plus": 0, "unparsed": 0}
    for r in rows:
        if tok is None:
            n = len(str(r["target"]).split())
        else:
            try:
                n = len(tok.encode(str(r["target"]), add_special_tokens=False).ids)
            except Exception:
                bins["unparsed"] += 1
                continue
        if n <= 4:
            bins["very_short_1_4"] += 1
        elif n <= 12:
            bins["short_5_12"] += 1
        elif n <= 32:
            bins["moderate_13_32"] += 1
        else:
            bins["long_33_plus"] += 1
    return bins


def freeze() -> dict[str, Any]:
    packed = split_and_audit(generate())
    audit = packed["audit"]
    tok = None
    try:
        from run000007_preflight import resolve_dump_root
        from tokenizers import Tokenizer

        dump = resolve_dump_root(None)
        if dump is not None:
            tok = Tokenizer.from_file(str(dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"))
    except Exception:
        tok = None
    ROOT.mkdir(parents=True, exist_ok=True)

    def write_split(name: str, rows: list[dict[str, Any]]) -> Path:
        p = ROOT / f"{name}.jsonl"
        p.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
        return p

    paths = {k: write_split(k, packed[k]) for k in ("train", "validation", "family_holdout", "template_holdout")}
    hashes = {k: _sha_file(p) for k, p in paths.items()}
    recipe = {
        "seed": SEED,
        "verbs_train": VERBS_TRAIN,
        "verbs_template_holdout": VERBS_HOLD,
        "holdout_subfamilies": {k: sorted(v) for k, v in HOLDOUT_SUB.items()},
        "generator": "wrim_instruction_train_v1.generate",
        "first_party": True,
        "no_external_scrape": True,
        "locked_eval_unused_in_generation": True,
    }
    recipe_hash = _sha_text(json.dumps(recipe, sort_keys=True))
    corpus_hash = _sha_text("".join(hashes[k] for k in sorted(hashes)) + recipe_hash)
    ready = bool(audit["leak_ok"]) and len(packed["train"]) >= 1500
    report = {
        "CORPUS_NAME": CORPUS_NAME,
        "CORPUS_VERSION": CORPUS_VERSION,
        "CORPUS_ID": CORPUS_ID,
        "CORPUS_HASH": corpus_hash,
        "PROVENANCE": "FIRST_PARTY",
        "FIRST_PARTY": True,
        "TRAIN_EXAMPLES": len(packed["train"]),
        "VALIDATION_EXAMPLES": len(packed["validation"]),
        "FAMILY_HOLDOUT_EXAMPLES": len(packed["family_holdout"]),
        "TEMPLATE_HOLDOUT_EXAMPLES": len(packed["template_holdout"]),
        "TOTAL_TOKENS": "computed_at_pack_time",
        "FAMILY_COUNTS": audit["FAMILY_COUNTS"],
        "TARGET_LENGTH_DISTRIBUTION": length_bins(packed["train"], tok),
        "EXACT_DUPLICATES": audit["EXACT_DUPLICATES"],
        "NORMALIZED_DUPLICATES": audit["NORMALIZED_DUPLICATES"],
        "NEAR_DUPLICATES": audit["NEAR_DUPLICATES"],
        "TARGET_COPY_RATE": audit["TARGET_COPY_RATE"],
        "TEMPLATE_CONCENTRATION": audit["TEMPLATE_CONCENTRATION"],
        "LOCKED_EVAL_EXACT_OVERLAP": audit["LOCKED_EVAL_EXACT_OVERLAP"],
        "LOCKED_EVAL_NEAR_OVERLAP": audit["LOCKED_EVAL_NEAR_OVERLAP"],
        "GRADUATION_EXACT_OVERLAP": audit["GRADUATION_EXACT_OVERLAP"],
        "GRADUATION_NEAR_OVERLAP": audit["GRADUATION_NEAR_OVERLAP"],
        "DATA_LEAKAGE_AUDIT": audit["DATA_LEAKAGE_AUDIT"],
        "SPLIT_HASHES": hashes,
        "GENERATION_RECIPE_HASH": recipe_hash,
        "GENERATION_RECIPE": recipe,
        "DATASET_REGISTERED": True,
        "SCHOOL_09_READY": "YES" if ready else "NO",
        "TRAINABLE_SURFACE": "NE1_ONLY_PREAUTHORIZED",
        "PARENT_IF_TRAIN": "WRIM1-UH1-AC2-NE1-000001/step-40",
        "ok": ready,
    }
    _write(ROOT / "manifest.json", report)
    _write(BUILD_REPORT, report)
    _write(ROOT / "generation_recipe.json", recipe)
    with REGISTRY.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps({
            "name": CORPUS_NAME,
            "version": CORPUS_VERSION,
            "hash": corpus_hash,
            "generation_recipe": str(ROOT / "generation_recipe.json"),
            "family_counts": audit["FAMILY_COUNTS"],
            "split_counts": {k: len(packed[k]) for k in paths},
            "leakage_results": audit["DATA_LEAKAGE_AUDIT"],
            "rights_provenance": "FIRST_PARTY",
            "status": "READY" if ready else "BLOCKED",
        }) + "\n")
    return report


if __name__ == "__main__":
    print(json.dumps(freeze(), indent=2, default=str))
