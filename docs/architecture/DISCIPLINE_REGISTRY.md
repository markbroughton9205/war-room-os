# Phase 47B Stage A — Discipline Registry

`lib/discipline/disciplineRegistry.ts` is a canonical, descriptive map of
War Room OS's Council-adjacent disciplines: their real integration status,
runtime authority, evidence posture, enforcement posture, implementation
locations, dependencies, observations, and known limitations.

## Purpose

This registry exists to describe reality before any Live Intel or Prophet
work begins, so that future phases build on an accurate picture of what
already exists rather than an aspirational one. It was produced by two
prior read-only discovery passes across the repository (Phase 47B
discovery and its follow-up), then encoded here as Stage A.

## What this registry is not

The registry is a pure data structure. It does not, and must not:

- invoke providers
- perform retrieval
- call Tavily or Firecrawl
- write memory
- access Supabase
- execute missions
- grant authority
- change routing
- alter `/api/chat`
- activate planned systems
- resolve the duplication it documents
- normalize the three existing runtime vocabularies into one
- claim that prompting a role is equivalent to that role having executed
- become a second runtime router

`lib/discipline/disciplineRegistry.ts` imports nothing at runtime from any
module it describes — only `import type` references, which TypeScript
erases entirely at compile time. Simply importing the registry file can
never trigger a side effect anywhere else in the codebase.

## Validation suite scope

`lib/discipline/disciplineRegistryValidation.ts` provides **structural
validation, contract validation, self-consistency validation,
vocabulary-drift protection, and deterministic-serialization checks** for
the registry.

It is **not** independent proof that every architecture claim in the
registry is behaviorally true. Most of its cases check the registry's own
internal shape (unique IDs, required fields present, module paths existing
on disk) or check that a specific fact is *disclosed somewhere in the
registry's own prose* — that is not the same as independently re-verifying
the fact against the real codebase. Repository and runtime claims (e.g.
"this file is imported by the moderator," "this regex is duplicated,"
"this route exists") require independent source inspection and, where
applicable, real runtime verification — passing this suite is a necessary
sanity check on the registry's own integrity, not a substitute for that
independent verification. This distinction is stated directly in the
validation file's own header comment.

## Registry contract

Every entry in `DISCIPLINE_REGISTRY` has this shape:

| Field | Type | Meaning |
|---|---|---|
| `disciplineId` | `string` | Unique, stable identifier. |
| `name` | `string` | Human-readable name. |
| `implementationStatus` | `DisciplineImplementationStatus` | How built/wired the *code* is — see below. |
| `runtimeAuthority` | `'none' \| 'observational' \| 'enforcing'` | What kind of effect this discipline has on a live request today. |
| `evidenceStatus` | `'not_applicable' \| 'none' \| 'partial' \| 'full'` | Whether this discipline consumes/produces evidence-shaped data, and how completely. |
| `enforcementStatus` | `'not_applicable' \| 'not_enforced' \| 'enforced'` | Whether this discipline currently blocks/alters output. |
| `moduleLocations` | `string[]` | Repository-relative file paths. Never empty. |
| `dependencies` | `string[]` | Other `disciplineId`s, or free-text external dependencies. |
| `observations` | `string[]` | Honest notes, including which existing honesty vocabulary (if any) this discipline's own code uses. |
| `limitations` | `string[]` | Known gaps, disclosed rather than fixed. |

`implementationStatus` accepts exactly these values, chosen to satisfy the
truthfulness distinctions Phase 47B requires:

`runtime_wired` · `observational` · `partial` · `seed_only` · `planned` ·
`not_integrated` · `unavailable` · `inferred`

This is **not** a fourth honesty vocabulary. The three vocabularies below
describe the truthfulness of *data* produced at runtime. `implementationStatus`
describes the *code itself* — has it shipped, is it reachable from a real
request path, is it backed by seed data. The two concerns are orthogonal.

