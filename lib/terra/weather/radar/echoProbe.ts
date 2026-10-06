/**
 * Server-side echo probe. The N0Q mosaic renders fully transparent where the radar network
 * measured no significant return, so counting non-transparent pixels in the tiles that cover the
 * current view is a real measurement — it is what lets Terra say NO_PRECIP instead of guessing.
 *
 * Bounded by design: a handful of already-published tiles per probe, no archival, no re-hosting.
 */

import { inflateSync } from 'node:zlib'
import type { TerraDegreeRectangle } from '@/lib/terra/aircraftBoundingBox'
import { ridgeTileUrlTemplate } from './frames'
import { RADAR_MAX_TILE_LEVEL } from './types'

/** Never issue more than this many upstream tile requests for a single probe. */
export const RADAR_ECHO_MAX_TILES = 4
export const RADAR_ECHO_MIN_ZOOM = 2
export const RADAR_ECHO_TILE_TIMEOUT_MS = 6_000
/** Alpha at or below this is treated as transparent (no measured echo). */
export const RADAR_ECHO_ALPHA_FLOOR = 8

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export type RadarTileRef = { z: number; x: number; y: number }

export function lonToTileX(lon: number, z: number): number {
  const n = 2 ** z
  return Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)))
}

export function latToTileY(lat: number, z: number): number {
  const n = 2 ** z
  const clamped = Math.min(85.0511, Math.max(-85.0511, lat))
  const rad = (clamped * Math.PI) / 180
  const value = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2
  return Math.min(n - 1, Math.max(0, Math.floor(value * n)))
}

/**
 * Pick the deepest zoom whose tile footprint over the view still fits the request budget, so a
 * continental view probes a couple of coarse tiles instead of hundreds of street-level ones.
 */
export function radarEchoTilesForView(
  view: TerraDegreeRectangle,
  maxTiles = RADAR_ECHO_MAX_TILES,
  maxZoom = RADAR_MAX_TILE_LEVEL,
): RadarTileRef[] {
  for (let z = Math.min(maxZoom, RADAR_MAX_TILE_LEVEL); z >= RADAR_ECHO_MIN_ZOOM; z -= 1) {
    const x0 = lonToTileX(Math.min(view.west, view.east), z)
    const x1 = lonToTileX(Math.max(view.west, view.east), z)
    // Tile Y grows southward, so the northern edge yields the smaller index.
    const y0 = latToTileY(Math.max(view.south, view.north), z)
    const y1 = latToTileY(Math.min(view.south, view.north), z)
    const count = (x1 - x0 + 1) * (y1 - y0 + 1)
    if (count <= maxTiles) {
      const tiles: RadarTileRef[] = []
      for (let x = x0; x <= x1; x += 1) {
        for (let y = y0; y <= y1; y += 1) tiles.push({ z, x, y })
      }
      return tiles
    }
  }
  const z = RADAR_ECHO_MIN_ZOOM
  return [{ z, x: lonToTileX(view.west, z), y: latToTileY(view.north, z) }]
}

export function radarEchoTileUrl(iemStamp: string, tile: RadarTileRef): string {
  return ridgeTileUrlTemplate(iemStamp)
    .replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y))
}

type PngHeader = { width: number; height: number; bitDepth: number; colorType: number; interlace: number }

function unfilter(raw: Buffer, width: number, height: number, bytesPerPixel: number): Buffer | null {
  const stride = width * bytesPerPixel
  if (raw.length < (stride + 1) * height) return null
  const out = Buffer.alloc(stride * height)
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)]
    const src = row * (stride + 1) + 1
    const dst = row * stride
    const prev = dst - stride
    for (let i = 0; i < stride; i += 1) {
      const x = raw[src + i] ?? 0
      const a = i >= bytesPerPixel ? (out[dst + i - bytesPerPixel] ?? 0) : 0
      const b = row > 0 ? (out[prev + i] ?? 0) : 0
      const c = row > 0 && i >= bytesPerPixel ? (out[prev + i - bytesPerPixel] ?? 0) : 0
      let value: number
      if (filter === 0) value = x
      else if (filter === 1) value = x + a
      else if (filter === 2) value = x + b
      else if (filter === 3) value = x + ((a + b) >> 1)
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        value = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      } else return null
      out[dst + i] = value & 0xff
    }
  }
  return out
}

