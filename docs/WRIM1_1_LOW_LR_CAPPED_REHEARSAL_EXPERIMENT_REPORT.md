# WRIM-1.1 LOW-LR / CAPPED-REHEARSAL EXPERIMENT REPORT

Date: 2026-08-30  
Authoritative repo: `/Users/markbroughton/Developer/war-room-os`  
Production: `/Users/markbroughton/WarRoomNode01` — **not modified**  
Git: **no commit, no push**

## BINARY VERDICT

**WRIM-1.1 LOW-LR RECOVERY EXPERIMENT — FAIL**

Rehearsal was actually capped at **15.0%**. Peak LR was **1e-4**. The model did **not** survive 50 corrected steps. Hard early stop at **step 25** when collapsed probes rose from **2/13 to 4/13**. Official WRIM1-RUN-000002 was **not** started.

---

## 1. EXPERIMENT ID

`TEST-WRIM1.1-RECOVERY-002`  
Artifacts: `model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-002/`  
Did **not** overwrite `TEST-WRIM1.1-RECOVERY-001`.

## 2. TEST_ONLY STATUS

`TEST_ONLY=true` / `NOT_PROMOTABLE=true` / `NOT_OFFICIAL_WRIM_LINEAGE=true` / `NOT_PRODUCTION=true`

## 3. WRIM-0 SHA

`d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`

## 4. WRIM-0 EXACT LOAD RESULT

`max_abs_diff = 0.0`. Tensor-tree SHA `8d0c903bbcd63f709114c1b69bd2d1136a20e5558f39acd3ad11f403064678b9` matches parent. Step-0 checkpoint SHA equals WRIM-0.

## 5. PRIOR EXPERIMENT REFERENCE

`TEST-WRIM1.1-RECOVERY-001` — FAIL (early stop step 100, `|`/`_` mode, not `.`). Healthy window 25–50. Peak LR 3e-4. Rehearsal actual 38.79%.

## 6. REHEARSAL TARGET %

**15.0%** of 400,000 target tokens → **60,000** tokens.

## 7. REHEARSAL ACTUAL TOKENS

**60,000**

## 8. REHEARSAL ACTUAL %

**15.0%** (≤15.5% gate passed; training allowed)

## 9. REHEARSAL CAP METHOD

Deterministic `unit_id` order on clean WR-CORPUS-0 documents (Alice/held-out doc dropped). Take whole documents while they fit. Truncate the last document to a **contiguous prefix** ending in EOS. Never permute tokens. 1 truncated unit. 4 clean docs available; 2 selected.

## 10. TOTAL EXPERIMENT TOKENS

**400,000** train / **840,182** val (contiguous, frozen val order)

## 11. PROSE %

**52.45%** (209,790 tokens)

## 12. CODE %

**22.39%** (89,560) — equal to the prior experiment’s code share cap; not increased.

## 13. JSON %

**8.50%** (34,000)

## 14. BEHAVIOR %

**1.66%** (6,650) — 31 examples, response-only mask unchanged.

## 15. EOS COUNT

**679** (train stream)

## 16. EOS RATE

**1.6975 per 1K** (prior repaired 1.283; not a regression to ~30 EOS)

## 17. HELD-OUT LEAK HITS

**0**. 68 eval-infra records excluded. Alice WR-CORPUS-0 doc dropped.

## 18. CONTIGUOUS PACKING RESULT

`prove_recovery_packing.py` **7/7 PASS** (added rehearsal-cap proof). `epoch_stream` remains identity.

## 19. SHUFFLE RESULT

Unit-order shuffle only. Intra-unit token order preserved.

## 20. MASK RESULT

Unchanged: raw LM full causal; behavior masked through `<|assistant|>`.

## 21. PEAK LR

**1e-4** (not 3e-4, not 3e-3)

## 22. LR SCHEDULE

Initial (step 0): **1e-5**  
Warmup: **10** steps to 1e-4  
Cosine to floor **10%** of peak = **1e-5**  
At stop (step 25): LR ≈ **7.54e-5**

## 23. OPTIMIZER

Fresh AdamW. betas (0.9, 0.95), eps 1e-8, wd 0.1, clip 1.0. Not inherited from 001 or WRIM-1.

## 24. PLANNED STEPS

**50**

## 25. COMPLETED STEPS

**25**

## 26. EARLY STOP

**YES** — `collapsed probes materially exceed step-0` at step 25 (2/13 → 4/13). Did not continue to 50.

## 27. STEP-0 COLLAPSE COUNT

**2 / 13**. Argmax ` a`. P(`.`)≈0.00101. Sky starts ` a`. Matches WRIM-0 / RECOVERY-001 step-0. Training was allowed.

## 28. STEP-10 COLLAPSE COUNT

**2 / 13**

## 29. STEP-25 COLLAPSE COUNT

**4 / 13** (early stop)

## 30. STEP-50 COLLAPSE COUNT

**not reached**

## 31. LANGUAGE OUTPUTS

