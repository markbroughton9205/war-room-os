export type TerraLocationTarget = {
  latitude: number
  longitude: number
  label: string
  /** Commander search string when this target came from typed location search. */
  query?: string | null
  source: 'coordinates' | 'nominatim' | 'open_meteo' | 'geonames'
  /** Nominatim's own "class/type" classification (e.g. "place/country"), verbatim — null for a
   * typed coordinate target (no resolver was involved) or when the resolver didn't supply one.
   * God's Eye multi-scale phase: display-only; camera framing prefers boundingBox when present. */
  placeType: string | null
  /** Nominatim's own result bounding box, verbatim — null for a typed coordinate target or when
   * unavailable. Lets the camera fly to a rectangle sized to the actual matched place instead of
   * one fixed altitude for every search result. */
  boundingBox: { south: number; north: number; west: number; east: number } | null
  nativeName: string | null
  englishName: string | null
  sourceUrl: string | null
  coverage: 'nominatim' | 'typed_coordinates' | 'open_meteo' | 'geonames'
  retrievedAt: string | null
  /** Commander explicitly requested an instant camera jump instead of cinematic flight. */
  instantRequested: boolean
}

export type TerraLocationResolution =
  | { status: 'resolved'; target: TerraLocationTarget }
  | { status: 'ambiguous'; message: string; matches: TerraLocationTarget[] }
  | { status: 'unresolved'; message: string }

const COORDINATE_PATTERN = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/

/** US ZIP, ZIP+4, Canadian postal, and typical UK/EU alphanumeric postcodes. Never used to
 * invent coordinates — only to prefer a unique Nominatim `postcode` candidate when the resolver
 * returns mixed nearby features. */
const US_ZIP = /^\d{5}(?:-\d{4})?$/
const CA_POSTAL = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/
const GENERIC_POSTAL = /^[A-Za-z0-9]{2,4}\s?[A-Za-z0-9]{2,4}$/

export function looksLikePostalCode(command: string): boolean {
  const text = command.trim()
  if (!text) return false
  if (US_ZIP.test(text) || CA_POSTAL.test(text)) return true
  if (text.length > 10) return false
  if (COORDINATE_PATTERN.test(text)) return false
  if (!/\d/.test(text)) return false
  return GENERIC_POSTAL.test(text)
}

export function isNominatimPostalType(placeClass: string | undefined, placeType: string | undefined): boolean {
  const type = (placeType ?? '').toLowerCase()
  const cls = (placeClass ?? '').toLowerCase()
  return type === 'postcode' || type === 'postal_code' || (cls === 'place' && type === 'postcode') || cls === 'postal_code'
}

function emptyTargetExtras(): Pick<TerraLocationTarget, 'sourceUrl' | 'coverage' | 'retrievedAt' | 'instantRequested'> {
  return {
    sourceUrl: null,
    coverage: 'typed_coordinates',
    retrievedAt: null,
    instantRequested: false,
  }
}

/** Client-safe command boundary shared by typed input today and a future voice adapter. */
export function parseTerraCoordinates(command: string): TerraLocationTarget | null {
  const match = COORDINATE_PATTERN.exec(command)
  if (!match) return null
  const latitude = Number(match[1])
  const longitude = Number(match[2])
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null
  return {
    latitude,
    longitude,
    label: `${latitude.toFixed(4)}°, ${longitude.toFixed(4)}°`,
    source: 'coordinates',
    placeType: null,
    boundingBox: null,
    nativeName: null,
    englishName: null,
    ...emptyTargetExtras(),
  }
}
