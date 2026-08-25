import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'insee_melodi' as const
const BASE_URL = 'https://api.insee.fr/melodi'
const MAX_RESULTS = 10

type CatalogEntry = { identifier?: string; title?: { content?: string; lang?: string }[]; numObservations?: number }
type CatalogResponse = CatalogEntry[]
type DataObservation = { dimensions?: Record<string, string>; measures?: { OBS_VALUE_NIVEAU?: { value?: number } } }
type DataResponse = { observations?: DataObservation[]; title?: { fr?: string; en?: string } }

function titleOf(entry: CatalogEntry): string | null {
  const en = entry.title?.find(t => t.lang === 'en')?.content
  const fr = entry.title?.find(t => t.lang === 'fr')?.content
  return en ?? fr ?? entry.identifier ?? null
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const cacheKey = `insee_melodi:${text}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const catalogUrl = new URL(`${BASE_URL}/catalog/all`)
  catalogUrl.searchParams.set('q', text)
  catalogUrl.searchParams.set('maxResult', '1')
  const catalogResult = await safeProviderFetch(PROVIDER, catalogUrl.toString(), { timeoutMs: 12_000 })
  if (!catalogResult.ok) return { ok: false as const, kind: 'http_error' as const, status: catalogResult.status }

  const catalog = safeJsonParse<CatalogResponse>(catalogResult.text)
  if (!Array.isArray(catalog) || catalog.length === 0 || !catalog[0].identifier) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const identifier = catalog[0].identifier
  const datasetTitle = titleOf(catalog[0]) ?? identifier
  const dataUrl = new URL(`${BASE_URL}/data/${encodeURIComponent(identifier)}`)
  dataUrl.searchParams.set('maxResult', String(MAX_RESULTS))
  const dataResult = await safeProviderFetch(PROVIDER, dataUrl.toString(), { timeoutMs: 12_000 })
  if (!dataResult.ok) return { ok: false as const, kind: 'http_error' as const, status: dataResult.status }

  const dataParsed = safeJsonParse<DataResponse>(dataResult.text)
  if (!dataParsed || !Array.isArray(dataParsed.observations)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'INSEE Melodi data response "observations" field was missing or not an array.' }
  }

  const canonicalUrl = `https://www.insee.fr/fr/statistiques/${identifier}`
  const documents = dataParsed.observations
    .filter(obs => obs.dimensions)
    .map((obs, i) => {
      const dimsLabel = Object.entries(obs.dimensions ?? {}).map(([k, v]) => `${k}=${v}`).join(', ')
      const value = obs.measures?.OBS_VALUE_NIVEAU?.value
      return makeDocument({
        id: `insee_melodi:${identifier}:${i}`,
        provider: PROVIDER,
        providerRecordId: `${identifier}:${i}`,
        title: `${datasetTitle} — ${dimsLabel}`,
        summary: typeof value === 'number' ? `Value: ${value}` : null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'INSEE Melodi',
        contentType: 'statistical_data_point',
        authors: [],
        organization: 'INSEE',
        publishedAt: obs.dimensions?.TIME_PERIOD ?? null,
        updatedAt: null,
        geography: obs.dimensions?.GEO ?? 'FR',
        language: 'fr',
        identifiers: { insee_dataset_identifier: identifier },
        subjects: [],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.timeSeries)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`INSEE Melodi fetch failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/catalog/all?q=population&maxResult=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'catalog endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const inseeMelodiAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
