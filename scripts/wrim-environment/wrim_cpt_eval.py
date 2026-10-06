"""WRIM-FOUNDATION-EVAL-1 + CPT diagnostics. Inference only. Does not train."""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

import torch
from tokenizers import Tokenizer

from stage2_eval import greedy_generate
from wrim_cpt_corpus import eval_root, load_jsonl
from wrim_cpt_identity import (
    ASSISTANT_ID,
    BOS_ID,
    COMMANDER_ID,
    FOUNDATION_EVAL_VERSION,
    NEWLINE_ID,
)
from wrim_g20m import WRIM0Model


def load_foundation_eval() -> dict[str, Any]:
    p = eval_root() / f"{FOUNDATION_EVAL_VERSION}.json"
    return json.loads(p.read_text(encoding="utf-8"))


def role_prefix_ids(tokenizer: Tokenizer, prompt: str) -> list[int]:
    body = list(tokenizer.encode(prompt, add_special_tokens=False).ids)
    return [BOS_ID, COMMANDER_ID, NEWLINE_ID, *body, ASSISTANT_ID, NEWLINE_ID]


def first_logits_ids(model: WRIM0Model, device: torch.device, ids: list[int]) -> torch.Tensor:
    x = torch.tensor([ids], dtype=torch.long, device=device)
    with torch.inference_mode():
        return model(x)[0, -1].detach()


def summarize_first(tokenizer: Tokenizer, logits: torch.Tensor, target_id: int | None) -> dict[str, Any]:
    lf = logits.float()
    probs = torch.softmax(lf, dim=-1)
    order = torch.argsort(lf, descending=True)
    argmax = int(order[0].item())
    top10 = []
    for i in range(10):
        tid = int(order[i].item())
        top10.append({"token": tokenizer.id_to_token(tid), "id": tid, "logit": float(lf[tid]), "prob": float(probs[tid])})
    out: dict[str, Any] = {
        "ARGMAX_TOKEN": tokenizer.id_to_token(argmax),
        "ARGMAX_LOGIT": float(lf[argmax]),
        "TOP_10": top10,
    }
    if target_id is not None and 0 <= int(target_id) < lf.numel():
        rank_t = torch.nonzero(order == int(target_id), as_tuple=False)
        rank = int(rank_t[0].item()) + 1 if rank_t.numel() else None
        tlog = float(lf[int(target_id)])
        out.update(
            {
                "TARGET_TOKEN": tokenizer.id_to_token(int(target_id)),
                "TARGET_LOGIT": tlog,
                "TARGET_RANK": rank,
                "LOGIT_GAP": tlog - float(lf[argmax]),
            }
        )
    return out


def nll_on_ids(model: WRIM0Model, device: torch.device, ids: list[int]) -> float | None:
    if len(ids) < 3:
        return None
    x = torch.tensor([ids[:-1]], dtype=torch.long, device=device)
    y = torch.tensor(ids[1:], dtype=torch.long, device=device)
    with torch.inference_mode():
        logits = model(x)[0]
        logp = torch.log_softmax(logits.float(), dim=-1)
        nll = -logp[torch.arange(y.numel(), device=device), y].mean()
    return float(nll.item())


def greedy_from_ids(model: WRIM0Model, tokenizer: Tokenizer, device: torch.device, ids: list[int], max_new: int = 32) -> dict[str, Any]:
    eos = tokenizer.token_to_id("<|eos|>") or 2
    new_ids: list[int] = []
    cur_ids = list(ids)
    with torch.inference_mode():
        cur = torch.tensor([cur_ids], dtype=torch.long, device=device)
        for _ in range(max_new):
            logits = model(cur)[0, -1]
            nxt = int(torch.argmax(logits).item())
            new_ids.append(nxt)
            cur_ids.append(nxt)
            if nxt == eos:
                break
            cur = torch.tensor([cur_ids], dtype=torch.long, device=device)
    text = tokenizer.decode(new_ids, skip_special_tokens=True)
    return {"new_ids": new_ids, "continuation": text, "eos": bool(new_ids and new_ids[-1] == eos)}


