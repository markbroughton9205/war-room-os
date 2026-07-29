# Phase 49-A: Runtime Truthfulness UI Sweep

Phase 49-A classifies, documents, and validates a coherent body of UI/runtime work already present, uncommitted, in the working tree at Phase 48 closeout: replacing placeholder/mock/fabricated status in a specific set of War Room OS surfaces with honest loading, empty, degraded, and error reporting. This document is classification and validation packaging. It does not redesign any UI, does not grant new execution authority, and does not authorize commit, push, deploy, or Supabase execution.

## 1. Phase Designation And Status

Phase: 49-A. Status: implemented and present in the working tree at the time this document was written; not yet committed. The owned-file list in section 17 reflects diff-level inspection of every modified and untracked path in the repository, cross-checked against the explicit exclusion list in the Commander work packet. One named scope item (System Health Intelligence) has no independent implementation and is documented as out of scope in section 6. Three ambiguous items were classified by the executing agent based on the exclusion criteria in the work packet (recorded in section 17); all three classifications were confirmed as-is by the Commander on 2026-07-27, with the stated exclusion reasons unchanged and no production-code changes required to reach this confirmation.

## 2. Purpose

A prior body of work (Phase 48 and earlier) left several War Room OS surfaces reporting `'placeholder'`, `'mock'`, or fabricated-looking values — payment provider readiness, income routes, tools routes, the Operator Command Deck, Signal Radar, the legacy KPI dashboard, and the live-room header. Phase 49-A's purpose is narrow: ensure that anywhere the Commander looks at one of these surfaces, what is displayed is either (a) real, source-backed state, or (b) an honest statement of what is missing and what would need to happen before real state could be shown — never a fabricated success, a silently-dropped failure, or a placeholder presented as if it were live capability.

## 3. Problem Statement

Prior to this sweep:

1. `lib/payments/types.ts` / `providers.ts` had a `'placeholder'` status value presented alongside real `'configured'`/`'not_configured'` values, with no distinction in the UI between "not wired yet" and "wired but currently unavailable."
2. `app/api/income/currency/route.ts` and `app/api/income/search/route.ts` returned static `status: 'placeholder'` bodies regardless of whether a real provider (an exchange-rate source, Tavily, Firecrawl) was configured — the route looked identical whether it could ever produce a real result or not.
3. `app/api/tools/files/route.ts` and `app/api/tools/repo/route.ts` returned `status: 'placeholder'` unconditionally, never attempting a real connection to Supabase-backed file metadata or repo status.
4. `app/api/repo/scan/route.ts` reported `buildStatus`/`deploymentStatus` as bare `'placeholder: not connected'` strings with no explanation of what "not connected" means or what would connect it.
5. The legacy `KpiGrid`, `CouncilTable`, `SentinelStatusPanel`, `WarRoomLazyPanels`, and `CommandBar` all displayed hardcoded `MOCK_KPIS` values or literal "Mock" / "Mock / Estimated" labels without directing the Commander to the real, source-backed surface.
6. `OperatorCommandDeck` had no approval-packet feed backed by real rows, only a single `lastPacket` summary, and no per-integration explanation of why an integration showed `UNAVAILABLE`.
7. `SignalRadarPanel` gave no single, honest "why is this panel empty/degraded/populated" diagnostic distinguishing API error, not-yet-loaded, missing migration, missing persistence, no configured sources, and no accepted results from each other.
8. `WarRoomOsHeader` reported CPU/Memory/Network as `'Nominal'` placeholders with no real resource monitor behind them.

## 4. User-Facing Surfaces

- Operator Command Deck (`components/war-room/operator/OperatorCommandDeck.tsx`, `OperatorCommandEnvironment.tsx`, `ActionQueueMini.tsx`, `FinancialTelemetryMini.tsx`, `GapFinderPanel.tsx`)
- Signal Radar Panel (`components/war-room/signals/SignalRadarPanel.tsx`)
- Legacy KPI dashboard route (`components/war-room/KpiGrid.tsx`, `WarRoomLazyPanels.tsx`, `components/war-room/council/CouncilTable.tsx`, `SentinelStatusPanel.tsx`, `components/war-room/CommandBar.tsx`)
- Live-room dock and header (`components/war-room/live-room/DockPanelContent.tsx`, `WarRoomOsHeader.tsx`)
- Payments, tools, and income API routes (see section 11)

