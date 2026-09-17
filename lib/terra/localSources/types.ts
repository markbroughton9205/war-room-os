/**
 * Terra LOCAL source intelligence — stations and public-information sources that
 * serve the active Terra geography. Not HEADLINES. Not a second news engine.
 *
 * This registry is a seed + matcher, not a complete catalog of every station on Earth.
 */

export const TERRA_LOCAL_SOURCE_TYPES = [
  'TV',
  'RADIO',
  'NEWSPAPER',
  'PUBLIC_AGENCY',
  'WEATHER',
  'TRANSPORTATION',
  'EMERGENCY',
  'EVENTS',
] as const
export type TerraLocalSourceType = (typeof TERRA_LOCAL_SOURCE_TYPES)[number]

export const TERRA_LOCAL_COVERAGE_LEVELS = [
  'CITY',
  'COUNTY',
  'METRO',
  'REGIONAL',
  'STATE_PROVINCE',
] as const
export type TerraLocalCoverageLevel = (typeof TERRA_LOCAL_COVERAGE_LEVELS)[number]

export const TERRA_LOCAL_SOURCE_HEALTH = [
  'ACTIVE',
  'STALE',
  'NO_FEED',
  'BLOCKED',
  'UNAVAILABLE',
  'AUTH_REQUIRED',
  'RATE_LIMITED',
] as const
export type TerraLocalSourceHealth = (typeof TERRA_LOCAL_SOURCE_HEALTH)[number]

/** Runtime usability — seed status is CONFIGURED only and never implies CURRENTLY_HEALTHY. */
export const TERRA_LOCAL_RUNTIME_USABILITY = [
  'CONFIGURED',
  'RETRIEVAL_VERIFIED',
  'CURRENTLY_HEALTHY',
  'STALE',
  'BLOCKED',
  'NO_FEED',
  'UNAVAILABLE',
] as const
export type TerraLocalRuntimeUsability = (typeof TERRA_LOCAL_RUNTIME_USABILITY)[number]

export const TERRA_LOCAL_AREA_COVERAGE = [
  'RICH_COVERAGE',
  'PARTIAL',
  'SPARSE',
  'NO_COVERAGE',
] as const
export type TerraLocalAreaCoverage = (typeof TERRA_LOCAL_AREA_COVERAGE)[number]

export const TERRA_LOCAL_FEED_TYPES = [
  'RSS',
  'ATOM',
  'API',
  'JSON',
  'NONE',
] as const
export type TerraLocalFeedType = (typeof TERRA_LOCAL_FEED_TYPES)[number]

export type TerraLocalSource = {
  id: string
  name: string
  type: TerraLocalSourceType
  city: string | null
  county: string | null
  metro: string | null
  region: string | null
  state: string | null
  country: string
  countryCode: string
  coverageLevel: TerraLocalCoverageLevel
  serviceArea: string
  aliases: string[]
  homepage: string
  feedUrl: string | null
  feedType: TerraLocalFeedType
  language: string
  provider: string
  lastVerified: string
  status: TerraLocalSourceHealth
  licenseClass: 'PUBLIC_RSS' | 'PUBLIC_API' | 'PUBLIC_HTML' | 'RESTRICTED'
  provenance: string
  coverageGeometry?: { west: number; south: number; east: number; north: number } | null
}

export type TerraLocalContext = {
  latitude: number
  longitude: number
  place: string | null
  city: string | null
  county: string | null
  metro: string | null
  state: string | null
  country: string | null
  countryCode: string | null
  bbox: { west: number; south: number; east: number; north: number } | null
  timezone: string | null
  shortLabel: string
}

export type TerraLocalMatchedSource = TerraLocalSource & {
  matchLevel: TerraLocalCoverageLevel
  matchReason: string
}

export type TerraLocalStoryQualification = {
  qualified: boolean
  relevance: 'Same city' | 'County' | 'Metro' | 'Regional' | 'State / province' | 'Nearby event' | null
  reason: string
}

export const TERRA_LOCAL_STORY_FRESHNESS = ['LIVE', 'RECENT', 'STALE'] as const
export type TerraLocalStoryFreshness = (typeof TERRA_LOCAL_STORY_FRESHNESS)[number]

export type TerraLocalFetchedItem = {
  sourceId: string
  sourceName: string
  sourceType: TerraLocalSourceType
  serviceArea: string
  title: string
  summary: string | null
  url: string | null
  publishedAt: string | null
  retrievedAt: string
  eventLocalTime: string | null
  sourceLocalTime: string | null
  freshnessState: TerraLocalStoryFreshness
  language: string | null
  geography: string | null
  qualification: TerraLocalStoryQualification
}

export type TerraLocalSourceRuntime = {
  source: TerraLocalMatchedSource
  health: TerraLocalSourceHealth
  usability: TerraLocalRuntimeUsability
  itemCount: number
  qualifiedCount: number
  rejectedCount: number
  newestPublishedAt: string | null
  error: string | null
}

export type TerraLocalMixRow = {
  key: string
  label: string
  count: number
}

export type TerraLocalIntelReport = {
  context: TerraLocalContext
  coverage: TerraLocalAreaCoverage
  coverageLevelsPresent: TerraLocalCoverageLevel[]
  health: TerraLocalSourceHealth | 'PARTIAL'
  matchedSources: TerraLocalMatchedSource[]
  sourceRuntime: TerraLocalSourceRuntime[]
  mix: TerraLocalMixRow[]
  qualified: TerraLocalFetchedItem[]
  rejected: TerraLocalFetchedItem[]
  reason: string
}

export const LOCAL_STORY_NEARBY_RADIUS_KM = 80
export const LOCAL_SOURCE_STALE_MS = 36 * 60 * 60 * 1000
