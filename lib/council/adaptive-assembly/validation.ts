import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { COUNCIL_CAPABILITIES, validateCapabilityList } from './capabilities'
import { validateAssemblyPlan, markAssemblyPlanReady } from './assemblyPlan'
import { classifyMission } from './missionClassification'
import {
  FAMILY_CAPABILITY_PROFILES,
  createCapabilityRegistry,
  validateFamilyCapabilityProfiles,
  type CapabilityRegistry,
} from './registry'
import {
  createAssemblyPlan,
  reviseCouncilAssemblyPlan,
} from './planner'
import type {
  CommanderOverride,
  CouncilAssemblyPlan,
  FamilyCapabilityProfile,
} from './types'

export type AdaptiveAssemblyValidationResult = {
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
): AdaptiveAssemblyValidationResult {
  const observed = condition ? 'valid' : 'invalid'
  return {
    caseId,
    description,
    result: observed === expected ? 'PASS' : 'FAIL',
    observed,
    details,
  }
}

function override(input: {
  overrideType: string
  value: unknown
  missionVersion?: number
  planVersion?: number
}): CommanderOverride {
  return {
    overrideId: `override-${String(input.overrideType).replace(/[^a-z0-9]+/gi, '-')}`,
    overrideType: input.overrideType,
    value: input.value,
    issuedBy: 'validation_commander',
    issuedAt: '2026-07-19T00:00:00.000Z',
    missionVersion: input.missionVersion ?? 1,
    planVersion: input.planVersion ?? 1,
    provenance: 'validation_fixture',
    supportStatus: 'unresolved',
  }
}

function plan(
  commanderMessage: string,
  input?: Partial<Parameters<typeof createAssemblyPlan>[0]>,
  registry?: CapabilityRegistry,
): CouncilAssemblyPlan {
  return createAssemblyPlan({
    missionId: 'validation-mission',
    missionVersion: 1,
    commanderMessage,
    createdAt: '2026-07-19T00:00:00.000Z',
    ...input,
  }, registry)
}

function withProfilePatch(
  familyId: CouncilOrchestrationFamily,
  patch: Partial<FamilyCapabilityProfile>,
): CapabilityRegistry {
  const profiles = FAMILY_CAPABILITY_PROFILES.map(profile => (
    profile.familyId === familyId
      ? { ...profile, ...patch } as FamilyCapabilityProfile
      : profile
  ))
  return createCapabilityRegistry(profiles)
}

function hasSelectionReason(assemblyPlan: CouncilAssemblyPlan): boolean {
  return assemblyPlan.selectedFamilies.every(family =>
    assemblyPlan.selectionReasons.some(reason => reason.familyId === family && reason.reasons.length > 0),
  )
}

function hasRelevantExclusionReason(assemblyPlan: CouncilAssemblyPlan): boolean {
  return assemblyPlan.excludedFamilies.every(family =>
    assemblyPlan.exclusionReasons.some(reason => reason.familyId === family && reason.reasons.length > 0),
  )
}

// Phase 48-C3B1 test-quality correction: replaces the prior vacuous
// typeof-comparison check with a real dynamic spy. Temporarily replaces
// globalThis.fetch with a throwing counter for the duration of `run`, then
// restores the original (or removes the property if fetch was previously
// undefined) even if `run` throws. Proves the exercised code path never
// actually invokes fetch -- not merely that fetch's *type* is unchanged.
function withFetchInvocationSpy<T>(run: () => T): { result: T; fetchInvocationCount: number } {
  let fetchInvocationCount = 0
  const globalWithFetch = globalThis as { fetch?: unknown }
  const hadOwnFetch = Object.prototype.hasOwnProperty.call(globalWithFetch, 'fetch')
  const originalFetch = globalWithFetch.fetch
  globalWithFetch.fetch = (...args: unknown[]) => {
    fetchInvocationCount += 1
    throw new Error(`fetch invoked during adaptive-assembly execution: ${JSON.stringify(args).slice(0, 200)}`)
  }
  try {
    const result = run()
    return { result, fetchInvocationCount }
  } finally {
    if (hadOwnFetch) {
      globalWithFetch.fetch = originalFetch
    } else {
      delete globalWithFetch.fetch
    }
  }
}