## 5. Runtime Truth Model

Every owned surface follows the same small vocabulary instead of inventing per-panel language:

| State | Meaning | Never means |
| --- | --- | --- |
| `configured` / `complete` / `found` / `source_backed` | Real, source-backed data is present | A count or status that was generated client-side without a backing source |
| `config_needed` / `not_configured` | A required credential, table, or bucket is absent | "Feature is broken" — it is simply not wired |
| `no_results` / `sources_missing` | The real pipeline ran but returned nothing usable | "Unhealthy" or "error" |
| `error` / `unavailable` | The real pipeline was attempted and failed, or a dependency could not be reached | Silently falling back to a fabricated value |
| `loading` / `not_loaded` | The client has not yet received a real snapshot | Any terminal state, healthy or unhealthy |

No surface in this sweep infers a numeric KPI, a health percentage, or a completion count from anything other than a real API response or a real source-backed row.

## 6. System Health Intelligence — Out Of Scope

"System Health Intelligence" was named as a Phase 49-A primary-scope surface in the originating work packet. Repository inspection found no independent implementation: the only files matching this name are `lib/native-builder/systemHealthSnapshot.ts` and `lib/native-builder/systemHealthAndIntelligence.validation.ts`, both owned by Native Builder, and `scripts/run-system-health-intelligence-validation.mjs` does nothing but shell out to the latter. Native Builder is explicitly excluded from this phase by the Commander work packet. This document therefore records System Health Intelligence as **out of scope for Phase 49-A** — a conclusion drawn directly from the work packet's own exclusion of Native Builder, not from a separate Commander decision — rather than fabricating a truthfulness section for a surface this phase does not own. No System Health Intelligence file was read, modified, or validated as part of this phase.

## 7. Operator Dashboard Behavior

`OperatorCommandDeck` renders, in order: an `Approval Packet Feed` backed by real `war_room_operator_packets` rows (up to 8, via `collectOperatorDeck()` / `lib/operator/deckPersistence.ts`), the existing `ActionQueueMini`, an injected `SignalRadarPanel` (via the new `signalRadarSlot` prop, wired from `DockPanelContent.tsx`), `FinancialTelemetryMini`, and `MissionStatusStrip`. Each packet displays its real `status`, a `TruthBadge`-rendered `truthLabel`, `approvalRequirement`, and `executionRelationship` string computed from real boolean columns (`external_action_performed`, `autonomous_execution_performed`, `email_sent`) — a packet whose row shows any of those three flags true renders `"Safety violation recorded on packet row; do not execute from this deck"` rather than a normal approval affordance. Only `Approve` is a live action (`approve_packet` command, requiring an explicit `window.confirm` and `confirmed: true`); `Modify`, `Reject`, and `Archive` are always rendered `disabled` with a `title` explaining the schema does not support them yet. Every `UNAVAILABLE` integration pill has a per-key `integrationDetail()` string naming the exact missing dependency (e.g. "Missing dependency: source-backed Signal Radar nodes from configured sources and accepted scan results.") rather than a bare "unavailable" label.

## 8. KPI And Signal Behavior

`KpiGrid` (the legacy dashboard route) no longer imports `MOCK_KPIS` or renders any numeric trend/value. It renders six `OPERATIONAL_STATUS_CARDS`, each a `{ label, status, detail }` triple whose `status` is a plain-language readout ("Use primary shell", "Source-gated", "Bucket-gated") and whose `detail` names the real dependency, never a synthesized count. `SignalRadarPanel` computes a single `availabilityDiagnostic` (`error` → `not_loaded`/`loading` → `migration_required` → `persistence_unavailable` → `sources_missing` → `no_results` → `source_backed`, evaluated in that order) and renders it as a dedicated "Radar Availability" section with `reason`, `dependency`, and `remaining` fields, in addition to its pre-existing freshness/staleness machinery (`lib/signals/freshness`, the `classificationBuckets.stale` bucket, and the explicit guardrail text "no fake signals, no stale/unknown-date news as live opportunities").

