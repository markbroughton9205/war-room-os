# WRIM-1.1 RECOVERY-008 — LR-SCHEDULE HORIZON ISOLATION REPORT

Date: 2026-08-31  
Authorization: Commander TEST_ONLY Recovery-008 only. Not official WRIM-1.1. Not Recovery-009. Not WRIM1-RUN-000003. Not promotion. Not production. Not git commit/push.

## FINAL VERDICT

**WRIM-1.1 RECOVERY-008 — FAIL**

LR-SCHEDULE-HORIZON FIX — NOT SUFFICIENT  
WRIM1-RUN-000003 — NOT READY  
ACTIVE MODEL — WRIM-0  
PRODUCTION — UNCHANGED

---

## 1. EXPERIMENT ID

`TEST-WRIM1.1-RECOVERY-008`  
Runner: `scripts/wrim1-training/run_recovery_experiment_008.py`  
Artifacts: `model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-008/`

Started from **WRIM-0**. Did **not** resume WRIM1-RUN-000002 step 100.

## 2. TEST_ONLY MARKERS

`TEST_ONLY=true`  
`NOT_PROMOTABLE=true`  
`NOT_OFFICIAL_WRIM_LINEAGE=true`  
`NOT_PRODUCTION=true`

Priors preserved: Recovery-001–007, WRIM1-RUN-000001, WRIM1-RUN-000002.

## 3. PYTHON / MLX ENVIRONMENT

Invoked: `/Users/markbroughton/Developer/war-room-os/.venv-wrim/bin/python`  
Python **3.12.14** arm64. MLX **0.32.2**. Device **`Device(gpu, 0)`**. Environment gate passed.

## 4. PARENT SHA + EXACT-LOAD PROOF

SHA: `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`  
`max_abs_diff = 0.0`. File SHA match. Tensor-tree SHA match (`8d0c903bbcd63f709114c1b69bd2d1136a20e5558f39acd3ad11f403064678b9`). Before optimizer step 1. Not a Recovery parent. Not an official-000002 resume.

## 5. TOKENIZER SHA

WR-TOKENIZER-0 `47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7`

## 6. CURRICULUM IDENTITY / HASH

`WR-CORPUS-1.1-CAPABILITY-CANDIDATE`  
686,070 tokens. Design content SHA `4c760d0e4f90b06c2685369da38c5c8b742f1a814f2e19d1b7f2b34ab5a4a974`.  
Packed `train.npy` SHA `d098ddce732d1fd77ec64e75ab3979250f846cfd0f57d1fbb3f9065743645291` — **byte-identical** to WRIM1-RUN-000002 (arrays and masks equal). Curriculum was identity-checked, not redesigned.

## 7. EVAL IDENTITY / HASH

`WRIM-1.1-CAP-EVAL-0`  
Suite SHA `f27dd64bcc245e228a8e4f18bfd95fcd7d0ee7c32cfdee5d8d40519fd1c1406d`

## 8. ACTUAL-STREAM LEAK RESULT

**0 hits.** Stream leak scan passed. Example leak 0. Training was allowed.

## 9. FIRST-100-STEP DATA COMPARABILITY PROOF

**PASS** before step 1.

| Check | Result |
|---|---|
| Packed train/mask vs 000002 | byte-identical |
| First-100 schedule SHA256 | `3128f0d2f4145796ff325dce724132d2abea516cac5acf2206054448a5dd9dd3` (match) |
| seq_starts / family / local mix | 0 mismatches / 100 steps |
| Seed / batch / ctx | 20260830 / 8 / 512 |

Only intended difference after that: LR schedule.

## 10. PACKING PROOF

Contiguous 2048-token windows. Deficit interleave. Unit-order-only (1444 windows). No token-level shuffle. Split preserves tokens. PASS.

## 11. CAUSAL-TARGET PROOF

`y[t]==x[t+1]` mismatches: **0**. Audit passed (12 batches).

## 12. MASK PROOF

PASS. Supervised response-only after `<|assistant|>` (115,883 mask tokens ok, 0 bad). LM units full causal 898/898. Prompt masked 71,026. Supervised targets 44,857.

