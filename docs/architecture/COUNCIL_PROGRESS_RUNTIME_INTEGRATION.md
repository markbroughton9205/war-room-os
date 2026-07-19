# Council Progress Runtime Integration

Phase 47C-3 connects the validated Council progress-event contract to the live `/api/chat` server orchestration path without changing provider routing, chat behavior, persistence, or UI behavior.

## Orchestration Path Reconciliation

The current live server path in `app/api/chat/route.ts` has several exits. The progress runtime integrates only where the route itself owns provider selection and observes provider results:

- Direct invocation: exactly one family selected from the explicit direct key.
- Parallel providers: server-selected configured providers called with `Promise.all`.
- Sequential continuation: frontend-selected single-family shards sent through `mode: "continue"` plus `councilSingleFamily`, including Full Council / Stable Group gather turns and autonomous continuation turns.

Other exits such as OS sweep, Council Research Team, Economic Ops routing, and unsupported-flow errors remain outside this phase. They continue to receive the existing runtime trace wrapper but no Council progress snapshot unless a progress tracker was created.

`app/api/council/continue/route.ts` is intentionally excluded from provider progress runtime integration in this phase. It does not execute model providers. Its active responsibility is planning/persisting continuation runtime state, publishing cognitive bus events, and returning a `chatInvokeHint` that instructs the client to invoke `/api/chat` with `mode: "continue"`, `councilSingleFamily`, `conversationalTurn: true`, and `raelDirectiveText`. If that route later begins dispatching providers or returning family model output directly, it must be instrumented at that new provider-execution boundary.

## Runtime Boundary

The chosen boundary is the `/api/chat` provider orchestration layer after provider selection is known and before provider calls are dispatched or explicitly skipped.

The runtime adapter:

- Creates a `CouncilRequestStateRecord`.
- Emits canonical progress events.
- Replays the accumulated event log plus the candidate event before committing a new event.
- Rejects invalid events without mutating progress state.
- Attaches a sanitized `councilProgress` snapshot to the existing JSON response.

For frontend sequential single-family continuation, the progress snapshot represents the current response shard, not the whole Commander decree. The client sends optional correlation metadata:

- `councilLogicalRequestId`
- `councilLogicalExpectedFamilies`
- `councilLogicalTurnIndex`
- `councilLogicalTurnTotal`

These fields let diagnostics group shards from the same logical Council turn without pretending one shard can complete the full decree. Missing or malformed correlation metadata falls back to the response-local tracker seed.

## Runtime Trace Relationship

Council runtime trace remains the diagnostic envelope. Council progress is the canonical state machine view of request/family lifecycle. Progress events do not replace trace stages, and trace stages do not become progress truth by implication.

## Event Coverage

The integrated paths emit:

- `request_created`
- `request_selection_resolved`
- `request_started`
- `family_queued`
- `family_dispatched`
- `family_response_started`
- `family_response_completed`
- `family_failed`
- `family_timed_out`
- `family_not_reached`
- `family_skipped_by_policy`
- `audit_scope_declared`
- `audit_completed`
- `diagnostic_recorded`
- `request_completed`
- `request_failed`
- `request_timed_out`

`request_cancel_requested`, `request_cancelled`, prior-response delivery, fallback, and retrieval events remain validated by the progress-event layer but are not yet emitted by this provider runtime integration path.

Sequential continuation does not emit `request_completed`, `request_failed`, or `request_timed_out` from one single-family shard. Request-level closure remains reserved for paths where the runtime observes the full selected family set reaching terminal state.

## Audit Protection

Phase 47C-2's audit re-declaration protection was replay-only. Phase 47C-3 makes replay the live ingestion boundary: every candidate event is tested by replaying the full accepted stream plus the candidate before mutation. That prevents audit scope from being re-declared after `audit_completed` in live ingestion.

## Fail-Open Rule

Progress subsystem failures must not block the underlying Council response. A rejected progress event records a safe internal diagnostic in the progress snapshot and does not throw through `/api/chat`.

## Red Team Accounting

In the server-parallel path, Red Team integrity output created by `validateProviderResults()` is classified as a synthetic integrity layer record, not as a fifth external provider. Selected provider families remain the configured external provider set.

## Closure Semantics

`closeIfTerminal()` closes only when every selected family in the current runtime tracker is terminal. If at least one selected family produced a usable complete response, the request closes as `request_completed` even when another selected family failed or timed out. `request_failed` is reserved for terminal requests with no usable family response. `request_timed_out` is reserved for terminal timeout-only requests.

## Known Limitations

- Client-side cancellation can be represented by the event contract but is not yet wired to live client abort handling.
- Memory recommendation remains explicitly non-executed on the server-parallel provider path.
- The attached progress snapshot is a response artifact, not persistent storage.
- Sequential progress snapshots are response-shard artifacts correlated by logical metadata, not a merged persistent progress ledger.

## Phase 47C-4 Recommendation

Wire progress events into client cancellation next, then decide whether persisted progress logs are needed. Persistence should be a separate authority review because progress records may reveal private operational timing and provider availability.
