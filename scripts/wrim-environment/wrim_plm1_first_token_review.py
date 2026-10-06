"""Read-only first-token bottleneck review for WRIM1-PLM-000001.

Forward inference only. Does not construct an optimizer. Does not backward.
Does not create a training run.
"""
from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import numpy as np
import torch
from safetensors.torch import load_file as load_safetensors_file
from tokenizers import Tokenizer

from run000007_preflight import resolve_dump_root, sha256_file
from stage3_runtime import write_json
from wrim_cpt_eval import greedy_from_ids
from wrim_cpt_identity import ASSISTANT_ID, BOS_ID, COMMANDER_ID, EOS_ID, LINUX_CKPT_ROOT
from wrim_cpt_stage_b_corpus import corpus_root, load_jsonl, tokenize_docs
from wrim_cpt2_identity import CORPUS_VERSION as CPT2_CORPUS_VERSION
from wrim_g20m import WRIM0Model
from wrim_plm1_encode import encode_example, pack_train_stream, prefix_ids_for_inference, slice_batches
from wrim_plm1_identity import (
    CKPT_ROOT,
    DATA_ROOT,
    EVAL_STEPS,
    EXPERIMENTAL_PARENT_CKPT,
    TOKENIZER_EXPECTED_SHA,
)
from wrim_resumable_checkpoint import MODEL_NAME
from wrim_target_only_loss import MASK_CAP_EOS, MASK_CAP_TARGET, MASK_IGNORE

REPORT_PATH = Path(DATA_ROOT) / "WRIM_GENESIS_FIRST_TOKEN_BOTTLENECK_REPORT.json"
ARTICLES = {"Ġthe", "the", "Ġa", "a", "Ġan", "an", "ĠThe", "The", "ĠA", "ĠAn"}
COMMON_PROSE = {
    "ĠI", "I", "Ġto", "to", "Ġof", "of", "Ġand", "and", "Ġin", "in", "Ġis", "is",
    "Ġthat", "that", "Ġfor", "for", "Ġit", "it", "Ġon", "on", "Ġwith", "with",
    "Ġas", "Ġbe", "Ġthis", "Ġwas", "Ġby", "Ġor", "Ġfrom", "Ġnot", "Ġare",
}
NEWLINE_IDS: list[int] = []
ARTICLE_IDS: list[int] = []
PROSE_IDS: list[int] = []


def _piece(tokenizer: Tokenizer, tid: int) -> str:
    return tokenizer.id_to_token(int(tid)) or f"id:{tid}"


def classify_piece(piece: str, tid: int) -> str:
    if tid == EOS_ID or piece == "<|eos|>":
        return "EOS"
    if tid in {BOS_ID, COMMANDER_ID, ASSISTANT_ID} or piece in {
        "<|bos|>",
        "<|commander|>",
        "<|assistant|>",
        "<|pad|>",
    }:
        return "special token"
    if piece and "Ċ" in piece:
        return "newline"
    raw = piece.lstrip("Ġ")
    if piece in ARTICLES:
        return "article"
    if "`" in piece or raw in {"def", "import", "class", "return", "json", "{", "}"}:
        return "code-like token"
    if piece in COMMON_PROSE or raw.lower() in {p.lstrip("Ġ").lower() for p in COMMON_PROSE}:
        return "common prose token"
    if raw and all(ch in PUNCT_CHARS for ch in raw):
        return "punctuation"
    if raw and raw[0].isupper():
        return "capitalized token"
    if raw and raw[:1].isalpha():
        return "unrelated semantic token"
    return "other"


def answer_group(rec: dict[str, Any]) -> str:
    fam = rec.get("family") or ""
    t = str(rec.get("target") or "")
    if fam == "yes_no" or t.lower() in {"yes", "no"}:
        return "yes/no"
    if fam == "integer" or t.isdigit():
        return "number"
    if fam == "iso_code":
        return "short phrase"
    if fam == "tag_echo":
        return "domain-specific term"
    if fam in {"halt_word", "color_stop", "first_of_list"}:
        return "single common word"
    if fam == "wrim_internal":
        if t[:1].isupper() and " " not in t and not t.isdigit():
            return "proper noun"
        return "instructional response"
    return "other"


def entropy_from_logits(logits: torch.Tensor) -> float:
    p = torch.softmax(logits.float(), dim=-1)
    return float((-(p * torch.log(p.clamp_min(1e-12))).sum()).item())


def topk(tokenizer: Tokenizer, logits: torch.Tensor, k: int = 5) -> list[dict[str, Any]]:
    probs = torch.softmax(logits.float(), dim=-1)
    val, idx = torch.topk(probs, k)
    out = []
    for p, i in zip(val.tolist(), idx.tolist()):
        out.append({"id": int(i), "piece": _piece(tokenizer, int(i)), "prob": float(p), "logit": float(logits[int(i)].item())})
    return out


