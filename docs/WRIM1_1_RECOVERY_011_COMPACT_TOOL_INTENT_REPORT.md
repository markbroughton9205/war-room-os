# WRIM-1.1 RECOVERY-011 — COMPACT TOOL-INTENT REINTRODUCTION REPORT

Date: 2026-08-31  
Authorization: Commander TEST_ONLY Recovery-011 only. Not official WRIM-1.1. Not Recovery-012. Not WRIM1-RUN-000003. Not promotion. Not production. Not git commit/push.

Control: **TEST-WRIM1.1-RECOVERY-010** (PASS, 250/250, TOOL_USE V1 removed).  
Parent: **WRIM-0** (not Recovery-010 weights).  
Primary variable: reintroduce **TOOL_USE V2 compact intent** in the 88 former V1 tool window slots.

## FINAL VERDICT

**WRIM-1.1 RECOVERY-011 — FAIL**

## TOOL CAPABILITY VERDICT

**WRIM-1.1 TOOL V2 — CAPABILITY ACQUISITION NOT DEMONSTRATED**

Compact V2 executed as designed (88 examples, 1,694 target tokens, validator PASS, 0 leakage). Training CE on TOOL_V2 declined on the 35 batches that contained it. Held-out **WRIM-1.1-TOOL-EVAL-1 stayed 0/12** at every measured step. Early stop fired at **step 120 (4/13)** with the same underscore-loop class as Recovery-008. Recovery-010 completed 250/250 at 3/13 at the same step. Representation simplification alone did **not** preserve 010 stability.

WRIM1-RUN-000003 — **NOT STARTED**  
RECOVERY-012 — **NOT STARTED**  
ACTIVE MODEL — **WRIM-0**  
PRODUCTION — **UNCHANGED**

---

## 1. EXPERIMENT ID

`TEST-WRIM1.1-RECOVERY-011`  
Runner: `scripts/wrim1-training/run_recovery_experiment_011.py`  
Pack: `scripts/wrim1-training/pack_recovery_011.py`  
Artifacts: `model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-011/`

Started from **WRIM-0**. Did **not** resume Recovery-010.

## 2. TEST_ONLY MARKERS

`TEST_ONLY=true`, `NOT_PROMOTABLE=true`, `NOT_OFFICIAL_WRIM_LINEAGE=true`, `NOT_PRODUCTION=true`. Authorization string: `COMMANDER_TEST_WRIM1_1_RECOVERY_011_ONLY`.

## 3. ENVIRONMENT

`.venv-wrim` Python **3.12.14**, arm64, MLX **0.32.2**, `Device(gpu, 0)`, executable match PASS. `environment.json` `passed: true`.

## 4. PARENT / TOKENIZER PROOF

WRIM-0 file SHA `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`. Tokenizer WR-TOKENIZER-0 SHA `47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7`. Loaded tensor-tree match. **max_abs_diff = 0.0**. Step-0 diagnostic matched WRIM-0 (2/13, sky starts with ` a`, argmax ` a`).

## 5. RECOVERY-010 CONTROL PACK IDENTITY

`WR-CORPUS-1.1-RECOVERY-010-NO-TOOL`  
train.npy SHA `af2a8224dc105b32febec9586f9e232e7974a0e60afd4b09c49c0c374ff58722`

## 6. RECOVERY-011 PACK IDENTITY

`WR-CORPUS-1.1-RECOVERY-011-COMPACT-TOOL`  
train.npy SHA `73025a9eb2b6112d1e6bd55b7f806746921a15ee6d725b8cf5ee5097ae2d1550`  
Length **686,070** (equal to 010/008). Intentionally not array-equal to 010.

## 7. V1 TOOL EXAMPLES ABSENT PROOF

`v1-absence-proof.json` **passed**. 88 V2 units. 0 `<tool_call>` hits in V2 units. 0 exact V1 response copies in V2 units. Correction-family JSON was not treated as TOOL_USE V1.

## 8. V2 TOOL EXAMPLE COUNT

