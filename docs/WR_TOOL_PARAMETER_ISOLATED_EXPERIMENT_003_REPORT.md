# WR-TOOL PARAMETER-ISOLATED EXPERIMENT 003 — REPORT

Date: 2026-08-31  
Repo: `/Users/markbroughton/Developer/war-room-os`  
Production (`/Users/markbroughton/WarRoomNode01`): **not modified**

## Verdicts

**WR-TOOL PARAMETER-ISOLATED EXPERIMENT 003 — PASS**  
(isolation / frozen-core / completed evaluation)

**WR-TOOL V3 LoRA-R2 — CAPABILITY ACQUISITION NOT DEMONSTRATED**

The same r=2 q/v architecture from Experiment 002 trained cleanly on WR-TOOL-CURRICULUM-V3 without moving WRIM-0 (`max_abs_diff=0`). Isolation proofs 30/30. EVAL-2 accuracy **0.504** / macro F1 **0.399** beats majority (0.122) and random (0.125) but **loses to keyword (0.626 / 0.653), schema (0.565 / 0.491), and bag-of-words logistic (0.617 / 0.709)**. Train accuracy **0.974** vs EVAL-2 **0.504** on a **94.3% synthetic** set is overfitting. RESEARCH recall on EVAL-2 is **0**. Real-wording subset **2/13 (0.154)**. H1 is **not** supported. Modules remain **CANDIDATE**. Not promoted. Argument extraction / r=4 / Experiment 004 **not started**.

Artifacts: `model-lab/manifests/modular-intelligence/WR-TOOL-PI-EXP-003/`  
Validation: `scripts/wrim-modular/prove_tool_pi_exp_003.py` **30/30**

Initialization: **fresh** LoRA r=2 + fresh Linear(256→8). Not loaded from EXP-002.

---

1. **Experiment identity:** `WR-TOOL-PI-EXP-003` — WR-TOOL PARAMETER-ISOLATED EXPERIMENT 003  
2. **Core identity:** `WRIM-0` (`OFFICIAL_FROZEN_CORE`). Composed candidate `WRIM-0 + WR-TOOL-LORA-R2-002 + WR-TOOL-HEAD-003` (experiment-local only).  
3. **Core SHA:** `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015`  
4. **Tokenizer SHA:** WR-TOKENIZER-0 `47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7`  
5. **V3 identity:** `WR-TOOL-CURRICULUM-V3`  
6. **V3 hash:** `204ce6e78bb301fd8a0bc590b02d9369ec075c7c7e8e8ad7e50d9f8c56775173` (verified)  
7. **EVAL-2 identity:** `WR-TOOL-EVAL-2` (`EXCLUDE_FROM_TRAINING=true`, n=115)  
8. **EVAL-2 hash:** `026aa2f4937f3580833a37529a4fd57618f675deeb3770f608289f03e6d414d5` (verified)  
9. **LoRA identity:** `WR-TOOL-LORA-R2-002` (does **not** overwrite `WR-TOOL-LORA-R2-001`)  
10. **Head identity:** `WR-TOOL-HEAD-003` (does **not** overwrite `WR-TOOL-HEAD-002`)  
11. **LoRA rank:** 2  
12. **LoRA targets:** `layers.{0–17}.attn.q` and `layers.{0–17}.attn.v` (36 sites; not `q_proj`/`v_proj`)  
13. **LoRA params (computed):** **36,864**  
14. **Classifier architecture:** `Linear(256 → 8, bias=True)`  
15. **Classifier params (computed):** **2,056**  
16. **Total isolated trainable params (computed):** **38,920**  
17. **Core trainable params:** **0**  
18. **Optimizer isolation:** AdamW trainable keys are only `backbone.layers.*.attn.{q,v}.lora_{a,b}` and `head.proj.{weight,bias}`. `base_trainable_keys=[]`.  
19. **Train count:** 313  
20. **Validation count:** 66  
21. **Test count:** 62  
22. **Per-class split counts:**  

