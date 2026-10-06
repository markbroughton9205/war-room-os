#!/usr/bin/env python3
"""WRIM capability plateau review diagnostics. Inference only. Does not train."""
from __future__ import annotations

import json
import math
import sys
from collections import Counter
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import torch
from safetensors.torch import load_file
from tokenizers import Tokenizer

from run000007_preflight import resolve_dump_root
from run000008_capability_eval import score_validator
from safetensors_model import load_model_state_from_safetensors
from stage2_eval import greedy_generate
from wrim_g20m import (
    CONTEXT_LENGTH,
    D_FF,
    D_MODEL,
    HEAD_DIM,
    N_HEADS,
    N_LAYERS,
    VOCAB_SIZE,
    WRIM0Model,
)

CK = Path("/home/chosenone/.local/share/war-room-os/data/wrim-checkpoints/test-only")
ME_ROOT = Path("/home/chosenone/.local/share/war-room-os/data/wrim-environment/WR-CORPUS-MODE-ENTRY-1-v1.0.0")
ME_VAL = ME_ROOT / "WR-CORPUS-MODE-ENTRY-1-v1.0.0-VALIDATION.jsonl"
ME_TRAIN = ME_ROOT / "WR-CORPUS-MODE-ENTRY-1-v1.0.0-TRAIN.jsonl"
OUT = Path("/home/chosenone/.local/share/war-room-os/data/wrim-environment/_plateau-review/wrim_plateau_review.json")


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def tok_ids(tokenizer, text: str) -> list[int]:
    return [int(x) for x in tokenizer.encode(text, add_special_tokens=False).ids]


def tok_pieces(tokenizer, ids: list[int]) -> list[str]:
    return [tokenizer.id_to_token(i) or f"id{i}" for i in ids]


def load_state(path: Path) -> dict[str, torch.Tensor]:
    if path.name == "checkpoint-final.safetensors":
        state, _ = load_model_state_from_safetensors(path)
        return state
    raw = load_file(str(path))
    if any(k.startswith("model.") for k in raw):
        return {k[6:]: v for k, v in raw.items() if k.startswith("model.")}
    return raw


def param_l2_rms(a: dict[str, torch.Tensor], b: dict[str, torch.Tensor]) -> dict[str, float]:
    num = 0.0
    den = 0
    max_abs = 0.0
    n_mismatch = 0
    for k, va in a.items():
        vb = b.get(k)
        if vb is None or va.shape != vb.shape:
            n_mismatch += 1
            continue
        d = (va.float().cpu() - vb.float().cpu()).reshape(-1)
        num += float((d * d).sum().item())
        den += int(d.numel())
        max_abs = max(max_abs, float(d.abs().max().item()))
    rms = math.sqrt(num / den) if den else None
    l2 = math.sqrt(num) if den else None
    return {"l2": l2, "rms": rms, "max_abs": max_abs, "n_params": den, "n_mismatch": n_mismatch}


def classify_piece(p: str) -> str:
    if p in {
        "<|eos|>",
        "<|bos|>",
        "<|pad|>",
        "<|unk|>",
        "<|assistant|>",
        "<|commander|>",
        "<|system|>",
        "<|tool|>",
        "<|evidence|>",
    }:
        return "special"
    if "Ċ" in (p or ""):
        return "newline"
    if p in {":", "Ġ:"}:
        return "colon"
    if p in {"_", "Ġ_"} or (p or "").startswith("_") or (p or "").endswith("_"):
        return "underscore"
    if "`" in (p or ""):
        return "backtick"
    if p in {"{", "}", "[", "]", "Ġ{", "Ġ}", "Ġ[", "Ġ]"}:
        return "json_brace"
    if p in {",", "Ġ,"}:
        return "comma"
    if p in {'"', 'Ġ"', "âĢľ", "âĢĿ"}:
        return "quote"
    if (p or "").startswith("Ġ"):
        return "space_word"
    if (p or "")[:1].isalpha():
        return "bare_word"
    return "other"


def first_logits(model, tokenizer, device, prompt: str) -> torch.Tensor:
    bos = tokenizer.token_to_id("<|bos|>") or 1
    ids = [int(bos), *tok_ids(tokenizer, prompt)]
    x = torch.tensor([ids], dtype=torch.long, device=device)
    with torch.inference_mode():
        return model(x)[0, -1].detach()


