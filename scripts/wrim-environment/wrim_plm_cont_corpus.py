"""WR-CORPUS-PLM-FIRST-TOKEN-CONTINUATION-1-v1.0.0. Analysis freeze only.

Does not train. Does not mutate WR-CORPUS-PLM-FIRST-TOKEN-1 or PLM-PROBE-1 or CPT-2.
"""
from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

from wrim_plm1_corpus import leakage_scan
from wrim_plm2_corpus import CLASS_PROMPTS, class_report
from wrim_plm3_identity import DATA_ROOT, MIN_CLASS_OVERLAP, MIN_TRAIN_PER_CLASS, N_CLASSES_MAX, N_CLASSES_MIN

CORPUS_ID = "WR-CORPUS-PLM-FIRST-TOKEN-CONTINUATION-1"
CORPUS_VERSION = "WR-CORPUS-PLM-FIRST-TOKEN-CONTINUATION-1-v1.0.0"
OLD_CORPUS_DIR = "WR-CORPUS-PLM-FIRST-TOKEN-1-v1.0.0"
OLD_CORPUS_HASH = "3150baffb6d723f89aedb119fc2728846df9da9e044364a32e4591f5a7d8cd26"

# Shared across classes so a later-token suffix cannot identify the class.
CONTINUATION_PATTERNS = (
    " word",
    " answer",
    " here",
    " now",
    " word now",
    " as asked",
    " word now please",
    " answer here now",
)


def _sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _sha256_file(p: Path) -> str:
    return _sha256_bytes(p.read_bytes())


def adapt_prompt(prompt: str) -> str:
    p = prompt
    p = re.sub(r"\bone word\.?", "", p, flags=re.I)
    p = re.sub(r"\band nothing else\.?", "", p, flags=re.I)
    p = re.sub(r", then stop\.?", ".", p, flags=re.I)
    p = re.sub(r", then halt\.?", ".", p, flags=re.I)
    p = re.sub(r"\s+", " ", p).strip()
    if not p.endswith("."):
        p += "."
    return (
        p
        + " Start with the short answer word, then add one to three ordinary extra words."
    )


def example_overlap(train: list[dict[str, Any]], val: list[dict[str, Any]]) -> dict[str, Any]:
    train_pt = {(str(r["prompt"]), str(r["target"])) for r in train}
    train_p = {str(r["prompt"]) for r in train}
    pair_hits = [r["example_id"] for r in val if (str(r["prompt"]), str(r["target"])) in train_pt]
    prompt_hits = [r["example_id"] for r in val if str(r["prompt"]) in train_p]
    return {
        "TRAIN_VAL_EXAMPLE_OVERLAP": len(pair_hits),
        "TRAIN_VAL_PROMPT_OVERLAP": len(prompt_hits),
        "pair_hit_ids": pair_hits,
        "prompt_hit_ids": prompt_hits,
        "ok": len(pair_hits) == 0 and len(prompt_hits) == 0,
    }


def build_items() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    train: list[dict[str, Any]] = []
    val: list[dict[str, Any]] = []
    n = 0
    for cls, prompts in CLASS_PROMPTS.items():
        if len(prompts) != 24:
            raise ValueError(f"{cls} must have 24 prompts, got {len(prompts)}")
        if len(set(prompts)) != 24:
            raise ValueError(f"{cls} has duplicate prompts")
        adapted = [adapt_prompt(p) for p in prompts]
        if len(set(adapted)) != 24:
            raise ValueError(f"{cls} adapted prompts collided")
        for i, prompt in enumerate(adapted):
            suf = CONTINUATION_PATTERNS[i % len(CONTINUATION_PATTERNS)]
            rec = {
                "example_id": f"ftc-{n:04d}",
                "family": f"class_{cls}",
                "first_token_class": cls,
                "prompt": prompt,
                "target": f"{cls}{suf}",
                "continuation_pattern": suf.strip(),
                "provenance": "first-party-war-room-os-internal-continuation-analysis",
            }
            n += 1
            if i < 18:
                train.append(rec)
            else:
                val.append(rec)
    return train, val


