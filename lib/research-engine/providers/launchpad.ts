import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'launchpad' as const
const BASE_URL = 'https://api.launchpad.net/devel/bugs'
const MAX_RESULTS = 25

type Entry = {
  self_link?: string
  web_link?: string
  status?: string
  importance?: string
  bug_target_display_name?: string
  date_created?: string
}
type SearchResponse = { entries?: Entry[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) throw new Error('Query must be a search keyword.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `launchpad:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('ws.op', 'searchTasks')
  url.searchParams.set('search_text', text)
  url.searchParams.set('ws.size', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.entries)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Launchpad response "entries" field was missing or not an array.' }
  }

  const documents = data.entries
    .filter(e => typeof e.web_link === 'string')
    .map(e => {
      const webLink = e.web_link as string
      return makeDocument({
        id: `launchpad:${webLink}`,
        provider: PROVIDER,
        providerRecordId: webLink,
        title: e.bug_target_display_name ?? webLink,
        summary: `Status: ${e.status ?? 'unknown'}${e.importance ? `, Importance: ${e.importance}` : ''}`,
        contentSnippet: null,
        canonicalUrl: webLink,
        sourceUrl: webLink,
        sourceName: 'Launchpad',
        contentType: 'bug_report',
        authors: [],
        organization: 'Canonical',
        publishedAt: e.date_created ?? null,
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: {},
        subjects: e.status ? [e.status] : [],
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
      if (outcome.kind === 'http_error') throw new Error(`Launchpad search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const url = new URL(BASE_URL)
    url.searchParams.set('ws.op', 'searchTasks')
    url.searchParams.set('search_text', 'crash')
    url.searchParams.set('ws.size', '1')
    const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'bugs searchTasks reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const launchpadAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
