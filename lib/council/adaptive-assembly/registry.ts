import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { isCouncilCapability, validateCapabilityList, type CouncilCapability } from './capabilities'
import type {
  CapabilityProvenance,
  CostTier,
  FamilyAvailability,
  FamilyCapabilityProfile,
  LatencyTier,
  MissionRiskLevel,
  ProfileStatus,
} from './types'

const PROFILE_VERSION = '48c3b1.family-capability-profile.v1'
const REGISTRY_VERSION = '48c3b1.capability-registry.v1'
const REQUIRED_FAMILIES: readonly CouncilOrchestrationFamily[] = [
  'chatgpt',
  'claude',
  'grok',
  'gemini',
  'kimi',
  'red_team',
  'baby',
  'bridge_architect',
]

function profile(input: {
  familyId: CouncilOrchestrationFamily
  displayName: string
  configuredCapabilities: CouncilCapability[]
  preferredCapabilities: CouncilCapability[]
  restrictedCapabilities?: CouncilCapability[]
  synthesisEligible: boolean
  redTeamEligible: boolean
  researchEligible: boolean
  configuredCostTier: CostTier
  configuredLatencyTier: LatencyTier
  maximumRecommendedMissionRisk: MissionRiskLevel
  availability?: FamilyAvailability
  availabilitySource?: string
  profileStatus?: ProfileStatus
  provenance?: CapabilityProvenance
}): FamilyCapabilityProfile {
  return Object.freeze({
    familyId: input.familyId,
    displayName: input.displayName,
    configuredCapabilities: validateCapabilityList(input.configuredCapabilities),
    preferredCapabilities: validateCapabilityList(input.preferredCapabilities),
    restrictedCapabilities: validateCapabilityList(input.restrictedCapabilities ?? []),
    synthesisEligible: input.synthesisEligible,
    redTeamEligible: input.redTeamEligible,
    researchEligible: input.researchEligible,
    configuredCostTier: input.configuredCostTier,
    configuredLatencyTier: input.configuredLatencyTier,
    maximumRecommendedMissionRisk: input.maximumRecommendedMissionRisk,
    availability: input.availability ?? 'unknown',
    availabilitySource: input.availabilitySource ?? 'no_live_health_source_connected',
    profileVersion: PROFILE_VERSION,
    profileStatus: input.profileStatus ?? 'active',
    provenance: input.provenance ?? 'configured_policy',
    lastReviewedAt: null,
  })
}

