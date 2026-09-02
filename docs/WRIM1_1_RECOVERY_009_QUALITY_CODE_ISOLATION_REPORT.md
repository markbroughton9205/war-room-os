# WRIM-1.1 RECOVERY-009 — QUALITY_CODE ISOLATION REPORT

Date: 2026-08-31  
Authorization: Commander TEST_ONLY Recovery-009 only. Not official WRIM-1.1. Not Recovery-010. Not WRIM1-RUN-000003. Not promotion. Not production. Not git commit/push.

## FINAL VERDICT

**WRIM-1.1 RECOVERY-009 — FAIL**

H1 QUALITY_CODE interaction — **NOT SUFFICIENT**  
WRIM1-RUN-000003 — **NOT READY**  
ACTIVE MODEL — **WRIM-0**  
PRODUCTION — **UNCHANGED**

Removing leftover QUALITY_CODE and replacing that token budget with WR-CORPUS-0 rehearsal did **not** prevent degeneration. Collapse arrived **earlier** than Recovery-008 (step **75** vs step **120**), with the same underscore / `-lab` loop class.

---

## 1. EXPERIMENT ID

`TEST-WRIM1.1-RECOVERY-009`  
Runner: `scripts/wrim1-training/run_recovery_experiment_009.py`  
Pack: `scripts/wrim1-training/pack_recovery_009.py`  
Artifacts: `model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-009/`

Started from **WRIM-0**. Did **not** resume Recovery-008.

## 2. TEST_ONLY MARKERS

`TEST_ONLY=true`  
`NOT_PROMOTABLE=true`  
`NOT_OFFICIAL_WRIM_LINEAGE=true`  
`NOT_PRODUCTION=true`

Priors preserved: Recovery-001–008, WRIM1-RUN-000001, WRIM1-RUN-000002. Official candidate corpus not modified in place.

## 3. PARENT / TOKENIZER PROOF

Parent WRIM-0 SHA: `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`  
`max_abs_diff = 0.0`. File SHA match. Tensor-tree SHA match (`8d0c903bbcd63f709114c1b69bd2d1136a20e5558f39acd3ad11f403064678b9`). Before optimizer step 1. Not a Recovery parent. Not an official-000002 resume.

Tokenizer WR-TOKENIZER-0 SHA: `47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7`

## 4. ENVIRONMENT PROOF

Invoked: `/Users/markbroughton/Developer/war-room-os/.venv-wrim/bin/python`  
Python **3.12.14** arm64. MLX **0.32.2**. Device **`Device(gpu, 0)`**. Environment gate passed.

## 5. RECOVERY-008 PACK IDENTITY

SHA `d098ddce732d1fd77ec64e75ab3979250f846cfd0f57d1fbb3f9065743645291`  
Byte-identical to WRIM1-RUN-000002. 686,070 tokens.

## 6. RECOVERY-009 PACK IDENTITY

TEST_ONLY SHA `086f23858932b4a1beaedd286922e8e01e77b9469de90183cb8d8cce95c4fe8d`  
Length identical (686,070). Intentionally **not** byte-identical to 008. Non-QUALITY_CODE windows: **1061/1061** byte-equal. QUALITY_CODE windows replaced: **383**. Window-byte proof passed.

## 7. QUALITY_CODE TOKENS REMOVED

**178,129** leftover QUALITY_CODE tokens (383 windows). Ordinary leftover family count after rebuild: **0**.

## 8. REHEARSAL TOKENS ADDED

**178,129** WR-CORPUS-0 tokens (exact 1:1 replacement of window lengths).  
Rehearsal 008: 180,000 → 009: **358,129** (increase **178,129**). Unused WR-CORPUS-0 first, then wrap of parent-distribution tokens. No new prose. No new synthetic data.

## 9. FINAL CURRICULUM PERCENTAGES

| Family | Recovery-008 | Recovery-009 |
|---|---:|---:|
| QUALITY_PROSE | 30.9091% (212,058) | 30.9091% (212,058) |
| WR-CORPUS-0 rehearsal | 26.2364% (180,000) | **52.2001% (358,129)** |
| QUALITY_CODE leftover | 25.9637% (178,129) | **0** |
| supervised (all families) | 16.8908% (115,883) | 16.8908% (115,883) |
| CODE_SUPERVISED | 1.7227% (11,819) | 1.7227% (11,819) |
| TOOL | 3.4129% | 3.4129% |

Total token delta: **0**.

## 10. SUPERVISED-SET IDENTITY PROOF

Unchanged example counts:

| Family | Examples |
|---|---:|
| instruction / behavior | 147 |
| tool-use | 88 |
| JSON | 84 |
| WR concepts | 45 |
| evidence | 64 |
| synthetic correction | 48 |
| code-supervised | 70 |

Passed.

## 11. CODE-SUPERVISED EXAMPLES RETAINED

70/70 windows. Token bytes equal to Recovery-008. Bounded supervised CODE family was **not** removed.

## 12. LEAK RESULT

**0** known eval leakage. Example leak 0. Stream leak scan passed. Training was allowed.

## 13. PACKING PROOF

008 deficit interleave of 2048-token windows preserved. 009 does not re-interleave. QUALITY_CODE windows substituted in place. Split preserves tokens. 1444 windows. No token-level shuffle. PASS.

## 14. CAUSAL PROOF

`y[t]==x[t+1]` mismatches: **0** (12-batch audit; also checked every train step).

## 15. MASK PROOF

PASS. Supervised response-only after `<|assistant|>` (115,883 ok, 0 bad). LM units full causal 898/898. Prompt masked 71,026. Supervised targets 44,857.

## 16. INTERLEAVING / LOCAL MIX

Deterministic local mix. Longest 100% rehearsal-only run: **0**. Longest non-rehearsal-only run: **0**.  
Mechanical effect of substitution: dominant `wr_corpus_0` for 16 consecutive steps [58, 73] (those steps were mixed, not 99% rehearsal). 99% rehearsal binge gate held. Seq starts identical to 008 for all 250 planned steps.

Rolling composition is in `planned-step-source-map.json` (`rolling_5`, `rolling_10`).

## 17. RECOVERY-008 → RECOVERY-009 WINDOW MAPPING

File: `window-mapping-008-to-009.json` and `step-mapping-008-to-009.json`.

- 1444 windows; 383 changed (QUALITY_CODE → rehearsal); 1061 unchanged.  
- Seq starts identical (0 mismatches).  
- 248/250 planned steps had QUALITY_CODE exposure in 008; **0** in 009.  
- Only mix field that changes in those steps: `code_pct` → `rehearsal_pct`.

## 18. LR SCHEDULE

Identical to Recovery-008:

```
if step < 25:  lr = 3e-5 * (step+1)/25
elif step <= 150:
    progress = min(1, (step-25)/(150-25))
    cosine = 0.5 * (1 + cos(pi * progress))
    lr = 3e-5 * (0.1 + 0.9 * cosine)
else: hold 3e-6
```

Peak 3e-5. Warmup 25. Cosine horizon 150. Floor ~3e-6. Matched Recovery-007 through 150. Not stretched to 502.

Observed at stop (step 75 optimizer index 74): **~2.10e-5** (same formula as 008 at that step).

## 19. OPTIMIZER

AdamW. β1=0.9 β2=0.95 ε=1e-8 weight decay 0.1 clip 1.0. Fresh optimizer state. Unchanged.

## 20. PLANNED / COMPLETED STEPS

Planned: **250**. Completed: **75**. Tokens seen: **307,200**. Wall: **300.2 s**.

## 21. EARLY-STOP RESULT

Stopped at step **75**. Reason: `collapsed probes exceed step-0 with corroborating loop/run evidence`.  
No NaN/Inf. No crash. Same `collapse_gate_008` as Recovery-008 (not weakened).

## 22. COLLAPSE TREND

| Step | 009 collapse | 008 collapse |
|---:|---:|---:|
| 0 | 2/13 | 2/13 |
| 25 | 2/13 | (008 healthier later) |
| 50 | 1/13 | — |
| 75 | **4/13 STOP** | **1/13** |
| 100 | not reached | 2/13 |
| 120 | not reached | 4/13 STOP |

## 23. UNIQUE-RATIO TREND

0: 0.397 → 25: 0.353 → 50: 0.327 → 75: **0.313**.  
008 at 75: **0.462**. 009 unique-ratio is worse throughout the overlapping window.

## 24. REPETITION TREND

Sky probe developed `-lab` loops by step 40–50, then underscore `_not_` runs at 75 (`underscore_run=23`). Letter-loop detector true from light diagnostics onward (WRIM-0 residual underscore noise exists at step 0; the new `-lab` / `_not_` class is the degeneration).

## 25. UNDERSCORE / `_not_` / MODEL-LAB TRACE

| Step | underscore_run | `_not_` count | model-lab / `-lab` hits | sky (truncated) |
|---:|---:|---:|---:|---|
| 0 | 25 | 0 | 5 | ` a` then tokenizer underscores (WRIM-0 residual) |
| 25 | 14 | 2 | 17 | `_not______________` |
| 40 | 0 | 0 | 62 | `##-lab-lab-lab-...` |
| 50 | 0 | 0 | 58 | `##-lab-lab-lab-...` |
| 75 | 23 | 2 | 15 | `_not_______________________` |

