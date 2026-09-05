# WRIM-1.1 RECOVERY-010 — TOOL_USE SUPERVISED ISOLATION REPORT

Date: 2026-08-31  
Authorization: Commander TEST_ONLY Recovery-010 only. Not official WRIM-1.1. Not Recovery-011. Not WRIM1-RUN-000003. Not promotion. Not production. Not git commit/push.

## FINAL VERDICT

**WRIM-1.1 RECOVERY-010 — PASS**

TOOL_USE REMOVAL STABILITY — **CONFIRMED** (for this isolation: 250/250 without the 008/009 4/13 early-stop)  
Do **not** conclude tool training should be deleted permanently.  
WRIM1-RUN-000003 — **NOT YET AUTHORIZED**  
ACTIVE MODEL — **WRIM-0**  
PRODUCTION — **UNCHANGED**

Removing only the TOOL_USE supervised family from the Recovery-008 capability mix, replacing that window budget with WR-CORPUS-0 rehearsal, let training complete **250/250** under the same collapse gate that stopped Recovery-008 at 120 and Recovery-009 at 75.

---

## 1. EXPERIMENT ID

`TEST-WRIM1.1-RECOVERY-010`  
Runner: `scripts/wrim1-training/run_recovery_experiment_010.py`  
Pack: `scripts/wrim1-training/pack_recovery_010.py`  
Artifacts: `model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-010/`

Started from **WRIM-0**. Did **not** resume Recovery-008 or Recovery-009.

## 2. TEST_ONLY MARKERS

`TEST_ONLY=true`  
`NOT_PROMOTABLE=true`  
`NOT_OFFICIAL_WRIM_LINEAGE=true`  
`NOT_PRODUCTION=true`

Priors preserved: Recovery-001–009, WRIM1-RUN-000001, WRIM1-RUN-000002, official capability candidate pack.

## 3. PARENT / TOKENIZER PROOF

Parent WRIM-0 SHA: `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`  
`max_abs_diff = 0.0`. File SHA match. Tensor-tree SHA match (`8d0c903bbcd63f709114c1b69bd2d1136a20e5558f39acd3ad11f403064678b9`). Before optimizer step 1. Not a Recovery parent. Not an official-000002 resume.

Tokenizer WR-TOKENIZER-0 SHA: `47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7`

## 4. ENVIRONMENT PROOF

Invoked: `/Users/markbroughton/Developer/war-room-os/.venv-wrim/bin/python`  
Python **3.12.14** arm64. MLX **0.32.2**. Device **`Device(gpu, 0)`**. Environment gate passed.

## 5. RECOVERY-008 PACK IDENTITY

SHA `d098ddce732d1fd77ec64e75ab3979250f846cfd0f57d1fbb3f9065743645291`  
Byte-identical to WRIM1-RUN-000002. 686,070 tokens. Recovery-009 pack (`086f2385…`) was **not** used as the base.

## 6. RECOVERY-010 PACK IDENTITY

TEST_ONLY id: **`WR-CORPUS-1.1-RECOVERY-010-NO-TOOL`**  
SHA `af2a8224dc105b32febec9586f9e232e7974a0e60afd4b09c49c0c374ff58722`  
Length identical (686,070). Intentionally **not** byte-identical to 008. Non-tool windows: **1356/1356** byte-equal. TOOL_USE windows replaced: **88**. Window-byte proof passed.

## 7. TOOL-USE EXAMPLES REMOVED

**88** supervised tool-use windows → **0** training examples.  
Source list still contains 88 design examples (not packed). Packed origin `tool_use` count: **0**.

## 8. TOOL TARGET TOKENS REMOVED

**6,098** trainable target tokens (response-only mask on those 88 windows).  
Full window token budget removed (prompt + target): **23,415**.

## 9. REPLACEMENT REHEARSAL TOKENS

**23,415** WR-CORPUS-0 tokens (exact 1:1 window-length replacement).  
Rehearsal 008: 180,000 → 010: **203,415** (increase **23,415**).  
Not Recovery-009’s 358,129 / 52.2%. Unused WR-CORPUS-0 first. No new prose, JSON, code, or synthetic capability material.

