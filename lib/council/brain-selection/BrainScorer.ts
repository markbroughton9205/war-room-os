import type {
  BrainCandidate,
  BrainCandidateMetadata,
  BrainScoreWeights,
  RequiredBrainProfile,
} from './types'

const DEFAULT_WEIGHTS: BrainScoreWeights = {
  fitScore: 0.25,
  capabilityScore: 0.25,
  reliabilityScore: 0.2,
  costScore: 0.1,
  latencyScore: 0.1,
  privacyScore: 0.1,
}

const clampScore = (score: number): number => Math.max(0, Math.min(1, score))

function normalizeWeights(weights: BrainScoreWeights): BrainScoreWeights {
  const total =
    weights.fitScore
    + weights.capabilityScore
    + weights.reliabilityScore
    + weights.costScore
    + weights.latencyScore
    + weights.privacyScore

  return {
    fitScore: weights.fitScore / total,
    capabilityScore: weights.capabilityScore / total,
    reliabilityScore: weights.reliabilityScore / total,
    costScore: weights.costScore / total,
    latencyScore: weights.latencyScore / total,
    privacyScore: weights.privacyScore / total,
  }
}

export function resolveBrainScoreWeights(profile: RequiredBrainProfile): BrainScoreWeights {
  const weights: BrainScoreWeights = { ...DEFAULT_WEIGHTS }

  if (profile.costSensitivity === 'high') {
    const addedCostWeight = 0.25 - weights.costScore
    const capabilityLatencyTotal = weights.capabilityScore + weights.latencyScore
    weights.costScore = 0.25
    weights.capabilityScore -= addedCostWeight * (weights.capabilityScore / capabilityLatencyTotal)
    weights.latencyScore -= addedCostWeight * (weights.latencyScore / capabilityLatencyTotal)
  }

  if (profile.latencyTolerance === 'fast') {
    weights.latencyScore = 0.25
  }

  if (profile.privacySensitivity === 'high') {
    weights.privacyScore = 0.3
  }

  if (profile.contextWindowNeed === 'high') {
    weights.capabilityScore = 0.35
  }

  return normalizeWeights(weights)
}

function calculateTotalScore(candidate: BrainCandidate, weights: BrainScoreWeights): number {
  return (
    candidate.fitScore * weights.fitScore
    + candidate.capabilityScore * weights.capabilityScore
    + candidate.reliabilityScore * weights.reliabilityScore
    + candidate.costScore * weights.costScore
    + candidate.latencyScore * weights.latencyScore
    + candidate.privacyScore * weights.privacyScore
  )
}

function scoreCandidate(candidate: BrainCandidateMetadata, profile: RequiredBrainProfile): BrainCandidate {
  const strengths = [...candidate.baseStrengths]
  const weaknesses = [...candidate.baseWeaknesses]
  let fitScore = candidate.baseFitScore
  let capabilityScore = candidate.baseCapabilityScore
  let privacyScore = candidate.basePrivacyScore

  if (candidate.reasoningStyles.includes(profile.reasoningStyle)) {
    fitScore += 0.12
    strengths.push(`Matches ${profile.reasoningStyle} reasoning style`)
  } else {
    weaknesses.push(`Does not primarily match ${profile.reasoningStyle} reasoning style`)
  }

  if (profile.contextWindowNeed === 'high') {
    if (candidate.supportsLargeContext) {
      capabilityScore += 0.1
      strengths.push('Supports high context-window need')
    } else {
      capabilityScore -= 0.12
      weaknesses.push('Limited fit for high context-window need')
    }
  }

  if (profile.liveResearchNeed) {
    if (candidate.supportsLiveResearch) {
      fitScore += 0.1
      capabilityScore += 0.1
      strengths.push('Supports live research need')
    } else if (candidate.hasCachedLocalResearch) {
      weaknesses.push('Only cached/local research support is available')
    } else {
      fitScore -= 0.1
      capabilityScore -= 0.1
      weaknesses.push('No live research support in candidate metadata')
    }
  }

  if (profile.toolUseNeed) {
    if (candidate.supportsToolUse) {
      fitScore += 0.08
      strengths.push('Supports tool-use need')
    } else {
      fitScore -= 0.08
      weaknesses.push('No tool-use support in candidate metadata')
    }
  }

  if (profile.privacySensitivity === 'high') {
    if (candidate.providerFamily === 'local' || candidate.providerFamily === 'static') {
      privacyScore += 0.12
      strengths.push('Favored for high privacy sensitivity')
    } else {
      privacyScore -= 0.12
      weaknesses.push('External candidate is weaker for high privacy sensitivity')
    }
  }

  const scoredCandidate: BrainCandidate = {
    candidateId: candidate.candidateId,
    providerId: candidate.providerId,
    modelId: candidate.modelId,
    providerFamily: candidate.providerFamily,
    fitScore: clampScore(fitScore),
    costScore: candidate.baseCostScore,
    latencyScore: candidate.baseLatencyScore,
    reliabilityScore: candidate.baseReliabilityScore,
    privacyScore: clampScore(privacyScore),
    capabilityScore: clampScore(capabilityScore),
    totalScore: 0,
    strengths,
    weaknesses,
    riskLevel: candidate.riskLevel,
    approvalRequired:
      candidate.isPremium
      || candidate.isCostly
      || candidate.isExternal
      || candidate.supportsLiveResearch
      || profile.privacySensitivity === 'high',
  }
  const weights = resolveBrainScoreWeights(profile)

  return {
    ...scoredCandidate,
    totalScore: calculateTotalScore(scoredCandidate, weights),
  }
}

function preferLocalOrStatic(candidate: BrainCandidate): number {
  return candidate.providerFamily === 'local' || candidate.providerFamily === 'static' ? 1 : 0
}

export class BrainScorer {
  rank(candidates: BrainCandidateMetadata[], profile: RequiredBrainProfile): BrainCandidate[] {
    return candidates
      .map(candidate => ({
        candidate,
        scored: scoreCandidate(candidate, profile),
      }))
      .sort((a, b) => {
        const totalDifference = b.scored.totalScore - a.scored.totalScore
        if (totalDifference !== 0) return totalDifference

        const reliabilityDifference = b.scored.reliabilityScore - a.scored.reliabilityScore
        if (reliabilityDifference !== 0) return reliabilityDifference

        const costDifference = b.scored.costScore - a.scored.costScore
        if (costDifference !== 0) return costDifference

        const localityDifference = preferLocalOrStatic(b.scored) - preferLocalOrStatic(a.scored)
        if (localityDifference !== 0) return localityDifference

        return a.candidate.registryOrder - b.candidate.registryOrder
      })
      .map(({ scored }) => scored)
  }
}