def summarize_logits(tokenizer, logits: torch.Tensor, target_id: int) -> dict[str, Any]:
    logits_f = logits.float()
    probs = torch.softmax(logits_f, dim=-1)
    order = torch.argsort(logits_f, descending=True)
    argmax_id = int(order[0].item())
    rank_t = torch.nonzero(order == int(target_id), as_tuple=False)
    rank = int(rank_t[0].item()) + 1 if rank_t.numel() else None
    top10 = []
    for i in range(10):
        tid = int(order[i].item())
        top10.append(
            {
                "rank": i + 1,
                "id": tid,
                "token": tokenizer.id_to_token(tid),
                "logit": float(logits_f[tid].item()),
                "prob": float(probs[tid].item()),
            }
        )
    cat: Counter[str] = Counter()
    for i in range(min(50, int(order.numel()))):
        tid = int(order[i].item())
        cat[classify_piece(tokenizer.id_to_token(tid) or "")] += 1
    t_logit = float(logits_f[int(target_id)].item()) if int(target_id) < logits_f.numel() else None
    a_logit = float(logits_f[argmax_id].item())
    return {
        "ARGMAX_TOKEN": tokenizer.id_to_token(argmax_id),
        "ARGMAX_TOKEN_ID": argmax_id,
        "ARGMAX_LOGIT": a_logit,
        "ARGMAX_PROB": float(probs[argmax_id].item()),
        "TARGET_TOKEN": tokenizer.id_to_token(int(target_id)),
        "TARGET_TOKEN_ID": int(target_id),
        "TARGET_LOGIT": t_logit,
        "TARGET_PROB": float(probs[int(target_id)].item()) if int(target_id) < probs.numel() else None,
        "TARGET_RANK": rank,
        "LOGIT_GAP": (t_logit - a_logit) if t_logit is not None else None,
        "TOP_10_TOKENS": top10,
        "TOP_50_CATEGORY_SUMMARY": dict(cat),
    }


def sample_next(logits: torch.Tensor, *, temperature: float | None, top_k: int | None, top_p: float | None, greedy: bool) -> int:
    if greedy:
        return int(torch.argmax(logits).item())
    x = logits.float()
    if temperature and temperature > 0:
        x = x / float(temperature)
    if top_k is not None:
        k = min(int(top_k), x.numel())
        vals, idx = torch.topk(x, k)
        mask = torch.full_like(x, float("-inf"))
        mask.scatter_(0, idx, vals)
        x = mask
    if top_p is not None:
        probs = torch.softmax(x, dim=-1)
        sorted_p, sorted_i = torch.sort(probs, descending=True)
        cdf = torch.cumsum(sorted_p, dim=-1)
        keep = cdf <= float(top_p)
        keep[0] = True
        mask = torch.full_like(x, float("-inf"))
        mask.scatter_(0, sorted_i[keep], x[sorted_i[keep]])
        x = mask
    probs = torch.softmax(x, dim=-1)
    return int(torch.multinomial(probs, 1).item())


def generate_ids(model, tokenizer, device, prompt: str, *, max_new: int, greedy: bool, temperature=None, top_k=None, top_p=None) -> list[int]:
    bos = tokenizer.token_to_id("<|bos|>") or 1
    eos = tokenizer.token_to_id("<|eos|>") or 2
    ids = [int(bos), *tok_ids(tokenizer, prompt)]
    new_ids: list[int] = []
    with torch.inference_mode():
        cur = torch.tensor([ids], dtype=torch.long, device=device)
        for _ in range(max_new):
            logits = model(cur)[0, -1]
            nxt = sample_next(logits, temperature=temperature, top_k=top_k, top_p=top_p, greedy=greedy)
            new_ids.append(nxt)
            ids.append(nxt)
            if nxt == eos:
                break
            cur = torch.tensor([ids], dtype=torch.long, device=device)
    return new_ids


def beam_generate(model, tokenizer, device, prompt: str, *, beam=5, max_new=32) -> list[int]:
    bos = tokenizer.token_to_id("<|bos|>") or 1
    eos = tokenizer.token_to_id("<|eos|>") or 2
    start = [int(bos), *tok_ids(tokenizer, prompt)]
    beams = [(0.0, start, False)]
    with torch.inference_mode():
        for _ in range(max_new):
            cand = []
            all_done = True
            for logp, seq, done in beams:
                if done:
                    cand.append((logp, seq, True))
                    continue
                all_done = False
                x = torch.tensor([seq], dtype=torch.long, device=device)
                logits = model(x)[0, -1].float()
                logprobs = torch.log_softmax(logits, dim=-1)
                vals, idx = torch.topk(logprobs, beam)
                for lp, tid in zip(vals.tolist(), idx.tolist()):
                    nid = int(tid)
                    nseq = seq + [nid]
                    cand.append((logp + float(lp), nseq, nid == eos))
            cand.sort(key=lambda t: t[0], reverse=True)
            beams = cand[:beam]
            if all_done:
                break
    best = beams[0][1]
    return best[len(start) :]


