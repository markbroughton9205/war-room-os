"""Train WRIM1-TOKENIZER-v1 and pack WRIM1-AB50M-PACK-v1. No optimizer."""
from __future__ import annotations

import json
import random
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterator

import numpy as np
from tokenizers import Tokenizer, decoders, models, pre_tokenizers, processors, trainers

from wrim1_ab50m_identity import (
    CORPUS_DIR,
    CORPUS_HASH,
    DOMAIN_MAP,
    MICRO_BATCH,
    PACK_DIR,
    PHYSICAL_MIX,
    PHYSICAL_TOKENS,
    PROBE_DIR,
    SEED,
    SEQ_LEN,
    SPECIAL_TOKENS,
    STEPS,
    TOKENIZER_DIR,
    TOKENS_PER_STEP,
    VOCAB_CANDIDATES,
)
from wrim_pilot_ab_data import EFFICIENCY_SAMPLES, frozen_probes, sha256_file, sha256_text, special_ids
from wrim_pilot_ab_identity import LOCKED_NAME_NEEDLES
from wrim1_pretrain_corpus_build import utc_now, write_json
from stage1_pack import is_eval_infra_text

N_TRAIN_WINDOWS = STEPS * MICRO_BATCH
N_VAL_WINDOWS = 512
N_HOLD_WINDOWS = 256


def iter_jsonl(path: Path):
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def map_domain(raw: str) -> str | None:
    return DOMAIN_MAP.get(raw)


def efficiency(tok, text: str) -> dict[str, float]:
    ids = tok.encode(text, add_special_tokens=False).ids
    words = [w for w in text.replace("\n", " ").split(" ") if w]
    return {
        "n_tokens": len(ids),
        "tokens_per_word": round(len(ids) / max(1, len(words)), 4),
        "tokens_per_char": round(len(ids) / max(1, len(text)), 4),
    }


def domain_samples(train_path: Path) -> dict[str, str]:
    needed = set(PHYSICAL_MIX)
    buckets: dict[str, list[str]] = defaultdict(list)
    for rec in iter_jsonl(train_path):
        d = map_domain(str(rec.get("domain") or ""))
        if not d:
            continue
        text = rec.get("text") or ""
        if len(text) < 40:
            continue
        if len(buckets[d]) < 24:
            buckets[d].append(text[:2500])
        if needed.issubset({k for k, v in buckets.items() if len(v) >= 24}):
            break
    return {k: "\n\n".join(v) for k, v in buckets.items()}


def locked_eval_hits(texts: list[str]) -> list[str]:
    distinctive = [
        n.lower()
        for n in LOCKED_NAME_NEEDLES
        if n.upper() not in {"CAPABILITY", "STAGE3"}
    ]
    hits = []
    for text in texts:
        low = text.lower()
        if is_eval_infra_text(text, ""):
            hits.append("eval_infra_text")
            continue
        for needle in distinctive:
            if needle in low:
                hits.append(needle)
                break
    return sorted(set(hits))


def train_iterator(subset_path: Path, train_path: Path) -> Iterator[str]:
    for rec in iter_jsonl(subset_path):
        text = rec.get("text") or ""
        if len(text) >= 8:
            yield text
    caps: dict[str, int] = defaultdict(int)
    for rec in iter_jsonl(train_path):
        d = map_domain(str(rec.get("domain") or "")) or "other"
        if caps[d] > 2_500_000:
            continue
        text = rec.get("text") or ""
        if len(text) < 8:
            continue
        caps[d] += len(text)
        yield text


def bpe_tokenizer(vocab_size: int):
    tok = Tokenizer(models.BPE(unk_token="<|unk|>"))
    tok.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tok.decoder = decoders.ByteLevel()
    trainer = trainers.BpeTrainer(
        vocab_size=int(vocab_size),
        special_tokens=list(SPECIAL_TOKENS),
        min_frequency=2,
        show_progress=False,
    )
    return tok, trainer