Degeneration is the same class as Recovery-008 (underscore / `_not_` / model-lab fragments), arriving earlier.

## 26. TRAIN-LOSS TREND

25: 6.84 → 50: 5.67 → 75: **5.16**. Training CE fell while diagnostics worsened (same pattern as 008 forensics: train CE down, held-out capability/stability not up).

Validation: 0: 7.75 → 75: 7.44.

## 27. FAMILY CE TREND

Bucket CE (positions mapped to stream family):

| Window | prose | wr_corpus_0 | supervised |
|---|---:|---:|---:|
| steps 1–25 mean | 7.80 | 4.75 | 7.65 |
| steps 50–75 mean | 7.43 | 4.63 | **8.12** |
| step 75 | 6.85 | 4.35 | 7.64 |

Rehearsal CE stays easy. Supervised CE does not improve. QUALITY_CODE CE is absent (0 leftover batches).

## 28. GRAD NORM BY FAMILY

Dominant-class of each batch (008 forensic method):

| Class | n | mean | median | max |
|---|---:|---:|---:|---:|
| REHEARSAL | 64 | 0.652 | 0.633 | 1.043 |
| QUALITY_PROSE | 11 | 0.786 | 0.724 | 1.168 |
| QUALITY_CODE | **0** | — | — | — |

QUALITY_CODE had **0 training batches**, as required. Supervised families never dominated a batch after the substitution (rehearsal 52% of the mix).

## 29. CLIP EVENTS

**3** clips: steps **2, 25, 67**. Step 67 is a MIXED batch with tool_pct 22.7%.

## 30. KL TREND

0: 0 → 25: 0.010 → 50: 0.022 → 75: **0.025**.  
008 at 75: **0.036**. 009 KL is *lower* at the same step; KL did not warn before collapse.

## 31. PARAMETER L2 TREND

0: 0 → 25: 0.95 → 50: 2.35 → 75: **3.31**.  
008 at 75: **3.88**. Smaller L2, worse collapse — drift magnitude is not the discriminator.

## 32. LAYER DRIFT

Broad. Cosines remain ≥0.99986 at step 75. Lowest layers ~layers.1/2. `tok_emb` cosine 0.999954. Embedding-led, not a single-row spike. Same qualitative picture as 008 forensics.

## 33. STEP-75 COMPARISON (critical)

| Metric | Recovery-009 | Recovery-008 |
|---|---:|---:|
| collapse | **4/13 STOP** | 1/13 |
| unique | 0.313 | 0.462 |
| LR | 2.10e-5 | 2.10e-5 |
| KL | 0.025 | 0.036 |
| param L2 | 3.31 | 3.88 |
| train loss | 5.16 | 5.66 |
| grad L2 | 0.62 | 0.67 |
| sky | `_not_` run | Gryphon prose |

009 is **worse** than 008 at the first shared full-diagnostic checkpoint after warmup.

## 34. STEP-100 COMPARISON

009 **did not reach** step 100. 008: collapse 2/13, unique 0.430, LR 1.27e-5, KL 0.038, L2 4.54, cap-eval 18/86.

## 35. STEP-120 COMPARISON

009 **did not reach** step 120. 008 stopped here at 4/13.

## 36. STEP-150 STATUS

Not reached. Floor hold never started.

## 37. STEP-200 STATUS

Not reached.

## 38. STEP-250 STATUS

Not reached. 75/250.

## 39–43. CAPABILITY SCORES

WRIM-1.1-CAP-EVAL-0, inference-only.

**Step 0 (WRIM-0):** **18/86**  
LANG 7/8, INSTRUCT 3/12, JSON 0/10, CODE 0/8, WR 1/12, EVIDENCE 0/12, TOOL 0/10, CORRECTION 1/8, RETENTION **6/6**.

**Steps 100, 150, 200, 250:** not run (early stop at 75). No later capability measurement.

## 44. RETENTION TREND

6/6 at step 0 only. Not re-measured at stop.

## 45. TOOL-USE SECONDARY HYPOTHESIS (H2)

Tool_use was **not** modified. Tool-associated steps (≥15% TOOL tokens): **67, 71, 73**. Stop at 75 immediately after that cluster. Clip also at 67.

However, `-lab` loops were already present at steps **40 and 50**, before those tool-heavy batches. Tool data remains a plausible amplifier, not a sufficient unique cause of *onset*. H2 is **not isolated**; it is **not ruled out**.

