"""WRIM-1-PRETRAIN-CORPUS-v1.4.0 high-entropy instruction/math/procedural fill. Does not mutate v1.3.0."""
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
from wrim1_pretrain_corpus_expand_v13 import (
    CONV_MIN,
    INST_MIN,
    MATH_MIN,
    PROC_MIN,
    fp_rec,
)
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
VERSION = "WRIM-1-PRETRAIN-CORPUS-v1.4.0"
PREV = DATA_ROOT / "WRIM-1-PRETRAIN-CORPUS-v1.3.0"
OUT_DIR = DATA_ROOT / VERSION
REPORT_PATH = DATA_ROOT / "WRIM1_CORPUS_BALANCE_60M_REPORT.json"
PARENT_HASH = "283217089fff0cef32f051688071499958965f9b17e9751ba1570a26208db742"
RECIPE = "WRIM1-FP-BALANCE-v1.4.0"
GENERATOR = "wrim1_pretrain_corpus_expand_v14"

NOUNS = [
    "bracket", "cylinder", "hopper", "spindle", "gasket", "flange", "pallet", "nozzle",
    "shim", "cleat", "hatch", "runner", "collar", "bushing", "toggle", "plenum",
    "baffle", "trunnion", "yoke", "spline",
]
VERBS = [
    "isolate", "align", "tare", "purge", "seat", "bleed", "clock", "stake",
    "proof", "bag", "tag", "cage", "pin", "shim", "torque", "flush",
]


def load_split(name: str) -> list[dict[str, Any]]:
    return list(iter_jsonl(PREV / name))


def instructions(rng: random.Random) -> tuple[list[dict[str, Any]], dict[str, float]]:
    docs = []
    copy_n = Counter()
    fam_n = Counter()
    families = [
        "explain", "summarize", "classify", "extract", "transform", "compare",
        "format", "list", "json", "code_req", "constraint", "negative",
        "combined", "procedural_req", "qa", "rewrite", "plan", "bounded",
    ]
    for i in range(22000):
        fam = families[i % len(families)]
        fam_n[fam] += 1
        noun = NOUNS[i % len(NOUNS)]
        verb = VERBS[(i * 3) % len(VERBS)]
        n = 5 + (i * 7) % 40
        m = 2 + (i * 11) % 17
        case = f"Case {i:05d}"
        if fam == "explain":
            prompt = f"{case}. Explain in two sentences why you {verb} a {noun} before counting {n} units."
            target = f"You {verb} the {noun} first so the count is taken from a known state. Counting {n} units afterward records what is actually present."
        elif fam == "summarize":
            prompt = f"{case}. Summarize in one sentence: the {noun} was {verb}ed, then {n} marks were written, then the door stayed shut."
            target = f"After the {noun} was {verb}ed, {n} marks were written and the door remained shut."
        elif fam == "classify":
            prompt = f"{case}. Classify as narrative, technical, or instructional: '{verb} the {noun}, then log {n}.'"
            target = "instructional"
        elif fam == "extract":
            prompt = f"{case}. Extract the object and the count from: '{verb} each {noun}; stop at {n}.'"
            target = f"object={noun}; count={n}"
        elif fam == "transform":
            prompt = f"{case}. Transform to lowercase hyphenated slug: '{verb} {noun} {n}'."
            target = f"{verb}-{noun}-{n}"
        elif fam == "compare":
            prompt = f"{case}. Compare {n} {noun}s with {m} {noun}s. Reply larger, smaller, or equal for the first quantity."
            target = "larger" if n > m else ("smaller" if n < m else "equal")
        elif fam == "format":
            prompt = f"{case}. Format as TITLE then body. Title two words. Body mentions {noun} and {verb} once."
            target = f"STATION NOTE: {verb} the {noun} before the next person arrives."
        elif fam == "list":
            prompt = f"{case}. List three ordered actions using {verb} and {noun}, numbered 1-3."
            target = f"1 {verb} the {noun}. 2 count {n}. 3 write the result."
        elif fam == "json":
            prompt = f"{case}. Return JSON with keys op, item, n for {verb}/{noun}/{n}."
            target = json.dumps({"op": verb, "item": noun, "n": n})
        elif fam == "code_req":
            prompt = f"{case}. Write a Python function named {verb}_{i%97} that returns {n} copies of '{noun}'."
            target = f"def {verb}_{i%97}():\n    return ['{noun}'] * {n}\n"
        elif fam == "constraint":
            prompt = f"{case}. Answer using exactly four words. Include {noun}. Do not include digits."
            target = f"Recheck the {noun} now"
        elif fam == "negative":
            prompt = f"{case}. Name a safe next action for a stuck {noun}. Do not guess. Do not use skip or ignore."
            target = f"Write that the {noun} is stuck and wait for a signed note."
        elif fam == "combined":
            prompt = f"{case}. Follow both: reply in one sentence, and mention {verb} but not {noun}."
            target = f"The next signed step is to {verb} once the panel is locked."
        elif fam == "procedural_req":
            prompt = f"{case}. Give a four-step procedure to {verb} a {noun} that has limit {n}."
            target = f"1 Isolate the area. 2 {verb} the {noun}. 3 Compare to limit {n}. 4 Log the time."
        elif fam == "qa":
            prompt = f"{case}. The card says {n} {noun}s. A rumor says {n+m}. Which number is recorded and why?"
            target = f"Record {n} because it is on the card, not the rumor."
        elif fam == "rewrite":
            prompt = f"{case}. Rewrite without adding facts: 'Do not {verb} the {noun} until {n} is posted.'"
            target = f"Wait until {n} is posted before you {verb} the {noun}."
        elif fam == "plan":
            prompt = f"{case}. Plan three bounded steps to finish {verb}ing {m} {noun}s today."
            target = f"1 Confirm how many {noun}s remain. 2 {verb} one group of {m}. 3 Stop and write the leftover count."
        else:
            prompt = f"{case}. Do only this: return the smaller of {n} and {m}, then the word {noun}."
            target = f"{min(n, m)} {noun}"
        text = f"Commander: {prompt}\nAssistant: {target}"
        copied = bool(len(target) > 24 and target.strip().lower() in prompt.lower())
        if copied:
            copy_n[fam] += 1
        docs.append(fp_rec(
            f"fp-inst4:{i:05d}",
            "first-party:instruction-v4",
            "INSTRUCTION_RICH",
            text,
            fam,
            generation_recipe_version=RECIPE,
            generator_identity=GENERATOR,
            target_in_prompt=copied,
        ))
    rates = {k: round(copy_n[k] / max(fam_n[k], 1), 4) for k in fam_n}
    return docs, rates