// Phase 48-C3B1 test-quality correction: static source-boundary check.
// Reads the actual shipped module source files (excluding this validation
// file and the runner script, which legitimately reference some of these
// tokens in string literals as part of testing for their absence) and
// confirms none of them contain a prohibited execution primitive, provider
// call, or execution-path import. This catches an added-but-never-called
// prohibited import/reference that a dynamic spy (which only observes what
// actually executes during a specific run) would miss.
const ADAPTIVE_ASSEMBLY_RUNTIME_SOURCE_FILES = [
  'types.ts',
  'capabilities.ts',
  'registry.ts',
  'missionClassification.ts',
  'assemblyPlan.ts',
  'planner.ts',
  'index.ts',
] as const

const PROHIBITED_EXECUTION_SOURCE_TOKENS = [
  'fetch(',
  'XMLHttpRequest',
  'callCouncilProvider',
  'callChatGPT',
  'callClaude',
  'callGrok',
  'callGemini',
  'callKimi',
  '/api/chat',
  "from '@/lib/council/progress-events/runtime'",
  "from '@/lib/council/request-state/",
  "from '@/lib/council/family-deliberation",
  '.record({',
] as const

function findProhibitedExecutionSourceTokens(): string[] {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const hits: string[] = []
  for (const file of ADAPTIVE_ASSEMBLY_RUNTIME_SOURCE_FILES) {
    const source = readFileSync(join(moduleDir, file), 'utf8')
    for (const token of PROHIBITED_EXECUTION_SOURCE_TOKENS) {
      if (source.includes(token)) hits.push(`${file}:${token}`)
    }
  }
  return hits
}