## 13. TOOL-TARGET PROOF

PASS. 84 tool units with `<tool_call>` after assistant; 0 prompt-span tool calls; 0 masked-tool failures.

## 14. GLOBAL CURRICULUM COMPOSITION

| Family | Tokens | Percent |
|---|---:|---:|
| prose | 212,058 | 30.9091% |
| WR-CORPUS-0 rehearsal | 180,000 | 26.2364% |
| code | 178,129 | 25.9637% |
| supervised | 115,883 | 16.8908% |

Unchanged vs WRIM1-RUN-000002.

## 15. OPTIMIZER

AdamW. β1=0.9 β2=0.95 ε=1e-8 weight decay 0.1 clip 1.0. Fresh optimizer state. Same as 000002 except scheduler horizon.

## 16. CONTEXT / BATCH

Context 512. Batch 8. Tokens per step 4096.

## 17. EXACT LR FORMULA

Peak `3e-5`. Warmup 25. Cosine horizon **150** (Recovery-007). Floor `3e-6`. After step 150: **hold floor**. No restart. No stretch to 502.

```
if step < 25:
    lr = 3e-5 * (step+1)/25
elif step <= 150:
    progress = min(1, (step-25)/(150-25))
    cosine = 0.5 * (1 + cos(pi * progress))
    lr = 3e-5 * (0.1 + 0.9 * cosine)
else:
    lr = 3e-6
```

Implemented as `lr_at_step(min(step, 150), 150, 3e-5, 25, 0.1)`.  
Pre-run proof: matches Recovery-007 through step 149/150; constant floor for 150–249. `matches_recovery_007_through_150=true`.

Diagnostic rows report the LR of the **completed update** (index `step-1`).

## 18. LR AT KEY STEPS

| Index / completed update | LR |
|---|---|
| warmup end (index 24–25) | **3.00e-5** |
| 50 (index 50) | 2.74e-5 |
| 75 | 2.07e-5 |
| **100 (index 99, applied at completed step 100)** | **1.27e-5** |
| 125 | 5.58e-6 |
| 149 / 150 | ~3.00e-6 / 3.00e-6 |
| 200 / 249 | 3.00e-6 (planned; not reached) |

WRIM1-RUN-000002 completed-step 100 LR: **2.84e-5** (still near peak on a 502-step cosine).

## 19. PLANNED / COMPLETED STEPS

Planned **250**. Completed **120 / 250**. Tokens seen **491,520**. Wall ~1089 s.

## 20. EARLY-STOP RULE (DOCUMENTED BEFORE STEP 1)

File: `collapse-stop-rule.json`.

Official 000002 used `collapse_gate_004`: stop if `collapsed_probes >= step0 + 2` (fired at 4/13). Recovery-007 survived 3/13. WRIM-0 itself is 2/13 with residual underscore noise, so isolated +2 can fire on two noisy probes.

Recovery-008 **hard stop** (not silently weakened):

- NaN/Inf, crash, causal/mask/leak/checkpoint corruption  
- collapse ≥ 6/13  
- unique-ratio < 0.5× step-0  
- new period-run or pipe/underscore-run degeneration  
- symbol argmax (`.` / `|` / `_`) with rising collapse  
- P(symbol) ≥ 0.15  
- prompt-echo +0.4  
- grad L2 > 50×  
- collapse ≥ step0+2 **and** corroborating loop/run evidence  

Isolated +1/+2 probe flips without loops do **not** stop.  
Step 100: stop if official-like (collapse ≥ 4 **and** underscore/`-lab` loops).

## 21. EARLY-STOP STATUS

**FIRED at step 120.**  
Reason: `collapsed probes exceed step-0 with corroborating loop/run evidence`.  
Gate-004 suppressions: **none**. Step-100 decision had continued.

## 22. COLLAPSE TREND

| Step | Collapse |
|---:|---:|
| 0 | 2/13 |
| 10 | 2/13 |
| 20–90 | 1/13 |
| **100** | **2/13** |
| 110 | 2/13 |
| **120** | **4/13** (stop) |

Official 000002: 2 → 1 → 1 → **4/13 at 100**.

