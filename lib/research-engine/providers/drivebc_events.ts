import 'server-only'

/**
 * DriveBC / Open511 (British Columbia, Canada) — God's Eye Traffic & Camera Intelligence phase's
 * first traffic-event source. Real endpoint confirmed live this build:
 * api.open511.gov.bc.ca/events — a standard Open511 v1 (open511.org) implementation, zero-auth,
 * keyless, real server-side `bbox` and `limit` query parameters (unlike Digitraffic, no
 * client-side post-filter is needed here — confirmed live this build that `?bbox=W,S,E,N` returns
 * a genuinely filtered result set, not the whole province).
 *
 * Real event_type/severity/status vocabulary (Open511 §Events spec, confirmed against live
 * responses this build) is preserved verbatim — never reinterpreted into a War Room-invented
 * scale, matching normalizeNwsAlerts.ts's existing CAP-preservation convention. `geography` is
 * real GeoJSON, either Point (a fixed hazard/incident location) or LineString (a construction/
 * closure corridor spanning a real stretch of highway) — both are passed through as real geometry,
 * never collapsed to a single point.
 */
import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'drivebc_events' as const
const BASE_URL = 'https://api.open511.gov.bc.ca'
const MAX_RESULTS = 100
const BBOX_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/

type Open511Geography = { type: 'Point' | 'LineString'; coordinates: number[] | number[][] }
type Open511Road = { name?: string; from?: string; to?: string; direction?: string; state?: string }
type Open511Event = {
  id: string
  url?: string
  headline?: string
  description?: string
  status: string
  event_type: string
  event_subtypes?: string[]
  severity?: string
  created?: string
  updated?: string
  geography?: Open511Geography
  roads?: Open511Road[]
}
type Open511Response = { events?: Open511Event[] | null }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim()
  const match = BBOX_PATTERN.exec(text)
  if (!match) {
    throw new Error('Query must be a bounding box "west,south,east,north" (e.g. "-123.3,49.0,-122.7,49.4" for the Vancouver metro area).')
  }
  const bbox = text
  const limit = Math.max(1, Math.min(query.maxResults ?? 50, MAX_RESULTS))
  const cacheKey = `drivebc_events:${bbox}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = `${BASE_URL}/events?bbox=${encodeURIComponent(bbox)}&status=ACTIVE&limit=${limit}&format=json`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }
  const data = safeJsonParse<Open511Response>(result.text)
  if (!data) return { ok: false as const, kind: 'malformed' as const, message: 'Open511 (DriveBC) events response was not valid JSON.' }

  const documents = (data.events ?? []).slice(0, limit).map(event => {
    const road = event.roads?.[0] ?? null
    const roadLabel = road?.name ?? null
    const canonicalUrl = event.url ?? `https://api.open511.gov.bc.ca/events/${event.id}`
    const geographyKind = event.geography?.type === 'LineString' ? 'path' : 'point'

    return makeDocument({
      id: `drivebc_events:${event.id}`,
      provider: PROVIDER,
      providerRecordId: event.id,
      title: event.headline ?? event.event_type,
      summary: event.description ?? null,
      contentSnippet: roadLabel ? `${event.event_type} on ${roadLabel}` : event.event_type,
      canonicalUrl,
      sourceUrl: canonicalUrl,
      sourceName: 'DriveBC / Open511 (British Columbia)',
      contentType: 'traffic_event',
      authors: [],
      organization: 'Government of British Columbia',
      publishedAt: event.updated ?? event.created ?? null,
      updatedAt: event.updated ?? null,
      geography: event.geography ? event.geography.type : null,
      language: null,
      identifiers: {
        eventType: event.event_type,
        status: event.status,
        geographyKind,
        ...(event.severity ? { severity: event.severity } : {}),
        ...(roadLabel ? { road: roadLabel } : {}),
        ...(road?.direction ? { direction: road.direction } : {}),
        ...(road?.state ? { laneState: road.state } : {}),
        ...(event.event_subtypes?.length ? { eventSubtypes: event.event_subtypes.join(',') } : {}),
        ...(event.geography ? { rawGeography: JSON.stringify(event.geography) } : {}),
      },
      subjects: [],
      license: 'Open Government Licence — British Columbia',
      accessStatus: 'open',
    })
  })

  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`DriveBC (Open511) events request failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/events?limit=1&format=json`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'events endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const drivebcEventsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