## 9. Gap Finder Behavior

`GapFinderPanel` adds a three-card summary (`Active Issues`, `Warnings`, `Resolved / Review`) computed directly from the existing `gaps` array (`gaps.filter(g => g.status === 'open')`, further split by `severity !== 'high'`) and an "Active Issue List" (first 12 open gaps, each showing title, area, severity, plain-language explanation, and recommended fix) explicitly labeled "Mirrors System Health badge count." No new gap-detection heuristic was added; this is a presentation-only expansion of pre-existing `gaps` data.

## 10. Live-Room And Dock Behavior

`DockPanelContent.tsx`'s `approvals` panel now renders `<OperatorCommandDeck signalRadarSlot={<SignalRadarPanel />} />` in place of a separate, duplicate `<OperatorCommandEnvironment>` mount (removed from this panel as part of the same change). `WarRoomOsHeader` replaces `"CPU · Nominal"` / `"Memory · Nominal"` / `"Network · Nominal"` (each previously titled `"... placeholder"`) with `"CPU · Not connected"` / `"Memory · Not connected"` / `"Network · Not connected"`, each titled `"Missing dependency: a connected resource monitor feed."` / `"...network health feed."` — no resource monitor was connected; the change is removing a fabricated "Nominal" reading, not adding real telemetry.

## 11. Payments/Tools/Income Route Behavior

| Route | Before | After |
| --- | --- | --- |
| `app/api/payments` types/providers | `status: 'placeholder'` in the type union and in the ACH row | `status: 'not_configured'`; `'placeholder'` removed from the type entirely |
| `app/api/income/currency/route.ts` | `status: 'placeholder'`, 200 OK | `status: 'config_needed'`, HTTP 503, names the missing exchange-rate provider dependency |
| `app/api/income/search/route.ts` | `status: 'placeholder'`, empty `opportunities: []`, 200 OK | Real `TAVILY_API_KEY`/`FIRECRAWL_API_KEY`-gated call to `searchTavilyIncomeOpportunities()`/`searchIncomeOpportunities()`; `config_needed` (503) if neither key is set, `found`/`no_results` (200) or `error` (502) otherwise; no generated/fallback opportunities in any branch |
| `app/api/tools/files/route.ts` | `status: 'placeholder'`, 200 OK, no Supabase call | Real Supabase call to `war_room_files`; `complete`/`config_needed`/`error` depending on bucket/table reachability; a `?health=1` mode checks bucket+table without listing rows |
| `app/api/tools/repo/route.ts` | `status: 'placeholder'`, 200 OK | Real call to `getRepoStatus()`; `complete`/`unavailable`/`error` depending on whether the configured repo path is readable |
| `app/api/repo/scan/route.ts` | `buildStatus`/`deploymentStatus`: `'placeholder: not connected'` | `'config_needed: ...'` with an explicit statement of what is not connected and why (build/deploy status is intentionally not inferred by a read-only repo-scan route) |

## 12. Data Sources

Real data sources touched by owned surfaces: Supabase tables `war_room_operator_packets`, `war_room_operator_actions`, `war_room_operator_earnings`, `war_room_operator_activity`, `war_room_files`; the configured Supabase storage bucket named by `SUPABASE_FILES_BUCKET`; `TAVILY_API_KEY` / `FIRECRAWL_API_KEY`-gated web search providers; the local repo-status reader behind `getRepoStatus()`; and the pre-existing Signal Radar snapshot API (`/api/signals/results`). This phase does not add a new data source — it either wires an existing route to a data source that was already implemented elsewhere in the codebase (income search, tools/files, tools/repo) or replaces a fabricated value with an honest "not connected" statement (payments, repo scan build/deploy status, header resource monitor).

## 13. Loading, Empty, Degraded, And Error States

