import { formatDisplayText } from '@/lib/council/toDisplayText'
import { classifyEvidenceConfidence } from '@/lib/intelligence/confidenceClassifier'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'

function freshnessScore(item: IntelligenceEvidenceItem): number {
  if (item.freshness === 'live') return 1
  if (item.freshness === 'recent') return 0.82
  if (item.freshness === 'aging') return 0.55
  if (item.freshness === 'stale') return 0.25
  return 0.45
}

function verifiedLevelScore(item: IntelligenceEvidenceItem): number {
  if (item.verified_level === 'verified') return 1
  if (item.verified_level === 'semi_verified') return 0.68
  return 0.28
}

function canonicalClaimTokens(item: IntelligenceEvidenceItem): Set<string> {
  const normalized = formatDisplayText(item.claim, claim =>
    claim
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[^\w\s]/g, ' '),
  )
  return new Set(
    normalized
      .split(/\s+/)
      .filter(word => word.length > 5)
      .slice(0, 24),
  )
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let hits = 0
  for (const token of a) {
    if (b.has(token)) hits += 1
  }
  return hits / Math.max(a.size, b.size)
}

export function scoreEvidenceItems(evidence: IntelligenceEvidenceItem[]): IntelligenceEvidenceItem[] {
  const tokenSets = evidence.map(canonicalClaimTokens)

  return evidence.map((item, index) => {
    const related = new Set(item.related_evidence_links)
    for (let j = 0; j < evidence.length; j++) {
      if (j === index) continue
      const other = evidence[j]!
      if (other.source_id === item.source_id) continue
      if (tokenOverlap(tokenSets[index]!, tokenSets[j]!) >= 0.18) related.add(other.id)
    }

    const corroborationCount = related.size
    const contradictionPenalty = item.contradiction_flags.length ? 0.28 : 0
    const weakPenalty = item.weak_signal ? 0.16 : 0
    const score =
      item.source_reputation * 0.34
      + verifiedLevelScore(item) * 0.2
      + freshnessScore(item) * 0.16
      + item.evidence_density * 0.14
      + Math.min(0.16, corroborationCount * 0.08)
      - contradictionPenalty
      - weakPenalty

    const next = {
      ...item,
      corroboration_count: corroborationCount,
      related_evidence_links: [...related].slice(0, 8),
      confidence: Math.max(0, Math.min(1, score)),
    }

    return {
      ...next,
      confidence_tier: classifyEvidenceConfidence(next),
    }
  })
}