def attractor_rates(first_tokens: list[str]) -> dict[str, float]:
    n = max(1, len(first_tokens))
    return {
        "NEWLINE_ATTRACTOR_RATE": sum(1 for t in first_tokens if t and "Ċ" in t) / n,
        "BACKTICK_ATTRACTOR_RATE": sum(1 for t in first_tokens if t and "`" in t) / n,
        "COLON_ATTRACTOR_RATE": sum(1 for t in first_tokens if t in {":", "Ġ:"}) / n,
        "UNDERSCORE_ATTRACTOR_RATE": sum(1 for t in first_tokens if t and "_" in t) / n,
        "DOCUMENT_CONTINUATION_ATTRACTOR_RATE": sum(1 for t in first_tokens if t in {"Ċ", "Ġthe", "the", "Ġa", "ĠI"}) / n,
    }


def evaluate_foundation(*, model: WRIM0Model, tokenizer: Tokenizer, device: torch.device) -> dict[str, Any]:
    suite = load_foundation_eval()
    items = list(suite.get("items") or [])
    rows = []
    ranks = []
    top5 = 0
    greedy_hits = 0
    firsts = []
    eos_ok = 0
    eos_n = 0
    for it in items:
        mode = it.get("prompt_mode")
        prompt = str(it.get("prompt") or "")
        target = it.get("target")
        if mode == "role":
            ids = role_prefix_ids(tokenizer, prompt)
        elif mode == "commander_only":
            ids = [BOS_ID, COMMANDER_ID, NEWLINE_ID, *tokenizer.encode(prompt, add_special_tokens=False).ids]
        else:
            ids = [BOS_ID, *tokenizer.encode(prompt, add_special_tokens=False).ids]
        logits = first_logits_ids(model, device, ids)
        t0 = None
        if target:
            tid = tokenizer.encode(str(target), add_special_tokens=False).ids
            t0 = int(tid[0]) if tid else None
        summ = summarize_first(tokenizer, logits, t0)
        gen = greedy_from_ids(model, tokenizer, device, ids, max_new=32)
        firsts.append(summ.get("ARGMAX_TOKEN"))
        exact = False
        if target:
            cont = (gen.get("continuation") or "").strip()
            exact = cont == str(target) or cont.startswith(str(target))
            if exact:
                greedy_hits += 1
            if summ.get("TARGET_RANK") is not None:
                ranks.append(int(summ["TARGET_RANK"]))
                if int(summ["TARGET_RANK"]) <= 5:
                    top5 += 1
        if it.get("family") in {"eos_prediction", "stopping"} or (it.get("subtype") == "stopping"):
            eos_n += 1
            if gen.get("eos"):
                eos_ok += 1
        rows.append(
            {
                "item_id": it.get("item_id"),
                "family": it.get("family"),
                **{k: summ[k] for k in ("ARGMAX_TOKEN", "ARGMAX_LOGIT", "TARGET_TOKEN", "TARGET_LOGIT", "TARGET_RANK", "LOGIT_GAP") if k in summ},
                "TOP_10": summ.get("TOP_10"),
                "greedy": (gen.get("continuation") or "")[:160],
                "greedy_exact": exact,
                "eos": gen.get("eos"),
            }
        )
    n_ranked = max(1, len(ranks))
    return {
        "n": len(rows),
        "ASSISTANT_BOUNDARY_TARGET_RANK": (sum(ranks) / len(ranks)) if ranks else None,
        "ASSISTANT_BOUNDARY_TOP5_COUNT": top5,
        "ASSISTANT_BOUNDARY_TOP5_RATE": top5 / n_ranked,
        "ASSISTANT_BOUNDARY_GREEDY_COUNT": greedy_hits,
        "EOS_GREEDY_STOP_COUNT": eos_ok,
        "EOS_GREEDY_STOP_N": eos_n,
        **attractor_rates([str(x) for x in firsts]),
        "items": rows,
    }


def family_nll(*, model, device, packs: dict[str, list[int]]) -> dict[str, float | None]:
    out = {}
    for name, ids in packs.items():
        out[name] = nll_on_ids(model, device, ids[:512]) if ids else None
    return out
