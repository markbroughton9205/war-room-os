# Phase 48-C4D: Council Runtime Truthfulness & Response Integrity Hardening

Phase 48-C4D closes and documents runtime hardening already implemented on top of Phase 48-C3A, 48-C4A, 48-C4B, and 48-C4C. It is documentation, validation packaging, targeted stabilization, and runtime-truth verification. It is not a new architecture rewrite, and it does not authorize any deployment, Supabase execution, or production change.

## 1. Phase Designation And Status

Phase: 48-C4D. Status: implemented and runtime-active in the working tree at the time this document was written; not yet committed. All six in-scope validation suites pass (66/66 checks) via `npm run validate:phase48-c4d`. Phase 48-DB-A and the Operator self-repair storage recursion fix are explicitly out of scope for this document (see sections 21 and 22).

## 2. Purpose

Phase 48-C3A through 48-C4C made Council family deliberation, the Commander operation timeline, and incremental transport authoritative and truthful at the event level. This phase hardens the layer directly above that: what the Commander actually reads and sees per family during and after a Council round — which family said what, which family has an issue and why, whether stale conversational context leaks into a new decree, and whether a single incomplete provider response ever gets silently promoted to normal, or silently discarded.

## 3. Problem Statement

Six adjacent but independent defects existed in the live Council surface prior to this hardening:

1. The attendance hard-close reveal path could theoretically double-release a family or drop a family that arrived late with real content.
2. Stable Group's "last two family replies" context carried forward verbatim regardless of whether the Commander's decree changed topic, letting a stale unrelated thread leak into a new response.
3. There was no single Commander-facing status vocabulary distinguishing "never called this round" from "called and failed" from "called and degraded" — code calling sites each had to interpret raw runtime enums themselves.
4. Response text extraction from a Council payload had no single, tested precedence order across `councilSingleResponse`, `results[].content`, and `familyDeliberation.turns`, risking system/integrity-flag rows being read as real answers.
5. `stripForbiddenScopeLines` could reduce an entire genuine reply to nothing when the reply's only forbidden-topic content was one incidental disclaiming line (e.g. "no Panama analysis needed" inside an otherwise on-topic greeting).
6. Provider retry/fallback logic existed but had no verified upper bound on how many real provider calls a single incomplete response could trigger, and no proof that a fallback family's content was always honestly attributed rather than rendered as if the original family had said it.

## 4. Runtime Architecture

This phase does not introduce a new pipeline stage. Each capability is a small, single-responsibility pure function (or, for retry orchestration, a bounded async orchestrator) called directly from the two existing hot paths that already own Council request/response handling:

- `app/api/chat/execute.ts` — server-side request execution (`executeCouncilChatRequest()`), the single provider-dispatch implementation shared by `/api/chat` and `/api/chat/stream` (per Phase 48-C4C).
- `app/page.tsx` — client-side Live Council rendering, attendance handling, and family-status derivation.

No new route, no new table, no new persisted field, and no new background worker is introduced.

## 5. File Ownership

| File | Owns |
| --- | --- |
| `lib/council/attendanceRelease.ts` | Building the late-reveal batch after attendance hard-close |
| `lib/council/contextRelevance.ts` | Keyword-overlap decree-relevance gate for prior-turn context |
| `lib/council/familyOperationStatus.ts` | Raw runtime → Commander-facing status mapping, issue banner, response-progress count |
| `lib/council/liveResponseExtraction.ts` | Extracting readable response text/contributions from a Council payload |
| `lib/council/intentScope.ts` | Forbidden-topic line stripping (host file; this phase only changes the fallback behavior) |
| `lib/providers/retryOrchestration.ts` | Integrity-gated retry and cross-family fallback for a single provider call |
| `lib/council/attendanceReadiness.ts` | Pre-existing source of truth for which raw runtime outcomes are "actionable" (unchanged by this phase; read for the status-sync regression in section 8) |
| `lib/council/renderPacket.ts` | Carries the optional `directedFamilies` field on `CouncilRenderPacket` — the honest denominator for family-operation-status response-progress counts (this phase only adds this field; no other change) |
| `components/war-room/live-room/CouncilMembersPanel.tsx` | UI consumer of the projected per-family operation status |

Each capability file (except `intentScope.ts`) has a co-located `*.validation.ts` and a standalone `scripts/run-*-validation.mjs` runner, preserved unchanged by this phase alongside the new aggregate runner (section 9).

## 6. Attendance Release Behavior

