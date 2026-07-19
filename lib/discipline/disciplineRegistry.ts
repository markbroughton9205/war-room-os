/**
 * Phase 47B Stage A — Discipline Registry Foundation.
 *
 * Pure descriptive metadata about War Room OS's Council-adjacent
 * disciplines. This module performs no I/O: no provider calls, no
 * retrieval, no Tavily/Firecrawl calls, no Supabase access, no memory
 * writes, no mission execution, no routing. It imports nothing at
 * runtime from any module it describes — only `import type` references,
 * which TypeScript erases entirely at compile time — so importing this
 * file can never trigger a side effect anywhere else in the codebase.
 *
 * This registry describes CURRENT reality, not design intent or planned
 * architecture. A discipline is only `runtimeAuthority: 'enforcing'` if
 * code actually blocks or alters runtime behavior today. A discipline is
 * only `implementationStatus: 'runtime_wired'` if a real, reachable
 * import chain into an actually-executed request path was confirmed —
 * not because a file with a plausible name exists. Requesting a role via
 * a prompt is never treated as equivalent to that role having executed.
 */

import type { CouncilTraceObservationMode } from '@/lib/council/runtimeTrace'
import type { LearningIntegrationStatus } from '@/lib/learning/integrationStatus'
import type { QueueTruthLabel } from '@/lib/queues/types'

// ---------------------------------------------------------------------------
// Registry contract
// ---------------------------------------------------------------------------

/**
 * The registry's own meta-classification of how built/wired a discipline
 * is. This is NOT a fourth "honesty vocabulary" competing with the three
 * documented below. Those three vocabularies describe the truthfulness of
 * DATA produced at runtime (evidence packets, learning panels, queue
 * items). This field describes the CODE ITSELF — has it shipped, is it
 * reachable from a real request path, is it backed by seed data. The two
 * concerns are orthogonal. This field exists because none of the three
 * existing vocabularies covers "not integrated," "planned," or
 * "unavailable" as first-class states in the shape Stage A requires.
 *
 * `'seed_only'` specifically describes a discipline's present
 * ARCHITECTURAL MATURITY (its code is backed by hardcoded demo/seed data
 * rather than a live pipeline) — it is a different layer from
 * `LearningIntegrationStatus`'s `'static_seed'` value, which describes
 * the INTEGRATION STATE of a specific data panel/table within the
 * learning subsystem. The two can legitimately describe the same
 * discipline at the same time without being the same vocabulary: this
 * registry uses `'seed_only'` at the architecture-metadata layer, and a
 * discipline's own `observations` should say when the underlying data
 * ought to also expose `'static_seed'` at the data/integration layer
 * (see `forecast_outcome_tracking` below). This registry does not
 * replace or subsume `LearningIntegrationStatus`.
 */
export type DisciplineImplementationStatus =
  | 'runtime_wired'
  | 'observational'
  | 'partial'
  | 'seed_only'
  | 'planned'
  | 'not_integrated'
  | 'unavailable'
  | 'inferred'

/** What kind of effect this discipline has on a live request today. */
export type DisciplineRuntimeAuthority = 'none' | 'observational' | 'enforcing'

/** Whether this discipline consumes/produces evidence-shaped data, and how completely. */
export type DisciplineEvidenceStatus = 'not_applicable' | 'none' | 'partial' | 'full'

/**
 * Whether this discipline currently blocks/alters output, distinct from
 * its general authority classification. Selection criterion, applied
 * uniformly across every entry below:
 *
 * - `'not_applicable'`: the discipline is descriptive, observational,
 *   classificatory, or otherwise has NO enforcement responsibility by
 *   design — not because enforcement is missing, but because enforcing
 *   anything was never this discipline's job. (Example: intent_resolution
 *   classifies intent; enforcement is downstream disciplines' job.)
 * - `'not_enforced'`: the discipline HAS an intended or relevant
 *   enforcement responsibility, but enforcement is absent, incomplete, or
 *   not currently wired. (No current entry in this registry meets this
 *   bar — every discipline that has an enforcement responsibility today
 *   already enforces it; this value remains available for a future entry
 *   whose enforcement role is real but not yet wired.)
 * - `'enforced'`: code currently changes, blocks, permits, rejects, or
 *   constrains runtime behavior.
 */
export type DisciplineEnforcementStatus = 'not_applicable' | 'not_enforced' | 'enforced'

