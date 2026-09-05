# WRIM-1.1 RECOVERY-008 CURRICULUM FAILURE FORENSICS

Date: 2026-08-31  
Authorization: Commander READ-ONLY forensics. **No training. No Recovery-009. No WRIM1-RUN-000003. No production. No git commit.**

Machine evidence: `model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-008-FORENSICS/`  
Primary run: `TEST-WRIM1.1-RECOVERY-008` (stopped step 120)  
References: Recovery-007, WRIM1-RUN-000002

## FINAL VERDICT

**WRIM-1.1 RECOVERY-008 FORENSICS — PASS**

The 80–125 window was reconstructed at step granularity with packed-stream identity, mask density, family sequence, loss/grad, checkpoint drift, and read-only replay. That is enough to name **one** next TEST_ONLY variable. It does **not** mean the model recovered.

---

## PART 1 — STEPS 80–125 (DO NOT SKIP)

Packed stream SHA matches official 000002. Steps 121–125 are **planned only** (008 stopped at 120). Diagnostics exist at 80, 90, 100, 110, 120 (light/full). KL/param L2 only at those snapshots.

| step | LR | dominant | style | reh% | prose% | code% | sup% | dens | loss | CE_reh/prose/code/sup | grad | clip | us_tok | collapse | unique | us_run |
|---:|---:|---|---|---:|---:|---:|---:|---:|---:|---|---:|---|---:|---:|---:|---:|
| 80 | 1.94e-05 | QUALITY_CODE | MIXED | 0.0 | 35.7 | 38.2 | 26.1 | 0.810 | 7.151 | -/7.11/7.12/7.52 | 0.838 | False | 117 | 1 | 0.471 | 0 |
| 81 | 1.90e-05 | REHEARSAL | CAUSAL | 50.0 | 29.1 | 14.5 | 6.4 | 0.954 | 5.751 | 4.37/7.19/7.40/7.57 | 0.578 | False | 52 |  |  |  |
| 82 | 1.87e-05 | QUALITY_CODE | MIXED | 0.0 | 35.7 | 38.7 | 25.6 | 0.815 | 7.403 | -/7.19/7.57/7.55 | 0.939 | False | 65 |  |  |  |
| 83 | 1.84e-05 | REHEARSAL | CAUSAL | 50.0 | 26.8 | 16.8 | 6.4 | 0.954 | 5.935 | 4.64/7.33/7.38/7.55 | 0.686 | False | 29 |  |  |  |
| 84 | 1.80e-05 | QUALITY_PROSE | MIXED | 0.0 | 37.9 | 36.5 | 25.6 | 0.815 | 7.360 | -/7.21/7.48/7.55 | 1.085 | True | 74 |  |  |  |
| 85 | 1.77e-05 | REHEARSAL | CAUSAL | 50.0 | 24.0 | 13.2 | 12.8 | 0.908 | 5.761 | 4.49/7.28/7.34/7.48 | 0.533 | False | 47 |  |  |  |
| 86 | 1.73e-05 | QUALITY_PROSE | MIXED | 14.6 | 30.5 | 28.1 | 26.8 | 0.806 | 6.678 | 4.47/7.10/7.12/7.62 | 0.967 | False | 48 |  |  |  |
| 87 | 1.70e-05 | REHEARSAL | CAUSAL | 35.4 | 27.5 | 28.8 | 8.3 | 0.938 | 6.346 | 4.73/7.13/7.47/7.82 | 0.784 | False | 119 |  |  |  |
| 88 | 1.67e-05 | QUALITY_PROSE | MIXED | 11.4 | 39.1 | 28.6 | 21.0 | 0.851 | 6.884 | 4.62/7.09/7.30/7.86 | 0.930 | False | 111 |  |  |  |
| 89 | 1.63e-05 | REHEARSAL | CAUSAL | 38.6 | 26.5 | 20.6 | 14.3 | 0.897 | 6.149 | 4.29/7.47/7.60/7.87 | 0.692 | False | 22 |  |  |  |
| 90 | 1.60e-05 | QUALITY_CODE | CAUSAL | 25.3 | 27.0 | 33.0 | 14.7 | 0.895 | 6.706 | 4.39/6.97/8.12/7.93 | 0.897 | False | 74 | 1 | 0.476 | 0 |
| 91 | 1.57e-05 | QUALITY_PROSE | MIXED | 24.7 | 29.9 | 25.3 | 20.1 | 0.850 | 6.451 | 4.46/7.01/7.48/7.73 | 0.645 | False | 50 |  |  |  |
| 92 | 1.53e-05 | REHEARSAL | CAUSAL | 48.6 | 26.2 | 12.2 | 13.0 | 0.901 | 5.829 | 4.48/7.49/7.08/7.97 | 0.667 | False | 57 |  |  |  |
| 93 | 1.50e-05 | QUALITY_PROSE | MIXED | 1.4 | 42.9 | 37.2 | 18.5 | 0.852 | 7.259 | 4.45/7.18/7.40/7.86 | 0.760 | False | 42 |  |  |  |
| 94 | 1.46e-05 | REHEARSAL | CAUSAL | 45.9 | 20.9 | 19.1 | 14.0 | 0.901 | 5.643 | 4.23/7.47/6.62/7.55 | 0.567 | False | 71 |  |  |  |
| 95 | 1.43e-05 | QUALITY_PROSE | MIXED | 4.1 | 41.7 | 29.8 | 24.4 | 0.817 | 7.022 | 3.95/7.23/7.04/7.54 | 0.670 | False | 75 |  |  |  |
| 96 | 1.40e-05 | REHEARSAL | CAUSAL | 50.0 | 18.5 | 21.7 | 9.7 | 0.931 | 5.926 | 4.65/7.11/7.70/7.02 | 0.543 | False | 38 |  |  |  |
| 97 | 1.36e-05 | QUALITY_PROSE | MIXED | 0.0 | 45.7 | 29.9 | 24.4 | 0.828 | 7.126 | -/6.93/7.45/7.03 | 1.092 | True | 61 |  |  |  |
| 98 | 1.33e-05 | REHEARSAL | CAUSAL | 50.0 | 16.4 | 23.9 | 9.7 | 0.931 | 5.823 | 4.51/7.11/7.55/6.96 | 0.527 | False | 42 |  |  |  |
| 99 | 1.30e-05 | QUALITY_PROSE | MIXED | 0.0 | 44.8 | 33.9 | 21.4 | 0.867 | 7.367 | -/7.36/7.47/7.01 | 0.984 | False | 112 |  |  |  |
| 100 | 1.27e-05 | REHEARSAL | CAUSAL | 50.0 | 24.0 | 14.6 | 11.4 | 0.937 | 5.791 | 4.60/6.86/7.68/7.03 | 0.756 | False | 17 | 2 | 0.430 | 14 |
| 101 | 1.23e-05 | QUALITY_PROSE | MIXED | 0.0 | 42.7 | 31.4 | 25.9 | 0.843 | 7.197 | -/7.15/7.34/6.96 | 0.713 | False | 50 |  |  |  |
| 102 | 1.20e-05 | REHEARSAL | CAUSAL | 50.0 | 17.4 | 24.0 | 8.6 | 0.965 | 5.673 | 4.17/7.20/7.40/7.10 | 0.518 | False | 13 |  |  |  |
| 103 | 1.17e-05 | QUALITY_CODE | MIXED | 0.0 | 35.1 | 37.8 | 27.0 | 0.851 | 7.268 | -/7.29/7.30/7.10 | 0.972 | False | 48 |  |  |  |
| 104 | 1.14e-05 | REHEARSAL | CAUSAL | 50.0 | 28.5 | 10.9 | 10.6 | 0.938 | 5.658 | 4.53/7.18/6.30/7.05 | 0.684 | False | 5 |  |  |  |
| 105 | 1.11e-05 | QUALITY_PROSE | MIXED | 0.0 | 44.4 | 32.1 | 23.6 | 0.874 | 7.133 | -/6.86/7.55/7.01 | 0.901 | False | 66 |  |  |  |
| 106 | 1.08e-05 | REHEARSAL | CAUSAL | 50.0 | 18.8 | 25.3 | 5.8 | 0.968 | 5.637 | 4.38/6.91/7.04/6.89 | 0.669 | False | 47 |  |  |  |
| 107 | 1.04e-05 | QUALITY_PROSE | MIXED | 18.5 | 31.5 | 27.1 | 22.9 | 0.872 | 6.569 | 4.55/6.90/7.39/7.04 | 0.775 | False | 42 |  |  |  |
| 108 | 1.01e-05 | REHEARSAL | MIXED | 31.5 | 27.1 | 25.5 | 16.0 | 0.912 | 6.217 | 4.39/7.07/7.32/7.07 | 0.668 | False | 64 |  |  |  |
| 109 | 9.85e-06 | QUALITY_PROSE | MIXED | 25.2 | 34.3 | 23.7 | 16.9 | 0.907 | 6.213 | 4.44/7.03/6.66/7.04 | 0.983 | False | 95 |  |  |  |
| 110 | 9.56e-06 | QUALITY_PROSE | MIXED | 24.8 | 32.1 | 26.1 | 17.0 | 0.905 | 6.292 | 4.32/6.83/7.30/6.99 | 0.645 | False | 46 | 2 | 0.416 | 14 |
| 111 | 9.27e-06 | REHEARSAL | MIXED | 30.2 | 27.3 | 25.0 | 17.6 | 0.902 | 6.236 | 4.55/6.96/7.27/6.94 | 0.579 | False | 37 |  |  |  |
| 112 | 8.98e-06 | QUALITY_PROSE | MIXED | 19.8 | 31.4 | 31.4 | 17.4 | 0.903 | 6.758 | 4.64/7.35/7.43/7.04 | 0.662 | False | 56 |  |  |  |
| 113 | 8.70e-06 | QUALITY_PROSE | MIXED | 24.5 | 34.6 | 24.7 | 16.1 | 0.912 | 6.328 | 4.28/7.06/7.12/7.05 | 0.617 | False | 12 |  |  |  |
| 114 | 8.43e-06 | QUALITY_PROSE | MIXED | 25.5 | 30.3 | 25.1 | 19.0 | 0.887 | 6.515 | 4.70/6.95/7.67/7.01 | 0.719 | False | 35 |  |  |  |
| 115 | 8.16e-06 | REHEARSAL | CAUSAL | 50.0 | 23.8 | 12.9 | 13.3 | 0.917 | 5.683 | 4.42/7.16/7.31/7.05 | 0.560 | False | 21 |  |  |  |
| 116 | 7.89e-06 | QUALITY_CODE | MIXED | 0.0 | 37.6 | 43.2 | 19.2 | 0.881 | 7.188 | -/7.17/7.23/7.06 | 0.966 | False | 138 |  |  |  |
| 117 | 7.64e-06 | REHEARSAL | CAUSAL | 50.0 | 22.9 | 13.5 | 13.6 | 0.919 | 5.632 | 4.37/6.96/7.50/7.03 | 0.679 | False | 66 |  |  |  |
| 118 | 7.38e-06 | QUALITY_CODE | MIXED | 0.0 | 33.3 | 46.3 | 20.4 | 0.874 | 7.029 | -/7.26/6.88/6.94 | 1.161 | True | 164 |  |  |  |
| 119 | 7.14e-06 | REHEARSAL | CAUSAL | 50.0 | 31.8 | 11.7 | 6.5 | 0.960 | 5.536 | 4.33/6.50/7.77/6.95 | 0.498 | False | 30 |  |  |  |
| 120 | 6.89e-06 | QUALITY_PROSE | MIXED | 0.0 | 40.1 | 33.4 | 26.5 | 0.838 | 7.205 | -/6.87/7.65/7.05 | 1.034 | True | 75 | 4 | 0.404 | 26 |
| 121 | 6.66e-06 | REHEARSAL | CAUSAL | 50.0 | 17.5 | 20.2 | 12.3 | 0.916 |  | not consumed |  |  | 31 |  |  |  |
| 122 | 6.43e-06 | QUALITY_PROSE | MIXED | 0.0 | 41.0 | 33.3 | 25.7 | 0.838 |  | not consumed |  |  | 71 |  |  |  |
| 123 | 6.21e-06 | REHEARSAL | CAUSAL | 50.0 | 25.6 | 15.7 | 8.7 | 0.959 |  | not consumed |  |  | 23 |  |  |  |
| 124 | 5.99e-06 | QUALITY_PROSE | MIXED | 0.0 | 40.4 | 35.3 | 24.4 | 0.834 |  | not consumed |  |  | 32 |  |  |  |
| 125 | 5.78e-06 | REHEARSAL | CAUSAL | 50.0 | 21.8 | 19.1 | 9.1 | 0.959 |  | not consumed |  |  | 27 |  |  |  |

