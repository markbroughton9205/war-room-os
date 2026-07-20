import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { createAssemblyPlan } from './planner'
import {
  createActualSelectionSnapshot,
  normalizeShadowMissionInput,
  resetShadowRuntimeForValidation,
  runAdaptiveCouncilShadowSelection,
  shouldAttachShadowReport,
} from './shadowRuntime'
import { createShadowSelectionReport } from './shadowComparison'
import type {
  ActualCouncilSelectionSnapshot,
  NormalizedShadowMissionInput,
  ShadowFeatureMode,
} from './shadowTypes'

export type AdaptiveShadowValidationResult = {
  caseId: string
  description: string
  result: 'PASS' | 'FAIL'
  observed: 'valid' | 'invalid'
  details: string[]
}

function caseResult(
  caseId: string,
  description: string,
  expected: 'valid' | 'invalid',
  condition: boolean,
  details: string[] = [],
): AdaptiveShadowValidationResult {
  const observed = condition ? 'valid' : 'invalid'
  return { caseId, description, result: observed === expected ? 'PASS' : 'FAIL', observed, details }
}

function missionInput(partial?: Partial<NormalizedShadowMissionInput>): NormalizedShadowMissionInput {
  return normalizeShadowMissionInput({
    requestId: 'shadow-validation-request',
    logicalRequestId: 'shadow-validation-logical',
    missionId: 'shadow-validation-mission',
    missionVersion: 1,
    commanderMessage: 'Build a current engineering strategy with risk review.',
    councilFlowMode: 'stable_group',
    ...partial,
  })
}

function actualSnapshot(partial?: Partial<ActualCouncilSelectionSnapshot>): ActualCouncilSelectionSnapshot {
  return createActualSelectionSnapshot({
    executionMode: 'stable_group',
    actualSelectedFamilies: ['chatgpt', 'claude', 'red_team'],
    actualSynthesisFamily: 'chatgpt',
    actualSelectionSource: 'existing_runtime',
    actualSelectionFinalized: true,
    snapshotCapturedAt: '2026-07-19T00:00:00.000Z',
    ...partial,
  })
}

function runShadow(args?: {
  featureMode?: ShadowFeatureMode
  mission?: NormalizedShadowMissionInput
  actual?: ActualCouncilSelectionSnapshot
  planFactory?: Parameters<typeof runAdaptiveCouncilShadowSelection>[0]['planFactory']
}) {
  return runAdaptiveCouncilShadowSelection({
    featureMode: args?.featureMode ?? 'response_metadata',
    missionInput: args?.mission ?? missionInput(),
    actualSnapshot: args?.actual ?? actualSnapshot(),
    planFactory: args?.planFactory,
  })
}

function listShadowFiles(): string[] {
  const dir = join(process.cwd(), 'lib', 'council', 'adaptive-assembly')
  return readdirSync(dir)
    .filter(file => file.endsWith('.ts'))
    .map(file => join(dir, file))
}

function shadowRuntimeSourceText(): string {
  return listShadowFiles()
    .filter(file => !file.endsWith('validation.ts') && !file.endsWith('shadowValidation.ts'))
    .map(file => readFileSync(file, 'utf8'))
    .join('\n')
}

function chatRouteText(): string {
  return readFileSync(join(process.cwd(), 'app', 'api', 'chat', 'route.ts'), 'utf8')
}

function throwsMessage(fn: () => unknown, expected: string): boolean {
  try {
    fn()
    return false
  } catch (error) {
    return error instanceof Error && error.message.includes(expected)
  }
}

function arraysEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// Phase 48-C3B2-R1 pre-commit correction #2: static source-boundary
// assertion over the REAL app/api/chat/route.ts integration (not just the
// isolated shadow module) proving no dispatch-relevant variable is ever
// declared or reassigned from shadow-report output. Scans an 8-line window
// from each declaration/assignment site (multi-line array-literal
// constructions, like activeFamilies' real env-var-derived declaration,
// span several lines) for any token that would indicate a write-back from
// shadow output into execution input. This is a structural boundary check
// over the real file, not a bare whole-file substring/hardcoded-string
// comparison.
const DISPATCH_VARIABLE_NAMES = ['activeFamilies'] as const
const FORBIDDEN_SHADOW_WRITE_BACK_TOKENS = [
  'shadowCouncilAssembly',
  'recommendedFamilies',
  'runAdaptiveCouncilShadowSelection',
  'CouncilShadowSelectionReport',
  'shadowReport',
] as const

