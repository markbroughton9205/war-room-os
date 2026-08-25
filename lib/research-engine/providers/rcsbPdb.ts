import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'rcsb_pdb' as const
const SEARCH_URL = 'https://search.rcsb.org/rcsbsearch/v2/query'
const DATA_BASE_URL = 'https://data.rcsb.org/rest/v1/core/entry'
const MAX_RESULTS = 10

type SearchResponse = { result_set?: { identifier?: string }[] }
type EntryDetail = {
  rcsb_id?: string
  struct?: { title?: string }
  rcsb_accession_info?: { initial_release_date?: string }
  audit_author?: { name?: string }[]
  rcsb_primary_citation?: { pdbx_database_id_PubMed?: number; pdbx_database_id_DOI?: string }
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  if (!text) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 5, MAX_RESULTS))
  const cacheKey = `rcsb_pdb:search:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const searchBody = JSON.stringify({
    query: { type: 'terminal', service: 'full_text', parameters: { value: text } },
    return_type: 'entry',
    request_options: { paginate: { start: 0, rows: limit } },
  })
  const searchResult = await safeProviderFetch(PROVIDER, SEARCH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: searchBody, timeoutMs: 12_000 })
  if (searchResult.status === 204 || searchResult.status === 404) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }
  if (!searchResult.ok) return { ok: false as const, kind: 'http_error' as const, status: searchResult.status }

  const searchData = safeJsonParse<SearchResponse>(searchResult.text)
  const ids = (searchData?.result_set ?? []).map(r => r.identifier).filter((id): id is string => Boolean(id)).slice(0, limit)
  if (ids.length === 0) return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }

  const details = await Promise.all(ids.map(async id => {
    const detailResult = await safeProviderFetch(PROVIDER, `${DATA_BASE_URL}/${id}`, { timeoutMs: 10_000 })
    if (!detailResult.ok) return null
    return safeJsonParse<EntryDetail>(detailResult.text)
  }))

  const documents = details
    .filter((d): d is EntryDetail => Boolean(d?.rcsb_id))
    .map(entry => {
      const id = entry.rcsb_id as string
      const canonicalUrl = `https://www.rcsb.org/structure/${id}`
      return makeDocument({
        id: `rcsb_pdb:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: entry.struct?.title ?? id,
        summary: null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'RCSB Protein Data Bank',
        contentType: 'protein_structure',
        authors: (entry.audit_author ?? []).map(a => a.name).filter((n): n is string => Boolean(n)),
        organization: null,
        publishedAt: entry.rcsb_accession_info?.initial_release_date ?? null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: {
          pdb_id: id,
          ...(entry.rcsb_primary_citation?.pdbx_database_id_DOI ? { doi: entry.rcsb_primary_citation.pdbx_database_id_DOI } : {}),
        },
        subjects: [],
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
      throw new Error(`RCSB PDB search failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${DATA_BASE_URL}/4HHB`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'entry detail endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const rcsbPdbAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