**88 / 88** (`WRIM-1.1-TOOL-CURRICULUM-V2-DESIGN`).

## 9. V2 TARGET-TOKEN COUNT

**1,694** (matches design). Packed assistant-span targets **1,694**. Mean 19.25 vs V1 69.30. **27.78%** of V1’s 6,098.

## 10. REHEARSAL-PADDING AMOUNT

**5,857** tokens of WR-CORPUS-0 pad (010 window tails after each V2 unit). **88** padding windows. Pad tails byte-identical to Recovery-010 window tails (88/88).

## 11. FINAL PACK COMPOSITION

| Class | Tokens |
|---|---:|
| QUALITY_PROSE | 212,058 |
| REHEARSAL | 185,857 |
| QUALITY_CODE | 178,129 |
| INSTRUCTION | 23,975 |
| JSON | 20,428 |
| TOOL_V2 | 17,558 |
| EVIDENCE | 17,499 |
| CODE_SUPERVISED | 11,819 |
| WR_CONCEPT | 10,387 |
| CORRECTION | 8,360 |
| **Total** | **686,070** |

Bucket %: prose 30.9091, code 25.9637, rehearsal 27.0901, supervised 16.0371. Rehearsal 010 was 203,415; 011 is 185,857 (pad only, not 010’s full tool-slot rehearsal).

## 12. RETAINED-FAMILY IDENTITY PROOF

Non-tool windows vs 010: **1,356 / 1,356** byte-identical. QUALITY_CODE leftover **178,129** retained. Supervised origins except tool_use unchanged vs 010. tool_use windows **88** (V2), not V1 JSON.

## 13. CAP-EVAL LEAK RESULT

**0**. CAP-EVAL-0 suite SHA `f27dd64bcc245e228a8e4f18bfd95fcd7d0ee7c32cfdee5d8d40519fd1c1406d`. `EXCLUDE_FROM_TRAINING` held. 10 EVAL-TOOL items unchanged (verbose V1 JSON gold).

## 14. TOOL-EVAL-1 LEAK RESULT

**0**. Suite SHA `a7b6f77dfd2364ea58af518416534df244b424d3a6d36527ffbffcf4db8c72b5`. 12 items. `EXCLUDE_FROM_TRAINING=true`. Does not overwrite CAP-EVAL-0.

## 15. PACKING PROOF

No token permutation. No re-interleave. seq_starts vs 010: **0 mismatches / 250 planned**. Window mapping 010→011: unchanged 1356, changed 88 (V2), rehearsal-padding windows 88. `window_byte_proof_passed: true`.

## 16. CAUSAL PROOF

`y[t]==x[t+1]` mismatches **0** (12 audit batches, 96 rows). Live training also gated on causal equality.

## 17. MASK PROOF

`unit-mask-audit.json` **passed**. Supervised mask tokens ok **110,026**, bad **0**. LM units full-causal **986**. V2 prompts masked; compact targets trainable.

## 18. V2 TOOL-TARGET GRADIENT PROOF

`v2-gradient-proof.json` **passed**. 88/88 compact parse. 0 JSON/`<tool_call>` in V2 targets. 1,694 gradient-bearing target tokens.

## 19. WINDOW MAPPING

`window-mapping-010-to-011.json` and `step-mapping-010-to-011.json`. Mix changed on **53** planned steps (V2 vs 010 rehearsal in those slots). seq_starts identical.

## 20. LR SCHEDULE

Peak **3e-5**, warmup **25**, cosine through **150**, floor **3e-6** thereafter. Identical Recovery-010/008 formula. Key: step 25 = 3e-5; 100 ≈ 1.27e-5; 150+ = 3e-6 (floor never reached because stop at 120).

## 21. OPTIMIZER

AdamW β1=0.9 β2=0.95 ε=1e-8 WD=0.1 clip=1.0. Fresh state. Unchanged vs 010.

## 22. PLANNED / COMPLETED STEPS

