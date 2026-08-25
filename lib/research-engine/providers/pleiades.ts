import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { extractAllXmlAttributes } from '@/lib/research-engine/security/xmlLite'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'pleiades' as const
const BASE_URL = 'https://pleiades.stoa.org'
const MAX_RESULTS = 10

type NameEntry = { attested?: string; romanized?: string }
type PlaceDetail = {
  id?: string
  title?: string
  description?: string
  reprPoint?: [number, number]
  placeTypes?: string[]
  names?: NameEntry[]
}

/** Pleiades' search_rss returns RDF/XML with only place URIs, not JSON —
 * a real two-step resolve pattern (same shape as mast/rcsb_pdb): find place
 * URIs via search_rss, then fetch each place's real per-place JSON endpoint.
 * Confirmed live: content-negotiation via Accept header does not change the
 * search_rss response format, so this is not a workaround, it's the contract. */
async function findPlaceIds(text: string, limit: number): Promise<string[]> {
  const url = new URL(`${BASE_URL}/search_rss`)
  url.searchParams.set('SearchableText', text)
  url.searchParams.set('portal_type', 'Place')
  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000 })
  if (!result.ok) return []
  const resources = extractAllXmlAttributes(result.text, 'rdf:li', 'rdf:resource')
  const ids: string[] = []
  for (const uri of resources) {
    const match = /\/places\/(\d+)/.exec(uri)
    if (match) ids.push(match[1])
    if (ids.length >= limit) break
  }
  return ids
}

async function fetchPlace(id: string): Promise<PlaceDetail | null> {
  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/places/${id}/json`, { timeoutMs: 10_000 })
  if (!result.ok) return null
  return safeJsonParse<PlaceDetail>(result.text)
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `pleiades:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const ids = await findPlaceIds(text, limit)
  if (ids.length === 0) {
    const response = okResponse(PROVIDER, { documents: [], durationMs: Date.now() - started })
    return { ok: true as const, response }
  }

  const details = await Promise.all(ids.map(fetchPlace))
  const documents = details
    .filter((d): d is PlaceDetail => !!d && typeof d.id === 'string')
    .map(place => {
      const id = place.id as string
      const canonicalUrl = `https://pleiades.stoa.org/places/${id}`
      const coords = place.reprPoint
      return makeDocument({
        id: `pleiades:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: place.title ?? `Place ${id}`,
        summary: place.description ?? null,
        contentSnippet: coords ? `lat ${coords[1]}, lon ${coords[0]}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'Pleiades',
        contentType: 'historical_place',
        authors: [],
        organization: null,
        publishedAt: null,
        updatedAt: null,
        geography: coords ? `lat ${coords[1]}, lon ${coords[0]}` : null,
        language: null,
        identifiers: { pleiades_id: id },
        subjects: place.placeTypes ?? [],
        license: 'CC-BY',
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
      return outcome.response
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/places/579885/json`, { timeoutMs: 8_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'place JSON endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const pleiadesAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
