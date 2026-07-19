import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { CouncilCapability } from './capabilities'
import {
  costTierFromFamilies,
  createPlanId,
  dependencyIntentForClassification,
  familyReason,
  latencyTierFromFamilies,
  markAssemblyPlanReady,
  missingCapabilities,
  reviseAssemblyPlan,
  speakingRolesForFamilies,
  validateAssemblyPlan,
} from './assemblyPlan'
import { classifyMission } from './missionClassification'
import {
  FAMILY_CAPABILITY_REGISTRY,
  type CapabilityRegistry,
  createCapabilityRegistry,
} from './registry'
import type {
  AssemblyPlanRevisionInput,
  CommanderOverride,
  CouncilAssemblyPlan,
  CouncilAssemblyPlannerInput,
  FamilyCapabilityProfile,
  FamilySelectionReason,
  ParticipationPreset,
  PlanStatus,
  SynthesisAuthorityPlan,
} from './types'

const SUPPORTED_OVERRIDE_TYPES = new Set([
  'add_family',
  'exclude_family',
  'require_red_team',
  'require_live_research',
  'prioritize_speed',
  'prioritize_depth',
  'set_cost_ceiling',
  'force_comprehensive',
  'request_direct_family',
  'prevent_synthesis',
  'stop_deliberation',
])

const FAMILY_ORDER: CouncilOrchestrationFamily[] = [
  'chatgpt',
  'claude',
  'grok',
  'gemini',
  'kimi',
  'red_team',
  'bridge_architect',
  'baby',
]

function familyFromValue(value: unknown): CouncilOrchestrationFamily | null {
  return typeof value === 'string' && FAMILY_ORDER.includes(value as CouncilOrchestrationFamily)
    ? value as CouncilOrchestrationFamily
    : null
}

function profileCapabilityScore(profile: FamilyCapabilityProfile, required: readonly CouncilCapability[], optional: readonly CouncilCapability[]): number {
  const configured = new Set(profile.configuredCapabilities)
  const preferred = new Set(profile.preferredCapabilities)
  let score = 0
  for (const capability of required) {
    if (configured.has(capability)) score += 3
    if (preferred.has(capability)) score += 1
  }
  for (const capability of optional) {
    if (configured.has(capability)) score += 1
  }
  if (profile.availability === 'available') score += 1
  if (profile.availability === 'unknown') score -= 0.25
  if (profile.availability === 'degraded') score -= 0.5
  if (profile.availability === 'unavailable') score -= 5
  if (profile.configuredCostTier === 'low') score += 0.2
  if (profile.configuredLatencyTier === 'fast') score += 0.2
  return score
}

function supportsAny(profile: FamilyCapabilityProfile, capabilities: readonly CouncilCapability[]): boolean {
  return capabilities.some(capability => profile.configuredCapabilities.includes(capability))
}

function supportsRequired(profile: FamilyCapabilityProfile, required: readonly CouncilCapability[]): CouncilCapability[] {
  return required.filter(capability => profile.configuredCapabilities.includes(capability))
}

function addReason(
  reasons: Map<CouncilOrchestrationFamily, string[]>,
  familyId: CouncilOrchestrationFamily,
  reason: string,
): void {
  const next = reasons.get(familyId) ?? []
  next.push(reason)
  reasons.set(familyId, next)
}

function normalizeOverrides(overrides: readonly CommanderOverride[]): {
  overrides: CommanderOverride[]
  includeFamilies: Set<CouncilOrchestrationFamily>
  excludeFamilies: Set<CouncilOrchestrationFamily>
  errors: string[]
  uncertaintyFlags: string[]
} {
  const includeFamilies = new Set<CouncilOrchestrationFamily>()
  const excludeFamilies = new Set<CouncilOrchestrationFamily>()
  const errors: string[] = []
  const uncertaintyFlags: string[] = []
  const normalized = overrides.map((override) => {
    if (!SUPPORTED_OVERRIDE_TYPES.has(override.overrideType)) {
      uncertaintyFlags.push(`unsupported_override:${override.overrideType}`)
      return { ...override, supportStatus: 'recorded_for_future_execution' as const }
    }
    const family = familyFromValue(override.value)
    if ((override.overrideType === 'add_family' || override.overrideType === 'request_direct_family') && family) {
      includeFamilies.add(family)
    }
    if (override.overrideType === 'exclude_family' && family) {
      excludeFamilies.add(family)
    }
    return { ...override, supportStatus: 'supported_now' as const }
  })

  for (const family of includeFamilies) {
    if (excludeFamilies.has(family)) errors.push(`contradictory_override_include_and_exclude:${family}`)
  }

  const preventSynthesis = normalized.some(override => override.overrideType === 'prevent_synthesis')
  const forceComprehensive = normalized.some(override => override.overrideType === 'force_comprehensive')
  const maxProviderOverride = normalized.find(override => override.overrideType === 'set_cost_ceiling')
  if (preventSynthesis && normalized.some(override => override.overrideType === 'prioritize_depth')) {
    errors.push('contradictory_override_prevent_synthesis_and_prioritize_depth')
  }
  if (forceComprehensive && maxProviderOverride?.value === 1) {
    errors.push('contradictory_override_force_comprehensive_with_single_provider_limit')
  }

  return { overrides: normalized, includeFamilies, excludeFamilies, errors, uncertaintyFlags }
}

