# Council Skills 46B Design

Phase 46B designs the skill layer that will sit between permanent Council Entities and future routing, memory, and learning systems.

This is design work only. It does not change provider routing, council orchestration, chat behavior, or UI.

## Purpose

Council Genesis created permanent identities:

- ARCHITECT
- STRATEGIST
- LIBRARIAN
- SCOUT
- ENGINEER
- SKEPTIC

Council Skills define what those identities can do.

The entity owns identity. The provider supplies temporary reasoning. The skill layer describes capability.

```text
Commander
-> Council Entity
-> Council Skill
-> Provider Brain
```

## Skill Model

A Council Skill should be a stable capability record, not a provider prompt.

Recommended fields:

- `id`
- `displayName`
- `description`
- `category`
- `ownerEntityIds`
- `supportingEntityIds`
- `requiredTools`
- `riskLevel`
- `approvalRequired`
- `memoryEligible`
- `learningEligible`
- `activationStatus`
- `createdAt`
- `updatedAt`

Recommended TypeScript shape:

```ts
type CouncilSkillId = string

type CouncilSkillCategory =
  | 'reasoning'
  | 'planning'
  | 'research'
  | 'implementation'
  | 'review'
  | 'risk'
  | 'memory'
  | 'communication'
  | 'coordination'

type CouncilSkillRiskLevel =
  | 'low'
  | 'medium'
  | 'high'
  | 'financial'
  | 'legal'
  | 'identity'
  | 'deployment'

type CouncilSkillActivationStatus =
  | 'foundation'
  | 'available'
  | 'disabled'
  | 'requires_tooling'

type CouncilSkillDefinition = {
  id: CouncilSkillId
  displayName: string
  description: string
  category: CouncilSkillCategory
  ownerEntityIds: CouncilEntityId[]
  supportingEntityIds: CouncilEntityId[]
  requiredTools: string[]
  riskLevel: CouncilSkillRiskLevel
  approvalRequired: boolean
  memoryEligible: boolean
  learningEligible: boolean
  activationStatus: CouncilSkillActivationStatus
  createdAt: string
  updatedAt: string
}
```

## Skill Categories

Initial categories:

- `reasoning`
- `planning`
- `research`
- `implementation`
- `review`
- `risk`
- `memory`
- `communication`
- `coordination`

## Initial Skill Catalog

ARCHITECT should own:

- `system_architecture`: System Architecture
- `engineering_review`: Engineering Review
- `feasibility_analysis`: Feasibility Analysis
- `long_reasoning_decomposition`: Long-Reasoning Decomposition

STRATEGIST should own:

- `business_strategy`: Business Strategy
- `planning`: Planning
- `synthesis`: Synthesis
- `writing`: Writing
- `command_translation`: Command Translation

LIBRARIAN should own:

- `knowledge_organization`: Knowledge Organization
- `research_review`: Research Review
- `pattern_recognition`: Pattern Recognition
- `cross_reference`: Cross Reference
- `source_comparison`: Source Comparison

SCOUT should own:

- `current_signal_detection`: Current Signal Detection
- `internet_awareness`: Internet Awareness
- `market_intelligence`: Market Intelligence
- `opportunity_sensing`: Opportunity Sensing
- `realtime_context_framing`: Realtime Context Framing

ENGINEER should own:

- `implementation_planning`: Implementation Planning
- `task_sequencing`: Task Sequencing
- `technical_execution_planning`: Technical Execution Planning
- `operations_mapping`: Operations Mapping
- `dependency_mapping`: Dependency Mapping

SKEPTIC should own:

- `assumption_challenge`: Assumption Challenge
- `risk_analysis`: Risk Analysis
- `contradiction_checking`: Contradiction Checking
- `scam_detection`: Scam Detection
- `stress_testing`: Stress Testing

## Skill Registry Contract

The future registry should expose methods only and avoid side effects.

Recommended methods:

- `getSkill(id)`
- `getAll()`
- `findByCategory(category)`
- `findByEntity(entityId)`
- `findByTool(toolId)`
- `findByRiskLevel(riskLevel)`
- `findByActivationStatus(status)`
- `entitySupportsSkill(entityId, skillId)`
- `getPrimaryOwner(skillId)`
- `getSupportingEntities(skillId)`

The registry should not:

- Call providers
- Dispatch tools
- Write memory
- Change entity confidence
- Change entity experience
- Trigger UI updates

## Skill Compatibility Layer

Phase 46 entities currently expose `specialties`.

The compatibility layer should map old specialty strings to stable skill IDs.

Examples:

```text
architecture -> system_architecture
engineering review -> engineering_review
systems reasoning -> system_architecture
strategy -> business_strategy
planning -> planning
research -> research_review
current events -> current_signal_detection
task sequencing -> task_sequencing
risk analysis -> risk_analysis
contradiction checking -> contradiction_checking
```

This keeps `supportsSkill(skill)` useful while future routing migrates from freeform strings to typed skill IDs.

## Skill Selection Flow

Future routing should make skill selection observable and reversible.

