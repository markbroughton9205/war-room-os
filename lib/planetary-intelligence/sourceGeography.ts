import { hostnameFromUrl } from '@/lib/intelligence/canonicalUrl'
import type { PlanetaryGeography } from './types'

export const LOCALITY_CLASSES = [
  'HYPERLOCAL',
  'CITY_LOCAL',
  'REGIONAL',
  'NATIONAL',
  'INTERNATIONAL',
  'SPECIALIST',
  'OFFICIAL',
  'UNKNOWN',
] as const
export type LocalityClass = (typeof LOCALITY_CLASSES)[number]

export const SOURCE_GEOGRAPHY_MATCH = ['MATCH', 'PARTIAL_MATCH', 'NO_MATCH', 'UNKNOWN'] as const
export type SourceGeographyMatch = (typeof SOURCE_GEOGRAPHY_MATCH)[number]

export type SourceGeographyRecord = {
  taskGeography: PlanetaryGeography | 'GLOBAL' | null
  eventGeography: PlanetaryGeography | null
  sourceHeadquartersGeography: PlanetaryGeography | null
  sourceCoverageGeography: PlanetaryGeography | null
  datelineGeography: PlanetaryGeography | null
  localityClass: LocalityClass
  country: string | null
  city: string | null
  sourceGeographyMatch: SourceGeographyMatch
}

type PublisherGeo = {
  host: RegExp
  coverage: PlanetaryGeography | null
  headquarters: PlanetaryGeography | null
  locality: LocalityClass
  country: string | null
  city: string | null
}

const PUBLISHER_GEO: PublisherGeo[] = [
  { host: /(^|\.)smh\.com\.au$/i, coverage: 'OCEANIA', headquarters: 'OCEANIA', locality: 'NATIONAL', country: 'Australia', city: 'Sydney' },
  { host: /(^|\.)abc\.net\.au$/i, coverage: 'OCEANIA', headquarters: 'OCEANIA', locality: 'NATIONAL', country: 'Australia', city: 'Sydney' },
  { host: /(^|\.)bbc\./i, coverage: null, headquarters: 'EUROPE', locality: 'INTERNATIONAL', country: 'United Kingdom', city: null },
  { host: /(^|\.)reuters\.com$/i, coverage: null, headquarters: 'EUROPE', locality: 'INTERNATIONAL', country: 'United Kingdom', city: null },
  { host: /(^|\.)apnews\.com$/i, coverage: 'NORTH_AMERICA', headquarters: 'NORTH_AMERICA', locality: 'INTERNATIONAL', country: 'United States', city: null },
  { host: /(^|\.)cnn\.com$/i, coverage: 'NORTH_AMERICA', headquarters: 'NORTH_AMERICA', locality: 'INTERNATIONAL', country: 'United States', city: null },
  { host: /(^|\.)nytimes\.com$/i, coverage: 'NORTH_AMERICA', headquarters: 'NORTH_AMERICA', locality: 'NATIONAL', country: 'United States', city: 'New York' },
  { host: /(^|\.)allafrica\.com$/i, coverage: 'AFRICA', headquarters: 'AFRICA', locality: 'REGIONAL', country: null, city: null },
  { host: /(^|\.)dw\.com$/i, coverage: 'EUROPE', headquarters: 'EUROPE', locality: 'INTERNATIONAL', country: 'Germany', city: null },
  { host: /(^|\.)lemonde\.fr$/i, coverage: 'EUROPE', headquarters: 'EUROPE', locality: 'NATIONAL', country: 'France', city: null },
  { host: /(^|\.)scmp\.com$/i, coverage: 'EAST_ASIA', headquarters: 'EAST_ASIA', locality: 'REGIONAL', country: 'Hong Kong', city: 'Hong Kong' },
  { host: /(^|\.)aljazeera\.com$/i, coverage: 'MIDDLE_EAST', headquarters: 'MIDDLE_EAST', locality: 'INTERNATIONAL', country: 'Qatar', city: null },
  { host: /(^|\.)thehindu\.com$/i, coverage: 'SOUTH_ASIA', headquarters: 'SOUTH_ASIA', locality: 'NATIONAL', country: 'India', city: null },
  { host: /(^|\.)abcnews\.com$/i, coverage: 'NORTH_AMERICA', headquarters: 'NORTH_AMERICA', locality: 'NATIONAL', country: 'United States', city: null },
  { host: /(^|\.)federalregister\.gov$/i, coverage: 'NORTH_AMERICA', headquarters: 'NORTH_AMERICA', locality: 'OFFICIAL', country: 'United States', city: null },
  { host: /(^|\.)sec\.gov$/i, coverage: 'NORTH_AMERICA', headquarters: 'NORTH_AMERICA', locality: 'OFFICIAL', country: 'United States', city: null },
  { host: /(^|\.)arxiv\.org$/i, coverage: null, headquarters: 'NORTH_AMERICA', locality: 'SPECIALIST', country: 'United States', city: null },
  { host: /(^|\.)cbs\.gov\.il$/i, coverage: 'MIDDLE_EAST', headquarters: 'MIDDLE_EAST', locality: 'OFFICIAL', country: 'Israel', city: null },
  { host: /(^|\.)news\.google\.com$/i, coverage: null, headquarters: 'NORTH_AMERICA', locality: 'INTERNATIONAL', country: 'United States', city: null },
]

