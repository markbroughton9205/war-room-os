import { lookupMapillaryCoverage } from './mapillary'
import { lookupPanoramaxCoverage } from './panoramax'
import { selectTurnIndex } from './navigation'
import {
  STREET_VIEW_DEFAULT_RADIUS_METERS,
  STREET_VIEW_MAX_ITEMS,
  STREET_VIEW_MAX_RADIUS_METERS,
  type StreetViewItem,
  type StreetViewLookupQuery,
  type StreetViewLookupResult,
  type StreetViewProviderAttempt,
  type StreetViewState,
} from './types'

function clampRadius(radiusMeters: number | null | undefined): number {
  if (radiusMeters == null || !Number.isFinite(radiusMeters)) return STREET_VIEW_DEFAULT_RADIUS_METERS
  return Math.min(STREET_VIEW_MAX_RADIUS_METERS, Math.max(25, Math.round(radiusMeters)))
}

function decorateSequence(items: StreetViewItem[]): StreetViewItem[] {
  return items.map((item, index) => ({
    ...item,
    hasPrevious: items.length > 1,
    hasNext: items.length > 1,
    canTurn: selectTurnIndex(items, index, 'left') !== null || selectTurnIndex(items, index, 'right') !== null,
  }))
}

export function composeStreetViewState(attempts: readonly StreetViewProviderAttempt[], itemCount: number): {
  state: StreetViewState
  honesty: string
} {
  if (itemCount > 0) {
    return {
      state: 'AVAILABLE',
      honesty: 'Lawful public street-level imagery is available near the selected coordinates. Camera stills stay a separate evidence stream.',
    }
  }
  const panoramax = attempts.find(row => row.provider === 'PANORAMAX')
  const mapillary = attempts.find(row => row.provider === 'MAPILLARY')
  const upstream = attempts.filter(row => row.state === 'ERROR_UPSTREAM')
  if (upstream.length > 0 && !attempts.some(row => row.state === 'NO_COVERAGE' || row.state === 'PROVIDER_AUTH_REQUIRED' || row.state === 'AVAILABLE')) {
    return { state: 'ERROR_UPSTREAM', honesty: 'Street-view providers failed upstream. No panorama was fabricated.' }
  }
  if (upstream.length === attempts.length) {
    return { state: 'ERROR_UPSTREAM', honesty: 'Street-view providers failed upstream. No panorama was fabricated.' }
  }
  if (mapillary?.state === 'PROVIDER_AUTH_REQUIRED' && (panoramax?.state === 'NO_COVERAGE' || !panoramax)) {
    return {
      state: 'NO_COVERAGE',
      honesty: 'No public Panoramax coverage at this coordinate. Mapillary is PROVIDER_AUTH_REQUIRED without a client token. STREET VIEW / NO PUBLIC COVERAGE. No Google Street View.',
    }
  }
  if (attempts.some(row => row.state === 'ERROR_UPSTREAM') && itemCount === 0 && panoramax?.state !== 'NO_COVERAGE') {
    return { state: 'ERROR_UPSTREAM', honesty: 'A street-view provider failed upstream. No panorama was fabricated.' }
  }
  if (panoramax?.state === 'UNAVAILABLE' && mapillary?.state === 'PROVIDER_AUTH_REQUIRED') {
    return { state: 'UNAVAILABLE', honesty: 'No lawful street-view provider is ready. Mapillary needs a client token. No Google scraping.' }
  }
  return {
    state: 'NO_COVERAGE',
    honesty: 'No public street-level imagery at this coordinate. STREET VIEW / NO PUBLIC COVERAGE. Terra did not fabricate a panorama.',
  }
}

export async function lookupStreetView(input: {
  latitude: number
  longitude: number
  radiusMeters?: number
}): Promise<StreetViewLookupResult> {
  const query: StreetViewLookupQuery = {
    latitude: input.latitude,
    longitude: input.longitude,
    radiusMeters: clampRadius(input.radiusMeters),
  }
  const [panoramax, mapillary] = await Promise.all([
    lookupPanoramaxCoverage(query, STREET_VIEW_MAX_ITEMS),
    lookupMapillaryCoverage(query, STREET_VIEW_MAX_ITEMS),
  ])
  const merged = [...panoramax.items, ...mapillary.items]
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, STREET_VIEW_MAX_ITEMS)
  const items = decorateSequence(merged)
  const providersAttempted = [panoramax.attempt, mapillary.attempt]
  const composed = composeStreetViewState(providersAttempted, items.length)
  return {
    ok: true,
    state: composed.state,
    query,
    items,
    activeIndex: 0,
    providersAttempted,
    nominatimUsed: false,
    googleUsed: false,
    fabricated: false,
    honesty: composed.honesty,
  }
}

