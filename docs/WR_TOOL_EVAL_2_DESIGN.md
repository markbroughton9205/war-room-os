# WR-TOOL-EVAL-2 — DESIGN

Date: 2026-08-31  
Status: **MATERIALIZED, EXCLUDE_FROM_TRAINING=true, NOT TRAINED**  
Identity: `WR-TOOL-EVAL-2`  
Path: `model-lab/eval-only/WR-TOOL-EVAL-2/`  
Does **not** overwrite `WRIM-1.1-CAP-EVAL-0` or `WRIM-1.1-TOOL-EVAL-1`.

## Purpose

A genuinely stronger held-out suite than TOOL-EVAL-1 (12 items, 3 classes) for the future r=2 Experiment 003 on V3’s 8-class space.

## Isolation

- No naive random split from V3.
- Hold out semantic/template families (`family_id`).
- Hold out argument values (eval payloads never appear in V3 gold args of length ≥ 6).
- Leak scan vs CAP-EVAL-0, TOOL-EVAL-1, and V3 training must be 0.

## Sections

| section | what it tests |
|---|---|
| TOOL_VS_NO_TOOL | TOOL-01 |
| TOOL_SELECTION | TOOL-02 |
| LOOKUP_NOTE_CONFUSION | hash/note/memory mixups |
| MULTI_TOOL_DISTRACTORS | TOOL-05 |
| ARGUMENT_EXTRACTION | TOOL-03/04 labeled args, not JSON emit |
| MISSING_ARGUMENTS | abstain + clarification |
| INVALID_ARGUMENT_TYPE | echo_int non-integers |
| UNSUPPORTED_TOOL | curl/wget/ftp/shell/smtp |
| UNAVAILABLE_TOOL | disabled_probe |
| AMBIGUOUS_INTENT | TOOL-07 |
| PARAPHRASE_GENERALIZATION | family-held-out wording |
| REAL_WORLD_WORDING | conversational |
| TOOL_RESULT_INTERPRETATION | TOOL-09 |
| FAILURE_RESULT_HANDLING | TOOL-10 |

## Scoring for a future run (not executed here)

Primary: macro F1 and per-class recall on semantic_class. Secondary: TOOL vs NO_TOOL, argument exact-match on EXPLICIT spans, family-held-out accuracy, real-wording subset, distractor subset. Generation JSON is **not** a scorer.

## Size

Target 100–250 if diversity exists. Materialized count is in `MANIFEST.json`.
