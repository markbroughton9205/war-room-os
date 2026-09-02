# WR-TOOL EXPERIMENT 004 — TRAINING REPORT

Date: 2026-08-31  
Run ID: `WR-TOOL-EXP-004-RUN-000001`  
Identity: `WR-TOOL-EXP-004`  
Path: `model-lab/manifests/wr_tool_experiments/WR-TOOL-EXP-004/`  
Script: `scripts/wrim-modular/run_tool_pi_exp_004.py`  
Python: `/Users/markbroughton/Developer/war-room-os/.venv-wrim`

**Mission verdict:** WR-TOOL EXPERIMENT 004 TRAINING — PASS  
**Capability verdict:** WR-TOOL EXP004 — CAPABILITY ACQUISITION NOT DEMONSTRATED  
**Promotion:** none (CANDIDATE). Active modules remain `[]`. Production not touched. Git not committed.

Runtime estimate before first optimizer step: likely **46s**, worst **124s** (budget 3600s). Actual wall **64.3s**. Training did start.

## Architecture (held)

- Frozen WRIM-0 SHA `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`
- Core trainable parameters: **0**
- LoRA r=2, α=2, `layers.{0–17}.attn.q` and `.v` (36 sites), **36,864** params
- Head `Linear(256→6, bias=True)`, **1,542** params
- Total trainable: **38,406**
- Pooling: `assistant_boundary_last_token` (`forward_hidden` then `hidden[:, -1, :]`). Not mean-pool.
- Class map: 0 NO_TOOL, 1 WEB, 2 MEMORY, 3 FILES, 4 RESEARCH, 5 SHA256

## Data

| split | identity | n | hash |
|---|---|---|---|
| train | frozen V4 `train.jsonl` | 26 | `4b8b33f0a44150ebadfbd3c7bc9d0cc09ec3f44836f693222b6e1a83d99d15da` |
| val | EVAL-4 validation | 16 | bundle `f905036c4bafeed776de492f95e0fea1d60e4594e0c5ecf4e915ec19b697a1a2` |
| test | EVAL-4 test | 16 | same bundle; used **once** after checkpoint freeze |

Train class counts: NO_TOOL 6, WEB 5, MEMORY 2, FILES 4, RESEARCH 5, SHA256 4. Class-weighted CE was **not** fixed in the design artifact; this run used **unweighted** cross-entropy. Imbalance (MEMORY n=2) is a limitation, not a post-hoc weight invention.

EVAL-4 did not enter optimizer batches. EVAL-2 (115) and EVAL-3 (13) were not trained, tuned, overwritten, or used for checkpoint selection.

Failure-row semantics: routing target preserved (test failure row `e4_972b4cbc6d48bf3b` gold SHA256, predicted NO_TOOL).

## Recipe

AdamW lr=5e-4, β=(0.9,0.999), ε=1e-8, wd=0.01, batch=4, clip=1.0, max 40, min 3, patience 8 on **validation macro F1**. Seeds 20260831 / head 11 / LoRA 20260831.

Stop: **patience_8_on_val_macro_f1** after **31** epochs. Best epoch **23** (val macro F1 **0.4286**, val acc **0.4375**, val balanced acc **0.4444**, val loss **2.9786**). Tie-break was not needed against epoch 28 (same F1, lower balanced accuracy).

## Overfit

Official selected-checkpoint flag: **false** (train acc **0.9231**, gap vs val **0.486**).  
History: epochs **24–31** had train acc **0.9615** with val acc ≤0.4375 (gap ≥0.25). Those epochs meet the memorization inequality and were **not** selected. They are not capability.

## Canonical EVAL-4 test (selected checkpoint)

| metric | value | gate | result |
|---|---|---|---|
| accuracy | 0.125 | ≥0.875 and > keyword 0.8125 and > BoW 0.75 | FAIL |
| balanced accuracy | 0.0972 | ≥0.80 | FAIL |
| macro F1 | 0.1389 | ≥0.8659 | FAIL |
| per-class recall | NO_TOOL 0.25, WEB 0, MEMORY 0.333, FILES 0, RESEARCH 0, SHA256 0 | ≥0.50 all six | FAIL |
| hard-boundary acc | 0.25 (n=8) | ≥0.75 | FAIL |
| REAL_TEST acc | 0.0769 (n=13) | ≥0.8125 | FAIL |
| TOOL-vs-NO_TOOL | 0.75 | report | — |
| conditional tool-ID | 0.0833 | report | — |
| EVAL_SYNTHETIC acc | 0.333 (n=3) | report | — |
| SYNTHETIC_MASKING | **true** (synth−REAL_TEST >0.15 and REAL_TEST <0.8125) | flag | FLAG |
| failure-row routing | 0.0 (n=1) | report | — |

