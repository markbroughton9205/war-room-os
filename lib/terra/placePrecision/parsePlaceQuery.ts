/**
 * Worldwide typed-query parse for Terra JUMP / GO.
 * Address-like US queries keep independent structural fields.
 * Non-address places keep name + admin hierarchy and never force parcel enrichment.
 */

import { parseUsStyleAddress, type ParsedUsAddress } from '../addressParse'
import { parseTerraCoordinates } from '../locationCommand'

export type ParsedPlaceKind = 'coordinates' | 'address' | 'place'

export type ParsedPlaceQuery = {
  kind: ParsedPlaceKind
  raw: string
  houseNumber: string | null
  preDirectional: string | null
  streetName: string | null
  streetStem: string | null
  streetType: string | null
  streetTypeAbbrev: string | null
  postDirectional: string | null
  unit: string | null
  name: string | null
  placeTypeCandidate: string | null
  city: string | null
  county: string | null
  stateProvince: string | null
  postalCode: string | null
  country: string | null
  countryCode: string | null
  us: ParsedUsAddress | null
  addressLike: boolean
}

const COUNTRY_HINTS: Array<{ re: RegExp; name: string; code: string }> = [
  { re: /\b(united states|usa|u\.s\.a\.|u\.s\.)\b/i, name: 'United States', code: 'US' },
  { re: /\b(united kingdom|great britain|england|scotland|wales)\b/i, name: 'United Kingdom', code: 'GB' },
  { re: /\b(japan|日本)\b/i, name: 'Japan', code: 'JP' },
  { re: /\b(france)\b/i, name: 'France', code: 'FR' },
  { re: /\b(spain|españa)\b/i, name: 'Spain', code: 'ES' },
  { re: /\b(germany|deutschland)\b/i, name: 'Germany', code: 'DE' },
  { re: /\b(canada)\b/i, name: 'Canada', code: 'CA' },
  { re: /\b(australia)\b/i, name: 'Australia', code: 'AU' },
  { re: /\b(mexico|méxico)\b/i, name: 'Mexico', code: 'MX' },
  { re: /\b(italy|italia)\b/i, name: 'Italy', code: 'IT' },
  { re: /\b(brazil|brasil)\b/i, name: 'Brazil', code: 'BR' },
]

const PLACE_TYPE_HINTS: Array<{ re: RegExp; type: string }> = [
  { re: /\b(hospital|clinic|medical center)\b/i, type: 'amenity' },
  { re: /\b(tower|monument|cathedral|temple|palace|castle)\b/i, type: 'landmark' },
  { re: /\bcounty\b/i, type: 'county' },
  { re: /\b(state|province|prefecture)\b/i, type: 'admin' },
]

function emptyPlace(raw: string): ParsedPlaceQuery {
  return {
    kind: 'place',
    raw,
    houseNumber: null,
    preDirectional: null,
    streetName: null,
    streetStem: null,
    streetType: null,
    streetTypeAbbrev: null,
    postDirectional: null,
    unit: null,
    name: raw,
    placeTypeCandidate: null,
    city: null,
    county: null,
    stateProvince: null,
    postalCode: null,
    country: null,
    countryCode: null,
    us: null,
    addressLike: false,
  }
}

export function parseTypedPlaceQuery(input: string): ParsedPlaceQuery {
  const raw = input.trim().replace(/\s+/g, ' ')
  if (!raw) return emptyPlace(raw)
  if (parseTerraCoordinates(raw)) {
    return { ...emptyPlace(raw), kind: 'coordinates', name: raw, placeTypeCandidate: 'coordinate' }
  }

  const us = parseUsStyleAddress(raw)
  if (us?.houseNumber && us.street) {
    return {
      kind: 'address',
      raw,
      houseNumber: us.houseNumber,
      preDirectional: us.preDirectional,
      streetName: us.streetName,
      streetStem: us.streetStem,
      streetType: us.streetType,
      streetTypeAbbrev: us.streetTypeAbbrev,
      postDirectional: us.postDirectional,
      unit: us.unit,
      name: [us.houseNumber, us.street].filter(Boolean).join(' '),
      placeTypeCandidate: 'address',
      city: us.city,
      county: null,
      stateProvince: us.stateCode ?? us.state,
      postalCode: us.postcode,
      country: 'United States',
      countryCode: 'US',
      us,
      addressLike: true,
    }
  }

  const place = emptyPlace(raw)
  const country = COUNTRY_HINTS.find(row => row.re.test(raw))
  if (country) {
    place.country = country.name
    place.countryCode = country.code
  }
  const hinted = PLACE_TYPE_HINTS.find(row => row.re.test(raw))
  place.placeTypeCandidate = hinted?.type ?? (country && raw.replace(country.re, '').trim() === '' ? 'country' : 'place')
  if (us && (us.city || us.stateCode || us.postcode) && !us.houseNumber) {
    place.city = us.city
    place.stateProvince = us.stateCode ?? us.state
    place.postalCode = us.postcode
    place.countryCode = place.countryCode ?? 'US'
    place.country = place.country ?? 'United States'
    place.us = us
    if (us.city && us.stateCode && !us.street) place.placeTypeCandidate = 'city'
    else if (!us.city && us.stateCode && !us.street) place.placeTypeCandidate = 'admin'
  }
  const parts = raw.split(',').map(part => part.trim()).filter(Boolean)
  if (parts.length >= 2 && !place.city) {
    place.name = parts[0]
    place.city = parts[0]
    if (!place.stateProvince && parts[1]) place.stateProvince = parts[1]
  }
  return place
}

export function shouldAttemptAddressEnrichment(parsed: ParsedPlaceQuery): boolean {
  return parsed.kind === 'address' && Boolean(parsed.houseNumber && parsed.streetStem && parsed.streetTypeAbbrev)
}
