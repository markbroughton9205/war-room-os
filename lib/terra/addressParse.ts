/**
 * US-style address parse for Terra JUMP / GO.
 * Structured fields are used for Nominatim structured lookup. Never invents a rooftop.
 */

import { expandStreetSuffix, normalizeStreetName, streetTypeAbbreviation } from './streetNameGuard'
import { splitStreetDirectionals } from './placePrecision/directionals'

export const NOMINATIM_STRUCTURED_PREFIX = 'terra-nominatim-search:'

const US_STATE_BY_NAME: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
}

const US_STATE_CODES = new Set(Object.values(US_STATE_BY_NAME))

export type ParsedUsAddress = {
  houseNumber: string | null
  preDirectional: string | null
  street: string | null
  streetName: string | null
  streetStem: string | null
  streetType: string | null
  streetTypeAbbrev: string | null
  postDirectional: string | null
  unit: string | null
  city: string | null
  state: string | null
  stateCode: string | null
  postcode: string | null
  country: 'US' | null
  countrycodes: 'us' | null
  /** True when Nominatim structured params (street/city/state/postalcode) can be sent. */
  structured: boolean
}

export type NominatimStructuredSearch = {
  q?: string
  street?: string
  city?: string
  county?: string
  state?: string
  postalcode?: string
  country?: string
  countrycodes?: string
}

function normalizeState(token: string | null | undefined): { name: string | null; code: string | null } {
  const raw = token?.trim()
  if (!raw) return { name: null, code: null }
  const upper = raw.toUpperCase()
  if (raw.length === 2 && US_STATE_CODES.has(upper)) return { name: upper, code: upper }
  const code = US_STATE_BY_NAME[raw.toLowerCase()]
  if (code) return { name: code, code }
  return { name: null, code: null }
}

function looksUsCountry(token: string | null | undefined): boolean {
  if (!token) return false
  return /^(usa|us|united states|united states of america)$/i.test(token.trim())
}

/** Expand a typed street line for Nominatim `street=` (housenumber + full suffix). */
export function nominatimStreetParam(houseNumber: string | null, streetLine: string | null): string | null {
  const street = streetLine?.trim()
  if (!street) return null
  const expanded = expandStreetSuffix(street)
  if (houseNumber) return `${houseNumber} ${expanded}`
  return expanded
}

