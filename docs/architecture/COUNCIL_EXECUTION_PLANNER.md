# Council Execution Planner

Phase 46E creates a dry-run execution planner for War Room.

This phase makes War Room better at planning how it would think. It does not make War Room execute.

## Purpose

The planner produces a dry-run answer to:

```text
Here is how I would process this request.
```

It must not mean:

```text
I am processing this request now.
```

## Lineage

Phase 46E preserves the architecture chain:

```text
Commander message
-> RoutingNote
-> BrainRecommendation
-> ExecutionPlan
-> Phase 46F gated live integration later
```

An `ExecutionPlan` references:

- `RoutingNote.routingId`
- `BrainRecommendation.recommendationId`

It does not mutate either object.

## Non-Executing Boundary

Every generated plan hardcodes:

```ts
executionAllowed: false
executionMode: 'dry_run'
```

Phase 46E does not:

- Call providers
- Execute tools
- Call APIs
- Mutate Supabase
- Write databases
- Mutate repositories
- Send messages
- Perform browser actions
- Wire into `/api/chat`
- Wire into `app/page.tsx`
- Add browser-visible behavior

## ExecutionPlan Shape

```ts
type ExecutionPlan = {
  executionPlanId: string
  routingId: string
  recommendationId: string
  commanderMessage: string
  intent: string
  selectedSkillIds: string[]
  selectedEntityIds: string[]
  recommendedBrainCandidateIds: string[]
  selectedBrainCandidateId: string | null
  approvalRequired: boolean
  blockedReason: string | null
  executionAllowed: false
  executionMode: 'dry_run'
  executionSteps: ExecutionStep[]
  expectedInputs: ExpectedInput[]
  expectedOutputs: ExpectedOutput[]
  safetyChecks: SafetyCheck[]
  estimatedCostClass: 'none' | 'low' | 'medium' | 'high'
  estimatedLatencyClass: 'instant' | 'fast' | 'normal' | 'slow'
  fallbackPlan: FallbackPlan
  decisionPath: string[]
  createdAt: string
}
```

## ExecutionStep Shape

```ts
type ExecutionStep = {
  stepId: string
  label: string
  ownerEntityId: string | null
  skillId: string | null
  brainCandidateId: string | null
  actionType:
    | 'classify'
    | 'gather_context'
    | 'reason'
    | 'draft'
    | 'critique'
    | 'synthesize'
    | 'ask_clarification'
    | 'propose_action'
    | 'await_approval'
  description: string
  requiresApproval: boolean
  riskLevel: 'low' | 'medium' | 'high'
  status: 'planned' | 'blocked' | 'not_executed'
}
```

Execution steps describe future behavior only. They do not execute providers, tools, databases, repos, or external services.

## Safety Checks

Safety checks make the dry-run boundary explicit.

Examples:

- Provider calls disabled
- `executionAllowed` false
- Live research not executed
- Approval required before high-risk action
- No repo mutation
- No external side effects
- No database mutation
- Privacy-sensitive request requires approval
- Low confidence requires clarification
- No eligible brain candidate blocks execution

## FallbackPlan Behavior

Fallback plans explain what War Room would do if execution cannot proceed later.

Strategies:

- `ask_clarification`
- `await_approval`
- `static_template_only`
- `local_only`
- `defer_execution`
- `route_to_skeptic`
- `no_action`

Fallbacks are selected for conditions such as:

- No eligible brain candidate
- Approval required
- Live research required but unavailable in this phase
- Low confidence
- High privacy or risk
- Cost/premium limits

## Behavior Validation

Phase 46E includes inert behavior validation in:

```text
lib/council/execution-plan/behaviorValidation.ts
```

It validates dry-run behavior for:

- `hello families`
- `build me a login system`
- `what’s happening with fuel prices lately`
- `is this message a scam?`
- `write an outreach message`
- `run full council`
- `scout income opportunities`
- `fix this bug`

The helper does not run automatically in production.

## Architecture Boundaries

Allowed one-directional dependencies:

```text
execution-plan -> routing
execution-plan -> brain-selection
```

Forbidden dependencies:

```text
routing -> execution-plan
brain-selection -> execution-plan
/api/chat -> execution-plan
app/page.tsx -> execution-plan
live council routes -> execution-plan
provider routes -> execution-plan
```

## Phase 46F Readiness

Future phase:

```text
Phase 46F — Gated Live Integration / Approved Execution Preview
```

Phase 46F may decide how approved preview/execution should be gated.

Phase 46E does not implement Phase 46F.
