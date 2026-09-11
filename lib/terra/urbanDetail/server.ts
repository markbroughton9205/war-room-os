import 'server-only'

import {
  isOverpassBackedOff,
  noteOverpassRateLimit,
  noteOverpassSuccess,
  readOverpassBackoffRemainingMs,
  readUrbanTileCacheRecord,
  TERRA_URBAN_ERROR_TTL_MS,
  writeUrbanTileCache,
} from './cache'
import { normalizeOverpassUrbanGeometry } from './normalize'
import { fetchUrbanOverpassTile } from './overpass'
import {
  asCachedUrbanPayload,
  asStaleUrbanPayload,
  createUrbanFetchCoordinator,
  hasUsableUrbanGeometry,
  isRateLimitedStatus,
  isUrbanRequestSuperseded,
  rateLimitedDiagnostics,
} from './requestControl'
import { tileBounds, urbanTileCacheKey } from './tiles'
import {
  TERRA_URBAN_ATTRIBUTION,
  TERRA_URBAN_LICENSE,
  TERRA_URBAN_SOURCE,
  TERRA_URBAN_TILE_VERSION,
  type TerraUrbanDiagnosticState,
  type TerraUrbanLod,
  type TerraUrbanTileKey,
  type TerraUrbanTilePayload,
} from './types'

const urbanCoordinator = createUrbanFetchCoordinator<TerraUrbanTilePayload>()

function emptyDiagnostics(state: TerraUrbanDiagnosticState, lod: TerraUrbanLod): TerraUrbanTilePayload['diagnostics'] {
  return {
    roads: state,
    buildings: lod === 'city' ? 'UNAVAILABLE' : state,
    labels: lod === 'building' ? state : 'UNAVAILABLE',
  }
}

export function emptyUrbanTile(key: TerraUrbanTileKey, state: TerraUrbanDiagnosticState, error: string | null, fromCache = false): TerraUrbanTilePayload {
  return {
    version: TERRA_URBAN_TILE_VERSION,
    source: TERRA_URBAN_SOURCE,
    license: TERRA_URBAN_LICENSE,
    attribution: TERRA_URBAN_ATTRIBUTION,
    key,
    bounds: tileBounds(key.z, key.x, key.y),
    fetchedAt: new Date().toISOString(),
    fromCache,
    truncated: false,
    roads: [],
    buildings: [],
    labels: [],
    diagnostics: emptyDiagnostics(state, key.lod),
    error,
    rateLimited: state === 'RATE_LIMITED',
    retryAfterMs: state === 'RATE_LIMITED' ? readOverpassBackoffRemainingMs() : null,
  }
}

function withGeometryDiagnostics(lod: TerraUrbanLod, liveState: TerraUrbanDiagnosticState): TerraUrbanTilePayload['diagnostics'] {
  return {
    roads: liveState,
    buildings: lod === 'city' ? 'UNAVAILABLE' : liveState,
    labels: lod === 'building' ? liveState : 'UNAVAILABLE',
  }
}

function rateLimitedFromCache(
  representative: TerraUrbanTileKey,
  bounds: ReturnType<typeof tileBounds>,
  cached: TerraUrbanTilePayload | null,
  message: string,
): TerraUrbanTilePayload {
  const retryAfterMs = readOverpassBackoffRemainingMs()
  if (cached && hasUsableUrbanGeometry(cached)) {
    return {
      ...asStaleUrbanPayload(cached, message, retryAfterMs),
      bounds,
    }
  }
  return {
    ...emptyUrbanTile(representative, 'RATE_LIMITED', message),
    bounds,
    diagnostics: rateLimitedDiagnostics(representative.lod),
    retryAfterMs,
    rateLimited: true,
  }
}

export function mergeUrbanTileKeys(keys: TerraUrbanTileKey[]): { z: number; lod: TerraUrbanLod; bounds: ReturnType<typeof tileBounds> } | null {
  if (keys.length === 0) return null
  const lod = keys[0].lod
  const z = keys[0].z
  if (keys.some(key => key.lod !== lod || key.z !== z)) return null
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const key of keys) {
    const bounds = tileBounds(key.z, key.x, key.y)
    west = Math.min(west, bounds.west)
    south = Math.min(south, bounds.south)
    east = Math.max(east, bounds.east)
    north = Math.max(north, bounds.north)
  }
  return { z, lod, bounds: { west, south, east, north } }
}

