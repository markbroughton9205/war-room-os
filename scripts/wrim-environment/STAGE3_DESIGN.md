# WRIM1-RUN-000003 — Stage 3 design

Status: **READY_FOR_STAGE3_COMMANDER_REVIEW**
Stage 3 authorization: **NO**
Training authorization: **OFF**
Execution readiness: **NO**

This file is design only. It does not train, interpolate, promote, replace Qwen, implement Ra'el, push, or deploy.

Preserve Phase 2 = **G. INCONCLUSIVE** and Phase 3A = **E. MULTIPLE_FINDINGS**.

## Findings that bind this design

1. Lower peak LR reduced drift. At α=0, 3e-5 KL ~0.022 / displacement ~0.0077; 2e-5 KL ~0.014 / displacement ~0.0054. Stage 3 peak_lr = **2e-5**.
2. BALANCED_GENESIS is **not** proven superior. Do not claim it. Official rehearsal = **NATURAL_BASELINE**. Instrument genesis shares; treat extreme concentration as a review band, not a mid-run policy switch.
3. Both val streams improved vs WRIM-0 (`val0=8.890125`, `val1=7.971308`). Phase 2 is not demonstrated catastrophic forgetting.
4. Historical 32-token 6/6 scorer is deterministic and **not robust**. Compatibility only. Promotion must not depend primarily on that bit.
5. Authoritative continuous metrics: WRIM0_ANCHOR_NLL_DELTA, KL(WRIM-0 ‖ candidate), val_loss_corpus0, val_loss_corpus1.
6. Interpolation is useful and optional. Raw checkpoint evaluation is required. Merges are TEST_ONLY. Nothing auto-promoted. No logit ensembling.

## Why not a blind 1500-step run

Historical 1500 steps / 6,144,000 tokens is **not** supported by Phase 2 curves.

Phase 2 cosine was indexed to **50 steps** (warmup 25, then cosine over the remaining 25 to `min_lr = peak/10`). Stretching that family to 1500 steps would keep LR near peak through the first 50 steps. That is a **different recipe** than the measured 2e-5 cell. Do not treat it as a confirmation of Phase 2.

Preferred pattern: **STAGE3A confirmation, then STAGE3B continuation only if healthy.**

## STAGE3A — confirmation (required first)

Exact Phase 2 NATURAL / 2e-5 recipe, one official seed, expanded eval (once authored).

| Field | Value |
|---|---|
| Parent | WRIM-0 `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015` |
| Tokenizer | WR-TOKENIZER-0 `47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7` |
| Architecture | WRIM-G-20M-v1-option-A, 19,217,152, dense, unchanged |
| Precision | FP32, TF32 OFF |
| Batch | micro 8, accum 1, effective 8, seq 512, 4096 tokens/step |
| Optimizer | fresh AdamW, fused=False, betas (0.9, 0.95), eps 1e-8, wd 0.1, clip 1.0 |
| LR | peak 2e-5, warmup 25, cosine over **50** steps, min_lr 2e-6 |
| Steps / tokens | 50 / 204,800 |
| Packing | contiguous_unit, BOS=1, EOS=2, per_token_shuffle=false |
| Corpus | WR-CORPUS-0 30%, WR-CORPUS-1 70%, TOOL_USE 0%, no WR-CORPUS-ACTIVE, no 18% code cap, no adaptive replay |
| WR-CORPUS-1 mix | locked Stage 2 MIX (prose 34.1 / code 25.6 / json 8.6 / behavior 1.7) |
| Rehearsal | NATURAL_BASELINE |
| Seed | **3003** (new official data-order stream; not a Phase 2 grid seed) |
| Checkpoints | step 0 = parent pointer only; step 25 weights; step 50 weights + AdamW (for possible STAGE3B) |

STAGE3A is `TRAINING_ARTIFACT` until eval completes, then `EVALUATION_CANDIDATE`. It is never `PROMOTED_WRIM1` by this segment.