def continuation_stats(train: list[dict[str, Any]], val: list[dict[str, Any]], encoded: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    rows = train + val
    patterns = Counter(r["continuation_pattern"] for r in rows)
    per_class = {}
    for cls in sorted({r["first_token_class"] for r in rows}):
        pats = sorted({r["continuation_pattern"] for r in rows if r["first_token_class"] == cls})
        per_class[cls] = {"n_patterns": len(pats), "patterns": pats}
    suffix_classes: dict[str, set[str]] = {}
    for r in rows:
        suffix_classes.setdefault(r["continuation_pattern"], set()).add(r["first_token_class"])
    unique_suffix = all(len(v) == 10 for v in suffix_classes.values())
    lengths = None
    later_set = None
    if encoded:
        lengths = [len(e["target_ids"]) for e in encoded]
        later_set = {tuple(e["target_ids"][1:]) for e in encoded}
    return {
        "pattern_counts": dict(patterns),
        "patterns_per_class": per_class,
        "min_patterns_per_class": min(v["n_patterns"] for v in per_class.values()),
        "suffix_used_by_all_10_classes": unique_suffix,
        "n_distinct_suffixes": len(patterns),
        "MEAN_TARGET_LENGTH": (sum(lengths) / len(lengths)) if lengths else None,
        "MEDIAN_TARGET_LENGTH": (sorted(lengths)[len(lengths) // 2] if lengths else None),
        "LATER_TOKEN_DIVERSITY": (len(later_set) if later_set is not None else None),
        "unique_later_id_tuples": len(later_set) if later_set is not None else None,
    }


def freeze_corpus(root: Path | None = None, tokenizer=None) -> dict[str, Any]:
    old = Path(DATA_ROOT) / OLD_CORPUS_DIR / "CORPUS_HASH.txt"
    live_old = old.read_text(encoding="utf-8").strip() if old.is_file() else None
    if live_old != OLD_CORPUS_HASH:
        return {"ok": False, "reason": "old_first_token_corpus_mutated", "live": live_old, "expected": OLD_CORPUS_HASH}

    root = Path(root or Path(DATA_ROOT) / CORPUS_VERSION)
    root.mkdir(parents=True, exist_ok=True)
    train, val = build_items()
    crep = class_report(train, val, tokenizer=tokenizer)
    exo = example_overlap(train, val)
    if not crep["ok"]:
        return {"ok": False, "reason": "CLASS_BALANCE_OR_OVERLAP_FAIL", "class_report": crep}
    leak = leakage_scan(train, val)
    if not leak["ok"]:
        return {"ok": False, "reason": "LEAKAGE_SCAN_FAIL", "leakage": leak, "class_report": crep}
    if not exo["ok"]:
        return {"ok": False, "reason": "EXAMPLE_OR_PROMPT_OVERLAP", "example_overlap": exo}

    encoded = None
    if tokenizer is not None:
        from wrim_plm3_encode import encode_example

        encoded = [encode_example(tokenizer, r) for r in train + val]
        for rec, enc in zip(train + val, encoded):
            n_tgt = len(enc["target_ids"])
            n_later = n_tgt - 1
            if n_later < 1 or n_later > 3:
                return {"ok": False, "reason": "later_token_count_out_of_range", "example_id": rec["example_id"], "n_later": n_later, "pieces": [tokenizer.id_to_token(i) for i in enc["target_ids"]]}
        class_first = {}
        for rec, enc in zip(train + val, encoded):
            class_first.setdefault(rec["first_token_class"], set()).add(int(enc["first_target_id"]))
        if any(len(s) != 1 for s in class_first.values()):
            return {"ok": False, "reason": "class_first_token_inconsistent", "class_first": {k: sorted(v) for k, v in class_first.items()}}

    cstat = continuation_stats(train, val, encoded)
    if cstat["min_patterns_per_class"] < 3:
        return {"ok": False, "reason": "too_few_continuation_patterns", "stats": cstat}
    if not cstat["suffix_used_by_all_10_classes"]:
        return {"ok": False, "reason": "suffix_class_shortcut", "stats": cstat}

    train_p = root / "train.jsonl"
    val_p = root / "val.jsonl"
    train_p.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in train), encoding="utf-8")
    val_p.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in val), encoding="utf-8")
    train_hash = _sha256_file(train_p)
    val_hash = _sha256_file(val_p)
    manifest = {
        "corpus_id": CORPUS_ID,
        "corpus_version": CORPUS_VERSION,
        "kind": "ANALYSIS_ONLY_NOT_A_TRAINING_RUN",
        "TRAIN_EXAMPLE_COUNT": len(train),
        "VAL_EXAMPLE_COUNT": len(val),
        "train_file": "train.jsonl",
        "val_file": "val.jsonl",
        "train_sha256": train_hash,
        "val_sha256": val_hash,
        "FIRST_TOKEN_CLASSES": crep["FIRST_TOKEN_CLASSES"],
        "FIRST_TOKEN_TRAIN_VAL_OVERLAP": crep["FIRST_TOKEN_TRAIN_VAL_OVERLAP"],
        "CONTINUATION_PATTERNS": list(CONTINUATION_PATTERNS),
        "PROVENANCE": "first-party War Room OS internal continuation curriculum. Analysis freeze only.",
        "PARENT_FIRST_TOKEN_CORPUS": OLD_CORPUS_DIR,
        "PARENT_FIRST_TOKEN_CORPUS_MUTATED": False,
        "CPT2_MUTATED": False,
        "PLM_PROBE_1_MUTATED": False,
    }
    man_blob = json.dumps(manifest, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    manifest_hash = _sha256_bytes(man_blob)
    manifest["manifest_sha256"] = manifest_hash
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    corpus_hash = _sha256_bytes((train_hash + val_hash + manifest_hash).encode("ascii"))
    (root / "CORPUS_HASH.txt").write_text(corpus_hash + "\n", encoding="utf-8")
    (root / "class-report.json").write_text(json.dumps({**crep, "continuation": cstat, "example_overlap": exo}, indent=2) + "\n", encoding="utf-8")
    live_old_after = old.read_text(encoding="utf-8").strip()
    if live_old_after != OLD_CORPUS_HASH:
        return {"ok": False, "reason": "old_corpus_mutated_during_freeze", "live": live_old_after}
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
        "DUPLICATE_SCAN": "PASS",
        "OLD_CORPUS_UNTOUCHED": True,
        "leakage": leak,
        "class_report": crep,
        "example_overlap": exo,
        "continuation": cstat,
        "train": train,
        "val": val,
        "encoded": encoded,
        "manifest": manifest,
    }
