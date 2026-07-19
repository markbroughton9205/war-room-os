# Council Request-State Contract

Phase 47C-1 creates the shared truth contract only.

It does not:

- change provider routing
- change Full Council execution
- add streaming
- add sequential orchestration
- change persistence
- change UI rendering
- enable autonomous execution

## Why Readiness And Completion Are Separate

Provider readiness describes capability outside the current Commander request. A provider can be configured, connected, unavailable, paused, disabled, or unknown before a turn begins.

Request completion describes what happened inside one Commander request. A connected provider can still fail, time out, return incomplete text, be skipped by policy, or never be reached. The request-state contract therefore forbids completion counts derived from provider readiness.

## Canonical Axes

The contract separates these axes:

- Provider readiness: capability snapshot outside the request.
- Request lifecycle: where a family is during the request.
- Request outcome: terminal result for that family.
- Audit scope: whether Red Team or an integrity layer reviewed a complete, partial, unknown, or unaudited record.
- Visibility: whether output was rendered, omitted, substituted, persisted, suppressed, or diagnostic-only.
- Selection authority: why a family was selected or skipped.
- Prior-response lineage: whether later families actually received earlier family outputs.
- Fallback lineage: how primary failure and fallback substitution are preserved.

## Lifecycle And Outcome

Lifecycle is progression: waiting, queued, dispatched, retrieving, reviewing previous family output, responding, stopped by Commander, not reached, and terminal.

Outcome is terminal result: complete, incomplete, timed out, failed, fallback used, skipped by policy, stopped, or not reached.

A terminal lifecycle requires exactly one outcome. A nonterminal lifecycle cannot carry an outcome.

## Fallback Preservation

Fallback success never erases primary failure. Fallback lineage records:

- primary family and provider
- primary outcome
- primary failure category
- fallback provider or mechanism
- fallback outcome
- whether fallback output rendered
- whether fallback output replaced visible primary content
- whether the Commander was informed
- safe diagnostic reason

Rendered fallback substitution must be marked as substituted in visibility state.

## Prior-Response Lineage

A family may only be shown as reviewing or responding to another family when lineage proves the prior response was delivered. The lineage record stores family identity, execution ID, delivery order, safe content fingerprint/reference, delivery purpose, and omission reason when content was not delivered.

The contract stores no hidden reasoning, raw provider prompts, credentials, cookies, tokens, authorization data, or chain-of-thought.

## Red Team Audit Scope

Red Team can be represented as either an external family audit or a synthetic integrity review. The audit metadata records expected families, received families, missing families, current-turn prior-response receipt, and scope:

- complete_record
- partial_record
- unknown_scope
- not_audited

Complete-record audit requires all expected auditable families. Partial-record audit requires missing or excluded metadata. Unknown-scope audit cannot claim full-record verification.

## Migration Boundary

The current browser Full Council path remains untouched. The future server-streamed Council kernel can reuse this contract for progress events, sequential conversation, cancellation, Live Intel evidence delivery, Red Team audit scope, persistence, diagnostics, and engineering telemetry.

Phase 47C-1 intentionally creates no route, UI, database, provider, or persistence behavior change.
