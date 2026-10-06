# WRIM1-RUN-000004 — STAGE3A corrective training design

Status: **CORRECTIVE_STAGE3A_DESIGN_READY** (pending Commander authorization)
Historical run WRIM1-RUN-000003: **UNMODIFIED**
Parent: **WRIM-0**
STAGE3B: **NO**
Training authorization: remains **OFF**
STAGE3_AUTHORIZATION = NO
Optimizer steps this pass: **0**

This file is design plus a zero-step freeze. It does not execute the 25-step pilot, start STAGE3B, promote, replace Qwen, implement Ra'el, push, or deploy.

#23 remains ACTIVE. #22 remains CLOSED.

## 1. Root-cause interpretation

WRIM-0 already fails the generation axes that STAGE3A interpolants were asked to rescue:

- 256-token adjudication: 0/32 pass on WRIM-0, STEP25_A0.2, STEP25_A0.4, and STEP50_A0.5
- 512-token adjudication: 0/4 pass on all four
- structured JSON: 0 valid on all four
- instruction following: 1/8 on all four
- substantial looping / low uniqueness; Alice/Queen/Gryphon stock collapse on long-form

Retention drift (ΔNLL / KL / val0) is real between step 25 and step 50, but it is not the main generation failure. The parent itself is generation-weak. A 50-step 2e-5 confirmation on the locked STAGE3 mix adapted the model without teaching long-form continuation, instruction, or valid JSON.

Corpus/packer evidence that makes this plausible:

- WR-CORPUS-0 train is 5 documents; Alice is 1/5. Mean unit ~63k tokens; longest ~170k. 30% rehearsal of a 50-step stream is ~61k tokens, so Alice-scale Gutenberg can dominate long-form.
- WR-CORPUS-1 records are pre-chunked ~1400 chars (p90 1395). Multi-paragraph continuity mostly comes from C0, i.e. Alice-scale text.
- Behavior pool is tiny (~5.4k tokens, ~25–31 examples) and highly templated (`near_duplicate_sample_rate` ~0.8).
- JSON trigram-repeat density ~0.073 (more templated than prose).
- Packer: 1024-token excerpt cut + family-window stitching inside 512 sequences + CE-only. No EOS-aware document boundary beyond wrap. Family stitching can place Alice next to JSON inside one 512 window.

## 2. Why existing interpolation is insufficient

`θ(α)=(1-α)*checkpoint + α*WRIM-0` can reduce ΔNLL/KL relative to raw STEP25/STEP50. It cannot insert generation competence that neither parent nor child has.

STEP25_A0.2 won a four-objective z-sum and kept CAP 6/6, but 256-token still 0/32. STEP50_A0.5 had the strongest val1 and failed CAP 5/6 (`cap0-ret-01` unique 0.219). Pareto was TRADEOFF_ONLY / NO_CLEAR_WINNER.

Interpolated TEST_ONLY_MERGE candidates must not silently become trained parents. Another ranking pass would not change the scientific conclusion.

## 3. Recommended parent

**WRIM-0.**

| Candidate | Verdict |
|---|---|
| Raw STEP50 | Forbidden. Unsuitable continuous drift. ΔNLL outside band. |
| STEP25 raw | Not chosen. Raw STEP25 ΔNLL 0.121 already outside 0.105. Residual 2e-5 displacement would confound a new mix+LR. Generation still fails. |
| STEP25_A0.2 / A0.4 / STEP50_A0.5 | TEST_ONLY_MERGE. Not authorized parents. |
| WRIM-0 | Chosen. Known SHA, known val0/val1, CAP 6/6, special-token stable, no leftover STEP50 displacement. |

Preferred default for planning was WRIM-0 unless evidence strongly supported STEP25. It does not.

Parent SHA: `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`  
Tokenizer SHA: `47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7`

## 4. Corpus-composition audit

Measurement only. Corpora were not mutated.

Locked STAGE3 mix that produced the current weaknesses: corpus0 30%, prose 34.1%, code 25.6%, json 8.6%, behavior 1.7%. Excerpt cap 1024. Seq 512.

Inventory after grouping (tokens): corpus0 317,338; prose 671,712; code 2,995,182; json 183,567; behavior 5,425.

Findings:

- Average C0 unit is extremely long; C1 records are short chunks later grouped into source runs.
- Code percentage in C1 records is high (6654/8405); mix already caps code tokens, but backticks concentrate there.
- Structured-output / JSON share is small in the trained stream (8.6%).
- Instruction/behavior share is 1.7% and templated.
- Dialogue and long-form prose are C0-dominated.
- Duplicate / near-duplicate rate is highest in behavior.
- BOS=1 EOS=2 wrap is applied per excerpt; long docs are cut at 1024 then restitched by family deficit, not by document.
- Tokenizer fragmentation was not the dominant loop signature; Alice rehearsal + stitching + CE is.

Pathology is plausibly reinforced by the current mixture. Do not mutate the corpus files; change sampling, excerpt caps, Alice cap, and packing.

## 5. Repetition-risk audit

Current objective/data pipeline can encourage token loops:

