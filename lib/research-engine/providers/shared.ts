import type {
  ResearchDocument,
  ResearchGeoFeature,
  ResearchProviderError,
  ResearchProviderId,
  ResearchProviderResponse,
  ResearchTimeSeries,
} from '@/lib/research-engine/core/types'

export function nowIso(): string {
  return new Date().toISOString()
}

export function makeDocument(partial: Omit<ResearchDocument, 'retrievedAt' | 'citations' | 'provenance' | 'warnings' | 'score' | 'providerRank'> & {
  score?: number | null
  providerRank?: number | null
  warnings?: string[]
  citations?: ResearchDocument['citations']
}): ResearchDocument {
  const retrievedAt = nowIso()
  return {
    ...partial,
    retrievedAt,
    score: partial.score ?? null,
    providerRank: partial.providerRank ?? null,
    warnings: partial.warnings ?? [],
    citations: partial.citations ?? [],
    provenance: {
      provider: partial.provider,
      sourceUrl: partial.sourceUrl ?? partial.canonicalUrl ?? '',
      retrievedAt,
      requestDurationMs: 0,
      fromCache: false,
      isHistorical: false,
    },
  }
}

export function okResponse(provider: ResearchProviderId, args: {
  documents?: ResearchDocument[]
  timeSeries?: ResearchTimeSeries[]
  geoFeatures?: ResearchGeoFeature[]
  durationMs: number
  fromCache?: boolean
}): ResearchProviderResponse {
  return {
    provider,
    ok: true,
    documents: args.documents ?? [],
    timeSeries: args.timeSeries ?? [],
    geoFeatures: args.geoFeatures ?? [],
    entities: [],
    error: null,
    durationMs: args.durationMs,
    fromCache: args.fromCache ?? false,
  }
}

export function errorResponse(provider: ResearchProviderId, error: ResearchProviderError, durationMs: number): ResearchProviderResponse {
  return {
    provider,
    ok: false,
    documents: [],
    timeSeries: [],
    geoFeatures: [],
    entities: [],
    error,
    durationMs,
    fromCache: false,
  }
}

export function notConfiguredResponse(provider: ResearchProviderId, message: string): ResearchProviderResponse {
  return errorResponse(provider, { provider, category: 'not_configured', message, httpStatus: null }, 0)
}
