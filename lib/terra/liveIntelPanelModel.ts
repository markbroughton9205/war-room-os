/**
 * Live Intel panel information model — a presentation/retrieval layer over existing Terra
 * world-state, Research Engine adapters, public RSS, and event feeds.
 *
 * Does not create Terra2, Council2, Search2, or a second Live Intel engine.
 * Coordinates are never invented. Severity/confidence are only copied when a source supplied them.
 * Conflict-zone geometry is never fabricated.
 */
import {
  isValidLiveCoordinate,
  type TerraLiveFreshness,
  type TerraLiveGeoObject,
  type TerraLiveProviderStatus,
} from './liveGeoIntelligence'
import { formatLastKnownGoodAge } from './videoFeedResilience'
import type { ResearchProviderId } from '@/lib/research-engine/core/types'
import type { TerraGeoFeature, TerraIntelligenceEventKind, TerraProvenance } from './types'
import {
  buildLiveIntelLanguageFields,
  resolvePlaceDisplayName,
  TERRA_LIVE_INTEL_TRANSLATION_STATES,
  type TerraLiveIntelLanguageFields,
  type TerraLiveIntelTranslationRecord,
  type TerraLiveIntelTranslationState,
} from './liveIntelLanguage'
import { compactLocalLabel, isDeviceOnlyPlaceLabel } from './geographicContext'
import { localSectionDisplayCount, scoreLocalIntelItem } from './localIntelRelevance'
import type { TerraGeoRelation, TerraRadiusTier } from './localIntelRelevance'
import type { GodsEyeZoomRung } from './godsEye/zoomLadder'
import type { TerraDegreeRectangle } from './aircraftBoundingBox'
import {
  relativeAgeLabel,
  resolveTerraWorldTime,
  worldClockStrip,
  type TerraWorldTimeSnapshot,
} from './worldTime'
import {
  buildMediaPreviewFromSource,
  mediaPreviewIsRenderable,
  sanitizeMediaPreviewForAuth,
  type TerraLiveIntelMediaPreview,
} from './liveIntelMedia'

export type { TerraLiveIntelMediaPreview } from './liveIntelMedia'
export {
  TERRA_LIVE_INTEL_MEDIA_ACCESS_CLASSES,
  TERRA_LIVE_INTEL_MEDIA_NONE,
  TERRA_LIVE_INTEL_MEDIA_PREVIEW_TYPES,
} from './liveIntelMedia'

export { TERRA_LIVE_INTEL_TRANSLATION_STATES, type TerraLiveIntelTranslationState, type TerraLiveIntelTranslationRecord }

export const TERRA_LIVE_INTEL_CATEGORIES = [
  'EARTH',
  'LOCAL',
  'HEADLINES',
  'BREAKING',
  'EVENTS',
  'CONFLICT',
] as const
export type TerraLiveIntelCategory = (typeof TERRA_LIVE_INTEL_CATEGORIES)[number]

export const TERRA_LIVE_INTEL_COVERAGE_STATES = [
  'LIVE',
  'CACHED',
  'STALE',
  'PARTIAL',
  'NO_COVERAGE',
  'AUTH_REQUIRED',
  'UNAVAILABLE',
] as const
export type TerraLiveIntelCoverageState = (typeof TERRA_LIVE_INTEL_COVERAGE_STATES)[number]

export const TERRA_LIVE_INTEL_VERIFICATION_STATES = [
  'CONFIRMED',
  'REPORTED',
  'DISPUTED',
  'UNVERIFIED',
] as const
export type TerraLiveIntelVerificationState = (typeof TERRA_LIVE_INTEL_VERIFICATION_STATES)[number]

export const TERRA_LIVE_INTEL_SECTION_CAPS: Record<TerraLiveIntelCategory, number> = {
  EARTH: 6,
  LOCAL: 12,
  HEADLINES: 8,
  BREAKING: 3,
  EVENTS: 5,
  CONFLICT: 5,
}

export const TERRA_LIVE_INTEL_LOCAL_RADIUS_KM = 80
export const TERRA_LIVE_INTEL_OVERLAY_CAP = 80

export type TerraLiveIntelSourceMixRow = {
  key: string
  label: string
  count: number
}

const EARTH_EVENT_TYPES = new Set<string>([
  'earthquake',
  'tropical_cyclone',
  'wildfire_incident',
  'volcano_event',
  'flood_event',
  'severe_weather_alert',
  'tsunami_alert',
  'traffic_event',
])

const CONFLICT_TITLE_RE = /\b(war|warfare|conflict|airstrike|air strike|ceasefire|cease-fire|evacuation|shelling|missile strike|invasion|occupation|clashes|armed clash|humanitarian corridor|displacement|refugees|bombardment|artillery)\b/i
const DISPUTED_RE = /\b(disputed|alleged|unconfirmed|unverified|claims? that|according to rebels|according to the military)\b/i
const BREAKING_TITLE_RE = /^\s*breaking\b|\bbreaking:\b|\bbreaking news\b/i
const EVENT_TITLE_RE = /\b(accident|disaster|launch|summit|election|protest|demonstration|outage|blackout|infrastructure|space station|wildfire|earthquake|cyclone|hurricane|typhoon|volcano|flood|tsunami)\b/i

export type TerraLiveIntelSourceRef = {
  name: string
  url: string | null
  provider: string
  publishedAt: string | null
}