Step 0 `The sky is`: ` a` then tokenizer-underscore (WRIM-0-like).  
Step 10: ` not been a end of the` then underscores. Literary probes still word-like.  
Step 25: mixed words (`said the Queen`) and `-lab` / backtick / underscore junk. **Not** period runs. **Not** `|` runs.

## 32. PROMPT ECHO

**0.50** at 0 / 10 / 25. Unchanged.

## 33. P(".") TREND

0.00101 → 0.00128 → 0.00355. Never argmax.

## 34. P("|") TREND

0.00051 → 0.00111 → 0.00229. Not dominant.

## 35. P("_") TREND

0.00567 → 0.00658 → 0.00589. Not greedy argmax. Sky continuations still contain underscore **runs** (already present at WRIM-0 step 0).

## 36. PERIOD ARGMAX

**NO** at 0 / 10 / 25. Top token: ` a` then ` not`.

## 37. SYMBOL-RUN RESULT

WRIM-0 step 0 already has long `_` runs on the sky probe (`symbol_run=true` at baseline). New collapse at 25 is **more probes** in tokenizer/`-lab`/backtick loops, not a new `.` or `|` mode. `pipe_run=0` at all recorded steps.

## 38. UNIQUE-TOKEN RATIO

0.397 → **0.336** (step 10) → **0.341** (step 25). Down vs WRIM-0; 001 at step 25 was **0.555** (healthier).

## 39. EOS GENERATION

**0 / 13** at every recorded step.

## 40. JSON RESULT

**invalid** at 0 / 10 / 25.

## 41. TRAIN LOSS

Step 1: 8.32. Min **7.16**. Step 25: **7.29**. Finite. Higher than 001’s ~4.3 at step 25 (different mix + lower LR).

## 42. VALIDATION LOSS

7.753 → 7.516 (step 10) → **7.224** (step 25). Recorded; not success.

## 43. ENTROPY

6.03 → 6.50 → 6.50. Finite.

## 44. CHECKPOINT RELOAD

Steps 0, 10, 25: SHA match. Step 0 reload = WRIM-0. No step 50.

## 45. COMPARISON TO RECOVERY-001

Same 13-probe suite. 001 had no step 10 and no P(`|`)/P(`_`) log.

| Step | 001 collapsed | 002 collapsed | 001 unique | 002 unique | 001 top | 002 top | 001 val | 002 val | 002 P(.) | 002 P(\|) | 002 P(_) |
|---:|---:|---:|---:|---:|---|---|---:|---:|---:|---:|---:|
| 0 | 2/13 | 2/13 | 0.397 | 0.397 | ` a` | ` a` | 7.753 | 7.753 | 0.00101 | 0.00051 | 0.00567 |
| 10 | — | 2/13 | — | 0.336 | — | ` not` | — | 7.516 | 0.00128 | 0.00111 | 0.00658 |
| 25 | **2/13** | **4/13** | **0.555** | **0.341** | ` not` | ` not` | 7.219 | 7.224 | 0.00355 | 0.00229 | 0.00589 |
| 50 | 2/13 | not run | 0.584 | — | ` not` | — | 7.265 | — | — | — | — |

001 was **healthier at step 25** (and through 50) than 002. Combined 1e-4 + 15% rehearsal + leftover-prose fill (prose **52%** vs 001 **30%**) did not preserve the 001 short-horizon window.

## 46. PRODUCTION STATUS

Untouched. Active model unchanged. No SQL, no restart.

## 47. GIT STATUS

No commit/push/merge/rebase/reset. `git diff --check` clean on this mission’s Python files. 001 artifacts preserved.

## 48. EXACT NEXT RECOMMENDATION

Do **not** start WRIM1-RUN-000002. Do **not** increase steps. Do **not** raise LR.

Two variables moved at once (LR and mix/rehearsal), so this FAIL does not isolate which one hurt.

Strongest next TEST_ONLY (`TEST-WRIM1.1-RECOVERY-003`), Commander-gated:

1. Keep contiguous packing, leak scan, EOS wrap, WRIM-0 start.  
2. Keep **15.0% token-capped** rehearsal (the cap works).  
3. Restore **peak 3e-4** (001’s LR) so only rehearsal/mix differs from 001.  
4. Stop leftover fill from dumping repo markdown to **52% prose**; keep code ≤22.39% and target ~001 non-rehearsal proportions.  
5. Plan **50** steps, cadence 0/10/25/50, same 13 probes.

If 003 with 3e-4 + capped rehearsal stays 2/13 through 50, the 002 failure is attributed to **1e-4 / warmup**, not the cap. If 003 still fails, the leftover **prose-heavy mix** is the next factor (not LR).

## 49. FINAL VERDICT

**WRIM-1.1 LOW-LR RECOVERY EXPERIMENT — FAIL**

---

WRIM-1.1 FULL CANDIDATE RUN — NOT READY  
ACTIVE MODEL — UNCHANGED  
PRODUCTION — UNCHANGED
