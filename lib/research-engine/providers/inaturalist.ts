import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'inaturalist' as const
const BASE_URL = 'https://api.inaturalist.org/v1'
const MAX_RESULTS = 20

type Observation = {
  id?: number
  taxon?: { name?: string; id?: number }
  observed_on?: string
  time_observed_at?: string
  uri?: string
  place_guess?: string
  quality_grade?: string
  license_code?: string | null
  user?: { login?: string }
  species_guess?: string
}
type ObservationsResponse = { total_results?: number; results?: Observation[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 150)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `inaturalist:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/observations`)
  url.searchParams.set('taxon_name', text)
  url.searchParams.set('per_page', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<ObservationsResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.results)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'iNaturalist response "results" field was missing or not an array.' }
  }

  const documents = data.results
    .filter(obs => typeof obs.id === 'number')
    .map(obs => {
      const id = String(obs.id)
      const canonicalUrl = obs.uri ?? `https://www.inaturalist.org/observations/${id}`
      return makeDocument({
        id: `inaturalist:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: obs.taxon?.name ?? obs.species_guess ?? `Observation ${id}`,
        summary: obs.place_guess ? `Observed at ${obs.place_guess}` : null,
        contentSnippet: obs.quality_grade ? `Quality grade: ${obs.quality_grade}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'iNaturalist',
        contentType: 'biodiversity_observation',
        authors: obs.user?.login ? [obs.user.login] : [],
        organization: null,
        publishedAt: obs.observed_on ?? null,
        updatedAt: obs.time_observed_at ?? null,
        geography: obs.place_guess ?? null,
        language: null,
        identifiers: { inaturalist_observation_id: id },
        subjects: [],
        license: obs.license_code ?? null,
        accessStatus: obs.license_code ? 'open' : 'unknown',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`iNaturalist search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/observations?taxon_name=Puma%20concolor&per_page=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'observations endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const inaturalistAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
