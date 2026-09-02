# WRIM-1.1 RECOVERY-007 — LOW-LR INTERLEAVED ENDURANCE REPORT

Date: 2026-08-31  
Authorization: Commander TEST_ONLY Recovery-007 only (not official WRIM-1.1, not Recovery-008, not production).

## FINAL VERDICT

**WRIM-1.1 RECOVERY-007 — PASS**

LOW-LR INTERLEAVED 150-STEP ENDURANCE — CONFIRMED  
WRIM-1.1 OFFICIAL CANDIDATE DESIGN — READY FOR COMMANDER REVIEW  
WRIM1-RUN-000002 — NOT YET AUTHORIZED  
ACTIVE MODEL — UNCHANGED  
PRODUCTION — UNCHANGED

---

## 1. EXPERIMENT ID

`TEST-WRIM1.1-RECOVERY-007`  
Artifacts: `model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-007/`  
Runner: `scripts/wrim1-training/run_recovery_experiment_007.py`

Started from **WRIM-0**, not from Recovery-006 step 50.

## 2. TEST_ONLY MARKERS

`TEST_ONLY=true`  
`NOT_PROMOTABLE=true`  
`NOT_OFFICIAL_WRIM_LINEAGE=true`  
`NOT_PRODUCTION=true`

Priors preserved: 001–006 and 004 forensics.

## 3. PYTHON / MLX ENVIRONMENT

Invoked: `/Users/markbroughton/Developer/war-room-os/.venv-wrim/bin/python`  
Python **3.12.14** arm64. MLX **0.32.2**. Device **`Device(gpu, 0)`**. Environment gate passed.

## 4. WRIM-0 PARENT SHA

`d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`

## 5. EXACT-LOAD PROOF

`max_abs_diff = 0.0`. File SHA match. Tensor-tree SHA match (`8d0c903bbcd63f709114c1b69bd2d1136a20e5558f39acd3ad11f403064678b9`). Before optimizer step. Checkpoint-0 reload matches WRIM-0.

## 6. TOKENIZER SHA

`47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7`

## 7. FIRST-50-STEP COMPARABILITY HASH / PROOF

`first50-comparability.json` **passed** before step 1.

| Check | Result |
|---|---|
| Packed train/mask/val vs 006 | **byte-identical** |
| Train SHA256 | `8066c56a3106fdf4e9f38b0c0337f448544ef303f28657b57f4de21d0a4c9b45` (match) |
| First-50 input schedule SHA256 | `b7b2e353…cf1315` (match) |
| First-50 LR SHA256 | match |
| Optimizer AdamW / 3e-5 / β / WD / clip | match |
| Cosine horizon | **150 unchanged** (not stretched) |

Step 25 and step 50 diagnostic gates vs Recovery-006: **passed**. Collapse, unique ratio, train loss, and sky text **exact**. KL/param L2 differ only at ~1e-11 (float noise).

## 8. GLOBAL DATA MIX

Same as 006/005. Mix gate passed. 0 leaks.

| Family | Percent |
|---|---:|
| WR-CORPUS-0 rehearsal | **30.0001%** |
| prose | **34.11%** |
| code | **25.61%** |
| JSON | **8.62%** |
| behavior | **1.66%** |

Packed train tokens 399,999. This run saw 150 × 8 × 512 = **614,400** tokens (~1.54 epochs of the pack). EOS 585 / 1.4625 per 1K.

## 9. LOCAL DATA MIX

150-step preflight passed. Rolling rehearsal ~30%. Longest 100% rehearsal-only: **0**. Longest non-rehearsal-only: **1** (step 16). First 50 seq_starts identical to 006. After wrap the interleaved stream repeats; that is duration, not a curriculum redesign.

## 10. PACKING PROOF

Contiguous 2048-token windows. Deficit FIFO unit-order interleave. No token permutation. Stream SHA matches 006.

## 11. CAUSAL-TARGET PROOF

12 batches, 96 rows: `y[t]==x[t+1]` mismatches **0**. Live training also gated; none occurred.

## 12. MASK PROOF

Unit-level behavior: **6650/6650** OK. 31 behavior units. 613 LM units full causal. Passed.

## 13. LEAKAGE RESULT

**0** known held-out hits. Retention windows frozen from Recovery-006 (themselves frozen from 005).

## 14. PEAK LR

**3e-5**. Never exceeded.

## 15. WARMUP

**25 steps** (identical to 006).

## 16. SCHEDULER SEMANTICS

Recovery-006 already used `linear_warmup_cosine_decay` with **total_steps = 150** and trained only 50. Recovery-007 **did not stretch** that horizon. It trained the full 150 steps already defined.

| Quantity | Value |
|---|---|
| Initial LR | 1.2e-6 |
| Peak | 3e-5 at warmup end |
| Floor | 3e-6 |
| LR at step 50 | 2.762e-5 |
| LR at step 100 | 1.265e-5 |
| LR at step 150 | 3.004e-6 (at floor) |