- **Loading**: `SignalRadarPanel.availabilityDiagnostic` explicitly distinguishes `loading` (a request is in flight) from `not_loaded` (no request has completed yet) — neither can render as `source_backed`.
- **Empty**: `ActionQueueMini`, `FinancialTelemetryMini`, and the Operator `PacketFeed` each render a distinct empty-state message naming the exact missing dependency (a specific table row, a specific env var, a specific upstream feed) rather than a generic "no data" string.
- **Degraded**: Signal Radar's `sources_missing` and `no_results` are distinct from both `error` and `source_backed` — a degraded (partially working) pipeline is never folded into either a clean success or a hard failure state.
- **Error**: `SignalRadarPanel` renders its `error` string in a dedicated red-bordered banner (not swallowed into console-only logging); `app/api/tools/files/route.ts` and `app/api/tools/repo/route.ts` both return HTTP error statuses with a real `message` field on any thrown error, rather than a 200 with a misleading placeholder body.

## 14. Truthfulness Requirements

This phase satisfies, for the owned-file list only (section 17):

- No fabricated system-health state (System Health Intelligence itself is out of scope per section 6; no owned file claims a health check it did not run).
- No fake KPI success state (`KpiGrid` renders no numeric value; `GapFinderPanel`'s counts derive from real `gaps` data already loaded by its caller).
- No placeholder route presented as operational (`'placeholder'` status removed from every owned route and from the `PaymentProviderReadiness` type; each replaced with `config_needed`/`not_configured` plus a named missing dependency).
- No hidden provider or database failure (`tools/files`, `tools/repo`, and `income/search` all surface `error` states with real messages rather than swallowing exceptions).
- No action authority is granted by display-only surfaces (`GapFinderPanel`'s issue list, `KpiGrid`'s status cards, and `WarRoomOsHeader`'s resource readout are read-only; none posts a command).
- No financial execution authority (`FinancialTelemetryMini` and payments routes report status only; `OperatorCommandDeck`'s `approve_packet` command records a Commander-confirmed approval row and explicitly states "no external action was performed" — it does not move money, send a payout, or call a payment provider).
- No deployment authority (`repo/scan`'s `buildStatus`/`deploymentStatus` are explicitly "not connected to repo scan," not simulated).
- No background autonomy (every owned surface change is either a read-only display or a Commander-confirmed, single-action command).
- No production mutation authorized by this phase (this phase is classification/documentation/validation only; any mutation capability documented above pre-exists in the working tree and is not created or altered here).

## 15. Security And Privacy Boundaries

No owned file introduces a new credential, a new external endpoint, or a new authentication path. Supabase calls in `tools/files/route.ts` and `deckPersistence.ts` use the existing server client/session pattern already present elsewhere in the codebase. `income/search/route.ts`'s `safeError()` helper explicitly redacts any error message matching `api[_-]?key|secret|token|bearer|authorization|unauthorized|401|403` before returning it to the client, rather than surfacing a raw provider error that might echo a credential.

## 16. Non-Goals

This phase does not: redesign any panel's layout or visual language beyond the specific truthfulness copy/state changes described above; add new gap-detection, signal-classification, or resource-monitoring capability; change payment execution logic; change Supabase schema; change authentication; grant new operator command types beyond `approve_packet` (which already existed as `approve_last_packet` with a different targeting mechanism); or implement System Health Intelligence (see section 6).

## 17. File Ownership

**Phase 49-A owned (whole file):**

| File | Change |
| --- | --- |
| `app/api/income/currency/route.ts` | `placeholder` → `config_needed`, 503, named dependency |
| `app/api/income/search/route.ts` | Real Tavily/Firecrawl wiring, no generated fallback |
| `app/api/repo/scan/route.ts` | Honest build/deploy "not connected" messaging |
| `app/api/tools/files/route.ts` | Real Supabase `war_room_files` wiring |
| `app/api/tools/repo/route.ts` | Real `getRepoStatus()` wiring |
| `components/war-room/CommandBar.tsx` | Legacy-route "not connected" copy, no "mock" wording |
| `components/war-room/KpiGrid.tsx` | Removes `MOCK_KPIS`; honest status cards |
| `components/war-room/WarRoomLazyPanels.tsx` | Legacy council overview copy, no "Mock" wording |
| `components/war-room/council/CouncilTable.tsx` | "Mock / Estimated" → "Static seed overview" |
| `components/war-room/council/SentinelStatusPanel.tsx` | "Mock / Not live" → "Static seed / not live" |
| `components/war-room/live-room/WarRoomOsHeader.tsx` | Resource status "Nominal" → "Not connected" |
| `components/war-room/operator/ActionQueueMini.tsx` | Named missing-dependency empty state |
| `components/war-room/operator/FinancialTelemetryMini.tsx` | Named missing-dependency empty state |
| `components/war-room/operator/GapFinderPanel.tsx` | Active/warning/resolved summary + issue list |
| `components/war-room/operator/OperatorCommandDeck.tsx` | Packet feed, truth badges, integration detail strings |
| `components/war-room/operator/OperatorCommandEnvironment.tsx` | Named missing-dependency messaging |
| `components/war-room/signals/SignalRadarPanel.tsx` | `availabilityDiagnostic` honest state machine |
| `lib/operator/deckPersistence.ts` | Real packet rows, `approve_packet` command |
| `lib/operator/deckTypes.ts` | `OperatorPacketSummary` truthfulness fields |
| `lib/payments/providers.ts` | `'placeholder'` → `'not_configured'` |
| `lib/payments/types.ts` | `'placeholder'` removed from status union |

**Phase 49-A owned (partial — file is mixed):**

| File | Owned portion | Excluded portion |
| --- | --- | --- |
| `app/page.tsx` | `TokenUsagePanel`'s `"Mock estimates."` → `"Local estimates only."` (one line) | Everything else (~99% of a 406-line diff): attendance release/readiness, `familyOperationStatus`, `liveResponseExtraction`, incremental-transport diagnostics, `contextRelevance`-filtered priors, `directedFamilies` — all Phase 48-C4D / attendance / incremental-transport |
| `components/war-room/live-room/DockPanelContent.tsx` | `<OperatorCommandDeck signalRadarSlot={<SignalRadarPanel />} />` wiring; removal of the duplicate `<OperatorCommandEnvironment>` mount from the approvals panel | Removal of `useLiveRoomMode`/`openBuilder` (Native Builder engineering-drawer trigger) |

**Existing validation runner (owned, mixed — see section 19):** `scripts/run-live-council-ui-fix-validation.mjs`

**Excluded (Commander-confirmed 2026-07-27):**

| File | Reason |
| --- | --- |
| `components/war-room/live-room/CouncilMembersPanel.tsx` | Depends on `lib/council/familyOperationStatus.ts` (Phase 48-C4D) |
| `components/war-room/runtime/PanelErrorBoundary.tsx` | Posts to `/api/native-builder/issues` (Native Builder) |
| `app/api/chat/stream/route.ts` | Council response-completion integrity — Phase 48-C4D's own theme, not a named 49-A UI surface |

**Excluded (persona/prompt tuning, Phase 48-C4D, attendance, incremental transport, or explicitly named in the work packet):** `app/api/chat/execute.ts`; ~99% of `app/page.tsx` (see above); `components/council/CouncilOperationTimeline.tsx`; `lib/council/compression.ts`; `lib/council/councilRenderGate.ts`; `lib/council/providerResponseSanitizer.ts`; `lib/council/stabilityMode.ts`; `lib/council/renderPacket.ts`; `lib/council/stableGroupChat.ts`; `lib/council/unified-experience/adapter.ts`; `lib/council/intentScope.ts`; `lib/council/providerIdentity.ts`; `lib/council/family-deliberation/runtime.ts`; `lib/providers/retryOrchestration.ts`; `lib/council/incremental-transport/client.ts`; `lib/council/incremental-transport/sse.ts`; `lib/council/incremental-transport/types.ts`; `lib/council/incremental-transport/validation.ts`; `lib/operator/canonicalIssues.ts`; `lib/operator/selfRepair/storage.ts`; `package.json` (adds only `validate:phase48-c4d`); every untracked Native Builder path (`app/api/native-builder/`, `app/native-builder/`, `components/war-room/native-builder/`, `lib/native-builder/`, `scripts/run-native-builder-*.mjs`); every untracked Sovereign Model Lab path (`app/api/sovereign-model-lab/`, `app/sovereign-model-lab/`, `components/war-room/sovereign-model-lab/`, `lib/sovereign-model-lab/`, `scripts/sovereign-model-lab/`, `scripts/run-sovereign-model-lab-*.mjs`); every untracked Phase 48-C4D file (`lib/council/attendanceRelease.ts`+`.validation.ts`, `contextRelevance.ts`+`.validation.ts`, `familyOperationStatus.ts`+`.validation.ts`, `intentScope.validation.ts`, `liveResponseExtraction.ts`+`.validation.ts`, `lib/providers/retryOrchestration.validation.ts`, `lib/operator/selfRepair/storage.validation.ts`, `scripts/run-attendance-late-release-validation.mjs`, `run-context-relevance-validation.mjs`, `run-family-operation-status-validation.mjs`, `run-intent-scope-validation.mjs`, `run-live-council-response-normalization-validation.mjs`, `run-phase48-c4d-validation.mjs`, `run-self-repair-storage-validation.mjs`, `docs/architecture/PHASE_48_C4D_COUNCIL_RUNTIME_TRUTHFULNESS_AND_RESPONSE_INTEGRITY.md`); `scripts/run-system-health-intelligence-validation.mjs` and `lib/native-builder/systemHealthAndIntelligence.validation.ts` (System Health Intelligence — see section 6, entirely Native Builder-owned).

## 18. Shared Dependencies

`scripts/ts-extension-loader.mjs` — a general Node ESM loader shim (stubs `server-only`/`client-only`, resolves sibling `.ts` files ahead of directory `index.ts`) required by every validation script in the repository, including the Phase 49-A aggregate runner (section 19). It is not owned by this phase and was not modified by this phase's work; it is depended on, unchanged.

## 19. Validation Coverage

See section 20 (limitations) and the companion validation-inventory findings. Summary: one existing suite (`scripts/run-live-council-ui-fix-validation.mjs`) already covers most of the owned-file list via its `operationalWiringCases` block (15 cases), but the same file also carries 26 pre-existing structural/behavioral cases for the unrelated, already-committed Live Council transcript/expanded-intel-workspace feature. Phase 49-A's aggregate runner (`scripts/run-phase49-a-validation.mjs`) runs this file's full case set (all 41 cases) as one labeled suite — honestly disclosing that 26/41 cases are pre-existing regression coverage, not new Phase 49-A assertions — plus a new, narrowly-scoped suite (`scripts/run-phase49-a-truth-tests.mjs`, added by this phase) covering the specific truth properties from Step 5 that the existing suite did not already assert (loading-vs-success, degraded-vs-failure distinctness, error visibility, KPI non-fabrication, display-only non-execution, and stale-data labeling for Signal Radar).

## 20. Known Limitations

- All validation in this phase is static source-string inspection (`readFileSync` + `includes()`/slicing), matching the pre-existing suite's own methodology. No suite renders a React component, calls a live provider, or connects to Supabase — none of these routes' *runtime* behavior against a real Supabase project or a real Tavily/Firecrawl key is exercised, only their *source-level* absence of placeholder/mock language and presence of the expected honest-state branches.
- `DOM component rendering coverage: NOT AVAILABLE` — the repository has no React/JSDOM/Vitest test stack configured (pre-existing limitation, not introduced by this phase).
- The `approve_packet` Supabase write path (`lib/operator/deckPersistence.ts`) is verified only by source inspection, not by an integration test against a real or emulated Supabase instance — consistent with the "no Supabase execution" boundary of this phase.
- System Health Intelligence remains fully unvalidated by this phase (see section 6) — this is a scope gap, not a passing/failing suite.

## 21. Completion Criteria

Phase 49-A is complete for the purposes of this classification/documentation/validation packet when: (a) the file-and-symbol ownership map in section 17 is Commander-confirmed — **satisfied**: the three items listed in section 17 as "excluded" were confirmed as-is by the Commander on 2026-07-27, with the stated exclusion reasons unchanged and no production-code changes required; (b) this document exists and covers the required sections (done); (c) the aggregate validation runner exists, runs with no live provider/Supabase/network dependency, and reports a clear pass/fail total (section 19; independently reproduced at 52/52 PASS); (d) TypeScript, ESLint (on touched files), and `npm run build` are run and their results are attributed to Phase 49-A vs. pre-existing/unrelated (independently reproduced clean/clean/success); (e) no commit, push, or deploy has occurred (true).
