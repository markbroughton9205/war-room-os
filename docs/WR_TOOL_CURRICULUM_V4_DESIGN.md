# WR-TOOL-CURRICULUM-V4 — DESIGN

Date: 2026-08-31  
Identity: `WR-TOOL-CURRICULUM-V4`  
Status: **CANDIDATE MATERIALIZED** as `WR-TOOL-CURRICULUM-V4-CANDIDATE`. **NOT FINAL. NOT TRAINED.**  
Candidate path: `model-lab/manifests/wr_tool_curriculum/design/WR-TOOL-CURRICULUM-V4-CANDIDATE/`  
Review: `docs/WR_TOOL_CURRICULUM_V4_MATERIALIZATION_REVIEW.md`

Do **not** start Experiment 004 from this file.

## Class space decision (applied to the candidate only; V3 unchanged)

**OPTION B:** operator-facing `NO_TOOL`, `WEB`, `MEMORY`, `FILES`, `RESEARCH` plus bounded-utility `SHA256`.

`LOOKUP_NOTE` and `ECHO_INT` remain historical/test-only. They are not in V4 train shards.

## What exists today (after MEMORY auth-unblocked collection + V4 candidate)

| item | count |
|---|---|
| V4 candidate included rows | 33 |
| Routing gold | 27 (18 REAL_RUNTIME + 9 REAL_TEST) |
| MEMORY gold | **2** (VALID BUT NARROW: 3 store rows / 2 unique decree texts) |
| SYNTHETIC in V4 shards | 0 |
| V3 (preserved, not imported) | 441 |

## Provenance constraints (enforced in candidate)

- No UNKNOWN/REJECT gold
- No EVAL-2 / EVAL-3 exact, normalized, or family leakage into included rows
- Replays are not independent examples
- Synthetic stays out of V4 gold (not unlabeled)
- MEMORY not cloned or paraphrased to inflate count

## Argument extraction

Out of scope. Routing labels store argument maps for future use; no extractor training.

## Held-out evaluation (EVAL-4 candidate)

Internal V4 val/test remain 4/3 (scarcity split of the curriculum candidate). They were **not** inflated.

A separate exam package exists: `WR-TOOL-EVAL-4-CANDIDATE` (`model-lab/manifests/wr_tool_evals/WR-TOOL-EVAL-4-CANDIDATE/`, `EXCLUDE_FROM_TRAINING=true`). n=32, val/test 16/16, all six classes in both splits. Report: `docs/WR_TOOL_EVAL_4_HELD_OUT_EXPANSION_REPORT.md`.

Train shard of this V4 candidate is frozen and was not grown.

## Experiment 004

**NOT READY FOR EXPERIMENT 004 REVIEW** as a train-start decision. Candidate exists for Commander review. Head/loader would need `Linear(256→6)`. Do not train. EVAL-4 strengthens the exam but does not add live MEMORY gold or review the 6-class loader.

