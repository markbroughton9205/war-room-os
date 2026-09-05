# WR-TOOL PARAMETER-ISOLATED EXPERIMENT 001 — DESIGN

Date: 2026-08-31  
Status: **EXECUTED 2026-08-31.** See `docs/WR_TOOL_PARAMETER_ISOLATED_EXPERIMENT_001_REPORT.md`.

Official frozen core: **WRIM-0** (SHA `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`).  
Recovery-010 remains TEST_ONLY comparison only.

## Outcome (do not treat as a design guess)

- Isolation: **PASS** (core max_abs_diff=0, 771-param CLASSIFIER_HEAD, no LoRA).  
- Capability: **INCONCLUSIVE** — TOOL vs NO_TOOL on family-held-out test is strong (91.7%); LOOKUP_NOTE recall is 0.  
- LoRA r=2 on `attn.q` + `attn.v` remains the next candidate and is **not started**.

## Capacity language

Full-weight tool training is repeatedly unstable in the current WRIM-1.1 regime.  
Parameter-isolated tool learning is **now tested once** (linear head only).  
A 19.2M capacity ceiling is **not** proven.

Official frozen core: **WRIM-0** (SHA `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`).  
Recovery-010 may be a TEST_ONLY comparison core only.

## Capacity language

Full-weight tool training is repeatedly unstable in the current WRIM-1.1 regime.  
Parameter-isolated tool learning is **untested**.  
A 19.2M capacity ceiling is **not** proven.

## Actual WRIM modules (inspected)

There is **no** `q_proj` / `v_proj`. Attention Linears are named:

`layers.{0..17}.attn.q` `k` `v` `o` — each `Linear(256 → 256)`, bias false.

FFN (SwiGLU): `ffn.gate` `up` (`256 → 768`), `ffn.down` (`768 → 256`).

Tied `tok_emb`; **no untied lm_head**.

126 Linear modules total. Eligible adapter sites are those Linears plus a last-hidden classifier on `norm_f` output (`d_model=256`).

## MLX LoRA

Installed MLX has **no** LoRA API. Custom `LoRALinear` is required (`scripts/wrim-modular/capability_module.py`). Counts from **actual** shapes: `r * (in + out)` per targeted Linear.

### LoRA on `attn.q` + `attn.v` (18 layers × 2 × 256×256)

| rank | parameters |
|---:|---:|
| r=1 | **18,432** |
| r=2 | **36,864** |
| r=4 | **73,728** |
| r=8 | **147,456** |

### LoRA on `q,k,v,o`

| rank | parameters |
|---:|---:|
| r=1 | 36,864 |
| r=2 | 73,728 |
| r=4 | 147,456 |
| r=8 | 294,912 |

### LoRA on attention + SwiGLU

| rank | parameters |
|---:|---:|
| r=1 | 92,160 |
| r=2 | 184,320 |
| r=4 | 368,640 |
| r=8 | 737,280 |

Core remains 19,217,152 frozen parameters in all cases.

## Classifier / router head (feasible)

Last-token hidden `256` → N classes, bias on:

| head | parameters |
|---|---:|
| 3-way (sha256 / lookup_note / none) | **771** |
| 4-way | **1,028** |
| 8-way | **2,056** |

Dummy Phase 1 head (4-way) already attaches without moving core weights.

## Strategy choice (not a guess)

Recommend **A. CLASSIFIER_HEAD / ROUTER_HEAD** as Experiment 001’s first isolated run:

1. Tool-use failure mode in 011 was **full-weight LM updates** on compact `TOOL=` tokens, not a missing attention name.
2. The decision is discrete (tool vs none + tool id). A head on last hidden matches that geometry without touching 19.2M LM weights.
3. 771–1028 trainable parameters vs 36k–73k for LoRA r=2 on q/v — smaller isolation, cheaper forensic.
4. Compact dialect + Tool Router already exist; the head can emit/score compact intent without teaching JSON.

Then, only if the head cannot separate TOOL vs NO_TOOL on a **clean held-out** set while core `max_abs_diff=0`:

**B. LoRA r=2 on `attn.q` + `attn.v`** (36,864 params), then **C. r=4** (73,728) as a rank ablation.

Do not start A/B/C until Commander authorizes Experiment 001. Dataset should be compact V2 + Tool Router labels, not V1 JSON, with CAP-EVAL-0 / TOOL-EVAL-1 held out. SHADOW only. No promotion path without Commander.

## Execution note (2026-08-31)

Commander authorized and executed **A** only (`WR-TOOL-PI-EXP-001`). Strategy **B/C** remain unauthorized.

## Non-goals for Experiment 001

- No WRIM-0 weight training  
- No merge of adapter into a new “WRIM-1.2” checkpoint  
- No production swap  
- No Recovery-012 full-weight recipe