MEMORY recall 0.333 is **ROUTING GENERALIZATION SIGNAL ONLY** (train MEMORY gold=2; live store 3/2 decree texts; held-out MEMORY partly EVAL_SYNTHETIC). Not broad MEMORY competence.

Confusion matrix (rows gold, cols pred; order NO_TOOL, WEB, MEMORY, FILES, RESEARCH, SHA256):

```
[[1, 1, 0, 1, 1, 0],
 [0, 0, 0, 1, 1, 0],
 [0, 1, 1, 0, 0, 1],
 [0, 1, 0, 0, 1, 0],
 [0, 2, 0, 0, 0, 0],
 [1, 2, 0, 0, 0, 0]]
```

## Lexical diagnostics (not used for selection)

- URL-masked WEB (n=2): masked acc **1.0** vs canonical URL subset **0.0**. No collapse; n=2 is not a stable cue test.
- Class/tool-name masking (n=16): acc **0.125**, delta 0 vs canonical. No additional collapse (already at floor).
- Canonical EVAL-4 rows were not modified and were not trained on.

## Historical diagnostics (after test only)

- EVAL-2: 93/115 comparable 6-class subset, acc **0.280**; 22 LOOKUP_NOTE/ECHO_INT **NOT_COMPARABLE**.
- EVAL-3: 13/13 comparable, acc **0.462**. Not checkpoint, not train.

## Isolation / reload

| check | result |
|---|---|
| core tree SHA before | `8d0c903bbcd63f709114c1b69bd2d1136a20e5558f39acd3ad11f403064678b9` |
| core tree SHA after | same |
| max_abs_diff | **0** (attach, train, detach, final eval, reload) |
| module reload | logits/metrics match, class map same, core unchanged |
| selected checkpoint hash | `1943c8d8e8e7cfb8a448e4d1aeb84f26fcf990178ac4f4ab41743ba34834ae78` |
| EXP-002 / EXP-003 | not overwritten |
| production `/Users/markbroughton/WarRoomNode01` | untouched |
| validator / python proofs | 22/22 |

## Next recommendation

Do **not** promote. Do **not** deploy. Do **not** change active modules. Do not re-tune this run against EVAL-4 test.

The isolated 6-class LoRA+head trained on n=26 did not beat keyword/BoW on EVAL-4. The honest bottleneck is **evidence scale and wording shift**, not a missing promotion step. A later Commander mission may authorize more REAL_RUNTIME train gold (without moving EVAL-4 into train) or a different architecture; r=4, argument extraction, Recovery-012, and WRIM1-RUN-000003 remain unauthorized here.

## Remaining uncertainties

- n_test=16: metric variance is large; 0.125 vs 0.4375 val is a real generalization gap, not a threshold tweak.
- Unweighted CE vs MEMORY n=2 was required (weights were not fixed).
- SYNTHETIC_MASKING is flagged; MEMORY/some boundaries are EVAL_SYNTHETIC.
- URL-mask n=2 can flip by chance.
- Prompt-prefix schema tokens contaminate naive keyword-on-prefix; gates used the frozen EVAL-4 keyword **0.8125** on raw input.

## NEXT STEPS FOR OPERATOR

1. Required environment changes: No operator action required.
2. Required SQL/migrations: No operator action required.
3. Restart requirements: No operator action required.
4. Verification URLs/routes: No operator action required. Artifacts are files under `model-lab/manifests/wr_tool_experiments/WR-TOOL-EXP-004/`.
5. Expected successful output: Isolation PASS; capability NOT DEMONSTRATED; active modules `[]`.
6. Feature flags enabled/disabled: No operator action required.
7. What should visibly change in UI: Nothing. This module is not in the live runtime.
8. Safe rollback instruction if needed: No operator action required. Delete only the EXP-004 artifact directory if the Commander wants the run discarded; do not delete EXP-002/EXP-003 or WRIM-0.
