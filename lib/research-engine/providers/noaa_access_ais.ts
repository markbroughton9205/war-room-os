import 'server-only'

/**
 * NOAA AccessAIS / MarineCadastre — historical U.S. coastal AIS bulk archives.
 * There is no queryable live current-position API. This adapter never labels output LIVE.
 */
import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'noaa_access_ais' as const

async function run(_query: ResearchQuery) {
  const retrievedAt = nowIso()
  const document = makeDocument({
    id: 'noaa_access_ais:archive',
    provider: PROVIDER,
    providerRecordId: 'marinecadastre-accessais',
    title: 'NOAA AccessAIS / MarineCadastre historical U.S. AIS archive',
    summary: 'Annual/monthly bulk CSV/zip AIS archives for U.S. coastal waters. Not a realtime vessel feed.',
    contentSnippet: 'Historical AIS vessel traffic archives published by NOAA/BOEM/USCG via MarineCadastre.',
    canonicalUrl: 'https://marinecadastre.gov/accessais/',
    sourceUrl: 'https://coast.noaa.gov/digitalcoast/data/ais.html',
    sourceName: 'NOAA AccessAIS / MarineCadastre',
    contentType: 'dataset',
    authors: [],
    organization: 'NOAA',
    publishedAt: null,
    updatedAt: null,
    geography: 'U.S. coastal waters',
    language: 'en',
    identifiers: { dataMode: 'historical_archive' },
    subjects: ['AIS', 'historical'],
    license: 'CC0',
    accessStatus: 'open',
  })
  document.provenance.isHistorical = true
  document.provenance.retrievedAt = retrievedAt
  return okResponse(PROVIDER, { documents: [document], durationMs: 0 })
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  return {
    provider: PROVIDER,
    state: 'ready',
    checkedAt: nowIso(),
    detail: 'Historical/batch archive adapter; never a live AIS position feed',
    durationMs: 0,
  }
}

export const noaaAccessAisAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
