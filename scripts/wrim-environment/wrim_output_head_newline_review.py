"""Read-only output-head / newline-attractor geometry review.

NO optimizer. NO optimizer.step. NO checkpoints. NO new training run.
"""
from __future__ import annotations

import json
import math
import os
import random
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from wrim_plm3_identity import (
    AUTHORIZE_ENV_NAME,
    CANONICAL_CHECKPOINT,
    CANONICAL_HASH,
    EXPECTED_PARENT_MODEL_HASH,
    EXPERIMENTAL_PARENT_CHECKPOINT,
    EXPERIMENTAL_PARENT_CKPT,
    NEWLINE_TOKEN_ID,
    SEED,
    TOKENIZER_EXPECTED_SHA,
)

REPORT_NAME = "WRIM_GENESIS_OUTPUT_HEAD_NEWLINE_ATTRACTOR_REPORT.json"
CLASS_IDS = {
    "yes": 2375,
    "no": 307,
    "red": 5132,
    "blue": 4257,
    "cat": 2563,
    "dog": 8717,
    "stop": 5148,
    "go": 590,
    "one": 400,
    "two": 729,
}


def _write(path: Path, obj: dict[str, Any]) -> None:
    path.write_text(json.dumps(obj, indent=2, default=str) + "\n", encoding="utf-8")


def hidden_forward(model, idx):
    x = model.tok_emb(idx)
    for layer in model.layers:
        x = layer(x)
    return model.norm_f(x)


def total_grad_l2(model) -> float:
    sq = 0.0
    for p in model.parameters():
        if p.grad is None:
            continue
        g = p.grad.detach().float()
        sq += float(g.pow(2).sum().item())
    return sq ** 0.5


def tok_emb_grad_l2(model) -> float:
    g = model.tok_emb.weight.grad
    if g is None:
        return 0.0
    return float(g.detach().float().norm(2).item())


def module_grads(model) -> dict[str, float]:
    attn = 0.0
    ffn = 0.0
    for name, p in model.named_parameters():
        if p.grad is None:
            continue
        n = float(p.grad.detach().float().norm(2).item())
        if ".attn" in name and ".attn_norm" not in name:
            attn += n * n
        elif ".ffn" in name and ".ffn_norm" not in name:
            ffn += n * n
    return {"attn": attn ** 0.5, "ffn": ffn ** 0.5, "tok_emb": tok_emb_grad_l2(model), "total": total_grad_l2(model)}


def percentile_rank(values: np.ndarray, query: float) -> float:
    return float((values <= query).mean() * 100.0)


def top_neighbors(W: np.ndarray, tid: int, tokenizer, k: int = 12) -> list[dict[str, Any]]:
    v = W[tid]
    n = np.linalg.norm(v) + 1e-12
    norms = np.linalg.norm(W, axis=1) + 1e-12
    cos = (W @ v) / (norms * n)
    order = np.argsort(-cos)
    rows = []
    for i in order[: k + 1]:
        if int(i) == tid:
            continue
        rows.append({"id": int(i), "piece": tokenizer.id_to_token(int(i)), "cosine": float(cos[i])})
        if len(rows) >= k:
            break
    return rows


def encode_prefix(tokenizer, prompt: str) -> list[int]:
    from wrim_cpt_identity import ASSISTANT_ID, BOS_ID, COMMANDER_ID

    raw = f"<|commander|>\n{prompt}<|assistant|>"
    body = list(tokenizer.encode(raw, add_special_tokens=False).ids)
    if body[0] != COMMANDER_ID or body[-1] != ASSISTANT_ID:
        raise ValueError("prefix malformed")
    return [BOS_ID, *body]


def load_rows(path: Path) -> list[dict[str, Any]]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def continuation_loss(logits, y, y_mask, first_w: float = 1.0, keep_mask=None):
    import torch
    import torch.nn.functional as F

    from wrim_plm3_encode import MASK_CAP_FIRST
    from wrim_target_only_loss import IGNORE_INDEX, MASK_CAP_EOS, MASK_CAP_TARGET, MASK_IGNORE

    labels = y.clone()
    labels = labels.masked_fill(y_mask == MASK_IGNORE, IGNORE_INDEX)
    nll = F.cross_entropy(
        logits.reshape(-1, logits.size(-1)),
        labels.reshape(-1),
        reduction="none",
        ignore_index=IGNORE_INDEX,
    ).view_as(y)
    w = torch.zeros_like(y_mask, dtype=torch.float32)
    w = w.masked_fill(y_mask == MASK_CAP_FIRST, first_w)
    w = w.masked_fill(y_mask == MASK_CAP_TARGET, 1.0)
    w = w.masked_fill(y_mask == MASK_CAP_EOS, 1.0)
    if keep_mask is not None:
        w = w * keep_mask.to(dtype=w.dtype)
    mass = w.sum().clamp_min(1.0)
    loss = (nll * w).sum() / mass
    n_first = int(((w > 0) & (y_mask == MASK_CAP_FIRST)).sum().item())
    n_later = int(((w > 0) & (y_mask == MASK_CAP_TARGET)).sum().item())
    n_eos = int(((w > 0) & (y_mask == MASK_CAP_EOS)).sum().item())
    ce_first = float(nll[y_mask == MASK_CAP_FIRST].mean().item()) if int((y_mask == MASK_CAP_FIRST).sum()) else None
    ce_later = float(nll[y_mask == MASK_CAP_TARGET].mean().item()) if int((y_mask == MASK_CAP_TARGET).sum()) else None
    ce_eos = float(nll[y_mask == MASK_CAP_EOS].mean().item()) if int((y_mask == MASK_CAP_EOS).sum()) else None
    return {
        "loss": loss,
        "FIRST_TOKEN_CE": ce_first,
        "LATER_TOKEN_CE": ce_later,
        "EOS_CE": ce_eos,
        "n_first": n_first,
        "n_later": n_later,
        "n_eos": n_eos,
        "mass": float(mass.item()),
    }


