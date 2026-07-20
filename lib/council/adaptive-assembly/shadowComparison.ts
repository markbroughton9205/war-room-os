import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { CouncilAssemblyPlan } from './types'
import type {
  ActualCouncilSelectionSnapshot,
  CouncilShadowSelectionReport,
  NormalizedShadowMissionInput,
  RecommendationMatchStatus,
  ShadowEligibilityReason,
  ShadowEligibilityStatus,
  SynthesizerMatchStatus,
} from './shadowTypes'
import { stablePlanHash } from './assemblyPlan'

const KNOWN_FAMILIES = new Set<CouncilOrchestrationFamily>([
  'chatgpt',
  'claude',
  'grok',
  'gemini',
  'red_team',
  'baby',
  'kimi',
  'bridge_architect',
])

function uniqueFamilies(
  families: readonly CouncilOrchestrationFamily[],
  side: 'recommended' | 'actual',
): CouncilOrchestrationFamily[] {
  const out: CouncilOrchestrationFamily[] = []
  for (const family of families) {
    if (!KNOWN_FAMILIES.has(family)) throw new Error(`unknown_${side}_family:${String(family)}`)
    if (out.includes(family)) throw new Error(`duplicate_${side}_family:${family}`)
    out.push(family)
  }
  return out
}

function intersection(a: readonly CouncilOrchestrationFamily[], b: readonly CouncilOrchestrationFamily[]): CouncilOrchestrationFamily[] {
  return a.filter(family => b.includes(family))
}

function difference(a: readonly CouncilOrchestrationFamily[], b: readonly CouncilOrchestrationFamily[]): CouncilOrchestrationFamily[] {
  return a.filter(family => !b.includes(family))
}

function matchStatus(
  recommended: readonly CouncilOrchestrationFamily[],
  actual: readonly CouncilOrchestrationFamily[],
  actualFinalized: boolean,
  planUnresolved: boolean,
): RecommendationMatchStatus {
  if (!actualFinalized) return 'actual_unresolved'
  if (planUnresolved) return 'recommendation_unresolved'
  if (!recommended.length || !actual.length) return 'not_comparable'
  const overlap = intersection(recommended, actual)
  if (overlap.length === recommended.length && overlap.length === actual.length) return 'exact_match'
  if (overlap.length > 0) return 'partial_match'
  return 'no_match'
}

function synthesizerStatus(
  recommended: CouncilOrchestrationFamily | null,
  actual: CouncilOrchestrationFamily | null,
  actualFinalized: boolean,
): SynthesizerMatchStatus {
  if (!actualFinalized) return 'actual_unresolved'
  if (!recommended) return 'recommendation_unresolved'
  if (!actual) return 'actual_unresolved'
  return recommended === actual ? 'exact_match' : 'different'
}

export function missionFingerprint(input: NormalizedShadowMissionInput): string {
  return stablePlanHash(JSON.stringify({
    missionId: input.missionId,
    missionVersion: input.missionVersion,
    commanderMessage: input.commanderMessage,
    councilFlowMode: input.councilFlowMode,
    logicalRequestId: input.logicalRequestId,
  }))
}

export function createShadowSelectionReport(input: {
  missionInput: NormalizedShadowMissionInput
  actualSnapshot: ActualCouncilSelectionSnapshot
  eligibilityStatus: ShadowEligibilityStatus
  eligibilityReason: ShadowEligibilityReason
  plan: CouncilAssemblyPlan | null
  plannerStatus: CouncilShadowSelectionReport['plannerStatus']
  comparisonStatus?: CouncilShadowSelectionReport['comparisonStatus']
  generatedAt?: string
  extraUncertaintyFlags?: readonly string[]
}): CouncilShadowSelectionReport {
  const recommendedFamilies = input.plan ? uniqueFamilies(input.plan.selectedFamilies, 'recommended') : []
  const actualFamilies = uniqueFamilies(input.actualSnapshot.actualSelectedFamilies, 'actual')
  const recommendedOnlyFamilies = difference(recommendedFamilies, actualFamilies)
  const actualOnlyFamilies = difference(actualFamilies, recommendedFamilies)
  const overlappingFamilies = intersection(recommendedFamilies, actualFamilies)
  const planUnresolved = Boolean(input.plan && (input.plan.planStatus === 'unresolved' || input.plan.planStatus === 'invalid'))
  const recommendationMatchStatus = matchStatus(
    recommendedFamilies,
    actualFamilies,
    input.actualSnapshot.actualSelectionFinalized,
    planUnresolved,
  )
  const recommendedSynthesizer = input.plan?.synthesisAuthority.primaryFamily ?? null
  const actualSynthesizer = input.actualSnapshot.actualSynthesisFamily
  const generatedAt = input.generatedAt ?? new Date().toISOString()

  return Object.freeze({
    shadowReportId: `shadow-${input.missionInput.requestId}-${missionFingerprint(input.missionInput)}`,
    schemaVersion: '48c3b2.shadow-selection.v1',
    requestId: input.missionInput.requestId,
    logicalRequestId: input.missionInput.logicalRequestId,
    missionFingerprint: missionFingerprint(input.missionInput),
    eligibilityStatus: input.eligibilityStatus,
    eligibilityReason: input.eligibilityReason,
    planId: input.plan?.planId ?? null,
    planVersion: input.plan?.planVersion ?? null,
    recommendedFamilies,
    actualFamilies,
    recommendedOnlyFamilies,
    actualOnlyFamilies,
    overlappingFamilies,
    recommendationMatchStatus,
    recommendedSynthesizer,
    actualSynthesizer,
    synthesizerMatchStatus: synthesizerStatus(recommendedSynthesizer, actualSynthesizer, input.actualSnapshot.actualSelectionFinalized),
    recommendedRedTeamPolicy: input.plan?.redTeamRequirement ?? null,
    actualRedTeamIncluded: input.actualSnapshot.actualRedTeamIncluded,
    participationPreset: input.plan?.participationPreset ?? null,
    actualExecutionMode: input.actualSnapshot.executionMode,
    unresolvedCapabilities: input.plan?.unresolvedCapabilities ?? [],
    uncertaintyFlags: [
      ...input.missionInput.uncertaintyFlags,
      ...(input.plan?.uncertaintyFlags ?? []),
      ...(input.extraUncertaintyFlags ?? []),
    ],
    plannerStatus: input.plannerStatus,
    comparisonStatus: input.comparisonStatus ?? 'compared',
    advisoryLabel: 'Recommended assembly — shadow only, not used for execution.',
    generatedAt,
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
    } as const,
  })
}
