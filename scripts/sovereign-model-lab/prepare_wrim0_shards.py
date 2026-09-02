#!/usr/bin/env python3
"""WR-CORPUS-0 -> WR-TOKENIZER-0 shard preparation for WRIM-0.

Tokenizes the real, Commander-approved WRM-001 corpus.jsonl (produced by
lib/sovereign-model-lab/corpusBuilder.ts via the actual approval-gated pipeline) with the real,
verified WR-TOKENIZER-0 artifact, and writes uint16 token-id shards plus a manifest recording every
hash needed to reproduce this exact preparation. Never fetches anything over the network, never
loads a third-party tokenizer or model.

Deterministic split: documents are sorted by documentId before splitting so the same corpus always
produces the same train/val boundary regardless of JSONL line order.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from tokenizers import Tokenizer


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus-jsonl", required=True)
    ap.add_argument("--tokenizer-json", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--val-fraction", type=float, default=0.05)
    args = ap.parse_args()

    corpus_path = Path(args.corpus_jsonl)
    tokenizer_path = Path(args.tokenizer_json)
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    vocab_size = tokenizer.get_vocab_size()
    bos_id = tokenizer.token_to_id("<|bos|>")
    eos_id = tokenizer.token_to_id("<|eos|>")
    if bos_id is None or eos_id is None:
        print("FATAL: tokenizer is missing required <|bos|>/<|eos|> special tokens", file=sys.stderr)
        return 1

    records = []
    with open(corpus_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            records.append(json.loads(line))
    records.sort(key=lambda r: r["documentId"])

    n_val = max(1, round(len(records) * args.val_fraction)) if len(records) > 1 else 0
    val_records = records[:n_val] if n_val > 0 else []
    train_records = records[n_val:] if n_val > 0 else records

    def encode_split(recs):
        ids: list[int] = []
        doc_boundaries = []
        for r in recs:
            enc = tokenizer.encode(r["text"])
            ids.append(bos_id)
            ids.extend(enc.ids)
            ids.append(eos_id)
            doc_boundaries.append({"documentId": r["documentId"], "tokenCount": len(enc.ids) + 2})
        return ids, doc_boundaries

    train_ids, train_docs = encode_split(train_records)
    val_ids, val_docs = encode_split(val_records) if val_records else ([], [])

    max_id = max(vocab_size - 1, bos_id, eos_id)
    dtype = np.uint16 if max_id < 65536 else np.uint32

    train_arr = np.array(train_ids, dtype=dtype)
    val_arr = np.array(val_ids, dtype=dtype)

    train_path = out_dir / "train.npy"
    val_path = out_dir / "val.npy"
    np.save(train_path, train_arr)
    np.save(val_path, val_arr)

    manifest = {
        "corpusJsonlPath": str(corpus_path),
        "corpusJsonlSha256": sha256_file(corpus_path),
        "tokenizerJsonPath": str(tokenizer_path),
        "tokenizerJsonSha256": sha256_file(tokenizer_path),
        "vocabSize": vocab_size,
        "bosId": bos_id,
        "eosId": eos_id,
        "dtype": str(dtype),
        "trainDocumentCount": len(train_records),
        "valDocumentCount": len(val_records),
        "trainTokenCount": int(train_arr.size),
        "valTokenCount": int(val_arr.size),
        "trainDocs": train_docs,
        "valDocs": val_docs,
        "trainNpySha256": sha256_file(train_path),
        "valNpySha256": sha256_file(val_path),
    }
    manifest_path = out_dir / "shard-manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    print(json.dumps({
        "vocabSize": vocab_size,
        "trainTokenCount": int(train_arr.size),
        "valTokenCount": int(val_arr.size),
        "trainNpySha256": manifest["trainNpySha256"],
        "valNpySha256": manifest["valNpySha256"],
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
