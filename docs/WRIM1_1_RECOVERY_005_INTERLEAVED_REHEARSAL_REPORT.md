# WRIM-1.1 RECOVERY-005 — INTERLEAVED REHEARSAL / TEMPORAL CURRICULUM REPORT

Date: 2026-08-31  
Authorization: Commander TEST_ONLY Recovery-005 only (not official WRIM-1.1, not Recovery-006, not production).

## FINAL VERDICT

**WRIM-1.1 RECOVERY-005 — FAIL**

INTERLEAVED MIXED-DOMAIN 50-STEP STABILITY — NOT CONFIRMED  
WRIM-1.1 FULL RUN — NOT READY  
ACTIVE MODEL — UNCHANGED  
PRODUCTION — UNCHANGED

---

## 1. EXPERIMENT ID

`TEST-WRIM1.1-RECOVERY-005`  
Artifacts: `model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-005/`

## 2. TEST_ONLY MARKERS

`TEST_ONLY=true`  
`NOT_PROMOTABLE=true`  
`NOT_OFFICIAL_WRIM_LINEAGE=true`  
`NOT_PRODUCTION=true`

Prior artifacts preserved: Recovery-001, 002, 003, 004, and Recovery-004 step-45 forensics.

## 3. PYTHON EXECUTABLE

Invoked: `/Users/markbroughton/Developer/war-room-os/.venv-wrim/bin/python`  
Resolved: Homebrew CPython 3.12.14 (`.../Python.framework/Versions/3.12/bin/python3.12`) via that venv.  
Not `/usr/bin/python3`. Not CommandLineTools 3.9.6.

## 4. PYTHON VERSION

3.12.14 (arm64)

## 5. MLX VERSION

0.32.2 (`mlx.core.__version__` / package metadata)

## 6. METAL DEVICE

`Device(gpu, 0)` — Metal available.

## 7. WRIM-0 SHA

`d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`

## 8. PARENT EXACT-LOAD PROOF

`max_abs_diff = 0.0`  
File SHA match. Tensor-tree SHA match (`8d0c903bbcd63f709114c1b69bd2d1136a20e5558f39acd3ad11f403064678b9`). Before optimizer step.

## 9. TOKENIZER SHA

`47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7`

## 10. TOTAL TRAINING TOKENS (PACKED STREAM)

399,999 packed train tokens (target 400,000; 1 token unfilled).  
This run consumed 30 steps × 8 × 512 = **122,880** tokens seen before early stop.

## 11–15. GLOBAL MIX (ACTUAL TOKEN ACCOUNTING)

Held Recovery-004 / 001-relative leftover. No material availability change; mix gate passed before training.

| Family | Tokens | Percent |
|---|---:|---:|
| WR-CORPUS-0 rehearsal | 120,000 | **30.0001%** |
| prose | 136,429 | **34.11%** |
| code | 102,450 | **25.61%** |
| JSON | 34,470 | **8.62%** |
| behavior | 6,650 | **1.66%** |

## 16. EOS COUNT / RATE

EOS count **585**  
EOS / 1K tokens **1.4625**  
BOS count 585 (existing wrap policy; no new BOS/EOS rule).

## 17. LEAKAGE HITS

**0** known held-out prompt hits. Training was allowed.

## 18. CONTIGUOUS-UNIT PROOF

Documents selected exactly as Recovery-004, then split into contiguous **2048-token** windows (584 source units → 644 windows). Concatenating each document’s windows in source order rebuilt the original token array.

## 19. TOKEN-ORDER PROOF

Within-unit token order: **UNCHANGED**  
Unit ordering: **INTERLEAVED** (deficit FIFO per family)  
No token-level permutation. `prove_recovery_packing.py` 8/8 including the new window-split test.

## 20. CAUSAL-TARGET PROOF

12 audited batches, 96 rows: `y[t]==x[t+1]` mismatches **0**.  
Live training also aborted on any causal mismatch; none occurred.

## 21. BEHAVIOR-MASK PROOF

Unit-level: **6650/6650** response-only mask tokens OK; 31 behavior units; 613 LM units full causal. **Passed.**  
Mixed-window mask counts remain observational (windows can include prior LM tokens before `<|assistant|>`).

## 22. PLANNED SOURCE-FAMILY ORDER (STEPS 1–50)

Preflight map written to `planned-step-source-map.json` **before** step 1. Dominant family alternates rehearsal/prose/code; **no** 12+ step single-family run. Longest rehearsal-only region: **0 steps**. Longest non-rehearsal-only: **1 step** (step 16). Scheduler preflight **passed**.

