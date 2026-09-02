# WRIM-1.1 RECOVERY-004 — 30% REHEARSAL ABLATION REPORT

Date: 2026-08-30  
Authoritative repo: `/Users/markbroughton/Developer/war-room-os`  
Production: `/Users/markbroughton/WarRoomNode01` — **not modified**  
Git: **no commit, no push**

## BINARY VERDICT

**WRIM-1.1 RECOVERY-004 — FAIL**

Forensic follow-up (no retraining): `docs/WRIM1_1_RECOVERY_004_STEP45_FORENSIC_DIAGNOSIS.md`.

30.0% WR-CORPUS-0 rehearsal with Recovery-001-relative leftover mix **did not** preserve WRIM-0 generation through 50 steps. The 13-probe suite stayed at or below baseline through step **40** (unique-ratio healthier than step 0). Hard early stop at **step 45** when collapsed probes rose **2/13 → 4/13**, train loss jumped **4.50 → 7.06**, and `|` / `B`-runs appeared. Official WRIM1-RUN-000002 was **not** started.

---

## 1. EXPERIMENT ID

`TEST-WRIM1.1-RECOVERY-004`  
Artifacts: `model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-004/`  
Did **not** overwrite 001, 002, or 003.

## 2. TEST_ONLY MARKERS

`TEST_ONLY=true` / `NOT_PROMOTABLE=true` / `NOT_OFFICIAL_WRIM_LINEAGE=true` / `NOT_PRODUCTION=true`

## 3. WRIM-0 SHA

`d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`

## 4. EXACT PARENT LOAD PROOF

`max_abs_diff = 0.0`. Tensor-tree SHA `8d0c903bbcd63f709114c1b69bd2d1136a20e5558f39acd3ad11f403064678b9` matches parent. Step-0 reload equals WRIM-0. Not initialized from WRIM-1 or recovery checkpoints.

## 5. TOTAL TRAIN TOKEN COUNT

**399,999** train / **840,182** val (TEST_ONLY). Unfilled 1 token vs 400,000 target.

## 6. REHEARSAL TOKEN COUNT

**120,000**

## 7. REHEARSAL %

**30.0001%** (band 29.5–30.5 held). Token-capped contiguous prefix; 1 truncated WR-CORPUS-0 unit.

## 8–11. MIX (001-relative leftover)

| Bucket | tokens | % | 001-relative target |
|---|---:|---:|---|
| Rehearsal | 120,000 | 30.00 | 30.00 |
| Prose | — | **34.11** | ~34.11 |
| Code | — | **25.61** | ~25.61 |
| JSON | — | **8.62** | ~8.61 |
| Behavior | 6,650 | **1.66** | ~1.67 |

Leftover used exact Recovery-001 prose/code/JSON shares among non-rehearsal PCJ (`0.499 / 0.375 / 0.126`). Mix gate **passed**.

## 12. EOS COUNT / RATE

**585** EOS / **1.463 per 1K**. 001: 585 / 1.283 (larger stream). 002: 679 / 1.70. 003: 701 / 1.75. Not a near-zero EOS regression. Packing proofs **7/7 PASS**.

## 13. LEAKAGE SCAN

**0** held-out prompt hits. 68 eval-infra records excluded. Training allowed.

## 14. REAL-BATCH CAUSAL-TARGET AUDIT

8 batches × 8 = 64 rows. **`y[t] == x[t+1]` mismatches: 0**. 57 windows contained EOS; 57 had EOS then BOS. Code, JSON, prose prefixes appeared in decoded batches. **Hard gate passed.**

## 15. REAL-BATCH MASKING AUDIT

Unit-level: 31 behavior units, **6650/6650** tokens match response-only after `<|assistant|>`. 553 LM units full causal, 0 not-full. **Passed.** Mixed sliding windows that straddle a prior LM unit before assistant are observational only (false “mask bad” if scored as a pure prompt).

## 16. LR SCHEDULE

Peak **3e-4**. Initial **1.2e-5**. Warmup **25**. Cosine floor **10%** of peak (**3e-5**). **Scheduler horizon 150 steps** (Recovery-001 semantics); train budget 50. At stop, LR ≈ **2.85e-4** (still near peak, like 001 at step 50). Not lowered or raised.

## 17. OPTIMIZER

Fresh AdamW. β1 **0.9**, β2 **0.95**, eps **1e-8**, weight decay **0.1**, clip **1.0**. Unchanged vs 001. No optimizer-state inheritance.

## 18. PLANNED / COMPLETED STEPS

Planned **50**. Completed **45**. Full diagnostics 0 / 10 / 25. Lightweight every 5 (5, 15, 20, 30, 35, 40, 45). Step 50 **not reached**.

## 19. EARLY STOP

**YES** — `collapsed probes materially exceed step-0` at step **45** (2/13 → 4/13). No NaN/Inf.

## 20. COLLAPSE COUNT (13-probe)

| Step | collapsed |
|---:|---:|
| 0 | 2/13 |
| 5 | 2/13 |
| 10 | 2/13 |
| 15 | 1/13 |
| 20 | 2/13 |
| 25 | **1/13** |
| 30 | 1/13 |
| 35 | **0/13** |
| 40 | 1/13 |
| 45 | **4/13** (stop) |
| 50 | not reached |

Expanded frozen 87 WRIM-0-prefix probes: **1/87** at 0, 10, and 25 (not run at 45).

## 21. UNIQUE-TOKEN RATIO

0.397 (0) → 0.329 (10) → **0.591 (25)** → 0.663 (35) → 0.620 (40) → **0.514 (45)**. Did **not** meet the 0.5× step-0 unique-ratio hard stop. Diversity at 25–40 matched or beat 001’s 25/50 window.

## 22. REPETITION TREND