export type DisciplineRegistryEntry = {
  disciplineId: string
  name: string
  implementationStatus: DisciplineImplementationStatus
  runtimeAuthority: DisciplineRuntimeAuthority
  evidenceStatus: DisciplineEvidenceStatus
  enforcementStatus: DisciplineEnforcementStatus
  /** Repository-relative file paths. Never empty. */
  moduleLocations: string[]
  /** Other disciplineIds this depends on, or free-text external dependencies (env vars, tables, packages). */
  dependencies: string[]
  observations: string[]
  limitations: string[]
}

// ---------------------------------------------------------------------------
// Existing honesty/status vocabularies — documented, not replaced or merged.
//
// Stage A must not invent a fourth honesty vocabulary. These three are the
// vocabularies that currently exist in the repository, and per-discipline
// `observations` below state which of these (if any) a given discipline's
// own code actually uses. The literal value arrays are hardcoded here for
// documentation purposes; the `_Assert*` type below causes a compile-time
// error (caught by `tsc --noEmit`) if the real type's value set ever
// drifts from what's documented here, so this file cannot silently go
// stale.
// ---------------------------------------------------------------------------

/** Source: lib/council/runtimeTrace.ts (Phase 47A). */
export const COUNCIL_TRACE_OBSERVATION_MODE_VALUES = ['runtime_observed', 'inferred'] as const
type _AssertCouncilTraceObservationModeMatches =
  (typeof COUNCIL_TRACE_OBSERVATION_MODE_VALUES)[number] extends CouncilTraceObservationMode
    ? CouncilTraceObservationMode extends (typeof COUNCIL_TRACE_OBSERVATION_MODE_VALUES)[number]
      ? true
      : never
    : never
const _assertCouncilTraceObservationModeMatches: _AssertCouncilTraceObservationModeMatches = true

/** Source: lib/learning/integrationStatus.ts. */
export const LEARNING_INTEGRATION_STATUS_VALUES = [
  'live_wired',
  'derived_from_existing_store',
  'static_seed',
  'not_connected',
  'persistent_store',
  'live_persistent',
  'awaiting_data',
] as const
type _AssertLearningIntegrationStatusMatches =
  (typeof LEARNING_INTEGRATION_STATUS_VALUES)[number] extends LearningIntegrationStatus
    ? LearningIntegrationStatus extends (typeof LEARNING_INTEGRATION_STATUS_VALUES)[number]
      ? true
      : never
    : never
const _assertLearningIntegrationStatusMatches: _AssertLearningIntegrationStatusMatches = true

/** Source: lib/queues/types.ts. Actively consumed by lib/signals/operatorIntelligence.ts, not a dormant type. */
export const QUEUE_TRUTH_LABEL_VALUES = ['SOURCE_BACKED', 'PROPOSED', 'APPROVAL_REQUIRED', 'UNAVAILABLE'] as const
type _AssertQueueTruthLabelMatches =
  (typeof QUEUE_TRUTH_LABEL_VALUES)[number] extends QueueTruthLabel
    ? QueueTruthLabel extends (typeof QUEUE_TRUTH_LABEL_VALUES)[number]
      ? true
      : never
    : never
const _assertQueueTruthLabelMatches: _AssertQueueTruthLabelMatches = true

// Referenced so the assertions above are not flagged as unused by lint/tsc
// while still being pure compile-time checks with zero runtime behavior.
export const HONESTY_VOCABULARY_ASSERTIONS_HOLD =
  _assertCouncilTraceObservationModeMatches && _assertLearningIntegrationStatusMatches && _assertQueueTruthLabelMatches

// ---------------------------------------------------------------------------
// Registry entries
// ---------------------------------------------------------------------------

