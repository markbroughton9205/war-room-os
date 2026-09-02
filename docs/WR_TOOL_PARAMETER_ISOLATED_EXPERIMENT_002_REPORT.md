# WR-TOOL PARAMETER-ISOLATED EXPERIMENT 002 — REPORT

Date: 2026-08-31  
Repo: `/Users/markbroughton/Developer/war-room-os`  
Production (`/Users/markbroughton/WarRoomNode01`): **not modified**

## Verdicts

**WR-TOOL PARAMETER-ISOLATED EXPERIMENT 002 — PASS**  
(infrastructure / isolation / completed evaluation)

**WR-TOOL LoRA-R2 — CAPABILITY ACQUISITION DEMONSTRATED**

Frozen WRIM-0 stayed bit-for-bit unchanged (`max_abs_diff=0`, weight-tree SHA identical, detached 13-probe hash identical). Isolated LoRA r=2 on actual `attn.q` + `attn.v` (36,864 params) plus `Linear(256→3)` (771 params) trained only classifier cross-entropy on the exact Experiment 001 split. Held-out LOOKUP_NOTE recall moved from **0 to 1.0**, conditional tool-ID from **0.50 to 0.83**, TOOL-EVAL-1 from **6/12 to 9/12**, test accuracy from **0.75 to 0.833** (above the keyword baseline). SHA256↔LOOKUP_NOTE centroid L2 rose from **0.41 to 15.5** (Fisher ratio **0.92 → 23.5**). Modules remain **CANDIDATE**. ACTIVE modules `[]`. Not promoted. LoRA r=4 / Experiment 003 / Recovery-012 / WRIM1-RUN-000003 **not started**.

Artifacts: `model-lab/manifests/modular-intelligence/WR-TOOL-PI-EXP-002/`  
Validation: `scripts/wrim-modular/prove_tool_pi_exp_002.py` **28/28**

---

1. **Experiment identity:** `WR-TOOL-PI-EXP-002` — WR-TOOL PARAMETER-ISOLATED EXPERIMENT 002  
2. **LoRA module identity:** `WR-TOOL-LORA-R2-001` (`LORA`)  
3. **Head module identity:** `WR-TOOL-HEAD-002` (`CLASSIFIER_HEAD` / router head)  
4. **Core identity:** `WRIM-0` (`OFFICIAL_FROZEN_CORE`). Recovery-010 unused. Composed candidate: `WRIM-0 + WR-TOOL-LORA-R2-001 + WR-TOOL-HEAD-002` (not WRIM-1 / 1.1 / 1.2 / merged checkpoint).  
5. **Core checkpoint SHA:** `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`  
6. **Tokenizer SHA:** WR-TOKENIZER-0 `47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7`  
7. **Core total params:** 19,217,152  
8. **Core trainable params:** **0** (base WRIM leaves; LoRA A/B are not core)  
9. **LoRA target modules:** `layers.{0–17}.attn.q` and `layers.{0–17}.attn.v` (36 sites; not `q_proj`/`v_proj`)  
10. **LoRA rank:** 2  
11. **LoRA alpha/scaling:** alpha=2.0, scale=`alpha/r`=1.0  
12. **LoRA initialization:** `A ~ N(0, 1/sqrt(in_features))`, `B = 0`, dropout none. Step-0 attached vs detached logit/hidden **max_abs_diff = 0**.  
13. **Exact LoRA param count (computed):** **36,864** (matches Phase 1 expected 36,864; not hardcoded as PASS)  
14. **Exact classifier architecture:** `Linear(256 → 3, bias=True)` on last hidden at assistant boundary  
15. **Classifier param count:** **771**  
16. **Total trainable isolated params:** **37,635**  
17. **Optimizer parameter-tree proof:** AdamW trainable keys are only `backbone.layers.*.attn.{q,v}.lora_{a,b}` and `head.proj.{weight,bias}`. `base_trainable_keys=[]`. Core keys in optimizer: none.  
18. **Exact EXP-001 split reuse proof:** example IDs, splits, gold classes, and template families copied from `WR-TOOL-PI-EXP-001/dataset-split.json`. Train ID sets equal. Input-ids hash matches EXP-001: `f6f8eb6944e37e40c278920828fbdeb14e8ebd805a9495d7760bf148599c10f2`.  
19. **Train count:** 59  
20. **Validation count:** 17  
21. **Test count:** 12  
22. **Class distribution:** train NO_TOOL 20 / SHA256 22 / LOOKUP_NOTE 17; val 6 / 9 / 2; test 6 / 3 / 3  
23. **Leakage:** train/test template overlap **0**; CAP-EVAL-0 `known_eval_leakage=0`; TOOL-EVAL-1 `known_eval_leakage=0`  
24. **Pooling strategy:** `assistant_boundary_last_token` (unchanged). Training did **not** use EXP-001 static hidden cache.  
25. **Objective:** classifier cross-entropy only. No LM loss, no tool-generation CE.  
26. **Optimizer:** AdamW  
27. **LR:** 1e-3 (not EXP-001’s 1e-2; chosen once for LoRA+head on 59 examples)  
28. **Batch size:** 8 (group of per-example forwards; no pad mask)  
29. **Max epochs:** 100  
30. **Early-stop policy:** min 5, patience **15**, restore **best validation loss**; never test/TOOL-EVAL-1 for selection  
31. **Best epoch:** **94** (ran through epoch 100; restored epoch 94)  
32. **Train loss (best ckpt):** **0.000139**  
33. **Validation loss (best ckpt):** **0.215**  
34. **Train accuracy (best ckpt + τ):** **1.0**  
35. **Validation accuracy:** **0.914** (16/17)  
36. **Test accuracy:** **0.833** (10/12)  
37. **Balanced accuracy (test):** **0.833**  
38. **Macro F1 (test):** **0.820**  
39. **Per-class precision (test):** NO_TOOL **1.0**; SHA256 **1.0**; LOOKUP_NOTE **0.60**  
40. **Per-class recall (test):** NO_TOOL **0.833**; SHA256 **0.667**; LOOKUP_NOTE **1.0**  
41. **Per-class F1 (test):** NO_TOOL **0.909**; SHA256 **0.80**; LOOKUP_NOTE **0.75**  
42. **Confusion matrix (test, rows gold NO_TOOL/SHA256/LOOKUP_NOTE):** `[[5,0,1],[0,2,1],[0,0,3]]`  
43. **NO_TOOL recall:** test **0.833**; val **1.0**; train **1.0**  
44. **TOOL vs NO_TOOL accuracy:** test **0.917** (same as EXP-001)  
45. **SHA256 recall:** test **0.667** (EXP-001 was 1.0; one SHA256 → LOOKUP_NOTE)  
46. **LOOKUP_NOTE recall:** test **1.0** (EXP-001 was **0**)  
47. **Conditional tool-ID accuracy:** test **0.833** (EXP-001 **0.50**)  
48. **Distractor score:** family-held-out distractor n=6, accuracy **0.833**; tool-id among distractors **0.833**  
49. **TOOL-EVAL-1 overall:** **9/12 (0.75)** vs EXP-001 **6/12**  
50. **TOOL-EVAL-1 class breakdown:** NO_TOOL subset 3/4 (0.75); SHA256 5/5 (1.0); LOOKUP_NOTE 1/3 (0.33); tool subset accuracy 0.75; TOOL vs NO_TOOL 0.917  
51. **Experiment 001 comparison**

