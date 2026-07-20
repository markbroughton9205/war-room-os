import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import {
  createAdaptiveCouncilReadoutViewModel,
  shouldRenderAdaptiveCouncilReadout,
} from './shadowReadout'
import type { CouncilShadowSelectionReport, RecommendationMatchStatus } from './shadowTypes'

export type AdaptiveCouncilReadoutValidationResult = {
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
): AdaptiveCouncilReadoutValidationResult {
  const observed = condition ? 'valid' : 'invalid'
  return { caseId, description, result: observed === expected ? 'PASS' : 'FAIL', observed, details }
}

function arraysEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function sourceText(): string {
  return [
    readFileSync(join(process.cwd(), 'lib', 'council', 'adaptive-assembly', 'shadowReadout.ts'), 'utf8'),
    readFileSync(join(process.cwd(), 'components', 'council', 'AdaptiveCouncilReadout.tsx'), 'utf8'),
  ].join('\n')
}

function report(partial?: Partial<CouncilShadowSelectionReport>): CouncilShadowSelectionReport {
  return {
    shadowReportId: 'shadow-readout-validation',
    schemaVersion: '48c3b2.shadow-selection.v1',
    requestId: 'readout-request',
    logicalRequestId: 'readout-logical',
    missionFingerprint: 'fingerprint',
    eligibilityStatus: 'eligible',
    eligibilityReason: 'supported_council_request',
    planId: 'plan_1',
    planVersion: 1,
    recommendedFamilies: ['chatgpt', 'claude', 'grok'],
    actualFamilies: ['chatgpt', 'claude', 'red_team'],
    recommendedOnlyFamilies: ['grok'],
    actualOnlyFamilies: ['red_team'],
    overlappingFamilies: ['chatgpt', 'claude'],
    recommendationMatchStatus: 'partial_match',
    recommendedSynthesizer: 'chatgpt',
    actualSynthesizer: 'chatgpt',
    synthesizerMatchStatus: 'exact_match',
    recommendedRedTeamPolicy: 'conditional',
    actualRedTeamIncluded: true,
    participationPreset: 'standard',
    actualExecutionMode: 'stable_group',
    unresolvedCapabilities: ['numerical_analysis'],
    uncertaintyFlags: ['availability_unknown:grok', 'legacy_stable_group_mapping_is_provenance_only'],
    plannerStatus: 'completed',
    comparisonStatus: 'compared',
    advisoryLabel: 'Recommended assembly — shadow only, not used for execution.',
    generatedAt: '2026-07-19T00:00:00.000Z',
    executionUnaffected: true,
    provenance: {
      generatedBy: 'adaptive_assembly_shadow_v1',
      planAuthority: 'advisory',
      executionAuthority: 'none',
      actualSelectionAuthority: 'existing runtime',
      capabilitySource: 'configured registry',
      availabilitySource: 'configured or unknown',
      providerHealthVerified: false,
      executionInfluenced: false,
    },
    ...partial,
  }
}

function model(input?: Partial<CouncilShadowSelectionReport>) {
  return createAdaptiveCouncilReadoutViewModel(report(input), {
    messageType: 'response',
    responseComplete: true,
    isUserMessage: false,
  })
}

