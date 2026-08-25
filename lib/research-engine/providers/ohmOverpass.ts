import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'ohm_overpass' as const
// A distinct OpenHistoricalMap Overpass deployment (confirmed live, separate
// host/dataset from the standard-OSM overpass-api.de instance the existing
// osm_overpass adapter targets) — OHM tags historical features with
// start_date/end_date, data OSM itself does not carry, so this is genuinely
// additional coverage, not a duplicate.
const BASE_URL = 'https://overpass-api.openhistoricalmap.org/api/interpreter'
const MAX_RESULTS = 20
const DEFAULT_RADIUS_KM = 10
const MAX_RADIUS_KM = 100
const NEAR_PATTERN = /^(.*?)\s+near\s+(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?$/i

type OverpassElement = { type?: string; id?: number; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> }
type OverpassResponse = { elements?: OverpassElement[] }

class OhmOverpassQueryError extends Error {}

function userAgent(): string {
  return process.env.OHM_OVERPASS_USER_AGENT_BASE?.trim() || 'WarRoomResearchEngine/1.0 (contact: research-engine@warroom.local)'
}

function kmToDegrees(km: number): number {
  return km / 111
}

function buildQuery(name: string, lat: number, lon: number, radiusKm: number, limit: number): string {
  const delta = kmToDegrees(radiusKm)
  const south = lat - delta
  const north = lat + delta
  const west = lon - delta
  const east = lon + delta
  const escapedName = name.replace(/"/g, '\\"')
  return `[out:json][timeout:25];nwr[name~"${escapedName}",i](${south},${west},${north},${east});out center ${limit};`
}

async function search(query: ResearchQuery) {
  const started = Date.now()
  const match = NEAR_PATTERN.exec(query.text.trim())
  if (!match) {
    throw new OhmOverpassQueryError('Query must be in the form "<name> near <lat>,<lon>[,<radiusKm>]" — Overpass has no unbounded worldwide search.')
  }
  const [, rawName, latStr, lonStr, radiusStr] = match
  const name = rawName.trim().slice(0, 100)
  const lat = Number(latStr)
  const lon = Number(lonStr)
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new OhmOverpassQueryError('Invalid name or out-of-range coordinates.')
  }
  const radiusKm = Math.max(0.1, Math.min(radiusStr ? Number(radiusStr) : DEFAULT_RADIUS_KM, MAX_RADIUS_KM))
  const limit = Math.max(1, Math.min(query.maxResults ?? 10, MAX_RESULTS))

  const cacheKey = `ohm_overpass:${name}:${lat}:${lon}:${radiusKm}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const overpassQuery = buildQuery(name, lat, lon, radiusKm, limit)
  const result = await safeProviderFetch(PROVIDER, BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': userAgent() },
    body: `data=${encodeURIComponent(overpassQuery)}`,
    timeoutMs: 30_000,
  })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const data = safeJsonParse<OverpassResponse>(result.text)
  if (!data || typeof data !== 'object' || !Array.isArray(data.elements)) {
    return { ok: false as const, kind: 'malformed' as const, message: 'OHM Overpass response "elements" field was missing or not an array.' }
  }

  const documents = data.elements
    .filter(el => el.type && typeof el.id === 'number')
    .map(el => {
      const recordId = `${el.type}/${el.id}`
      const canonicalUrl = `https://www.openhistoricalmap.org/${el.type}/${el.id}`
      const tagName = el.tags?.name ?? name
      const pointLat = el.lat ?? el.center?.lat
      const pointLon = el.lon ?? el.center?.lon
      const geo = typeof pointLat === 'number' && typeof pointLon === 'number' ? `lat ${pointLat}, lon ${pointLon}` : null
      const dateRange = [el.tags?.start_date, el.tags?.end_date].filter(Boolean).join(' – ')
      return makeDocument({
        id: `ohm_overpass:${recordId}`,
        provider: PROVIDER,
        providerRecordId: recordId,
        title: tagName,
        summary: dateRange || null,
        contentSnippet: el.tags ? Object.entries(el.tags).map(([k, v]) => `${k}=${v}`).join(', ') : null,
        canonicalUrl,
        sourceUrl: canonicalUrl,
        sourceName: 'OpenHistoricalMap',
        contentType: 'historical_geospatial_feature',
        authors: [],
        organization: null,
        publishedAt: el.tags?.start_date ?? null,
        updatedAt: null,
        geography: geo,
        language: null,
        identifiers: { ohm_id: recordId },
        subjects: el.tags ? Object.keys(el.tags) : [],
        license: 'CC0',
        accessStatus: 'open',
      })
    })
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.webSearch)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await search(query)
      if (outcome.ok) return outcome.response
      if (outcome.kind === 'http_error') throw new Error(`OHM Overpass query failed with HTTP ${outcome.status}`)
      throw new Error(outcome.message)
    })
  } catch (error) {
    if (error instanceof OhmOverpassQueryError) {
      return errorResponse(PROVIDER, { provider: PROVIDER, category: 'unknown', message: error.message, httpStatus: null }, 0)
    }
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  try {
    const result = await safeProviderFetch(PROVIDER, BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': userAgent() },
      body: 'data=' + encodeURIComponent('[out:json][timeout:10];node(0,0,0.01,0.01);out body 1;'),
      timeoutMs: 15_000,
    })
    return { provider: PROVIDER, state: result.ok ? 'ready' : 'degraded', checkedAt: nowIso(), detail: result.ok ? 'interpreter reachable' : `HTTP ${result.status}`, durationMs: Date.now() - started }
  } catch (error) {
    return { provider: PROVIDER, state: 'unavailable', checkedAt: nowIso(), detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }
  }
}

export const ohmOverpassAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
