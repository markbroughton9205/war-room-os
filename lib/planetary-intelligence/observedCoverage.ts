import { buildCoverageMatrix, qualifyDocumentForCell, DEFAULT_COVERAGE_FACETS } from './coverage'
import type { CoverageCell, RetrievedDocument } from './types'
import type { RegistryEndpoint, RegistrySource } from './registryTypes'
import { sourceMatchesGap } from './registryCoverage'

export function sourceExistenceGivesZeroCoverage(documents: RetrievedDocument[]): boolean {
  return documents.length === 0 && buildCoverageMatrix({ documents: [], claims: [] }).every(cell => cell.qualifyingDocumentCount === 0)
}

export function endpointExistenceGivesZeroCoverage(liveEndpoints: number, documents: RetrievedDocument[]): boolean {
  return liveEndpoints > 0 && documents.length === 0 && buildCoverageMatrix({ documents: [], claims: [] }).every(cell => cell.qualifyingDocumentCount === 0)
}

export function isFreshEnough(input: { publishedAt?: string | null; retrievedAt: string; nowIso: string; windowHours?: number }): boolean {
  const windowMs = (input.windowHours ?? 72) * 3600_000
  const now = Date.parse(input.nowIso)
  const stamp = Date.parse(input.publishedAt || input.retrievedAt)
  if (!Number.isFinite(now) || !Number.isFinite(stamp)) return false
  return Math.abs(now - stamp) <= windowMs
}

export function qualifyObservedDocument(doc: RetrievedDocument, facet: {
  geography: CoverageCell['geography']
  topic: CoverageCell['topic']
  language: string
  sourceType: CoverageCell['sourceType']
}, nowIso: string, windowHours?: number): { ok: boolean; reasons: string[] } {
  const base = qualifyDocumentForCell(doc, {
    geography: facet.geography === 'GLOBAL' ? 'EAST_ASIA' : facet.geography,
    topic: facet.topic,
    language: facet.language,
    sourceType: facet.sourceType,
  })
  const reasons = [...base.reasons]
  if (!isFreshEnough({ publishedAt: doc.publishedAt, retrievedAt: nowIso, nowIso, windowHours })) reasons.push('freshness_mismatch')
  return { ok: reasons.length === 0, reasons }
}

export type LayeredCellExplanation = {
  cell: string
  sourceLayer: 'PRESENT' | 'ABSENT'
  endpointLayer: 'LIVE' | 'NONE'
  documentLayer: CoverageCell['status']
  status: CoverageCell['status']
  qualifyingDocumentCount: number
  independentOriginCount: number
  languageMatchedCount: number
  geographyMatchedCount: number
  sourceClassMatchedCount: number
  freshnessMatchedCount: number
  rejectionReasons: string[]
  explanation: string
}

export function explainPriorityCells(input: {
  documents: RetrievedDocument[]
  sources: RegistrySource[]
  endpoints: RegistryEndpoint[]
  nowIso: string
}): LayeredCellExplanation[] {
  const matrix = buildCoverageMatrix({ documents: input.documents, claims: [] })
  return DEFAULT_COVERAGE_FACETS.map(facet => {
    const cell = matrix.find(item => item.geography === facet.geography && item.topic === facet.topic && item.language === facet.language && item.sourceType === facet.sourceType)!
    const gapKey = gapKeyFor(facet.geography, facet.topic, facet.language)
    const matchingSources = input.sources.filter(source => gapKey ? sourceMatchesGap(source, gapKey) : false)
    const liveEndpoints = input.endpoints.filter(endpoint => matchingSources.some(source => source.sourceId === endpoint.sourceId) && endpoint.activationState === 'LIVE')
    const freshnessMatchedCount = input.documents.filter(doc => isFreshEnough({ publishedAt: doc.publishedAt, retrievedAt: input.nowIso, nowIso: input.nowIso })).length
    return {
      cell: `${facet.geography} × ${facet.topic} × ${facet.language} × ${facet.sourceType}`,
      sourceLayer: matchingSources.length ? 'PRESENT' : 'ABSENT',
      endpointLayer: liveEndpoints.length ? 'LIVE' : 'NONE',
      documentLayer: cell.status,
      status: cell.status,
      qualifyingDocumentCount: cell.qualifyingDocumentCount,
      independentOriginCount: cell.independentOrigins,
      languageMatchedCount: cell.languageMatchedCount,
      geographyMatchedCount: cell.geographyMatchedCount,
      sourceClassMatchedCount: cell.sourceClassMatchedCount,
      freshnessMatchedCount,
      rejectionReasons: cell.rejectionReasons,
      explanation: cell.explanation,
    }
  })
}

function gapKeyFor(geography: string, topic: string, language: string): string | null {
  if (geography === 'EAST_ASIA' && topic === 'INFRASTRUCTURE' && language === 'ja') return 'ja-infra'
  if (geography === 'EAST_AFRICA' && topic === 'HEALTH' && language === 'sw') return 'sw-health'
  if (geography === 'SOUTHEAST_ASIA' && topic === 'INFRASTRUCTURE' && language === 'id') return 'id-infra'
  if (geography === 'MIDDLE_EAST' && topic === 'PUBLIC_SAFETY' && language === 'ar') return 'ar-safety'
  if (geography === 'EUROPE' && topic === 'ENERGY' && language === 'de') return 'de-energy'
  if (geography === 'LATIN_AMERICA' && topic === 'SCIENCE' && language === 'es') return 'es-science'
  if (geography === 'SOUTH_ASIA' && topic === 'ECONOMICS' && language === 'hi') return 'hi-econ'
  if (geography === 'OCEANIA' && topic === 'WEATHER' && language === 'en') return 'oceania-weather'
  return null
}
