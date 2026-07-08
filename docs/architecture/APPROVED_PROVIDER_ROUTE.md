# Approved Provider Route Specification

This document specifies the future `app/api/council/approved-provider-call/route.ts` boundary. It is a specification only. No route, provider adapter, environment check, or executable path is created in this phase.

The purpose of this route is to extend the Phase 46G containment model from a fake adapter to one narrowly controlled real-provider smoke path, while preserving the same approval boundary: no explicit execution approval means no call.

## Route Contract

Future route:

`POST /api/council/approved-provider-call`

Expected request shape:

```ts
type ApprovedProviderRouteRequest = {
  executionPlan: ExecutionPlan
  preview: ApprovedExecutionPreview
  approval: ExplicitExecutionApproval
  providerCandidateId: string
  executionStepId: string
  input: {
    prompt: string
    systemInstruction: string
  }
}
```

Expected response shape:

```ts
type ApprovedProviderRouteResponse = {
  requestId: string
  status: 'blocked' | 'succeeded' | 'failed' | 'timed_out' | 'invalid_output'
  providerFamily: 'openai'
  providerId: 'openai-approved-smoke'
  modelId: string
  output: {
    content: string
  } | null
  approvalConsumed: boolean
  auditRecord: ProviderCallAuditRecord
  safeSummary: string
  recommendedNextAction: string
}
```

The route must be text-only. It must not support tools, function calling, web browsing, file access, database mutation, repo mutation, memory writes, message sending, deployment, Auto Mode execution, or fallback provider selection.

## Required Environment Flags

The future route requires two independent environment flags. Both default to false.

```env
WAR_ROOM_ENABLE_46H_APPROVED_PROVIDER_ROUTE=false
WAR_ROOM_ENABLE_REAL_PROVIDER_SMOKE=false
```

`WAR_ROOM_ENABLE_46H_APPROVED_PROVIDER_ROUTE` controls whether the route is available at all.

`WAR_ROOM_ENABLE_REAL_PROVIDER_SMOKE` controls whether a real provider smoke call can be attempted after the route is enabled.

Both flags must be true before the route may attempt a provider call. If either flag is missing or false, the route returns `blocked`, produces an audit record, and does not call the provider.

The flags do not replace `ExplicitExecutionApproval`. They only allow the route to proceed to approval verification. A valid explicit approval is still required.

## Approval Verification

Phase 46G verification carries over unchanged.

The only object that can authorize the call is `ExplicitExecutionApproval`:

```ts
type ExplicitExecutionApproval = {
  approvalId: string
  executionPlanId: string
  previewId: string
  approvalType: 'single_provider_call'
  approvalText: 'I APPROVE THIS SINGLE PROVIDER CALL'
  approvedBy: 'commander'
  approvedAt: string
  expiresAt: string
  singleUse: true
  consumedAt: string | null
  approvalTokenHash: string
  approvalScope: {
    allowedProviderCandidateId: string
    allowedExecutionStepId: string
    allowedActionType: 'provider_call'
  }
}
```

The approval must match exactly on:

- exact approval text
- approval type
- approver
- expiration
- consumed state
- execution plan id
- preview id
- provider candidate id
- execution step id
- action type

`approved_preview_only`, `approvalRequired`, `executionAllowed`, `liveExecutionEnabled`, route flags, provider health, or any boolean must never authorize the call.

If the request is blocked before provider invocation, approval remains unconsumed.

If provider invocation begins, approval is consumed whether the call succeeds, fails, times out, or returns invalid output.

## First Smoke Provider

The first smoke provider should be OpenAI.

Planned provider identity:

```ts
providerFamily: 'openai'
providerId: 'openai-approved-smoke'
modelId: '<lowest-cost currently approved smoke model>'
```

OpenAI is chosen for the first smoke test because the War Room already has established OpenAI provider infrastructure, the API surface is familiar, and a text-only single-turn call can be contained with minimal moving parts. The smoke test is not intended to measure model quality. It is intended to prove that the approval gate, route flags, network interceptor, timeout handling, audit record, and consumption rules work together.

The exact model must be selected during implementation using the current approved low-cost text model available in the existing provider configuration. This specification intentionally avoids hardcoding a model name.

No other provider should be used in the first smoke test. There must be no fallback to Claude, Grok, Gemini, Kimi, local engines, or a fake adapter if the real smoke call fails.

## Gate 7: Approved Real-Call Verification

Gate 7 verifies that the future route cannot accidentally call the network.

The validation harness must install a network spy or interceptor around provider-call execution. The spy must record attempted outbound calls, target host, request count, and whether the request body matches the single approved provider call shape.

Recommended method:

- In tests, replace the provider transport with an injectable fetch/client wrapper.
- The wrapper records every outbound call attempt.
- Negative-control tests assert zero outbound calls.
- The one valid smoke test asserts exactly one outbound call to the expected OpenAI endpoint.
- Timeout and malformed-output tests assert exactly one outbound call and no retry.

Gate 7 must prove:

- no network call occurs when route flags are false
- no network call occurs without `ExplicitExecutionApproval`
- no network call occurs with invalid approval
- no network call occurs with expired approval
- no network call occurs with consumed approval
- no network call occurs with lineage mismatch
- no network call occurs with scope mismatch
- no network call occurs when approval is only `approved_preview_only`
- exactly one network call occurs for a valid approval and both route flags enabled
- no retry creates a second network call
- no fallback provider is selected
- provider invocation consumes approval
- audit record is produced for blocked, failed, timed out, invalid, and succeeded paths

## Negative-Control Test Cases

The full negative-control suite must include:

1. Route flag `WAR_ROOM_ENABLE_46H_APPROVED_PROVIDER_ROUTE=false` -> blocked, zero network calls, approval unconsumed.
2. Route flag `WAR_ROOM_ENABLE_REAL_PROVIDER_SMOKE=false` -> blocked, zero network calls, approval unconsumed.
3. Both flags missing -> blocked, zero network calls, approval unconsumed.
4. No approval object -> blocked, zero network calls.
5. Preview approval only -> blocked, zero network calls.
6. Wrong approval text -> blocked, zero network calls, approval unconsumed.
7. Wrong approval type -> blocked, zero network calls, approval unconsumed.
8. Wrong approver -> blocked, zero network calls, approval unconsumed.
9. Expired approval -> blocked, zero network calls, approval unconsumed.
10. Consumed approval -> blocked, zero network calls.
11. Wrong executionPlanId -> blocked, zero network calls, approval unconsumed.
12. Wrong previewId -> blocked, zero network calls, approval unconsumed.
13. Wrong providerCandidateId -> blocked, zero network calls, approval unconsumed.
14. Wrong executionStepId -> blocked, zero network calls, approval unconsumed.
15. Wrong action type -> blocked, zero network calls, approval unconsumed.
16. Prompt attempts tool use -> blocked, zero network calls, approval unconsumed.
17. Prompt attempts file/database/repo/deployment action -> blocked, zero network calls, approval unconsumed.
18. Valid approval but malformed request body -> blocked, zero network calls, approval unconsumed.
19. Valid approval and flags enabled but provider timeout -> `timed_out`, exactly one network call, approval consumed, no retry.
20. Valid approval and flags enabled but provider error -> `failed`, exactly one network call, approval consumed, no retry.
21. Valid approval and flags enabled but invalid provider output -> `invalid_output`, exactly one network call, approval consumed, no retry.
22. Valid approval and flags enabled succeeds -> `succeeded`, exactly one network call, approval consumed.
23. Reuse consumed approval after success -> blocked, zero network calls.
24. Reuse consumed approval after timeout/failure -> blocked, zero network calls.

## Timeout And Failure Behavior

The future route must match Phase 46G's containment rule:

- blocked before provider invocation -> approval remains unconsumed
- provider invocation begins -> approval is consumed either way
- no retry
- no fallback provider
- no alternate brain
- no tool escalation
- no Auto Mode action

Timeout behavior:

- apply a strict server-side timeout to the single provider call
- return `timed_out`
- include a safe summary
- include recommended next action
- produce an audit record
- do not retry
- do not attempt any alternate provider

Failure behavior:

- provider API error -> `failed`
- malformed or empty provider output -> `invalid_output`
- unexpected exception before provider invocation -> `blocked` if approval/provider call did not begin
- unexpected exception after provider invocation begins -> `failed`, approval consumed

All failures must be visible in the response and audit record. Silent disappearance is not allowed.

## Audit Requirements

Every route response must include an audit record.

Audit record must include:

- request id
- approval id
- execution plan id
- preview id
- provider candidate id
- execution step id
- route flag state
- approval verification result
- provider invocation attempted true/false
- network call count from the spy/interceptor
- status
- approval consumed true/false
- timeout/failure reason when applicable
- created timestamp

Audit records are response-local for the first route phase unless a later phase explicitly adds persistence.

## Rollback Plan

Rollback must be simple and immediate.

1. Set `WAR_ROOM_ENABLE_REAL_PROVIDER_SMOKE=false`.
2. If needed, set `WAR_ROOM_ENABLE_46H_APPROVED_PROVIDER_ROUTE=false`.
3. Confirm the route returns `blocked` before provider invocation.
4. Confirm the network spy records zero outbound calls.
5. Re-run negative-control tests.
6. If code rollback is needed, remove only the route and provider smoke adapter files introduced in the implementation phase.
7. Keep Phase 46G fake-adapter package intact.

Rollback must not require schema changes, data migration, UI changes, or provider-key changes.

## Implementation Constraints For The Future Route

The future implementation must not:

- create broad `approved: true` execution semantics
- treat preview approval as execution approval
- add Auto Mode
- add provider fallback
- add streaming
- add tool calls
- add web browsing
- add memory writes
- add Supabase writes
- add repo mutation
- add message sending
- add deployment
- support multiple calls from one approval
- expose provider keys to the client

The future route should remain a narrow smoke-test corridor: one explicit approval, one provider candidate, one execution step, one text-only provider call, one audit record.
