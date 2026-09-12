# #22 Phase 8 — Bounded DATA_CORPUS_AGENT Runtime

**Status:** IMPLEMENTED_BOUNDED  
**Operational Ascension agents:** 7  
**Ascension autonomy:** OFF  
**Crawl / training:** DENIED  
**#23:** WR-CORPUS ACTIVE (promotion remains Commander-governed; tokenizer/WRIM/Ra'el not started)  

## Identity

| Field | Value |
| --- | --- |
| agent_role | DATA_CORPUS_AGENT |
| runtime_version | ascension-phase8-v1 |
| policy_profile | BOUNDED_CORPUS_CURATION |

## Architecture (preserve)

- Sovereign Search / local index / Stage 5 freshness (FRESH/DUE/STALE/UNKNOWN)
- Evidence Packet + stored research metadata surfaces
- Frozen Stage 4: `CHUNKING_VERSION=wr-chunk-v1`, embedding `BAAI/bge-small-en-v1.5`
- Curation ≠ training; indexing ≠ model learning

## Soft kill

`ASCENSION_DATA_CORPUS_AGENT_ENABLED=false`

## Validation

```bash
pnpm run validate:ascension-phase8
```

## API

`POST /api/ascension/data-corpus-agent/run` (Commander session)

## Explicitly not in Phase 8

- Crawl expansion / source approval
- WR-CORPUS / tokenizer / WRIM / Ra'el / #23
- Embedding model or Stage 4 threshold changes
- Auto-delete duplicates
- FUTURE_NAVIGATION_AGENT / FUTURE_WORLD_LEARNING_AGENT