def probe_grad(model, x, y, y_mask, *, first_w=1.0, keep_mask=None, split_tied=False):
    import torch
    import torch.nn.functional as F

    model.zero_grad(set_to_none=True)
    if not split_tied:
        logits = model(x)
        split = continuation_loss(logits, y, y_mask, first_w=first_w, keep_mask=keep_mask)
        split["loss"].backward()
        mg = module_grads(model)
        model.zero_grad(set_to_none=True)
        return {
            **mg,
            "FIRST_TOKEN_CE": split["FIRST_TOKEN_CE"],
            "LATER_TOKEN_CE": split["LATER_TOKEN_CE"],
            "EOS_CE": split["EOS_CE"],
            "weighted_loss": float(split["loss"].detach().item()),
            "n_first": split["n_first"],
            "n_later": split["n_later"],
            "n_eos": split["n_eos"],
            "mass": split["mass"],
        }

    W = model.tok_emb.weight
    W_in = W.detach().clone().requires_grad_(True)
    W_out = W.detach().clone().requires_grad_(True)
    h = F.embedding(x, W_in)
    for layer in model.layers:
        h = layer(h)
    h = model.norm_f(h)
    logits = F.linear(h, W_out)
    split = continuation_loss(logits, y, y_mask, first_w=first_w, keep_mask=keep_mask)
    split["loss"].backward()
    in_n = float(W_in.grad.detach().float().norm(2).item()) if W_in.grad is not None else 0.0
    out_n = float(W_out.grad.detach().float().norm(2).item()) if W_out.grad is not None else 0.0
    if W_in.grad is not None and W_out.grad is not None:
        both = W_in.grad.detach().float() + W_out.grad.detach().float()
        sum_n = float(both.norm(2).item())
        in_share = float((W_in.grad.detach().float().pow(2).sum() / both.pow(2).sum().clamp_min(1e-12)).item())
        out_share = float((W_out.grad.detach().float().pow(2).sum() / both.pow(2).sum().clamp_min(1e-12)).item())
        cos = float(
            torch.nn.functional.cosine_similarity(
                W_in.grad.detach().flatten().float(),
                W_out.grad.detach().flatten().float(),
                dim=0,
            ).item()
        )
    else:
        sum_n = in_n + out_n
        in_share = None
        out_share = None
        cos = None
    model.zero_grad(set_to_none=True)
    return {
        "input_role_grad_l2": in_n,
        "output_role_grad_l2": out_n,
        "sum_tied_roles_l2": sum_n,
        "input_role_sq_share": in_share,
        "output_role_sq_share": out_share,
        "input_output_grad_cosine": cos,
        "weighted_loss": float(split["loss"].detach().item()),
    }


def condition_stats(model, tokenizer, device, prefixes: list[list[int]], target_ids: list[int] | None = None) -> dict[str, Any]:
    import torch

    from wrim_cpt_identity import EOS_ID

    W = model.tok_emb.weight.detach().float()
    nl = W[NEWLINE_TOKEN_ID]
    eos = W[EOS_ID]
    hiddens = []
    nl_logits = []
    tgt_logits = []
    argmaxes = []
    h_norms = []
    cos_nl = []
    cos_tgt = []
    cos_eos = []
    dots_nl = []
    dots_tgt = []
    ents = []
    top10 = []
    with torch.inference_mode():
        for i, pref in enumerate(prefixes):
            x = torch.tensor([pref], dtype=torch.long, device=device)
            h = hidden_forward(model, x)[0, -1].float()
            logits = torch.nn.functional.linear(h, W)
            p = torch.softmax(logits, dim=-1)
            hiddens.append(h.cpu().numpy())
            h_norms.append(float(h.norm().item()))
            nl_logits.append(float(logits[NEWLINE_TOKEN_ID].item()))
            argmaxes.append(int(logits.argmax().item()))
            cos_nl.append(float(torch.nn.functional.cosine_similarity(h, nl, dim=0).item()))
            cos_eos.append(float(torch.nn.functional.cosine_similarity(h, eos, dim=0).item()))
            dots_nl.append(float((h * nl).sum().item()))
            ents.append(float((-(p * torch.log(p.clamp_min(1e-12))).sum()).item()))
            if target_ids is not None:
                tid = target_ids[i]
                tgt_logits.append(float(logits[tid].item()))
                tw = W[tid]
                cos_tgt.append(float(torch.nn.functional.cosine_similarity(h, tw, dim=0).item()))
                dots_tgt.append(float((h * tw).sum().item()))
            if i < 6:
                order = torch.argsort(logits, descending=True)[:10]
                top10.append(
                    [
                        {
                            "id": int(j),
                            "piece": tokenizer.id_to_token(int(j)),
                            "logit": float(logits[int(j)].item()),
                            "prob": float(p[int(j)].item()),
                        }
                        for j in order.tolist()
                    ]
                )
    H = np.stack(hiddens)
    return {
        "n": len(prefixes),
        "HIDDEN_NORM_MEAN": float(np.mean(h_norms)),
        "NEWLINE_LOGIT": float(np.mean(nl_logits)),
        "TARGET_LOGIT": float(np.mean(tgt_logits)) if tgt_logits else None,
        "TARGET_NEWLINE_GAP": float(np.mean(np.array(tgt_logits) - np.array(nl_logits))) if tgt_logits else None,
        "NEWLINE_ARGMAX_RATE": float(np.mean([a == NEWLINE_TOKEN_ID for a in argmaxes])),
        "NEWLINE_COSINE": float(np.mean(cos_nl)),
        "TARGET_COSINE": float(np.mean(cos_tgt)) if cos_tgt else None,
        "EOS_COSINE": float(np.mean(cos_eos)),
        "NEWLINE_DOT": float(np.mean(dots_nl)),
        "TARGET_DOT": float(np.mean(dots_tgt)) if dots_tgt else None,
        "ENTROPY": float(np.mean(ents)),
        "mean_hidden": H.mean(axis=0),
        "argmax_counter": dict(Counter(tokenizer.id_to_token(a) for a in argmaxes)),
        "top10_examples": top10,
        "_H": H,
        "_argmaxes": argmaxes,
    }