Parameter-update column: logged `approx_param_update_scale = lr * min(grad, 1.0)`. Checkpoint parameter L2 change 75→100 = **0.822**; 100→120 = **0.370**.

Full JSON: `step_80_125_table.json`.

---

## PART 2 — FIRST DEVIATION

**FIRST SUSPECT STEP: 100** (diagnostic). **Causal batch window immediately before it: 97–99.**

Why not “collapse=4/13”:

- Step 90: collapse **1/13**, unique **0.476**, underscore_run **0**, sky still Gryphon/`##-room`.
- Step 100: collapse **2/13**, unique **0.430**, underscore_run **14**, sky ` not been a\n_not______________`.
- P("_") barely moves (0.00517 at 75 → 0.00537 at 100). The loop is **generation-path**, not argmax `_`.
- Top-1 stays `" not"` (id 206) the whole window; P(" not") rises 0.083 → 0.101.

**Earlier than the 13-probe:** read-only replay of checkpoint **75** already has Hello-world `-lab-lab_`_`_...`. So `-lab` onset is **before** this window. Sky `_not_` is the new event at 100.

---

## PART 3 — FAMILY SEQUENCE (80–125)

```
80 QUALITY_CODE   81 REHEARSAL   82 QUALITY_CODE   83 REHEARSAL
84 QUALITY_PROSE  85 REHEARSAL   86 QUALITY_PROSE  87 REHEARSAL
88 QUALITY_PROSE  89 REHEARSAL   90 QUALITY_CODE   91 QUALITY_PROSE
92 REHEARSAL      93 QUALITY_PROSE 94 REHEARSAL    95 QUALITY_PROSE
96 REHEARSAL      97 QUALITY_PROSE 98 REHEARSAL    99 QUALITY_PROSE
100 REHEARSAL     101 QUALITY_PROSE 102 REHEARSAL  103 QUALITY_CODE
104 REHEARSAL     105 QUALITY_PROSE 106 REHEARSAL  107 QUALITY_PROSE
108 REHEARSAL     109 QUALITY_PROSE 110 QUALITY_PROSE 111 REHEARSAL
112 QUALITY_PROSE 113 QUALITY_PROSE 114 QUALITY_PROSE 115 REHEARSAL
116 QUALITY_CODE  117 REHEARSAL   118 QUALITY_CODE  119 REHEARSAL
120 QUALITY_PROSE
121–125 planned, not consumed
```

