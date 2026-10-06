"""Build and freeze WR-CORPUS-PLM-FIRST-TOKEN-1-v1.0.0. Does not train.

Does not mutate WR-CORPUS-PLM-PROBE-1 or WR-CORPUS-CPT-2.
"""
from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from wrim_plm1_corpus import leakage_scan
from wrim_plm2_identity import (
    CORPUS_DIRNAME,
    CORPUS_ID,
    CORPUS_VERSION,
    DATA_ROOT,
    MIN_CLASS_OVERLAP,
    MIN_TRAIN_PER_CLASS,
    N_CLASSES_MAX,
    N_CLASSES_MIN,
)

# 10 first-token classes. Each target is a single common tokenizer piece.
# 18 train + 6 val per class. Val prompts are unseen; answers share the class token.
CLASS_PROMPTS: dict[str, list[str]] = {
    "yes": [
        "Is snow cold in ordinary speech? yes or no.",
        "Does a bicycle usually have two wheels? yes or no.",
        "Can a fish live in water? yes or no.",
        "Is 10 greater than 3? yes or no.",
        "Does the sun rise in the morning? yes or no.",
        "Is a square a rectangle with equal sides? yes or no.",
        "Can paper be folded? yes or no.",
        "Is air needed for ordinary human breathing? yes or no.",
        "Does 5 plus 5 equal 10? yes or no.",
        "Is a puppy a young dog? yes or no.",
        "Can a door be opened? yes or no.",
        "Is night darker than noon? yes or no.",
        "Does a week contain seven days? yes or no.",
        "Is bread a food? yes or no.",
        "Can a book be read? yes or no.",
        "Is a hill lower than a typical mountain? yes or no.",
        "Does rain fall from clouds? yes or no.",
        "Is a key used to open a lock? yes or no.",
        "Can a cup hold water? yes or no.",
        "Is Tuesday after Monday? yes or no.",
        "Does a triangle have three sides? yes or no.",
        "Is ice made of frozen water? yes or no.",
        "Can a window be made of glass? yes or no.",
        "Is a map used for finding places? yes or no.",
    ],
    "no": [
        "Is fire colder than ice in ordinary speech? yes or no.",
        "Does a bicycle usually have nine wheels? yes or no.",
        "Can a rock photosynthesize like a green leaf? yes or no.",
        "Is 3 greater than 10? yes or no.",
        "Does the sun rise at midnight? yes or no.",
        "Does a circle have four corners? yes or no.",
        "Is a stone a kind of bird? yes or no.",
        "Can a fish live in dry sand as its home? yes or no.",
        "Does 2 plus 2 equal 5? yes or no.",
        "Is a kitten a young horse? yes or no.",
        "Is winter the hottest season in ordinary speech? yes or no.",
        "Does a month have three hundred days? yes or no.",
        "Is a cloud a kind of metal? yes or no.",
        "Can a shadow exist without light? yes or no.",
        "Is the moon a planet in ordinary school speech? yes or no.",
        "Does a square have five sides? yes or no.",
        "Is salt the same as water? yes or no.",
        "Can a wooden chair fly by itself? yes or no.",
        "Is January the last month of the year? yes or no.",
        "Does a day have forty hours? yes or no.",
        "Is a river a kind of mountain? yes or no.",
        "Can a silent drum make a loud sound by itself? yes or no.",
        "Is smoke a solid block of wood? yes or no.",
        "Does a pencil grow on trees as fruit? yes or no.",
    ],
    "red": [
        "Print the color red once, then stop.",
        "Reply with the color word red and nothing else.",
        "What color is a ripe common apple often called? one word.",
        "Name the color of fresh blood in ordinary speech. one word.",
        "Return only the color red.",
        "Give the English color word red.",
        "Output the color name red.",
        "Answer with red as a single color word.",
        "Write the color red and halt.",
        "Say the color of a stop sign in ordinary speech. one word.",
        "Provide the color word red.",
        "Respond using only the word red.",
        "Which color word is red? reply with that word.",
        "Echo the color red once.",
        "State the color red.",
        "Give one-word color: red.",
        "Return red as the color answer.",
        "Name this color: red.",
        "Print red as the color.",
        "The requested color is red. reply with that color.",
        "Output only red.",
        "Color answer required: red.",
        "Reply red.",
        "One color token please: red.",
    ],
    "blue": [
        "Print the color blue once, then stop.",
        "Reply with the color word blue and nothing else.",
        "What color is a clear daytime sky often called? one word.",
        "Name the color of deep ocean water in ordinary speech. one word.",
        "Return only the color blue.",
        "Give the English color word blue.",
        "Output the color name blue.",
        "Answer with blue as a single color word.",
        "Write the color blue and halt.",
        "Say the color of many sapphires in ordinary speech. one word.",
        "Provide the color word blue.",
        "Respond using only the word blue.",
        "Which color word is blue? reply with that word.",
        "Echo the color blue once.",
        "State the color blue.",
        "Give one-word color: blue.",
        "Return blue as the color answer.",
        "Name this color: blue.",
        "Print blue as the color.",
        "The requested color is blue. reply with that color.",
        "Output only blue.",
        "Color answer required: blue.",
        "Reply blue.",
        "One color token please: blue.",
    ],
    "cat": [
        "Name the small house pet that meows. one word.",
        "Reply with the animal cat and nothing else.",
        "What animal is a kitten when grown? one word.",
        "Print the word cat once, then stop.",
        "Return only the animal cat.",
        "Give the English animal word cat.",
        "Output the animal name cat.",
        "Answer with cat as a single animal word.",
        "Write cat and halt.",
        "Which animal purrs in ordinary speech? one word.",
        "Provide the animal word cat.",
        "Respond using only the word cat.",
        "Echo the animal cat once.",
        "State the animal cat.",
        "Give one-word animal: cat.",
        "Return cat as the animal answer.",
        "Name this animal: cat.",
        "Print cat as the animal.",
        "The requested animal is cat. reply with that animal.",
        "Output only cat.",
        "Animal answer required: cat.",
        "Reply cat.",
        "One animal token please: cat.",
        "A feline house pet is called a cat. reply with that word.",
    ],
    "dog": [
        "Name the house pet that barks. one word.",
        "Reply with the animal dog and nothing else.",
        "What animal is a puppy when grown? one word.",
        "Print the word dog once, then stop.",
        "Return only the animal dog.",
        "Give the English animal word dog.",
        "Output the animal name dog.",
        "Answer with dog as a single animal word.",
        "Write dog and halt.",
        "Which animal is often called man's best friend? one word.",
        "Provide the animal word dog.",
        "Respond using only the word dog.",
        "Echo the animal dog once.",
        "State the animal dog.",
        "Give one-word animal: dog.",
        "Return dog as the animal answer.",
        "Name this animal: dog.",
        "Print dog as the animal.",
        "The requested animal is dog. reply with that animal.",
        "Output only dog.",
        "Animal answer required: dog.",
        "Reply dog.",
        "One animal token please: dog.",
        "A canine house pet is called a dog. reply with that word.",
    ],
    "stop": [
        "Reply with the action word stop and nothing else.",
        "Print the word stop once, then halt.",
        "What word tells a walker to cease moving? one word.",
        "Return only the verb stop.",
        "Give the English word stop.",
        "Output the command stop.",
        "Answer with stop as a single word.",
        "Write stop and halt.",
        "Provide the word stop.",
        "Respond using only the word stop.",
        "Echo the word stop once.",
        "State the word stop.",
        "Give one-word command: stop.",
        "Return stop as the action answer.",
        "Name this action: stop.",
        "Print stop as the command.",
        "The requested word is stop. reply with that word.",
        "Output only stop.",
        "Action answer required: stop.",
        "Reply stop.",
        "One action token please: stop.",
        "The opposite of go in a simple pair is stop. reply with that word.",
        "Say stop.",
        "Give the halt word stop.",
    ],
    "go": [
        "Reply with the action word go and nothing else.",
        "Print the word go once, then halt.",
        "What word tells a walker to begin moving? one word.",
        "Return only the verb go.",
        "Give the English word go.",
        "Output the command go.",
        "Answer with go as a single word.",
        "Write go and halt.",
        "Provide the word go.",
        "Respond using only the word go.",
        "Echo the word go once.",
        "State the word go.",
        "Give one-word command: go.",
        "Return go as the action answer.",
        "Name this action: go.",
        "Print go as the command.",
        "The requested word is go. reply with that word.",
        "Output only go.",
        "Action answer required: go.",
        "Reply go.",
        "One action token please: go.",
        "The opposite of stop in a simple pair is go. reply with that word.",
        "Say go.",
        "Give the start-moving word go.",
    ],
    "one": [
        "Reply with the number word one and nothing else.",
        "Print the word one once, then stop.",
        "How many suns does Earth orbit in ordinary speech? one word.",
        "Return only the number word one.",
        "Give the English number one.",
        "Output the count one.",
        "Answer with one as a single word.",
        "Write one and halt.",
        "Provide the number word one.",
        "Respond using only the word one.",
        "Echo the word one once.",
        "State the number one.",
        "Give one-word number: one.",
        "Return one as the count answer.",
        "Name this number: one.",
        "Print one as the number.",
        "The requested number word is one. reply with that word.",
        "Output only one.",
        "Number answer required: one.",
        "Reply one.",
        "One number token please: one.",
        "A single item is counted as one. reply with that word.",
        "Say one.",
        "Give the first counting word one.",
    ],
    "two": [
        "Reply with the number word two and nothing else.",
        "Print the word two once, then stop.",
        "How many wheels does a common bicycle have? one word.",
        "Return only the number word two.",
        "Give the English number two.",
        "Output the count two.",
        "Answer with two as a single word.",
        "Write two and halt.",
        "Provide the number word two.",
        "Respond using only the word two.",
        "Echo the word two once.",
        "State the number two.",
        "Give one-word number: two.",
        "Return two as the count answer.",
        "Name this number: two.",
        "Print two as the number.",
        "The requested number word is two. reply with that word.",
        "Output only two.",
        "Number answer required: two.",
        "Reply two.",
        "One number token please: two.",
        "A pair of items is counted as two. reply with that word.",
        "Say two.",
        "Give the second counting word two.",
    ],
}


