/**
 * One active Terra geographic-context object.
 * Device GPS and the Commander's explored Terra location stay distinct.
 * Coordinates are never invented. No numeric confidence is attached.
 */
import type { TerraDegreeRectangle } from './aircraftBoundingBox'
import type { TerraActiveLocation, TerraContextType } from './activeLocation'
import type { GodsEyeZoomRung } from './godsEye/zoomLadder'

export type { TerraContextType }
export { TERRA_CONTEXT_TYPES } from './activeLocation'

export type TerraGeographicContext = {
  lat: number
  lon: number
  bbox: TerraDegreeRectangle | null
  zoomLevel: GodsEyeZoomRung
  placeName: string | null
  nativePlaceName: string | null
  city: string | null
  county: string | null
  state: string | null
  country: string | null
  countryCode: string | null
  accuracyMeters: number | null
  contextType: TerraContextType
  source: TerraActiveLocation['source'] | 'device-geolocation'
}

export const US_STATE_ABBREVIATIONS: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO',
  Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH',
  Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
  'District of Columbia': 'DC',
}

const PLACE_STOPWORDS = new Set([
  'county', 'district', 'township', 'parish', 'borough', 'city', 'town', 'village',
  'municipality', 'prefecture', 'province', 'region', 'state', 'territory',
  'of', 'the', 'and', 'gps', 'position', 'nearby', 'united',
])

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const sinLat = Math.sin(dLat / 2)
  const sinLon = Math.sin(dLon / 2)
  const h = sinLat * sinLat + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLon * sinLon
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)))
}

export function rectangleCenter(bbox: TerraDegreeRectangle | null): { latitude: number; longitude: number } | null {
  if (!bbox) return null
  const { west, south, east, north } = bbox
  if (![west, south, east, north].every(Number.isFinite)) return null
  return { latitude: (south + north) / 2, longitude: (west + east) / 2 }
}

export function pointInRectangle(lat: number, lon: number, bbox: TerraDegreeRectangle | null): boolean {
  if (!bbox) return false
  return lon >= bbox.west && lon <= bbox.east && lat >= bbox.south && lat <= bbox.north
}

export function compactLocalLabel(input: {
  city?: string | null
  county?: string | null
  state?: string | null
  countryCode?: string | null
  placeName?: string | null
}): string | null {
  const city = input.city?.trim() || null
  const county = input.county?.trim() || null
  const state = input.state?.trim() || null
  const code = input.countryCode?.trim().toUpperCase() || null
  const abbr = state ? (US_STATE_ABBREVIATIONS[state] ?? (/^[A-Za-z]{2,3}$/.test(state) ? state.toUpperCase() : null)) : null
  if (city && abbr) return `${city.toUpperCase()}, ${abbr}`
  if (city && code && ['GB', 'JP', 'ZA', 'FR', 'CA', 'AU'].includes(code)) return city.toUpperCase()
  if (city && code) return `${city.toUpperCase()}, ${code}`
  if (county && abbr) return `${county.toUpperCase()}, ${abbr}`
  if (city) return city.toUpperCase()
  if (state && code) return `${state.toUpperCase()}, ${code}`
  const place = input.placeName?.trim()
  if (place && !/^GPS\b/i.test(place) && !/^-?\d+(\.\d+)?°/.test(place)) {
    const first = place.split(',')[0]?.trim()
    if (first) return first.toUpperCase()
  }
  return null
}

export function isDeviceOnlyPlaceLabel(label: string | null | undefined): boolean {
  if (!label?.trim()) return true
  return /^GPS\b/i.test(label) || /^-?\d+(\.\d+)?°/.test(label.trim())
}

export function significantPlaceTokens(text: string | null | undefined): string[] {
  if (!text?.trim()) return []
  const tokens = text
    .toLowerCase()
    .split(/[\s,/|–—()-]+/)
    .map(part => part.replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff'-]/gi, ''))
    .filter(part => part.length >= 3 && !PLACE_STOPWORDS.has(part) && !/^\d+$/.test(part))
  return [...new Set(tokens)]
}

export function viewportMoveThresholdDeg(zoom: GodsEyeZoomRung): number {
  if (zoom === 'PLANET') return 8
  if (zoom === 'COUNTRY') return 1.4
  if (zoom === 'CITY') return 0.18
  if (zoom === 'NEIGHBORHOOD') return 0.045
  return 0.012
}

export function contextMovedMaterially(
  previous: { lat: number; lon: number; zoomLevel?: GodsEyeZoomRung | null } | null,
  next: { lat: number; lon: number; zoomLevel: GodsEyeZoomRung },
): boolean {
  if (!previous) return true
  if (previous.zoomLevel && previous.zoomLevel !== next.zoomLevel) return true
  const threshold = viewportMoveThresholdDeg(next.zoomLevel)
  return Math.abs(previous.lat - next.lat) >= threshold || Math.abs(previous.lon - next.lon) >= threshold
}

export function followSuspendDistanceKm(zoom: GodsEyeZoomRung): number {
  if (zoom === 'PLANET' || zoom === 'COUNTRY') return 80
  if (zoom === 'CITY') return 8
  if (zoom === 'NEIGHBORHOOD') return 3
  return 1.2
}

export function geographicCellKey(lat: number, lon: number, zoom: GodsEyeZoomRung): string {
  const step = zoom === 'PLANET' ? 4 : zoom === 'COUNTRY' ? 1 : zoom === 'CITY' ? 0.2 : zoom === 'NEIGHBORHOOD' ? 0.05 : 0.02
  const snap = (value: number) => (Math.round(value / step) * step).toFixed(3)
  return `${zoom}:${snap(lat)}:${snap(lon)}`
}

export function contextFromActiveLocation(
  location: TerraActiveLocation,
  extras?: {
    bbox?: TerraDegreeRectangle | null
    zoomLevel?: GodsEyeZoomRung | null
  },
): TerraGeographicContext {
  return {
    lat: location.latitude,
    lon: location.longitude,
    bbox: extras?.bbox ?? location.bbox ?? null,
    zoomLevel: extras?.zoomLevel ?? location.zoomLevel ?? 'CITY',
    placeName: location.place ?? location.label,
    nativePlaceName: location.nativePlaceName,
    city: location.city ?? null,
    county: location.county ?? null,
    state: location.state ?? null,
    country: location.country ?? null,
    countryCode: location.countryCode ?? null,
    accuracyMeters: location.accuracyMeters ?? null,
    contextType: location.contextType ?? (location.source === 'nominatim' ? 'CLICK' : 'CLICK'),
    source: location.contextType === 'GPS' ? 'device-geolocation' : location.source,
  }
}