| class | train | val | test | all |
|---|---:|---:|---:|---:|
| NO_TOOL | 43 | 11 | 10 | 64 |
| SHA256 | 55 | 9 | 14 | 78 |
| LOOKUP_NOTE | 44 | 1 | 18 | 63 |
| ECHO_INT | 36 | 6 | 6 | 48 |
| WEB | 33 | 9 | 4 | 46 |
| MEMORY | 30 | 12 | 3 | 45 |
| FILES | 33 | 12 | 3 | 48 |
| RESEARCH | 39 | 6 | 4 | 49 |

Class entropy: all **2.972** / 3.000 bits; train 2.974; val 2.830; test 2.686. Provenance: SYNTHETIC 416 (94.3%), REAL_TEST 8, GYM_FIXTURE 5, COUNTERFACTUAL 6, HARD_NEGATIVE flag 15 / example_class HARD_NEGATIVE 6. REAL_RUNTIME **0**. Not duplicated.

23. **Leakage:** train/test family overlap **0**; CAP-EVAL-0 **0**; TOOL-EVAL-1 **0**; TOOL-EVAL-2 **0**  
24. **Pooling:** `assistant_boundary_last_token` / post-`norm_f` last token / dim 256. Unchanged from EXP-002. Hidden states not cached for training.  
25. **Objective:** classifier cross-entropy only. No LM / JSON / TOOL= generation / argument / rehearsal loss.  
26. **Optimizer:** AdamW (EXP-002 recipe reused because isolated param count is nearly unchanged; no sweep)  
27. **LR:** 1e-3  
28. **Batch:** 8 (grouped per-example forwards; no pad)  
29. **Max epochs:** 100  
30. **Early-stop:** min 5, patience 15, restore **best validation loss only**; never test or EVAL-2  
31. **Runtime estimate:** 0.149 s/example fwd+bwd; likely **1506 s (25.1 min)**; worst **5019 s**. Stop gate is `likely>60min AND worst>60min`. Likely under budget → trained.  
32. **Actual runtime:** train **862 s**; wall **913 s** (~15.2 min)  
33. **Best epoch:** **10** (stopped 25)  
34. **Train loss (best ckpt):** **0.242**  
35. **Validation loss (best ckpt):** **0.918**  
36. **Train accuracy:** **0.974**  
37. **Validation accuracy:** **0.758**  
38. **Test accuracy:** **0.694** (43/62)  
39. **Balanced accuracy (test):** **0.714**  
40. **Macro F1 (test):** **0.680**  
41. **Per-class precision (test):** NO_TOOL 0.833; SHA256 0.588; LOOKUP_NOTE 0.923; ECHO_INT 1.0; WEB 0.375; MEMORY 0.750; FILES 0.250; RESEARCH 0.750  
42. **Per-class recall (test):** NO_TOOL **0.500**; SHA256 **0.714**; LOOKUP_NOTE **0.667**; ECHO_INT **1.0**; WEB **0.750**; MEMORY **1.0**; FILES **0.333**; RESEARCH **0.750**  
43. **Per-class F1 (test):** NO_TOOL 0.625; SHA256 0.645; LOOKUP_NOTE 0.774; ECHO_INT 1.0; WEB 0.500; MEMORY 0.857; FILES 0.286; RESEARCH 0.750  
44. **Test confusion (rows gold, cols pred, order NO_TOOL/SHA256/LOOKUP_NOTE/ECHO_INT/WEB/MEMORY/FILES/RESEARCH):**  
`[[5,1,1,0,1,1,0,1],[1,10,0,0,2,0,1,0],[0,4,12,0,1,0,1,0],[0,0,0,6,0,0,0,0],[0,0,0,0,3,0,1,0],[0,0,0,0,0,3,0,0],[0,2,0,0,0,0,1,0],[0,0,0,0,1,0,0,3]]`  
45. **NO_TOOL recall:** test **0.500**; val **0.909**; train **0.977**; EVAL-2 **0.667**  
46. **TOOL vs NO_TOOL:** test **0.903**; EVAL-2 **0.704**  
47. **Conditional tool-ID:** test **0.731**; EVAL-2 **0.400**  
48. **SHA256 recall:** test 0.714; EVAL-2 0.714  
49. **LOOKUP_NOTE recall:** test 0.667; EVAL-2 0.692 (val 0.0 on **n=1** official split — not re-split)  
50. **ECHO_INT recall:** test 1.0; EVAL-2 0.222  
51. **WEB recall:** test 0.750; EVAL-2 0.333  
52. **MEMORY recall:** test 1.0; EVAL-2 0.125  
53. **FILES recall:** test 0.333; EVAL-2 0.375  
54. **RESEARCH recall:** test 0.750; EVAL-2 **0.0**  
55. **EVAL-2 accuracy:** **0.504** (58/115)  
56. **EVAL-2 balanced accuracy:** **0.391**  
57. **EVAL-2 macro F1:** **0.399**  
58. **EVAL-2 per-class:** NO_TOOL P/R/F1 0.612/0.667/0.638 (n=45); SHA256 0.526/0.714/0.606 (n=14); LOOKUP_NOTE 0.692/0.692/0.692 (n=13); ECHO_INT 0.222/0.222/0.222 (n=9); WEB 0.750/0.333/0.462 (n=9); MEMORY 0.167/0.125/0.143 (n=8); FILES 0.500/0.375/0.429 (n=8); RESEARCH **0/0/0 (n=9)**  
59. **Real-wording subset:** n=**13**, accuracy **0.154** (2/13). Near chance. Do **not** claim real-world generalization from synthetic train fit.  
60. **Distractor subset:** n=**21**, accuracy **0.524**, macro F1 **0.335**. Collapsed ECHO_INT/WEB/FILES/RESEARCH on this slice. Adapter is **not** shown to be making robust semantic distinctions vs tool-name tokens.  
61. **Argument-task routing subset:** n=**70**, accuracy **0.400** (class only; arguments not scored)  
62. **Unsupported/unavailable subset:** n=**10**, accuracy **0.400**  
63. **Ambiguity subset:** n=**5**, accuracy **1.0** (tiny; gold is a narrow NO_TOOL-style slice — not treated as a real-wording win)  
64. **Keyword baseline:** EVAL-2 neural **loses** (0.504/0.399 vs 0.626/0.653)  
65. **Schema heuristic:** EVAL-2 neural **loses** (vs 0.565/0.491)  
66. **BoW/logistic:** EVAL-2 neural **loses** (vs 0.617/0.709)  
67. **Representation:** Frozen WRIM-0 class centroids are nearly collapsed (nearest NO_TOOL–WEB L2 **0.23**). After r=2, nearest pair is NO_TOOL–MEMORY L2 **7.20**. SHA256–LOOKUP L2 **0.27→13.0**, Fisher **0.70→14.0**. WEB–RESEARCH Fisher **3.70→26.3**. r=2 **did** create multi-class train geometry. That geometry did **not** transfer to EVAL-2 heuristics.  
68. **Worst confusing pair:** test LOOKUP_NOTE→SHA256 (4); EVAL-2 NO_TOOL→ECHO_INT (7). RESEARCH on EVAL-2 is fully collapsed (mostly into NO_TOOL).  
69. **Overfit:** train–val gap 0.974–0.758; train–test 0.974–0.694; train–EVAL-2 **0.974–0.504**; synthetic 94.3% vs real-wording 0.154. **Classified as overfitting.**  
70. **LoRA movement:** max_abs_diff **0.519**  
71. **Head movement:** max_abs_diff **0.302**  
72. **Core pre hash:** `8d0c903bbcd63f709114c1b69bd2d1136a20e5558f39acd3ad11f403064678b9`  
73. **Core post hash:** identical  
74. **Core max_abs_diff:** **0**  
75. **Detached 13-probe:** output hash identical `44ed0cefdaf7706317609b81df76e252f2b1b00363b53dfdea7adfb3f66ef119`; detached weight hash identical; detached max_abs_diff 0  
76. **Attached probes:** hash differs from detached (expected; LoRA is on). collapse_count **2**/13 vs EXP-002 attached **5**/13. Not scored as adapter-created broad degeneration (`adapter_created_broad_degeneration=false`). Detached tokenizer-loop probes 5 → attached 4.  
77. **Attached collapse count:** 2  
78. **Attached unique ratio:** 0.462 (EXP-002 attached 0.447)  
79. **Degeneration classes:** WRIM-0 tokenizer/`_` loops remain on some probes; attached `max_underscore_run=30` (core already does this). No new `-lab` loop class vs detached rule. Absolute collapse-style flags true because of existing WRIM-0 underscore runs, not a new EXP-003 class.  
80. **LoRA reload:** ok  
81. **Head reload:** ok  
82. **Attach/detach:** reattach classifier logits match  
83. **ToolIntent mapping:** NO_TOOL→`TOOL=none`; SHA256/LOOKUP_NOTE/ECHO_INT/WEB/MEMORY/FILES/RESEARCH → matching `TOOL=<id>`  
84. **Router validation:** `TOOL=none` VALID; gold-arg SHA256 fixture VALID; class-only intents may be MISSING_ARGUMENT (args not trained)  
85. **execution=false:** dry-run only; live tools not executed  
86. **Lifecycle:** SHADOW during train → **CANDIDATE**. **Not PROMOTED.**  
87. **ACTIVE core:** WRIM-0  
88. **ACTIVE modules:** `[]`  
89. **Production:** untouched  
90. **Git:** dirty worktree preserved; this experiment **not committed**  
91. **Scientific interpretation:** r=2 q/v can still reshape last-token geometry on the V3 **train** distribution (centroids separate; train CE falls). That is **not** the same as learning a War Room tool surface that beats lexical heuristics on family-held-out EVAL-2. The dominant failure is **synthetic-template overfitting**, with RESEARCH collapse and near-chance real wording. Isolation succeeded; capability on the 8-class eval did not.  
92. **H1 supported?** **No.** The EXP-002 3-class success did not generalize to this 8-class evidence base.  
93. **Exact next recommendation:** **STOP.** Return evidence. Do **not** auto-start argument-extractor training (D-then-A), LoRA r=4, Experiment 004, Recovery-012, WRIM1-RUN-000003, or promotion. If later ordered: collect REAL_RUNTIME traces and/or diagnose RESEARCH/WEB/MEMORY template leakage **before** raising rank.  
94. **Remaining uncertainties:** val LOOKUP_NOTE n=1 in the official V3 split; EVAL-2 is still mostly synthetic; τ=0 (argmax) from val TOOL vs NO_TOOL; argument extraction untested by design; 94.3% synthetic ceiling.  
95. **Experiment verdict:** WR-TOOL PARAMETER-ISOLATED EXPERIMENT 003 — PASS  
96. **Capability verdict:** WR-TOOL V3 LoRA-R2 — CAPABILITY ACQUISITION NOT DEMONSTRATED  