No step is TOOL/JSON/INSTRUCTION-dominant. Supervised is **always a minority slice** inside leftover batches.

Token counts inside 80–120 (consumed): TOOL **13584** (8.1%), WR_CONCEPT **10387**, EVIDENCE **4637**, CODE_SUPERVISED **0**, JSON **0**, INSTRUCTION **0**, CORRECTION **0**.

---

## PART 4 — SUPERVISED / MASK DENSITY

Ordinary LM rehearsal steps: density **0.93–0.97**.  
Mixed leftover+supervised: **0.81–0.88**.

Classification vs all-ones causal LM: mixed batches are **moderate-to-sparse** (lowest 0.806 at step 86), not 10% sparse. Mean density 80–120: **0.890**.

---

## PART 5 — MASKED-LOSS NORMALIZATION

Exact path: `scripts/wrim1-training/run_recovery_experiment.py` `masked_loss_fn`:

```
loss = sum(CE * w) / (sum(w) + 1e-8)
```

**A. Divided by number of valid/trainable target tokens** (sum of the loss mask on `y` positions).  
Not B (raw sequence length) unless the mask is all ones. Not C (unweighted batch size).

Implication: a mixed batch with density 0.81 and a rehearsal batch with density 0.95 produce **comparable mean per-target CE**. Sparse targets do **not** automatically get a larger mean-loss scale. They **do** concentrate the gradient on fewer positions (shared parameters still receive those grads). Whether that is “shock” is answered by measured grad L2 (Part 6): leftover-dominant mixed steps **are** higher, rehearsal lower.

