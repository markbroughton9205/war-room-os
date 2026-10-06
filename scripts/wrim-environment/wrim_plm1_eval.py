"""Held-out prefix-LM metrics for WRIM1-PLM-000001. Inference only."""
from __future__ import annotations

from typing import Any

import torch
from tokenizers import Tokenizer

from wrim_cpt_eval import greedy_from_ids
from wrim_g20m import WRIM0Model
from wrim_plm1_encode import encode_example, prefix_ids_for_inference
from wrim_cpt_identity import EOS_ID


def _nll_target(model: WRIM0Model, device: torch.device, tokens: list[int], first_target_index: int) -> float | None:
    if first_target_index <= 0 or first_target_index >= len(tokens):
        return None
    x = torch.tensor([tokens[:-1]], dtype=torch.long, device=device)
    y = torch.tensor(tokens[1:], dtype=torch.long, device=device)
    with torch.inference_mode():
        logits = model(x)[0]
        logp = torch.log_softmax(logits.float(), dim=-1)
        # positions whose y is a target token or EOS: indices first_target_index-1 .. end
        sl = slice(first_target_index - 1, None)
        nll = -logp[torch.arange(y.numel(), device=device), y][sl].mean()
    return float(nll.item())


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
    top5 = 0
    top10 = 0
    greedy_first = 0
    greedy_exact = 0
    greedy_short = 0
    greedy_stop = 0
    empty = 0
    ramble = 0
    n_two = 0
    token1_ok = 0
    token2_given_greedy_t1 = 0
    token2_given_gold_t1 = 0
    greedy_two_exact = 0
    eos_after_two = 0
    two_classes = {}
    n_three = 0
    greedy_three_exact = 0
    token3_given_gold = 0
    token3_given_greedy = 0
    eos_after_three = 0
    three_classes = {}
    nlls = []
    eos_ranks = []
    eos_probs = []
    eos_argmax = 0
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
        if rank is not None:
            ranks.append(rank)
            if rank <= 5:
                top5 += 1
            if rank <= 10:
                top10 += 1
        probs.append(prob)
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
        nll = _nll_target(model, device, [int(x) for x in enc["tokens"].tolist()], int(enc["first_target_index"]))
        if nll is not None:
            nlls.append(nll)
        tgt_ids = [int(x) for x in enc["target_ids"]]
        cls = str(rec.get("first_token_class") or rec.get("target") or "unk")
        t2_g = None
        t2_gold = None
        two_ex = None
        eos2 = None
        t2_rank = None
        t2_prob = None
        t2_ce = None
        if len(tgt_ids) >= 2:
            n_two += 1
            token1_ok += int(first_match)
            two_ex = bool(len(new_ids) >= 2 and new_ids[0] == tgt_ids[0] and new_ids[1] == tgt_ids[1])
            if two_ex:
                greedy_two_exact += 1
            t2_g = bool(first_match and len(new_ids) >= 2 and new_ids[1] == tgt_ids[1])
            if t2_g:
                token2_given_greedy_t1 += 1
            gold_pref = prefix + [tgt_ids[0]]
            with torch.inference_mode():
                lg2 = model(torch.tensor([gold_pref], dtype=torch.long, device=device))[0, -1].float()
            t2_gold = int(lg2.argmax().item()) == tgt_ids[1]
            if t2_gold:
                token2_given_gold_t1 += 1
            od2 = torch.argsort(lg2, descending=True)
            pr2 = torch.softmax(lg2, dim=-1)
            hit2 = torch.nonzero(od2 == tgt_ids[1], as_tuple=False)
            t2_rank = int(hit2[0].item()) + 1 if hit2.numel() else None
            t2_prob = float(pr2[tgt_ids[1]].item())
            t2_ce = float((-torch.log(pr2[tgt_ids[1]].clamp_min(1e-12))).item())
            gold2 = prefix + tgt_ids[:2]
            with torch.inference_mode():
                lge = model(torch.tensor([gold2], dtype=torch.long, device=device))[0, -1].float()
            eos2 = int(lge.argmax().item()) == EOS_ID
            if eos2:
                eos_after_two += 1
            bucket = two_classes.setdefault(
                cls,
                {
                    "n": 0,
                    "t1": 0,
                    "t2_greedy": 0,
                    "two_exact": 0,
                    "t2_gold": 0,
                    "t2_rank": [],
                    "t2_prob": [],
                    "t2_ce": [],
                    "eos_after": 0,
                },
            )
            bucket["n"] += 1
            bucket["t1"] += int(first_match)
            bucket["t2_greedy"] += int(t2_g)
            bucket["two_exact"] += int(two_ex)
            bucket["t2_gold"] += int(t2_gold)
            bucket["eos_after"] += int(eos2)
            if t2_rank is not None:
                bucket["t2_rank"].append(t2_rank)
            bucket["t2_prob"].append(t2_prob)
            bucket["t2_ce"].append(t2_ce)
        t3_g = None
        t3_gold = None
        three_ex = None
        eos3 = None
        t3_rank = None
        t3_prob = None
        t3_ce = None
        if len(tgt_ids) >= 3:
            n_three += 1
            three_ex = bool(len(new_ids) >= 3 and new_ids[0] == tgt_ids[0] and new_ids[1] == tgt_ids[1] and new_ids[2] == tgt_ids[2])
            if three_ex:
                greedy_three_exact += 1
            t3_g = bool(len(new_ids) >= 3 and new_ids[0] == tgt_ids[0] and new_ids[1] == tgt_ids[1] and new_ids[2] == tgt_ids[2])
            if t3_g:
                token3_given_greedy += 1
            gold_pref = prefix + tgt_ids[:2]
            with torch.inference_mode():
                lg3 = model(torch.tensor([gold_pref], dtype=torch.long, device=device))[0, -1].float()
            t3_gold = int(lg3.argmax().item()) == tgt_ids[2]
            if t3_gold:
                token3_given_gold += 1
            od3 = torch.argsort(lg3, descending=True)
            pr3 = torch.softmax(lg3, dim=-1)
            hit3 = torch.nonzero(od3 == tgt_ids[2], as_tuple=False)
            t3_rank = int(hit3[0].item()) + 1 if hit3.numel() else None
            t3_prob = float(pr3[tgt_ids[2]].item())
            t3_ce = float((-torch.log(pr3[tgt_ids[2]].clamp_min(1e-12))).item())
            gold3 = prefix + tgt_ids[:3]
            with torch.inference_mode():
                lge3 = model(torch.tensor([gold3], dtype=torch.long, device=device))[0, -1].float()
            eos3 = int(lge3.argmax().item()) == EOS_ID
            if eos3:
                eos_after_three += 1
            b3 = three_classes.setdefault(
                cls,
                {"n": 0, "three_exact": 0, "t3_gold": 0, "t3_greedy": 0, "t3_rank": [], "t3_prob": [], "t3_ce": [], "eos_after": 0},
            )
            b3["n"] += 1
            b3["three_exact"] += int(three_ex)
            b3["t3_gold"] += int(t3_gold)
            b3["t3_greedy"] += int(t3_g)
            b3["eos_after"] += int(eos3)
            if t3_rank is not None:
                b3["t3_rank"].append(t3_rank)
            b3["t3_prob"].append(t3_prob)
            b3["t3_ce"].append(t3_ce)
        # EOS rank at last target token position (predict EOS after target)
        toks = [int(x) for x in enc["tokens"].tolist()]
        if len(toks) >= 3:
            with torch.inference_mode():
                lg = model(torch.tensor([toks[:-1]], dtype=torch.long, device=device))[0, -1].float()
            od = torch.argsort(lg, descending=True)
            pr = torch.softmax(lg, dim=-1)
            rt = torch.nonzero(od == EOS_ID, as_tuple=False)
            if rt.numel():
                er = int(rt[0].item()) + 1
                eos_ranks.append(er)
            eos_probs.append(float(pr[EOS_ID].item()))
            if int(od[0].item()) == EOS_ID:
                eos_argmax += 1
        items.append(
            {
                "example_id": rec["example_id"],
                "target": target,
                "rank": rank,
                "prob": prob,
                "argmax": tokenizer.id_to_token(argmax),
                "greedy": cont[:160],
                "greedy_first_match": first_match,
                "greedy_exact": exact,
                "TOKEN2_GIVEN_GREEDY_TOKEN1": t2_g,
                "TOKEN2_GIVEN_GOLD_TOKEN1": t2_gold,
                "GREEDY_TWO_TOKEN_EXACT": two_ex,
                "EOS_AFTER_TWO_TOKEN": eos2,
                "TOKEN2_RANK": t2_rank,
                "TOKEN2_PROBABILITY": t2_prob,
                "TOKEN2_CE": t2_ce,
                "TOKEN3_GIVEN_GOLD_PREFIX": t3_gold,
                "TOKEN3_GIVEN_GREEDY_PREFIX": t3_g,
                "GREEDY_THREE_TOKEN_EXACT": three_ex,
                "EOS_AFTER_TOKEN3": eos3,
                "TOKEN3_RANK": t3_rank,
                "TOKEN3_PROBABILITY": t3_prob,
                "TOKEN3_CE": t3_ce,
                "eos": stopped,
                "nll": nll,
            }
        )
    n = max(1, len(rows))
    t2_ranks_all: list[int] = []
    t2_probs_all: list[float] = []
    t2_ces_all: list[float] = []
    slim_two: dict[str, Any] = {}
    for k, v in two_classes.items():
        t2_ranks_all.extend(v.get("t2_rank") or [])
        t2_probs_all.extend(v.get("t2_prob") or [])
        t2_ces_all.extend(v.get("t2_ce") or [])
        slim_two[k] = {
            "n": v["n"],
            "TOKEN1_GREEDY_CORRECT": v["t1"],
            "TOKEN2_GREEDY_CORRECT": v.get("t2_greedy", 0),
            "TOKEN2_GIVEN_GOLD_TOKEN1": v["t2_gold"],
            "TWO_TOKEN_EXACT": v["two_exact"],
            "TOKEN2_RANK": (sum(v["t2_rank"]) / len(v["t2_rank"])) if v.get("t2_rank") else None,
            "TOKEN2_PROBABILITY": (sum(v["t2_prob"]) / len(v["t2_prob"])) if v.get("t2_prob") else None,
            "TOKEN2_CE": (sum(v["t2_ce"]) / len(v["t2_ce"])) if v.get("t2_ce") else None,
            "EOS_AFTER_TOKEN2": v.get("eos_after", 0),
        }
    slim_three: dict[str, Any] = {}
    t3_ranks_all: list[int] = []
    t3_ces_all: list[float] = []
    for k, v in three_classes.items():
        t3_ranks_all.extend(v.get("t3_rank") or [])
        t3_ces_all.extend(v.get("t3_ce") or [])
        slim_three[k] = {
            "n": v["n"],
            "THREE_TOKEN_EXACT": v["three_exact"],
            "TOKEN3_GIVEN_GOLD_PREFIX": v["t3_gold"],
            "TOKEN3_GIVEN_GREEDY_PREFIX": v["t3_greedy"],
            "TOKEN3_RANK": (sum(v["t3_rank"]) / len(v["t3_rank"])) if v.get("t3_rank") else None,
            "TOKEN3_CE": (sum(v["t3_ce"]) / len(v["t3_ce"])) if v.get("t3_ce") else None,
            "EOS_AFTER_TOKEN3": v.get("eos_after", 0),
        }
    return {
        "n": len(rows),
        "FIRST_TARGET_TOKEN_RANK": (sum(ranks) / len(ranks)) if ranks else None,
        "FIRST_TARGET_TOKEN_PROBABILITY": (sum(probs) / len(probs)) if probs else None,
        "FIRST_TARGET_TOP5_COUNT": top5,
        "FIRST_TARGET_TOP10_COUNT": top10,
        "GREEDY_FIRST_TOKEN_MATCH": greedy_first,
        "GREEDY_EXACT_ANSWER": greedy_exact,
        "GREEDY_SHORT_ANSWER_CORRECT": greedy_short,
        "GREEDY_STOPPING": greedy_stop,
        "TARGET_SEQUENCE_NLL": (sum(nlls) / len(nlls)) if nlls else None,
        "EOS_MEAN_RANK": (sum(eos_ranks) / len(eos_ranks)) if eos_ranks else None,
        "EOS_MEAN_PROBABILITY": (sum(eos_probs) / len(eos_probs)) if eos_probs else None,
        "EOS_ARGMAX": eos_argmax,
        "RAMBLE_RATE": ramble / n,
        "EMPTY_RESPONSE_RATE": empty / n,
        "RESPONSE_LENGTH_MEAN": None,
        "N_TWO_TOKEN": n_two,
        "TOKEN1_CORRECT": token1_ok,
        "TOKEN2_GIVEN_GREEDY_TOKEN1_CORRECT": token2_given_greedy_t1,
        "TOKEN2_GIVEN_GOLD_TOKEN1_CORRECT": token2_given_gold_t1,
        "GREEDY_TWO_TOKEN_EXACT": greedy_two_exact,
        "EOS_AFTER_TWO_TOKEN": eos_after_two,
        "TOKEN2_RANK": (sum(t2_ranks_all) / len(t2_ranks_all)) if t2_ranks_all else None,
        "TOKEN2_PROBABILITY": (sum(t2_probs_all) / len(t2_probs_all)) if t2_probs_all else None,
        "TOKEN2_CE": (sum(t2_ces_all) / len(t2_ces_all)) if t2_ces_all else None,
        "TWO_TOKEN_BY_CLASS": slim_two,
        "N_CLASSES_GREEDY_TWO_TOKEN": sum(1 for v in slim_two.values() if (v.get("TWO_TOKEN_EXACT") or 0) > 0),
        "N_THREE_TOKEN": n_three,
        "GREEDY_THREE_TOKEN_EXACT": greedy_three_exact,
        "TOKEN3_GIVEN_GOLD_PREFIX": token3_given_gold,
        "TOKEN3_GIVEN_GREEDY_PREFIX": token3_given_greedy,
        "EOS_AFTER_TOKEN3": eos_after_three,
        "TOKEN3_RANK": (sum(t3_ranks_all) / len(t3_ranks_all)) if t3_ranks_all else None,
        "TOKEN3_CE": (sum(t3_ces_all) / len(t3_ces_all)) if t3_ces_all else None,
        "THREE_TOKEN_BY_CLASS": slim_three,
        "N_CLASSES_GREEDY_THREE_TOKEN": sum(1 for v in slim_three.values() if (v.get("THREE_TOKEN_EXACT") or 0) > 0),
        "items": items,
    }