## 17. OPTIMIZER

AdamW; β1 0.9; β2 0.95; ε 1e-8; WD 0.1; clip 1.0. Fresh state from WRIM-0.

## 18. CONTEXT / BATCH

512 / 8. Unchanged.

## 19. PLANNED / COMPLETED STEPS

Planned **150**. Completed **150**. No automatic extension.

## 20. EARLY-STOP STATUS

**NO.** Collapse gate never fired. No NaN/Inf. No crash.

## 21. COLLAPSE TREND (FROZEN 13)

| Step | Collapse |
|---:|---|
| 0 | 2/13 (WRIM-0) |
| 25 | 2/13 |
| 50 | 2/13 (006 match) |
| 75 | **1/13** |
| 100 | 3/13 |
| 125 | 3/13 |
| 150 | **3/13** |

Near baseline (+1 vs WRIM-0 at the end). Expanded 87 stayed **1/87** at every full diagnostic.

## 22. UNIQUE-RATIO TREND

0.397 (0) → 0.349 (25) → **0.337 (50)** → 0.313 (75) → 0.332 (100) → 0.320 (125) → **0.310 (150)**.  
Did not hit the 0.5× WRIM-0 kill (~0.198). Slow decline after 50, not a cliff.

## 23. REPETITION TREND

Parent already has underscore/`tokenizer` runs. Those persist. No Recovery-005 `|` loops. At step 150 one QA probe shows a short `B` run; it is isolated, not suite-wide. Prompt-echo mean stayed 0.5. Top token: ` a` through ~10, then ` not`.

## 24–26. P(".") / P("|") / P("_")

P(.): 0.00101 → 0.00123 (25) → 0.00194 (50) → 0.00236 (150). Never argmax.  
P(|): 0.00051 → 0.00079 → 0.00113 → 0.00128. Not dominant.  
P(_): 0.00567 → 0.00633 → 0.00632 → 0.00612. Stable.

## 27. TRAIN-LOSS TREND

Finite. Domain oscillation continues. Rehearsal-heavy ~5.8–6.2; leftover-dominant later steps ~7.0–7.1 (step 150 train 7.09, dominant prose). No explosion.

## 28. VALIDATION-LOSS TREND

7.753 (0) → 7.548 (25) → 7.340 (50) → 7.231 (75) → 7.152 (100) → 7.116 (125) → **7.101 (150)**.  
Monotone decline, flattening as LR approaches floor.

## 29. SOURCE-LOCAL CE TREND

| Family | Mean CE 1–150 | Mean CE last 50 |
|---|---:|---:|
| rehearsal | 4.49 | 4.41 |
| behavior | 7.18 | 6.71 |
| prose | 7.33 | 7.10 |
| code | 7.52 | 7.29 |
| JSON | 7.80 | 7.36 |

The ~4.5 vs ~7.1–7.8 gap **remains** and is not treated as failure. Leftover CE drifted slightly **down** in the second 100 steps.

## 30. GLOBAL GRAD-NORM TREND

Step 1: 1.12. Typical 0.54–1.29. Step 50: 0.54. Step 100: 1.29 (clipped). Step 150: 0.89. Finite. Not 50× baseline.

## 31. CLIPPING EVENTS

**37** mild clips at limit 1.0 across 150 steps (006 had 24 in 50). No late blow-up.

## 32. KL TREND (WRIM-0 → current)

1008 frozen positions.

0 → 0.0125 (25) → **0.0253 (50)** → 0.0299 (75) → 0.0340 (100) → 0.0345 (125) → **0.0357 (150)**.

Almost flat from 100–150. Not 005’s 0.112 at step 30.

## 33. PARAMETER L2 TREND

0 → 1.09 (25) → **2.75 (50)** → 3.88 (75) → 4.53 (100) → 4.84 (125) → **5.00 (150)**.  
Second 50 steps added less drift than the first 50 (cosine decay). Relative drift at 150: **0.019**.

## 34. PER-LAYER COSINE TREND

Min cosine at 150: **layers.1 = 0.99973**. `tok_emb` **0.99987**. No layer cosine collapse.

## 35. EMBEDDING / OUTPUT-HEAD DRIFT

Tied. Embedding L2: 0 → 1.51 (50) → 2.67 (100) → **3.01 (150)**.

## 36. ENTROPY TREND

6.03 (0) → 6.31 (25) → 6.46 (50) → 6.44 (75) → 6.34 (100) → **6.30 (150)**. Finite. Slight retreat from the step-50 peak.

## 37. STEP-50 COMPARISON TO RECOVERY-006

| Metric | 006 | 007 |
|---|---|---|
| Collapse | 2/13 | **2/13** |
| Unique | 0.336538 | **0.336538** |
| Train loss | 5.948317 | **5.948317** |
| KL | 0.02534782 | 0.02534782 |
| Param L2 | 2.75169733 | 2.75169733 |
| Sky | identical | identical |

Recipe reproduction: **confirmed**.