`buildAttendanceLateLines(cells, alreadyRevealedFamilies, buildFallbackLine)` iterates the packet's directed family order once. A family already present in `alreadyRevealedFamilies` (the soft-cap batch) is skipped outright — never re-emitted. A family not yet revealed is released exactly once: with its real late-arriving text if it produced any, or an honest fallback line (`DEGRADED` / `FAILED` / `UNAVAILABLE`) if it did not. No family can appear twice across the soft-cap and late-release batches, and no family's absence is ever filled with fabricated content. Called from `app/page.tsx`'s attendance hard-close handler, feeding `releaseAttendancePacket`.

## 7. Context Relevance Behavior

`isPriorContextDecreeRelevant(decreeText, candidateText)` is a bounded keyword-overlap check, not a semantic classifier. It is deliberately permissive: empty inputs, short/low-information decrees (≤3 significant words), and explicit continuation language (`continue`, `following up`, `as we discussed`, etc.) always keep prior context. Only a substantive decree with zero significant-word overlap against the candidate text is treated as stale and dropped. `filterDecreeRelevantPriorReplies` applies this per-reply, preserving order. Called unconditionally (no stability-mode gate) from `app/api/chat/execute.ts` before building both the Stable Group prior-context block and the per-turn user prompt.

## 8. Family Operation-Status Behavior

`mapFamilyOperationStatus()` maps the canonical per-family runtime outcome (`ProviderFamilyOutcomeStatus`, already produced by the gather pipeline) to one of ten Commander-facing statuses (`ready`, `queued`, `thinking`, `responded`, `degraded`, `provider_error`, `timed_out`, `empty_response`, `unavailable`, `not_called`). It never infers a status from provider connectivity (whether an API key is configured) — that remains a separate concern (`providerHealth`). A family with no runtime entry maps to `not_called` only once `operationConcluded` is true; while the operation is still running, an absent entry maps to `thinking` or `queued`, never to a terminal/error state. `projectFamilyOperationStatuses()` is a pure function of its arguments only (no message history, no shared mutable state), so a fresh operation can never inherit the prior round's failures — proven by `family_op_17`.

