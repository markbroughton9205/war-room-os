import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { CouncilCapability } from './capabilities'

export type CostTier = 'low' | 'medium' | 'high' | 'unknown'
export type LatencyTier = 'fast' | 'moderate' | 'slow' | 'unknown'
export type FamilyAvailability = 'available' | 'unavailable' | 'degraded' | 'unknown'
export type CapabilityProvenance = 'configured_policy' | 'observed_support' | 'manually_assigned' | 'unknown'
export type ProfileStatus = 'active' | 'inactive' | 'deprecated'
export type MissionRiskLevel = 'low' | 'medium' | 'high'

export type FamilyCapabilityProfile = {
  readonly familyId: CouncilOrchestrationFamily
  readonly displayName: string
  readonly configuredCapabilities: readonly CouncilCapability[]
  readonly preferredCapabilities: readonly CouncilCapability[]
  readonly restrictedCapabilities: readonly CouncilCapability[]
  readonly synthesisEligible: boolean
  readonly redTeamEligible: boolean
  readonly researchEligible: boolean
  readonly configuredCostTier: CostTier
  readonly configuredLatencyTier: LatencyTier
  readonly maximumRecommendedMissionRisk: MissionRiskLevel
  readonly availability: FamilyAvailability
  readonly availabilitySource: string
  readonly profileVersion: string
  readonly profileStatus: ProfileStatus
  readonly provenance: CapabilityProvenance
  readonly lastReviewedAt: string | null
}

export type MissionClassificationKind =
  | 'general'
  | 'strategy'
  | 'engineering'
  | 'current_intelligence'
  | 'research'
  | 'numerical'
  | 'historical'
  | 'high_risk'
  | 'execution_planning'
  | 'mixed'
  | 'unknown'
  | 'requires_commander_clarification'

export type EvidenceRequirement = 'not_required' | 'recommended' | 'required' | 'live_required' | 'unavailable' | 'unresolved'
export type RedTeamRequirement = 'mandatory' | 'conditional' | 'optional' | 'omitted'
export type RecommendedDepth = 'concise' | 'standard' | 'deep'
export type ParticipationPreset = 'focused' | 'standard' | 'comprehensive'
export type DependencyIntent =
  | 'opening_required'
  | 'direct_review_required'
  | 'challenge_required'
  | 'revision_possible'
  | 'synthesis_required'
export type SynthesisAuthorityStatus = 'resolved' | 'fallback_available' | 'unresolved' | 'prevented_by_commander'
export type PlanStatus = 'draft' | 'advisory' | 'execution_ready' | 'execution_started' | 'superseded' | 'invalid' | 'unresolved'
export type PlanProvenance = 'deterministic_planner' | 'commander_override' | 'legacy_mapping' | 'validation_fixture'

export type MissionClassification = {
  readonly missionClassification: MissionClassificationKind
  readonly requiredCapabilities: readonly CouncilCapability[]
  readonly optionalCapabilities: readonly CouncilCapability[]
  readonly riskLevel: MissionRiskLevel
  readonly liveDataRequirement: EvidenceRequirement
  readonly evidenceRequirement: EvidenceRequirement
  readonly redTeamRequirement: RedTeamRequirement
  readonly redTeamTriggerReasons: readonly string[]
  readonly synthesisRequirement: 'required' | 'recommended' | 'optional' | 'prevented'
  readonly recommendedDepth: RecommendedDepth
  readonly recommendedParticipationPreset: ParticipationPreset
  readonly uncertaintyFlags: readonly string[]
}

export type CommanderOverrideType =
  | 'add_family'
  | 'exclude_family'
  | 'require_red_team'
  | 'require_live_research'
  | 'prioritize_speed'
  | 'prioritize_depth'
  | 'set_cost_ceiling'
  | 'force_comprehensive'
  | 'request_direct_family'
  | 'prevent_synthesis'
  | 'stop_deliberation'
  | string