export type TerraLiveIntelItem = {
  id: string
  category: TerraLiveIntelCategory
  headline: string
  summary: string | null
  originalLanguage: string | null
  originalHeadline: string
  englishHeadline: string | null
  originalSummary: string | null
  englishSummary: string | null
  translationState: TerraLiveIntelTranslationState
  translation: TerraLiveIntelTranslationRecord | null
  nativeLocationName: string | null
  englishLocationName: string | null
  timestamp: string | null
  utcTimestamp: string | null
  timezone: string | null
  localTime: string | null
  utcOffset: string | null
  dayNightState: TerraWorldTimeSnapshot['dayNightState']
  dstActive: boolean | null
  relativeAge: string | null
  location: string | null
  lat: number | null
  lon: number | null
  source: string
  sourceUrl: string | null
  provider: string
  confidence: number | null
  verificationState: TerraLiveIntelVerificationState | null
  coverageState: TerraLiveIntelCoverageState
  freshnessState: TerraLiveFreshness
  freshnessLabel?: string | null
  eventType: string | null
  severity: string | number | null
  relatedTerraEntityIds: string[]
  relatedEvidenceIds: string[]
  retrievedAt: string
  sourceCount: number
  sources: TerraLiveIntelSourceRef[]
  breakingReason: string | null
  coordinateOrigin: string | null
  geoRelation?: TerraGeoRelation | null
  distanceKm?: number | null
  radiusTier?: TerraRadiusTier | null
  localSourceType?: string | null
  localServiceArea?: string | null
  localRelevance?: string | null
  mediaPreview?: TerraLiveIntelMediaPreview
}

export type TerraConflictZone = {
  name: string
  region: string | null
  centroid: { lat: number; lon: number } | null
  boundingGeometry: null
  status: string
  lastUpdated: string | null
  sourceRefs: { name: string; url: string | null }[]
  recentEvents: string[]
  coverageState: TerraLiveIntelCoverageState
  uncertainty: string
  localTime: string | null
  timezone: string | null
  utcOffset: string | null
  dayNightState: TerraWorldTimeSnapshot['dayNightState']
  nativeName: string | null
  englishName: string | null
}

export type TerraLiveIntelSection = {
  id: TerraLiveIntelCategory
  label: string
  count: number
  displayCount: string
  coverageState: TerraLiveIntelCoverageState
  reason: string
  items: TerraLiveIntelItem[]
  sourceMix?: TerraLiveIntelSourceMixRow[]
  runtimeHealth?: TerraLiveIntelRuntimeHealth | null
}

export type TerraLiveIntelRuntimeHealth = {
  configured: number
  currentlyHealthy: number
  stale: number
  blocked: number
  unavailable: number
  noFeed: number
}

export type TerraLiveIntelNewsSeed = {
  id: string
  title: string
  summary: string | null
  url: string | null
  sourceName: string
  provider: string
  publishedAt: string | null
  retrievedAt: string
  fromCache?: boolean
  lastKnownGood?: boolean
  contentType?: string | null
  geography?: string | null
  reliability?: 'HIGH' | 'MEDIUM' | 'LOW'
  feedName?: string | null
  categories?: string[]
  declaredLanguage?: string | null
  englishTitle?: string | null
  englishSummary?: string | null
  localSourceType?: string | null
  localServiceArea?: string | null
  localRelevance?: string | null
  youtubeVideoId?: string | null
  verifiedVideoSourceId?: string | null
  mediaPreview?: TerraLiveIntelMediaPreview
  intelCategory?: TerraLiveIntelCategory
  verificationState?: TerraLiveIntelVerificationState | null
}

export type TerraLiveIntelLocalInput = {
  seeds: TerraLiveIntelNewsSeed[]
  coverage: 'RICH_COVERAGE' | 'PARTIAL' | 'SPARSE' | 'NO_COVERAGE'
  health: 'ACTIVE' | 'STALE' | 'UNAVAILABLE' | 'NO_FEED' | 'AUTH_REQUIRED' | 'RATE_LIMITED' | 'PARTIAL' | 'BLOCKED'
  mix: TerraLiveIntelSourceMixRow[]
  shortLabel: string | null
  rejectedCount: number
  reason: string
  runtimeHealth?: TerraLiveIntelRuntimeHealth | null
}

export type TerraEarthIntelPanelSnapshot = {
  fetchedAt: string
  authState: 'AUTHENTICATED' | 'AUTH_REQUIRED'
  scope: {
    label: string
    latitude: number | null
    longitude: number | null
    place: string | null
    nativePlaceName: string | null
    englishPlaceName: string | null
    city?: string | null
    county?: string | null
    state?: string | null
    country?: string | null
    countryCode?: string | null
    compactLabel?: string | null
    reverseSublocalityLabel?: string | null
    zoomLevel?: GodsEyeZoomRung | null
  }
  worldTime: TerraWorldTimeSnapshot
  worldClock: ReturnType<typeof worldClockStrip>
  sections: TerraLiveIntelSection[]
  zones: TerraConflictZone[]
}

export type ComposeLiveIntelPanelInput = {
  now: string
  objects?: TerraLiveGeoObject[]
  news?: TerraLiveIntelNewsSeed[]
  newsCoverage?: TerraLiveIntelCoverageState
  newsReason?: string
  conflictCoverage?: TerraLiveIntelCoverageState
  conflictReason?: string
  latitude?: number | null
  longitude?: number | null
  place?: string | null
  nativePlaceName?: string | null
  englishPlaceName?: string | null
  city?: string | null
  county?: string | null
  state?: string | null
  country?: string | null
  countryCode?: string | null
  reverseSublocalityLabel?: string | null
  zoomLevel?: GodsEyeZoomRung | null
  bbox?: TerraDegreeRectangle | null
  authState?: 'AUTHENTICATED' | 'AUTH_REQUIRED'
  providers?: TerraLiveProviderStatus[]
  localIntel?: TerraLiveIntelLocalInput | null
}

const SECTION_LABEL: Record<TerraLiveIntelCategory, string> = {
  EARTH: 'EARTH',
  LOCAL: 'LOCAL',
  HEADLINES: 'HEADLINES',
  BREAKING: 'BREAKING',
  EVENTS: 'EVENTS',
  CONFLICT: 'CONFLICT',
}