---

## PART 6 — GRADIENT BY DOMINANT FAMILY (80–120)

| Dominant class | n | mean | median | max | clips |
|---|---:|---:|---:|---:|---:|
| QUALITY_CODE | 6 | **0.962** | 0.953 | 1.161 | 1 |
| QUALITY_PROSE | 17 | 0.834 | 0.775 | 1.092 | 3 |
| REHEARSAL | 18 | **0.622** | 0.623 | 0.784 | **0** |

TOOL/JSON/instruction never dominate a step, so they have **no solo grad sample**. Their signal is folded into MIXED leftover steps (e.g. step 80 = code+prose+1068 tool tokens).

---

## PART 7 — UPDATE MAGNITUDE

Per-step proxy `lr * min(grad, 1)`: code 1.24e-5 mean, prose 1.03e-5, rehearsal 8.17e-6.

True parameter delta (checkpoint): **||θ100−θ75||₂ = 0.822**, **||θ120−θ100||₂ = 0.370**. Updates shrank as LR decayed; collapse still completed. No new optimizer run.

---

## PART 8 — DEGENERATION-TOKEN TRACE

Tokenization: `_`=68, `|`=97, `B`=40, `-lab`→[113, 19, 2360], `_not_`→[359, 529, 68].

| snap | P(_) | P(\|) | P(.) | top-1 | sky | hello |
|---|---:|---:|---:|---|---|---|
| 75 | 0.00517 | 0.00092 | 0.00229 | ` not` | Gryphon / `##-room` | **`-lab-lab_`_`_`** |
| 80 | 0.00523 | 0.00093 | 0.00235 | ` not` | same Gryphon | (saved: us_run 0) |
| 90 | 0.00533 | 0.00098 | 0.00246 | ` not` | same Gryphon | us_run 0 |
| 100 | 0.00537 | 0.00101 | 0.00249 | ` not` | **`_not_ ___`** | `-lab_`_`_` |
| 110 | 0.00542 | 0.00105 | 0.00247 | ` not` | `_not_ ___` | us_run 14 |
| 120 | 0.00544 | 0.00109 | 0.00249 | ` not` | `_not_` run 26 | `-lab_`_`_` |

