"""Phase-1 role-control candidate search + gradient preflight. No optimizer.step."""
from __future__ import annotations

import hashlib
import json
import os
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from wrim_hvu_identity import (
    ASSISTANT_DELIMITER_POLICY,
    AUTHORIZE_ENV_NAME,
    DATA_ROOT,
    EVAL_SEED,
    EXPECTED_PARENT_MODEL_HASH,
    EXPERIMENTAL_PARENT_CKPT,
    GRAD_HARD,
    GRAD_REVIEW,
    MAX_ROLE_CANDIDATES,
    MICRO_BATCH,
    NEWLINE_TOKEN_ID,
    SEED,
    SEQ_LEN,
    TOKENIZER_EXPECTED_SHA,
)
from wrim_plm3_encode import encode_example, mask_report, pack_train_stream, slice_batches, validate_inference_match
from wrim_plm3_probe import _probe_one


GENERIC_PROMPTS = [
    "Reply.",
    "Go ahead.",
    "Please continue.",
    "Your turn.",
    "Speak.",
    "Answer now.",
    "Begin.",
    "Say something simple.",
    "Continue the reply.",
    "Please speak.",
    "You may answer.",
    "Start your reply.",
    "Give a short reply.",
    "Proceed.",
    "Talk.",
    "Respond.",
    "Please reply.",
    "Now you.",
    "Over to you.",
    "A short reply please.",
    "Keep it simple.",
    "One short reply.",
    "Go on.",
    "Please go on.",
    "Answer in ordinary words.",
    "Use a common word first.",
    "Begin with a common word.",
    "A plain reply.",
    "Ordinary speech please.",
    "Simple words only.",
    "Reply in plain words.",
    "Continue in plain words.",
    "Please begin now.",
    "You can start.",
    "Start now.",
    "A brief reply.",
]

# Held-out prompt stems (unseen wording, same task).
VAL_PROMPTS = [
    "Please start.",
    "Your reply.",
    "A common-word reply.",
    "Speak plainly.",
    "Begin the answer.",
    "Short ordinary reply.",
    "Go ahead and speak.",
    "Reply in simple speech.",
    "Now reply.",
    "Please talk.",
    "Continue simply.",
    "A plain answer.",
]


def _sha(p: Path) -> str:
    h = hashlib.sha256()
    h.update(p.read_bytes())
    return h.hexdigest()


def freeze_split(name: str, train: list[dict], val: list[dict]) -> dict[str, Any]:
    root = Path(DATA_ROOT) / name
    root.mkdir(parents=True, exist_ok=True)
    tr = root / "train.jsonl"
    va = root / "val.jsonl"
    tr.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in train), encoding="utf-8")
    va.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in val), encoding="utf-8")
    th, vh = _sha(tr), _sha(va)
    man = {
        "corpus_id": name,
        "kind": "ROLE_CONTROL_CANDIDATE",
        "train_sha256": th,
        "val_sha256": vh,
        "TRAIN_EXAMPLE_COUNT": len(train),
        "VAL_EXAMPLE_COUNT": len(val),
        "ASSISTANT_DELIMITER_POLICY": ASSISTANT_DELIMITER_POLICY,
    }
    blob = json.dumps({k: v for k, v in man.items()}, sort_keys=True, separators=(",", ":")).encode()
    mh = hashlib.sha256(blob).hexdigest()
    man["manifest_sha256"] = mh
    (root / "manifest.json").write_text(json.dumps(man, indent=2) + "\n", encoding="utf-8")
    ch = hashlib.sha256((th + vh + mh).encode()).hexdigest()
    (root / "CORPUS_HASH.txt").write_text(ch + "\n", encoding="utf-8")
    return {"ok": True, "root": str(root), "CORPUS_HASH": ch, "TRAIN_HASH": th, "VAL_HASH": vh, "MANIFEST_HASH": mh, "train": train, "val": val}