Planned **250**. Completed **120**. Tokens seen **491,520**. Wall **2428.6 s**. Checkpoints saved: 0, 25, 50, 75, 100, 120. Reload SHA match on all six.

## 23. EARLY-STOP STATUS

**FIRED** at step **120**. Reason: collapsed probes exceed step-0 with corroborating loop/run evidence (`collapse_gate_008`, not weakened). No NaN/Inf. No crash. No leak/mask/causal/checkpoint integrity failure.

## 24. COLLAPSE TREND

| Step | 011 | 010 control |
|---:|---:|---:|
| 0 | 2/13 | 2/13 |
| 25 | 1/13 | 1/13 |
| 50 | 1/13 | 1/13 |
| 75 | 1/13 | 1/13 |
| 100 | 2/13 | 2/13 |
| 120 | **4/13 STOP** | 3/13 (continued to 250) |

## 25. UNIQUE-RATIO TREND

0: 0.397 → 25: 0.377 → 50: 0.375 → 75: 0.447 → 100: 0.466 → 120: **0.418**. At 120, 010 was 0.445.

## 26. REPETITION TREND

Step 50–75: `-lab` runs (`##-lab-lab-lab-…`). Step 100–120: `_not` + long underscore runs (26). Same degeneration class as Recovery-008 step 120, not a new loop family.

## 27. `_` / `_not_` / `-lab` / model-lab TRACE

| Step | underscore_run | not_count | model_lab_hits | letter_loop |
|---:|---:|---:|---:|---|
| 0 | 25 | 0 | 5 | true (WRIM-0 residual) |
| 25 | 3 | 2 | 18 | true |
| 50 | 0 | 0 | 62 | true |
| 75 | 0 | 1 | 47 | true |
| 100 | 26 | 2 | 20 | true |
| 120 | 26 | 2 | 13 | true |

P("_") stayed ~0.005–0.006 (not a P(symbol)≥0.15 stop). Collapse gate fired on **probe count + corroborating underscore run**, matching 008.

## 28. TRAIN-LOSS TREND

25: 7.689 → 50: 6.354 → 75: 5.621 → 100: 5.793 → 120: **7.209** (spike at stop, similar to 010’s 7.223 at 120 which did **not** trip 4/13).

## 29. SUPERVISED CE TREND

Present every step (n=120). First 7.628, last 7.057, mean 7.495. Step 75 7.209; 100 7.021; 120 7.057.

## 30. TOOL_V2 CE TREND

35 batches with TOOL_V2 CE (first exposure step **65**). First 7.155 → last recorded 6.248 (step 99). Mean 6.904. Training CE **decreased** where measured. That is **not** held-out skill.

## 31. GRAD NORM BY FAMILY

Dominant-class global grad L2 (mean / median / max / clip count):

| Family | n | mean | median | max | clips |
|---|---:|---:|---:|---:|---:|
| REHEARSAL | 58 | 0.668 | 0.662 | 0.947 | 0 |
| QUALITY_PROSE | 43 | 0.906 | 0.886 | 1.289 | 16 |
| QUALITY_CODE | 19 | 1.013 | 0.968 | 1.331 | 8 |
| TOOL_V2 (dominant) | 0 | — | — | — | 0 |

TOOL_V2 never dominated a 4096-token batch (short targets + pad). Gradients still flowed: 35 batches had TOOL_V2 CE.

## 32. CLIP EVENTS

**24** (prose 16 + code 8). Rehearsal 0.

## 33. V2 TARGET-DENSITY STATISTICS

Prompt tokens **15,864**. Target **1,694**. Unit **17,558**. Target density **0.0965**. Share of supervised targets **4.19%** (vs V1 historical **13.59%**). Batch incidence **35/120 = 29.2%** of completed steps — essentially the same **~29%** Recovery-008 V1 incidence — because V2 occupies the **same window slots** (pad keeps geometry). V1 historical target mass 6,098.

## 34. CAUSAL↔MIXED SWITCH COUNT