**First rising loop token in this window: `_` / `_not_` in sky between 90 and 100.** `-lab` on Hello is **already present at 75**. `_` is never top-1. `|` and `B` are not the collapse mode here.

---

## PART 9 — BATCHES BEFORE DEGRADATION

**Before step-100 sky `_not_` (prev 5):**  
96 REHEARSAL → **97 MIXED prose+code+tool, CLIP** → 98 REHEARSAL → **99 MIXED prose+code+tool+WR, loss 7.37** → 100 REHEARSAL (diag fires).

Repeated association: **zero-rehearsal MIXED leftover+supervised** (97, 99) immediately before the first sky loop. Not a single occurrence (also 80, 82, 84, 93, 95).

**Before step-120 4/13 (prev 5):**  
116 CODE+evidence (138 `_` tokens) → 117 REH → **118 CODE 46%+evidence, CLIP grad 1.16, 164 `_` tokens** → 119 REH (model-lab decode hit) → **120 PROSE+evidence 26.5% sup, CLIP, collapse 4**.

Repeated association for **completion**: leftover **code** + **evidence_uncertainty**, 0% rehearsal, clip.

Do not claim one family unique causation from one step.

---

## PART 10 — CAUSAL VS SUPERVISED SWITCHING

Consumed 80–120: **24 MIXED, 17 CAUSAL**. Almost every-other-step until 109–114 (prose run).

```
C M C M C M ... (81–108)
then MIXED cluster 109–114
then C M C M C M (115–120)
```

Loss jumps **in lockstep** with the switch (~1.3–1.7 nats). Transition frequency is high **from the start of the run**, so it is a standing property, not a new event at 100. Suspicious as **amplifier** together with leftover code, not as a sudden trigger.

---

