import type { EvidenceConfidenceTier, IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import { classifyCommunitySignal } from '@/lib/intelligence/local/communitySignalClassifier'
import { weightLocalSource } from '@/lib/intelligence/local/localSourceWeighting'

export type HyperlocalEvidenceScore = {
  evidenceId: string
  localWeight: number
  localityDepthScore: number
  corroborationScore: number
  manipulationPenalty: number
  tier: EvidenceConfidenceTier
  rationale: string[]
}

const LOCALITY_DEPTH_SCORE = {
  none: 0,
  regional: 0.3,
  city: 0.58,
  neighborhood: 0.8,
  street_or_venue: 1,
}

export function scoreHyperlocalEvidence(item: IntelligenceEvidenceItem): HyperlocalEvidenceScore {
  const sourceWeight = weightLocalSource(item)
  const signal = classifyCommunitySignal(item)
  const localityDepthScore = LOCALITY_DEPTH_SCORE[sourceWeight.localityDepth]
  const corroborationScore = Math.min(1, item.corroboration_count / 3)
  const manipulationPenalty = signal.manipulationRisk === 'high' ? 0.28 : signal.manipulationRisk === 'medium' ? 0.14 : 0
  const localWeight = Math.max(
    0,
    Math.min(1, sourceWeight.weight * 0.45 + localityDepthScore * 0.2 + corroborationScore * 0.2 + item.confidence * 0.15 - manipulationPenalty),
  )
  const tier: EvidenceConfidenceTier =
    item.contradiction_flags.length > 0
      ? 'contradictory'
      : localWeight >= 0.76 && item.verified_level === 'verified'
        ? 'verified'
        : localWeight >= 0.62 && item.corroboration_count > 0
          ? 'corroborated'
          : signal.weakSignal
            ? 'weak_signal'
            : localWeight >= 0.42
              ? 'emerging'
              : 'unsupported'

  return {
    evidenceId: item.id,
    localWeight,
    localityDepthScore,
    corroborationScore,
    manipulationPenalty,
    tier,
    rationale: [
      `source=${sourceWeight.sourceDepth}`,
      `locality=${sourceWeight.localityDepth}`,
      `signal=${signal.kind}`,
      ...(signal.rumorRisk ? ['rumor_risk'] : []),
      ...(item.contradiction_flags.length ? ['contradiction_present'] : []),
    ],
  }
}

export function scoreHyperlocalEvidenceSet(evidence: IntelligenceEvidenceItem[]): HyperlocalEvidenceScore[] {
  return evidence.map(scoreHyperlocalEvidence)
}
