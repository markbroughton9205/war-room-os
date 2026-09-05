#!/usr/bin/env python3
"""War Room Sovereign Model Lab — Phase 2A real tokenizer training.

Trains a tokenizer from the approved WRM-001 corpus only, using a tokenizer library that is
ALREADY installed in this environment. This script never installs anything, never makes a network
request, never downloads a vocabulary or any external model artifact, and never loads a third-party
model. Ownership is strictly war_room_native_artifact: source is the approved corpus only.

Fixed CLI contract — unknown arguments are rejected by construction (argparse.parse_args, not
parse_known_args). No shell string is ever built from these arguments; they are passed straight
through to the tokenizer library's Python API.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

MODEL_ID = "WRM-001-TOKENIZER"
OWNERSHIP = "war_room_native_artifact"

REQUIRED_SPECIAL_TOKENS = [
    "<|pad|>",
    "<|bos|>",
    "<|eos|>",
    "<|unk|>",
    "<|system|>",
    "<|commander|>",
    "<|assistant|>",
    "<|tool|>",
    "<|evidence|>",
]


def fail(message: str, code: int = 1) -> None:
    print(json.dumps({"ok": False, "error": message}), file=sys.stderr)
    sys.exit(code)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="train_wrm001_tokenizer.py",
        description="Train a real local WRM-001 tokenizer from an approved corpus. No network access.",
    )
    parser.add_argument("--corpus", required=True, help="Path to corpus.jsonl")
    parser.add_argument("--output-dir", required=True, help="Directory to write tokenizer.json into")
    parser.add_argument("--algorithm", required=True, choices=["bpe", "unigram", "wordpiece"])
    parser.add_argument("--vocab-size", required=True, type=int)
    parser.add_argument("--minimum-frequency", required=True, type=int)
    parser.add_argument("--seed", required=True, type=int)
    parser.add_argument("--manifest-output", required=True, help="Path to write the training manifest JSON")
    return parser.parse_args()


def load_corpus_texts(corpus_path: Path) -> list[str]:
    texts: list[str] = []
    with corpus_path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                fail(f"corpus.jsonl line {line_no} is not valid JSON: {exc}")
                raise
            text = record.get("text", "")
            if isinstance(text, str) and text.strip():
                texts.append(text)
    return texts


def recommend_vocab_size(requested: int, texts: list[str]) -> tuple[int, str | None]:
    """Honestly recommend a lower vocab size when the corpus cannot support the requested one. A
    documented, conservative heuristic — never silently substituted, always reported."""
    total_chars = sum(len(t) for t in texts)
    unique_chars = len(set("".join(texts)))
    base_alphabet = max(unique_chars, 32)
    # A tokenizer cannot usefully learn more merge rules than roughly half its training character
    # count, and should never be recommended below its own base alphabet + special tokens.
    ceiling = max(base_alphabet + len(REQUIRED_SPECIAL_TOKENS), total_chars // 2)
    if requested <= ceiling:
        return requested, None
    reason = (
        f"Requested vocab_size={requested} exceeds what this corpus ({total_chars} characters, "
        f"{unique_chars} unique) can usefully support. Recommending {ceiling} instead "
        f"(heuristic: max(base_alphabet + special_tokens, total_chars // 2), not an authoritative bound)."
    )
    return ceiling, reason


def train_tokenizer(texts: list[str], algorithm: str, vocab_size: int, min_frequency: int, seed: int):
    try:
        from tokenizers import Tokenizer
        from tokenizers.models import BPE, Unigram, WordPiece
        from tokenizers.trainers import BpeTrainer, UnigramTrainer, WordPieceTrainer
        from tokenizers.pre_tokenizers import ByteLevel
    except ImportError as exc:
        fail(f"Required tokenizer library not importable: {exc}")
        raise

    if algorithm == "bpe":
        tokenizer = Tokenizer(BPE(unk_token="<|unk|>"))
        trainer = BpeTrainer(vocab_size=vocab_size, min_frequency=min_frequency, special_tokens=REQUIRED_SPECIAL_TOKENS)
    elif algorithm == "wordpiece":
        tokenizer = Tokenizer(WordPiece(unk_token="<|unk|>"))
        trainer = WordPieceTrainer(vocab_size=vocab_size, min_frequency=min_frequency, special_tokens=REQUIRED_SPECIAL_TOKENS)
    else:
        tokenizer = Tokenizer(Unigram())
        trainer = UnigramTrainer(vocab_size=vocab_size, special_tokens=REQUIRED_SPECIAL_TOKENS, seed=seed)

    tokenizer.pre_tokenizer = ByteLevel()
    tokenizer.train_from_iterator(texts, trainer=trainer)
    return tokenizer


def main() -> None:
    args = parse_args()
    corpus_path = Path(args.corpus)
    output_dir = Path(args.output_dir)
    manifest_output_path = Path(args.manifest_output)

    if not corpus_path.is_file():
        fail(f"Corpus file does not exist: {corpus_path}")
        return

    output_dir.mkdir(parents=True, exist_ok=True)

    texts = load_corpus_texts(corpus_path)
    if not texts:
        fail("Corpus contains zero non-empty text records — cannot train a tokenizer from nothing.")
        return

    vocab_size_produced, vocab_adjustment_reason = recommend_vocab_size(args.vocab_size, texts)
    if vocab_adjustment_reason:
        print(json.dumps({"progress": "vocab_size_adjusted", "detail": vocab_adjustment_reason}))

    started_at = time.time()
    tokenizer = train_tokenizer(texts, args.algorithm, vocab_size_produced, args.minimum_frequency, args.seed)
    runtime_seconds = time.time() - started_at

    tokenizer_json_path = output_dir / "tokenizer.json"
    tokenizer.save(str(tokenizer_json_path))

    vocab = tokenizer.get_vocab()
    special_token_ids = [{"token": tok, "id": vocab.get(tok, -1)} for tok in REQUIRED_SPECIAL_TOKENS]
    missing_special_tokens = [entry["token"] for entry in special_token_ids if entry["id"] == -1]
    if missing_special_tokens:
        fail(f"Special tokens missing from trained vocabulary: {missing_special_tokens}")
        return

    manifest = {
        "modelId": MODEL_ID,
        "ownership": OWNERSHIP,
        "algorithm": args.algorithm,
        "vocabSizeRequested": args.vocab_size,
        "vocabSizeProduced": len(vocab),
        "vocabAdjustmentReason": vocab_adjustment_reason,
        "minimumFrequency": args.minimum_frequency,
        "seed": args.seed,
        "specialTokens": special_token_ids,
        "corpusPath": str(corpus_path),
        "corpusRecordCount": len(texts),
        "runtimeSeconds": runtime_seconds,
        "trainedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "artifactFile": "tokenizer.json",
    }
    manifest_output_path.parent.mkdir(parents=True, exist_ok=True)
    with manifest_output_path.open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)

    print(json.dumps({"ok": True, "manifest": manifest}))


if __name__ == "__main__":
    main()
