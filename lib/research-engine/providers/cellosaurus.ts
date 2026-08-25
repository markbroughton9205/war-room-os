import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'cellosaurus' as const
const BASE_URL = 'https://api.cellosaurus.org/search/cell-line'
const MAX_RESULTS = 25

type AccessionEntry = { type?: string; value?: string }
type NameEntry = { type?: string; value?: string }
type CellLine = { 'accession-list'?: AccessionEntry[]; 'name-list'?: NameEntry[] }
type SearchResponse = { Cellosaurus?: { 'cell-line-list'?: CellLine[] } }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 100)
  if (!text) throw new Error('Query must be a cell line name (e.g. "HeLa").')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `cellosaurus:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('q', text)
  url.searchParams.set('rows', String(limit))
  // The unfiltered response is enormous (~300KB+ per matched cell line) —
  // fields= bounds it to the identity fields we actually surface (confirmed live).
  url.searchParams.set('fields', 'id,ac,sy')
  url.searchParams.set('format', 'json')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  const cellLines = data?.Cellosaurus?.['cell-line-list']
  if (!Array.isArray(cellLines)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Cellosaurus response "Cellosaurus.cell-line-list" field was missing or not an array.' }
  }

  const documents = cellLines
    .map(cl => {
      const primary = cl['accession-list']?.find(a => a.type === 'primary')?.value ?? cl['accession-list']?.[0]?.value
      if (!primary) return null
      const name = cl['name-list']?.[0]?.value ?? primary
      const synonyms = cl['name-list']?.filter(n => n.type === 'synonym').map(n => n.value).filter((v): v is string => !!v) ?? []
      const canonicalUrl = `https://www.cellosaurus.org/${primary}`
      return makeDocument({
        id: `cellosaurus:${primary}`,
        provider: PROVIDER,
        providerRecordId: primary,
        title: name,
        summary: synonyms.length ? `Also known as: ${synonyms.slice(0, 5).join(', ')}` : null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Cellosaurus',
        contentType: 'cell_line_record',
        authors: [],
        organization: 'SIB Swiss Institute of Bioinformatics',
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { cellosaurus_accession: primary },
        subjects: [],
        license: 'CC-BY-4.0',
        accessStatus: 'open',
      })
    })
    .filter((doc): doc is NonNullable<typeof doc> => doc !== null)
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.scholarlyMetadata)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`Cellosaurus search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?q=HeLa&rows=1&fields=id,ac&format=json`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const cellosaurusAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
