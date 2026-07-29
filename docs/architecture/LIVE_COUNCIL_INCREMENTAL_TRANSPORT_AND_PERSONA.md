# Live Council: Incremental Transport and Persona Cluster — Architecture and Governance

## 1. Designation And Status

Documents the current, actually-implemented behavior of the Live Council incremental (SSE)
transport layer and the persona/tone/truthfulness hardening applied on top of the existing
Council request/response pipeline. This is a diagnostics-and-honesty layer over pre-existing,
already-committed Council orchestration (Phase 48-C4C's SSE envelope/reconciliation contract,
Phase 48-C4D's runtime truthfulness pass) — it does not introduce a new provider, a new
persistence store, or a new authority boundary. Where this document's claims differ from an
earlier doc's claims about the same file, this document is authoritative for the state observed
at the commit that introduces it.

## 2. Purpose

Two related changes, audited and hardened together because they touch the same request path and
were developed as one uncommitted diff set:

1. **Transport observability** — `app/api/chat/stream/route.ts` and
   `lib/council/incremental-transport/**` gain diagnostic fields and callbacks
   (`onResponse`/`onChunk`/`onFrame`, `final.status`/`readableContributionCount`/
   `runtimeEventCount`/`completedAt`, SSE `event:`/`id:`/`retry:` field parsing) so a caller can
   observe exactly what the transport actually did, without changing what the transport does.
2. **Persona and truthfulness hardening** — `stabilityMode.ts`, `stableGroupChat.ts`,
   `providerIdentity.ts`, `family-deliberation/runtime.ts`, `compression.ts`, and
   `councilRenderGate.ts`/`providerResponseSanitizer.ts` are adjusted so (a) Stable Group chat can
   no longer bypass truthful greeting-only/degraded-response detection, and (b) family voice reads
   as a person in the room rather than a labeled report, without changing what evidence a family
   is allowed to claim.

## 3. Owned-File Map

Files with real, uncommitted diffs at the start of this audit (HEAD `c78195e`), all attributed to
this cluster:

| File | Nature of change |
|---|---|
| `app/api/chat/stream/route.ts` | Adds `readableContributionCount()`, `finalStatusFor()`; wires 4 new fields into the `final` envelope. |
| `lib/council/incremental-transport/client.ts` | Adds `onResponse`/`onChunk`/`onFrame` diagnostic callbacks. No change to control flow. |
| `lib/council/incremental-transport/sse.ts` | Parses `event:`/`id:`/`retry:` SSE fields; adds `stream_event_name_mismatch` malformed case; adds frame-level diagnostics; tightens `final` envelope shape validation to the 4 new fields. |
| `lib/council/incremental-transport/types.ts` | New diagnostic types; `CouncilStreamFinal` and `CouncilStreamParserEvent`/`CouncilStreamCallbacks` extended to match. |
| `lib/council/incremental-transport/validation.ts` | +3 cases (`c4c_sse_010`–`012`) covering the new SSE field parsing and diagnostics. |
| `lib/council/stabilityMode.ts` | `shouldPassthroughCouncilProviderText()` drops its `councilFlowMode` param — passthrough is now driven solely by the explicit `COUNCIL_STABILITY_MODE` flag, not by Stable Group chat membership. `getStabilityModeFlags()` exempts `liveResearchRouter` from the "heavy systems off" bucket. |
| `lib/council/stableGroupChat.ts` | Rewrites `ROLE_BY_FAMILY`/`FINAL_SYNTHESIS_ROLE` tone; adds anti-repetition guidance and an optional `researchBlock` param to the user prompt builder. |
| `lib/council/compression.ts` | Adds `NO_RELIABLE_SYNTHESIS_MESSAGE`; `fallbackDecision()` no longer silently returns a generic "waiting" message when real (but all-unusable) responses exist — it says synthesis was attempted and failed. |
| `lib/council/councilRenderGate.ts` | Calls the new zero-param `shouldPassthroughCouncilProviderText()`. |
| `lib/council/providerResponseSanitizer.ts` | Same zero-param call-site update. |
| `lib/council/providerIdentity.ts` | Rewrites the 6 `PROVIDER_IDENTITY_PROFILES` strings toward a more natural, less report-like voice. Still enforced under 250 characters each. |
| `lib/council/family-deliberation/runtime.ts` | Rewrites `roleInstruction()`'s 5 role-prompt strings to stop instructing message-ID citation and labeled sections (`confidence:`, `recommended action:`), and to talk like a person in the room. |
| `lib/council/unified-experience/adapter.ts` | `briefingFromText()` no longer says the uninformative `'Not yet available.'` when no final briefing exists — states plainly that no `final_synthesis`/`commander_briefing` message was emitted, and that nothing is fabricated in its place. |
| `components/council/CouncilOperationTimeline.tsx` | Moves the raw runtime-event `<ol>` (previously always visible) into a collapsed `<details>` "View runtime event timeline", positioned after the Commander Briefing section instead of before it. |
| `components/war-room/live-room/CommandConsole.tsx` | Copy: `'Council responding…'` → `'Council thinking…'`; `'Working…'` → `'Council thinking…'`. |
| `components/war-room/live-room/LiveRoomCenter.tsx` | Bottom padding changed from `py-2` to `pt-2 pb-[calc(...+1rem)]` so the last message isn't flush against the reserved command-console area. |
| `components/war-room/runtime/PanelErrorBoundary.tsx` | `componentDidCatch` now also fire-and-forget POSTs to `/api/native-builder/issues` (`kind: 'panel_error_boundary'`) so a render crash becomes a fingerprinted, deduplicated Native Builder issue instead of a console-only event. Failure of that POST is swallowed — never surfaces as a second panel error. |

`app/page.tsx` is explicitly **not** part of this owned-file map. It contains 15 hunks belonging to
this cluster interleaved with already-committed Phase 48-C4D/49-A hunks and 1 genuinely-mixed
hunk; per prior Commander instruction it is deliberately held back and will be split with a
manual patch once this cluster's own files are committed. `lib/council/incremental-transport/
reconcile.ts` is read and documented below (ordering/duplicate-suppression) but carries no diff —
it is pre-existing, already-committed behavior, not owned by this commit.

## 4. Transport Architecture

`app/api/chat/stream/route.ts` (`createCouncilStreamPostHandler`) is the sole SSE producer. It
wraps one injected `CouncilStreamExecutor`, emits `opened` immediately, streams `progress` frames
as the executor's progress observer fires, and emits exactly one terminal frame — `final` on
success or `error` on failure — followed by `closed`. `lib/council/incremental-transport/client.ts`
(`postIncrementalCouncilChat`) is the sole browser-side consumer, used from `app/page.tsx`.

Envelope contract (`lib/council/incremental-transport/types.ts`): every envelope carries
`version` (`COUNCIL_STREAM_VERSION`, currently `'48c4c.council-stream.v1'`), `envelopeType` (one
of `opened | progress | final | error | closed`), `requestId`, `operationId`, a monotonic integer
`sequence`, and `emittedAt`. `final` now additionally requires `status` (`completed | partial |
failed`), `readableContributionCount` (number), `runtimeEventCount` (number), and `completedAt`
(non-empty string) — these are computed server-side in `route.ts` from the same `CouncilChatJson`
already being returned, not derived from anything new.

## 5. Streaming Behavior And Event Ordering

Frames are delimited on a blank line (`\r?\n\r?\n`) by `createCouncilSseParser` in `sse.ts`, which
now also parses `event:`, `id:`, and `retry:` fields per the SSE spec (previously only `data:` was
read). A named `event:` field is cross-checked against the envelope's own `envelopeType`; a
mismatch is rejected as `stream_event_name_mismatch` rather than silently trusted. Every parsed
(or rejected) frame produces one `CouncilStreamFrameDiagnostic` via the new `onFrame` callback —
purely observational, it does not gate parsing.

Ordering and duplicate suppression are enforced by `reconcile.ts` (unchanged, pre-existing):
`opened` may arrive once, `progress` any number of times (deduped by `progressEvent.eventId`),
`final` exactly once (`duplicate_final_envelope` is a hard transport error, not silently ignored),
`closed` exactly once. A `requestId`/`operationId` mismatch mid-stream is treated as
`operation_identity_mismatch` and rejected — the client never merges frames from two different
operations. `closed` arriving without a prior `final` (other than the
`validation_failed_before_execution` terminal state) marks the reconciliation state `stale`,
surfaced to the caller as `closed_without_final_state_uncertain` rather than treated as success.

## 6. Partial-Response, Retry, Timeout, And Cancellation Behavior

- **Partial response**: `final.status` can be `'partial'` — computed by `finalStatusFor()` in
  `route.ts` from whether the underlying `CouncilChatJson` response was `ok` and whether any
  readable contribution exists. The client does not synthesize partial success on its own; it only
  reports what the server's `final` envelope said.
- **Retry**: none exists at the transport layer. `postIncrementalCouncilChat` makes exactly one
  `fetch('/api/chat/stream')` call and returns whatever that single attempt produced (a `final`
  envelope, an `error` envelope, or — if the stream ends with neither — a synthesized
  `stream_ended_without_final` transport error). Retrying, if desired, is entirely the caller's
  responsibility.
- **Timeout**: no client-side timeout/AbortController is created internally by this transport; the
  caller supplies `options.signal`. There is no server-side idle timeout on the SSE response body
  in `route.ts` beyond whatever the platform/hosting layer enforces.
- **Cancellation**: `options.signal.aborted` is checked once, after the read loop ends, to decide
  whether a missing `final` should be reported as `stream_ended_without_final` (skipped when the
  signal was aborted, since abort is an intentional, non-erroneous termination). The `abortSignalState`
  field on each `onChunk` diagnostic (`'aborted' | 'active' | 'none'`) is purely observational.

## 7. Duplicate Suppression

Covered by §5/`reconcile.ts`. Additionally, at the SSE-frame level, `createCouncilSseParser`
tracks nothing across frames itself (it is a pure per-frame parser); all cross-frame duplicate
logic lives in `reconcile.ts`'s `seenSequences`/`progressEventIds`/`finalDelivered` state, which is
per-call (`createCouncilStreamReconciliationState()`), never shared across concurrent requests.

## 8. Provider Identity Truthfulness

`lib/council/providerIdentity.ts`'s `PROVIDER_IDENTITY_PROFILES` describe each family's voice
(chatgpt/claude/grok/gemini/kimi/red_team) in under 250 characters each — unchanged constraint,
reworded content. These are prompt-construction inputs only; they do not change which provider a
family label maps to, and they carry forward existing "no pretend searches / say telemetry gap"
and "no pretend progress" honesty instructions verbatim for `grok` and `kimi`.

## 9. Sanitization

`lib/council/providerResponseSanitizer.ts`'s `sanitizeCouncilFamilyResponse()` and
`lib/council/incremental-transport/sse.ts`'s `sanitizeCouncilStreamError()` are two independent
sanitizers with two independent purposes: the former decides what raw provider text is safe to
render as a family's displayed response (integrity/degraded detection, passthrough gate); the
latter redacts secret-like/filesystem-like/internal-prompt-like substrings out of **transport**
error messages before they reach the browser. Only the former's passthrough gate changed in this
diff (see §11); the error sanitizer's redaction patterns are untouched.

## 10. Compression

`lib/council/compression.ts`'s `fallbackDecision()` is reached only when no message is "synthesis
eligible" (i.e., no family produced a usable response this round). Previously, if any responses
existed but all were incomplete, it announced which families were incomplete and said the Council
was "awaiting fallback or retry" — implying more was coming even when the round was simply
over. It now uses the new `NO_RELIABLE_SYNTHESIS_MESSAGE` constant and states plainly that
synthesis was attempted and could not be produced, still naming which families didn't return a
usable response. When there were no responses at all (nothing attempted yet), the original
`'Council is waiting for a new decree or provider response.'` message is unchanged.

## 11. Stability Mode

`isCouncilStabilityMode()` reads `COUNCIL_STABILITY_MODE` from env (`'true'` or `'1'`) — unchanged.
`isMinimalCouncilSystemsPath(councilFlowMode)` — unchanged: still true for either the explicit env
flag or Stable Group chat mode, and still gates the "heavy" systems list (memory injection, RSS
federation, opportunity scanning, baby observer, autonomous gather, packet classification,
synthesis compression, response governor, OS sweep/research team).

What changed is narrower and more consequential: **`shouldPassthroughCouncilProviderText()`** used
to take an optional `councilFlowMode` and return `isMinimalCouncilSystemsPath(councilFlowMode)` —
meaning Stable Group chat, not just the explicit debug flag, bypassed truthful greeting-only/
degraded-response detection in `councilRenderGate.ts` and `providerResponseSanitizer.ts`. It is now
zero-parameter and returns `isCouncilStabilityMode()` only. Practical effect: a Stable Group family
bubble that returns a greeting-only or degraded provider response now gets the same truthful
integrity treatment as every other flow; only the explicit `COUNCIL_STABILITY_MODE=true` debug/
circuit-breaker flag still gets raw passthrough. Separately, `getStabilityModeFlags()` now always
sets `liveResearchRouter: !isCouncilStabilityMode()` regardless of Stable Group membership — live
research grounding is treated as a truthfulness requirement, not an optional "heavy" enrichment, so
Stable Group decrees still get real research even with everything else in the minimal-systems
bucket turned off.

## 12. Group-Chat And Persona Behavior

`lib/council/stableGroupChat.ts`'s `buildStableGroupSystemPrompt` gained explicit guidance not to
repeat prior points or always open the same way, and to be honest about whether a claim is
grounded in the (optional) `researchBlock` now threaded through `buildStableGroupUserPrompt`. Role
voice (`ROLE_BY_FAMILY`, `FINAL_SYNTHESIS_ROLE`) was reworded toward a "family member speaking,"
not "a report" — kimi's role string is unchanged. `family-deliberation/runtime.ts`'s
`roleInstruction()` mirrors the same shift for the 4-role family-deliberation flow (opening
position, direct response, red-team challenge, revision-or-stand-firm, synthesis): all 4
non-synthesis roles previously instructed citing prior turns "by message_id" and structuring the
reply with labeled sections (`confidence:`, `recommended action:`); all 5 role strings now
instruct talking in plain language, addressing prior positions by family name rather than by
message ID, and explicitly forbid labeled sections. None of this changes what evidence a family is
allowed to cite or what the Red Team is required to challenge — only how it is asked to phrase it.

## 13. Family Deliberation Behavior

Unchanged beyond §12's prompt wording: `family-deliberation/runtime.ts` still runs the same 4-turn
role sequence (opening → direct response → red-team challenge → revision-or-stand-firm) followed by
synthesis, still formats prior turns via `formatPriorTurnsBlock`, still exposes
`formatDeliberationTurnForChat` for rendering. No new turn type, no new persistence, no new
provider call was added.

## 14. Rendering Gates

`applyCouncilRenderGate()` in `councilRenderGate.ts` is unchanged except for the same zero-param
`shouldPassthroughCouncilProviderText()` call site described in §11 — its `promptIntent`/
`relaxedCasual` detection, family-specific display logic, and the `opts?.stabilityMode` explicit
override (still honored ahead of the env-derived default) are untouched.

`components/council/CouncilOperationTimeline.tsx` moves the raw runtime-event list behind a
collapsed `<details>` element titled "View runtime event timeline," placed after the Commander
Briefing section (previously the event list rendered unconditionally above the briefing). The
"Operation running…"/"Awaiting approval…" status banners now render between the briefing and the
collapsed timeline rather than above the (now-hidden) event list. This is a presentation-order and
default-visibility change only — no event data is dropped, filtered, or delayed.

## 15. Error Boundaries

`components/war-room/runtime/PanelErrorBoundary.tsx`'s `componentDidCatch` already logged to
`console.error` and to an existing diagnostic sink (unchanged). It now additionally issues a
fire-and-forget `fetch('/api/native-builder/issues', { method: 'POST', body: { kind:
'panel_error_boundary', panelLabel, errorMessage, componentStack } })`. The POST's own failure is
caught and discarded — a broken issue-reporting call can never itself trigger a second panel error
or block rendering of the boundary's fallback UI. This is a genuine new coupling between the Live
Council UI and the Native Builder issue pipeline (see §20 for the authority analysis and a
discovered, out-of-scope gap in that pipeline's own validation).

## 16. Authentication Requirements

No change. `app/api/chat/stream/route.ts` uses whatever session/auth check
`createCouncilStreamPostHandler`'s injected executor already enforces — this cluster added no new
route and no new auth check. `POST /api/native-builder/issues` (now called from
`PanelErrorBoundary`) has no additional auth beyond whatever Native Builder's existing route-level
auth already provides — unchanged by this diff, see NATIVE_BUILDER_ARCHITECTURE_AND_GOVERNANCE.md
§7 for that route's actual auth posture.

## 17. Authorization Requirements

No Commander-approval-gated action exists anywhere in this cluster's own files. Filing an issue via
`/api/native-builder/issues` with `kind: 'panel_error_boundary'` only creates or merges an issue
record and opens a repair record in state `collecting_evidence`
(`lib/native-builder/runtime.ts`'s `reportIssue`/`createRepairForIssue`) — it does not apply a
patch, does not roll anything back, and does not enter any state that Native Builder's own
Commander-approval gates (`/resolve`, live research) would need to check. No new authorization
boundary was required or added.

## 18. Provider Boundaries

None of this cluster's changed files call an LLM provider directly. `stableGroupChat.ts` and
`family-deliberation/runtime.ts` build prompt strings consumed elsewhere in the existing Council
pipeline; `compression.ts`, `providerIdentity.ts`, `providerResponseSanitizer.ts`,
`councilRenderGate.ts` are pure text transforms; the transport files move already-produced bytes.

## 19. Persistence Boundaries

None of this cluster's changed files perform filesystem, database, or Supabase I/O. The one
network call introduced (`PanelErrorBoundary.tsx`'s POST to `/api/native-builder/issues`) is a
client-side `fetch` to an existing, already-governed Native Builder route — not a new persistence
mechanism owned by this cluster.

## 20. Failure States

- **Malformed provider payload / malformed SSE frame**: rejected by `parseSseFrame` as
  `malformed_stream_json` or `malformed_stream_envelope`; now also `stream_event_name_mismatch`
  when a named SSE `event:` field disagrees with the envelope's own type. All three are terminal,
  `classification: 'transport'` errors surfaced via `onMalformedEnvelope`.
- **Empty / all-incomplete responses**: `compression.ts`'s `fallbackDecision()` — see §10.
- **Provider failure mid-stream**: surfaced as an `error` envelope from the route, or (if the
  stream simply ends without one) synthesized client-side as `stream_ended_without_final`.
- **Duplicate final**: hard transport error (`duplicate_final_envelope`), not silently ignored.
- **Panel render crash**: caught by `PanelErrorBoundary`, logged, now also filed as a Native
  Builder issue on a best-effort basis (§15).
- **Discovered, out-of-scope gap**: `lib/native-builder/storage.ts` has no validation-storage-root
  isolation mechanism analogous to `lib/sovereign-model-lab/storage.ts`'s (added in commit
  `c78195e`). `nativeBuilder.validation.ts`'s existing route-level test cases, to the extent they
  invoke real Native Builder routes, may be reading/writing the same `.war-room/native-builder/`
  directory real usage would occupy. This was **not** touched by this cluster's changes and is
  outside Stage 5's authorized scope; it is recorded here because it is the same class of risk the
  Commander previously halted a commit over for Sovereign Model Lab, and is exactly why this
  cluster's own new validator (§23) avoids invoking that route directly — see §23.

## 21. Production Rollout Behavior

Nothing in this cluster is behind a new feature flag. `COUNCIL_STABILITY_MODE` (pre-existing env
var) continues to be the only flag governing passthrough behavior, now scoped correctly per §11.
No new env var was introduced by this diff.

## 22. Known Limitations

- No server-side idle/keepalive timeout is implemented for the SSE response in `route.ts` beyond
  whatever the hosting platform enforces; a hung upstream executor with no progress events would
  leave the client waiting indefinitely (bounded only by the caller's own `AbortSignal`, if any).
- The `onResponse`/`onChunk`/`onFrame` diagnostics are opt-in callbacks with no default consumer in
  this diff; they exist to be wired into telemetry, not to change transport behavior.
- The Native Builder issue-pipeline coupling (§15, §20) inherits whatever limitations that pipeline
  already has, including the storage-isolation gap noted in §20.

## 23. Deterministic Validation Requirements

Two validators are in scope for this cluster, run together:

1. **`scripts/run-incremental-council-transport-validation.mjs`** (pre-existing, unchanged
   invocation path; +3 new cases `c4c_sse_010`–`012` in this diff covering named-final-event
   acceptance, event/type mismatch rejection, and frame-diagnostic shape) — covers envelope
   contract, SSE parsing, reconciliation/ordering/duplicate-suppression, client parsing, route
   wiring (auth-equivalent 401, execution-once, opened→progress→final→closed ordering, abort
   cleanup, no stack/secret leakage, no fallback-after-ambiguous-failure, per-request isolation),
   and error sanitization.
2. **`scripts/run-live-council-persona-cluster-validation.mjs`** (new, added by this cluster) —
   covers what §1 does not: stability-mode passthrough truthfulness (env-driven, not
   `councilFlowMode`-driven), compression fallback-message honesty, persona/role-instruction
   content (pinned, no message-ID citation or labeled-section instructions, all under the 250-char
   identity-profile budget), the render-gate/sanitizer zero-param call-site update, UI copy
   changes (`CommandConsole`, `CouncilOperationTimeline` disclosure default), and the
   `PanelErrorBoundary → issueFromPanelErrorBoundary` mapping tested as a pure function (deliberately
   **not** invoking the live `/api/native-builder/issues` route, per §20's discovered gap — this
   validator does not create real Native Builder issue/repair records).

Both are plain Node scripts using this repo's established `{caseId, category, result, details}`
pattern; no test framework, no mocking library. `tsc --noEmit`, `eslint` (owned files), and
`pnpm run build` are additionally required before commit; `git diff --check` for whitespace.

## 24. Completion Criteria

- Both validators above at 100% pass.
- `tsc --noEmit` clean.
- `eslint` clean on every file in §3's owned-file map plus the new validator/doc.
- `pnpm run build` succeeds.
- `git diff --check` clean (no whitespace errors) on the exact staged file set.
- No secret values, no machine-local absolute paths in any file staged.
- `app/page.tsx` remains untouched by this commit.