## 10. FINAL PACK COMPOSITION

| Family | Recovery-008 | Recovery-010 |
|---|---:|---:|
| QUALITY_PROSE | 30.9091% (212,058) | 30.9091% (212,058) |
| WR-CORPUS-0 rehearsal | 26.2364% (180,000) | **29.6493% (203,415)** |
| QUALITY_CODE leftover | 25.9637% (178,129) | 25.9637% (178,129) **retained** |
| supervised (all packed) | 16.8908% (115,883) | **13.4779% (92,468)** |
| TOOL (supervised) | 3.4129% (23,415) | **0** |
| CODE_SUPERVISED | 1.7227% (11,819) | 1.7227% (11,819) |

Total token delta: **0**.

## 11. RETAINED SUPERVISED-FAMILY PROOF

Packed window counts:

| Family | Examples / windows |
|---|---:|
| instruction / behavior | 147 |
| JSON | 84 |
| WR concepts | 45 |
| evidence | 64 |
| synthetic correction | 48 |
| code-supervised | 70 |
| tool-use | **0** (was 88) |

Non-tool supervised windows byte-identical to Recovery-008. Passed.

## 12. HELD-OUT TOOL EVAL UNCHANGED

WRIM-1.1-CAP-EVAL-0 SHA `f27dd64bcc245e228a8e4f18bfd95fcd7d0ee7c32cfdee5d8d40519fd1c1406d`.  
EVAL-TOOL: **10/10** items retained. Suite not rewritten. `eval-identity.json` passed.

## 13. LEAK RESULT

**0** known eval leakage. Example leak 0. Stream leak scan passed. Training was allowed.

## 14. PACKING PROOF

008 deficit interleave of 2048-token windows preserved. 010 does not re-interleave. TOOL_USE windows substituted in place. Split preserves tokens. 1444 windows. No token-level shuffle. PASS.

## 15. CAUSAL PROOF

`y[t]==x[t+1]` mismatches: **0** (12-batch audit; also checked every train step).

## 16. MASK PROOF

PASS. Remaining supervised response-only after `<|assistant|>` (92,468 ok, 0 bad). LM units full causal 986/986. Prompt masked 53,709. Supervised targets 38,759 (44,857 − 6,098 tool targets).

## 17. WINDOW COMPARABILITY MAP

Files: `window-mapping-008-to-010.json`, `step-mapping-008-to-010.json`.

- 1444 windows; **88** changed (TOOL_USE → rehearsal); **1356** unchanged.  
- Seq starts identical (0 mismatches) for all 250 planned steps.  
- Mix changed on **53** planned steps (supervised_pct down, rehearsal_pct up on former tool windows).  
- Planned CAUSAL↔MIXED switches: 008 **204** → 010 **158** (algorithm unchanged; tool windows no longer count as supervised).

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

Peak 3e-5. Warmup 25. Cosine horizon 150. Floor 3e-6. Not stretched to 502.

## 19. OPTIMIZER

AdamW. β1=0.9 β2=0.95 ε=1e-8 weight decay 0.1 clip 1.0. Fresh optimizer state. Unchanged.

## 20. PLANNED / COMPLETED STEPS

Planned: **250**. Completed: **250**. Tokens seen: **1,024,000**. Wall: **1015.1 s**.

## 21. EARLY-STOP STATUS

Did **not** fire. Same `collapse_gate_008` as Recovery-008/009 (not weakened). No NaN/Inf. No crash. TOOL_USE training batches: **0**.

## 22. COLLAPSE TREND

| Step | 010 | 008 | 009 |
|---:|---:|---:|---:|
| 0 | 2/13 | 2/13 | 2/13 |
| 25 | 1/13 | — | 2/13 |
| 50 | 1/13 | 1/13 | 1/13 |
| 75 | **1/13** | 1/13 | **4/13 STOP** |
| 100 | **2/13** | 2/13 | not reached |
| 120 | **3/13** | **4/13 STOP** | not reached |
| 150 | 3/13 | not reached | not reached |
| 200 | 2/13 | not reached | not reached |
| 250 | 3/13 | not reached | not reached |

