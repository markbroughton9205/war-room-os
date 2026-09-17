import type { TerraDegreeRectangle } from '@/lib/terra/aircraftBoundingBox'

/** Radar is MEASURED instrument imagery. Particles (later) are PRESENTATION ONLY. Do not mix. */
export const RADAR_TRUTH_KIND = 'MEASURED' as const

export const RADAR_PROVIDER_ID = 'iem_mesonet' as const
export const RADAR_PROVIDER_NAME = 'Iowa Environmental Mesonet / Iowa State University'
export const RADAR_PRODUCT = 'USCOMP-N0Q'
export const RADAR_PRODUCT_LABEL = 'CONUS NEXRAD mosaic N0Q (8-bit base reflectivity; IEM uses N0B source since 2022-04-18)'
export const RADAR_SITE = 'USCOMP'

export const IEM_ORIGIN = 'https://mesonet.agron.iastate.edu'
export const IEM_OGC_DOCS = `${IEM_ORIGIN}/ogc/`
export const IEM_RIDGE_DOCS = `${IEM_ORIGIN}/GIS/ridge.phtml`
export const IEM_MOSAIC_DOCS = `${IEM_ORIGIN}/docs/nexrad_mosaic/`
export const IEM_DISCLAIMER = `${IEM_ORIGIN}/disclaimer.php`
export const IEM_JSON_RADAR = `${IEM_ORIGIN}/json/radar`
export const IEM_N0Q_META = `${IEM_ORIGIN}/data/gis/images/4326/USCOMP/n0q_0.json`
export const IEM_TMS_CACHED = `${IEM_ORIGIN}/c/tile.py/1.0.0`

/**
 * IEM n0q_0.wld (0.005°, origin -126/50) plus documented N0Q mosaic size after 2014-08-08
 * (12200×5400). Honest CONUS mosaic domain — not a global radar product.
 */
export const IEM_USCOMP_COVERAGE: TerraDegreeRectangle & { basis: string } = {
  west: -126,
  south: 23,
  east: -65,
  north: 50,
  basis: 'IEM n0q_0.wld + N0Q mosaic dimensions after 2014-08-08',
}

export const DEFAULT_RADAR_OPACITY = 0.45
export const RADAR_HISTORY_MINUTES = 120
export const RADAR_METADATA_CACHE_MS = 90_000
/** Mosaic is 5-minute. IEM mosaics products within 15 minutes of runtime. */
export const RADAR_STALE_AFTER_MS = 15 * 60_000
export const RADAR_MAX_TILE_LEVEL = 8
export const RADAR_ENABLED_STORAGE_KEY = 'terra-weather-radar-enabled'

export const RADAR_ATTRIBUTION =
  'Iowa Environmental Mesonet / Iowa State University. NEXRAD from NOAA/NWS. IEM materials are public domain; attribution appreciated. This is MEASURED reflectivity, not a forecast and not alert confirmation.'

export const RADAR_COVERAGE_STATES = [
  'AVAILABLE',
  'NO_COVERAGE',
  'STALE',
  'ERROR_UPSTREAM',
  'RATE_LIMITED',
  'UNAVAILABLE',
] as const
export type RadarCoverageState = (typeof RADAR_COVERAGE_STATES)[number]

export type RadarFrame = {
  timestampIso: string
  iemStamp: string
  tileUrlTemplate: string
  source: 'n0q_meta' | 'radar_list'
}

export type RadarCatalog = {
  provider: typeof RADAR_PROVIDER_ID
  providerName: typeof RADAR_PROVIDER_NAME
  product: typeof RADAR_PRODUCT
  productLabel: typeof RADAR_PRODUCT_LABEL
  truthKind: typeof RADAR_TRUTH_KIND
  attribution: typeof RADAR_ATTRIBUTION
  docsUrl: typeof IEM_OGC_DOCS
  disclaimerUrl: typeof IEM_DISCLAIMER
  coverage: typeof IEM_USCOMP_COVERAGE
  frames: RadarFrame[]
  latest: RadarFrame | null
  retrievedAt: string
  generatedAt: string | null
  fromCache: boolean
  catalogState: Exclude<RadarCoverageState, 'NO_COVERAGE'>
  error: string | null
}
