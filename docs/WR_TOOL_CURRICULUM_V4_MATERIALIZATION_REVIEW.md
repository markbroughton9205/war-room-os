# WR-TOOL CURRICULUM V4 MATERIALIZATION REVIEW

Date: 2026-08-31  
Identity: `WR-TOOL-CURRICULUM-V4-CANDIDATE`  
Path: `model-lab/manifests/wr_tool_curriculum/design/WR-TOOL-CURRICULUM-V4-CANDIDATE/`  
Status: **CANDIDATE. NOT FINAL. NOT TRAINED.**

Does **not** overwrite `WR-TOOL-CURRICULUM-V3`, `WR-TOOL-EVAL-2`, `WR-TOOL-EVAL-3`, or prior trajectory ledgers.

**Materialization:** WR-TOOL CURRICULUM V4 MATERIALIZATION — PASS

**Experiment 004:** WR-TOOL V4 — NOT READY FOR EXPERIMENT 004 REVIEW

Do **not** start Experiment 004, LoRA, r=4, argument extraction, Recovery-012, or WRIM1-RUN-000003.

Runtime estimate before start: ~5 minutes. Actual well under 60 minutes. Deterministic rebuild ×2: hashes identical.

## Class space (OPTION B)

Historical eight preserved as catalog history. V4 **train** classes:

`NO_TOOL`, `WEB`, `MEMORY`, `FILES`, `RESEARCH`, `SHA256`

**LOOKUP_NOTE** and **ECHO_INT** are curriculum/test-only (not `TOOL_REGISTRY` operator tools). They are inventoried, not trained.

Rationale: operator classroom must not mix mock fixtures. SHA256 is a bounded WRIM utility with VERIFIED REAL_RUNTIME, so it is kept. This is **not** 8-class convenience.

EXP-003 head was `Linear(256→8)`. Option B requires `Linear(256→6)` and a new class index map: **DATASET/LOADER CHANGE REQUIRED**. Architecture was not modified in this mission.

## Eligibility (recomputed)

Gold routing rows require VERIFIED or SUPPORTED, `REAL_RUNTIME` or `REAL_TEST`, recovered arguments and result status, no EVAL-2/EVAL-3 exact/normalized/family leak, no JWT/Bearer request text, no REPLAY-as-independent-gold, no V3 synthetic import, no MEMORY clones.

PARTIAL rows may appear only as labeled failures (`TAVILY_401`, `NO_MATCH`, `MISSING_ARGUMENT`) with routing target separate from execution outcome.

## MEMORY caveat (VALID BUT NARROW)

2 SUPPORTED retrieves. 2 request families. Store: 3 rows, 2 unique texts, `decree` only, overlapping hits. SHA256 observer restatements capped (7 dropped). Synthetic MEMORY: **0**.

## Numbers

| item | n |
|---|---|
| Inventory rows (ledgers + pool) | 101 |
| V3 examples inspected, not imported | 441 |
| Inspected total | 542 |
| Included (gold + labeled failures) | 33 |
| Routing gold | 27 |
| Labeled failures | 6 |
| Train / val / test | 26 / 4 / 3 |
| REAL_RUNTIME routing gold | 18 |
| REAL_TEST routing gold | 9 |
| SYNTHETIC in V4 shards | 0 |
| Row-level real/test | 100% |
| Family-level real/test | 100% |

Routing gold by class: NO_TOOL 9, WEB 2, MEMORY 2, FILES 5, RESEARCH 6, SHA256 3.

## Leakage / duplicates / splits

EVAL-2 and EVAL-3 exact, normalized, and family overlap with included rows: **0**. Family overlap across train/val/test: **0**. Exact duplicate removals: 0. Normalized duplicate removals: 0.

Internal test has FILES, RESEARCH, NO_TOOL only — no MEMORY/WEB/SHA256 in test (scarcity).

## Baselines (validation routing gold n=4)

Majority 0.50 (NO_TOOL). Random 0.167. Keyword 0.75. Schema/rule 0.75. BoW linear 1.00. **BoW 1.00 is not skill** — n=4. Treat as a tiny-split diagnostic only.

## Hashes

See `HASHES.json`. Combined bundle `5121e4550e0c6e7543000fa29caca03435aa2c80542dd6946d1dcef561940b7f`.

## Why EXP-004 is not ready

1. MEMORY gold is two overlapping decree retrieves.  
2. Loader/head must change from 8-way to 6-way.  
3. n=27 routing gold is scarcity, not a replacement for V3’s 441 synthetic-heavy set.

The workbook is assembled and auditable. Commander review is the next step. Training is not.

## Held-out expansion (2026-08-31, later the same day)

Separate package `WR-TOOL-EVAL-4-CANDIDATE` at `model-lab/manifests/wr_tool_evals/WR-TOOL-EVAL-4-CANDIDATE/`. See `docs/WR_TOOL_EVAL_4_HELD_OUT_EXPANSION_REPORT.md`.

V4 **train** hash unchanged: `4b8b33f0a44150ebadfbd3c7bc9d0cc09ec3f44836f693222b6e1a83d99d15da` (n=26). EVAL-2 and EVAL-3 not overwritten.

EVAL-4: 32 held-out rows (val 16 / test 16), all six classes in both splits, 8 hard-boundary families, train/EVAL-2/EVAL-3 leaks 0. MEMORY held-out is EVAL_SYNTHETIC (live store still decree-only).

## EXP-004 6-class design review (later the same day)

See `docs/WR_TOOL_EXP_004_DESIGN_REVIEW.md`. Package `WR-TOOL-EXP-004-DESIGN`. Dry-run verified Linear(256→6)=1542, LoRA 36864, trainable 38406, core diff 0, no optimizer step. Design is ready for Commander to decide on a later training mission. **Experiment 004 was not started.**