def pca_2(H: np.ndarray) -> dict[str, Any]:
    X = H - H.mean(axis=0, keepdims=True)
    _u, s, _vt = np.linalg.svd(X, full_matrices=False)
    var = s ** 2
    var = var / max(float(var.sum()), 1e-12)
    return {"explained_var_top2": [float(var[0]), float(var[1])]}


def main() -> dict[str, Any]:
    import torch
    from safetensors.torch import load_file as load_safetensors_file
    from tokenizers import Tokenizer

    from run000007_preflight import resolve_dump_root, sha256_file
    from wrim_cpt_identity import ASSISTANT_ID, BOS_ID, COMMANDER_ID, EOS_ID, LINUX_CKPT_ROOT, LINUX_DATA_ROOT
    from wrim_cpt_stage_b_identity import PROVISIONAL_STAGE_B_PARENT_CHECKPOINT
    from wrim_g20m import VOCAB_SIZE, WRIM0Model
    from wrim_plm1_encode import encode_example as encode_plm1
    from wrim_plm1_encode import pack_train_stream as pack_plm1
    from wrim_plm1_encode import slice_batches as slice_plm1
    from wrim_plm3_encode import MASK_CAP_FIRST, encode_example, pack_train_stream, slice_batches
    from wrim_proven_load import disable_tf32
    from wrim_resumable_checkpoint import MODEL_NAME
    from wrim_target_only_loss import MASK_CAP_EOS, MASK_CAP_TARGET, MASK_IGNORE

    os.environ[AUTHORIZE_ENV_NAME] = "OFF"
    t0 = datetime.now(timezone.utc).isoformat()
    dump = resolve_dump_root(None)
    assert dump is not None
    parent = Path(EXPERIMENTAL_PARENT_CKPT)
    exp_model = parent / MODEL_NAME
    parent_hash = sha256_file(exp_model)
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    tok_hash = sha256_file(tok_path)
    step400 = Path(LINUX_CKPT_ROOT) / PROVISIONAL_STAGE_B_PARENT_CHECKPOINT / MODEL_NAME
    can_hash = sha256_file(step400)
    tokenizer = Tokenizer.from_file(str(tok_path))

    disable_tf32()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)

    model = WRIM0Model()
    model.load_state_dict(load_safetensors_file(str(exp_model)), strict=True)
    model.to(device)
    model.eval()
    W = model.tok_emb.weight.detach().float().cpu().numpy()
    norms = np.linalg.norm(W, axis=1)
    nl_norm = float(norms[NEWLINE_TOKEN_ID])
    class_norms = {k: float(norms[v]) for k, v in CLASS_IDS.items()}
    special_norms = {
        "newline": nl_norm,
        "EOS": float(norms[EOS_ID]),
        "assistant": float(norms[ASSISTANT_ID]),
        "commander": float(norms[COMMANDER_ID]),
        "BOS": float(norms[BOS_ID]),
    }

    from wrim_cpt2_identity import CORPUS_VERSION as CPT2
    from wrim_cpt_stage_b_corpus import corpus_root, load_jsonl, tokenize_docs

    c2 = corpus_root() / f"{CPT2}-TRAIN.jsonl"
    cpt_bc = np.zeros(VOCAB_SIZE, dtype=np.int64)
    if c2.is_file():
        docs = load_jsonl(c2)
        tokdocs = tokenize_docs(docs, tokenizer)
        ids = np.concatenate([np.asarray(r["token_ids"], dtype=np.int32) for r in tokdocs if r.get("token_ids")])
        ids = ids[(ids >= 0) & (ids < VOCAB_SIZE)]
        cpt_bc = np.bincount(ids, minlength=VOCAB_SIZE)
    npy = dump / "model-lab" / "manifests" / "wrim0_corpus_shards" / "train.npy"
    pre_bc = np.zeros(VOCAB_SIZE, dtype=np.int64)
    if npy.is_file():
        arr = np.load(npy, mmap_mode="r")
        for s in range(0, arr.size, 4_000_000):
            chunk = np.asarray(arr[s : s + 4_000_000], dtype=np.int64)
            chunk = chunk[(chunk >= 0) & (chunk < VOCAB_SIZE)]
            pre_bc += np.bincount(chunk, minlength=VOCAB_SIZE)

    top_freq_ids = np.argsort(-pre_bc)[:100]
    top_freq_norm_mean = float(norms[top_freq_ids].mean())

    data = Path(LINUX_DATA_ROOT)
    cont_val = load_rows(data / "WR-CORPUS-PLM-FIRST-TOKEN-CONTINUATION-1-v1.0.0" / "val.jsonl")
    cont_train = load_rows(data / "WR-CORPUS-PLM-FIRST-TOKEN-CONTINUATION-1-v1.0.0" / "train.jsonl")
    st_train = load_rows(data / "WR-CORPUS-PLM-FIRST-TOKEN-1-v1.0.0" / "train.jsonl")
    probe_train = load_rows(data / "WR-CORPUS-PLM-PROBE-1-v1.0.0" / "train.jsonl")

    held_pref = []
    held_tgt = []
    for rec in cont_val:
        enc = encode_example(tokenizer, rec)
        held_pref.append(encode_prefix(tokenizer, rec["prompt"]))
        held_tgt.append(int(enc["first_target_id"]))
    train_pref = [encode_prefix(tokenizer, rec["prompt"]) for rec in cont_train[:60]]
    train_tgt = [int(encode_example(tokenizer, rec)["first_target_id"]) for rec in cont_train[:60]]

    docs_txt = [
        "The river was quiet in the early morning light and birds moved among the trees.",
        "A small shop sold bread, milk, and simple tools to people from the nearby farms.",
        "In winter the hills were white and the road to town was often closed by snow.",
        "She opened the book and read the first page slowly, then paused to think.",
        "Computers can store numbers, words, and pictures in files on a disk.",
        "The committee met on Tuesday to review the plan and vote on the next step.",
        "Rain fell on the roof all night, and by dawn the garden soil was dark and wet.",
        "He walked along the street until he reached the old bridge over the canal.",
        "def add(a, b):\n    return a + b\n",
        '{"ok": true, "count": 3, "name": "sample"}',
    ]
    doc_pref = []
    for t in docs_txt:
        ids = [BOS_ID, *list(tokenizer.encode(t, add_special_tokens=False).ids)]
        doc_pref.append(ids[:64] if len(ids) > 8 else ids)
    cmd_only = []
    for rec in cont_val[:30]:
        raw = f"<|commander|>\n{rec['prompt']}"
        body = list(tokenizer.encode(raw, add_special_tokens=False).ids)
        cmd_only.append([BOS_ID, *body])
    body_cn = list(tokenizer.encode("<|commander|>\n", add_special_tokens=False).ids)
    cmd_nl = [[BOS_ID, *body_cn]]
    short_ast = [encode_prefix(tokenizer, p) for p in ["yes or no?", "Name a color.", "Count to two.", "Go or stop?", "Cat or dog?"]]

    part_a = condition_stats(model, tokenizer, device, held_pref, held_tgt)
    part_train = condition_stats(model, tokenizer, device, train_pref, train_tgt)
    part_doc = condition_stats(model, tokenizer, device, doc_pref)
    part_cmd = condition_stats(model, tokenizer, device, cmd_only)
    part_cmd_nl = condition_stats(model, tokenizer, device, cmd_nl)
    part_short = condition_stats(model, tokenizer, device, short_ast)

    H_all = np.concatenate([part_a["_H"], part_doc["_H"], part_cmd["_H"]], axis=0)
    pca = pca_2(H_all)
    argmax_ids = part_a["_argmaxes"] + part_train["_argmaxes"]
    top_argmax = [i for i, _ in Counter(argmax_ids).most_common(20)]
    top_argmax_norm = {tokenizer.id_to_token(i): float(norms[i]) for i in top_argmax}

    ma = part_a["mean_hidden"]
    md = part_doc["mean_hidden"]
    mc = part_cmd["mean_hidden"]

    def vcos(a, b) -> float:
        return float(np.dot(a, b) / ((np.linalg.norm(a) + 1e-12) * (np.linalg.norm(b) + 1e-12)))

    cos_ast_doc = vcos(ma, md)
    cos_ast_cmd = vcos(ma, mc)
    nl_w = W[NEWLINE_TOKEN_ID]
    cos_a_nl = vcos(ma, nl_w)
    cos_d_nl = vcos(md, nl_w)

    for d in (part_a, part_train, part_doc, part_cmd, part_cmd_nl, part_short):
        d.pop("_H", None)
        d.pop("_argmaxes", None)
        d.pop("mean_hidden", None)

    neighbors = {
        "assistant": top_neighbors(W, ASSISTANT_ID, tokenizer),
        "commander": top_neighbors(W, COMMANDER_ID, tokenizer),
        "newline": top_neighbors(W, NEWLINE_TOKEN_ID, tokenizer),
        "EOS": top_neighbors(W, EOS_ID, tokenizer),
        "Ġyes": top_neighbors(W, CLASS_IDS["yes"], tokenizer, k=8),
        "Ġno": top_neighbors(W, CLASS_IDS["no"], tokenizer, k=8),
    }

    model.train()
    enc_cont = [encode_example(tokenizer, r) for r in cont_train]
    stream, mask = pack_train_stream(enc_cont)
    batches = slice_batches(stream, mask)
    x_np, y_np, m_np = batches[0]
    x = torch.tensor(x_np, dtype=torch.long, device=device)
    y = torch.tensor(y_np, dtype=torch.long, device=device)
    y_mask = torch.tensor(m_np, dtype=torch.int8, device=device)

    tied = probe_grad(model, x, y, y_mask, first_w=1.0, split_tied=True)
    full_a = probe_grad(model, x, y, y_mask, first_w=1.0)
    first_only = torch.zeros_like(y_mask, dtype=torch.float32)
    first_only = first_only.masked_fill(y_mask == MASK_CAP_FIRST, 1.0)
    later_only = torch.zeros_like(y_mask, dtype=torch.float32)
    later_only = later_only.masked_fill(y_mask == MASK_CAP_TARGET, 1.0)
    eos_only = torch.zeros_like(y_mask, dtype=torch.float32)
    eos_only = eos_only.masked_fill(y_mask == MASK_CAP_EOS, 1.0)
    g_first = probe_grad(model, x, y, y_mask, first_w=1.0, keep_mask=first_only)
    g_later = probe_grad(model, x, y, y_mask, first_w=1.0, keep_mask=later_only)
    g_eos = probe_grad(model, x, y, y_mask, first_w=1.0, keep_mask=eos_only)

    sup = (y_mask != MASK_IGNORE).detach().cpu().numpy().reshape(-1)
    idx = np.flatnonzero(sup)
    density_rows = []
    for frac, tag in ((1.0, "1"), (0.5, "1/2"), (0.25, "1/4"), (0.125, "1/8")):
        keep_idx = idx[: max(1, int(round(len(idx) * frac)))]
        km = np.zeros_like(sup, dtype=np.float32)
        km[keep_idx] = 1.0
        km_t = torch.tensor(km.reshape(y_mask.shape), dtype=torch.float32, device=device)
        g = probe_grad(model, x, y, y_mask, first_w=1.0, keep_mask=km_t)
        density_rows.append({"keep": tag, "n_keep": int(keep_idx.size), **g})

    micro_rows = []
    for n in (8, 4, 2, 1):
        g = probe_grad(model, x[:n], y[:n], y_mask[:n], first_w=1.0)
        micro_rows.append({"microbatch": n, **g})

    class_grad = []
    for cls, tid in CLASS_IDS.items():
        km = torch.zeros_like(y_mask, dtype=torch.float32)
        km = km.masked_fill((y_mask == MASK_CAP_FIRST) & (y == tid), 1.0)
        npos = int(km.sum().item())
        if npos == 0:
            continue
        g = probe_grad(model, x, y, y_mask, first_w=1.0, keep_mask=km)
        class_grad.append(
            {
                "CLASS": cls,
                "TOKEN_ID": tid,
                "n_first_in_batch": npos,
                "PRETRAIN_FREQUENCY": int(pre_bc[tid]),
                "CPT_FREQUENCY": int(cpt_bc[tid]),
                "embed_norm": class_norms[cls],
                **g,
            }
        )

    enc_st = [encode_example(tokenizer, r) for r in st_train]
    st_stream, st_mask = pack_train_stream(enc_st)
    st_batches = slice_batches(st_stream, st_mask)
    sx, sy, sm = st_batches[0]
    stx = torch.tensor(sx, dtype=torch.long, device=device)
    sty = torch.tensor(sy, dtype=torch.long, device=device)
    stm = torch.tensor(sm, dtype=torch.int8, device=device)
    g_st1 = probe_grad(model, stx, sty, stm, first_w=1.0)
    g_st2 = probe_grad(model, stx, sty, stm, first_w=2.0)

    enc_p = [encode_plm1(tokenizer, r) for r in probe_train]
    p_stream, p_mask = pack_plm1(enc_p)
    p_batches = slice_plm1(p_stream, p_mask)
    px, py, pm = p_batches[0]
    g_p1 = probe_grad(
        model,
        torch.tensor(px, dtype=torch.long, device=device),
        torch.tensor(py, dtype=torch.long, device=device),
        torch.tensor(pm, dtype=torch.int8, device=device),
        first_w=1.0,
    )
    n_p_tgt = int((pm == MASK_CAP_TARGET).sum())
    n_p_eos = int((pm == MASK_CAP_EOS).sum())
    n_st_first = int((sm == MASK_CAP_FIRST).sum())
    n_st_eos = int((sm == MASK_CAP_EOS).sum())
    n_c_first = int((m_np == MASK_CAP_FIRST).sum())
    n_c_later = int((m_np == MASK_CAP_TARGET).sum())
    n_c_eos = int((m_np == MASK_CAP_EOS).sum())

    tots = [r["total"] for r in density_rows]
    fracs = [1.0, 0.5, 0.25, 0.125]
    rel = [t / tots[0] for t in tots]
    err_flat = float(np.mean([(a - 1.0) ** 2 for a in rel]))
    err_lin = float(np.mean([(a - f) ** 2 for a, f in zip(rel, fracs)]))
    err_sqrt = float(np.mean([(a - math.sqrt(f)) ** 2 for a, f in zip(rel, fracs)]))
    if err_lin < min(err_flat, err_sqrt) and err_lin < 0.05:
        scaling = "LINEAR"
    elif err_sqrt <= err_flat:
        scaling = "SUBLINEAR"
    elif err_flat < err_lin:
        scaling = "SUBLINEAR"
    else:
        scaling = "IRREGULAR"

    src_votes = {
        "document": part_doc["NEWLINE_ARGMAX_RATE"],
        "commander_only": part_cmd["NEWLINE_ARGMAX_RATE"],
        "commander_newline": part_cmd_nl["NEWLINE_ARGMAX_RATE"],
        "assistant_heldout": part_a["NEWLINE_ARGMAX_RATE"],
        "assistant_short": part_short["NEWLINE_ARGMAX_RATE"],
    }
    if part_doc["NEWLINE_ARGMAX_RATE"] >= 0.7 and part_a["NEWLINE_ARGMAX_RATE"] >= 0.95:
        nl_source = "MULTIFACTOR"
    elif part_a["NEWLINE_ARGMAX_RATE"] >= 0.95 and part_doc["NEWLINE_ARGMAX_RATE"] < 0.5:
        nl_source = "ASSISTANT_TOKEN_STATE"
    else:
        nl_source = "MULTIFACTOR"

    if part_a["NEWLINE_ARGMAX_RATE"] < 0.5:
        ast_state = "STRONG"
    elif cos_ast_doc >= 0.95:
        ast_state = "ABSENT"
    else:
        ast_state = "WEAK"

    if tied["output_role_grad_l2"] > 0 and tied["output_role_grad_l2"] >= 0.4 * (tied["sum_tied_roles_l2"] or 1):
        untied = "SUPPORTED"
    elif tied["output_role_grad_l2"] > 0:
        untied = "POSSIBLE"
    else:
        untied = "NOT_SUPPORTED"

    primary = "MULTIFACTOR"
    secondary = "ASSISTANT_CONTROL_STATE_WEAK"
    nl_pct = percentile_rank(norms, nl_norm)
    ast_pct = percentile_rank(norms, float(norms[ASSISTANT_ID]))
    mean_tgt_norm = float(np.mean(list(class_norms.values())))
    mean_tgt_pct = percentile_rank(norms, mean_tgt_norm)
    hnorm = part_a["HIDDEN_NORM_MEAN"]
    nl_dir = hnorm * nl_norm * part_a["NEWLINE_COSINE"]
    tgt_dir = hnorm * mean_tgt_norm * (part_a["TARGET_COSINE"] or 0)
    counterfactual_nl_logit = hnorm * mean_tgt_norm * part_a["NEWLINE_COSINE"]
    gap_from_norm = hnorm * (nl_norm - mean_tgt_norm) * part_a["NEWLINE_COSINE"]
    gap_from_align = hnorm * mean_tgt_norm * (part_a["NEWLINE_COSINE"] - (part_a["TARGET_COSINE"] or 0))

    freq_specials = {
        "newline_pretrain": int(pre_bc[NEWLINE_TOKEN_ID]),
        "newline_cpt": int(cpt_bc[NEWLINE_TOKEN_ID]),
        "assistant_pretrain": int(pre_bc[ASSISTANT_ID]),
        "assistant_cpt": int(cpt_bc[ASSISTANT_ID]),
        "commander_pretrain": int(pre_bc[COMMANDER_ID]),
        "commander_cpt": int(cpt_bc[COMMANDER_ID]),
        "eos_pretrain": int(pre_bc[EOS_ID]),
        "eos_cpt": int(cpt_bc[EOS_ID]),
        "pretrain_total": int(pre_bc.sum()),
        "cpt_total": int(cpt_bc.sum()),
    }

    levers = {
        "A": {
            "WHAT_IT_CHANGES": "Fewer packed examples / smaller microbatch / fewer supervised positions per step",
            "WHY_IT_MAY_REDUCE_GRADIENT": "Only if loss is summed or hardest CE mass is removed. Mean-reduced CE often does not drop total L2 linearly.",
            "ADDRESSES_NEWLINE": "NO",
            "ARCHITECTURE_CHANGE_REQUIRED": "NO",
            "RETENTION_RISK": "LOW if step budget unchanged",
            "SAFE_PREPARATION_TEST": "Repeat keep-mask probe; require unclipped L2 < 6.5 before optimizer.step",
        },
        "B": {
            "WHAT_IT_CHANGES": "Gradient accumulation of small microbatches",
            "WHY_IT_MAY_REDUCE_GRADIENT": "Per-microstep clip sees a smaller tensor; accumulated mean-loss grads can still be large",
            "ADDRESSES_NEWLINE": "NO",
            "ARCHITECTURE_CHANGE_REQUIRED": "NO",
            "RETENTION_RISK": "LOW-MODERATE; clip semantics change",
            "SAFE_PREPARATION_TEST": "Backward-only per microbatch plus simulated accumulate without step",
        },
        "C": {
            "WHAT_IT_CHANGES": "Assistant-boundary control-state training with one non-newline first token per sequence",
            "WHY_IT_MAY_REDUCE_GRADIENT": "Collapses packing density; still faces first-token CE unless the hidden state moves",
            "ADDRESSES_NEWLINE": "YES",
            "ARCHITECTURE_CHANGE_REQUIRED": "NO",
            "RETENTION_RISK": "MODERATE if document newline prior shifts",
            "SAFE_PREPARATION_TEST": "Single-position-per-row backward probe; stop if L2 >= 8",
        },
        "D": {
            "WHAT_IT_CHANGES": "Newline suppression / contrastive target-vs-newline at assistant position",
            "WHY_IT_MAY_REDUCE_GRADIENT": "Does not reduce CE grad by itself; can increase it",
            "ADDRESSES_NEWLINE": "YES",
            "ARCHITECTURE_CHANGE_REQUIRED": "NO",
            "RETENTION_RISK": "HIGH if documents still need newline",
            "SAFE_PREPARATION_TEST": "Forward-only gap tracking; any backward must meet GRAD_HARD on a tiny pack",
        },
        "E": {
            "WHAT_IT_CHANGES": "Temporary output-head-specific training on tied tok_emb",
            "WHY_IT_MAY_REDUCE_GRADIENT": "Stops body grads; tok_emb L2 is still near HARD by itself",
            "ADDRESSES_NEWLINE": "PARTIAL",
            "ARCHITECTURE_CHANGE_REQUIRED": "NO",
            "RETENTION_RISK": "HIGH because W is also the input embed",
            "SAFE_PREPARATION_TEST": "Freeze body and re-probe tok_emb-only L2",
        },
        "F": {
            "WHAT_IT_CHANGES": "Untie output projection from input embeddings",
            "WHY_IT_MAY_REDUCE_GRADIENT": "Input and output grads would no longer add on the same parameter",
            "ADDRESSES_NEWLINE": "PARTIAL",
            "ARCHITECTURE_CHANGE_REQUIRED": "YES",
            "RETENTION_RISK": "HIGH — not authorized",
            "SAFE_PREPARATION_TEST": "Not authorized. Tied-split already estimates isolation.",
        },
        "G": {
            "WHAT_IT_CHANGES": "Role-token pretraining before answer training",
            "WHY_IT_MAY_REDUCE_GRADIENT": "If assistant hidden moves off newline, first-token CE and grads fall",
            "ADDRESSES_NEWLINE": "YES if successful",
            "ARCHITECTURE_CHANGE_REQUIRED": "NO",
            "RETENTION_RISK": "MODERATE",
            "SAFE_PREPARATION_TEST": "Role-token-only sequences with one supervised position; backward L2 < 6.5",
        },
        "H": {
            "WHAT_IT_CHANGES": "Short-answer curriculum with fewer simultaneous packed examples per 512-row",
            "WHY_IT_MAY_REDUCE_GRADIENT": "Same as A unless CE itself is easier",
            "ADDRESSES_NEWLINE": "NO",
            "ARCHITECTURE_CHANGE_REQUIRED": "NO",
            "RETENTION_RISK": "LOW",
            "SAFE_PREPARATION_TEST": "One response per row, backward-only",
        },
    }

    rec = (
        "Prepare a single-supervised-position assistant-boundary probe "
        "(one first-token label per sequence, no multi-example 512 packing). "
        "Backward-only first. If L2 still >= 8, next lever is role-token control-state "
        "(OPTION G) or output-row diagnosis (OPTION E). Do not untie the head. "
        "Do not lower LR as the primary fix. Do not raise GRAD_HARD."
    )

    report = {
        "ok": True,
        "kind": "WRIM_GENESIS_OUTPUT_HEAD_NEWLINE_ATTRACTOR_REPORT",
        "CANONICAL": CANONICAL_CHECKPOINT,
        "PARENT": EXPERIMENTAL_PARENT_CHECKPOINT,
        "PARENT_MODEL_HASH": parent_hash,
        "PARENT_MODEL_HASH_OK": parent_hash == EXPECTED_PARENT_MODEL_HASH,
        "CANONICAL_HASH_OK": can_hash == CANONICAL_HASH,
        "TOKENIZER_HASH_OK": tok_hash == TOKENIZER_EXPECTED_SHA,
        "PRIMARY_CAUSE": primary,
        "SECONDARY_CAUSE": secondary,
        "NEWLINE_LOGIT": part_a["NEWLINE_LOGIT"],
        "TARGET_LOGIT": part_a["TARGET_LOGIT"],
        "TARGET_NEWLINE_GAP": part_a["TARGET_NEWLINE_GAP"],
        "NEWLINE_EMBED_NORM": nl_norm,
        "TARGET_EMBED_NORM": mean_tgt_norm,
        "NEWLINE_EMBED_NORM_PERCENTILE": nl_pct,
        "ASSISTANT_TOKEN_EMBED_NORM": float(norms[ASSISTANT_ID]),
        "ASSISTANT_EMBED_NORM_PERCENTILE": ast_pct,
        "TARGET_EMBED_NORM_PERCENTILE": mean_tgt_pct,
        "NEWLINE_COSINE_ALIGNMENT": part_a["NEWLINE_COSINE"],
        "TARGET_COSINE_ALIGNMENT": part_a["TARGET_COSINE"],
        "NEWLINE_DOT": part_a["NEWLINE_DOT"],
        "TARGET_DOT": part_a["TARGET_DOT"],
        "HIDDEN_STATE_NORM": part_a["HIDDEN_NORM_MEAN"],
        "LOGIT_DECOMPOSITION": {
            "formula": "logit = ||h|| ||w|| cos",
            "newline_reconstructed": nl_dir,
            "target_reconstructed_mean_class_norm": tgt_dir,
            "gap_component_from_norm": gap_from_norm,
            "gap_component_from_alignment": gap_from_align,
            "counterfactual_newline_logit_if_norm_eq_mean_target": float(counterfactual_nl_logit),
            "newline_unusually_large_norm": bool(nl_pct >= 90),
        },
        "ASSISTANT_CONTROL_STATE": ast_state,
        "ASSISTANT_VS_DOCUMENT_MEAN_COSINE": cos_ast_doc,
        "ASSISTANT_VS_COMMANDER_MEAN_COSINE": cos_ast_cmd,
        "ASSISTANT_MEAN_VS_NEWLINE_COSINE": cos_a_nl,
        "DOCUMENT_MEAN_VS_NEWLINE_COSINE": cos_d_nl,
        "TIED_HEAD_CONTRIBUTION": tied,
        "UNTIED_HEAD_HYPOTHESIS": untied,
        "SUPERVISED_DENSITY_ANALYSIS": {
            "plm000001_first_batch": {
                "n_target": n_p_tgt,
                "n_eos": n_p_eos,
                "supervised": n_p_tgt + n_p_eos,
                "grad": g_p1,
                "historical_run_max_grad": 7.157,
            },
            "single_token_first_batch_w1": {"n_first": n_st_first, "n_later": 0, "n_eos": n_st_eos, "grad": g_st1},
            "single_token_first_batch_w2": {"grad": g_st2},
            "continuation_A_first_batch": {"n_first": n_c_first, "n_later": n_c_later, "n_eos": n_c_eos, "grad": full_a},
            "loss_on_first_only": g_first,
            "loss_on_later_only": g_later,
            "loss_on_eos_only": g_eos,
        },
        "MICROBATCH_ROW_SCALING": micro_rows,
        "SUPERVISED_KEEP_FRACTION": density_rows,
        "MICROBATCH_GRAD_SCALING": scaling,
        "TARGET_CLASS_GRAD_ANALYSIS": class_grad,
        "NEWLINE_ATTRACTOR_SOURCE": nl_source,
        "CONDITION_NEWLINE_RATES": src_votes,
        "PART_A_HELDOUT_AFTER_ASSISTANT": part_a,
        "PART_C_CONDITIONS": {
            "train_after_assistant": part_train,
            "document": part_doc,
            "commander_only": part_cmd,
            "commander_newline": part_cmd_nl,
            "short_assistant": part_short,
            "pca": pca,
        },
        "PART_B_NORMS": {
            "special": special_norms,
            "classes": class_norms,
            "newline_percentile": nl_pct,
            "assistant_percentile": ast_pct,
            "vocab_mean_norm": float(norms.mean()),
            "vocab_median_norm": float(np.median(norms)),
            "top100_freq_mean_norm": top_freq_norm_mean,
            "top_argmax_norms": top_argmax_norm,
            "EOS_percentile": percentile_rank(norms, float(norms[EOS_ID])),
        },
        "PART_D_NEIGHBORS": neighbors,
        "PART_D_FREQUENCIES": freq_specials,
        "SAFE_NEXT_LEVER": "C_THEN_G",
        "LEVERS": levers,
        "RECOMMENDED_NEXT_PREPARATION": rec,
        "TRAINING_EXECUTED": "NO",
        "OPTIMIZER_CREATED": "NO",
        "OPTIMIZER_STEP": "NO",
        "WEIGHTS_CHANGED": "NO",
        "NEW_RUN_CREATED": "NO",
        "MODEL_PROMOTED": "NO",
        "CANONICAL_CHANGED": "NO",
        "COMMIT": "NO",
        "PUSH": "NO",
        "DEPLOY": "NO",
        "COMMANDER_DECISION_REQUIRED": "YES",
        "timestamp": t0,
        "finished": datetime.now(timezone.utc).isoformat(),
    }
    _write(Path(LINUX_DATA_ROOT) / REPORT_NAME, report)
    return report