def make_items(prompts: list[str], targets: list[str], split: str, prefix: str) -> list[dict[str, Any]]:
    rows = []
    for i, prompt in enumerate(prompts):
        tgt = targets[i % len(targets)]
        first = tgt.split()[0]
        rows.append(
            {
                "example_id": f"{prefix}-{split}-{i:04d}",
                "family": f"role_{first}",
                "first_token_class": first,
                "prompt": prompt,
                "target": tgt,
                "provenance": "hvu-role-control-first-party",
            }
        )
    return rows


def leak_ok(train: list[dict], val: list[dict]) -> bool:
    tp = {(r["prompt"], r["target"]) for r in train}
    pp = {r["prompt"] for r in train}
    if any((r["prompt"], r["target"]) in tp or r["prompt"] in pp for r in val):
        return False
    return True


def pack_and_probe(model, tokenizer, device, train, first_w: float = 1.0) -> dict[str, Any]:
    import torch

    encoded = [encode_example(tokenizer, r) for r in train]
    if not all(validate_inference_match(tokenizer, r, e) for r, e in zip(train, encoded)):
        return {"ok": False, "reason": "boundary_fail"}
    mean_len = max(1, int(np.mean([int(e["tokens"].size) for e in encoded])))
    need = 10 * MICRO_BATCH * SEQ_LEN + 1
    while len(encoded) * mean_len * 60 < need:
        encoded = encoded + encoded
    n_later = [len(e["target_ids"]) - 1 for e in encoded]
    stream, mask = pack_train_stream(encoded)
    packed = mask_report(mask, first_w=first_w)
    batches = slice_batches(stream, mask)
    x_np, y_np, m_np = batches[0]
    x = torch.tensor(x_np, dtype=torch.long, device=device)
    y = torch.tensor(y_np, dtype=torch.long, device=device)
    y_mask = torch.tensor(m_np, dtype=torch.int8, device=device)
    probe = _probe_one(model=model, x=x, y=y, y_mask=y_mask, first_w=first_w)
    model.zero_grad(set_to_none=True)
    g = probe.get("total_unclipped_grad_norm")
    gate = "UNSAFE"
    if g is not None and g < GRAD_REVIEW:
        gate = "SAFE"
    elif g is not None and g < GRAD_HARD:
        gate = "REVIEW"
    return {
        "ok": True,
        "mean_later": float(np.mean(n_later)),
        "packed": {k: packed[k] for k in packed if k != "ok"},
        "first_batch": {
            "n_first": probe.get("n_first_supervised"),
            "n_later": probe.get("n_later_supervised"),
            "n_eos": probe.get("n_eos_supervised"),
        },
        "FIRST_TOKEN_CE": probe.get("FIRST_TOKEN_CE"),
        "LATER_TOKEN_CE": probe.get("LATER_TOKEN_CE"),
        "EOS_CE": probe.get("EOS_CE"),
        "weighted_loss": probe.get("weighted_loss"),
        "UNCLIPPED_GRAD_L2": g,
        "TIED_EMBED_OUTPUT_GRAD": probe.get("embedding_output_head_tied_grad_norm"),
        "GRAD_GATE": gate,
        "optimizer_step": False,
    }


