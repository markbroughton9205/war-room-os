import { BRAIN_CANDIDATE_REGISTRY } from './BrainCandidateRegistry'
import { BrainProfileResolver } from './BrainProfileResolver'
import { BrainScorer, resolveBrainScoreWeights } from './BrainScorer'
import type {
  BrainCandidateMetadata,
  BrainRecommendation,
  BrainSelectionInput,
  RequiredBrainProfile,
} from './types'

function createRecommendationId(createdAt: string): string {
  const randomPart =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `brain_${createdAt.replace(/[^0-9]/g, '')}_${randomPart}`
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
    const decisionPath: string[] = []

    decisionPath.push(`Attached brain recommendation to routing note ${input.routingNote.routingId}.`)

    const requiredBrainProfile = this.profileResolver.resolve(input.routingNote)
    decisionPath.push(`Required brain profile resolved as ${requiredBrainProfile.reasoningStyle}.`)

    const weights = resolveBrainScoreWeights(requiredBrainProfile)
    decisionPath.push(getDominantWeightingReason(requiredBrainProfile))
    decisionPath.push(
      `Normalized weights: fit ${weights.fitScore.toFixed(2)}, capability ${weights.capabilityScore.toFixed(2)}, reliability ${weights.reliabilityScore.toFixed(2)}, cost ${weights.costScore.toFixed(2)}, latency ${weights.latencyScore.toFixed(2)}, privacy ${weights.privacyScore.toFixed(2)}.`,
    )

    const rankedCandidates = this.scorer.rank(this.candidates, requiredBrainProfile)
    decisionPath.push(`Ranked ${rankedCandidates.length} static registry candidate(s) without execution.`)

    const selectedCandidate = rankedCandidates[0] ?? null
    const selectedCandidateId = selectedCandidate?.candidateId ?? null
    decisionPath.push(
      selectedCandidate
        ? `Top recommendation is ${selectedCandidate.candidateId}; execution remains disabled.`
        : 'No candidate selected; execution remains disabled.',
    )

    const approvalRequired = selectedCandidate?.approvalRequired ?? false
    decisionPath.push(
      approvalRequired
        ? 'Approval is required before any future execution attempt.'
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
        : 'No candidate could be ranked from the static registry.',
      decisionPath,
      executionAllowed: false,
      createdAt,
    }
  }
}