Example (first 10 planned = actual):

| Step | Dominant | Reh% | Prose% | Code% | JSON% | Beh% |
|---:|---|---:|---:|---:|---:|---:|
| 1 | wr_corpus_0 | 50.00 | 25.02 | 24.98 | 0.00 | 0.00 |
| 2 | prose | 13.21 | 42.07 | 17.04 | 27.69 | 0.00 |
| 5 | wr_corpus_0 | 50.00 | 12.91 | 17.58 | 19.51 | 0.00 |
| 16 | code | 0.00 | 34.40 | 52.15 | 13.45 | 0.00 |
| 25 | wr_corpus_0 | 50.00 | 27.03 | 22.97 | 0.00 | 0.00 |
| 30 | wr_corpus_0 | 50.00 | 23.58 | 13.53 | 12.89 | 0.00 |
| 35 | wr_corpus_0 | 50.00 | 28.10 | 15.92 | 5.98 | 0.00 |
| 45 | wr_corpus_0 | 50.00 | 19.58 | 10.79 | 19.63 | 0.00 |

Step 35/45 rows are planned only (run stopped at 30). They already show mixed leftover, unlike Recovery-004’s Austen-only 15–41.

## 23. ACTUAL PER-STEP LOCAL MIX

Matched the plan for steps 1–30 (`actual-step-source-map.json`). No 100% rehearsal step. Several ~50% rehearsal + leftover batches (window size 2048 × batch 8). Isolated 0% rehearsal steps: 16, 24 (and planned 48, not reached).

## 24. ROLLING 5-STEP REHEARSAL %

Completed windows (end step 5–30): **27.43–34.12%**, typically **30.00%**. No 0% or 100% 5-step binge.

## 25. ROLLING 10-STEP REHEARSAL %

Completed windows: **27.90–32.06%**, typically **30.00%**.

## 26. LONGEST CONSECUTIVE REHEARSAL-ONLY REGION

**0 steps** (no step with rehearsal ≥99%).

## 27. LONGEST CONSECUTIVE NON-REHEARSAL-ONLY REGION

**1 step** (step 16).

Recovery-004’s 15–41 = 100% Austen binge **did not recur**.

## 28. LR SCHEDULE

Peak **3e-4**. Warmup **25**. Cosine horizon **150**. Floor 10% (3e-5). Initial LR 1.2e-5. Unchanged vs Recovery-004. Not lowered or raised.

## 29. OPTIMIZER

AdamW; β1 0.9; β2 0.95; ε 1e-8; weight decay 0.1; grad clip 1.0. Fresh optimizer state.

## 30. PLANNED STEPS

50 (not 100 or 150). No automatic extension.

## 31. COMPLETED STEPS

**30**

## 32. EARLY STOP

**YES.** Step **30**. Reason: `collapsed probes materially exceed step-0` (2/13 → **7/13**).  
Also met the spirit of “broad symbol/letter loops” (`|` and `B` runs on multiple probes at 30). Finite loss. No NaN/Inf. No causal corruption. No leakage. No silent crash-resume.

## 33. COLLAPSE COUNT TREND (FROZEN 13)

| Step | Collapse |
|---:|---|
| 0 | 2/13 (WRIM-0 match; top ` a`) |
| 5 | 1/13 |
| 10 | 2/13 |
| 15 | 3/13 |
| 20 | 2/13 |
| 25 | **3/13** |
| 30 | **7/13** (stop) |
| 35–50 | not reached |

Expanded 87: 1/87 at 0, 1/87 at 10, **3/87** at 25.

## 34. UNIQUE-TOKEN RATIO TREND

0.397 (0) → 0.380 (5) → 0.310 (10) → **0.269 (15)** → 0.428 (20) → **0.377 (25)** → **0.248 (30)**.  
Deteriorated with behavior (not the 0.5× hard unique-ratio rule alone; collapse gate fired on probe count).

## 35. REPETITION TREND

Step 0: WRIM-0 baseline underscore/`tokenizer` runs (`symbol_run=true` at parent).  
Step 25: `|` loop on hello; colon/`B` on seq; hyphen loops on code.  
Step 30: many probes are `| | | …` or `B` runs. Not greedy `.` mode.

## 36–38. P(".") / P("|") / P("_")

P(.): 0.00101 → 0.00133 (10) → 0.00642 (25) → 0.00437 (30). Never argmax.  
P(|): 0.00051 → 0.00100 → 0.00195 → 0.00205. Not logit-dominant; **greedy `|` loops** anyway.  
P(_): 0.00567 → 0.00645 → 0.00598 → 0.00463. Not greedy argmax.

