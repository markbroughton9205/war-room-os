import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'opensanctions' as const
const BASE_URL = 'https://api.opensanctions.org'
const MAX_RESULTS = 20

type OsResult = { id?: string; caption?: string; schema?: string; datasets?: string[]; first_seen?: string; last_seen?: string; target?: boolean }
type OsResponse = { results?: OsResult[] }

function apiKey(): string {
  return process.env.OPENSANCTIONS_API_KEY?.trim() ?? ''
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `opensanctions:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/search/default`)
  url.searchParams.set('q', text)
  url.searchParams.set('limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { headers: { Authorization: `ApiKey ${apiKey()}` }, timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<OsResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.results)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'OpenSanctions response "results" field was missing or not an array.' }
  }

  const documents = data.results
    .filter(row => row.id && row.caption)
    .map(row => {
      const id = row.id as string
      const canonicalUrl = `https://www.opensanctions.org/entities/${id}/`
      return makeDocument({
        id: `opensanctions:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: row.caption as string,
        summary: row.schema ? `Entity type: ${row.schema}` : null,
        contentSnippet: row.target ? 'Target: sanctioned/watchlisted entity' : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'OpenSanctions',
        contentType: 'sanctions_watchlist_record',
        authors: [],
        organization: null,
        publishedAt: row.first_seen ?? null,
        updatedAt: row.last_seen ?? null,
        geography: null,
        language: null,
        identifiers: { opensanctions_id: id, ...(typeof row.target === 'boolean' ? { is_target: String(row.target) } : {}) },
        subjects: row.datasets ?? [],
        license: null,
        accessStatus: 'unknown',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.webSearch)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'OPENSANCTIONS_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`OpenSanctions search failed with HTTP ${outcome.status}`)
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
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'OPENSANCTIONS_API_KEY missing', durationMs: null }
  }
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/search/default?q=test&limit=1`, { headers: { Authorization: `ApiKey ${apiKey()}` }, timeoutMs: 8_000 })
    return {
      provider: PROVIDER,
      state: result.ok ? 'ready' : result.status === 401 || result.status === 403 ? 'authentication_failed' : 'degraded',
      checkedAt: nowIso(),
      detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const opensanctionsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
