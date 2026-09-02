# WR-TOOL EVAL-6 SEMANTIC BENCHMARK

Identity: `WR-TOOL-EVAL-6-CANDIDATE`  
Path: `model-lab/manifests/wr_tool_evals/WR-TOOL-EVAL-6-CANDIDATE/`  
Held out. **Do not train WRIM on this exam.**

Purpose: reduce lexical shortcuts and test intent distinction (information state, source, freshness, scope). Not a vehicle to raise WRIM scores.

## Size

- Six-way rows: **224** (validation 112 / test 112, family-isolated ~50/50)
- Diagnostics (excluded from six-way accuracy): abstention **12**, multi-tool **10**
- Total labeled rows: **246**, all `TEST_FIXTURE` (honest; not called real)
- Unique six-way families: **112** (each a matched counterfactual pair)

## Class counts (six-way)

| Class | n |
| --- | --- |
| NO_TOOL | 76 |
| WEB | 35 |
| MEMORY | 34 |
| FILES | 30 |
| RESEARCH | 29 |
| SHA256 | 20 |

All six classes appear in validation and test.

## Pair families

| Kind | Families |
| --- | --- |
| WEB vs RESEARCH | 18 |
| FILES vs MEMORY | 18 |
| MEMORY vs NO_TOOL | 16 |
| SHA256 vs NO_TOOL | 20 |
| WEB vs NO_TOOL | 17 |
| FILES vs NO_TOOL | 12 |
| RESEARCH vs NO_TOOL | 11 |

Plus lexical-adversarial, negation/trap, multi-turn, and information-state tags on the same rows.

## Isolation

Exact / normalized / family overlap vs V5 train, EVAL-5, and EVAL-4: **0**. Template and underlying-fact overlap reported 0.

Bundle hash: `34e9fd63c40cb1d7a7053961a5ea589edbf59bc98ea233e5441586928fa063c6`

## Design notes

Matched pairs keep topic vocabulary aligned and change one semantic condition (live listing vs multi-source synthesis; stored fact vs artifact; already in prompt vs must recall; explain vs compute). Cue words such as research/file/hash/memory appear under the *wrong* gold class where valid.