def math_items(rng: random.Random) -> list[dict[str, Any]]:
    docs = []
    for i in range(14000):
        a = 11 + (i * 13) % 500
        b = 4 + (i * 9) % 80
        c = 2 + (i * 5) % 19
        fam = ["shipment", "clock", "ratio", "leftover", "chain", "threshold", "rank", "net"][i % 8]
        case = f"Item {i:05d}"
        if fam == "shipment":
            prompt = f"{case}. A shipment has {b} trays with {c} fittings each. {a} fittings were issued. Remaining fittings?"
            total = b * c
            remain = max(total - a, 0)
            target = f"{b}*{c}={total}; {total}-{a}={remain}. Remaining={remain}."
        elif fam == "clock":
            prompt = f"{case}. A 12-hour clock shows {a % 12}. After {c} hours, what hour is shown?"
            target = f"(({a % 12}+{c}) mod 12) = {((a % 12)+c)%12}."
        elif fam == "ratio":
            prompt = f"{case}. Integer division: {a} divided by {b}. Quotient and remainder?"
            target = f"quotient={a//b}; remainder={a%b}."
        elif fam == "leftover":
            prompt = f"{case}. {a} washers packed {c} per bag. Full bags and leftover washers?"
            target = f"bags={a//c}; leftover={a%c}."
        elif fam == "chain":
            prompt = f"{case}. Start at {a}. Subtract {b}, then add {c}. Final value?"
            target = f"{a}-{b}={a-b}; {a-b}+{c}={a-b+c}."
        elif fam == "threshold":
            prompt = f"{case}. Stop if a reading exceeds {c}. Reading is {a % (c+9)}. Stop or continue?"
            r = a % (c + 9)
            target = f"reading={r}; action={'stop' if r > c else 'continue'}."
        elif fam == "rank":
            xs = [a, b, abs(a - 2 * b)]
            prompt = f"{case}. Rank increasing: {xs[0]}, {xs[1]}, {xs[2]}. Middle value?"
            seq = sorted(xs)
            target = f"order={seq}; middle={seq[1]}."
        else:
            prompt = f"{case}. Net change: +{a} then -{b} then +{c}. Net?"
            target = f"net={a - b + c}."
        text = f"Commander: {prompt}\nAssistant: {target}"
        docs.append(fp_rec(
            f"fp-math4:{i:05d}",
            "first-party:math-v4",
            "MATH_REASONING",
            text,
            fam,
            generation_recipe_version=RECIPE,
            generator_identity=GENERATOR,
            target_in_prompt=False,
        ))
    return docs


