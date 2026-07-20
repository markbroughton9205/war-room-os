# Live Council Operation Timeline

Phase 48-C4B connects the C4A Commander operation timeline to the existing Council progress-event runtime. It is a presentation and event-consumption layer only.

## Purpose

C4A can reconstruct an ordered Council activity record after response messages exist. C4B adds a final-response authoritative snapshot projection when `/api/chat` returns a `councilProgress` snapshot. The UI may then reconcile runtime-originated events with the completed transcript without replacing or fabricating either record.

Current transport is not incremental browser streaming. `authoritative_runtime_snapshot` means the timeline data originated from the runtime progress system, not that the browser watched each event arrive before the response resolved.

C4B does not simulate Council deliberation.

C4B only displays runtime activity that the system can prove occurred.

## Runtime Source Of Truth Map

| Displayed event | Authoritative runtime source | Exact source field/type | Fallback behavior | Live delivery currently exists |
| --- | --- | --- | --- | --- |
| Request received | Council progress snapshot | `CouncilProgressEventEnvelope.eventType === "request_created"` | C4A completed transcript emits reconstructed `request_received` | Returned final-response snapshot only |
| Request interpreted | Completed transcript adapter | Structured message/request metadata | Omit if unavailable | No |
| Council mode selected | Council progress snapshot | `eventType === "request_started"` plus `state.flowMode` | Omit unsupported detail | Returned final-response snapshot only |
| Families assigned | Council progress snapshot | `eventType === "request_selection_resolved"`, `payload.selectedFamilies` | Omit if no selection event | Returned final-response snapshot only |
| Family assigned/queued | Council progress snapshot | `family_waiting`, `family_queued` | Omit if unavailable | Returned final-response snapshot only |
| Family started | Council progress snapshot | `family_dispatched`, `family_response_started` | Omit if no start evidence | Returned final-response snapshot only |
| Family responded | Council progress snapshot or completed transcript | `family_response_completed` or actual visible provider output | Completed transcript fallback | Returned snapshot plus transcript |
| Family failed | Council progress snapshot | `family_failed` | Omit if only prose says failed | Returned final-response snapshot only |
| Family timed out | Council progress snapshot | `family_timed_out` | Omit if unsupported | Returned final-response snapshot only |
| Family unavailable | Council progress snapshot | `family_not_reached` | Omit if only prose says unavailable | Returned final-response snapshot only |
| Family skipped | Council progress snapshot | `family_skipped_by_policy`, `family_stopped_by_commander` | Omit if unsupported | Returned final-response snapshot only |
| Synthesis started | Future structured source | No current universal event | Omit | No |
| Synthesis completed | Completed transcript structured finality | C4A finality flags, final message types, or deliberation synthesis role | Omit if finality is not structured | Transcript only |
| Approval required | Project/approval packet state | `ProjectOrchestrationPacket.approvalPacket` or approval state | Packet fallback | No progress-event source yet |
| Operation completed | Council progress snapshot or terminal transcript metadata | `request_completed` or C4A terminal flags | Omit if no terminal truth | Returned snapshot plus transcript |
| Operation failed | Council progress snapshot | `request_failed`, `request_timed_out` | Omit if unsupported | Returned final-response snapshot only |
| Operation cancelled | Council progress snapshot | `request_cancelled` | Omit if unsupported | Returned final-response snapshot only |

## Operation Identity

The preferred operation identity is the runtime request identity:

1. `councilProgress.logicalRequestId`
2. `councilProgress.requestId`
3. completed transcript `requestId`
4. project packet ID

Array index, family name, rendered count, and content hash are not valid operation identities.

## Reconciliation Rules

`buildCommanderOperationFromProgressSnapshot()` projects progress events into `CommanderOperation` cards.

`reconcileCommanderOperation()` adds one runtime event idempotently.

`mergeCommanderOperationWithCompletedTranscript()` merges a completed transcript into an active runtime operation only when request identity is compatible. It preserves live events, adds final transcript truth once, and does not replace the timeline.

