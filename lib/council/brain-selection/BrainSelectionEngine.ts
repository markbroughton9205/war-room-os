import { BRAIN_CANDIDATE_REGISTRY } from './BrainCandidateRegistry'
import { BrainProfileResolver, detectPrivacySignals } from './BrainProfileResolver'
import { BrainScorer, resolveBrainScoreWeights } from './BrainScorer'
import type {
  BrainCandidate,
  BrainCandidateMetadata,
  BrainReasoningStyle,
  BrainRecommendation,
  BrainSelectionInput,
  RequiredBrainProfile,
} from './types'
import type { RoutingNote } from '../routing'

// Minimum capabilityScore a candidate must clear to be eligible as the *primary*
// recommendation for a reasoning-heavy task. Below-floor candidates stay visible in
// rankedCandidates (marked via unavailableReason) but are never selected as primary.
const CAPABILITY_FLOORS: Partial<Record<BrainReasoningStyle, number>> = {
  risk: 0.65,
  architectural: 0.7,
  coding: 0.7,
  strategic: 0.6,
  synthesis: 0.6,
}

function createRecommendationId(createdAt: string): string {
  const randomPart =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `brain_${createdAt.replace(/[^0-9]/g, '')}_${randomPart}`
}

function describeRiskSource(routingNote: RoutingNote): string {
  if (routingNote.riskLevel === 'high' && routingNote.intent === 'implementation') {
    return 'Risk is high due to implementation impact.'
  }
  return `Risk is ${routingNote.riskLevel} based on the routing note's skill risk metadata.`
}

function describePrivacySource(profile: RequiredBrainProfile, matchedPrivacySignals: string[]): string {
  if (profile.privacySensitivity === 'high') {
    return matchedPrivacySignals.length > 0
      ? `Privacy is high due to sensitive data (${matchedPrivacySignals.join(', ')}).`
      : 'Privacy is high due to sensitive data.'
  }
  return 'Privacy remains low; no sensitive data signals detected in the commander message.'
}

function getDominantWeightingReason(profile: RequiredBrainProfile): string {
  if (profile.privacySensitivity === 'high') {
    return 'Privacy sensitivity was high, so local/static candidates received extra weight.'
  }
  if (profile.costSensitivity === 'high') {
    return 'Cost sensitivity was high, so cheaper/local candidates received extra weight.'
  }
  if (profile.latencyTolerance === 'fast') {
    return 'Latency tolerance was fast, so low-latency candidates received extra weight.'
  }
  if (profile.contextWindowNeed === 'high') {
    return 'Context-window need was high, so high-capability candidates received extra weight.'
  }
  if (profile.liveResearchNeed) {
    return 'Live research was needed, so live-research-capable candidates received fit and capability preference.'
  }
  if (profile.toolUseNeed) {
    return 'Tool use was needed, so tool-capable candidates received fit preference.'
  }
  return 'Balanced weights were used because no dominant sensitivity overrode the default profile.'
}

export class BrainSelectionEngine {
  constructor(
    private readonly profileResolver: BrainProfileResolver = new BrainProfileResolver(),
    private readonly scorer: BrainScorer = new BrainScorer(),
    private readonly candidates: BrainCandidateMetadata[] = BRAIN_CANDIDATE_REGISTRY,
  ) {}