export function runAdaptiveCouncilReadoutValidation(): AdaptiveCouncilReadoutValidationResult[] {
  const results: AdaptiveCouncilReadoutValidationResult[] = []
  const source = sourceText()
  const baseReport = report()
  const baseModel = model()
  const original = report()
  const before = JSON.stringify(original)
  const afterModel = createAdaptiveCouncilReadoutViewModel(original)
  const after = JSON.stringify(original)
  void afterModel

  const statusCases: [RecommendationMatchStatus, string][] = [
    ['exact_match', 'Exact match'],
    ['partial_match', 'Partial match'],
    ['no_match', 'Different Council used'],
    ['actual_unresolved', 'Actual Council not available'],
    ['recommendation_unresolved', 'Recommendation incomplete'],
    ['not_comparable', 'Comparison unavailable'],
  ]
  statusCases.forEach(([status, label], index) => {
    results.push(caseResult(
      `readout_${String(index + 1).padStart(2, '0')}_${status}`,
      `${label} maps to Commander-facing status label.`,
      'valid',
      model({ recommendationMatchStatus: status }).statusLabel === label,
    ))
  })

  results.push(caseResult('readout_07_shadow_failure_maps', 'Shadow failure maps to unavailable state.', 'valid', model({ plannerStatus: 'failed', eligibilityStatus: 'planner_failed', comparisonStatus: 'failed' }).status === 'shadow_failed'))
  results.push(caseResult('readout_08_absent_report_unavailable', 'Optional absent report does not render.', 'valid', !createAdaptiveCouncilReadoutViewModel(undefined).available))
  results.push(caseResult('readout_09_input_unmodified', 'Input report remains unmodified.', 'valid', before === after))
  results.push(caseResult('readout_10_unknown_status_safe', 'Unknown status is handled safely.', 'valid', createAdaptiveCouncilReadoutViewModel(report({ recommendationMatchStatus: 'mystery' as RecommendationMatchStatus })).status === 'not_comparable'))

  results.push(caseResult('readout_11_recommended_never_actual', 'Recommended-only family never appears as actual unless actual input includes it.', 'valid', !baseModel.actualFamilies.some(item => item.id === 'grok')))
  results.push(caseResult('readout_12_actual_only_truth', 'Actual-only family remains actual-only.', 'valid', arraysEqual(baseModel.actualOnlyFamilies.map(item => item.id), ['red_team'])))
  results.push(caseResult('readout_13_recommended_only_truth', 'Recommended-only family remains recommended-only.', 'valid', arraysEqual(baseModel.recommendedOnlyFamilies.map(item => item.id), ['grok'])))
  results.push(caseResult('readout_14_overlap_truth', 'Overlap is represented correctly.', 'valid', arraysEqual(baseModel.overlappingFamilies.map(item => item.id), ['chatgpt', 'claude'])))
  results.push(caseResult('readout_15_empty_actual_finalized_truthful', 'Empty finalized actual remains truthful.', 'valid', model({ actualFamilies: [], actualOnlyFamilies: [], overlappingFamilies: [], recommendationMatchStatus: 'not_comparable' }).actualFamilies.length === 0))
  results.push(caseResult('readout_16_empty_recommendation_truthful', 'Empty recommendation remains truthful.', 'valid', model({ recommendedFamilies: [], recommendedOnlyFamilies: [], overlappingFamilies: [], recommendationMatchStatus: 'not_comparable' }).recommendedFamilies.length === 0))
  results.push(caseResult('readout_17_duplicate_ui_removed', 'Duplicate UI display does not occur.', 'valid', model({ actualFamilies: ['chatgpt', 'chatgpt'] }).actualFamilies.length === 1))
  results.push(caseResult('readout_18_order_difference_not_false', 'Order differences are displayed as provided and status-driven, not locally reclassified.', 'valid', model({ recommendedFamilies: ['claude', 'chatgpt'], actualFamilies: ['chatgpt', 'claude'], overlappingFamilies: ['chatgpt', 'claude'], recommendationMatchStatus: 'exact_match' }).status === 'exact_match'))
  results.push(caseResult('readout_19_unknown_family_safe', 'Unknown family ID does not crash and renders safely.', 'valid', model({ actualFamilies: ['oracle' as CouncilOrchestrationFamily] }).actualFamilies[0]?.label === 'Unknown Council family'))
  results.push(caseResult('readout_20_arrays_independent', 'Actual and recommended arrays remain independent.', 'valid', !arraysEqual(baseModel.actualFamilies.map(item => item.id), baseModel.recommendedFamilies.map(item => item.id))))

  results.push(caseResult('readout_21_advisory_only_true', 'Advisory-only remains true.', 'valid', baseModel.advisoryOnly === true))
  results.push(caseResult('readout_22_execution_unaffected_true_only', 'Execution-unaffected statement is backed by true flag.', 'valid', baseModel.executionUnaffected === true))
  results.push(caseResult('readout_23_missing_execution_unaffected_no_false_assurance', 'Missing/false executionUnaffected does not produce assurance.', 'valid', createAdaptiveCouncilReadoutViewModel(report({ executionUnaffected: false as true })).executionUnaffected === false))
  results.push(caseResult('readout_24_no_execution_action_text', 'No execution action exists.', 'valid', !/Execute plan|Run recommended Council|Promote to active/i.test(source)))
  results.push(caseResult('readout_25_no_apply_recommendation', 'No Apply Recommendation control exists.', 'valid', !/Apply Recommendation|Use this Council|Replace current selection|Auto-select|save as default/i.test(source)))
  results.push(caseResult('readout_26_no_write_back', 'No shadow output write-back exists.', 'valid', !/activeFamilies\s*=|setActiveFamilies|selectedFamilies\s*=|write-back/i.test(source)))
  results.push(caseResult('readout_27_no_client_planner', 'No client planner invocation exists.', 'valid', !/createAssemblyPlan|classifyMission|runAdaptiveCouncilShadowSelection/.test(source)))
  results.push(caseResult('readout_28_no_provider_call', 'No provider call exists.', 'valid', !/\bfetch\s*\(|callCouncilProvider|callChatGPT|callClaude|callXAIChat|completeGemini|completeKimi/.test(source)))
  results.push(caseResult('readout_29_no_progress_event', 'No progress event exists.', 'valid', !/family_queued|family_dispatched|request_completed|createCouncilProgressRuntimeTracker/.test(source)))
  results.push(caseResult('readout_30_no_persistence_call', 'No persistence call exists.', 'valid', !/supabase|localStorage|sessionStorage|indexedDB|postgres|insert\(|update\(/i.test(source)))

  results.push(caseResult('readout_31_red_team_distinct', 'Recommended Red Team is distinct from actual Red Team.', 'valid', model({ recommendedRedTeamPolicy: 'mandatory', actualRedTeamIncluded: false }).recommendedRedTeam === true && model({ recommendedRedTeamPolicy: 'mandatory', actualRedTeamIncluded: false }).actualRedTeamIncluded === false))
  results.push(caseResult('readout_32_red_team_recommend_not_participation', 'Red Team recommendation does not imply participation.', 'valid', model({ recommendedRedTeamPolicy: 'mandatory', actualRedTeamIncluded: false }).actualRedTeamIncluded === false))
  results.push(caseResult('readout_33_evidence_not_collected', 'Evidence required does not imply evidence collected.', 'valid', baseModel.evidenceRequired === null))
  results.push(caseResult('readout_34_live_data_not_researched', 'Live data required does not imply research occurred.', 'valid', baseModel.liveDataRequired === null))
  results.push(caseResult('readout_35_unknown_evidence_remains_unknown', 'Unknown evidence state remains unknown.', 'valid', baseModel.evidenceRequired === null && baseModel.liveDataRequired === null))

  results.push(caseResult('readout_36_matching_synth', 'Matching synthesizer is displayed.', 'valid', model({ synthesizerMatchStatus: 'exact_match' }).synthesizerStatus === 'match'))
  results.push(caseResult('readout_37_mismatching_synth', 'Mismatching synthesizer is displayed.', 'valid', model({ synthesizerMatchStatus: 'different' }).synthesizerStatus === 'mismatch'))
  results.push(caseResult('readout_38_missing_actual_synth', 'Missing actual synthesizer remains unresolved.', 'valid', model({ actualSynthesizer: null, synthesizerMatchStatus: 'actual_unresolved' }).actualSynthesizer === null))
  results.push(caseResult('readout_39_missing_recommended_synth', 'Missing recommended synthesizer remains unresolved.', 'valid', model({ recommendedSynthesizer: null, synthesizerMatchStatus: 'recommendation_unresolved' }).recommendedSynthesizer === null))
  results.push(caseResult('readout_40_recommended_not_sub_actual_synth', 'Recommended synthesizer never substitutes for actual.', 'valid', model({ recommendedSynthesizer: 'chatgpt', actualSynthesizer: null, synthesizerMatchStatus: 'actual_unresolved' }).actualSynthesizer === null))

  results.push(caseResult('readout_41_completed_eligible_renders', 'Completed eligible response renders.', 'valid', shouldRenderAdaptiveCouncilReadout(baseReport, { messageType: 'response', responseComplete: true, isUserMessage: false })))
  results.push(caseResult('readout_42_no_metadata_no_render', 'No metadata does not render.', 'valid', !shouldRenderAdaptiveCouncilReadout(undefined, { messageType: 'response', responseComplete: true, isUserMessage: false })))
  results.push(caseResult('readout_43_direct_ineligible_no_render', 'Direct invocation ineligible metadata does not render.', 'valid', !shouldRenderAdaptiveCouncilReadout(report({ eligibilityStatus: 'ineligible', eligibilityReason: 'unsupported_direct_provider_path', plannerStatus: 'not_run', comparisonStatus: 'not_run' }), { messageType: 'response', responseComplete: true, isUserMessage: false })))
  results.push(caseResult('readout_44_streaming_partial_no_render', 'Streaming partial response does not render final readout.', 'valid', !shouldRenderAdaptiveCouncilReadout(baseReport, { messageType: 'response', responseComplete: false, isUserMessage: false })))
  results.push(caseResult('readout_45_historic_response_usable', 'Historic response without metadata remains usable.', 'valid', createAdaptiveCouncilReadoutViewModel(null).available === false))
  results.push(caseResult('readout_46_failure_state_usable', 'Failure state remains usable.', 'valid', model({ plannerStatus: 'failed', eligibilityStatus: 'planner_failed', comparisonStatus: 'failed' }).failureMessage !== null))
  results.push(caseResult('readout_47_one_readout_per_response', 'Only one collapsed disclosure container is defined by the readout component.', 'valid', (source.match(/<details/g) ?? []).length === 1))
  results.push(caseResult('readout_48_user_message_no_readout', 'User message never receives readout.', 'valid', !shouldRenderAdaptiveCouncilReadout(baseReport, { messageType: 'decree', responseComplete: true, isUserMessage: true })))

  results.push(caseResult('readout_49_disclosure_label', 'Disclosure has accessible label.', 'valid', /aria-label/.test(source) && /Adaptive Council readout/.test(source)))
  results.push(caseResult('readout_50_disclosure_state', 'Disclosure state is represented by semantic details element.', 'valid', /<details/.test(source) && /<summary/.test(source)))
  results.push(caseResult('readout_51_status_textual', 'Status has textual label.', 'valid', baseModel.statusLabel.length > 0))
  results.push(caseResult('readout_52_family_headings', 'Family groups have headings.', 'valid', /Recommended Council/.test(source) && /Actual Council Used/.test(source)))
  results.push(caseResult('readout_53_no_color_only', 'Meaning is not communicated by color alone.', 'valid', /Recommended, not used/.test(source) && /Used, not recommended/.test(source) && /Recommended and used/.test(source)))
  results.push(caseResult('readout_54_long_reasons_wrap', 'Long reason text wraps.', 'valid', /break-words/.test(source) || /whitespace/.test(source)))
  results.push(caseResult('readout_55_mobile_no_fixed_overflow', 'Mobile layout has no fixed-width overflow.', 'valid', !/w-\[[0-9]+px\]|min-w-\[[0-9]+px\]|style=\{\{[^}]*width: [0-9]/.test(source)))

  results.push(caseResult('readout_56_reads_metadata_only', 'Readout reads only response metadata.', 'valid', /report: CouncilShadowSelectionReport/.test(source) && !/message:\s*string.*commanderMessage/.test(source)))
  results.push(caseResult('readout_57_no_planner_import', 'No adaptive planner import exists.', 'valid', !/from ['"].*planner|from ['"].*missionClassification|from ['"].*shadowRuntime/.test(source)))
  results.push(caseResult('readout_58_no_route_import', 'No route import exists.', 'valid', !/app\/api\/chat|route\.ts/.test(source)))
  results.push(caseResult('readout_59_no_provider_adapter_import', 'No provider adapter import exists.', 'valid', !/providerDirectCall|providers\/|ai\/providers/.test(source)))
  results.push(caseResult('readout_60_no_progress_runtime_import', 'No progress-runtime import exists.', 'valid', !/progress-events|CouncilProgressRuntimeTracker/.test(source)))
  results.push(caseResult('readout_61_no_supabase_persistence_import', 'No Supabase or persistence import exists.', 'valid', !/supabase|persistence|storage/i.test(source)))
  results.push(caseResult('readout_62_no_fetch_network', 'No fetch or network primitive exists.', 'valid', !/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource/.test(source)))
  results.push(caseResult('readout_63_no_active_family_mutation', 'No activeFamilies mutation exists.', 'valid', !/activeFamilies|setActive/.test(source)))
  results.push(caseResult('readout_64_no_selected_family_mutation', 'No selected-family mutation exists.', 'valid', !/setSelected|selectedFamilies\s*=/.test(source)))
  results.push(caseResult('readout_65_no_execution_control_text', 'No execution control text exists.', 'valid', !/Apply recommendation|Use this Council|Run recommended Council|Execute plan|Promote to active|Retry with recommendation/i.test(source)))
  results.push(caseResult('readout_66_unknown_availability_not_healthy', 'Unknown availability is not converted into healthy display.', 'valid', baseModel.uncertaintyMessages.some(message => /Availability Unknown:Grok/.test(message)) && !JSON.stringify(baseModel).includes('Healthy')))

  return results
}
