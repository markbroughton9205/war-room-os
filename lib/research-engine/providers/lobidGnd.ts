import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'lobid_gnd' as const
const BASE_URL = 'https://lobid.org/gnd/search'
const MAX_RESULTS = 25

type Member = {
  id?: string
  preferredName?: string
  dateOfBirth?: string[]
  dateOfDeath?: string[]
  type?: string[]
  gndSubjectCategory?: { label?: string }[]
}
type SearchResponse = { totalItems?: number; member?: Member[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `lobid_gnd:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', text)
  url.searchParams.set('format', 'json')
  url.searchParams.set('size', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.member)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'lobid-gnd response "member" field was missing or not an array.' }
  }

  const documents = data.member
    .filter(m => typeof m.id === 'string')
    .map(m => {
      const id = m.id as string
      const gndId = id.split('/').pop() ?? id
      const lifespan = m.dateOfBirth?.[0] || m.dateOfDeath?.[0] ? `${m.dateOfBirth?.[0] ?? '?'}–${m.dateOfDeath?.[0] ?? '?'}` : null
      return makeDocument({
        id: `lobid_gnd:${gndId}`,
        provider: PROVIDER,
        providerRecordId: gndId,
        title: m.preferredName ?? `GND ${gndId}`,
        summary: m.type?.length ? `Type: ${m.type.join(', ')}` : null,
        contentSnippet: lifespan,
        canonicalUrl: id,
        sourceUrl: id,
        sourceName: 'lobid-gnd (German National Library)',
        contentType: 'authority_record',
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: 'de',
        identifiers: { gnd_id: gndId },
        subjects: m.gndSubjectCategory?.map(c => c.label).filter((v): v is string => !!v) ?? [],
        license: null,
        accessStatus: 'open',
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
      if (outcome.kind === 'http_error') throw new Error(`lobid-gnd search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=Albert%20Einstein&format=json&size=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const lobidGndAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
