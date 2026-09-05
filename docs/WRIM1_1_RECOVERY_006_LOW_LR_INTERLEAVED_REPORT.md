# WRIM-1.1 RECOVERY-006 — LOW-LR INTERLEAVED MIXED-DOMAIN REPORT

Date: 2026-08-31  
Authorization: Commander TEST_ONLY Recovery-006 only (not official WRIM-1.1, not Recovery-007, not production).

## FINAL VERDICT

**WRIM-1.1 RECOVERY-006 — PASS**

LOW-LR INTERLEAVED 50-STEP STABILITY — CONFIRMED  
WRIM-1.1 FULL RUN — NOT YET AUTHORIZED  
ACTIVE MODEL — UNCHANGED  
PRODUCTION — UNCHANGED

---

## 1. EXPERIMENT ID

`TEST-WRIM1.1-RECOVERY-006`  
Artifacts: `model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-006/`  
Runner: `scripts/wrim1-training/run_recovery_experiment_006.py`

## 2. TEST_ONLY MARKERS

`TEST_ONLY=true`  
`NOT_PROMOTABLE=true`  
`NOT_OFFICIAL_WRIM_LINEAGE=true`  
`NOT_PRODUCTION=true`

Prior artifacts preserved: Recovery-001, 002, 003, 004, 004 step-45 forensics, and Recovery-005.

## 3. PYTHON EXECUTABLE / VERSION

Invoked: `/Users/markbroughton/Developer/war-room-os/.venv-wrim/bin/python`  
Resolved: Homebrew CPython **3.12.14** (`.../Python.framework/Versions/3.12/bin/python3.12`) via that venv.  
Architecture: **arm64**.  
Not `/usr/bin/python3`. Not CommandLineTools 3.9.6.

## 4. MLX VERSION / DEVICE

MLX **0.32.2**. Device **`Device(gpu, 0)`**. Metal available. Environment gate **passed**.

## 5. WRIM-0 SHA

`d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`

## 6. EXACT PARENT-LOAD PROOF

`max_abs_diff = 0.0`  
File SHA match. Tensor-tree SHA match (`8d0c903bbcd63f709114c1b69bd2d1136a20e5558f39acd3ad11f403064678b9`). Before optimizer step. Checkpoint-0 reload matches WRIM-0.

## 7. TOKENIZER SHA

WR-TOKENIZER-0: `47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7`

## 8. TOTAL TRAIN TOKENS

Packed stream: **399,999** (target 400,000; 1 token unfilled). Identical to Recovery-005.  
This run consumed 50 steps × 8 × 512 = **204,800** tokens seen.

## 9. GLOBAL DATA MIX

Exact Recovery-005 accounting (stream identity vs 005: train/mask/val **equal**). Mix gate passed.

| Family | Tokens | Percent |
|---|---:|---:|
| WR-CORPUS-0 rehearsal | 120,000 | **30.0001%** |
| prose | 136,429 | **34.11%** |
| code | 102,450 | **25.61%** |
| JSON | 34,470 | **8.62%** |
| behavior | 6,650 | **1.66%** |

EOS **585** / **1.4625** per 1K. Same wrap policy as 005. No new BOS/EOS rule.

## 10. LOCAL 5-STEP / 10-STEP MIX

Preflight vs Recovery-005: **0 mismatches** on seq_starts, dominant family, and family percents for 50 planned steps (`local-mix-vs-005.json`).

Rolling 5-step mean rehearsal **29.88%**. Rolling 10-step mean **29.89%**. Completed 5-step windows track ~30% (end-step 50 window = **30.00%**). Same as Recovery-005 behavior.

## 11. LONGEST REHEARSAL-ONLY RUN

**0 steps** (no ≥99% rehearsal step). Longest non-rehearsal-only: **1 step** (step 16). Identical to Recovery-005.

## 12. PACKING PROOF

Contiguous 2048-token windows. Split preserves tokens. Interleave is unit-order-only (deficit FIFO). No token permutation. Train stream byte-identical to Recovery-005.

## 13. CAUSAL-TARGET PROOF

12 audited batches, 96 rows: `y[t]==x[t+1]` mismatches **0**. Live training also aborted on any causal mismatch; none occurred.

## 14. MASK PROOF

Unit-level behavior response-only: **6650/6650** OK; 31 behavior units; 613 LM units full causal. **Passed.** Mixed-window mask counts remain observational.

## 15. LEAK HITS

**0** known held-out prompt hits. Frozen 005 retention windows equal (`equal_to_005: true`). Expanded 87 frozen from 005.

## 16. PEAK LR

**3e-5** (exactly 10× lower than Recovery-005’s 3e-4). Never exceeded.

## 17. WARMUP

**25 steps** — repo-consistent equivalent of Recovery-005, so step-25/30 sit at the same schedule **shape** at 10× scale. Commander’s preferred warmup of 10 was **not** used, to avoid a second schedule variable.

