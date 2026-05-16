import type { EvidenceConfidenceTier, IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import { classifyCommunitySignal, type CommunitySignalKind } from '@/lib/intelligence/local/communitySignalClassifier'
import type { LocalContradiction } from '@/lib/intelligence/local/localContradictionScanner'

export type LocalNarrativeMomentum = 'new' | 'building' | 'stable' | 'contested'

export type LocalNarrative = {
  theme: CommunitySignalKind
  label: string
  evidenceIds: string[]
  narrative_momentum: LocalNarrativeMomentum
  confidence_trend: EvidenceConfidenceTier
  corroboration_growth: number
  contradiction_rate: number
  weak_signal_count: number
}

const LABELS: Record<CommunitySignalKind, string> = {
  crime_incident: 'Crime / incident discussion',
  infrastructure_complaint: 'Infrastructure complaints',
  economic_stress: 'Economic stress',
  neighborhood_development: 'Neighborhood development',
  policing_discussion: 'Policing discussion',
  business_opening_closure: 'Business openings / closures',
  local_opportunity: 'Local opportunity signals',
  public_concern: 'Recurring public concerns',
  unknown: 'Unclassified local narrative',
}

function strongestTier(items: IntelligenceEvidenceItem[]): EvidenceConfidenceTier {
  if (items.some(item => item.confidence_tier === 'contradictory')) return 'contradictory'
  if (items.some(item => item.confidence_tier === 'verified')) return 'verified'
  if (items.some(item => item.confidence_tier === 'corroborated')) return 'corroborated'
  if (items.some(item => item.confidence_tier === 'emerging')) return 'emerging'
  if (items.some(item => item.confidence_tier === 'weak_signal')) return 'weak_signal'
  return 'unsupported'
}

export function trackLocalNarratives(
  evidence: IntelligenceEvidenceItem[],
  contradictions: LocalContradiction[],
): LocalNarrative[] {
  const grouped = new Map<CommunitySignalKind, IntelligenceEvidenceItem[]>()
  for (const item of evidence) {
    const signal = classifyCommunitySignal(item)
    if (!signal.localityMentioned && signal.kind === 'unknown') continue
    const bucket = grouped.get(signal.kind) ?? []
    bucket.push(item)
    grouped.set(signal.kind, bucket)
  }

  return Array.from(grouped.entries()).map(([theme, items]) => {
    const contradictionCount = contradictions.filter(c => c.evidenceIds.some(id => items.some(item => item.id === id))).length
    const weakSignalCount = items.filter(item => item.weak_signal || item.confidence_tier === 'weak_signal').length
    const corroborationGrowth = items.reduce((sum, item) => sum + item.corroboration_count, 0)
    const contradictionRate = items.length ? contradictionCount / items.length : 0
    const narrativeMomentum: LocalNarrativeMomentum =
      contradictionRate > 0.35
        ? 'contested'
        : items.length >= 3 || corroborationGrowth >= 3
          ? 'building'
          : items.length === 1
            ? 'new'
            : 'stable'

    return {
      theme,
      label: LABELS[theme],
      evidenceIds: items.map(item => item.id),
      narrative_momentum: narrativeMomentum,
      confidence_trend: strongestTier(items),
      corroboration_growth: corroborationGrowth,
      contradiction_rate: contradictionRate,
      weak_signal_count: weakSignalCount,
    }
  }).sort((a, b) => b.evidenceIds.length - a.evidenceIds.length).slice(0, 8)
}
