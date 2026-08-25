import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'cbdb' as const
const BASE_URL = 'https://cbdb.fas.harvard.edu/cbdbapi/person.php'

type BasicInfo = {
  PersonId?: number | string
  EngName?: string
  ChName?: string
  IndexYear?: number | string
  YearBirth?: number | string
  YearDeath?: number | string
  Dynasty?: string
  Notes?: string
}
type CbdbResponse = { Package?: { PersonAuthority?: { PersonInfo?: { Person?: { BasicInfo?: BasicInfo } } } } }

/** CBDB's API returns a single fuzzy-matched Person, not a multi-result list —
 * confirmed live (a common name like "Wang" still returns exactly one match). */
async function lookup(query: ResearchQuery) {
  const started = Date.now()
  const name = query.text.trim().slice(0, 100)
  if (!name) throw new Error('Query must be a person name (English pinyin or Chinese characters), e.g. "Wang Anshi".')
  const cacheKey = `cbdb:${name}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('name', name)
  url.searchParams.set('o', 'json')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<CbdbResponse>(result.text)
  const person = data?.Package?.PersonAuthority?.PersonInfo?.Person?.BasicInfo
  if (!person || person.PersonId == null) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const id = String(person.PersonId)
  const canonicalUrl = `https://cbdb.fas.harvard.edu/cbdbapi/person.php?id=${id}`
  const title = [person.EngName, person.ChName].filter(Boolean).join(' / ') || `Person ${id}`
  const lifespan = person.YearBirth || person.YearDeath ? `${person.YearBirth ?? '?'}–${person.YearDeath ?? '?'}` : null
  const documents = [makeDocument({
    id: `cbdb:${id}`,
    provider: PROVIDER,
    providerRecordId: id,
    title,
    summary: person.Notes ?? null,
    contentSnippet: lifespan,
    canonicalUrl,
    sourceUrl: canonicalUrl,
    sourceName: 'China Biographical Database',
    contentType: 'biographical_record',
    authors: [],
    organization: 'Harvard CBDB Project',
    publishedAt: person.YearBirth ? String(person.YearBirth) : null,
    updatedAt: null,
    geography: null,
    language: 'zh',
    identifiers: { cbdb_person_id: id },
    subjects: person.Dynasty ? [person.Dynasty] : [],
    license: null,
    accessStatus: 'open',
  })]
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await lookup(query)
      if (outcome.ok) return outcome.response
      throw new Error(`CBDB lookup failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?name=Wang%20Anshi&o=json`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'person lookup endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const cbdbAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
