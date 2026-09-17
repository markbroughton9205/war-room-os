/**
 * Commander-selected jurisdiction must stay distinct from reverse-geocoded sublocality.
 * SEARCH establishes LOCAL query context. Reverse geocode may enrich it, never replace it.
 */

import type { TerraActiveLocation } from './activeLocation'
import { isNarrowLocalityName, normalizePlaceToken, parseLocalContext } from './localSources/context'

export const TERRA_JURISDICTION_TYPES = ['city', 'county', 'state', 'country', 'coordinates'] as const
export type TerraJurisdictionType = (typeof TERRA_JURISDICTION_TYPES)[number]

const SUBLOCALITY_RE = /\b(township|ward|neighbourhood|neighborhood|quarter|hamlet|borough of)\b/i
const JP_WARD_RE = /区$/
const TOKYO_RE = /^(tokyo|tōkyō|東京都|東京)$/i

export function isSublocalityName(value: string | null | undefined): boolean {
  const text = value?.trim()
  if (!text) return false
  if (isNarrowLocalityName(text)) return true
  if (SUBLOCALITY_RE.test(text)) return true
  if (JP_WARD_RE.test(text)) return true
  return false
}

export function jurisdictionTypeFromParts(input: {
  city?: string | null
  county?: string | null
  state?: string | null
  country?: string | null
}): TerraJurisdictionType | null {
  if (input.city?.trim() && !isSublocalityName(input.city)) return 'city'
  if (input.county?.trim()) return 'county'
  if (input.state?.trim()) return 'state'
  if (input.country?.trim()) return 'country'
  return null
}

function tokyoCityFromParts(city: string | null, county: string | null, state: string | null): string | null {
  if (city && TOKYO_RE.test(city.trim())) return 'Tokyo'
  if (state && TOKYO_RE.test(state.trim())) return 'Tokyo'
  if (county && TOKYO_RE.test(county.trim())) return 'Tokyo'
  if (city && isSublocalityName(city) && (TOKYO_RE.test(state ?? '') || TOKYO_RE.test(county ?? ''))) return 'Tokyo'
  return city && !isSublocalityName(city) ? city : null
}

/** Parse the Commander search string first; Nominatim display label only fills gaps. */
export function selectedJurisdictionFromSearch(input: {
  query: string
  label: string
  latitude: number
  longitude: number
  nativeName?: string | null
  englishName?: string | null
}): {
  city: string | null
  county: string | null
  state: string | null
  country: string | null
  countryCode: string | null
  jurisdictionType: TerraJurisdictionType | null
  searchQuery: string
} {
  const query = input.query.trim()
  const fromQuery = parseLocalContext({ latitude: input.latitude, longitude: input.longitude, place: query || input.label })
  const fromLabel = parseLocalContext({
    latitude: input.latitude,
    longitude: input.longitude,
    place: input.label,
    city: fromQuery.city,
    county: fromQuery.county,
    state: fromQuery.state,
    country: fromQuery.country,
    countryCode: fromQuery.countryCode,
  })
  const queryIsExplicitSublocality = Boolean(fromQuery.city && isSublocalityName(fromQuery.city))
  let city = fromQuery.city
  let county = fromQuery.county ?? fromLabel.county
  const state = fromQuery.state ?? fromLabel.state
  const country = fromQuery.country ?? fromLabel.country
  const countryCode = fromQuery.countryCode ?? fromLabel.countryCode
  if (!city && !fromQuery.county && fromLabel.city && !isSublocalityName(fromLabel.city)) city = fromLabel.city
  if (!queryIsExplicitSublocality) {
    if (input.englishName && TOKYO_RE.test(input.englishName)) city = 'Tokyo'
    if (input.nativeName && TOKYO_RE.test(input.nativeName)) city = city && isSublocalityName(city) ? 'Tokyo' : (city ?? 'Tokyo')
    city = tokyoCityFromParts(city, county, state)
    if (city && isSublocalityName(city)) city = null
  }
  if (county && city && normalizePlaceToken(county) === normalizePlaceToken(city)) county = fromQuery.county ?? fromLabel.county
  const jurisdictionType = jurisdictionTypeFromParts({ city, county, state, country })
  return {
    city,
    county,
    state,
    country,
    countryCode,
    jurisdictionType,
    searchQuery: query || input.label,
  }
}

