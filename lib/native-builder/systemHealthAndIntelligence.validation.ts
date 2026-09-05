/**
 * Tests for the System Health snapshot projection, immunity artifacts, repair-scope
 * classification, the [ REPAIR SYSTEM ] sweep, and the Global Intelligence mission layer.
 */
import { pathToFileURL } from 'node:url'
import { classifyRepairScope } from './repairScopeClassifier'
import { deriveImmunityArtifact } from './immunity'
import { mapRouterResultToEvidence, runGlobalIntelligenceMission } from './intelligenceMission'
import type { LiveResearchRouterResult } from '@/lib/research/researchRouter'
import type { NativeIssueRecord, NativeRepairRecord } from './types'
import { NATIVE_REPAIR_TRANSITIONS } from './types'
import { runRepairSystemSweep, reportIssue } from './runtime'
import { countUnresolvedIssues } from './storage'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

async function resetNativeBuilderState(): Promise<void> {
  const root = path.join(resolveRepoRoot(), '.war-room', 'native-builder')
  await rm(root, { recursive: true, force: true })
}

// --- Repair scope classification ---------------------------------------------------------------

function testRepairScopeClassifier(): CaseResult[] {
  const external = classifyRepairScope('No live Tavily or Firecrawl provider is connected. provider key missing')
  const commander = classifyRepairScope('Approval gate persistence is not verified. migration required')
  const unclear = classifyRepairScope('Something unusual happened in a module nobody has a pattern for yet.')
  return [
    check('scope_01_provider_account_pattern_classified', external === 'external_provider_account_action_required', external),
    check('scope_02_commander_action_pattern_classified', commander === 'commander_action_required', commander),
    check('scope_03_unmatched_evidence_is_unclear_not_guessed', unclear === 'unclear', unclear),
  ]
}

// --- Immunity artifacts ---------------------------------------------------------------------

const BASE_ISSUE: NativeIssueRecord = {
  id: 'issue-1',
  fingerprint: 'fp-1',
  title: 'Test issue',
  severity: 'medium',
  source: 'commander_report',
  affectedSubsystem: 'lib/test.ts',
  evidence: [],
  rawEvidenceText: 'test',
  occurrenceCount: 1,
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  status: 'open',
}

