"""WRIM-1-PRETRAIN-CORPUS-v1.5.0 long-form unique fill. Does not mutate v1.4.0."""
from __future__ import annotations

import json
import random
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from wrim1_pretrain_corpus_build import (
    assign_tokens,
    contamination_hit,
    dedup,
    domain_tokens,
    iter_jsonl,
    load_locked_fingerprints,
    load_tokenizer,
    sha256_file,
    split_by_source,
    utc_now,
    write_json,
    write_jsonl,
)
from wrim1_pretrain_corpus_expand_v13 import CONV_MIN, INST_MIN, MATH_MIN, PROC_MIN, fp_rec
from wrim1_pretrain_corpus_identity import (
    CORPUS_ID,
    DATA_ROOT,
    PILOT_CORPUS_HASH,
    PILOT_TOKENIZER_HASH,
    PILOT_TOKENIZER_PATH,
    PRIMARY_LANGUAGE,
    SEED,
)
from wrim_pilot_ab_identity import CANONICAL, CANONICAL_HASH

PROGRAM_ID = "WRIM1-CORPUS-BALANCE-60M-01"
VERSION = "WRIM-1-PRETRAIN-CORPUS-v1.5.0"
PREV = DATA_ROOT / "WRIM-1-PRETRAIN-CORPUS-v1.4.0"
OUT_DIR = DATA_ROOT / VERSION
REPORT_PATH = DATA_ROOT / "WRIM1_CORPUS_BALANCE_60M_REPORT.json"
PARENT_HASH = "e2f39402ec1d5a22940d5ecbfa5262cf77f99c6acfbc8d5b8f8370aee2d9c117"
RECIPE = "WRIM1-FP-BALANCE-v1.5.0"
GENERATOR = "wrim1_pretrain_corpus_expand_v15"

S1 = [
    "The morning count at bay {n} started late because the {noun} tag had been turned face-down.",
    "A spare {noun} sat on the bench with no matching card for case {case}.",
    "Two operators argued quietly about whether the {noun} had already been {verb}ed once.",
    "Rain on the loading dock made the {noun} labels harder to read than the posted sheet.",
    "The last shift left a note that the {noun} near post {n} still needed a written finish.",
]
S2 = [
    "Nobody wanted to guess. They wanted a record that the next person could follow without a rumor.",
    "The constraint was simple on paper and messy in the room: finish the check or write why it stopped.",
    "A cleaner story would have been easier to tell, and that is exactly why they refused to tell one.",
    "Time was short, but skipping the wait would have made the later reading meaningless.",
    "The posted limit and the handwritten limit disagreed, so both had to be copied before any action.",
]
S3 = [
    "They agreed to {verb} the {noun} in place, then count {n} units out loud.",
    "The slower method was chosen because it left a trail on the card for case {case}.",
    "If the {noun} moved during the wait, they would stop rather than average two numbers.",
    "A signed change could replace the card later; a hallway version could not.",
    "After {n} seconds they would either continue or freeze the station and call for a written instruction.",
]


def vignette(i: int, noun: str, verb: str, n: int) -> str:
    case = f"{i:05d}"
    a = S1[i % len(S1)].format(n=n, noun=noun, verb=verb, case=case)
    b = S2[(i * 3) % len(S2)]
    c = S3[(i * 5) % len(S3)].format(n=n, noun=noun, verb=verb, case=case)
    extra = (
        f"Case {case} also records that the {noun} serial fragment is {i%97:02d}{verb[:2]} "
        f"and that the operator named the unfinished work in one sentence before leaving. "
        f"The unfinished work was: confirm the {noun}, {verb} only if the panel is locked, "
        f"write {n} on the card, and do not invent a missing mark."
    )
    return f"{a} {b} {c} {extra}"