export function parseUsStyleAddress(input: string): ParsedUsAddress | null {
  const text = input.trim().replace(/\s+/g, ' ')
  if (!text) return null

  let working = text.replace(/[.,]+$/g, '')
  let country: 'US' | null = null
  const countryTail = working.match(/,?\s*(USA|U\.S\.A\.|U\.S\.|US|United States(?: of America)?)$/i)
  if (countryTail) {
    country = 'US'
    working = working.slice(0, countryTail.index).trim().replace(/[.,]+$/g, '')
  }

  let postcode: string | null = null
  const zipTail = working.match(/,?\s*(\d{5}(?:-\d{4})?)$/)
  if (zipTail) {
    postcode = zipTail[1]
    working = working.slice(0, zipTail.index).trim().replace(/[.,]+$/g, '')
    // A 5-digit tail is not proof of the United States (Spain, etc.). US country
    // is set only from an explicit US token or a US state below.
  }

  let stateCode: string | null = null
  let state: string | null = null
  const tokens = working.split(/[,\s]+/).filter(Boolean)
  const lastToken = tokens[tokens.length - 1] ?? ''
  if (lastToken.length === 2 && US_STATE_CODES.has(lastToken.toUpperCase())) {
    const parsedState = normalizeState(lastToken)
    stateCode = parsedState.code
    state = parsedState.name
    const lastIndex = working.toLowerCase().lastIndexOf(lastToken.toLowerCase())
    working = working.slice(0, lastIndex).trim().replace(/[.,]+$/g, '')
    country = country ?? 'US'
  } else {
    const parsedState = normalizeState(lastToken)
    if (parsedState.code) {
      stateCode = parsedState.code
      state = parsedState.name
      const lastIndex = working.toLowerCase().lastIndexOf(lastToken.toLowerCase())
      working = working.slice(0, lastIndex).trim().replace(/[.,]+$/g, '')
      country = country ?? 'US'
    }
  }

  const parts = working.split(',').map(part => part.trim()).filter(Boolean)
  let houseNumber: string | null = null
  let street: string | null = null
  let unit: string | null = null
  let city: string | null = null

  if (parts.length >= 2) {
    const streetLine = parts[0]
    city = parts.slice(1).join(', ') || null
    const houseMatch = streetLine.match(/^(\d+[A-Za-z]?)\s+(.+)$/)
    if (houseMatch) {
      houseNumber = houseMatch[1]
      const split = splitStreetAndUnit(houseMatch[2])
      street = split.street
      unit = split.unit
    } else if (/^\d/.test(streetLine)) {
      street = streetLine
    } else if (!city) {
      city = streetLine
    } else {
      street = streetLine
    }
  } else if (parts.length === 1) {
    const houseMatch = parts[0].match(/^(\d+[A-Za-z]?)\s+(.+)$/)
    if (houseMatch) {
      houseNumber = houseMatch[1]
      const remainder = houseMatch[2]
      const suffixSplit = remainder.match(/^(.+?\b(?:st|street|rd|road|ave|avenue|dr|drive|blvd|boulevard|ln|lane|ct|court|cir|circle|pl|place|ter|terrace|pkwy|parkway|hwy|highway|way|trl|trail)\.?)\s+(.+)$/i)
      if (suffixSplit) {
        const split = splitStreetAndUnit(suffixSplit[1])
        street = split.street
        unit = split.unit
        city = suffixSplit[2]
      } else {
        const split = splitStreetAndUnit(remainder)
        street = split.street
        unit = split.unit
      }
    } else if (postcode || stateCode) {
      city = parts[0]
    } else {
      return null
    }
  }

  if (!houseNumber && !street && !city && !stateCode && !postcode) return null
  const isUs = country === 'US' || Boolean(stateCode)
  if (!isUs) return null

  const streetNorm = normalizeStreetName(street)
  const directional = splitStreetDirectionals(streetNorm?.stem ?? '')
  const structured = Boolean((houseNumber && street) || city || postcode || stateCode)
  return {
    houseNumber,
    preDirectional: directional.preDirectional,
    street,
    streetName: directional.streetName || null,
    streetStem: (directional.streetName || streetNorm?.stem || null)?.toUpperCase() ?? null,
    streetType: streetNorm?.type ?? null,
    streetTypeAbbrev: streetNorm?.typeAbbrev ?? streetTypeAbbreviation(streetNorm?.type) ?? null,
    postDirectional: directional.postDirectional,
    unit,
    city,
    state,
    stateCode,
    postcode,
    country: 'US',
    countrycodes: 'us',
    structured,
  }
}

function splitStreetAndUnit(value: string): { street: string; unit: string | null } {
  const match = value.match(/^(.*?)\s+(?:apt\.?|apartment|unit|ste\.?|suite|#)\s*([A-Za-z0-9-]+)$/i)
  if (!match) return { street: value.trim(), unit: null }
  return { street: match[1].trim(), unit: match[2].trim() }
}

export function encodeNominatimStructuredSearch(search: NominatimStructuredSearch): string {
  return `${NOMINATIM_STRUCTURED_PREFIX}${JSON.stringify(search)}`
}

export function decodeNominatimStructuredSearch(text: string): NominatimStructuredSearch | null {
  const raw = text.trim()
  if (!raw.startsWith(NOMINATIM_STRUCTURED_PREFIX)) return null
  try {
    const parsed = JSON.parse(raw.slice(NOMINATIM_STRUCTURED_PREFIX.length)) as NominatimStructuredSearch
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

export function structuredSearchFromParsedAddress(parsed: ParsedUsAddress): NominatimStructuredSearch | null {
  if (!parsed.structured) return null
  const street = nominatimStreetParam(parsed.houseNumber, parsed.street)
  const search: NominatimStructuredSearch = {}
  if (street) search.street = street
  if (parsed.city) search.city = parsed.city
  if (parsed.stateCode) search.state = parsed.stateCode
  if (parsed.postcode) search.postalcode = parsed.postcode
  if (parsed.countrycodes === 'us' && (parsed.stateCode || parsed.country === 'US')) search.countrycodes = 'us'
  if (!search.street && !search.city && !search.postalcode) return null
  return search
}
