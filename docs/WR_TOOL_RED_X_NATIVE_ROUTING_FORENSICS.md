# WR-TOOL RED-X NATIVE ROUTING FORENSICS

Identity: `WR-TOOL-RED-X-FORENSICS-001`  
Path: `model-lab/manifests/wr_tool_experiments/WR-TOOL-RED-X-FORENSICS-001/`  
Replaces: EXP006 (not executed)

**WR-TOOL RED-X NATIVE ROUTING FORENSICS — PASS**

No WRIM training. No LoRA training. No EXP006. WRIM-0 weights unchanged (`max_abs_diff=0`). Production untouched. EVAL-5 test used once after validation selection.

## Question

Does WRIM-0 already contain routing information that EXP005 last-token LoRA failed to read?

## Locked configuration (validation only)

- Layer: `layers.10` (implementation index 10 of 0–17; post-block residual)
- Pooling: mean over prompt tokens (equal to masked-mean; no padding)
- Normalization: raw (centering / L2 / PCA / whitening all lost to raw on val)
- Probe: L2 logistic regression
- Then evaluated **once** on EVAL-5 test

## EVAL-5 test (selected config, once)

| Metric | Frozen mean-pool L10 logistic | EXP005 LoRA last-token | Authoritative BoW |
| --- | --- | --- | --- |
| Accuracy | 0.7708 | 0.5625 | 0.958 |
| Balanced acc | 0.7720 | 0.5386 | 0.944 |
| Macro F1 | 0.7693 | 0.5137 | 0.957 |
| TOOL-vs-NO_TOOL | 0.9375 | 0.8125 | 0.958 |
| Conditional tool-ID | 0.75 | 0.5278 | 0.944 |

Δ vs EXP005 balanced: **+0.233** (≥ 0.15 extraction gate).  
Δ vs BoW balanced: **−0.172**.

V5-style BoW reproduction on the same split matched the frozen EVAL-5 baseline exactly (acc 0.958 / bal 0.944 / F1 0.957).

## Layers inspected

Accessible hidden states (not literature numbering):

- `tok_emb` — embedding output
- `layers.0` … `layers.17` — post-block residual after attention + SwiGLU
- `norm_f` — final RMSNorm (the EXP001–005 last-token source)

Routing information **peaks before the final layer**. Best last-token 6-way layer is also `layers.10` (val bal 0.739), not `norm_f` (val bal 0.426).

| Task | Best last-token layer | Val balanced |
| --- | --- | --- |
| 6-way | layers.10 | 0.739 |
| TOOL vs NO_TOOL | layers.14 | 0.845 |
| WEB vs RESEARCH | layers.9 | 1.000 (n=13, tiny) |
| FILES vs MEMORY | layers.11 | 0.955 (n=18) |
| SHA256 vs NO_TOOL | layers.14 | 0.786 (n=17) |

## Pooling

Last-token is **not** optimal.

| Variant | Split | Balanced acc |
| --- | --- | --- |
| `norm_f` last-token logistic | val | 0.426 |
| `norm_f` mean | val | 0.544 (Δ +0.118 vs last) |
| `norm_f` max | val | 0.719 (Δ +0.293 vs last) |
| `layers.10` last-token | val | 0.739 |
| `layers.10` mean (selected) | val | 0.867 (Δ +0.128 vs same-layer last; Δ +0.441 vs final last-token) |
| layer-averaged mean-pool | val | 0.851 (below selected) |

Max pooling at the final layer preserves more lexical identity than last-token, but mid-layer mean still wins.

## Geometry / anisotropy

Measured on V5 train, not from literature.

| | `norm_f` last-token | `layers.10` mean |
| --- | --- | --- |
| Effective rank | 13.45 | 6.11 |
| Mean pairwise cosine | 0.995 | 0.999 |

Representations are **measurably anisotropic** (near-collinear). Whitening best val Δ vs raw: **−0.033**. Centering / L2 / PCA did not meet the +0.10 gate. Anisotropy is real; it was **not** the accuracy bottleneck.

## Probes (validation, selected features)

| Probe | Acc | Bal | Macro F1 |
| --- | --- | --- | --- |
| L2 logistic (best linear) | 0.875 | 0.867 | 0.869 |
| Linear SVM | below logistic | — | — |
| Cosine nearest centroid | 0.646 | 0.627 | — |
| KNN k=5 (best nonlinear) | 0.667 | 0.647 | 0.657 |
| RBF SVM / MLP-64 | did not beat logistic | — | — |

