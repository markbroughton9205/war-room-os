import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'opensky' as const
const BASE_URL = 'https://opensky-network.org/api'
const MAX_RESULTS = 25
// "lamin,lomin,lamax,lomax" bounding box — required (unbounded /states/all is huge).
const BBOX_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/

type StateVector = [
  string, string | null, string, number | null, number | null, number | null, number | null,
  number | null, boolean, number | null, number | null, number | null, unknown, number | null,
  string | null, boolean, number,
]
type StatesResponse = { time?: number; states?: StateVector[] | null }

async function search(query: ResearchQuery) {
  const started = Date.now()
  const text = query.text.trim()
  const match = BBOX_PATTERN.exec(text)
  if (!match) {
    throw new Error('Query must be a bounding box "lamin,lomin,lamax,lomax" (e.g. "45.8,5.9,47.8,10.5" for Switzerland).')
  }
  const [, lamin, lomin, lamax, lomax] = match
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))
  const cacheKey = `opensky:${text}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(`${BASE_URL}/states/all`)
  url.searchParams.set('lamin', lamin)
  url.searchParams.set('lomin', lomin)
  url.searchParams.set('lamax', lamax)
  url.searchParams.set('lomax', lomax)

  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 15_000 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<StatesResponse>(result.text)
  if (!data) {
    return { ok: false as const, kind: 'malformed' as const, message: 'OpenSky response was not valid JSON.' }
  }
  const states = data.states ?? []

  const documents = states
    .slice(0, limit)
    .filter(s => typeof s[0] === 'string')
    .map(s => {
      const icao24 = s[0]
      const callsign = s[1]?.trim() || null
      const country = s[2]
      const lastContact = s[4]
      const lon = s[5]
      const lat = s[6]
      const baroAltitude = s[7]
      const onGround = s[8]
      const velocity = s[9]
      const trueTrack = s[10]
      const verticalRate = s[11]
      const geoAltitude = s[13]
      // baro_altitude is the more commonly populated of the two real OpenSky altitude fields;
      // geo_altitude is used only when it's null, never both averaged or guessed between.
      const altitudeMeters = baroAltitude ?? geoAltitude
      const canonicalUrl = `https://opensky-network.org/aircraft-profile?icao24=${icao24}`
      return makeDocument({
        id: `opensky:${icao24}`,
        provider: PROVIDER,
        providerRecordId: icao24,
        title: callsign ?? `Aircraft ${icao24}`,
        summary: `Origin country: ${country}${onGround ? ' (on ground)' : ''}`,
        contentSnippet: lat != null && lon != null ? `lat ${lat}, lon ${lon}` : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'OpenSky Network',
        contentType: 'aircraft_state',
        authors: [],
        organization: null,
        publishedAt: data.time ? new Date(data.time * 1000).toISOString() : null,
        updatedAt: null,
        geography: lat != null && lon != null ? `lat ${lat}, lon ${lon}` : country ?? null,
        language: null,
        // Every real OpenSky state-vector field this adapter can honestly extract, carried as
        // strings in the existing identifiers bag (the same "extra structured field" escape hatch
        // normalizeNwsAlerts.ts already uses for severity/urgency/certainty) — never fabricated
        // when the source reports null (origin/destination/operator/registration/model are not
        // part of this endpoint at all and are never invented here).
        identifiers: {
          icao24,
          ...(callsign ? { callsign } : {}),
          ...(country ? { originCountry: country } : {}),
          ...(lat != null ? { latitude: String(lat) } : {}),
          ...(lon != null ? { longitude: String(lon) } : {}),
          ...(altitudeMeters != null ? { altitudeMeters: String(altitudeMeters) } : {}),
          ...(velocity != null ? { velocityMps: String(velocity) } : {}),
          ...(trueTrack != null ? { headingDeg: String(trueTrack) } : {}),
          ...(verticalRate != null ? { verticalRateMps: String(verticalRate) } : {}),
          onGround: String(onGround),
          ...(lastContact != null ? { lastContactIso: new Date(lastContact * 1000).toISOString() } : {}),
        },
        subjects: [],
        license: null,
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
      if (outcome.kind === 'http_error') throw new Error(`OpenSky search failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, `${BASE_URL}/states/all?lamin=45.8&lomin=5.9&lamax=47.8&lomax=10.5`, { timeoutMs: 10_000 })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'states endpoint reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const openskyAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
