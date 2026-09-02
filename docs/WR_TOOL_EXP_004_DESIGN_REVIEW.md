# WR-TOOL EXPERIMENT 004 — 6-CLASS LOADER / HEAD DESIGN REVIEW

Date: 2026-08-31  
Identity: `WR-TOOL-EXP-004-DESIGN`  
Path: `model-lab/manifests/wr_tool_experiments/WR-TOOL-EXP-004-DESIGN/`  
Status: **DESIGN COMPLETE. TRAINING LATER AUTHORIZED AND EXECUTED** as `WR-TOOL-EXP-004-RUN-000001`. See `docs/WR_TOOL_EXP_004_TRAINING_REPORT.md`.

**Mission verdict (this design document):** WR-TOOL EXPERIMENT 004 DESIGN REVIEW — PASS  
**Design readiness (historical):** WR-TOOL EXP004 — READY FOR COMMANDER TRAINING AUTHORIZATION  
**Training (separate authorized mission):** WR-TOOL EXPERIMENT 004 TRAINING — PASS; WR-TOOL EXP004 — CAPABILITY ACQUISITION NOT DEMONSTRATED. Module remains CANDIDATE. Active modules `[]`.

This design review is not rewritten as a training log. The design contract (6-class head, V4/EVAL-4 bindings, val macro F1 selection, fixed gates) was executed as specified. Training used **unweighted** CE because class weights were optional/not fixed.

Runtime estimate: ~8 minutes. Actual dry-run wall ~1.6s after core load in `.venv-wrim`.

## What EXP-003 actually does (inspected)

Script: `scripts/wrim-modular/run_tool_pi_exp_003.py`  
Support: `scripts/wrim-modular/exp003_support.py`, `lora_qv.py`, `capability_module.py`, `frozen_core.py`

| item | EXP-003 actual |
|---|---|
| classes | 8: NO_TOOL, SHA256, LOOKUP_NOTE, ECHO_INT, WEB, MEMORY, FILES, RESEARCH |
| head | `DummyClassifierHead` = `nn.Linear(256, 8, bias=True)` → **2056** params |
| LoRA | r=2, α=2, `layers.{0–17}.attn.q` and `.v` (36 sites) → **36864** params (verified in EXP-003 `lora-config.json`) |
| trainable | 38920 |
| features | `IsolatedLoRAHeadRuntime`: `forward_hidden` then `head(hidden[:, -1, :])` |
| pooling name | `assistant_boundary_last_token` — prefix ends at `<|assistant|>` plus newline; **not** mean-pool |
| optimizer | AdamW lr=1e-3, β=(0.9,0.999), eps=1e-8, wd=0.01, batch=8 |
| epochs | max 100, min 5, patience 15 on **validation loss** |
| clip | none |
| test each epoch | **no** — test and EVAL-2 run after restore of best val-loss checkpoint |
| dataset | V3 n_train=313 / val=66 / test=62 + EVAL-2 (115) |

## EXP-004 delta (dataset + head width only)

Frozen: WRIM-0, r=2 q+v all 18 layers, last-token pooling, isolated optimizer (LoRA+head only), no promotion.

Changed:

- Head `Linear(256→6)` = **1542** params (verified in dry-run, not arithmetic-only)
- Class order **0 NO_TOOL, 1 WEB, 2 MEMORY, 3 FILES, 4 RESEARCH, 5 SHA256**
- Train: frozen V4 `train.jsonl` n=26 hash `4b8b33f0a44150ebadfbd3c7bc9d0cc09ec3f44836f693222b6e1a83d99d15da`
- Eval: EVAL-4 val 16 / test 16, bundle `f905036c4bafeed776de492f95e0fea1d60e4594e0c5ecf4e915ec19b697a1a2`
- Prompt schema omits lookup_note/echo_int
- Checkpoint metric: **validation macro F1** (EXP-003 used val loss — required change)
- Recipe scaled for n=26: AdamW **lr=5e-4**, batch **4**, max epochs **40**, min **3**, patience **8**, clip **1.0**, optional inverse-frequency class weights

Expected trainable: 36864+1542=**38406** (verified).

## Failure-row semantics

Routing label is the classifier target. Provider outcome is not.

- TAVILY_401 → still **WEB**
- MEMORY no-match → still **MEMORY**
- SHA256 missing argument → still **SHA256** (not NO_TOOL)

## EVAL-2 / EVAL-3

Secondary compatibility diagnostics only. Do not train, tune, overwrite, or select checkpoints on them. EVAL-2 remains 8-class historical; scores there are not EXP-004 success.

V4 internal val/test (4/3) are **not** used for EXP-004.

## Gates fixed before training (EVAL-4 test)

All must pass on the checkpoint chosen from validation only:

| gate | threshold |
|---|---|
| test accuracy | **≥ 0.875** (14/16; > keyword 0.8125 and > BoW 0.75) |
| test balanced accuracy | **≥ 0.80** |
| test macro F1 | **≥ 0.8659** (keyword test macro F1 0.8159 + 0.05) |
| per-class recall | **≥ 0.50** for all six classes, MEMORY included |
| hard-boundary accuracy | **≥ 0.75** on test rows in the four required pair types |
| REAL_TEST subset (test split) | **≥ 0.8125** |
| EVAL_SYNTHETIC | reported separately; cannot pass the experiment; SYNTHETIC_MASKING if synth acc − REAL_TEST acc > 0.15 **and** REAL_TEST < 0.8125 |

Beating majority/random is not success.

## MEMORY interpretation

**ROUTING GENERALIZATION SIGNAL**, not proven broad memory competence. Train MEMORY gold = 2. Eval MEMORY = 6 (EVAL_SYNTHETIC). Live store = 3/2 decree texts.

## Overfit / stop / promotion

Memorization flag: train acc ≥ 0.96 and train−val acc ≥ 0.25. Do not call that capability.

Stop: max 40 epochs, patience 8 on val macro F1, NaN, core mutation, hash/class-map mismatch.

Even if gates pass: state remains **CANDIDATE**. No automatic promotion. Active modules stay `[]` until a later Commander order.

## Dry-run (this mission)

Loaded V4 train + EVAL-4, attached LoRA r=2, initialized 6-way head, ran forward + CE on one train row, ran metric path on one val and one test row.

| check | result |
|---|---|
| LoRA params | 36864 |
| head params | 1542 |
| trainable | 38406 |
| core trainable | 0 |
| core max-abs-diff | 0 |
| LoRA/head max-abs-diff | 0 |
| `optimizer.step` | **NO** |
| `mlx.optimizers` imported | **NO** |
| EXP-004 started | **NO** |

Validator 25/25.

## Next

Training was later authorized and executed (`WR-TOOL-EXP-004-RUN-000001`). Isolation held; all capability gates failed on EVAL-4 test (acc 0.125 vs keyword 0.8125). Do not promote. Do not treat this design review as a second train order.