## 23. UNIQUE-RATIO TREND

Step 0: 0.397. 25: 0.377. 50: 0.375. 75: 0.462. **100: 0.430**. 120: 0.404.  
Official step 100: **0.346**. No 0.5× WRIM-0 unique-ratio kill.

## 24. REPETITION TREND

WRIM-0 sky already has underscore residue. 008: underscore_run 25 (step 0) → 0 through much of 25–90 → **14 at 100** → **26 at 120**. `-lab` loops appeared in sky at step 50 then receded, then underscore loops returned. Step 120 sky: ` not been a\n_not__________________________` — same class as official 000002 step 100.

## 25. P(".") / P("|") / P("_") TREND

P(".") rose slowly 0.0010 → ~0.0025. P("|") 0.0005 → ~0.0011. P("_") stayed ~0.005–0.006 (not dominant). Top token at 100/120: `" not"` (not `.`/`|`/`_`).

## 26. TRAIN-LOSS TREND

Step 1: 6.70. 25: 7.69. 50: 6.35. 75: 5.66. **100: 5.79**. 110: 6.29. **120: 7.20**. Finite throughout. Loss rose into the stop.

## 27. SOURCE / FAMILY CE TREND

Step 1: rehearsal 5.73 / prose 7.74 / code 7.85 / supervised 7.63.  
Step 100: rehearsal 4.60 / prose 6.86 / code 7.68 / supervised 7.03.  
Step 120 (no rehearsal in that batch): prose 6.87 / code 7.65 / supervised 7.05.  
Rehearsal CE improved; leftover/supervised stayed high. Domain gap remains.

## 28. GLOBAL GRAD TREND

Finite. Step 1: 0.69. 25: 1.29 (clip). 100: 0.76. 120: 1.03 (clip). No 50× explosion.

## 29. CLIP EVENTS

**23** events. First step 2. Last step 120. Clip limit 1.0.

## 30. KL TREND

KL(WRIM-0 ‖ current): 0 → 0.017 (25) → 0.034 (50) → 0.036 (75) → **0.038 (100)** → 0.039 (120).  
Official step 100: **0.042**.

## 31. PARAMETER L2 TREND

0 → 1.11 (25) → 2.74 (50) → 3.88 (75) → **4.54 (100)** → 4.82 (120).  
Official step 100: **5.28**.

## 32. PER-LAYER DRIFT

At 100, layer cosines to WRIM-0 remain ≥ 0.99977. Embedding L2 2.71 vs official 3.23. Tied output head = embedding. Slow, broad drift; not a single-layer blow-up.

## 33. ENTROPY TREND

Step 0: 6.03. 25: 6.32. 50: 6.46. 75: 6.34. 100: 6.25. 120: 6.19. No entropy collapse to a spike.

## 34. STEP-100 COMPARISON TO WRIM1-RUN-000002

| Metric | Recovery-008 | Official 000002 |
|---|---|---|
| Actual LR | **1.27e-5** | **2.84e-5** |
| Collapse | **2/13** | **4/13** |
| Unique ratio | 0.430 | 0.346 |
| KL | 0.038 | 0.042 |
| Param L2 | 4.54 | 5.28 |
| Grad L2 | 0.76 | 0.73 |
| Train loss | 5.79 | 5.74 |
| Cap-eval | **18/86** | **19/86** |
| Retention | **6/6** | **5/6** |
| Language sky | underscore residue, collapse 2 | underscore/`-lab` loops, collapse 4 |
| Decision | **continue** | **hard stop** |

Step 100 was **materially better** on the official failure mode. That is why training continued.

## 35. STEP-150 RESULT

**Not reached.** Cosine floor hold was never tested.

## 36. STEP-200 RESULT

**Not reached.**

## 37. STEP-250 RESULT

**Not reached.**

## 38. CAPABILITY EVAL STEP 0

**18 / 86** (matches WRIM-0 baseline).  
LANG 7/8, INSTRUCT 3/12, JSON 0/10, CODE 0/8, WR 1/12, EVIDENCE 0/12, TOOL 0/10, CORRECTION 1/8, RETENTION 6/6.

