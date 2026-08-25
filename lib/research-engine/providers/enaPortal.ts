import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'ena_portal' as const
const BASE_URL = 'https://www.ebi.ac.uk/ena/portal/api/search'
const MAX_RESULTS = 25

type Entry = { accession?: string; description?: string; scientific_name?: string }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200).replace(/["\\]/g, '')
  if (!text) throw new Error('Query must be an organism scientific name (e.g. "Escherichia coli").')
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `ena_portal:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('result', 'sequence')
  // ENA's queryable field is genuinely "scientific_name" — "organism"/
  // "organism_name" both 404 with "Invalid fieldName(s)" (confirmed live).
  url.searchParams.set('query', `scientific_name="${text}"`)
  url.searchParams.set('fields', 'accession,description,scientific_name')
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<Entry[]>(result.text)
  if (!Array.isArray(data)) {
    return { ok: true as const, response: okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started }) }
  }

  const documents = data
    .filter(entry => typeof entry.accession === 'string')
    .map(entry => {
      const accession = entry.accession as string
      const canonicalUrl = `https://www.ebi.ac.uk/ena/browser/view/${accession}`
      return makeDocument({
        id: `ena_portal:${accession}`,
        provider: PROVIDER,
        providerRecordId: accession,
        title: entry.description ?? accession,
        summary: entry.scientific_name ? `Organism: ${entry.scientific_name}` : null,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'European Nucleotide Archive',
        contentType: 'nucleotide_sequence',
        authors: [],
        organization: 'EMBL-EBI',
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: null,
        identifiers: { ena_accession: accession },
        subjects: entry.scientific_name ? [entry.scientific_name] : [],
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
      throw new Error(`ENA Portal search failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}?result=sequence&query=scientific_name%3D%22Escherichia%20coli%22&fields=accession&format=json&limit=1`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'search endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const enaPortalAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