## STAGE3B — continuation (Commander-gated after STAGE3A)

Only if STAGE3A is `HEALTHY_FOR_CONTINUATION`.

Do **not** re-raise LR to 2e-5. Phase 3A showed 50 steps already produce interpolatable displacement. Re-peaking would ignore that.

| Field | Value |
|---|---|
| Start | STAGE3A step-50 weights + AdamW moments |
| LR | continue from STAGE3A terminal (~2e-6); cosine 2e-6 → 2e-7 over 200 steps |
| Steps / tokens | 200 / 819,200 |
| Cumulative if both complete | 250 steps / 1,024,000 tokens |
| Eval | every 50 continuation steps (global 100, 150, 250) |
| Checkpoints | weights at 100/150/250; AdamW only at 250 |

A later 1500-step (or re-peaked) run requires **new** Commander authorization after STAGE3A/B evidence. It is not this design.

## Expanded evaluation suite

Suite ID: `WRIM-EVAL-S3-000001`
Status: **DESIGNED_NOT_AUTHORED** (stems not written in this pass)
Size: 7 categories × 5 items = **35**, plus compatibility overlays (CAP-EVAL-0 six stems; DIAGNOSTIC-0 `d0-json`). Total with overlays in-range of 35–50.

Axes are separate. Do not reduce to one scalar.

- **A parent-behavior retention:** literary_prose, special_token_stability; plus WRIM0_ANCHOR_NLL_DELTA / KL on frozen WRIM-0 continuations.
- **B downstream adaptation:** factual_prose, code, instruction_following; plus val_loss_corpus1.
- **C generation stability:** long_form_continuity, special_token_stability; unique_ratio_256, entropy, max_token_run, period probability, special_rate_256.
- **D structured-output capability:** json_structured_output parse validity; `d0-json` remains compatibility (WRIM-0 is `json_valid=false`).

Historical 32-token binary on CAP-EVAL-0: **COMPATIBILITY_ONLY**.

Item specs live in `WRIM-EVAL-S3-000001.design.json`. Prompts must not be genesis slices (`UNMAPPED_NO_STEM_OVERLAP` for literary).

## WRIM-0 baseline (required before any Stage 3 training)

After stems are authored and hashed:

1. Load parent WRIM-0 only. Zero optimizer steps.
2. Run the full suite (32 and 256), val0, val1, special-token rates, fingerprints, structured parse flags.
3. Freeze NLL of WRIM-0 greedy continuations as the new anchor set (do not rewrite CAP-EVAL-0 frozen NLL SHA `43c57b52610cbdaf7a6edf4791b05e2d360936b3341a0b6ca1838d940dd27dfe`; add a sibling artifact).
4. Hash the baseline JSON. Stage 3 candidates compare only to that frozen file.

Cannot run in this pass: suite texts do not exist.

## Primary vs secondary metrics

Primary (promotion review): anchor-NLL delta, KL, val0, val1, per-category suite metrics, special_rate_256, collapse/repetition descriptors, JSON validity on the new JSON items, continuation fingerprints.

Secondary / compatibility: historical 32-token 6/6, unique_ratio_32, CAP-EVAL-0, `d0-json`.

## Validation plan

Log val_loss_corpus0 and val_loss_corpus1 separately. Never collapse to STAB-000001 mixed scalar.

Pre-run packer gates unchanged: corpus0 share 0.30±0.02, code share 0.256±0.01, tool-use 0, leakage 0.

Eval at STAGE3A 0/25/50 and STAGE3B 100/150/250. Full suite at 0, 50, 250 (and at any hard stop). Compact continuous metrics at intermediate checkpoints.

## Hard stops (abort the run; write ABORT.json; training OFF)

NaN/Inf, gradient corruption, tokenizer mismatch, parent mismatch, packing failure, eval leakage, checkpoint corruption, disk threshold, runtime corruption, DIAGNOSTIC-0 extreme repetition collapse, special-token takeover loop.

