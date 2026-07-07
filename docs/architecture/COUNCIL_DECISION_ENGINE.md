# Council Decision Engine

Phase 46C introduces the routing layer that decides how a commander request should be handled before any provider is selected.

This phase is architecture-only. It does not change live council orchestration, provider routing, chat behavior, or UI.

## Flow

```text
Commander
-> Intent Engine
-> Skill Router
-> Entity Router
-> Approval Gate
-> Routing Note
```

The decision engine answers:

1. What is the commander asking?
2. Which skills are required?
3. Which Council Entities own or support those skills?
4. Does this route require approval?
5. How confident is War Room in the routing decision?

Provider selection is intentionally absent from this phase.

## Routing Confidence vs Answer Confidence

Routing confidence measures how confident War Room is that it classified and routed the request correctly.

It is not a measure of the final AI answer quality.

Examples:

- A short request like "research this" may have medium routing confidence because the intent is clear but the object is underspecified.
- A request like "plan, research, and build this" may have lower routing confidence because multiple route families are active at once.
- A future model answer may still be high quality even if routing confidence is low, but low routing confidence should surface a clarification note before action.

Low confidence should produce:

```text
Multiple candidate routes detected. Commander clarification recommended.
```

## Why Provider Selection Is Deferred

Phase 46 established permanent Council Entities.

Phase 46B established Council Skills.

Phase 46C decides:

```text
intent -> skills -> entities -> approval posture
```

It does not decide:

```text
entity -> provider brain
```

That provider-brain selection belongs to Phase 46D. Until then, every Routing Note must keep:

```ts
providerRecommendation: null
```

This prevents the routing layer from accidentally recreating the old provider-first architecture.

## Routing Note Shape

```ts
type RoutingNote = {
  routingId: string
  intent: string
  routingConfidence: number
  candidateSkillIds: CouncilSkillId[]
  rejectedSkillIds: { skillId: CouncilSkillId; reason: string }[]
  selectedSkillIds: CouncilSkillId[]
  selectedEntityIds: CouncilEntityId[]
  approvalRequired: boolean
  riskLevel: CouncilSkillRiskLevel
  reason: string
  decisionPath: string[]
  providerRecommendation: null
  timestamp: string
}
```

## Decision Path

`decisionPath` is built by the actual `CouncilDecisionEngine` as it moves through each step.

Expected entries include:

- Intent classification
- Skill selection count
- Rejected candidate count when applicable
- Entity selection count
- Approval gate outcome
- Clarification recommendation when confidence is low or ambiguous
- Provider selection deferral

The path is not a separate freeform narrative. It is the audit trail of decisions made by the engine.

## Rejected Skills

For every routing decision, the Skill Router records candidate skills considered through:

- `CouncilSkillRegistry.findByCategory()`
- `CouncilSkillRegistry.findByTool()`

Any candidate skill not selected becomes:

```ts
{ skillId: CouncilSkillId; reason: string }
```

This creates later auditability without executing tools or providers.

## Approval Gate

The Approval Gate reuses Phase 46B skill metadata:

- `approvalRequired`
- `riskLevel`

It does not invent new approval logic.

If any selected skill requires approval, the Routing Note requires approval.

The Routing Note risk level is the highest risk level among selected skills.

## Decision Visualization Shape

No UI is built in Phase 46C.

Future UI could render a decision visualization from the Routing Note:

```text
Routing Note
├── Intent
│   ├── intent
│   └── routingConfidence
├── Skills
│   ├── candidateSkillIds
│   ├── selectedSkillIds
│   └── rejectedSkillIds
├── Entities
│   └── selectedEntityIds
├── Approval
│   ├── approvalRequired
│   └── riskLevel
├── Provider
│   └── providerRecommendation: null
└── Decision Path
    └── step-by-step routing audit trail
```

Suggested visual treatment later:

- Compact routing summary card
- Expandable decision path
- Selected skill chips
- Rejected skill audit drawer
- Entity ownership map
- Approval posture badge
- Provider section explicitly marked "Deferred to Phase 46D"

## Non-Goals

Phase 46C does not:

- Call providers
- Recommend providers
- Import routing into `/api/chat`
- Import routing into `app/page.tsx`
- Change live council orchestration
- Change chat behavior
- Change UI appearance
- Execute tools
- Write memory
- Mutate Council Entities
- Mutate Council Skills

## Ready for Phase 46D

Phase 46D can build provider-brain selection on top of Routing Notes.

Until then, provider selection remains deliberately absent and `providerRecommendation` remains null.
