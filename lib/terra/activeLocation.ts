import type { TerraDegreeRectangle } from './aircraftBoundingBox'
import type { GodsEyeZoomRung } from './godsEye/zoomLadder'
import type { TerraAddressMatchQuality } from './geocodeMatchQuality'

export const TERRA_CONTEXT_TYPES = [
  'GPS',
  'SEARCH',
  'FLY_TO',
  'CLICK',
  'CAMERA',
  'EVENT',
  'VIEWPORT',
  'HANDOFF',
  'COORDINATE',
] as const
export type TerraContextType = (typeof TERRA_CONTEXT_TYPES)[number]

export type TerraLocationResolutionStatus = 'resolving' | 'resolved' | 'coordinate_only'
export type TerraLocationConfidence = 'provider_supported' | 'coordinate_only'

/** One semantic location context shared by Terra UI, typed commands, and future Council adapters. */
export type TerraActiveLocation = {
  latitude: number
  longitude: number
  height: number | null
  hasTerrainHeight: boolean
  label: string
  place: string | null
  address: string | null
  region: string | null
  source: 'coordinates' | 'nominatim' | 'open_meteo' | 'geonames'
  sourceLabel: string
  sourceUrl: string | null
  nativePlaceName: string | null
  englishPlaceName: string | null
  status: TerraLocationResolutionStatus
  confidence: TerraLocationConfidence
  detail: string
  selectedAt: string
  contextType?: TerraContextType
  city?: string | null
  county?: string | null
  state?: string | null
  country?: string | null
  countryCode?: string | null
  accuracyMeters?: number | null
  bbox?: TerraDegreeRectangle | null
  zoomLevel?: GodsEyeZoomRung | null
  /** Original Commander search string when contextType is SEARCH. */
  searchQuery?: string | null
  jurisdictionType?: 'city' | 'county' | 'state' | 'country' | 'coordinates' | null
  /** Reverse-geocoded locality (ward/township) — never the LOCAL query jurisdiction by itself. */
  locality?: string | null
  reverseNeighborhood?: string | null
  reverseWard?: string | null
  reverseTownship?: string | null
  reverseMunicipality?: string | null
  /** Sublocality reverse-geocode may show (ward/township) without replacing LOCAL city/county. */
  reverseSublocalityLabel?: string | null
  reverseGeocodeStatus?: 'ok' | 'pending' | 'stale' | 'unavailable'
  /** Honest JUMP/GO match quality. Never ROOFTOP for a street centroid. */
  matchQuality?: TerraAddressMatchQuality | null
  houseNumber?: string | null
  road?: string | null
  postcode?: string | null
  precisionSource?: string | null
  enrichmentState?: import('./placePrecision/matchClass').TerraEnrichmentState | null
  geometryType?: 'point' | 'polygon' | 'polyline' | 'bbox' | null
}

export type TerraReverseLocationResolution =
  | { status: 'resolved'; location: TerraActiveLocation }
  | { status: 'coordinate_only'; location: TerraActiveLocation }