def load_model(path: Path, device: torch.device) -> WRIM0Model:
    model = WRIM0Model()
    state = load_state(path)
    model.load_state_dict(state, strict=True)
    model.to(device)
    model.eval()
    for p in model.parameters():
        p.requires_grad_(False)
    return model


def extract_eval_snapshot(run: str, step: int) -> dict[str, Any]:
    ev_path = CK / run / "evals" / f"step-{step}.json"
    tf_path = CK / run / "evals" / f"teacher-forced-step-{step}.json"
    me_path = CK / run / "evals" / f"mode-entry-step-{step}.json"
    cap_path = CK / run / "evals" / f"capability-step-{step}.json"
    out: dict[str, Any] = {"run": run, "step": step, "eval_exists": ev_path.is_file()}
    if ev_path.is_file():
        ev = json.loads(ev_path.read_text(encoding="utf-8"))
        out.update(
            {
                "tokens": ev.get("tokens"),
                "lr": ev.get("lr"),
                "train_loss": ev.get("train_loss"),
                "val_loss_corpus0": ev.get("val_loss_corpus0"),
                "val_loss_corpus1": ev.get("val_loss_corpus1"),
                "historical_binary": ev.get("historical_binary"),
                "mean_wrim0_anchor_nll_delta": ev.get("mean_wrim0_anchor_nll_delta"),
                "mean_kl_wrim0_to_candidate": ev.get("mean_kl_wrim0_to_candidate"),
                "NEW_FAILURES_VS_PARENT": ev.get("NEW_FAILURES_VS_PARENT"),
                "S3_INST_02_FIRST_TOKEN": ev.get("S3_INST_02_FIRST_TOKEN"),
                "S3_INST_02_FIRST_TOKEN_TEXT": ev.get("S3_INST_02_FIRST_TOKEN_TEXT"),
                "S3_INST_02_MAX_RUN_256": ev.get("S3_INST_02_MAX_RUN_256"),
                "n_collapsed_256": ev.get("n_collapsed_256") or ev.get("n_collapsed"),
            }
        )
        items = ev.get("items") or []
        inst = next((it for it in items if it.get("item_id") == "s3-inst-02"), None)
        if inst:
            d256 = inst.get("descriptive_256") or {}
            out["s3_inst_02_prefix"] = (d256.get("continuation_prefix") or "")[:160]
            out["s3_inst_02_max_run"] = d256.get("max_token_run") or d256.get("max_run")
    if tf_path.is_file():
        tf = json.loads(tf_path.read_text(encoding="utf-8"))
        ov = ((tf.get("mode_entry") or {}).get("overall")) or {}
        if not ov and isinstance(tf.get("mode_entry"), dict):
            ov = tf.get("mode_entry") or {}
        out["tf_target_rank"] = ov.get("TARGET_FIRST_TOKEN_RANK")
        out["tf_seq_nll"] = ov.get("TARGET_SEQUENCE_AVG_NLL")
        out["tf_eos_prob"] = ov.get("EOS_PROBABILITY_AT_CORRECT_STOP")
        out["tf_eos_rank"] = ov.get("TARGET_STOP_TOKEN_RANK")
        out["tf_logit_margin"] = ov.get("LOGIT_MARGIN_TO_ARGMAX")
        out["tf_topk"] = ov.get("TARGET_TOPK")
    if me_path.is_file():
        mej = json.loads(me_path.read_text(encoding="utf-8"))
        s = mej.get("summary") or {}
        out["mode_entry_pass"] = s.get("PASS_COUNT")
        out["mode_entry_n"] = s.get("n")
        out["greedy_correctness"] = f"{s.get('PASS_COUNT')}/{s.get('n')}"
    if cap_path.is_file():
        cj = json.loads(cap_path.read_text(encoding="utf-8"))
        s = cj.get("summary") or {}
        out["capability_pass"] = s.get("PASS_COUNT")
        out["capability_n"] = s.get("n")
        out["cap"] = f"{s.get('PASS_COUNT')}/{s.get('n')}"
    return out


