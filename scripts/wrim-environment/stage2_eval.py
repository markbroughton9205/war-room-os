"""Stage 2 local stability evaluation. DIAGNOSTIC-0 + EVAL-RETENTION. Not promotion."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import torch
from tokenizers import Tokenizer

from wrim_g20m import WRIM0Model

SPECIAL_IDS = set(range(9))
PERIOD_ID = 20
GEN_TOKENS = 32
EVAL_SEED = 42


def entropy_from_logits(logits: torch.Tensor) -> float:
    x = logits.float()
    x = x - x.max()
    p = torch.softmax(x, dim=-1)
    return float(-(p * torch.log(p.clamp_min(1e-12))).sum().item())


def greedy_generate(model: WRIM0Model, tokenizer: Tokenizer, prompt: str, device: torch.device, max_new: int = GEN_TOKENS) -> dict[str, Any]:
    bos = tokenizer.token_to_id("<|bos|>")
    eos = tokenizer.token_to_id("<|eos|>")
    body = tokenizer.encode(prompt, add_special_tokens=False).ids
    ids = [int(bos), *body]
    new_ids: list[int] = []
    first_logits = None
    was_training = model.training
    model.eval()
    with torch.inference_mode():
        cur = torch.tensor([ids], dtype=torch.long, device=device)
        for i in range(max_new):
            logits = model(cur)[0, -1]
            if i == 0:
                first_logits = logits.detach()
            nxt = int(torch.argmax(logits).item())
            new_ids.append(nxt)
            ids.append(nxt)
            if nxt == eos:
                break
            cur = torch.tensor([ids], dtype=torch.long, device=device)
    if was_training:
        model.train()
    continuation = tokenizer.decode(new_ids, skip_special_tokens=True)
    finite = True
    entropy = None
    p_period = None
    argmax_id = None
    argmax_prob = None
    if first_logits is not None:
        finite = bool(torch.isfinite(first_logits).all().item())
        entropy = entropy_from_logits(first_logits)
        argmax_id = int(torch.argmax(first_logits).item())
        probs = torch.softmax(first_logits.float(), dim=-1)
        argmax_prob = float(probs[argmax_id].item())
        if PERIOD_ID < probs.numel():
            p_period = float(probs[PERIOD_ID].item())
    max_run = 1
    run = 1
    for a, b in zip(new_ids, new_ids[1:]):
        run = run + 1 if a == b else 1
        max_run = max(max_run, run)
    uniq = (len(set(new_ids)) / len(new_ids)) if new_ids else None
    collapsed = bool(new_ids) and max_run >= max(6, len(new_ids) // 3)
    special_loop = False
    spec_run = 0
    last_spec = None
    for tid in new_ids:
        if tid in SPECIAL_IDS:
            spec_run = spec_run + 1 if tid == last_spec else 1
            last_spec = tid
            if spec_run >= 4:
                special_loop = True
                break
        else:
            spec_run = 0
            last_spec = None
    punct_dom = False
    if new_ids:
        punct = sum(1 for t in new_ids[:8] if t in (PERIOD_ID, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22))
        punct_dom = (new_ids[0] == PERIOD_ID) and (punct >= 6)
    return {
        "new_ids": new_ids,
        "continuation": continuation,
        "n_new": len(new_ids),
        "finite": finite,
        "entropy": entropy,
        "argmax_id": argmax_id,
        "argmax_prob": argmax_prob,
        "p_period": p_period,
        "unique_ratio": round(uniq, 4) if uniq is not None else None,
        "max_run": max_run,
        "collapsed": collapsed,
        "special_loop": special_loop,
        "period_first": bool(new_ids) and new_ids[0] == PERIOD_ID,
        "punct_dominated": punct_dom,
        "single_punct": bool(new_ids) and all(t == PERIOD_ID for t in new_ids),
    }


def load_diagnostic_items(dump_root: Path) -> list[dict]:
    path = dump_root / "model-lab" / "manifests" / "wrim1_1_recovery" / "test-only" / "WRIM-RECOVERY-DIAGNOSTIC-0-EXTENDED.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    return list(payload.get("items") or [])


def load_retention_items(dump_root: Path) -> list[dict]:
    path = dump_root / "model-lab" / "eval-only" / "WRIM-1.1-CAP-EVAL-0" / "suite.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    return [it for it in (payload.get("items") or []) if it.get("family") == "EVAL-RETENTION"]


def json_valid_from(item_id: str, prompt: str, continuation: str) -> bool | None:
    if item_id != "d0-json":
        return None
    for blob in (continuation, prompt + continuation):
        try:
            json.loads(blob)
            return True
        except Exception:
            continue
    return False


def score_retention(gen: dict, expected: dict) -> bool:
    uniq = gen.get("unique_ratio") or 0.0
    min_u = float(expected.get("min_unique_ratio") or 0.35)
    if expected.get("forbid_single_punct") and gen.get("single_punct"):
        return False
    if gen.get("collapsed"):
        return False
    return uniq >= min_u


def evaluate_stability(
    model: WRIM0Model,
    tokenizer: Tokenizer,
    device: torch.device,
    dump_root: Path,
    *,
    val_loss: float | None,
    train_loss: float | None,
    weight_hash: str,
) -> dict[str, Any]:
    items = load_diagnostic_items(dump_root)
    gens = []
    collapsed_n = 0
    uniq = []
    max_runs = []
    period_ps = []
    ents = []
    json_ok = None
    special_loop_n = 0
    period_first_n = 0
    punct_dom_n = 0
    for item in items:
        g = greedy_generate(model, tokenizer, item["input"], device)
        if g["collapsed"]:
            collapsed_n += 1
        if g["unique_ratio"] is not None:
            uniq.append(g["unique_ratio"])
        max_runs.append(g["max_run"])
        if g["p_period"] is not None:
            period_ps.append(g["p_period"])
        if g["entropy"] is not None:
            ents.append(g["entropy"])
        if g["special_loop"]:
            special_loop_n += 1
        if g["period_first"]:
            period_first_n += 1
        if g["punct_dominated"]:
            punct_dom_n += 1
        if item["id"] == "d0-json":
            json_ok = json_valid_from(item["id"], item["input"], g["continuation"])
        gens.append({"id": item["id"], "category": item["category"], "input": item["input"], **{k: v for k, v in g.items() if k != "new_ids"}, "new_ids": g["new_ids"][:32]})

    ret_items = load_retention_items(dump_root)
    ret_pass = 0
    ret_detail = []
    for it in ret_items:
        g = greedy_generate(model, tokenizer, it.get("generation_prompt") or it["prompt"], device)
        ok = score_retention(g, it.get("expected") or {})
        if ok:
            ret_pass += 1
        ret_detail.append(
            {
                "evalId": it.get("evalId"),
                "pass": ok,
                "unique_ratio": g["unique_ratio"],
                "collapsed": g["collapsed"],
                "entropy": g.get("entropy"),
                "max_run": g.get("max_run"),
                "argmax_id": g.get("argmax_id"),
                "argmax_prob": g.get("argmax_prob"),
                "p_period": g.get("p_period"),
                "continuation_fingerprint": hashlib.sha256((g.get("continuation") or "").encode("utf-8")).hexdigest()[:16],
                "continuation": (g["continuation"] or "")[:160],
            }
        )

    sky = next((x for x in gens if x["id"] == "d0-prose-sky"), None)
    return {
        "eval_seed": EVAL_SEED,
        "train_loss": train_loss,
        "validation_loss": val_loss,
        "collapsed_probes": collapsed_n,
        "n_probes": len(items),
        "mean_unique_ratio": float(sum(uniq) / len(uniq)) if uniq else None,
        "mean_max_run": float(sum(max_runs) / len(max_runs)) if max_runs else None,
        "max_token_run": int(max(max_runs) if max_runs else 0),
        "mean_entropy": float(sum(ents) / len(ents)) if ents else None,
        "mean_period_prob": float(sum(period_ps) / len(period_ps)) if period_ps else None,
        "generation_diversity": float(sum(uniq) / len(uniq)) if uniq else None,
        "special_token_loops": special_loop_n,
        "period_first_count": period_first_n,
        "punct_dominated_count": punct_dom_n,
        "json_valid": json_ok,
        "retention_pass": ret_pass,
        "retention_total": len(ret_items),
        "retention_family": f"{ret_pass}/{len(ret_items)}",
        "sky_argmax_id": None if sky is None else sky.get("argmax_id"),
        "sky_continuation": None if sky is None else sky.get("continuation"),
        "weight_hash": weight_hash,
        "diagnostic_items": gens,
        "retention_items": ret_detail,
    }


def sentinel_decision(step0: dict, now: dict, history: list[dict]) -> tuple[bool, str]:
    """Return (stop, reason). Commander Stage 2 rules."""
    floor = int(step0.get("collapsed_probes") or 0)
    collapse = int(now.get("collapsed_probes") or 0)
    if collapse >= floor + 2:
        return True, f"DIAGNOSTIC-0 collapsed {collapse} exceeds floor {floor}+2"
    ret0 = int(step0.get("retention_pass") or 0)
    ret = int(now.get("retention_pass") or 0)
    if ret <= ret0 - 1:
        return True, f"retention family {ret}/{now.get('retention_total')} dropped by >=1 vs step-0 {ret0}"
    uniq0 = float(step0.get("mean_unique_ratio") or 1.0)
    uniq = now.get("mean_unique_ratio")
    if uniq is not None and uniq0 > 0 and float(uniq) < 0.5 * uniq0:
        # two consecutive evals
        prior = history[-2] if len(history) >= 2 else None
        if prior is not None and prior.get("mean_unique_ratio") is not None and float(prior["mean_unique_ratio"]) < 0.5 * uniq0:
            return True, f"unique-token ratio {uniq} < 50% of WRIM-0 {uniq0} for two consecutive evals"
    if int(now.get("punct_dominated_count") or 0) >= 3:
        return True, "period/punctuation dominance on >=3 DIAGNOSTIC-0 prompts"
    if int(now.get("special_token_loops") or 0) > 0:
        return True, "special-token loop detected"
    if int(now.get("max_token_run") or 0) >= max(6, GEN_TOKENS // 3) and collapse >= floor + 1:
        # majority-run corroboration is already in collapsed_probes; hard stop only with period dominance above
        pass
    if now.get("json_valid") is False and step0.get("json_valid") is True:
        return True, "JSON-validity probes failed after passing at step-0"
    return False, ""