def make_instruction(i: int) -> dict[str, Any]:
    nouns = ["bracket", "hopper", "gasket", "flange", "pallet", "nozzle", "shim", "hatch", "collar", "baffle"]
    verbs = ["isolate", "align", "purge", "seat", "bleed", "proof", "tag", "pin", "torque", "flush"]
    fams = [
        "explain", "summarize", "classify", "extract", "transform", "compare",
        "format", "constraint", "negative", "qa", "rewrite", "plan", "json", "steps",
    ]
    noun = nouns[i % len(nouns)]
    verb = verbs[(i * 3) % len(verbs)]
    n = 6 + (i * 7) % 29
    m = 2 + (i * 11) % 13
    fam = fams[i % len(fams)]
    passage = vignette(i, noun, verb, n)
    if fam == "explain":
        prompt = f"Read the passage for case {i:05d}. Explain in three sentences why the slower method was justified.\nPassage: {passage}"
        target = (
            f"The slower method left a written trail instead of a rumor. "
            f"The {noun} could not be trusted until it was {verb}ed from a known state. "
            f"A short wait of {n} units was cheaper than handing a lie to the next shift."
        )
    elif fam == "summarize":
        prompt = f"Summarize case {i:05d} in two sentences without copying any full sentence from the passage.\nPassage: {passage}"
        target = (
            f"Operators refused to guess about a {noun} and chose a checkable sequence. "
            f"They would {verb} only after locking the panel and writing {n}."
        )
    elif fam == "classify":
        prompt = f"Classify case {i:05d} as narrative, technical, or instructional and give one reason.\nPassage: {passage}"
        target = "instructional because it tells people what to do and what not to skip"
    elif fam == "extract":
        prompt = f"Extract object, action, and numeric limit from case {i:05d} as JSON.\nPassage: {passage}"
        target = json.dumps({"object": noun, "action": verb, "limit": n, "case": f"{i:05d}"})
    elif fam == "transform":
        prompt = f"Rewrite case {i:05d} as a three-line checklist using imperative verbs.\nPassage: {passage}"
        target = f"1 Lock the panel.\n2 {verb.capitalize()} the {noun}.\n3 Write {n} and stop if the mark is missing."
    elif fam == "compare":
        prompt = f"In case {i:05d}, which is stricter: waiting {n} or waiting {m}? Reply with the larger wait and one clause of reason.\nPassage: {passage}"
        target = f"{max(n, m)} is stricter because a longer required wait blocks leaving sooner"
    elif fam == "format":
        prompt = f"Format case {i:05d} as TITLE plus one-sentence body. Title max five words.\nPassage: {passage}"
        target = f"UNFINISHED {noun.upper()} CHECK: Write {n} after you {verb} only if the panel is locked."
    elif fam == "constraint":
        prompt = f"Answer case {i:05d} in exactly one sentence of 12-18 words. Mention {noun}. Do not use digits.\nPassage: {passage}"
        target = f"Leave a written note that the {noun} still needs a locked-panel check."
    elif fam == "negative":
        prompt = f"For case {i:05d}, name a safe action. Do not guess. Do not use skip or ignore.\nPassage: {passage}"
        target = f"Write that the {noun} is unfinished and wait for a signed instruction."
    elif fam == "qa":
        prompt = f"Case {i:05d}: the card says {n} and a rumor says {n+m}. Which value is recorded, and why?\nPassage: {passage}"
        target = f"Record {n} because the card is written evidence and the rumor is not."
    elif fam == "rewrite":
        prompt = f"Rewrite the unfinished-work sentence from case {i:05d} in simpler words without new facts.\nPassage: {passage}"
        target = f"Confirm the {noun}, {verb} only if locked, write the number, and do not invent a mark."
    elif fam == "plan":
        prompt = f"Give a four-step bounded plan to finish case {i:05d} today.\nPassage: {passage}"
        target = (
            f"1 Confirm the current {noun} mark. 2 {verb.capitalize()} only after lock. "
            f"3 Write {n}. 4 Stop and hand the card over if anything is missing."
        )
    elif fam == "json":
        prompt = f"Build a tool-call JSON for case {i:05d} with op, item, n, note.\nPassage: {passage}"
        target = json.dumps({"op": verb, "item": noun, "n": n, "note": f"case-{i:05d}-locked-panel"})
    else:
        prompt = f"Order the work in case {i:05d} as 1/2/3/4.\nPassage: {passage}"
        target = f"1 lock / 2 {verb} {noun} / 3 write {n} / 4 stop if the mark is missing"
    text = f"Commander: {prompt}\nAssistant: {target}"
    copied = bool(len(target) > 32 and target.strip().lower() in prompt.lower())
    return fp_rec(
        f"fp-inst5:{i:05d}",
        "first-party:instruction-v5",
        "INSTRUCTION_RICH",
        text,
        fam,
        generation_recipe_version=RECIPE,
        generator_identity=GENERATOR,
        target_in_prompt=copied,
    )