## PART 11 — READ-ONLY FAMILY REPLAY (checkpoint 100, no backward)

Dominant-class representatives only (tool/JSON never dominate a step):

| class | seq_start | n_targets | masked CE | last-pos entropy |
|---|---:|---:|---:|---:|
| QUALITY_PROSE | 339968 | 323 | 6.98 | 7.35 |
| QUALITY_CODE | 323584 | 309 | 7.14 | 7.64 |
| REHEARSAL | 327680 | 512 | 7.38 | 7.74 |

The rehearsal **window** chosen (step 81 start) is not easier than leftover on a single 512-span; **batch-level** train CE still shows rehearsal ~4.4 vs leftover ~7.1 because those batches contain long WR-CORPUS-0 spans. Hardest **train** family remains leftover code/supervised (~7.3–7.4 mean in 80–120) vs rehearsal ~4.45.

---

## PART 12 — RECOVERY-007 (same LR, different curriculum)

LR at 80/100/120 is **identical**. 007 collapse 2/3/3 at 80/100/120 vs 008 **1/2/4**. 007 unique ~0.32 (worse) but **no 4/13 loop stop**. 007 clips 5 vs 008 4 in 80–120. 007 has **no** capability tool/WR/evidence supervised pack. 008 mean supervised in-window **17.0%**.

---

## PART 13–14 — OFFICIAL 000002 / SHARED REGION

Byte-identical packed stream. Steps 80–100 **same seq_starts and same units**. Official consumed that region and died at 100 (4/13) at LR 2.84e-5. 008 consumed the **same** 80–100 region at LR 1.27e-5 and only reached 2/13, then consumed **101–120** (official never trained those bytes) and died at 120.

Shared suspect region for **onset**: stream offsets **~364544–409600** (steps 90–100), MIXED leftover+`tool_use`/`war_room_concepts`.  
008-only completion region: **409600–491520** (steps 101–120), then leftover+`evidence_uncertainty`.

---

## PART 15 — MASK BOUNDARIES

Sampled supervised units in-window are **tool_use**: prompt masked through `<|assistant|>`, targets are `<tool_call>{JSON}</tool_call>` plus a short disclaimer + EOS. Assistant index ~187–214. No training on commander/system spans in these samples. Schema punctuation **is** in the target (intended). Targets are **not** extremely short (71–73 tokens in these clones).

---

## PART 16 — SHORT TARGETS

127 supervised units overlapping the window: **0** in 1–4, **0** in 5–16, 24 in 17–64, 103 in 65+. Mean **89.5** target tokens. No repeated `pass`/`true`/`false` stubs. The hazard is **repeated medium JSON templates**, not 1-token habits.

---

## PART 17–18 — UNDERSCORE / MODEL-LAB

`_` token rate: **1.05%** in steps 1–40 vs **1.45%** in 80–120. Token 113 (`-lab` first piece) 1697 vs 1552 (not up). Decode `model-lab` hits: steps **107, 119, 120** (collapse completion). Step 118 has **164** `_` tokens (highest in the table) then clips.

---

## PART 19–20 — ADAMW / WEIGHT DECAY

| ckpt | m L2 | v L2 | adam ΔL2 est | wd ΔL2 est | wd/adam |
|---|---:|---:|---:|---:|---:|
| 75 | 0.438 | 0.00618 | 0.0440 | 0.00055 | **0.013** |
| 100 | 0.430 | 0.00708 | 0.0247 | 0.00033 | **0.013** |
| 120 | 0.466 | 0.00850 | 0.0142 | 0.00018 | **0.013** |

Weight decay **0.1 is ~1.3% of the Adam step L2** at these LRs. Not the collapse driver. First moment L2 is slightly **up** 100→120 (0.43→0.47) while LR falls.

---

## PART 21–22 — LAYER / OUTPUT-HEAD DRIFT

Drift is **broad**, tok_emb-heavy (0.51 of 0.82 from 75→100). Transformer layers each ~0.15. Final norm negligible. 100→120 smaller but same shape.

Underscore embedding Δ 75–100 = **0.00450** vs vocab median **0.00322**, p90 **0.00630**. `-lab` piece 113: **0.00488**. Not a unique explosion; slightly above median.

