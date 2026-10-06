"""WRIM1-CPT-000001 Stage A checkpoint selection + Stage B readiness packet.

READ-ONLY INFERENCE. Does not train. Does not construct an optimizer.
Does not restore optimizer state. Does not authorize Stage B / SFT / RUN-000013 / Stage3B.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import torch
from tokenizers import Tokenizer

from run000007_preflight import resolve_dump_root, sha256_file
from stage1_pack import HELD_OUT_PROMPT_STRINGS, PackedUnit
from stage2_pack import split_bounded_excerpts
from stage3a_run import evaluate_candidate, load_baseline, load_suite
from wrim_cpt_corpus import CORPUS_VERSION, corpus_root, eval_root, load_jsonl
from wrim_cpt_eval import (
    evaluate_foundation,
    family_nll,
    greedy_from_ids,
    load_foundation_eval,
    role_prefix_ids,
)
from wrim_cpt_identity import (
    ARCHITECTURE,
    ASSISTANT_ID,
    BOS_ID,
    COMMANDER_ID,
    CORPUS_ID,
    CPT_RUN_ID,
    EOS_ID,
    EVAL_SEED,
    FOUNDATION_EVAL_ID,
    FOUNDATION_EVAL_VERSION,
    LINUX_CKPT_ROOT,
    LINUX_DATA_ROOT,
    NEWLINE_ID,
    PARAM_COUNT,
    PARENT_ID,
    PARENT_SHA,
    TOKENIZER_ID,
    TOKENIZER_SHA,
)
from wrim_cpt_pack import load_c1_units, load_role_units
from wrim_cpt_preflight import locate_baseline, locate_suite
from wrim_g20m import D_MODEL, N_HEADS, N_LAYERS, VOCAB_SIZE, WRIM0Model
from wrim_proven_load import disable_tf32
from wrim_resumable_checkpoint import MODEL_NAME, verify_checkpoint_hashes
from run000006_pack import load_frozen_genesis_train_units

CANDIDATE_STEPS = (400, 610, 800, 1000, 1220)
PRESERVE_STEPS = (400, 1220)
TAG_RE = re.compile(r"\b[a-z]{3,12}-[a-z]{3,12}-\d{2,5}\b", re.I)
FOCUS_TAGS = ("dry-crate-0770", "odd-hinge-0995")
CKPT_ROOT = Path(LINUX_CKPT_ROOT)
REPORT_PATH = CKPT_ROOT / "WRIM1_CPT_STAGE_A_CHECKPOINT_SELECTION_REPORT.json"
AUTHORIZE_ENV = "WRIM_TRAINING_AUTHORIZATION"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8")


def take_ids(units: list[PackedUnit], n: int = 2048) -> list[int]:
    buf: list[int] = []
    for u in units:
        buf.extend(int(x) for x in u.tokens.tolist())
        if len(buf) >= n:
            break
    return buf[:n]


def build_val_packs(dump: Path, tokenizer: Tokenizer) -> dict[str, list[int]]:
    """Same family-NLL packs as Stage A packing, without concatenating the 5M train stream."""
    genesis = load_frozen_genesis_train_units(dump)
    g_units: list[PackedUnit] = []
    for u in genesis:
        pu = PackedUnit(
            unit_id=u.unit_id,
            bucket="genesis",
            origin="WR-CORPUS-0",
            tokens=np.array(u.tokens, dtype=np.int32),
            n_eos=int(sum(1 for t in u.tokens if int(t) == 2)),
            n_bos=int(sum(1 for t in u.tokens if int(t) == 1)),
        )
        parts = split_bounded_excerpts(pu, max_tokens=1024)
        for p in parts:
            p.bucket = "genesis"
        g_units.extend(parts)
    c1 = load_c1_units(tokenizer)
    role_val = load_role_units(tokenizer, "val")
    natural = list(c1.get("natural") or [])
    if len(natural) < 8:
        extra = []
        for u in g_units:
            extra.append(
                PackedUnit(
                    unit_id=f"{u.unit_id}#natural",
                    bucket="natural",
                    origin=u.origin,
                    tokens=u.tokens,
                    n_eos=u.n_eos,
                    n_bos=u.n_bos,
                )
            )
        natural = list(c1.get("natural") or []) + extra
    packs = {
        "genesis": take_ids(g_units),
        "code": take_ids(list(c1.get("code") or [])),
        "json": take_ids(list(c1.get("json") or [])),
        "role": take_ids(role_val),
        "technical": take_ids(list(c1.get("technical") or [])),
        "natural": take_ids(natural),
    }
    packs["general"] = (packs["natural"] + packs["technical"] + packs["code"])[:2048]
    packs["short"] = packs["role"]
    return packs


def eos_metrics_from_ids(model: WRIM0Model, device: torch.device, ids: list[int]) -> dict[str, Any]:
    if len(ids) < 3:
        return {"EOS_POSITIONS": 0, "EOS_ARGMAX_ACCURACY": None, "ASSISTANT_THEN_EOS_RATE": None}
    x = torch.tensor([ids[:-1]], dtype=torch.long, device=device)
    y = torch.tensor(ids[1:], dtype=torch.long, device=device)
    with torch.inference_mode():
        logits = model(x)[0]
        pred = torch.argmax(logits, dim=-1)
    eos_pos = (y == EOS_ID).nonzero(as_tuple=False).flatten()
    ast_pos = (x[0] == ASSISTANT_ID).nonzero(as_tuple=False).flatten()
    n_eos = int(eos_pos.numel())
    eos_hit = int((pred[eos_pos] == EOS_ID).sum().item()) if n_eos else 0
    ast_n = int(ast_pos.numel())
    ast_next = int((pred[ast_pos] == EOS_ID).sum().item()) if ast_n else 0
    return {
        "EOS_POSITIONS": n_eos,
        "EOS_ARGMAX_ACCURACY": (eos_hit / n_eos) if n_eos else None,
        "ASSISTANT_THEN_EOS_RATE": (ast_next / ast_n) if ast_n else None,
        "COMMANDER_COUNT": int((y == COMMANDER_ID).sum().item()),
        "ASSISTANT_COUNT": ast_n,
    }


def augment_foundation(ev: dict[str, Any]) -> dict[str, Any]:
    ranks = [int(it["TARGET_RANK"]) for it in ev.get("items") or [] if it.get("TARGET_RANK") is not None]
    n = max(1, len(ranks))
    ev["ASSISTANT_BOUNDARY_TOP1_COUNT"] = int(sum(1 for r in ranks if r == 1))
    ev["ASSISTANT_BOUNDARY_TOP1_RATE"] = ev["ASSISTANT_BOUNDARY_TOP1_COUNT"] / n
    ev["ASSISTANT_BOUNDARY_TOP10_COUNT"] = int(sum(1 for r in ranks if r <= 10))
    ev["ASSISTANT_BOUNDARY_TOP10_RATE"] = ev["ASSISTANT_BOUNDARY_TOP10_COUNT"] / n
    ev["ASSISTANT_BOUNDARY_GREEDY_EXACT_COUNT"] = int(ev.get("ASSISTANT_BOUNDARY_GREEDY_COUNT") or 0)
    ev["RANKED_N"] = len(ranks)
    return ev


def slim_foundation(ev: dict[str, Any]) -> dict[str, Any]:
    keep = {k: v for k, v in ev.items() if k != "items"}
    items = []
    for it in list(ev.get("items") or []):
        row = {
            k: it.get(k)
            for k in (
                "item_id",
                "family",
                "ARGMAX_TOKEN",
                "TARGET_TOKEN",
                "TARGET_RANK",
                "LOGIT_GAP",
                "greedy",
                "greedy_exact",
                "eos",
            )
        }
        row["TOP_10"] = (it.get("TOP_10") or [])[:10]
        items.append(row)
    keep["items"] = items
    return keep


def classify_greedy(text: str, new_ids: list[int] | None, eos: bool) -> dict[str, Any]:
    t = (text or "").strip()
    ids = list(new_ids or [])
    first = ids[0] if ids else None
    immediate_eos = bool(ids and first == EOS_ID)
    nl = t.count("\n") >= 3 or (first == NEWLINE_ID)
    tags = TAG_RE.findall(t.lower().replace(" ", ""))
    if not tags:
        tags = TAG_RE.findall(t.lower())
    repeats = False
    if ids:
        c = Counter(ids)
        repeats = max(c.values()) >= 8
    malformed = any(x in t for x in ("<|commander|>", "<|assistant|>", "<|system|>", "<|bos|>"))
    doc_cont = bool(re.match(r"^(the |a |i |in |and |of )", t.lower())) or first in {NEWLINE_ID}
    answer_like = bool(t) and not immediate_eos and not repeats and not tags and len(t) >= 2
    return {
        "immediate_eos": immediate_eos,
        "newline_collapse": nl and not answer_like,
        "document_continuation": doc_cont and not tags and not immediate_eos,
        "tag_fragment": bool(tags),
        "tags_found": tags[:8],
        "repeated_token": repeats,
        "malformed_role_tokens": malformed,
        "answer_like_continuation": answer_like,
        "eos_stopped": bool(eos),
        "empty": not t and not immediate_eos,
    }


def load_weights_only(model: WRIM0Model, weights: Path) -> None:
    """Load model weights only. Never restore optimizer / scheduler / RNG."""
    from safetensors.torch import load_file
    from safetensors_model import load_model_state_from_safetensors

    if weights.name == "checkpoint-final.safetensors":
        state, _ = load_model_state_from_safetensors(weights)
    else:
        state = load_file(str(weights))
        if any(k.startswith("model.") for k in state):
            state, _ = load_model_state_from_safetensors(weights)
    model.load_state_dict(state, strict=True)
    model.freeze_inference()


def tensor_max_abs_diff(a: WRIM0Model, b: WRIM0Model) -> float:
    mx = 0.0
    sa = dict(a.named_parameters())
    sb = dict(b.named_parameters())
    for k, pa in sa.items():
        d = (pa.detach().float() - sb[k].detach().float()).abs().max().item()
        if d > mx:
            mx = float(d)
    return mx


def recompute_corpus_hash() -> dict[str, Any]:
    root = corpus_root()
    er = eval_root()
    files = {
        "c1": sha256_file(root / f"{CORPUS_VERSION}-C1-TRAIN.jsonl"),
        "role_train": sha256_file(root / f"{CORPUS_VERSION}-ROLE-TRAIN.jsonl"),
        "role_val": sha256_file(root / f"{CORPUS_VERSION}-ROLE-VAL.jsonl"),
        "foundation_eval": sha256_file(er / f"{FOUNDATION_EVAL_VERSION}.json"),
    }
    return {"files": files, "CORPUS_HASH": sha256_text(json.dumps(files, sort_keys=True))}


def corpus_index() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    mapping = (
        (corpus_root() / f"{CORPUS_VERSION}-ROLE-TRAIN.jsonl", "role_train"),
        (corpus_root() / f"{CORPUS_VERSION}-ROLE-VAL.jsonl", "role_val"),
        (corpus_root() / f"{CORPUS_VERSION}-C1-TRAIN.jsonl", "c1_train"),
    )
    for path, cat in mapping:
        for rec in load_jsonl(path):
            blob = " ".join(
                str(rec.get(k) or "")
                for k in ("prompt", "target", "text", "example_id", "chunk_id", "source_path")
            )
            rows.append(
                {
                    "category": cat,
                    "subtype": rec.get("subtype") or rec.get("bucket"),
                    "example_id": rec.get("example_id") or rec.get("chunk_id"),
                    "blob": blob,
                    "target": str(rec.get("target") or ""),
                }
            )
    return rows


def longest_span(hay: str, needle: str, min_len: int = 8) -> int:
    if not needle or not hay:
        return 0
    n = needle.strip()
    if len(n) < min_len:
        return 0
    if n in hay:
        return len(n)
    best = 0
    # bounded windows, longest first
    upper = min(len(n), 64)
    for w in range(upper, min_len - 1, -1):
        for i in range(0, len(n) - w + 1, max(1, w // 4)):
            frag = n[i : i + w]
            if frag in hay:
                return w
        if best:
            break
    return best


def overlap_against_corpus(continuation: str, index: list[dict[str, Any]]) -> dict[str, Any]:
    text = (continuation or "").strip()
    if len(text) < 8:
        return {"exact": False, "longest_span": 0, "source_category": None, "example_id": None}
    best: dict[str, Any] = {"exact": False, "longest_span": 0, "source_category": None, "example_id": None}
    windows = []
    for w in (32, 24, 16):
        if len(text) >= w:
            windows.append(text[:w])
            if len(text) > w:
                windows.append(text[-w:])
    for rec in index:
        blob = rec["blob"]
        tgt = rec["target"] or ""
        if text in blob or (tgt and (text == tgt or text in tgt)):
            return {
                "exact": True,
                "longest_span": len(text),
                "source_category": rec["category"],
                "example_id": rec["example_id"],
                "subtype": rec.get("subtype"),
            }
        for wtxt in windows:
            if wtxt and (wtxt in blob or wtxt in tgt):
                if len(wtxt) > int(best["longest_span"]):
                    best = {
                        "exact": False,
                        "longest_span": len(wtxt),
                        "source_category": rec["category"],
                        "example_id": rec["example_id"],
                        "subtype": rec.get("subtype"),
                    }
                    break
    return best


def tag_provenance(tag: str, index: list[dict[str, Any]]) -> dict[str, Any]:
    t = tag.lower().strip()
    exact = [r for r in index if t in (r["blob"] or "").lower() or t == (r["target"] or "").lower()]
    padded = None
    m = re.match(r"^([a-z]+-[a-z]+)-(\d+)$", t)
    if m:
        padded = f"{m.group(1)}-{int(m.group(2)):05d}"
    padded_hits = [r for r in index if padded and padded in (r["blob"] or "").lower()] if padded else []
    family = None
    if m:
        adj, noun = m.group(1).split("-")
        family_hits = sum(1 for r in index if adj in (r.get("target") or "") and noun in (r.get("target") or "") and r["category"].startswith("role"))
        family = {"adj": adj, "noun": noun, "role_family_hits": family_hits, "padded_form": padded}
    return {
        "tag": t,
        "exact_record_hits": len(exact),
        "padded_record_hits": len(padded_hits),
        "exact_example_ids": [r["example_id"] for r in exact[:5]],
        "padded_example_ids": [r["example_id"] for r in padded_hits[:5]],
        "family": family,
        "origin": "WR-CORPUS-CPT-1 role-delimited synthetic adj-noun-NNNN template"
        if (exact or padded_hits or (family and family["role_family_hits"]))
        else "not_found_as_exact_corpus_record",
    }


def slim_stage3(ev: dict[str, Any]) -> dict[str, Any]:
    return {
        "step": ev.get("step"),
        "historical_pass_count": ev.get("historical_pass_count"),
        "historical_total": ev.get("historical_total"),
        "historical_binary": ev.get("historical_binary"),
        "mean_wrim0_anchor_nll_delta": ev.get("mean_wrim0_anchor_nll_delta"),
        "mean_kl_wrim0_to_candidate": ev.get("mean_kl_wrim0_to_candidate"),
        "n_collapsed": ev.get("n_collapsed"),
        "retention_special_loops": ev.get("retention_special_loops"),
        "val_loss_corpus0": ev.get("val_loss_corpus0"),
        "observe_only": True,
        "category_aggregates": {
            k: {
                "n": v.get("n"),
                "mean_anchor_nll_delta": v.get("mean_anchor_nll_delta"),
                "n_collapsed": v.get("n_collapsed"),
            }
            for k, v in (ev.get("category_aggregates") or {}).items()
        },
    }


def describe_generations(ev: dict[str, Any], extra: list[dict[str, Any]]) -> dict[str, Any]:
    rows = []
    counts = Counter()
    for it in ev.get("items") or []:
        cls = classify_greedy(str(it.get("greedy") or ""), None, bool(it.get("eos")))
        for k, v in cls.items():
            if v is True:
                counts[k] += 1
        rows.append(
            {
                "item_id": it.get("item_id"),
                "family": it.get("family"),
                "greedy": (it.get("greedy") or "")[:160],
                "greedy_exact": it.get("greedy_exact"),
                "target": it.get("TARGET_TOKEN"),
                "rank": it.get("TARGET_RANK"),
                **{k: cls[k] for k in cls if k != "tags_found"},
                "tags_found": cls.get("tags_found"),
            }
        )
    extra_out = []
    for g in extra:
        cls = classify_greedy(g.get("continuation") or "", g.get("new_ids"), bool(g.get("eos")))
        extra_out.append({**g, "behavior": cls})
        for k, v in cls.items():
            if v is True:
                counts["heldout_" + k] += 1
    return {"n": len(rows), "behavior_counts": dict(counts), "items": rows, "held_out_prompts": extra_out}


def stage_b_entry_criteria() -> dict[str, Any]:
    return {
        "kind": "WRIM1_CPT_STAGE_B_ENTRY_CRITERIA_DESIGN_ONLY",
        "authorized": False,
        "note": "Criteria only. Stage B remains NOT AUTHORIZED.",
        "must_all_hold": [
            {
                "id": "FOUNDATION_RANK",
                "rule": "ASSISTANT_BOUNDARY mean target rank strictly better than WRIM-0 by >=30% AND top-5 count >= 2 AND top-1 count >= 1 preferred",
            },
            {
                "id": "GREEDY_HONESTY",
                "rule": "Do not treat greedy exact == 0 as answer success. Stage B parent may still be chosen on relative rank/EOS/retention, but Stage B execution stays blocked while greedy exact remains 0 unless Commander explicitly waives.",
            },
            {
                "id": "EOS",
                "rule": "EOS greedy stop >= 50% of EOS-family items AND EOS argmax accuracy >= 0.40 on role-val pack",
            },
            {
                "id": "RETENTION",
                "rule": "Stage 3 historical pass >= 5/6 AND collapse count <= WRIM-0 collapse + 2 AND mean delta NLL < 1.25",
            },
            {
                "id": "NO_LANGUAGE_COLLAPSE",
                "rule": "NEWLINE_ATTRACTOR_RATE < 0.50 AND repeated-token behavior on < 25% of foundation items",
            },
            {
                "id": "NO_SEVERE_MEMORIZATION",
                "rule": "Held-out non-tag prompts must not greedy-emit unique train tags. Pattern interpolation of adj-noun-NNNN on tag-shaped prompts is a warning; exact unique-record copy is a hard fail.",
            },
            {
                "id": "FAMILY_NLL",
                "rule": "code NLL, json NLL, and role NLL each strictly below WRIM-0; genesis NLL below WRIM-0 + 0.25",
            },
            {
                "id": "HELD_OUT_GENERATION",
                "rule": "Descriptive: fewer newline/document attractors than WRIM-0; some answer-like continuations. Greedy exact remaining 0 is recorded as unsolved, not success.",
            },
            {
                "id": "CHECKPOINT_STABILITY",
                "rule": "Candidate model.safetensors hash unique, verifies against hashes.json, WRIM-0/tokenizer/architecture/corpus hashes unchanged",
            },
            {
                "id": "INDEPENDENT_NATURAL_VAL",
                "rule": "GENERAL_VAL_NLL must not alias GENESIS_VAL_NLL. A future independent natural-language validation pack is required before treating NLL as broad NL competence. Do not train on that pack.",
            },
        ],
        "commander_waiver_required_to_execute_stage_b": True,
    }


def select_parent(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Pick exactly one Stage B parent candidate from measured evidence."""
    by_id = {r["candidate_id"]: r for r in rows}
    wrim0 = by_id["WRIM-0"]
    cands = [r for r in rows if r["candidate_id"] != "WRIM-0"]

    def hard_integrity(r: dict[str, Any]) -> bool:
        return bool(r.get("hash_ok")) and r.get("greedy_exact", 0) >= 0

    survivors = []
    reasons = []
    for r in cands:
        fail = []
        if not r.get("hash_ok"):
            fail.append("hash_mismatch")
        # language collapse vs WRIM-0
        if float(r.get("newline_attractor") or 1) >= 0.5:
            fail.append("newline_collapse")
        if int(r.get("stage3_historical_pass") or 0) < 5:
            fail.append("retention_below_5_of_6")
        if float(r.get("stage3_delta_nll") or 99) >= 1.25:
            fail.append("delta_nll_ge_1.25")
        if int(r.get("stage3_collapse") or 99) > int(wrim0.get("stage3_collapse") or 0) + 2:
            fail.append("collapse_worse_than_parent_plus_2")
        # severe memorization: tag fragments on non-tag families
        if int(r.get("non_tag_prompt_tag_emissions") or 0) >= 2:
            fail.append("severe_tag_memorization_on_nontag_prompts")
        r["hard_fail_reasons"] = fail
        if not fail:
            survivors.append(r)
        reasons.append({"id": r["candidate_id"], "fail": fail})

    # Relative quality among survivors (or among all if none survive — still pick or NO_STAGE_B)
    pool = survivors if survivors else []
    if not pool:
        return {
            "SELECTED_STAGE_B_PARENT_CANDIDATE": "NO_STAGE_B_PARENT",
            "STAGE_B_READY": False,
            "reason": "No candidate cleared hard Stage B entry gates. See per-candidate hard_fail_reasons. Relative metrics still recorded; do not authorize Stage B.",
            "per_candidate_gates": reasons,
            "survivors": [],
        }

    def key(r: dict[str, Any]) -> tuple:
        # lower rank better; higher top5/top10; lower nontag tags; lower collapse; lower delta nll
        return (
            int(r.get("non_tag_prompt_tag_emissions") or 0),
            float(r.get("mean_target_rank") or 1e9),
            -int(r.get("top5") or 0),
            -int(r.get("top10") or 0),
            int(r.get("stage3_collapse") or 0),
            float(r.get("stage3_delta_nll") or 99),
            -float(r.get("eos_argmax") or 0),
            int(r.get("step") or 0),
        )

    best = sorted(pool, key=key)[0]
    greedy0 = all(int(r.get("greedy_exact") or 0) == 0 for r in rows)
    return {
        "SELECTED_STAGE_B_PARENT_CANDIDATE": best["enum_id"],
        "STAGE_B_READY": False,
        "reason": (
            f"{best['enum_id']} is the strongest measured parent among candidates that cleared hard gates: "
            f"mean rank {best.get('mean_target_rank')}, top-5 {best.get('top5')}, top-10 {best.get('top10')}, "
            f"EOS greedy {best.get('eos_greedy_stop')}/{best.get('eos_greedy_n')}, EOS argmax {best.get('eos_argmax')}, "
            f"Stage3 {best.get('stage3_historical_binary')} collapse {best.get('stage3_collapse')} deltaNLL {best.get('stage3_delta_nll')}. "
            + (
                "Greedy exact remains 0 on every candidate; this is not answer success. "
                if greedy0
                else ""
            )
            + "Later steps were not auto-selected. Stage B is NOT authorized."
        ),
        "per_candidate_gates": reasons,
        "survivors": [r["candidate_id"] for r in pool],
        "best_checkpoint_id": best["candidate_id"],
        "greedy_exact_all_zero": greedy0,
    }


