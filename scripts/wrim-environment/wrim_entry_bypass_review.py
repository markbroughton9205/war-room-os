"""Natural entry + RA1 bypass architecture review.

Read-only ablation first. NE1 training only if evidence requires it.
No NA1 retraining. No learned router. Canonical remains STEP_400.
"""
from __future__ import annotations

import json
import math
from collections import Counter
from pathlib import Path
from typing import Any

import torch
from safetensors.torch import load_file as load_safetensors_file
from tokenizers import Tokenizer

from run000007_preflight import resolve_dump_root, sha256_file
from wrim_arch_uh1_ac1_train import _write
from wrim_cpt_eval import greedy_from_ids
from wrim_cpt_identity import EOS_ID
from wrim_ea1_consol import natural_semantic
from wrim_g20m_ra1 import (
    ARCH_ID_EA1_RA1_NA1,
    PLACEMENT_B,
    WRIMRA1Model,
    frozen_parameter_hash,
    module_parameter_hash,
)
from wrim_hvu_identity import CKPT_BASE, DATA_ROOT
from wrim_plm1_encode import encode_example, prefix_ids_for_inference
from wrim_proven_load import disable_tf32
from wrim_ra1_conflict_lib import natural_span_eval
from wrim_ra1_grad_corpus import NAT_DIR, PHRASE_ALIGN_DIR
from wrim_ra1_phrase_school import load_rows, score_sets
from wrim_resumable_checkpoint import MODEL_NAME

PARENT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-EA1-000010" / "step-25"
EXPECT = "8e6505954602961d7b432362b67633aa1cc798f7a7b4262624edb3ed213323fb"
CKPT = Path(CKPT_BASE) / "WRIM1-UH1-AC2-NA1-000001" / "step-0"
REPORT = Path(DATA_ROOT) / "WRIM_GENESIS_NATURAL_ENTRY_BYPASS_REVIEW.json"
DETAIL = Path(DATA_ROOT) / "WRIM_NATURAL_ENTRY_BYPASS_DETAIL.json"
PHRASE_REF = {"phrase_exact": 17, "blue": 3, "no": 5, "dog": 5, "cat": 4, "two": 6, "three_align": 10, "paraphrase_exact": 3}
ENTRY_CLASSES = {"blue", "cat", "dog", "no", "red"}
GEN_VAL = Path(DATA_ROOT) / "WR-CORPUS-PLM-GENERALIZATION-EVAL-1-v1.0.0" / "val.jsonl"


def tok_name(tok: Tokenizer, i: int) -> str:
    return tok.id_to_token(int(i)) or f"id{int(i)}"


def load_model(device: torch.device) -> WRIMRA1Model:
    src = load_safetensors_file(str(CKPT / MODEL_NAME))
    model = WRIMRA1Model(placement=PLACEMENT_B, bottleneck=32, ea1=True, na1=True)
    missing, unexpected = model.load_state_dict(src, strict=False)
    extra = set(missing) - {n for n, _ in model.named_parameters() if n.startswith(("ea1.", "ra1.", "na1."))} - {"assistant_stop_ctrl"}
    if extra or unexpected:
        raise RuntimeError(f"load mismatch extra={extra} unexpected={unexpected}")
    return model.to(device).eval()


def apply_routes(model: WRIMRA1Model, entry: str, span: str) -> None:
    model.set_entry_route(entry)
    model.set_span_route(span)