- Repeated n-gram density is highest in JSON and behavior templates.
- Sequence packing stitches different families inside 512 windows.
- Truncation at 1024 (and C1 ~1400-char records) chops multi-paragraph arguments.
- Continuation boundaries are excerpt/EOS wraps, not semantic document ends.
- Duplicate behavior samples would be oversampled if behavior were raised to ~11%.
- Repeated code fences / backticks concentrate in C1 code.
- Lab/tokenizer-style markers on C0 are likely false positives on 5 docs; C1 lab/tokenizer ~3%.
- Curriculum today is deficit-interleave, not a generation-stability curriculum.
- Loss is CE only. No unlikelihood.

Do **not** add unlikelihood loss, training-time repetition penalty, or an auxiliary objective on this 25-step pilot. Evidence points to Alice rehearsal, 1024 cut, family stitch, tiny templated behavior, and 2e-5 drift — not a missing exotic loss.

Justified interventions (data/pipeline only):

- Alice cap 3% of stream; prefer non-Alice C0.
- Lower C0 from 30% to 15%.
- Raise prose to 40% and JSON to 21%.
- Cap behavior at 4% (use the pool about once; do not loop 31 templates).
- Lower code to 20%; filter backtick-heavy excerpts.
- Document-major contiguous packing; prose/JSON excerpt cap 2048; code 1024.
- No eval-suite oversampling.

## 6. Corrective data-mixture design

Rights-cleared / already-approved sources only: WR-CORPUS-0 train, WR-CORPUS-1-HARDENED train, wave8.1 non-tool behavior examples.

Target mix (sums to 1.0) and dry-pack actuals for the 102,401-token stream:

| Family | STAGE3 locked | Corrective target | Dry-pack actual |
|---|---|---|---|
| wr_corpus_0 | 0.30 | **0.15** (Alice ≤ 0.03 of total stream) | 15.60% (Alice 3.12%) |
| prose | 0.341 | **0.40** | 39.70% |
| code | 0.256 | **0.20** | 19.33% |
| json | 0.086 | **0.21** | 21.84% |
| behavior | 0.017 | **0.04** | 3.53% |

Packing: `DOCUMENT_MAJOR_CONTIGUOUS`. Seed 4004. Corpus files unchanged.

This increases coherent long-form (non-Alice C0 + grouped prose runs), JSON/key-value/list-like text, clean-terminating code, and a bounded instruction/behavior once-through. It does not train on evaluation-shaped prompts.

## 7. Evaluation-data exclusions

Forbidden for training forever:

- CAP-EVAL-0
- WRIM-EVAL-S3-000001
- WRIM-EVAL-S3A-RET-000001
- WRIM-EVAL-S3A-STRUCT-000001
- WRIM-EVAL-S3A-ADJ-000001
- DIAGNOSTIC-0 / held-out recovery probes already excluded by packer eval-infra gates

These remain evaluation-only. DEV set is also forbidden for training.

## 8. Development-set design

`WRIM-DEV-S3A-COR-000001` — 40 items, 8×5, **DEVELOPMENT_ONLY**.

- Authored synthetic stems in training domains (not corpus prefixes: prefixes leak against C1/C0 haystacks by construction).
- Disjoint from frozen eval suites (char-13 Jaccard block plus exact/normalized match).
- Rights-cleared / Commander-owned authorship, same class as other WRIM authored suites.
- Frozen before run.
- Allowed for checkpoint selection.
- Explicitly labeled DEVELOPMENT_ONLY / training_use=FORBIDDEN / final_eval_suite=false.

Frozen evaluation suites remain untouched and are not used for mid-run model selection. Full adjudication overlay only at step 0 and step 25 (and abort).

## 9. Proposed optimizer

Fresh AdamW. fused=False. betas (0.9, 0.95). eps 1e-8. weight_decay 0.1. grad_clip 1.0. Do not resume STAGE3A AdamW moments. Do not construct the optimizer in this design pass.

## 10. Proposed learning rate

Peak **1e-5**.

Evidence, not intuition:

- Phase 2: 3e-5 KL ~0.022 vs 2e-5 KL ~0.014. Higher LR was worse.
- STAGE3A 2e-5: useful adaptation by step 25, but STEP25_RAW ΔNLL 0.121 outside 0.105; drift increased strongly toward step 50.
- 5e-6 is half of 1e-5 and may not move generation in 25 steps × 4096 tokens.
- 1.5e-5 is too close to the drifting 2e-5 recipe.

One run. No grid.

## 11. Proposed LR schedule

1-indexed steps 1–25.

- Warmup: `lr(step)=1e-5*step/8` for `1<=step<=8` (step 8 = 1e-5)
- Cosine: `progress=(step-8)/17`; `lr=1e-6+0.5*(1e-5-1e-6)*(1+cos(pi*progress))` for `8<step<=25` (step 25 = 1e-6)

Self-test required before any future train CLI.

## 12. Sequence length

512. Unchanged.

## 13. Batch size

micro-batch 8.

## 14. Accumulation

1. Effective batch 8.

## 15. Exact tokens per step

