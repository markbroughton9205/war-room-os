import 'server-only'

/**
 * OHGO incidents, construction, dangerous slowdowns, and travel delays.
 * Same PUBLIC_KEY as cameras. Bounded with map-bounds-sw / map-bounds-ne.
 */
import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { ohgoApiKey, ohgoGetJson, ohgoLatLon, ohgoParseId, parseOhgoList, OHGO_API_BASE } from './ohgo_shared'
import { TERRA_OFFICIAL_VIEWERS } from '@/lib/terra/terraPublicIdentity'

const PROVIDER = 'ohgo_events' as const
const MAX_RESULTS = 80
const BBOX_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/

const ENDPOINTS = [
  { path: 'incidents', eventType: 'incident' },
  { path: 'construction', eventType: 'construction' },
  { path: 'dangerous-slowdowns', eventType: 'dangerous_slowdown' },
  { path: 'travel-delays', eventType: 'travel_delay' },
  { path: 'digital-signs', eventType: 'digital_sign' },
] as const

type OhgoEventRow = {
  Id?: string | number
  id?: string | number
  Latitude?: number
  latitude?: number
  Longitude?: number
  longitude?: number
  Location?: string
  location?: string
  Description?: string
  description?: string
  Direction?: string
  direction?: string
  Category?: string
  category?: string
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const key = ohgoApiKey()
  if (!key) return { ok: false as const, kind: 'not_configured' as const, message: 'OHGO_API_KEY is not configured.' }
  const match = BBOX_PATTERN.exec(query.text.trim())
  if (!match) throw new Error('Query must be a bounding box "lamin,lomin,lamax,lomax".')
  const [, laminStr, lominStr, lamaxStr, lomaxStr] = match
  const bbox = { lamin: Number(laminStr), lomin: Number(lominStr), lamax: Number(lamaxStr), lomax: Number(lomaxStr) }
  const limit = Math.max(1, Math.min(query.maxResults ?? 60, MAX_RESULTS))
  const cacheKey = `ohgo_events:${query.text.trim()}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const documents: ReturnType<typeof makeDocument>[] = []
  for (const endpoint of ENDPOINTS) {
    const result = await ohgoGetJson(PROVIDER, endpoint.path, key, bbox)
    if (result.status === 429) return { ok: false as const, kind: 'http_error' as const, status: 429 }
    if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }
    const rows = parseOhgoList<OhgoEventRow>(safeJsonParse(result.text))
    if (!rows) return { ok: false as const, kind: 'malformed' as const, message: `OHGO ${endpoint.path} response was not a list.` }
    for (const row of rows) {
      if (documents.length >= limit) break
      const id = ohgoParseId(row)
      const point = ohgoLatLon(row)
      if (!id || !point) continue
      const title = (row.Description ?? row.description ?? row.Location ?? row.location ?? `${endpoint.eventType} ${id}`).trim()
      documents.push(makeDocument({
        id: `ohgo_events:${endpoint.eventType}:${id}`,
        provider: PROVIDER,
        providerRecordId: `${endpoint.eventType}:${id}`,
        title,
        summary: row.Location ?? row.location ?? endpoint.eventType,
        contentSnippet: `lat ${point.lat}, lon ${point.lon}`,
        canonicalUrl: TERRA_OFFICIAL_VIEWERS.ohgoMap,
        sourceUrl: `${OHGO_API_BASE}/${endpoint.path}`,
        sourceName: 'ODOT / OHGO',
        contentType: 'traffic_event',
        authors: [],
        organization: 'ODOT',
        publishedAt: null,
        updatedAt: null,
        geography: `lat ${point.lat}, lon ${point.lon}`,
        language: 'en',
        identifiers: {
          latitude: String(point.lat),
          longitude: String(point.lon),
          eventType: endpoint.eventType,
          viewerUrl: TERRA_OFFICIAL_VIEWERS.ohgoMap,
          ...(row.Direction ?? row.direction ? { direction: String(row.Direction ?? row.direction) } : {}),
          ...(row.Category ?? row.category ? { category: String(row.Category ?? row.category) } : {}),
        },
        subjects: [endpoint.eventType],
        license: 'OHGO Public API',
        accessStatus: 'open',
      }))
    }
  }

  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'OHGO_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'not_configured') return notConfiguredResponse(PROVIDER, outcome.message)
      if (outcome.kind === 'http_error') {
        throw new Error(outcome.status === 429 ? 'OHGO events request was RATE_LIMITED (HTTP 429).' : `OHGO events request failed with HTTP ${outcome.status}`)
      }
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const key = ohgoApiKey()
  if (!key) return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'OHGO_API_KEY missing', durationMs: null }
  try {
    const result = await ohgoGetJson(PROVIDER, 'incidents', key, { lamin: 41.0, lomin: -81.7, lamax: 41.2, lomax: -81.3 })
    const state = result.ok ? 'ready' : result.status === 401 || result.status === 403 ? 'authentication_failed' : result.status === 429 ? 'rate_limited' : 'degraded'
    return { provider: PROVIDER, state, checkedAt: nowIso(), detail: result.ok ? 'incidents endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ohgoEventsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
