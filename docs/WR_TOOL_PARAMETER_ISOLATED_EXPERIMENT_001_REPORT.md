# WR-TOOL PARAMETER-ISOLATED EXPERIMENT 001 — REPORT

Date: 2026-08-31  
Repo: `/Users/markbroughton/Developer/war-room-os`  
Production (`/Users/markbroughton/WarRoomNode01`): **not modified**

## Verdicts

**WR-TOOL PARAMETER-ISOLATED EXPERIMENT 001 — PASS**  
(infrastructure / isolation)

**WR-TOOL HEAD — CAPABILITY ACQUISITION INCONCLUSIVE**

Isolation succeeded with WRIM-0 bit-for-bit unchanged. Held-out family accuracy (75%) beats majority (25%) and uniform chance (33%) and matches the keyword baseline (75%). TOOL vs NO_TOOL on the family-held-out test set is 91.7%. Bounded tool-ID is **not** demonstrated: LOOKUP_NOTE recall is 0 on train, validation, and test (the head never emits that class). This does **not** prove 19.2M cannot learn tools. LoRA r=2 on `attn.q` + `attn.v` is the next scientific candidate and is **not started**.

Artifacts: `model-lab/manifests/modular-intelligence/WR-TOOL-PI-EXP-001/`  
Validation: `scripts/wrim-modular/prove_tool_pi_exp_001.py` **20/20**

---

1. **Experiment identity:** `WR-TOOL-PI-EXP-001` — WR-TOOL PARAMETER-ISOLATED EXPERIMENT 001  
2. **Module identity:** `WR-TOOL-HEAD-001` (`CLASSIFIER_HEAD`, not LoRA)  
3. **Core identity:** `WRIM-0` (`OFFICIAL_FROZEN_CORE`). Recovery-010 not used.  
4. **Checkpoint SHA proof:** `d1affa599ff967313b476e649062c7d969606b8e9f6fa1410f12a41d857ba015` (file SHA match)  
5. **Tokenizer SHA proof:** WR-TOKENIZER-0 `47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7`  
6. **Core total params:** 19,217,152  
7. **Core trainable params:** 0  
8. **Head architecture:** `Linear(256 → 3, bias=True)` on last hidden at the assistant boundary  
9. **Head parameter count:** 771  
10. **Hidden-state source:** `WRIM0Model.forward_hidden` post-`norm_f`, before tied embedding projection  
11. **Pooling strategy (one only):** `assistant_boundary_last_token` — encode rendered prefix through `<|assistant|>\n`; take hidden `[:, -1, :]`. Gold TOOL= tokens are not in the feature. Mean pooling is future work only.  
12. **Feature shape:** `(88, 256)`  
13. **Feature cache:** `WR-TOOL-PI-EXP-001-FEATURES-V1` hash `125ee4d5b1e354eec8530157253276a2b27c2c8e98ed2b35ed8581d10542d6b0`; input-ids hash `f6f8eb6944e37e40c278920828fbdeb14e8ebd805a9495d7760bf148599c10f2`; labels not stored in the feature file  
14. **Dataset source:** `WRIM-1.1-TOOL-CURRICULUM-V2-DESIGN` supervised JSONL (88 examples). Not trained on compact generation CE.  
15. **Class mapping:** observed V2 tools only — `none→NO_TOOL`, `sha256→SHA256`, `lookup_note→LOOKUP_NOTE`. **OTHER_TOOL not used** (no unsupported tools invented).  
16. **Train count:** 59  
17. **Validation count:** 17  
18. **Test count:** 12  
19. **Split method:** whole normalized prompt-template family to one split; round-robin train/train/train/val/test stratified by majority class of the family. 59 template families.  
20. **Leakage:** train/test template overlap **0**; train/test normalized prompt overlap **0**; CAP-EVAL-0 `known_eval_leakage=0`; TOOL-EVAL-1 `known_eval_leakage=0`. TOOL-EVAL-1 and CAP-EVAL-0 were not trained on.  
21. **Majority baseline:** train majority **SHA256**; test accuracy **0.25** (test is 6/12 NO_TOOL)  
22. **Random baseline:** uniform **1/3**; train-prior expected accuracy **0.337**  
23. **Keyword/deterministic baseline:** test accuracy **0.75** (NO_TOOL and LOOKUP_NOTE recovered; SHA256 missed)  
24. **Optimizer:** AdamW over head parameters only (cached features; core not in the graph)  
25. **LR:** 1e-2; betas `(0.9, 0.999)`; weight decay `0.01`  
26. **Batch size:** 8  
27. **Epoch policy:** max 100; min 5; restore best **validation loss**; patience 12. Stopped epoch **17**, best epoch **5**.  
28. **Training loss curve:** 3.64 → 0.59 over 17 epochs (noisy; best val at epoch 5: train loss 1.69)  
29. **Validation loss curve:** 3.31 → 0.71 at best (epoch 5), then rose (early stop restored epoch 5)  
30. **Train accuracy (best ckpt + val-derived threshold τ=0.75):** **0.644**  
31. **Validation accuracy:** **0.824**  
32. **Test accuracy:** **0.750**  
33. **Test balanced accuracy:** **0.667**  
34. **Test macro F1:** **0.558**  
35. **Per-class (test):** NO_TOOL P/R/F1 0.857 / 1.0 / 0.923 (n=6); SHA256 0.60 / 1.0 / 0.75 (n=3); LOOKUP_NOTE 0 / 0 / 0 (n=3)  
36. **Test confusion (rows gold NO_TOOL, SHA256, LOOKUP_NOTE):** `[[6,0,0],[0,3,0],[1,2,0]]`  
37. **NO_TOOL accuracy (recall):** test **1.0**; train **0.95**; val **1.0**  
38. **TOOL vs NO_TOOL accuracy:** test **0.917**; val **0.941**; train **0.881**  
39. **Conditional tool-ID accuracy (gold TOOL):** test **0.50**; train **0.487** (LOOKUP never predicted)  
40. **TOOL-EVAL-1 compatible classifier items:** **12/12** for tool-id labels. 9 items still require args or WHY for the original generation scorer — not counted as classifier failures.  
41. **TOOL-EVAL-1 classifier score:** overall **6/12 (0.50)**; balanced acc 0.433; macro F1 0.381  
42. **Distractor:** V2 family-held-out distractor slice n=6, accuracy **0.50**; TOOL-EVAL-1 TOOL_SELECTION n=3, accuracy **0.667** (2 SHA256 correct, 1 LOOKUP predicted SHA256)  
43. **Head pre hash:** `ca002b1976ac8d1eda468b039131d3837c356aa46c41aaf31cbff2dd86e78e51`  
    **Head post hash:** `ff354a75d2bef944aa8dcbd1309fdb151fdb6aa857dbda214ac8795d719a850f`  