export function runAdaptiveCouncilAssemblyValidation(): AdaptiveAssemblyValidationResult[] {
  const results: AdaptiveAssemblyValidationResult[] = []

  const validRegistry = createCapabilityRegistry()
  const validPlan = plan('Build a repo architecture plan for debugging deployment risk.')
  const currentIntelPlan = plan('Search the latest current market signals online.')
  const highRiskPlan = plan('Review this payment and identity security risk before execution.')
  const uncertainPlan = plan('')
  const includeGrokPlan = plan('Create a strategy note.', { commanderOverrides: [override({ overrideType: 'add_family', value: 'grok' })] })
  const excludeClaudePlan = plan('Build a repo architecture plan.', { commanderOverrides: [override({ overrideType: 'exclude_family', value: 'claude' })] })
  const contradictoryPlan = plan('Create a plan.', {
    commanderOverrides: [
      override({ overrideType: 'add_family', value: 'claude' }),
      override({ overrideType: 'exclude_family', value: 'claude' }),
    ],
  })
  const missingCapabilityPlan = plan('Calculate the ROI and numerical budget estimate.')
  const focusedPlan = plan('Quick concise strategy.', { maxProviderCount: 2 })
  const comprehensivePlan = plan('High risk legal financial security review with deep analysis.')
  const genericPlan = plan('Say hello and give a concise response.')
  const stableGroupPlan = plan('Build a strategy.', { legacyCompatibilityOrigin: 'stable_group' })
  const fullCouncilPlan = plan('Build a strategy.', { legacyCompatibilityOrigin: 'full_council' })
  const unsupportedOverridePlan = plan('Build a strategy.', { commanderOverrides: [override({ overrideType: 'summon_oracle', value: true })] })
  const unavailableGrokRegistry = withProfilePatch('grok', { availability: 'unavailable' })
  const unavailableGrokPlan = plan('Search latest current information online.', undefined, unavailableGrokRegistry)
  const forcedUnavailableGrokPlan = plan(
    'Search latest current information online.',
    { commanderOverrides: [override({ overrideType: 'add_family', value: 'grok' })] },
    unavailableGrokRegistry,
  )
  const claudeOnlyEngineeringRegistry = createCapabilityRegistry(FAMILY_CAPABILITY_PROFILES.map(profileItem => (
    profileItem.familyId === 'claude'
      ? profileItem
      : { ...profileItem, availability: 'unavailable' } as FamilyCapabilityProfile
  )))
  const claudeOnlyEngineeringPlan = plan('Build code architecture for a repo implementation.', undefined, claudeOnlyEngineeringRegistry)
  const noChatGptSynthesisPlan = plan('Build architecture and synthesis plan.', {
    commanderOverrides: [override({ overrideType: 'exclude_family', value: 'chatgpt' })],
  })

  results.push(caseResult('assembly_01_valid_profiles_pass', 'Valid family capability profiles pass registry validation.', 'valid', validRegistry.profiles.length >= 8))
  results.push(caseResult('assembly_02_unknown_capability_fails', 'Unknown capability names fail validation.', 'invalid', (() => {
    try {
      validateCapabilityList(['general_reasoning', 'made_up_capability'])
      return true
    } catch {
      return false
    }
  })()))
  results.push(caseResult(
    'assembly_03_duplicate_family_ids_fail',
    'Duplicate family IDs alone -- with every required family otherwise present exactly once -- fail registry validation specifically due to the duplicate, isolated from any missing-family error.',
    'invalid',
    (() => {
      const errors = validateFamilyCapabilityProfiles([...FAMILY_CAPABILITY_PROFILES, FAMILY_CAPABILITY_PROFILES[0]])
      const hasDuplicateError = errors.some(error => error.startsWith('duplicate_family:chatgpt'))
      const hasMissingFamilyError = errors.some(error => error.startsWith('missing_family:'))
      return !(hasDuplicateError && !hasMissingFamilyError)
    })(),
  ))
  results.push(caseResult('assembly_04_unknown_availability_preserved', 'Unknown availability remains unknown, not healthy.', 'valid', validRegistry.profiles.some(profile => profile.availability === 'unknown')))
  const fetchSpyRun = withFetchInvocationSpy(() => {
    const registry = createCapabilityRegistry()
    classifyMission({ commanderMessage: 'Build a repo architecture plan for debugging deployment risk.' })
    const spyPlan = plan('Build a repo architecture plan for debugging deployment risk.', undefined, registry)
    reviseCouncilAssemblyPlan({
      previousPlan: spyPlan,
      changeReason: 'fetch spy exercise',
      provenance: 'validation_fixture',
      createdAt: '2026-07-19T00:03:00.000Z',
    })
    validateAssemblyPlan(spyPlan)
    return spyPlan
  })
  results.push(caseResult(
    'assembly_05_registry_no_provider_invocation',
    'A full registry-construction + mission-classification + plan-creation + plan-revision + plan-validation exercise never actually invokes fetch (dynamic spy on globalThis.fetch, not a type comparison).',
    'valid',
    fetchSpyRun.fetchInvocationCount === 0,
  ))
  results.push(caseResult('assembly_06_classification_deterministic', 'Mission classification is deterministic.', 'valid', JSON.stringify(classifyMission({ commanderMessage: 'Build code architecture.' })) === JSON.stringify(classifyMission({ commanderMessage: 'Build code architecture.' }))))
  results.push(caseResult('assembly_07_engineering_requires_engineering', 'Engineering mission requires engineering or architecture capabilities.', 'valid', validPlan.requiredCapabilities.some(capability => capability === 'software_engineering' || capability === 'systems_architecture')))
  results.push(caseResult('assembly_08_current_intelligence_live_data', 'Current-intelligence mission marks live data required.', 'valid', currentIntelPlan.evidenceRequirement === 'live_required'))
  results.push(caseResult('assembly_09_high_risk_requires_red_team', 'High-risk mission requires Red Team.', 'valid', highRiskPlan.redTeamRequirement === 'mandatory' && highRiskPlan.selectedFamilies.includes('red_team')))
  results.push(caseResult('assembly_10_uncertain_flags', 'Uncertain mission returns uncertainty flags.', 'valid', uncertainPlan.uncertaintyFlags.length > 0))
  results.push(caseResult('assembly_11_include_override_affects_selection', 'Include override affects recommendation.', 'valid', includeGrokPlan.selectedFamilies.includes('grok')))
  results.push(caseResult('assembly_12_exclude_override_prevents_selection', 'Exclude override prevents selection.', 'valid', !excludeClaudePlan.selectedFamilies.includes('claude') && excludeClaudePlan.excludedFamilies.includes('claude')))
  results.push(caseResult('assembly_13_selected_excluded_overlap_invalid', 'Same family cannot be both selected and excluded.', 'invalid', validateAssemblyPlan({ ...validPlan, excludedFamilies: [...validPlan.excludedFamilies, validPlan.selectedFamilies[0]] }).length === 0))
  results.push(caseResult('assembly_14_contradictory_overrides_fail_safe', 'Contradictory overrides fail safely.', 'valid', contradictoryPlan.planStatus === 'invalid'))
  results.push(caseResult('assembly_15_missing_capability_unresolved', 'Missing required capability returns unresolved.', 'valid', missingCapabilityPlan.unresolvedCapabilities.includes('numerical_analysis')))
  results.push(caseResult('assembly_16_max_provider_count_respected', 'Max provider count is respected.', 'valid', focusedPlan.selectedFamilies.length <= 2))
  results.push(caseResult('assembly_17_comprehensive_not_every_family', 'Comprehensive does not automatically select every family.', 'valid', comprehensivePlan.selectedFamilies.length < validRegistry.profiles.length))
  results.push(caseResult('assembly_18_synthesis_eligible_only', 'Synthesis authority comes only from synthesisEligible profiles.', 'valid', !validPlan.synthesisAuthority.primaryFamily || Boolean(validRegistry.profiles.find(profile => profile.familyId === validPlan.synthesisAuthority.primaryFamily)?.synthesisEligible)))
  results.push(caseResult('assembly_19_red_team_omitted_without_rule', 'Red Team is omitted when no rule or override requires it.', 'valid', genericPlan.redTeamRequirement !== 'mandatory' && !genericPlan.selectedFamilies.includes('red_team')))
  results.push(caseResult('assembly_20_selected_families_have_reasons', 'Every selected family has a traceable selection reason.', 'valid', hasSelectionReason(validPlan)))
  results.push(caseResult('assembly_21_excluded_families_have_reasons', 'Relevant excluded families have exclusion reasons.', 'valid', hasRelevantExclusionReason(excludeClaudePlan)))
  results.push(caseResult('assembly_22_duplicate_selected_prevented', 'Duplicate selected families are prevented.', 'valid', new Set(validPlan.selectedFamilies).size === validPlan.selectedFamilies.length))
  results.push(caseResult('assembly_23_execution_ready_immutable', 'Plan becomes immutable at execution_ready.', 'invalid', (() => {
    try {
      reviseCouncilAssemblyPlan({ previousPlan: markAssemblyPlanReady(validPlan), changeReason: 'negative', provenance: 'validation_fixture' })
      return true
    } catch {
      return false
    }
  })()))
  results.push(caseResult('assembly_24_execution_started_immutable', 'Plan becomes immutable at execution_started.', 'invalid', (() => {
    try {
      reviseCouncilAssemblyPlan({ previousPlan: { ...validPlan, planStatus: 'execution_started' }, changeReason: 'negative', provenance: 'validation_fixture' })
      return true
    } catch {
      return false
    }
  })()))
  const revisedMission = reviseCouncilAssemblyPlan({ previousPlan: validPlan, commanderMessage: 'Build a revised engineering plan.', changeReason: 'mission changed', provenance: 'validation_fixture', createdAt: '2026-07-19T00:01:00.000Z' })
  results.push(caseResult('assembly_25_mission_change_new_version', 'Mission changes create a new plan version.', 'valid', revisedMission.missionVersion === validPlan.missionVersion + 1 && revisedMission.planVersion === validPlan.planVersion + 1))
  const revisedOverride = reviseCouncilAssemblyPlan({ previousPlan: validPlan, commanderOverrides: [override({ overrideType: 'add_family', value: 'grok', missionVersion: 2, planVersion: 2 })], changeReason: 'override changed', provenance: 'validation_fixture', createdAt: '2026-07-19T00:02:00.000Z' })
  results.push(caseResult('assembly_26_override_change_new_version', 'Override changes create a new plan version.', 'valid', revisedOverride.planVersion === validPlan.planVersion + 1 && revisedOverride.commanderOverrides.length === 1))
  results.push(caseResult('assembly_27_revised_links_prior_plan', 'Revised plan links to the prior plan.', 'valid', revisedMission.previousPlanId === validPlan.planId && revisedMission.previousPlanVersion === validPlan.planVersion))
  results.push(caseResult('assembly_28_stable_group_provenance_only', 'Stable Group mapping is provenance-only.', 'valid', stableGroupPlan.uncertaintyFlags.includes('legacy_stable_group_mapping_is_provenance_only') && stableGroupPlan.advisoryNotice.includes('not used for execution')))
  results.push(caseResult('assembly_29_full_council_provenance_only', 'Full Council mapping is provenance-only.', 'valid', fullCouncilPlan.uncertaintyFlags.includes('legacy_full_council_mapping_is_provenance_only') && fullCouncilPlan.participationPreset === 'comprehensive'))
  results.push(caseResult('assembly_30_advisory_honesty_label', 'Advisory output says it was not used for execution.', 'valid', validPlan.advisoryNotice === 'Recommended assembly — not used for execution.'))
  results.push(caseResult('assembly_31_planner_does_not_call_api_chat', 'Planner does not call /api/chat.', 'valid', !JSON.stringify(validPlan).includes('/api/chat')))
  results.push(caseResult('assembly_32_execution_config_unchanged', 'Planner does not alter current execution configuration.', 'valid', validPlan.planStatus === 'advisory' || validPlan.planStatus === 'unresolved'))
  results.push(caseResult('assembly_33_no_live_research_claim_without_evidence', 'No live research claim appears without real evidence.', 'valid', !JSON.stringify(currentIntelPlan).includes('research occurred')))
  results.push(caseResult('assembly_34_cost_uncertainty_explicit', 'Cost uncertainty remains explicit when unknown-tier families are selected.', 'valid', currentIntelPlan.estimatedCostTier === 'unknown' || currentIntelPlan.uncertaintyFlags.some(flag => flag.includes('availability_unknown'))))
  results.push(caseResult('assembly_35_missing_registry_family_fails_safe', 'Missing registry family fails safely.', 'invalid', (() => {
    try {
      createCapabilityRegistry(FAMILY_CAPABILITY_PROFILES.filter(profile => profile.familyId !== 'chatgpt'))
      return createAssemblyPlan({ missionId: 'validation', missionVersion: 1, commanderMessage: 'strategy synthesis', createdAt: '2026-07-19T00:00:00.000Z' }, createCapabilityRegistry(FAMILY_CAPABILITY_PROFILES.filter(profile => profile.familyId !== 'chatgpt'))).selectedFamilies.length > 0
    } catch {
      return false
    }
  })()))
  results.push(caseResult('assembly_36_same_input_same_plan', 'Same input produces the same plan.', 'valid', JSON.stringify(plan('Build a repo architecture plan.', { createdAt: '2026-07-19T00:00:00.000Z' })) === JSON.stringify(plan('Build a repo architecture plan.', { createdAt: '2026-07-19T00:00:00.000Z' }))))
  results.push(caseResult('assembly_37_unsupported_override_marked', 'Unsupported override is marked correctly.', 'valid', unsupportedOverridePlan.commanderOverrides[0]?.supportStatus === 'recorded_for_future_execution'))
  results.push(caseResult('assembly_38_synth_fallback_deterministic', 'Synthesizer fallback order is deterministic.', 'valid', JSON.stringify(validPlan.synthesisFallbacks) === JSON.stringify(plan('Build a repo architecture plan for debugging deployment risk.').synthesisFallbacks)))
  results.push(caseResult('assembly_39_unavailable_not_selected_unless_forced', 'Known unavailable family is not selected unless explicitly forced and marked unresolved.', 'valid', !unavailableGrokPlan.selectedFamilies.includes('grok') && forcedUnavailableGrokPlan.selectedFamilies.includes('grok') && forcedUnavailableGrokPlan.uncertaintyFlags.includes('forced_unavailable_family:grok')))
  results.push(caseResult('assembly_40_unknown_availability_not_healthy', 'Unknown availability is not treated as proven healthy.', 'valid', validRegistry.profiles.filter(profile => profile.availability === 'unknown').every(profile => profile.availabilitySource === 'no_live_health_source_connected')))
  results.push(caseResult('assembly_41_capability_vocabulary_typed', 'Capability vocabulary remains a finite typed list.', 'valid', COUNCIL_CAPABILITIES.length === new Set(COUNCIL_CAPABILITIES).size))
  results.push(caseResult('assembly_42_chosen_profile_covers_required_capabilities', 'A selected engineering family must cover required engineering capabilities or report unresolved capabilities.', 'valid', claudeOnlyEngineeringPlan.selectedFamilies.includes('claude') && claudeOnlyEngineeringPlan.unresolvedCapabilities.length === 0))
  results.push(caseResult('assembly_43_synthesis_not_hardcoded_chatgpt', 'Synthesis authority is not hardcoded to ChatGPT when ChatGPT is excluded.', 'valid', noChatGptSynthesisPlan.synthesisAuthority.primaryFamily !== 'chatgpt'))
  results.push(caseResult('assembly_44_default_availability_unknown_without_health_source', 'Default profile availability remains unknown without a live health source.', 'valid', validRegistry.profiles.find(profile => profile.familyId === 'chatgpt')?.availability === 'unknown'))
  results.push(caseResult(
    'assembly_45_no_prohibited_execution_imports_in_source',
    'The shipped adaptive-assembly module source (excluding this validation file) contains no fetch/provider-call/execution-path-import primitive, statically -- catches an added-but-unused prohibited reference a dynamic spy would miss.',
    'valid',
    findProhibitedExecutionSourceTokens().length === 0,
    findProhibitedExecutionSourceTokens(),
  ))

  return results
}
