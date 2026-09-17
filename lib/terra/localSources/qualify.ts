import { LOCAL_STORY_NEARBY_RADIUS_KM, type TerraLocalContext, type TerraLocalMatchedSource, type TerraLocalStoryQualification } from './types'
import { normalizePlaceToken } from './context'
import { haversineKm } from '@/lib/terra/cinematicFlyTo'

const FOREIGN_COUNTRY_RE = /\b(france|french|paris|ukraine|russia|china|beijing|germany|berlin|italy|rome|spain|madrid|brazil|mexico|canada|australia|india|pakistan|israel|gaza|iran|iraq|syria|sudan|nigeria|kenya)\b/i

function wordBoundaryIncludes(haystack: string, needle: string): boolean {
  const token = normalizePlaceToken(needle)
  if (token.length < 3) return false
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(haystack)
}

function stateMentioned(haystack: string, state: string | null): boolean {
  if (!state) return false
  const name = normalizePlaceToken(state)
  if (name.length > 3 && wordBoundaryIncludes(haystack, name)) return true
  const compact: Record<string, string> = {
    ohio: 'oh',
    'new york': 'ny',
    california: 'ca',
    illinois: 'il',
    florida: 'fl',
    ontario: 'ontario',
    'new south wales': 'nsw',
    england: 'england',
    'western cape': 'western cape',
    'île-de-france': 'île-de-france',
    tokyo: 'tokyo',
  }
  const abbr = compact[name]
  if (!abbr || abbr.length < 2) return false
  if (abbr.length === 2) return new RegExp(`(?:^|[^a-z0-9])${abbr}(?:$|[^a-z0-9])`, 'i').test(haystack)
  return wordBoundaryIncludes(haystack, abbr)
}

function cityNativeNames(city: string | null): string[] {
  if (!city) return []
  const extra: Record<string, string[]> = {
    tokyo: ['東京', '東京都'],
    'cape town': ['kaapstad'],
    'los angeles': ['l.a.'],
    'new york': ['nyc'],
  }
  return [city, ...(extra[normalizePlaceToken(city)] ?? [])]
}

function mentionsToken(haystack: string, token: string): boolean {
  if (/[\u3040-\u30ff\u3400-\u9fff]/.test(token)) return haystack.includes(token.toLowerCase()) || haystack.includes(token)
  return wordBoundaryIncludes(haystack, token)
}

function scrubPublisher(haystack: string, sourceName: string | undefined): string {
  let text = haystack
  text = text.replace(/\bthe post\b[\s\S]{0,200}\bappeared first on\b[\s\S]{0,80}/gi, ' ')
  if (sourceName && sourceName.trim().length >= 4) {
    const escaped = sourceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    text = text.replace(new RegExp(escaped, 'gi'), ' ')
  }
  return text
}

export function qualifyLocalStory(input: {
  title: string
  summary?: string | null
  geography?: string | null
  tags?: string[]
  lat?: number | null
  lon?: number | null
  context: TerraLocalContext
  source: Pick<TerraLocalMatchedSource, 'coverageLevel' | 'city' | 'county' | 'metro' | 'state' | 'country' | 'aliases' | 'serviceArea' | 'name'>
}): TerraLocalStoryQualification {
  const haystack = scrubPublisher(
    [input.title, input.summary ?? '', input.geography ?? '', ...(input.tags ?? [])].join(' ').toLowerCase(),
    input.source.name,
  )
  const city = input.context.city
  const county = input.context.county
  const metro = input.context.metro
  const state = input.context.state

  if (typeof input.lat === 'number' && typeof input.lon === 'number') {
    const km = haversineKm(
      { latitude: input.context.latitude, longitude: input.context.longitude },
      { latitude: input.lat, longitude: input.lon },
    )
    if (km <= LOCAL_STORY_NEARBY_RADIUS_KM) {
      return { qualified: true, relevance: km <= 12 ? 'Same city' : 'Nearby event', reason: `${km.toFixed(1)} km from active Terra location.` }
    }
  }

  if (cityNativeNames(city).some(name => mentionsToken(haystack, name) || input.title.includes(name) || (input.geography ?? '').includes(name))) {
    return { qualified: true, relevance: 'Same city', reason: `Story names ${city}.` }
  }
  if (county && wordBoundaryIncludes(haystack, county.replace(/\s+county$/i, '')) && /county|district|prefecture/i.test(haystack + ' ' + (county ?? ''))) {
    return { qualified: true, relevance: 'County', reason: `Story names ${county}.` }
  }
  if (county && wordBoundaryIncludes(haystack, county)) {
    return { qualified: true, relevance: 'County', reason: `Story names ${county}.` }
  }
  // Metro name is only a match when it is this location's metro — not a neighboring DMA.
  if (metro && city && normalizePlaceToken(metro) !== normalizePlaceToken(city) && wordBoundaryIncludes(haystack, metro)) {
    return { qualified: true, relevance: 'Metro', reason: `Story names metro ${metro}.` }
  }
  for (const alias of input.source.aliases) {
    if (alias.length < 3) continue
    if (!mentionsToken(haystack, alias) && !input.title.includes(alias)) continue
    const aliasIsActiveCity = Boolean(city && (normalizePlaceToken(alias) === normalizePlaceToken(city) || cityNativeNames(city).some(name => normalizePlaceToken(name) === normalizePlaceToken(alias) || name === alias)))
    const aliasIsActiveCounty = Boolean(county && (normalizePlaceToken(alias) === normalizePlaceToken(county) || wordBoundaryIncludes(alias, county.replace(/ county$/i, ''))))
    if (aliasIsActiveCity) {
      return { qualified: true, relevance: 'Same city', reason: `Story matches city alias ${alias}.` }
    }
    if (aliasIsActiveCounty) {
      return { qualified: true, relevance: 'County', reason: `Story matches county alias ${alias}.` }
    }
  }

  const localTokens = [city, county, metro, ...(input.source.aliases.filter(alias => alias.length > 3))]
    .filter(Boolean) as string[]
  const hasLocalToken = localTokens.some(token => wordBoundaryIncludes(haystack, token))
  const foreign = FOREIGN_COUNTRY_RE.test(haystack) && !hasLocalToken
  if (foreign) {
    return { qualified: false, relevance: null, reason: 'Story geography is outside the active Terra location; publisher city is not enough.' }
  }

  if (state && stateMentioned(haystack, state) && !foreign) {
    if (input.source.coverageLevel === 'STATE_PROVINCE' || input.source.coverageLevel === 'REGIONAL') {
      return { qualified: true, relevance: 'State / province', reason: `Story names ${state} and source covers that region.` }
    }
  }

  return {
    qualified: false,
    relevance: null,
    reason: 'Local publisher only — story has no city/county/state/coordinate match for the active Terra location.',
  }
}