Top token: ` a` at 0–5; **` not` from step 10** (same drift family as 002–004, not `.`).

## 39. TRAIN-LOSS TREND

Oscillates with domain, not a single cliff:

- Rehearsal-heavy steps: ~4.2–5.7 (step 1: 6.25; step 20: **5.51**; step 25: **5.75**; step 30: **5.51**)
- Leftover-heavy switches: ~7.1–7.7 (step 2: 7.57; step 9: **7.75**; step 16: **7.65**)

Finite. Mean leftover CE stays high from step 1; this is domain mix, not a late surprise.

## 40. VALIDATION-LOSS TREND

7.753 (0) → 7.495 (10) → 7.161 (20) → 7.011 (25) → **6.846 (30)**. Still falling while generation collapsed. Not success.

## 41. PER-SOURCE LOSS (OBSERVATIONAL)

Mean CE on training tokens (steps 1–30):

| Family | Mean CE | Min | Max |
|---|---:|---:|---:|
| rehearsal (WR-CORPUS-0) | **4.67** | 3.76 | 8.22 |
| behavior | 7.02 | 5.56 | 7.98 |
| prose | 7.40 | 6.73 | 8.39 |
| code | 7.52 | 6.85 | 8.06 |
| JSON | 7.72 | 6.37 | 8.72 |

Leftover is ~3 nats harder than rehearsal throughout. Weighting was **not** changed from these values.

## 42. GRADIENT-NORM TREND

Step 1 global L2 **1.12**. Typical 0.50–1.34. Step 25 **0.50**. Step 30 **0.59**. Finite. Not 50× this-run baseline.

## 43. CLIPPING EVENTS

**10** events (limit 1.0): steps 1–6, 9, 11, 16, 19. Later steps unclipped. Mild; not an optimizer explosion.

## 44. KL(WRIM-0 || CURRENT)

Frozen 1008 positions. 0 → 0.027 (10) → 0.071 (20) → 0.091 (25) → **0.112 (30)**. Faster than Recovery-004’s ~0.077 at step 45. Observational; no universal KL kill switch.

## 45. ENTROPY

6.03 (0) → 6.46 (10) → 6.40 (25) → 6.15 (30). Finite.

## 46. GLOBAL PARAMETER DRIFT

L2 from WRIM-0: 0 → 1.69 (10) → 8.46 (25) → **10.95 (30)**. Already at Recovery-004’s step-45 drift (~10.78) **fifteen steps earlier**, after mixed-domain exposure.

## 47. PER-LAYER DRIFT

Step 30 cosine to WRIM-0: min **layers.1 = 0.99888**; `tok_emb` **0.99920**. No single-layer cosine collapse.

## 48. EMBEDDING / OUTPUT-HEAD DRIFT

Tied embedding/head. Embedding L2: 0 → 0.89 (10) → 5.48 (25) → **7.44 (30)** (004 was 7.01 at step 45).

## 49. SOURCE-TRANSITION FINDINGS

**22** dominant-family switches in 30 steps.

Largest train-loss **jumps** (~+1.3 to +1.8) are rehearsal → leftover (code/prose). Largest **drops** (~−1.7 to −1.8) are leftover → rehearsal.

Interleaving **did** convert Recovery-004’s one late domain re-entry into many small, reversible CE swings. Those swings did **not** keep language stable. Collapse arrived **during** mixed training, not after a 115k Austen binge.

## 50. STEP-35 COMPARISON VS RECOVERY-004

Recovery-004 step 35: **0/13**, unique **0.663**, train loss **4.31**, still **100% Austen**.  
Recovery-005: **did not reach 35**. At step 30 (already mixed): **7/13**, unique **0.248**, train loss **5.51**.  
004’s step-35 “health” is not a mixed-domain result. 005 never produced a healthier mixed step 35.

## 51. STEP-45 COMPARISON VS RECOVERY-004 (PRIMARY POINT)

Recovery-004 step 45: **4/13**, unique **0.514**, train loss **7.06**, KL ~0.077, after the novel ended.  
Recovery-005: **did not reach 45**. Stopped earlier and **worse** (7/13 at 30). Direct 45-vs-45 numbers do not exist because 005 failed first.

Closest mixed comparison: **step 25**

| | 004 | 005 |
|---|---|---|
| Local mix | still Austen binge | mixed (~50% rehearsal) |
| Collapse | **1/13** | **3/13** |
| Unique ratio | **0.591** | **0.377** |
| Train loss | ~4.3 | **5.75** |
| KL | lower than 005 | 0.091 |

