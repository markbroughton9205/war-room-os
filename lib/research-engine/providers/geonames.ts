import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'geonames' as const
const BASE_URL = 'https://secure.geonames.org'
const MAX_RESULTS = 25

type GeonamesEntry = {
  geonameId?: number
  name?: string
  toponymName?: string
  lat?: string
  lng?: string
  countryName?: string
  fcodeName?: string
  population?: number
}
type GeonamesResponse = { totalResultsCount?: number; geonames?: GeonamesEntry[]; status?: { message?: string } }

function username(): string {
  return process.env.GEONAMES_USERNAME?.trim() ?? ''
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `geonames:search:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/searchJSON`)
  url.searchParams.set('q', text)
  url.searchParams.set('maxRows', String(limit))
  url.searchParams.set('username', username())

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<GeonamesResponse>(result.text)
  if (!data || typeof data !== 'object') {
    return { ok: false as const, kind: 'malformed' as const, message: 'GeoNames response was not a valid JSON object.' }
  }
  // GeoNames reports API errors (bad username, quota exceeded) as HTTP 200
  // with a `status` object instead of an HTTP error status — must be
  // detected explicitly or a real failure would be silently reported as an
  // honest empty success.
  if (data.status?.message) {
    return { ok: false as const, kind: 'malformed' as const, message: `GeoNames API error: ${data.status.message}` }
  }
  if (!Array.isArray(data.geonames)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'GeoNames response "geonames" field was missing or not an array.' }
  }

  const documents = data.geonames
    .filter(row => typeof row.geonameId === 'number')
    .map(row => {
      const id = String(row.geonameId)
      const canonicalUrl = `https://www.geonames.org/${id}`
      return makeDocument({
        id: `geonames:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: row.name ?? row.toponymName ?? `GeoNames ${id}`,
        summary: row.countryName ? `${row.fcodeName ?? 'Place'} in ${row.countryName}` : null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'GeoNames',
        contentType: 'geographic_place',
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: null,
        geography: row.countryName ?? null,
        language: null,
        identifiers: { geonames_id: id },
        subjects: row.fcodeName ? [row.fcodeName] : [],
        license: 'CC BY 4.0',
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.webSearch)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'GEONAMES_USERNAME is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`GeoNames search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'GEONAMES_USERNAME missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/searchJSON?q=London&maxRows=1&username=${encodeURIComponent(username())}`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const geonamesAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
