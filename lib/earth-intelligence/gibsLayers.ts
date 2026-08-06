/**
 * Curated Phase 1 NASA GIBS layer registry for the /earth-intelligence route.
 *
 * This is a small, hand-verified subset of GIBS' catalog — not a client of the
 * full WMTS GetCapabilities document (~69k lines). Values below (format,
 * TileMatrixSet, native zoom, legend URLs) were confirmed against GIBS'
 * published epsg3857 "best" capabilities at implementation time. If NASA
 * changes a layer's identifier or tiling scheme, this registry must be
 * updated by hand — it will not pick up upstream catalog changes automatically.
 */

export type GibsTileFormat = 'jpg' | 'png'

export type GibsTemporalResolution = 'daily' | '8-day-composite' | 'annual'

export type GibsLayerStatus = 'available' | 'unavailable'

export interface GibsLayerDefinition {
  /** Stable key used in the UI and URL state — not the GIBS identifier. */
  id: string
  label: string
  /** Exact GIBS WMTS layer identifier. */
  identifier: string
  description: string
  /** Plain-language caveat shown near the layer name, if any. */
  caveat?: string
  status: GibsLayerStatus
  /** Present only when status === 'unavailable'. */
  unavailableReason?: string
  tileFormat?: GibsTileFormat
  /** GIBS TileMatrixSet name for the epsg3857 "best" endpoint. */
  tileMatrixSet?: string
  /** Native max zoom implied by the TileMatrixSet (e.g. Level9 -> 9). */
  maxNativeZoom?: number
  temporalResolution?: GibsTemporalResolution
  /** ISO YYYY-MM-DD default date GIBS itself advertises for this layer. */
  defaultDate?: string
  /** Horizontal legend image published by GIBS, if any. */
  legendUrl?: string
  isBaseLayer?: boolean
}

