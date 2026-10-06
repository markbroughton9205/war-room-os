"""Read-only corpus/packing audit for WRIM1-RUN-000004 design.

Does not train. Does not mutate corpora. Does not create an optimizer.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import numpy as np
from tokenizers import Tokenizer

from stage1_pack import (
    MIX,
    bucket_for_record,
    encode_behavior_units,
    encode_corpus1_units,
    encode_rehearsal_units,
    is_eval_infra_text,
    is_tool_use,
    load_jsonl,
    text_of,
)
from stage2_pack import MAX_EXCERPT_TOKENS, split_bounded_excerpts
from stage3_runtime import utc_now, write_json

ALICE_MARKERS = ("Alice", "Gryphon", "Mock Turtle", "White Rabbit", "Queen of Hearts")
LAB_MARKERS = ("tokenizer", "model-lab", "-lab", "` - lab", "WR-TOKENIZER")
FENCE_RE = re.compile(r"```")
JSONISH_RE = re.compile(r"^\s*[\{\[]", re.M)
KV_RE = re.compile(r"^[A-Za-z0-9_\-]{2,40}\s*:", re.M)
DIALOGUE_RE = re.compile(r"[“\"][^”\"]{8,}[”\"]")
INSTRUCTION_RE = re.compile(r"\b(Write|Return|Output|Respond|Answer|Continue|Do not|must)\b", re.I)


def ngram_counts(text: str, n: int = 13) -> Counter:
    t = re.sub(r"\s+", " ", text.lower())
    if len(t) < n:
        return Counter()
    return Counter(t[i : i + n] for i in range(0, len(t) - n + 1, max(1, n // 2)))


def repeat_density(text: str) -> float:
    words = re.findall(r"[A-Za-z0-9_\-]+", text.lower())
    if len(words) < 20:
        return 0.0
    grams = [" ".join(words[i : i + 3]) for i in range(len(words) - 2)]
    if not grams:
        return 0.0
    c = Counter(grams)
    top = c.most_common(1)[0][1]
    return float(top / len(grams))


def summarize_texts(rows: list[dict[str, Any]], *, tokenizer: Tokenizer | None = None) -> dict[str, Any]:
    n = len(rows)
    if n == 0:
        return {"n": 0}
    char_lens = [len(r["text"]) for r in rows]
    tok_lens = []
    if tokenizer is not None:
        for r in rows[: min(n, 400)]:
            tok_lens.append(len(tokenizer.encode(r["text"], add_special_tokens=False).ids))
    alice = sum(1 for r in rows if any(m in r["text"] for m in ALICE_MARKERS))
    lab = sum(1 for r in rows if any(m.lower() in r["text"].lower() for m in LAB_MARKERS))
    fences = sum(1 for r in rows if FENCE_RE.search(r["text"]))
    jsonish = sum(1 for r in rows if JSONISH_RE.search(r["text"][:400]))
    kv = sum(1 for r in rows if len(KV_RE.findall(r["text"])) >= 3)
    dialogue = sum(1 for r in rows if len(DIALOGUE_RE.findall(r["text"])) >= 2)
    instruction = sum(1 for r in rows if INSTRUCTION_RE.search(r["text"][:500]))
    backticks = sum(r["text"].count("`") for r in rows)
    long_form = sum(1 for r in rows if len(r["text"]) >= 1200)
    densities = [repeat_density(r["text"]) for r in rows]
    hashes = [hash(re.sub(r"\s+", " ", r["text"].strip().lower())[:400]) for r in rows]
    dup_rate = 1.0 - (len(set(hashes)) / n)
    near = 0
    grams_seen: dict[str, int] = {}
    for r in rows[: min(n, 800)]:
        g = set(list(ngram_counts(r["text"][:800], 13).keys())[:40])
        overlap = sum(1 for x in g if grams_seen.get(x, 0) > 0)
        if g and overlap / max(1, len(g)) >= 0.5:
            near += 1
        for x in g:
            grams_seen[x] = grams_seen.get(x, 0) + 1
    return {
        "n": n,
        "mean_chars": round(sum(char_lens) / n, 1),
        "p50_chars": int(sorted(char_lens)[n // 2]),
        "p90_chars": int(sorted(char_lens)[int(n * 0.9)]),
        "max_chars": max(char_lens),
        "mean_tokens_sample": round(sum(tok_lens) / max(1, len(tok_lens)), 1) if tok_lens else None,
        "p50_tokens_sample": int(sorted(tok_lens)[len(tok_lens) // 2]) if tok_lens else None,
        "alice_docs": alice,
        "alice_rate": round(alice / n, 4),
        "lab_tokenizer_docs": lab,
        "lab_tokenizer_rate": round(lab / n, 4),
        "code_fence_docs": fences,
        "code_fence_rate": round(fences / n, 4),
        "jsonish_docs": jsonish,
        "jsonish_rate": round(jsonish / n, 4),
        "kv_like_docs": kv,
        "dialogue_docs": dialogue,
        "instruction_like_docs": instruction,
        "instruction_like_rate": round(instruction / n, 4),
        "backtick_count": backticks,
        "long_form_ge_1200_chars": long_form,
        "long_form_rate": round(long_form / n, 4),
        "mean_trigram_repeat_density": round(sum(densities) / n, 6),
        "exact_prefix400_dup_rate": round(dup_rate, 4),
        "near_duplicate_sample_rate": round(near / max(1, min(n, 800)), 4),
    }


def load_c0_docs(dump_root: Path, tokenizer: Tokenizer, split: str) -> list[dict[str, Any]]:
    man = json.loads((dump_root / "model-lab" / "manifests" / "wrim0_corpus_shards" / "shard-manifest.json").read_text(encoding="utf-8"))
    npy = np.load(dump_root / "model-lab" / "manifests" / "wrim0_corpus_shards" / ("train.npy" if split == "train" else "val.npy"))
    key = "trainDocs" if split == "train" else "valDocs"
    offset = 0
    out = []
    for doc in man.get(key) or []:
        n = int(doc["tokenCount"])
        ids = [int(x) for x in npy[offset : offset + n].tolist()]
        offset += n
        text = tokenizer.decode(ids, skip_special_tokens=True)
        out.append({"id": str(doc.get("documentId")), "text": text, "n_tokens": n, "n_bos": ids.count(1), "n_eos": ids.count(2)})
    return out


def load_c1(dump_root: Path, split: str) -> list[dict[str, Any]]:
    name = "train" if split == "train" else "validation"
    path = dump_root / "model-lab" / "corpora" / "WR-CORPUS-1-HARDENED" / name / "shard-00000.jsonl"
    rows = []
    for i, rec in enumerate(load_jsonl(path)):
        text = text_of(rec)
        rows.append(
            {
                "id": str(rec.get("chunk_id") or rec.get("id") or i),
                "text": text,
                "bucket": bucket_for_record(rec),
                "kind": rec.get("kind"),
                "format": rec.get("format"),
                "tool_use": is_tool_use(rec),
                "eval_infra": is_eval_infra_text(text, str(rec.get("source_path") or "")),
                "source_path": str(rec.get("source_path") or rec.get("path") or ""),
            }
        )
    return rows


def family_token_inventory(tokenizer: Tokenizer, dump_root: Path) -> dict[str, Any]:
    c1 = encode_corpus1_units(tokenizer, dump_root)
    reh = encode_rehearsal_units(tokenizer, dump_root)
    beh = encode_behavior_units(tokenizer, dump_root)
    inv = {}
    for name, units in {"wr_corpus_0": reh, "prose": c1.get("prose") or [], "code": c1.get("code") or [], "json": c1.get("json") or [], "behavior": beh}.items():
        toks = [int(u.tokens.size) for u in units]
        excerpts = []
        for u in units[:200]:
            excerpts.extend(split_bounded_excerpts(u))
        inv[name] = {
            "n_units": len(units),
            "n_tokens": int(sum(toks)),
            "mean_unit_tokens": round(sum(toks) / max(1, len(toks)), 1),
            "p50_unit_tokens": int(sorted(toks)[len(toks) // 2]) if toks else 0,
            "max_unit_tokens": max(toks) if toks else 0,
            "n_excerpts_sample200": len(excerpts),
            "mean_excerpt_tokens_sample": round(float(np.mean([int(e.tokens.size) for e in excerpts])), 1) if excerpts else 0,
        }
    return inv


def bos_eos_from_c0(docs: list[dict[str, Any]]) -> dict[str, Any]:
    n = len(docs) or 1
    return {
        "mean_bos": round(sum(d["n_bos"] for d in docs) / n, 3),
        "mean_eos": round(sum(d["n_eos"] for d in docs) / n, 3),
        "docs_missing_eos": sum(1 for d in docs if d["n_eos"] == 0),
        "docs_missing_bos": sum(1 for d in docs if d["n_bos"] == 0),
        "mean_tokens": round(sum(d["n_tokens"] for d in docs) / n, 1),
    }


def fragmentation(tokenizer: Tokenizer, samples: list[str]) -> dict[str, Any]:
    ratios = []
    for s in samples[:200]:
        ids = tokenizer.encode(s, add_special_tokens=False).ids
        chars = max(1, len(s))
        ratios.append(len(ids) / chars)
    if not ratios:
        return {"n": 0}
    return {
        "n": len(ratios),
        "mean_tokens_per_char": round(sum(ratios) / len(ratios), 4),
        "p90_tokens_per_char": round(sorted(ratios)[int(len(ratios) * 0.9)], 4),
    }


def run_audit(*, dump_root: Path, tokenizer_path: Path, report_path: Path) -> dict[str, Any]:
    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    c0_train = load_c0_docs(dump_root, tokenizer, "train")
    c0_val = load_c0_docs(dump_root, tokenizer, "val")
    c1_train = load_c1(dump_root, "train")
    c1_val = load_c1(dump_root, "validation")
    c1_clean = [r for r in c1_train if not r["tool_use"] and not r["eval_infra"]]
    by_bucket = defaultdict(list)
    for r in c1_clean:
        by_bucket[r["bucket"]].append(r)
    beh_path = dump_root / "model-lab" / "manifests" / "wave8_1" / "behavior-examples.json"
    behavior_n = 0
    behavior_tokens = 0
    if beh_path.exists():
        examples = json.loads(beh_path.read_text(encoding="utf-8")).get("examples") or []
        behavior_n = len(examples)
        for ex in examples:
            t = ex.get("renderedTrainingText") or ""
            behavior_tokens += len(tokenizer.encode(t, add_special_tokens=False).ids)

    inv = family_token_inventory(tokenizer, dump_root)
    # Simulate 25-step NATURAL mix vs proposed mix availability
    needed = 25 * 8 * 512
    locked_need = {k: int(needed * v) for k, v in MIX.items()}
    available = {k: inv[k]["n_tokens"] for k in inv}

    payload = {
        "ok": True,
        "kind": "STAGE3A_CORRECTIVE_CORPUS_AUDIT",
        "created_at": utc_now(),
        "optimizer_steps_this_pass": 0,
        "TRAINING_AUTHORIZATION": "OFF",
        "corpus_mutated": False,
        "locked_stage3_mix": MIX,
        "max_excerpt_tokens_current": MAX_EXCERPT_TOKENS,
        "seq_len": 512,
        "tokens_per_step": 4096,
        "inventory": inv,
        "available_vs_25step_locked_need": {"needed_tokens": needed, "locked_need": locked_need, "available": available},
        "wr_corpus_0_train": {**summarize_texts(c0_train, tokenizer=tokenizer), **bos_eos_from_c0(c0_train)},
        "wr_corpus_0_val": summarize_texts(c0_val, tokenizer=tokenizer),
        "wr_corpus_1_train": summarize_texts(c1_clean, tokenizer=tokenizer),
        "wr_corpus_1_train_by_bucket": {k: summarize_texts(v, tokenizer=tokenizer) for k, v in by_bucket.items()},
        "wr_corpus_1_validation": summarize_texts(c1_val, tokenizer=tokenizer),
        "behavior_examples": {"n": behavior_n, "approx_tokens": behavior_tokens},
        "fragmentation_c1_sample": fragmentation(tokenizer, [r["text"][:800] for r in c1_clean[:200]]),
        "eval_suites_excluded": [
            "CAP-EVAL-0",
            "WRIM-EVAL-S3-000001",
            "WRIM-EVAL-S3A-RET-000001",
            "WRIM-EVAL-S3A-STRUCT-000001",
            "WRIM-EVAL-S3A-ADJ-000001",
        ],
        "pipeline_risks": {
            "excerpt_cap_1024_cuts_long_form": True,
            "deficit_interleave_stitches_families_inside_512_windows": True,
            "alice_rehearsal_share_locked": MIX["wr_corpus_0"],
            "behavior_share_locked": MIX["behavior"],
            "json_share_locked": MIX["json"],
            "ce_loss_only": True,
            "no_unlikelihood_currently": True,
        },
        "note": "Measurement only. Corpora not mutated. Eval suites not used for training.",
    }
    write_json(report_path, payload)
    print(json.dumps({"ok": True, "report": str(report_path), "c0_alice_rate": payload["wr_corpus_0_train"].get("alice_rate"), "c1_buckets": {k: v.get("n") for k, v in payload["wr_corpus_1_train_by_bucket"].items()}, "inventory_tokens": available, "behavior_n": behavior_n}, indent=2), flush=True)
    return payload


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--dump-root", required=True)
    p.add_argument("--tokenizer", required=True)
    p.add_argument("--report", required=True)
    args = p.parse_args()
    try:
        out = run_audit(dump_root=Path(args.dump_root), tokenizer_path=Path(args.tokenizer), report_path=Path(args.report))
        return 0 if out.get("ok") else 1
    except Exception as exc:
        Path(args.report).parent.mkdir(parents=True, exist_ok=True)
        write_json(Path(args.report), {"ok": False, "kind": "STAGE3A_CORRECTIVE_CORPUS_AUDIT_BLOCKED", "error": str(exc), "TRAINING_AUTHORIZATION": "OFF"})
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2), flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
