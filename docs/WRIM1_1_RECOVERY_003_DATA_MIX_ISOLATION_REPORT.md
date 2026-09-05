# WRIM-1.1 RECOVERY-003 — DATA-MIX ISOLATION REPORT

Date: 2026-08-30  
Authoritative repo: `/Users/markbroughton/Developer/war-room-os`  
Production: `/Users/markbroughton/WarRoomNode01` — **not modified**  
Git: **no commit, no push**

## BINARY VERDICT

**WRIM-1.1 RECOVERY-003 — FAIL**

15.0% rehearsal + peak **3e-4** + balanced leftover mix did **not** preserve WRIM-0 language for 50 steps. Hard early stop at **step 25** when collapsed probes rose from **2/13 to 11/13**. Official WRIM1-RUN-000002 was **not** started.

---

## 1. EXPERIMENT ID

`TEST-WRIM1.1-RECOVERY-003`  
Artifacts: `model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-003/`  
Did **not** overwrite RECOVERY-001 or RECOVERY-002.

## 2. WRIM-0 LOAD PROOF

File SHA-256: `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`  
Loaded tensor-tree SHA-256: `8d0c903bbcd63f709114c1b69bd2d1136a20e5558f39acd3ad11f403064678b9` (matches parent)  
**max_abs_diff = 0.0** before the first optimizer step. Step-0 reload SHA equals WRIM-0. Parent was WRIM-0 only — not WRIM-1 or recovery 001/002 checkpoints.

## 3. REHEARSAL EXACT TOKENS / %

**60,000 tokens / 15.0%** of 400,000 train tokens.  
Band 14.5%–15.5% **held**. Cap method: deterministic `unit_id` order; whole clean WR-CORPUS-0 documents while they fit; last document truncated to a contiguous prefix ending in EOS. 1 truncated unit. 2 of 4 clean docs selected. Alice/held-out WR-CORPUS-0 doc dropped.

## 4. PEAK LR

**3e-4** (same as RECOVERY-001; not 002’s 1e-4; not Genesis 3e-3). Not increased beyond 3e-4.

## 5. LR SCHEDULE

Scheduler: **linear warmup + cosine decay** (`linear_warmup_cosine_decay`)  
Initial (step 0 / first update): **1.2e-5** (`peak * 1/25`)  
Warmup: **25** of **50** (001 used warmup 25 of 150; absolute warmup kept)  
Peak: **3e-4** (reached on the step-25 update)  
Floor: **10% of peak = 3e-5**  
Optimizer: fresh AdamW, betas (0.9, 0.95), eps 1e-8, weight decay 0.1, clip 1.0. Not inherited from 001/002/WRIM-1.

## 6. TOTAL TRAIN TOKENS

**400,000** train / **840,182** val (TEST_ONLY band 300K–500K). Contiguous packing. Unit-order shuffle only.

## 7. PROSE %

**35.0%** (140,000 tokens). ≤45% gate passed. 002 was 52.45%. 001 was 29.82%.

## 8. CODE %

**35.0%** (140,000). ≤45% gate passed. 001/002 were 22.39%. Available clean code was 2,995,634 — not a shortage.

## 9. JSON %

**13.34%** (53,350). Guide was ~10%. Leftover after target fill (13,350 tokens) went json→code→prose; json took the remainder. Not a 002-style prose dump.

## 10. BEHAVIOR %

**1.66%** (6,650) — all 31 clean examples. Guide was ~5%. Could not fabricate more behavior tokens. Masking unchanged (response-only after `<|assistant|>`).

Mix gate **passed** before train. Data availability did **not** force a stop: prose/code/json pools were large enough for a balanced leftover.

## 11. EOS COUNT / RATE

**701** EOS / **1.7525 per 1K** tokens. BOS 701. Not a regression to WRIM-1’s 30 EOS / 0.00774 per 1K. Packing proofs: `prove_recovery_packing.py` **7/7 PASS**.

