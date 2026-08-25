import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'virustotal' as const
const BASE_URL = 'https://www.virustotal.com/api/v3/search'
const MAX_RESULTS = 25

// Auth mechanism (X-Apikey header, real 401 AuthenticationRequiredError)
// confirmed live. Free self-service "Public API" key via account
// registration (500 req/day, 4/min); ToS restricts commercial/product use
// of the free tier. Response body shape for a valid key not independently
// re-verified live (no key available this build).
type Attributes = { last_analysis_stats?: { malicious?: number; suspicious?: number; harmless?: number }; type_description?: string; meaningful_name?: string }
type ResultItem = { id?: string; type?: string; attributes?: Attributes }
type SearchResponse = { data?: ResultItem[] }

function apiKey(): string {
  return process.env.VIRUSTOTAL_API_KEY?.trim() ?? ''
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be a hash, domain, IP, or URL.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `virustotal:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('query', text)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: { 'X-Apikey': apiKey() }, timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'VirusTotal response "data" field was missing or not an array.' }
  }

  const documents = data.data
    .slice(0, limit)
    .filter(item => typeof item.id === 'string')
    .map(item => {
      const id = item.id as string
      const canonicalUrl = `https://www.virustotal.com/gui/search/${encodeURIComponent(id)}`
      const stats = item.attributes?.last_analysis_stats
      return makeDocument({
        id: `virustotal:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: item.attributes?.meaningful_name ?? id,
        summary: item.attributes?.type_description ?? item.type ?? null,
        contentSnippet: stats ? `Malicious: ${stats.malicious ?? 0}, Suspicious: ${stats.suspicious ?? 0}, Harmless: ${stats.harmless ?? 0}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'VirusTotal',
        contentType: 'threat_indicator',
        authors: [],
        organization: 'Google (Mandiant)',
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { virustotal_id: id },
        subjects: [],
        license: null,
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'VIRUSTOTAL_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`VirusTotal search failed with HTTP ${outcome.status}`)
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
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'VIRUSTOTAL_API_KEY missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?query=8.8.8.8`, { headers: { 'X-Apikey': apiKey() }, timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const virustotalAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