function sourceLanguageFields(headline: string, summary: string | null, extras?: {
  declaredLanguage?: string | null
  englishHeadline?: string | null
  englishSummary?: string | null
}): TerraLiveIntelLanguageFields {
  return buildLiveIntelLanguageFields({
    headline,
    summary,
    declaredLanguage: extras?.declaredLanguage,
    englishHeadline: extras?.englishHeadline,
    englishSummary: extras?.englishSummary,
  })
}

function locationNameFields(location: string | null): {
  location: string | null
  nativeLocationName: string | null
  englishLocationName: string | null
} {
  if (!location) return { location: null, nativeLocationName: null, englishLocationName: null }
  const names = resolvePlaceDisplayName({ place: location })
  return {
    location: names.displayLabel ?? location,
    nativeLocationName: names.nativeName,
    englishLocationName: names.englishName,
  }
}

function eventTimeFields(input: {
  timestamp: string | null
  now: string
  lat: number | null
  lon: number | null
}): Pick<TerraLiveIntelItem, 'utcTimestamp' | 'timezone' | 'localTime' | 'utcOffset' | 'dayNightState' | 'dstActive' | 'relativeAge'> {
  const relativeAge = input.timestamp ? relativeAgeLabel(input.timestamp, input.now) : null
  if (input.lat === null || input.lon === null || !input.timestamp) {
    return {
      utcTimestamp: input.timestamp,
      timezone: null,
      localTime: null,
      utcOffset: null,
      dayNightState: null,
      dstActive: null,
      relativeAge,
    }
  }
  const resolved = resolveTerraWorldTime({
    utcIso: input.now,
    latitude: input.lat,
    longitude: input.lon,
    sourceTimestamp: input.timestamp,
  })
  return {
    utcTimestamp: input.timestamp,
    timezone: resolved.timeZone,
    localTime: resolved.eventLocalTime,
    utcOffset: resolved.eventUtcOffset ?? resolved.utcOffset,
    dayNightState: resolved.dayNightState,
    dstActive: resolved.dstActive,
    relativeAge,
  }
}

function localStoryFreshness(publishedAt: string | null, now: string, fromCache?: boolean): TerraLiveFreshness {
  if (fromCache) return 'CACHED'
  if (!publishedAt) return 'STALE'
  const age = Date.parse(now) - Date.parse(publishedAt)
  if (!Number.isFinite(age)) return 'STALE'
  if (age <= 2 * 60 * 60 * 1000) return 'LIVE'
  if (age <= 36 * 60 * 60 * 1000) return 'RECENT'
  return 'STALE'
}

function newsSeedFreshness(seed: TerraLiveIntelNewsSeed, now: string, asLocalStory: boolean): TerraLiveFreshness {
  if (seed.lastKnownGood) return 'STALE_LAST_GOOD'
  if (seed.contentType === 'official_youtube') return seed.fromCache ? 'CACHED' : 'LIVE'
  if (asLocalStory) return localStoryFreshness(seed.publishedAt, now, seed.fromCache)
  return seed.fromCache ? 'CACHED' : 'LIVE'
}