export const DISCIPLINE_REGISTRY: DisciplineRegistryEntry[] = [
  {
    disciplineId: 'intent_resolution',
    name: 'Intent Resolution',
    implementationStatus: 'runtime_wired',
    runtimeAuthority: 'observational',
    evidenceStatus: 'not_applicable',
    enforcementStatus: 'not_applicable',
    moduleLocations: ['lib/council/currentIntent.ts', 'lib/council/promptIntent.ts', 'lib/council/intentClassifier.ts'],
    dependencies: [],
    observations: [
      "Confirmed reachable via app/api/chat/route.ts's councilTrace.record('current_intent_resolved', { module: 'lib/council/currentIntent.ts:resolveCurrentIntent' }) call site.",
      'Resolves/classifies intent from decree text; does not itself block or alter output. Its output is consumed by active_scope_construction and mode_governance, which do enforce.',
      "enforcementStatus is not_applicable rather than not_enforced: this discipline has no enforcement responsibility by design (classification only), not an incomplete or missing one.",
      'Does not use any of the three documented honesty vocabularies.',
    ],
    limitations: [],
  },
  {
    disciplineId: 'active_scope_construction',
    name: 'Active Scope Construction',
    implementationStatus: 'runtime_wired',
    runtimeAuthority: 'enforcing',
    evidenceStatus: 'not_applicable',
    enforcementStatus: 'enforced',
    moduleLocations: ['lib/council/intentScope.ts'],
    dependencies: ['intent_resolution'],
    observations: [
      "Confirmed reachable via councilTrace.record('active_scope_built', { module: 'lib/council/intentScope.ts:buildActiveScope' }).",
      'Constrains what the Council is permitted to address for the current request; this is an active runtime restriction, not merely descriptive.',
      'Does not use any of the three documented honesty vocabularies.',
    ],
    limitations: [],
  },
  {
    disciplineId: 'topic_scope_enforcement',
    name: 'Topic Scope Enforcement',
    implementationStatus: 'runtime_wired',
    runtimeAuthority: 'enforcing',
    evidenceStatus: 'not_applicable',
    enforcementStatus: 'enforced',
    moduleLocations: ['lib/council/topicScope.ts'],
    dependencies: ['active_scope_construction'],
    observations: [
      "Confirmed reachable via councilTrace.record('topic_scope_built', { module: 'lib/council/topicScope.ts:deriveTopicScopeLock' }).",
      'Actively strips lines/content that fall outside the permitted topic lock — a direct runtime mutation of response content, not an advisory label.',
      'Does not use any of the three documented honesty vocabularies.',
    ],
    limitations: [],
  },
  {
    disciplineId: 'mode_governance',
    name: 'Mode Governance',
    implementationStatus: 'runtime_wired',
    runtimeAuthority: 'enforcing',
    evidenceStatus: 'not_applicable',
    enforcementStatus: 'enforced',
    moduleLocations: ['lib/council/modeGovernor.ts', 'lib/council/modeGovernorFilters.ts', 'lib/council/modeGovernorPrompt.ts'],
    dependencies: ['intent_resolution'],
    observations: [
      "Confirmed reachable via councilTrace.record('mode_governor_resolved', { module: 'lib/council/modeGovernor.ts:resolveModeGovernor' }).",
      'Applies real per-mode gates (maxSentences, allowSpeculation, renderImmediately) that change what is rendered for a given WarRoomMode.',
      'Does not use any of the three documented honesty vocabularies.',
    ],
    limitations: [],
  },
  {
    disciplineId: 'provider_selection',
    name: 'Provider Selection',
    implementationStatus: 'runtime_wired',
    runtimeAuthority: 'enforcing',
    evidenceStatus: 'not_applicable',
    enforcementStatus: 'enforced',
    moduleLocations: ['app/api/chat/route.ts'],
    dependencies: ['mode_governance', 'active_scope_construction'],
    observations: [
      "Confirmed reachable via multiple councilTrace.record('providers_selected', ...) call sites across route.ts.",
      'No single dedicated module exists — selection logic is distributed inline across several branches in app/api/chat/route.ts (os_sweep_bypass, council_research_team_bypass, economic_ops_bypass, direct_invocation, parallel_provider_selection, continue_single). This is disclosed explicitly rather than implying a consolidated selector module exists.',
      'Directly determines which provider families are actually called; this is enforcing, not advisory.',
      'Does not use any of the three documented honesty vocabularies.',
    ],
    limitations: ['Distributed inline implementation across many branches, not a single reusable module — harder to audit as one unit.'],
  },
  {
    disciplineId: 'response_integrity',
    name: 'Response Integrity',
    implementationStatus: 'runtime_wired',
    runtimeAuthority: 'enforcing',
    evidenceStatus: 'not_applicable',
    enforcementStatus: 'enforced',
    moduleLocations: ['lib/providers/responseIntegrity.ts', 'lib/council/responseIntegrity.ts'],
    dependencies: [],
    observations: [
      'Both files exist and are both runtime-used — this is not a stale duplicate.',
      'lib/providers/responseIntegrity.ts exports validateProviderResponseIntegrity() and the ResponseIntegrityStatus enum (COMPLETE/INCOMPLETE/TRUNCATED/MALFORMED/EMPTY/DEGRADED_RESPONSE_QUALITY/UNKNOWN), used by finalModerator.ts/responseGovernor.ts.',
      'lib/council/responseIntegrity.ts exports repairOrFlagResponse(), a text-level repair function used by final moderation, plus the SKIP_TERMINAL_TRUNCATION_BELOW constant.',
      'lib/providers/responseIntegrity.ts imports only the SKIP_TERMINAL_TRUNCATION_BELOW constant from the council file; it does not import or call repairOrFlagResponse.',
      'Confirmed via direct read: lib/providers/responseIntegrity.ts locally redefines its own copies of the same truncation-detection regexes already defined in lib/council/responseIntegrity.ts (e.g. TRUNCATED_WORD, BROKEN_BULLET, OPEN_TAIL, CLIPPED_ELLIPSIS_END, BROKEN_SYNC_TAIL) rather than importing them.',
      'Does not use any of the three documented honesty vocabularies.',
    ],
    limitations: [
      'CONFIRMED DIVERGENCE RISK: because the truncation-detection regex patterns are duplicated by copy rather than shared, a future tuning fix to one file\'s patterns will not automatically apply to the other. The enum-based classifier (providers/) and the text-repair function (council/) can silently diverge on whether the same text counts as truncated. Not fixed in Stage A per explicit scope boundary — disclosed here as a known limitation only.',
      'Both files independently define a type named ResponseIntegrityResult with different shapes ({text, integrityWarnings} in council/ vs. {integrity_status, confidence, reason, retry_recommended, fallback_recommended, degraded_quality?} in providers/) — a name collision, not a runtime conflict since nothing imports both under the same unaliased name, but a source of confusion.',
    ],
  },
  {
    disciplineId: 'research_planning',
    name: 'Research Planning',
    implementationStatus: 'runtime_wired',
    runtimeAuthority: 'enforcing',
    evidenceStatus: 'full',
    enforcementStatus: 'enforced',
    moduleLocations: ['lib/research/researchIntent.ts', 'lib/research/researchRouter.ts', 'lib/research/researchEvidence.ts'],
    dependencies: ['intelligence_packet_evidence_handling', 'retrieval_orchestration'],
    observations: [
      "Confirmed reachable via councilTrace.record('research_planned', ...) call sites referencing lib/research/researchIntent.ts:detectResearchIntent and lib/research/researchRouter.ts:runLiveResearchRouter.",
      'evaluateMandatoryLiveRetrieval decides, from decree text pattern matching, whether live retrieval is required for a request (current_events/weather/politics/crime_public_safety/business_economics/local_conditions/public_sentiment/breaking_developments/explicit_live_retrieval).',
      'When mandatory retrieval fails, a retrieval_failed/synthesis_allowed flag blocks current-fact synthesis and requires explicit disclosure in the resulting gap message — a real runtime block, not advisory.',
      'Real, enforced cost/timeout/size bounds confirmed: MAX_DIRECT=2 URLs, MAX_SNIPPET=2400 chars, FETCH_TIMEOUT_MS=12000, a content-type allowlist.',
      'Grok is used as framing-only, never real web search, and is explicitly labeled as such internally (note: framing_only_not_web_search) — this label is honest, but its contribution currently still affects the packet\'s numeric confidence score identically alongside genuine retrieval legs. See known limitations.',
      'The numeric confidence-weighting formula referenced in the known limitations below (Tavily/Grok/direct-fetch weights) lives specifically in lib/research/researchEvidence.ts, now listed in moduleLocations — the prior Stage A build omitted this file even though the limitation it documents was already accurate.',
      'Does not use any of the three documented honesty vocabularies directly; produces IntelligenceEvidenceItem/IntelligencePacket-shaped data whose verified_level field functions as a de facto truth label.',
    ],
    limitations: [
      "Known limitation: direct-fetch retrieval follows redirects (redirect: 'follow'), but only the original extracted URL is validated against the SSRF/private-host blocklist — the final resolved location after a redirect chain is never re-validated. Not fixed in Stage A.",
      "Known limitation: Grok's honestly-labeled framing-only contribution (+0.12) is weighted identically alongside genuine Tavily (+0.28) and direct-fetch (+0.22) legs in the packet's overall numeric confidence score (lib/research/researchEvidence.ts) — the label is honest, the number does not yet reflect it. Not fixed in Stage A.",
    ],
  },
  {
    disciplineId: 'retrieval_orchestration',
    name: 'Retrieval Orchestration',
    implementationStatus: 'runtime_wired',
    runtimeAuthority: 'observational',
    evidenceStatus: 'full',
    enforcementStatus: 'not_applicable',
    moduleLocations: ['lib/intelligence/sources/retrievalOrchestrator.ts'],
    dependencies: ['intelligence_packet_evidence_handling'],
    observations: [
      'Assembles the RetrievalOrchestration block embedded within IntelligencePacket, and is used by the hydration chain (hydrateLiveIntelligencePacket) that research_planning depends on.',
      'This discipline entry is grounded in the prior Phase 47B inventory passes\' confirmed import-chain findings rather than a fresh line-by-line read performed while authoring this registry; flagged explicitly per this repository\'s convention of disclosing provenance rather than implying uniform depth of investigation.',
      'enforcementStatus is not_applicable rather than not_enforced: this discipline assembles/orchestrates data for research_planning to enforce with; blocking behavior is not this discipline\'s own responsibility.',
      'Does not use any of the three documented honesty vocabularies.',
    ],
    limitations: ['Not independently re-verified line-by-line in this Stage A build session — relies on the prior discovery passes\' findings.'],
  },
  {
    disciplineId: 'intelligence_packet_evidence_handling',
    name: 'IntelligencePacket Evidence Handling',
    implementationStatus: 'runtime_wired',
    runtimeAuthority: 'observational',
    evidenceStatus: 'full',
    enforcementStatus: 'not_applicable',
    moduleLocations: [
      'lib/intelligence/intelligencePacket.ts',
      'lib/intelligence/evidenceScoring.ts',
      'lib/intelligence/contradictionScanner.ts',
      'lib/intelligence/confidenceClassifier.ts',
      'lib/intelligence/redTeamVerification.ts',
    ],
    dependencies: [],
    observations: [
      'This is the canonical, single evidence data model in the repository — IntelligenceEvidenceItem / IntelligencePacket, read/written consistently by the research/evidence pipeline. Not duplicated for the same purpose (see signals_intelligence_subsystem for a related-but-distinct model with a different purpose).',
      'No type literally named EvidenceReference or TruthLabel exists anywhere in the repository (confirmed by repository-wide search, zero hits for both exact names). verified_level (SourceVerifiedLevel: verified/semi_verified/unverified) is the functional equivalent of a TruthLabel under a different name — this registry does not invent a new name for it.',
      'IntelligenceEvidenceItem fields: id, source_id, source_type, source_label, verified_level, title, url, claim, content, observed_at, confidence, confidence_tier, corroboration_count, freshness, source_reputation, contradiction_flags, evidence_density, related_evidence_links, weak_signal.',
      'Does not use any of the three documented honesty vocabularies; it is itself the canonical evidence-truth model that a future reconciliation could map alongside them, not an instance of any of them.',
    ],
    limitations: [
      'Genuinely missing fields identified by prior inventory passes for a future Live Intel extension (not added in Stage A): commanderApprovalStatus, claimSupportType, sourceAccessClass. Several other previously-proposed fields (sourceId, sourceTrustTier, retrievedAt, freshnessStatus, contradictionStatus) already exist under different names and should not be duplicated.',
    ],
  },
  {
    disciplineId: 'signals_intelligence_subsystem',
    name: 'Signals Intelligence Subsystem',
    implementationStatus: 'runtime_wired',
    runtimeAuthority: 'observational',
    evidenceStatus: 'partial',
    enforcementStatus: 'not_applicable',
    moduleLocations: [
      'lib/signals/pipeline.ts',
      'lib/signals/sources.ts',
      'lib/signals/model.ts',
      'lib/signals/snapshot.ts',
      'lib/signals/persistence.ts',
      'lib/signals/operatorIntelligence.ts',
      'lib/signals/scoring.ts',
      'lib/signals/freshness.ts',
      'lib/signals/providers.ts',
    ],
    dependencies: ['queue_truth_labeling'],
    observations: [
      'Runtime-wired: confirmed real callers at six live API routes — app/api/signals/scan/route.ts, app/api/signals/results/route.ts, app/api/signals/sources/route.ts, app/api/signals/rss/poll/route.ts, app/api/signals/rss/status/route.ts, app/api/signals/federation/route.ts.',
      'Confirmed three real UI components: components/war-room/signals/SignalRadarPanel.tsx, SignalFederationPanel.tsx, components/intelligence/NewsIntelCommandWall.tsx.',
      'Confirmed real Supabase persistence: writes to and reads from war_room_signal_sources / _scans / _results / _scores / _alerts tables (persistence.ts).',
      'Confirmed real consumers beyond its own routes: lib/operator/deckPersistence.ts, lib/queues/queueIntelligence.ts, lib/runtime-graph/collect.ts, lib/war-room-sweep/collectors/signals.ts, lib/income-workers/scoutOrchestrator.ts.',
      'This subsystem is parallel to IntelligencePacket rather than an extension of it — it serves a different purpose (income/opportunity signal scanning and scoring), and maintains its own confidence model (SignalScores.confidence), its own freshness vocabulary (SignalFreshnessStatus: LIVE/RECENT/STALE/ARCHIVAL/UNKNOWN_DATE, distinct in value set from IntelligencePacket\'s EvidenceFreshness: live/recent/aging/stale/unknown), and its own contradiction-handling module (lib/signals/contradictions/*, not shared with lib/intelligence/contradictionScanner.ts).',
      'This is a confirmed third independent Tavily/Firecrawl integration point in the repository — lib/signals/sources.ts reads TAVILY_API_KEY/FIRECRAWL_API_KEY directly and builds its own source registry, independent of both lib/research/researchRouter.ts and the income-scout subsystem (lib/income/tavily.ts, lib/income/firecrawl.ts).',
      'Maps its own signal results into QueueTruthLabel via lib/signals/operatorIntelligence.ts — this is the third honesty vocabulary documented in this registry, and lib/signals is one of its active producers, not merely a theoretical consumer.',
      'Every SignalResult hardcodes guardrails: { sourceBacked: true, recommendationOnly: true, approvalRequired: true, externalExecutionAllowed: false, hiddenExecutionAllowed: false, incomeClaimed: false }. Every SignalAlert hardcodes approvalRequired: true, canExecute: false. Snapshot-level guardrails hardcode noAutomaticOutreachSpendApplicationsOrExecution: true and approvalRequiredBeforeAction: true.',
      'No scheduled/background execution found for this subsystem — runSignalScan() only runs when its API route is hit; no cron/scheduler wiring exists.',
      'evidenceStatus is marked partial specifically because this subsystem produces evidence-shaped data through its own separate model, not through the canonical IntelligencePacket type — the two evidence models are not reconciled.',
    ],
    limitations: [
      'Confirmed duplication, not overstated as canonical Live Intel: separate confidence model, separate freshness vocabulary, separate contradiction-handling module, and a third independent Tavily/Firecrawl integration relative to research_planning and the income-scout subsystem. Not consolidated in Stage A per explicit scope boundary.',
      'Not individually line-read in this pass beyond the core files listed above: lib/signals/classification/*, lib/signals/credibility/*, lib/signals/contradictions/*, lib/signals/router/*, lib/signals/rss/*, lib/signals/scoring/* were confirmed wired via the import graph (pipeline.ts directly imports applySignalClassificationPipeline, runFederatedSignalIngestion, dedupeAndRankSignals, scoreSignalItem) but not individually read line-by-line.',
    ],
  },
  {
    disciplineId: 'red_team_integrity_layer',
    name: 'Red Team Integrity Layer',
    implementationStatus: 'runtime_wired',
    runtimeAuthority: 'enforcing',
    evidenceStatus: 'not_applicable',
    enforcementStatus: 'enforced',
    moduleLocations: ['lib/council/redTeamTriggers.ts', 'lib/council/redTeamHold.ts'],
    dependencies: [],
    observations: [
      "Confirmed reachable via councilTrace.record('red_team_checked', ...) call sites in app/api/chat/route.ts.",
      'Red Team is explicitly and correctly NOT represented as an external provider anywhere in the runtime trace output: sourceType is recorded as integrity_layer and externalProviderCallCompleted is recorded as false. This registry preserves that same honest framing rather than describing Red Team as a fifth provider family.',
      'Keyword-trigger heuristics (textContainsRedTeamRiskKeywords, shouldInjectRedTeamEarly) that gate whether/when Red Team is injected into a response — this is a real runtime enforcement mechanism, not advisory.',
      'Does not use any of the three documented honesty vocabularies directly, but its own sourceType/externalProviderCallCompleted pairing is the same style of honest self-labeling this registry aims to formalize repository-wide.',
    ],
    limitations: [],
  },
  {
    disciplineId: 'memory_evaluation',
    name: 'Memory Evaluation',
    implementationStatus: 'runtime_wired',
    runtimeAuthority: 'observational',
    evidenceStatus: 'not_applicable',
    enforcementStatus: 'not_applicable',
    moduleLocations: ['lib/memory/ingestFromModel.ts'],
    dependencies: [],
    observations: [
      "Confirmed reachable via councilTrace.record('memory_recommendation_recorded', { module: 'lib/memory/ingestFromModel.ts:tryPersistMemoryProposalFromModelOutput' }).",
      'Proposal-only: insertMemoryProposal always creates a row with pending status and never auto-approves. Marked observational rather than enforcing because it does not block or alter the Council response itself — it only records a proposal for separate Commander review.',
      'enforcementStatus is not_applicable rather than not_enforced: recording a pending proposal is this discipline\'s entire current responsibility; it has no enforcement mandate of its own to be incomplete.',
      'Does not use any of the three documented honesty vocabularies.',
    ],
    limitations: [],
  },
  {
    disciplineId: 'council_reporting',
    name: 'Council Reporting',
    implementationStatus: 'partial',
    runtimeAuthority: 'observational',
    evidenceStatus: 'not_applicable',
    enforcementStatus: 'not_applicable',
    moduleLocations: ['app/api/chat/route.ts'],
    dependencies: [],
    observations: [
      "Confirmed at app/api/chat/route.ts: reportType: 'minimal_trace_envelope', canonicalCouncilReportGenerated: false.",
      'No canonical Council Report engine exists in the repository. This registry does not describe Council Report as a canonical engine — it remains minimal_trace_envelope, a lightweight diagnostic construct built inline across several route.ts branches, not a dedicated reporting module.',
      "Uses CouncilTraceObservationMode indirectly via runtime_diagnostics' own trace envelope, but has no honesty label of its own beyond the reportType/canonicalCouncilReportGenerated pair.",
    ],
    limitations: ['No dedicated module exists; construction is inline and distributed across route.ts branches, consistent with its own minimal_trace_envelope self-description.'],
  },
  {
    disciplineId: 'runtime_diagnostics',
    name: 'Runtime Diagnostics (Commander Runtime Diagnostics)',
    implementationStatus: 'runtime_wired',
    runtimeAuthority: 'observational',
    evidenceStatus: 'not_applicable',
    enforcementStatus: 'not_applicable',
    moduleLocations: ['lib/council/runtimeTrace.ts', 'lib/council/traceTestRoute.ts', 'app/api/council/trace-test/route.ts'],
    dependencies: [],
    observations: [
      'Committed and pushed as Phase 47A, independently reviewed across five review rounds in that phase\'s history, including a real mutation-safety defect and a real secret-redaction false-positive found and fixed during those reviews.',
      'Commander-only, environment-gated (assertLiveActionsAllowed() then requireCommanderSession()), strictly observational: featureType: commander_diagnostic, executionAuthority: none, memoryWriteAuthority: none, providerControlAuthority: none.',
      'Defines and uses CouncilTraceObservationMode (runtime_observed / inferred) — the first of the three documented honesty vocabularies — to distinguish stages that genuinely executed from stages that are inferred/labeled without direct observation (e.g. scope_guardian_checked is marked inferred with an explicit "not yet integrated in 47A-1" note).',
    ],
    limitations: [],
  },
  {
    disciplineId: 'forecast_outcome_tracking',
    name: 'Forecast & Outcome Tracking',
    implementationStatus: 'seed_only',
    runtimeAuthority: 'none',
    evidenceStatus: 'partial',
    enforcementStatus: 'not_applicable',
    moduleLocations: ['lib/learning/forecastingEngine.ts', 'lib/learning/outcomeLedger.ts', 'lib/learning/persistence/forecastPersistence.ts'],
    dependencies: [],
    observations: [
      'A real outcome-tracking schema and scoring math exist: the war_room_forecast_feedback table (Phase 9B) and calculateForecastFeedbackMetrics() compute genuine variance/confidence-accuracy from predicted-vs-actual data when real rows exist.',
      'STRATEGIC_FORECASTS (forecastingEngine.ts) is hardcoded static seed data with realistic-looking confidence/accuracy/successScore numbers. It is not labeled static_seed at its own data level — only a separate integration-status check (buildLearningIntegrationSnapshot, using LearningIntegrationStatus) knows the persisted-outcome side is empty.',
      'No code path exists that creates a real forecast_id-linked row in war_room_forecast_feedback when an actual Council forecast claim is made. There is no forecast creation-to-resolution pipeline.',
      'Current calibrated forecast count is effectively zero: a bare probability number with no live creation-to-resolution wiring is not a calibrated forecast, even though the resolution-side persistence and scoring code is real, working code and not placeholder.',
      "This discipline should report its own status using LearningIntegrationStatus's vocabulary once wired (e.g. patternsWorkflow panel status in buildLearningIntegrationSnapshot already does, using 'static_seed' when no economic workflow rows have arrived yet), rather than inventing a separate forecast-specific status vocabulary.",
      "Reconciling this entry's implementationStatus ('seed_only') against LearningIntegrationStatus's own 'static_seed' value: (1) this registry uses 'seed_only' to describe the discipline's present ARCHITECTURAL MATURITY — its code is a hardcoded demo array, not a live creation-to-resolution pipeline; (2) the underlying forecast demo data (STRATEGIC_FORECASTS) should truthfully use or expose 'static_seed' at the data/integration layer via LearningIntegrationStatus, the same way patternsWorkflow's panel status already does — it currently does not, at its own data level (verified: 'static_seed' is assigned only to the patternsWorkflow panel in lib/learning/integrationStatus.ts, not to outcomeLedger, which can only report live_persistent/persistent_store/derived_from_existing_store/awaiting_data); (3) this registry is not replacing or subsuming LearningIntegrationStatus, it is a separate, orthogonal layer; (4) the known limitation remains, unresolved: realistic-looking seed records are not labeled static_seed at their own data level, so a reader encountering STRATEGIC_FORECASTS directly (rather than via the separate integration-status snapshot) could mistake it for real calibration history.",
    ],
    limitations: [
      'Static seed data (STRATEGIC_FORECASTS, OUTCOME_LEDGER_ENTRIES) is not labeled static_seed at the data level itself — a reader could mistake it for real calibration history if surfaced without the separate integration-status context. Not fixed in Stage A.',
      'No forecast creation-to-resolution wiring exists — this is required before any Prophet-style calibrated forecast can be considered meaningful, and is explicitly out of scope for Stage A.',
    ],
  },
  {
    disciplineId: 'queue_truth_labeling',
    name: 'Queue Truth Labeling',
    implementationStatus: 'runtime_wired',
    runtimeAuthority: 'observational',
    evidenceStatus: 'not_applicable',
    enforcementStatus: 'not_applicable',
    moduleLocations: ['lib/queues/types.ts', 'lib/signals/operatorIntelligence.ts'],
    dependencies: [],
    observations: [
      'QueueTruthLabel (SOURCE_BACKED / PROPOSED / APPROVAL_REQUIRED / UNAVAILABLE) is the third documented honesty vocabulary in this registry, alongside CouncilTraceObservationMode and LearningIntegrationStatus.',
      'Actively consumed, not a dormant type: lib/signals/operatorIntelligence.ts maps real signal results into QueueTruthLabel values when constructing QueueItem records.',
      'Every QueueItem also hardcodes canExecute: false, and every QueueSnapshot hardcodes guardrails: { noAutonomousExecution: true, approvalGatesPreserved: true, ... } — consistent with the same recommendation-only discipline pattern found in lib/signals directly.',
      'This registry does not replace QueueTruthLabel or map it into a new registry-level enum; it is documented as-is per Stage A\'s explicit constraint.',
    ],
    limitations: [],
  },
]

// ---------------------------------------------------------------------------
// Pure, static helpers — no I/O, no side effects, no runtime routing.
// ---------------------------------------------------------------------------

export function listDisciplineIds(): string[] {
  return DISCIPLINE_REGISTRY.map(entry => entry.disciplineId)
}

export function getDisciplineById(disciplineId: string): DisciplineRegistryEntry | undefined {
  return DISCIPLINE_REGISTRY.find(entry => entry.disciplineId === disciplineId)
}

export function listDisciplinesByImplementationStatus(status: DisciplineImplementationStatus): DisciplineRegistryEntry[] {
  return DISCIPLINE_REGISTRY.filter(entry => entry.implementationStatus === status)
}
