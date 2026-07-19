# Unified Adaptive Council Assembly

Phase 48-C3B1 creates the advisory planning foundation for a future Unified Adaptive Council. It does not change provider routing, provider dispatch, Stable Group, Full Council, direct invocation, Phase 48-C3A family-to-family deliberation, synthesis execution, research execution, persistence, authentication, or UI behavior.

Every plan produced by this phase is labeled:

> Recommended assembly — not used for execution.

## Purpose

The Commander should eventually issue one mission while War Room recommends which AI families should participate based on configured capability profiles and mission requirements. Phase 48-C3B1 only answers the planning question. It never claims a family actually executed.

## Capability Vocabulary

Capabilities live in `lib/council/adaptive-assembly/capabilities.ts`. The vocabulary is finite and typed:

- `general_reasoning`
- `strategic_planning`
- `systems_architecture`
- `software_engineering`
- `current_information`
- `evidence_research`
- `broad_knowledge_synthesis`
- `numerical_analysis`
- `comparative_analysis`
- `task_decomposition`
- `adversarial_review`
- `high_risk_review`
- `visual_reasoning`
- `historical_analysis`
- `concise_response`
- `deep_analysis`
- `synthesis`
- `tool_eligible`
- `research_eligible`

Unknown capability strings fail validation. The registry does not accept arbitrary runtime free text.

## Registry Design

`FamilyCapabilityProfile` records configured capability claims for existing War Room families:

- ChatGPT
- Claude
- Grok
- Gemini
- Kimi
- Red Team
- Baby AI Observer
- Bridge Architect

Commercial family identities remain visible. The registry does not replace them with fictional departments.

Each profile records configured capabilities, preferred capabilities, restricted capabilities, synthesis eligibility, Red Team eligibility, research eligibility, cost tier, latency tier, maximum recommended risk, availability, provenance, profile version, and review metadata.

Availability is truth-labeled:

- `available`
- `unavailable`
- `degraded`
- `unknown`

Phase 48-C3B1 does not run health checks and does not read provider keys. Unknown availability stays unknown and is not treated as proven healthy.

## Provenance Rules

Registry values use provenance labels:

- `configured_policy`
- `observed_support`
- `manually_assigned`
- `unknown`

Phase 48-C3B1 uses configured policy and manually assigned profile metadata only. It does not fabricate observed live state.

## Mission Classification

`classifyMission()` deterministically maps Commander mission text and Commander overrides into:

- mission classification
- required capabilities
- optional capabilities
- risk level
- live data requirement
- evidence requirement
- Red Team requirement
- synthesis requirement
- recommended depth
- participation preset
- uncertainty flags

The classifier is keyword/policy driven. It does not call AI providers.

## Participation Presets

The planner supports advisory presets:

- `focused`: normally one to two families, lower cost and latency.
- `standard`: balanced default.
- `comprehensive`: broader participation for higher depth or risk.

Stable Group and Full Council are not renamed or removed. Legacy mapping is provenance-only:

- Stable Group compatibility origin maps to focused or standard metadata.
- Full Council compatibility origin maps to comprehensive metadata.

This mapping never changes current execution.

## Assembly Plan

`CouncilAssemblyPlan` is the canonical advisory recommendation for family participation and execution envelope. It includes:

- plan identity and immutable version metadata
- mission identity and mission version
- classification and required capabilities
- selected, optional, and excluded families
- structural selection and exclusion reasons
- speaking roles
- dependency intent
- evidence, Red Team, revision, and synthesis planning
- minimum usable families
- provider and turn ceilings
- cost and latency tiers
- timeout intent
- fallback plan
- Commander overrides
- unresolved capabilities
- uncertainty flags
- plan status and provenance

The plan never stores provider turn content. Actual content remains owned by `DeliberationSession` and `DeliberationTurn`.

## Immutable Versioning

Plan statuses:

- `draft`
- `advisory`
- `execution_ready`
- `execution_started`
- `superseded`
- `invalid`
- `unresolved`

Draft/advisory plans may be revised through explicit versioned revision. `execution_ready` and `execution_started` plans are immutable. Mission changes and override changes create new plan versions with prior-plan linkage. Silent mutation is not allowed.

## Commander Overrides

Supported override representations:

- `add_family`
- `exclude_family`
- `require_red_team`
- `require_live_research`
- `prioritize_speed`
- `prioritize_depth`
- `set_cost_ceiling`
- `force_comprehensive`
- `request_direct_family`
- `prevent_synthesis`
- `stop_deliberation`

Every override records identity, type, value, issuer, timestamps, mission/plan version, provenance, and support status. Contradictory overrides fail safely. Unsupported override types are preserved as `recorded_for_future_execution`.

## Synthesis Authority Planning

The planner does not permanently assign ChatGPT as synthesizer. It recommends a synthesis authority only from selected, synthesis-eligible profiles. Fallback synthesizers are deterministic and ordered by capability fit. Commander `prevent_synthesis` marks synthesis as prevented by Commander authority.

This is planning only. It does not execute synthesis.

## Red Team Policy

Red Team requirement is represented as:

- `mandatory`
- `conditional`
- `optional`
- `omitted`

Trigger reasons include high-risk mission signals and Commander overrides. Red Team is not included by default for visual effect.

## Evidence Planning

Evidence requirement states:

- `not_required`
- `recommended`
- `required`
- `live_required`
- `unavailable`
- `unresolved`

No research is performed in Phase 48-C3B1. The planner may say live evidence is required, but it cannot claim live research occurred.

## Cost and Latency Planning

Cost and latency are configured tiers, not exact billing claims:

- Cost: `low`, `medium`, `high`, `unknown`
- Latency: `fast`, `moderate`, `slow`, `unknown`

The planner reports provider count, max turns, timeout intent, and unresolved estimate states. It does not block existing provider execution.

## State Authority

Current state authority remains:

- Existing mission structures: canonical mission intent.
- `FamilyCapabilityRegistry`: canonical configured capability claims.
- `CouncilAssemblyPlan`: canonical advisory recommendation.
- `DeliberationSession` / `DeliberationTurn`: canonical actual conversation content and causal linkage.
- `CouncilProgressRuntimeTracker`: canonical provider/request lifecycle truth.
- Live Council UI state: rendering only.

The assembly planner is not a lifecycle tracker.

## Relationship To Phase 48-C3A

Phase 48-C3A established real family-to-family deliberation. Phase 48-C3B1 does not change that runtime. It only creates a future planning layer that can later recommend when deliberation should be focused, standard, or comprehensive.

## Relationship To Stable Group And Full Council

Stable Group and Full Council remain operationally unchanged. Phase 48-C3B1 may record compatibility origin as provenance-only metadata, but it does not control dispatch or mode selection.

## Why Execution Is Unchanged

No file in this module is imported by `/api/chat`, provider routes, Live Council UI dispatch, progress runtime, or provider adapters. The validation suite also checks that the planner does not call `/api/chat`, does not invoke providers, and labels output as advisory-only.

## Future Phase 48-C3B2

Phase 48-C3B2 can add a shadow-selection path that computes an assembly plan alongside existing execution and records comparison diagnostics. That future phase should still avoid controlling dispatch until independently validated.

## Known Limitations

- Availability is configured truth only; no health checks are performed.
- No exact cost estimates are produced.
- No research occurs.
- No evidence packets are created.
- No persistence exists.
- The planner does not yet consume a fully canonical mission object because current mission structures are not the same shape as Live Council directives.
- Advisory recommendations are not visible in production UI unless a future phase safely surfaces them.