async function fetchAndNormalize(
  cacheKey: string,
  representative: TerraUrbanTileKey,
  bounds: ReturnType<typeof tileBounds>,
  cached: TerraUrbanTilePayload | null,
): Promise<TerraUrbanTilePayload> {
  const result = await fetchUrbanOverpassTile(bounds, representative.lod)
  if (!result.ok) {
    if (isRateLimitedStatus(result.status)) {
      noteOverpassRateLimit(result.retryAfterMs)
      return rateLimitedFromCache(
        representative,
        bounds,
        cached,
        `${result.message}. Serving prior geometry when available; retry suppressed.`,
      )
    }
    const failed = {
      ...emptyUrbanTile(representative, 'UNAVAILABLE', result.message),
      bounds,
    }
    writeUrbanTileCache(cacheKey, failed, TERRA_URBAN_ERROR_TTL_MS)
    return failed
  }

  noteOverpassSuccess()
  const geometry = normalizeOverpassUrbanGeometry(result.response, representative.lod)
  const liveState: TerraUrbanDiagnosticState = geometry.truncated ? 'DEGRADED' : 'LIVE'
  const payload: TerraUrbanTilePayload = {
    version: TERRA_URBAN_TILE_VERSION,
    source: TERRA_URBAN_SOURCE,
    license: TERRA_URBAN_LICENSE,
    attribution: TERRA_URBAN_ATTRIBUTION,
    key: representative,
    bounds,
    fetchedAt: new Date().toISOString(),
    fromCache: false,
    truncated: geometry.truncated,
    roads: geometry.roads,
    buildings: geometry.buildings,
    labels: geometry.labels,
    diagnostics: withGeometryDiagnostics(representative.lod, liveState),
    error: geometry.truncated ? 'Viewport truncated to object cap.' : null,
    rateLimited: false,
    retryAfterMs: null,
  }
  writeUrbanTileCache(cacheKey, payload)
  return payload
}

export async function loadUrbanViewport(keys: TerraUrbanTileKey[]): Promise<TerraUrbanTilePayload> {
  if (keys.length === 0) {
    return emptyUrbanTile({ z: 0, x: 0, y: 0, lod: 'city' }, 'UNAVAILABLE', 'No urban tiles in view.')
  }
  const sorted = [...keys].sort((a, b) => a.x - b.x || a.y - b.y)
  const representative = sorted[0]
  const cacheKey = urbanTileCacheKey(
    { z: representative.z, x: sorted[0].x, y: sorted[0].y, lod: representative.lod },
    `${TERRA_URBAN_TILE_VERSION}:view:${sorted.map(key => `${key.x}/${key.y}`).join(',')}`,
  )
  const record = readUrbanTileCacheRecord(cacheKey)
  if (record?.freshness === 'FRESH') return asCachedUrbanPayload(record.payload)

  const merged = mergeUrbanTileKeys(sorted)
  if (!merged) return emptyUrbanTile(representative, 'UNAVAILABLE', 'Mixed urban tile set rejected.')

  if (isOverpassBackedOff()) {
    return rateLimitedFromCache(
      representative,
      merged.bounds,
      record?.payload ?? null,
      `Overpass retry suppressed for ${Math.ceil(readOverpassBackoffRemainingMs() / 1000)}s.`,
    )
  }

  try {
    return await urbanCoordinator.run(cacheKey, () => fetchAndNormalize(
      cacheKey,
      representative,
      merged.bounds,
      record?.payload ?? null,
    ))
  } catch (error) {
    if (isUrbanRequestSuperseded(error)) {
      return emptyUrbanTile(representative, 'UNAVAILABLE', 'Viewport superseded by a newer camera settle.')
    }
    throw error
  }
}

export async function loadUrbanTile(key: TerraUrbanTileKey): Promise<TerraUrbanTilePayload> {
  const cacheKey = urbanTileCacheKey(key, TERRA_URBAN_TILE_VERSION)
  const record = readUrbanTileCacheRecord(cacheKey)
  if (record?.freshness === 'FRESH') return asCachedUrbanPayload(record.payload)

  const bounds = tileBounds(key.z, key.x, key.y)
  if (isOverpassBackedOff()) {
    return rateLimitedFromCache(key, bounds, record?.payload ?? null, `Overpass retry suppressed for ${Math.ceil(readOverpassBackoffRemainingMs() / 1000)}s.`)
  }

  try {
    return await urbanCoordinator.run(cacheKey, () => fetchAndNormalize(cacheKey, key, bounds, record?.payload ?? null))
  } catch (error) {
    if (isUrbanRequestSuperseded(error)) {
      return emptyUrbanTile(key, 'UNAVAILABLE', 'Tile request superseded by a newer viewport.')
    }
    throw error
  }
}