## 23. UNIQUE-RATIO TREND

0: 0.397 → 25: 0.377 → 50: 0.375 → 75: **0.478** → 100: 0.466 → 120: 0.445 → 150: 0.430 → 200: 0.438 → 250: 0.406.

008 at 75/100: 0.462 / 0.430. 009 at 75: **0.313**. 010 unique-ratio is better than 009 at the 009 failure point and does not crash through 250.

## 24. REPETITION TREND

Sky-probe underscore runs: WRIM-0 residual at step 0 (25), dip mid-run, then ~26 from step 100–220, 23 at 250. Pipe runs: 0. Unique-ratio never collapsed to 0.5× step-0. 13-probe suite never reached 4/13.

## 25. UNDERSCORE / `_not_` / `-lab` / model-lab TRACE

Residual WRIM-0-class noise **did not disappear**. It also **did not escalate** to the 008/009 early-stop class (4/13 + corroborated loop).

- Steps ~40–70: `-lab` letter-loop on sky (also present on 008/009 at 50).  
- From ~90: `_not_` + underscore fill on sky (`underscore_run` 14 then 26).  
- `not_loop` flag true at 130–160 and again ~225–250 (`_not_` count 4), with collapse still 2–3/13.  
- P("_") stayed ~0.0051–0.0061 (not a 0.15 symbol-mode). P("|") ~0.0008–0.001. P(".") ~0.002.

Interpretation: the **suite-wide 4/13 stop** of 008/009 is prevented; local sky-probe garbage remains a parent-distribution leftover, not a new dominant loop class.

## 26. TRAIN-LOSS TREND

Step 25: 7.69 → 50: 6.35 → 75: 5.55 → 100: 5.80 → 120: 7.22 (batch mix) → 150: 6.19 → 200: 6.76 → 250: 5.71. Finite throughout.

## 27. SUPERVISED CE TREND

Mean aggregate supervised CE (batches that contained a retained supervised family):

| Window | n batches | mean sup CE |
|---|---:|---:|
| 1–25 | 25 | 7.59 |
| 26–50 | 25 | 8.13 |
| 51–75 | 15 | 8.27 |
| 76–100 | 2 | 7.09 |
| 101–120 | 20 | 7.02 |
| 121–150 | 30 | 7.01 |
| 151–200 | 50 | 7.08 |
| 201–250 | 32 | 7.95 |

Aggregate supervised CE **rises early** then **settles ~7.0** through the 008/009 failure region, with a late uptick. It does **not** show 009’s pattern of collapsing diagnostics while only easy LM loss improves. TOOL CE: n = 0 (absent).

## 28. PER-FAMILY CE (spot)

Examples (when that family is in-batch):

- instruction step 1: 7.63; step 25: 7.27; step 200: 6.87  
- JSON step 50: 8.64  
- WR concept step 100: 7.03  
- evidence step 120: 7.07  
- correction step 150: 7.02  
- QUALITY_CODE leftover remains in mix (CE ~7.1–7.8)  
- REHEARSAL CE ~4.3–5.7 (easier, as expected)

## 29. GRAD NORM BY FAMILY (dominant-class batches)

| Dominant | n | mean | median | max |
|---|---:|---:|---:|---:|
| REHEARSAL | 125 | 0.633 | 0.607 | 1.068 |
| QUALITY_PROSE | 97 | 0.833 | 0.772 | 1.289 |
| QUALITY_CODE | 28 | 0.924 | 0.912 | 1.331 |
| TOOL | **0** | — | — | — |

Other supervised families were rarely the *dominant* class of a full 4096-token step; their CE is in `family-loss.json`.

## 30. CLIP EVENTS

**29** clip events (grad L2 > 1.0). First switches into MIXED often clip (e.g. step 2 grad 1.33). No clip storm.

## 31. TARGET-DENSITY STATISTICS

