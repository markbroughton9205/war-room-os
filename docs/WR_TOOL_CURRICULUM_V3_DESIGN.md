# WR-TOOL-CURRICULUM-V3 — DESIGN

Date: 2026-08-31  
Status: **MATERIALIZED, NOT TRAINED**  
Identity: `WR-TOOL-CURRICULUM-V3`  
Path: `model-lab/manifests/wr_tool_curriculum/design/WR-TOOL-CURRICULUM-V3/`  
Does **not** overwrite TOOL V1, TOOL V2, TOOL-EVAL-1, EXP-001, or EXP-002.

## Scientific variable

Experiment 002 proved r=2 q/v + linear classifier routing on a 3-class V2 split. V3 changes **data breadth only**. Architecture for a future Experiment 003 remains WRIM-0 frozen + LoRA r=2 + linear head (class count grows with labels).

## Authoritative tool surface

UI registry: `lib/tools/toolRegistry.ts`  
Schema view: `lib/modular-intelligence/toolCatalog.ts`  
Python mirror for this dataset: `scripts/wrim-modular/tool_catalog_v3.py`

### Selected V3 routing identities (7 tools + NO_TOOL)

| tool_id | purpose | required args | side-effect | training | dry-run |
|---|---|---|---|---|---|
| sha256 | bounded gym hash | text:string | pure local | yes | yes |
| lookup_note | synthetic note fetch | note_id:string | mock | yes | yes |
| echo_int | integer schema fixture | n:integer | mock | yes | yes |
| web | web lookup | query:string | network read | yes (labels only) | yes |
| memory | memory retrieval | query:string | auth read | yes (labels only) | yes |
| files | file inspection | path:string | auth read | yes (labels only) | yes |
| research | multi-source synthesis | query:string | network read | yes (labels only) | yes |
| none / NO_TOOL | abstain | — | none | yes | n/a |

### Excluded (implemented, not V3 classes)

| tool_id | why |
|---|---|
| repo | commit/patch workflow, write-capable |
| deployments | release workflow, high-risk |
| build | persists drafts |
| disabled_probe | unavailable fixture; used only as TOOL-06 gold=NO_TOOL |

No fabricated tools. Compact overlays have **no optional fields**; TOOL-04 is “drop non-schema chatter,” not invented optionals.

## Provenance policy

Every example has `example_class` ∈ {REAL_RUNTIME, REAL_TEST, GYM_FIXTURE, SYNTHETIC, COUNTERFACTUAL, HARD_NEGATIVE}.

Repo inspection found **no production AGIExperienceRecord dumps**. REAL_RUNTIME = **0**. REAL_TEST items are gym/parser/Wave 8.1 trajectories verified in this repo. The 25–40% real-share target is **not met**; actual REAL_TEST share is reported in accounting (~1.8%). Synthetic remainder is labeled SYNTHETIC, not disguised.

## Labels vs runtime JSON

Semantic gold:

```json
{ "decision": "TOOL", "tool_id": "sha256", "arguments": { "text": "hello" } }
```

This is metadata. Compact `TOOL=` lines exist for router dry-run. The neural target for Experiment 003 remains a **class id**, not JSON generation.

Argument fields: `gold_arguments`, `required_arg_presence`, `arg_types`, `argument_spans`, `argument_source` ∈ {EXPLICIT, INFERABLE, MISSING, AMBIGUOUS}.

## Splits

Family-hash holdout (~70/15/15 by `family_id`, not random rows). Argument values used in WR-TOOL-EVAL-2 are excluded from V3. Entire eval families are excluded.

## Continual learning (design only)

`runtime tool interaction → AGIExperienceRecord → quality gate → curriculum candidate → human/validator review → next dataset version`

Hooks already exist (`experienceHooks.ts`, `curriculumPath.ts`). **No auto-train from production.**

## Validator

`scripts/wrim-modular/build_tool_curriculum_v3.py` + `prove_tool_curriculum_v3.py`. Experiment 003 is **not** started by this mission.
