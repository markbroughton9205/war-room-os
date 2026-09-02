#!/usr/bin/env python3
"""Encode category samples with WR-TOKENIZER-0. Does not train or overwrite the tokenizer."""
from __future__ import annotations

import json
import sys
from tokenizers import Tokenizer

payload = json.load(sys.stdin)
tokenizer = Tokenizer.from_file(payload["tokenizerPath"])
report = {}
for name, text in payload["samples"].items():
    ids = tokenizer.encode(text).ids
    report[name] = {
        "chars": len(text),
        "tokens": len(ids),
        "charsPerToken": (len(text) / len(ids)) if ids else None,
    }
json.dump(report, sys.stdout)