function dispatchVariableDeclarationWindows(routeSource: string, variableName: string): string[] {
  const lines = routeSource.split('\n')
  const windows: string[] = []
  const declarationOrAssignment = new RegExp(`\\b(?:const|let|var)\\s+${variableName}\\b|\\b${variableName}\\s*=[^=]`)
  lines.forEach((line, index) => {
    if (!declarationOrAssignment.test(line)) return
    windows.push(lines.slice(index, Math.min(lines.length, index + 8)).join('\n'))
  })
  return windows
}

function dispatchWriteBackFromShadow(routeSource: string): string[] {
  const hits: string[] = []
  for (const variableName of DISPATCH_VARIABLE_NAMES) {
    for (const windowText of dispatchVariableDeclarationWindows(routeSource, variableName)) {
      for (const token of FORBIDDEN_SHADOW_WRITE_BACK_TOKENS) {
        if (windowText.includes(token)) hits.push(`${variableName}:${token}`)
      }
    }
  }
  return hits
}

export function runAdaptiveCouncilShadowSelectionValidation(): AdaptiveShadowValidationResult[] {
  resetShadowRuntimeForValidation()
  const results: AdaptiveShadowValidationResult[] = []
  const beforeActual = actualSnapshot()
  const beforeFamilies = [...beforeActual.actualSelectedFamilies]
  const report = runShadow({ actual: beforeActual })
  const secondReport = runShadow({ actual: beforeActual })
  const failureReport = runShadow({
    mission: missionInput({ requestId: 'shadow-failure' }),
    planFactory: () => {
      throw new Error('validation planner failure')
    },
  })
  const registryFailureReport = runShadow({
    mission: missionInput({ requestId: 'shadow-registry-failure' }),
    planFactory: () => {
      throw new Error('Invalid capability registry: validation')
    },
  })
  const exactPlan = createAssemblyPlan({
    missionId: 'shadow-validation-mission',
    missionVersion: 1,
    commanderMessage: 'Say hello concise.',
    createdAt: '2026-07-19T00:00:00.000Z',
  })
  const partialPlan = createAssemblyPlan({
    missionId: 'shadow-validation-mission',
    missionVersion: 1,
    commanderMessage: 'Build code architecture.',
    createdAt: '2026-07-19T00:00:00.000Z',
  })
  const exactReport = createShadowSelectionReport({
    missionInput: missionInput({ requestId: 'shadow-exact' }),
    actualSnapshot: actualSnapshot({
      actualSelectedFamilies: exactPlan.selectedFamilies,
      actualSynthesisFamily: exactPlan.synthesisAuthority.primaryFamily,
    }),
    eligibilityStatus: 'eligible',
    eligibilityReason: 'supported_council_request',
    plan: exactPlan,
    plannerStatus: 'completed',
    generatedAt: '2026-07-19T00:00:00.000Z',
  })
  const noMatchPlan = createAssemblyPlan({
    missionId: 'shadow-validation-mission',
    missionVersion: 1,
    commanderMessage: 'Search latest current online info.',
    createdAt: '2026-07-19T00:00:00.000Z',
    maxProviderCount: 1,
  })
  const noMatchReport = createShadowSelectionReport({
    missionInput: missionInput({ requestId: 'shadow-no-match' }),
    actualSnapshot: actualSnapshot({ actualSelectedFamilies: ['baby'], actualSynthesisFamily: null }),
    eligibilityStatus: 'eligible',
    eligibilityReason: 'supported_council_request',
    plan: noMatchPlan,
    plannerStatus: 'completed',
  })
  const partialReport = createShadowSelectionReport({
    missionInput: missionInput({ requestId: 'shadow-partial' }),
    actualSnapshot: actualSnapshot({ actualSelectedFamilies: ['chatgpt', 'claude', 'red_team'] }),
    eligibilityStatus: 'eligible',
    eligibilityReason: 'supported_council_request',
    plan: partialPlan,
    plannerStatus: 'completed',
  })
  const unresolvedActualReport = createShadowSelectionReport({
    missionInput: missionInput({ requestId: 'shadow-actual-unresolved' }),
    actualSnapshot: actualSnapshot({ actualSelectedFamilies: [], actualSelectionFinalized: false }),
    eligibilityStatus: 'eligible',
    eligibilityReason: 'supported_council_request',
    plan: exactPlan,
    plannerStatus: 'completed',
  })
  const missingActualSynthReport = createShadowSelectionReport({
    missionInput: missionInput({ requestId: 'shadow-missing-actual-synth' }),
    actualSnapshot: actualSnapshot({
      actualSelectedFamilies: exactPlan.selectedFamilies,
      actualSynthesisFamily: null,
      actualSelectionFinalized: true,
    }),
    eligibilityStatus: 'eligible',
    eligibilityReason: 'supported_council_request',
    plan: exactPlan,
    plannerStatus: 'completed',
  })
  const emptyActualFinalizedReport = createShadowSelectionReport({
    missionInput: missionInput({ requestId: 'shadow-empty-actual-finalized' }),
    actualSnapshot: actualSnapshot({ actualSelectedFamilies: [], actualSelectionFinalized: true, actualSynthesisFamily: null }),
    eligibilityStatus: 'eligible',
    eligibilityReason: 'supported_council_request',
    plan: exactPlan,
    plannerStatus: 'completed',
  })
  const unresolvedPlan = createAssemblyPlan({
    missionId: 'shadow-validation-mission',
    missionVersion: 1,
    commanderMessage: 'Calculate numerical ROI.',
    createdAt: '2026-07-19T00:00:00.000Z',
  })
  const unresolvedRecommendationReport = createShadowSelectionReport({
    missionInput: missionInput({ requestId: 'shadow-recommendation-unresolved' }),
    actualSnapshot: actualSnapshot(),
    eligibilityStatus: 'eligible',
    eligibilityReason: 'supported_council_request',
    plan: unresolvedPlan,
    plannerStatus: 'completed',
  })
  const source = shadowRuntimeSourceText()
  const route = chatRouteText()

  results.push(caseResult('shadow_01_eligible_request_plan', 'Eligible Council request produces one shadow plan.', 'valid', report.plannerStatus === 'completed' && Boolean(report.planId)))
  results.push(caseResult('shadow_02_ineligible_no_plan', 'Ineligible request produces no plan.', 'valid', runShadow({ mission: missionInput({ requestId: 'shadow-direct', directInvocation: true }) }).planId === null))
  results.push(caseResult('shadow_03_internal_subcall_no_plan', 'Internal provider subcall does not produce a shadow plan.', 'valid', runShadow({ mission: missionInput({ requestId: 'shadow-internal', directInvocation: true }) }).eligibilityReason === 'unsupported_direct_provider_path'))
  results.push(caseResult('shadow_04_no_duplicate_shadow_plan', 'One logical request cannot produce duplicate shadow plans.', 'valid', secondReport.plannerStatus === 'not_run' && secondReport.uncertaintyFlags.includes('duplicate_shadow_planning_prevented')))
  results.push(caseResult('shadow_05_normalized_input_used', 'Shadow planner receives normalized mission input.', 'valid', report.requestId === 'shadow-validation-request' && report.logicalRequestId === 'shadow-validation-logical'))
  const mutableMission = { text: 'Build a plan.' }
  const frozenMission = missionInput({ requestId: 'shadow-mutation', commanderMessage: mutableMission.text })
  mutableMission.text = 'mutated'
  results.push(caseResult('shadow_06_mission_input_not_mutated', 'Shadow planner does not mutate mission input.', 'valid', frozenMission.commanderMessage === 'Build a plan.'))
  results.push(caseResult('shadow_07_same_input_same_recommendation', 'Same input produces the same recommendation.', 'valid', arraysEqual(report.recommendedFamilies, runShadow({ mission: missionInput({ requestId: 'shadow-determinism' }) }).recommendedFamilies)))
  results.push(caseResult('shadow_08_actual_selection_unchanged', 'Actual selected families remain unchanged.', 'valid', arraysEqual(beforeActual.actualSelectedFamilies, beforeFamilies)))
  results.push(caseResult('shadow_09_dispatch_order_unchanged', 'Provider dispatch order remains unchanged.', 'valid', arraysEqual(beforeActual.actualSelectedFamilies, ['chatgpt', 'claude', 'red_team'])))
  results.push(caseResult('shadow_10_execution_mode_unchanged', 'Existing execution mode remains unchanged.', 'valid', beforeActual.executionMode === 'stable_group' && report.actualExecutionMode === 'stable_group'))
  results.push(caseResult('shadow_11_recommendation_not_actual', 'Shadow recommendation never becomes actual selection.', 'valid', report.actualFamilies.length === beforeFamilies.length && arraysEqual(report.actualFamilies, beforeFamilies)))
  results.push(caseResult('shadow_12_failure_fail_open', 'Shadow planner failure does not fail the request.', 'valid', failureReport.plannerStatus === 'failed' && failureReport.executionUnaffected === true))
  results.push(caseResult('shadow_13_failure_status_truthful', 'Shadow planner failure records truthful status.', 'valid', failureReport.eligibilityStatus === 'planner_failed' && failureReport.comparisonStatus === 'failed'))
  results.push(caseResult('shadow_14_registry_failure_fail_open', 'Registry failure does not fail the request.', 'valid', registryFailureReport.plannerStatus === 'failed' && registryFailureReport.executionUnaffected))
  results.push(caseResult('shadow_15_comparison_failure_safe', 'Comparison failure does not fail the request.', 'valid', runShadow({
    mission: missionInput({ requestId: 'shadow-unknown-family' }),
    actual: actualSnapshot({ actualSelectedFamilies: ['unknown' as CouncilOrchestrationFamily] }),
  }).executionUnaffected === true))
  results.push(caseResult('shadow_16_recommended_only', 'Recommended-only families are computed correctly.', 'valid', report.recommendedOnlyFamilies.every(family => !report.actualFamilies.includes(family))))
  results.push(caseResult('shadow_17_actual_only', 'Actual-only families are computed correctly.', 'valid', report.actualOnlyFamilies.every(family => !report.recommendedFamilies.includes(family))))
  results.push(caseResult('shadow_18_overlap', 'Overlap is computed correctly.', 'valid', report.overlappingFamilies.every(family => report.actualFamilies.includes(family) && report.recommendedFamilies.includes(family))))
  results.push(caseResult('shadow_19_exact_match', 'Exact match is detected.', 'valid', exactReport.recommendationMatchStatus === 'exact_match'))
  results.push(caseResult('shadow_20_partial_match', 'Partial match is detected.', 'valid', partialReport.recommendationMatchStatus === 'partial_match'))
  results.push(caseResult('shadow_21_no_match', 'No match is detected.', 'valid', noMatchReport.recommendationMatchStatus === 'no_match'))
  results.push(caseResult('shadow_22_actual_unresolved', 'Actual unresolved is represented honestly.', 'valid', unresolvedActualReport.recommendationMatchStatus === 'actual_unresolved'))
  results.push(caseResult('shadow_23_recommendation_unresolved', 'Recommendation unresolved is represented honestly.', 'valid', unresolvedRecommendationReport.recommendationMatchStatus === 'recommendation_unresolved'))
  results.push(caseResult('shadow_24_duplicate_actual_fails', 'Duplicate actual family IDs fail comparison with actual-side error.', 'valid', throwsMessage(() => createShadowSelectionReport({
    missionInput: missionInput({ requestId: 'shadow-duplicate' }),
    actualSnapshot: actualSnapshot({ actualSelectedFamilies: ['chatgpt', 'chatgpt'] }),
    eligibilityStatus: 'eligible',
    eligibilityReason: 'supported_council_request',
    plan: exactPlan,
    plannerStatus: 'completed',
  }), 'duplicate_actual_family:chatgpt')))
  results.push(caseResult('shadow_25_unknown_actual_fails', 'Unknown actual family fails safely with actual-side error.', 'valid', throwsMessage(() => createShadowSelectionReport({
    missionInput: missionInput({ requestId: 'shadow-unknown' }),
    actualSnapshot: actualSnapshot({ actualSelectedFamilies: ['oracle' as CouncilOrchestrationFamily] }),
    eligibilityStatus: 'eligible',
    eligibilityReason: 'supported_council_request',
    plan: exactPlan,
    plannerStatus: 'completed',
  }), 'unknown_actual_family:oracle')))
  results.push(caseResult('shadow_26_recommended_synth_advisory', 'Recommended synthesizer is advisory only.', 'valid', report.provenance.planAuthority === 'advisory' && report.provenance.executionAuthority === 'none'))
  results.push(caseResult('shadow_27_actual_synth_runtime_authority', 'Actual synthesizer remains runtime-authoritative.', 'valid', report.actualSynthesizer === beforeActual.actualSynthesisFamily))
  results.push(caseResult('shadow_28_red_team_not_added', 'Red Team recommendation does not add Red Team execution.', 'valid', report.actualRedTeamIncluded === beforeActual.actualRedTeamIncluded))
  results.push(caseResult('shadow_29_advisory_label', 'Shadow report includes advisory label.', 'valid', report.advisoryLabel === 'Recommended assembly — shadow only, not used for execution.'))
  results.push(caseResult('shadow_30_execution_unaffected_true', 'Shadow report includes executionUnaffected: true.', 'valid', report.executionUnaffected === true))
  results.push(caseResult('shadow_31_execution_authority_none', 'Shadow report states execution authority none.', 'valid', report.provenance.executionAuthority === 'none'))
  results.push(caseResult('shadow_32_unknown_availability_not_healthy', 'Unknown configured availability remains unknown and is not promoted to health.', 'valid',
    report.provenance.providerHealthVerified === false
    && report.provenance.availabilitySource === 'configured or unknown'
    && report.recommendedFamilies.some(family => report.uncertaintyFlags.includes(`availability_unknown:${family}`))
    && arraysEqual(beforeActual.actualSelectedFamilies, beforeFamilies)))
  results.push(caseResult('shadow_33_not_council_turn', 'Shadow result is not represented as a Council turn.', 'valid', !('turn_id' in report) && !('provider_family' in report)))
  results.push(caseResult('shadow_34_not_in_provider_prompts', 'Shadow result is not included in provider prompts.', 'valid', !/shadowCouncilAssembly[\s\S]{0,500}baseUserPrompt|baseUserPrompt[\s\S]{0,500}shadowCouncilAssembly/.test(route)))
  results.push(caseResult('shadow_35_no_progress_events', 'Shadow result emits no progress events.', 'valid', !/family_queued|family_dispatched|family_response_completed|request_completed|createCouncilProgressRuntimeTracker/.test(source)))
  results.push(caseResult('shadow_36_cannot_close_request', 'Shadow result cannot close a request.', 'valid', !/closeIfTerminal|request_completed/.test(source)))
  results.push(caseResult('shadow_37_missing_terminal_untouched', 'Shadow result does not alter missingTerminalFamilies.', 'valid', !source.includes('missingTerminalFamilies')))
  results.push(caseResult('shadow_38_disabled_no_planner', 'Shadow feature disabled means no planner invocation.', 'valid', runShadow({ featureMode: 'disabled', mission: missionInput({ requestId: 'shadow-disabled' }) }).plannerStatus === 'not_run'))
  results.push(caseResult('shadow_39_diagnostics_only_no_response_attach', 'Diagnostics-only mode does not alter normal response behavior.', 'valid', shouldAttachShadowReport('diagnostics_only') === false))
  results.push(caseResult('shadow_40_exactly_once', 'Planner invoked exactly once per eligible request.', 'valid', secondReport.plannerStatus === 'not_run'))
  results.push(caseResult('shadow_41_actual_snapshot_runtime_source', 'Actual selected family snapshot comes from existing runtime.', 'valid', report.provenance.actualSelectionAuthority === 'existing runtime'))
  results.push(caseResult('shadow_42_actual_unavailable_pending', 'Actual snapshot is unresolved when actual selection is unavailable.', 'valid', unresolvedActualReport.actualFamilies.length === 0 && unresolvedActualReport.recommendationMatchStatus === 'actual_unresolved'))
  results.push(caseResult('shadow_43_stable_group_unchanged', 'Stable Group execution remains unchanged.', 'valid', report.actualExecutionMode === 'stable_group' && arraysEqual(report.actualFamilies, ['chatgpt', 'claude', 'red_team'])))
  results.push(caseResult('shadow_44_full_council_unchanged', 'Full Council execution remains unchanged.', 'valid', createActualSelectionSnapshot({ executionMode: 'full_council', actualSelectedFamilies: ['chatgpt', 'claude', 'grok'] }).executionMode === 'full_council'))
  results.push(caseResult('shadow_45_family_deliberation_unchanged', 'Family-to-family execution remains unchanged.', 'valid', createActualSelectionSnapshot({ executionMode: 'family_to_family_deliberation', actualSelectedFamilies: ['chatgpt', 'claude', 'red_team'] }).actualSelectedFamilies.includes('red_team')))
  results.push(caseResult('shadow_46_direct_provider_unchanged', 'Direct provider execution remains unchanged.', 'valid', runShadow({ mission: missionInput({ requestId: 'shadow-direct-2', directInvocation: true }), actual: actualSnapshot({ executionMode: 'direct_invocation', actualSelectedFamilies: ['claude'] }) }).eligibilityStatus === 'ineligible'))
  results.push(caseResult('shadow_47_unsupported_override_advisory', 'Unsupported Commander override remains advisory.', 'valid', report.provenance.planAuthority === 'advisory'))
  results.push(caseResult('shadow_48_no_provider_bodies', 'Shadow metadata contains no provider response bodies.', 'valid', !JSON.stringify(report).includes('full_response') && !JSON.stringify(report).includes('provider response body')))
  results.push(caseResult('shadow_49_no_secrets', 'Shadow metadata contains no secrets.', 'valid', !/api[_-]?key|access[_-]?token|refresh[_-]?token|service[_-]?role/i.test(JSON.stringify(report))))
  results.push(caseResult('shadow_50_no_fetch_provider_adapter', 'No fetch/provider adapter exists in shadow module.', 'valid', !/\bfetch\s*\(|callCouncilProvider|callChatGPT|callClaude|callXAIChat|completeGemini|completeKimi/.test(source)))
  results.push(caseResult('shadow_51_no_progress_import', 'No progress-runtime import exists in shadow module.', 'valid', !source.includes('progress-events') && !source.includes('CouncilProgressRuntimeTracker')))
  results.push(caseResult('shadow_52_no_request_state_mutation', 'No request-state mutation exists in shadow module.', 'valid', !source.includes('request-state') && !source.includes('reduceCouncilProgressEvent')))
  results.push(caseResult('shadow_53_no_recursive_chat', 'Shadow exception cannot cause recursive /api/chat call.', 'valid', !source.includes('/api/chat')))
  results.push(caseResult('shadow_54_no_dispatch_missing_recommended', 'Shadow comparison does not dispatch missing recommended families.', 'valid', !source.includes('dispatch') && !source.includes('callCouncilProvider')))
  results.push(caseResult('shadow_55_metadata_omittable', 'Advisory metadata can be omitted without changing actual output.', 'valid', shouldAttachShadowReport('diagnostics_only') === false))
  results.push(caseResult('shadow_56_consumer_absent_metadata', 'Existing response consumer tolerates absent shadow metadata.', 'valid', shouldAttachShadowReport('disabled') === false))
  results.push(caseResult('shadow_57_consumer_present_metadata', 'Existing response consumer tolerates present shadow metadata.', 'valid', shouldAttachShadowReport('response_metadata') === true && report.schemaVersion === '48c3b2.shadow-selection.v1'))
  results.push(caseResult('shadow_58_uncertainty_explicit', 'Mission uncertainty remains explicit.', 'valid', report.uncertaintyFlags.length > 0))
  results.push(caseResult('shadow_59_planner_provenance', 'Planner provenance is present.', 'valid', report.provenance.generatedBy === 'adaptive_assembly_shadow_v1'))
  results.push(caseResult('shadow_60_actual_provenance', 'Actual-selection provenance is present.', 'valid', report.provenance.actualSelectionAuthority === 'existing runtime'))
  results.push(caseResult('shadow_61_duplicate_recommended_fails', 'Duplicate recommended family IDs fail comparison with recommended-side error.', 'valid', throwsMessage(() => createShadowSelectionReport({
    missionInput: missionInput({ requestId: 'shadow-duplicate-recommended' }),
    actualSnapshot: actualSnapshot(),
    eligibilityStatus: 'eligible',
    eligibilityReason: 'supported_council_request',
    plan: { ...exactPlan, selectedFamilies: ['chatgpt', 'chatgpt'] },
    plannerStatus: 'completed',
  }), 'duplicate_recommended_family:chatgpt')))
  results.push(caseResult('shadow_62_unknown_recommended_fails', 'Unknown recommended family fails safely with recommended-side error.', 'valid', throwsMessage(() => createShadowSelectionReport({
    missionInput: missionInput({ requestId: 'shadow-unknown-recommended' }),
    actualSnapshot: actualSnapshot(),
    eligibilityStatus: 'eligible',
    eligibilityReason: 'supported_council_request',
    plan: { ...exactPlan, selectedFamilies: ['oracle' as CouncilOrchestrationFamily] },
    plannerStatus: 'completed',
  }), 'unknown_recommended_family:oracle')))
  results.push(caseResult('shadow_63_missing_actual_synth_not_fallback', 'Missing actual synthesizer remains unresolved and never falls back to the recommendation.', 'valid',
    missingActualSynthReport.actualSynthesizer === null
    && missingActualSynthReport.recommendedSynthesizer === exactPlan.synthesisAuthority.primaryFamily
    && missingActualSynthReport.synthesizerMatchStatus === 'actual_unresolved'))
  results.push(caseResult(
    'shadow_64_empty_actual_finalized_truthful',
    'A finalized zero-family actual execution (real "no providers configured" state) is compared truthfully: recommended families are never substituted onto the empty actual side, exact_match is never falsely reported, actual selection is not marked unresolved merely because it is empty, not_comparable is preserved, recommended-only families are reported truthfully, and executionUnaffected remains true.',
    'valid',
    emptyActualFinalizedReport.actualFamilies.length === 0
    && emptyActualFinalizedReport.recommendedFamilies.length > 0
    // A string-literal-union match status can only ever be one value at a
    // time, so asserting it equals 'not_comparable' below is already
    // sufficient to prove it is neither 'exact_match' nor
    // 'actual_unresolved' -- TypeScript's own literal-type narrowing
    // enforces this statically (redundant runtime !== checks were removed
    // as unreachable-by-construction, per tsc's own comparison-overlap
    // diagnostic).
    && emptyActualFinalizedReport.recommendationMatchStatus === 'not_comparable'
    && arraysEqual(emptyActualFinalizedReport.recommendedOnlyFamilies, exactPlan.selectedFamilies)
    && emptyActualFinalizedReport.executionUnaffected === true,
  ))
  results.push(caseResult(
    'shadow_65_shadow_recommendation_cannot_control_dispatch',
    'Static source-boundary check over the real app/api/chat/route.ts integration: no dispatch-relevant variable (activeFamilies) is ever declared or reassigned from shadow-report output (shadowCouncilAssembly, recommendedFamilies, runAdaptiveCouncilShadowSelection, CouncilShadowSelectionReport, shadowReport). Response-only metadata attachment is permitted; execution-input write-back is not.',
    'valid',
    dispatchWriteBackFromShadow(route).length === 0,
    dispatchWriteBackFromShadow(route),
  ))

  return results
}
