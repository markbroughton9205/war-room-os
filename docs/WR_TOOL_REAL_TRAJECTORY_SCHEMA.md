# WR-TOOL Real Trajectory Schema

Date: 2026-08-31  
Pool: `WR-TOOL-REAL-TRAJECTORY-POOL-V1`  
This is **dataset metadata**, not a model-side JSON generation contract.

## Record

| field | meaning |
|---|---|
| `trajectory_id` | Stable hash of source identity + request + decision + tool + arguments |
| `request_text` | Original wording when recoverable; compact `TOOL=` dialect labeled as such |
| `decision` | `TOOL` or `NO_TOOL` |
| `tool_id` / `gold_tool_id` | Catalog id, or null for NO_TOOL |
| `arguments` / `gold_arguments` | Only values supported by the actual call/result |
| `argument_source` | `EXPLICIT` / `DERIVED` / `INFERABLE` / `MISSING` / `AMBIGUOUS` |
| `result` | Preserved tool/gym result when safe |
| `result_status` | `SUCCESS` / `FAILURE` / `PARTIAL` / `UNAVAILABLE` / `REJECTED` / `UNKNOWN` |
| `routing_correctness` | Whether the tool **choice** is gold |
| `tool_execution_success` | Whether the **executor** succeeded (can fail after a correct choice) |
| `provenance.source_type` | `REAL_RUNTIME` / `REAL_TEST` / `GYM_FIXTURE` / `REPLAY` / `SYNTHETIC` / `HARD_NEGATIVE` / `COUNTERFACTUAL` / `UNKNOWN` |
| `quality_label` | `VERIFIED` / `SUPPORTED` / `PARTIAL` / `UNKNOWN` / `REJECT` |
| `quality_components` | Completeness, recoverability, certainties, uniqueness, realism, leak risk |
| `family_id` | Semantic/template family; replays share a family |
| `context_dependence` | `STANDALONE` or `CONTEXT_DEPENDENT` plus `context_ref` |
| `review_state` | `RAW` → `NORMALIZED` → `VERIFIED` → `CURRICULUM_CANDIDATE` or `EVAL_CANDIDATE` / `REJECTED` |
| `verification_evidence` | Repo paths / mission ids |
| `router_compact` | Tool Router mapping (`TOOL=name` + `field=value`) |
| `EXCLUDE_FROM_TRAINING` | True unless approved gold |

## Quality labels

- **VERIFIED:** request, tool, args, result recoverable and consistent (e.g. gym sha256 digest matches payload).
- **SUPPORTED:** core trajectory recoverable; one non-critical field inferred from strong evidence (e.g. research-engine gym analog to catalog `research`).
- **PARTIAL:** useful fields exist (parser fixtures) but not supervised gold.
- **UNKNOWN:** ground truth unsafe.
- **REJECT:** corrupt, leaky, or secret-bearing.

Only **VERIFIED** and approved **SUPPORTED** may be strong gold. **UNKNOWN** and **REJECT** never are. **REPLAY** is not an independent gold count.

## Review gate

No raw runtime record becomes training data automatically. States: RAW, NORMALIZED, VERIFIED, CURRICULUM_CANDIDATE, EVAL_CANDIDATE, REJECTED.

## Pipeline

runtime interaction → raw experience (`AGIExperienceRecord` / observational RAW) → normalization → verification → dedup/family → capability labels → curriculum candidate → held-out exclusion → dataset versioning → future **shadow** training (Commander-gated).

No automatic active-model training.
