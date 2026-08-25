import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'art_institute_chicago' as const
const BASE_URL = 'https://api.artic.edu/api/v1'
const MAX_RESULTS = 25

type Artwork = {
  id?: number
  title?: string
  artist_display?: string
  date_display?: string
  image_id?: string | null
}
type SearchResponse = { data?: Artwork[]; config?: { iiif_url?: string } }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `art_institute_chicago:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/artworks/search`)
  url.searchParams.set('q', text)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('fields', 'id,title,artist_display,date_display,image_id')

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<SearchResponse>(result.text)
  if (!data || !Array.isArray(data.data)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Art Institute of Chicago response "data" field was missing or not an array.' }
  }
  const iiifUrl = data.config?.iiif_url ?? 'https://www.artic.edu/iiif/2'

  const documents = data.data
    .filter(item => typeof item.id === 'number')
    .map(item => {
      const id = String(item.id)
      const canonicalUrl = `https://www.artic.edu/artworks/${id}`
      const imageUrl = item.image_id ? `${iiifUrl}/${item.image_id}/full/843,/0/default.jpg` : null
      return makeDocument({
        id: `art_institute_chicago:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: item.title ?? `Artwork ${id}`,
        summary: item.artist_display ?? null,
        contentSnippet: item.date_display ?? null,
        canonicalUrl,
        sourceUrl: imageUrl ?? canonicalUrl,
        sourceName: 'Art Institute of Chicago',
        contentType: 'museum_artwork',
        authors: item.artist_display ? [item.artist_display] : [],
        organization: 'Art Institute of Chicago',
        publishedAt: null,
        updatedAt: null,
        geography: null,
        language: 'en',
        identifiers: { artic_id: id },
        subjects: [],
        license: 'CC0',
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
      if (outcome.kind === 'http_error') throw new Error(`Art Institute of Chicago search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/artworks/search?q=van%20gogh&limit=1`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'artworks search reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const artInstituteChicagoAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