4096 = 8 × 512.

## 16. Exact total pilot tokens

102,400 = 25 × 4096. Stream materialization uses 102,401 tokens for the causal last target.

## 17. Checkpoint schedule

step 0 = parent pointer only (no copy of weights required beyond the existing WRIM-0 file).  
Weights at 5, 10, 15, 20, 25 under a **new** TEST_ONLY directory for WRIM1-RUN-000004. Do not overwrite WRIM1-RUN-000003 checkpoints.

## 18. Evaluation schedule

At 0/5/10/15/20/25: ΔNLL, KL, val0, val1, DEV generation, CAP-EVAL-0 overlay, special-token rate, repetition/collapse, JSON validity, instruction constraints, long-form unique ratio.

Full frozen WRIM-EVAL-S3A-ADJ-000001 only at 0 and 25 (and abort). Not for mid-run selection.

## 19. ΔNLL sentinel

Abort if ΔNLL > **0.105**.

## 20. KL sentinel

Abort if KL(WRIM-0 ‖ candidate) > **0.018**.

## 21. val0 sentinel

Abort if val0 > **8.890125** (parent). val1 is measured; abort only if val1 > parent+0.30 (catastrophic). Parent val1 = 7.971308.

## 22. CAP sentinel

Abort if CAP-EVAL-0 pass count ≤ **3/6**. Success band requires ≥ **5/6**. Do not treat a single CAP bit as the only stop.

## 23. Repetition sentinel

Abort if DEV looping/collapse count ≥ parent_step0 + **4**. Success: looping count ≤ parent − 2 (or unique-ratio improvement below).

## 24. Collapse sentinel

Same as repetition for hard abort (collapse_count ≥ parent + 4). Combined with special-token and unique-ratio, not used alone.

## 25. Structured-output sentinel

Measure DEV JSON parse / required keys / list / CSV. Hard abort only as part of the multi-metric policy (two or more generation degradations plus a retention trip). Do not abort solely because JSON remains 0/5 at step 5.

## 26. Instruction sentinel

Measure DEV constraint_ok. Success: +≥1 vs WRIM-0. Soft-stop if constraint_ok ≤ parent − 2 together with another generation degradation.

## 27. Long-form sentinel

Measure DEV 128-token unique ratio and entity-track. Success: mean unique_ratio +≥ 0.03 vs WRIM-0. Soft-stop if unique_ratio ≤ parent − 0.05 together with another generation degradation.

## 28. Special-token sentinel

Abort if mean special_rate > **0.08**. Success: not worse than parent + 0.02.

## 29. Automatic abort policy

Immediate stop on any hard trip:

1. NaN/Inf logits or loss
2. Parent or tokenizer SHA mismatch
3. ΔNLL > 0.105
4. KL > 0.018
5. val0 > 8.890125
6. CAP ≤ 3/6
7. special_rate mean > 0.08
8. DEV collapse_count ≥ parent + 4
9. Packing/leakage/eval-suite contamination
10. Disk / write failure

Soft multi-metric stop (halt and report, do not continue) if **two or more**:

- unique128 mean ≤ parent − 0.05
- instruction constraint_ok ≤ parent − 2
- json_valid ≤ parent (and not improved) while looping also worsened
- val1 > parent + 0.15

Do not use one brittle binary item as the only stop condition except SHA/NaN/contamination.

## 30. Success criteria

Pilot is **promising** (not perfect) if it improves WRIM-0 on **at least two** of:

- repetition resistance (looping −≥2 or unique-ratio +≥0.03)
- 128/256-token continuity (unique-ratio +≥0.03 or entity-track +≥1)
- instruction adherence (+≥1 constraint_ok) **or** structured-output (+≥1 json_valid)

AND maintains:

- ΔNLL < 0.105
- KL < 0.018
- val0 < 8.890125
- CAP ≥ 5/6
- special_rate ≤ parent + 0.02

Then recommend `CORRECTIVE_STAGE3A_CONTINUATION_READY` for Commander review. No automatic scale-up.

## 31. Failure criteria

Stop. Do not automatically continue if:

- any hard abort
- fewer than two generation-axis improvements
- retention outside bands
- CAP < 5/6 at step 25
- special-token regression beyond +0.02
- collapse worse than parent + 4

## 32. Proposed run id

**WRIM1-RUN-000004**. Does not overwrite WRIM1-RUN-000003.

## 33. Ready for Commander authorization?

**YES for design.** **NO for optimizer.** CORRECTIVE_STAGE3A_EXECUTION_READINESS remains false until the next prompt explicitly authorizes the 25-step run.

## 34–42. Authority locks

- STAGE3B remains **NO**
- TRAINING_AUTHORIZATION remains **OFF**
- production WRIM unchanged (`NOT_IMPLEMENTED`)
- Qwen unchanged (`THIRD_PARTY_MODEL_RUNNING_LOCALLY`)
- Ra'el not implemented
- #22 CLOSED
- #23 ACTIVE
- nothing pushed
- nothing deployed

Delete nothing now. Interpolants remain TEST_ONLY_MERGE.
