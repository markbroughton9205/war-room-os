# WR-TOOL EVIDENCE EXPANSION REPORT

Date: 2026-08-31  
Repo: `/Users/markbroughton/Developer/war-room-os`  
Production: `/Users/markbroughton/WarRoomNode01` — **not modified**  
Verdict: **WR-TOOL EVIDENCE EXPANSION — PASS**

PASS originally meant V3 + EVAL-2 + Experiment 003 **design** exist. Experiment 003 was later **trained** (2026-08-31): isolation **PASS**, capability **NOT DEMONSTRATED**. See `docs/WR_TOOL_PARAMETER_ISOLATED_EXPERIMENT_003_REPORT.md`. Modules were **not** promoted. Production tools were not activated. WRIM-0 was not modified.

## Inventory

Authoritative UI tools from `lib/tools/toolRegistry.ts`: web, memory, files, research, repo, deployments, build.

Catalog extras from `lib/modular-intelligence/toolCatalog.ts`: sha256, lookup_note, echo_int, disabled_probe.

Selected: sha256, lookup_note, echo_int, web, memory, files, research (+ NO_TOOL).  
Excluded: repo, deployments, build (write/high-risk); disabled_probe (unavailable probe, not a class).

## Dataset

- Identity: `WR-TOOL-CURRICULUM-V3`
- Hash: `204ce6e78bb301fd8a0bc590b02d9369ec075c7c7e8e8ad7e50d9f8c56775173`
- n=441; train/val/test by family 313/66/62
- Unique families 201; largest family share 0.68%; median family size 3; max exact duplicates 1
- Class entropy 2.97 / 3.00 bits; largest class SHA256 17.7%; NO_TOOL 14.5%
- REAL_RUNTIME 0; REAL_TEST 8 (1.81%); GYM_FIXTURE 5; SYNTHETIC 416; HARD_NEGATIVE 15; COUNTERFACTUAL 6
- 25–40% real target **not met** because production trajectories are not in this repo. Not fabricated.

## EVAL-2

- Identity: `WR-TOOL-EVAL-2`
- Hash: `026aa2f4937f3580833a37529a4fd57618f675deeb3770f608289f03e6d414d5`
- 115 items, `EXCLUDE_FROM_TRAINING=true`
- Leaks: CAP-EVAL-0 **0**; TOOL-EVAL-1 **0**; V3 train **0**

## Baselines on EVAL-2 (train=V3 train split)

| baseline | accuracy | macro F1 |
|---|---|---|
| majority (SHA256) | 0.122 | 0.027 |
| uniform random | 0.125 | — |
| keyword | 0.626 | 0.653 |
| schema heuristic | 0.565 | 0.491 |
| numpy bag-of-words softmax | 0.617 | 0.709 |
| EXP-001 (V2, 3-class, n=12) | 0.75 | — |
| EXP-002 (V2, 3-class, n=12) | 0.833 | 0.820 |

EXP-003 (executed) EVAL-2: accuracy **0.504**, macro F1 **0.399**, balanced **0.391**. Beats majority/random only. **Loses** to keyword, schema, and BoW. Capability **NOT DEMONSTRATED**. Do not reuse the 12-item EXP-002 score as promotion evidence.

## Argument architecture recommendation

**D (deterministic extraction after tool class), then A (per-field heads).**  
Schemas are one required field each (string or integer). Span extraction (B) is optional later. Compact generation adapters (C) repeat Recovery-011’s failure mode.

## Promotion-readiness (DESIGN HYPOTHESIS, not thresholds-as-fact)

Do not promote EXP-002 now. A future WR-Tool module should not become PROMOTED until:

1. Eval n ≫ 12 (EVAL-2 scale or larger) plus family-held-out V3 test
2. Real-trajectory subset reported (even if small); do not pretend 25% if absent
3. Macro F1 above heuristic logistic and keyword on EVAL-2, with confidence intervals or at least per-class floors
4. Per-tool recall floor treated as **hypothesis** until EXP-003 variance is known
5. NO_TOOL false-positive rate reported (tool fired when none should)
6. Attached-runtime stability vs detached WRIM-0 (no new collapse class)
7. Core immutability `max_abs_diff=0`
8. Artifact hashes reproducible
9. Router dry-run validation on predicted classes
10. Explicit Commander authorization

## Files

Scripts: `scripts/wrim-modular/build_tool_curriculum_v3.py`, `tool_catalog_v3.py`, `prove_tool_curriculum_v3.py`, `paths.py`.  
Artifacts under `model-lab/manifests/wr_tool_curriculum/design/WR-TOOL-CURRICULUM-V3/` and `model-lab/eval-only/WR-TOOL-EVAL-2/`.  
EXP-003 artifacts: `model-lab/manifests/modular-intelligence/WR-TOOL-PI-EXP-003/` (plus preserved `design-only/`).  
Validator (curriculum): 28/28 in `validator.json`. EXP-003 prove: 30/30.
