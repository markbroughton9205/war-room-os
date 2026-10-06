"""Unified evaluation hooks. Does not train. Full WRIM greedy eval is opt-in."""
from __future__ import annotations

from typing import Any

from wrim_promptbook.engine import Engine


def list_suites() -> dict[str, Any]:
    return Engine().evaluate("status")
