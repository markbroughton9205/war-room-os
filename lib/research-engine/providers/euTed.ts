import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'eu_ted' as const
const BASE_URL = 'https://api.ted.europa.eu/v3/notices/search'
const MAX_RESULTS = 25

type Notice = { ND?: string; PD?: string; TI?: Record<string, string>; 'publication-number'?: string }
type SearchResponse = { notices?: Notice[]; totalNoticeCount?: number }

function escapeTedQuery(value: string): string {
  return value.replace(/["\\]/g, '')
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be a search keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `eu_ted:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const body = JSON.stringify({
    query: `FT="${escapeTedQuery(text)}"`,
    fields: ['ND', 'PD', 'TI', 'publication-number'],
    limit,
  })

  const result = await safeProviderFetch(PROVIDER, BASE_URL, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
    timeoutMs: 15_000,
  })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.notices)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'EU TED response "notices" field was missing or not an array.' }
  }

  const documents = data.notices
    .filter(n => typeof n.ND === 'string')
    .map(n => {
      const nd = n.ND as string
      const canonicalUrl = `https://ted.europa.eu/en/notice/-/detail/${nd}`
      const title = n.TI?.eng ?? Object.values(n.TI ?? {})[0] ?? nd
      return makeDocument({
        id: `eu_ted:${nd}`,
        provider: PROVIDER,
        providerRecordId: nd,
        title,
        summary: n['publication-number'] ? `Publication: ${n['publication-number']}` : null,
        contentSnippet: n.PD ? `Published: ${n.PD}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'EU Tenders Electronic Daily (TED)',
        contentType: 'procurement_notice',
        authors: [],
        organization: 'Publications Office of the EU',
        publishedAt: n.PD ?? null,
        updatedAt: null,
        geography: 'European Union',
        language: 'en',
        identifiers: { ted_notice_id: nd },
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
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`EU TED search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, BASE_URL, {
      method: 'POST',
      body: JSON.stringify({ query: 'FT="software"', fields: ['ND'], limit: 1 }),
      headers: { 'Content-Type': 'application/json' },
      timeoutMs: 10_000,
    })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const euTedAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