  recommend(input: BrainSelectionInput): BrainRecommendation {
    const createdAt = input.createdAt ?? new Date().toISOString()
    const commanderMessage = input.commanderMessage ?? ''
    const decisionPath: string[] = []

    decisionPath.push(`Attached brain recommendation to routing note ${input.routingNote.routingId}.`)

    const requiredBrainProfile = this.profileResolver.resolve(input.routingNote, commanderMessage)
    decisionPath.push(`Required brain profile resolved as ${requiredBrainProfile.reasoningStyle}.`)
    decisionPath.push(describeRiskSource(input.routingNote))
    decisionPath.push(describePrivacySource(requiredBrainProfile, detectPrivacySignals(commanderMessage)))

    const weights = resolveBrainScoreWeights(requiredBrainProfile)
    decisionPath.push(getDominantWeightingReason(requiredBrainProfile))
    decisionPath.push(
      `Normalized weights: fit ${weights.fitScore.toFixed(2)}, capability ${weights.capabilityScore.toFixed(2)}, reliability ${weights.reliabilityScore.toFixed(2)}, cost ${weights.costScore.toFixed(2)}, latency ${weights.latencyScore.toFixed(2)}, privacy ${weights.privacyScore.toFixed(2)}.`,
    )

    const scoredCandidates = this.scorer.rank(this.candidates, requiredBrainProfile)
    decisionPath.push(`Ranked ${scoredCandidates.length} static registry candidate(s) without execution.`)

    const metadataById = new Map(this.candidates.map(candidate => [candidate.candidateId, candidate]))

    if (requiredBrainProfile.liveResearchNeed) {
      decisionPath.push('Live research required; non-live candidates ranked as fallback only.')
    }

    const capabilityFloor = CAPABILITY_FLOORS[requiredBrainProfile.reasoningStyle]
    let capabilityFloorExcluded = false

    const rankedCandidates: BrainCandidate[] = scoredCandidates.map(candidate => {
      const metadata = metadataById.get(candidate.candidateId)
      const failsLiveResearch = requiredBrainProfile.liveResearchNeed && !(metadata?.supportsLiveResearch ?? false)
      const failsCapabilityFloor = capabilityFloor !== undefined && candidate.capabilityScore < capabilityFloor

      if (failsCapabilityFloor) {
        capabilityFloorExcluded = true
      }

      if (failsLiveResearch) {
        return {
          ...candidate,
          unavailableReason:
            'Excluded from primary selection: live research is required for this task and this candidate does not support it.',
        }
      }

      if (failsCapabilityFloor) {
        return {
          ...candidate,
          unavailableReason:
            `Excluded from primary selection: capability score ${candidate.capabilityScore.toFixed(2)} is below the `
            + `${capabilityFloor!.toFixed(2)} floor required for ${requiredBrainProfile.reasoningStyle} reasoning.`,
        }
      }

      return candidate
    })

    if (capabilityFloorExcluded) {
      decisionPath.push('Candidate failed capability floor for reasoning-heavy task.')
    }

    const eligibleCandidates = rankedCandidates.filter(candidate => candidate.unavailableReason === undefined)
    const selectedCandidate = eligibleCandidates[0] ?? null
    const selectedCandidateId = selectedCandidate?.candidateId ?? null
    const noEligibleCandidate = selectedCandidate === null

    decisionPath.push(
      selectedCandidate
        ? `Top recommendation is ${selectedCandidate.candidateId}; execution remains disabled.`
        : 'No eligible primary candidate found under live-research/capability-floor constraints; Commander approval or clarification is required.',
    )

    const approvalRequired = noEligibleCandidate ? true : (selectedCandidate?.approvalRequired ?? false)
    decisionPath.push(
      approvalRequired
        ? (noEligibleCandidate
            ? 'Commander approval or clarification is required before a brain can be selected.'
            : 'Approval is required before any future execution attempt.')
        : 'No approval is required for this recommendation-only note.',
    )

    decisionPath.push('executionAllowed is false; Phase 46D recommends only.')

    return {
      recommendationId: input.recommendationId ?? createRecommendationId(createdAt),
      routingId: input.routingNote.routingId,
      requiredBrainProfile,
      rankedCandidates,
      selectedCandidateId,
      approvalRequired,
      reason: selectedCandidate
        ? `Ranked ${selectedCandidate.candidateId} highest for the routing profile.`
        : 'No eligible candidate met the live-research or capability-floor requirements for this routing profile; Commander clarification or approval is required.',
      decisionPath,
      executionAllowed: false,
      createdAt,
    }
  }
}