if __name__ == "__main__":
    obj = main()
    keys = [
        "PRIMARY_CAUSE",
        "SECONDARY_CAUSE",
        "NEWLINE_LOGIT",
        "TARGET_LOGIT",
        "TARGET_NEWLINE_GAP",
        "NEWLINE_EMBED_NORM",
        "TARGET_EMBED_NORM",
        "NEWLINE_EMBED_NORM_PERCENTILE",
        "NEWLINE_COSINE_ALIGNMENT",
        "TARGET_COSINE_ALIGNMENT",
        "ASSISTANT_TOKEN_EMBED_NORM",
        "ASSISTANT_CONTROL_STATE",
        "UNTIED_HEAD_HYPOTHESIS",
        "MICROBATCH_GRAD_SCALING",
        "NEWLINE_ATTRACTOR_SOURCE",
        "SAFE_NEXT_LEVER",
        "TIED_HEAD_CONTRIBUTION",
        "CONDITION_NEWLINE_RATES",
        "LOGIT_DECOMPOSITION",
        "ASSISTANT_VS_DOCUMENT_MEAN_COSINE",
        "ASSISTANT_VS_COMMANDER_MEAN_COSINE",
        "PART_D_FREQUENCIES",
        "RECOMMENDED_NEXT_PREPARATION",
    ]
    print(json.dumps({k: obj.get(k) for k in keys}, indent=2, default=str))
    print("--- DENSITY ---")
    print(json.dumps(obj.get("SUPERVISED_DENSITY_ANALYSIS"), indent=2, default=str))
    print("--- KEEP ---")
    print(json.dumps(obj.get("SUPERVISED_KEEP_FRACTION"), indent=2, default=str))
    print("--- MICRO ---")
    print(json.dumps(obj.get("MICROBATCH_ROW_SCALING"), indent=2, default=str))
    print("--- CLASS ---")
    print(json.dumps(obj.get("TARGET_CLASS_GRAD_ANALYSIS"), indent=2, default=str))
    print("--- NORMS ---")
    print(json.dumps(obj.get("PART_B_NORMS"), indent=2, default=str))
    print("--- NEIGHBORS ---")
    print(json.dumps(obj.get("PART_D_NEIGHBORS"), indent=2, default=str))
    print("--- CONDITIONS ---")
    print(json.dumps(obj.get("PART_C_CONDITIONS"), indent=2, default=str)[:6000])