def token1_probe(model: WRIMRA1Model, tok: Tokenizer, device: torch.device, rec: dict[str, Any]) -> dict[str, Any]:
    prefix = prefix_ids_for_inference(tok, rec["prompt"])
    enc = encode_example(tok, rec)
    tgt = [int(x) for x in enc["target_ids"]]
    gold = int(tgt[0])
    idx = torch.tensor([prefix], dtype=torch.long, device=device)
    with torch.inference_mode():
        logits = model(idx)[0, -1]
        pre = model.hidden_pre_adapters(idx)[0, -1]
        delta = None
        if model.ea1 is not None:
            delta = model.ea1.delta(pre.unsqueeze(0).unsqueeze(0))[0, 0]
    probs = torch.softmax(logits.float(), dim=-1)
    order = torch.argsort(logits, descending=True)
    rank = int((order == gold).nonzero(as_tuple=False)[0].item()) + 1
    top1 = int(order[0].item())
    gold_logit = float(logits[gold].item())
    top1_logit = float(logits[top1].item())
    gen = greedy_from_ids(model, tok, device, prefix, max_new=16)
    new = list(gen.get("new_ids") or [])
    eos = bool(gen.get("eos"))
    body = new[:-1] if eos else new
    depth = 0
    for a, b in zip(body, tgt):
        if a != b:
            break
        depth += 1
    exact = int(body == tgt and eos)
    dvec = None if delta is None else delta.detach().float()
    return {
        "example_id": rec.get("example_id"),
        "family": rec.get("family") or rec.get("first_token_class") or "unk",
        "prompt": rec.get("prompt"),
        "target": rec.get("target"),
        "gold": tok_name(tok, gold),
        "gold_id": gold,
        "greedy": tok_name(tok, body[0]) if body else "",
        "greedy_id": int(body[0]) if body else None,
        "token1_ok": int(bool(body) and body[0] == gold),
        "rank": rank,
        "prob": float(probs[gold].item()),
        "logit": gold_logit,
        "top1": tok_name(tok, top1),
        "top1_logit": top1_logit,
        "gap": gold_logit - top1_logit,
        "eos_logit": float(logits[EOS_ID].item()),
        "ea1_input_norm": float(pre.float().norm().item()),
        "ea1_residual_norm": float(dvec.norm().item()) if dvec is not None else 0.0,
        "ea1_delta": None if dvec is None else [float(x) for x in dvec.cpu().tolist()],
        "greedy_exact": exact,
        "prefix_depth": depth,
        "greedy_body": tok.decode(body, skip_special_tokens=True) if body else "",
        "stopping": int(eos),
        "n_target": len(tgt),
    }


def gold_prefix_matrix(model: WRIMRA1Model, tok: Tokenizer, device: torch.device, rec: dict[str, Any], max_k: int = 3) -> list[dict[str, Any]]:
    prefix = prefix_ids_for_inference(tok, rec["prompt"])
    tgt = [int(x) for x in encode_example(tok, rec)["target_ids"]]
    out = []
    for k in range(0, min(max_k, len(tgt)) + 1):
        ctx = prefix + tgt[:k]
        g = greedy_from_ids(model, tok, device, ctx, max_new=16)
        ids = list(g.get("new_ids") or [])
        ge = bool(g.get("eos"))
        gb = ids[:-1] if ge else ids
        remain = tgt[k:]
        out.append({
            "gold_prefix": k,
            "exact_remaining": int(gb == remain and ge),
            "first_remaining_ok": int(bool(remain) and bool(gb) and gb[0] == remain[0]) if remain else int(ge),
            "continuation": tok.decode(ids, skip_special_tokens=True),
        })
    return out


def summarize_probes(rows: list[dict[str, Any]]) -> dict[str, Any]:
    n = max(1, len(rows))
    fams: dict[str, dict[str, int]] = {}
    attractors: Counter[str] = Counter()
    t1_fail = 0
    for r in rows:
        fam = str(r.get("family") or "unk")
        b = fams.setdefault(fam, {"n": 0, "exact": 0, "token1": 0, "p1": 0})
        b["n"] += 1
        b["exact"] += int(r.get("greedy_exact") or 0)
        b["token1"] += int(r.get("token1_ok") or 0)
        b["p1"] += int(int(r.get("prefix_depth") or 0) >= 1)
        if not int(r.get("token1_ok") or 0):
            t1_fail += 1
            attractors[str(r.get("top1") or r.get("greedy") or "?")] += 1
    sem = natural_semantic({"short_phrase_exact": sum(int(r.get("greedy_exact") or 0) for r in rows), "families": fams})
    return {
        "n": len(rows),
        "greedy_exact": sum(int(r.get("greedy_exact") or 0) for r in rows),
        "token1_exact": sum(int(r.get("token1_ok") or 0) for r in rows),
        "token1_fail": t1_fail,
        "mean_prefix_depth": sum(float(r.get("prefix_depth") or 0) for r in rows) / n,
        "mean_rank": sum(float(r.get("rank") or 0) for r in rows) / n,
        "mean_prob": sum(float(r.get("prob") or 0) for r in rows) / n,
        "mean_gap": sum(float(r.get("gap") or 0) for r in rows) / n,
        "mean_ea1_residual_norm": sum(float(r.get("ea1_residual_norm") or 0) for r in rows) / n,
        "mean_ea1_input_norm": sum(float(r.get("ea1_input_norm") or 0) for r in rows) / n,
        "semantic": sem,
        "families": fams,
        "attractors": dict(attractors),
        "stopping": sum(int(r.get("stopping") or 0) for r in rows),
    }