function firstCommaPart(value: string | null | undefined): string | null {
  const text = value?.split(',')[0]?.trim()
  return text || null
}

function reverseSublocalityLabel(reverse: Pick<TerraActiveLocation, 'city' | 'locality' | 'label' | 'place' | 'reverseNeighborhood'>): {
  reverseWard: string | null
  reverseTownship: string | null
  reverseMunicipality: string | null
  reverseNeighborhood: string | null
  reverseSublocalityLabel: string | null
} {
  const candidates = [
    reverse.locality,
    reverse.city,
    firstCommaPart(reverse.place),
    firstCommaPart(reverse.label),
  ].map(value => value?.trim() || null)
  const candidate = candidates.find(value => value && isSublocalityName(value)) ?? null
  const reverseWard = candidate && (JP_WARD_RE.test(candidate) || /\bward\b/i.test(candidate)) ? candidate : null
  const reverseTownship = candidate && /\btownship\b/i.test(candidate) ? candidate : null
  const reverseMunicipality = candidate && !reverseWard && !reverseTownship && isSublocalityName(candidate) ? candidate : null
  const reverseNeighborhood = reverseWard || reverseTownship || reverseMunicipality
    ? null
    : (reverse.reverseNeighborhood?.trim() || (isSublocalityName(candidate) ? candidate : null))
  const reverseSublocalityLabel = reverseWard || reverseTownship || reverseMunicipality || reverseNeighborhood
  return { reverseWard, reverseTownship, reverseMunicipality, reverseNeighborhood, reverseSublocalityLabel }
}

/** Reverse geocode enriches SEARCH. City/county used for LOCAL stay the selected jurisdiction. */
export function enrichSearchWithReverse(selected: TerraActiveLocation, reverse: TerraActiveLocation): TerraActiveLocation {
  const sub = reverseSublocalityLabel(reverse)
  return {
    ...selected,
    address: reverse.address ?? selected.address,
    region: reverse.region ?? selected.region,
    sourceUrl: selected.sourceUrl ?? reverse.sourceUrl,
    locality: reverse.locality ?? selected.locality ?? sub.reverseSublocalityLabel,
    reverseWard: sub.reverseWard,
    reverseTownship: sub.reverseTownship,
    reverseMunicipality: sub.reverseMunicipality,
    reverseNeighborhood: sub.reverseNeighborhood,
    reverseSublocalityLabel: sub.reverseSublocalityLabel,
    detail: sub.reverseSublocalityLabel
      ? `Selected jurisdiction preserved for LOCAL. Reverse geocode is inside ${sub.reverseSublocalityLabel}.`
      : selected.detail,
  }
}

/**
 * Click / pan / GPS: use a meaningful admin level, not the smallest Nominatim locality.
 * Does not invent names — only drops township/ward from the city slot when a parent exists.
 */
export function promoteMeaningfulAdmin(location: TerraActiveLocation): TerraActiveLocation {
  let city = location.city?.trim() || null
  const county = location.county?.trim() || null
  const state = location.state?.trim() || null
  const sub = reverseSublocalityLabel(location)
  if (city && isSublocalityName(city)) {
    const tokyo = tokyoCityFromParts(city, county, state)
    city = tokyo && tokyo !== city ? tokyo : null
  } else {
    city = tokyoCityFromParts(city, county, state) ?? city
  }
  if (!city && state && TOKYO_RE.test(state.trim())) city = 'Tokyo'
  return {
    ...location,
    city,
    locality: location.locality ?? sub.reverseSublocalityLabel,
    reverseWard: location.reverseWard ?? sub.reverseWard,
    reverseTownship: location.reverseTownship ?? sub.reverseTownship,
    reverseMunicipality: location.reverseMunicipality ?? sub.reverseMunicipality,
    reverseNeighborhood: location.reverseNeighborhood ?? sub.reverseNeighborhood,
    reverseSublocalityLabel: location.reverseSublocalityLabel ?? sub.reverseSublocalityLabel,
  }
}