def first_token_stats(tokenizer: Tokenizer, rec: dict[str, Any], enc: dict[str, Any]) -> dict[str, Any]:
    tid = int(enc["first_target_id"])
    return {
        "ITEM_ID": rec["example_id"],
        "family": rec.get("family"),
        "group": answer_group(rec),
        "target": rec["target"],
        "TARGET_FIRST_TOKEN": _piece(tokenizer, tid),
        "TOKEN_ID": tid,
        "n_target_tokens": len(enc["target_ids"]),
    }


def inspect_prefix(model: WRIM0Model, tokenizer: Tokenizer, device: torch.device, ids: list[int], target_id: int | None) -> dict[str, Any]:
    x = torch.tensor([ids], dtype=torch.long, device=device)
    with torch.inference_mode():
        logits = model(x)[0, -1].float()
    probs = torch.softmax(logits, dim=-1)
    order = torch.argsort(logits, descending=True)
    argmax = int(order[0].item())
    row: dict[str, Any] = {
        "argmax_id": argmax,
        "argmax_piece": _piece(tokenizer, argmax),
        "argmax_prob": float(probs[argmax].item()),
        "argmax_logit": float(logits[argmax].item()),
        "entropy": entropy_from_logits(logits),
        "top5": topk(tokenizer, logits, 5),
        "newline_mass": float(probs[NEWLINE_IDS].sum().item()) if NEWLINE_IDS else 0.0,
        "eos_mass": float(probs[EOS_ID].item()),
        "assistant_mass": float(probs[ASSISTANT_ID].item()),
        "commander_mass": float(probs[COMMANDER_ID].item()),
        "common_prose_mass": float(probs[ARTICLE_IDS + PROSE_IDS].sum().item()) if (ARTICLE_IDS or PROSE_IDS) else 0.0,
    }
    if target_id is not None:
        rt = torch.nonzero(order == int(target_id), as_tuple=False)
        rank = int(rt[0].item()) + 1 if rt.numel() else None
        row.update(
            {
                "target_id": int(target_id),
                "target_piece": _piece(tokenizer, int(target_id)),
                "target_logit": float(logits[int(target_id)].item()),
                "target_prob": float(probs[int(target_id)].item()),
                "target_rank": rank,
                "logit_gap_target_minus_argmax": float(logits[int(target_id)].item() - logits[argmax].item()),
            }
        )
    return row


def position_nlls(model: WRIM0Model, device: torch.device, tokens: list[int], first_target_index: int) -> dict[str, Any]:
    if first_target_index <= 0 or first_target_index >= len(tokens):
        return {}
    x = torch.tensor([tokens[:-1]], dtype=torch.long, device=device)
    y = torch.tensor(tokens[1:], dtype=torch.long, device=device)
    with torch.inference_mode():
        logp = torch.log_softmax(model(x)[0].float(), dim=-1)
        nll = -logp[torch.arange(y.numel(), device=device), y]
    # y index i predicts tokens[i+1]. first target is tokens[first_target_index] predicted at i = first_target_index-1
    i0 = first_target_index - 1
    out = {"pos1_nll": float(nll[i0].item())}
    if i0 + 1 < nll.numel() - 1:
        out["pos2_nll"] = float(nll[i0 + 1].item())
    else:
        out["pos2_nll"] = None
    later = nll[i0 + 2 : -1]
    out["pos3plus_nll"] = float(later.mean().item()) if later.numel() else None
    out["eos_nll"] = float(nll[-1].item())
    return out