## 38. STEP-75 HEALTH

Collapse **1/13**. Unique 0.313. KL 0.030. L2 3.88. Val 7.231. No early stop.

## 39. STEP-100 HEALTH

Collapse **3/13**. Unique 0.332. KL 0.034. L2 4.53. Val 7.152. Expanded still 1/87.

## 40. STEP-125 HEALTH

Collapse 3/13. Unique 0.320. KL 0.035. L2 4.84. Val 7.116. LR 5.8e-6.

## 41. STEP-150 HEALTH

Collapse **3/13**. Unique **0.310**. KL **0.036**. L2 **5.00**. Val **7.101**. LR at floor. Reload SHA match. Isolated QA `B` run; not suite-wide `|`/`B` language.

## 42. CHECKPOINT RELOAD

Saved: 0, 10, 20, 25, 30, 40, 50, 60, 75, 90, 100, 120, 125, 150.  
SHA match on all full-diag checkpoints. Fresh-load diagnostics at 0/50/100/150 reproduce live collapse counts (2/2/3/3). Step 0 = WRIM-0.

## 43. PYTHON / MLX CRASH STATUS

**No crash.** PID **53957**. Wall **842 s**. Single process. No silent relaunch.

## 44. STABLE LEARNING VS SLOWER FORGETTING

KL and param L2 keep rising after 50 but **decelerate** as cosine LR falls, then nearly plateau 100–150. Collapse moves 2 → 3 after step 90 and stays there. Unique ratio slowly declines (0.337 → 0.310) without a cliff. Leftover CE does not explode; it slightly improves late.

This is **slow drift under a decaying LR**, not 005-style catastrophic forgetting and not a proof of new capability. For a 150-step bounded endurance test it is acceptable.

## 45. CAPABILITY SIGNALS

Relative to WRIM-0: **unchanged to slightly regressed**.

- 13-probe collapse 2/13 → 3/13.  
- JSON still invalid.  
- Underscore/`tokenizer` runs remain (present at parent).  
- Some prose/EOS probes still emit short English.  
- Expanded 87: 1/87 throughout.

Do not declare a capability gain.

## 46. COMPARISON TO RECOVERY-005

005: peak 3e-4, same interleave, **FAIL at 30 (7/13)**, unique 0.248, `|`/`B` loops.  
007: peak 3e-5, **150/150 at 3/13**. Confirms 006: 3e-4 was the lethal variable for this mix.

## 47. COMPARISON TO RECOVERY-006

006: 50/50 PASS, 2/13, KL 0.025, L2 2.75.  
007: first 50 **reproduced**; then continued to 150 at 3/13, KL 0.036, L2 5.00. Endurance holds without 005-like collapse.

## 48. OFFICIAL CANDIDATE READINESS

**Design is ready for Commander review.** See `docs/WRIM1_1_OFFICIAL_CANDIDATE_TRAINING_DESIGN.md`.

**WRIM1-RUN-000002 is not authorized and was not launched.** 150 TEST_ONLY steps ≠ an official run. Promotion remains a later instruction.

## 49. PRODUCTION STATUS

`/Users/markbroughton/WarRoomNode01` not modified. No deploy, restart, SQL, or active model replacement.

## 50. GIT STATUS

No commit, push, merge, rebase, reset, or unrelated stash. Worktree remains dirty with prior WIP plus this TEST_ONLY experiment.

## 51. EXACT NEXT RECOMMENDATION

**STOP after Recovery-007.**

Do **not** launch Recovery-008.  
Do **not** launch `WRIM1-RUN-000002`.  
Do **not** promote.

Commander should review the official candidate design (LR 3e-5, interleaved 30% mix, evaluation/promotion gates). Execute only under a new authorization.

## 52. FINAL VERDICT

**WRIM-1.1 RECOVERY-007 — PASS**

---

WRIM-1.1 RECOVERY-007 — PASS  
LOW-LR INTERLEAVED 150-STEP ENDURANCE — CONFIRMED  
WRIM-1.1 OFFICIAL CANDIDATE DESIGN — READY FOR COMMANDER REVIEW  
WRIM1-RUN-000002 — NOT YET AUTHORIZED  
ACTIVE MODEL — UNCHANGED  
PRODUCTION — UNCHANGED

## NEXT STEPS FOR OPERATOR

1. Required environment changes — none.
2. Required SQL/migrations — none.
3. Restart requirements — none. Do not restart production.
4. Verification URLs/routes — none. Read this report, `docs/WRIM1_1_OFFICIAL_CANDIDATE_TRAINING_DESIGN.md`, and `model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-007/`.
5. Expected successful output — `completed_steps: 150`, `early_stop.stopped: false`, first-50 reproduction gates passed, collapse 3/13 at step 150.
6. Feature flags enabled/disabled — none.
7. What should visibly change in UI — nothing.
8. Safe rollback — delete only the Recovery-007 artifact directory and its reports. Do **not** delete 001–006. Do not change production weights.
