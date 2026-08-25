import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'whg' as const
const BASE_URL = 'https://whgazetteer.org/api/index'
const MAX_RESULTS = 25
const USER_AGENT = 'WarRoomOS-ResearchEngine/1.0 (research-engine@warroom.internal)'

type Timespan = { gte?: number; lte?: number }
type Properties = {
  title?: string
  index_id?: string | number
  place_id?: string | number
  variants?: string[]
  placetypes?: string[]
  timespans?: Timespan[]
  dataset?: string
  ccodes?: string[]
}
type Geometry = { type?: string; coordinates?: [number, number] }
type Feature = { properties?: Properties; geometry?: Geometry }
type FeatureCollection = { features?: Feature[] }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim().slice(0, 200)
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `whg:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/`)
  url.searchParams.set('name', text)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 12_000, headers: { 'User-Agent': USER_AGENT } })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<FeatureCollection>(result.text)
  if (!data || !Array.isArray(data.features)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'WHG response "features" field was missing or not an array.' }
  }

  const documents = data.features
    .slice(0, limit)
    .filter(f => f.properties?.index_id != null)
    .map(f => {
      const props = f.properties as Properties
      const id = String(props.index_id)
      const canonicalUrl = `https://whgazetteer.org/places/${props.place_id ?? id}/portal/`
      const timespan = props.timespans?.[0]
      const geo = f.geometry?.coordinates ? `lat ${f.geometry.coordinates[1]}, lon ${f.geometry.coordinates[0]}` : null
      return makeDocument({
        id: `whg:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: props.title ?? `Place ${id}`,
        summary: props.variants?.length ? `Also known as: ${props.variants.slice(0, 5).join(', ')}` : null,
        contentSnippet: geo,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'World Historical Gazetteer',
        contentType: 'historical_place',
        authors: [],
        organization: null,
        publishedAt: timespan ? `${timespan.gte ?? ''}` : null,
        updatedAt: null,
        geography: props.ccodes?.length ? props.ccodes.join(', ') : geo,
        language: null,
        identifiers: { whg_index_id: id },
        subjects: props.placetypes ?? [],
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
      if (outcome.kind === 'http_error') throw new Error(`WHG search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/?name=Rome`, { timeoutMs: 8_000, headers: { 'User-Agent': USER_AGENT } })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'index search reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const whgAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