## 18. EXACT LR SCHEDULE

Type: linear warmup + cosine decay. Horizon **150** (train 50 only). Floor ratio **0.1**.

| Quantity | Value |
|---|---|
| Initial LR (step 0) | **1.2e-6** |
| Warmup | 25 |
| Peak | **3e-5** (first reached at step 24 index / train step 25) |
| Floor | **3e-6** |
| Schedule horizon | 150 |
| Step 25 (0-based 24) | 3e-5 |
| Step 30 | 2.993e-5 |
| Step 50 | 2.762e-5 |

Every-step LR is in `lr-schedule.json` (planned) and `metrics.jsonl` (actual). Max planned/actual ≤ 3e-5.

## 19. OPTIMIZER

AdamW; β1 **0.9**; β2 **0.95**; ε **1e-8**; weight decay **0.1**; grad clip **1.0**. Fresh optimizer state. Unchanged vs Recovery-005 except `base_lr`.

## 20. CONTEXT / BATCH

Context **512**. Batch **8**. Unchanged.

## 21. PLANNED / COMPLETED STEPS

Planned **50**. Completed **50**. No automatic extension.

## 22. EARLY STOP

**NO.** Gate did not fire. No NaN/Inf. No causal corruption. No Python/MLX crash.

## 23. COLLAPSE-COUNT TREND (FROZEN 13)

| Step | Collapse |
|---:|---|
| 0 | **2/13** (WRIM-0 match; top ` a`) |
| 5 | 2/13 |
| 10 | 2/13 |
| 15 | 2/13 |
| 20 | 1/13 |
| 25 | **2/13** |
| 30 | **2/13** |
| 35 | 2/13 |
| 40 | 3/13 (peak; recovered) |
| 45 | 2/13 |
| 50 | **2/13** |

Expanded 87: **1/87** at every full diagnostic (0, 10, 25, 30, 35, 40, 45, 50). Unique on expanded stayed ~0.71–0.75.

## 24. UNIQUE-RATIO TREND

0.397 (0) → 0.406 (5) → 0.418 (10) → 0.373 (15) → 0.416 (20) → **0.349 (25)** → **0.351 (30)** → 0.353 (35) → 0.305 (40) → 0.322 (45) → **0.337 (50)**.

Did not hit the 0.5× WRIM-0 unique-ratio kill (that would be ~0.198). Dip at 40 recovered by 50.

## 25. REPETITION TREND

Step 0 already has WRIM-0 underscore/`tokenizer` runs (`symbol_run=true` at parent).  
Through 50: sky stays short English then inherited `_` runs — **not** Recovery-005’s `|` / `B` loops. Prompt-echo mean stayed **0.5**. Greedy top token: ` a` through step 10, then ` not` from step 25 (same family as 002–005, not `.` / `|`).

## 26. P(".") TREND

0.00101 (0) → 0.00103 (10) → 0.00123 (25) → 0.00135 (30) → 0.00194 (50). Never argmax. Never ≥0.15.

## 27. P("|") TREND

0.00051 (0) → 0.00055 (10) → 0.00079 (25) → 0.00090 (30) → 0.00113 (50). Not logit-dominant. No greedy `|` loops.

## 28. P("_") TREND

0.00567 (0) → 0.00579 (10) → 0.00633 (25) → 0.00635 (30) → 0.00632 (50). Stable. Not greedy argmax.

## 29. TRAIN-LOSS TREND

Oscillates with domain, same pattern as 005, **without** late explosion:

- Step 1: 6.25 (rehearsal-dominant)
- Step 10: 6.15
- Step 25: 6.07
- Step 30: 6.11
- Step 50: 5.95

Finite throughout. Leftover-heavy steps remain ~7.1–7.7; rehearsal-heavy ~4.3–5.6.

## 30. VALIDATION-LOSS TREND

7.753 (0) → 7.710 (10) → 7.548 (25) → 7.495 (30) → 7.449 (35) → 7.407 (40) → 7.371 (45) → **7.340 (50)**.  
Monotone decline. Unlike 005, validation still falling **while generation stayed at baseline collapse count**.

## 31. REHEARSAL LOSS

Mean CE on rehearsal tokens (steps with rehearsal present): **4.58** (min 3.76, max 8.18 on a near-zero-rehearsal mixed row). Typical rehearsal-heavy CE ~4.3–5.0.

## 32. LEFTOVER / NEW-DOMAIN LOSS

Prose/code/JSON/behavior remain ~3 nats harder than rehearsal from step 1. Lower LR **did not close** the ~4.6 vs ~7.5–8.3 gap. It **did** stop that gap from producing 005-style language collapse by step 30.

## 33. PER-SOURCE LOSSES (STEPS 1–50)