def token_ce_bank(model, tokenizer, device, prompts: list[str], words: list[str]) -> list[dict[str, Any]]:
    import torch
    from wrim_cpt_identity import ASSISTANT_ID, BOS_ID, COMMANDER_ID

    rows = []
    with torch.inference_mode():
        for w in words:
            nlls = []
            ids = list(tokenizer.encode(w, add_special_tokens=False).ids)
            if len(ids) != 1:
                rows.append({"word": w, "n_pieces": len(ids), "skip": True})
                continue
            tid = ids[0]
            for p in prompts[:12]:
                raw = f"<|commander|>\n{p}<|assistant|>"
                body = list(tokenizer.encode(raw, add_special_tokens=False).ids)
                pref = [BOS_ID, *body]
                if pref[1] != COMMANDER_ID or pref[-1] != ASSISTANT_ID:
                    continue
                lg = model(torch.tensor([pref], dtype=torch.long, device=device))[0, -1].float()
                logp = torch.log_softmax(lg, dim=-1)
                nlls.append(float(-logp[tid].item()))
            rows.append(
                {
                    "word": w,
                    "token_id": tid,
                    "piece": tokenizer.id_to_token(tid),
                    "mean_nll_after_assistant": float(np.mean(nlls)) if nlls else None,
                    "n": len(nlls),
                }
            )
    rows = [r for r in rows if not r.get("skip")]
    rows.sort(key=lambda r: r["mean_nll_after_assistant"] if r["mean_nll_after_assistant"] is not None else 99)
    return rows


