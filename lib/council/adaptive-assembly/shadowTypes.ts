import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { CouncilAssemblyPlan, ParticipationPreset, RedTeamRequirement } from './types'

export type ShadowFeatureMode = 'disabled' | 'diagnostics_only' | 'response_metadata'

export type ShadowEligibilityStatus =
  | 'eligible'
  | 'ineligible'
  | 'skipped'
  | 'unavailable'
  | 'invalid_input'
  | 'planner_failed'

export type ShadowEligibilityReason =
  | 'supported_council_request'
  | 'unsupported_direct_provider_path'
  | 'missing_mission_input'
  | 'empty_commander_message'
  | 'internal_system_request'
  | 'non_council_request'
  | 'validation_only'
  | 'planner_exception'
  | 'feature_disabled'

export type RecommendationMatchStatus =
  | 'exact_match'
  | 'partial_match'
  | 'no_match'
  | 'actual_unresolved'
  | 'recommendation_unresolved'
  | 'not_comparable'

export type SynthesizerMatchStatus =
  | 'exact_match'
  | 'different'
  | 'actual_unresolved'
  | 'recommendation_unresolved'
  | 'not_comparable'

export type ShadowPlannerStatus = 'not_run' | 'completed' | 'failed'
export type ShadowComparisonStatus = 'not_run' | 'compared' | 'failed' | 'not_comparable'

export type NormalizedShadowMissionInput = {
  readonly requestId: string
  readonly logicalRequestId: string | null
  readonly missionId: string
  readonly missionVersion: number
  readonly commanderMessage: string
  readonly councilFlowMode: string
  readonly directInvocation: boolean
  readonly familyDeliberationRequested: boolean
  readonly uncertaintyFlags: readonly string[]
}

export type ActualCouncilSelectionSnapshot = {
  readonly executionMode: string
  readonly actualSelectedFamilies: readonly CouncilOrchestrationFamily[]
  readonly actualSynthesisFamily: CouncilOrchestrationFamily | null
  readonly actualRedTeamIncluded: boolean
  readonly actualSelectionSource: 'existing_runtime' | 'direct_invocation' | 'system_selected' | 'continuation_selected' | 'unresolved'
  readonly actualSelectionFinalized: boolean
  readonly snapshotCapturedAt: string
}

export type CouncilShadowSelectionReport = {
  readonly shadowReportId: string
  readonly schemaVersion: '48c3b2.shadow-selection.v1'
  readonly requestId: string
  readonly logicalRequestId: string | null
  readonly missionFingerprint: string
  readonly eligibilityStatus: ShadowEligibilityStatus
  readonly eligibilityReason: ShadowEligibilityReason
  readonly planId: string | null
  readonly planVersion: number | null
  readonly recommendedFamilies: readonly CouncilOrchestrationFamily[]
  readonly actualFamilies: readonly CouncilOrchestrationFamily[]
  readonly recommendedOnlyFamilies: readonly CouncilOrchestrationFamily[]
  readonly actualOnlyFamilies: readonly CouncilOrchestrationFamily[]
  readonly overlappingFamilies: readonly CouncilOrchestrationFamily[]
  readonly recommendationMatchStatus: RecommendationMatchStatus
  readonly recommendedSynthesizer: CouncilOrchestrationFamily | null
  readonly actualSynthesizer: CouncilOrchestrationFamily | null
  readonly synthesizerMatchStatus: SynthesizerMatchStatus
  readonly recommendedRedTeamPolicy: RedTeamRequirement | null
  readonly actualRedTeamIncluded: boolean
  readonly participationPreset: ParticipationPreset | null
  readonly actualExecutionMode: string
  readonly unresolvedCapabilities: readonly string[]
  readonly uncertaintyFlags: readonly string[]
  readonly plannerStatus: ShadowPlannerStatus
  readonly comparisonStatus: ShadowComparisonStatus
  readonly advisoryLabel: 'Recommended assembly — shadow only, not used for execution.'
  readonly generatedAt: string
  readonly executionUnaffected: true
  readonly provenance: {
    readonly generatedBy: 'adaptive_assembly_shadow_v1'
    readonly planAuthority: 'advisory'
    readonly executionAuthority: 'none'
    readonly actualSelectionAuthority: 'existing runtime'
    readonly capabilitySource: 'configured registry'
    readonly availabilitySource: 'configured or unknown'
    readonly providerHealthVerified: false
    readonly executionInfluenced: false
  }
}

export type ShadowRuntimeInput = {
  readonly featureMode: ShadowFeatureMode
  readonly missionInput: NormalizedShadowMissionInput
  readonly actualSnapshot: ActualCouncilSelectionSnapshot
  readonly planFactory?: (missionInput: NormalizedShadowMissionInput) => CouncilAssemblyPlan
}

