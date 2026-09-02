# WR-TOOL FROZEN NATIVE ROUTER V1

Identity: `WR-TOOL-FROZEN-ROUTER-L10-MEAN-V1`  
Path: `model-lab/manifests/wr_tool_experiments/WR-TOOL-FROZEN-ROUTER-L10-MEAN-V1/`  
Lifecycle: **SHADOW** (not promoted). Active modules remain `[]`.

This is a development/shadow routing head. It does not modify WRIM-0.

## Architecture

WRIM-0 frozen → transformer forward with hidden intercept at **layers.10** (post-block residual) → **mean pool** over prompt tokens (no padding; equal to masked mean) → **raw** features → **L2 logistic regression** → 6 classes:

0 NO_TOOL, 1 WEB, 2 MEMORY, 3 FILES, 4 RESEARCH, 5 SHA256

`forward_hidden` / `norm_f` is **not** the representation site. RED-X showed last-token final-layer probes were the extraction bottleneck.

## Fit

- Train: WR-TOOL-CURRICULUM-V5-CANDIDATE `train.jsonl` hash `f9e1ae99e46fa1bf767f95c246f5aa0ee55a5153e671374859bc30eeb9ffad33` (n=156)
- Layer / pooling / normalization / classifier family: exact RED-X
- Classifier trainable parameters: **1542** (256×6 + 6). WRIM trainable: **0**
- Artifact bundles `classifier.npz` (coef + intercept). No WRIM tensors.

## RED-X reproduction (EVAL-5 test, once)

| Metric | Locked RED-X | This fit |
| --- | --- | --- |
| Accuracy | 0.7708 | 0.7708 |
| Balanced | 0.7720 | 0.7720 |
| Macro F1 | 0.7693 | 0.7693 |

**PASS** (tolerance 5e-4). sklearn `lbfgs` still hits `max_iter=800` as in RED-X; do not raise iterations.

## Core immutability

File SHA before/after: `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`  
Tree SHA: `8d0c903bbcd63f709114c1b69bd2d1136a20e5558f39acd3ad11f403064678b9`  
`max_abs_diff`: 0

## Shadow runtime

Flag `WR_TOOL_FROZEN_ROUTER_SHADOW` default **OFF**. Production `NODE_ENV` always off. Scoring attaches provenance on the existing trajectory observer and never changes `routeToolIntent`.

## Promotion

Not promoted. EVAL-6 showed this head is **not** ready for promotion review (see `docs/WR_TOOL_FROZEN_ROUTER_EVAL_6_REPORT.md`).