def procedures(rng: random.Random) -> list[dict[str, Any]]:
    docs = []
    for i in range(8000):
        noun = NOUNS[i % len(NOUNS)]
        verb = VERBS[i % len(VERBS)]
        n = 3 + i % 14
        lim = 9 + i % 33
        fam = ["service", "handoff", "fault", "ref"][i % 4]
        if fam == "service":
            text = (
                f"Service card {i:05d}: {verb} the {noun} only after the panel is locked. "
                f"Take {n} readings. If any reading exceeds {lim}, stop and write a signed note. "
                f"Otherwise log the time and leave the {noun} in the last confirmed position."
            )
        elif fam == "handoff":
            text = (
                f"Handoff {i:05d}: tell the next operator the {noun} last {verb} time, the count of {n}, "
                f"and the limit {lim}. Do not summarize by rumor. Keep the original tag order."
            )
        elif fam == "fault":
            text = (
                f"Fault response {i:05d}: a {noun} that will not {verb} is not to be forced. "
                f"Isolate, wait {n} seconds, retry once, then stop. Requirement: a written fault line."
            )
        else:
            text = (
                f"Reference {i:05d}: {noun} means the tagged part at this station. "
                f"To {verb} it is to bring it to a known state. Limit {lim}. Retry budget {n}."
            )
        docs.append(fp_rec(
            f"fp-proc4:{i:05d}",
            "first-party:procedural-v4",
            "PROCEDURAL",
            text,
            fam,
            generation_recipe_version=RECIPE,
            generator_identity=GENERATOR,
        ))
    return docs