Do **not** hard-stop on a single literary 6/6→5/6 flip.

## Review bands (not invented promotion constants)

Derived from Phase 2 NATURAL 2e-5 cell at step 50:

- mean ΔNLL ~0.0885 (sd ~0.00831) → review if ΔNLL > mean + 2 sd ≈ **0.105**
- mean KL ~0.0141 (sd ~0.00186) → review if KL > mean + 2 sd ≈ **0.018**
- val0 / val1 must remain **below** WRIM-0 8.890125 / 7.971308; crossing parent val is `REVIEW_STOP`
- category-level: all 5 items in a category collapsed, or special_rate_256 >> frozen WRIM-0 rate → `REVIEW_STOP`
- STAGE3B: if a 50-step window adds more ΔNLL or KL than STAGE3A's entire 50-step delta → `REVIEW_STOP`

`HEALTHY_FOR_CONTINUATION` = no hard stop, inside review bands, both val streams still better than WRIM-0, Commander still must authorize STAGE3B.

`PASS` / `FAIL` / `REVIEW` for the official run:

- **FAIL:** hard stop, or parent SHA/tokenizer mismatch, or leakage.
- **REVIEW:** outside bands, interpolation non-monotonic on continuous metrics, suite category regression, binary cliff without continuous support.
- **PASS (candidate only):** STAGE3A and optional STAGE3B complete inside bands, raw+interpolated Pareto documented, state `PROMOTION_REVIEW`. Still not `PROMOTED_WRIM1`.

## Raw vs interpolated

At each retained healthy milestone (50, and 250 if STAGE3B runs):

1. Evaluate RAW weights.
2. If displacement is in the Phase 2 2e-5 neighborhood (~0.005) or larger but finite, run post-hoc WRIM-0 lerp at α = 0, 0.1, 0.2, 0.3, 0.4, 0.5, 1.0. Reuse the Phase 3A evaluator. No optimizer. No logit ensemble.
3. Pareto-minimize ΔNLL, KL, val0, val1. Report best retention, best corpus1, best balanced. Do not promote interpolation automatically. Do not assume interpolation must be used.

## Candidate-state lifecycle

`TRAINING_ARTIFACT` → `EVALUATION_CANDIDATE` → `PROMOTION_REVIEW` → Commander decision → `PROMOTED_WRIM1` or `REJECTED`.

No automatic move to `PROMOTED_WRIM1`. Qwen replacement is a separate authorization even after `PROMOTED_WRIM1`.

## Qwen / Ra'el / sparse experts

Qwen remains `THIRD_PARTY_MODEL_RUNNING_LOCALLY` for the entire experiment.
Do not call Stage 3 WRIM-1 Ra'el. Ra'el = NOT_IMPLEMENTED.
Dense baseline only.

## Storage retention (do not delete in this pass)

KEEP: Phase 2 `experiment_summary.json` / `GRID_COMPLETE.json`; Phase 3A `INTERPOLATION_SUMMARY.json` / selection / eval JSON; four representative Phase 2 checkpoints used in 3A; WRIM-0 parent; any ABORT artifacts.

OPTIONAL_DELETE_AFTER_COMMANDER_APPROVAL: 36 non-selected Phase 2 runs (~28.4 GB), dominated interpolation merged safetensors (~1.1 GB; keep JSON), superseded accum=4 SKEWED_BASELINE (~2 GB inspect first).

Estimated reclaimable: **~29.5–32 GB**. Delete nothing now.

## Preconditions before execution can even be requested

1. Commander accepts this design.
2. Author and hash `WRIM-EVAL-S3-000001` stems (implementation pass, not this file).
3. Freeze WRIM-0 expanded-suite baseline.
4. Separate Commander authorization: `TRAINING_AUTHORIZATION=STAGE3A_ONLY` (not this pass).

Until then: `STAGE3_EXECUTION_READINESS = NO`.
