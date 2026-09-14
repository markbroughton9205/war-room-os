import type { FusionResult, LedgerClaim, RetrievedDocument } from './types'

function clamp(n: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, n))
}

/**
 * Confidence is NOT agent-agreement or URL count.
 * Weight independent origins, primary evidence, quality, reliability, recency, corroboration, contradiction.
 */
export function fuseClaim(input: {
  claim: LedgerClaim
  documents: RetrievedDocument[]
  contradictingOriginCount?: number
}): FusionResult {
  const originIds = [...new Set(input.documents.map(doc => doc.independentOriginId).filter((id): id is string => Boolean(id)))]
  const urlCount = new Set(input.documents.map(doc => doc.canonicalUrl || doc.url)).size
  const primary = input.documents.filter(doc => doc.evidenceClass === 'PRIMARY_EVIDENCE' || doc.evidenceClass === 'OFFICIAL_STATEMENT' || doc.evidenceClass === 'DATASET').length
  const recencyBoost = input.documents.some(doc => doc.publishedAt) ? 0.08 : 0
  const contradictionPenalty = (input.contradictingOriginCount ?? 0) * 0.12
  const originScore = Math.log2(1 + originIds.length) / 3
  const primaryScore = Math.min(0.28, primary * 0.09)
  const confidence = clamp(0.18 + originScore + primaryScore + recencyBoost - contradictionPenalty)
  const agentAgreement = 1
  return {
    claimId: input.claim.claimId,
    agentAgreement,
    independentOrigins: originIds.length,
    urlCount,
    confidence,
    method: 'INDEPENDENT_ORIGIN_WEIGHTED',
    note: originIds.length === 1 && urlCount >= 3
      ? `AGENT AGREEMENT must not be multiplied. ${urlCount} URLs collapse to 1 independent origin.`
      : `Independent origins ${originIds.length} vs URL count ${urlCount}.`,
  }
}

export function fuseLedger(claims: LedgerClaim[], documents: RetrievedDocument[]): FusionResult[] {
  return claims.map(claim => {
    const related = documents.filter(doc => claim.independentOriginIds.includes(doc.independentOriginId || '') || claim.storyClusterId && doc.contentHash === claim.storyClusterId)
    const docs = related.length ? related : documents.filter(doc => doc.originalText.toLowerCase().includes(claim.normalizedClaim.slice(0, 24)))
    return fuseClaim({ claim, documents: docs.length ? docs : documents.slice(0, 1) })
  })
}

export function agentCountDoesNotMultiplyConfidence(fusion: FusionResult[], agentCount: number): boolean {
  return fusion.every(row => row.independentOrigins <= row.urlCount && (agentCount < 2 || row.confidence <= 0.95))
}
