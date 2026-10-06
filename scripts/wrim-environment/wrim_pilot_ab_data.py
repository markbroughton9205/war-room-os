"""Build WRIM1-PILOT-CORPUS-v1, tokenizer study, and frozen probes. No model training."""
from __future__ import annotations

import hashlib
import json
import random
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterator

from run000007_preflight import resolve_dump_root
from stage1_pack import is_eval_infra_text, is_tool_use
from wrim_pilot_ab_identity import (
    CORPUS_DIR,
    DATA_ROOT,
    PROBE_DIR,
    SEED,
    SPECIAL_TOKENS,
    TARGET_MIX,
    TOKENIZER_DIR,
    UNIQUE_TARGET,
    VOCAB_CANDIDATES,
)

EFFICIENCY_SAMPLES = {
    "english": "The commander asked whether the model could follow instructions across held-out wording without collapsing structured phrase identity.",
    "instruction": "Return a JSON object with keys ok, n, and id. Set ok true, n 7, and id willow.",
    "json": '{"ok": true, "n": 7, "id": "willow", "items": [1, 2, 3], "nested": {"a": false}}',
    "code": "def add(a, b):\n    return a + b\nprint(add(2, 3))\nfor i in range(10):\n    print(i)\n",
    "numbers": "The values are 0, 1, 2, 12, 64, 256, 1024, 3.14159, and -18.",
    "contractions": "don't can't it's we're they'll I've that's won't",
    "domain": "tokenizer vocabulary residual adapter lm_head RMSNorm SwiGLU pretraining checkpoint",
}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def iter_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def locked(rec: dict[str, Any]) -> bool:
    blob = " ".join(str(rec.get(k) or "") for k in ("source_path", "path", "documentId", "sourceId", "origin", "format", "split"))
    low = blob.lower()
    if "holdout" in low or "held-out" in low or "heldout" in low:
        return True
    if rec.get("split") in {"validation", "family_holdout", "template_holdout"}:
        return True
    elig = str(rec.get("splitEligibility") or "")
    if elig in {"held-out-eligible", "validation-eligible"}:
        return True
    text = rec.get("text") or ""
    path = str(rec.get("source_path") or rec.get("path") or "")
    if text and is_eval_infra_text(text, path):
        return True
    if is_tool_use(rec):
        return True
    return False


