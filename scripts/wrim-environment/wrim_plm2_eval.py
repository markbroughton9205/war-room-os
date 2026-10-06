"""Held-out first-token curriculum metrics for WRIM1-PLM-000002. Inference only."""
from __future__ import annotations

from collections import defaultdict
from typing import Any

import torch
from tokenizers import Tokenizer

from wrim_cpt_eval import greedy_from_ids
from wrim_cpt_identity import EOS_ID
from wrim_g20m import WRIM0Model
from wrim_plm2_encode import encode_example, prefix_ids_for_inference
from wrim_plm2_identity import NEWLINE_TOKEN_ID


def _entropy(logits: torch.Tensor) -> float:
    p = torch.softmax(logits.float(), dim=-1)
    return float((-(p * torch.log(p.clamp_min(1e-12))).sum()).item())


def evaluate_prefix_heldout(
    *,
    model: WRIM0Model,
    tokenizer: Tokenizer,
    device: torch.device,
    rows: list[dict[str, Any]],
    max_new: int = 32,
) -> dict[str, Any]:
    ranks = []
    probs = []
    top1 = 0
    top5 = 0
    top10 = 0
    greedy_first = 0
    greedy_exact = 0
    greedy_short = 0
    greedy_stop = 0
    empty = 0
    ramble = 0
    nlls = []
    eos_ranks = []
    eos_probs = []
    eos_argmax = 0
    nl_argmax = 0
    nl_probs = []
    nl_logits = []
    tgt_logits = []
    gaps = []
    ents = []
    lengths = []
    by_cls: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "n": 0, "rank": 0.0, "prob": 0.0, "greedy": 0, "newline_argmax": 0,
    })
    items = []
    for rec in rows:
        enc = encode_example(tokenizer, rec)
        prefix = prefix_ids_for_inference(tokenizer, rec["prompt"])
        if prefix != [int(x) for x in enc["tokens"].tolist()[: enc["assistant_index"] + 1]]:
            raise ValueError(f"train/eval prefix mismatch for {rec['example_id']}")
        x = torch.tensor([prefix], dtype=torch.long, device=device)
        with torch.inference_mode():
            logits = model(x)[0, -1].float()
        order = torch.argsort(logits, descending=True)
        probs_t = torch.softmax(logits, dim=-1)
        tid = int(enc["first_target_id"])
        rank_t = torch.nonzero(order == tid, as_tuple=False)
        rank = int(rank_t[0].item()) + 1 if rank_t.numel() else None
        prob = float(probs_t[tid].item())
        argmax = int(order[0].item())
        nl_p = float(probs_t[NEWLINE_TOKEN_ID].item())
        nl_logit = float(logits[NEWLINE_TOKEN_ID].item())
        t_logit = float(logits[tid].item())
        if rank is not None:
            ranks.append(rank)
            if rank == 1:
                top1 += 1
            if rank <= 5:
                top5 += 1
            if rank <= 10:
                top10 += 1
        probs.append(prob)
        nl_probs.append(nl_p)
        nl_logits.append(nl_logit)
        tgt_logits.append(t_logit)
        gaps.append(t_logit - nl_logit)
        ents.append(_entropy(logits))
        if argmax == NEWLINE_TOKEN_ID or ("Ċ" in (tokenizer.id_to_token(argmax) or "")):
            nl_argmax += 1
        gen = greedy_from_ids(model, tokenizer, device, prefix, max_new=max_new)
        new_ids = list(gen.get("new_ids") or [])
        cont = (gen.get("continuation") or "").strip()
        target = str(rec["target"]).strip()
        first_match = bool(new_ids and new_ids[0] == tid)
        if first_match:
            greedy_first += 1
        exact = cont == target
        short_ok = exact or cont.startswith(target)
        if exact:
            greedy_exact += 1
        if short_ok:
            greedy_short += 1
        stopped = bool(gen.get("eos"))
        if stopped:
            greedy_stop += 1
        if not new_ids or (len(new_ids) == 1 and new_ids[0] == EOS_ID):
            empty += 1
        if (not stopped and len(new_ids) >= max_new) or (len(new_ids) >= 24 and not exact):
            ramble += 1
        lengths.append(len(new_ids))
        toks = [int(x) for x in enc["tokens"].tolist()]
        if len(toks) >= 3:
            with torch.inference_mode():
                lg = model(torch.tensor([toks[:-1]], dtype=torch.long, device=device))[0].float()
                logp = torch.log_softmax(lg, dim=-1)
                y = torch.tensor(toks[1:], dtype=torch.long, device=device)
                nll = -logp[torch.arange(y.numel(), device=device), y]
                sl = slice(int(enc["first_target_index"]) - 1, None)
                nlls.append(float(nll[sl].mean().item()))
                eos_lg = lg[-1]
            od = torch.argsort(eos_lg, descending=True)
            pr = torch.softmax(eos_lg, dim=-1)
            rt = torch.nonzero(od == EOS_ID, as_tuple=False)
            if rt.numel():
                eos_ranks.append(int(rt[0].item()) + 1)
            eos_probs.append(float(pr[EOS_ID].item()))
            if int(od[0].item()) == EOS_ID:
                eos_argmax += 1
        cls = str(rec.get("first_token_class") or target)
        d = by_cls[cls]
        d["n"] += 1
        d["rank"] += float(rank or 0)
        d["prob"] += prob
        d["greedy"] += int(first_match)
        d["newline_argmax"] += int(argmax == NEWLINE_TOKEN_ID or ("Ċ" in (tokenizer.id_to_token(argmax) or "")))
        items.append(
            {
                "example_id": rec["example_id"],
                "class": cls,
                "target": target,
                "rank": rank,
                "prob": prob,
                "argmax": tokenizer.id_to_token(argmax),
                "greedy": cont[:80],
                "greedy_first_match": first_match,
                "newline_argmax": argmax == NEWLINE_TOKEN_ID,
                "target_logit": t_logit,
                "newline_logit": nl_logit,
                "gap": t_logit - nl_logit,
            }
        )
    n = max(1, len(rows))
    class_rows = []
    for cls, d in sorted(by_cls.items()):
        nn = max(1, d["n"])
        class_rows.append(
            {
                "CLASS": cls,
                "VAL_COUNT": d["n"],
                "MEAN_TARGET_RANK": d["rank"] / nn,
                "MEAN_TARGET_PROB": d["prob"] / nn,
                "GREEDY_MATCH": d["greedy"],
                "NEWLINE_ARGMAX_RATE": d["newline_argmax"] / nn,
            }
        )
    return {
        "n": len(rows),
        "FIRST_TARGET_TOKEN_RANK": (sum(ranks) / len(ranks)) if ranks else None,
        "FIRST_TARGET_TOKEN_PROBABILITY": (sum(probs) / len(probs)) if probs else None,
        "FIRST_TARGET_TOP1_COUNT": top1,
        "FIRST_TARGET_TOP5_COUNT": top5,
        "FIRST_TARGET_TOP10_COUNT": top10,
        "GREEDY_FIRST_TOKEN_MATCH": greedy_first,
        "GREEDY_EXACT_ANSWER": greedy_exact,
        "GREEDY_SHORT_ANSWER_CORRECT": greedy_short,
        "GREEDY_STOPPING": greedy_stop,
        "TARGET_SEQUENCE_NLL": (sum(nlls) / len(nlls)) if nlls else None,
        "NEWLINE_ARGMAX_COUNT": nl_argmax,
        "NEWLINE_ARGMAX_RATE": nl_argmax / n,
        "NEWLINE_PROBABILITY": (sum(nl_probs) / len(nl_probs)) if nl_probs else None,
        "NEWLINE_LOGIT": (sum(nl_logits) / len(nl_logits)) if nl_logits else None,
        "TARGET_LOGIT": (sum(tgt_logits) / len(tgt_logits)) if tgt_logits else None,
        "TARGET_MINUS_NEWLINE_LOGIT_GAP": (sum(gaps) / len(gaps)) if gaps else None,
        "RESPONSE_ENTRY_ENTROPY": (sum(ents) / len(ents)) if ents else None,
        "EOS_MEAN_RANK": (sum(eos_ranks) / len(eos_ranks)) if eos_ranks else None,
        "EOS_MEAN_PROBABILITY": (sum(eos_probs) / len(eos_probs)) if eos_probs else None,
        "EOS_ARGMAX": eos_argmax,
        "RAMBLE_RATE": ramble / n,
        "EMPTY_RESPONSE_RATE": empty / n,
        "RESPONSE_LENGTH_MEAN": (sum(lengths) / len(lengths)) if lengths else None,
        "by_class": class_rows,
        "items": items,
    }
