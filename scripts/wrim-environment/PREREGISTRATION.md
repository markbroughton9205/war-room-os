# WRIM-1 Nebula controlled stability — PREREGISTRATION

Status: PHASE 2 PRIMARY GRID AUTHORIZED AS `PHASE2_GRID_ONLY`.
Phase 0 = PASS / REVIEWED. Phase 1 = `PHASE1_GREEDY_DETERMINISM_PASS`.
This file is updated **before optimizer step 1**.

Experiment ID: `WRIM1-NEBULA-STABILITY-GRID-000001`
Classification: TEST_ONLY / CONTROLLED_EXPERIMENT
NOT authorized: interpolation, Stage 3, WRIM1-RUN-000003, promotion, Qwen replacement, Ra'el, sparse experts, extra arms, push, deploy.

## Phase 0 truths (preserve)

- All six CAP-EVAL-0 retention prompts are authored synthetic literary stems.
- `RETENTION_ITEM_TO_GENESIS_SOURCE_MAPPING = UNMAPPED_NO_STEM_OVERLAP`
- Do not invent per-item source-document mappings.
- Do not regress "item NLL vs that item's source-document rehearsal share".
- Do not assign `cap0-ret-02` to Alice or any genesis document.
- Do not describe a failed probe as source-document starvation.
- Allowed question: does overall WR-CORPUS-0 rehearsal concentration/distribution affect preservation of generic literary continuation behavior?

## Phase 1 facts (preserve)

- Harness artifact SHA256: `4e89902ac8adbb3fce45a705ea50a8056dc3279cbc06c2ecb2de2870d6dcc9b5`
- Verdict: `PHASE1_GREEDY_DETERMINISM_PASS`
- 10/10 greedy repeats: identical 32-token and 256-token token IDs and fingerprints
- Historical binary 6/6 every repeat
- No measured evaluator noise exists under greedy WRIM-0 (`NUMERIC_REPEATABILITY = PASS`, per-item abs/rel spread 0.0)
- Training uncertainty is therefore assessed through within-cell **data-order / packing** variation, not evaluator noise and not random model-initialization variance
- Dropout = 0. Parent weights identical across runs.

## WRIM0_ANCHOR_NLL (not gold-label NLL)

Frozen artifact: `wrim0-reference-nll.json`
SHA256: `43c57b52610cbdaf7a6edf4791b05e2d360936b3341a0b6ca1838d940dd27dfe`

Targets are WRIM-0's own frozen greedy 32-token continuations.

```
wrim0_anchor_nll_delta(item) =
  NLL_candidate(fixed_WRIM0_generated_reference_tokens(item))
  - NLL_WRIM0(fixed_WRIM0_generated_reference_tokens(item))
```

Positive delta: candidate assigns less probability to WRIM-0's historical continuation.
Negative delta: candidate assigns more probability to WRIM-0's historical continuation.

This is a **parent-behavior retention / parent-anchor metric**.
Do not call this ground-truth continuation NLL, gold-label NLL, or objective quality loss.

Frozen WRIM-0 baselines:

- `val_loss_corpus0` = 8.890125
- `val_loss_corpus1` = 7.971308
- historical retention = 6/6

## Historical vs 256-token metrics

- `unique_ratio_32` = HISTORICAL_COMPATIBILITY_METRIC (STAB-000001 greedy 32, token-id unique ratio, threshold 0.35, collapse + single-period). Keep exact scorer.
- `unique_ratio_256` = DESCRIPTIVE_CONTINUOUS_METRIC. **No 0.35 binary gate.** WRIM-0 itself can be < 0.35 at 256 tokens.
- Continuation identity is token-ID SHA256 / fingerprints. Equal unique ratios do not imply equal continuations.

## KL secondary metric (no binary threshold)

```
KL(WRIM-0 || candidate)
```

Teacher-forced on the frozen WRIM-0 32-token reference positions.
Implementation: stable `log_softmax` on both models; `KL = mean_t sum_i p0_i * (log p0_i - log q_i)`.
Continuous secondary distribution-drift metric. **No invented KL cutoff.**

## No invented NLL/KL cutoffs

Do not invent pass/fail thresholds for anchor-NLL or KL.
Historical 6/6 → 5/6 is `RETENTION_WARNING` for this diagnostic grid, not an automatic stop.

## Superseded accum=4 runs

