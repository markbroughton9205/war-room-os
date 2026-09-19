"""Starved-doc accounting for WRIM1-RUN-000006. Stdlib only. No optimizer."""
from __future__ import annotations

from typing import Any

FROZEN_GENESIS_TRAIN_IDS = [
    "3aad6a56-039d-45c7-ba1b-3642f3293196",
    "7180f321-8186-424a-b995-f3298b29d5c2",
    "a1211375-318b-4866-92ba-70bb10241766",
    "af0163c6-478f-4541-aab0-7ad84e592222",
    "bdbb17d6-5e32-4672-980f-7cdb68d0ab5a",
]


def rehearsal_coverage_report(
    token_counts_by_doc: dict[str, int],
    *,
    all_doc_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Coverage begins from the authoritative genesis train IDs, including zeros."""
    pool: list[str] = []
    seen: set[str] = set()
    for d in list(all_doc_ids or []) + list(FROZEN_GENESIS_TRAIN_IDS):
        if d and d not in seen:
            pool.append(d)
            seen.add(d)
    counts = {d: int(token_counts_by_doc.get(d, 0)) for d in pool}
    total = float(sum(counts.values()))
    denom = total if total > 0 else 1.0
    shares = {d: float(counts[d]) / denom for d in pool}
    share_vals = [shares[d] for d in pool]
    starved = [d for d in pool if counts[d] <= 0]
    consumed = [d for d in pool if counts[d] > 0]
    p2 = sum(s * s for s in share_vals if s > 0)
    effective_n = (1.0 / p2) if p2 > 0 else 0.0
    return {
        "ALL_DOC_IDS": list(pool),
        "CONSUMED_DOC_IDS": consumed,
        "STARVED_DOC_IDS": starved,
        "DOC_TOKEN_COUNTS": counts,
        "DOC_TOKEN_SHARES": {d: round(shares[d], 8) for d in pool},
        "MAX_DOC_SHARE": round(max(share_vals, default=0.0), 6),
        "EFFECTIVE_DOCUMENT_N": round(effective_n, 6),
        "rehearsal_tokens": int(total),
        "n_genesis_docs_in_prefix": len(consumed),
        "starved_docs": starved,
        "max_doc_share_of_rehearsal": round(max(share_vals, default=0.0), 6),
    }
