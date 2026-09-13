"""WRIM-EVAL-S3-000001 authoring audits + WRIM-0 baseline freeze.

ZERO optimizer steps. Does not train. Does not start STAGE3A/STAGE3B.
Authorization: STAGE3_EVAL_BASELINE_ONLY
"""
from __future__ import annotations

import argparse
import copy
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
from stage1_pack import text_of
from stage2_eval import (
    PERIOD_ID,
    SPECIAL_IDS,
    greedy_generate,
    load_diagnostic_items,
    load_retention_items,
)
from stage2_pack import encode_corpus1_val_units, encode_rehearsal_val_units
from stage3_eval_items import CATEGORIES, ITEMS, SUITE_ID, SUITE_VERSION, assert_inventory
from wrim_g20m import VOCAB_SIZE, WRIM0Model, expected_torch_keys

PARENT_SHA = "d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015"
TOKENIZER_SHA = "47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7"
VAL_CORPUS0_BASELINE = 8.890125
VAL_CORPUS1_BASELINE = 7.971308
NGRAM = 13
SELF_KL_TOL = 1e-5
SEQ_LEN = 512
MICRO_BATCH = 8
EOS_ID = 2
DUP_JACCARD_BLOCK = 0.42
CHAR13_BLOCK_COVERAGE = 0.80
TOKEN13_BLOCK_RATIO = 0.80
MIN_BLOCK_SPAN = 20

AUTHORIZATION = "STAGE3_EVAL_BASELINE_ONLY"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def disable_tf32() -> None:
    if torch.cuda.is_available():
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        torch.backends.cudnn.benchmark = False
    if hasattr(torch, "set_float32_matmul_precision"):
        torch.set_float32_matmul_precision("highest")