export const FAMILY_CAPABILITY_PROFILES = Object.freeze([
  profile({
    familyId: 'chatgpt',
    displayName: 'ChatGPT',
    configuredCapabilities: [
      'general_reasoning',
      'strategic_planning',
      'broad_knowledge_synthesis',
      'comparative_analysis',
      'concise_response',
      'deep_analysis',
      'synthesis',
      'tool_eligible',
    ],
    preferredCapabilities: ['strategic_planning', 'synthesis', 'broad_knowledge_synthesis'],
    synthesisEligible: true,
    redTeamEligible: false,
    researchEligible: false,
    configuredCostTier: 'medium',
    configuredLatencyTier: 'moderate',
    maximumRecommendedMissionRisk: 'high',
  }),
  profile({
    familyId: 'claude',
    displayName: 'Claude',
    configuredCapabilities: [
      'general_reasoning',
      'systems_architecture',
      'software_engineering',
      'comparative_analysis',
      'task_decomposition',
      'deep_analysis',
      'synthesis',
      'tool_eligible',
    ],
    preferredCapabilities: ['systems_architecture', 'software_engineering', 'task_decomposition'],
    synthesisEligible: true,
    redTeamEligible: false,
    researchEligible: false,
    configuredCostTier: 'medium',
    configuredLatencyTier: 'moderate',
    maximumRecommendedMissionRisk: 'high',
  }),
  profile({
    familyId: 'grok',
    displayName: 'Grok',
    configuredCapabilities: [
      'general_reasoning',
      'current_information',
      'evidence_research',
      'comparative_analysis',
      'research_eligible',
      'tool_eligible',
    ],
    preferredCapabilities: ['current_information', 'evidence_research'],
    synthesisEligible: false,
    redTeamEligible: false,
    researchEligible: true,
    configuredCostTier: 'medium',
    configuredLatencyTier: 'fast',
    maximumRecommendedMissionRisk: 'medium',
  }),
  profile({
    familyId: 'gemini',
    displayName: 'Gemini',
    configuredCapabilities: [
      'general_reasoning',
      'broad_knowledge_synthesis',
      'visual_reasoning',
      'historical_analysis',
      'comparative_analysis',
      'evidence_research',
      'synthesis',
      'research_eligible',
    ],
    preferredCapabilities: ['visual_reasoning', 'historical_analysis', 'broad_knowledge_synthesis'],
    synthesisEligible: true,
    redTeamEligible: false,
    researchEligible: true,
    configuredCostTier: 'unknown',
    configuredLatencyTier: 'unknown',
    maximumRecommendedMissionRisk: 'medium',
  }),
  profile({
    familyId: 'kimi',
    displayName: 'Kimi',
    configuredCapabilities: [
      'general_reasoning',
      'task_decomposition',
      'software_engineering',
      'comparative_analysis',
      'deep_analysis',
      'synthesis',
    ],
    preferredCapabilities: ['task_decomposition', 'software_engineering'],
    synthesisEligible: true,
    redTeamEligible: false,
    researchEligible: false,
    configuredCostTier: 'unknown',
    configuredLatencyTier: 'unknown',
    maximumRecommendedMissionRisk: 'medium',
    availability: 'unknown',
  }),
  profile({
    familyId: 'red_team',
    displayName: 'Red Team',
    configuredCapabilities: [
      'general_reasoning',
      'adversarial_review',
      'high_risk_review',
      'comparative_analysis',
      'deep_analysis',
    ],
    preferredCapabilities: ['adversarial_review', 'high_risk_review'],
    synthesisEligible: false,
    redTeamEligible: true,
    researchEligible: false,
    configuredCostTier: 'medium',
    configuredLatencyTier: 'moderate',
    maximumRecommendedMissionRisk: 'high',
  }),
  profile({
    familyId: 'baby',
    displayName: 'Baby AI Observer',
    configuredCapabilities: [
      'general_reasoning',
      'broad_knowledge_synthesis',
      'comparative_analysis',
      'concise_response',
    ],
    preferredCapabilities: ['general_reasoning', 'broad_knowledge_synthesis'],
    restrictedCapabilities: ['tool_eligible', 'research_eligible'],
    synthesisEligible: false,
    redTeamEligible: false,
    researchEligible: false,
    configuredCostTier: 'low',
    configuredLatencyTier: 'fast',
    maximumRecommendedMissionRisk: 'low',
    provenance: 'manually_assigned',
  }),
  profile({
    familyId: 'bridge_architect',
    displayName: 'Bridge Architect',
    configuredCapabilities: [
      'general_reasoning',
      'software_engineering',
      'systems_architecture',
      'task_decomposition',
      'comparative_analysis',
    ],
    preferredCapabilities: ['software_engineering', 'task_decomposition'],
    synthesisEligible: false,
    redTeamEligible: false,
    researchEligible: false,
    configuredCostTier: 'low',
    configuredLatencyTier: 'fast',
    maximumRecommendedMissionRisk: 'medium',
    provenance: 'manually_assigned',
  }),
] satisfies readonly FamilyCapabilityProfile[])

export type CapabilityRegistry = {
  registryVersion: string
  profiles: readonly FamilyCapabilityProfile[]
}

export function validateFamilyCapabilityProfiles(profiles: readonly FamilyCapabilityProfile[]): string[] {
  const errors: string[] = []
  const seenFamilies = new Set<CouncilOrchestrationFamily>()

  for (const profileItem of profiles) {
    if (seenFamilies.has(profileItem.familyId)) errors.push(`duplicate_family:${profileItem.familyId}`)
    seenFamilies.add(profileItem.familyId)
    for (const capability of [
      ...profileItem.configuredCapabilities,
      ...profileItem.preferredCapabilities,
      ...profileItem.restrictedCapabilities,
    ]) {
      if (!isCouncilCapability(capability)) errors.push(`invalid_capability:${profileItem.familyId}:${String(capability)}`)
    }
    if (!profileItem.profileVersion) errors.push(`missing_profile_version:${profileItem.familyId}`)
  }
  for (const familyId of REQUIRED_FAMILIES) {
    if (!seenFamilies.has(familyId)) errors.push(`missing_family:${familyId}`)
  }

  return errors
}

export function createCapabilityRegistry(
  profiles: readonly FamilyCapabilityProfile[] = FAMILY_CAPABILITY_PROFILES,
): CapabilityRegistry {
  const errors = validateFamilyCapabilityProfiles(profiles)
  if (errors.length) throw new Error(`Invalid capability registry: ${errors.join('; ')}`)
  return Object.freeze({
    registryVersion: REGISTRY_VERSION,
    profiles: Object.freeze([...profiles]),
  })
}

export const FAMILY_CAPABILITY_REGISTRY = createCapabilityRegistry()

export function getFamilyCapabilityProfile(
  familyId: CouncilOrchestrationFamily,
  registry: CapabilityRegistry = FAMILY_CAPABILITY_REGISTRY,
): FamilyCapabilityProfile | null {
  return registry.profiles.find(profileItem => profileItem.familyId === familyId) ?? null
}
