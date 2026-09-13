"""Phase 0 controlled-stability audit. Inference only. ZERO optimizer steps.

Maps CAP-EVAL-0 retention items onto WR-CORPUS-0 genesis documents, audits
held-out-span excision, runs a 13-gram leakage scan, freezes WRIM-0 reference
NLL, and records STAB-000001 scorer + validation-set truth.

TRAINING_AUTHORIZATION=OFF. Do not train. Do not print CLEAR TO RUN.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn.functional as F
from tokenizers import Tokenizer

from safetensors_model import load_model_state_from_safetensors
from stage2_eval import (
    EVAL_SEED,
    GEN_TOKENS,
    SPECIAL_IDS,
    greedy_generate,
    load_retention_items,
    score_retention,
)
from wrim_g20m import VOCAB_SIZE, WRIM0Model, expected_torch_keys

PARENT_SHA = "d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015"
TOKENIZER_SHA = "47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7"
ALICE_STAB000001_DOC = "bdbb17d6-5e32-4672-980f-7cdb68d0ab5a"
NGRAM = 13
HISTORICAL_GEN_TOKENS = 32
HIGHRES_GEN_TOKENS = 256
STAB000001_ALICE_REHEARSAL_SHARE = 0.865

INSTRUCTION_PREFIXES = [
    "Continue literary English: ",
    "Continue this period-neutral prose: ",
    "Continue: ",
    "In complete sentences, ",
    "Write four coherent sentences of ordinary narrative about ",
]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, indent=2)
    path.write_text(text, encoding="utf-8")


def disable_tf32() -> None:
    if torch.cuda.is_available():
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        torch.backends.cudnn.benchmark = False
    if hasattr(torch, "set_float32_matmul_precision"):
        torch.set_float32_matmul_precision("highest")


def literary_stem(prompt: str) -> str:
    text = prompt
    for p in sorted(INSTRUCTION_PREFIXES, key=len, reverse=True):
        if text.startswith(p):
            text = text[len(p) :]
            break
    return text.strip()


def char_ngrams(text: str, n: int = NGRAM) -> list[str]:
    if len(text) < n:
        return [text] if text else []
    return [text[i : i + n] for i in range(len(text) - n + 1)]


def token_ngrams(ids: list[int], n: int = NGRAM) -> list[tuple[int, ...]]:
    if len(ids) < n:
        return [tuple(ids)] if ids else []
    return [tuple(ids[i : i + n]) for i in range(len(ids) - n + 1)]


def longest_substring_in(haystack: str, needle: str) -> dict[str, Any]:
    if not needle:
        return {"found_exact": False, "longest": 0, "offset": None}
    if needle in haystack:
        return {"found_exact": True, "longest": len(needle), "offset": haystack.find(needle)}
    best = 0
    off = None
    # longest prefix/suffix / window search for distinctive stems (bounded)
    max_n = min(len(needle), len(haystack), 240)
    for n in range(max_n, 11, -1):
        for i in range(0, len(needle) - n + 1):
            frag = needle[i : i + n]
            pos = haystack.find(frag)
            if pos >= 0:
                return {"found_exact": False, "longest": n, "offset": pos, "fragment": frag}
    return {"found_exact": False, "longest": best, "offset": off}


def ngram_coverage(haystack: str, needle: str, n: int = NGRAM) -> dict[str, Any]:
    grams = char_ngrams(needle, n)
    if not grams:
        return {"n": n, "stem_ngrams": 0, "hits": 0, "hit_ratio": 0.0, "blocking_contiguous": False}
    hay_set = set(char_ngrams(haystack, n)) if len(haystack) >= n else set()
    hits = [g in hay_set or g in haystack for g in grams]
    n_hits = int(sum(hits))
    # contiguous run of matching 13-grams covering most of the stem => span present
    run = 0
    max_run = 0
    for h in hits:
        run = run + 1 if h else 0
        max_run = max(max_run, run)
    covered_chars = max_run + n - 1 if max_run else 0
    blocking = bool(needle) and (needle in haystack or (len(needle) >= n and covered_chars / max(1, len(needle)) >= 0.80))
    return {
        "n": n,
        "stem_ngrams": len(grams),
        "hits": n_hits,
        "hit_ratio": round(n_hits / max(1, len(grams)), 6),
        "max_contiguous_ngram_run": max_run,
        "approx_covered_chars": covered_chars,
        "blocking_contiguous": blocking,
    }


def classify_excerpt(text: str) -> str:
    low = text.lower()
    if any(w in low for w in ("alice", "gryphon", "queen of hearts", "hatter", "white rabbit", "mock turtle")):
        return "literary_alice_like"
    if "```" in text or "function " in low or "def " in low[:400]:
        return "code_or_markdown"
    if any(w in low for w in (" said", "chapter", "once ", "the ")):
        return "prose_like"
    return "other"


def load_split_docs(dump_root: Path, tokenizer: Tokenizer, split: str) -> list[dict[str, Any]]:
    man = json.loads((dump_root / "model-lab" / "manifests" / "wrim0_corpus_shards" / "shard-manifest.json").read_text(encoding="utf-8"))
    npy_name = "train.npy" if split == "train" else "val.npy"
    npy = np.load(dump_root / "model-lab" / "manifests" / "wrim0_corpus_shards" / npy_name)
    key = "trainDocs" if split == "train" else "valDocs"
    offset = 0
    out = []
    for doc in man.get(key) or []:
        n = int(doc["tokenCount"])
        ids = [int(x) for x in npy[offset : offset + n].tolist()]
        offset += n
        decoded = tokenizer.decode(ids, skip_special_tokens=True)
        out.append(
            {
                "documentId": str(doc.get("documentId")),
                "split": split,
                "tokenCount": n,
                "ids": ids,
                "text": decoded,
                "coarse_class": classify_excerpt(decoded[:4000]),
            }
        )
    return out


def encode_prompt_ids(tokenizer: Tokenizer, prompt: str) -> list[int]:
    bos = tokenizer.token_to_id("<|bos|>")
    body = tokenizer.encode(prompt, add_special_tokens=False).ids
    return [int(bos), *body]


def teacher_force_nll(model: WRIM0Model, prompt_ids: list[int], target_ids: list[int], device: torch.device) -> dict[str, float]:
    ids = prompt_ids + target_ids
    if len(ids) < 2 or not target_ids:
        return {"nll": float("nan"), "mean_token_prob": float("nan"), "mean_entropy_tf": float("nan")}
    x = torch.tensor([ids[:-1]], dtype=torch.long, device=device)
    model.eval()
    with torch.inference_mode():
        logits = model(x)[0]
        start = len(prompt_ids) - 1
        tlogits = logits[start : start + len(target_ids)].float()
        logp = F.log_softmax(tlogits, dim=-1)
        idx = torch.arange(len(target_ids), device=device)
        tgt = torch.tensor(target_ids, dtype=torch.long, device=device)
        tok_nll = -logp[idx, tgt]
        probs = torch.exp(-tok_nll)
        ents = []
        for i in range(tlogits.size(0)):
            p = torch.softmax(tlogits[i], dim=-1)
            ents.append(float(-(p * torch.log(p.clamp_min(1e-12))).sum().item()))
    special_rate = float(sum(1 for t in target_ids if t in SPECIAL_IDS) / max(1, len(target_ids)))
    return {
        "nll": float(tok_nll.mean().item()),
        "mean_token_prob": float(probs.mean().item()),
        "mean_entropy_tf": float(sum(ents) / len(ents)),
        "special_token_rate_0_8": special_rate,
    }


def map_item_to_docs(stem: str, stem_ids: list[int], docs: list[dict[str, Any]]) -> dict[str, Any]:
    ranked = []
    for d in docs:
        sub = longest_substring_in(d["text"], stem)
        cov = ngram_coverage(d["text"], stem, NGRAM)
        tok_set = set(token_ngrams(d["ids"], NGRAM))
        stem_toks = token_ngrams(stem_ids, NGRAM)
        tok_hits = int(sum(1 for g in stem_toks if g in tok_set)) if stem_toks else 0
        ranked.append(
            {
                "documentId": d["documentId"],
                "split": d["split"],
                "coarse_class": d["coarse_class"],
                "tokenCount": d["tokenCount"],
                "exact_stem": sub["found_exact"],
                "longest_substring": sub["longest"],
                "substring_offset": sub.get("offset"),
                "char13": cov,
                "token13_hits": tok_hits,
                "token13_total": len(stem_toks),
                "token13_hit_ratio": round(tok_hits / max(1, len(stem_toks)), 6),
            }
        )
    ranked.sort(key=lambda r: (r["exact_stem"], r["char13"]["blocking_contiguous"], r["longest_substring"], r["token13_hits"]), reverse=True)
    evidenced = [
        r for r in ranked
        if r["exact_stem"] or r["char13"]["blocking_contiguous"] or int(r["longest_substring"] or 0) >= 20 or float(r["token13_hit_ratio"] or 0) > 0
    ]
    best = evidenced[0] if evidenced else None
    return {"best": best, "all": ranked, "mapping_status": "MAPPED" if best is not None else "UNMAPPED_NO_STEM_OVERLAP"}


def stab000001_val_truth() -> dict[str, Any]:
    return {
        "run_id": "WRIM1-NEBULA-STAB-000001",
        "val_loss_definition": "SINGLE_MIXED_SCALAR",
        "implementation": "scripts/wrim-environment/stage2_pack.py encode_rehearsal_val_units + encode_corpus1_val_units, expand_family, take_until_budget(32768), then _pack_selected deficit-interleave",
        "sources_mixed": ["WR-CORPUS-0 val.npy / valDocs", "WR-CORPUS-1-HARDENED validation/shard-00000.jsonl"],
        "separated_val_loss_corpus0": False,
        "separated_val_loss_corpus1": False,
        "future_required_split": {
            "val_loss_corpus0": "contiguous packed windows from WR-CORPUS-0 val.npy only; same wrap BOS/EOS; no WR-CORPUS-1 tokens",
            "val_loss_corpus1": "contiguous packed windows from WR-CORPUS-1-HARDENED validation shard only after TOOL_USE + eval-infra exclusion; no WR-CORPUS-0 tokens",
            "do_not_report_only_the_mixed_scalar": True,
        },
        "note": "STAB-000001 validation loss cannot isolate genesis forgetting from WR-CORPUS-1 fit.",
    }


def historical_scorer_truth() -> dict[str, Any]:
    return {
        "stab000001_scorer": {
            "file": "scripts/wrim-environment/stage2_eval.py",
            "functions": ["greedy_generate", "score_retention"],
            "decoding_mode": "greedy_argmax",
            "sampling": False,
            "temperature": None,
            "eval_seed_logged": EVAL_SEED,
            "eval_seed_effect": "logged only; greedy argmax is deterministic given weights and FP32 math",
            "continuation_length_tokens": HISTORICAL_GEN_TOKENS,
            "GEN_TOKENS_constant": GEN_TOKENS,
            "unique_ratio_definition": "len(set(new_token_ids)) / len(new_token_ids)  [TOKEN ids, not words]",
            "threshold": {"min_unique_ratio": 0.35, "forbid_single_punct": True, "forbid_collapsed": True},
            "collapsed_rule": "max consecutive identical token run >= max(6, n_new // 3)",
            "single_punct_rule": "all generated token ids == PERIOD_ID (20)",
            "special_tokens": {
                "ids_0_through_8": "tracked for special_loop (>=4 identical special ids in a row) on DIAGNOSTIC-0; not part of retention pass/fail except via unique_ratio/collapse",
                "eos_stops_generation": True,
                "decode_skip_special_tokens": True,
            },
            "binary_pass": "unique_ratio >= 0.35 AND not collapsed AND not single_punct",
        },
        "original_cap_eval_0_scorer": {
            "file": "scripts/wrim1-training/capability_curriculum_lib.py",
            "function": "score_output language-diagnostics",
            "generation": "scripts/wrim1-training/run_wrim0_cap_eval_baseline.py generate() greedy 64 tokens, mlx seed 0",
            "unique_ratio_definition": "whitespace-split WORD unique ratio of decoded continuation",
            "extra_gates": "not collapsed punctuation blob; len(stripped) >= 20",
            "not_used_by_STAB000001": True,
        },
        "continuity_rule": "Keep historical 32-token token-id scorer for STAB-000001 comparability. Future higher-resolution scorer uses >=256 generated tokens under pinned greedy decode. Do not replace the 32-token scorer until Commander reviews Phase 0.",
        "phase1_harness": "NOT RUN. Historical scorer is greedy, so Phase 1 would repeat frozen WRIM-0 eval 10 times and require identical token ids. Authorization for Phase 1 is not this pass.",
    }


def validate_experiment(report: dict[str, Any]) -> None:
    """Hard assertions. Raises AssertionError on Phase 0 failure."""
    assert report.get("optimizer_steps") == 0, "optimizer_steps must be 0"
    assert report.get("CLEAR_TO_RUN") is not True, "CLEAR_TO_RUN must not be true in Phase 0"
    assert report.get("training_authorization") == "OFF"
    assert report.get("stage3_started") is False
    assert report.get("promotion_candidate") is False
    hashes = report.get("artifact_sha_verification") or {}
    assert hashes.get("parent_match") is True, "WRIM-0 hash mismatch"
    assert hashes.get("tokenizer_match") is True, "tokenizer hash mismatch"
    leak = report.get("leakage_audit") or {}
    assert leak.get("blocking_failure") is False, "Phase 0 leakage failure is BLOCKING"
    assert (report.get("reference_nll") or {}).get("frozen") is True
    assert (report.get("cap0_ret_02") or {}).get("evalId") == "cap0-ret-02"
    grid = Path(__file__).with_name("experiment_grid.py").read_text(encoding="utf-8")
    assert "TRAINING_AUTHORIZATION=OFF" in grid
    assert "SUPERSEDED" in grid


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--dump-root", required=True)
    ap.add_argument("--report", required=True)
    args = ap.parse_args()

    weights = Path(args.weights)
    tokenizer_path = Path(args.tokenizer)
    dump_root = Path(args.dump_root)
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)

    optimizer_steps = 0
    parent_mtime = weights.stat().st_mtime_ns
    parent_sha = sha256_file(weights)
    tok_sha = sha256_file(tokenizer_path)
    hashes = {
        "parent_path": str(weights),
        "parent_sha256": parent_sha,
        "parent_expected": PARENT_SHA,
        "parent_match": parent_sha == PARENT_SHA,
        "tokenizer_path": str(tokenizer_path),
        "tokenizer_sha256": tok_sha,
        "tokenizer_expected": TOKENIZER_SHA,
        "tokenizer_match": tok_sha == TOKENIZER_SHA,
    }
    if not hashes["parent_match"] or not hashes["tokenizer_match"]:
        payload = {
            "ok": False,
            "phase": 0,
            "error": "HASH_MISMATCH",
            "artifact_sha_verification": hashes,
            "optimizer_steps": 0,
            "CLEAR_TO_RUN": False,
            "training_authorization": "OFF",
        }
        write_json(report_path, payload)
        print(json.dumps(payload, indent=2))
        return 2

    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    items = load_retention_items(dump_root)
    train_docs = load_split_docs(dump_root, tokenizer, "train")
    val_docs = load_split_docs(dump_root, tokenizer, "val")
    all_docs = train_docs + val_docs

    # WR-CORPUS-1 train texts for prompt leakage (not genesis mapping)
    c1_path = dump_root / "model-lab" / "corpora" / "WR-CORPUS-1-HARDENED" / "train" / "shard-00000.jsonl"
    c1_blobs = []
    with c1_path.open("r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            rec = json.loads(line)
            text = rec.get("text") or rec.get("content") or ""
            if isinstance(text, str) and text:
                c1_blobs.append(text)

    mappings = []
    blocking_leaks = []
    for it in items:
        prompt = it.get("generation_prompt") or it["prompt"]
        stem = literary_stem(prompt)
        stem_ids = tokenizer.encode(stem, add_special_tokens=False).ids
        mapped = map_item_to_docs(stem, stem_ids, all_docs)
        train_hits = [r for r in mapped["all"] if r["split"] == "train" and (r["exact_stem"] or r["char13"]["blocking_contiguous"])]
        val_hits = [r for r in mapped["all"] if r["split"] == "val" and (r["exact_stem"] or r["char13"]["blocking_contiguous"])]
        c1_exact = [i for i, blob in enumerate(c1_blobs) if stem and stem in blob][:5]
        leak = {
            "evalId": it.get("evalId"),
            "prompt": prompt,
            "literary_stem": stem,
            "stem_n_chars": len(stem),
            "stem_n_tokens": len(stem_ids),
            "mapped_source_document": None if mapped["best"] is None else mapped["best"]["documentId"],
            "mapped_source_split": None if mapped["best"] is None else mapped["best"]["split"],
            "mapped_source_class": None if mapped["best"] is None else mapped["best"]["coarse_class"],
            "mapping_status": mapped["mapping_status"],
            "exact_stem_in_best": False if mapped["best"] is None else mapped["best"]["exact_stem"],
            "best_longest_substring": None if mapped["best"] is None else mapped["best"]["longest_substring"],
            "best_char13": None if mapped["best"] is None else mapped["best"]["char13"],
            "train_blocking_docs": [r["documentId"] for r in train_hits],
            "val_blocking_docs": [r["documentId"] for r in val_hits],
            "wr_corpus_1_train_exact_stem_rows": c1_exact,
            "designed_held_out_span_excised": False,
            "ranking": mapped["all"],
        }
        if train_hits or c1_exact:
            blocking_leaks.append({"evalId": it.get("evalId"), "train_docs": leak["train_blocking_docs"], "c1_rows": c1_exact})
        mappings.append(leak)

    cap02 = next(m for m in mappings if m["evalId"] == "cap0-ret-02")
    alice_doc = next((d for d in train_docs if d["documentId"] == ALICE_STAB000001_DOC), None)
    cap02_is_alice_doc = cap02["mapped_source_document"] == ALICE_STAB000001_DOC and bool(cap02["exact_stem_in_best"] or (cap02.get("best_char13") or {}).get("blocking_contiguous"))

    # Frozen WRIM-0 reference NLL (inference only)
    disable_tf32()
    if not torch.cuda.is_available():
        payload = {"ok": False, "error": "CUDA required for WRIM-0 NLL freeze", "optimizer_steps": 0, "CLEAR_TO_RUN": False}
        write_json(report_path, payload)
        print(json.dumps(payload, indent=2))
        return 2
    device = torch.device("cuda")
    raw, _hdr = load_model_state_from_safetensors(weights)
    model = WRIM0Model()
    missing = [k for k in expected_torch_keys() if k not in raw]
    if missing:
        raise RuntimeError(f"parent missing keys {missing[:8]}")
    model.load_state_dict(raw, strict=True)
    model = model.to(device)
    model.freeze_inference()
    # Explicit: no optimizer object exists in this process.
    assert optimizer_steps == 0
    assert not any(p.requires_grad for p in model.parameters())

    torch.manual_seed(EVAL_SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(EVAL_SEED)

    nll_items = []
    for it in items:
        prompt = it.get("generation_prompt") or it["prompt"]
        prompt_ids = encode_prompt_ids(tokenizer, prompt)
        gen32 = greedy_generate(model, tokenizer, prompt, device, max_new=HISTORICAL_GEN_TOKENS)
        gen256 = greedy_generate(model, tokenizer, prompt, device, max_new=HIGHRES_GEN_TOKENS)
        nll32 = teacher_force_nll(model, prompt_ids, list(gen32["new_ids"]), device)
        nll256 = teacher_force_nll(model, prompt_ids, list(gen256["new_ids"]), device)
        binary = score_retention(gen32, it.get("expected") or {})
        # continuation 13-gram vs train (report; blocking only if long contiguous stem-like regurgitation of the prompt's mapped doc AND exact generated 40+ char span in train)
        cont = gen32.get("continuation") or ""
        cont_block = []
        for d in train_docs:
            if cont and len(cont) >= 40 and cont in d["text"]:
                cont_block.append(d["documentId"])
        nll_items.append(
            {
                "evalId": it.get("evalId"),
                "prompt": prompt,
                "nll_32": nll32["nll"],
                "mean_token_prob_32": nll32["mean_token_prob"],
                "entropy_tf_32": nll32["mean_entropy_tf"],
                "special_token_rate_0_8_32": nll32["special_token_rate_0_8"],
                "unique_ratio_32": gen32.get("unique_ratio"),
                "max_run_32": gen32.get("max_run"),
                "entropy_first_32": gen32.get("entropy"),
                "continuation_fingerprint_32": hashlib.sha256(cont.encode("utf-8")).hexdigest(),
                "new_ids_32": list(gen32["new_ids"]),
                "binary_historical_pass_32": binary,
                "nll_256": nll256["nll"],
                "continuation_fingerprint_256": hashlib.sha256((gen256.get("continuation") or "").encode("utf-8")).hexdigest(),
                "n_new_256": gen256.get("n_new"),
                "unique_ratio_256": gen256.get("unique_ratio"),
                "verbatim_32_continuation_in_train_docs": cont_block,
            }
        )
        if cont_block:
            blocking_leaks.append({"evalId": it.get("evalId"), "reason": "WRIM-0 32-token continuation verbatim in WR-CORPUS-0 train", "docs": cont_block})

    nll_artifact = {
        "kind": "WRIM-0_REFERENCE_NLL_FROZEN",
        "parent_sha256": parent_sha,
        "tokenizer_sha256": tok_sha,
        "eval_seed": EVAL_SEED,
        "decoding": "greedy_argmax",
        "historical_gen_tokens": HISTORICAL_GEN_TOKENS,
        "highres_gen_tokens": HIGHRES_GEN_TOKENS,
        "dtype": "FP32",
        "tf32": False,
        "items": nll_items,
        "optimizer_steps": 0,
    }
    nll_path = report_path.with_name("wrim0-reference-nll.json")
    nll_text = json.dumps(nll_artifact, indent=2)
    nll_path.write_text(nll_text, encoding="utf-8")
    nll_sha = sha256_bytes(nll_text.encode("utf-8"))

    shard_man = json.loads((dump_root / "model-lab" / "manifests" / "wrim0_corpus_shards" / "shard-manifest.json").read_text(encoding="utf-8"))
    excision = {
        "method": "WHOLE_DOCUMENT_SPLIT_NOT_SPAN_EXCISION",
        "implementation": "scripts/sovereign-model-lab/prepare_wrim0_shards.py",
        "rule": "documents sorted by documentId; first round(n_docs * 0.05) documents are VAL; remainder TRAIN",
        "trainDocumentCount": shard_man.get("trainDocumentCount"),
        "valDocumentCount": shard_man.get("valDocumentCount"),
        "trainDocs": [d["documentId"] for d in train_docs],
        "valDocs": [d["documentId"] for d in val_docs],
        "cap_eval_0_construction": "scripts/wrim1-training/capability_curriculum_lib.py authored synthetic EVAL-RETENTION prompts; generation_prompt == prompt; not sliced from genesis documents",
        "designed_held_out_continuation_spans": "NONE",
        "implication": "There is no excised gold continuation for the 6 retention items. Leakage is prompt-stem / 13-gram presence in train/rehearsal, not a missing span cut.",
    }

    leakage_blocking = bool(blocking_leaks)
    report = {
        "ok": not leakage_blocking and hashes["parent_match"] and hashes["tokenizer_match"],
        "phase": 0,
        "phase0_status": "COMPLETE_PENDING_COMMANDER_REVIEW" if not leakage_blocking else "BLOCKED_LEAKAGE",
        "CLEAR_TO_RUN": False,
        "training_authorization": "OFF",
        "optimizer_steps": 0,
        "optimizer_constructed": False,
        "stage3_started": False,
        "promotion_candidate": False,
        "interpolation_executed": False,
        "grid_executed_this_pass": False,
        "unauthorized_prior_grid_note": (
            "Two SUPERSEDED accum=4 SKEWED_BASELINE__3e-5 runs (seeds 1337, 7331) completed before Commander STOP. "
            "They are not Phase 0 science, not a promotion candidate, and do not authorize Stage 3. "
            "Remaining grid processes were killed. gradient_accumulation=4 is not the comparability baseline."
        ),
        "artifact_sha_verification": hashes,
        "retention_item_source_map": mappings,
        "cap0_ret_02": {
            "evalId": "cap0-ret-02",
            "prompt": cap02["prompt"],
            "literary_stem": cap02["literary_stem"],
            "mapped_source_document": cap02["mapped_source_document"],
            "mapped_source_split": cap02["mapped_source_split"],
            "mapped_source_class": cap02["mapped_source_class"],
            "mapping_status": cap02["mapping_status"],
            "exact_stem_in_mapped_doc": cap02["exact_stem_in_best"],
            "is_alice_like_stab000001_majority_doc": cap02_is_alice_doc,
            "stab000001_alice_majority_documentId": ALICE_STAB000001_DOC,
            "stab000001_alice_share_of_trained_rehearsal": STAB000001_ALICE_REHEARSAL_SHARE,
            "alice_doc_class": None if alice_doc is None else alice_doc["coarse_class"],
            "alice_doc_tokens": None if alice_doc is None else alice_doc["tokenCount"],
            "conclusion": (
                "cap0-ret-02 IS the Alice-like majority rehearsal document"
                if cap02_is_alice_doc
                else "cap0-ret-02 is NOT identified as the Alice-like document that supplied ~86.5% of STAB-000001 rehearsal tokens"
            ),
        },
        "held_out_span_excision": excision,
        "leakage_audit": {
            "n_gram": NGRAM,
            "blocking_failure": leakage_blocking,
            "blocking_events": blocking_leaks,
            "rule": (
                "BLOCK if a retention literary stem is an exact substring of WR-CORPUS-0 train or WR-CORPUS-1 train, "
                "or if 13-gram coverage implies the stem is present (>=80% contiguous 13-grams), "
                "or if the frozen WRIM-0 32-token continuation is a verbatim 40+ character span in WR-CORPUS-0 train."
            ),
        },
        "validation_set_truth": stab000001_val_truth(),
        "historical_scorer_truth": historical_scorer_truth(),
        "reference_nll": {
            "frozen": True,
            "path": str(nll_path),
            "sha256": nll_sha,
            "n_items": len(nll_items),
            "mean_nll_32": float(sum(x["nll_32"] for x in nll_items) / len(nll_items)),
            "binary_historical_32": f"{sum(1 for x in nll_items if x['binary_historical_pass_32'])}/6",
        },
        "genesis_train_docs": [{"documentId": d["documentId"], "tokenCount": d["tokenCount"], "coarse_class": d["coarse_class"]} for d in train_docs],
        "genesis_val_docs": [{"documentId": d["documentId"], "tokenCount": d["tokenCount"], "coarse_class": d["coarse_class"]} for d in val_docs],
        "parent_unmodified": weights.stat().st_mtime_ns == parent_mtime,
        "CURRENT_PRODUCTION_WRIM": "NOT_IMPLEMENTED",
        "RAEL": "NOT_IMPLEMENTED",
        "QWEN": "THIRD_PARTY_MODEL_RUNNING_LOCALLY",
        "READY_FOR_STAGE3_TRAINING_AUTHORIZATION": "NO",
        "utc": datetime.now(timezone.utc).isoformat(),
    }
    try:
        validate_experiment(report)
        report["validate_experiment"] = {"passed": True}
    except AssertionError as exc:
        report["ok"] = False
        report["validate_experiment"] = {"passed": False, "error": str(exc)}
        write_json(report_path, report)
        print(json.dumps({"ok": False, "validate_experiment": str(exc), "CLEAR_TO_RUN": False, "optimizer_steps": 0}, indent=2))
        return 4

    write_json(report_path, report)
    summary = {
        "ok": report["ok"],
        "phase": 0,
        "CLEAR_TO_RUN": False,
        "optimizer_steps": 0,
        "leakage_blocking": leakage_blocking,
        "cap0_ret_02_source": cap02["mapped_source_document"],
        "cap0_ret_02_is_alice_majority_doc": cap02_is_alice_doc,
        "reference_nll_sha256": nll_sha,
        "parent_match": True,
        "tokenizer_match": True,
        "report": str(report_path),
    }
    print(json.dumps(summary, indent=2))
    return 0 if report["ok"] else 5


if __name__ == "__main__":
    sys.exit(main())