def load_catalog() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    prose_index = DATA_ROOT / "WR-CORPUS-CPT3-PROSE-1-v1.2.0" / "WR-CORPUS-CPT3-PROSE-1-v1.2.0-INDEX.json"
    prose_docs = DATA_ROOT / "WR-CORPUS-CPT3-PROSE-1-v1.2.0" / "WR-CORPUS-CPT3-PROSE-1-v1.2.0-DOCUMENTS.jsonl"
    for rec in json.loads(prose_index.read_text(encoding="utf-8")):
        if rec.get("splitEligibility") != "train-eligible":
            continue
        rows.append({
            "domain": "prose",
            "source_id": rec["sourceId"],
            "doc_id": rec["documentId"],
            "old_tokens": int(rec.get("tokenCount") or 0),
            "path": str(prose_docs),
            "key": rec["documentId"],
        })
    tech_docs = DATA_ROOT / "WR-CORPUS-CPT3-TECHNICAL-1-v1.0.0" / "WR-CORPUS-CPT3-TECHNICAL-1-v1.0.0-DOCUMENTS.jsonl"
    tech_index = DATA_ROOT / "WR-CORPUS-CPT3-TECHNICAL-1-v1.0.0" / "WR-CORPUS-CPT3-TECHNICAL-1-v1.0.0-INDEX.json"
    if tech_index.is_file():
        tech_meta = json.loads(tech_index.read_text(encoding="utf-8"))
        for rec in tech_meta:
            if rec.get("splitEligibility") not in (None, "train-eligible"):
                continue
            rows.append({
                "domain": "technical",
                "source_id": rec["sourceId"],
                "doc_id": rec["documentId"],
                "old_tokens": int(rec.get("tokenCount") or 0),
                "path": str(tech_docs),
                "key": rec["documentId"],
            })
    else:
        for rec in iter_jsonl(tech_docs):
            if rec.get("splitEligibility") not in (None, "train-eligible"):
                continue
            rows.append({
                "domain": "technical",
                "source_id": rec["sourceId"],
                "doc_id": rec["documentId"],
                "old_tokens": int(rec.get("tokenCount") or 0),
                "path": str(tech_docs),
                "key": rec["documentId"],
            })
    json_docs = DATA_ROOT / "WR-CORPUS-CPT3-JSON-1-v1.0.0" / "WR-CORPUS-CPT3-JSON-1-v1.0.0-DOCUMENTS.jsonl"
    json_index = DATA_ROOT / "WR-CORPUS-CPT3-JSON-1-v1.0.0" / "WR-CORPUS-CPT3-JSON-1-v1.0.0-INDEX.json"
    json_meta = json.loads(json_index.read_text(encoding="utf-8"))
    for rec in json_meta:
        if rec.get("splitEligibility") not in (None, "train-eligible"):
            continue
        rows.append({
            "domain": "json",
            "source_id": rec["sourceId"],
            "doc_id": rec["documentId"],
            "old_tokens": int(rec.get("tokenCount") or 0),
            "path": str(json_docs),
            "key": rec["documentId"],
        })
    c1 = DATA_ROOT / "WR-CORPUS-CPT-1-v1.0.0" / "WR-CORPUS-CPT-1-v1.0.0-C1-TRAIN.jsonl"
    for rec in iter_jsonl(c1):
        if locked(rec):
            continue
        fmt = str(rec.get("format") or "")
        bucket = str(rec.get("bucket") or "")
        if fmt == "code" or bucket == "code":
            domain = "code"
        elif fmt == "structured_json" or bucket == "json":
            domain = "json"
        else:
            continue
        doc_id = str(rec.get("chunk_id") or rec.get("source_path"))
        rows.append({
            "domain": domain,
            "source_id": str(rec.get("source_path") or doc_id),
            "doc_id": doc_id,
            "old_tokens": int(rec.get("token_count") or 0),
            "path": str(c1),
            "key": doc_id,
            "c1": True,
        })
    ins = DATA_ROOT / "WRIM-INSTRUCTION-TRAIN-v1.1.0" / "train.jsonl"
    for rec in iter_jsonl(ins):
        if rec.get("split") and rec.get("split") != "train":
            continue
        prompt = str(rec.get("prompt") or "")
        target = str(rec.get("target") or "")
        text = f"{prompt}\n{target}"
        rows.append({
            "domain": "instruction",
            "source_id": "WRIM-INSTRUCTION-TRAIN-v1.1.0",
            "doc_id": str(rec.get("example_id")),
            "old_tokens": max(8, len(text.split())),
            "path": str(ins),
            "key": str(rec.get("example_id")),
            "instruction": True,
            "prompt": prompt,
            "target": target,
        })
    dump = resolve_dump_root(None)
    if dump is not None:
        c0 = dump / "sovereign-model-lab" / "corpora" / "WRM-001" / "175af25fe1c17cf7630b506d0d6e6e88" / "corpus.jsonl"
        if c0.is_file():
            for i, rec in enumerate(iter_jsonl(c0)):
                text = rec.get("text") or rec.get("content") or ""
                if not text:
                    continue
                doc_id = str(rec.get("documentId") or rec.get("id") or f"c0-{i}")
                rows.append({
                    "domain": "genesis",
                    "source_id": "WR-CORPUS-0",
                    "doc_id": doc_id,
                    "old_tokens": int(rec.get("tokenCount") or rec.get("token_count") or max(1, len(str(text)) // 4)),
                    "path": str(c0),
                    "key": doc_id,
                })
    return rows


def greedy_select(catalog: list[dict[str, Any]], *, seed: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    rng = random.Random(seed)
    by_domain: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for rec in catalog:
        by_domain[rec["domain"]].append(rec)
    train: list[dict[str, Any]] = []
    val: list[dict[str, Any]] = []
    stats: dict[str, Any] = {"train_old_tokens": {}, "val_old_tokens": {}, "train_docs": {}, "val_docs": {}}
    for domain, share in TARGET_MIX.items():
        items = list(by_domain.get(domain) or [])
        if not items:
            stats["train_old_tokens"][domain] = 0
            stats["val_old_tokens"][domain] = 0
            stats["train_docs"][domain] = 0
            stats["val_docs"][domain] = 0
            continue
        if domain in {"prose", "technical"}:
            sources = sorted({r["source_id"] for r in items})
            rng.shuffle(sources)
            by_src: dict[str, list[dict[str, Any]]] = defaultdict(list)
            for r in items:
                by_src[r["source_id"]].append(r)
            budget = int(UNIQUE_TARGET * share)
            val_budget = max(int(budget * 0.08), 1)
            used = 0
            vused = 0
            for src in sources:
                src_tok = sum(r["old_tokens"] for r in by_src[src])
                if vused < val_budget and vused + src_tok <= val_budget * 2 and used >= budget * 0.2:
                    val.extend(by_src[src])
                    vused += src_tok
                elif used < budget:
                    if used + src_tok > budget * 1.12 and used > budget * 0.9:
                        continue
                    train.extend(by_src[src])
                    used += src_tok
                elif vused < val_budget:
                    val.extend(by_src[src])
                    vused += src_tok
            stats["train_old_tokens"][domain] = used
            stats["val_old_tokens"][domain] = vused
        else:
            rng.shuffle(items)
            budget = int(UNIQUE_TARGET * share)
            val_budget = max(int(budget * 0.08), 1)
            used = 0
            vused = 0
            for r in items:
                tok = r["old_tokens"]
                if used < budget:
                    train.append(r)
                    used += tok
                elif vused < val_budget:
                    val.append(r)
                    vused += tok
                else:
                    break
            stats["train_old_tokens"][domain] = used
            stats["val_old_tokens"][domain] = vused
        stats["train_docs"][domain] = sum(1 for r in train if r["domain"] == domain)
        stats["val_docs"][domain] = sum(1 for r in val if r["domain"] == domain)
    used_keys = {(r["path"], r["key"]) for r in train + val}
    leftover_prose = [r for r in by_domain.get("prose", []) if (r["path"], r["key"]) not in used_keys]
    rng.shuffle(leftover_prose)
    # fill remaining unique budget with extra held-in prose documents (not val sources)
    val_sources = {r["source_id"] for r in val if r["domain"] == "prose"}
    total_old = sum(stats["train_old_tokens"].values())
    for r in leftover_prose:
        if r["source_id"] in val_sources:
            continue
        if total_old >= UNIQUE_TARGET:
            break
        train.append(r)
        stats["train_old_tokens"]["prose"] += r["old_tokens"]
        total_old += r["old_tokens"]
    stats["train_docs"]["prose"] = sum(1 for r in train if r["domain"] == "prose")
    if any(r["domain"] == "genesis" for r in train) and not any(r["domain"] == "genesis" for r in val):
        genesis = [r for r in train if r["domain"] == "genesis"]
        if len(genesis) > 1:
            hold = genesis[-1]
            train.remove(hold)
            val.append(hold)
            stats["train_old_tokens"]["genesis"] -= hold["old_tokens"]
            stats["val_old_tokens"]["genesis"] = hold["old_tokens"]
            stats["train_docs"]["genesis"] -= 1
            stats["val_docs"]["genesis"] = 1
    return train, val, stats


def load_texts(selected: list[dict[str, Any]]) -> list[dict[str, Any]]:
    needed: dict[str, set[str]] = defaultdict(set)
    filled: list[dict[str, Any]] = []
    index: dict[tuple[str, str], dict[str, Any]] = {}
    for rec in selected:
        if rec.get("instruction"):
            filled.append({**rec, "text": f"{rec['prompt']}\n{rec['target']}"})
            continue
        needed[rec["path"]].add(rec["key"])
        index[(rec["path"], rec["key"])] = rec
    for path, keys in needed.items():
        for rec in iter_jsonl(Path(path)):
            candidates = [
                str(rec.get("documentId") or ""),
                str(rec.get("chunk_id") or ""),
                str(rec.get("source_path") or ""),
                str(rec.get("id") or ""),
            ]
            hit = next((c for c in candidates if c and c in keys), None)
            if hit is None:
                continue
            text = rec.get("text") or rec.get("content") or ""
            if not isinstance(text, str) or not text.strip():
                continue
            sel = index.get((path, hit))
            if sel is None:
                continue
            filled.append({**sel, "text": text})
    return filled


def _bpe_tokenizer(vocab_size: int):
    from tokenizers import Tokenizer, decoders, models, pre_tokenizers, processors, trainers

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


def efficiency(tok, text: str) -> dict[str, float]:
    ids = tok.encode(text, add_special_tokens=False).ids
    words = [w for w in text.replace("\n", " ").split(" ") if w]
    return {
        "n_tokens": len(ids),
        "tokens_per_word": round(len(ids) / max(1, len(words)), 4),
        "tokens_per_char": round(len(ids) / max(1, len(text)), 4),
    }


def train_tokenizer_candidates(train_docs: list[dict[str, Any]]) -> dict[str, Any]:
    from tokenizers import processors

    def iterator() -> Iterator[str]:
        caps = defaultdict(int)
        for rec in train_docs:
            domain = rec["domain"]
            if caps[domain] > 3_500_000:
                continue
            text = rec.get("text") or ""
            if len(text) < 8:
                continue
            caps[domain] += len(text)
            yield text

    held = [rec for rec in train_docs if rec["domain"] == "prose"][-12:]
    held_text = "\n\n".join((r.get("text") or "")[:4000] for r in held) or EFFICIENCY_SAMPLES["english"]
    results = []
    TOKENIZER_DIR.mkdir(parents=True, exist_ok=True)
    for vocab in VOCAB_CANDIDATES:
        tok, trainer = _bpe_tokenizer(vocab)
        tok.train_from_iterator(iterator(), trainer=trainer)
        tok.post_processor = processors.ByteLevel(trim_offsets=False)
        path = TOKENIZER_DIR / f"candidate-{vocab}.json"
        tok.save(str(path))
        scores = {k: efficiency(tok, v) for k, v in EFFICIENCY_SAMPLES.items()}
        scores["heldout_prose"] = efficiency(tok, held_text)
        results.append({
            "vocab_size": vocab,
            "actual_vocab": tok.get_vocab_size(),
            "path": str(path),
            "sha256": sha256_file(path),
            "efficiency": scores,
        })
    # Select: prefer lower JSON/code tok/word, keep A near 23M ⇒ 16k unless 24/32k cuts JSON tok/word by ≥15%.
    base = results[0]
    json0 = base["efficiency"]["json"]["tokens_per_word"]
    code0 = base["efficiency"]["code"]["tokens_per_word"]
    chosen = results[0]
    reason = "default_16k_keeps_parameter_targets"
    for cand in results[1:]:
        json_gain = (json0 - cand["efficiency"]["json"]["tokens_per_word"]) / json0
        code_gain = (code0 - cand["efficiency"]["code"]["tokens_per_word"]) / code0
        if json_gain >= 0.15 and code_gain >= 0.10:
            chosen = cand
            reason = f"vocab {cand['vocab_size']} reduced JSON tok/word {json_gain:.1%} and code {code_gain:.1%}"
    frozen = TOKENIZER_DIR / "tokenizer.json"
    Path(chosen["path"]).read_bytes()
    frozen.write_bytes(Path(chosen["path"]).read_bytes())
    return {
        "candidates": results,
        "selected_vocab": chosen["vocab_size"],
        "selected_reason": reason,
        "tokenizer_path": str(frozen),
        "tokenizer_sha256": sha256_file(frozen),
        "actual_vocab": chosen["actual_vocab"],
        "efficiency": chosen["efficiency"],
    }


def encode_doc(tok, rec: dict[str, Any], ids: dict[str, int]) -> list[int]:
    text = rec.get("text") or ""
    if rec["domain"] == "instruction":
        prompt = rec.get("prompt") or text.split("\n", 1)[0]
        target = rec.get("target") or ""
        body = (
            [ids["bos"], ids["commander"]]
            + tok.encode("\n" + prompt, add_special_tokens=False).ids
            + [ids["assistant"]]
            + tok.encode("\n" + target, add_special_tokens=False).ids
            + [ids["eos"]]
        )
        return body
    pieces = [ids["bos"]] + tok.encode(text, add_special_tokens=False).ids + [ids["eos"]]
    return pieces


def pack_windows(docs: list[dict[str, Any]], tok, ids: dict[str, int], *, seq: int, n_windows: int, seed: int):
    import numpy as np

    rng = random.Random(seed)
    by_domain: dict[str, list[list[int]]] = defaultdict(list)
    unique_by_domain: dict[str, int] = defaultdict(int)
    for rec in docs:
        ids_doc = encode_doc(tok, rec, ids)
        if len(ids_doc) < 3:
            continue
        by_domain[rec["domain"]].append(ids_doc)
        unique_by_domain[rec["domain"]] += len(ids_doc)
    streams: dict[str, list[int]] = {}
    for domain, docs_ids in by_domain.items():
        order = list(docs_ids)
        rng.shuffle(order)
        stream: list[int] = []
        i = 0
        # Repeat documents only as needed to fill later packing; unique count is pre-repeat.
        while len(stream) < 4 or i < len(order):
            stream.extend(order[i % len(order)])
            i += 1
            if i > len(order) * 8 and len(stream) > seq * 8:
                break
        streams[domain] = stream
    windows = np.zeros((n_windows, seq), dtype=np.uint16)
    domains = []
    mix_keys = [k for k in TARGET_MIX if streams.get(k)]
    # Build domain window pools
    pools: dict[str, list[list[int]]] = {}
    for domain, stream in streams.items():
        pool = []
        for i in range(0, max(len(stream) - 1, seq), seq):
            chunk = stream[i : i + seq]
            if len(chunk) < seq:
                chunk = chunk + [ids["pad"]] * (seq - len(chunk))
            pool.append(chunk)
        rng.shuffle(pool)
        pools[domain] = pool
    counts = {k: 0 for k in mix_keys}
    target_n = {k: int(round(n_windows * TARGET_MIX[k])) for k in mix_keys}
    # fix rounding
    while sum(target_n.values()) < n_windows:
        target_n[mix_keys[0]] += 1
    while sum(target_n.values()) > n_windows:
        target_n[mix_keys[0]] -= 1
    cursor = {k: 0 for k in mix_keys}
    w = 0
    rr = list(mix_keys)
    while w < n_windows:
        progressed = False
        for domain in rr:
            if counts[domain] >= target_n[domain]:
                continue
            pool = pools[domain]
            chunk = pool[cursor[domain] % len(pool)]
            cursor[domain] += 1
            windows[w] = chunk
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
    return windows, domains, dict(unique_by_domain), counts


def frozen_probes() -> dict[str, Any]:
    """Original diagnostic items. Not copied from train holdouts."""
    instruction = [
        {"id": "brief", "family": "brief", "prompt": "In one short sentence, say what water does at 100 degrees Celsius.", "target": "It boils."},
        {"id": "classify", "family": "classify", "prompt": "Classify the word oak as animal or plant.", "target": "plant"},
        {"id": "extract", "family": "extract", "prompt": "From the list red stone willow, write only the tree name.", "target": "willow"},
        {"id": "transform", "family": "transform", "prompt": "Rewrite this in lowercase: HELLO", "target": "hello"},
        {"id": "list", "family": "list", "prompt": "List three primary colors, comma-separated.", "target": "red, blue, yellow"},
        {"id": "json", "family": "json", "prompt": "Return JSON with keys ok and n where ok is true and n is 3.", "target": '{"ok": true, "n": 3}'},
        {"id": "code", "family": "code", "prompt": "Write a Python function named double that returns n times two.", "target": "def double(n):\n    return n * 2"},
        {"id": "pos", "family": "pos", "prompt": "Reply with exactly the word yes.", "target": "yes"},
        {"id": "neg", "family": "neg", "prompt": "Do not mention cats. Name one farm animal.", "target": "cow"},
        {"id": "combo", "family": "combo", "prompt": "Give one even integer between 10 and 20 inclusive, digits only.", "target": "12"},
    ]
    natural = [
        {"id": "n1", "prompt": "The night sky over the lake was", "target": "quiet"},
        {"id": "n2", "prompt": "She opened the window because", "target": "the"},
        {"id": "n3", "prompt": "A reliable way to start a letter is", "target": "Dear"},
        {"id": "n4", "prompt": "After the rain, the garden smelled of", "target": "earth"},
    ]
    json_p = [
        {"id": "j1", "prompt": '{"ok":', "target": " true"},
        {"id": "j2", "prompt": '{"name": "ada", "n":', "target": " 1"},
        {"id": "j3", "prompt": "[\n  {\"id\": 1},\n  {\"id\":", "target": " 2"},
    ]
    code_p = [
        {"id": "c1", "prompt": "def add(a, b):\n    return ", "target": "a"},
        {"id": "c2", "prompt": "for i in range(3):\n    print(", "target": "i"},
        {"id": "c3", "prompt": "class Point:\n    def __init__(self, x, y):\n        self.x = ", "target": "x"},
    ]
    reason = [
        {"id": "r1", "prompt": "2 + 3 =", "target": " 5"},
        {"id": "r2", "prompt": "The next integer after 7 is", "target": " 8"},
        {"id": "r3", "prompt": "If all birds have wings and a robin is a bird, a robin has", "target": " wings"},
    ]
    language = [
        {"id": "l1", "prompt": "It is a truth universally acknowledged, that a single man in possession of a good fortune", "target": " must"},
        {"id": "l2", "prompt": "The purpose of a standard is to make independent implementations", "target": " interoperable"},
    ]
    payload = {
        "kind": "WRIM1_PILOT_PROBES_v1",
        "train_on_answers": False,
        "instruction": instruction,
        "natural": natural,
        "json": json_p,
        "code": code_p,
        "reasoning": reason,
        "language": language,
    }
    payload["sha256"] = sha256_text(json.dumps(payload, sort_keys=True, ensure_ascii=False))
    return payload


def special_ids(tok) -> dict[str, int]:
    names = {
        "pad": "<|pad|>",
        "bos": "<|bos|>",
        "eos": "<|eos|>",
        "unk": "<|unk|>",
        "system": "<|system|>",
        "commander": "<|commander|>",
        "assistant": "<|assistant|>",
        "tool": "<|tool|>",
        "evidence": "<|evidence|>",
    }
    out = {}
    for k, name in names.items():
        tid = tok.token_to_id(name)
        if tid is None:
            raise RuntimeError(f"missing special {name}")
        out[k] = int(tid)
    return out