def round_trip_ok(tok) -> dict[str, Any]:
    ids_map = special_ids(tok)
    sample = "The commander asked whether water boils. don't can't JSON {\"n\": 7}."
    enc = tok.encode(sample, add_special_tokens=False)
    dec = tok.decode(enc.ids)
    specials = {}
    names = {
        "pad": "<|pad|>", "bos": "<|bos|>", "eos": "<|eos|>", "unk": "<|unk|>",
        "system": "<|system|>", "commander": "<|commander|>", "assistant": "<|assistant|>",
        "tool": "<|tool|>", "evidence": "<|evidence|>",
    }
    for name, token in names.items():
        tid = ids_map[name]
        specials[name] = {"id": tid, "token": token, "roundtrip": tok.id_to_token(tid) == token}
    return {
        "decode_contains_commander": "commander" in dec.lower(),
        "decode_contains_json": "{" in dec,
        "specials": specials,
        "all_specials_ok": all(v["roundtrip"] for v in specials.values()),
        "ids": ids_map,
    }


def select_vocab(results: list[dict[str, Any]]) -> tuple[dict[str, Any], str]:
    def comp(r: dict[str, Any]) -> float:
        e = r["efficiency"]
        score = (
            0.18 * e["english"]["tokens_per_word"]
            + 0.12 * e.get("conversation", e["english"])["tokens_per_word"]
            + 0.12 * e.get("instruction", e["english"])["tokens_per_word"]
            + 0.14 * e["json"]["tokens_per_word"]
            + 0.14 * e["code"]["tokens_per_word"]
            + 0.10 * e.get("math", e["english"])["tokens_per_word"]
            + 0.08 * e.get("procedural", e["english"])["tokens_per_word"]
            + 0.12 * e["heldout"]["tokens_per_word"]
        )
        extra = (r["vocab_size"] / 16384) - 1.0
        penalty = extra * 0.06  # small-model embedding-table cost vs 16k
        return score + penalty

    ranked = sorted(results, key=comp)
    chosen = ranked[0]
    if len(ranked) > 1 and abs(comp(ranked[0]) - comp(ranked[1])) < 0.01:
        chosen = min(ranked[:2], key=lambda r: r["vocab_size"])
    reason = (
        f"lowest composite tok/word+embed-penalty {comp(chosen):.4f}; "
        + ", ".join(f"{r['vocab_size']}={comp(r):.4f}" for r in ranked)
    )
    if chosen is not ranked[0]:
        reason += "; tie-break smaller vocab for small-model embedding cost"
    return chosen, reason


