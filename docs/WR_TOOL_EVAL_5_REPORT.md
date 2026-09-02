# WR-TOOL EVAL-5

Identity: `WR-TOOL-EVAL-5-CANDIDATE`  
Path: `model-lab/manifests/wr_tool_evals/WR-TOOL-EVAL-5-CANDIDATE/`  
EVAL-4 remains frozen (`f905036c4bafeed776de492f95e0fea1d60e4594e0c5ecf4e915ec19b697a1a2`). Not copied, paraphrased, or trained on.

## Package

- Total **96** (val 48 / test 48), family-isolated, all six classes in both splits
- Bundle `e1c0fd40f92a29d8b1afd229cbc30e2f12a9989341276005860a981b3506add6`
- Hard-boundary families in eval: **42** (WEB vs RESEARCH, FILES vs MEMORY, MEMORY vs NO_TOOL, WEB vs NO_TOOL, SHA256 vs NO_TOOL)
- REAL_RUNTIME+REAL_TEST row %: **77.1%** (MEMORY holdout is largely TEST_FIXTURE, labeled)
- Unique families: 67
- Train overlap exact/norm/family: **0**

## Baselines on EVAL-5 test (BoW trained only on V5 train)

| System | Acc | Bal acc | Macro F1 |
| --- | --- | --- | --- |
| Majority | 0.250 | 0.167 | 0.067 |
| Random | 0.167 | 0.167 | 0.167 |
| Keyword | 0.417 | 0.406 | 0.399 |
| Schema/rule | 0.375 | 0.284 | 0.252 |
| BoW logistic | **0.958** | **0.944** | **0.957** |

Lexical finding: EVAL-5 is still highly solvable by bag-of-words on natural wording. That is an exam property, not permission to lower neural gates.

## Fixed success gates (before optimizer)

Acc ≥ 0.9792, bal ≥ 0.9653, macro F1 ≥ 0.9777, per-class recall ≥ 0.40, hard-boundary ≥ 0.60, REAL_TEST/RUNTIME subset ≥ 0.50. Rule: if simple baseline ≥ 0.90, require +1/n_test.

## Verdict

**WR-TOOL EVAL-5 — PASS**
