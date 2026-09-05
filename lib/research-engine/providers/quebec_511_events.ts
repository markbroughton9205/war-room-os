import 'server-only'

/**
 * Québec 511 road events (entraves / avertissements) — God's Eye Phase 3 (global traffic
 * expansion), via the same official MTMD open-data WFS as quebec_511_cameras (see that file's
 * header for the shared endpoint/axis-order evidence). Real layer confirmed live this build:
 *   typename=ms:evenements — real HTTP 200 GeoJSON with real French-language event fields
 *   (entrave type, localisation, direction, municipalite, duree, cause, consequence, detour,
 *   regions, enVigueurDepuis ISO timestamp) and real Point or LineString geometry (real
 *   LineString corridors observed live — e.g. alternating-traffic segments with two coordinate
 *   pairs), never collapsed to a point. The geometry is preserved verbatim as JSON text in
 *   identifiers.rawGeography for lib/terra/normalizeQuebecTrafficEvents.ts to parse into Terra's
 *   own point/path geography, mirroring drivebc_events' existing convention.
 *
 * Source vocabulary is French (this is the MTMD's primary published language for the layer);
 * field text is preserved verbatim, never machine-translated into an invented English label.
 * Server-side bbox filtering uses the same lat,lon axis order as quebec_511_cameras (confirmed
 * live this build). Zero-auth, keyless; Québec government open data (donneesquebec.ca).
 */
import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'quebec_511_events' as const
const WFS_BASE_URL = 'https://ws.mapserver.transports.gouv.qc.ca/swtq'
const MAX_RESULTS = 100
const BBOX_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/

type QuebecEventProperties = {
  identifiant?: number
  entrave?: string
  numeroRoute?: string
  localisation?: string
  direction?: string
  municipalite?: string
  duree?: string
  cause?: string
  consequence?: string
  detour?: string
  regions?: string
  regionsDiffusion?: string
  enVigueurDepuis?: string
}
type QuebecEventFeature = {
  id?: number | string
  properties?: QuebecEventProperties
  geometry?: { type?: string; coordinates?: number[] | number[][] }
}

function parseIsoDate(raw: string | undefined): string | null {
  if (!raw) return null
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim()
  const match = BBOX_PATTERN.exec(text)
  if (!match) {
    throw new Error('Query must be a bounding box "lamin,lomin,lamax,lomax" (e.g. "45.3,-74.2,45.8,-73.3" for Montréal).')
  }
  const [, laminStr, lominStr, lamaxStr, lomaxStr] = match
  const limit = Math.max(1, Math.min(query.maxResults ?? 60, MAX_RESULTS))
  const cacheKey = `quebec_511_events:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  // WFS 2.0.0 / EPSG:4326 axis order is lat,lon — see quebec_511_cameras.ts's header for the
  // live-confirmed axis-order evidence.
  const url = `${WFS_BASE_URL}?service=wfs&version=2.0.0&request=getfeature&typename=ms:evenements&srsname=EPSG:4326&outputformat=geojson&bbox=${laminStr},${lominStr},${lamaxStr},${lomaxStr},EPSG:4326`
  const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 25_000, maxResponseBytes: 4 * 1024 * 1024 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }
  const payload = safeJsonParse<{ features?: QuebecEventFeature[] }>(result.text)
  if (!payload || !Array.isArray(payload.features)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Québec 511 events WFS response was not a valid GeoJSON FeatureCollection.' }
  }

  const documents: ReturnType<typeof makeDocument>[] = []
  for (const feature of payload.features) {
    if (documents.length >= limit) break
    const geometry = feature.geometry
    if (!geometry || (geometry.type !== 'Point' && geometry.type !== 'LineString') || !Array.isArray(geometry.coordinates)) continue
    const props = feature.properties ?? {}
    const eventId = String(props.identifiant ?? feature.id ?? '')
    if (!eventId) continue
    const inForceSinceIso = parseIsoDate(props.enVigueurDepuis)

    documents.push(makeDocument({
      id: `quebec_511_events:${eventId}`,
      provider: PROVIDER,
      providerRecordId: eventId,
      title: props.localisation || props.entrave || `Road event ${eventId}`,
      summary: [props.entrave, props.cause].filter(Boolean).join(' — ') || null,
      contentSnippet: [props.direction, props.municipalite, props.duree].filter(Boolean).join(' · '),
      canonicalUrl: 'https://www.quebec511.info/',
      sourceUrl: url,
      sourceName: 'Québec 511 (Ministère des Transports et de la Mobilité durable)',
      contentType: 'traffic_event',
      authors: [],
      organization: 'Ministère des Transports et de la Mobilité durable du Québec',
      publishedAt: inForceSinceIso,
      updatedAt: inForceSinceIso,
      geography: geometry.type === 'Point'
        ? `lat ${(geometry.coordinates as number[])[1]}, lon ${(geometry.coordinates as number[])[0]}`
        : null,
      language: 'fr',
      identifiers: {
        eventId,
        eventType: props.entrave ?? '',
        rawGeography: JSON.stringify(geometry),
        ...(props.numeroRoute ? { road: props.numeroRoute } : {}),
        ...(props.direction ? { direction: props.direction } : {}),
        ...(props.municipalite ? { municipality: props.municipalite } : {}),
        ...(props.duree ? { duration: props.duree } : {}),
        ...(props.cause ? { cause: props.cause } : {}),
        ...(props.consequence ? { consequence: props.consequence } : {}),
        ...(props.detour ? { detour: props.detour } : {}),
        ...(props.regionsDiffusion ? { regions: props.regionsDiffusion } : {}),
        ...(inForceSinceIso ? { inForceSinceIso } : {}),
      },
      subjects: [],
      license: 'Québec government open data (donneesquebec.ca)',
      accessStatus: 'open',
    }))
  }

  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`Québec 511 events request failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const url = `${WFS_BASE_URL}?service=wfs&version=2.0.0&request=getfeature&typename=ms:evenements&srsname=EPSG:4326&outputformat=geojson&count=1`
    const result = await safeProviderFetch(PROVIDER, url, { timeoutMs: 15_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'events WFS endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const quebec511EventsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