| Family | Mean CE | Min | Max |
|---|---:|---:|---:|
| rehearsal (WR-CORPUS-0) | **4.58** | 3.76 | 8.18 |
| behavior | 7.22 | 6.60 | 7.72 |
| prose | 7.69 | 7.08 | 8.39 |
| code | 7.76 | 6.72 | 8.44 |
| JSON | 8.35 | 7.57 | 8.96 |

Vs Recovery-005 (steps 1–30): rehearsal 4.67 / prose 7.40 / code 7.52 / JSON 7.72 / behavior 7.02. Same conflict; 006 simply ran longer at smaller updates.

## 34. GLOBAL GRAD-NORM TREND

Step 1 L2 **1.12**. Typical 0.54–1.61. Step 25 **0.64**. Step 30 **0.86**. Step 50 **0.54**. Finite. Not 50× this-run baseline.

## 35. PER-LAYER GRAD-NORM SUMMARY

Largest share is `tok_emb` then `layers.0` at every sampled step (1 / 25 / 30 / 50). Example step 50: tok_emb 0.45, layers.0 0.27, layers.17 0.05. No single-layer explosion.

## 36. CLIPPING EVENTS

**24** events at limit 1.0 (mild, grads 1.02–1.61). Spread across the 50 steps; not a late blow-up. Recovery-005 had 10 clips in 30 steps. Same clip limit; more steps and similar grad scale.

## 37. KL-TO-WRIM-0 TREND

Frozen 1008 positions (same windows as 005).

0 → 0.00052 (10) → **0.0125 (25)** → **0.0184 (30)** → 0.0222 (35) → 0.0235 (40) → 0.0243 (45) → **0.0253 (50)**.

Recovery-005 was already **0.091 at 25** and **0.112 at 30**. 006 at step 50 is still ~4× below 005 at step 25.

## 38. ENTROPY TREND

6.03 (0) → 6.09 (10) → 6.31 (25) → 6.39 (30) → 6.46 (50). Finite. Slightly rising; no collapse to a delta spike.

## 39. PARAMETER-DRIFT TREND

Global L2 from WRIM-0: 0 → 0.18 (10) → **1.09 (25)** → **1.47 (30)** → **2.75 (50)**. Relative drift at 50: **0.0104**.

Recovery-005: 8.46 at 25, **10.95 at 30**. 006 moved ~7–8× less by the 005 failure point.

Per-layer cosine to WRIM-0 at 50: min **layers.1 = 0.99991**; `tok_emb` **0.99997**. No layer cosine collapse.

## 40. EMBEDDING / OUTPUT-HEAD DRIFT

Tied embedding/head. Embedding L2: 0 → 0.088 (10) → 0.544 (25) → 0.752 (30) → **1.51 (50)**. 005 was **7.44 at step 30**.

## 41. CHECKPOINT RELOAD

Saved TEST_ONLY: **0, 10, 20, 25, 30, 35, 40, 45, 50**. SHA match on reload for all eight diagnostic-aligned checkpoints plus step 20. Step 0 matches WRIM-0. Not official lineage.

## 42. PYTHON / MLX CRASH STATUS

**No crash.** PID **52194**. Wall **452 s**. Single process. No silent reopen.

## 43. STEP-25 COMPARISON VS RECOVERY-005

| | Recovery-005 | Recovery-006 |
|---|---|---|
| Peak LR | 3e-4 | **3e-5** |
| Local mix | identical interleaved | identical |
| Collapse | **3/13** | **2/13** |
| Unique ratio | 0.377 | 0.349 |
| Train loss | ~5.75 | 6.07 |
| KL | 0.091 | **0.0125** |
| Param L2 | 8.46 | **1.09** |
| Generation | already degrading | baseline-like |

006 is healthier on collapse, KL, and drift. Unique is slightly lower than 005 at 25 but without 005’s subsequent crash.

## 44. STEP-30 COMPARISON VS RECOVERY-005

| | Recovery-005 | Recovery-006 |
|---|---|---|
| Collapse | **7/13** (early stop) | **2/13** (continued) |
| Unique ratio | **0.248** | **0.351** |
| Generation | `\|` / `B` loops | no new symbol language |
| KL | 0.112 | **0.0184** |
| Param L2 | 10.95 | **1.47** |
| Train loss | 5.51 | 6.11 |

This is the decisive comparison. Same curriculum, 10× lower peak LR, 005 dies; 006 does not.

## 45. STEP-50 RESULT

**50/50 steps completed.** Collapse **2/13** (same as WRIM-0). Unique **0.337**. KL **0.025**. Param L2 **2.75**. Val loss **7.340**. Checkpoints reload. No early stop.

The model is **not** smarter. JSON still invalid. Underscore/tokenizer runs remain (parent already had them). Stability bar met.