`SKEWED_BASELINE / 3e-5 / 1337` and `7331`: SUPERSEDED, ACCUM4, EXCLUDED_FROM_PRIMARY_GRID, NOT_COMPARABILITY_EVIDENCE, NOT_PROMOTION_CANDIDATE. Keep files. Do not aggregate into Phase 2.

Denied terminology/config: `SKEWED_BASELINE`, `gradient_accumulation=4` or `8`, 12-run superseded grid, 18% code cap, flat LR, 0% replay, L2-SP, LoRA, freezing, adaptive replay.

## Identity

- Parent: WRIM-0 (`d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`)
- Tokenizer: WR-TOKENIZER-0 (`47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7`)
- Architecture: WRIM-G-20M-v1-option-A, unchanged, dense, 19,217,152 parameters, FP32, TF32 off
- Stage 3 / WRIM1-RUN-000003: NOT AUTHORIZED
- Promotion, Qwen replacement, Ra'el, sparse experts, push, deploy: DENIED

## Phase 2 invariants

- `gradient_accumulation = 1`
- `micro_batch = 8`
- `effective_batch = 8`
- Sequence length 512
- Maximum 50 optimizer steps
- `tokens_per_step = 4096`
- `max_tokens_per_run = 204800`
- TOOL_USE = 0, WR-CORPUS-ACTIVE = 0
- WR-CORPUS-0 = 30%, WR-CORPUS-1 = 70%
- WR-CORPUS-1 family mix FIXED (Stage 2 MIX: prose 34.1 / code 25.6 / json 8.6 / behavior 1.7)
- Hard pre-run: `abs(realized_code_share - 0.256) <= 0.01`, `abs(realized_corpus0_share - 0.30) <= 0.02`, tool-use share == 0, leakage == 0
- Fresh AdamW every run: betas (0.9, 0.95), eps 1e-8, weight_decay 0.1, grad_clip 1.0
- LR schedule family pinned: warmup 25 steps, cosine after warmup; only peak LR changes (`3e-5` vs `2e-5`); `min_lr = peak/10`
- Packing: contiguous unit packing, BOS=1 / EOS=2, no per-token shuffle
- Replicate factor: **DATA-ORDER / PACKING VARIANCE** (seeds 1001–1010). Not random init variance.

## Factors (Phase 2 primary grid)

1. Rehearsal policy
   - `NATURAL_BASELINE`: STAB-000001-style natural WR-CORPUS-0 source-selection. Do not force the historical 86.5% Alice share; measure realized concentration.
   - `BALANCED_GENESIS`: deterministic deficit-balanced WR-CORPUS-0 source selection. Global 30% rehearsal unchanged. WR-CORPUS-1 mix unchanged.
2. Peak LR: `3e-5` vs `2e-5`
3. Data-order seeds: `1001` … `1010`

Total: 2 × 2 × 10 = 40 TEST_ONLY runs.

## Predeclared directional questions

1. Does NATURAL_BASELINE + 3e-5 reproduce STAB-000001-like behavioral warnings?
2. Does BALANCED_GENESIS change anchor-NLL retention relative to NATURAL_BASELINE?
3. Does 2e-5 reduce anchor-NLL/KL drift relative to 3e-5?
4. Does rehearsal-policy effect depend on LR?
5. Does realized genesis concentration correlate with generic literary retention?

Do not call STAB-000001 robustly reproduced unless a clear majority of the NATURAL_BASELINE + 3e-5 cell supports it.
n=10 provides engineering uncertainty estimates. Do not present publication-grade significance claims.
If policy × LR interaction remains uncertain, say so. Absence of an obvious interaction is not proof of no interaction.

## Realized rehearsal instrumentation

At every eval: tokens per genesis document, shares, normalized Shannon entropy, Gini, maximum exposure gap.
These are document-level rehearsal statistics only. Because probes are synthetic, do not perform per-item source-document regression.

## Validation

Log separately, never collapse:

- `val_loss_corpus0` (upstream/genesis-side)
- `val_loss_corpus1` (downstream/adaptation-side)

STAB-000001 mixed val_loss remains historical truth only.

## Interpolation

Designed only. **Do not execute** in Phase 2. Requires a separate Commander authorization after the Phase 2 summary.

## Hard-stop

Any run hard-stop writes `ABORT.json` and **stops the entire grid**. Do not continue to the next run. `TRAINING_AUTHORIZATION` returns to OFF for Commander review.

Retention 6/6 → 5/6 is warning-only for this diagnostic experiment and does not alter future promotion gates.