| metric | EXP-001 | EXP-002 |
|---|---:|---:|
| test accuracy | 0.750 | **0.833** |
| balanced accuracy | 0.667 | **0.833** |
| macro F1 | 0.558 | **0.820** |
| NO_TOOL recall | 1.0 | 0.833 |
| SHA256 recall | 1.0 | 0.667 |
| LOOKUP_NOTE recall | 0 | **1.0** |
| TOOL vs NO_TOOL | 0.917 | 0.917 |
| conditional tool-ID | 0.50 | **0.833** |
| TOOL-EVAL-1 | 6/12 | **9/12** |

52. **Keyword baseline comparison:** keyword test accuracy **0.75**; EXP-002 **0.833** (now **above** keyword). Majority **0.25**; random ~**0.33**.  
53. **Class centroid / separability:** frozen SHA256↔LOOKUP centroid L2 **0.411**, Fisher **0.915**. LoRA-adapted centroid L2 **15.50**, Fisher **23.47**. Within-class scatter also grew (representations expanded), but between-tool separation grew much more.  
54. **SHA256↔LOOKUP_NOTE separability delta:** centroid L2 **+15.09**; Fisher **+22.56**. H1’s geometry claim is supported.  
55. **LoRA pre/post movement:** max_abs_diff **0.386**; hashes `50014084…` → `15161c2b…`  
56. **Head pre/post movement:** max_abs_diff **0.302**; hashes `ca002b19…` → `9cc393fe…` (same head init seed as EXP-001 pre-hash)  
57. **Core pre-training hash:** `8d0c903bbcd63f709114c1b69bd2d1136a20e5558f39acd3ad11f403064678b9`  
58. **Core post-training hash:** identical  
59. **Core max_abs_diff:** **0.0**  
60. **Detached 13-probe comparison:** output hash `44ed0cefdaf7706317609b81df76e252f2b1b00363b53dfdea7adfb3f66ef119` before and after (identical).  
61. **Attached 13-probe result:** different hash (expected: LoRA changes generation). Tokenizer-mode probe count **5/13**, same as detached WRIM-0.  
62. **Attached collapse count:** **5/13** (token-repeat metric)  
63. **Attached unique ratio:** mean **0.447**  
64. **Degeneration trace:** attached tokenizer/underscore on sky, hello, punct, seq, code. Detached WRIM-0 already tokenizer-collapsed sky/hello/seq/code/repeat. Adapter **did not create a new class**; `punct` newly entered tokenizer mode; `repeat` lost `-lab` loops. `adapter_created_broad_degeneration=false`.  
65. **LoRA artifact reload:** `module/WR-TOOL-LORA-R2-001/weights.safetensors` (no WRIM-0 weights); reload logits match  
66. **Classifier artifact reload:** `module/WR-TOOL-HEAD-002/weights.safetensors`; reload logits match  
67. **Attach/detach proof:** reattach classifier logits match; detached core hash/probes exact  
68. **ToolIntent proof:** class → compact `TOOL=lookup_note` / `TOOL=sha256` / `TOOL=none`  
69. **Tool Router proof:** `TOOL=none` VALID; class-only `TOOL=lookup_note` MISSING_ARGUMENT (classifier does not extract args); gold-arg SHA256 fixture VALID  
70. **Execution-boundary proof:** dry-run only; `executed=false`; would_call `agi_gym_sha256` for the fixture  
71. **Final module lifecycle:** both modules **CANDIDATE** (SHADOW during train; **not PROMOTED**)  
72. **ACTIVE core:** WRIM-0  
73. **ACTIVE modules:** `[]`  
74. **Production status:** untouched  
75. **Git status:** dirty worktree preserved; this experiment **not committed** (Commander did not authorize commit/push)  
76. **Scientific interpretation:** Frozen last-hidden states were not linearly separable for SHA256 vs LOOKUP_NOTE (EXP-001). LoRA r=2 on q/v **did** reshape `norm_f` last-token geometry enough for a linear head to recover LOOKUP_NOTE on the same family-held-out test set, without moving 19.2M core weights. Tool vs no-tool stayed 91.7%. Cost: one NO_TOOL and one SHA256 test example nowed as LOOKUP_NOTE; SHA256 recall dropped. Train accuracy 1.0 at epoch 94 on 59 examples is a small-n overfit risk, but validation (16/17) and test (10/12) still improved versus EXP-001.  
77. **Whether H1 is supported:** **Yes**, on this dataset and split. Frozen WRIM-0 already had TOOL vs NO_TOOL signal; r=2 LoRA made tool identities more separable without editing the foundation.  
78. **Exact next recommendation:** **STOP.** Return evidence to Commander. Do **not** auto-start LoRA r=4, Experiment 003, Recovery-012, WRIM1-RUN-000003, or promotion. Likely later work (only if ordered): broaden labeled tool identities / real trajectories, then Model Lab lifecycle — not a merge into WRIM-0.  
79. **Remaining uncertainties:** n_test=12 is tiny (LOOKUP 3/3 can flip); TOOL-EVAL-1 LOOKUP_NOTE still 1/3; τ=0 (argmax) from val TOOL vs NO_TOOL already 1.0 so no override; train CE ~0 by epoch 20 while val kept improving slowly through 94; composed generation still contains WRIM-0 tokenizer loops; results are semantic routing only, not tool-argument extraction or generation.  
80. **Final experiment verdict:** WR-TOOL PARAMETER-ISOLATED EXPERIMENT 002 — PASS  
81. **Final capability verdict:** WR-TOOL LoRA-R2 — CAPABILITY ACQUISITION DEMONSTRATED  

