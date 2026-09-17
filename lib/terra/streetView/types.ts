/**
 * Lawful public street-level imagery for Terra STREET VIEW.
 * Mapillary + Panoramax only. Never Google Street View. Never a fabricated panorama.
 */
export const STREET_VIEW_PROVIDERS = ['MAPILLARY', 'PANORAMAX'] as const
export type StreetViewProviderId = (typeof STREET_VIEW_PROVIDERS)[number]

export const STREET_VIEW_STATES = [
  'AVAILABLE',
  'NO_COVERAGE',
  'AUTH_REQUIRED',
  'PROVIDER_AUTH_REQUIRED',
  'UNAVAILABLE',
  'ERROR_UPSTREAM',
] as const
export type StreetViewState = (typeof STREET_VIEW_STATES)[number]

export const STREET_VIEW_GOOGLE_FORBIDDEN = true
export const STREET_VIEW_FABRICATE_FORBIDDEN = true
export const STREET_VIEW_PUBLIC_PANORAMAX_BASE = 'https://api.panoramax.xyz'
export const STREET_VIEW_DEFAULT_RADIUS_METERS = 80
export const STREET_VIEW_MAX_RADIUS_METERS = 250
export const STREET_VIEW_MAX_ITEMS = 12

export type StreetViewAuthModel =
  | 'NONE'
  | 'MAPILLARY_OAUTH_CLIENT_TOKEN'
  | 'PANORAMAX_PUBLIC'
  | 'PANORAMAX_INSTANCE'

export type StreetViewItem = {
  id: string
  provider: StreetViewProviderId
  latitude: number
  longitude: number
  headingDeg: number | null
  capturedAt: string | null
  distanceMeters: number
  imageUrl: string | null
  thumbUrl: string | null
  viewerUrl: string | null
  sourceUrl: string | null
  license: string
  attribution: string
  sequenceId: string | null
  hasPrevious: boolean
  hasNext: boolean
  canTurn: boolean
  authModel: StreetViewAuthModel
}

export type StreetViewProviderAttempt = {
  provider: StreetViewProviderId
  state: StreetViewState
  authModel: StreetViewAuthModel
  itemCount: number
  honesty: string
}

export type StreetViewLookupQuery = {
  latitude: number
  longitude: number
  radiusMeters: number
}

export type StreetViewLookupResult = {
  ok: true
  state: StreetViewState
  query: StreetViewLookupQuery
  items: StreetViewItem[]
  activeIndex: number
  providersAttempted: StreetViewProviderAttempt[]
  nominatimUsed: false
  googleUsed: false
  fabricated: false
  honesty: string
}

export type StreetViewLookupError = {
  ok: false
  state: Extract<StreetViewState, 'UNAVAILABLE' | 'ERROR_UPSTREAM' | 'AUTH_REQUIRED'>
  query: StreetViewLookupQuery
  items: []
  nominatimUsed: false
  googleUsed: false
  fabricated: false
  honesty: string
}

export type StreetViewOriginContext = 'LOCATION' | 'BUILDING' | 'GROUND' | 'CAMERA' | 'AREA_LIVE'

export type StreetViewOrigin = {
  latitude: number
  longitude: number
  label: string
  context: StreetViewOriginContext
}
