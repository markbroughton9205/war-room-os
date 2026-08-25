import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'mozilla_bugzilla' as const
const BASE_URL = 'https://bugzilla.mozilla.org/rest/bug'
const MAX_RESULTS = 25
const FIELDS = ['id', 'summary', 'status', 'resolution', 'product', 'component', 'severity', 'priority', 'creation_time', 'last_change_time'].join(',')

type Bug = {
  id?: number
  summary?: string
  status?: string
  resolution?: string
  product?: string
  component?: string
  severity?: string
  priority?: string
  creation_time?: string
  last_change_time?: string
}
type BugsResponse = { bugs?: Bug[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `mozilla_bugzilla:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('summary', text)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('include_fields', FIELDS)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<BugsResponse>(result.text)
  if (!data || !Array.isArray(data.bugs)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Mozilla Bugzilla response "bugs" field was missing or not an array.' }
  }

  const documents = data.bugs
    .filter(bug => typeof bug.id === 'number')
    .map(bug => {
      const id = String(bug.id)
      const canonicalUrl = `https://bugzilla.mozilla.org/show_bug.cgi?id=${id}`
      return makeDocument({
        id: `mozilla_bugzilla:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: bug.summary ?? `Bug ${id}`,
        summary: `${bug.product ?? ''}${bug.component ? ` / ${bug.component}` : ''}`.trim() || null,
        contentSnippet: `Status: ${bug.status ?? 'unknown'}${bug.resolution ? ` (${bug.resolution})` : ''}`,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Mozilla Bugzilla',
        contentType: 'bug_report',
        authors: [],
        organization: 'Mozilla',
        publishedAt: bug.creation_time ?? null,
        updatedAt: bug.last_change_time ?? null,
        geography: null,
        language: 'en',
        identifiers: { bugzilla_id: id },
        subjects: [bug.severity, bug.priority].filter((v): v is string => !!v),
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
      if (outcome.kind === 'http_error') throw new Error(`Mozilla Bugzilla search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?summary=crash&limit=1&include_fields=id`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'bug search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const mozillaBugzillaAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
