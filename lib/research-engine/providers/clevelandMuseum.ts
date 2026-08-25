import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'cleveland_museum' as const
const BASE_URL = 'https://openaccess-api.clevelandart.org/api'
const MAX_RESULTS = 25

type Creator = { description?: string }
type Artwork = {
  id?: number
  accession_number?: string
  title?: string
  creators?: Creator[]
  creation_date?: string
  url?: string
  share_license_status?: string
}
type SearchResponse = { data?: Artwork[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `cleveland_museum:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/artworks/`)
  url.searchParams.set('q', text)
  url.searchParams.set('limit', String(limit))

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Cleveland Museum of Art response "data" field was missing or not an array.' }
  }

  const documents = data.data
    .filter(item => typeof item.id === 'number')
    .map(item => {
      const id = String(item.id)
      const canonicalUrl = item.url ?? `https://www.clevelandart.org/art/${item.accession_number ?? id}`
      const authors = (item.creators ?? []).map(c => c.description).filter((v): v is string => !!v)
      return makeDocument({
        id: `cleveland_museum:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: item.title ?? `Artwork ${id}`,
        summary: authors.length ? authors.join('; ') : null,
        contentSnippet: item.creation_date ?? null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Cleveland Museum of Art',
        contentType: 'museum_artwork',
        authors,
        organization: 'Cleveland Museum of Art',
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { cma_id: id, ...(item.accession_number ? { accession_number: item.accession_number } : {}) },
        subjects: [],
        license: item.share_license_status ?? null,
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
      if (outcome.kind === 'http_error') throw new Error(`Cleveland Museum of Art search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/artworks/?q=monet&limit=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'artworks search reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const clevelandMuseumAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
