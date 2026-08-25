import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'uk_gazette' as const
const BASE_URL = 'https://www.thegazette.co.uk/all-notices/notice/data.json'
const MAX_RESULTS = 25

type Link = { '@href'?: string; '@rel'?: string }
type Entry = { id?: string; title?: string; 'f:notice-code'?: string; 'f:status'?: string; published?: string; updated?: string; link?: Link[] }
type GazetteResponse = { entry?: Entry[] | Entry }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be a search keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `uk_gazette:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('text', text)
  url.searchParams.set('results-page-size', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<GazetteResponse>(result.text)
  const entriesRaw = data?.entry
  const entries = Array.isArray(entriesRaw) ? entriesRaw : entriesRaw ? [entriesRaw] : []

  const documents = entries
    .slice(0, limit)
    .filter(entry => typeof entry.id === 'string')
    .map(entry => {
      const id = entry.id as string
      const htmlLink = entry.link?.find(l => l['@rel'] === 'alternate')?.['@href'] ?? id
      return makeDocument({
        id: `uk_gazette:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: entry.title ?? id,
        summary: entry['f:notice-code'] ? `Notice code: ${entry['f:notice-code']}` : null,
        contentSnippet: entry['f:status'] ?? null,
        canonicalUrl: htmlLink,
        sourceUrl: htmlLink,
        sourceName: 'The Gazette (UK)',
        contentType: 'official_notice',
        authors: [],
        organization: 'HM Government',
        publishedAt: entry.published ?? null,
        updatedAt: entry.updated ?? null,
        geography: 'United Kingdom',
        language: 'en',
        identifiers: { gazette_notice_id: id },
        subjects: entry['f:notice-code'] ? [entry['f:notice-code']] : [],
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
      throw new Error(`UK Gazette search failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?text=insolvency&results-page-size=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ukGazetteAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