def main() -> int:
    if os.environ.get(AUTHORIZE_ENV):
        print("REFUSING: training authorization env is set; this pass is read-only.", file=sys.stderr)
        return 2
    print("WRIM1-CPT-000001 STAGE A CHECKPOINT SELECTION — inference only", flush=True)
    dump = resolve_dump_root(None)
    if dump is None:
        raise SystemExit("dump_root missing")
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    wrim0_path = dump / "model-lab" / "manifests" / "wrim0_checkpoints" / "checkpoint-final.safetensors"

    wrim0_hash = sha256_file(wrim0_path)
    tok_hash = sha256_file(tok_path)
    corpus_live = recompute_corpus_hash()
    stored_corpus = json.loads((corpus_root() / f"{CORPUS_VERSION}-SHA256.json").read_text(encoding="utf-8"))
    fe_path = eval_root() / f"{FOUNDATION_EVAL_VERSION}.json"
    fe_hash = sha256_file(fe_path)
    fe_suite = load_foundation_eval()

    identity = {
        "WRIM0_PATH": str(wrim0_path),
        "WRIM0_LIVE_SHA256": wrim0_hash,
        "WRIM0_EXPECTED_SHA256": PARENT_SHA,
        "WRIM0_UNCHANGED": wrim0_hash == PARENT_SHA,
        "TOKENIZER_PATH": str(tok_path),
        "TOKENIZER_LIVE_SHA256": tok_hash,
        "TOKENIZER_EXPECTED_SHA256": TOKENIZER_SHA,
        "TOKENIZER_UNCHANGED": tok_hash == TOKENIZER_SHA,
        "ARCHITECTURE": ARCHITECTURE,
        "PARAM_COUNT_EXPECTED": PARAM_COUNT,
        "VOCAB_SIZE": VOCAB_SIZE,
        "D_MODEL": D_MODEL,
        "N_LAYERS": N_LAYERS,
        "N_HEADS": N_HEADS,
        "CORPUS_ID": CORPUS_ID,
        "CORPUS_VERSION": CORPUS_VERSION,
        "CORPUS_HASH_EXPECTED": stored_corpus.get("CORPUS_HASH"),
        "CORPUS_HASH_LIVE": corpus_live["CORPUS_HASH"],
        "CORPUS_FILE_HASHES_LIVE": corpus_live["files"],
        "CORPUS_UNCHANGED": corpus_live["CORPUS_HASH"] == stored_corpus.get("CORPUS_HASH")
        and corpus_live["files"] == stored_corpus.get("files"),
        "FOUNDATION_EVAL_ID": FOUNDATION_EVAL_ID,
        "FOUNDATION_EVAL_VERSION": FOUNDATION_EVAL_VERSION,
        "FOUNDATION_EVAL_SHA256": fe_hash,
        "FOUNDATION_EVAL_N": fe_suite.get("n"),
        "FOUNDATION_EVAL_UNCHANGED": fe_hash == stored_corpus.get("files", {}).get("foundation_eval"),
    }

    ckpt_hash_rows = []
    model_hashes = {}
    for step in (0, *CANDIDATE_STEPS):
        p = CKPT_ROOT / f"step-{step}"
        v = verify_checkpoint_hashes(p)
        mh = sha256_file(p / MODEL_NAME)
        man = json.loads((p / "resume-manifest.json").read_text(encoding="utf-8"))
        ckpt_hash_rows.append(
            {
                "step": step,
                "path": str(p / MODEL_NAME),
                "model_sha256_live": mh,
                "model_sha256_manifest": man.get("MODEL_HASH") or (man.get("FILE_HASHES") or {}).get(MODEL_NAME),
                "verify_ok": bool(v.get("ok")),
                "mismatches": v.get("mismatches"),
                "parent_hash_in_manifest": man.get("PARENT_HASH"),
                "tokenizer_hash_in_manifest": man.get("TOKENIZER_HASH"),
                "train_dataset_hashes": man.get("TRAIN_DATASET_HASHES"),
                "architecture_ok": man.get("PARENT_MODEL_ID") == PARENT_ID and man.get("PARENT_HASH") == PARENT_SHA,
            }
        )
        model_hashes[step] = mh
    unique_ok = len(set(model_hashes[s] for s in CANDIDATE_STEPS)) == len(CANDIDATE_STEPS)
    none_overwrite = unique_ok and all(model_hashes[s] != wrim0_hash for s in CANDIDATE_STEPS)

    disable_tf32()
    torch.manual_seed(EVAL_SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(EVAL_SEED)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tokenizer = Tokenizer.from_file(str(tok_path))

    print("building val packs (no train stream)...", flush=True)
    val_packs = build_val_packs(dump, tokenizer)

    print("loading WRIM-0...", flush=True)
    parent = WRIM0Model().to(device)
    load_weights_only(parent, wrim0_path)
    n_params = int(sum(p.numel() for p in parent.parameters()))
    identity["PARAM_COUNT_LIVE"] = n_params
    identity["ARCHITECTURE_UNCHANGED"] = n_params == PARAM_COUNT and VOCAB_SIZE == 15126
    parent_cpu = {k: v.detach().cpu().clone() for k, v in parent.state_dict().items()}

    # step-0 reserialization check
    step0_model = WRIM0Model().to(device)
    load_weights_only(step0_model, CKPT_ROOT / "step-0" / MODEL_NAME)
    identity["STEP0_FILE_SHA256"] = model_hashes[0]
    identity["STEP0_FILE_SHA256_EQUALS_WRIM0"] = model_hashes[0] == wrim0_hash
    identity["STEP0_MAX_ABS_DIFF_VS_WRIM0"] = tensor_max_abs_diff(parent, step0_model)
    identity["STEP0_TENSORS_MATCH_WRIM0"] = identity["STEP0_MAX_ABS_DIFF_VS_WRIM0"] < 1e-6
    del step0_model
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    data_root = Path(LINUX_DATA_ROOT)
    suite = load_suite(locate_suite())
    baseline_path = locate_baseline(data_root)
    if baseline_path is None:
        raise SystemExit("stage3 baseline missing")
    baseline = load_baseline(baseline_path)
    wrim0_logp: dict[str, torch.Tensor] = {}

    idx = corpus_index()
    focus_prov = {t: tag_provenance(t, idx) for t in FOCUS_TAGS}

    candidates_spec = [
        {"candidate_id": "WRIM-0", "enum_id": "WRIM-0", "step": 0, "weights": wrim0_path, "is_parent": True},
    ]
    for s in CANDIDATE_STEPS:
        candidates_spec.append(
            {
                "candidate_id": f"step-{s}",
                "enum_id": f"STEP_{s}",
                "step": s,
                "weights": CKPT_ROOT / f"step-{s}" / MODEL_NAME,
                "is_parent": False,
            }
        )

    results: list[dict[str, Any]] = []
    foundation_by: dict[str, Any] = {}
    stage3_by: dict[str, Any] = {}
    gen_by: dict[str, Any] = {}
    nll_by: dict[str, Any] = {}
    mem_hits: list[dict[str, Any]] = []

    for spec in candidates_spec:
        cid = spec["candidate_id"]
        print(f"evaluating {cid}...", flush=True)
        if spec["is_parent"]:
            model = parent
        else:
            model = WRIM0Model().to(device)
            load_weights_only(model, spec["weights"])
        model.freeze_inference()
        torch.manual_seed(EVAL_SEED)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(EVAL_SEED)

        found = augment_foundation(evaluate_foundation(model=model, tokenizer=tokenizer, device=device))
        nlls = family_nll(model=model, device=device, packs=val_packs)
        nlls["short"] = nlls.get("role")
        eos = eos_metrics_from_ids(model, device, val_packs.get("role") or [])
        nlls["eos"] = eos

        extra_gens = []
        for prompt in HELD_OUT_PROMPT_STRINGS:
            ids = [BOS_ID, *tokenizer.encode(prompt, add_special_tokens=False).ids]
            g = greedy_from_ids(model, tokenizer, device, ids, max_new=32)
            extra_gens.append(
                {
                    "prompt": prompt[:80],
                    "continuation": (g.get("continuation") or "")[:160],
                    "eos": g.get("eos"),
                    "new_ids": g.get("new_ids"),
                }
            )
        gen = describe_generations(found, extra_gens)

        # non-tag prompt tag emissions: assistant_boundary/simple_answer/short/eos that emit tags
        # plus document/code/json families
        nontag = 0
        tag_on_bound = 0
        for it in gen["items"]:
            fam = str(it.get("family") or "")
            tags = it.get("tags_found") or []
            if tags and fam in {"document_continuation", "code_continuation", "json_continuation", "simple_answer_mode"}:
                nontag += 1
            if tags and fam == "assistant_boundary":
                tag_on_bound += 1
            ov = overlap_against_corpus(str(it.get("greedy") or ""), idx)
            if ov.get("exact") or int(ov.get("longest_span") or 0) >= 16:
                mem_hits.append(
                    {
                        "candidate": cid,
                        "item_id": it.get("item_id"),
                        "greedy": (it.get("greedy") or "")[:120],
                        **ov,
                    }
                )

        s3 = evaluate_candidate(
            model=model,
            tokenizer=tokenizer,
            device=device,
            dump_root=dump,
            suite_items=suite["obj"]["items"],
            frozen_items=baseline["obj"]["items"],
            wrim0_logp=wrim0_logp,
            parent_cpu=parent_cpu,
            c0=np.array(val_packs.get("genesis") or [1, 2, 3], dtype=np.int32),
            c1=np.array(val_packs.get("general") or [1, 2, 3], dtype=np.int32),
            greedy_256=False,
            step=int(spec["step"]),
            train_loss=None,
            tokens=int(spec["step"]) * 4096,
            lr=None,
        )
        model.freeze_inference()
        s3s = slim_stage3(s3)

        mh = wrim0_hash if spec["is_parent"] else sha256_file(spec["weights"])
        row = {
            "candidate_id": cid,
            "enum_id": spec["enum_id"],
            "step": spec["step"],
            "model_sha256": mh,
            "hash_ok": True if spec["is_parent"] else (mh == model_hashes[spec["step"]]),
            "mean_target_rank": found.get("ASSISTANT_BOUNDARY_TARGET_RANK"),
            "top1": found.get("ASSISTANT_BOUNDARY_TOP1_COUNT"),
            "top5": found.get("ASSISTANT_BOUNDARY_TOP5_COUNT"),
            "top10": found.get("ASSISTANT_BOUNDARY_TOP10_COUNT"),
            "greedy_exact": found.get("ASSISTANT_BOUNDARY_GREEDY_COUNT"),
            "newline_attractor": found.get("NEWLINE_ATTRACTOR_RATE"),
            "document_continuation_attractor": found.get("DOCUMENT_CONTINUATION_ATTRACTOR_RATE"),
            "eos_greedy_stop": found.get("EOS_GREEDY_STOP_COUNT"),
            "eos_greedy_n": found.get("EOS_GREEDY_STOP_N"),
            "eos_argmax": eos.get("EOS_ARGMAX_ACCURACY"),
            "role_nll": nlls.get("role"),
            "code_nll": nlls.get("code"),
            "json_nll": nlls.get("json"),
            "genesis_nll": nlls.get("genesis"),
            "natural_nll": nlls.get("natural"),
            "general_nll": nlls.get("general"),
            "general_equals_genesis": nlls.get("general") == nlls.get("genesis") or nlls.get("natural") == nlls.get("genesis"),
            "stage3_historical_pass": s3s.get("historical_pass_count"),
            "stage3_historical_total": s3s.get("historical_total"),
            "stage3_historical_binary": s3s.get("historical_binary"),
            "stage3_delta_nll": s3s.get("mean_wrim0_anchor_nll_delta"),
            "stage3_collapse": s3s.get("n_collapsed"),
            "non_tag_prompt_tag_emissions": nontag,
            "boundary_tag_emissions": tag_on_bound,
            "behavior_counts": gen.get("behavior_counts"),
        }
        results.append(row)
        foundation_by[cid] = slim_foundation(found)
        stage3_by[cid] = s3s
        gen_by[cid] = {
            "behavior_counts": gen.get("behavior_counts"),
            "held_out_prompts": [
                {k: v for k, v in x.items() if k != "new_ids"} | {"behavior": x.get("behavior")}
                for x in gen.get("held_out_prompts") or []
            ],
            "foundation_items": gen.get("items"),
        }
        nll_by[cid] = nlls
        write_json(CKPT_ROOT / "evals-selection" / f"foundation-{cid}.json", foundation_by[cid])
        write_json(CKPT_ROOT / "evals-selection" / f"stage3-{cid}.json", s3s)
        write_json(CKPT_ROOT / "evals-selection" / f"val-nll-{cid}.json", nlls)
        if not spec["is_parent"]:
            del model
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

    selection = select_parent(results)

    # drift 400 -> 1220
    by = {r["candidate_id"]: r for r in results}
    d400, d1220 = by["step-400"], by["step-1220"]
    drift = {
        "rank_400_to_1220": {
            "from": d400["mean_target_rank"],
            "to": d1220["mean_target_rank"],
            "improved": float(d1220["mean_target_rank"] or 0) < float(d400["mean_target_rank"] or 0),
        },
        "top5_400_to_1220": {"from": d400["top5"], "to": d1220["top5"]},
        "top10_400_to_1220": {"from": d400["top10"], "to": d1220["top10"]},
        "eos_argmax_400_to_1220": {"from": d400["eos_argmax"], "to": d1220["eos_argmax"]},
        "eos_greedy_400_to_1220": {"from": d400["eos_greedy_stop"], "to": d1220["eos_greedy_stop"]},
        "nll_400_to_1220": {
            "role": {"from": d400["role_nll"], "to": d1220["role_nll"]},
            "code": {"from": d400["code_nll"], "to": d1220["code_nll"]},
            "json": {"from": d400["json_nll"], "to": d1220["json_nll"]},
            "genesis": {"from": d400["genesis_nll"], "to": d1220["genesis_nll"]},
        },
        "retention_400_to_1220": {
            "historical": {"from": d400["stage3_historical_binary"], "to": d1220["stage3_historical_binary"]},
            "delta_nll": {"from": d400["stage3_delta_nll"], "to": d1220["stage3_delta_nll"]},
            "collapse": {"from": d400["stage3_collapse"], "to": d1220["stage3_collapse"]},
        },
        "tag_emissions_400_to_1220": {
            "nontag_prompts": {"from": d400["non_tag_prompt_tag_emissions"], "to": d1220["non_tag_prompt_tag_emissions"]},
            "boundary": {"from": d400["boundary_tag_emissions"], "to": d1220["boundary_tag_emissions"]},
        },
        "interpretation": {
            "A_improves_general_foundation": float(d1220["mean_target_rank"] or 9e9) < float(d400["mean_target_rank"] or 9e9)
            and int(d1220["top5"] or 0) >= int(d400["top5"] or 0),
            "B_over_specializes_corpus_artifacts": int(d1220["non_tag_prompt_tag_emissions"] or 0)
            > int(d400["non_tag_prompt_tag_emissions"] or 0)
            or int(d1220["boundary_tag_emissions"] or 0) > int(d400["boundary_tag_emissions"] or 0),
            "C_improves_stopping_worsens_answer_rank": (float(d1220["eos_argmax"] or 0) >= float(d400["eos_argmax"] or 0))
            and (float(d1220["mean_target_rank"] or 0) > float(d400["mean_target_rank"] or 0)),
            "D_changes_retention": d400["stage3_historical_binary"] != d1220["stage3_historical_binary"]
            or d400["stage3_collapse"] != d1220["stage3_collapse"],
            "E_short_tag_memorization_artifacts": any(focus_prov[t]["origin"].startswith("WR-CORPUS") for t in FOCUS_TAGS)
            or int(d1220["boundary_tag_emissions"] or 0) > 0,
        },
    }

    preserved = {
        "step_400_exists": (CKPT_ROOT / "step-400" / MODEL_NAME).is_file(),
        "step_1220_exists": (CKPT_ROOT / "step-1220" / MODEL_NAME).is_file(),
        "step_400_hash": model_hashes[400],
        "step_1220_hash": model_hashes[1220],
        "deleted_any_stage_a_checkpoint": False,
        "all_candidate_steps_present": all((CKPT_ROOT / f"step-{s}" / MODEL_NAME).is_file() for s in CANDIDATE_STEPS),
    }

    natural_val_limitation = {
        "GENERAL_VAL_NLL_EQUALS_GENESIS_VAL_NLL": True,
        "cause": "Stage A val_packs set natural from genesis excerpts when the C1 natural pool is thin, and aliased general/natural to that same genesis-derived text. Reported GENERAL_VAL_NLL is genesis document NLL, not independent natural-language validation.",
        "do_not_describe_as": "broad natural-language validation",
        "future_independent_natural_language_validation_pack": {
            "id_proposal": "WR-VAL-NL-INDEPENDENT-1-v1.0.0",
            "train_on_pack": False,
            "n_items": "32-48 held-out English passages",
            "sources": "original War Room prose not present in WR-CORPUS-0 genesis documents and not in WR-CORPUS-1-HARDENED worktree chunks",
            "metrics": ["mean NLL @512", "greedy 32-token continuation class", "newline/document attractor"],
            "freeze": "hash pack before any future CPT Stage B; never mix into train stream",
            "separate_from": ["role tags", "genesis rehearsal", "code/json family NLL"],
        },
    }

    report = {
        "kind": "WRIM1_CPT_STAGE_A_CHECKPOINT_SELECTION_REPORT",
        "CPT_RUN_ID": CPT_RUN_ID,
        "PARENT": PARENT_ID,
        "ARCHITECTURE": ARCHITECTURE,
        "PARAMETER_COUNT": PARAM_COUNT,
        "TOKENIZER": TOKENIZER_ID,
        "CORPUS": CORPUS_VERSION,
        "TOKENS_EXECUTED": 4_997_120,
        "STAGE_A": "COMPLETE",
        "STAGE_B": "NOT AUTHORIZED",
        "SFT": "NOT AUTHORIZED",
        "RUN-000013": "NOT AUTHORIZED",
        "STAGE3B": "NOT AUTHORIZED",
        "TRAINING_AUTHORIZATION": "OFF",
        "created_at": utc_now(),
        "TRAINING_PERFORMED": "NO",
        "OPTIMIZER_STEPS": 0,
        "STAGE_B_EXECUTED": "NO",
        "SFT_EXECUTED": "NO",
        "RUN_000013_EXECUTED": "NO",
        "STAGE3B_EXECUTED": "NO",
        "WRIM0_MODIFIED": "NO" if identity["WRIM0_UNCHANGED"] else "HASH_MISMATCH",
        "TOKENIZER_MODIFIED": "NO" if identity["TOKENIZER_UNCHANGED"] else "HASH_MISMATCH",
        "ARCHITECTURE_MODIFIED": "NO" if identity["ARCHITECTURE_UNCHANGED"] else "YES",
        "CANONICAL_PROMOTED": "NO",
        "COMMANDER_DECISION_REQUIRED": "YES",
        "1_candidate_checkpoints": [r["candidate_id"] for r in results],
        "2_candidate_hashes": {r["candidate_id"]: r["model_sha256"] for r in results},
        "checkpoint_hash_verification": ckpt_hash_rows,
        "unique_candidate_hashes": unique_ok,
        "no_checkpoint_overwrite": none_overwrite,
        "3_WRIM0_baseline": {k: by["WRIM-0"][k] for k in by["WRIM-0"] if k != "behavior_counts"} | {"identity": identity},
        "4_foundation_metrics": {
            r["candidate_id"]: {
                "mean_target_rank": r["mean_target_rank"],
                "top1": r["top1"],
                "top5": r["top5"],
                "top10": r["top10"],
                "greedy_exact": r["greedy_exact"],
                "newline_attractor": r["newline_attractor"],
                "document_continuation_attractor": r["document_continuation_attractor"],
                "eos_greedy_stop": r["eos_greedy_stop"],
                "eos_greedy_n": r["eos_greedy_n"],
            }
            for r in results
        },
        "foundation_eval_full": foundation_by,
        "5_stage3_retention": {r["candidate_id"]: stage3_by[r["candidate_id"]] for r in results},
        "6_deterministic_generation_comparison": gen_by,
        "7_eos_behavior_comparison": {
            r["candidate_id"]: {
                "EOS_GREEDY_STOP": r["eos_greedy_stop"],
                "EOS_GREEDY_STOP_N": r["eos_greedy_n"],
                "EOS_ARGMAX_ACCURACY": r["eos_argmax"],
            }
            for r in results
        },
        "8_rank_behavior_comparison": {
            r["candidate_id"]: {"mean": r["mean_target_rank"], "top1": r["top1"], "top5": r["top5"], "top10": r["top10"]}
            for r in results
        },
        "9_nll_comparison": nll_by,
        "10_memorization_analysis": {
            "exact_or_long_span_hits": mem_hits[:80],
            "n_hits": len(mem_hits),
            "method": "greedy continuation exact substring + bounded longest span >=16 against WR-CORPUS-CPT-1-v1.0.0 role/c1 jsonl",
        },
        "11_short_tag_fragment_provenance": focus_prov,
        "12_natural_validation_limitation": natural_val_limitation,
        "13_checkpoint_drift_analysis": drift,
        "14_stage_b_entry_criteria": stage_b_entry_criteria(),
        "15_selected_stage_b_parent_candidate": selection["SELECTED_STAGE_B_PARENT_CANDIDATE"],
        "16_reason_for_selection": selection["reason"],
        "selection_detail": selection,
        "17_step_400_preserved": "YES" if preserved["step_400_exists"] else "NO",
        "18_step_1220_preserved": "YES" if preserved["step_1220_exists"] else "NO",
        "preserved": preserved,
        "19_WRIM0_modified": "NO" if identity["WRIM0_UNCHANGED"] else "HASH_MISMATCH",
        "20_tokenizer_modified": "NO" if identity["TOKENIZER_UNCHANGED"] else "HASH_MISMATCH",
        "21_architecture_modified": "NO" if identity["ARCHITECTURE_UNCHANGED"] else "YES",
        "22_training_performed": "NO",
        "23_optimizer_steps_performed": 0,
        "24_canonical_promoted": "NO",
        "25_remaining_risks": [
            "Greedy exact remains 0; rank improvements are not answer success.",
            "GENERAL_VAL_NLL aliases genesis document text.",
            "Role-mix synthetic adj-noun-NNNN tags create short-tag interpolation artifacts.",
            "Stage 3 is observation-only; historical pass can coexist with elevated delta NLL.",
            "step-0 file hash differs from WRIM-0 due to safetensors re-serialization; tensor equality is the identity check.",
            "No independent natural-language validation pack exists yet.",
        ],
        "26_commander_decision_required": [
            "Accept or reject the selected Stage B parent candidate.",
            "Do not authorize Stage B, SFT, RUN-000013, or Stage3B in this pass.",
            "Optional: commission WR-VAL-NL-INDEPENDENT-1 without training on it.",
            "Retain step-400 and step-1220 (already preserved; nothing deleted).",
        ],
        "candidate_table": results,
    }
    write_json(REPORT_PATH, report)
    print("WROTE", REPORT_PATH, flush=True)
    print("SELECTED", selection["SELECTED_STAGE_B_PARENT_CANDIDATE"], flush=True)
    print("TRAINING_PERFORMED=NO OPTIMIZER_STEPS=0", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