## 39. CAPABILITY EVAL STEP 100

**18 / 86**. Same families as step 0 (no movement). Inference only.  
Official 000002 at 100 was 19/86 (LANG 8/8, WR 2/12, RETENTION 5/6). 008 did not pick up those two extra passes; it also did not lose retention.

## 40–42. CAPABILITY EVAL STEPS 150 / 200 / 250

Not run (early stop).

## 43. FAMILY-LEVEL CAPABILITY DELTAS

Step 0 → 100: **all zeros**. No P0 meaningful lift. No retention regression on this suite.

## 44. RETENTION TREND

Held-out family 6/6 at 0 and 100. KL/L2 rising slowly (see §§30–31). Official 000002 dropped retention to 5/6 at the failed step 100.

## 45. CHECKPOINT RELOAD RESULTS

Reload SHA match **ok** for steps 0, 25, 50, 75, 100. Early-stop bundle written at 120 (complete). TEST_ONLY. Not promoted.

## 46. CRASH STATUS

No Python/MLX crash. No NaN/Inf. PID recorded. Runtime stable.

## 47. LR-HORIZON HYPOTHESIS ASSESSMENT

**NOT SUFFICIENT.**

The stretched 502-step cosine **did** keep 000002 near peak LR at step 100 (2.84e-5 vs 1.27e-5) and 000002 failed there. Recovery-008 was healthier at that same data step. That supports “horizon was a confound.”

It is **not** sufficient: the **same** underscore / `_not_` loop class returned at **step 120** (4/13) while still on the Recovery-007 decay curve (LR ~6.9e-6, well below official’s step-100 LR). The capability packed stream still destabilizes language in the same neighborhood of exposure (~100–120 steps, ~0.4M–0.5M tokens).

## 48. CAPABILITY-CURRICULUM ASSESSMENT

**Stronger suspect.** Same mix, masks, order, and parent as 000002. Short-horizon decay delayed but did not prevent the loop mode. Capability scores did not move. Rehearsal CE fell; leftover/supervised CE stayed high. Do not automatically change rehearsal % or architecture in this authorization.

## 49. OFFICIAL SCHEDULE RECOMMENDATION (DESIGN ONLY)

Do **not** treat `cosine total_steps = 502` as a proven-stable 3e-5 exposure.  
Do **not** treat Recovery-007’s 150-step cosine + floor as a drop-in fix for this capability pack.  
Do **not** authorize WRIM1-RUN-000003 from this result.  
If a later official run is designed: keep peak ≤ 3e-5, do not stretch a 150-step cosine across 502, and separately investigate curriculum/objective conflict. That investigation is **not** started here.

## 50. PRODUCTION STATUS

`/Users/markbroughton/WarRoomNode01` not touched. WRIM-0 SHA unchanged. WRIM1-RUN-000001 and WRIM1-RUN-000002 registries untouched. No deploy, restart, SQL, or active-model replacement.

## 51. GIT STATUS

Inspect only. No commit, push, merge, rebase, reset, or clean.

## 52. EXACT NEXT RECOMMENDATION

Return these results to Commander.  
**Do not start** Recovery-009, WRIM1-RUN-000003, promotion, or WRIM-1.2.  
Active model remains WRIM-0.

## 53. FINAL VERDICT

**WRIM-1.1 RECOVERY-008 — FAIL**

---

## NEXT STEPS FOR OPERATOR

1. Required environment changes — **No operator action required.**
2. Required SQL/migrations — **No operator action required.**
3. Restart requirements — **No operator action required.** Do not restart production.
4. Verification URLs/routes — **No operator action required.** Evidence is under `model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-008/` and this report.
5. Expected successful output — This experiment **FAIL**ed. Expected PASS would have been 250/250 without loop collapse.
6. Feature flags enabled/disabled — **No operator action required.**
7. What should visibly change in UI — **Nothing.** TEST_ONLY; production UI unchanged.
8. Safe rollback instruction if needed — **No operator action required.** WRIM-0 remains the parent. Delete only the TEST-WRIM1.1-RECOVERY-008 directory if discarding TEST_ONLY artifacts; do not delete WRIM-0 or official 000002.