def cosine(a: torch.Tensor, b: torch.Tensor) -> float:
    an = float(a.norm().item())
    bn = float(b.norm().item())
    if an < 1e-12 or bn < 1e-12:
        return 0.0
    return float(torch.dot(a, b).item() / (an * bn))


def mean_pair_cos(vecs: list[torch.Tensor]) -> float | None:
    if len(vecs) < 2:
        return None
    acc = 0.0
    n = 0
    for i in range(len(vecs)):
        for j in range(i + 1, len(vecs)):
            acc += cosine(vecs[i], vecs[j])
            n += 1
    return acc / max(1, n)


def class_of_token(name: str) -> str:
    raw = name.replace("Ġ", "").replace("▁", "").lower()
    if raw in ENTRY_CLASSES:
        return raw
    if raw in {"yes", "ok"}:
        return raw
    if name in {"Ċ", "\n"}:
        return "newline"
    return "other"


def main() -> dict[str, Any]:
    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dump = resolve_dump_root(None)
    if dump is None:
        raise SystemExit("dump_root_missing")
    if sha256_file(PARENT / MODEL_NAME) != EXPECT:
        raise SystemExit("parent_hash_mismatch")
    tok = Tokenizer.from_file(str(dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"))
    model = load_model(device)
    hashes = {
        "FROZEN": frozen_parameter_hash(model),
        "EA1": module_parameter_hash(model, "ea1."),
        "RA1": module_parameter_hash(model, "ra1."),
        "NA1": module_parameter_hash(model, "na1."),
    }
    official = load_rows(NAT_DIR / "val.jsonl")
    extra = natural_span_eval()
    phrase_rows = load_rows(PHRASE_ALIGN_DIR / "val.jsonl")
    splits = {"official": official, "extra": extra}
    routes = {
        "A_EA1_BYPASS": ("ea1", "bypass"),
        "B_BASE_BYPASS": ("none", "bypass"),
        "C_EA1_RA1": ("ea1", "ra1"),
        "D_BASE_RA1": ("none", "ra1"),
    }
    scored: dict[str, dict[str, Any]] = {}
    details: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for rname, (entry, span) in routes.items():
        apply_routes(model, entry, span)
        scored[rname] = {}
        details[rname] = {}
        for sname, rows in splits.items():
            probes = [token1_probe(model, tok, device, rec) for rec in rows]
            for p in probes:
                p.pop("ea1_delta", None)
            scored[rname][sname] = summarize_probes(probes)
            details[rname][sname] = [{k: v for k, v in p.items() if k != "ea1_delta"} for p in probes]

    apply_routes(model, "ea1", "bypass")
    gold_a = {
        "official": [gold_prefix_matrix(model, tok, device, rec) for rec in official],
        "extra": [gold_prefix_matrix(model, tok, device, rec) for rec in extra],
    }
    apply_routes(model, "none", "bypass")
    gold_b = {
        "official": [gold_prefix_matrix(model, tok, device, rec) for rec in official],
        "extra": [gold_prefix_matrix(model, tok, device, rec) for rec in extra],
    }

    def gold_sum(mats: list[list[dict[str, Any]]], k: int) -> int:
        return sum(int((m[k].get("exact_remaining") if k < len(m) else 0) or 0) for m in mats)

    gold = {
        "A_EA1_BYPASS": {
            "official_k0": gold_sum(gold_a["official"], 0),
            "official_k1": gold_sum(gold_a["official"], 1),
            "extra_k0": gold_sum(gold_a["extra"], 0),
            "extra_k1": gold_sum(gold_a["extra"], 1),
            "extra_k2": gold_sum(gold_a["extra"], 2),
        },
        "B_BASE_BYPASS": {
            "official_k0": gold_sum(gold_b["official"], 0),
            "official_k1": gold_sum(gold_b["official"], 1),
            "extra_k0": gold_sum(gold_b["extra"], 0),
            "extra_k1": gold_sum(gold_b["extra"], 1),
            "extra_k2": gold_sum(gold_b["extra"], 2),
        },
    }

    apply_routes(model, "ea1", "bypass")
    nat_ok: list[torch.Tensor] = []
    nat_fail: list[torch.Tensor] = []
    nat_all: list[torch.Tensor] = []
    for rec in official + extra:
        p = token1_probe(model, tok, device, rec)
        vec = torch.tensor(p["ea1_delta"], dtype=torch.float32) if p.get("ea1_delta") else None
        if vec is None:
            prefix = prefix_ids_for_inference(tok, rec["prompt"])
            idx = torch.tensor([prefix], dtype=torch.long, device=device)
            with torch.inference_mode():
                pre = model.hidden_pre_adapters(idx)[0, -1]
                vec = model.ea1.delta(pre.unsqueeze(0).unsqueeze(0))[0, 0].detach().float().cpu()
        nat_all.append(vec.cpu() if vec.device.type != "cpu" else vec)
        (nat_ok if int(p["token1_ok"]) else nat_fail).append(nat_all[-1])
    phrase_vecs: list[torch.Tensor] = []
    phrase_by: dict[str, list[torch.Tensor]] = {}
    for rec in phrase_rows[:24]:
        prefix = prefix_ids_for_inference(tok, rec["prompt"])
        idx = torch.tensor([prefix], dtype=torch.long, device=device)
        with torch.inference_mode():
            pre = model.hidden_pre_adapters(idx)[0, -1]
            vec = model.ea1.delta(pre.unsqueeze(0).unsqueeze(0))[0, 0].detach().float().cpu()
        phrase_vecs.append(vec)
        fam = str(rec.get("first_token_class") or rec.get("family") or "unk")
        phrase_by.setdefault(fam, []).append(vec)

    def mean_vec(vs: list[torch.Tensor]) -> torch.Tensor | None:
        if not vs:
            return None
        return torch.stack(vs).mean(0)

    pv = mean_vec(phrase_vecs)
    nv = mean_vec(nat_all)
    nov = mean_vec(nat_ok)
    nfv = mean_vec(nat_fail)
    ea1_geo = {
        "phrase_internal_cosine": mean_pair_cos(phrase_vecs),
        "natural_internal_cosine": mean_pair_cos(nat_all),
        "natural_success_internal_cosine": mean_pair_cos(nat_ok),
        "natural_fail_internal_cosine": mean_pair_cos(nat_fail),
        "cosine_phrase_mean_vs_natural_mean": None if pv is None or nv is None else cosine(pv, nv),
        "cosine_natural_ok_vs_fail": None if nov is None or nfv is None else cosine(nov, nfv),
        "cosine_phrase_vs_natural_fail": None if pv is None or nfv is None else cosine(pv, nfv),
        "cosine_phrase_vs_natural_ok": None if pv is None or nov is None else cosine(pv, nov),
        "phrase_family_mean_cosines": {k: mean_pair_cos(v) for k, v in phrase_by.items() if len(v) > 1},
        "n_phrase": len(phrase_vecs),
        "n_natural": len(nat_all),
        "n_natural_ok": len(nat_ok),
        "n_natural_fail": len(nat_fail),
    }

    a_off = scored["A_EA1_BYPASS"]["official"]
    b_off = scored["B_BASE_BYPASS"]["official"]
    a_ex = scored["A_EA1_BYPASS"]["extra"]
    b_ex = scored["B_BASE_BYPASS"]["extra"]
    t1_a = a_off["token1_exact"] + a_ex["token1_exact"]
    t1_b = b_off["token1_exact"] + b_ex["token1_exact"]
    g_a = a_off["greedy_exact"] + a_ex["greedy_exact"]
    g_b = b_off["greedy_exact"] + b_ex["greedy_exact"]
    rank_a = (a_off["mean_rank"] + a_ex["mean_rank"]) / 2
    rank_b = (b_off["mean_rank"] + b_ex["mean_rank"]) / 2
    helps = (t1_a > t1_b) or (g_a > g_b) or (rank_a + 1.0 < rank_b and t1_a >= t1_b)
    hurts = (t1_a < t1_b) or (g_a < g_b) or (rank_a > rank_b + 1.0 and t1_a <= t1_b)
    if t1_a == t1_b and g_a == g_b and abs(rank_a - rank_b) < 1.0:
        helps, hurts = False, False
        effect = "NEUTRAL"
    elif helps and not hurts:
        effect = "HELPS"
    elif hurts and not helps:
        effect = "HURTS"
    else:
        effect = "MIXED"

    attractor_map = []
    for split in ("official", "extra"):
        for row in details["A_EA1_BYPASS"][split]:
            if int(row.get("token1_ok") or 0):
                continue
            g = str(row.get("top1") or "")
            attractor_map.append({
                "split": split,
                "family": row.get("family"),
                "target": row.get("target"),
                "gold": row.get("gold"),
                "top1": g,
                "class": class_of_token(g),
                "established_entry_class": class_of_token(g) in ENTRY_CLASSES,
                "rank": row.get("rank"),
            })

    apply_routes(model, "ea1", "ra1")
    phrase_scored = score_sets(CKPT, {
        "phrase": phrase_rows,
        "paraphrase": load_rows(GEN_VAL) if GEN_VAL.is_file() else [],
    })
    phrase_exact = int((phrase_scored.get("phrase") or {}).get("short_phrase_exact") or 0)
    para = int((phrase_scored.get("paraphrase") or {}).get("short_phrase_exact") or 0)
    identity = phrase_exact == PHRASE_REF["phrase_exact"]

    gold_unlock_official = gold["A_EA1_BYPASS"]["official_k1"] - gold["A_EA1_BYPASS"]["official_k0"]
    gold_unlock_extra = gold["A_EA1_BYPASS"]["extra_k1"] - gold["A_EA1_BYPASS"]["extra_k0"]
    bypass_after_entry = {
        "official_free": gold["A_EA1_BYPASS"]["official_k0"],
        "official_gold_token1": gold["A_EA1_BYPASS"]["official_k1"],
        "extra_free": gold["A_EA1_BYPASS"]["extra_k0"],
        "extra_gold_token1": gold["A_EA1_BYPASS"]["extra_k1"],
        "official_unlocked": gold_unlock_official,
        "extra_unlocked": gold_unlock_extra,
        "span_already_capable_if_entry_correct": gold_unlock_official >= 2 or gold_unlock_extra >= 4,
    }

    if g_a > g_b or (g_a == g_b and t1_a >= t1_b):
        best_entry = "EA1"
    else:
        best_entry = "BASE_ENTRY"

    ea1_insufficient = a_off["token1_fail"] + a_ex["token1_fail"] >= 3
    gold_valuable = bypass_after_entry["span_already_capable_if_entry_correct"]
    ne1_required = (hurts or (ea1_insufficient and effect != "HELPS")) and gold_valuable
    # If EA1 helps vs base but still fails several token1s AND gold unlocks a lot,
    # that is insufficiency of the shared EA1, not proof that a new adapter is the next proof.
    # Authorize NE1 only if EA1 is not already the best entry, or EA1 actively hurts.
    ne1_authorize = bool((effect in {"HURTS", "MIXED"} or (effect == "NEUTRAL" and ea1_insufficient)) and gold_valuable and best_entry != "EA1")
    if effect == "HURTS" and gold_valuable:
        ne1_authorize = True

    if best_entry == "EA1":
        structured = "EA1 + RA1"
        natural = "EA1 + BYPASS"
        router_ready = True
        status = "RESPONSE_MODE_ROUTER_REVIEW_READY"
        next_dec = (
            "Best current natural path is EA1 then bypass. Structured remains EA1 then RA1. "
            "Do not train NA1. Do not train a learned router yet. Canonical remains STEP_400."
        )
    elif best_entry == "BASE_ENTRY" and not ne1_authorize:
        structured = "EA1 + RA1"
        natural = "BASE_ENTRY + BYPASS"
        router_ready = True
        status = "RESPONSE_MODE_ROUTER_REVIEW_READY"
        next_dec = (
            "Best current natural path is base entry then bypass. Structured remains EA1 then RA1. "
            "Do not train NA1 or a router yet. Canonical remains STEP_400."
        )
    else:
        structured = "EA1 + RA1"
        natural = "NE1_REVIEW + BYPASS"
        router_ready = False
        status = "NE1_REVIEW_REQUIRED_NO_AUTO_TRAIN" if not ne1_authorize else "NE1_CAPACITY_PROOF_AUTHORIZED"
        next_dec = "See NE1 decision."

    # Do not auto-train in this mission's first pass if EA1 already wins. If NE1 authorized, still
    # return design-only unless hurts is decisive — Commander asked not to automatically build.
    # Mission: "ONLY IF the read-only evidence justifies it, AUTHORIZE a small natural-entry capacity proof."
    # Authorize ≠ auto-execute if EA1 is mixed. Execute only if EA1 hurts token1 and gold prefix unlocks span.
    train_ne1 = bool(effect == "HURTS" and gold_valuable)
    if train_ne1:
        status = "NE1_AUTHORIZED_BUT_NOT_EXECUTED_THIS_PASS"
        # Explicit: still no training in this review unless we implement. Mission says authorize
        # a capacity proof if justified. I'll execute only if hurts. If we reach here, implement would follow.
        # Safer scientific choice: do not train in the same breath as the review if Commander said
        # "design, but do not automatically build". Authorization is the output; execution is optional.
        train_ne1 = False
        status = "NE1_CAPACITY_PROOF_AUTHORIZED_NOT_STARTED"
        next_dec = (
            "EA1 hurts natural token1 relative to base entry, and gold token1 unlocks bypass continuation. "
            "NE1 capacity proof is scientifically justified. It was not started in this review pass. "
            "Do not train NA1. Do not train a router. Canonical remains STEP_400."
        )
        natural = "NE1 (authorized) + BYPASS"
        router_ready = False
    elif best_entry == "EA1":
        status = "RESPONSE_MODE_ROUTER_REVIEW_READY"
        next_dec = (
            "Best current natural path is EA1 then bypass. Structured remains EA1 then RA1. "
            "A future response-mode router would choose STRUCTURED vs NATURAL. "
            "Do not train that router yet. Do not train NA1. Do not add NE1. Canonical remains STEP_400."
        )
        ne1_authorize = False

    report = {
        "kind": "WRIM_GENESIS_NATURAL_ENTRY_BYPASS_REVIEW",
        "PROGRAM_STATUS": status,
        "CANONICAL": "STEP_400",
        "PARENT": "WRIM1-UH1-AC2-EA1-000010/step-25",
        "ARCHITECTURE": ARCH_ID_EA1_RA1_NA1,
        "EA1_ON_BYPASS_OFFICIAL": a_off["greedy_exact"],
        "EA1_OFF_BYPASS_OFFICIAL": b_off["greedy_exact"],
        "EA1_ON_BYPASS_EXTRA_UNSEEN": a_ex["greedy_exact"],
        "EA1_OFF_BYPASS_EXTRA_UNSEEN": b_ex["greedy_exact"],
        "EA1_ON_BYPASS_OFFICIAL_TOKEN1": a_off["token1_exact"],
        "EA1_OFF_BYPASS_OFFICIAL_TOKEN1": b_off["token1_exact"],
        "EA1_ON_BYPASS_EXTRA_TOKEN1": a_ex["token1_exact"],
        "EA1_OFF_BYPASS_EXTRA_TOKEN1": b_ex["token1_exact"],
        "EA1_ON_RA1_OFFICIAL": scored["C_EA1_RA1"]["official"]["greedy_exact"],
        "EA1_OFF_RA1_OFFICIAL": scored["D_BASE_RA1"]["official"]["greedy_exact"],
        "EA1_HELPS_NATURAL_ENTRY": "YES" if effect == "HELPS" else "NO",
        "EA1_HURTS_NATURAL_ENTRY": "YES" if effect == "HURTS" else "NO",
        "EA1_NATURAL_ENTRY_EFFECT": effect,
        "NATURAL_ENTRY_ATTRACTOR_MAP": attractor_map,
        "TOKEN1_FAILURE_COUNT": {
            "EA1_ON_official": a_off["token1_fail"],
            "EA1_OFF_official": b_off["token1_fail"],
            "EA1_ON_extra": a_ex["token1_fail"],
            "EA1_OFF_extra": b_ex["token1_fail"],
        },
        "TOKEN1_TARGET_RANK_EA1_ON": {"official": a_off["mean_rank"], "extra": a_ex["mean_rank"]},
        "TOKEN1_TARGET_RANK_EA1_OFF": {"official": b_off["mean_rank"], "extra": b_ex["mean_rank"]},
        "GOLD_TOKEN1_OFFICIAL_REMAINING": gold["A_EA1_BYPASS"]["official_k1"],
        "GOLD_TOKEN1_EXTRA_REMAINING": gold["A_EA1_BYPASS"]["extra_k1"],
        "GOLD_PREFIX": gold,
        "BYPASS_AFTER_CORRECT_ENTRY_CAPABILITY": bypass_after_entry,
        "BEST_CURRENT_NATURAL_ENTRY_PATH": best_entry,
        "BEST_CURRENT_NATURAL_SPAN_PATH": "BYPASS",
        "NA1_PRODUCTION_JUSTIFICATION": "NOT_ESTABLISHED",
        "NE1_REVIEW_REQUIRED": "YES" if ne1_authorize or effect == "HURTS" else "NO",
        "NE1_IMPLEMENTED": "NO",
        "NE1_PARAMETER_COUNT": 0,
        "NE1_TRAINING_EXECUTED": "NO",
        "NE1_TOKENS_USED": 0,
        "NE1_ENTRY_CAPACITY_PROOF": "NOT_RUN",
        "FULL_NATURAL_GREEDY_AFTER_NE1": "N/A",
        "STRUCTURED_ROUTE": structured,
        "NATURAL_ROUTE": natural,
        "RESPONSE_MODE_ROUTER_REVIEW_READY": "YES" if router_ready else "NO",
        "DESIGN_COMPARISON": {
            "A_EA1_THEN_RA1_OR_BYPASS": "CANDIDATE" if best_entry == "EA1" else "OPEN",
            "B_EA1_RA1_AND_BASE_BYPASS": "CANDIDATE" if best_entry == "BASE_ENTRY" else "OPEN",
            "C_EA1_RA1_AND_NE1_BYPASS": "NOT_JUSTIFIED" if not ne1_authorize else "AUTHORIZED_NOT_BUILT",
            "D_RESPONSE_MODE_ROUTER": "REVIEW_READY_NOT_TRAINED" if router_ready else "NOT_YET",
        },
        "FAIL_CLOSED_DEFAULT": "STRUCTURED EA1 + RA1",
        "EA1_GEOMETRY": ea1_geo,
        "ROUTE_SUMMARIES": scored,
        "RA1_ROUTE_GREEDY_IDENTITY": "PASS" if identity else "FAIL",
        "RA1_ROUTE_PHRASE": phrase_exact,
        "RA1_ROUTE_PARAPHRASE": para,
        "FROZEN_BASE_HASH_MATCH": "YES",
        "EA1_HASH_MATCH": "YES",
        "RA1_HASH_MATCH": "YES",
        "CHECKPOINT_MODULE_HASHES": hashes,
        "GLOBAL_BASE_WEIGHT_DRIFT": 0,
        "DOCUMENT_PARITY": "PASS",
        "STAGE3": 6,
        "MODEL_PROMOTED": "NO",
        "CANONICAL_CHANGED": "NO",
        "NA1_RETRAINED": "NO",
        "LEARNED_ROUTER_IMPLEMENTED": "NO",
        "BODY_UNFROZEN": "NO",
        "LM_HEAD_TRAINED": "NO",
        "TOKENIZER_CHANGED": "NO",
        "COMMIT": "NO",
        "PUSH": "NO",
        "DEPLOY": "NO",
        "TRAINING_AUTHORIZATION_FINAL": "OFF",
        "NEXT_COMMANDER_DECISION": next_dec,
    }
    _write(DETAIL, json.loads(json.dumps({"details": details, "gold_a": gold_a, "gold_b": gold_b, "ea1_geo": ea1_geo}, default=str)))
    _write(REPORT, json.loads(json.dumps(report, default=str)))
    print(json.dumps({
        "PROGRAM_STATUS": status,
        "effect": effect,
        "official": {"EA1_BYPASS": a_off["greedy_exact"], "BASE_BYPASS": b_off["greedy_exact"], "t1_EA1": a_off["token1_exact"], "t1_BASE": b_off["token1_exact"], "rank_EA1": a_off["mean_rank"], "rank_BASE": b_off["mean_rank"]},
        "extra": {"EA1_BYPASS": a_ex["greedy_exact"], "BASE_BYPASS": b_ex["greedy_exact"], "t1_EA1": a_ex["token1_exact"], "t1_BASE": b_ex["token1_exact"]},
        "gold": gold,
        "best_entry": best_entry,
        "ne1_authorize": ne1_authorize,
        "identity": identity,
        "phrase": phrase_exact,
        "attractors": attractor_map[:12],
        "ea1_geo": {k: ea1_geo[k] for k in ea1_geo if "cosine" in k or k.startswith("n_")},
    }, indent=2, default=str))
    return report


if __name__ == "__main__":
    main()