---

## PART 23 — TRAIN CE VS HELD-OUT

Mean CE 1–25 → 90–100: rehearsal −0.23, prose −0.61, code −0.60, supervised −0.17. Train is falling. Cap-eval **18/86 at 0 and 100**, JSON/TOOL/EVIDENCE **0**. Learning on-distribution CE without held-out lift: **yes** (under-generalization / template fit), not proof of useful capability.

---

## PARTS 24–27 — HYPOTHESES AND NEXT VARIABLE

**H1 (HIGH):** leftover QUALITY_CODE mixed with capability supervised in the same step is loop fuel.  
**H2 (MEDIUM):** repeated `tool_use` JSON templates in 80–100 start sky `_not_`.  
**H3 (MEDIUM):** every-other-step CAUSAL/MIXED switching amplifies loss/grad oscillation.

**Highest-information Recovery-009 variable (DO NOT LAUNCH):**  
Replace leftover **QUALITY_CODE** tokens with extra **WR-CORPUS-0 rehearsal**. Hold WRIM-0, tokenizer, supervised set, Recovery-007 LR (150 cosine + floor), AdamW, ctx/batch.

If that still fails, next (not authorized) is `tool_use` exclusion.

Curriculum edits: **indicated as TEST_ONLY exclusion candidates only**. Original pack not rewritten.  
Optimizer changes: **not indicated** (wd/moments not the driver).  
Architecture/capacity: **not implicated by this window** (broad small drift, no layer blow-up).

Exclusion list (no deletes): `exclusion_candidates.json`.

---

## RETURN CHECKLIST

1. First suspect step: **100** (diag); batches **97–99**  
2. First behavioral deviation in-window: sky **`_not_` loops**; `-lab` already at **75**  
3. Family sequence: Part 3  
4. Target density: 0.81–0.97; mixed moderate/sparse  
5. Loss = mean CE over mask 1s  
6. Grad: code > prose > rehearsal  
7. Update: checkpoint Δ 0.82 then 0.37; proxy tracks grad×LR  
8. Token trace: Part 8  
9. Pre-degradation batches: Part 9  
10. Switching: 24 MIXED / 17 CAUSAL  
11. Replay CE: Part 11  
12. 007: same LR, no cap-supervised, stays 3/13  
13. 000002: same 80–100 bytes; dies earlier at higher LR  
14. Shared region: offsets ~364k–410k  
15. Mask: response-only tool JSON, long-ish targets  
16. Short targets: none in 1–16  
17. `_` rate +37% relative in 80–120; model-lab at 107/119/120  
18. Adam m/v finite; m L2 slightly up at 120  
19. wd ~1.3% of Adam ΔL2  
20. Broad tok_emb-led drift  
21. `_`/`-lab` rows slightly above median, not unique  
22. Train CE down; held-out 18/86 unchanged  
23. H1 leftover code × supervised mix  
24. H2 tool_use templates  
25. H3 objective switching  
26. Recovery-009 variable: **drop leftover code → extra rehearsal**  
27. Curriculum edits: candidates only, no rewrite  
28. Optimizer: no  
29. Architecture: no  
30. Production/git: untouched  

**WRIM-1.1 RECOVERY-008 FORENSICS — PASS**

STOP. Do not train. Do not start Recovery-009. Do not start WRIM1-RUN-000003.

---

## NEXT STEPS FOR OPERATOR

1. Required environment changes — **No operator action required.**
2. Required SQL/migrations — **No operator action required.**
3. Restart requirements — **No operator action required.**
4. Verification URLs/routes — **No operator action required.** Read `docs/WRIM1_1_RECOVERY_008_CURRICULUM_FAILURE_FORENSICS.md` and `model-lab/manifests/wrim1_1_recovery/test-only/TEST-WRIM1.1-RECOVERY-008-FORENSICS/`.
5. Expected successful output — Forensic PASS: next single variable named; model still failed at 120.
6. Feature flags enabled/disabled — **No operator action required.**
7. What should visibly change in UI — **Nothing.**
8. Safe rollback instruction if needed — **No operator action required.** Forensics wrote only a new TEST_ONLY directory and this doc. WRIM-0 unchanged.
