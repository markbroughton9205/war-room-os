# WR-TOOL EXP-005 TRAINING

Run: `WR-TOOL-EXP-005-RUN-000001`  
Path: `model-lab/manifests/wr_tool_experiments/WR-TOOL-EXP-005/`

## Execution

**WR-TOOL EXPERIMENT 005 TRAINING — PASS** (isolation + one bounded run).  
**WR-TOOL EXP005 — CAPABILITY ACQUISITION NOT DEMONSTRATED**

WRIM-0 SHA unchanged. Core trainable 0. LoRA r2 q+v 36864 + head 1542 = **38406**. Core max_abs_diff **0** before/attach/train/eval/reload. Reload logits/metrics match. Modules remain **CANDIDATE**. Active `[]`. Not promoted. Production untouched.

Selected checkpoint: epoch **14**, val acc 0.6042, val bal 0.5949, val macro F1 **0.5865**. Train acc at freeze **0.9103**. Gap 0.306. Memorization flag false (train acc < 0.96 at selected checkpoint). Stop: max 18 epochs. Wall ~206s.

## EVAL-5 test (once)

| Metric | Value | Gate | Result |
| --- | --- | --- | --- |
| Accuracy | 0.5625 | ≥ 0.9792 and > BoW 0.958 | FAIL |
| Balanced acc | 0.5386 | ≥ 0.9653 | FAIL |
| Macro F1 | 0.5137 | ≥ 0.9777 | FAIL |
| Recall NO_TOOL/WEB/MEMORY/FILES/RESEARCH/SHA256 | 0.667 / 0.429 / 0.636 / 1.00 / 0.333 / 0.167 | ≥ 0.40 all | FAIL (RESEARCH, SHA256) |
| TOOL-vs-NO_TOOL | 0.8125 | — | — |
| Conditional tool-ID | 0.5278 | — | — |
| Hard-boundary | 0.5405 (n=37) | ≥ 0.60 | FAIL |
| REAL_RUNTIME+REAL_TEST | 0.5405 (n=37) | ≥ 0.50 | PASS |
| TEST_FIXTURE | 0.6364 (n=11) | — | — |

Confusion (rows gold NO_TOOL, WEB, MEMORY, FILES, RESEARCH, SHA256): FILES is the only class with recall 1.0; SHA256 mostly collapses to NO_TOOL/FILES; WEB confused with FILES.

## EVAL-4 historical (untouched exam, not used for selection)

Acc **0.3125** / bal **0.306** / macro F1 **0.231** vs EXP004 test **0.125 / 0.097 / 0.139**. Directionally better, still not capability.

## Lexical diagnostics

URL-mask: no URL-containing EVAL-5 test rows (`url_masked` null). Class-name mask acc 0.5417 (Δ −0.021, not a material collapse). BoW on the same exam remains ~0.92–0.96: the adapter did not beat the trivial system.

## Forensic reading (no retry)

Scale and family diversity **did** move the student off EXP004’s 0.125 EVAL-4 collapse. They did **not** beat BoW on a still-lexical EVAL-5, and hard-boundary / RESEARCH / SHA256 identity remain weak. Do not answer with LR/rank/epoch fishing. Remaining bottleneck is **representation vs lexical cues on a 20M frozen core with r=2**, plus MEMORY still fixture-backed.

Checkpoint hash `db80414dc4854a7fdda95b292ca914fede9162c6683a56228fe1297d7c6f017c`.

## Successor: RED-X (replaces EXP006)

EXP006 was **not** run. Forensics identity `WR-TOOL-RED-X-FORENSICS-001` (`docs/WR_TOOL_RED_X_NATIVE_ROUTING_FORENSICS.md`). Frozen WRIM-0 only. Selected `layers.10` mean-pool + L2 logistic. EVAL-5 test acc **0.7708** / bal **0.7720** / macro F1 **0.7693** vs this run’s 0.5625 / 0.5386 / 0.5137 (extraction Δ +0.233). BoW remains 0.958 / 0.944 / 0.957. No LoRA, no WRIM training, no promotion.

