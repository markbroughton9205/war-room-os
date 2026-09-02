# WRIM-1.1 SMALL RECOVERY EXPERIMENT REPORT

Date: 2026-08-30  
Authoritative repo: `/Users/markbroughton/Developer/war-room-os`  
Production: `/Users/markbroughton/WarRoomNode01` — **not modified**  
Git: **no commit, no push**

## BINARY VERDICT

**WRIM-1.1 SMALL RECOVERY EXPERIMENT — FAIL**

The token-shuffle packing bug is **corrected** and was **not** the WRIM-1 period-argmax mode in this run. The experiment still **did not** preserve WRIM-0 language through the planned 150 steps. Hard early stop fired at **step 100** when diagnostic collapse reached **6/13**. Official WRIM1-RUN-000002 is **not** authorized by this result.

---

## 1. EXPERIMENT ID

`TEST-WRIM1.1-RECOVERY-001`

Artifacts: `model-lab/manifests/wrim1_1_recovery/test-only/`

## 2. TEST_ONLY STATUS

`TEST_ONLY` / `NOT_PROMOTABLE` / `NOT_OFFICIAL_WRIM_LINEAGE` / `NOT_PRODUCTION`

This is **not** WRIM1-RUN-000002.

## 3. WRIM-0 PARENT SHA

File SHA-256: `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`  
Loaded tensor-tree SHA-256 matches parent tensors: `8d0c903bbcd63f709114c1b69bd2d1136a20e5558f39acd3ad11f403064678b9`  
`max_abs_diff = 0.0` before the first optimizer step. Proof: `wrim0-load-proof.json`. Step-0 checkpoint SHA equals that tree.

## 4. TOKEN SHUFFLE FIX

`scripts/wrim1-training/dataset_cursor.py`: `epoch_stream` is now an identity (contiguous). The WRIM-1 collapse path is preserved only as `legacy_token_permutation_stream` for diagnosis.

Shuffle, when used, is `permute_unit_order` (document/chunk **units**), not individual tokens.

## 5. CONTIGUOUS PACKING PROOF

`python3 scripts/wrim1-training/prove_recovery_packing.py` — **6/6 PASS** (known-string tokenize→pack→retrieve; unit shuffle vs intra-unit tokens; EOS target shift; masks).

## 6. VALIDATION PACKING FIX

Validation uses the same `next_batch` contiguous windows and the same BOS/EOS-wrapped source units, in **frozen (unshuffled) unit order**. Seed 0. Not the legacy token permutation.

## 7. EOS OLD COUNT/RATE

WRIM-1 official train.npy (diagnosis): **30 EOS / 3,874,900 tokens**  
EOS per 1K: **0.00774** (~129k tokens/EOS)

## 8. EOS EXPERIMENT COUNT/RATE

Recovery train stream: **585 EOS / 456,085 tokens**  
EOS per 1K: **1.283**  
EOS per unit: **1.0** (one EOS at each independent source/document/behavior unit; same-file chunks concatenated in offset order without extra EOS)

Materially repaired. Not flooded (one boundary token per independent unit).

## 9. TRAIN DATA MIX

Measured token percentages on the packed experiment stream (not fabricated):

| Bucket | tokens | % |
|---|---:|---:|
| WR-CORPUS-0 rehearsal | 176,935 | 38.79 |
| prose/docs | 136,005 | 29.82 |
| code | 102,132 | 22.39 |
| JSON | 34,363 | 7.53 |
| behavior | 6,650 | 1.46 |
| other | 0 | 0.00 |
| **total** | **456,085** | 100 |

Available cleaned hardened tokens (before sampling): prose 671,712; code 2,995,634; JSON 183,567; other 0. Code was **downsampled**; the official 77.6% code mix was **not** reused.

## 10. WR-CORPUS-0 REHEARSAL SHARE

**38.79%** of experiment tokens (target was 15%). Overshoot is because remaining WR-CORPUS-0 train documents after dropping the Alice/held-out document are large wholes (2 of 4 clean docs packed; Alice document dropped: 1). Not duplicated many times. Unique WR-CORPUS-0 rehearsal tokens: **176,935**.

## 11. EVAL-INFRA EXCLUSIONS

