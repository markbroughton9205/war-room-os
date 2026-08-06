import { getGibsLayer } from '@/lib/earth-intelligence/gibsLayers'

/**
 * Public NASA GIBS WMTS REST base URL (epsg3857, "best available" endpoint).
 * GIBS documents this as a public, unauthenticated endpoint — it takes no API
 * key. This constant is safe to ship to the browser. It intentionally mirrors
 * the value of the server-side NASA_GIBS_WMTS_BASE_URL env var (see
 * lib/earth-intelligence/gibsServerConfig.ts) without reading that env var
 * into client code. This is the only host any tile request in this module
 * can ever be built against — nothing here accepts a caller-supplied host.
 */
export const PUBLIC_GIBS_WMTS_BASE_URL = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/'

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return false
  return parsed.toISOString().slice(0, 10) === value
}

export function todayUtcIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Broad request-safety floor only — NOT a claim that every registered layer
 * has imagery starting on this date. Individual layers' actual known-good
 * dates live in the registry (`GibsLayerDefinition.defaultDate`), which
 * remains the source of truth for "what date should this layer show by
 * default." This constant exists solely to reject nonsense input (e.g. a
 * date centuries before any Earth-observation satellite existed) before it
 * ever reaches a network request — GIBS itself is the authority on whether
 * imagery exists for any specific in-range date, surfaced to the user via a
 * failed tile load, not precomputed here.
 */
export const EARLIEST_PLAUSIBLE_GIBS_DATE = '2000-01-01'

export function isRequestableIsoDate(value: string): boolean {
  if (!isValidIsoDate(value)) return false
  return value >= EARLIEST_PLAUSIBLE_GIBS_DATE && value <= todayUtcIsoDate()
}

/**
 * Builds a Leaflet-compatible tile URL template (literal {z}/{y}/{x}
 * placeholders) for a raster GIBS layer on a given date. GIBS' WMTS REST
 * tiling order is TileMatrix/TileRow/TileCol, which is exactly z/y/x — no
 * reprojection needed.
 *
 * Registry boundary: callers pass a registered layer ID, never a layer
 * object or raw identifier/format/host/path fragment. The identifier,
 * format, extension and TileMatrixSet are resolved exclusively from
 * `GIBS_LAYERS` (see gibsLayers.ts) — an unknown ID fails closed. Combined
 * with `isRequestableIsoDate`'s strict YYYY-MM-DD validation, no caller
 * input can inject an arbitrary host, path component, or file extension
 * into the resulting URL.
 */
export function buildGibsTileUrlTemplate(layerId: string, isoDate: string): string {
  const layer = getGibsLayer(layerId)
  if (!layer) {
    throw new Error('Unknown GIBS layer id')
  }
  if (layer.status !== 'available' || !layer.tileFormat || !layer.tileMatrixSet) {
    throw new Error(`GIBS layer "${layerId}" is not renderable as a raster tile layer`)
  }
  if (!isRequestableIsoDate(isoDate)) {
    throw new Error('Invalid date for GIBS tile request')
  }
  return `${PUBLIC_GIBS_WMTS_BASE_URL}${encodeURIComponent(layer.identifier)}/default/${isoDate}/${layer.tileMatrixSet}/{z}/{y}/{x}.${layer.tileFormat}`
}
