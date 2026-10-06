"""Teacher-forced mode-entry diagnostics and basin classification for RUN-000010.

Diagnostics only. Does not modify evaluation prompts. Does not train.
"""
from __future__ import annotations

import re
from collections import Counter
from typing import Any

from run000009_diagnostics import LITERARY_MARKERS, SCHEMA_MARKERS, TOKENIZER_MARKERS, _first_ids, _token_ids, delta_teacher_force

def delta_teacher_force_me(now: dict[str, Any] | None, parent: dict[str, Any] | None) -> dict[str, Any]:
    n = (now or {}).get("instruction_stopping") or (now or {}).get("overall") or {}
    p = (parent or {}).get("instruction_stopping") or (parent or {}).get("overall") or {}
    wrapped_now = {"overall": n}
    wrapped_parent = {"overall": p}
    out = delta_teacher_force(wrapped_now, wrapped_parent)

    def d(key: str, *, lower_better: bool = False) -> dict[str, Any]:
        a = n.get(key)
        b = p.get(key)
        if a is None or b is None:
            return {"parent": b, "now": a, "delta": None, "improved": None}
        delta = float(a) - float(b)
        improved = (delta < 0) if lower_better else (delta > 0)
        return {"parent": b, "now": a, "delta": delta, "improved": improved}

    out["TARGET_STOP_TOKEN_RANK"] = d("TARGET_STOP_TOKEN_RANK", lower_better=True)
    out["MARGIN_BETWEEN_TARGET_FIRST_TOKEN_AND_ARGMAX"] = d("MARGIN_BETWEEN_TARGET_FIRST_TOKEN_AND_ARGMAX")
    return out


def teacher_force_item(*, model, tokenizer, device, ex: dict[str, Any]) -> dict[str, Any]:
    import torch

    bos = tokenizer.token_to_id("<|bos|>") or 1
    eos = tokenizer.token_to_id("<|eos|>") or 2
    prompt = str(ex.get("prompt") or "")
    target = str(ex.get("target") or "")
    prompt_ids = [int(bos), *_token_ids(tokenizer, prompt)]
    target_ids = _token_ids(tokenizer, target)
    cat = str(ex.get("category") or "")
    if not target_ids:
        return {
            "example_id": ex.get("example_id"),
            "category": cat,
            "ok": False,
            "reason": "empty_target_ids",
        }
    seq = prompt_ids + target_ids + [int(eos)]
    x = torch.tensor([seq[:-1]], dtype=torch.long, device=device)
    was = model.training
    model.eval()
    with torch.inference_mode():
        logits = model(x)[0]
    if was:
        model.train()
    prompt_end = len(prompt_ids) - 1
    first_logits = logits[prompt_end]
    finite = bool(torch.isfinite(first_logits).all().item())
    if not finite:
        return {
            "example_id": ex.get("example_id"),
            "category": cat,
            "ok": False,
            "reason": "nonfinite_logits",
        }
    probs = torch.softmax(first_logits.float(), dim=-1)
    first_id = int(target_ids[0])
    first_prob = float(probs[first_id].item()) if first_id < probs.numel() else None
    order = torch.argsort(probs, descending=True)
    rank_t = torch.nonzero(order == first_id, as_tuple=False)
    first_rank = int(rank_t[0].item()) + 1 if rank_t.numel() else None
    argmax_id = int(order[0].item()) if order.numel() else None
    argmax_prob = float(probs[argmax_id].item()) if argmax_id is not None and argmax_id < probs.numel() else None
    margin = None
    if first_prob is not None and argmax_prob is not None:
        margin = float(first_prob - argmax_prob)

    json_ids = _first_ids(tokenizer, ("{", "[", " {", "\n{"))
    code_ids = _first_ids(tokenizer, ("def", "class", "import", "from", "return", "```", "\n", "    "))
    json_mass = float(sum(float(probs[i].item()) for i in json_ids if i < probs.numel()))
    code_mass = float(sum(float(probs[i].item()) for i in code_ids if i < probs.numel()))

    nlls = []
    for i, tid in enumerate(target_ids):
        pos = prompt_end + i
        lg = logits[pos]
        if not bool(torch.isfinite(lg).all().item()):
            continue
        logp = torch.log_softmax(lg.float(), dim=-1)
        if tid < logp.numel():
            nlls.append(float(-logp[tid].item()))
    eos_logits = logits[prompt_end + len(target_ids)]
    eos_probs = torch.softmax(eos_logits.float(), dim=-1)
    eos_prob = float(eos_probs[int(eos)].item()) if int(eos) < eos_probs.numel() else None
    eos_order = torch.argsort(eos_probs, descending=True)
    eos_rank_t = torch.nonzero(eos_order == int(eos), as_tuple=False)
    eos_rank = int(eos_rank_t[0].item()) + 1 if eos_rank_t.numel() else None
    avg_nll = (sum(nlls) / len(nlls)) if nlls else None

    def dec(tid: int | None) -> str | None:
        if tid is None:
            return None
        try:
            return tokenizer.decode([int(tid)])
        except Exception:
            return None

    return {
        "example_id": ex.get("example_id"),
        "category": cat,
        "ok": True,
        "TARGET_FIRST_TOKEN_ID": first_id,
        "TARGET_TOKEN": dec(first_id),
        "ARGMAX_TOKEN_ID": argmax_id,
        "ARGMAX_TOKEN": dec(argmax_id),
        "TARGET_FIRST_TOKEN_PROBABILITY": first_prob,
        "TARGET_FIRST_TOKEN_RANK": first_rank,
        "MARGIN_BETWEEN_TARGET_FIRST_TOKEN_AND_ARGMAX": margin,
        "TARGET_SEQUENCE_AVG_NLL": avg_nll,
        "TARGET_SEQUENCE_PER_TOKEN_NLL": nlls[:48],
        "TARGET_SEQUENCE_N_TOKENS": len(target_ids),
        "EOS_PROBABILITY_AT_CORRECT_STOP": eos_prob,
        "TARGET_STOP_TOKEN_RANK": eos_rank,
        "PROBABILITY_MASS_ON_VALID_JSON_START": json_mass,
        "PROBABILITY_MASS_ON_CODE_START": code_mass,
    }


