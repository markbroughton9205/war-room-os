"""RUN-000012 diagnostics. Reuses RUN-000011 rank/top-k/margin tools. Adds top20."""
from __future__ import annotations

from run000011_diagnostics import *  # noqa: F401,F403
from run000011_diagnostics import topk_counts as _topk_counts_011


def topk_counts(ranks: list[int | float | None]) -> dict[str, int]:
    base = _topk_counts_011(ranks)
    nums = [int(r) for r in ranks if r is not None]
    base["TARGET_IN_TOP_20"] = sum(1 for r in nums if r <= 20)
    return base