export const GIBS_LAYERS: GibsLayerDefinition[] = [
  {
    id: 'true-color',
    label: 'True Color',
    identifier: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
    description:
      'Natural-color daily imagery from the VIIRS instrument aboard NOAA-20, approximating what the human eye would see from orbit.',
    status: 'available',
    tileFormat: 'jpg',
    tileMatrixSet: 'GoogleMapsCompatible_Level9',
    maxNativeZoom: 9,
    temporalResolution: 'daily',
    defaultDate: '2026-08-06',
    isBaseLayer: true,
  },
  {
    id: 'fires',
    label: 'Fires',
    identifier: 'MODIS_Combined_Thermal_Anomalies_Day',
    description: 'Daily thermal anomalies and active fire detections from MODIS.',
    status: 'unavailable',
    unavailableReason:
      'GIBS serves this layer as Mapbox Vector Tiles (application/vnd.mapbox-vector-tile), not raster imagery. The Phase 1 map uses a plain Leaflet raster tile layer with no vector-tile renderer, so this layer cannot be displayed without adding a new client dependency (e.g. MapLibre GL or a Leaflet vector-tile plugin) in a later phase. It is listed here for visibility, not rendered.',
    temporalResolution: 'daily',
    defaultDate: '2026-08-05',
  },
  {
    id: 'aerosol',
    label: 'Aerosol / Smoke Conditions',
    identifier: 'MODIS_Combined_Value_Added_AOD',
    description:
      'Aerosol Optical Depth (AOD) — how much sunlight is scattered or absorbed by airborne particles such as smoke, dust, haze, and pollution. Higher values indicate hazier conditions.',
    caveat: 'This is an atmospheric optical measurement, not a definitive smoke detection or air-quality classification.',
    status: 'available',
    tileFormat: 'png',
    tileMatrixSet: 'GoogleMapsCompatible_Level6',
    maxNativeZoom: 6,
    temporalResolution: 'daily',
    defaultDate: '2026-08-04',
    legendUrl: 'https://gibs.earthdata.nasa.gov/legends/MODIS_Combined_Value_Added_AOD_H.svg',
  },
  {
    id: 'cloud-top-height',
    label: 'Cloud Top Height',
    identifier: 'VIIRS_NOAA20_Cloud_Top_Height_Day',
    description: 'Estimated cloud-top altitude derived from VIIRS/NOAA-20 infrared measurements.',
    caveat: 'Provided for situational awareness only — not an official storm warning or aviation weather product.',
    status: 'available',
    tileFormat: 'png',
    tileMatrixSet: 'GoogleMapsCompatible_Level7',
    maxNativeZoom: 7,
    temporalResolution: 'daily',
    defaultDate: '2026-08-04',
    legendUrl: 'https://gibs.earthdata.nasa.gov/legends/MODIS_VIIRS_Cloud_Top_Height_H.svg',
  },
  {
    id: 'flood',
    label: 'Flood Detection',
    identifier: 'VIIRS_Combined_Flood_1-Day',
    description: 'Near-real-time flood-water detection derived from VIIRS observations, updated on a rolling 1-day basis.',
    caveat: 'Coverage and accuracy vary with cloud cover and terrain.',
    status: 'available',
    tileFormat: 'png',
    tileMatrixSet: 'GoogleMapsCompatible_Level9',
    maxNativeZoom: 9,
    temporalResolution: 'daily',
    defaultDate: '2026-08-05',
    legendUrl: 'https://gibs.earthdata.nasa.gov/legends/MODIS_Flood_H.svg',
  },
  {
    id: 'ndvi',
    label: 'Vegetation Health',
    identifier: 'VIIRS_NOAA20_NDVI_8Day',
    description:
      'Normalized Difference Vegetation Index (NDVI), composited over 8-day periods — a proxy for vegetation greenness and photosynthetic activity.',
    status: 'available',
    tileFormat: 'png',
    tileMatrixSet: 'GoogleMapsCompatible_Level8',
    maxNativeZoom: 8,
    temporalResolution: '8-day-composite',
    defaultDate: '2026-08-04',
    legendUrl: 'https://gibs.earthdata.nasa.gov/legends/MODIS_NDVI_H.svg',
  },
  {
    id: 'snow',
    label: 'Snow Cover',
    identifier: 'VIIRS_NOAA20_NDSI_Snow_Cover',
    description: 'Normalized Difference Snow Index (NDSI) based snow-cover fraction.',
    status: 'available',
    tileFormat: 'png',
    tileMatrixSet: 'GoogleMapsCompatible_Level8',
    maxNativeZoom: 8,
    temporalResolution: 'daily',
    defaultDate: '2026-08-06',
    legendUrl: 'https://gibs.earthdata.nasa.gov/legends/MODIS_NDSI_Snow_Cover_H.svg',
  },
  {
    id: 'night-lights',
    label: 'Night Lights',
    identifier: 'VIIRS_Night_Lights',
    description:
      'Annual composite of nighttime light emissions, useful for observing human settlement, infrastructure, and power-availability patterns.',
    caveat: 'This is a yearly composite, not a live or daily feed.',
    status: 'available',
    tileFormat: 'png',
    tileMatrixSet: 'GoogleMapsCompatible_Level8',
    maxNativeZoom: 8,
    temporalResolution: 'annual',
    defaultDate: '2016-01-01',
  },
  {
    id: 'surface-air-temp',
    label: 'Surface Air Temperature',
    identifier: 'AIRS_L3_Surface_Air_Temperature_Daily_Night',
    description: 'Nighttime surface air temperature from the AIRS instrument, Level-3 daily gridded product.',
    status: 'available',
    tileFormat: 'png',
    tileMatrixSet: 'GoogleMapsCompatible_Level6',
    maxNativeZoom: 6,
    temporalResolution: 'daily',
    defaultDate: '2026-07-28',
    legendUrl: 'https://gibs.earthdata.nasa.gov/legends/AIRS_Surface_Air_Temperature_Daily_Night_H.svg',
  },
]

export function getGibsLayer(id: string): GibsLayerDefinition | undefined {
  return GIBS_LAYERS.find(layer => layer.id === id)
}

export const DEFAULT_GIBS_LAYER_ID = 'true-color'