def freeze_deep_probes() -> dict[str, Any]:
    base = frozen_probes()
    extra_inst = [
        {"id": "explain", "family": "explain", "prompt": "In two sentences, explain why a written count is better than a remembered count.", "target": "A written count can be checked later. A remembered count can change without a record."},
        {"id": "compare", "family": "compare", "prompt": "Which is larger, 9 or 4? Reply with the number only.", "target": "9"},
        {"id": "extract2", "family": "extract", "prompt": "From 'limit 12, item hatch, op isolate', write only the item.", "target": "hatch"},
        {"id": "transform2", "family": "transform", "prompt": "Rewrite in lowercase hyphenated form: LOCK PANEL.", "target": "lock-panel"},
        {"id": "neg2", "family": "negative constraint", "prompt": "Name a safe action for a stuck valve. Do not guess. Do not use skip.", "target": "Write that it is stuck and wait."},
        {"id": "combo2", "family": "combined constraint", "prompt": "Reply in exactly three words. Mention gauge. Do not use digits.", "target": "Check the gauge"},
    ]
    extra_nat = [
        {"id": "n5", "prompt": "I still do not understand. Can you say that again more simply? The delay happened because", "target": "the"},
        {"id": "n6", "prompt": "Thank you for staying. What remains unfinished is", "target": "the"},
    ]
    payload = {
        "kind": "WRIM1-DEEP-PROBES-v1",
        "train_on_answers": False,
        "immutable": True,
        "includes_pilot_probes": True,
        "pilot_probe_sha256": base["sha256"],
        "instruction": list(base["instruction"]) + extra_inst,
        "natural": list(base["natural"]) + extra_nat,
        "json": list(base["json"]),
        "code": list(base["code"]),
        "reasoning": list(base["reasoning"]),
        "language": list(base["language"]),
    }
    payload["sha256"] = sha256_text(json.dumps({k: payload[k] for k in payload if k != "sha256"}, sort_keys=True, ensure_ascii=False))
    PROBE_DIR.mkdir(parents=True, exist_ok=True)
    (PROBE_DIR / "probes.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload


def encode_doc(tok, rec: dict[str, Any], ids: dict[str, int]) -> list[int]:
    text = rec.get("text") or ""
    domain = rec["domain"]
    if domain == "instruction" and "Commander:" in text and "Assistant:" in text:
        prompt = text.split("Commander:", 1)[1].split("Assistant:", 1)[0].strip()
        target = text.split("Assistant:", 1)[1].strip()
        return (
            [ids["bos"], ids["commander"]]
            + tok.encode("\n" + prompt, add_special_tokens=False).ids
            + [ids["assistant"]]
            + tok.encode("\n" + target, add_special_tokens=False).ids
            + [ids["eos"]]
        )
    return [ids["bos"]] + tok.encode(text, add_special_tokens=False).ids + [ids["eos"]]


def pack_split(docs: list[dict[str, Any]], tok, ids: dict[str, int], n_windows: int, seed: int) -> dict[str, Any]:
    rng = random.Random(seed)
    by_domain: dict[str, list[tuple[str, list[int]]]] = defaultdict(list)
    unique_tok: dict[str, int] = defaultdict(int)
    for i, rec in enumerate(docs):
        seq = encode_doc(tok, rec, ids)
        if len(seq) < 4:
            continue
        pack_id = f"{rec['doc_id']}#{i}"
        by_domain[rec["domain"]].append((pack_id, seq))
        unique_tok[rec["domain"]] += len(seq)
    mix_keys = [k for k in PHYSICAL_MIX if by_domain.get(k)]
    target_n = {k: int(round(n_windows * PHYSICAL_MIX[k])) for k in mix_keys}
    while sum(target_n.values()) < n_windows:
        target_n[mix_keys[0]] += 1
    while sum(target_n.values()) > n_windows:
        k = max(target_n, key=lambda x: target_n[x])
        target_n[k] -= 1
    windows = np.zeros((n_windows, SEQ_LEN), dtype=np.uint16)
    domains: list[str] = []
    uses: dict[str, dict[str, int]] = {k: defaultdict(int) for k in mix_keys}
    pools: dict[str, list[list[int]]] = {}
    for domain, items in by_domain.items():
        order = list(items)
        rng.shuffle(order)
        stream: list[int] = []
        i = 0
        skipped = 0
        need = target_n.get(domain, 0) * SEQ_LEN + SEQ_LEN
        while len(stream) < max(need, SEQ_LEN * 2):
            pack_id, seq = order[i % len(order)]
            if uses[domain][pack_id] >= 4:
                skipped += 1
                i += 1
                if skipped > len(order) * 2:
                    break
                continue
            uses[domain][pack_id] += 1
            stream.extend(seq)
            i += 1
            skipped = 0
            if i > len(order) * 8:
                break
        pool = []
        for j in range(0, max(len(stream) - 1, SEQ_LEN), SEQ_LEN):
            chunk = stream[j : j + SEQ_LEN]
            if len(chunk) < SEQ_LEN:
                chunk = chunk + [ids["pad"]] * (SEQ_LEN - len(chunk))
            pool.append(chunk)
        rng.shuffle(pool)
        pools[domain] = pool or [[ids["pad"]] * SEQ_LEN]
    cursor = {k: 0 for k in mix_keys}
    counts = {k: 0 for k in mix_keys}
    w = 0
    rr = list(mix_keys)
    while w < n_windows:
        progressed = False
        for domain in rr:
            if counts[domain] >= target_n[domain]:
                continue
            pool = pools[domain]
            windows[w] = pool[cursor[domain] % len(pool)]
            cursor[domain] += 1
            domains.append(domain)
            counts[domain] += 1
            w += 1
            progressed = True
            if w >= n_windows:
                break
        if not progressed:
            domain = mix_keys[0]
            pool = pools[domain]
            windows[w] = pool[cursor[domain] % len(pool)]
            cursor[domain] += 1
            domains.append(domain)
            w += 1
    repeat_stats = {}
    for domain, used in uses.items():
        vals = list(used.values())
        if not vals:
            continue
        sv = sorted(vals)
        repeat_stats[domain] = {
            "docs_used": len(vals),
            "mean": round(sum(vals) / len(vals), 4),
            "p50": sv[len(sv) // 2],
            "p90": sv[int(len(sv) * 0.9)],
            "max": max(vals),
        }
    return {
        "windows": windows,
        "domains": domains,
        "counts": counts,
        "unique_tokens_encoded": dict(unique_tok),
        "repeat_stats": repeat_stats,
        "physical_share": {k: round(v / n_windows, 4) for k, v in counts.items()},
    }


def load_docs(path: Path) -> list[dict[str, Any]]:
    out = []
    for rec in iter_jsonl(path):
        d = map_domain(str(rec.get("domain") or ""))
        if not d:
            continue
        text = rec.get("text") or ""
        if len(text) < 8:
            continue
        out.append({"doc_id": rec.get("doc_id") or sha256_text(text)[:16], "domain": d, "text": text})
    return out


def main() -> int:
    print("PREP_START", utc_now(), flush=True)
    man = json.loads((CORPUS_DIR / "WRIM-1-PRETRAIN-CORPUS-v1.5.0-MANIFEST.json").read_text(encoding="utf-8"))
    assert man.get("CORPUS_HASH") == CORPUS_HASH, "corpus hash mismatch"
    train_path = CORPUS_DIR / "train.jsonl"
    val_path = CORPUS_DIR / "val.jsonl"
    hold_path = CORPUS_DIR / "source-holdout.jsonl"
    subset_path = CORPUS_DIR / "tokenizer-training-subset.jsonl"
    samples = domain_samples(train_path)
    held_text = samples.get("prose") or "The commander asked a held-out question."
    TOKENIZER_DIR.mkdir(parents=True, exist_ok=True)
    results = []
    texts = list(train_iterator(subset_path, train_path))
    locked_hits = locked_eval_hits(texts)
    if locked_hits:
        raise RuntimeError(f"locked-eval contamination in tokenizer texts: {locked_hits}")
    print("tokenizer_train_docs", len(texts), flush=True)
    for vocab in VOCAB_CANDIDATES:
        path = TOKENIZER_DIR / f"candidate-{vocab}.json"
        if path.is_file():
            tok = Tokenizer.from_file(str(path))
        else:
            tok, trainer = bpe_tokenizer(vocab)
            tok.train_from_iterator(iter(texts), trainer=trainer)
            tok.post_processor = processors.ByteLevel(trim_offsets=False)
            tok.save(str(path))
        eff = {
            "english": efficiency(tok, held_text[:4000]),
            "conversation": efficiency(tok, samples.get("conversation", held_text)[:4000]),
            "instruction": efficiency(tok, samples.get("instruction", held_text)[:4000]),
            "json": efficiency(tok, samples.get("json", '{"ok": true, "n": 7}')[:4000]),
            "code": efficiency(tok, samples.get("code", "def add(a,b):\n    return a+b\n")[:4000]),
            "math": efficiency(tok, samples.get("math", "2 + 3 = 5")[:4000]),
            "procedural": efficiency(tok, samples.get("procedural", held_text)[:4000]),
            "numbers": efficiency(tok, EFFICIENCY_SAMPLES["numbers"]),
            "contractions": efficiency(tok, EFFICIENCY_SAMPLES["contractions"]),
            "domain_terminology": efficiency(tok, EFFICIENCY_SAMPLES["domain"]),
            "heldout": efficiency(tok, held_text),
        }
        results.append({
            "vocab_size": vocab,
            "actual_vocab": tok.get_vocab_size(),
            "path": str(path),
            "sha256": sha256_file(path),
            "efficiency": eff,
        })
        print("candidate", vocab, flush=True)
    chosen, reason = select_vocab(results)
    frozen = TOKENIZER_DIR / "tokenizer.json"
    frozen.write_bytes(Path(chosen["path"]).read_bytes())
    tok = Tokenizer.from_file(str(frozen))
    rt = round_trip_ok(tok)
    assert rt["all_specials_ok"]
    tok.model.save(str(TOKENIZER_DIR), "wrim1")
    vocab_path = TOKENIZER_DIR / "wrim1-vocab.json"
    merges_path = TOKENIZER_DIR / "wrim1-merges.txt"
    tok_hash = sha256_file(frozen)
    write_json(TOKENIZER_DIR / "VOCAB_STUDY.json", {
        "candidates": results,
        "selected_vocab": chosen["vocab_size"],
        "selection_reason": reason,
        "locked_eval_hits": locked_hits,
    })
    write_json(TOKENIZER_DIR / "WRIM1-TOKENIZER-v1-MANIFEST.json", {
        "TOKENIZER_ID": "WRIM1-TOKENIZER-v1",
        "immutable": True,
        "selected_vocab": chosen["vocab_size"],
        "actual_vocab": tok.get_vocab_size(),
        "sha256": tok_hash,
        "vocab_sha256": sha256_file(vocab_path) if vocab_path.is_file() else None,
        "merges_sha256": sha256_file(merges_path) if merges_path.is_file() else None,
        "special_token_ids": rt["ids"],
        "selection_reason": reason,
        "candidates": results,
        "round_trip": {k: rt[k] for k in ("decode_contains_commander", "decode_contains_json", "all_specials_ok")},
        "locked_eval_hits": locked_hits,
        "created_at": utc_now(),
        "corpus": "WRIM-1-PRETRAIN-CORPUS-v1.5.0",
        "corpus_hash": CORPUS_HASH,
        "pilot_tokenizer_unmutated": True,
    })
    print("TOKENIZER_FROZEN", chosen["vocab_size"], tok_hash, flush=True)

    print("loading docs", flush=True)
    train_docs = load_docs(train_path)
    val_docs = load_docs(val_path)
    hold_docs = load_docs(hold_path)
    ids = rt["ids"]
    print("packing", len(train_docs), flush=True)
    packed = pack_split(train_docs, tok, ids, N_TRAIN_WINDOWS, SEED)
    val_pack = pack_split(val_docs, tok, ids, N_VAL_WINDOWS, SEED + 1)
    hold_pack = pack_split(hold_docs, tok, ids, N_HOLD_WINDOWS, SEED + 2)
    PACK_DIR.mkdir(parents=True, exist_ok=True)
    np.save(PACK_DIR / "train_windows.npy", packed["windows"])
    np.save(PACK_DIR / "val_windows.npy", val_pack["windows"])
    np.save(PACK_DIR / "hold_windows.npy", hold_pack["windows"])
    probes = freeze_deep_probes()
    write_json(PACK_DIR / "PACK-MANIFEST.json", {
        "steps": STEPS,
        "physical_tokens": PHYSICAL_TOKENS,
        "n_train_windows": N_TRAIN_WINDOWS,
        "tokens_per_step": TOKENS_PER_STEP,
        "seq_len": SEQ_LEN,
        "physical_mix_target": PHYSICAL_MIX,
        "physical_mix_actual": packed["physical_share"],
        "repeat_stats": packed["repeat_stats"],
        "unique_tokens_encoded": packed["unique_tokens_encoded"],
        "train_sha256": sha256_file(PACK_DIR / "train_windows.npy"),
        "val_sha256": sha256_file(PACK_DIR / "val_windows.npy"),
        "hold_sha256": sha256_file(PACK_DIR / "hold_windows.npy"),
        "tokenizer_sha256": tok_hash,
        "probes_sha256": probes["sha256"],
        "created_at": utc_now(),
    })
    print("PREP_DONE", chosen["vocab_size"], packed["physical_share"], flush=True)
    print(json.dumps({"tokenizer_sha256": tok_hash, "vocab": chosen["vocab_size"], "reason": reason, "mix": packed["physical_share"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
