# Council Progress Event Contract

Phase 47C-2 defines an inert, canonical progress-event contract for Council request execution. It explains how ordered execution activity can be transported safely, reduced into Phase 47C-1 request-state snapshots, and replayed deterministically for audit and future UI work.

This phase does not change provider routing, Full Council execution, server streaming, UI rendering, persistence, authentication, Supabase, or autonomous execution.

## Boundary

The progress-event module lives under `lib/council/progress-events/` and imports the existing request-state vocabulary from `lib/council/request-state/`. It does not duplicate provider readiness, lifecycle, outcome, visibility, audit-scope, or request-summary concepts.

No live API route, UI component, provider adapter, worker, persistence path, or production orchestrator imports this module in Phase 47C-2.

## Canonical Envelope

Every event uses a JSON-serializable envelope with:

- schema version
- request ID
- event ID
- optional family execution ID
- request-scoped positive integer sequence
- event type
- occurred/emitted timestamps
- optional family
- canonical source
- structured payload (audit metadata, where applicable, lives in `payload.audit` -- there is no separate envelope-level audit field)
- visibility
- safe diagnostic metadata where applicable

No functions, classes, raw `Error` objects, provider SDK objects, streams, promises, buffers, raw prompts, chain-of-thought, hidden reasoning, cookies, API keys, or authorization values belong in the envelope.

## Event Vocabulary

The vocabulary covers request events, family lifecycle events, fallback events, audit events, and diagnostics. It is intentionally minimal and excludes cosmetic UI events.

Sources are canonical: client orchestrator, server orchestrator, provider adapter, retrieval layer, fallback layer, integrity layer, Commander, diagnostic layer, or replay.

## Ordering And Idempotency

Sequence is explicit and request-scoped. Replay accepts exact duplicate delivery as idempotent and ignores it. A duplicate event ID with conflicting content is rejected. Duplicate sequences with different event IDs, sequence gaps, and out-of-order sequence input stop replay at the failure position.

## Reducer

The reducer is pure. It accepts an initial request-state record and one validated event, returns a new request-state record plus issues, and never mutates inputs. It does not access network, filesystem, database, Supabase, providers, UI, or global process state.

Events map to Phase 47C-1 state:

- `family_dispatched` sets lifecycle and dispatch time
- `family_response_started` sets responding
- `family_response_completed` sets terminal outcome
- timeout/failure/skip/stop/not-reached events set truthful terminal outcomes
- prior-response delivery appends lineage
- fallback completion preserves primary failure truth
- audit declaration/completion sets explicit audit metadata
- `request_cancel_requested` records Commander intent to cancel but does not
  set `cancellation.cancelled` and does not close the request -- selected
  families may still be legitimately winding down
- `request_cancelled` sets canonical cancellation state (`cancelled: true`,
  reason, timestamp) and is the only event that actually closes a request
  via cancellation

## Prior-Response Lineage

Prior-response delivery records source family, target family, source execution ID, target execution ID, delivery order, delivered flag, fingerprint or opaque reference, and omission reason when not delivered. Later reviewing or response claims must have matching delivered lineage.

## Fallback Truthfulness

Fallback events preserve primary family/provider identity, primary outcome, failure category, fallback mechanism, fallback outcome, rendered/substituted status, and whether the Commander was informed. A fallback never converts failed primary execution into an unqualified complete result.

## Audit Scope

Audit events preserve Phase 47C-1 distinctions: complete record, partial record, unknown scope, not audited, synthetic integrity review, and external Red Team review. Complete audit cannot claim full verification while expected family records are missing.

Once `audit_completed` has been applied for a request, no further `audit_scope_declared` or `audit_completed` event may be applied for that request -- replay rejects any re-declaration, downgrade, or unguarded rewrite outright (Phase 47C-2R Correction 2, Option A: prohibit all re-declaration after completion).

**Known limitation, to be resolved before Phase 47C-3 runtime ingestion:**
- Audit re-declaration protection is currently guaranteed **only by `replayCouncilProgressEvents`**, which has visibility across the full ordered event stream via a local, non-persisted `auditCompletedSeen` flag.
- A standalone `reduceCouncilProgressEvent` call, made outside of `replayCouncilProgressEvents`, has no persisted signal to detect a post-completion re-declaration on its own -- `CouncilRequestStateRecord`/`CouncilAuditMetadata` (owned by `lib/council/request-state/types.ts`) carries no "audit already completed" field. **The standalone reducer must not be treated as the live ingestion authority for audit events** until this gap is closed.
- This must be resolved -- either by adding a completion marker to the request-state audit type, or by wrapping any future live/one-event-at-a-time ingestion path so it always routes through `replayCouncilProgressEvents` (or an equivalent full-history-aware check) -- before Phase 47C-3 wires progress events into runtime ingestion.

## Diagnostics

Diagnostics are structured and safe. Unsafe vocabulary -- authorization headers, bearer tokens, access/refresh tokens, API keys, service role/Supabase service keys, cookies, passwords, private keys, raw prompts, chain-of-thought, hidden reasoning, or provider request/response bodies -- is rejected regardless of whether it is joined by spaces, hyphens, underscores, or other punctuation, and regardless of case. A small safe-phrase allowlist (e.g. "cookie policy", "key result", "reasoning category", "prompt version") prevents benign lookalikes from being falsely rejected, while unsafe content elsewhere in the same string is still caught. Detection walks the entire event payload (including `payload.fallback.safeDiagnosticReason`, `payload.audit.notes`, and any nested object or array field) rather than a fixed list of known fields, so no free-text field can bypass the check. The detector is shared with `lib/council/request-state/invariants.ts` (`containsUnsafeSecretText`) so both modules apply identical rules.

## Request Closure

`request_completed` is not accepted merely because one family completed. It must be compatible with the canonical completion summary and selected-family accounting. Cancellation, failure, and timeout events preserve family-level truth instead of erasing unresolved execution.

## Replay

Replay deterministically reduces ordered events into a final request state, returning applied event IDs, ignored exact duplicates, issues, and failure position. It never conceals partial failure.

## Future Integration

Future phases may wire progress events into runtime only after separate review. Required follow-up work includes live event capture, UI projection, transport buffering, persistence decisions, and integration with trace discipline. Phase 47C-2 only provides the inert contract and pure mapping layer.