def main() -> dict[str, Any]:
    import torch
    from safetensors.torch import load_file as load_safetensors_file
    from tokenizers import Tokenizer

    from run000007_preflight import resolve_dump_root, sha256_file
    from wrim_g20m import WRIM0Model
    from wrim_proven_load import disable_tf32
    from wrim_resumable_checkpoint import MODEL_NAME

    os.environ[AUTHORIZE_ENV_NAME] = "OFF"
    dump = resolve_dump_root(None)
    assert dump is not None
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    assert sha256_file(tok_path) == TOKENIZER_EXPECTED_SHA
    tokenizer = Tokenizer.from_file(str(tok_path))
    parent = Path(EXPERIMENTAL_PARENT_CKPT) / MODEL_NAME
    assert sha256_file(parent) == EXPECTED_PARENT_MODEL_HASH

    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    model = WRIM0Model()
    model.load_state_dict(load_safetensors_file(str(parent)), strict=True)
    model.to(device)
    model.eval()

    words = [
        "the", "a", "I", "it", "is", "to", "and", "you", "we", "he", "she",
        "this", "that", "yes", "no", "ok", "here", "now", "do", "my", "name",
        "in", "of", "for", "on", "with", "as", "at", "be", "have", "not",
        "one", "two", "go", "stop", "good", "well", "so", "if", "or",
    ]
    bank = token_ce_bank(model, tokenizer, device, GENERIC_PROMPTS, words)
    easy = [r["word"] for r in bank if r["mean_nll_after_assistant"] is not None and r["mean_nll_after_assistant"] < 6.5][:8]
    mid = [r["word"] for r in bank if r["mean_nll_after_assistant"] is not None and 4.0 <= r["mean_nll_after_assistant"] < 8.0][:8]
    if len(easy) < 4:
        easy = [r["word"] for r in bank[:6]]
    if len(mid) < 4:
        mid = [r["word"] for r in bank[3:11]]

    # Phrase targets using easy unigrams; verify 2-3 later tokens.
    phrase_pool = []
    for a in easy[:4]:
        for b in ["is", "the", "a", "it"]:
            if a == b:
                continue
            t = f"{a} {b}"
            ids = tokenizer.encode(t, add_special_tokens=False).ids
            if 2 <= len(ids) <= 3:
                phrase_pool.append(t)
    if not phrase_pool:
        phrase_pool = [f"{easy[0]} is", f"{easy[0]} a"] if easy else ["the is"]

    long_pool = []
    for p in phrase_pool[:6]:
        t = p + " now"
        ids = tokenizer.encode(t, add_special_tokens=False).ids
        if 2 <= len(ids) <= 4:
            long_pool.append(t)
    if not long_pool:
        long_pool = phrase_pool

    train_p = GENERIC_PROMPTS[:]  # 36
    val_p = VAL_PROMPTS[:]  # 12

    candidates_spec = [
        ("C1_easy_unigram_eos", [w for w in easy], False, "easy unigram mix + EOS"),
        ("C2_easiest_singleton", easy[:2] or easy, False, "1-2 lowest-CE unigrams + EOS"),
        ("C3_easy_bigram_eos", phrase_pool[:8] or easy, False, "easy 2-token phrase + EOS"),
        ("C4_high_density_short_prompt", easy, False, "same easy unigrams, more copies of short prompts"),
        ("C5_mid_unigram_eos", mid or easy, False, "mid-CE common unigrams + EOS"),
        ("C6_easy_trigram_eos", long_pool[:8] or phrase_pool, False, "easy 3-token phrase + EOS"),
    ]

    model.train()
    results = []
    for i, (cid, tgts, _no_eos, why) in enumerate(candidates_spec[:MAX_ROLE_CANDIDATES]):
        if cid == "C4_high_density_short_prompt":
            tr_prompts = (["Reply.", "Begin.", "Speak.", "Go."] * 18)[:72]
            va_prompts = (["Please start.", "Now reply.", "Talk."] * 4)[:12]
        else:
            tr_prompts = train_p
            va_prompts = val_p
        train = make_items(tr_prompts, tgts, "train", cid.lower())
        val = make_items(va_prompts, tgts, "val", cid.lower())
        if not leak_ok(train, val):
            # uniqueness: append a tag to val prompts
            val = make_items([p + " Thanks." for p in va_prompts], tgts, "val", cid.lower())
        if not leak_ok(train, val):
            results.append({"id": cid, "ok": False, "reason": "leak"})
            continue
        frozen = freeze_split(f"WR-CORPUS-HVU-ROLE-{cid}-v1.0.0", train, val)
        probe = pack_and_probe(model, tokenizer, device, train, first_w=1.0)
        row = {
            "id": cid,
            "why": why,
            "targets": tgts[:12],
            "n_train": len(train),
            "n_val": len(val),
            "CORPUS_HASH": frozen["CORPUS_HASH"],
            "root": frozen["root"],
            **probe,
        }
        results.append(row)

    safe = [r for r in results if r.get("GRAD_GATE") == "SAFE"]
    review = [r for r in results if r.get("GRAD_GATE") == "REVIEW"]
    chosen = None
    if safe:
        chosen = min(safe, key=lambda r: (r["UNCLIPPED_GRAD_L2"], r.get("FIRST_TOKEN_CE") or 99))
    status = "SAFE_CURRICULUM_FOUND" if chosen else "ROLE_CONTROL_STATE_POSITIVE_TRAINING_BLOCKED"
    if not chosen and len(results) >= MAX_ROLE_CANDIDATES:
        status = "ROLE_CONTROL_STATE_POSITIVE_TRAINING_BLOCKED"

    report = {
        "ok": True,
        "kind": "WRIM_HVU_ROLE_CONTROL_CANDIDATE_SEARCH",
        "token_ce_bank": bank[:25],
        "easy_words": easy,
        "mid_words": mid,
        "candidates": results,
        "CHOSEN": None if chosen is None else chosen["id"],
        "STATUS": status,
        "n_safe": len(safe),
        "n_review": len(review),
        "TRAINING_AUTHORIZATION": "OFF",
        "optimizer_step": False,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    out = Path(DATA_ROOT) / "WRIM_HVU_ROLE_CONTROL_CANDIDATE_SEARCH.json"
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


if __name__ == "__main__":
    obj = main()
    print(json.dumps({k: obj[k] for k in ("STATUS", "CHOSEN", "easy_words", "mid_words", "n_safe", "n_review")}, indent=2))
    print("--- BANK ---")
    print(json.dumps(obj["token_ce_bank"][:15], indent=2))
    print("--- CANDIDATES ---")
    slim = [{k: r.get(k) for k in ("id", "GRAD_GATE", "UNCLIPPED_GRAD_L2", "FIRST_TOKEN_CE", "LATER_TOKEN_CE", "EOS_CE", "weighted_loss", "targets", "first_batch")} for r in obj["candidates"]]
    print(json.dumps(slim, indent=2))