## 52. CHECKPOINT RELOAD

Saved TEST_ONLY: 0, 10, 20, 25, 30. SHA match on reload for all five. Step 0 matches WRIM-0 tensor tree. Not official lineage.

## 53. PYTHON / MLX CRASH STATUS

**No crash.** PID **51229**. Wall **133 s**. Training stopped by diagnostic gate, not Metal abort. Continuity: single process, no silent reopen.

## 54. INTERLEAVING HYPOTHESIS ASSESSMENT

**Local rehearsal interleaving: CONFIRMED.**  
**50-step mixed-domain survival: NOT CONFIRMED.**

The Recovery-004 failure mode (100% rehearsal then abrupt leftover) was removed. WRIM-0 still did not survive 50 interleaved mixed steps at 3e-4. Interleaving is necessary to un-confound 004; it is **not** sufficient for stability at this LR/mix/capacity.

## 55. VS RECOVERY-001

001: 38.8% rehearsal as a long contiguous binge; healthy ~50 steps; collapse at 100 (6/13).  
005 is **worse by step 25** (3/13 vs 001’s 2/13 and unique 0.555). 001’s mid-run health was likely the same Austen binge 004 later proved.

## 56. VS RECOVERY-002

002: 15% rehearsal, peak 1e-4, stop 25 at **4/13**.  
005: 30% interleaved, 3e-4, stop 30 at **7/13**. Different variables; 005 is not a 002 retry. 005 failed later than 002 but from a worse probe count.

## 57. VS RECOVERY-003

003: 15% + 3e-4 + 35/35 mix, stop 25 at **11/13**, unique 0.216.  
005 is better than 003 at step 25 (3/13 vs 11/13) but still a FAIL and did not reach 50.

## 58. VS RECOVERY-004

Same global mix, LR, optimizer, tokenizer, parent, ctx, batch. Only temporal order changed.  
004 lived to 45 inside an Austen block, then died on leftover re-entry.  
005 saw leftover from step 1 and died at 30 on `|`/`B` loops.  
Conclusion: 004’s extra 15 steps were **not** mixed-domain robustness.

## 59. PRODUCTION STATUS

`/Users/markbroughton/WarRoomNode01` not modified. No deploy, restart, production SQL, or active model replacement.

## 60. GIT STATUS

No commit, push, merge, rebase, reset, or unrelated stash. Worktree remains dirty with prior unrelated WIP plus this TEST_ONLY experiment (uncommitted). 001–004 directories not overwritten.

## 61. EXACT NEXT RECOMMENDATION

Do **not** launch official WRIM-1.1 / `WRIM1-RUN-000002`.  
Do **not** auto-start Recovery-006.  
Do **not** raise rehearsal % as the next single variable.

Failure is associated with **repeated leftover-domain exposure and domain-switch CE swings**, not a missing 30% global rehearsal knob and not a unique LR cliff at step 42.

Commander-gated next TEST_ONLY (pick **one**):

1. **Lower peak LR** (e.g. 1e-4) **with this same interleaved mix** — asks whether 3e-4 is too fast once leftover is actually seen.  
2. **Longer contiguous windows** (still interleaved, still 30%) — asks whether 2048-token switches are too frequent.  
3. **Optimizer / weight decay / β2** — only after (1) or (2), still one variable.

Return to Commander.

## 62. FINAL VERDICT

**WRIM-1.1 RECOVERY-005 — FAIL**

---

WRIM-1.1 RECOVERY-005 — FAIL  
INTERLEAVED MIXED-DOMAIN STABILITY — NOT CONFIRMED  
WRIM-1.1 FULL RUN — NOT READY  
ACTIVE MODEL — UNCHANGED  
PRODUCTION — UNCHANGED

## NEXT STEPS FOR OPERATOR

1. Required environment changes — No operator action required. Keep using `.venv-wrim` for WRIM/MLX; do not switch to system Python 3.9.6.
2. Required SQL/migrations — No operator action required.
3. Restart requirements — No operator action required. Do not restart production.
4. Verification URLs/routes — none (no UI). Read this report and `model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-005/`.
5. Expected successful output — this experiment’s success bar was 50 mixed steps without collapse; that did **not** happen. Early stop at step 30, 7/13 collapsed.
6. Feature flags enabled/disabled — No operator action required. TEST_ONLY markers only.
7. What should visibly change in UI — nothing. Active model unchanged.
8. Safe rollback — delete only the `TEST-WRIM1.1-RECOVERY-005/` directory and this report if discarding the experiment. Do **not** delete Recovery-001–004 or 004 forensics. Do not restore or replace production weights.