All 250 batches: mean **0.925**, median 0.920, min 0.797, max 1.0.  
CAUSAL (n=134): mean 0.964. MIXED (n=116): mean 0.879. Normalization unchanged.

## 32. KL TREND (WRIM-0 → current)

0: 0 → 25: 0.017 → 50: 0.034 → 75: 0.033 → 100: 0.032 → 120: 0.033 → 150: 0.036 → 200: 0.037 → 250: **0.038**. Flattening, similar to Recovery-007 endurance (0.036 at 150).

## 33. PARAM L2 TREND

0 → 25: 1.11 → 50: 2.74 → 75: 3.84 → 100: 4.40 → 120: 4.68 → 150: 4.88 → 200: 5.07 → 250: **5.29**. Decelerating. Relative drift at 250: **0.020**.

## 34. LAYER-DRIFT TREND

Per-layer cosine to WRIM-0 at 250: all layers **≥ 0.99970**; `norm_f` ≈ 1.0; `tok_emb` 0.99985. No layer blow-up.

## 35. STEP-50 COMPARISON

010 vs 008: collapse 1/13 = 1/13; unique 0.375 = 0.375; train loss 6.354 = 6.354; KL/L2 match to ~1e-8. Same `-lab` sky. Tool removal has not yet diverged the run.  
010 vs 009: unique 0.375 vs **0.327**; 009 already worse.

## 36. STEP-75 COMPARISON

010: **1/13**, unique **0.478**, loss 5.55.  
008: 1/13, unique 0.462, loss 5.66.  
009: **4/13 STOP**, unique **0.313**, loss 5.16.  
010 survives the 009 failure region.

## 37. STEP-100 COMPARISON

010: **2/13**, unique 0.466, LR 1.27e-5.  
008: 2/13, unique 0.430.  
Cap-eval 010: **20/86** vs baseline 18/86.

## 38. STEP-120 COMPARISON

010: **3/13**, unique 0.445, continues.  
008: **4/13 STOP** (underscore-loop class).  
010 survives the 008 failure region.

## 39. STEP-150 STATUS

Cosine complete. LR floor 3e-6 from here. Collapse 3/13. Unique 0.430. Cap-eval **18/86** (RETENTION 5/6 this snapshot). Floor hold **reached** (008 never did).

## 40. STEP-200 STATUS

Collapse 2/13. Unique 0.438. KL 0.037. L2 5.07. Cap-eval **19/86**. RETENTION 6/6.

## 41. STEP-250 STATUS

Collapse **3/13**. Unique 0.406. KL 0.038. L2 5.29. Cap-eval **19/86**. Checkpoints 0…250 all reload. Final SHA `aa0e9238d2395939a33f372613814d6e61ed61b827e6fbf9d862d5ad2bc2bcca`.

## 42–48. CAPABILITY EVAL (WRIM-1.1-CAP-EVAL-0)

Inference-only. Baseline WRIM-0 = 18/86.

| Step | Total | LANG | INSTRUCT | JSON | CODE | WR | EVIDENCE | TOOL | CORRECTION | RETENTION |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 18/86 | 7/8 | 3/12 | 0/10 | 0/8 | 1/12 | 0/12 | 0/10 | 1/8 | 6/6 |
| 75 | 18/86 | 6/8 | 3/12 | 0 | 0 | 2/12 | 0 | 0/10 | 1/8 | 6/6 |
| 100 | **20/86** | 8/8 | 3/12 | 0 | 0 | 2/12 | 0 | 0/10 | 1/8 | 6/6 |
| 120 | **20/86** | 8/8 | 3/12 | 0 | 0 | 2/12 | 0 | 0/10 | 1/8 | 6/6 |
| 150 | 18/86 | 8/8 | 3/12 | 0 | 0 | 1/12 | 0 | 0/10 | 1/8 | 5/6 |
| 200 | 19/86 | 8/8 | 3/12 | 0 | 0 | 1/12 | 0 | 0/10 | 1/8 | 6/6 |
| 250 | 19/86 | 8/8 | 3/12 | 0 | 0 | 1/12 | 0 | 0/10 | 1/8 | 6/6 |

