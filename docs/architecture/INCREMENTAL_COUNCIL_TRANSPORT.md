# Incremental Council Transport

Phase 48-C4C adds browser-visible delivery for already-authoritative Council progress events. It does not create Council truth, change provider selection, alter prompts, modify synthesis, write memory, add persistence, or change approval authority.

## Existing Request Path

The canonical JSON route remains `POST /api/chat`. Its public route file delegates to `executeCouncilChatRequest()` in `app/api/chat/execute.ts`, preserving the prior semantic response shape. That execution function is the single provider-dispatch implementation for both JSON and streaming callers.

## Streaming Path

`POST /api/chat/stream` accepts the same chat request body and calls `executeCouncilChatRequest()` exactly once. It passes a request-scoped progress observer into the existing Council progress runtime. The route emits Server-Sent Events:

- `opened`
- `progress`
- `final`
- `error`
- `closed`

SSE is transport only. It does not add polling, WebSockets, background jobs, storage, global broadcasters, or cross-request subscriptions.

## Authoritative Event Source

The source of truth is `createCouncilProgressRuntimeTracker()` in `lib/council/progress-events/runtime.ts`. The observer is invoked only after an event has been accepted by replay and committed to the runtime tracker. Observer failures are swallowed so transport cannot change Council execution.

Runtime event creation, event transport, and timeline projection are separate:

- Runtime event creation: progress runtime records accepted `CouncilProgressEventEnvelope` values.
- Event transport: `/api/chat/stream` wraps accepted events in versioned SSE envelopes.
- Timeline projection: the browser reconciles progress snapshots through the existing C4B operation timeline.

## Envelope Contract

All envelopes use `version: "48c4c.council-stream.v1"` and include `envelopeType`, `requestId`, `operationId`, `sequence`, and `emittedAt`.

`progress` envelopes carry the authoritative progress event plus the current authoritative snapshot. They do not reconstruct transcript content or infer provider states.

`final` envelopes carry the final `/api/chat` semantic payload, final HTTP status, and final progress snapshot when available.

`error` envelopes carry sanitized structured errors with no stack traces, tokens, cookies, provider keys, or service-role values.

`closed` envelopes describe transport closure. Transport closure does not equal operation completion.

## Request Identity And Ordering

The stream opens with the first authoritative progress request ID when runtime progress exists. If a request fails before progress begins, the stream uses a transport ID and emits a validation or transport error. Transport sequence numbers are independent from progress-event sequence numbers and preserve SSE frame order.

The client reconciliation state rejects request/operation identity mismatches, duplicate final envelopes, and stale updates after close. Duplicate progress events are ignored by event ID.

## Cancellation

The browser uses `AbortController`. Client abort cleans up the parser and stops UI callbacks. Server-side disconnect emits `client_disconnected` when observable, but it does not claim that provider execution stopped. Client disconnection does not prove provider cancellation.

## Fallback Boundary

The client may fall back to `POST /api/chat` only when the streaming endpoint is unavailable before execution starts, such as a non-SSE response. Once any stream frame beyond establishment is received, retry is unsafe because provider execution may already have begun. Ambiguous stream interruption surfaces as a transport error instead of retrying.

## Request-Kind Coverage

- Ordinary Commander question: streaming supported when routed through `/api/chat/stream`; authoritative progress source is the progress runtime; final source is the shared execution response.
- Direct family invocation: streaming supported; source is the direct runtime tracker.
- Stable Group: per-family calls can stream their own runtime snapshots; one cross-family stream remains future work.
- Full Council: streaming supported for server parallel provider path.
- Decree: streaming supported for calls that use the shared chat helper; unsupported branches retain final snapshot fallback.
- Status check: streaming only if `/api/chat` emits progress; otherwise final snapshot fallback.
- Troubleshooting: streaming only when routed through `/api/chat`; repair-specific routes are not streamed.
- Research request: research-specific routes remain unsupported; `/api/chat` research branches can return final snapshots.
- Project packet: unsupported unless created through `/api/chat` progress runtime.
- Approval review: unsupported unless routed through `/api/chat` progress runtime.

## Security

There is no public global event bus, no cross-user subscription by request ID, no cache-sharing expansion, no CORS expansion, and no debug transport enabled by default. Stream frames are generated only inside the active request.

## C4B Versus C4C

C4B projects final authoritative runtime snapshots after the JSON response. C4C transports accepted runtime events incrementally before the final response arrives. Both use the same timeline projection and neither fabricates provider thinking, typing, pacing, or completion.

## Remaining Limitations

- Server-side provider cancellation is not guaranteed by browser disconnect.
- Some UI paths still issue per-family requests; those stream per request rather than as a single cross-family operation.
- Unsupported routes continue to rely on final-response snapshot projection.
- Manual runtime proofs require an authenticated browser session and were not performed by this build-only pass.