def tokenizer_probes(tokenizer) -> dict[str, Any]:
    probes = {
        "newline": "\n",
        "double_newline": "\n\n",
        "colon": ":",
        "space_colon": " :",
        "underscore": "_",
        "space_underscore": " _",
        "json_object": '{"ok":true}',
        "json_punct": "{}[]:,",
        "quotes": '"hello"',
        "braces": "{}",
        "comma": ",",
        "indent_2": "  foo",
        "indent_4": "    foo",
        "def": "def",
        "function": "function",
        "return": "return",
        "fn_syntax": "def foo(x):",
        "eos_text": "<|eos|>",
        "bos_text": "<|bos|>",
        "assistant": "<|assistant|>",
        "commander": "<|commander|>",
        "user_fake": "<|user|>",
        "instruction_word": "Return",
        "halt": "halt",
        "only": "only",
        "yes": "yes",
        "no": "no",
        "true": "true",
        "false": "false",
        "OK": "OK",
        "ok": "ok",
        "IRON": "IRON",
        "IRON-MERE-CHIT": "IRON-MERE-CHIT",
        "underscore_repeat": "____",
        "colon_repeat": "::::",
        "backtick": "`",
        "code_block": "```",
    }
    out = {}
    for name, s in probes.items():
        ids = tok_ids(tokenizer, s)
        out[name] = {"text": s, "n": len(ids), "ids": ids, "pieces": tok_pieces(tokenizer, ids)}
    return out