## 12. LEAKAGE HITS

**0** known held-out/eval prompt hits on packed units. 68 eval-infra records excluded. Training was allowed.

## 13. PLANNED / COMPLETED STEPS

Planned **50**. Completed **25**. Diagnostics at 0, 10, 25. Step 50 **not reached**.

## 14. EARLY STOP

**YES** — `collapsed probes materially exceed step-0` at step **25** (2/13 → 11/13). No NaN/Inf. Did not continue.

## 15. STEP-0 COLLAPSE

**2 / 13**. Argmax ` a`. P(`.`)≈0.00101. Sky starts ` a`. Matches WRIM-0 / 001 / 002 step-0. Training allowed.

## 16. STEP-10 COLLAPSE

**2 / 13**. Unique-ratio 0.322. Argmax ` not`. Still WRIM-0-like underscore runs on sky.

## 17. STEP-25 COLLAPSE

**11 / 13**. Early stop. Unique-ratio **0.216**. Language no longer word-like on most probes.

## 18. STEP-50 COLLAPSE

**not reached**

## 19. LANGUAGE OUTPUTS

Same frozen 13-probe suite (`WRIM-RECOVERY-DIAGNOSTIC-0-EXTENDED.json`). Prompts unmodified.

Step 0 `The sky is`: ` a` then tokenizer-underscore (WRIM-0-like). Literary probes still word-like (`Once upon a time` → world/feelings fragments).

Step 10: sky ` not been a end of the` then underscores. Several probes still English-ish; tokenizer/`-lab` junk on hello/code.

Step 25: sky ` not\n|-BBBBBBBBBBmmBBBmBmBBEBEBmBmB`. Hello/JSON/code/seq: spaced `|` loops. QA: newline/`##:` loops. One literary probe still mixed words (`said the Cat`) plus junk. **Not** greedy `.` mode.

## 20. UNIQUE-TOKEN RATIO

0.397 (step 0) → 0.322 (step 10) → **0.216** (step 25). Sharp decline vs WRIM-0. Worse than 002 (0.341) and 001 (0.555) at step 25.

## 21. P(".")

0.00101 → 0.00138 → 0.00839. Never argmax. Not dominant.

## 22. P("|")

0.00051 → 0.00126 → 0.00290. Logit mass not dominant, but **greedy continuations** entered `|` loops on multiple probes at step 25.

## 23. P("_")

0.00567 → 0.00658 → 0.00422. Not greedy argmax at step 25.

## 24. SYMBOL-RUN RESULT

Step 0/10: `symbol_run=true` from WRIM-0-baseline underscore runs (`pipe_run=0`).  
Step 25: detector `symbol_run=false` (`pipe_run=1` because `|` is space-separated) but **language is repeated `|` / letter-run / newline**. Collapse count 11/13 is the hard evidence.

## 25. JSON RESULT

**invalid** at 0 / 10 / 25.

## 26. TRAIN LOSS

Step 1: **8.09**. Step 10: **7.78**. Step 25: **6.81**. Finite. Higher than 001’s ~4.3 at step 25 (001 had 38.79% rehearsal and a different mix).

## 27. VAL LOSS

7.753 → 7.482 (step 10) → **6.887** (step 25). Finite. Improving val while generation collapsed — not success.

## 28. ENTROPY

6.03 → 6.65 → 6.19. Finite. Logits finite at every diagnostic.

## 29. COMPARISON VS RECOVERY-001

Same 13 probes. 001 had no step-10 row. 001 peak LR also 3e-4; rehearsal **38.79%**; prose 29.82%; code 22.39%.

| Step | 001 collapsed | 003 collapsed | 001 unique | 003 unique | 001 top | 003 top | 001 val | 003 val |
|---:|---:|---:|---:|---:|---|---|---:|---:|
| 0 | 2/13 | 2/13 | 0.397 | 0.397 | ` a` | ` a` | 7.753 | 7.753 |
| 10 | — | 2/13 | — | 0.322 | — | ` not` | — | 7.482 |
| 25 | **2/13** | **11/13** | **0.555** | **0.216** | ` not` | ` not` | 7.219 | 6.887 |
| 50 | 2/13 | not run | 0.584 | — | ` not` | — | 7.265 | — |

