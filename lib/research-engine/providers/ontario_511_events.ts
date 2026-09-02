import 'server-only'

/**
 * Ontario 511 (511on.ca) road events — God's Eye Phase 2. Real endpoint confirmed live this build:
 * GET https://511on.ca/api/v2/get/event — zero-auth, keyless, real JSON array of road events
 * (crashes, construction, closures, restrictions). Real EventType/Severity/LanesAffected vocabulary
 * is preserved verbatim, matching drivebc_events'/normalizeNwsAlerts.ts's existing "never
 * reinterpret a source's own severity/status vocabulary" convention. `Reported`/`LastUpdated`/
 * `StartDate`/`PlannedEndDate` are real Unix epoch seconds, converted to ISO 8601 only (no timezone
 * shift, no invented precision).
 */
import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'ontario_511_events' as const
const BASE_URL = 'https://511on.ca/api/v2/get'
const MAX_RESULTS = 100
const BBOX_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/

type OntarioEvent = {
  ID: number
  Organization?: string
  RoadwayName?: string
  DirectionOfTravel?: string
  Description?: string
  Reported?: number
  LastUpdated?: number
  EventType?: string
  EventSubType?: string | null
  IsFullClosure?: boolean
  Severity?: string
  LanesAffected?: string
  Latitude: number
  Longitude: number
}

function epochSecondsToIso(seconds: number | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null
  return new Date(seconds * 1000).toISOString()
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim()
  const match = BBOX_PATTERN.exec(text)
  if (!match) {
    throw new Error('Query must be a bounding box "lamin,lomin,lamax,lomax" (e.g. "43.5,-79.6,43.9,-79.1" for the Toronto/QEW area).')
  }
  const [, laminStr, lominStr, lamaxStr, lomaxStr] = match
  const [lamin, lomin, lamax, lomax] = [laminStr, lominStr, lamaxStr, lomaxStr].map(Number)
  const limit = Math.max(1, Math.min(query.maxResults ?? 60, MAX_RESULTS))
  const cacheKey = `ontario_511_events:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/event`, { timeoutMs: 20_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }
  const events = safeJsonParse<OntarioEvent[]>(result.text)
  if (!events) return { ok: false as const, kind: 'malformed' as const, message: 'Ontario 511 events response was not valid JSON.' }

  const withinBbox = events.filter(event =>
    typeof event.Latitude === 'number' && typeof event.Longitude === 'number' &&
    event.Latitude >= lamin && event.Latitude <= lamax && event.Longitude >= lomin && event.Longitude <= lomax,
  )

  const documents = withinBbox.slice(0, limit).map(event => {
    const updatedIso = epochSecondsToIso(event.LastUpdated)
    const reportedIso = epochSecondsToIso(event.Reported)
    const canonicalUrl = `https://511on.ca/list/events/${event.ID}`
    const road = event.RoadwayName ?? null

    return makeDocument({
      id: `ontario_511_events:${event.ID}`,
      provider: PROVIDER,
      providerRecordId: String(event.ID),
      title: road ? `${event.EventType ?? 'Event'} — ${road}` : (event.EventType ?? `Event ${event.ID}`),
      summary: event.Description ?? null,
      contentSnippet: road ? `${event.EventType ?? 'event'} on ${road}` : (event.EventType ?? null),
      canonicalUrl,
      sourceUrl: canonicalUrl,
      sourceName: 'Ontario 511 (511on.ca)',
      contentType: 'traffic_event',
      authors: [],
      organization: event.Organization ?? 'Government of Ontario / Ministry of Transportation',
      publishedAt: updatedIso ?? reportedIso,
      updatedAt: updatedIso,
      geography: `lat ${event.Latitude}, lon ${event.Longitude}`,
      language: null,
      identifiers: {
        latitude: String(event.Latitude),
        longitude: String(event.Longitude),
        eventType: event.EventType ?? 'unknown',
        geographyKind: 'point',
        ...(event.Severity ? { severity: event.Severity } : {}),
        ...(road ? { road } : {}),
        ...(event.DirectionOfTravel && event.DirectionOfTravel !== 'Unknown' ? { direction: event.DirectionOfTravel } : {}),
        ...(event.LanesAffected ? { laneState: event.LanesAffected } : {}),
        ...(event.EventSubType ? { eventSubtypes: event.EventSubType } : {}),
        ...(typeof event.IsFullClosure === 'boolean' ? { isFullClosure: String(event.IsFullClosure) } : {}),
        ...(reportedIso ? { reportedAtIso: reportedIso } : {}),
      },
      subjects: [],
      license: 'Government of Ontario — terms not independently confirmed this build',
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
      if (outcome.kind === 'http_error') throw new Error(`Ontario 511 events request failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/event`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'event endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ontario511EventsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
