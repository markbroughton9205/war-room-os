import 'server-only'

/**
 * Bounded Overpass QL for one urban tile. Uses the existing osm_overpass host allowlist and
 * safeProviderFetch boundary — never scrapes tile.openstreetmap.org vector endpoints, never
 * fans out one request per building.
 *
 * Public overpass-api.de is bootstrap/convenience only. Failover mirrors are NOT added here:
 * the Research Engine allowlist is deliberately single-host. Self-hosted Overpass is the
 * sovereign next step.
 */
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { withProviderGate } from '@/lib/research-engine/security/providerGate'
import { TERRA_URBAN_OVERPASS_MAX_RETRIES } from './requestControl'
import { buildUrbanOverpassQuery } from './query'
import type { OverpassResponse } from './normalize'
import type { TerraUrbanBounds, TerraUrbanLod } from './types'

const DEFAULT_OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const PROVIDER = 'osm_overpass' as const

function userAgent(): string {
  return process.env.OSM_OVERPASS_USER_AGENT_BASE?.trim() || 'WarRoomTerraUrban/1.0 (contact: research-engine@warroom.local)'
}

function overpassUrl(): string {
  const configured = process.env.OSM_OVERPASS_API_BASE_URL?.trim()
  return configured || DEFAULT_OVERPASS_URL
}

export { buildUrbanOverpassQuery }

export async function fetchUrbanOverpassTile(bounds: TerraUrbanBounds, lod: TerraUrbanLod): Promise<{
  ok: true
  response: OverpassResponse
  durationMs: number
  endpoint: string
} | {
  ok: false
  status: number | null
  message: string
  durationMs: number
  retryAfterMs: number | null
  endpoint: string
}> {
  const query = buildUrbanOverpassQuery(bounds, lod)
  const started = Date.now()
  const endpoint = overpassUrl()
  try {
    const result = await withProviderGate(PROVIDER, async () => {
      return safeProviderFetch(PROVIDER, endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': userAgent(),
        },
        body: `data=${encodeURIComponent(query)}`,
        timeoutMs: 28_000,
        maxRetries: TERRA_URBAN_OVERPASS_MAX_RETRIES,
        maxResponseBytes: 12 * 1024 * 1024,
      })
    })
    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        message: `Overpass HTTP ${result.status}`,
        durationMs: Date.now() - started,
        retryAfterMs: result.retryAfterMs,
        endpoint,
      }
    }
    const parsed = safeJsonParse<OverpassResponse>(result.text)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.elements)) {
      return {
        ok: false,
        status: result.status,
        message: 'Overpass response missing elements array.',
        durationMs: Date.now() - started,
        retryAfterMs: null,
        endpoint,
      }
    }
    return { ok: true, response: parsed, durationMs: Date.now() - started, endpoint }
  } catch (error) {
    return {
      ok: false,
      status: null,
      message: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
      retryAfterMs: null,
      endpoint,
    }
  }
}