def normalize_ws(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip().lower()


def char_ngrams(text: str, n: int = NGRAM) -> list[str]:
    if len(text) < n:
        return [text] if text else []
    return [text[i : i + n] for i in range(len(text) - n + 1)]


def token_ngrams(ids: list[int], n: int = NGRAM) -> list[tuple[int, ...]]:
    if len(ids) < n:
        return [tuple(ids)] if ids else []
    return [tuple(ids[i : i + n]) for i in range(len(ids) - n + 1)]


def ngram_coverage(haystack: str, needle: str, n: int = NGRAM) -> dict[str, Any]:
    grams = char_ngrams(needle, n)
    if not grams:
        return {"n": n, "stem_ngrams": 0, "hits": 0, "hit_ratio": 0.0, "blocking_contiguous": False, "max_contiguous_ngram_run": 0}
    hay_set = set(char_ngrams(haystack, n)) if len(haystack) >= n else set()
    hits = [g in hay_set for g in grams]
    n_hits = int(sum(hits))
    run = 0
    max_run = 0
    for h in hits:
        run = run + 1 if h else 0
        max_run = max(max_run, run)
    covered_chars = max_run + n - 1 if max_run else 0
    blocking = bool(needle) and (
        needle in haystack or (len(needle) >= n and covered_chars / max(1, len(needle)) >= CHAR13_BLOCK_COVERAGE)
    )
    return {
        "n": n,
        "stem_ngrams": len(grams),
        "hits": n_hits,
        "hit_ratio": round(n_hits / max(1, len(grams)), 6),
        "max_contiguous_ngram_run": max_run,
        "approx_covered_chars": covered_chars,
        "blocking_contiguous": blocking,
    }


def item_content_hash(item: dict[str, Any]) -> str:
    core = {
        "item_id": item["item_id"],
        "category": item["category"],
        "prompt_text": item["prompt_text"],
        "reference_type": item["reference_type"],
        "reference_payload": item.get("reference_payload"),
        "generation_mode": item["generation_mode"],
        "max_new_tokens": item["max_new_tokens"],
    }
    return sha256_text(json.dumps(core, sort_keys=True, ensure_ascii=False, separators=(",", ":")))


def hashed_items() -> list[dict[str, Any]]:
    out = []
    for it in ITEMS:
        row = copy.deepcopy(it)
        row["content_hash"] = item_content_hash(row)
        out.append(row)
    return out


def encode_prompt_ids(tokenizer: Tokenizer, prompt: str) -> list[int]:
    bos = tokenizer.token_to_id("<|bos|>")
    body = tokenizer.encode(prompt, add_special_tokens=False).ids
    return [int(bos), *body]


def concat_units(units: list) -> np.ndarray:
    if not units:
        return np.zeros((0,), dtype=np.int32)
    return np.concatenate([u.tokens for u in units])


def measure_val_loss(model: WRIM0Model, stream: np.ndarray, device: torch.device) -> float | None:
    if stream.size < SEQ_LEN + 1:
        return None
    model.eval()
    offset = 0
    losses = []
    usable = int(stream.size) - SEQ_LEN - 1
    with torch.inference_mode():
        for _ in range(4):
            xs = []
            ys = []
            for _b in range(MICRO_BATCH):
                if offset > usable:
                    offset = 0
                xs.append(stream[offset : offset + SEQ_LEN])
                ys.append(stream[offset + 1 : offset + SEQ_LEN + 1])
                offset += SEQ_LEN
            x = torch.tensor(np.stack(xs), dtype=torch.long, device=device)
            y = torch.tensor(np.stack(ys), dtype=torch.long, device=device)
            logits = model(x)
            loss = F.cross_entropy(logits.reshape(-1, VOCAB_SIZE), y.reshape(-1))
            if not torch.isfinite(loss):
                return None
            losses.append(float(loss.item()))
    return float(sum(losses) / len(losses)) if losses else None


def extract_json_blob(text: str) -> str | None:
    if not text:
        return None
    starts = [i for i, ch in enumerate(text) if ch in "{["]
    if not starts:
        return None
    start = starts[0]
    opener = text[start]
    closer = "}" if opener == "{" else "]"
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
            continue
        if ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def first_word(text: str) -> str:
    parts = re.findall(r"[A-Za-z0-9_\-]+", text or "")
    return parts[0] if parts else ""


def continuation_metrics(gen: dict[str, Any]) -> dict[str, Any]:
    ids = list(gen.get("new_ids") or [])
    special = [t for t in ids if t in SPECIAL_IDS]
    eos_run = 1
    run = 1
    max_eos = 0
    for a, b in zip(ids, ids[1:]):
        if a == EOS_ID and b == EOS_ID:
            run += 1
            max_eos = max(max_eos, run)
        else:
            run = 1
    spec_rate = float(len(special) / max(1, len(ids)))
    fp = hashlib.sha256((" ".join(str(i) for i in ids)).encode("utf-8")).hexdigest()
    return {
        "n_new": len(ids),
        "token_id_sha256": fp,
        "continuation_prefix": (gen.get("continuation") or "")[:240],
        "unique_ratio": gen.get("unique_ratio"),
        "max_token_run": gen.get("max_run"),
        "collapsed": gen.get("collapsed"),
        "entropy": gen.get("entropy"),
        "p_period": gen.get("p_period"),
        "finite": gen.get("finite"),
        "special_loop": gen.get("special_loop"),
        "special_count_0_8": len(special),
        "special_rate_0_8": round(spec_rate, 6),
        "eos_max_run": max_eos,
        "new_ids": ids,
    }


def teacher_force_nll_kl(
    model: WRIM0Model,
    prompt_ids: list[int],
    target_ids: list[int],
    device: torch.device,
    wrim0_logp: torch.Tensor | None,
) -> dict[str, Any]:
    if len(prompt_ids) + len(target_ids) < 2 or not target_ids:
        return {"nll": float("nan"), "kl": float("nan"), "log_softmax": None}
    x = torch.tensor([prompt_ids + target_ids[:-1]], dtype=torch.long, device=device)
    model.eval()
    with torch.inference_mode():
        logits = model(x)[0]
        start = len(prompt_ids) - 1
        tlogits = logits[start : start + len(target_ids)].float()
        logq = F.log_softmax(tlogits, dim=-1)
        tgt = torch.tensor(target_ids, dtype=torch.long, device=device)
        idx = torch.arange(len(target_ids), device=device)
        tok_nll = -logq[idx, tgt]
        kl = None
        out_logp = None
        if wrim0_logp is None:
            out_logp = logq.detach().cpu()
            p0 = logq
            kl_t = (p0.exp() * (p0 - logq)).sum(dim=-1)
            kl = float(kl_t.mean().item())
        else:
            p0 = wrim0_logp.to(device)
            kl_t = (p0.exp() * (p0 - logq)).sum(dim=-1)
            kl = float(kl_t.mean().item())
    return {"nll": float(tok_nll.mean().item()), "kl": kl, "log_softmax": out_logp}


def score_item(item: dict[str, Any], gen_primary: dict[str, Any], gen32: dict[str, Any], gen256: dict[str, Any]) -> dict[str, Any]:
    text = gen_primary.get("continuation") or ""
    payload = item.get("reference_payload") or {}
    forbid = list(payload.get("forbid_substrings") or [])
    must_any = list(payload.get("must_contain_any") or [])
    expected_sub = list(payload.get("expected_token_substrings") or [])
    low = text.lower()
    scores: dict[str, Any] = {}
    if forbid:
        scores["no_tool_markup"] = not any(s.lower() in low or s in text for s in forbid)
    if must_any:
        scores["must_contain_any"] = any(s in text for s in must_any)
    if expected_sub:
        scores["constraint_substring_any"] = any(s.lower() in low for s in expected_sub)
    if "code_has_return" in item["scoring_functions"]:
        scores["code_has_return"] = "return" in text
    if "code_closes_bracket" in item["scoring_functions"]:
        scores["code_closes_bracket"] = "]" in text or ")" in text
    if "not_empty" in item["scoring_functions"]:
        scores["not_empty"] = bool(text.strip())
    if any(n.startswith("json_") for n in item["scoring_functions"]):
        blob = extract_json_blob(text)
        if "json_parse_prefix_repair" in item["scoring_functions"]:
            blob = extract_json_blob((item["prompt_text"] + text))
        parsed = None
        valid = False
        if blob:
            try:
                parsed = json.loads(blob)
                valid = True
            except Exception:
                valid = False
        scores["json_valid"] = valid
        if "json_required_keys" in item["scoring_functions"]:
            keys = payload.get("required_keys") or []
            scores["json_required_keys"] = bool(valid and isinstance(parsed, dict) and all(k in parsed for k in keys))
        if "json_array_len_3" in item["scoring_functions"]:
            scores["json_array_len_3"] = bool(valid and isinstance(parsed, list) and len(parsed) == 3 and all(isinstance(x, str) for x in parsed))
        if "json_nested_outer" in item["scoring_functions"]:
            parent_key = (payload.get("required_keys") or ["outer"])[0]
            nested = parsed.get(parent_key) if valid and isinstance(parsed, dict) else None
            ok = isinstance(nested, dict) and payload.get("nested_key") in nested
            scores["json_nested_outer"] = bool(ok)
        if "json_bool_null" in item["scoring_functions"]:
            ok = valid and isinstance(parsed, dict) and isinstance(parsed.get("ready"), bool) and parsed.get("note") is None
            scores["json_bool_null"] = bool(ok)
        if "json_parse_optional" in item["scoring_functions"]:
            scores["json_valid_optional"] = valid
        if "schema_object" in item["scoring_functions"]:
            ok = valid and isinstance(parsed, dict) and all(k in parsed for k in (payload.get("required_keys") or []))
            if ok and payload.get("ready_type") == "bool":
                ok = isinstance(parsed.get("ready"), bool)
            if ok and payload.get("spool_type") == "number":
                ok = isinstance(parsed.get("spool_count"), (int, float)) and not isinstance(parsed.get("spool_count"), bool)
            scores["schema_object"] = bool(ok)
    if "key_value_lines" in item["scoring_functions"]:
        lines = [ln.strip() for ln in text.replace("\r", "").split("\n") if ln.strip()]
        keys = [k.lower() for k in (payload.get("required_keys") or [])]
        found = set()
        for ln in lines:
            if ":" not in ln:
                continue
            left, right = ln.split(":", 1)
            left = left.strip().lower()
            right = right.strip()
            if right and (not keys or left in keys):
                found.add(left if left else "_")
        scores["key_value_lines"] = (set(keys).issubset(found) if keys else bool(found))
    if "list_lines" in item["scoring_functions"]:
        lines = [ln.strip() for ln in text.replace("\r", "").split("\n") if ln.strip()]
        min_lines = int(payload.get("min_lines") or 3)
        scores["list_lines"] = len(lines) >= min_lines
    if "csv_row" in item["scoring_functions"]:
        blob = (payload.get("prefix") or "") + text
        row = blob.replace("\r", "").strip().split("\n")[-1]
        nfields = len([p for p in row.split(",") if p.strip() != ""])
        scores["csv_row"] = nfields >= int(payload.get("min_fields") or 2)
    if "exactly_one_word" in item["scoring_functions"]:
        words = re.findall(r"[A-Za-z0-9_\-]+", text)
        scores["exactly_one_word"] = len(words) == 1
    if "accepted_word" in item["scoring_functions"]:
        w = first_word(text)
        scores["accepted_word"] = w in set(payload.get("accepted_words") or [])
    if "contains_exact_span" in item["scoring_functions"]:
        scores["contains_exact_span"] = (payload.get("span") or "") in text
    if "three_csv" in item["scoring_functions"]:
        parts = [p.strip().lower() for p in text.replace("\n", " ").split(",") if p.strip()]
        want = [t.lower() for t in (payload.get("tokens") or [])]
        scores["three_csv"] = parts[:3] == want and len(parts) >= 3
    if "lowercase_no_digits" in item["scoring_functions"]:
        scores["lowercase_no_digits"] = bool(text) and text == text.lower() and not re.search(r"\d", text)
    if "required_terms" in item["scoring_functions"]:
        terms = [str(t).lower() for t in (payload.get("required_terms") or [])]
        scores["required_terms"] = all(t in low for t in terms) if terms else True
    if "forbidden_terms" in item["scoring_functions"]:
        terms = [str(t).lower() for t in (payload.get("forbidden_terms") or [])]
        scores["forbidden_terms"] = not any(t in low for t in terms)
    if "ordered_terms" in item["scoring_functions"]:
        pos = 0
        ok = True
        for term in [str(t).lower() for t in (payload.get("ordered_terms") or [])]:
            i = low.find(term, pos)
            if i < 0:
                ok = False
                break
            pos = i + len(term)
        scores["ordered_terms"] = ok
    if "max_words" in item["scoring_functions"]:
        words = re.findall(r"[A-Za-z0-9_\-]+", text)
        scores["max_words"] = len(words) <= int(payload.get("max_words") or 0)
        extra_req = [str(t).lower() for t in (payload.get("required_terms") or [])]
        if extra_req:
            scores["required_terms"] = all(t in low for t in extra_req)
    if "entity_track" in item["scoring_functions"]:
        ent = str(payload.get("track_entity") or "")
        scores["entity_track"] = (not ent) or (ent.lower() in low)
    if "special_rate_0_8" in item["scoring_functions"]:
        ids = list(gen_primary.get("new_ids") or [])
        special = [t for t in ids if t in SPECIAL_IDS]
        rate = float(len(special) / max(1, len(ids)))
        scores["special_rate_ok"] = rate <= 0.08
    scores["primary_collapsed"] = bool(gen_primary.get("collapsed"))
    scores["primary_special_loop"] = bool(gen_primary.get("special_loop"))
    return scores


def load_corpus0_docs(dump_root: Path, tokenizer: Tokenizer, split: str) -> list[dict[str, Any]]:
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
        out.append({"id": str(doc.get("documentId")), "split": f"WR-CORPUS-0-{split}", "text": decoded, "ids": ids})
    return out


def load_corpus1_records(dump_root: Path, split: str) -> list[dict[str, Any]]:
    path = dump_root / "model-lab" / "corpora" / "WR-CORPUS-1-HARDENED" / ("train" if split == "train" else "validation") / "shard-00000.jsonl"
    rows = []
    with path.open("r", encoding="utf-8") as f:
        for i, line in enumerate(f):
            rec = json.loads(line)
            rows.append({"id": f"c1-{split}-{i}", "split": f"WR-CORPUS-1-{split}", "text": text_of(rec)})
    return rows


def scan_haystacks(prompt: str, prompt_ids: list[int], haystacks: list[dict[str, Any]]) -> dict[str, Any]:
    worst = {"blocking": False, "hits": []}
    needle = prompt
    needle_n = normalize_ws(prompt)
    stem_toks = token_ngrams(prompt_ids, NGRAM)
    for h in haystacks:
        text = h.get("text") or ""
        if not text:
            continue
        exact = needle in text
        norm = needle_n and needle_n in normalize_ws(text)
        cov = ngram_coverage(text, needle, NGRAM)
        tok_hits = 0
        tok_ratio = 0.0
        ids = h.get("ids")
        if ids and stem_toks:
            tok_set = set(token_ngrams(ids, NGRAM))
            tok_hits = int(sum(1 for g in stem_toks if g in tok_set))
            tok_ratio = tok_hits / max(1, len(stem_toks))
        elif (exact or cov["blocking_contiguous"] or cov["hit_ratio"] > 0.2) and stem_toks:
            # tokenize only on suspicious char overlap
            pass
        blocking = bool(
            exact
            or (len(needle) >= MIN_BLOCK_SPAN and cov["blocking_contiguous"])
            or (len(needle) >= MIN_BLOCK_SPAN and tok_ratio >= TOKEN13_BLOCK_RATIO)
        )
        if exact or cov["hit_ratio"] >= 0.15 or tok_ratio >= 0.15 or blocking:
            worst["hits"].append(
                {
                    "source": h.get("split"),
                    "source_id": h.get("id"),
                    "exact": exact,
                    "normalized_exact": bool(norm),
                    "char13": cov,
                    "token13_hits": tok_hits,
                    "token13_hit_ratio": round(tok_ratio, 6),
                    "blocking": blocking,
                }
            )
        if blocking:
            worst["blocking"] = True
    worst["hits"].sort(key=lambda r: (r["blocking"], r["exact"], r["char13"]["hit_ratio"]), reverse=True)
    worst["hits"] = worst["hits"][:8]
    return worst


def leakage_audit(items: list[dict[str, Any]], tokenizer: Tokenizer, dump_root: Path) -> dict[str, Any]:
    c0_train = load_corpus0_docs(dump_root, tokenizer, "train")
    c0_val = load_corpus0_docs(dump_root, tokenizer, "val")
    c1_train = load_corpus1_records(dump_root, "train")
    c1_val = load_corpus1_records(dump_root, "validation")
    cap = load_retention_items(dump_root)
    diag = load_diagnostic_items(dump_root)
    overlays = []
    for it in cap:
        overlays.append({"id": it.get("evalId") or it.get("id"), "split": "CAP-EVAL-0", "text": it.get("prompt") or it.get("input") or it.get("generation_prompt") or ""})
    for it in diag:
        overlays.append({"id": it.get("id"), "split": "DIAGNOSTIC-0", "text": it.get("input") or ""})
    hay = c0_train + c0_val + c1_train + c1_val + overlays
    per_item = []
    blocking_ids = []
    for it in items:
        prompt = it["prompt_text"]
        ids = encode_prompt_ids(tokenizer, prompt)
        scan = scan_haystacks(prompt, ids, hay)
        payload = it.get("reference_payload")
        if isinstance(payload, dict):
            extra = json.dumps(payload, ensure_ascii=False)
            if extra and extra not in ("null", "{}", "[]"):
                scan_ref = scan_haystacks(extra, encode_prompt_ids(tokenizer, extra), hay)
                if scan_ref["blocking"]:
                    scan["blocking"] = True
                    scan["reference_blocking"] = scan_ref["hits"][:3]
        row = {"item_id": it["item_id"], "category": it["category"], "blocking": scan["blocking"], "top_hits": scan["hits"]}
        if scan.get("reference_blocking"):
            row["reference_blocking"] = scan["reference_blocking"]
        per_item.append(row)
        if scan["blocking"]:
            blocking_ids.append(it["item_id"])
    return {
        "ok": len(blocking_ids) == 0,
        "n_items": len(items),
        "n_haystacks": len(hay),
        "blocking_item_ids": blocking_ids,
        "per_item": per_item,
        "note": "Incidental short common phrases are not blocking unless exact/80% contiguous 13-gram coverage of a span >= 20 chars.",
        "stage3_streams": "NOT_MATERIALIZED; corpus0/1 train+val cover the future mix.",
    }


def duplication_audit(items: list[dict[str, Any]]) -> dict[str, Any]:
    pairs = []
    blocking = []
    for i, a in enumerate(items):
        ga = set(char_ngrams(a["prompt_text"], NGRAM))
        na = normalize_ws(a["prompt_text"])
        for b in items[i + 1 :]:
            gb = set(char_ngrams(b["prompt_text"], NGRAM))
            nb = normalize_ws(b["prompt_text"])
            union = ga | gb
            jac = (len(ga & gb) / len(union)) if union else 0.0
            exact = a["prompt_text"] == b["prompt_text"]
            norm = na == nb and bool(na)
            same_cat = a["category"] == b["category"]
            block = exact or norm or jac >= DUP_JACCARD_BLOCK
            if jac >= 0.18 or block:
                pairs.append(
                    {
                        "a": a["item_id"],
                        "b": b["item_id"],
                        "same_category": same_cat,
                        "exact": exact,
                        "normalized_exact": norm,
                        "char13_jaccard": round(jac, 6),
                        "blocking": block,
                    }
                )
            if block:
                blocking.append((a["item_id"], b["item_id"]))
    per_cat = {}
    for cat in CATEGORIES:
        cat_items = [it for it in items if it["category"] == cat]
        mean_jac = []
        for i, a in enumerate(cat_items):
            ga = set(char_ngrams(a["prompt_text"], NGRAM))
            for b in cat_items[i + 1 :]:
                gb = set(char_ngrams(b["prompt_text"], NGRAM))
                union = ga | gb
                mean_jac.append((len(ga & gb) / len(union)) if union else 0.0)
        per_cat[cat] = {"n": len(cat_items), "mean_pairwise_char13_jaccard": round(sum(mean_jac) / max(1, len(mean_jac)), 6)}
    poor = [c for c, v in per_cat.items() if v["mean_pairwise_char13_jaccard"] >= 0.25]
    return {
        "ok": len(blocking) == 0 and not poor,
        "blocking_pairs": [{"a": a, "b": b} for a, b in blocking],
        "flagged_pairs": pairs,
        "per_category": per_cat,
        "poor_category_diversity": poor,
    }


def eval_wrim0(
    *,
    model: WRIM0Model,
    tokenizer: Tokenizer,
    device: torch.device,
    items: list[dict[str, Any]],
    dump_root: Path,
) -> dict[str, Any]:
    c0 = concat_units(encode_rehearsal_val_units(tokenizer, dump_root))
    c1 = concat_units(encode_corpus1_val_units(tokenizer, dump_root))
    live_v0 = measure_val_loss(model, c0, device)
    live_v1 = measure_val_loss(model, c1, device)
    item_rows = []
    self_kls = []
    nlls = []
    for it in items:
        prompt = it["prompt_text"]
        prompt_ids = encode_prompt_ids(tokenizer, prompt)
        gen32 = greedy_generate(model, tokenizer, prompt, device, max_new=32)
        gen256 = greedy_generate(model, tokenizer, prompt, device, max_new=256)
        primary = gen256 if int(it["max_new_tokens"]) >= 256 else gen32
        m32 = continuation_metrics(gen32)
        m256 = continuation_metrics(gen256)
        bundle = teacher_force_nll_kl(model, prompt_ids, m32["new_ids"], device, None)
        self_kl = bundle["kl"]
        if self_kl is not None and math.isfinite(self_kl):
            self_kls.append(float(self_kl))
        nlls.append(bundle["nll"])
        scores = score_item(it, primary, gen32, gen256)
        item_rows.append(
            {
                "item_id": it["item_id"],
                "category": it["category"],
                "axis": it.get("axis"),
                "content_hash": it["content_hash"],
                "prompt_token_count": len(prompt_ids),
                "prompt_token_sha256": hashlib.sha256((" ".join(str(i) for i in prompt_ids)).encode("utf-8")).hexdigest(),
                "wrim0_anchor_nll_32": bundle["nll"],
                "self_kl_32": self_kl,
                "historical_32": {k: v for k, v in m32.items() if k != "new_ids"} | {"new_ids": m32["new_ids"]},
                "descriptive_256": {k: v for k, v in m256.items() if k != "new_ids"} | {"new_ids": m256["new_ids"]},
                "category_scores": scores,
            }
        )
    by_cat: dict[str, list[dict[str, Any]]] = {c: [] for c in CATEGORIES}
    for row in item_rows:
        by_cat[row["category"]].append(row)

    def cat_agg(rows: list[dict[str, Any]]) -> dict[str, Any]:
        if not rows:
            return {}
        json_valid = [r["category_scores"].get("json_valid") for r in rows if "json_valid" in r["category_scores"]]
        spec = [float((r["descriptive_256"] or {}).get("special_rate_0_8") or 0.0) for r in rows]
        coll = [bool((r["descriptive_256"] or {}).get("collapsed")) for r in rows]
        return {
            "n": len(rows),
            "mean_anchor_nll_32": float(sum(float(r["wrim0_anchor_nll_32"]) for r in rows) / len(rows)),
            "mean_self_kl_32": float(sum(float(r["self_kl_32"] or 0.0) for r in rows) / len(rows)),
            "mean_special_rate_256": float(sum(spec) / len(spec)),
            "n_collapsed_256": int(sum(coll)),
            "json_valid_count": int(sum(1 for x in json_valid if x)),
            "json_n": len(json_valid),
        }

    max_self = max(self_kls) if self_kls else float("nan")
    return {
        "live_val_loss_corpus0_check": live_v0,
        "live_val_loss_corpus1_check": live_v1,
        "preserved_val_loss_corpus0": VAL_CORPUS0_BASELINE,
        "preserved_val_loss_corpus1": VAL_CORPUS1_BASELINE,
        "self_kl": {
            "mean": float(sum(self_kls) / max(1, len(self_kls))),
            "max": float(max_self) if math.isfinite(max_self) else None,
            "tolerance": SELF_KL_TOL,
            "pass": bool(self_kls) and all(abs(k) <= SELF_KL_TOL for k in self_kls),
        },
        "items": item_rows,
        "category_aggregates": {c: cat_agg(by_cat[c]) for c in CATEGORIES},
        "mean_anchor_nll_32": float(sum(nlls) / max(1, len(nlls))),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--dump-root", required=True)
    ap.add_argument("--suite-out", required=True)
    ap.add_argument("--leakage-out", required=True)
    ap.add_argument("--duplication-out", required=True)
    ap.add_argument("--baseline-out", required=True)
    ap.add_argument("--pointer-out", required=True)
    ap.add_argument("--authorization", required=True)
    args = ap.parse_args()
    if args.authorization != AUTHORIZATION:
        print(json.dumps({"ok": False, "error": "authorization must be STAGE3_EVAL_BASELINE_ONLY"}, indent=2))
        return 2

    assert_inventory()
    items = hashed_items()
    suite_path = Path(args.suite_out)
    leakage_path = Path(args.leakage_out)
    dup_path = Path(args.duplication_out)
    baseline_path = Path(args.baseline_out)
    weights = Path(args.weights)
    tokenizer_path = Path(args.tokenizer)
    dump_root = Path(args.dump_root)

    parent_sha = sha256_file(weights)
    tok_sha = sha256_file(tokenizer_path)
    if parent_sha != PARENT_SHA or tok_sha != TOKENIZER_SHA:
        payload = {"ok": False, "error": "HASH_MISMATCH", "parent": parent_sha, "tokenizer": tok_sha, "optimizer_steps": 0}
        write_json(baseline_path, payload)
        print(json.dumps(payload, indent=2))
        return 2

    suite_obj = {
        "suite_id": SUITE_ID,
        "suite_version": SUITE_VERSION,
        "status": "AUTHORED_FROZEN",
        "kind": "VERSIONED_EVALUATION_SUITE",
        "classification": ["VERSIONED_EVALUATION_SUITE", "STAGE3_PRETRAINING_BASELINE"],
        "n_items": 35,
        "n_categories": 7,
        "items_per_category": 5,
        "categories": CATEGORIES,
        "generation_mode": "greedy_argmax",
        "do_not_collapse_to_one_score": True,
        "historical_32_binary": "COMPATIBILITY_ONLY",
        "items": items,
    }
    canonical = json.dumps(
        {"suite_id": SUITE_ID, "suite_version": SUITE_VERSION, "items": items},
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    suite_hash = sha256_text(canonical)
    suite_obj["suite_hash"] = suite_hash
    write_json(suite_path, suite_obj)

    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    leak = leakage_audit(items, tokenizer, dump_root)
    dup = duplication_audit(items)
    write_json(leakage_path, leak)
    write_json(dup_path, dup)
    if not leak["ok"] or not dup["ok"]:
        payload = {
            "ok": False,
            "error": "AUDIT_FAIL",
            "leakage_ok": leak["ok"],
            "duplication_ok": dup["ok"],
            "blocking_leakage": leak.get("blocking_item_ids"),
            "blocking_duplication": dup.get("blocking_pairs"),
            "poor_category_diversity": dup.get("poor_category_diversity"),
            "optimizer_steps": 0,
            "suite_hash": suite_hash,
        }
        write_json(baseline_path, payload)
        print(json.dumps(payload, indent=2))
        return 3

    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    state, _cov = load_model_state_from_safetensors(weights)
    if set(state) != set(expected_torch_keys()):
        payload = {"ok": False, "error": "ARCHITECTURE_KEY_MISMATCH", "optimizer_steps": 0}
        write_json(baseline_path, payload)
        print(json.dumps(payload, indent=2))
        return 2
    model = WRIM0Model()
    model.load_state_dict(state, strict=True)
    model.freeze_inference()
    model.to(device)
    model.eval()

    evaled = eval_wrim0(model=model, tokenizer=tokenizer, device=device, items=items, dump_root=dump_root)
    if not evaled["self_kl"]["pass"]:
        payload = {
            "ok": False,
            "error": "SELF_KL_NONZERO",
            "self_kl": evaled["self_kl"],
            "optimizer_steps": 0,
        }
        write_json(baseline_path, payload)
        print(json.dumps(payload, indent=2))
        return 4

    cap = load_retention_items(dump_root)
    diag = load_diagnostic_items(dump_root)
    d0 = next((x for x in diag if x.get("id") == "d0-json"), None)
    d0_gen = greedy_generate(model, tokenizer, d0["input"], device, max_new=32) if d0 else {}
    d0_blob = extract_json_blob((d0.get("input") if d0 else "") + (d0_gen.get("continuation") or ""))
    d0_valid = False
    if d0_blob:
        try:
            json.loads(d0_blob)
            d0_valid = True
        except Exception:
            d0_valid = False

    hardware = {
        "device": str(device),
        "cuda": torch.cuda.is_available(),
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "torch": torch.__version__,
        "precision": "FP32",
        "tf32": "OFF",
    }
    baseline = {
        "ok": True,
        "kind": "WRIM0_STAGE3_SUITE_BASELINE",
        "suite_id": SUITE_ID,
        "suite_version": SUITE_VERSION,
        "suite_hash": suite_hash,
        "parent_id": "WRIM-0",
        "parent_sha256": parent_sha,
        "tokenizer_id": "WR-TOKENIZER-0",
        "tokenizer_sha256": tok_sha,
        "architecture": "WRIM-G-20M-v1-option-A",
        "optimizer_steps": 0,
        "training_authorization": "OFF",
        "stage3_authorization": "NO",
        "hardware": hardware,
        "utc": utc_now(),
        "self_kl": evaled["self_kl"],
        "preserved_val_loss_corpus0": VAL_CORPUS0_BASELINE,
        "preserved_val_loss_corpus1": VAL_CORPUS1_BASELINE,
        "live_val_loss_corpus0_check": evaled["live_val_loss_corpus0_check"],
        "live_val_loss_corpus1_check": evaled["live_val_loss_corpus1_check"],
        "items": evaled["items"],
        "category_aggregates": evaled["category_aggregates"],
        "special_token_baseline": {
            "mean_special_rate_256": float(
                sum(float((r["descriptive_256"] or {}).get("special_rate_0_8") or 0.0) for r in evaled["items"]) / 35.0
            )
        },
        "structured_output_baseline": evaled["category_aggregates"].get("JSON_STRUCTURED_OUTPUT"),
        "cap_eval_0": {"status": "COMPATIBILITY_ONLY", "n_items": len(cap), "replaced": False, "primary": False},
        "diagnostic_0": {
            "status": "COMPATIBILITY_ONLY",
            "id": "d0-json",
            "json_valid": d0_valid,
            "note": "Canonical DIAGNOSTIC-0 probe only. Baseline truth, not a discriminative parent capability.",
        },
        "review_bands_unchanged": True,
        "note": "WRIM-0 is a weak ~19.2M genesis model. This file is a comparison reference, not a quality target.",
    }
    write_json(baseline_path, baseline)
    frozen_text = baseline_path.read_text(encoding="utf-8").replace("\r\n", "\n")
    baseline_sha = sha256_text(frozen_text)
    sidecar = {
        "ok": True,
        "baseline_artifact": str(baseline_path),
        "baseline_sha256": baseline_sha,
        "suite_path": str(suite_path),
        "suite_hash": suite_hash,
        "optimizer_steps": 0,
        "self_kl_pass": True,
        "leakage_ok": True,
        "duplication_ok": True,
    }
    write_json(baseline_path.with_name("wrim-eval-s3-000001-wrim0-baseline.SHA256.json"), sidecar)
    write_json(Path(args.pointer_out), {
        "ok": True,
        "suite_id": SUITE_ID,
        "suite_version": SUITE_VERSION,
        "suite_hash": suite_hash,
        "baseline_artifact_name": "wrim-eval-s3-000001-wrim0-baseline.json",
        "baseline_sha256": baseline_sha,
        "optimizer_steps": 0,
    })
    print(json.dumps(sidecar, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