def teacher_force_capability(*, model, tokenizer, device, items: list[dict[str, Any]]) -> dict[str, Any]:
    rows = []
    by_cat: dict[str, list[dict[str, Any]]] = {"instruction": [], "json": [], "code": [], "stopping": []}
    for ex in items:
        row = teacher_force_item(model=model, tokenizer=tokenizer, device=device, ex=ex)
        rows.append(row)
        cat = str(row.get("category") or "")
        if cat in by_cat and row.get("ok"):
            by_cat[cat].append(row)

    def agg(vals: list[dict[str, Any]]) -> dict[str, Any]:
        probs = [float(v["TARGET_FIRST_TOKEN_PROBABILITY"]) for v in vals if v.get("TARGET_FIRST_TOKEN_PROBABILITY") is not None]
        ranks = [float(v["TARGET_FIRST_TOKEN_RANK"]) for v in vals if v.get("TARGET_FIRST_TOKEN_RANK") is not None]
        nlls = [float(v["TARGET_SEQUENCE_AVG_NLL"]) for v in vals if v.get("TARGET_SEQUENCE_AVG_NLL") is not None]
        eos = [float(v["EOS_PROBABILITY_AT_CORRECT_STOP"]) for v in vals if v.get("EOS_PROBABILITY_AT_CORRECT_STOP") is not None]
        stop_ranks = [float(v["TARGET_STOP_TOKEN_RANK"]) for v in vals if v.get("TARGET_STOP_TOKEN_RANK") is not None]
        margins = [float(v["MARGIN_BETWEEN_TARGET_FIRST_TOKEN_AND_ARGMAX"]) for v in vals if v.get("MARGIN_BETWEEN_TARGET_FIRST_TOKEN_AND_ARGMAX") is not None]
        json_m = [float(v["PROBABILITY_MASS_ON_VALID_JSON_START"]) for v in vals if v.get("PROBABILITY_MASS_ON_VALID_JSON_START") is not None]
        code_m = [float(v["PROBABILITY_MASS_ON_CODE_START"]) for v in vals if v.get("PROBABILITY_MASS_ON_CODE_START") is not None]
        return {
            "n": len(vals),
            "TARGET_FIRST_TOKEN_PROBABILITY": (sum(probs) / len(probs)) if probs else None,
            "TARGET_FIRST_TOKEN_RANK": (sum(ranks) / len(ranks)) if ranks else None,
            "TARGET_SEQUENCE_AVG_NLL": (sum(nlls) / len(nlls)) if nlls else None,
            "EOS_PROBABILITY_AT_CORRECT_STOP": (sum(eos) / len(eos)) if eos else None,
            "TARGET_STOP_TOKEN_RANK": (sum(stop_ranks) / len(stop_ranks)) if stop_ranks else None,
            "MARGIN_BETWEEN_TARGET_FIRST_TOKEN_AND_ARGMAX": (sum(margins) / len(margins)) if margins else None,
            "PROBABILITY_MASS_ON_VALID_JSON_START": (sum(json_m) / len(json_m)) if json_m else None,
            "PROBABILITY_MASS_ON_CODE_START": (sum(code_m) / len(code_m)) if code_m else None,
            "median_first_token_rank": (sorted(ranks)[len(ranks) // 2] if ranks else None),
        }

    overall = agg([r for r in rows if r.get("ok")])
    inst_stop = agg([r for r in rows if r.get("ok") and r.get("category") in {"instruction", "stopping"}])
    return {
        "n": len(rows),
        "ok_n": int(sum(1 for r in rows if r.get("ok"))),
        "overall": overall,
        "instruction_stopping": inst_stop,
        "by_category": {k: agg(v) for k, v in by_cat.items()},
        "items": rows,
    }


def classify_basin(text: str, gen: dict[str, Any] | None = None, *, category: str | None = None, correct: bool = False) -> str:
    gen = gen or {}
    ids = [int(x) for x in (gen.get("new_ids") or [])]
    max_run = int(gen.get("max_run") or gen.get("max_token_run") or 0)
    collapsed = bool(gen.get("collapsed"))
    first = ids[0] if ids else None
    second = ids[1] if len(ids) > 1 else None
    eos_pos = next((i for i, t in enumerate(ids) if t == 2), None)
    dom_id = None
    dom_n = 0
    if ids:
        dom_id, dom_n = Counter(ids).most_common(1)[0]
    blob = text or ""
    low = blob.lower()
    colon_underscore = (
        first == 32
        or (dom_id == 68 and dom_n >= 8)
        or bool(re.fullmatch(r"[:_\s]+", blob or ""))
        or blob[:8] in {":", "_", ":_", "_:"}
        or (first is not None and second == 32)
    )
    if colon_underscore:
        return "COLON_UNDERSCORE_ATTRACTOR"
    if collapsed or max_run >= 20:
        return "REPETITION_LOOP"
    if eos_pos is None and len(ids) >= 64:
        return "OVERLONG_CONTINUATION"
    if any(m in low for m in TOKENIZER_MARKERS):
        return "TOKENIZER_CHATTER"
    if any(m in low for m in LITERARY_MARKERS):
        return "LITERARY_CONTINUATION"
    if any(m in low for m in SCHEMA_MARKERS) and not blob.strip().startswith(("{", "[")):
        return "SCHEMA_CHATTER"
    if correct:
        return "EXPECTED_TASK_MODE"
    cat = (category or "").lower()
    stripped = blob.strip()
    if cat == "json" and stripped.startswith(("{", "[")):
        return "EXPECTED_TASK_MODE"
    if cat == "code" and (stripped.startswith(("def ", "class ", "import ", "return ", "```")) or stripped[:1] in {" ", "\t"}):
        return "EXPECTED_TASK_MODE"
    if cat in {"instruction", "stopping"} and 0 < len(stripped.split()) <= 8 and "\n\n" not in stripped:
        return "EXPECTED_TASK_MODE"
    return "OTHER"


def classify_eval_items(items: list[dict[str, Any]]) -> dict[str, Any]:
    counts = {
        "EXPECTED_TASK_MODE": 0,
        "COLON_UNDERSCORE_ATTRACTOR": 0,
        "LITERARY_CONTINUATION": 0,
        "TOKENIZER_CHATTER": 0,
        "SCHEMA_CHATTER": 0,
        "REPETITION_LOOP": 0,
        "OVERLONG_CONTINUATION": 0,
        "OTHER": 0,
    }
    rows = []
    for it in items:
        gen = it.get("descriptive_256") or it
        text = str(it.get("continuation") or gen.get("continuation") or "")
        label = classify_basin(
            text,
            gen,
            category=str(it.get("category") or ""),
            correct=bool(it.get("correct") or it.get("CORRECT")),
        )
        counts[label] = int(counts.get(label) or 0) + 1
        rows.append({"id": it.get("example_id") or it.get("item_id"), "basin": label})
    return {"counts": counts, "n": len(items), "items": rows}


def s3_inst_02_trace(tokenizer, ids: list[int], parent_ids: list[int] | None = None) -> dict[str, Any]:
    ids = [int(x) for x in ids]
    parent_ids = [int(x) for x in (parent_ids or [])]
    first = ids[0] if ids else None
    second = ids[1] if len(ids) > 1 else None
    changed = None
    for i, tid in enumerate(ids):
        if i >= len(parent_ids) or tid != parent_ids[i]:
            changed = i
            break
    eos_pos = next((i for i, t in enumerate(ids) if t == 2), None)
    max_run = 0
    run = 0
    prev = None
    for t in ids:
        if t == prev:
            run += 1
        else:
            run = 1
            prev = t
        if run > max_run:
            max_run = run
    dom_id, dom_n = (Counter(ids).most_common(1)[0] if ids else (None, 0))

    def dec(tid: int | None) -> str | None:
        if tid is None:
            return None
        try:
            return tokenizer.decode([int(tid)])
        except Exception:
            return None

    return {
        "FIRST_TOKEN": first,
        "SECOND_TOKEN": second,
        "FIRST_TOKEN_TEXT": dec(first),
        "SECOND_TOKEN_TEXT": dec(second),
        "FIRST_CHANGED_POSITION": changed,
        "MAX_IDENTICAL_TOKEN_RUN_256": max_run,
        "DOMINANT_TOKEN_ID": dom_id,
        "DOMINANT_TOKEN_TEXT": dec(dom_id),
        "DOMINANT_COUNT": int(dom_n),
        "UNIQUE_TOKEN_RATIO": (len(set(ids)) / len(ids)) if ids else None,
        "EOS_POSITION": eos_pos,
    }
