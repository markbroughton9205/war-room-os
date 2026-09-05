#!/usr/bin/env python3
"""Count tokens with WR-TOKENIZER-0. Does not train or overwrite the tokenizer."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from tokenizers import Tokenizer

payload = json.load(sys.stdin)
tokenizer = Tokenizer.from_file(payload["tokenizerPath"])
report: dict[str, dict[str, float | int | None]] = {}
for item in payload["items"]:
    text = item.get("text")
    if text is None:
        text = Path(item["path"]).read_text(encoding="utf-8", errors="replace")
    ids = tokenizer.encode(text).ids
    chars = len(text)
    raw = text.encode("utf-8")
    tokens = len(ids)
    report[item["id"]] = {
        "chars": chars,
        "bytes": len(raw),
        "tokens": tokens,
        "charsPerToken": (chars / tokens) if tokens else None,
        "bytesPerToken": (len(raw) / tokens) if tokens else None,
    }
json.dump(report, sys.stdout)
