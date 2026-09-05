# WR-TOOL PARAMETER-ISOLATED EXPERIMENT 002 — DESIGN

Date: 2026-08-31  
Status: **AUTHORIZED AND EXECUTED** under Commander order. See `docs/WR_TOOL_PARAMETER_ISOLATED_EXPERIMENT_002_REPORT.md`.

Official frozen core: **WRIM-0** (SHA `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`).  
Tokenizer: **WR-TOKENIZER-0** (SHA `47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7`).  
Recovery-010 remains **TEST_ONLY_COMPARISON**. Not used as a training parent.

## Scientific variable

Experiment 001 held every WRIM-0 parameter frozen and trained only `Linear(256 → 3, bias=True)` on `assistant_boundary_last_token` hidden states.

Experiment 002 changes **one** architectural variable:

**Add LoRA rank r=2 on actual modules `layers.{0–17}.attn.q` and `layers.{0–17}.attn.v`.**

Held constant: WRIM-0 parent, tokenizer, TOOL V2 dataset, semantic labels, EXP-001 example-ID split, family grouping, TOOL-EVAL-1, pooling, linear classifier architecture, classifier CE objective, metrics, router dry-run, production posture.

## Composed candidate (not a foundation)

`WRIM-0 + WR-TOOL-LORA-R2-001 + WR-TOOL-HEAD-002`

This is a composed runtime. It is not WRIM-1, WRIM-1.1, WRIM-2, a merged checkpoint, or a promoted foundation.

## LoRA parameterization (chosen before training)

| Field | Value |
|---|---|
| Implementation | custom `LoRALinear` (MLX has no built-in LoRA for this architecture) |
| Formula | `y = W x + (alpha/r) B(A(x))` |
| Rank | **2** |
| Alpha | **2.0** → scale = 1.0 |
| Targets | `attn.q`, `attn.v` on all 18 layers (36 Linear sites, each 256→256) |
| Init | `A ~ N(0, 1/sqrt(in_features))`, `B = 0` so step-0 delta is identically zero |
| Dropout | none |
| Phase-1 expected count | 36,864 (must be **verified from the live tree**, not hardcoded as PASS) |
| Classifier | Linear(256→3, bias=True) = 771 |
| Expected isolated total | 37,635 |

## Optimizer recipe (one, documented before training)

Not EXP-001’s `LR=1e-2` (that recipe was head-only on **cached** frozen features).

| Field | Value | Rationale |
|---|---|---|
| Optimizer | AdamW | bounded, standard for LoRA + tiny head |
| LR | **1e-3** | below head-only 1e-2; above conservative LM-LoRA 1e-4 because the loss is classifier CE on 59 examples, not token CE |
| betas | (0.9, 0.999) | AdamW default |
| eps | 1e-8 | AdamW default |
| weight decay | 0.01 | same isolation as EXP-001 head |
| batch | 8 (group of per-example forwards) | WRIM has no pad mask; last-token pooling must not see pad tokens |
| max epochs | 100 | bounded |
| early stop | patience **15**, min 5, restore **best validation loss** | validation only; never test / TOOL-EVAL-1 |

If training is non-finite or otherwise unstable: **stop and report**. Do not retune LR inside this experiment identity.

## Runtime gate

Time a handful of forward+backward examples on the real composed graph **before** the epoch loop. If the extrapolated worst-case and likely-case both exceed 60 minutes, **do not start training**.

## Non-goals

- No full-weight training, Recovery-012, WRIM1-RUN-000003, official WRIM training
- No r=4, no MLP classifier, no pooling change, no new dataset
- No production deploy, no ACTIVE module write, no auto-promote
- Do not start Experiment 003 from this design
