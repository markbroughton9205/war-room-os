# Council Execution Gate

Phase 46F introduces the boundary between War Room's dry-run intelligence stack and future live execution.

This is not a full execution phase.

## Stack Position

Current stack:

```text
Council Entities
-> Council Skills
-> RoutingNote
-> BrainRecommendation
-> ExecutionPlan
```

46F adds:

```text
ExecutionPlan
-> ApprovedExecutionPreview
-> ExecutionGateDecision
-> AutoModePolicy
```

## Purpose

Phase 46F lets War Room say:

- Here is what I would do.
- Here is what is blocked.
- Here is what requires approval.
- Here is what would be auto-eligible later.
- Here is why Auto Mode is not active yet.

It does not let War Room execute.

## approved_preview_only

In 46F, approved means approved to preview only.

Approved preview may include:

- Showing the dry-run plan
- Preparing a copyable work packet
- Preparing a validation prompt
- Explaining blocked actions
- Requesting next-step confirmation
- Marking an item as future-queue eligible in memory only

Approved preview does not mean:

- Provider calls
- API calls
- Database writes
- Repo mutation
- Message sending
- Deployment
- Tool execution
- Auto Mode action

## Execution Gate Decision

`ExecutionGateDecision` records the boundary posture.

It hardcodes:

```ts
executionAllowed: false
liveExecutionEnabled: false
```

Gate states:

- `preview_only`
- `approval_required`
- `blocked`
- `unsupported`

## Blocked Execution Categories

46F explicitly blocks:

- `provider_call`
- `tool_call`
- `database_mutation`
- `repo_mutation`
- `message_send`
- `payment_action`
- `deployment_action`
- `live_research`
- `memory_write`
- `external_side_effect`
- `auto_mode_action`

## Auto Mode Policy

Auto Mode is architecturally supported but disabled.

46F hardcodes:

```ts
autoModeSupported: true
autoModeEnabled: false
allowedAutoActionTypes: []
```

Auto Mode may calculate eligibility and blocked reasons, but it cannot act.

## Allowed Next Actions

Allowed next actions in 46F:

- `show_preview`
- `ask_clarification`
- `request_operator_approval`
- `copy_work_packet`
- `copy_validation_prompt`
- `queue_for_future_execution`
- `explain_blocked_action`

Not allowed:

- Call provider
- Call API
- Write database
- Mutate repo
- Send message
- Deploy
- Commit/push
- Execute tool
- Run Auto Mode

## Five Validation Gates

Starting in 46F, validation is tracked through five gates:

1. Static Validation: TypeScript, ESLint, build.
2. Behavior Validation: realistic inputs and expected gate decisions.
3. Regression Validation: 46C, 46D, and 46E remain stable.
4. Architecture Validation: dependency direction, no unauthorized imports, no live wiring.
5. Execution Boundary Validation: execution, live execution, and Auto Mode remain disabled.

## Behavior Validation

The inert validation helper covers:

- `hello families`
- `build me a login system`
- `what's happening with fuel prices lately`
- `is this message a scam?`
- `write an outreach message`
- `run full council`
- `scout income opportunities`
- `fix this bug`
- `send this email to Jasmine`
- `update Supabase with this`
- `deploy this to Vercel`
- `commit and push this`

The helper does not run automatically in production.

## Architecture Boundaries

Allowed:

```text
execution-gate -> execution-plan
execution-gate -> brain-selection
execution-gate -> routing
```

Forbidden:

```text
routing -> execution-gate
brain-selection -> execution-gate
execution-plan -> execution-gate
app/api/chat -> execution-gate
app/page.tsx -> execution-gate
provider routes -> execution-gate
```

## Roadmap

- 46F: Execution Gate + Approved Preview + Auto Mode Policy Scaffold.
- 46G: Single approved provider call behind explicit approval.
- 46H: Tool/action approval framework.
- 46I: Memory/lesson write gate.
- 46J: Limited Auto Mode for safe reversible actions.

46F does not implement 46G, 46H, 46I, or 46J.