44. **Head movement:** max_abs_diff **1.721** (non-zero)  
45. **Core pre-training weight tree hash:** `8d0c903bbcd63f709114c1b69bd2d1136a20e5558f39acd3ad11f403064678b9`  
46. **Core post-training weight tree hash:** identical  
47. **Core max_abs_diff:** **0.0**  
48. **Detached WRIM-0 13-probe output hash:** `44ed0cefdaf7706317609b81df76e252f2b1b00363b53dfdea7adfb3f66ef119` before and after (identical). Full CAP-EVAL-0 86-item generation was not re-run; probes plus logit identity cover core-only behavior.  
49. **Attach/detach:** attached head emits a class; detached LM logits equal core-only logits (exact).  
50. **Module save/load:** `module/WR-TOOL-HEAD-001/` reload logits match; no WRIM-0 weights embedded.  
51. **ToolIntent:** class → compact `TOOL=none` / `TOOL=sha256` / `TOOL=lookup_note` via existing parser.  
52. **Router validation:** `TOOL=none` VALID; class-only `TOOL=sha256` is MISSING_ARGUMENT (classifier does not extract args); gold-arg fixture VALID.  
53. **Execution boundary:** dry-run only; `executed=false`; would_call `agi_gym_sha256` for the fixture. No live tools.  
54. **Module lifecycle final state:** **CANDIDATE** (created SHADOW; not REJECTED because isolation passed; **not PROMOTED**)  
55. **ACTIVE core:** WRIM-0  
56. **ACTIVE modules:** `[]` (global runtime not written with this head)  
57. **Production:** untouched  
58. **Git:** dirty worktree as before; this experiment **not committed** (Commander did not authorize commit/push)  
59. **Scientific interpretation:** Frozen last-hidden states on this V2 set already separate **TOOL vs NO_TOOL** above majority/random on a family-held-out split. They do **not** linearly separate SHA256 vs LOOKUP_NOTE (LOOKUP_NOTE collapsed into SHA256). Keyword baseline matches test accuracy via a different error pattern. H1 is only **partially** supported.  
60. **Next recommendation (not started):** Commander review of **LoRA r=2 on `attn.q` + `attn.v` (36,864 params)** if the goal is tool-ID, **or** a larger/cleaner labeled set / different pooling if the question is still linear readout. Do not start Experiment 002, Recovery-012, or WRIM1-RUN-000003 from this result alone.  
61. **Uncertainties:** n_test=12 is small; val LOOKUP_NOTE n=2; early-stop on val loss while val acc later peaked higher; τ=0.75 derived on val (raw softmax, **not** calibrated); LOOKUP collapse may be feature geometry or class imbalance in hidden space, not proven either way; TOOL-EVAL-1 prompts include a different schema prefix than V2 train render.  
62. **Experiment verdict:** WR-TOOL PARAMETER-ISOLATED EXPERIMENT 001 — PASS  
63. **Capability verdict:** WR-TOOL HEAD — CAPABILITY ACQUISITION INCONCLUSIVE  

## Threshold

τ = **0.75** on tool-class softmax mass, chosen on **validation** TOOL vs NO_TOOL accuracy only. Raw softmax is not a calibrated confidence claim.

## Stop state

Do **not** start: LoRA, Experiment 002, Recovery-012, WRIM1-RUN-000003, promotion.

## NEXT STEPS FOR OPERATOR

1. Required environment changes — **No operator action required.**
2. Required SQL/migrations — **No operator action required.**
3. Restart requirements — **No operator action required.**
4. Verification URLs/routes — **No operator action required.** Inspect `model-lab/manifests/modular-intelligence/WR-TOOL-PI-EXP-001/` and `docs/WR_TOOL_PARAMETER_ISOLATED_EXPERIMENT_001_REPORT.md`. Re-run `.venv-wrim/bin/python scripts/wrim-modular/prove_tool_pi_exp_001.py` (20/20).
5. Expected successful output — Isolation PASS; capability INCONCLUSIVE; core SHA unchanged; ACTIVE modules empty.
6. Feature flags enabled/disabled — **No operator action required.**
7. What should visibly change in UI — **Nothing.** Head is SHADOW/CANDIDATE only.
8. Safe rollback instruction if needed — Delete `model-lab/manifests/modular-intelligence/WR-TOOL-PI-EXP-001/` and leave WRIM-0 weights untouched. Do not deploy.
