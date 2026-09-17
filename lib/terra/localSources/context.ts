import type { TerraLocalContext } from './types'

const US_STATES: Record<string, string> = {
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

const US_ABBREV_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATES).map(([name, abbr]) => [abbr, name.replace(/\b\w/g, ch => ch.toUpperCase())]),
)

const COUNTRY_ALIASES: Record<string, { name: string; code: string }> = {
  'united states': { name: 'United States', code: 'US' },
  usa: { name: 'United States', code: 'US' },
  us: { name: 'United States', code: 'US' },
  'united kingdom': { name: 'United Kingdom', code: 'GB' },
  uk: { name: 'United Kingdom', code: 'GB' },
  england: { name: 'United Kingdom', code: 'GB' },
  japan: { name: 'Japan', code: 'JP' },
  'south africa': { name: 'South Africa', code: 'ZA' },
  canada: { name: 'Canada', code: 'CA' },
  france: { name: 'France', code: 'FR' },
  australia: { name: 'Australia', code: 'AU' },
}

export function normalizePlaceToken(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim()
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, ch => ch.toUpperCase())
}

function countryFromToken(token: string): { name: string; code: string } | null {
  return COUNTRY_ALIASES[normalizePlaceToken(token)] ?? null
}

const SUBNATIONAL: Record<string, { name: string; abbr: string | null }> = {
  ontario: { name: 'Ontario', abbr: 'ON' },
  'new south wales': { name: 'New South Wales', abbr: 'NSW' },
  nsw: { name: 'New South Wales', abbr: 'NSW' },
  'western cape': { name: 'Western Cape', abbr: null },
  'ile de france': { name: 'Île-de-France', abbr: null },
  'île-de-france': { name: 'Île-de-France', abbr: null },
  'ile-de-france': { name: 'Île-de-France', abbr: null },
}

function stateFromToken(token: string): { name: string; abbr: string | null } | null {
  const key = normalizePlaceToken(token)
  if (US_STATES[key]) return { name: titleCase(key), abbr: US_STATES[key] }
  if (SUBNATIONAL[key]) return SUBNATIONAL[key]
  const upper = token.trim().toUpperCase()
  if (US_ABBREV_TO_NAME[upper]) return { name: US_ABBREV_TO_NAME[upper], abbr: upper }
  return null
}

const TOKYO_TOKEN = /^(tokyo|tōkyō|東京都|東京)$/i

export function isNarrowLocalityName(value: string | null | undefined): boolean {
  const text = value?.trim()
  if (!text) return false
  if (/\b(township|ward)\b/i.test(text)) return true
  if (/区$/.test(text)) return true
  return false
}

export function parseLocalContext(input: {
  latitude: number
  longitude: number
  place?: string | null
  city?: string | null
  county?: string | null
  state?: string | null
  country?: string | null
  countryCode?: string | null
  metro?: string | null
  timezone?: string | null
  bbox?: { west: number; south: number; east: number; north: number } | null
}): TerraLocalContext {
  const parts = (input.place ?? '').split(',').map(part => part.trim()).filter(Boolean)
  const cityFromInput = input.city?.trim() || null
  const countyFromInput = input.county?.trim() || null
  let city = cityFromInput
  let county = countyFromInput
  let state = input.state?.trim() || null
  let country = input.country?.trim() || null
  let countryCode = input.countryCode?.trim().toUpperCase() || null

  for (const part of [...parts].reverse()) {
    const asCountry = countryFromToken(part)
    if (!country && asCountry) {
      country = asCountry.name
      countryCode = countryCode ?? asCountry.code
      continue
    }
    const asState = stateFromToken(part)
    if (!state && asState) {
      state = asState.name
      continue
    }
    if (!county && /county|district|borough|municipality|prefecture/i.test(part)) {
      county = part
      continue
    }
  }

  if (!city && parts[0] && !/county|district/i.test(parts[0])) {
    const sameAsState = state && normalizePlaceToken(parts[0]) === normalizePlaceToken(state)
    const duplicatedCityState = Boolean(parts[1] && normalizePlaceToken(parts[0]) === normalizePlaceToken(parts[1]))
    const nestedUnderSelectedCounty = isNarrowLocalityName(parts[0]) && Boolean(countyFromInput)
    if ((!sameAsState || duplicatedCityState) && !nestedUnderSelectedCounty) city = parts[0]
  }
  if (!cityFromInput && city && isNarrowLocalityName(city) && countyFromInput) city = null
  if (!city && state && TOKYO_TOKEN.test(state)) city = 'Tokyo'
  if (!cityFromInput && city && isNarrowLocalityName(city) && state && TOKYO_TOKEN.test(state)) city = 'Tokyo'
  if (city && /tokyo|東京/i.test(city)) city = /東京/.test(city) && !/tokyo/i.test(city) ? city : 'Tokyo'
  if (city && /new york/i.test(city)) city = 'New York'
  if (city && /cape town|kaapstad/i.test(city)) city = 'Cape Town'

  const countryInfo = country ? countryFromToken(country) : countryCode ? countryFromToken(countryCode) : null
  if (countryInfo) {
    country = countryInfo.name
    countryCode = countryInfo.code
  }

  const metro = input.metro?.trim()
    || (city && /new york|nyc/i.test(city) ? 'New York City' : null)
    || (city && /los angeles/i.test(city) ? 'Los Angeles' : null)
    || (city && /cape town|kaapstad/i.test(city) ? 'Cape Town' : null)
    || city

  const shortLabel = formatLocalShortLabel({ city, county, state, country, countryCode, latitude: input.latitude, longitude: input.longitude })

  return {
    latitude: input.latitude,
    longitude: input.longitude,
    place: input.place?.trim() || null,
    city,
    county,
    metro,
    state,
    country,
    countryCode,
    bbox: input.bbox ?? null,
    timezone: input.timezone ?? null,
    shortLabel,
  }
}

export function formatLocalShortLabel(input: {
  city: string | null
  county: string | null
  state: string | null
  country: string | null
  countryCode: string | null
  latitude: number
  longitude: number
}): string {
  const city = input.city?.trim() || null
  const state = input.state?.trim() || null
  const county = input.county?.trim() || null
  const abbr = state ? (US_STATES[normalizePlaceToken(state)] ?? (/^[A-Za-z]{2,3}$/.test(state) ? state.toUpperCase() : null)) : null
  if (city && abbr) return `${city.toUpperCase()}, ${abbr}`
  if (city && input.countryCode && ['GB', 'JP', 'ZA', 'FR', 'CA', 'AU'].includes(input.countryCode)) return city.toUpperCase()
  if (city) return city.toUpperCase()
  if (county && abbr) return `${county.toUpperCase()}, ${abbr}`
  if (county) return county.toUpperCase()
  if (state) return (abbr ?? state).toUpperCase()
  return `${input.latitude.toFixed(3)}°, ${input.longitude.toFixed(3)}°`
}

export function contextTokens(context: TerraLocalContext): string[] {
  return [context.city, context.county, context.metro, context.state, ...((context.county ?? '').split(/[/,]/))]
    .map(value => normalizePlaceToken(value))
    .filter(value => value.length > 2)
}