`ISSUE_STATUSES` (now exported — the only production code change from Step 3, see below) is the subset of the ten statuses that `buildProviderIssueBanner()` treats as worth reporting. It must stay in agreement with `isActionableProviderRuntime()`/`packetHasActionableProviderIssues()` in `attendanceReadiness.ts`, which independently decide whether the provider-issue banner shows at all. `familyOperationStatus.validation.ts` now proves this agreement exhaustively (`status_sync_01` through `status_sync_04`, section 8's implementation) rather than relying on the two files staying manually synchronized. Called from `app/page.tsx`, feeding `<CouncilMembersPanel operationStatuses={...}>`, which resolves each roster member's status through `FAMILY_OPERATION_STATUS_PRESENTATION` for its badge tone.

## 9. Response Extraction Behavior

`extractReadableCouncilResponse()` resolves one readable response per turn using a fixed precedence: (1) `councilSingleResponse` if it has ≥5 usable characters — the final-synthesis field always wins when present; (2) the first `results[]` row that passes `resultHasUsableProviderText` (status `OK`, non-empty content ≥5 chars, not a `SYSTEM` row, not an `integrity_flag` message, and family-matched when a target family is given); (3) the first matching `familyDeliberation.turns` entry with `completion_status === 'complete'` and non-empty `full_response`. `extractReadableCouncilContributions()` applies the same usability rules across all rows/turns, de-duplicating by family+content (or by stable message/turn ID when present) and preserving order. System rows and integrity-flag rows can never surface as a family's answer. Called from three points in `app/page.tsx`: stream-chunk parsing, deliberation-turn parsing, and final-synthesis parsing.

## 10. Intent-Scope Behavior

`stripForbiddenScopeLines()` strips only the lines that match a forbidden-topic pattern, keeping every other line intact — this was already its behavior. The hardening in this phase is the fallback added for the case where every line matches (a single-paragraph reply that only incidentally mentions a forbidden topic while disclaiming it, e.g. "no Panama analysis needed" inside a plain greeting): instead of returning an empty string, the function now returns the original, untouched text with `stripped: 0`. A genuine reply silently vanishing from the transcript is treated as strictly worse than leaving one incidental off-topic mention in place. Unaffected: partial off-topic lines are still stripped normally; empty input and scopes with no forbidden topics still pass through unchanged.

## 11. Retry Orchestration Behavior

`orchestrateProviderResponse()` runs, in order, for a single already-fetched provider response (`rawText`, already obtained by the caller before this function is invoked):

1. **Stability bypass**: if `shouldPassthroughCouncilProviderText()` (true only under the explicit `COUNCIL_STABILITY_MODE` circuit breaker) the function returns immediately with zero calls to `invoke` — no retries, no fallback, no integrity substitution.
2. **Initial integrity assessment** via `validateProviderResponseIntegrity()`.
3. **Retry stage**: only if the assessment recommends retry or reports degraded quality. Gemini gets up to three strategies (`simplified`, `no_compression`, `short_context`); every other family gets exactly one (`simplified`), with an explicit early exit after the first attempt regardless of array length. The loop exits early the moment an attempt reassesses as `COMPLETE`, or the moment the current assessment no longer recommends retry.
4. **Fallback stage**: only if still incomplete after retries and the assessment recommends fallback. Iterates `FALLBACK_CHAIN[family]` (a fixed 1–2 candidate list per family, `['chatgpt','claude']` as the default for families absent from the map), skipping any candidate whose provider key is not configured, calling `invoke` once per configured candidate, and stopping at the first candidate whose fallback response reassesses as `COMPLETE`.

## 12. Honest Fallback Attribution

`family` in the returned `ProviderCallOutcome` always stays the *original* requested family — a Gemini turn that used a ChatGPT fallback is still reported as a Gemini outcome, never silently reassigned. `displayText` (Commander/Council-facing) is prefixed `[{FallbackFamily} summarized {OriginalFamily}'s incomplete response]` whenever a fallback was used; `text` (diagnostics-only) carries the raw fallback content unprefixed. A fallback family's words are never rendered under the original family's name as if it spoke them.

## 13. Runtime Flags And Circuit Breakers

`orchestrateProviderResponse()` only runs at all when `stabilityFlags.integrityOrchestrationRetries` is true. This flag is part of `StabilityModeFlags` in `lib/council/stabilityMode.ts`: it defaults to `true` in normal production operation (`ENABLED_WHEN_NORMAL`) and is forced `false` under `DISABLED_WHEN_STABLE` — i.e. whenever `COUNCIL_STABILITY_MODE=true` or the request is running in Stable Group Chat mode (`isMinimalCouncilSystemsPath()`). Independently, `shouldPassthroughCouncilProviderText()` (itself just `isCouncilStabilityMode()`) short-circuits the function body even if it is called, for the explicit debug/circuit-breaker case. Confirmed by `retry_orchestration_14_stability_mode_bypasses_orchestration_zero_calls`.

## 14. Provider-Call Budget

The exact maximum number of real provider calls `orchestrateProviderResponse()` itself can make (not counting the original call already made by the caller before this function runs), verified by counting-mock tests rather than assumed:

| Family shape | Retry calls (max) | Fallback calls (max) | **Total (max)** |
| --- | --- | --- | --- |
| Gemini | 3 (all three strategies) | 2 (`['chatgpt','claude']`) | **5** |
| Any family with a 2-candidate fallback chain (grok, claude, chatgpt, red_team, and any family defaulting to `['chatgpt','claude']`) | 1 | 2 | **3** |
| `baby` (1-candidate chain `['chatgpt']`) | 1 | 1 | **2** |

This is a correction, not a restatement, of the earlier classification-pass estimate ("3 Gemini retries + 1 fallback = 4"), which undercounted the fallback stage — the fallback loop can try more than one candidate before giving up. Verified by `retry_orchestration_07` through `retry_orchestration_12` in `lib/providers/retryOrchestration.validation.ts`, using a counting mock `invoke` with no live provider or network call involved. A successful attempt at any stage stops further calls immediately (`retry_orchestration_11`, `retry_orchestration_12`) — the budget above is a ceiling, not a guaranteed cost. This is real provider-call-bearing code: every retry and fallback attempt above is a genuine, billable provider request when running against live providers in production, not a no-op.

## 15. Failure Behavior

When integrity never reaches `COMPLETE` after retries and fallback, the function returns a non-`COMPLETE` outcome with an operator-safe, honest `displayText` (`operatorSafeIncompleteMessage('gemini' | 'fallback' | 'unavailable')`) — never the raw incomplete provider text, and never a fabricated "success" message. `diagnosticFragment` (the original incomplete body) is retained for diagnostics only and is documented as never intended for Operator-facing display.

## 16. Security And Privacy Boundaries

No new persistence, no new table, no new external endpoint, and no new credential handling are introduced. `retryOrchestration.ts` reads existing provider API key env vars only to decide whether a fallback candidate is callable (`providerConfigured()`) — it never logs or displays key values. `logProviderIntegrityAudit()` calls (pre-existing) receive only status/reason/family metadata, not raw provider secrets. None of the six capabilities read, write, or transmit Supabase data, session tokens, or authentication state.

## 17. Non-Goals

This phase does not: change provider selection or routing, add new Council modes, change synthesis, add persistence, change approval authority, change authentication, execute any Supabase migration, or expand which providers can be called for a given family. It does not implement true semantic context relevance (only bounded keyword overlap), and it does not add a general-purpose retry framework beyond the single-call scope described above.

## 18. Validation Coverage

Six suites, all passing, runnable individually (existing standalone runners, unchanged) or together via the new aggregate runner:

| Suite | Cases | Result |
| --- | --- | --- |
| Attendance late-release integrity | 7 | 7/7 PASS |
| Decree-context relevance filtering | 7 | 7/7 PASS |
| Family operation-status projection (incl. 4 new status-sync cases) | 23 | 23/23 PASS |
| Intent-scope regression protection | 5 | 5/5 PASS |
| Live Council response extraction | 9 | 9/9 PASS |
| Provider retry orchestration (incl. 9 new budget/bypass/structural cases) | 15 | 15/15 PASS |
| **Total** | **66** | **66/66 PASS** |

Run via `npm run validate:phase48-c4d` (`scripts/run-phase48-c4d-validation.mjs`), which imports and calls each suite's existing exported validation function directly — no suite's standalone runner script was renamed, removed, or duplicated. No suite calls a live provider or touches the network; every provider invocation inside these suites goes through an in-memory mock.

## 19. Known Limitations

- Context relevance is keyword-overlap only; it can occasionally keep a genuinely stale reply (a false negative) rather than risk dropping a real continuation (a false positive) — this is an intentional, documented bias, not an oversight.
- The status-sync regression (section 8) proves agreement between `isActionableProviderRuntime` and `ISSUE_STATUSES` for every runtime/detail combination present in production source today; it does not prevent a future code change from introducing a new detail string without also adding a corresponding test case to the fixed matrix in `familyOperationStatus.validation.ts`.
- The retry/fallback provider-call budget (section 14) is a structural ceiling proven for the exact chains configured in `FALLBACK_CHAIN` today; changing that map changes the ceiling and requires re-verifying the budget tests.
- No suite in this phase includes a DOM/React rendering test (`CouncilMembersPanel.tsx` wiring is confirmed by static import/prop-name inspection, not a rendered-component test) — this repository has no React/JSDOM/Vitest stack configured, consistent with `scripts/run-live-council-ui-fix-validation.mjs`'s existing disclosure of the same limitation.

## 20. Relationship To Phase 48-C4A, C4B, And C4C

C4A owns truthful completed-transcript projection into Commander operation cards. C4B connects that timeline to the authoritative progress-event runtime. C4C adds incremental browser-visible transport for the same authoritative events. None of the three change provider dispatch, prompts, synthesis, or per-family outcome truth. Phase 48-C4D operates one layer beneath all three: it hardens how a single family's raw runtime outcome becomes Commander-facing text and status, and how much retry cost a single incomplete response can incur, before that outcome ever reaches the C4A/C4B/C4C presentation layers. C4D does not change event ordering, event identity, or transport envelopes owned by C4B/C4C.

## 21. Explicit Exclusion Of Phase 48-DB-A

Phase 48-DB-A (Production Database Privilege Repair) is unrelated code surface — Supabase `service_role` table privileges — with its own explicit Commander-authorization gate documented in `docs/architecture/PRODUCTION_DATABASE_PRIVILEGE_REPAIR.md`. This phase does not touch any file listed there, does not execute any SQL, and does not change or advance DB-A's authorization status. DB-A remains separately gated.

## 22. Explicit Exclusion Of Operator Self-Repair Storage

`lib/operator/selfRepair/storage.ts` and `lib/operator/selfRepair/storage.validation.ts` contain an unrelated, already-fixed infinite-recursion regression test (`loadSelfRepairSnapshot` ↔ `normalizeSelfRepairGapIds`) in the Operator subsystem. It shares no import, call graph, or capability with any of the six Council-runtime capabilities in this phase and is excluded by design. It should be logged as its own entry in `docs/repair-ledger.md` rather than folded into this phase.

## 23. Completion Criteria

This phase is complete when: (1) this architecture document exists and matches the structure of the sibling C4A–C4C documents (done); (2) one aggregate validation script runs all six suites under a single pass/fail gate (done — `npm run validate:phase48-c4d`, 66/66 PASS); (3) the status-synchronization dependency between `familyOperationStatus.ts` and `attendanceReadiness.ts` is proven by a deterministic test rather than a comment (done — `status_sync_01`–`04`); (4) the exact retry/fallback provider-call budget is verified by test rather than estimated (done — 5 for Gemini, 3 for a typical fallback family, 2 for `baby`); (5) `tsc`, `eslint` on touched files, and `pnpm run build` pass with no new failures attributable to this phase's changes (see the accompanying work-packet report for current results). Committing this work to version control is a separate, later step not authorized by this document.
