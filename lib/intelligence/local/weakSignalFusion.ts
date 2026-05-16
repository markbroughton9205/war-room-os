import type { EvidenceConfidenceTier, IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import { classifyCommunitySignal } from '@/lib/intelligence/local/communitySignalClassifier'
import type { HyperlocalEvidenceScore } from '@/lib/intelligence/local/hyperlocalEvidenceScoring'
import type { LocalNarrative } from '@/lib/intelligence/local/localNarrativeTracker'

export type LocalFusionLayer = 'verified' | 'emerging' | 'local_chatter' | 'contradictory' | 'unsupported'

export type FusedLocalSignal = {
  layer: LocalFusionLayer
  summary: string
  evidenceIds: string[]
  confidence: EvidenceConfidenceTier
  weakSignal: boolean
}

function layerFor(item: IntelligenceEvidenceItem): LocalFusionLayer {
  if (item.contradiction_flags.length || item.confidence_tier === 'contradictory') return 'contradictory'
  if (item.confidence_tier === 'verified' || item.confidence_tier === 'corroborated') return 'verified'
  if (item.confidence_tier === 'emerging') return 'emerging'
  if (item.weak_signal || item.confidence_tier === 'weak_signal') return 'local_chatter'
  return 'unsupported'
}

export function fuseWeakLocalSignals(args: {
  evidence: IntelligenceEvidenceItem[]
  scores: HyperlocalEvidenceScore[]
  narratives: LocalNarrative[]
}): FusedLocalSignal[] {
  const scoreById = new Map(args.scores.map(score => [score.evidenceId, score]))
  const signals: FusedLocalSignal[] = []

  for (const item of args.evidence) {
    const community = classifyCommunitySignal(item)
    const score = scoreById.get(item.id)
    const layer = score?.tier === 'contradictory' ? 'contradictory' : layerFor(item)
    if (layer === 'unsupported' && !community.localityMentioned) continue
    signals.push({
      layer,
      summary:
        layer === 'local_chatter'
          ? `Weak signal only: ${item.claim}`
          : layer === 'emerging'
            ? `Emerging: ${item.claim}`
            : item.claim,
      evidenceIds: [item.id],
      confidence: score?.tier ?? item.confidence_tier,
      weakSignal: layer === 'local_chatter' || community.weakSignal,
    })
  }

  for (const narrative of args.narratives) {
    if (narrative.evidenceIds.length < 2) continue
    signals.push({
      layer: narrative.confidence_trend === 'weak_signal' ? 'local_chatter' : narrative.confidence_trend === 'contradictory' ? 'contradictory' : 'emerging',
      summary: `${narrative.label}: ${narrative.narrative_momentum} momentum, corroboration ${narrative.corroboration_growth}, contradiction rate ${narrative.contradiction_rate.toFixed(2)}.`,
      evidenceIds: narrative.evidenceIds,
      confidence: narrative.confidence_trend,
      weakSignal: narrative.weak_signal_count > 0,
    })
  }

  return signals.slice(0, 12)
}
