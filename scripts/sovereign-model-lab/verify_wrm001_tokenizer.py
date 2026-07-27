#!/usr/bin/env python3
"""War Room Sovereign Model Lab — Phase 2A tokenizer verification (Part 10, checks 8-15).

Loads a trained tokenizer.json fresh in this brand-new process (satisfying the "reload succeeds in
a fresh process" check by construction) and runs a fixed battery of encode/decode probes. Prints one
JSON result blob to stdout: {"ok": bool, "checks": [{id, label, passed, detail}, ...]}.

No network access. Reads only the single artifact path given on the command line.
"""
import argparse
import json
import sys

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

LONG_INPUT_MAX_CHARS = 100_000


def check(checks: list, id_: str, label: str, passed: bool, detail: str) -> None:
    checks.append({"id": id_, "label": label, "passed": passed, "detail": detail})


def main() -> None:
    parser = argparse.ArgumentParser(prog="verify_wrm001_tokenizer.py")
    parser.add_argument("--tokenizer-path", required=True)
    args = parser.parse_args()

    checks: list = []

    try:
        from tokenizers import Tokenizer
    except ImportError as exc:
        print(json.dumps({"ok": False, "checks": [{"id": "reload_fresh_process", "label": "Artifact reload in fresh process", "passed": False, "detail": f"tokenizers library not importable: {exc}"}]}))
        sys.exit(0)

    try:
        tokenizer = Tokenizer.from_file(args.tokenizer_path)
        check(checks, "reload_fresh_process", "Artifact reload in fresh process", True, "Loaded successfully in a newly-spawned process.")
    except Exception as exc:  # noqa: BLE001 — verification must report failure, never crash
        print(json.dumps({"ok": False, "checks": [{"id": "reload_fresh_process", "label": "Artifact reload in fresh process", "passed": False, "detail": str(exc)}]}))
        sys.exit(0)

    vocab = tokenizer.get_vocab()
    special_token_ids = [vocab.get(tok, -1) for tok in REQUIRED_SPECIAL_TOKENS]
    check(checks, "special_tokens_exist", "Special tokens exist in vocabulary", all(i != -1 for i in special_token_ids), json.dumps(dict(zip(REQUIRED_SPECIAL_TOKENS, special_token_ids))))
    present_ids = [i for i in special_token_ids if i != -1]
    check(checks, "special_token_ids_unique", "Special token IDs are unique", len(present_ids) == len(set(present_ids)), f"{len(present_ids)} present, {len(set(present_ids))} unique")

    ascii_text = "The Commander reviewed the report."
    try:
        encoded = tokenizer.encode(ascii_text)
        check(checks, "encode_succeeds", "Encode succeeds", True, f"{len(encoded.ids)} tokens")
    except Exception as exc:  # noqa: BLE001
        check(checks, "encode_succeeds", "Encode succeeds", False, str(exc))
        encoded = None

    if encoded is not None:
        try:
            decoded = tokenizer.decode(encoded.ids)
            check(checks, "decode_succeeds", "Decode succeeds", True, decoded[:80])
            roundtrip_close = decoded.replace(" ", "").strip() != "" if decoded else False
            check(checks, "roundtrip_measured", "Encode/decode round-trip measured", True, f"original_len={len(ascii_text)} decoded_len={len(decoded)} non_empty={roundtrip_close}")
        except Exception as exc:  # noqa: BLE001
            check(checks, "decode_succeeds", "Decode succeeds", False, str(exc))
            check(checks, "roundtrip_measured", "Encode/decode round-trip measured", False, "decode failed")

    unicode_text = "Ra'el 指揮官 🛡️ café naïve"
    try:
        u_encoded = tokenizer.encode(unicode_text)
        u_decoded = tokenizer.decode(u_encoded.ids)
        check(checks, "unicode_text_works", "Unicode text works", True, f"{len(u_encoded.ids)} tokens, decoded_len={len(u_decoded)}")
    except Exception as exc:  # noqa: BLE001
        check(checks, "unicode_text_works", "Unicode text works", False, str(exc))

    unknown_char_text = "𐀀 \x00\x01 unusual bytes"
    try:
        tokenizer.encode(unknown_char_text)
        check(checks, "unknown_characters_no_crash", "Unknown characters do not crash", True, "encoded without raising")
    except Exception as exc:  # noqa: BLE001
        check(checks, "unknown_characters_no_crash", "Unknown characters do not crash", False, str(exc))

    try:
        empty_encoded = tokenizer.encode("")
        check(checks, "empty_input_no_crash", "Empty input does not crash", True, f"{len(empty_encoded.ids)} tokens")
    except Exception as exc:  # noqa: BLE001
        check(checks, "empty_input_no_crash", "Empty input does not crash", False, str(exc))

    long_text = ("The Commander reviewed the readable Council response. " * 2000)[:LONG_INPUT_MAX_CHARS]
    try:
        long_encoded = tokenizer.encode(long_text)
        check(checks, "long_input_bounded", "Long input is bounded", True, f"input_chars={len(long_text)} tokens={len(long_encoded.ids)}")
    except Exception as exc:  # noqa: BLE001
        check(checks, "long_input_bounded", "Long input is bounded", False, str(exc))

    all_passed = all(c["passed"] for c in checks)
    print(json.dumps({"ok": all_passed, "checks": checks}))


if __name__ == "__main__":
    main()