## Runtime

Timed before training: ~0.065–0.36 s/example fwd+bwd. Likely ~2–12 min; worst-case under 40 min. Actual final run ~6.4 minutes to completion. Did not exceed the 60-minute stop gate.

## Threshold

τ = **0.0** (no NO_TOOL override) from validation TOOL vs NO_TOOL only. Softmax values are **raw, not calibrated**.

## Stop state

Do **not** start: LoRA r=4, Experiment 003, Recovery-012, WRIM1-RUN-000003, WRIM-1.2, promotion, production deploy.

## NEXT STEPS FOR OPERATOR

1. Required environment changes — **No operator action required.**
2. Required SQL/migrations — **No operator action required.**
3. Restart requirements — **No operator action required.**
4. Verification URLs/routes — **No operator action required.** Inspect `model-lab/manifests/modular-intelligence/WR-TOOL-PI-EXP-002/` and this report. Re-run `.venv-wrim/bin/python scripts/wrim-modular/prove_tool_pi_exp_002.py` (28/28).
5. Expected successful output — Isolation PASS; capability DEMONSTRATED; core SHA unchanged; ACTIVE modules empty; modules CANDIDATE only.
6. Feature flags enabled/disabled — **No operator action required.**
7. What should visibly change in UI — **Nothing.** Adapter is not ACTIVE.
8. Safe rollback instruction if needed — Delete `model-lab/manifests/modular-intelligence/WR-TOOL-PI-EXP-002/` and leave WRIM-0 weights untouched. Do not deploy.