Observed **91** switches in 120 steps (algorithm unchanged). Planned 011 over 250 would have been **196** vs 010’s **158** (mix shift from V2 vs full rehearsal in those slots). H3 was **not redesigned**. 011 failed **despite** compact targets, so H3 / weighting / staging remain live suspects.

## 35. KL TREND

0 → 0.0169 (25) → 0.0338 (50) → 0.0346 (75) → 0.0344 (100) → **0.0365 (120)**. 010 at 120 was 0.0335.

## 36. PARAM L2 TREND

0 → 1.11 (25) → 2.74 (50) → 3.86 (75) → 4.48 (100) → **4.77 (120)**. 010 at 120 was 4.68; at 250 was 5.29.

## 37. LAYER DRIFT

Step 120 per-layer cosine to WRIM-0 all **≥ 0.99975**. tok_emb 0.99988. norm_f ~1.0. Relative drift 0.0181. No single-layer blow-up.

## 38–43. COMPARISON VS RECOVERY-010

| Step | 011 collapse / unique / loss / KL / L2 | 010 collapse / unique / loss / KL / L2 |
|---:|---|---|
| 25 | 1 / 0.377 / 7.689 / 0.0169 / 1.11 | **identical collapse/unique/loss** (KL/L2 match to ~1e-9) |
| 50 | 1 / 0.375 / 6.354 / 0.0338 / 2.74 | **identical collapse/unique/loss** |
| 75 | 1 / 0.447 / 5.621 / 0.0346 / 3.86 | 1 / 0.478 / 5.552 / 0.0328 / 3.84 |
| 100 | 2 / 0.466 / 5.793 / 0.0344 / 4.48 | 2 / 0.466 / 5.802 / 0.0317 / 4.40 |
| 120 | **4 STOP** / 0.418 / 7.209 / 0.0365 / 4.77 | 3 / 0.445 / 7.223 / 0.0335 / 4.68 |
| 150 | not reached | 3 / 0.430 / 6.194 / 0.0356 / 4.88 |
| 200 | not reached | 2 / 0.438 / 6.755 / 0.0368 / 5.07 |
| 250 | not reached | 3 / 0.406 / 5.709 / 0.0384 / 5.29 |

Through step 50, 011 tracked 010 almost exactly. Divergence begins by 75 (unique-ratio). Hard split at 120.

## 44–50. CAP-EVAL-0

Verbose V1 TOOL JSON family remained **0/10** at every step (expected under compact training; not the 011 acquisition metric).

| Step | Overall | LANG | INSTRUCT | JSON | CODE | WR | EVIDENCE | TOOL | CORRECTION | RETENTION |
|---:|---|---|---|---|---|---|---|---|---|---|
| 0 | 18/86 | 7/8 | 3/12 | 0/10 | 0/8 | 1/12 | 0/12 | 0/10 | 1/8 | 6/6 |
| 75 | 18/86 | 6/8 | 3/12 | 0/10 | 0/8 | 2/12 | 0/12 | 0/10 | 1/8 | 6/6 |
| 100 | 18/86 | 7/8 | 3/12 | 0/10 | 0/8 | 2/12 | 0/12 | 0/10 | 1/8 | 5/6 |
| 120 | 19/86 | 8/8 | 3/12 | 0/10 | 0/8 | 1/12 | 0/12 | 0/10 | 1/8 | 6/6 |
| 150+ | not run | | | | | | | | | |

## 51–57. TOOL-EVAL-1 (inference-only, compact gold)

**0/12 at steps 0, 75, 100, and 120.** All subfamilies 0 pass. Steps 150/200/250 not run (early stop).

## 58–61. SUBFAMILY DELTAS (step 120 vs WRIM-0 / step 0)

TOOL_DECISION: **0** (0/3 → 0/3)  
TOOL_SELECTION: **0** (0/3 → 0/3)  
TOOL_ARGS: **0** (0/2 → 0/2)  
TOOL_CALL: **0** (0/2 → 0/2)  
TOOL_FAILURE: **0** (0/2 → 0/2)  
TOOL_RESULT: **not in TOOL-EVAL-1** (deferred in V2 design)

