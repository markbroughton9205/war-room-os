import 'server-only'

import type { ResearchGeoFeature, ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

/**
 * NOAA National Hurricane Center — CurrentStorms.json. A real, live, zero-auth, structured-JSON
 * feed of every currently active tropical/subtropical/post-tropical cyclone across all NHC
 * basins (Atlantic, Eastern Pacific, Central Pacific) — the exact "active hurricanes" gap Terra
 * Phase 0 identified and Phase 5 exists to close. No query parameters exist on this endpoint; the
 * caller's query text is accepted but ignored (documented, not silently dropped).
 *
 * The forecast track, track cone, and best track are real NHC products but are only published as
 * zip/KMZ GIS files, not inline JSON coordinate arrays — parsing them would require a real
 * shapefile/KML parser this codebase does not have. Their real URLs are preserved in
 * `identifiers`/summary text so a Commander can open them, but this adapter does not attempt to
 * decode them into a forecast track geometry this phase (see lib/terra/normalizeNhcCurrentStorms.ts
 * for how Terra documents this limitation honestly rather than fabricating a track).
 */
const PROVIDER = 'nhc_current_storms' as const
const BASE_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json'
const USER_AGENT = 'WarRoomOS-ResearchEngine/1.0 (research-engine@warroom.internal)'

type NhcProduct = { advNum?: string; issuance?: string; url?: string } | null
type NhcGisProduct = { zipFile?: string; kmzFile?: string } | null
type NhcStorm = {
  id?: string
  binNumber?: string
  name?: string
  classification?: string
  intensity?: string
  pressure?: string
  latitude?: string
  longitude?: string
  latitudeNumeric?: number
  longitudeNumeric?: number
  movementDir?: number
  movementSpeed?: number
  lastUpdate?: string
  publicAdvisory?: NhcProduct
  forecastAdvisory?: NhcProduct
  forecastDiscussion?: NhcProduct
  forecastGraphics?: NhcProduct
  forecastTrack?: NhcGisProduct
  trackCone?: NhcGisProduct
  bestTrackGIS?: NhcGisProduct
}
type NhcResponse = { activeStorms?: NhcStorm[] }

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

// binNumber's letter prefix is NHC's own basin code — AL (Atlantic), EP (Eastern Pacific), CP
// (Central Pacific) — real, not inferred.
function basinFromBinNumber(binNumber: string | undefined): string | null {
  if (!binNumber) return null
  const match = /^(AL|EP|CP)/.exec(binNumber)
  return match ? match[1] : null
}

// Query text is accepted (matching every other adapter's ResearchQuery contract) but intentionally
// unused — CurrentStorms.json has no query parameters; every caller sees the same live snapshot.
async function search(query: ResearchQuery) {
  void query
  const started = Date.now()
  const cacheKey = 'nhc_current_storms:active'
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(PROVIDER, BASE_URL, { timeoutMs: 12_000, headers: { 'User-Agent': USER_AGENT } })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<NhcResponse>(result.text)
  if (!data || !Array.isArray(data.activeStorms)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'NHC CurrentStorms response "activeStorms" field was missing or not an array.' }
  }

  const documents = data.activeStorms
    .filter(storm => typeof storm.id === 'string' && isFiniteNumber(storm.latitudeNumeric) && isFiniteNumber(storm.longitudeNumeric))
    .map(storm => {
      const id = storm.id as string
      const canonicalUrl = storm.publicAdvisory?.url ?? `https://www.nhc.noaa.gov/?${id}`
      return makeDocument({
        id: `nhc_current_storms:${id}`,
        provider: PROVIDER,
        providerRecordId: id,
        title: `${storm.classification ?? 'Cyclone'} ${storm.name ?? id}`,
        summary: `${storm.classification ?? 'Cyclone'} ${storm.name ?? id} — max sustained wind ${storm.intensity ?? 'n/a'} kt, pressure ${storm.pressure ?? 'n/a'} mb.`,
        contentSnippet: null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'NOAA National Hurricane Center',
        contentType: 'tropical_cyclone_advisory',
        authors: [],
        organization: 'NOAA/NHC',
        publishedAt: storm.publicAdvisory?.issuance ?? storm.lastUpdate ?? null,
        updatedAt: storm.lastUpdate ?? null,
        geography: null,
        language: 'en',
        identifiers: {
          nhc_storm_id: id,
          ...(storm.binNumber ? { basin: basinFromBinNumber(storm.binNumber) ?? '' } : {}),
          ...(storm.classification ? { classification: storm.classification } : {}),
          ...(storm.forecastTrack?.kmzFile ? { forecast_track_kmz: storm.forecastTrack.kmzFile } : {}),
          ...(storm.trackCone?.kmzFile ? { track_cone_kmz: storm.trackCone.kmzFile } : {}),
          ...(storm.bestTrackGIS?.kmzFile ? { best_track_kmz: storm.bestTrackGIS.kmzFile } : {}),
        },
        subjects: [],
        license: null,
        accessStatus: 'open',
      })
    })

  const geoFeatures: ResearchGeoFeature[] = data.activeStorms
    .filter(storm => typeof storm.id === 'string' && isFiniteNumber(storm.latitudeNumeric) && isFiniteNumber(storm.longitudeNumeric))
    .map(storm => ({
      id: storm.id as string,
      geometryType: 'Point',
      coordinates: [storm.longitudeNumeric, storm.latitudeNumeric],
      properties: {
        name: storm.name ?? null,
        classification: storm.classification ?? null,
        intensityKt: storm.intensity ? Number(storm.intensity) : null,
        pressureMb: storm.pressure ? Number(storm.pressure) : null,
        movementDir: storm.movementDir ?? null,
        movementSpeedKt: storm.movementSpeed ?? null,
        basin: basinFromBinNumber(storm.binNumber),
        lastUpdate: storm.lastUpdate ?? null,
        forecastAdvisoryUrl: storm.forecastAdvisory?.url ?? null,
        forecastDiscussionUrl: storm.forecastDiscussion?.url ?? null,
        forecastGraphicsUrl: storm.forecastGraphics?.url ?? null,
      },
    }))

  const response = okResponse(PROVIDER, { documents, geoFeatures, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`NHC CurrentStorms fetch failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, BASE_URL, { timeoutMs: 8_000, headers: { 'User-Agent': USER_AGENT } })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'CurrentStorms.json reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const nhcCurrentStormsAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