export type OverrideSupportStatus = 'supported_now' | 'recorded_for_future_execution' | 'incompatible' | 'unresolved'

export type CommanderOverride = {
  readonly overrideId: string
  readonly overrideType: CommanderOverrideType
  readonly value: unknown
  readonly issuedBy: string
  readonly issuedAt: string
  readonly missionVersion: number
  readonly planVersion: number
  readonly provenance: PlanProvenance
  readonly supportStatus: OverrideSupportStatus
}

export type FamilySelectionReason = {
  readonly familyId: CouncilOrchestrationFamily
  readonly reasons: readonly string[]
}

export type SpeakingRole = {
  readonly familyId: CouncilOrchestrationFamily
  readonly role: 'opening' | 'review' | 'challenge' | 'synthesis' | 'observer' | 'optional'
}

export type SynthesisAuthorityPlan = {
  readonly status: SynthesisAuthorityStatus
  readonly primaryFamily: CouncilOrchestrationFamily | null
  readonly fallbackFamilies: readonly CouncilOrchestrationFamily[]
  readonly reason: string
}

export type CouncilAssemblyPlan = {
  readonly planId: string
  readonly planVersion: number
  readonly previousPlanId: string | null
  readonly previousPlanVersion: number | null
  readonly missionId: string
  readonly missionVersion: number
  readonly missionClassification: MissionClassificationKind
  readonly requiredCapabilities: readonly CouncilCapability[]
  readonly optionalCapabilities: readonly CouncilCapability[]
  readonly selectedFamilies: readonly CouncilOrchestrationFamily[]
  readonly optionalFamilies: readonly CouncilOrchestrationFamily[]
  readonly excludedFamilies: readonly CouncilOrchestrationFamily[]
  readonly selectionReasons: readonly FamilySelectionReason[]
  readonly exclusionReasons: readonly FamilySelectionReason[]
  readonly speakingRoles: readonly SpeakingRole[]
  readonly dependencyIntent: readonly DependencyIntent[]
  readonly evidenceRequirement: EvidenceRequirement
  readonly redTeamRequirement: RedTeamRequirement
  readonly redTeamTriggerReasons: readonly string[]
  readonly revisionRequirement: 'required' | 'possible' | 'not_required'
  readonly synthesisAuthority: SynthesisAuthorityPlan
  readonly synthesisFallbacks: readonly CouncilOrchestrationFamily[]
  readonly minimumUsableFamilies: number
  readonly maxProviderCount: number
  readonly maxTurns: number
  readonly estimatedCostTier: CostTier
  readonly costCeiling: CostTier | null
  readonly latencyTarget: LatencyTier
  readonly providerTimeoutIntent: 'short' | 'standard' | 'extended'
  readonly totalMissionTimeoutIntent: 'short' | 'standard' | 'extended'
  readonly fallbackPlan: string
  readonly commanderOverrides: readonly CommanderOverride[]
  readonly participationPreset: ParticipationPreset
  readonly unresolvedCapabilities: readonly CouncilCapability[]
  readonly uncertaintyFlags: readonly string[]
  readonly planStatus: PlanStatus
  readonly planProvenance: PlanProvenance
  readonly advisoryNotice: 'Recommended assembly — not used for execution.'
  readonly createdAt: string
}

export type CouncilAssemblyPlannerInput = {
  readonly missionId: string
  readonly missionVersion: number
  readonly commanderMessage: string
  readonly createdAt?: string
  readonly maxProviderCount?: number
  readonly commanderOverrides?: readonly CommanderOverride[]
  readonly legacyCompatibilityOrigin?: 'stable_group' | 'full_council' | null
}

export type AssemblyPlanRevisionInput = {
  readonly previousPlan: CouncilAssemblyPlan
  readonly commanderMessage?: string
  readonly missionVersion?: number
  readonly commanderOverrides?: readonly CommanderOverride[]
  readonly changeReason: string
  readonly provenance: PlanProvenance
  readonly createdAt?: string
}