const TLD_NATIONAL: Record<string, { geography: PlanetaryGeography; country: string }> = {
  au: { geography: 'OCEANIA', country: 'Australia' },
  nz: { geography: 'OCEANIA', country: 'New Zealand' },
  jp: { geography: 'EAST_ASIA', country: 'Japan' },
  kr: { geography: 'EAST_ASIA', country: 'South Korea' },
  cn: { geography: 'EAST_ASIA', country: 'China' },
  in: { geography: 'SOUTH_ASIA', country: 'India' },
  id: { geography: 'SOUTHEAST_ASIA', country: 'Indonesia' },
  br: { geography: 'LATIN_AMERICA', country: 'Brazil' },
  mx: { geography: 'LATIN_AMERICA', country: 'Mexico' },
  ar: { geography: 'LATIN_AMERICA', country: 'Argentina' },
  de: { geography: 'EUROPE', country: 'Germany' },
  fr: { geography: 'EUROPE', country: 'France' },
  uk: { geography: 'EUROPE', country: 'United Kingdom' },
  ke: { geography: 'EAST_AFRICA', country: 'Kenya' },
  ng: { geography: 'WEST_AFRICA', country: 'Nigeria' },
  za: { geography: 'AFRICA', country: 'South Africa' },
  il: { geography: 'MIDDLE_EAST', country: 'Israel' },
}

const PARENT: Record<string, PlanetaryGeography> = {
  WEST_AFRICA: 'AFRICA',
  EAST_AFRICA: 'AFRICA',
  CENTRAL_AFRICA: 'AFRICA',
}

function fixtureLocalHost(host: string): { geography: PlanetaryGeography; locality: LocalityClass } | null {
  const match = /^(local|rss|gov|ops|research|alt|gap)-([a-z_]+)\.example$/i.exec(host)
  if (!match) return null
  const geo = match[2]!.toUpperCase() as PlanetaryGeography
  const kind = match[1]!.toLowerCase()
  const locality: LocalityClass = kind === 'gov' || kind === 'ops' ? 'OFFICIAL' : kind === 'research' ? 'SPECIALIST' : kind === 'rss' ? 'REGIONAL' : 'CITY_LOCAL'
  return { geography: geo, locality }
}

export function classifySourceGeography(input: {
  url: string
  title?: string
  outlet?: string
  taskGeography?: PlanetaryGeography | 'GLOBAL' | null
}): SourceGeographyRecord {
  const host = (hostnameFromUrl(input.url) || '').toLowerCase()
  const fixture = fixtureLocalHost(host)
  const known = PUBLISHER_GEO.find(entry => entry.host.test(host))
  const tld = host.split('.').pop() ?? ''
  const tldHit = TLD_NATIONAL[tld]

  let locality: LocalityClass = 'UNKNOWN'
  let coverage: PlanetaryGeography | null = null
  let headquarters: PlanetaryGeography | null = null
  let country: string | null = null
  let city: string | null = null

  if (fixture) {
    locality = fixture.locality
    coverage = fixture.geography
    headquarters = fixture.geography
  } else if (known) {
    locality = known.locality
    coverage = known.coverage
    headquarters = known.headquarters
    country = known.country
    city = known.city
  } else if (tldHit) {
    locality = 'NATIONAL'
    coverage = tldHit.geography
    headquarters = tldHit.geography
    country = tldHit.country
  }

  const titleCity = /\b(city of|municipal)\s+[a-z]{3,}\b/i.test(`${input.title ?? ''} ${input.outlet ?? ''}`)
  void titleCity
  if (/\bgazette\b|\bherald\b|\btimes\b/i.test(input.outlet ?? '') && locality === 'UNKNOWN') {
    locality = 'UNKNOWN'
  }

  const task = input.taskGeography && input.taskGeography !== 'GLOBAL' ? input.taskGeography : null
  return {
    taskGeography: input.taskGeography ?? null,
    eventGeography: null,
    sourceHeadquartersGeography: headquarters,
    sourceCoverageGeography: coverage,
    datelineGeography: null,
    localityClass: locality,
    country,
    city,
    sourceGeographyMatch: matchTaskToSource(task, coverage, headquarters, locality),
  }
}

export function matchTaskToSource(
  task: PlanetaryGeography | null,
  coverage: PlanetaryGeography | null,
  headquarters: PlanetaryGeography | null,
  locality: LocalityClass,
): SourceGeographyMatch {
  if (!task) return coverage || headquarters ? 'UNKNOWN' : 'UNKNOWN'
  const observed = coverage ?? headquarters
  if (!observed) return 'UNKNOWN'
  if (observed === task) return 'MATCH'
  if (PARENT[task] === observed || PARENT[observed] === task) return 'PARTIAL_MATCH'
  if (locality === 'INTERNATIONAL' || locality === 'SPECIALIST') return 'PARTIAL_MATCH'
  return 'NO_MATCH'
}

export function taskGeographyIsNotSourceGeography(task: PlanetaryGeography, source: PlanetaryGeography | null): boolean {
  return source !== task
}

export function cityNameHeuristicCannotEstablishLocality(title: string, url: string): LocalityClass {
  const classified = classifySourceGeography({ url, title, taskGeography: 'LATIN_AMERICA' })
  return classified.localityClass
}