`seed_only` specifically describes a discipline's present **architectural
maturity** (its code is backed by hardcoded demo/seed data rather than a
live pipeline). This is a different layer from `LearningIntegrationStatus`'s
own `static_seed` value, which describes the **integration state** of a
specific data panel/table within the learning subsystem — see
[Seed-status reconciliation](#seed-status-reconciliation-seed_only-vs-static_seed)
below for how the two coexist without one replacing the other.

No fields were added beyond the ten originally accepted for Stage A.

### `enforcementStatus` selection criterion

- **`not_applicable`**: the discipline is descriptive, observational,
  classificatory, or otherwise has **no enforcement responsibility by
  design** — not because enforcement is missing, but because enforcing
  anything was never this discipline's job. Example: `intent_resolution`
  classifies intent; enforcement is downstream disciplines' job.
- **`not_enforced`**: the discipline **has** an intended or relevant
  enforcement responsibility, but enforcement is absent, incomplete, or
  not currently wired. No current entry in this registry meets this bar —
  every discipline that has an enforcement responsibility today already
  enforces it. This value remains available for a future entry whose
  enforcement role is real but not yet wired.
- **`enforced`**: code currently changes, blocks, permits, rejects, or
  constrains runtime behavior.

Applying this criterion during the Stage A correction pass reclassified
three entries from `not_enforced` to `not_applicable`: `intent_resolution`,
`retrieval_orchestration`, and `memory_evaluation` — each has no enforcement
responsibility of its own by design, not an incomplete one. No entry was
changed merely to make the summary table look uniform; every change is
justified per-entry in that entry's own `observations` in the source file.

## Existing honesty/status vocabularies

Three honesty/status vocabularies already exist in the repository. Stage A
documents all three and does not collapse them into one universal enum.
Each discipline's `observations` states which vocabulary (if any) its own
code actually uses.

### 1. `CouncilTraceObservationMode`

Source: `lib/council/runtimeTrace.ts` (Phase 47A).

```
'runtime_observed' | 'inferred'
```

Distinguishes a trace stage that genuinely executed from one that is
inferred/labeled without direct observation.

### 2. `LearningIntegrationStatus`

Source: `lib/learning/integrationStatus.ts`.

```
'live_wired' | 'derived_from_existing_store' | 'static_seed' |
'not_connected' | 'persistent_store' | 'live_persistent' | 'awaiting_data'
```

Describes how connected a learning/forecast panel is to real persisted data.

### 3. `QueueTruthLabel`

Source: `lib/queues/types.ts`.

```
'SOURCE_BACKED' | 'PROPOSED' | 'APPROVAL_REQUIRED' | 'UNAVAILABLE'
```

Actively consumed by `lib/signals/operatorIntelligence.ts` when mapping
signal results into queue items — not a dormant type.

`lib/discipline/disciplineRegistry.ts` includes a compile-time assertion
against each of these three real types, so if any of their value sets ever
drifts from what's documented here, `tsc --noEmit` fails rather than this
document silently going stale.

## Discipline entries

| disciplineId | implementationStatus | runtimeAuthority | evidenceStatus |
|---|---|---|---|
| `intent_resolution` | runtime_wired | observational | not_applicable |
| `active_scope_construction` | runtime_wired | enforcing | not_applicable |
| `topic_scope_enforcement` | runtime_wired | enforcing | not_applicable |
| `mode_governance` | runtime_wired | enforcing | not_applicable |
| `provider_selection` | runtime_wired | enforcing | not_applicable |
| `response_integrity` | runtime_wired | enforcing | not_applicable |
| `research_planning` | runtime_wired | enforcing | full |
| `retrieval_orchestration` | runtime_wired | observational | full |
| `intelligence_packet_evidence_handling` | runtime_wired | observational | full |
| `signals_intelligence_subsystem` | runtime_wired | observational | partial |
| `red_team_integrity_layer` | runtime_wired | enforcing | not_applicable |
| `memory_evaluation` | runtime_wired | observational | not_applicable |
| `council_reporting` | partial | observational | not_applicable |
| `runtime_diagnostics` | runtime_wired | observational | not_applicable |
| `forecast_outcome_tracking` | seed_only | none | partial |
| `queue_truth_labeling` | runtime_wired | observational | not_applicable |

Full detail — exact module locations, dependencies, observations, and
limitations for every entry — lives in `lib/discipline/disciplineRegistry.ts`
itself; this table is a summary index, not a duplicate of the source of
truth.

### `lib/signals` — explicit disclosure

`signals_intelligence_subsystem` is genuinely runtime-wired, not dead,
planned, or unwired: six live API routes, three UI components, real
Supabase persistence (`war_room_signal_*` tables), and consumers in the
operator, queue, and runtime-graph subsystems. It is **not** overstated as
canonical Live Intel. It is parallel to `IntelligencePacket` rather than an
extension of it, and is a confirmed third independent Tavily/Firecrawl
integration point in the repository (alongside `lib/research/researchRouter.ts`
and the income-scout subsystem). It has its own confidence model, its own
freshness vocabulary, and its own contradiction-handling module, none of
which are reconciled with `IntelligencePacket`. It maps into `QueueTruthLabel`.
Signal results require approval and disallow external execution
(`externalExecutionAllowed: false`, `approvalRequiredBeforeAction: true`).
Its `evidenceStatus` is `partial` specifically because its evidence model is
not reconciled with the canonical one.

### Response integrity — explicit disclosure

Represented as one discipline with both files listed under `moduleLocations`:
`lib/providers/responseIntegrity.ts` and `lib/council/responseIntegrity.ts`.
Both exist, both are runtime-used. `providers/responseIntegrity.ts` handles
the enum-based classification consumed by the moderator/governor paths;
`council/responseIntegrity.ts` handles text repair consumed by final
moderation. `providers/responseIntegrity.ts` duplicates the truncation-detection
regexes by copy rather than importing them, and the two implementations
never call each other — a confirmed divergence risk, not fixed in this
packet.

## Seed-status reconciliation: seed_only vs static_seed

`forecast_outcome_tracking`'s `implementationStatus` is `seed_only`, and
`LearningIntegrationStatus` (a real, existing repository vocabulary) has
its own `static_seed` value. These describe two different layers, not a
duplicate concept requiring one to be renamed:

1. This registry uses `seed_only` to describe the discipline's present
   **architectural maturity** — its code is a hardcoded demo array
   (`STRATEGIC_FORECASTS`), not a live creation-to-resolution pipeline.
2. The underlying forecast demo data should truthfully use or expose
   `static_seed` at the **data/integration layer** via
   `LearningIntegrationStatus`, the same way `patternsWorkflow`'s panel
   status already does in `buildLearningIntegrationSnapshot` (`static_seed`
   is assigned only to the `patternsWorkflow` panel in
   `lib/learning/integrationStatus.ts` — `outcomeLedger` can only report
   `live_persistent`/`persistent_store`/`derived_from_existing_store`/
   `awaiting_data`, never `static_seed`) — it currently does not, at its
   own data level.
3. This registry is **not** replacing or subsuming `LearningIntegrationStatus`;
   it is a separate, orthogonal layer describing the discipline's code, not
   its data.
4. The known limitation remains, unresolved: realistic-looking seed records
   are not labeled `static_seed` at their own data level, so a reader
   encountering `STRATEGIC_FORECASTS` directly (rather than via the
   separate integration-status snapshot) could mistake it for real
   calibration history.

No enum was renamed — the two vocabularies coexist without contradiction
once this distinction is documented.

## Known limitations documented in the registry

1. **Direct-fetch redirect SSRF gap** — the original URL is checked against
   the private/blocked-host list, but the final redirect destination is not
   revalidated (`research_planning`).
2. **Strategic forecast and outcome ledger seed data** — hardcoded demo data
   with realistic-looking values, not labeled `static_seed` at the data
   level itself (`forecast_outcome_tracking`; see seed-status reconciliation
   above).
3. **Grok confidence-weighting gap** — Grok is honestly labeled
   `framing_only_not_web_search`, but its contribution currently affects
   numeric packet confidence identically to real retrieval legs. The
   weighting formula lives in `lib/research/researchEvidence.ts`
   (`research_planning`).
4. **Forecast calibration gap** — forecast outcome persistence and scoring
   exist, but there is no real forecast-creation-to-resolution pipeline;
   current calibrated forecast count is effectively zero
   (`forecast_outcome_tracking`).
5. **Intelligence duplication** — `IntelligencePacket`, `lib/signals`, and
   the income-scout subsystem are independent retrieval/evidence paths
   (`signals_intelligence_subsystem`, `intelligence_packet_evidence_handling`).
6. **Response-integrity duplication** — classification and text-repair
   systems can diverge because their regex logic is duplicated
   (`response_integrity`).

None of these are fixed in Stage A. They are disclosed so later stages do
not have to rediscover them.

## Out of scope for Stage A

No changes were made to: `app/api/chat/route.ts`, provider invocation,
`researchRouter.ts`, `retrievalOrchestrator.ts`, `lib/signals` runtime
behavior, the response-integrity implementation, memory paths, Supabase
schema, SQL, RLS, queues, forecast persistence, background jobs, or
deployment configuration. Live Intel implementation, retrieval
consolidation, response-integrity refactoring, Prophet wiring, and
continuous intelligence all remain unbuilt.