001 was healthier at step 25 (and through 50). Restoring 3e-4 without 001’s rehearsal share did **not** reproduce 001’s short-horizon window.

## 30. COMPARISON VS RECOVERY-002

002: 15.0% rehearsal, peak **1e-4**, prose **52.45%**, code 22.39%. 003: 15.0% rehearsal, peak **3e-4**, prose **35.0%**, code **35.0%**.

| Step | 002 collapsed | 003 collapsed | 002 unique | 003 unique | 002 top | 003 top | 002 P(.) | 003 P(.) | 002 P(\|) | 003 P(\|) | 002 P(_) | 003 P(_) |
|---:|---:|---:|---:|---:|---|---|---:|---:|---:|---:|---:|---:|
| 0 | 2/13 | 2/13 | 0.397 | 0.397 | ` a` | ` a` | 0.00101 | 0.00101 | 0.00051 | 0.00051 | 0.00567 | 0.00567 |
| 10 | 2/13 | 2/13 | 0.336 | 0.322 | ` not` | ` not` | 0.00128 | 0.00138 | 0.00111 | 0.00126 | 0.00658 | 0.00658 |
| 25 | **4/13** | **11/13** | **0.341** | **0.216** | ` not` | ` not` | 0.00355 | 0.00839 | 0.00229 | 0.00290 | 0.00589 | 0.00422 |
| 50 | not run | not run | — | — | — | — | — | — | — | — | — | — |

Removing 002’s leftover-prose dump and restoring 3e-4 made step 25 **worse**, not better. 002’s 52% prose is **not** the unique cause of 002 FAIL.

Isolation reading:

- Shared with 002 vs 001: **15.0% rehearsal** (001 had 38.79%).
- 003 uniquely raised **code to 35%** (001/002 were 22.39%) and used **3e-4** at that mix.
- The 001 healthy window at 25–50 is still most consistent with **high WR-CORPUS-0 rehearsal** and/or **lower code share**, not with “just un-dump leftover markdown.”

## 31. PRODUCTION STATUS

Untouched. No deploy, no production SQL, no restart, no active model change. Official WRIM-1 checkpoint registry still 10 entries. Path isolation: 003 work dir ≠ official dir.

## 32. GIT STATUS

No commit, push, merge, rebase, reset, or unrelated stash. 001 and 002 artifacts preserved.

## 33. NEXT RECOMMENDATION

Do **not** start WRIM1-RUN-000002. Do **not** increase steps. Do **not** raise LR. Do **not** auto-launch 004.

The test question (“does 15% rehearsal + 3e-4 + balanced mix preserve WRIM-0 language for 50 steps?”) is answered **no**.

Strongest next TEST_ONLY, Commander-gated, one primary variable:

1. Keep contiguous packing, leak scan, EOS wrap, WRIM-0 start, **15.0% token-capped rehearsal**, peak **3e-4**.  
2. Restore **001 non-rehearsal shares** (prose ~30%, code **~22.39%**, JSON ~8%) instead of 35/35 code/prose. That isolates whether 003’s extra code (35% vs 22%) drove the 11/13 collapse.  
3. Alternate if Commander prefers not to touch mix again: weight decay / objective-masking / sequence-boundary investigation — not more steps.

Do not return to 38.79% rehearsal unless Commander explicitly authorizes a rehearsal-share experiment.

## 34. FINAL VERDICT

**WRIM-1.1 RECOVERY-003 — FAIL**

---

WRIM-1.1 RECOVERY-003 — FAIL  
FULL WRIM-1.1 RUN — NOT READY  
ACTIVE MODEL — UNCHANGED  
PRODUCTION — UNCHANGED