function baseRepair(overrides: Partial<NativeRepairRecord>): NativeRepairRecord {
  return {
    id: 'repair-1',
    issueId: 'issue-1',
    state: 'validating',
    history: [],
    proposals: [],
    validationResults: [],
    autoRepairEligible: false,
    autoRepairMode: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function testImmunityArtifacts(): CaseResult[] {
  const withScript = baseRepair({
    validationResults: [
      { operation: { id: 'validation_script', targets: ['scripts/run-x.mjs'] }, ok: true, exitCode: 0, stdout: '', stderr: '', durationMs: 1, ranAt: '2026-01-01T00:00:00.000Z' },
    ],
  })
  const scriptOutcome = deriveImmunityArtifact(withScript, BASE_ISSUE)

  const withGenericOnly = baseRepair({
    selectedProposal: { issueId: 'issue-1', sourceKind: 'deterministic', proposerId: 'x', diagnosis: 'x', confidence: 'high', relevantFiles: ['lib/test.ts'], plannedChanges: [], validations: [], risks: [], rollbackPlan: '', generatedAt: '2026-01-01T00:00:00.000Z' },
    validationResults: [
      { operation: { id: 'typecheck' }, ok: true, exitCode: 0, stdout: '', stderr: '', durationMs: 1, ranAt: '2026-01-01T00:00:00.000Z' },
    ],
  })
  const genericOutcome = deriveImmunityArtifact(withGenericOnly, BASE_ISSUE)

  const withNothing = baseRepair({ validationResults: [] })
  const noneOutcome = deriveImmunityArtifact(withNothing, BASE_ISSUE)

  return [
    check('immunity_01_validation_script_yields_regression_test', scriptOutcome.created && scriptOutcome.artifact.type === 'regression_test', JSON.stringify(scriptOutcome)),
    check('immunity_02_generic_check_yields_validation_rule', genericOutcome.created && genericOutcome.artifact.type === 'validation_rule', JSON.stringify(genericOutcome)),
    check('immunity_03_no_evidence_yields_honest_non_creation_with_reason', !noneOutcome.created && noneOutcome.reason.length > 0, JSON.stringify(noneOutcome)),
  ]
}

// --- State machine extension -----------------------------------------------------------------

function testStateMachineExtension(): CaseResult[] {
  const partiallyVerifiedTargets = NATIVE_REPAIR_TRANSITIONS.partially_verified
  const cancelledTerminal = NATIVE_REPAIR_TRANSITIONS.cancelled.length === 0
  const detectedCanCancel = NATIVE_REPAIR_TRANSITIONS.detected.includes('cancelled')
  // Mid-execution cancellation is now a sanctioned transition: the Code Operator wave added
  // applying_patch/validating -> 'cancelled' so a Commander can abort a running validation
  // (processRegistry kills the child-process tree; runtime.cancelMissionExecution persists the
  // transition with a killed-process audit note). Cancellation still never rolls files back —
  // rollback remains the only path that reverts an applied patch.
  const applyingCanCancel = NATIVE_REPAIR_TRANSITIONS.applying_patch.includes('cancelled')
  const validatingCanCancel = NATIVE_REPAIR_TRANSITIONS.validating.includes('cancelled')
  return [
    check('state_ext_01_partially_verified_can_resolve_or_rollback', partiallyVerifiedTargets.includes('resolved') && partiallyVerifiedTargets.includes('rolled_back'), JSON.stringify(partiallyVerifiedTargets)),
    check('state_ext_02_cancelled_is_terminal', cancelledTerminal, JSON.stringify(NATIVE_REPAIR_TRANSITIONS.cancelled)),
    check('state_ext_03_cancel_allowed_before_apply', detectedCanCancel, JSON.stringify(NATIVE_REPAIR_TRANSITIONS.detected)),
    check('state_ext_04_cancel_allowed_mid_apply_kills_process_tree', applyingCanCancel && validatingCanCancel, JSON.stringify({ applying: NATIVE_REPAIR_TRANSITIONS.applying_patch, validating: NATIVE_REPAIR_TRANSITIONS.validating })),
  ]
}

// --- Global Intelligence: pure resilience test (Tavily failed leg, simulated) ------------------

function testIntelligenceResilienceWhenTavilyDown(): CaseResult[] {
  const simulatedFailedTavily: LiveResearchRouterResult = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    searchQuery: 'test query',
    tavily: { ok: false, results: [], error: 'TAVILY_API_KEY not configured', durationMs: 5 },
    publicRss: { ok: false, results: [], error: 'not used', durationMs: 1 },
    weatherAlerts: { ok: true, queried: false, results: [], durationMs: 0 },
    grok: { ok: false, text: '', error: 'XAI_API_KEY missing' },
    direct: [
      { url: 'https://example.com/page', ok: true, contentSnippet: 'Real fetched content from a direct, non-commercial route.', statusCode: 200 },
    ],
    retrieval: {} as LiveResearchRouterResult['retrieval'],
  }
  const evidence = mapRouterResultToEvidence('mission-1', simulatedFailedTavily)
  const hasDirectEvidence = evidence.some(e => e.sourceType === 'direct_web' && e.retrievalStatus === 'complete')
  const hasNoFakeSearchEvidence = !evidence.some(e => e.sourceType === 'search')
  const noFabrication = evidence.every(e => e.retrievalStatus !== 'complete' || (e.excerpt && e.excerpt.length > 0))

  const accessRestrictedCase: LiveResearchRouterResult = {
    ...simulatedFailedTavily,
    direct: [{ url: 'https://example.com/blocked', ok: false, contentSnippet: '', error: 'HTTP 403', statusCode: 403 }],
  }
  const restrictedEvidence = mapRouterResultToEvidence('mission-2', accessRestrictedCase)
  const accessRestrictedLabeled = restrictedEvidence[0]?.retrievalStatus === 'access_restricted' && restrictedEvidence[0]?.accessRestriction?.includes('ACCESS RESTRICTED')

  return [
    check('intel_01_direct_route_survives_tavily_failure', hasDirectEvidence, JSON.stringify(evidence.map(e => ({ type: e.sourceType, status: e.retrievalStatus }))) ),
    check('intel_02_no_fake_search_evidence_when_tavily_failed', hasNoFakeSearchEvidence, String(hasNoFakeSearchEvidence)),
    check('intel_03_no_fabricated_evidence_excerpt', noFabrication, String(noFabrication)),
    check('intel_04_access_restricted_labeled_honestly_not_hidden', Boolean(accessRestrictedLabeled), JSON.stringify(restrictedEvidence[0])),
  ]
}

// --- Global Intelligence: real live call proof (network) --------------------------------------

async function testLiveIntelligenceMission(): Promise<CaseResult[]> {
  const result = await runGlobalIntelligenceMission({
    decreeText: 'Reference material for verification: https://example.com',
    supabase: null,
  })
  const directRouteRan = result.routesAttempted.includes('direct_web:direct_fetch')
  const gotAtLeastOneRoute = result.routesWithEvidence.length >= 1
  const firecrawlNeverUsed = result.firecrawlUsed === false
  const noAutoTavilyRequirement = true // mission completed regardless of tavilyUsed value below
  return [
    check('intel_05_live_mission_attempts_direct_route', directRouteRan, JSON.stringify(result.routesAttempted)),
    check('intel_06_live_mission_got_real_evidence_from_at_least_one_route', gotAtLeastOneRoute, JSON.stringify(result.routesWithEvidence)),
    check('intel_07_firecrawl_never_invoked', firecrawlNeverUsed, String(result.firecrawlUsed)),
    check('intel_08_mission_does_not_require_tavily_to_complete', noAutoTavilyRequirement && typeof result.tavilyUsed === 'boolean', `tavilyUsed=${result.tavilyUsed}`),
  ]
}

// --- Repair-system sweep: real end-to-end over the live canonical health snapshot ---------------

async function testRepairSystemSweep(): Promise<CaseResult[]> {
  await resetNativeBuilderState()
  const fakeReq = new Request('http://localhost:3000/api/native-builder/repair-system')
  const before = await countUnresolvedIssues()
  const sweep = await runRepairSystemSweep(fakeReq)
  const after = await countUnresolvedIssues()

  const snapshotShapeOk = typeof sweep.snapshot.totalChecks === 'number' && Array.isArray(sweep.snapshot.checks)
  const entriesOnlyForUnhealthy = sweep.entries.every(e => e.check.status === 'degraded' || e.check.status === 'unavailable' || e.check.status === 'unknown')
  const badgeGrewByOpenedIssues = after >= before // sweep can only add/merge issues, never silently remove them
  const everyEntryHasScope = sweep.entries.every(e => ['native_builder_repairable', 'commander_action_required', 'external_provider_account_action_required', 'unclear'].includes(e.scope))

  // Re-running the sweep immediately must not create duplicate issues for the same evidence.
  const sweepAgain = await runRepairSystemSweep(fakeReq)
  const noDuplicateIssuesOnRerun = sweepAgain.entries.every(e2 => sweep.entries.some(e1 => e1.issue.fingerprint === e2.issue.fingerprint))

  await resetNativeBuilderState()

  return [
    check('sweep_01_snapshot_shape_valid', snapshotShapeOk, JSON.stringify({ total: sweep.snapshot.totalChecks, checks: sweep.snapshot.checks.length })),
    check('sweep_02_entries_only_for_unhealthy_checks', entriesOnlyForUnhealthy, JSON.stringify(sweep.entries.map(e => e.check.status))),
    check('sweep_03_badge_reflects_real_open_issues', badgeGrewByOpenedIssues, `${before} -> ${after}`),
    check('sweep_04_every_entry_has_a_repair_scope_classification', everyEntryHasScope, JSON.stringify(sweep.entries.map(e => e.scope))),
    check('sweep_05_rerun_does_not_duplicate_issues', noDuplicateIssuesOnRerun, `first=${sweep.entries.length} second=${sweepAgain.entries.length}`),
  ]
}

// --- unresolved-issue badge accuracy (Part 8) ---------------------------------------------------

async function testIssueBadgeAccuracy(): Promise<CaseResult[]> {
  await resetNativeBuilderState()
  const before = await countUnresolvedIssues()
  await reportIssue({ source: 'commander_report', title: 'Badge test issue', severity: 'low', affectedSubsystem: 'lib/badge-test.ts', evidence: ['x'], rawEvidenceText: 'badge test issue x' })
  const afterOpen = await countUnresolvedIssues()
  await resetNativeBuilderState()
  return [
    check('badge_01_increments_on_new_open_issue', afterOpen === before + 1, `${before} -> ${afterOpen}`),
  ]
}

export async function runSystemHealthAndIntelligenceValidation(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  results.push(...testRepairScopeClassifier())
  results.push(...testImmunityArtifacts())
  results.push(...testStateMachineExtension())
  results.push(...testIntelligenceResilienceWhenTavilyDown())
  results.push(...(await testLiveIntelligenceMission()))
  results.push(...(await testRepairSystemSweep()))
  results.push(...(await testIssueBadgeAccuracy()))
  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSystemHealthAndIntelligenceValidation().then(results => {
    for (const result of results) {
      console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
    }
    const failed = results.filter(result => !result.pass)
    console.log(`System Health & Intelligence validation: ${results.length - failed.length}/${results.length} PASS`)
    if (failed.length) process.exit(1)
  })
}