Capability improvement is **not** required for PASS and was **not** achieved in a meaningful P0 sense.

## 49. TOOL HELD-OUT TREND

**0/10 at every measured step**, including step 0. Removing tool *training* did not create a new TOOL eval failure (it was already 0). Indirect TOOL transfer: none observed.

## 50. OTHER P0 CAPABILITY TRENDS

LANG: 7 → 8 (from step 100). INSTRUCT: 3/12 flat. JSON/EVIDENCE/CODE: 0. WR: 1–2/12. RETENTION: 6/6 except 5/6 at 150.

## 51. CAUSAL ↔ MIXED SWITCH COUNT

Observed: **158** switches in 250 steps.  
Planned: 158 (010) vs 204 (008). Switcher **algorithm unchanged**. Fewer MIXED steps because tool windows no longer contribute supervised_pct.

## 52. SWITCH-ASSOCIATED LOSS / GRAD

Typical MIXED entry: loss jumps ~6.4 → ~7.6–7.9 and grad often clips. Return to CAUSAL: loss drops ~7.5 → ~5.7. Pattern is **controlled and visible**, same qualitative H3 signature as 008, without 4/13 collapse.

## 53. TOOL_USE HYPOTHESIS VERDICT

**STRONGLY SUPPORTED as an interaction with the 008/009 early-stop failure.**  
Removing only TOOL_USE training (H2) let the run pass both prior failure regions and finish 250.  
This does **not** authorize deleting tools from future curricula. Next work (not authorized here) should test: more diverse tool templates, less repetition, separate phase, lower objective weight, different masking/format, or different interleaving.

## 54. OBJECTIVE-SWITCHING HYPOTHESIS STATUS

H3 is **not eliminated**. Switching still occurred (158). It is **no longer the strongest sole explanation** of the 008/009 4/13 stop, because 010 kept the same switcher and survived. H3 remains a live variable for any later isolation (Recovery-011 is **not** started).

## 55. CURRICULUM ASSESSMENT

Recovery-008 mix **minus tool-supervised windows**, plus 23,415 rehearsal tokens, is **stable enough** under this LR/optimizer to finish 250 without the previous early-stop. QUALITY_CODE leftover was **retained** (248 batches) and is **not sufficient** as the 4/13 driver (009 already showed that; 010 confirms with code still present). Do not auto-delete code. Do not auto-delete tools permanently.

## 56. OPTIMIZER ASSESSMENT

Not indicated. Same AdamW. 29 clips. No NaN.

## 57. ARCHITECTURE ASSESSMENT

Insufficient evidence to blame capacity. Layer cosines remain ~1. Collapse stayed near WRIM-0 (2–3/13).

## 58. PRODUCTION STATUS

`/Users/markbroughton/WarRoomNode01` **not touched**. WRIM-0 SHA unchanged. 000001/000002/008/009 registries untouched. No deploy, restart, production SQL, or active-model replacement.

## 59. GIT STATUS

No commit, push, merge, rebase, reset, or clean. Dirty worktree of unrelated and AGI files remains. Commander did not authorize git.

## 60. EXACT NEXT RECOMMENDATION

**STOP.** Return this packet to Commander.

Do **not** start Recovery-011, WRIM1-RUN-000003, promotion, or WRIM-1.2.

If later authorized, the highest-information follow-ups are: (a) restore TOOL_USE with **diversified / down-weighted / phased** templates rather than deletion; (b) only then consider H3 (objective-switch redesign) as a separate single-variable test.

## 61. FINAL VERDICT

**WRIM-1.1 RECOVERY-010 — PASS**

---

WRIM-1.1 RECOVERY-010 — PASS  
TOOL_USE REMOVAL STABILITY — CONFIRMED  
WRIM1-RUN-000003 — NOT YET AUTHORIZED  
ACTIVE MODEL — WRIM-0  
PRODUCTION — UNCHANGED

STOP AFTER RECOVERY-010.  
RETURN RESULTS TO COMMANDER.
