#!/usr/bin/env python3
"""wrim-foundation: WRIM Genesis Foundation Promptbook runner.

Does not construct a WRIM optimizer. Does not promote. Does not rerun MOD-02A.
"""
from __future__ import annotations

from wrim_promptbook.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
