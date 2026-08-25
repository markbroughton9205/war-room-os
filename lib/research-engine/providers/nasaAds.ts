import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'nasa_ads' as const
const BASE_URL = 'https://api.adsabs.harvard.edu/v1/search/query'
const MAX_RESULTS = 20
const FIELDS = 'bibcode,title,author,year,pub,doi'

type AdsDoc = { bibcode?: string; title?: string[]; author?: string[]; year?: string; pub?: string; doi?: string[] }
type AdsResponse = { response?: { docs?: AdsDoc[] } }

function authHeaders(): Record<string, string> {
  const token = process.env.NASA_ADS_API_TOKEN?.trim() ?? ''
  return { Authorization: `Bearer ${token}` }
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `nasa_ads:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', text)
  url.searchParams.set('fl', FIELDS)
  url.searchParams.set('rows', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: authHeaders(), timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<AdsResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.response?.docs)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'NASA ADS response "response.docs" field was missing or not an array.' }
  }

  const documents = data.response!.docs!
    .filter(doc => doc.bibcode)
    .map(doc => {
      const bibcode = doc.bibcode as string
      const canonicalUrl = `https://ui.adsabs.harvard.edu/abs/${encodeURIComponent(bibcode)}/abstract`
      return makeDocument({
        id: `nasa_ads:${bibcode}`,
        provider: PROVIDER,
        providerRecordId: bibcode,
        title: doc.title?.[0] ?? bibcode,
        summary: doc.pub ? `Published in: ${doc.pub}` : null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'NASA Astrophysics Data System',
        contentType: 'scholarly_work',
        authors: doc.author ?? [],
        organization: null,
        publishedAt: doc.year ?? null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { bibcode, ...(doc.doi?.[0] ? { doi: doc.doi[0] } : {}) },
        subjects: [],
        license: null,
        accessStatus: 'unknown',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'NASA_ADS_API_TOKEN is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`NASA ADS search failed with HTTP ${outcome.status}`)
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
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'NASA_ADS_API_TOKEN missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=test&fl=bibcode&rows=1`, { headers: authHeaders(), timeoutMs: 8_000 })
    return {
      provider: PROVIDER,
      state: result.ok ? 'ready' : result.status === 401 ? 'authentication_failed' : 'degraded',
      checkedAt: nowIso(),
      detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const nasaAdsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