function maxProvidersForPreset(preset: ParticipationPreset): number {
  if (preset === 'focused') return 2
  if (preset === 'comprehensive') return 5
  return 3
}

function resolveSynthesisAuthority(input: {
  selectedFamilies: readonly CouncilOrchestrationFamily[]
  profiles: readonly FamilyCapabilityProfile[]
  preventSynthesis: boolean
  requiredCapabilities: readonly CouncilCapability[]
  reasons: Map<CouncilOrchestrationFamily, string[]>
}): SynthesisAuthorityPlan {
  if (input.preventSynthesis) {
    return {
      status: 'prevented_by_commander',
      primaryFamily: null,
      fallbackFamilies: [],
      reason: 'Commander override prevents synthesis planning.',
    }
  }

  const selectedProfiles = input.selectedFamilies
    .map(family => input.profiles.find(profile => profile.familyId === family))
    .filter((profile): profile is FamilyCapabilityProfile => Boolean(profile))
    .filter(profile => profile.synthesisEligible)
  const ranked = [...selectedProfiles].sort((a, b) => {
    const bScore = profileCapabilityScore(b, input.requiredCapabilities, ['synthesis'])
    const aScore = profileCapabilityScore(a, input.requiredCapabilities, ['synthesis'])
    if (bScore !== aScore) return bScore - aScore
    return FAMILY_ORDER.indexOf(a.familyId) - FAMILY_ORDER.indexOf(b.familyId)
  })
  const primary = ranked[0] ?? null
  if (!primary) {
    return {
      status: 'unresolved',
      primaryFamily: null,
      fallbackFamilies: [],
      reason: 'No selected synthesis-eligible family is available in the advisory plan.',
    }
  }
  addReason(input.reasons, primary.familyId, 'Selected as synthesis authority because it is synthesisEligible and matched the mission capability profile.')
  return {
    status: ranked.length > 1 ? 'fallback_available' : 'resolved',
    primaryFamily: primary.familyId,
    fallbackFamilies: ranked.slice(1).map(profile => profile.familyId),
    reason: `${primary.displayName} is the highest-ranked selected synthesis-eligible family for this mission profile.`,
  }
}

