# WR-CORPUS v1 — Canonical sovereign corpus

**Roadmap:** #22 CLOSED · **#23:** ACTIVE (WR-CORPUS implemented)  
**Architecture ID:** `WR_CORPUS`  
**Runtime version:** `wr-corpus-v1`  
**Not started / not implemented:** tokenizer training, production WRIM, Ra'el, model training  
**Tokenizer:** WR-TOKENIZER-0 reconciled (`KEEP_AND_EXTEND_LATER`) — see `docs/architecture/WR_TOKENIZER_RECONCILIATION.md`  
**WRIM lineage:** reconciled (`B_REBUILD_WRIM_1_FROM_WRIM_0`) — see `docs/architecture/WRIM_RECONCILIATION.md`. Historical WRIM-1 = REJECTED_COLLAPSED. No training this pass.

This is the single canonical corpus architecture. Do not create Corpus2, WRCorpus2, TrainingCorpus2, or RaelCorpus.

## Historical vs canonical names

| Canonical | Historical identity | Layout |
|---|---|---|
| WR-CORPUS-0 | WRM-001 / `175af25fe1c17cf7630b506d0d6e6e88` | genesis bundle (`corpus.jsonl` + manifest) |
| WR-CORPUS-1 | WR-CORPUS-1-HARDENED | train/val/test shards + npy + Wave 8 metadata |
| WR-CORPUS-ACTIVE | live Commander-promoted records | SQLite active layer |

`canonical_name` and `historical_name` are both retained. History is not rewritten as if WRM-001 was originally called WR-CORPUS-0.

## Storage

Canonical mutable index + imported immutable bytes live under sovereign AppData:

`%LOCALAPPDATA%\War Room OS\data\wr-corpus\`

- `artifacts/WR-CORPUS-0/` and `artifacts/WR-CORPUS-1/` — imported frozen bytes
- `wr-corpus.sqlite` — version registry, records, embeddings, tombstones, migration/promotion events

Not stored in git. Not stored in the installed application directory. The Mac recovery dump remains a **read-only** historical source and is never mutated or junctioned over live `model-lab/`.

## Classification truth

- WR-CORPUS-0: REAL_DATA, GENESIS_SMOKE, VALIDATION_ONLY. Not silently production-training eligible.
- WR-CORPUS-1: REAL_DATA, HARDENED_CANDIDATE, historical PRODUCTION_CANDIDATE. Not current production model corpus. Not automatically TRAINING_ELIGIBLE.
- Old `allowedForTraining: true` maps to `HISTORICAL_DECLARED_ELIGIBLE_NOT_CURRENT`.
- Unknown rights: `REQUIRES_REVIEW`.

## Growth path

Research → World Learning → Data Corpus → durable candidate → **explicit Commander approval** → WR-CORPUS-ACTIVE.

Raw Search cannot bypass World Learning. Candidates are never auto-promoted. `startWrCorpus` is denied as a second architecture.

## Retrieval / RAG

Lexical + hashed-token semantic retrieval over the canonical index. Qwen may RAG over migrated WR-CORPUS. That is retrieval, not training. Qwen remains `THIRD_PARTY_MODEL_RUNNING_LOCALLY`.

## Delete / tombstones

Active-layer delete supports `DELETE_AND_ALLOW_RELEARN` and `DELETE_AND_BLOCK_RELEARN`. The recovery dump is never deleted. UI distinguishes `ACTIVE_CORPUS_DELETE` from `HISTORICAL_RECOVERY_SOURCE_PRESERVED`.

## Historical lineage (not production)

- HISTORICAL WR-TOKENIZER-0: TRAINED_VALIDATED (SHA `47ed32ce…`); canonical reconciled tokenizer (`KEEP_AND_EXTEND_LATER`); training still NOT_STARTED
- HISTORICAL WRIM-0: TRAINED_RESEARCH_ARTIFACT (`d1affa59…`)
- HISTORICAL WRIM-1: REJECTED_COLLAPSED
- WRIM1-RUN-000001: collapsed, promotion rejected
- WRIM1-RUN-000002: partial training failed, not promoted
- Continuation: `B_REBUILD_WRIM_1_FROM_WRIM_0` (not started)
- Recovery experiments: TEST_ONLY

Checkpoint trees are not imported into WR-CORPUS.

See `lib/wr-corpus/` for implementation and `pnpm run validate:wr-corpus` / `pnpm run migrate:wr-corpus`.