def buckets(rs: list[int | None]) -> dict[str, Any]:
    xs = [x for x in rs if x is not None]
    return {
        "mean": (sum(xs) / len(xs)) if xs else None,
        "median": sorted(xs)[len(xs) // 2] if xs else None,
        "top1": sum(1 for x in xs if x == 1),
        "top5": sum(1 for x in xs if x <= 5),
        "top10": sum(1 for x in xs if x <= 10),
        "top50": sum(1 for x in xs if x <= 50),
        "top100": sum(1 for x in xs if x <= 100),
        "n": len(xs),
    }


def agg(rows, ranks, gaps, argmax):
    inst_rows = [r for r in rows if r["category"] == "instruction"]
    stop_rows = [r for r in rows if r["category"] == "stopping"]
    inst_sorted = sorted(inst_rows, key=lambda r: r["TARGET_RANK"] or 99999)
    examples = []
    pick = inst_sorted[:2]
    if inst_sorted:
        pick.append(inst_sorted[len(inst_sorted) // 2])
    if stop_rows:
        pick.append(stop_rows[0])
    seen = set()
    for r in pick:
        eid = r["example_id"]
        if eid in seen:
            continue
        seen.add(eid)
        examples.append(
            {
                "example_id": eid,
                "category": r["category"],
                "ARGMAX_TOKEN": r["ARGMAX_TOKEN"],
                "ARGMAX_LOGIT": r["ARGMAX_LOGIT"],
                "TARGET_TOKEN": r["TARGET_TOKEN"],
                "TARGET_LOGIT": r["TARGET_LOGIT"],
                "TARGET_RANK": r["TARGET_RANK"],
                "LOGIT_GAP": r["LOGIT_GAP"],
                "TOP_10_TOKENS": r["TOP_10_TOKENS"],
                "TOP_50_CATEGORY_SUMMARY": r["TOP_50_CATEGORY_SUMMARY"],
            }
        )
    return {
        "n": len(rows),
        "mean_rank": (sum(ranks) / len(ranks)) if ranks else None,
        "mean_logit_gap": (sum(gaps) / len(gaps)) if gaps else None,
        "instruction": buckets([r["TARGET_RANK"] for r in inst_rows]),
        "stopping": buckets([r["TARGET_RANK"] for r in stop_rows]),
        "overall": buckets(ranks),
        "argmax_tokens": dict(argmax.most_common(12)),
        "examples": examples,
    }


def main() -> None:
    dump = resolve_dump_root(None)
    if dump is None:
        raise SystemExit("dump_root_missing")
    tok_path = dump / "model-lab" / "manifests" / "wrim0_tokenizer_v16384" / "tokenizer.json"
    wrim0_path = dump / "model-lab" / "manifests" / "wrim0_checkpoints" / "checkpoint-final.safetensors"
    tokenizer = Tokenizer.from_file(str(tok_path))
    vocab = tokenizer.get_vocab_size()

    model_cpu = WRIM0Model()
    n_total = sum(p.numel() for p in model_cpu.parameters())
    n_train = sum(p.numel() for p in model_cpu.parameters() if p.requires_grad)
    del model_cpu

    val = load_jsonl(ME_VAL)
    train = load_jsonl(ME_TRAIN)

    prompt_lens = []
    target_lens = []
    first_ids = []
    first_nl_ids = []
    single = 0
    mismatch_nl = 0
    frag_ratios = []
    for ex in val:
        p = str(ex.get("prompt") or "")
        t = str(ex.get("target") or "")
        pi = tok_ids(tokenizer, p)
        ti = tok_ids(tokenizer, t)
        nl = tok_ids(tokenizer, "\n" + t)
        prompt_lens.append(len(pi))
        target_lens.append(len(ti))
        if ti:
            first_ids.append(ti[0])
        if len(nl) > 1:
            first_nl_ids.append(nl[1])
        if len(ti) == 1:
            single += 1
        if ti and nl[1:] != ti:
            mismatch_nl += 1
        chars = max(1, len(t))
        frag_ratios.append(len(ti) / chars)

    npy = dump / "model-lab" / "manifests" / "wrim0_corpus_shards" / "train.npy"
    freq = None
    eos_density = None
    bos_density = None
    assistant_density = None
    pretrain_tokens = None
    if npy.is_file():
        import numpy as np

        arr = np.load(str(npy), mmap_mode="r")
        n = int(arr.size)
        pretrain_tokens = n
        eos_density = float((arr == 2).sum()) / n if n else None
        bos_density = float((arr == 1).sum()) / n if n else None
        assistant_density = float((arr == 6).sum()) / n if n else None
        sample = np.asarray(arr[: min(n, 2_048_000)], dtype=np.int32)
        freq = np.bincount(sample, minlength=vocab)

    first_freq = []
    rare = 0
    if freq is not None and first_ids:
        tot = float(freq.sum()) or 1.0
        for fid in first_ids:
            f = float(freq[fid]) / tot if fid < len(freq) else 0.0
            first_freq.append(f)
            if f < 1e-5:
                rare += 1

    tok_metrics = {
        "VOCAB_SIZE_TOKENIZER": vocab,
        "VOCAB_SIZE_EMBEDDING": VOCAB_SIZE,
        "VOCAB_MATCH": vocab == VOCAB_SIZE,
        "BOS_ID": tokenizer.token_to_id("<|bos|>"),
        "EOS_ID": tokenizer.token_to_id("<|eos|>"),
        "ASSISTANT_ID": tokenizer.token_to_id("<|assistant|>"),
        "COMMANDER_ID": tokenizer.token_to_id("<|commander|>"),
        "USER_ID": tokenizer.token_to_id("<|user|>"),
        "MEAN_PROMPT_TOKENS": sum(prompt_lens) / len(prompt_lens),
        "MEAN_TARGET_TOKENS": sum(target_lens) / len(target_lens),
        "TARGET_TOKEN_FRAGMENTATION": {
            "mean_target_tokens": sum(target_lens) / len(target_lens),
            "mean_tokens_per_char": sum(frag_ratios) / len(frag_ratios),
            "p50_target_tokens": sorted(target_lens)[len(target_lens) // 2],
            "max_target_tokens": max(target_lens),
            "min_target_tokens": min(target_lens),
        },
        "PERCENT_SINGLE_TOKEN_TARGETS": 100.0 * single / len(val),
        "PERCENT_MULTI_TOKEN_TARGETS": 100.0 * (len(val) - single) / len(val),
        "MEAN_FIRST_TARGET_TOKEN_FREQUENCY": (sum(first_freq) / len(first_freq)) if first_freq else None,
        "RARE_FIRST_TARGET_TOKEN_RATE": (rare / len(first_ids)) if first_ids else None,
        "STANDALONE_VS_NEWLINE_FIRST_TOKEN_MISMATCH_RATE": mismatch_nl / len(val),
        "FIRST_TARGET_TOKEN_PIECES_STANDALONE": dict(Counter(tok_pieces(tokenizer, first_ids)).most_common(15)),
        "FIRST_TARGET_TOKEN_PIECES_AFTER_NEWLINE": dict(Counter(tok_pieces(tokenizer, first_nl_ids)).most_common(15)),
        "EOS_TOKEN_FREQUENCY_PRETRAIN": eos_density,
        "BOS_TOKEN_FREQUENCY_PRETRAIN": bos_density,
        "ASSISTANT_TOKEN_FREQUENCY_PRETRAIN": assistant_density,
        "PRETRAIN_NPY_TOKENS": pretrain_tokens,
        "ROLE_TOKENS_PRESENT_IN_TOKENIZER": True,
        "PROBES": tokenizer_probes(tokenizer),
    }

    subtypes = Counter(str(x.get("subtype")) for x in train)
    cats = Counter(str(x.get("category")) for x in train)
    tlen_chars = [len(str(x.get("target") or "")) for x in train]
    plen_chars = [len(str(x.get("prompt") or "")) for x in train]
    templates = Counter()
    for x in train:
        p = str(x.get("prompt") or "")
        if p.startswith("Return only the quoted"):
            templates["exact_quote"] += 1
        elif p.startswith("Emit this tag"):
            templates["exact_marker"] += 1
        elif p.startswith("Keep only the tag"):
            templates["extract_only"] += 1
        else:
            templates["other"] += 1
    data_rep = {
        "train_n": len(train),
        "val_n": len(val),
        "train_categories": dict(cats),
        "train_subtypes": dict(subtypes),
        "val_categories": dict(Counter(str(x.get("category")) for x in val)),
        "val_subtypes": dict(Counter(str(x.get("subtype")) for x in val)),
        "mean_target_chars_train": sum(tlen_chars) / len(tlen_chars),
        "mean_prompt_chars_train": sum(plen_chars) / len(plen_chars),
        "unique_targets_train": len({str(x.get("target")) for x in train}),
        "unique_prompts_train": len({str(x.get("prompt")) for x in train}),
        "template_buckets_train_prefix": dict(templates),
        "format": 'BOS + prompt + "\\n" + target + EOS',
        "role_tokens_used_in_text": any("<|assistant|>" in str(x.get("text") or "") for x in train[:80]),
    }

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print("DEVICE", device, flush=True)
    ckpts = {
        "WRIM-0": wrim0_path,
        "RUN-000011-step-30": CK / "WRIM1-RUN-000011" / "step-30" / "model.safetensors",
        "RUN-000011-step-40": CK / "WRIM1-RUN-000011" / "step-40" / "model.safetensors",
        "RUN-000012-step-30": CK / "WRIM1-RUN-000012" / "step-30" / "model.safetensors",
    }
    disp_ckpts = {
        "RUN-000007-step-10": CK / "WRIM1-RUN-000007" / "step-10" / "model.safetensors",
        "RUN-000008-step-15": CK / "WRIM1-RUN-000008" / "step-15" / "model.safetensors",
        "RUN-000009-step-15": CK / "WRIM1-RUN-000009" / "step-15" / "model.safetensors",
        **{k: v for k, v in ckpts.items() if k != "WRIM-0"},
    }

    parent_state = load_state(wrim0_path)
    displacement = {}
    for name, p in disp_ckpts.items():
        print("DISPLACE", name, flush=True)
        if not p.is_file():
            displacement[name] = {"missing": True, "path": str(p)}
            continue
        st = load_state(p)
        displacement[name] = param_l2_rms(parent_state, st)
        del st

    logit_report = {}
    decode_report = {}
    newline_greedy = {}
    inst = [x for x in val if x.get("category") == "instruction"][:8]
    stop = [x for x in val if x.get("category") == "stopping"][:8]
    decode_items = inst + stop
    modes = [
        ("GREEDY", dict(greedy=True)),
        ("TEMPERATURE_0.2", dict(greedy=False, temperature=0.2)),
        ("TEMPERATURE_0.5", dict(greedy=False, temperature=0.5)),
        ("TOP_K_5", dict(greedy=False, temperature=1.0, top_k=5)),
        ("TOP_K_10", dict(greedy=False, temperature=1.0, top_k=10)),
        ("TOP_P_0.9", dict(greedy=False, temperature=1.0, top_p=0.9)),
        ("BEAM_5", None),
    ]

    for label, path in ckpts.items():
        print("LOAD", label, flush=True)
        model = load_model(path, device)
        rows_canon = []
        rows_nl = []
        rank_c: list[int | None] = []
        rank_n: list[int | None] = []
        gap_c: list[float] = []
        gap_n: list[float] = []
        argmax_c: Counter[str] = Counter()
        argmax_n: Counter[str] = Counter()
        for ex in val:
            p = str(ex["prompt"])
            t = str(ex["target"])
            ti = tok_ids(tokenizer, t)
            nl_ids = tok_ids(tokenizer, "\n" + t)
            if not ti:
                continue
            log_c = first_logits(model, tokenizer, device, p)
            sc = summarize_logits(tokenizer, log_c, ti[0])
            sc["example_id"] = ex["example_id"]
            sc["category"] = ex["category"]
            rows_canon.append(sc)
            rank_c.append(sc["TARGET_RANK"])
            gap_c.append(sc["LOGIT_GAP"])
            argmax_c[str(sc["ARGMAX_TOKEN"])] += 1
            log_n = first_logits(model, tokenizer, device, p + "\n")
            tgt_nl = nl_ids[1] if len(nl_ids) > 1 else ti[0]
            sn = summarize_logits(tokenizer, log_n, tgt_nl)
            sn["example_id"] = ex["example_id"]
            sn["category"] = ex["category"]
            rows_nl.append(sn)
            rank_n.append(sn["TARGET_RANK"])
            gap_n.append(sn["LOGIT_GAP"])
            argmax_n[str(sn["ARGMAX_TOKEN"])] += 1

        logit_report[label] = {
            "canonical_no_newline": agg(rows_canon, rank_c, gap_c, argmax_c),
            "after_separator_newline": agg(rows_nl, rank_n, gap_n, argmax_n),
        }

        if label in {"WRIM-0", "RUN-000011-step-40"}:

            def greedy_pass(with_nl: bool) -> dict[str, Any]:
                n_ok = 0
                n = 0
                by: Counter[str] = Counter()
                by_ok: Counter[str] = Counter()
                firsts: Counter[str] = Counter()
                samples = []
                for ex in val:
                    prompt = str(ex["prompt"]) + ("\n" if with_nl else "")
                    gen = greedy_generate(model, tokenizer, prompt, device, max_new=32)
                    scored = score_validator(ex, gen.get("continuation") or "", gen)
                    n += 1
                    cat = str(ex.get("category"))
                    by[cat] += 1
                    if scored["correct"]:
                        n_ok += 1
                        by_ok[cat] += 1
                    ids = gen.get("new_ids") or []
                    if ids:
                        firsts[str(tokenizer.id_to_token(int(ids[0])))] += 1
                    if len(samples) < 6:
                        samples.append(
                            {
                                "example_id": ex["example_id"],
                                "category": cat,
                                "correct": scored["correct"],
                                "continuation": (gen.get("continuation") or "")[:120],
                                "first_token": tokenizer.id_to_token(int(ids[0])) if ids else None,
                            }
                        )
                return {
                    "PASS_COUNT": n_ok,
                    "n": n,
                    "by_ok": dict(by_ok),
                    "by_n": dict(by),
                    "first_tokens": dict(firsts.most_common(12)),
                    "samples": samples,
                    "CANONICAL_EVAL": (not with_nl),
                }

            newline_greedy[label] = {
                "canonical_prompt_only": greedy_pass(False),
                "diagnostic_prompt_plus_newline": greedy_pass(True),
            }

        if label == "RUN-000011-step-40":
            mode_stats = {}
            for mname, kw in modes:
                print("DECODE", mname, flush=True)
                hits = 0
                first_hits = 0
                n = 0
                samples = []
                for ex in decode_items:
                    n += 1
                    prompt = str(ex["prompt"])
                    target = str(ex["target"])
                    if mname == "BEAM_5":
                        ids = beam_generate(model, tokenizer, device, prompt, beam=5, max_new=32)
                    else:
                        ids = generate_ids(model, tokenizer, device, prompt, max_new=32, **kw)
                    text = tokenizer.decode(ids, skip_special_tokens=True)
                    scored = score_validator(ex, text, {"new_ids": ids, "continuation": text})
                    if scored["correct"]:
                        hits += 1
                    t0 = tok_ids(tokenizer, target)
                    if ids and t0 and int(ids[0]) == int(t0[0]):
                        first_hits += 1
                    if len(samples) < 4:
                        samples.append(
                            {
                                "example_id": ex["example_id"],
                                "correct": scored["correct"],
                                "first_token": tokenizer.id_to_token(int(ids[0])) if ids else None,
                                "continuation": text[:100],
                            }
                        )
                mode_stats[mname] = {
                    "n": n,
                    "exact_correct": hits,
                    "first_token_match_standalone_target": first_hits,
                    "samples": samples,
                }
            decode_report = mode_stats

        del model
        if device.type == "cuda":
            torch.cuda.empty_cache()

    c0 = json.loads((dump / "model-lab" / "manifests" / "wrim0_corpus_shards" / "shard-manifest.json").read_text())
    train_jsonl = dump / "model-lab" / "corpora" / "WR-CORPUS-1-HARDENED" / "train" / "shard-00000.jsonl"
    obj_counts: Counter[str] = Counter()
    buckets_c1: Counter[str] = Counter()
    if train_jsonl.is_file():
        from foundational_root_cause_audit import classify_text_objective
        from stage1_pack import bucket_for_record, text_of

        with train_jsonl.open(encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                rec = json.loads(line)
                text = text_of(rec)
                obj_counts[classify_text_objective(text, rec)] += 1
                buckets_c1[bucket_for_record(rec)] += 1

    pretrain = {
        "TOTAL_PRETRAINING_TOKENS": 2_048_000,
        "PARENT_STEPS": 500,
        "C0_TRAIN_TOKEN_COUNT_MANIFEST": c0.get("trainTokenCount"),
        "C0_TRAIN_DOCS": c0.get("trainDocumentCount"),
        "C0_VAL_DOCS": c0.get("valDocumentCount"),
        "C0_VOCAB_SIZE": c0.get("vocabSize"),
        "WR_CORPUS_1_OBJECTIVE_RECORD_COUNTS": dict(obj_counts),
        "WR_CORPUS_1_BUCKETS": dict(buckets_c1),
        "INSTRUCTIONAL_TEXT_SHARE_RECORDS": obj_counts.get("INSTRUCTION_RESPONSE", 0) + obj_counts.get("CHAT_TURN", 0),
        "DIALOGUE_SHARE_RECORDS": obj_counts.get("CHAT_TURN", 0),
        "STRUCTURED_DATA_SHARE_RECORDS": obj_counts.get("RAW_JSON_DOCUMENT", 0),
        "EOS_DENSITY": eos_density,
        "SHORT_RESPONSE_DENSITY": "UNKNOWN",
        "ASSISTANT_ROLE_TOKEN_DENSITY_PRETRAIN": assistant_density,
        "PREDOMINANT_OBJECTIVE": "DOCUMENT_CONTINUATION",
    }

    post_tokens = {
        "000006": 25 * 4096,
        "000007": 10 * 4096,
        "000008": 20 * 4096,
        "000009_completed": 25 * 4096,
        "000010": 20 * 4096,
        "000011": 40 * 4096,
        "000012": 30 * 4096,
    }

    payload = {
        "kind": "WRIM_CAPABILITY_PLATEAU_REVIEW_MEASUREMENTS",
        "TRAINING_EXECUTED": False,
        "architecture": {
            "PARAM_COUNT_TOTAL": n_total,
            "TRAINABLE_PARAMETER_COUNT": n_train,
            "NUM_LAYERS": N_LAYERS,
            "HIDDEN_SIZE": D_MODEL,
            "FFN_SIZE": D_FF,
            "NUM_ATTENTION_HEADS": N_HEADS,
            "NUM_KV_HEADS": N_HEADS,
            "VOCAB_SIZE": VOCAB_SIZE,
            "TOKENIZER_VOCAB": vocab,
            "MAX_CONTEXT_LENGTH": CONTEXT_LENGTH,
            "POSITIONAL_ENCODING_TYPE": "RoPE rotate-half traditional=False theta=10000",
            "NORMALIZATION_TYPE": "pre-RMSNorm eps=1e-5",
            "ACTIVATION_FUNCTION": "SwiGLU (SiLU gate * up)",
            "ATTENTION_IMPLEMENTATION": "reference explicit scores + causal mask + softmax (not SDPA)",
            "TIED_EMBEDDINGS": "YES",
            "OUTPUT_HEAD_TYPE": "tied F.linear(h, tok_emb.weight) — no untied lm_head Parameter",
            "EMBEDDING_DIMENSION": D_MODEL,
            "HEAD_DIMENSION": HEAD_DIM,
            "DROPOUT": 0,
            "INITIALIZATION": "checkpoint-loaded recovered MLX WRIM-0; module defaults nn.Embedding/Linear (bias=False on attn/ffn)",
            "DTYPE": "FP32",
            "WEIGHT_STORAGE_FORMAT": "safetensors F32",
            "BIAS": "none on attention/FFN; RMSNorm scale only",
        },
        "tokenizer_metrics": tok_metrics,
        "data_representation": data_rep,
        "pretraining": pretrain,
        "displacement": displacement,
        "logits": logit_report,
        "decoding": decode_report,
        "newline_greedy_diagnostic": newline_greedy,
        "checkpoint_eval_extracts": {
            "WRIM-0": extract_eval_snapshot("WRIM1-RUN-000011", 0),
            "RUN-000007-step-10": extract_eval_snapshot("WRIM1-RUN-000007", 10),
            "RUN-000008-step-15": extract_eval_snapshot("WRIM1-RUN-000008", 15),
            "RUN-000009-step-15": extract_eval_snapshot("WRIM1-RUN-000009", 15),
            "RUN-000011-step-30": extract_eval_snapshot("WRIM1-RUN-000011", 30),
            "RUN-000011-step-40": extract_eval_snapshot("WRIM1-RUN-000011", 40),
            "RUN-000012-step-30": extract_eval_snapshot("WRIM1-RUN-000012", 30),
        },
        "posttraining_token_exposure_per_run": post_tokens,
        "posttraining_token_sum_000006_000012": sum(post_tokens.values()),
        "note": "Each run restarts from WRIM-0; summed post-training tokens are not sequential accumulation on one weight set.",
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("WROTE", OUT, flush=True)


if __name__ == "__main__":
    main()