**68** train/val records excluded by content and path markers (heldOut/eval/behavior source, takeover report, fingerprints, frozen prompt strings). Examples include `lib/wrim1-dataset/behavior.ts` and `docs/WAR_ROOM_AGI_MASTER_TAKEOVER_REPORT.md`.

## 12. HELD-OUT LEAK SCAN

Packed unit decode scan against frozen Wave 8.1 held-out **prompt strings**: **0 hits**. Experiment was allowed to start.

## 13. BEHAVIOR MASKING

31 clean behavior examples. Loss mask: tokens at/before `<|assistant|>` masked; response (and following EOS) unmasked. Raw LM units: full causal mask. Proof in packing tests.

## 14. LEARNING RATE

Peak **3e-4** (10× below Genesis/WRIM-1 3e-3). Warmup 25 of 150, cosine to 10% floor. Justified as continued pretrain from a finished WRIM-0, not from-scratch Genesis. No extra LR sweep (not required). At early stop, LR ≈ 1.27e-4.

## 15. OPTIMIZER CONFIG

Fresh **AdamW** (not inherited from WRIM-1). betas `(0.9, 0.95)`, eps `1e-8`, weight decay `0.1`, gradient clip `1.0`, grad accum `1`, fp32. Scheduler: linear warmup + cosine decay.

## 16. PLANNED STEPS

**150** (batch 8 × ctx 512 = 4,096 tokens/step; ~614k tokens if completed).

## 17. COMPLETED STEPS

**100**. Wall clock ~512 s (~8.5 min) plus packing.

## 18. EARLY STOP STATUS

**YES.** Reason: `diagnostic suite collapsed (>=6/n)` at step **100**. Did not continue to 150.

## 19. STEP-0 DIAGNOSTIC

Same greedy generator as collapse diagnosis (`diagnose_collapse.generate`).

Prompt `The sky is`: continuation starts ` a\n}_tokenizer_tokenizer…`  
Argmax next token: ` a` (p≈0.077). P(`.`)≈0.0010. Entropy≈6.03. Finite. Collapsed probes **2/13**. Matches WRIM-0 diagnosis (word-like argmax, not period mode; weak tokenizer-underscore runs on some probes).

## 20. CHECKPOINT DIAGNOSTIC TABLE

Suite: frozen `WRIM-RECOVERY-DIAGNOSTIC-0` plus 5 experiment-only probes (echo, repetition, EOS, QA-from-context, short instruction). Not held-out promotion items.

| Step | train loss | val loss | collapsed | P(`.`) | greedy argmax `The sky is` | unique ratio | prompt echo | JSON valid |
|---:|---:|---:|---:|---:|---|---:|---:|---|
| 0 | — | 7.753 | 2/13 | 0.00101 | ` a` | 0.397 | 0.50 | false |
| 25 | 4.300 | 7.219 | 2/13 | 0.00396 | ` not` | 0.555 | 0.50 | false |
| 50 | 4.403 | 7.265 | 2/13 | 0.00379 | ` not` | 0.584 | 0.50 | false |
| 100 | 6.270 | 6.322 | **6/13** | 0.00312 | ` not` | 0.276 | 0.50 | false |

Min train loss: **4.062** at step 35.

## 21. LANGUAGE OUTPUTS

Step 0 `The sky is`: ` a` then tokenizer-underscore (WRIM-0-like).  
Step 25/50: still English-ish (` not a`, dialogue / literary fragments). **Not** period runs.  
Step 100: still not `.` loops; degenerates into `|` / `_` / whitespace runs on several probes. Literary probes still emit words (`Catherine`, `man`) mixed with junk.

## 22. PROMPT ECHO

Mean echo score **0.50** at every checkpoint (full_decode contains prompt; continuation does not start with the prompt). **Did not worsen.**

## 23. PERIOD PROBABILITY

P(`.`) on `The sky is`: 0.0010 → ~0.004 → 0.0031. **Never** greedy argmax. Controlled vs WRIM-1 @200 (P(`.`)≈0.030 and argmax `.`).

## 24. PERIOD REPETITION

`period_run_sky`: **false** at all recorded steps. Mean period fraction in greedy continuations: 0.014 → 0.014 → 0.031 → 0.026.

## 25. UNIQUE TOKEN RATIO