## 46. LEARNING-RATE HYPOTHESIS ASSESSMENT

**Strongly supported.** Reducing peak LR from 3e-4 to 3e-5 on the **same** interleaved mix let WRIM-0 survive 50 mixed-domain steps. Interleaving alone (005) was not enough; **interleaving + 3e-5** was enough for this bounded recipe.

Not proven: that 3e-5 is optimal, that it scales to the official 1893-step run, or that leftover CE can be reduced without new variables.

The ~4.6 vs ~7.5 domain-loss gap **remains**. Lower LR reduced **behavioral damage** from that gap; it did not remove the objective conflict.

## 47. COMPARISON VS RECOVERY-001

001: higher effective rehearsal binge, peak 3e-4, healthy ~50 then collapse at 100 (6/13).  
006: genuine mixed 30% interleaved, **3e-5**, **50/50 at 2/13**. 006 is the first recovery run to finish a planned 50 mixed steps without the collapse gate.

## 48. COMPARISON VS RECOVERY-002

002: 15% rehearsal, peak **1e-4**, stop 25 at **4/13**.  
006: 30% interleaved, peak **3e-5** (lower than 002), **2/13 at 25 and 50**. Different mix; 006 is not a 002 retry. Combined with 005, LR scale looks more important than 002’s 1e-4 once leftover is actually interleaved.

## 49. COMPARISON VS RECOVERY-003

003: 15% + 3e-4 + 35/35 mix, stop 25 at **11/13**.  
006 at 25 is **2/13** vs 003’s 11/13. 006 reached 50; 003 did not.

## 50. COMPARISON VS RECOVERY-004

004: same global mix as 006, peak 3e-4, lived to 45 **inside a 100% Austen block**, then died on leftover.  
006: same mix **interleaved**, peak 3e-5, mixed from step 1, **finished 50**. 004’s extra life was not mixed-domain robustness; 006 is.

## 51. COMPARISON VS RECOVERY-005

Only intended primary training variable: **peak LR 3e-4 → 3e-5**. Mix, interleave (2048, deficit FIFO), optimizer, β, WD, ctx, batch, tokenizer, parent, EOS, masks: held. Packed streams **byte-identical**. Local 50-step map **identical**. Retention windows **frozen from 005**.

005: FAIL at 30 (7/13).  
006: PASS at 50 (2/13).

## 52. PRODUCTION STATUS

`/Users/markbroughton/WarRoomNode01` not modified by this experiment. No deploy, restart, production SQL, or active model replacement.

## 53. GIT STATUS

No commit, push, merge, rebase, reset, or unrelated stash. Worktree remains dirty with prior unrelated WIP plus this TEST_ONLY experiment (uncommitted). 001–005 directories not overwritten.

## 54. EXACT NEXT RECOMMENDATION

**STOP after Recovery-006.**

Do **not** launch Recovery-007.  
Do **not** launch official WRIM-1.1 / `WRIM1-RUN-000002`.  
Do **not** promote. Do **not** replace the active model.

Low-LR interleaved **50-step** stability is confirmed for this recipe only. That is not authorization for a full continued-pretrain.

Return to Commander. If a later TEST_ONLY is authorized, pick **one**:

1. **Longer run at the same 3e-5 interleaved recipe** (ask whether 50-step health holds toward 100+).  
2. **Official-scale step count still TEST_ONLY** at 3e-5 — only with a new authorization.  
3. **Objective-conflict / leftover CE** (source-weighted loss) — only after deciding 50-step stability is enough evidence on LR.

Do not raise rehearsal % first. Do not change β2/WD in the same run as a longer horizon.

## 55. FINAL VERDICT

**WRIM-1.1 RECOVERY-006 — PASS**

---

WRIM-1.1 RECOVERY-006 — PASS  
LOW-LR INTERLEAVED 50-STEP STABILITY — CONFIRMED  
WRIM-1.1 FULL RUN — NOT YET AUTHORIZED  
ACTIVE MODEL — UNCHANGED  
PRODUCTION — UNCHANGED

## NEXT STEPS FOR OPERATOR

1. Required environment changes — none. WRIM Python remains `/Users/markbroughton/Developer/war-room-os/.venv-wrim/bin/python`.
2. Required SQL/migrations — none.
3. Restart requirements — none. Do not restart production.
4. Verification URLs/routes — none (no UI). Read this report and `model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-006/`.
5. Expected successful output — experiment-summary `completed_steps: 50`, `early_stop.stopped: false`, collapse 2/13 at step 50.
6. Feature flags enabled/disabled — none.
7. What should visibly change in UI — nothing. Active model unchanged.
8. Safe rollback — delete only the `TEST-WRIM1.1-RECOVERY-006/` directory and this report if discarding the experiment. Do **not** delete Recovery-001–005 or 004 forensics. Do not restore or replace production weights.