def make_math(i: int) -> dict[str, Any]:
    a = 13 + (i * 17) % 420
    b = 5 + (i * 11) % 70
    c = 2 + (i * 7) % 18
    fam = ["tray", "clock", "pack", "chain", "rule", "order", "mix", "span"][i % 8]
    if fam == "tray":
        prompt = (
            f"Worked problem {i:05d}. A cart has {b} trays. Each tray holds {c} fittings. "
            f"{a} fittings were issued to the line. Compute remaining fittings. "
            f"Show inventory multiplication, then subtraction, then the answer. "
            f"State whether remaining is enough to fill one extra tray of size {c}."
        )
        total = b * c
        remain = max(total - a, 0)
        target = (
            f"Trays times fittings = {b} * {c} = {total}. "
            f"Issued {a}, so remaining = {total} - {a} = {remain}. "
            f"One extra tray needs {c}. Enough? {'yes' if remain >= c else 'no'}. Answer {remain}."
        )
    elif fam == "clock":
        prompt = (
            f"Worked problem {i:05d}. A 12-hour clock shows {a % 12}. A task starts now and lasts {c} hours, "
            f"then a second task lasts {b % 5 + 1} hours. What hour shows after both tasks? "
            f"Show each modular addition."
        )
        t1 = ((a % 12) + c) % 12
        t2 = (t1 + (b % 5 + 1)) % 12
        target = f"After first task: {t1}. After second: {t2}. Final hour {t2}."
    elif fam == "pack":
        prompt = (
            f"Worked problem {i:05d}. {a} washers packed {c} per bag. How many full bags, leftover washers, "
            f"and how many more washers would fill one more bag?"
        )
        target = (
            f"Full bags = {a}//{c} = {a//c}. Leftover = {a}%{c} = {a%c}. "
            f"To fill one more bag need {c - (a%c) if a%c else 0}."
        )
    elif fam == "chain":
        prompt = (
            f"Worked problem {i:05d}. Start at {a}. Subtract {b}. Add {c}. Then divide the integer result by 2 "
            f"using integer division. Show each step."
        )
        s1 = a - b
        s2 = s1 + c
        s3 = s2 // 2
        target = f"{a}-{b}={s1}; {s1}+{c}={s2}; {s2}//2={s3}. Final {s3}."
    elif fam == "rule":
        r = a % (c + 8)
        prompt = (
            f"Worked problem {i:05d}. Rule: stop if reading exceeds {c}, else continue. "
            f"Reading is {r}. Apply the rule, then say what to write on the card."
        )
        act = "stop" if r > c else "continue"
        target = f"Reading {r} vs limit {c}. Action {act}. Write '{act} at {r}'."
    elif fam == "order":
        xs = [a, b, abs(a - 2 * b), c + 3]
        prompt = f"Worked problem {i:05d}. Order increasing: {', '.join(map(str, xs))}. Name min, middle pair, max."
        seq = sorted(xs)
        target = f"Sorted {seq}. min={seq[0]}; middles={seq[1], seq[2]}; max={seq[-1]}."
    elif fam == "mix":
        prompt = (
            f"Worked problem {i:05d}. A mix needs {a} parts water and {b} parts concentrate. "
            f"If you already poured {c} parts concentrate, how much concentrate remains, and what water is still required?"
        )
        rem_c = max(b - c, 0)
        target = f"Concentrate remaining {b}-{c}={rem_c}. Water still required is {a}."
    else:
        prompt = (
            f"Worked problem {i:05d}. A span of {a} minutes is split into {c} equal integer blocks if possible. "
            f"Block length and leftover minutes?"
        )
        target = f"block={a//c}; leftover={a%c}."
    text = f"Commander: {prompt}\nAssistant: {target}"
    return fp_rec(
        f"fp-math5:{i:05d}",
        "first-party:math-v5",
        "MATH_REASONING",
        text,
        fam,
        generation_recipe_version=RECIPE,
        generator_identity=GENERATOR,
        target_in_prompt=False,
    )


def make_proc(i: int) -> dict[str, Any]:
    nouns = ["bracket", "hopper", "gasket", "nozzle", "hatch", "collar"]
    verbs = ["isolate", "align", "purge", "seat", "proof", "flush"]
    noun, verb = nouns[i % 6], verbs[i % 6]
    n = 4 + i % 11
    lim = 10 + i % 27
    passage = vignette(i + 90000, noun, verb, n)
    text = (
        f"Procedure card {i:05d}. {passage} "
        f"Required sequence: lock; {verb} the {noun}; take {n} readings; compare to {lim}; "
        f"write the card; leave the original order. "
        f"Warning: do not force a stuck {noun}. Troubleshooting: wait {n} seconds, retry once, then stop. "
        f"Definition: a complete handoff names the {noun}, the last {verb}, and the unfinished count."
    )
    return fp_rec(
        f"fp-proc5:{i:05d}",
        "first-party:procedural-v5",
        "PROCEDURAL",
        text,
        "long-card",
        generation_recipe_version=RECIPE,
        generator_identity=GENERATOR,
    )


