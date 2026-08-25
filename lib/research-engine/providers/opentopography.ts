import 'server-only'

import type { ResearchHealthStatus, ResearchQuery } from '@/lib/research-engine/core/types'
import { providerEnvDescriptor, isProviderEnvSatisfied } from '@/lib/research-engine/config/providerEnv'
import { safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { ResearchProviderAdapter } from '@/lib/research-engine/providers/adapter'
import { errorResponse, makeDocument, notConfiguredResponse, okResponse, nowIso } from '@/lib/research-engine/providers/shared'

const PROVIDER = 'opentopography' as const
const BASE_URL = 'https://portal.opentopography.org/API/globaldem'
const BBOX_PATTERN = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*([A-Z0-9]+))?$/i
const DEFAULT_DEM_TYPE = 'SRTMGL3'
// OpenTopography's free tier is heavily rate-limited (50-200 calls/24h) —
// this adapter never fetches the actual raster body, only confirms the
// bounded request would succeed and records file metadata (size/type), to
// avoid burning the caller's daily quota on data this codebase can't
// usefully decode into document fields anyway.

function apiKey(): string {
  return process.env.OPENTOPOGRAPHY_API_KEY?.trim() ?? ''
}

/** Query text is "<south>,<west>,<north>,<east>[,<demType>]". */
function parseBbox(text: string): { south: number; west: number; north: number; east: number; demType: string } | null {
  const match = BBOX_PATTERN.exec(text.trim())
  if (!match) return null
  const [, south, west, north, east, demType] = match
  const bbox = { south: Number(south), west: Number(west), north: Number(north), east: Number(east), demType: (demType ?? DEFAULT_DEM_TYPE).toUpperCase() }
  if (bbox.south >= bbox.north || bbox.west >= bbox.east) return null
  // Cap the request area to keep every call small and quota-friendly.
  if (bbox.north - bbox.south > 1 || bbox.east - bbox.west > 1) return null
  return bbox
}

async function fetchTile(query: ResearchQuery) {
  const started = Date.now()
  const bbox = parseBbox(query.text)
  if (!bbox) {
    throw new Error('Query must be "<south>,<west>,<north>,<east>[,<demType>]" with a span ≤1° per side (e.g. "36.0,-112.5,36.5,-112.0,SRTMGL3").')
  }
  const cacheKey = `opentopography:${bbox.south}:${bbox.west}:${bbox.north}:${bbox.east}:${bbox.demType}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const url = new URL(BASE_URL)
  url.searchParams.set('demtype', bbox.demType)
  url.searchParams.set('south', String(bbox.south))
  url.searchParams.set('north', String(bbox.north))
  url.searchParams.set('west', String(bbox.west))
  url.searchParams.set('east', String(bbox.east))
  url.searchParams.set('outputFormat', 'GTiff')
  url.searchParams.set('API_Key', apiKey())

  // HEAD-equivalent: this endpoint doesn't document a lightweight metadata
  // probe, so a real GET is required to confirm the tile is servable — the
  // response body (a GeoTIFF) is read via the shared client's byte cap but
  // never decoded, only its size recorded.
  const result = await safeProviderFetch(PROVIDER, url.toString(), { timeoutMs: 20_000, maxResponseBytes: 2 * 1024 * 1024 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }

  const canonicalUrl = 'https://opentopography.org/'
  const documents = [makeDocument({
    id: `opentopography:${bbox.demType}:${bbox.south}:${bbox.west}:${bbox.north}:${bbox.east}`,
    provider: PROVIDER,
    providerRecordId: `${bbox.demType}:${bbox.south},${bbox.west},${bbox.north},${bbox.east}`,
    title: `${bbox.demType} elevation tile — ${bbox.south},${bbox.west} to ${bbox.north},${bbox.east}`,
    summary: `GeoTIFF DEM tile, ${result.truncated ? '>2MB (truncated at cap)' : `${result.text.length} bytes`}`,
    contentSnippet: null,
    canonicalUrl,
    sourceUrl: url.toString().replace(/API_Key=[^&]+/, 'API_Key=REDACTED'),
    sourceName: 'OpenTopography',
    contentType: 'elevation_raster_tile',
    authors: [],
    organization: null,
    publishedAt: null,
    updatedAt: null,
    geography: `${bbox.south},${bbox.west} to ${bbox.north},${bbox.east}`,
    language: null,
    identifiers: { dem_type: bbox.demType },
    subjects: [],
    license: null,
    accessStatus: 'open',
  })]
  const response = okResponse(PROVIDER, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.codelist)
  return { ok: true as const, response }
}

async function run(query: ResearchQuery) {
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return notConfiguredResponse(PROVIDER, 'OPENTOPOGRAPHY_API_KEY is not configured.')
  }
  try {
    return await withProviderGate(PROVIDER, async () => {
      const outcome = await fetchTile(query)
      if (outcome.ok) return outcome.response
      throw new Error(`OpenTopography fetch failed with HTTP ${outcome.status}`)
    })
  } catch (error) {
    return errorResponse(PROVIDER, { provider: PROVIDER, category: 'upstream_error', message: error instanceof Error ? error.message : String(error), httpStatus: null }, 0)
  }
}

async function healthCheck(): Promise<ResearchHealthStatus> {
  const started = Date.now()
  const descriptor = providerEnvDescriptor(PROVIDER)
  if (!descriptor || !isProviderEnvSatisfied(descriptor)) {
    return { provider: PROVIDER, state: 'not_configured', checkedAt: nowIso(), detail: 'OPENTOPOGRAPHY_API_KEY missing', durationMs: null }
  }
  // Deliberately does not spend a real quota call here — the free tier is
  // capped at 50-200 calls/24h, too scarce to burn on a routine health
  // check. Configuration presence is reported instead of a live probe.
  return { provider: PROVIDER, state: 'ready', checkedAt: nowIso(), detail: 'API key configured; live probe skipped to conserve the low daily quota', durationMs: Date.now() - started }
}

export const opentopographyAdapter: ResearchProviderAdapter = { id: PROVIDER, run, healthCheck }
