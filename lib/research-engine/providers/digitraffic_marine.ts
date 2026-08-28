import 'server-only'

/**
 * Digitraffic Marine Traffic (Fintraffic, Finland) — real live AIS vessel positions + static/
 * voyage metadata for Finnish territorial/EEZ waters. Confirmed live this build against the
 * current official docs (digitraffic.fi/en/marine-traffic, digitraffic.fi/en/terms-of-service):
 * zero-auth, keyless, CC BY 4.0. This is Terra's first Maritime source — see
 * lib/terra/maritimeSourceRegistry.ts for how it sits inside the broader Source Federation
 * (government feed, class C3) rather than being Maritime's only planned source.
 *
 * Two upstream GET calls, merged by MMSI:
 *   /locations — current AIS position reports (GeoJSON FeatureCollection; sog/cog/heading/navStat)
 *   /vessels   — static/voyage metadata (name/callSign/imo/destination/draught/shipType)
 * The endpoint has no bounding-box parameter — it always returns the whole Finnish-waters dataset
 * (~1,300-1,400 vessels) — so the camera-bbox query text this adapter requires (identical
 * "lamin,lomin,lamax,lomax" shape to lib/research-engine/providers/opensky.ts, reusing the same
 * documented convention) is applied as a server-side filter over the real response, never sent as
 * an upstream request parameter Digitraffic doesn't support.
 */
import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'digitraffic_marine' as const
const BASE_URL = 'https://meri.digitraffic.fi/api/ais/v1'
const MAX_RESULTS = 150
const BBOX_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/
// Not a secret — a plain identification string per Digitraffic's own "please identify your app"
// guidance (digitraffic.fi/en/support/instructions), which raises the documented 60 req/min/IP
// anonymous limit. No account or key is created or required to send this.
const DIGITRAFFIC_USER_HEADER = 'war-room-os-terra-maritime'

// Real ITU-R M.1371 AIS sentinel "not available" values — Digitraffic decodes raw AIS payloads but
// preserves these verbatim. Never rendered as real observed values.
const HEADING_NOT_AVAILABLE = 511
const COG_NOT_AVAILABLE = 360
const SOG_NOT_AVAILABLE = 102.3
const IMO_NOT_AVAILABLE = 0
const DRAUGHT_NOT_AVAILABLE = 0

type LocationFeature = {
  geometry: { type: string; coordinates: [number, number] }
  properties: { mmsi: number; sog: number; cog: number; navStat: number; heading: number; timestampExternal: number }
}
type LocationsResponse = { features?: LocationFeature[] | null }
type VesselRecord = { mmsi: number; name?: string; callSign?: string; imo?: number; destination?: string; draught?: number; shipType?: number }

function cleanString(raw: string | undefined): string | null {
  const trimmed = raw?.trim()
  return trimmed ? trimmed : null
}

/** Real ITU-R M.1371 Table 50.2 navigation-status codes (0-15) — a controlled vocabulary, not an
 * invented one, decoded the same way normalizeNwsAlerts.ts preserves real CAP severity text. */
const NAV_STATUS_LABELS: Record<number, string> = {
  0: 'Under way using engine',
  1: 'At anchor',
  2: 'Not under command',
  3: 'Restricted manoeuvrability',
  4: 'Constrained by her draught',
  5: 'Moored',
  6: 'Aground',
  7: 'Engaged in fishing',
  8: 'Under way sailing',
  9: 'Reserved (high-speed craft)',
  10: 'Reserved (wing-in-ground craft)',
  11: 'Power-driven vessel towing astern (regional)',
  12: 'Power-driven vessel pushing ahead/towing alongside (regional)',
  13: 'Reserved for future use',
  14: 'AIS-SART/MOB-AIS/EPIRB-AIS active',
  15: 'Not defined (default)',
}

/** Real ITU-R M.1371 Table 50.3 "ship and cargo type" decade categorization — broad categories
 * only (the full table has hundreds of sub-codes); a code outside every known decade is reported
 * as "Type {code} (reserved/other)", never silently dropped nor guessed into a specific vessel
 * class the code doesn't actually claim. */