def _sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _sha256_file(p: Path) -> str:
    return _sha256_bytes(p.read_bytes())


def build_items() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    train: list[dict[str, Any]] = []
    val: list[dict[str, Any]] = []
    n = 0
    for cls, prompts in CLASS_PROMPTS.items():
        if len(prompts) != 24:
            raise ValueError(f"{cls} must have 24 prompts, got {len(prompts)}")
        if len(set(prompts)) != 24:
            raise ValueError(f"{cls} has duplicate prompts")
        # last 6 val, first 18 train
        for i, prompt in enumerate(prompts):
            rec = {
                "example_id": f"ft-{n:04d}",
                "family": f"class_{cls}",
                "first_token_class": cls,
                "prompt": prompt,
                "target": cls,
                "provenance": "first-party-war-room-os-internal",
            }
            n += 1
            if i < 18:
                train.append(rec)
            else:
                val.append(rec)
    return train, val


def class_report(train: list[dict[str, Any]], val: list[dict[str, Any]], tokenizer=None) -> dict[str, Any]:
    tr = Counter(r["first_token_class"] for r in train)
    va = Counter(r["first_token_class"] for r in val)
    classes = sorted(set(tr) | set(va))
    overlap = [c for c in classes if tr[c] > 0 and va[c] > 0]
    rows = []
    for c in classes:
        token_id = None
        piece = None
        if tokenizer is not None:
            ids = list(tokenizer.encode(c, add_special_tokens=False).ids)
            token_id = ids[0] if ids else None
            piece = tokenizer.id_to_token(token_id) if token_id is not None else None
        rows.append(
            {
                "CLASS": c,
                "TRAIN_COUNT": int(tr[c]),
                "VAL_COUNT": int(va[c]),
                "TOKEN_ID": token_id,
                "PIECE": piece,
            }
        )
    n_val_cls = len([c for c in classes if va[c] > 0])
    overlap_frac = (len(overlap) / n_val_cls) if n_val_cls else 0.0
    min_train = min(tr.values()) if tr else 0
    max_train = max(tr.values()) if tr else 0
    balance_ok = (max_train - min_train) <= 1 and min_train >= MIN_TRAIN_PER_CLASS
    n_cls = len(classes)
    ok = (
        N_CLASSES_MIN <= n_cls <= N_CLASSES_MAX
        and overlap_frac >= MIN_CLASS_OVERLAP
        and balance_ok
        and all(tr[c] >= MIN_TRAIN_PER_CLASS for c in classes)
        and all(va[c] > 0 for c in classes)
    )
    return {
        "ok": ok,
        "FIRST_TOKEN_CLASSES": classes,
        "FIRST_TOKEN_CLASS_COUNTS": rows,
        "FIRST_TOKEN_TRAIN_VAL_OVERLAP": overlap_frac,
        "overlap_classes": overlap,
        "n_classes": n_cls,
        "balance_ok": balance_ok,
        "min_train": min_train,
        "max_train": max_train,
    }