def count_role_in_metrics(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {"ok": False, "path": str(path)}
    role_steps = 0
    role_seq = 0
    n = 0
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            n += 1
            fam = rec.get("family_composition") or {}
            if int(fam.get("role_boundary_rehearsal") or rec.get("role") or 0) > 0:
                role_steps += 1
            role_seq += int(rec.get("ROLE_SEQUENCE_COUNT") or 0)
    return {"ok": True, "steps": n, "steps_with_role_family": role_steps, "ROLE_SEQUENCE_COUNT_SUM": role_seq}


def bincount_ids(ids: np.ndarray, vocab: int = 15126) -> np.ndarray:
    ids = np.asarray(ids, dtype=np.int64)
    ids = ids[(ids >= 0) & (ids < vocab)]
    return np.bincount(ids, minlength=vocab)


def main() -> dict[str, Any]:
    dump = resolve_dump_root(None)
    if dump is None:
        raise SystemExit("dump_root_missing")
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    assert sha256_file(tok_path) == TOKENIZER_EXPECTED_SHA
    global NEWLINE_IDS, ARTICLE_IDS, PROSE_IDS
    tokenizer = Tokenizer.from_file(str(tok_path))
    NEWLINE_IDS = [i for i in range(15126) if "Ċ" in (tokenizer.id_to_token(i) or "")]
    ARTICLE_IDS = [i for i in range(15126) if (tokenizer.id_to_token(i) or "") in ARTICLES]
    PROSE_IDS = [i for i in range(15126) if (tokenizer.id_to_token(i) or "") in COMMON_PROSE]

    corpus_dir = Path(DATA_ROOT) / "WR-CORPUS-PLM-PROBE-1-v1.0.0"
    train_rows = load_jsonl(corpus_dir / "train.jsonl")
    val_rows = load_jsonl(corpus_dir / "val.jsonl")
    train_enc = [encode_example(tokenizer, r) for r in train_rows]
    val_enc = [encode_example(tokenizer, r) for r in val_rows]

    train_first = [int(e["first_target_id"]) for e in train_enc]
    val_first = [int(e["first_target_id"]) for e in val_enc]
    train_freq = Counter(train_first)
    val_freq = Counter(val_first)
    train_unique = set(train_freq)
    val_unique = set(val_freq)
    overlap = train_unique & val_unique

    # Packed stream first-target occurrences (supervised)
    stream, mask = pack_train_stream(train_enc)
    first_pos = []
    for i in range(1, int(stream.size)):
        if int(stream[i - 1]) == ASSISTANT_ID and int(mask[i]) == MASK_CAP_TARGET:
            first_pos.append(int(stream[i]))
    packed_first = Counter(first_pos)
    n_first_packed = len(first_pos)
    n_tgt = int(np.count_nonzero(mask == MASK_CAP_TARGET))
    n_eos = int(np.count_nonzero(mask == MASK_CAP_EOS))
    n_ign = int(np.count_nonzero(mask == MASK_IGNORE))

    occ = list(train_freq.values())
    buckets = {
        "1": sum(1 for c in occ if c == 1),
        "2-3": sum(1 for c in occ if 2 <= c <= 3),
        "4-10": sum(1 for c in occ if 4 <= c <= 10),
        ">10": sum(1 for c in occ if c > 10),
    }
    val_never = sum(1 for t in val_first if t not in train_unique)
    val_once = sum(1 for t in val_first if train_freq.get(t, 0) == 1)
    val_rare = sum(1 for t in val_first if 1 <= train_freq.get(t, 0) <= 3)
    val_common = sum(1 for t in val_first if train_freq.get(t, 0) >= 4)

    # CPT-2 frequencies
    c2_root = corpus_root()
    c2_train = load_jsonl(c2_root / f"{CPT2_CORPUS_VERSION}-TRAIN.jsonl")
    c2_tok = tokenize_docs(c2_train, tokenizer)
    c2_ids = np.concatenate([np.asarray(r["token_ids"], dtype=np.int32) for r in c2_tok if r.get("token_ids")])
    c2_bc = bincount_ids(c2_ids)
    commander_c2 = int(c2_bc[COMMANDER_ID])
    assistant_c2 = int(c2_bc[ASSISTANT_ID])

    # Pretrain train.npy
    npy = dump / "model-lab" / "manifests" / "wrim0_corpus_shards" / "train.npy"
    pre_bc = None
    pre_n = None
    pre_cmd = pre_ast = None
    if npy.is_file():
        arr = np.load(npy, mmap_mode="r")
        pre_n = int(arr.size)
        # chunked bincount
        pre_bc = np.zeros(15126, dtype=np.int64)
        chunk = 2_000_000
        for s in range(0, arr.size, chunk):
            pre_bc += bincount_ids(np.asarray(arr[s : s + chunk]))
        pre_cmd = int(pre_bc[COMMANDER_ID])
        pre_ast = int(pre_bc[ASSISTANT_ID])

    plm_all_ids = np.concatenate([e["tokens"] for e in train_enc])
    plm_bc = bincount_ids(plm_all_ids)

    def freq_row(tid: int) -> dict[str, Any]:
        return {
            "id": tid,
            "piece": _piece(tokenizer, tid),
            "train_first_count": int(train_freq.get(tid, 0)),
            "val_first_count": int(val_freq.get(tid, 0)),
            "packed_first_count": int(packed_first.get(tid, 0)),
            "plm_train_token_count": int(plm_bc[tid]) if tid < len(plm_bc) else 0,
            "cpt2_token_count": int(c2_bc[tid]) if tid < len(c2_bc) else 0,
            "pretrain_token_count": None if pre_bc is None else int(pre_bc[tid]),
        }

    train_table = [freq_row(t) for t, _ in train_freq.most_common()]
    val_table = [freq_row(t) for t, _ in val_freq.most_common()]

    cpt5_role = count_role_in_metrics(Path("/home/chosenone/.local/share/war-room-os/data/wrim-checkpoints/test-only/WRIM1-CPT-000005/metrics.jsonl"))
    cpt4_role = count_role_in_metrics(Path("/home/chosenone/.local/share/war-room-os/data/wrim-checkpoints/test-only/WRIM1-CPT-000004/metrics.jsonl"))

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    ckpt_root = Path(CKPT_ROOT)
    steps = list(EVAL_STEPS)
    models: dict[int, WRIM0Model] = {}

    def load_step(step: int) -> WRIM0Model:
        if step in models:
            return models[step]
        m = WRIM0Model()
        if step == 0:
            p = Path(EXPERIMENTAL_PARENT_CKPT) / MODEL_NAME
        else:
            p = ckpt_root / f"step-{step}" / MODEL_NAME
            if not p.is_file():
                p = ckpt_root / f"step-{step}" / MODEL_NAME
        # step-0 of PLM is the parent weights after eval persist; use PLM step-0 if present
        plm0 = ckpt_root / "step-0" / MODEL_NAME
        if step == 0 and plm0.is_file():
            p = plm0
        m.load_state_dict(load_safetensors_file(str(p)), strict=True)
        m.to(device)
        m.freeze_inference()
        models[step] = m
        return m

    # Packed-stream forward loss shares (no backward)
    batches = slice_batches(stream, mask)
    loss_by_step: dict[str, Any] = {}
    for step in steps:
        m = load_step(step)
        sums = {"first": 0.0, "later": 0.0, "eos": 0.0, "n_first": 0, "n_later": 0, "n_eos": 0}
        offset = 0
        for x_np, y_np, m_np in batches:
            x = torch.tensor(x_np, dtype=torch.long, device=device)
            y = torch.tensor(y_np, dtype=torch.long, device=device)
            mm = torch.tensor(m_np, dtype=torch.int8, device=device)
            with torch.inference_mode():
                logp = torch.log_softmax(m(x).float(), dim=-1)
                nll = -logp.gather(-1, y.unsqueeze(-1)).squeeze(-1)
            # reconstruct whether y is first-target: previous token in stream is assistant
            # batch rows are contiguous slices of stream
            bsz, sl = y_np.shape
            for bi in range(bsz):
                # stream index of y[0] is offset+1
                for j in range(sl):
                    sidx = offset + 1 + j  # index in stream of predicted token
                    mask_v = int(m_np[bi, j])
                    if mask_v == MASK_IGNORE:
                        continue
                    prev = int(stream[sidx - 1]) if sidx - 1 >= 0 else -1
                    val = float(nll[bi, j].item())
                    if mask_v == MASK_CAP_EOS:
                        sums["eos"] += val
                        sums["n_eos"] += 1
                    elif mask_v == MASK_CAP_TARGET and prev == ASSISTANT_ID:
                        sums["first"] += val
                        sums["n_first"] += 1
                    elif mask_v == MASK_CAP_TARGET:
                        sums["later"] += val
                        sums["n_later"] += 1
                offset += sl
        tot = sums["first"] + sums["later"] + sums["eos"]
        n_sup = sums["n_first"] + sums["n_later"] + sums["n_eos"]
        loss_by_step[str(step)] = {
            "FIRST_TOKEN_LOSS": (sums["first"] / sums["n_first"]) if sums["n_first"] else None,
            "LATER_TOKEN_LOSS": (sums["later"] / sums["n_later"]) if sums["n_later"] else None,
            "EOS_LOSS": (sums["eos"] / sums["n_eos"]) if sums["n_eos"] else None,
            "FIRST_TOKEN_LOSS_SHARE": (sums["first"] / tot) if tot else None,
            "LATER_TOKEN_LOSS_SHARE": (sums["later"] / tot) if tot else None,
            "EOS_LOSS_SHARE": (sums["eos"] / tot) if tot else None,
            "n_first": sums["n_first"],
            "n_later": sums["n_later"],
            "n_eos": sums["n_eos"],
            "n_supervised": n_sup,
            "count_fraction_first": sums["n_first"] / n_sup if n_sup else None,
            "count_fraction_later": sums["n_later"] / n_sup if n_sup else None,
            "count_fraction_eos": sums["n_eos"] / n_sup if n_sup else None,
        }
        # free GPU between? keep models cached; 5 * 20M is fine

    def eval_split(rows: list[dict[str, Any]], encs: list[dict[str, Any]], steps_geom: list[int], greedy_steps: list[int]) -> dict[str, Any]:
        by_step: dict[str, list[dict[str, Any]]] = {}
        for step in steps_geom:
            m = load_step(step)
            items = []
            for rec, enc in zip(rows, encs):
                prefix = prefix_ids_for_inference(tokenizer, rec["prompt"])
                geom = inspect_prefix(m, tokenizer, device, prefix, int(enc["first_target_id"]))
                toks = [int(x) for x in enc["tokens"].tolist()]
                pn = position_nlls(m, device, toks, int(enc["first_target_index"]))
                item = {**first_token_stats(tokenizer, rec, enc), **geom, **pn}
                if step in greedy_steps:
                    gen = greedy_from_ids(m, tokenizer, device, prefix, max_new=32)
                    new_ids = list(gen.get("new_ids") or [])
                    item["greedy_first_id"] = new_ids[0] if new_ids else None
                    item["greedy_first_piece"] = _piece(tokenizer, new_ids[0]) if new_ids else None
                    item["greedy_first_class"] = classify_piece(item["greedy_first_piece"], new_ids[0]) if new_ids else None
                    item["greedy_first_match"] = bool(new_ids and new_ids[0] == int(enc["first_target_id"]))
                    cont = (gen.get("continuation") or "").strip()
                    item["greedy_exact"] = cont == str(rec["target"]).strip()
                    item["greedy_short"] = item["greedy_exact"] or cont.startswith(str(rec["target"]).strip())
                    item["greedy_eos"] = bool(gen.get("eos"))
                    item["greedy_cont"] = cont[:80]
                    # oracle: feed gold first target
                    gold = prefix + [int(enc["first_target_id"])]
                    tgt_ids = list(enc["target_ids"])
                    if len(tgt_ids) >= 2:
                        g2 = inspect_prefix(m, tokenizer, device, gold, int(tgt_ids[1]))
                        item["oracle_second_rank"] = g2.get("target_rank")
                        item["oracle_second_prob"] = g2.get("target_prob")
                        item["oracle_second_piece"] = g2.get("target_piece")
                    else:
                        g2 = inspect_prefix(m, tokenizer, device, gold, EOS_ID)
                        item["oracle_eos_rank"] = g2.get("target_rank")
                        item["oracle_eos_prob"] = g2.get("target_prob")
                    ogen = greedy_from_ids(m, tokenizer, device, gold, max_new=32)
                    ocont = ((tokenizer.decode([int(enc["first_target_id"])], skip_special_tokens=True) or "") + (ogen.get("continuation") or "")).strip()
                    item["oracle_greedy_exact"] = ocont == str(rec["target"]).strip()
                    item["oracle_greedy_short"] = item["oracle_greedy_exact"] or ocont.startswith(str(rec["target"]).strip())
                    item["oracle_greedy_eos"] = bool(ogen.get("eos"))
                items.append(item)
            by_step[str(step)] = items
        return by_step

    val_by = eval_split(val_rows, val_enc, steps, greedy_steps=[0, 10])
    train_by = eval_split(train_rows, train_enc, [0, 10], greedy_steps=[0, 10])

    def summarize_geom(items: list[dict[str, Any]]) -> dict[str, Any]:
        ranks = [i["target_rank"] for i in items if i.get("target_rank") is not None]
        probs = [i["target_prob"] for i in items if i.get("target_prob") is not None]
        logits = [i["target_logit"] for i in items if i.get("target_logit") is not None]
        gaps = [i["logit_gap_target_minus_argmax"] for i in items if i.get("logit_gap_target_minus_argmax") is not None]
        a_logits = [i["argmax_logit"] for i in items if i.get("argmax_logit") is not None]
        ents = [i["entropy"] for i in items if i.get("entropy") is not None]
        return {
            "mean_rank": sum(ranks) / len(ranks) if ranks else None,
            "mean_prob": sum(probs) / len(probs) if probs else None,
            "mean_target_logit": sum(logits) / len(logits) if logits else None,
            "mean_argmax_logit": sum(a_logits) / len(a_logits) if a_logits else None,
            "mean_gap": sum(gaps) / len(gaps) if gaps else None,
            "mean_entropy": sum(ents) / len(ents) if ents else None,
            "greedy_first_match": sum(1 for i in items if i.get("greedy_first_match")),
            "greedy_exact": sum(1 for i in items if i.get("greedy_exact")),
            "greedy_short": sum(1 for i in items if i.get("greedy_short")),
            "n": len(items),
        }

    val_geom = {s: summarize_geom(val_by[s]) for s in val_by}
    train_geom = {s: summarize_geom(train_by[s]) for s in train_by}

    # argmax classes at parent and step10 val
    cls0 = Counter(i.get("greedy_first_class") or "other" for i in val_by["0"])
    cls10 = Counter(i.get("greedy_first_class") or "other" for i in val_by["10"])

    # rank improved vs worsened
    rank_up = rank_down = rank_same = 0
    for a, b in zip(val_by["0"], val_by["10"]):
        if a.get("target_rank") is None or b.get("target_rank") is None:
            continue
        if b["target_rank"] < a["target_rank"]:
            rank_up += 1
        elif b["target_rank"] > a["target_rank"]:
            rank_down += 1
        else:
            rank_same += 1

    # groups
    groups: dict[str, dict[str, Any]] = {}
    for rec, e0, e10 in zip(val_rows, val_by["0"], val_by["10"]):
        g = answer_group(rec)
        d = groups.setdefault(g, {"n": 0, "rank0": 0.0, "rank10": 0.0, "p0": 0.0, "p10": 0.0})
        d["n"] += 1
        d["rank0"] += float(e0.get("target_rank") or 0)
        d["rank10"] += float(e10.get("target_rank") or 0)
        d["p0"] += float(e0.get("target_prob") or 0)
        d["p10"] += float(e10.get("target_prob") or 0)
    for g, d in groups.items():
        n = max(1, d["n"])
        d["mean_rank0"] = d["rank0"] / n
        d["mean_rank10"] = d["rank10"] / n
        d["mean_p0"] = d["p0"] / n
        d["mean_p10"] = d["p10"] / n
        d["delta_rank"] = d["mean_rank0"] - d["mean_rank10"]
        d["delta_prob"] = d["mean_p10"] - d["mean_p0"]

    # position movement val
    def mean_key(items: list[dict[str, Any]], k: str) -> float | None:
        xs = [i[k] for i in items if i.get(k) is not None]
        return (sum(xs) / len(xs)) if xs else None

    pos_move = {
        "pos1_nll": {"parent": mean_key(val_by["0"], "pos1_nll"), "step10": mean_key(val_by["10"], "pos1_nll")},
        "pos2_nll": {"parent": mean_key(val_by["0"], "pos2_nll"), "step10": mean_key(val_by["10"], "pos2_nll")},
        "pos3plus_nll": {"parent": mean_key(val_by["0"], "pos3plus_nll"), "step10": mean_key(val_by["10"], "pos3plus_nll")},
        "eos_nll": {"parent": mean_key(val_by["0"], "eos_nll"), "step10": mean_key(val_by["10"], "eos_nll")},
    }

    # oracle
    multi = [i for i in val_by["10"] if int(i.get("n_target_tokens") or 1) >= 2]
    single = [i for i in val_by["10"] if int(i.get("n_target_tokens") or 1) == 1]
    oracle = {
        "n_multi": len(multi),
        "n_single": len(single),
        "mean_p_first_parent": mean_key(val_by["0"], "target_prob"),
        "mean_p_first_step10": mean_key(val_by["10"], "target_prob"),
        "mean_oracle_second_prob_step10": mean_key(multi, "oracle_second_prob"),
        "mean_oracle_second_rank_step10": mean_key(multi, "oracle_second_rank"),
        "mean_oracle_eos_prob_single_step10": mean_key(single, "oracle_eos_prob"),
        "mean_oracle_eos_rank_single_step10": mean_key(single, "oracle_eos_rank"),
        "oracle_greedy_exact_val_step10": sum(1 for i in val_by["10"] if i.get("oracle_greedy_exact")),
        "oracle_greedy_short_val_step10": sum(1 for i in val_by["10"] if i.get("oracle_greedy_short")),
        "unguided_greedy_exact_val_step10": sum(1 for i in val_by["10"] if i.get("greedy_exact")),
        "oracle_greedy_exact_train_step10": sum(1 for i in train_by["10"] if i.get("oracle_greedy_exact")),
        "unguided_greedy_exact_train_step10": sum(1 for i in train_by["10"] if i.get("greedy_exact")),
        "unguided_greedy_first_train_step10": sum(1 for i in train_by["10"] if i.get("greedy_first_match")),
        "unguided_greedy_first_val_step10": sum(1 for i in val_by["10"] if i.get("greedy_first_match")),
        "unguided_greedy_first_train_parent": sum(1 for i in train_by["0"] if i.get("greedy_first_match")),
        "unguided_greedy_first_val_parent": sum(1 for i in val_by["0"] if i.get("greedy_first_match")),
    }
    p_first = oracle["mean_p_first_step10"] or 0.0
    p_second = oracle["mean_oracle_second_prob_step10"]
    p_eos = oracle["mean_oracle_eos_prob_single_step10"]
    if p_second is not None:
        oracle["ORACLE_FIRST_TOKEN_GAIN"] = float(p_second - p_first)
    elif p_eos is not None:
        oracle["ORACLE_FIRST_TOKEN_GAIN"] = float(p_eos - p_first)
    else:
        oracle["ORACLE_FIRST_TOKEN_GAIN"] = None

    # assistant boundary probe: empty prompt vs a typical prompt
    boundary = {}
    for step in (0, 10):
        m = load_step(step)
        prefix = prefix_ids_for_inference(tokenizer, "Reply with the integer 17 and nothing else.")
        boundary[str(step)] = inspect_prefix(m, tokenizer, device, prefix, tokenizer.encode("17", add_special_tokens=False).ids[0])

    # per held-out item table
    heldout_rows = []
    for rec, e0, e10 in zip(val_rows, val_by["0"], val_by["10"]):
        tid = int(e10["TOKEN_ID"])
        heldout_rows.append(
            {
                "ITEM_ID": rec["example_id"],
                "family": rec["family"],
                "group": answer_group(rec),
                "TARGET_FIRST_TOKEN": e10["TARGET_FIRST_TOKEN"],
                "TOKEN_ID": tid,
                "TRAIN_COUNT": int(train_freq.get(tid, 0)),
                "PRETRAIN_COUNT": None if pre_bc is None else int(pre_bc[tid]),
                "CPT_COUNT": int(c2_bc[tid]),
                "PARENT_RANK": e0.get("target_rank"),
                "STEP10_RANK": e10.get("target_rank"),
                "PARENT_PROB": e0.get("target_prob"),
                "STEP10_PROB": e10.get("target_prob"),
                "GREEDY_ARGMAX_TOKEN": e10.get("greedy_first_piece"),
                "GREEDY_ARGMAX_CLASS": e10.get("greedy_first_class"),
            }
        )

    n_train_ft = len(train_unique)
    examples_per_class = 140 / max(1, n_train_ft)
    packed_reps = n_first_packed / max(1, len(train_rows))
    overlap_frac = len(overlap) / max(1, len(val_unique))
    val_unseen_frac = val_never / max(1, len(val_first))

    if val_unseen_frac >= 0.7 or buckets["1"] / max(1, n_train_ft) >= 0.7:
        sparsity = "SEVERE"
    elif val_unseen_frac >= 0.3 or buckets["1"] / max(1, n_train_ft) >= 0.4:
        sparsity = "MODERATE"
    else:
        sparsity = "LOW"

    # Part I classification
    tr0, tr10 = train_geom["0"], train_geom["10"]
    va0, va10 = val_geom["0"], val_geom["10"]
    train_greedy_moved = (tr10["greedy_first_match"] or 0) > (tr0["greedy_first_match"] or 0)
    val_greedy_moved = (va10["greedy_first_match"] or 0) > (va0["greedy_first_match"] or 0)
    train_rank_moved = (tr0["mean_rank"] or 0) - (tr10["mean_rank"] or 0) >= 50
    if train_greedy_moved and not val_greedy_moved:
        part_i = "GENERALIZATION_FAILURE"
    elif not train_greedy_moved and not val_greedy_moved and not train_rank_moved:
        part_i = "OPTIMIZATION_SIGNAL_TOO_WEAK"
    else:
        part_i = "UNDERTRAINED_RESPONSE_ENTRY"

    # continuation vs entry
    p1_0, p1_10 = pos_move["pos1_nll"]["parent"], pos_move["pos1_nll"]["step10"]
    eos0, eos10 = pos_move["eos_nll"]["parent"], pos_move["eos_nll"]["step10"]
    later0 = pos_move["pos2_nll"]["parent"]
    later10 = pos_move["pos2_nll"]["step10"]
    entry_bottleneck = False
    if p1_0 and p1_10 and eos0 and eos10:
        eos_drop = eos0 - eos10
        p1_drop = p1_0 - p1_10
        if eos_drop > p1_drop + 0.15:
            entry_bottleneck = True
    if (later0 and later10 and p1_0 and p1_10) and ((later0 - later10) > (p1_0 - p1_10) + 0.1):
        entry_bottleneck = True

    l0 = loss_by_step["0"]
    l10 = loss_by_step["10"]

    report = {
        "kind": "WRIM_GENESIS_FIRST_TOKEN_BOTTLENECK_REPORT",
        "RUN_ID": "WRIM1-PLM-000001",
        "TRAINING_EXECUTED": "NO",
        "NEW_RUN_CREATED": "NO",
        "MODEL_PROMOTED": "NO",
        "CANONICAL_CHANGED": "NO",
        "COMMIT": "NO",
        "PUSH": "NO",
        "DEPLOY": "NO",
        "COMMANDER_DECISION_REQUIRED": "YES",
        "UNIQUE_FIRST_TARGET_TOKENS_TRAIN": len(train_unique),
        "UNIQUE_FIRST_TARGET_TOKENS_VAL": len(val_unique),
        "TRAIN_FIRST_TOKEN_FREQUENCY_TABLE": train_table,
        "VAL_FIRST_TOKEN_FREQUENCY_TABLE": val_table,
        "TRAIN_VAL_FIRST_TOKEN_OVERLAP_IDS": sorted(overlap),
        "TRAIN_VAL_FIRST_TOKEN_OVERLAP_N": len(overlap),
        "TRAIN_VAL_FIRST_TOKEN_OVERLAP_FRAC_OF_VAL_UNIQUE": overlap_frac,
        "packed_first_target_positions": n_first_packed,
        "packed_target_positions": n_tgt,
        "packed_eos_positions": n_eos,
        "packed_ignored": n_ign,
        "first_token_occurrence_buckets_train": buckets,
        "val_first_never_in_train": val_never,
        "val_first_seen_once": val_once,
        "val_first_rare_1_3": val_rare,
        "val_first_common_ge4": val_common,
        "val_unseen_fraction": val_unseen_frac,
        "FIRST_TOKEN_DATA_SPARSITY": sparsity,
        "examples_per_first_token_class": examples_per_class,
        "packed_repetitions_per_train_example": packed_reps,
        "loss_by_step": loss_by_step,
        "FIRST_TOKEN_LOSS_SHARE": l10.get("FIRST_TOKEN_LOSS_SHARE"),
        "LATER_TOKEN_LOSS_SHARE": l10.get("LATER_TOKEN_LOSS_SHARE"),
        "EOS_LOSS_SHARE": l10.get("EOS_LOSS_SHARE"),
        "val_geom_by_step": val_geom,
        "train_geom_by_step": train_geom,
        "rank_improved_items": rank_up,
        "rank_worsened_items": rank_down,
        "rank_unchanged_items": rank_same,
        "ARGMAX_TOKEN_CLASSES_PARENT": dict(cls0),
        "ARGMAX_TOKEN_CLASSES_STEP10": dict(cls10),
        "groups": groups,
        "position_nll": pos_move,
        "oracle": oracle,
        "assistant_boundary": {k: {kk: vv for kk, vv in v.items() if kk != "top5"} | {"top5": v.get("top5")} for k, v in boundary.items()},
        "role_history": {
            "pretrain_n_tokens": pre_n,
            "pretrain_commander": pre_cmd,
            "pretrain_assistant": pre_ast,
            "pretrain_commander_density": None if not pre_n else pre_cmd / pre_n,
            "pretrain_assistant_density": None if not pre_n else pre_ast / pre_n,
            "cpt2_n_tokens": int(c2_ids.size),
            "cpt2_commander": commander_c2,
            "cpt2_assistant": assistant_c2,
            "cpt2_commander_density": commander_c2 / max(1, int(c2_ids.size)),
            "cpt2_assistant_density": assistant_c2 / max(1, int(c2_ids.size)),
            "cpt000004_metrics": cpt4_role,
            "cpt000005_metrics": cpt5_role,
            "plm_commander": int(plm_bc[COMMANDER_ID]),
            "plm_assistant": int(plm_bc[ASSISTANT_ID]),
            "plm_n_tokens": int(plm_all_ids.size),
        },
        "heldout_items": heldout_rows,
        "PART_I_CLASS": part_i,
        "RESPONSE_ENTRY_BOTTLENECK_CONFIRMED": bool(entry_bottleneck),
        "limitation_gradients": "No per-position or per-parameter gradients were logged. First-token signal inferred from packed-position counts plus forward CE shares. Backward was not run.",
    }
    write_json(REPORT_PATH, report)
    print(json.dumps({
        "ok": True,
        "report": str(REPORT_PATH),
        "sparsity": sparsity,
        "overlap_frac": overlap_frac,
        "part_i": part_i,
        "entry_bottleneck": entry_bottleneck,
        "train_greedy_10": tr10["greedy_first_match"],
        "val_greedy_10": va10["greedy_first_match"],
        "oracle_gain": oracle.get("ORACLE_FIRST_TOKEN_GAIN"),
        "loss0": l0,
        "loss10": l10,
    }, default=str))
    return report


if __name__ == "__main__":
    main()
