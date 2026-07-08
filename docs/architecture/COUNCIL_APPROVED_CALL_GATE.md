# Council Approved Call Gate

Phase 46G introduces the first live-capable-shaped council boundary, but this phase is fake-adapter-only. It proves containment: War Room can refuse every unapproved provider-shaped call and permit exactly one contained fake call when the Commander provides a distinct execution approval.

No real provider route is added. No environment flag can enable real execution. No UI, API route, Supabase write, memory write, repo mutation, tool call, message send, deployment, web access, or Auto Mode path is introduced.

## Stack Position

The inert architecture now flows:

Commander message -> RoutingNote -> BrainRecommendation -> ExecutionPlan -> ApprovedExecutionPreview -> ExplicitExecutionApproval -> ApprovedProviderCallRequest -> FakeProviderCallResult -> ProviderCallAuditRecord

Phase 46F preview approval remains separate from execution approval. `approvalRequired`, `approvalState`, `approved_preview_only`, and all 46F booleans never authorize a provider call.

## Explicit Execution Approval

The only object that can authorize the fake adapter is `ExplicitExecutionApproval`.

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

The approval must match exactly on phrase, plan id, preview id, provider candidate id, execution step id, and action type. It must be unexpired and unconsumed. Any mismatch blocks before adapter invocation.

If the fake adapter invocation begins, the approval is consumed whether the result succeeds, fails, times out, or returns invalid output. If the request is blocked before adapter invocation, the approval remains unconsumed.

## Fake Provider Adapter

46G uses one contained adapter only:

- `providerFamily: 'fake'`
- `providerId: 'fake-approved-provider'`
- `modelId: 'fake-contained-model'`

The adapter accepts a text prompt and system instruction and returns simulated text. It does not stream, retry, call tools, access files, query databases, write memory, send messages, deploy, browse, or call any real model.

## Failure Behavior

Blocked paths produce a `ProviderCallResult` and `ProviderCallAuditRecord` without invoking the adapter. Adapter paths produce a result and audit record after exactly one fake invocation.

Failure never escalates:

- no fallback provider
- no retry
- no provider chain
- no Auto Mode execution
- no side effects

Modeled failure statuses are `blocked`, `failed`, `timed_out`, and `invalid_output`.

## Six Validation Gates

Gate 1: Static validation

- TypeScript
- ESLint
- build

Gate 2: Behavioral validation

- all twelve required approval/failure cases are built into `behaviorValidation.ts`

Gate 3: Regression validation

- 46C routing, 46D brain selection, 46E execution plans, and 46F execution gate remain stable

Gate 4: Architecture validation

- no imports into live orchestration
- no UI wiring
- no API route wiring

Gate 5: Execution boundary validation

- no tools
- no database writes
- no repo mutation
- no message sending
- no deployment
- no Auto Mode
- no fallback provider chain
- no multiple calls per approval

Gate 6: Approved-call verification

- fake adapter is not called without approval
- fake adapter is not called with invalid, expired, consumed, or mismatched approval
- fake adapter is called exactly once for a valid approval
- `approved_preview_only` never authorizes execution
- approval becomes consumed after the attempt, success or failure
- no real provider adapter is imported
- no environment flag enables real execution
- no fallback provider is selected
- no retry produces an extra call
- audit records are produced for blocked and fake-called paths

## Future Roadmap

46G proves the containment boundary with a fake adapter only. A later phase may add a real API route behind an additional explicit approval protocol. Another later phase may add UI wiring for Commander approval. Those phases must preserve the separation between preview approval and execution approval.
