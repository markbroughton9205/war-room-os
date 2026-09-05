# WR-TOOL PARAMETER-ISOLATED EXPERIMENT 003 — DESIGN

Date: 2026-08-31  
Status: **EXECUTED.** Isolation **PASS**. Capability **NOT DEMONSTRATED**. Not promoted.

Do not treat this file as a license to start Experiment 004, r=4, or argument-head training.

## Primary question

Can the already-proven r=2 parameter-isolated architecture generalize across a broader, more realistic War Room tool surface?

**Answer from the executed run:** isolation yes; EVAL-2 generalization **no**. H1 not supported.

## Architecture (unchanged rank)

Held constant from Experiment 002:

- Parent: frozen WRIM-0 (`trainable_parameters=0`, 19,217,152)
- LoRA **r=2** on actual `layers.{0–17}.attn.q` and `attn.v` (**36,864** params, computed)
- Pooling: `assistant_boundary_last_token`
- Objective: classifier cross-entropy only
- Initialization: **fresh** LoRA + fresh 8-way head (not EXP-002 weights)
- No r=4, no MLP head, no full-weight training

Changed **one** scientific variable: **dataset / class space**.

| field | EXP-002 | EXP-003 (executed) |
|---|---|---|
| dataset | TOOL V2 88 / 3 classes | WR-TOOL-CURRICULUM-V3 / 8 classes |
| eval | TOOL-EVAL-1 (12) | WR-TOOL-EVAL-2 (115) + V3 family test (62) |
| head | Linear(256→3)=771 | Linear(256→8)=**2056** (computed) |
| LoRA | 36,864 | 36,864 (computed) |
| isolated trainable | 37,635 | **38,920** (computed) |
| EVAL-2 accuracy | n/a | **0.504** (below keyword 0.626) |

## Optimizer (documented before training)

Reuse EXP-002 AdamW: lr 1e-3, betas 0.9/0.999, eps 1e-8, wd 0.01, batch 8. Isolated trainable count almost unchanged; no sweep.

## Result (executed)

- core `max_abs_diff = 0`
- no adapter-created broad degeneration vs WRIM-0 baseline
- did **not** beat keyword / schema / BoW on EVAL-2
- RESEARCH collapsed on EVAL-2
- real-wording 2/13
- 94.3% synthetic — limitation not hidden
- modules **CANDIDATE**, ACTIVE `[]`

## Non-goals (still)

No Recovery-012, WRIM1-RUN-000003, LoRA r=4, EXP-002 overwrite, production deploy, live tool activation, argument-head training.

## Argument heads

Still not in this experiment. D-then-A remains the design recommendation **if** routing first succeeds on EVAL-2. Routing did not succeed; do not start D-then-A from this result.
