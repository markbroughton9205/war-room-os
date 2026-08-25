import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'europe_pmc' as const
const BASE_URL = 'https://www.ebi.ac.uk/europepmc/webservices/rest'
const MAX_RESULTS = 25

type EpmcResult = {
  id?: string
  pmid?: string
  doi?: string
  title?: string
  authorString?: string
  journalTitle?: string
  pubYear?: string
  source?: string
  isOpenAccess?: string
  firstPublicationDate?: string
}
type EpmcResponse = { hitCount?: number; resultList?: { result?: EpmcResult[] } }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 300)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `europe_pmc:search:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/search`)
  url.searchParams.set('query', text)
  url.searchParams.set('format', 'json')
  url.searchParams.set('pageSize', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<EpmcResponse>(result.text)
  if (!data || typeof data !== 'object') {
    return { ok: false as const, kind: 'malformed' as const, message: 'Europe PMC response was not a valid JSON object.' }
  }
  const rows = Array.isArray(data.resultList?.result) ? data.resultList!.result! : []

  const documents = rows
    .filter(row => row.id && row.title)
    .map(row => {
      const canonicalUrl = row.doi ? `https://doi.org/${encodeURIComponent(row.doi)}` : row.pmid ? `https://europepmc.org/article/MED/${row.pmid}` : `https://europepmc.org/article/${row.source ?? 'MED'}/${row.id}`
      return makeDocument({
        id: `europe_pmc:${row.id}`,
        provider: PROVIDER,
        providerRecordId: row.id ?? null,
        title: row.title as string,
        summary: null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: row.journalTitle ?? 'Europe PMC',
        contentType: 'scholarly_work',
        authors: row.authorString ? row.authorString.split(',').map(a => a.trim()).filter(Boolean) : [],
        organization: null,
        publishedAt: row.firstPublicationDate ?? (row.pubYear ? row.pubYear : null),
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { ...(row.pmid ? { pmid: row.pmid } : {}), ...(row.doi ? { doi: row.doi } : {}) },
        subjects: [],
        license: null,
        accessStatus: row.isOpenAccess === 'Y' ? 'open' : 'unknown',
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
      if (outcome.kind === 'http_error') throw new Error(`Europe PMC search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/search?query=test&format=json&pageSize=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const europePmcAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
