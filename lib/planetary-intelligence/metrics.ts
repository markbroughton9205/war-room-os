import { aggregateOverlap, effectiveRank } from './baseline'
import type {
  CommanderIntelligenceDisplay,
  CoverageCell,
  LedgerClaim,
  OverlapMetrics,
  RetrievedDocument,
  SeatOverlapRecord,
} from './types'

function entropyFromLabels(labels: Array<string | null | undefined>): number {
  const counts: Record<string, number> = {}
  for (const label of labels) {
    if (!label) continue
    counts[label] = (counts[label] ?? 0) + 1
  }
  return effectiveRank(counts)
}

export function diversityMetrics(input: {
  seats: SeatOverlapRecord[]
  claims: LedgerClaim[]
  documents: RetrievedDocument[]
  coverage: CoverageCell[]
}): OverlapMetrics & {
  geographicEntropy: number
  topicEntropy: number
  languageCoverage: string[]
  missingFacetCount: number
  sourceClassCoverage: string[]
} {
  const base = aggregateOverlap(input.seats)
  const languages = [...new Set(input.documents.map(doc => doc.detectedLanguage).filter((item): item is string => Boolean(item)))]
  const missingFacetCount = input.coverage.filter(cell => cell.status === 'MISSING' || cell.status === 'WEAK' || cell.status === 'NOT_ASSESSED').length
  return {
    ...base,
    geographicEntropy: entropyFromLabels(input.documents.map(doc => doc.geography)),
    topicEntropy: entropyFromLabels(input.documents.map(doc => doc.topic)),
    languageCoverage: languages,
    missingFacetCount,
    sourceClassCoverage: [...new Set(input.documents.map(doc => doc.sourceClass))],
  }
}

export function commanderDisplay(input: {
  claims: LedgerClaim[]
  documents: RetrievedDocument[]
  syndicatedCopies: number
  coverageGaps: number
}): CommanderIntelligenceDisplay {
  const origins = new Set(input.documents.map(doc => doc.independentOriginId).filter(Boolean))
  return {
    uniqueClaims: new Set(input.claims.map(claim => claim.normalizedClaim)).size,
    independentEvidenceOrigins: origins.size,
    syndicatedCopiesCollapsed: input.syndicatedCopies,
    verifiedClaims: input.claims.filter(claim => claim.verificationState === 'SUPPORTED').length,
    disputedClaims: input.claims.filter(claim => claim.verificationState === 'DISPUTED' || claim.verificationState === 'CONTRADICTED').length,
    coverageGaps: input.coverageGaps,
  }
}

export const REJECTED_PRIMARY_METRICS = ['distinct-n', 'lexical_variation_as_intelligence'] as const