Step 0: WRIM-0 underscore runs on sky (`symbol_run=true`, baseline).  
Step 25–40: mostly word-like / literary; some `B` fragments.  
Step 45: hello ` | | | …`; sky `B` run; seq colon run. Not greedy `.`.

## 23. ENTROPY

6.03 → 6.63 (10) → 6.21 (25) → 6.00 (40) → 6.41 (45). Finite.

## 24–26. P(".") / P("|") / P("_")

P(.): 0.00101 → 0.00129 (10) → 0.00445 (25) → 0.00550 (45). Never argmax.  
P(|): 0.00051 → 0.00135 → 0.00135 → 0.00209. Not logit-dominant; **greedy `|` loop** on hello at 45.  
P(_): 0.00567 → 0.00675 → 0.00689 → 0.00651. Not greedy argmax.

## 27. TRAIN LOSS

Step 1: **7.95**. ~**4.17** at 20. **4.26** at 25. **4.50** at 40. **7.06** at 45 (spike coinciding with collapse). Finite.

## 28. VAL LOSS

7.753 → 7.500 (10) → 7.317 (25) → **7.154** (45). Still falling while generation broke. Not success.

## 29. GRADIENT-NORM TREND

Global L2 step 1: **1.32**. Step 25: **0.48**. Step 45: **0.98**. Finite. Not 50× baseline. Layer 0 carries most grad mass (typical for embeddings/early layers).

## 30. PARAMETER-DRIFT TREND

L2 from WRIM-0: 0 → 1.92 (10) → 7.34 (25) → **10.78 (45)**. Relative: 0 → 0.0073 → ~0.028 → **0.041**. Smooth; no discontinuity at the 40–45 behavior break (weights keep drifting while loss/generation snap).

## 31. PER-LAYER DRIFT

Cosine to WRIM-0 at 45: all layers **≥0.9989**, `tok_emb` **0.9993**, `norm_f` **~1.0**. No single-layer cosine collapse.

## 32. EMBEDDING / OUTPUT-HEAD DRIFT

Tied embeddings (no separate `lm_head`). Embedding L2 from WRIM-0: 0 → 0.99 (10) → 4.38 (25) → **7.01 (45)**.

## 33. KL-TO-WRIM-0 (observational)

Frozen 16×64 WR-CORPUS-0 windows, **1008** next-token positions. Alice doc dropped. 0 leak hits.

mean KL(WRIM-0 ‖ current): **0** (step 0) → **0.049** (10) → **0.057** (25) → **0.077** (45). Finite. **Not** used as a universal threshold.

## 34. CHECKPOINT RELOAD

Steps 0, 10, 25: SHA match. Step 0 = WRIM-0. No step-50 bundle (early stop). Light step 45 was not a full checkpoint write.

## 35. VS RECOVERY-001

Same 13 probes, same peak LR, 001-relative leftover, **less rehearsal** (30% vs 38.79%).

| Step | 001 coll. | 004 coll. | 001 unique | 004 unique |
|---:|---:|---:|---:|---:|
| 0 | 2/13 | 2/13 | 0.397 | 0.397 |
| 25 | 2/13 | **1/13** | 0.555 | **0.591** |
| 45/50 | 2/13 @50 | **4/13 @45** | 0.584 @50 | 0.514 @45 |

004 was **as healthy as 001 at step 25** (slightly better collapse/unique). It did **not** hold that window to 50. 001’s extra ~9 points of rehearsal remain the main uncopied 001 factor.

## 36. VS RECOVERY-002

002: 15% rehearsal, 1e-4, stop **25** at 4/13 unique 0.341.  
004: 30% rehearsal, 3e-4, **1/13 at 25** unique 0.591, stop **45**. Strictly healthier at the 002 failure step.

## 37. VS RECOVERY-003

003: 15% rehearsal, 3e-4, 35/35 mix, stop **25** at **11/13** unique 0.216.  
004 at 25 is not in the same failure class.

## 38. REHEARSAL HYPOTHESIS ASSESSMENT

**Substantially stronger; not uniquely proven.**

- 15% + 3e-4 died at 25 (003: 11/13).  
- 30% + 3e-4 + 001-relative leftover was **001-like through ~40 steps**, then failed at 45.  
- Mix is no longer the 002/003 confounder. Rehearsal share is the variable that tracks the healthy window.  
- 30% is **not enough** for a 50-step PASS under this recipe. 001’s 38.79% still uniquely held 50 at 2/13.

Do **not** call rehearsal a universal root cause. Optimizer / β2 / weight decay / LR remain future one-variable tests **after** Commander review.

## 39. PRODUCTION STATUS

Untouched. No deploy, SQL, restart, or active model change. Official WRIM-1 registry still 10 checkpoints.

## 40. GIT STATUS

No commit, push, merge, rebase, reset, or unrelated stash. 001–003 artifacts preserved.

## 41. NEXT RECOMMENDATION

Do **not** launch Recovery-005 or WRIM1-RUN-000002 automatically.

Commander-gated options (one variable):

1. **Rehearsal interpolation:** same 001-relative leftover, peak 3e-4, **~35%** token-capped rehearsal, 50 TEST_ONLY steps.  
2. If Commander prefers not to raise rehearsal: freeze 30% mix and change **one** of weight decay / fresh optimizer / β2.

Do not raise LR. Do not extend this 004 run.

## 42. FINAL VERDICT

**WRIM-1.1 RECOVERY-004 — FAIL**

---

WRIM-1.1 RECOVERY-004 — FAIL  
30% REHEARSAL STABILITY TEST — FAILED  
WRIM-1.1 FULL RUN — NOT READY  
ACTIVE MODEL — UNCHANGED  
PRODUCTION — UNCHANGED
