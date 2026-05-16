import type {
  EvidenceConfidenceTier,
  IntelligenceConfidenceSummary,
  IntelligenceEvidenceItem,
} from '@/lib/intelligence/intelligencePacket'

export function classifyEvidenceConfidence(item: IntelligenceEvidenceItem): EvidenceConfidenceTier {
  if (item.contradiction_flags.length > 0) return 'contradictory'
  if (item.confidence >= 0.82 && item.verified_level === 'verified') return 'verified'
  if (item.confidence >= 0.68 && item.corroboration_count > 0) return 'corroborated'
  if (item.weak_signal || item.verified_level === 'unverified') {
    return item.confidence >= 0.38 ? 'weak_signal' : 'unsupported'
  }
  if (item.confidence >= 0.45) return 'emerging'
  return 'unsupported'
}

export function classifyConfidenceSummary(evidence: IntelligenceEvidenceItem[]): IntelligenceConfidenceSummary {
  const counts = {
    verified_count: 0,
    corroborated_count: 0,
    emerging_count: 0,
    weak_signal_count: 0,
    contradictory_count: 0,
    unsupported_count: 0,
  }

  for (const item of evidence) {
    if (item.confidence_tier === 'verified') counts.verified_count += 1
    if (item.confidence_tier === 'corroborated') counts.corroborated_count += 1
    if (item.confidence_tier === 'emerging') counts.emerging_count += 1
    if (item.confidence_tier === 'weak_signal') counts.weak_signal_count += 1
    if (item.confidence_tier === 'contradictory') counts.contradictory_count += 1
    if (item.confidence_tier === 'unsupported') counts.unsupported_count += 1
  }

  const score = evidence.length
    ? evidence.reduce((sum, item) => sum + item.confidence, 0) / evidence.length
    : 0

  let overall: EvidenceConfidenceTier = 'unsupported'
  if (counts.contradictory_count > 0) overall = 'contradictory'
  else if (counts.verified_count > 0 && score >= 0.78) overall = 'verified'
  else if (counts.corroborated_count > 0 || (counts.verified_count > 0 && evidence.length >= 2)) overall = 'corroborated'
  else if (counts.emerging_count > 0) overall = 'emerging'
  else if (counts.weak_signal_count > 0) overall = 'weak_signal'

  return {
    overall,
    score,
    ...counts,
  }
}
