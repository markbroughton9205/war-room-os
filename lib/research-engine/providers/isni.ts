import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { extractXmlBlocks, extractXmlText } from '@/lib/research-engine/security/xmlLite'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'isni' as const
// Confirmed live: the bare /sru/?query=... path returns a ZiNG "Temporary
// system error" for every query — the real working SRU endpoint requires
// the /DB=1.2/ path segment and operation=searchRetrieve&version=1.1.
const BASE_URL = 'https://isni.oclc.org/sru/DB=1.2/'
const MAX_RESULTS = 20

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200).replace(/["\\]/g, '')
  if (!text) throw new Error('Query must be a person or organization name.')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `isni:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('operation', 'searchRetrieve')
  url.searchParams.set('version', '1.1')
  url.searchParams.set('query', `pica.nw=${text}`)
  url.searchParams.set('recordSchema', 'isni-b')
  url.searchParams.set('maximumRecords', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const records = extractXmlBlocks(result.text, 'srw:record')
  const documents = records
    .map(record => {
      const isni = extractXmlText(record, 'isniUnformatted')
      if (!isni) return null
      const name = extractXmlText(record, 'surname') ?? extractXmlText(record, 'keyName')
      const canonicalUrl = `https://isni.org/isni/${isni}`
      return makeDocument({
        id: `isni:${isni}`,
        provider: PROVIDER,
        providerRecordId: isni,
        title: name ?? `ISNI ${isni}`,
        summary: null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'ISNI',
        contentType: 'name_authority_record',
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { isni },
        subjects: [],
        license: null,
        accessStatus: 'open',
      })
    })
    .filter((doc): doc is NonNullable<typeof doc> => doc !== null)
    .slice(0, limit)
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      throw new Error(`ISNI search failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?operation=searchRetrieve&version=1.1&query=pica.nw%3DEinstein&recordSchema=isni-b&maximumRecords=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'SRU endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const isniAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