/**
 * Minimal RGBA8 PNG reader for the tiles IEM actually publishes (8-bit truecolour+alpha,
 * non-interlaced). Anything else returns null so the caller reports UNDETERMINED instead of
 * inventing a reading.
 */
export function measureTileEchoPixels(bytes: Buffer): { total: number; echo: number } | null {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  let offset = 8
  let header: PngHeader | null = null
  const idat: Buffer[] = []
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii')
    const dataStart = offset + 8
    if (dataStart + length > bytes.length) return null
    if (type === 'IHDR') {
      header = {
        width: bytes.readUInt32BE(dataStart),
        height: bytes.readUInt32BE(dataStart + 4),
        bitDepth: bytes[dataStart + 8] ?? 0,
        colorType: bytes[dataStart + 9] ?? 0,
        interlace: bytes[dataStart + 12] ?? 0,
      }
    } else if (type === 'IDAT') {
      idat.push(bytes.subarray(dataStart, dataStart + length))
    } else if (type === 'IEND') {
      break
    }
    offset = dataStart + length + 4
  }
  if (!header || !idat.length) return null
  if (header.bitDepth !== 8 || header.colorType !== 6 || header.interlace !== 0) return null
  if (header.width <= 0 || header.height <= 0) return null

  let raw: Buffer
  try {
    raw = inflateSync(Buffer.concat(idat))
  } catch {
    return null
  }
  const pixels = unfilter(raw, header.width, header.height, 4)
  if (!pixels) return null

  let echo = 0
  const total = header.width * header.height
  for (let i = 3; i < pixels.length; i += 4) {
    if ((pixels[i] ?? 0) > RADAR_ECHO_ALPHA_FLOOR) echo += 1
  }
  return { total, echo }
}

export type RadarEchoProbeResult = {
  /** Fraction of probed pixels carrying reflectivity, or null when nothing could be measured. */
  echoFraction: number | null
  tilesRequested: number
  tilesMeasured: number
  pixelsMeasured: number
  echoPixels: number
  frameStamp: string
  note: string | null
}

export async function probeRadarEcho(input: {
  iemStamp: string
  view: TerraDegreeRectangle
  userAgent: string
  maxTiles?: number
}): Promise<RadarEchoProbeResult> {
  const tiles = radarEchoTilesForView(input.view, input.maxTiles ?? RADAR_ECHO_MAX_TILES)
  let pixelsMeasured = 0
  let echoPixels = 0
  let tilesMeasured = 0
  let note: string | null = null

  const results = await Promise.all(tiles.map(async tile => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), RADAR_ECHO_TILE_TIMEOUT_MS)
    try {
      const response = await fetch(radarEchoTileUrl(input.iemStamp, tile), {
        headers: { Accept: 'image/png', 'User-Agent': input.userAgent },
        signal: controller.signal,
        cache: 'no-store',
      })
      if (response.status === 429) return { rateLimited: true as const }
      if (!response.ok) return { missing: true as const }
      const buffer = Buffer.from(await response.arrayBuffer())
      return { measured: measureTileEchoPixels(buffer) }
    } catch {
      return { missing: true as const }
    } finally {
      clearTimeout(timer)
    }
  }))

  for (const result of results) {
    if ('rateLimited' in result) {
      note = 'Provider rate limited the tile probe.'
      continue
    }
    if ('missing' in result || !('measured' in result) || !result.measured) continue
    tilesMeasured += 1
    pixelsMeasured += result.measured.total
    echoPixels += result.measured.echo
  }

  return {
    echoFraction: pixelsMeasured > 0 ? echoPixels / pixelsMeasured : null,
    tilesRequested: tiles.length,
    tilesMeasured,
    pixelsMeasured,
    echoPixels,
    frameStamp: input.iemStamp,
    note: note ?? (tilesMeasured === 0 ? 'No mosaic tile could be decoded for this view.' : null),
  }
}
