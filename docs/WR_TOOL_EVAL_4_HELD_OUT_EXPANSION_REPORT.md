# WR-TOOL-EVAL-4 — HELD-OUT EVIDENCE EXPANSION

Date: 2026-08-31  
Identity: `WR-TOOL-EVAL-4-CANDIDATE`  
Path: `model-lab/manifests/wr_tool_evals/WR-TOOL-EVAL-4-CANDIDATE/`  
`EXCLUDE_FROM_TRAINING=true`  
Does **not** overwrite `WR-TOOL-EVAL-2`, `WR-TOOL-EVAL-3`, or `WR-TOOL-CURRICULUM-V4-CANDIDATE` train.

**Mission verdict:** WR-TOOL V4 HELD-OUT EVIDENCE EXPANSION — PASS  
**Readiness (historical, this eval mission):** WR-TOOL V4 — NOT READY FOR EXPERIMENT 004 REVIEW  
**Later:** Commander authorized EXP-004 training against this frozen exam. See `docs/WR_TOOL_EXP_004_TRAINING_REPORT.md`. EVAL-4 bytes were not regenerated.

Runtime estimate before start: ~5 minutes. Actual well under 60 minutes. Deterministic rebuild ×2: hashes identical.

This mission expands the exam. It does not add homework (train rows). It does not start Experiment 004.

## Phase A — train freeze

V4 train shard treated as immutable.

| when | `train.jsonl` SHA-256 |
|---|---|
| before | `4b8b33f0a44150ebadfbd3c7bc9d0cc09ec3f44836f693222b6e1a83d99d15da` |
| after | `4b8b33f0a44150ebadfbd3c7bc9d0cc09ec3f44836f693222b6e1a83d99d15da` |

Train changed: **NO**. Train n remains **26**. No family reassignment.

## Phase B — inventory of prior held-out coverage

| set | n | missing / weak |
|---|---|---|
| V4 internal validation | 4 | FILES, RESEARCH, SHA256 absent |
| V4 internal test | 3 | MEMORY, WEB, SHA256 absent |
| WR-TOOL-EVAL-2 | 115 | historical 8-class scorecard; not overwritten |
| WR-TOOL-EVAL-3 | 13 | all six present but tiny (MEMORY/WEB/FILES/SHA256 = 1 each) |

V4 internal test had no WEB vs RESEARCH, FILES vs MEMORY, MEMORY vs NO_TOOL, or WEB vs NO_TOOL pairs.

## Phase C — MEMORY

Live `memories` store remains **3 rows / 2 unique decree texts**. New real fact families cannot be minted without fabricating memories.

MEMORY held-out rows are **EVAL_SYNTHETIC** routing challenges, distinct from train families:

- `fam.e4.boundary.files-vs-memory.deploy-freeze`
- `fam.e4.boundary.files-vs-memory.claude`
- `fam.e4.boundary.memory-vs-notool.weekend-halt`
- `fam.e4.boundary.memory-vs-notool.tavily-credential`
- `fam.e4.memory.no-match-absent` (intended NO_MATCH, not a fake hit)
- `fam.e4.memory.approval-gate`

Train overlap of those families: **0**. Sufficiency: **PARTIAL** (distinct from train, not live gold).

## Phases D–H — other classes

WEB: HTTPS page/JSON retrieve wording (python.org, unicode.org, rust-lang.org, iana.org, npm status JSON) plus one labeled Tavily-401 search routing item. No literal class-name cue required. Tavily remains a provider failure.

SHA256: normal `eval4-heldout-keel`, short `xy`, longer natural sentence, missing argument, Wikipedia-distractor wording. Argument values do not overlap train.

NO_TOOL hard negatives: supplied-context “research”, conceptual documents, conceptual hashing, explain-not-retrieve.

RESEARCH: multi-source / disagreement items (CPython numbering, Unicode/ICU/CLDR, WHO vs CDC influenza, Debian vs Ubuntu cadence). Distinct from single-page WEB.

FILES: `docs/ENGINEERING_COMPLETION_STANDARD.md`, `CLAUDE.md`, EXP-004 design doc, Wave 8 dataset report. Distinct from V4 train paths.

## Phase I — hard boundary pairs

8 families (2 per required contrast), family-isolated so both sides of a pair stay in the same split:

| contrast | families |
|---|---|
| WEB vs RESEARCH | cpython (val), unicode (test) |
| FILES vs MEMORY | deploy-freeze (val), claude (test) |
| MEMORY vs NO_TOOL | weekend-halt (val), tavily-credential (test) |
| WEB vs NO_TOOL | rust-learn (val), iana-root (test) |

## Phases J–N — provenance, leakage, size, realism

| metric | value |
|---|---|
| final rows | 32 |
| validation / test | 16 / 16 |
| unique families | 24 |
| largest family share | 0.0625 (2/32) |
| REAL_RUNTIME | 0 |
| REAL_TEST | 25 |
| EVAL_SYNTHETIC | 7 |
| real/test row % | 78.12 |
| real/test family % | 70.83 |
| synthetic % | 21.88 |

All six classes ≥4. All six in validation and in test.

Train / EVAL-2 / EVAL-3 exact, normalized, and family overlap: **0**. EVAL-2 still 115. EVAL-3 still 13.

## Phase O — baselines (family-safe)

BoW trained **only** on frozen V4 train. Not trained on EVAL-4.

| baseline | validation | test |
|---|---|---|
| majority (NO_TOOL from train) | 0.1875 | 0.25 |
| random (1/6) | 0.1667 | 0.1667 |
| keyword | 0.6875 | 0.8125 |
| schema/rule | 0.4375 | 0.4375 |
| BoW linear | 0.875 | 0.75 |

Not flagged as obviously trivial (keyword/schema < 0.90; BoW < 0.95). Keyword on test is still high because several WEB items contain `https://`. That is a remaining cue, not a 1.00 n=4 artifact.

## Phases Q–S — materialization

Builder: `scripts/wrim-modular/build_tool_eval_4_candidate.py`  
Proofs: `scripts/wrim-modular/prove_tool_eval_4.py` (18/18) + `validator.json` (37/37)

Combined bundle: `f905036c4bafeed776de492f95e0fea1d60e4594e0c5ecf4e915ec19b697a1a2`

## Later training against this exam

EXP-004 was subsequently trained on frozen V4 train only (`WR-TOOL-EXP-004-RUN-000001`). EVAL-4 remained held out. Canonical test accuracy **0.125**; capability **NOT DEMONSTRATED**. This eval package was not overwritten.

## Stop (eval mission)

The eval mission itself did not start training. Production untouched. Git not committed. Promotion remains a separate Commander order (not granted).