## 46. OBJECTIVE-SWITCHING EVIDENCE (H3)

Switching semantics unchanged. **58** CAUSAL ↔ MIXED transitions in 75 steps. Alternation remains dense (example 60–75: CAUSAL/MIXED every step). 009 failed **despite** QUALITY_CODE removal and **with** similar switching. H3 remains **plausible**. Not isolated here.

## 47. QUALITY_CODE HYPOTHESIS VERDICT (H1)

**QUALITY_CODE REMOVAL — NOT SUFFICIENT.**

H1 is **not strongly supported**. Leftover QUALITY_CODE was a high-gradient family in 008 forensics, but deleting it and filling the budget with parent rehearsal produced **earlier** collapse, not later survival.

Do **not** automatically delete code from future WRIM training. This test does not prove QUALITY_CODE is harmless; it proves that **removing it is not enough** and that the replacement (52% rehearsal) plus remaining mix is still unstable.

## 48. CURRICULUM ASSESSMENT

The remaining 009 mix is QUALITY_PROSE + doubled rehearsal + unchanged supervised (including tool, JSON, WR, evidence, instruction, correction, **and** code-supervised). Train loss still falls. Held-out capability was only measured at 0. Stability is worse than 008 around the first 75 steps.

Likely remaining drivers (not ranked as a new authorized experiment):

1. Unchanged supervised/tool templates (H2).  
2. Frequent CAUSAL/MIXED switching (H3).  
3. Rehearsal overshoot to 52% (authorized replacement side-effect; Recovery-007 was stable near 30%).  
4. QUALITY_PROSE leftover.  
5. Interaction among the above.

## 49. WHETHER FUTURE CODE SHOULD BE FILTERED / REDUCED / PHASED

**Do not automatically delete or globally ban code.**  
QUALITY_CODE leftover may still need filtering, lower proportion, a separate phase, or different interleaving — but this isolation test failed, so any such treatment requires a **new Commander authorization**. Code-supervised examples were retained and are not implicated by this FAIL as a unique cause.

## 50. OPTIMIZER ASSESSMENT

Hold. Same AdamW / clip / decay as 008. Not the isolation variable. 3 clips, no explosion.

## 51. ARCHITECTURE ASSESSMENT

Unchanged. **INSUFFICIENT EVIDENCE OF CAPACITY LIMIT.** Failure is still a curriculum/stability interaction, not a proven 19.2M capacity wall.

## 52. PRODUCTION STATUS

`/Users/markbroughton/WarRoomNode01` **not touched**. No deploy, restart, SQL, or model replacement. WRIM-0 SHA unchanged. Official 000001/000002 registries untouched. Recovery-008 registry untouched.

## 53. GIT STATUS

No commit. No push. No merge/rebase/reset. Dirty worktree from prior AGI work remains; this experiment added TEST_ONLY scripts, artifacts, and docs only.

## 54. EXACT NEXT RECOMMENDATION

**STOP AFTER RECOVERY-009.**

Do **not** start Recovery-010.  
Do **not** start WRIM1-RUN-000003.  
Do **not** promote.  
Do **not** start WRIM-1.2.  
Do **not** touch production.

Return results to Commander. Any next isolation (tool_use ablation, switching freeze, rehearsal-fraction control, QUALITY_PROSE ablation) needs a **new explicit authorization**.

## 55. FINAL VERDICT

**WRIM-1.1 RECOVERY-009 — FAIL**

---

## NEXT STEPS FOR OPERATOR

1. Required environment changes — **No operator action required.**
2. Required SQL/migrations — **No operator action required.**
3. Restart requirements — **No operator action required.** Production was not touched.
4. Verification URLs/routes — **No operator action required.** Read `docs/WRIM1_1_RECOVERY_009_QUALITY_CODE_ISOLATION_REPORT.md` and `model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-009/`.
5. Expected successful output — This experiment **FAIL**ed. Expected FAIL artifacts: `experiment-summary.json` verdict `WRIM-1.1 RECOVERY-009 — FAIL`, early stop step 75, QUALITY_CODE leftover 0.
6. Feature flags enabled/disabled — **No operator action required.**
7. What should visibly change in UI — **Nothing.** Active model remains WRIM-0.
8. Safe rollback instruction if needed — **No operator action required.** WRIM-0 remains the parent. Delete only the TEST-WRIM1.1-RECOVERY-009 directory if discarding TEST_ONLY artifacts; do not delete WRIM-0, Recovery-008, or official 000002.