## 62. NO_TOOL PERFORMANCE

4 none-expecting items in TOOL-EVAL-1 (decision + missing-arg). **0/4** at every step. V2 trained 32/88 NO_TOOL examples; held-out none-decision did not appear.

## 63. V2 GENERALIZATION EVIDENCE

None. Training CE down; held-out parseable compact TOOL= never produced a passing item. Two-schema distractors (20 train / 3 held-out selection items) **0/3**.

## 64. V2 REPRESENTATION VERDICT

Compact `TOOL=` is **safer on target mass** (4.19% vs 13.59% of supervised targets) but **not sufficient** to stop 008-class collapse when placed in the same window schedule. Step incidence remained ~29%. Representation change **did not isolate** the failure from window occupancy / objective mixing.

## 65. TOOL CAPABILITY ACQUISITION VERDICT

**NOT DEMONSTRATED** (held-out TOOL-EVAL-1 did not improve over WRIM-0 0/12).

## 66. OBJECTIVE-SWITCHING STATUS

**Unchanged algorithm.** 91 observed switches in 120 steps. Isolation of compact representation **failed**; H3 is **not eliminated**. Do not auto-redesign switching without a new authorization.

## 67. OPTIMIZER STATUS

**Not implicated** as the unique 011 failure. Same AdamW as 010, which completed 250.

## 68. ARCHITECTURE / CAPACITY STATUS

**Not scaled. Not implicated uniquely.** 19,217,152 params. Layer cosines remain ~1.0.

## 69. PRODUCTION STATUS

`/Users/markbroughton/WarRoomNode01` **not touched**. WRIM-0 SHA unchanged. Official 000001/000002 and Recovery-008/009/010 registries untouched.

## 70. GIT STATUS

**No commit, push, merge, rebase, reset, or clean.** Inspect-only. This experiment added uncommitted TEST_ONLY scripts, manifests, and docs in the existing dirty worktree.

## 71. EXACT NEXT RECOMMENDATION

**STOP.** Do not start Recovery-012. Do not start WRIM1-RUN-000003. Do not promote. Do not touch production.

If Commander later authorizes **one** next isolation, candidates (pick one, not a bundle):

1. **Tool staging** (separate phase after a 010-like language-stable prefix).  
2. **Tool objective weight / exposure cap** (same V2 bytes, fewer steps hitting tool slots).  
3. **H3 CAUSAL↔MIXED freeze** with V2 held constant.

Do not choose automatically here. Compact V2 remains the preferred **model-side dialect** for a future Tool Router, but it is **not yet a proven stable curriculum**.

## 72. FINAL VERDICT

**WRIM-1.1 RECOVERY-011 — FAIL**

**WRIM-1.1 TOOL V2 — CAPABILITY ACQUISITION NOT DEMONSTRATED**

---

## NEXT STEPS FOR OPERATOR

1. Required environment changes — **No operator action required.**
2. Required SQL/migrations — **No operator action required.**
3. Restart requirements — **No operator action required.** Do not restart production.
4. Verification URLs/routes — **No operator action required.** Read `docs/WRIM1_1_RECOVERY_011_COMPACT_TOOL_INTENT_REPORT.md` and `model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-011/experiment-summary.json`.
5. Expected successful output — This run **FAIL**ed stability. Expected files exist: pack proofs, checkpoints 0–120, TOOL-EVAL-1 0/12, CAP-EVAL-0 ~18–19/86.
6. Feature flags enabled/disabled — **No operator action required.**
7. What should visibly change in UI — **Nothing.** Active model remains WRIM-0.
8. Safe rollback instruction if needed — Leave WRIM-0 and Recovery-010 artifacts in place. Discard only `TEST-WRIM1.1-RECOVERY-011/` plus this report if Commander rejects the experiment record. Do not revert Recovery-010.