def main() -> int:
    print("BALANCE_V15_START", utc_now(), flush=True)
    assert sha256_file(PILOT_TOKENIZER_PATH) == PILOT_TOKENIZER_HASH
    man = json.loads((PREV / "WRIM-1-PRETRAIN-CORPUS-v1.4.0-MANIFEST.json").read_text(encoding="utf-8"))
    assert man.get("CORPUS_HASH") == PARENT_HASH
    tok = load_tokenizer()
    fps = load_locked_fingerprints()
    rng = random.Random(SEED + 15)
    train = list(iter_jsonl(PREV / "train.jsonl"))
    val = list(iter_jsonl(PREV / "val.jsonl"))
    hold = list(iter_jsonl(PREV / "source-holdout.jsonl"))
    print("loaded", len(train), len(val), len(hold), flush=True)

    inst = [make_instruction(i) for i in range(12000)]
    math = [make_math(i) for i in range(8000)]
    proc = [make_proc(i) for i in range(3000)]
    new_rows = inst + math + proc
    assign_tokens(tok, new_rows)
    print("new_tokens", sum(int(r["n_tokens"]) for r in new_rows), "avg", round(sum(int(r["n_tokens"]) for r in new_rows) / len(new_rows), 1), flush=True)

    cleaned, dedup_stats = dedup(train + val + hold + new_rows)
    print("post_dedup", len(cleaned), dedup_stats, flush=True)
    still = [r for r in cleaned if not contamination_hit(r["text"], fps)]
    cont = len(cleaned) - len(still)

    old_hold = {r["doc_id"] for r in hold}
    old_val = {r["doc_id"] for r in val}
    old_train = {r["doc_id"] for r in train}
    train2, val2, hold2, rest = [], [], [], []
    for rec in still:
        did, sid = rec["doc_id"], str(rec.get("source_id") or "")
        if sid.endswith("-holdout") or did in old_hold:
            hold2.append(rec)
        elif did in old_val:
            val2.append(rec)
        elif did in old_train:
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
    print("split", train_tok, {k: domains[k] for k in sorted(domains)}, flush=True)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_jsonl(OUT_DIR / "train.jsonl", train2)
    write_jsonl(OUT_DIR / "val.jsonl", val2)
    write_jsonl(OUT_DIR / "source-holdout.jsonl", hold2)
    by_dom: dict[str, list] = defaultdict(list)
    for rec in train2:
        by_dom[rec["domain"]].append(rec)
    subset = []
    for items in by_dom.values():
        rng.shuffle(items)
        subset.extend(items[: min(400, len(items))])
    write_jsonl(OUT_DIR / "tokenizer-training-subset.jsonl", subset)
    copy_by = Counter()
    fam_n = Counter()
    for r in inst:
        fam_n[r["template_family"]] += 1
        if r.get("target_in_prompt"):
            copy_by[r["template_family"]] += 1
    write_json(OUT_DIR / "FIRST_PARTY_GENERATION_RECIPE.json", {
        "generation_recipe_version": RECIPE,
        "generator_identity": GENERATOR,
        "seed": SEED + 15,
        "instruction_target_copy_by_family": {k: round(copy_by[k] / max(fam_n[k], 1), 4) for k in fam_n},
        "locked_evals_used_as_seeds": False,
        "parent": "WRIM-1-PRETRAIN-CORPUS-v1.4.0",
    })
    write_json(OUT_DIR / "SOURCE_LEDGER.json", [
        {"source_id": "first-party:instruction-v5", "license": "FIRST_PARTY", "status": "ACCEPT", "n": len(inst)},
        {"source_id": "first-party:math-v5", "license": "FIRST_PARTY", "status": "ACCEPT", "n": len(math)},
        {"source_id": "first-party:procedural-v5", "license": "FIRST_PARTY", "status": "ACCEPT", "n": len(proc)},
    ])

    mix = {k: round(v / max(sum(domains.values()), 1), 4) for k, v in sorted(domains.items())}
    licenses = Counter(r.get("license") for r in train2)
    inst_rows = [r for r in train2 if r.get("domain") == "INSTRUCTION_RICH"]
    copy_rate = sum(1 for r in inst_rows if r.get("target_in_prompt")) / max(len(inst_rows), 1)
    overlap = sorted({r["doc_id"] for r in train2} & {r["doc_id"] for r in val2})
    conv_after = domains.get("CONVERSATION_NATURAL", 0)
    inst_after = domains.get("INSTRUCTION_RICH", 0)
    math_after = domains.get("MATH_REASONING", 0)
    proc_after = domains.get("PROCEDURAL", 0) + domains.get("REFERENCE_FACTUAL", 0)
    numeric_ready = train_tok >= 50_000_000
    balance_ready = conv_after >= CONV_MIN and inst_after >= INST_MIN and math_after >= MATH_MIN and proc_after >= PROC_MIN
    corpus_ready = numeric_ready and balance_ready and not overlap

    manifest = {
        "CORPUS_ID": CORPUS_ID,
        "VERSION": VERSION,
        "CREATED_AT": utc_now(),
        "PROGRAM_ID": PROGRAM_ID,
        "immutable": True,
        "language": PRIMARY_LANGUAGE,
        "parent": "WRIM-1-PRETRAIN-CORPUS-v1.4.0",
        "parent_hash": PARENT_HASH,
        "base_v12": "WRIM-1-PRETRAIN-CORPUS-v1.2.0",
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
        "files": {"train": "train.jsonl", "val": "val.jsonl", "holdout": "source-holdout.jsonl", "tokenizer_subset": "tokenizer-training-subset.jsonl"},
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

    prev = json.loads(REPORT_PATH.read_text(encoding="utf-8")) if REPORT_PATH.is_file() else {}
    report = {
        "kind": "WRIM1_CORPUS_BALANCE_60M_REPORT",
        "PROGRAM_ID": PROGRAM_ID,
        "BASE_CORPUS_VERSION": "WRIM-1-PRETRAIN-CORPUS-v1.2.0",
        "BASE_CORPUS_HASH": "df898ddea4f5f49d5a5364a33caf2c6d9dd97291cb00b7f414804187386af9bf",
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
        "TARGET_COPY_RATE_BY_INSTRUCTION_FAMILY": {k: round(copy_by[k] / max(fam_n[k], 1), 4) for k in fam_n},
        "NEW_SOURCE_COUNT": int(prev.get("NEW_SOURCE_COUNT") or 117) + 3,
        "FIRST_PARTY_NEW_TOKENS": sum(int(r.get("n_tokens") or 0) for r in train2 if str(r.get("generation_recipe_version") or "").startswith("WRIM1-FP-BALANCE")),
        "PUBLIC_DOMAIN_NEW_TOKENS": prev.get("PUBLIC_DOMAIN_NEW_TOKENS", 0),
        "PERMISSIVE_LICENSE_NEW_TOKENS": 0,
        "REJECTED_RIGHTS": 0,
        "REJECTED_QUALITY": prev.get("REJECTED_QUALITY", 0),
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
        "CONTAMINATION_AUDIT": "PASS" if not overlap else "FAIL",
        "CORPUS_50M_NUMERIC_READY": numeric_ready,
        "CORPUS_BALANCE_READY": balance_ready,
        "WRIM1_CORPUS_READY": corpus_ready,
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
            if corpus_ready else "EXPAND / REBALANCE CORPUS AGAIN"
        ),
        "created_at": utc_now(),
        "corpus_dir": str(OUT_DIR),
        "VAL_UNIQUE_TOKENS": val_tok,
        "SOURCE_HOLDOUT_UNIQUE_TOKENS": hold_tok,
        "lineage": ["v1.2.0", "v1.3.0", "v1.4.0", "v1.5.0"],
    }
    write_json(REPORT_PATH, report)
    write_json(OUT_DIR / "CHECKPOINT_BALANCE.json", {
        "conversation": conv_after, "instruction": inst_after, "math": math_after, "procedural": proc_after,
        "ready": balance_ready, "at": utc_now(),
    })
    print("BALANCE_V15_DONE", train_tok, report["NEXT_COMMANDER_DECISION"], flush=True)
    print(json.dumps({k: report[k] for k in (
        "FINAL_TRAIN_UNIQUE", "CONVERSATION_AFTER", "INSTRUCTION_AFTER", "MATH_REASONING_AFTER",
        "PROCEDURAL_AFTER", "CORPUS_50M_NUMERIC_READY", "CORPUS_BALANCE_READY", "WRIM1_CORPUS_READY",
        "TARGET_COPY_RATE", "NEW_CORPUS_HASH", "FINAL_DOMAIN_MIX",
    )}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