Nonlinear − linear balanced: **−0.219**. Information that is readable is **linearly** readable. The linear boundary was not the bottleneck.

## Hierarchy

Val: coarse hierarchy 0.869 vs flat 0.867 (Δ +0.002). Test of val-selected hierarchy C: 0.683 vs flat test 0.772. Stage-1 can look healthy while exact ID remains the failure; hierarchy did **not** meet the +0.10 gate and did not beat flat on the locked test.

## Registry (shadow only; TOOL_REGISTRY not mutated)

Test balanced: lexical 0.410, WRIM cosine 0.269, hybrid 0.258, TF-IDF top-1 0.521 / top-3 0.708. Fixed-class frozen probe still wins. Distractors (10 candidates, 4 extra tools) drop TF-IDF val top-1 from 0.438 to 0.313. Holdout SHA256 is a tiny-n simulation; do not overclaim. Fixed-ID architecture is **not** demonstrated as the bottleneck on this exam.

## Abstention (design only, not production-enabled)

Wrong routes have lower top1–top2 margin (test mean margin correct 0.832 vs incorrect 0.641). Margin thresholding barely lifts accuracy (coverage stays high). Codes designed: `NO_COMPATIBLE_TOOL`, `IDENTITY_AMBIGUOUS`. Calibrated abstention is only weakly viable here.

## Hard subsets (EVAL-5 test labels, selected probe vs BoW)

| Pair | Selected probe acc | BoW acc |
| --- | --- | --- |
| WEB vs RESEARCH | 0.692 | 1.00 |
| FILES vs MEMORY | 0.765 | 0.941 |
| MEMORY vs NO_TOOL | 0.783 | 1.00 |
| SHA256 vs NO_TOOL | 0.833 | 0.944 |
| WEB vs NO_TOOL | 0.737 | 1.00 |

## Decision gates

| Gate | Result |
| --- | --- |
| A Extraction ≥0.15 test bal vs EXP005 | **DEMONSTRATED** (+0.233; last-token was a major bottleneck) |
| B Whitening/centering ≥0.10 | **NOT DEMONSTRATED** |
| C Nonlinear ≥0.10 over linear | **NOT DEMONSTRATED** |
| D Hierarchy ≥0.10 over flat | **NOT DEMONSTRATED** |
| E Registry beats fixed-ID | **NOT DEMONSTRATED** |
| F WRIM-0 limit (best frozen bal ≤0.65 and BoW ≥0.90 plus overlap) | **NOT PROVEN** (best frozen test bal 0.772 > 0.65) |

A poor last-token LoRA does not prove WRIM is globally a bad model. Frozen mid-layer mean-pooled states are routing-informative on this still-lexical exam; they still lose to BoW.

## EVAL-6

Design only at RED-X time (`eval6-design.json`). **Later materialized** as `WR-TOOL-EVAL-6-CANDIDATE` (see `docs/WR_TOOL_EVAL_6_SEMANTIC_BENCHMARK.md` and `docs/WR_TOOL_FROZEN_ROUTER_EVAL_6_REPORT.md`). Frozen L10 mean router RED-X reproduction **PASS**; EVAL-6 semantic routing **NOT DEMONSTRATED** (RESULT E). Do not train WRIM on EVAL-6.

## Core immutability

- File SHA before/after: `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`
- Tree SHA before/after: `8d0c903bbcd63f709114c1b69bd2d1136a20e5558f39acd3ad11f403064678b9`
- `max_abs_diff`: 0
- Active core: WRIM-0. Active modules: `[]`

## Next architecture

Do not start EXP006. Do not train WRIM or LoRA on V5/EVAL-5. A frozen-core linear head on `layers.10` mean-pool was materialized as `WR-TOOL-FROZEN-ROUTER-L10-MEAN-V1` (SHADOW). EVAL-6 then showed that head does **not** close the BoW gap under lexical control (WRIM bal 0.483 vs BoW 0.793). Native Router V1 later combined deterministic state routing with that frozen head as one signal (`WR-NATIVE-ROUTER-V1-CANDIDATE`, SHADOW). Keep historical RED-X numbers unchanged. Do not promote WRIM as the entire switchboard.