## Failure cause (ordered)

Do **not** automatically increase LoRA rank.

1. **Synthetic-data limitation / overfitting** (primary): 94.3% SYNTHETIC; train 0.974 vs EVAL-2 0.504.  
2. **Real-wording generalization:** 2/13.  
3. **Specific class collapse:** RESEARCH recall 0 on EVAL-2.  
4. **Tool similarity:** WEB/RESEARCH/MEMORY/FILES confusions on held-out wording.  
5. **Not optimizer isolation:** core frozen; LoRA+head moved; recipe matched EXP-002.  
6. **Not “r=2 cannot make geometry”:** train-set centroids clearly separated.

## Stop state

Do **not** start: argument extractor, LoRA r=4, Experiment 004, Recovery-012, WRIM1-RUN-000003, promotion, production deploy.

## NEXT STEPS FOR OPERATOR

1. Required environment changes — **No operator action required.**
2. Required SQL/migrations — **No operator action required.**
3. Restart requirements — **No operator action required.**
4. Verification URLs/routes — **No operator action required.** Inspect `model-lab/manifests/modular-intelligence/WR-TOOL-PI-EXP-003/` and this report. Re-run `.venv-wrim/bin/python scripts/wrim-modular/prove_tool_pi_exp_003.py` (30/30).
5. Expected successful output — Isolation PASS; capability NOT DEMONSTRATED; core SHA unchanged; ACTIVE modules empty; modules CANDIDATE only; EVAL-2 below keyword/schema/BoW.
6. Feature flags enabled/disabled — **No operator action required.**
7. What should visibly change in UI — **Nothing.** Adapter is not ACTIVE.
8. Safe rollback instruction if needed — Delete `model-lab/manifests/modular-intelligence/WR-TOOL-PI-EXP-003/module/` and generated JSON (keep `design-only/` if desired). Leave WRIM-0 weights and EXP-002 modules untouched. Do not deploy.