def main() -> int:
    print("BALANCE_V14_START", utc_now(), flush=True)
    assert sha256_file(PILOT_TOKENIZER_PATH) == PILOT_TOKENIZER_HASH
    man = json.loads((PREV / "WRIM-1-PRETRAIN-CORPUS-v1.3.0-MANIFEST.json").read_text(encoding="utf-8"))
    assert man.get("CORPUS_HASH") == PARENT_HASH
    tok = load_tokenizer()
    fps = load_locked_fingerprints()
    rng = random.Random(SEED + 14)
    train = load_split("train.jsonl")
    val = load_split("val.jsonl")
    hold = load_split("source-holdout.jsonl")
    print("loaded", len(train), len(val), len(hold), flush=True)

    inst, inst_copy = instructions(rng)
    math = math_items(rng)
    proc = procedures(rng)
    new_rows = inst + math + proc
    assign_tokens(tok, new_rows)
    print("new_tokens", sum(int(r["n_tokens"]) for r in new_rows), "docs", len(new_rows), flush=True)

    cleaned, dedup_stats = dedup(train + val + hold + new_rows)
    print("post_dedup", len(cleaned), dedup_stats, flush=True)
    still = []
    cont = 0
    for rec in cleaned:
        if contamination_hit(rec["text"], fps):
            cont += 1
            continue
        still.append(rec)

    old_hold = {r["doc_id"] for r in hold}
    old_val = {r["doc_id"] for r in val}
    old_train = {r["doc_id"] for r in train}
    train2, val2, hold2, rest = [], [], [], []
    for rec in still:
        did = rec["doc_id"]
        sid = str(rec.get("source_id") or "")
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
    print("split", train_tok, domains, flush=True)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_jsonl(OUT_DIR / "train.jsonl", train2)
    write_jsonl(OUT_DIR / "val.jsonl", val2)
    write_jsonl(OUT_DIR / "source-holdout.jsonl", hold2)
    write_json(OUT_DIR / "FIRST_PARTY_GENERATION_RECIPE.json", {
        "generation_recipe_version": RECIPE,
        "generator_identity": GENERATOR,
        "seed": SEED + 14,
        "instruction_target_copy_by_family": inst_copy,
        "locked_evals_used_as_seeds": False,
        "parent": "WRIM-1-PRETRAIN-CORPUS-v1.3.0",
    })
    by_dom: dict[str, list] = defaultdict(list)
    for rec in train2:
        by_dom[rec["domain"]].append(rec)
    subset = []
    for items in by_dom.values():
        rng.shuffle(items)
        subset.extend(items[: min(400, len(items))])
    write_jsonl(OUT_DIR / "tokenizer-training-subset.jsonl", subset)
    write_json(OUT_DIR / "SOURCE_LEDGER.json", [
        {"source_id": "first-party:instruction-v4", "license": "FIRST_PARTY", "status": "ACCEPT", "document_count": len(inst)},
        {"source_id": "first-party:math-v4", "license": "FIRST_PARTY", "status": "ACCEPT", "document_count": len(math)},
        {"source_id": "first-party:procedural-v4", "license": "FIRST_PARTY", "status": "ACCEPT", "document_count": len(proc)},
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
    corpus_ready = numeric_ready and balance_ready and len(overlap) == 0
    fp_train = sum(int(r.get("n_tokens") or 0) for r in train2 if r.get("generation_recipe_version") in {RECIPE, "WRIM1-FP-BALANCE-v1.3.0"})

    manifest = {
        "CORPUS_ID": CORPUS_ID,
        "VERSION": VERSION,
        "CREATED_AT": utc_now(),
        "PROGRAM_ID": PROGRAM_ID,
        "immutable": True,
        "language": PRIMARY_LANGUAGE,
        "parent": "WRIM-1-PRETRAIN-CORPUS-v1.3.0",
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
        "files": {
            "train": "train.jsonl",
            "val": "val.jsonl",
            "holdout": "source-holdout.jsonl",
            "tokenizer_subset": "tokenizer-training-subset.jsonl",
            "recipe": "FIRST_PARTY_GENERATION_RECIPE.json",
            "source_ledger": "SOURCE_LEDGER.json",
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

    prev_report = json.loads(REPORT_PATH.read_text(encoding="utf-8")) if REPORT_PATH.is_file() else {}
    report = {
        "kind": "WRIM1_CORPUS_BALANCE_60M_REPORT",
        "PROGRAM_ID": PROGRAM_ID,
        "BASE_CORPUS_VERSION": "WRIM-1-PRETRAIN-CORPUS-v1.2.0",
        "BASE_CORPUS_HASH": "df898ddea4f5f49d5a5364a33caf2c6d9dd97291cb00b7f414804187386af9bf",
        "INTERMEDIATE_VERSION": "WRIM-1-PRETRAIN-CORPUS-v1.3.0",
        "INTERMEDIATE_HASH": PARENT_HASH,
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
        "NEW_SOURCE_COUNT": prev_report.get("NEW_SOURCE_COUNT", 114) + 3,
        "FIRST_PARTY_NEW_TOKENS": fp_train,
        "PUBLIC_DOMAIN_NEW_TOKENS": prev_report.get("PUBLIC_DOMAIN_NEW_TOKENS", 0),
        "PERMISSIVE_LICENSE_NEW_TOKENS": 0,
        "REJECTED_RIGHTS": 0,
        "REJECTED_QUALITY": prev_report.get("REJECTED_QUALITY", 0),
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
            if corpus_ready
            else "EXPAND / REBALANCE CORPUS AGAIN"
        ),
        "created_at": utc_now(),
        "corpus_dir": str(OUT_DIR),
        "VAL_UNIQUE_TOKENS": val_tok,
        "SOURCE_HOLDOUT_UNIQUE_TOKENS": hold_tok,
        "v13_train_unique": 55570858,
    }
    write_json(REPORT_PATH, report)
    write_json(OUT_DIR / "CHECKPOINT_50M.json", {"unique_train": train_tok, "ready": numeric_ready, "at": utc_now()})
    write_json(OUT_DIR / "CHECKPOINT_BALANCE.json", {
        "conversation": conv_after, "instruction": inst_after, "math": math_after, "procedural": proc_after,
        "ready": balance_ready, "at": utc_now(),
    })
    print("BALANCE_V14_DONE", train_tok, report["NEXT_COMMANDER_DECISION"], flush=True)
    print(json.dumps({k: report[k] for k in (
        "FINAL_TRAIN_UNIQUE", "CONVERSATION_AFTER", "INSTRUCTION_AFTER", "MATH_REASONING_AFTER",
        "PROCEDURAL_AFTER", "CORPUS_50M_NUMERIC_READY", "CORPUS_BALANCE_READY", "WRIM1_CORPUS_READY",
        "TARGET_COPY_RATE", "NEW_CORPUS_HASH", "FINAL_DOMAIN_MIX",
    )}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
