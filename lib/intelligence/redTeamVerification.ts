import type {
  IntelligenceConfidenceSummary,
  IntelligenceEvidenceItem,
  IntelligenceSourceFailure,
} from '@/lib/intelligence/intelligencePacket'

export type RedTeamVerificationReport = {
  status: 'clear' | 'caution' | 'blocked'
  warnings: string[]
  unsupported_claims: string[]
  stale_evidence: string[]
  contradiction_chains: string[]
  manipulated_narrative_risks: string[]
  weak_source_overreliance: boolean
  operational_truth_blocks: string[]
}

const MANIPULATION_TERMS = [
  /\beveryone\s+knows\b/i,
  /\bthey\s+don'?t\s+want\s+you\s+to\s+know\b/i,
  /\bguaranteed\b/i,
  /\bsecret\b/i,
  /\bmainstream\s+media\s+won'?t\b/i,
]

export function runRedTeamVerification(args: {
  evidence: IntelligenceEvidenceItem[]
  confidenceSummary: IntelligenceConfidenceSummary
  unsupportedClaims: string[]
  sourceFailures: IntelligenceSourceFailure[]
}): RedTeamVerificationReport {
  const warnings: string[] = []
  const staleEvidence = args.evidence
    .filter(item => item.freshness === 'stale')
    .map(item => item.id)
  const contradictionChains = args.evidence
    .filter(item => item.contradiction_flags.length)
    .map(item => `${item.id}: ${item.contradiction_flags.join(',')}`)
  const manipulatedNarrativeRisks = args.evidence
    .filter(item => MANIPULATION_TERMS.some(pattern => pattern.test(`${item.title} ${item.content}`)))
    .map(item => item.id)
  const weakCount = args.evidence.filter(item => item.weak_signal || item.confidence_tier === 'weak_signal').length
  const verifiedCount = args.evidence.filter(item => item.confidence_tier === 'verified' || item.confidence_tier === 'corroborated').length
  const weakSourceOverreliance = weakCount > 0 && verifiedCount === 0
  const operationalTruthBlocks: string[] = []

  if (args.confidenceSummary.overall === 'unsupported') {
    operationalTruthBlocks.push('No supported evidence can be promoted to operational truth.')
  }
  if (weakSourceOverreliance) {
    operationalTruthBlocks.push('Weak signals present without verified/corroborated support.')
  }
  if (contradictionChains.length) {
    operationalTruthBlocks.push('Contradictions must be resolved or disclosed before Commander proposal.')
  }
  if (args.sourceFailures.some(failure => failure.failure_behavior === 'block_operational_truth')) {
    operationalTruthBlocks.push('Required truth-source failed or is not configured.')
  }

  if (staleEvidence.length) warnings.push(`${staleEvidence.length} stale evidence item(s).`)
  if (contradictionChains.length) warnings.push(`${contradictionChains.length} contradiction chain(s).`)
  if (manipulatedNarrativeRisks.length) warnings.push(`${manipulatedNarrativeRisks.length} possible narrative manipulation marker(s).`)
  if (weakSourceOverreliance) warnings.push('Weak-source overreliance detected.')
  if (args.unsupportedClaims.length) warnings.push(`${args.unsupportedClaims.length} unsupported claim(s).`)

  const blocked = operationalTruthBlocks.length > 0
  return {
    status: blocked ? 'blocked' : warnings.length ? 'caution' : 'clear',
    warnings,
    unsupported_claims: args.unsupportedClaims,
    stale_evidence: staleEvidence,
    contradiction_chains: contradictionChains,
    manipulated_narrative_risks: manipulatedNarrativeRisks,
    weak_source_overreliance: weakSourceOverreliance,
    operational_truth_blocks: operationalTruthBlocks,
  }
}