Recommended flow:

```text
message intent
-> candidate skill IDs
-> owning Council Entities
-> provider brain candidates
-> approval gate
-> response or action proposal
```

Skill selection should produce a routing note with:

- `intent`
- `candidateSkillIds`
- `selectedSkillIds`
- `selectedEntityIds`
- `approvalRequired`
- `reason`

In 46B, this is design only. No live route should consume it yet.

## Entity Skill Assignments

The first implementation should keep each skill owned by one primary entity unless there is a strong reason to make it shared.

Recommended cross-support:

- ARCHITECT supports ENGINEER on implementation planning and dependency mapping.
- ENGINEER supports ARCHITECT on feasibility analysis and engineering review.
- SKEPTIC supports all high-risk skills.
- LIBRARIAN supports SCOUT on source comparison and research review.
- STRATEGIST supports all communication and synthesis outputs.
- SCOUT supports STRATEGIST on market intelligence and opportunity sensing.

## Approval Defaults

Default approval by category:

| Category | Default Approval |
| --- | --- |
| reasoning | false |
| planning | false |
| research | false unless external tool execution is required |
| implementation | true before code/file changes |
| review | false |
| risk | false |
| memory | true before permanent save |
| communication | false unless external send/post is required |
| coordination | true before external action |

Default risk by category:

| Category | Default Risk |
| --- | --- |
| reasoning | low |
| planning | low |
| research | medium |
| implementation | high |
| review | low |
| risk | medium |
| memory | medium |
| communication | low |
| coordination | medium |

## Skill Ownership

Each skill has one or more owner entities.

Owner entities are responsible for primary judgment.

Supporting entities can assist without owning the final recommendation.

Example:

```text
Skill: Feasibility Analysis
Owner: ARCHITECT
Support: ENGINEER, SKEPTIC
```

## Skill Activation

46B should not automatically activate skills in live chat.

Future activation should be explicit:

1. A commander message creates intent.
2. Intent maps to candidate skills.
3. Skills map to Council Entities.
4. Entities map to provider brains.
5. Approval gates apply before external action.

## Risk and Approval

Skills should carry risk metadata before they are connected to routing.

Recommended risk levels:

- `low`
- `medium`
- `high`
- `financial`
- `legal`
- `identity`
- `deployment`

Recommended approval behavior:

- Low-risk skills can suggest.
- Medium-risk skills should ask Ra'el before action.
- High-risk and special-risk skills require explicit approval.
- Financial, legal, identity, and deployment skills require secure approval.

## Memory and Learning

Skills may be memory-eligible or learning-eligible, but Phase 46B should not enable automatic memory writes.

Future memory rules:

- Skill outcomes can recommend memory.
- Ra'el approves permanent memory.
- Entity experience may increase only from approved memory or approved feedback.
- Provider output alone should not update entity experience.

## Compatibility With Phase 46

Phase 46 already includes `specialties` on each entity.

Council Skills should not replace `specialties` immediately.

Recommended transition:

1. Keep `specialties` as lightweight compatibility strings.
2. Add first-class skill definitions in a separate skill registry.
3. Let entity methods continue supporting `supportsSkill(skill)` through compatibility lookup.
4. Later, route intent through the skill registry instead of raw specialty strings.

## Proposed Files for Implementation

Future implementation should create:

- `lib/council/skills/types.ts`
- `lib/council/skills/CouncilSkill.ts`
- `lib/council/skills/CouncilSkillRegistry.ts`
- `lib/council/skills/skillCompatibility.ts`
- `lib/council/skills/index.ts`
- `docs/architecture/COUNCIL_SKILLS.md`

Suggested implementation order:

1. Add skill types.
2. Add immutable `CouncilSkill` class with read methods only.
3. Add registry with initial skill catalog.
4. Add compatibility lookup from Phase 46 `specialties` to skill IDs.
5. Add unit-style assertion file for registry lookups.
6. Export the skills package from `lib/council/skills/index.ts`.
7. Do not import the registry into live orchestration until a later phase.

## Suggested Assertions

Future assertion coverage should verify:

- Every skill has at least one owner entity.
- Every owner entity ID exists in the Council Entity registry.
- Every supporting entity ID exists in the Council Entity registry.
- Skill IDs are unique.
- Skill IDs are lowercase snake case.
- Risk levels are explicit.
- Special-risk skills require approval.
- Compatibility strings resolve to expected skill IDs.
- No skill performs provider calls or tool execution.

## Non-Goals for 46B

Do not change:

- Existing council orchestration
- Provider routing
- Chat behavior
- UI appearance
- Provider names
- Entity identity fields
- Memory persistence
- Learning behavior

Do not add:

- Autonomous skill execution
- Tool execution
- Provider selection changes
- Automatic memory writes
- Automatic experience updates

## Readiness Criteria

46B is ready to implement when:

- Skill types are stable.
- Initial skill catalog is agreed.
- Skill ownership rules are clear.
- Risk and approval metadata are defined.
- Compatibility with Phase 46 entities is preserved.
