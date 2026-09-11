/**
 * Slippy-map tile math for Terra urban geography. Viewport → bounded tile keys, never a
 * statewide extract. Pure / deterministic — no I/O.
 */
import type { TerraUrbanBounds, TerraUrbanLod, TerraUrbanTileKey } from './types'

const MAX_TILES_PER_VIEW = 9

export function lon2tile(longitude: number, z: number): number {
  const n = 2 ** z
  const wrapped = ((longitude + 180) % 360 + 360) % 360 - 180
  return Math.min(n - 1, Math.max(0, Math.floor(((wrapped + 180) / 360) * n)))
}

export function lat2tile(latitude: number, z: number): number {
  const n = 2 ** z
  const lat = Math.max(-85.05112878, Math.min(85.05112878, latitude))
  const rad = (lat * Math.PI) / 180
  return Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n)))
}

export function tileBounds(z: number, x: number, y: number): TerraUrbanBounds {
  const n = 2 ** z
  const west = (x / n) * 360 - 180
  const east = ((x + 1) / n) * 360 - 180
  const north = tileLat(y, n)
  const south = tileLat(y + 1, n)
  return { west, south, east, north }
}

function tileLat(y: number, n: number): number {
  const rad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)))
  return (rad * 180) / Math.PI
}

export function urbanTileCacheKey(key: TerraUrbanTileKey, version: string): string {
  return `terra-urban:${version}:${key.lod}:${key.z}/${key.x}/${key.y}`
}

export function urbanTileId(key: TerraUrbanTileKey): string {
  return `${key.lod}/${key.z}/${key.x}/${key.y}`
}

/**
 * Expand a viewport by a small fractional margin so panning slightly does not immediately
 * miss geometry at the edge — still a bounded neighborhood, never a state extract.
 */
export function expandBounds(bounds: TerraUrbanBounds, marginFraction = 0.12): TerraUrbanBounds {
  const lonSpan = Math.max(0.0001, bounds.east - bounds.west)
  const latSpan = Math.max(0.0001, bounds.north - bounds.south)
  const lonPad = lonSpan * marginFraction
  const latPad = latSpan * marginFraction
  return {
    west: Math.max(-180, bounds.west - lonPad),
    east: Math.min(180, bounds.east + lonPad),
    south: Math.max(-90, bounds.south - latPad),
    north: Math.min(90, bounds.north + latPad),
  }
}

export function tilesForBounds(bounds: TerraUrbanBounds, z: number, lod: TerraUrbanLod): TerraUrbanTileKey[] {
  const x0 = lon2tile(bounds.west, z)
  const x1 = lon2tile(bounds.east, z)
  const y0 = lat2tile(bounds.north, z)
  const y1 = lat2tile(bounds.south, z)
  const minX = Math.min(x0, x1)
  const maxX = Math.max(x0, x1)
  const minY = Math.min(y0, y1)
  const maxY = Math.max(y0, y1)
  const tiles: TerraUrbanTileKey[] = []
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      tiles.push({ z, x, y, lod })
    }
  }
  if (tiles.length <= MAX_TILES_PER_VIEW) return tiles
  return selectNearestTiles(tiles, bounds, MAX_TILES_PER_VIEW)
}

function selectNearestTiles(tiles: TerraUrbanTileKey[], bounds: TerraUrbanBounds, limit: number): TerraUrbanTileKey[] {
  const cx = (bounds.west + bounds.east) / 2
  const cy = (bounds.south + bounds.north) / 2
  return [...tiles]
    .sort((a, b) => {
      const ab = tileBounds(a.z, a.x, a.y)
      const bb = tileBounds(b.z, b.x, b.y)
      const ad = ((ab.west + ab.east) / 2 - cx) ** 2 + ((ab.south + ab.north) / 2 - cy) ** 2
      const bd = ((bb.west + bb.east) / 2 - cx) ** 2 + ((bb.south + bb.north) / 2 - cy) ** 2
      return ad - bd
    })
    .slice(0, limit)
}