function newsSeedFreshnessLabel(seed: TerraLiveIntelNewsSeed, freshness: TerraLiveFreshness, now: string): string | null {
  if (freshness !== 'STALE_LAST_GOOD') return null
  const nowMs = Date.parse(now)
  return formatLastKnownGoodAge(seed.retrievedAt, Number.isFinite(nowMs) ? nowMs : Date.now())
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeHeadline(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\b(ap|reuters|afp|exclusive|breaking|live|update)\b/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenSet(text: string): Set<string> {
  return new Set(normalizeHeadline(text).split(' ').filter(token => token.length > 3))
}

export function headlinesAreNearDuplicate(a: string, b: string): boolean {
  const left = normalizeHeadline(a)
  const right = normalizeHeadline(b)
  if (!left || !right) return false
  if (left === right) return true
  const leftTokens = tokenSet(a)
  const rightTokens = tokenSet(b)
  if (!leftTokens.size || !rightTokens.size) return left === right
  let inter = 0
  for (const token of leftTokens) if (rightTokens.has(token)) inter += 1
  const union = leftTokens.size + rightTokens.size - inter
  return union > 0 && inter / union >= 0.55
}

export function coverageFromFreshness(freshness: TerraLiveFreshness): TerraLiveIntelCoverageState {
  if (freshness === 'LIVE' || freshness === 'RECENT') return 'LIVE'
  if (freshness === 'CACHED' || freshness === 'DELAYED' || freshness === 'READY') return 'CACHED'
  if (freshness === 'STALE' || freshness === 'STALE_LAST_GOOD' || freshness === 'HISTORICAL') return 'STALE'
  if (freshness === 'EMPTY' || freshness === 'NO_COVERAGE' || freshness === 'DISABLED') return 'NO_COVERAGE'
  if (
    freshness === 'AUTH_FAILED'
    || freshness === 'NEEDS_CREDENTIALS'
    || freshness === 'AUTH_REQUIRED'
    || freshness === 'NOT_CONFIGURED'
  ) return 'AUTH_REQUIRED'
  if (freshness === 'PARTIAL') return 'PARTIAL'
  return 'UNAVAILABLE'
}

function sourceSeverity(object: TerraLiveGeoObject): string | number | null {
  if (object.type !== 'earthquake') return null
  const match = object.title.match(/\bM(?:w)?\s*(\d+(?:\.\d+)?)\b/i)
  if (!match?.[1]) return null
  const mag = Number(match[1])
  return Number.isFinite(mag) ? mag : null
}

function earthEventType(object: TerraLiveGeoObject): string | null {
  if (EARTH_EVENT_TYPES.has(object.type)) return object.type
  return null
}

function itemFromGeoObject(object: TerraLiveGeoObject, category: TerraLiveIntelCategory, now: string): TerraLiveIntelItem {
  const eventType = earthEventType(object) ?? object.type
  const verification: TerraLiveIntelVerificationState | null = category === 'CONFLICT'
    ? 'REPORTED'
    : EARTH_EVENT_TYPES.has(object.type)
      ? 'CONFIRMED'
      : null
  const lat = isValidLiveCoordinate(object.latitude, object.longitude) ? object.latitude : null
  const lon = isValidLiveCoordinate(object.latitude, object.longitude) ? object.longitude : null
  return {
    id: object.id,
    category,
    headline: object.title,
    summary: object.summary,
    ...sourceLanguageFields(object.title, object.summary),
    timestamp: object.observedAt,
    ...eventTimeFields({ timestamp: object.observedAt, now, lat, lon }),
    ...locationNameFields(object.region ?? object.country),
    lat,
    lon,
    source: object.publisherFamily ?? object.provider,
    sourceUrl: object.sourceUrl,
    provider: object.provider,
    confidence: object.confidence,
    verificationState: verification,
    coverageState: coverageFromFreshness(object.freshness),
    freshnessState: object.freshness,
    eventType,
    severity: sourceSeverity(object),
    relatedTerraEntityIds: [object.id],
    relatedEvidenceIds: object.evidenceId ? [object.evidenceId] : [],
    retrievedAt: object.receivedAt,
    sourceCount: 1 + object.discoveryProvenance.alsoDiscoveredVia.length,
    sources: [
      { name: object.publisherFamily ?? object.provider, url: object.sourceUrl, provider: object.provider, publishedAt: object.observedAt },
      ...object.discoveryProvenance.alsoDiscoveredVia.map(name => ({ name, url: null, provider: name, publishedAt: object.observedAt })),
    ],
    breakingReason: null,
    coordinateOrigin: object.coordinateOrigin,
    mediaPreview: buildMediaPreviewFromSource({
      sourceUrl: object.sourceUrl,
      provider: object.provider,
      retrievedAt: object.receivedAt,
      originalLanguage: null,
    }),
  }
}

function itemFromNewsSeed(seed: TerraLiveIntelNewsSeed, category: TerraLiveIntelCategory, now: string): TerraLiveIntelItem {
  const disputed = DISPUTED_RE.test(seed.title) || DISPUTED_RE.test(seed.summary ?? '')
  const official = seed.contentType === 'humanitarian_report' || seed.contentType === 'official_youtube'
  let verification: TerraLiveIntelVerificationState | null = seed.verificationState ?? null
  if (verification == null && (category === 'CONFLICT' || CONFLICT_TITLE_RE.test(seed.title))) {
    if (disputed) verification = 'DISPUTED'
    else if (official) verification = 'REPORTED'
    else if (seed.reliability === 'HIGH') verification = 'REPORTED'
    else verification = 'UNVERIFIED'
  } else if (verification == null && official) {
    verification = disputed ? 'DISPUTED' : 'REPORTED'
  }
  if (verification === 'CONFIRMED' && seed.contentType === 'official_youtube') {
    verification = 'REPORTED'
  }
  const freshness = newsSeedFreshness(seed, now, false)
  const freshnessLabel = newsSeedFreshnessLabel(seed, freshness, now)
  const explicitBreaking = Boolean(seed.feedName && /breaking/i.test(seed.feedName)) || BREAKING_TITLE_RE.test(seed.title)
  return {
    id: seed.id,
    category,
    headline: seed.title,
    summary: seed.summary,
    ...sourceLanguageFields(seed.title, seed.summary, {
      declaredLanguage: seed.declaredLanguage,
      englishHeadline: seed.englishTitle,
      englishSummary: seed.englishSummary,
    }),
    timestamp: seed.publishedAt,
    ...eventTimeFields({ timestamp: seed.publishedAt, now, lat: null, lon: null }),
    ...locationNameFields(seed.geography ?? null),
    lat: null,
    lon: null,
    source: seed.sourceName,
    sourceUrl: seed.url,
    provider: seed.provider,
    confidence: null,
    verificationState: verification,
    coverageState: coverageFromFreshness(freshness),
    freshnessState: freshness,
    freshnessLabel,
    eventType: category === 'CONFLICT' ? 'conflict_report' : category === 'BREAKING' ? 'breaking_news' : 'news',
    severity: null,
    relatedTerraEntityIds: [],
    relatedEvidenceIds: [seed.id],
    retrievedAt: seed.retrievedAt,
    sourceCount: 1,
    sources: [{ name: seed.sourceName, url: seed.url, provider: seed.provider, publishedAt: seed.publishedAt }],
    breakingReason: explicitBreaking
      ? seed.feedName && /breaking/i.test(seed.feedName)
        ? `Provider feed explicitly labeled breaking (${seed.feedName}).`
        : 'Source headline explicitly marked breaking.'
      : null,
    coordinateOrigin: null,
    localSourceType: seed.localSourceType ?? null,
    localServiceArea: seed.localServiceArea ?? null,
    localRelevance: seed.localRelevance ?? null,
    mediaPreview: seed.mediaPreview ?? buildMediaPreviewFromSource({
      sourceUrl: seed.url,
      youtubeVideoId: seed.youtubeVideoId,
      provider: seed.provider,
      retrievedAt: seed.retrievedAt,
      originalLanguage: seed.declaredLanguage,
      englishTranslation: seed.englishTitle,
    }),
  }
}

function mergeCluster(items: TerraLiveIntelItem[]): TerraLiveIntelItem[] {
  const clusters: TerraLiveIntelItem[] = []
  for (const item of items) {
    const existing = clusters.find(candidate => (
      candidate.originalLanguage === item.originalLanguage
      && headlinesAreNearDuplicate(candidate.originalHeadline, item.originalHeadline)
    ))
    if (!existing) {
      clusters.push({ ...item, sources: [...item.sources] })
      continue
    }
    const seen = new Set(existing.sources.map(source => `${source.provider}|${source.url ?? source.name}`))
    for (const source of item.sources) {
      const key = `${source.provider}|${source.url ?? source.name}`
      if (seen.has(key)) continue
      seen.add(key)
      existing.sources.push(source)
    }
    existing.sourceCount = existing.sources.length
    if (!existing.summary && item.summary) existing.summary = item.summary
    if (!existing.sourceUrl && item.sourceUrl) existing.sourceUrl = item.sourceUrl
    if (!existing.relatedEvidenceIds.includes(item.id)) existing.relatedEvidenceIds.push(item.id)
    const existingMs = Date.parse(existing.timestamp ?? '')
    const itemMs = Date.parse(item.timestamp ?? '')
    if (Number.isFinite(itemMs) && (!Number.isFinite(existingMs) || itemMs > existingMs)) {
      existing.timestamp = item.timestamp
      existing.headline = item.originalHeadline
      existing.originalHeadline = item.originalHeadline
      existing.originalSummary = item.originalSummary ?? existing.originalSummary
      existing.summary = item.originalSummary ?? existing.summary
    }
    if (item.breakingReason && !existing.breakingReason) existing.breakingReason = item.breakingReason
    if ((!existing.mediaPreview || existing.mediaPreview.type === 'NONE') && item.mediaPreview && item.mediaPreview.type !== 'NONE') {
      existing.mediaPreview = item.mediaPreview
    }
  }
  return clusters
}

function classifyBreaking(item: TerraLiveIntelItem, nowMs: number): boolean {
  if (item.breakingReason) return true
  const publishedMs = Date.parse(item.timestamp ?? '')
  if (!Number.isFinite(publishedMs)) return false
  const ageMs = nowMs - publishedMs
  if (ageMs < 0 || ageMs > 2 * 60 * 60 * 1000) return false
  return item.sourceCount >= 2
}

function compareIntelItems(a: TerraLiveIntelItem, b: TerraLiveIntelItem): number {
  const aTime = a.timestamp ?? a.retrievedAt
  const bTime = b.timestamp ?? b.retrievedAt
  if (aTime !== bTime) return aTime < bTime ? 1 : -1
  if (a.sourceCount !== b.sourceCount) return b.sourceCount - a.sourceCount
  return a.id.localeCompare(b.id)
}

/** Keep a small official-media reserve so verified video is not crowded out by RSS/geo volume. */
function sliceSectionItems(id: TerraLiveIntelCategory, items: TerraLiveIntelItem[]): TerraLiveIntelItem[] {
  const cap = TERRA_LIVE_INTEL_SECTION_CAPS[id]
  if (id !== 'EARTH' && id !== 'HEADLINES' && id !== 'LOCAL') return items.slice(0, cap)
  const media = items.filter(item => mediaPreviewIsRenderable(item.mediaPreview))
  const rest = items.filter(item => !mediaPreviewIsRenderable(item.mediaPreview))
  const reserved = Math.min(2, media.length, cap)
  return [...rest.slice(0, cap - reserved), ...media.slice(0, reserved)].sort(compareIntelItems)
}

function sectionState(
  items: TerraLiveIntelItem[],
  fallback: TerraLiveIntelCoverageState,
  emptyReason: string,
  liveReason: string,
): { coverageState: TerraLiveIntelCoverageState; reason: string } {
  if (!items.length) return { coverageState: fallback, reason: emptyReason }
  const states = new Set(items.map(item => item.coverageState))
  if (states.size > 1) return { coverageState: 'PARTIAL', reason: liveReason }
  const only = items[0]?.coverageState ?? fallback
  return { coverageState: only, reason: liveReason }
}

function scopeLabel(place: string | null | undefined, latitude: number | null | undefined, longitude: number | null | undefined): string {
  if (place?.trim()) return place.trim()
  if (typeof latitude === 'number' && typeof longitude === 'number' && isValidLiveCoordinate(latitude, longitude)) {
    return `${latitude.toFixed(3)}°, ${longitude.toFixed(3)}°`
  }
  return 'No active Terra location'
}

function mixFromLocalItems(items: TerraLiveIntelItem[]): TerraLiveIntelSourceMixRow[] {
  const counts = new Map<string, TerraLiveIntelSourceMixRow>()
  for (const item of items) {
    const raw = (item.localSourceType ?? 'EVENTS').toUpperCase()
    const key = raw === 'PUBLIC_AGENCY' || raw === 'EMERGENCY'
      ? 'PUBLIC SAFETY'
      : raw === 'TRANSPORTATION'
        ? 'TRAFFIC'
        : raw
    const current = counts.get(key) ?? { key, label: key, count: 0 }
    current.count += 1
    counts.set(key, current)
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

function resolveLocalSectionState(input: {
  hasLocation: boolean
  localScope: string
  itemCount: number
  localIntel: TerraLiveIntelLocalInput | null
}): { coverageState: TerraLiveIntelCoverageState; reason: string } {
  if (!input.hasLocation) {
    return { coverageState: 'NO_COVERAGE', reason: 'Local intel uses the active Terra location — not a silent Commander track. Select a place, search, click, or enable My Location.' }
  }
  if (!input.localIntel) {
    return input.itemCount
      ? { coverageState: 'LIVE', reason: `Nearby events at ${input.localScope}. Local station sources were not queried in this composition.` }
      : { coverageState: 'NO_COVERAGE', reason: `Local source pool was not queried for ${input.localScope}.` }
  }
  const health = input.localIntel.health
  if (input.localIntel.coverage === 'NO_COVERAGE' && !input.itemCount) {
    return { coverageState: 'NO_COVERAGE', reason: input.localIntel.reason }
  }
  if ((health === 'UNAVAILABLE' || health === 'NO_FEED' || health === 'AUTH_REQUIRED' || health === 'RATE_LIMITED' || health === 'BLOCKED') && !input.itemCount) {
    const coverage: TerraLiveIntelCoverageState = health === 'AUTH_REQUIRED' || health === 'BLOCKED' ? 'AUTH_REQUIRED' : health === 'RATE_LIMITED' ? 'PARTIAL' : health === 'NO_FEED' ? 'NO_COVERAGE' : 'UNAVAILABLE'
    return { coverageState: coverage, reason: input.localIntel.reason }
  }
  if (health === 'PARTIAL') {
    return { coverageState: 'PARTIAL', reason: input.localIntel.reason }
  }
  if (!input.itemCount) {
    return { coverageState: 'LIVE', reason: input.localIntel.reason || `Healthy local source set queried for ${input.localScope}; zero qualifying local stories.` }
  }
  return { coverageState: health === 'STALE' ? 'STALE' : 'LIVE', reason: input.localIntel.reason || `Local to ${input.localScope}.` }
}

export function composeLiveIntelPanel(input: ComposeLiveIntelPanelInput): TerraEarthIntelPanelSnapshot {
  const now = input.now
  const nowMs = Date.parse(now)
  const lat = asFiniteNumber(input.latitude)
  const lon = asFiniteNumber(input.longitude)
  const hasLocation = lat !== null && lon !== null && isValidLiveCoordinate(lat, lon)
  const place = asNonEmptyString(input.place)
  const placeNames = resolvePlaceDisplayName({
    place,
    nativeName: input.nativePlaceName,
    englishName: input.englishPlaceName,
  })
  const placeLabel = placeNames.displayLabel ?? place

  const geoEarth = (input.objects ?? [])
    .filter(object => EARTH_EVENT_TYPES.has(object.type))
    .map(object => itemFromGeoObject(object, 'EARTH', now))
    .sort(compareIntelItems)

  const localGeoScored = hasLocation
    ? geoEarth.map(item => {
        const relevance = scoreLocalIntelItem(item, {
          lat,
          lon,
          bbox: input.bbox ?? null,
          zoomLevel: input.zoomLevel ?? 'CITY',
          placeName: placeLabel,
          nativePlaceName: placeNames.nativeName,
          city: input.city ?? null,
          county: input.county ?? null,
          state: input.state ?? null,
          country: input.country ?? null,
          countryCode: input.countryCode ?? null,
          accuracyMeters: null,
          contextType: 'CAMERA',
          source: 'coordinates',
        })
        return { item, relevance }
      }).filter(row => row.relevance.includeInLocal)
    : []

  const newsItems = mergeCluster((input.news ?? []).map(seed => {
    if (seed.intelCategory === 'EARTH' || seed.intelCategory === 'HEADLINES' || seed.intelCategory === 'EVENTS' || seed.intelCategory === 'CONFLICT') {
      return itemFromNewsSeed(seed, seed.intelCategory, now)
    }
    if (CONFLICT_TITLE_RE.test(seed.title) || seed.contentType === 'humanitarian_report') {
      return itemFromNewsSeed(seed, CONFLICT_TITLE_RE.test(seed.title) ? 'CONFLICT' : 'EVENTS', now)
    }
    if (EVENT_TITLE_RE.test(seed.title) && !/news/i.test(seed.feedName ?? '')) {
      return itemFromNewsSeed(seed, 'EVENTS', now)
    }
    return itemFromNewsSeed(seed, 'HEADLINES', now)
  }))

  const earthNews = newsItems.filter(item => item.category === 'EARTH')
  const earthItems = mergeCluster([...geoEarth, ...earthNews]).sort(compareIntelItems)

  const headlines = mergeCluster(newsItems.filter(item => item.category === 'HEADLINES' || item.category === 'EVENTS' || item.category === 'CONFLICT'))
    .map(item => ({ ...item, category: 'HEADLINES' as const }))
    .sort(compareIntelItems)

  const breaking = headlines
    .filter(item => classifyBreaking(item, Number.isFinite(nowMs) ? nowMs : Date.now()))
    .map(item => ({
      ...item,
      category: 'BREAKING' as const,
      eventType: 'breaking_news',
      breakingReason: item.breakingReason ?? `Multiple independent sources (${item.sourceCount}) published within two hours.`,
    }))
    .sort(compareIntelItems)

  const events = mergeCluster([
    ...newsItems.filter(item => item.category === 'EVENTS'),
    ...geoEarth.filter(item => item.eventType === 'traffic_event' || item.eventType === 'flood_event' || item.eventType === 'tropical_cyclone').map(item => ({ ...item, category: 'EVENTS' as const })),
  ]).sort(compareIntelItems)

  const conflictNews = mergeCluster([
    ...newsItems.filter(item => item.category === 'CONFLICT' || CONFLICT_TITLE_RE.test(item.headline)),
  ]).map(item => ({ ...item, category: 'CONFLICT' as const }))
    .sort(compareIntelItems)

  const compactPlace = compactLocalLabel({
    city: input.city,
    county: input.county,
    state: input.state,
    countryCode: input.countryCode,
    placeName: isDeviceOnlyPlaceLabel(placeLabel) ? null : placeLabel,
  }) ?? input.localIntel?.shortLabel ?? null
  const localScope = compactPlace ?? scopeLabel(placeLabel, lat, lon)

  const localNewsItems = (input.localIntel?.seeds ?? []).map(seed => {
    const freshnessState = newsSeedFreshness(seed, now, true)
    const base = itemFromNewsSeed(seed, 'LOCAL' as const, now)
    return {
      ...base,
      ...eventTimeFields({ timestamp: seed.publishedAt, now, lat, lon }),
      freshnessState,
      freshnessLabel: newsSeedFreshnessLabel(seed, freshnessState, now),
      coverageState: coverageFromFreshness(freshnessState),
      eventType: seed.localSourceType === 'WEATHER'
        ? 'severe_weather_alert'
        : seed.localSourceType === 'TRANSPORTATION'
          ? 'traffic_event'
          : seed.localSourceType === 'EVENTS'
            ? 'local_event'
            : 'local_news',
      localSourceType: seed.localSourceType ?? null,
      localServiceArea: seed.localServiceArea ?? null,
      localRelevance: seed.localRelevance ?? null,
    }
  })

  const localItems = mergeCluster([
    ...localGeoScored.map(row => ({
      ...row.item,
      category: 'LOCAL' as const,
      geoRelation: row.relevance.relation,
      distanceKm: row.relevance.distanceKm,
      radiusTier: row.relevance.radiusTier,
      localSourceType: row.item.eventType === 'severe_weather_alert'
        ? 'WEATHER'
        : row.item.eventType === 'traffic_event'
          ? 'TRANSPORTATION'
          : 'EVENTS',
      localServiceArea: compactPlace ?? localScope,
      localRelevance: row.relevance.distanceKm != null && row.relevance.distanceKm <= 12 ? 'Same city' : 'Nearby event',
    })),
    ...localNewsItems,
  ]).sort(compareIntelItems)

  const earthState = sectionState(earthItems, 'NO_COVERAGE', 'No projectable Earth-intel events in the current snapshot.', 'Physical/world-state feeds through existing Terra hazard adapters and official video channels.')
  const localState = resolveLocalSectionState({
    hasLocation,
    localScope,
    itemCount: localItems.length,
    localIntel: input.localIntel ?? null,
  })
  const headlineState = sectionState(
    headlines,
    input.newsCoverage ?? 'UNAVAILABLE',
    input.newsReason ?? 'No headline sources returned sourced items.',
    'Public RSS plus configured research providers; near-duplicate stories are clustered.',
  )
  const breakingState = sectionState(
    breaking,
    headlines.length ? 'NO_COVERAGE' : (input.newsCoverage ?? 'UNAVAILABLE'),
    'Nothing met breaking criteria (explicit source mark or multiple fresh independent sources). Recent is not automatically breaking.',
    'Breaking only when source evidence supports it.',
  )
  const eventState = sectionState(events, headlines.length ? 'NO_COVERAGE' : (input.newsCoverage ?? 'UNAVAILABLE'), 'No broader current-event items in this snapshot.', 'Descriptive current events from sourced feeds.')
  const conflictState = sectionState(
    conflictNews,
    input.conflictCoverage ?? 'NO_COVERAGE',
    input.conflictReason ?? 'No conflict-related items from wired public sources. No battlefield dataset is connected.',
    'Documented public reporting only. Not a combatant ranking or prediction.',
  )

  const makeSection = (id: TerraLiveIntelCategory, items: TerraLiveIntelItem[], state: { coverageState: TerraLiveIntelCoverageState; reason: string }): TerraLiveIntelSection => ({
    id,
    label: id === 'LOCAL' && compactPlace ? `LOCAL · ${compactPlace}` : SECTION_LABEL[id],
    count: items.length,
    displayCount: id === 'LOCAL' ? localSectionDisplayCount(state.coverageState, items.length, input.localIntel?.coverage) : String(items.length),
    coverageState: state.coverageState,
    reason: state.reason,
    items: sliceSectionItems(id, items).map(item => ({
      ...item,
      mediaPreview: sanitizeMediaPreviewForAuth(item.mediaPreview, input.authState ?? 'AUTHENTICATED'),
    })),
    sourceMix: id === 'LOCAL' ? (input.localIntel?.mix ?? mixFromLocalItems(items)) : undefined,
    runtimeHealth: id === 'LOCAL' ? (input.localIntel?.runtimeHealth ?? null) : undefined,
  })

  const zones = buildConflictZones(conflictNews)
  const worldTime = resolveTerraWorldTime({
    utcIso: now,
    latitude: hasLocation ? lat : null,
    longitude: hasLocation ? lon : null,
    place: placeLabel,
    nativePlaceName: placeNames.nativeName,
    englishPlaceName: placeNames.englishName,
  })

  return {
    fetchedAt: now,
    authState: input.authState ?? 'AUTHENTICATED',
    scope: {
      label: scopeLabel(placeLabel, lat, lon),
      latitude: hasLocation ? lat : null,
      longitude: hasLocation ? lon : null,
      place: placeLabel,
      nativePlaceName: placeNames.nativeName,
      englishPlaceName: placeNames.englishName,
      city: input.city ?? null,
      county: input.county ?? null,
      state: input.state ?? null,
      country: input.country ?? null,
      countryCode: input.countryCode ?? null,
      compactLabel: compactPlace,
      reverseSublocalityLabel: input.reverseSublocalityLabel?.trim() || null,
      zoomLevel: input.zoomLevel ?? null,
    },
    worldTime,
    worldClock: worldClockStrip(now, worldTime),
    sections: [
      makeSection('EARTH', earthItems, earthState),
      makeSection('LOCAL', localItems, localState),
      makeSection('HEADLINES', headlines, headlineState),
      makeSection('BREAKING', breaking, breakingState),
      makeSection('EVENTS', events, eventState),
      makeSection('CONFLICT', conflictNews, conflictState),
    ],
    zones,
  }
}

function buildConflictZones(items: TerraLiveIntelItem[]): TerraConflictZone[] {
  if (!items.length) return []
  const byRegion = new Map<string, TerraLiveIntelItem[]>()
  for (const item of items) {
    const name = item.location?.trim() || 'Unspecified region'
    const bucket = byRegion.get(name) ?? []
    bucket.push(item)
    byRegion.set(name, bucket)
  }
  return [...byRegion.entries()]
    .map(([name, members]) => {
      const latest = [...members].sort(compareIntelItems)[0]
      const coords = members.filter(item => item.lat !== null && item.lon !== null)
      const centroid = coords.length
        ? {
            lat: coords.reduce((sum, item) => sum + (item.lat as number), 0) / coords.length,
            lon: coords.reduce((sum, item) => sum + (item.lon as number), 0) / coords.length,
          }
        : null
      const zoneClock = centroid && (latest?.timestamp || latest?.retrievedAt)
        ? resolveTerraWorldTime({
            utcIso: latest?.timestamp ?? latest?.retrievedAt ?? '',
            latitude: centroid.lat,
            longitude: centroid.lon,
            place: name,
            sourceTimestamp: latest?.timestamp ?? null,
          })
        : null
      const names = resolvePlaceDisplayName({
        place: name,
        nativeName: latest?.nativeLocationName,
        englishName: latest?.englishLocationName,
      })
      return {
        name: names.displayLabel ?? name,
        region: name === 'Unspecified region' ? null : (names.displayLabel ?? name),
        centroid,
        boundingGeometry: null,
        status: (latest?.verificationState ?? 'REPORTED') as TerraConflictZone['status'],
        lastUpdated: latest?.timestamp ?? latest?.retrievedAt ?? null,
        localTime: latest?.localTime ?? zoneClock?.eventLocalTime ?? zoneClock?.localTime ?? null,
        timezone: latest?.timezone ?? zoneClock?.timeZone ?? null,
        utcOffset: latest?.utcOffset ?? zoneClock?.eventUtcOffset ?? zoneClock?.utcOffset ?? null,
        dayNightState: latest?.dayNightState ?? zoneClock?.dayNightState ?? null,
        sourceRefs: members.flatMap(item => item.sources).slice(0, 6),
        recentEvents: members.slice(0, 3).map(item => item.originalHeadline),
        coverageState: 'PARTIAL' as const,
        uncertainty: centroid
          ? 'Country/region centroid from sourced reporting only — not a battlefield boundary.'
          : 'Country/region name from sourced reporting only. No geometry is available; none is invented.',
        nativeName: names.nativeName,
        englishName: names.englishName,
      }
    })
    .sort((a, b) => (b.lastUpdated ?? '').localeCompare(a.lastUpdated ?? ''))
    .slice(0, 8)
}

const KIND_SET = new Set<string>([
  'earthquake',
  'tropical_cyclone',
  'wildfire_incident',
  'volcano_event',
  'flood_event',
  'severe_weather_alert',
  'tsunami_alert',
  'traffic_event',
  'aircraft_state',
  'vessel_position',
])

export function intelItemToGeoFeature(item: TerraLiveIntelItem): TerraGeoFeature | null {
  if (item.lat === null || item.lon === null) return null
  if (!isValidLiveCoordinate(item.lat, item.lon)) return null
  if (!item.sourceUrl && !item.relatedEvidenceIds.length) return null
  const kind = (KIND_SET.has(item.eventType ?? '') ? item.eventType : 'place') as TerraIntelligenceEventKind
  const providerId = item.provider as ResearchProviderId
  const provenance: TerraProvenance = {
    provider: providerId,
    sourceUrl: item.sourceUrl,
    retrievedAt: item.retrievedAt,
    fromCache: item.freshnessState === 'CACHED',
    isHistorical: item.freshnessState === 'HISTORICAL' || item.freshnessState === 'STALE' || item.freshnessState === 'STALE_LAST_GOOD',
  }
  return {
    id: item.id,
    eventId: item.id,
    providerId,
    kind,
    longitude: item.lon,
    latitude: item.lat,
    altitude: null,
    timestamp: item.timestamp,
    title: item.originalHeadline,
    summary: item.summary,
    properties: {
      liveIntelCategory: item.category,
      eventType: item.eventType,
      sourceCount: item.sourceCount,
      verificationState: item.verificationState,
    },
    provenance,
    rawReference: { documentId: item.relatedEvidenceIds[0] ?? item.id, providerRecordId: item.id, canonicalUrl: item.sourceUrl },
    coordinateOrigin: item.coordinateOrigin === 'observed' || item.coordinateOrigin === 'source_embedded' || item.coordinateOrigin === 'resolved'
      ? item.coordinateOrigin
      : 'source_embedded',
    geoResolution: null,
    geometryKind: 'point',
    regionRings: null,
    pathCoordinates: null,
  }
}

export function overlayFeaturesFromPanel(
  panel: TerraEarthIntelPanelSnapshot,
  existingIds: Set<string>,
): TerraGeoFeature[] {
  const features: TerraGeoFeature[] = []
  for (const section of panel.sections) {
    if (section.id === 'HEADLINES' || section.id === 'BREAKING') continue
    for (const item of section.items) {
      if (existingIds.has(item.id)) continue
      const feature = intelItemToGeoFeature(item)
      if (!feature) continue
      features.push(feature)
      if (features.length >= TERRA_LIVE_INTEL_OVERLAY_CAP) return features
    }
  }
  return features
}

export function findPanelItem(panel: TerraEarthIntelPanelSnapshot | null | undefined, id: string | null | undefined): TerraLiveIntelItem | null {
  if (!panel || !id) return null
  for (const section of panel.sections) {
    const match = section.items.find(item => item.id === id)
    if (match) return match
  }
  return null
}