def freeze_corpus(root: Path | None = None, tokenizer=None) -> dict[str, Any]:
    root = Path(root or Path(DATA_ROOT) / CORPUS_DIRNAME)
    root.mkdir(parents=True, exist_ok=True)
    train, val = build_items()
    crep = class_report(train, val, tokenizer=tokenizer)
    if tokenizer is not None:
        try:
            from wrim_cpt_identity import COMMANDER_ID  # noqa: F401
            from wrim_cpt_stage_b_corpus import corpus_root, load_jsonl, tokenize_docs
            from wrim_cpt2_identity import CORPUS_VERSION as CPT2_CORPUS_VERSION
            import numpy as np
            from run000007_preflight import resolve_dump_root

            c2 = corpus_root() / f"{CPT2_CORPUS_VERSION}-TRAIN.jsonl"
            c2_bc = None
            if c2.is_file():
                docs = load_jsonl(c2)
                tokdocs = tokenize_docs(docs, tokenizer)
                ids = np.concatenate([np.asarray(r["token_ids"], dtype=np.int32) for r in tokdocs if r.get("token_ids")])
                c2_bc = np.bincount(ids[(ids >= 0) & (ids < 15126)], minlength=15126)
            pre_bc = None
            dump = resolve_dump_root(None)
            npy = None if dump is None else dump / "model-lab" / "manifests" / "wrim0_corpus_shards" / "train.npy"
            if npy is not None and npy.is_file():
                arr = np.load(npy, mmap_mode="r")
                pre_bc = np.zeros(15126, dtype=np.int64)
                for s in range(0, arr.size, 2_000_000):
                    chunk = np.asarray(arr[s : s + 2_000_000], dtype=np.int64)
                    chunk = chunk[(chunk >= 0) & (chunk < 15126)]
                    pre_bc += np.bincount(chunk, minlength=15126)
            for row in crep["FIRST_TOKEN_CLASS_COUNTS"]:
                tid = row.get("TOKEN_ID")
                row["PRETRAIN_FREQUENCY"] = None if pre_bc is None or tid is None else int(pre_bc[int(tid)])
                row["CPT_FREQUENCY"] = None if c2_bc is None or tid is None else int(c2_bc[int(tid)])
        except Exception as exc:
            crep["freq_error"] = str(exc)
    if not crep["ok"]:
        return {"ok": False, "reason": "CLASS_BALANCE_OR_OVERLAP_FAIL", "class_report": crep}
    leak = leakage_scan(train, val)
    if not leak["ok"]:
        return {"ok": False, "reason": "LEAKAGE_SCAN_FAIL", "leakage": leak, "class_report": crep}
    train_p = root / "train.jsonl"
    val_p = root / "val.jsonl"
    train_p.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in train), encoding="utf-8")
    val_p.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in val), encoding="utf-8")
    train_hash = _sha256_file(train_p)
    val_hash = _sha256_file(val_p)
    manifest = {
        "corpus_id": CORPUS_ID,
        "corpus_version": CORPUS_VERSION,
        "TRAIN_EXAMPLE_COUNT": len(train),
        "VAL_EXAMPLE_COUNT": len(val),
        "train_file": "train.jsonl",
        "val_file": "val.jsonl",
        "train_sha256": train_hash,
        "val_sha256": val_hash,
        "FIRST_TOKEN_CLASSES": crep["FIRST_TOKEN_CLASSES"],
        "FIRST_TOKEN_TRAIN_VAL_OVERLAP": crep["FIRST_TOKEN_TRAIN_VAL_OVERLAP"],
        "PROVENANCE": "first-party War Room OS internal short-answer curriculum. No third-party scrape.",
        "CPT2_MUTATED": False,
        "PLM_PROBE_1_MUTATED": False,
    }
    man_blob = json.dumps(manifest, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    manifest_hash = _sha256_bytes(man_blob)
    manifest["manifest_sha256"] = manifest_hash
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    corpus_hash = _sha256_bytes((train_hash + val_hash + manifest_hash).encode("ascii"))
    (root / "CORPUS_HASH.txt").write_text(corpus_hash + "\n", encoding="utf-8")
    (root / "class-report.json").write_text(json.dumps(crep, indent=2) + "\n", encoding="utf-8")
    return {
        "ok": True,
        "root": str(root),
        "CORPUS_ID": CORPUS_ID,
        "CORPUS_VERSION": CORPUS_VERSION,
        "CORPUS_HASH": corpus_hash,
        "MANIFEST_HASH": manifest_hash,
        "TRAIN_HASH": train_hash,
        "VAL_HASH": val_hash,
        "TRAIN_EXAMPLES": len(train),
        "VAL_EXAMPLES": len(val),
        "LEAKAGE_SCAN": "PASS",
        "leakage": leak,
        "class_report": crep,
        "manifest": manifest,
        "PROVENANCE": manifest["PROVENANCE"],
        "DUPLICATE_SCAN": "PASS",
    }


if __name__ == "__main__":
    print(json.dumps({k: v for k, v in freeze_corpus().items() if k not in {"leakage", "manifest"}}, indent=2, default=str))