## Ordering Rules

Ordering uses:

1. progress event `sequence`
2. progress event `occurredAt`
3. deterministic event ID fallback

No artificial delay, provider pacing, dramatic ordering, or `setTimeout` simulation is used by the reconciliation layer.

## Deduplication Rules

Duplicate runtime event IDs render once. Duplicate semantic events from the same family/request render once. Same event type from different families remains separate. Retry attempts remain separate when runtime identity differs.

Duplicate request-completion source events for the same operation reconcile to one visible terminal event. The authoritative mechanism is terminal-event reconciliation after deterministic ordering: the first terminal operation event wins, later terminal events for the same operation are suppressed, and earlier family events remain intact.

## Monotonic State Rules

Completed, failed, and cancelled states do not regress to running. Responded does not regress to queued. A late earlier event may be inserted in sequence order without changing its truth.

## Family Truth Boundaries

Started requires `family_dispatched` or `family_response_started`. Responded requires `family_response_completed` or actual visible provider output. Failed, timed out, unavailable, and skipped require structured runtime status. Provider prose is never parsed for execution status.

Control/system remains runtime identity, not a Council family.

The Control identity is always treated as system identity. It must never render as ChatGPT, Claude, Grok, Gemini, Kimi, Red Team, Baby AI, or Bridge Architect.

## Synthesis Truth Boundary

Synthesis is never inferred from ChatGPT authorship, final-looking prose, message position, response length, or UI completion. It appears only from structured finality evidence already validated by C4A.

## Completion Truth Boundary

Completion requires `request_completed`, `request_failed`, `request_timed_out`, `request_cancelled`, or structured terminal transcript metadata. Rendered event count never completes an operation.

## Request Isolation

Separate `requestId`/`logicalRequestId` values are separate operations. Final response B cannot attach to request A when authoritative IDs differ.

## Fallback Behavior

Where live events are unavailable, the UI uses the C4A completed-transcript fallback and labels it as reconstructed. Partial runtime snapshots may be reconciled with completed transcript data once.
Commander-facing language must not imply real-time delivery. Fixed labels use wording such as `Runtime event record`, `Runtime record reconciled with completed response`, `Completed operation record`, and `Project operation record`.

## Copy Behavior

Running operations copy only currently available events and do not include a final briefing. Completed operations include the reconciled timeline and exactly one authoritative final briefing when present. Clipboard success remains promise-gated.

## Accessibility Behavior

The timeline remains a semantic section with a list of event cards. Running updates use polite `aria-live`; copy confirmation remains screen-reader visible. Disclosures remain keyboard accessible. The UI does not steal focus when new events appear.

## Mobile And Performance

Cards wrap long text, raw JSON stays in a collapsed scrollable disclosure, event keys are stable IDs, and reconciliation dedupes events before rendering.

## Unsupported Live Paths

Current `/api/chat` returns a final JSON payload with `councilProgress`. It does not stream each progress event to the browser before the response resolves. Research routes, project packet routes, approval routes, and repair packet routes do not yet expose universal progress-event streams to this timeline.

## Execution Isolation Boundary

C4B does not alter provider selection, provider routing, dispatch, prompts, adaptive assembly, synthesis execution, progress accounting, request closure, approval authority, memory, persistence, SQL, Supabase, or deployment behavior.

## Remaining Limitations

- True browser-visible incremental delivery requires a future transport phase.
- `synthesis_started` has no universal source event yet.
- Some paths remain reconstructed because their routes do not emit Council progress snapshots.
- The timeline consumes runtime snapshots; it does not create or persist progress events.
- Provider prose is excluded from transport-honesty scanning. A provider may discuss real-time systems or other domain language without changing timeline transport truth.

## C4A Versus C4B

C4A owns truthful completed-transcript projection.

C4B owns authoritative runtime-event projection and reconciliation with C4A output when a runtime snapshot exists.