0.397 (step 0) → **0.555 / 0.584** (25/50, healthier) → **0.276** (100, worse than WRIM-0). Diversity collapsed at the same step as the 6/13 flag.

## 26. EOS GENERATION

Greedy decoding **never** emitted EOS on the 13 probes (0/13 at every step). P(EOS) on `The sky is` rose only 1.8e-5 → 9.3e-5.

## 27. JSON RESULT

`{"ok":` probe: **invalid JSON** at every step. Honest measurement; not claimed as capability.

## 28. VALIDATION LOSS

7.753 → 7.219 → 7.265 → **6.322**. Improved while generation worsened at 100. **Not** used as success.

## 29. TRAIN LOSS

7.92 (step 1) → min 4.06 (step 35) → 6.27 (step 100). Rise after ~50 tracks the diagnostic collapse. Finite throughout.

## 30. RAW LOGIT DRIFT (`The sky is`)

| Step | top token | P(`.`) | P(EOS) | entropy | finite |
|---:|---|---:|---:|---:|---|
| 0 | ` a` | 0.00101 | 1.8e-5 | 6.03 | yes |
| 25 | ` not` | 0.00396 | 4.2e-5 | 5.97 | yes |
| 50 | ` not` | 0.00379 | 4.4e-5 | 5.96 | yes |
| 100 | ` not` | 0.00312 | 9.3e-5 | 6.17 | yes |

No NaN/Inf. Mode is **not** period.

## 31. CHECKPOINT RELOAD

Steps 0, 25, 50, 100: reload SHA matches bundle SHA. Step 0 reload matches WRIM-0 tensor tree.

## 32. COLLAPSE DETECTED

**YES** at step 100 (6/13 diagnostic collapsed; unique-ratio drop; `|`/`_` runs).  
**NO** WRIM-1-style greedy-`.` / period-run mode at any recorded step.

## 33. WRIM-1 REJECTED CHECKPOINTS STATUS

`model-lab/manifests/wrim1_checkpoints/` registry still **10** complete official checkpoints. Registry mtime unchanged during this experiment (2026-08-30 20:55 local). Not written.

## 34. PRODUCTION STATUS

`/Users/markbroughton/WarRoomNode01` not modified. Active model unchanged.

## 35. GIT STATUS

No commit, push, merge, rebase, reset, or stash. Worktree remains dirty with prior AGI work plus this experiment’s files.

## 36. ROOT-CAUSE HYPOTHESIS CONFIRMATION

**CONFIRMED for the WRIM-1 period collapse:** per-token `permutation(data.size)` was sufficient to explain greedy `.` mode. With contiguous packing, that mode **did not reappear** in 100 steps.

**NOT sufficient as a complete recovery:** corrected packing + lower LR + EOS wrap + mix change still produced a **different** degeneration by step 100 (bar/underscore/whitespace runs, unique-ratio drop, train loss rebound). Remaining likely contributors: continued-pretrain LR still aggressive relative to 150-step cosine; WR-CORPUS-0 rehearsal overshoot (38.8% vs 15% target); literary-style dominance in greedy samples at 25–50 then instability; JSON/code still hard for this 19M model.

## 37. EXACT NEXT RECOMMENDATION

Do **not** start WRIM1-RUN-000002 / official WRIM-1.1.

Next Commander-gated TEST_ONLY (suggested, not started):

1. Keep contiguous unit packing and leak exclusions.  
2. Cap WR-CORPUS-0 rehearsal at **≤15% tokens** by truncating documents, not packing two huge leftovers.  
3. Try peak LR **1e-4**, warmup ~25, **stop at 50** if 25/50 stay at 2/13 collapsed.  
4. Diagnose `|` / `_` token mass (tokenizer artifacts vs markdown/code headers).  
5. Do not increase duration until a 50–100 step run stays at or below WRIM-0 collapse counts.

Possible later official id (only after a passing TEST_ONLY): `WRIM1-RUN-000002`.

## 38. FINAL VERDICT

**WRIM-1.1 SMALL RECOVERY EXPERIMENT — FAIL**

---

TOKEN-SHUFFLE COLLAPSE — CORRECTED (period mode did not return)  
WRIM-1.1 FULL CANDIDATE RUN — **NOT READY**  
ACTIVE MODEL — UNCHANGED  
PRODUCTION — UNCHANGED