function classifyAisShipType(code: number): string | null {
  if (!Number.isFinite(code) || code <= 0) return null
  if (code >= 20 && code <= 29) return 'Wing in ground (WIG)'
  if (code === 30) return 'Fishing'
  if (code === 31 || code === 32) return 'Towing'
  if (code === 33) return 'Dredging or underwater operations'
  if (code === 34) return 'Diving operations'
  if (code === 35) return 'Military operations'
  if (code === 36) return 'Sailing'
  if (code === 37) return 'Pleasure craft'
  if (code >= 40 && code <= 49) return 'High-speed craft (HSC)'
  if (code === 50) return 'Pilot vessel'
  if (code === 51) return 'Search and rescue vessel'
  if (code === 52) return 'Tug'
  if (code === 53) return 'Port tender'
  if (code === 54) return 'Anti-pollution equipment'
  if (code === 55) return 'Law enforcement'
  if (code === 58) return 'Medical transport'
  if (code >= 60 && code <= 69) return 'Passenger'
  if (code >= 70 && code <= 79) return 'Cargo'
  if (code >= 80 && code <= 89) return 'Tanker'
  if (code >= 90 && code <= 99) return 'Other type'
  return `Type ${code} (reserved/other)`
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim()
  const match = BBOX_PATTERN.exec(text)
  if (!match) {
    throw new Error('Query must be a bounding box "lamin,lomin,lamax,lomax" (e.g. "59.0,24.0,60.5,26.0" for the Gulf of Finland approaches to Helsinki).')
  }
  const [, laminStr, lominStr, lamaxStr, lomaxStr] = match
  const [lamin, lomin, lamax, lomax] = [laminStr, lominStr, lamaxStr, lomaxStr].map(Number)
  const limit = Math.max(1, Math.min(query.maxResults ?? 50, MAX_RESULTS))
  const cacheKey = `digitraffic_marine:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const headers = { 'Digitraffic-User': DIGITRAFFIC_USER_HEADER }
  const [locationsResult, vesselsResult] = await Promise.all([
    safeProviderFetch(PROVIDER, `${BASE_URL}/locations`, { timeoutMs: 15_000, headers }),
    safeProviderFetch(PROVIDER, `${BASE_URL}/vessels`, { timeoutMs: 15_000, headers }),
  ])
  if (!locationsResult.ok) return { ok: false as const, kind: 'http_error' as const, status: locationsResult.status }
  // Vessel static/voyage metadata is a real but non-essential enrichment (name/IMO/callsign/
  // destination/draught/shipType) — a failure fetching it degrades those fields to "not reported"
  // for this fetch rather than failing the whole layer, since position-only is still honest,
  // useful Observed Data.
  const vesselsOk = vesselsResult.ok

  const locationsData = safeJsonParse<LocationsResponse>(locationsResult.text)
  if (!locationsData) {
    return { ok: false as const, kind: 'malformed' as const, message: 'Digitraffic locations response was not valid JSON.' }
  }
  const vesselsData = vesselsOk ? safeJsonParse<VesselRecord[]>(vesselsResult.text) : null
  const vesselByMmsi = new Map<number, VesselRecord>((vesselsData ?? []).map(vessel => [vessel.mmsi, vessel]))

  const features = locationsData.features ?? []
  const withinBbox = features.filter(feature => {
    const [lon, lat] = feature.geometry?.coordinates ?? []
    return typeof lat === 'number' && typeof lon === 'number' && lat >= lamin && lat <= lamax && lon >= lomin && lon <= lomax
  })

  const documents = withinBbox.slice(0, limit).map(feature => {
    const [lon, lat] = feature.geometry.coordinates
    const props = feature.properties
    const mmsi = props.mmsi
    const vessel = vesselByMmsi.get(mmsi) ?? null
    const name = vessel ? cleanString(vessel.name) : null
    const callSign = vessel ? cleanString(vessel.callSign) : null
    const imo = vessel && vessel.imo && vessel.imo !== IMO_NOT_AVAILABLE ? vessel.imo : null
    const destination = vessel ? cleanString(vessel.destination) : null
    const draughtMeters = vessel && typeof vessel.draught === 'number' && vessel.draught !== DRAUGHT_NOT_AVAILABLE ? vessel.draught / 10 : null
    const shipTypeCode = vessel && typeof vessel.shipType === 'number' ? vessel.shipType : null
    const shipTypeLabel = shipTypeCode !== null ? classifyAisShipType(shipTypeCode) : null
    const sog = props.sog !== SOG_NOT_AVAILABLE ? props.sog : null
    const cog = props.cog !== COG_NOT_AVAILABLE ? props.cog : null
    const heading = props.heading !== HEADING_NOT_AVAILABLE ? props.heading : null
    const navStatLabel = NAV_STATUS_LABELS[props.navStat] ?? null
    const lastObservedIso = new Date(props.timestampExternal).toISOString()
    const title = name ?? `Vessel ${mmsi}`
    const canonicalUrl = `https://meri.digitraffic.fi/api/ais/v1/vessels/${mmsi}`

    return makeDocument({
      id: `digitraffic_marine:${mmsi}`,
      provider: PROVIDER,
      providerRecordId: String(mmsi),
      title,
      summary: navStatLabel ? `Navigation status: ${navStatLabel}` : null,
      contentSnippet: `lat ${lat}, lon ${lon}`,
      canonicalUrl,
      sourceUrl: canonicalUrl,
      sourceName: 'Digitraffic Marine Traffic (Fintraffic)',
      contentType: 'vessel_position',
      authors: [],
      organization: 'Fintraffic',
      publishedAt: lastObservedIso,
      updatedAt: null,
      geography: `lat ${lat}, lon ${lon}`,
      language: null,
      // Same "extra structured field" identifiers-bag convention normalizeOpenSkyAircraft.ts's own
      // provider (opensky.ts) uses — every real field this adapter can honestly extract, never a
      // fabricated one when the source didn't supply it (sentinel-filtered above).
      identifiers: {
        mmsi: String(mmsi),
        ...(callSign ? { callSign } : {}),
        ...(imo !== null ? { imo: String(imo) } : {}),
        latitude: String(lat),
        longitude: String(lon),
        ...(sog !== null ? { speedKnots: String(sog) } : {}),
        ...(cog !== null ? { courseDeg: String(cog) } : {}),
        ...(heading !== null ? { headingDeg: String(heading) } : {}),
        navStatCode: String(props.navStat),
        ...(navStatLabel ? { navStatLabel } : {}),
        ...(destination ? { destination } : {}),
        ...(draughtMeters !== null ? { draughtMeters: String(draughtMeters) } : {}),
        ...(shipTypeCode !== null ? { shipTypeCode: String(shipTypeCode) } : {}),
        ...(shipTypeLabel ? { shipTypeLabel } : {}),
        lastObservedIso,
        vesselMetadataAvailable: String(vesselsOk),
      },
      subjects: [],
      license: 'CC BY 4.0',
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
      if (outcome.kind === 'http_error') throw new Error(`Digitraffic Marine locations request failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/locations`, { timeoutMs: 10_000, headers: { 'Digitraffic-User': DIGITRAFFIC_USER_HEADER } })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'locations endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const digitrafficMarineAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
