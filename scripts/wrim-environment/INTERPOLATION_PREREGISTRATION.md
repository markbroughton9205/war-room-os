# WRIM-1 Nebula Phase 3A — interpolation preregistration

Written **before any weight merge**. No optimizer. No training. No Stage 3.

Authorization: `PHASE3A_INTERPOLATION_ONLY`
Classification of merges: `TEST_ONLY_MERGE`
Phase 2 classification preserved: `G. INCONCLUSIVE`
Training authorization remains `OFF`.

## Selection rule (locked before interpolation)

Exactly one healthy step-50 run per nominal cell:

- NATURAL_BASELINE / 3e-5
- NATURAL_BASELINE / 2e-5
- BALANCED_GENESIS / 3e-5
- BALANCED_GENESIS / 2e-5

Metrics (equal weight):

1. `final_mean_wrim0_anchor_nll_delta`
2. `final_mean_kl`
3. `final_val_loss_corpus0`
4. `final_val_loss_corpus1`

For each cell, compute the cell median and sample standard deviation of each metric.
Standardized distance of run `i` to the cell median:

```
d_i = sqrt( sum_m  ((x_{i,m} - median_m) / s_m)^2  )
```

If `s_m == 0`, that term is 0.

Select `argmin d_i`. Ties: lowest seed, then lexicographic `run_id`.

Purpose: typical cell representative. Not the best single metric. Not cherry-picked.

## Merge definition

```
theta_merged(alpha) = (1 - alpha) * theta_candidate + alpha * theta_WRIM0
```

Alphas: `0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 1.0`

`alpha=0` is the candidate. `alpha=1` is WRIM-0.

No gradients. No AdamW. No logit ensembling.

Linear weight interpolation does **not** imply linear function interpolation.

## Endpoint rule

Tensor-hash identity:

- lerp(0) must equal the source candidate
- lerp(1) must equal WRIM-0

If either fails: write `INTERPOLATION_ENDPOINT_FAILURE.json` and stop. No approximate repair.

## Structured-output probe

Use existing canonical DIAGNOSTIC-0 `d0-json` / `json_valid_from` from `stage2_eval.py`.
Do not invent a new test suite.

## Historical binary

Compatibility metric only. Deterministic ≠ robust.
Primary continuous measures: WRIM0 anchor-NLL delta, KL, val_loss_corpus0, val_loss_corpus1.