export function createAssemblyPlan(
  input: CouncilAssemblyPlannerInput,
  registry: CapabilityRegistry = FAMILY_CAPABILITY_REGISTRY,
): CouncilAssemblyPlan {
  createCapabilityRegistry(registry.profiles)
  const overrideState = normalizeOverrides(input.commanderOverrides ?? [])
  const classification = classifyMission({
    commanderMessage: input.commanderMessage,
    commanderOverrides: overrideState.overrides,
  })
  const selected: CouncilOrchestrationFamily[] = []
  const optional: CouncilOrchestrationFamily[] = []
  const excluded = new Set<CouncilOrchestrationFamily>()
  const selectionReasons = new Map<CouncilOrchestrationFamily, string[]>()
  const exclusionReasons = new Map<CouncilOrchestrationFamily, string[]>()
  const uncertaintyFlags = [...classification.uncertaintyFlags, ...overrideState.uncertaintyFlags]
  let preset = classification.recommendedParticipationPreset

  if (input.legacyCompatibilityOrigin === 'stable_group') {
    uncertaintyFlags.push('legacy_stable_group_mapping_is_provenance_only')
    if (preset === 'comprehensive') preset = 'standard'
  }
  if (input.legacyCompatibilityOrigin === 'full_council') {
    uncertaintyFlags.push('legacy_full_council_mapping_is_provenance_only')
    preset = 'comprehensive'
  }

  const maxProviderCount = input.maxProviderCount ?? maxProvidersForPreset(preset)
  if (overrideState.errors.length) uncertaintyFlags.push(...overrideState.errors)
  if (overrideState.overrides.some(override => override.overrideType === 'force_comprehensive')) preset = 'comprehensive'

  for (const profile of registry.profiles) {
    if (overrideState.excludeFamilies.has(profile.familyId)) {
      excluded.add(profile.familyId)
      addReason(exclusionReasons, profile.familyId, 'Commander exclude override prevents advisory selection.')
      continue
    }
    if (!supportsAny(profile, [...classification.requiredCapabilities, ...classification.optionalCapabilities])) {
      excluded.add(profile.familyId)
      addReason(exclusionReasons, profile.familyId, 'Configured capability profile does not match required or optional mission capabilities.')
      continue
    }
    if (profile.profileStatus !== 'active') {
      excluded.add(profile.familyId)
      addReason(exclusionReasons, profile.familyId, `Profile status is ${profile.profileStatus}.`)
      continue
    }
    if (profile.availability === 'unavailable' && !overrideState.includeFamilies.has(profile.familyId)) {
      excluded.add(profile.familyId)
      addReason(exclusionReasons, profile.familyId, 'Family availability is known unavailable and no Commander include override exists.')
      continue
    }
    if (profile.availability === 'unknown') {
      uncertaintyFlags.push(`availability_unknown:${profile.familyId}`)
    }
  }

  const redTeamRequired = classification.redTeamRequirement === 'mandatory'
    || overrideState.overrides.some(override => override.overrideType === 'require_red_team')
  if (redTeamRequired && !overrideState.excludeFamilies.has('red_team')) {
    selected.push('red_team')
    addReason(selectionReasons, 'red_team', `Red Team selected because redTeamRequirement=${classification.redTeamRequirement}.`)
  }

  for (const family of overrideState.includeFamilies) {
    if (!selected.includes(family)) {
      selected.push(family)
      addReason(selectionReasons, family, 'Commander include override requested this family.')
      const profile = registry.profiles.find(item => item.familyId === family)
      if (profile?.availability === 'unavailable') uncertaintyFlags.push(`forced_unavailable_family:${family}`)
    }
  }

  const candidateProfiles = [...registry.profiles]
    .filter(profile => !excluded.has(profile.familyId))
    .filter(profile => !selected.includes(profile.familyId))
    .filter(profile => profile.familyId !== 'red_team' || redTeamRequired)
    .sort((a, b) => {
      const bScore = profileCapabilityScore(b, classification.requiredCapabilities, classification.optionalCapabilities)
      const aScore = profileCapabilityScore(a, classification.requiredCapabilities, classification.optionalCapabilities)
      if (bScore !== aScore) return bScore - aScore
      return FAMILY_ORDER.indexOf(a.familyId) - FAMILY_ORDER.indexOf(b.familyId)
    })

  for (const profile of candidateProfiles) {
    if (selected.length >= maxProviderCount) {
      optional.push(profile.familyId)
      addReason(exclusionReasons, profile.familyId, 'Family matches mission but maxProviderCount reserved it as optional.')
      continue
    }
    const matchedRequired = supportsRequired(profile, classification.requiredCapabilities)
    if (!matchedRequired.length && selected.length > 0) {
      optional.push(profile.familyId)
      addReason(exclusionReasons, profile.familyId, 'Family only matched optional capabilities after required coverage was already represented.')
      continue
    }
    selected.push(profile.familyId)
    addReason(
      selectionReasons,
      profile.familyId,
      `${profile.displayName} selected because configured profile includes ${[
        ...matchedRequired,
        ...classification.optionalCapabilities.filter(capability => profile.configuredCapabilities.includes(capability)),
      ].join(', ') || 'general reasoning'}.`,
    )
  }

  const selectedCapabilities = selected.flatMap((family) => {
    const profile = registry.profiles.find(item => item.familyId === family)
    return profile ? [...profile.configuredCapabilities] : []
  })
  const unresolvedCapabilities = missingCapabilities(classification.requiredCapabilities, selectedCapabilities)
  if (unresolvedCapabilities.length) uncertaintyFlags.push(`unresolved_capabilities:${unresolvedCapabilities.join(',')}`)

  const preventSynthesis = overrideState.overrides.some(override => override.overrideType === 'prevent_synthesis')
  const synthesisAuthority = resolveSynthesisAuthority({
    selectedFamilies: selected,
    profiles: registry.profiles,
    preventSynthesis,
    requiredCapabilities: classification.requiredCapabilities,
    reasons: selectionReasons,
  })

  const selectedProfiles = selected
    .map(family => registry.profiles.find(profile => profile.familyId === family))
    .filter((profile): profile is FamilyCapabilityProfile => Boolean(profile))
  const estimatedCostTier = costTierFromFamilies(selectedProfiles.map(profile => profile.configuredCostTier))
  const latencyTarget = latencyTierFromFamilies(selectedProfiles.map(profile => profile.configuredLatencyTier))
  const planStatus: PlanStatus = overrideState.errors.length || selected.length === 0
    ? 'invalid'
    : unresolvedCapabilities.length
      ? 'unresolved'
      : 'advisory'
  const createdAt = input.createdAt ?? new Date().toISOString()
  const planVersion = 1
  const planId = createPlanId({
    missionId: input.missionId,
    missionVersion: input.missionVersion,
    planVersion,
    selectedFamilies: selected,
    overrides: overrideState.overrides,
  })
  const dependencyIntent = dependencyIntentForClassification(classification)
  const redTeamIncluded = selected.includes('red_team')
  const allExcludedReasons: FamilySelectionReason[] = [
    ...[...excluded].map(family => familyReason(family, exclusionReasons.get(family) ?? ['Excluded by deterministic planner.'])),
    ...optional.map(family => familyReason(family, exclusionReasons.get(family) ?? ['Reserved as optional by deterministic planner.'])),
  ]

  return Object.freeze({
    planId,
    planVersion,
    previousPlanId: null,
    previousPlanVersion: null,
    missionId: input.missionId,
    missionVersion: input.missionVersion,
    missionClassification: classification.missionClassification,
    requiredCapabilities: classification.requiredCapabilities,
    optionalCapabilities: classification.optionalCapabilities,
    selectedFamilies: Object.freeze([...new Set(selected)]),
    optionalFamilies: Object.freeze([...new Set(optional)]),
    excludedFamilies: Object.freeze([...new Set([...excluded])]),
    selectionReasons: Object.freeze([...new Set(selected)].map(family => familyReason(family, selectionReasons.get(family) ?? []))),
    exclusionReasons: Object.freeze(allExcludedReasons),
    speakingRoles: Object.freeze(speakingRolesForFamilies({
      selectedFamilies: [...new Set(selected)],
      redTeamIncluded,
      synthesizer: synthesisAuthority.primaryFamily,
    })),
    dependencyIntent: Object.freeze(dependencyIntent),
    evidenceRequirement: classification.evidenceRequirement,
    redTeamRequirement: classification.redTeamRequirement,
    redTeamTriggerReasons: classification.redTeamTriggerReasons,
    revisionRequirement: classification.redTeamRequirement === 'mandatory' ? 'possible' : 'not_required',
    synthesisAuthority,
    synthesisFallbacks: synthesisAuthority.fallbackFamilies,
    minimumUsableFamilies: Math.min(1, selected.length),
    maxProviderCount,
    maxTurns: dependencyIntent.includes('challenge_required') ? 5 : 3,
    estimatedCostTier,
    costCeiling: null,
    latencyTarget,
    providerTimeoutIntent: latencyTarget === 'fast' ? 'short' : 'standard',
    totalMissionTimeoutIntent: preset === 'comprehensive' ? 'extended' : 'standard',
    fallbackPlan: 'If selected families cannot cover required capabilities, surface unresolvedCapabilities and request Commander clarification.',
    commanderOverrides: Object.freeze(overrideState.overrides),
    participationPreset: preset,
    unresolvedCapabilities,
    uncertaintyFlags: Object.freeze([...new Set(uncertaintyFlags)]),
    planStatus,
    planProvenance: input.legacyCompatibilityOrigin ? 'legacy_mapping' : 'deterministic_planner',
    advisoryNotice: 'Recommended assembly — not used for execution.',
    createdAt,
  })
}

export function reviseCouncilAssemblyPlan(
  input: AssemblyPlanRevisionInput,
  registry: CapabilityRegistry = FAMILY_CAPABILITY_REGISTRY,
): CouncilAssemblyPlan {
  return reviseAssemblyPlan(input, (args) => {
    const next = createAssemblyPlan({
      missionId: input.previousPlan.missionId,
      missionVersion: args.missionVersion,
      commanderMessage: args.commanderMessage ?? '',
      commanderOverrides: args.commanderOverrides ?? input.previousPlan.commanderOverrides,
      createdAt: args.createdAt,
      maxProviderCount: input.previousPlan.maxProviderCount,
    }, registry)
    return Object.freeze({
      ...next,
      planId: createPlanId({
        missionId: next.missionId,
        missionVersion: next.missionVersion,
        planVersion: args.planVersion,
        selectedFamilies: next.selectedFamilies,
        overrides: next.commanderOverrides,
      }),
      planVersion: args.planVersion,
      previousPlanId: args.previousPlanId,
      previousPlanVersion: args.previousPlanVersion,
      planProvenance: input.provenance,
    })
  })
}

export { markAssemblyPlanReady, validateAssemblyPlan }
