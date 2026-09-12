/**
 * Roadmap #12 — Live Globe Intel composition.
 *
 * Terra remains the visualization/retrieval surface. This module does not create a second globe,
 * a second event model, or a second provider client. It projects existing TerraIntelligenceEvent /
 * TerraGeoFeature / evidence / settlement records into one bounded, secret-stripped live-intel
 * object with truthful freshness.
 *
 * LIVE is never inferred from adapter registration. Credential/hardware/historical
 * blockers stay as precise states (NEEDS_CREDENTIALS, NEEDS_LOCAL_SENSOR, HISTORICAL,
 * NOT_IMPLEMENTED) — never a catch-all NOT_CONFIGURED, and never UNAVAILABLE for
 * NO_COVERAGE or EMPTY.
 */
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import type { SettlementRecord } from '@/lib/settlement-intelligence/types'
import { isTerraVesselStale } from './vesselStaleness'
import type { TerraGeoFeature, TerraIntelligenceEvent, TerraIntelligenceEventKind, TerraTimeWindow } from './types'
import {
  aggregateVesselLayerFreshness,
  layerReason,
  listMaritimeLiveProviderStatuses as listMaritimeStatusesFromRegistry,
  maritimeProviderLiveStatus as maritimeStatusFromRecord,
} from './maritimeProviderStatus'

export const TERRA_LIVE_FRESHNESS_STATES = [
  'LIVE',
  'DELAYED',
  'CACHED',
  'STALE',
  'EMPTY',
  'NO_COVERAGE',
  'READY',
  'NEEDS_CREDENTIALS',
  'NEEDS_LOCAL_SENSOR',
  'NEEDS_COMMERCIAL_ACCOUNT',
  'HISTORICAL',
  'NOT_IMPLEMENTED',
  'DISABLED',
  'UNAVAILABLE',
  'AUTH_FAILED',
  'NOT_CONFIGURED',
] as const
export type TerraLiveFreshness = (typeof TERRA_LIVE_FRESHNESS_STATES)[number]

export const TERRA_LIVE_LAYER_IDS = ['vessels', 'intelligence_events', 'settlement_events', 'other'] as const
export type TerraLiveLayerId = (typeof TERRA_LIVE_LAYER_IDS)[number]

export const TERRA_LIVE_INTEL_BROWSER_CAP = 250
export const TERRA_LIVE_INTEL_PER_LAYER_CAP = 150

export const TERRA_INTELLIGENCE_EVENT_LAYER_KINDS: ReadonlySet<TerraIntelligenceEventKind> = new Set([
  'earthquake',
  'tropical_cyclone',
  'wildfire_incident',
  'volcano_event',
  'flood_event',
  'severe_weather_alert',
  'tsunami_alert',
])

const SECRET_KEY_RE = /^(api[_-]?key|authorization|auth|token|secret|password|cookie|credential|private[_-]?key|access[_-]?token|refresh[_-]?token|commander|userId|user_id|requestedBy)$/i
const SECRET_VALUE_RE = /\b(Bearer\s+\S+|sk-[A-Za-z0-9]+|xai-[A-Za-z0-9]+|AIza[A-Za-z0-9_\-]+)\b/i

export type TerraLiveDiscoveryProvenance = {
  discoveredVia: string | null
  alsoDiscoveredVia: string[]
  upstreamEngines: string[]
  storageOrigin: string | null
}

export type TerraLiveGeoObject = {
  id: string
  layer: TerraLiveLayerId
  type: string
  category: string
  title: string
  summary: string | null
  latitude: number
  longitude: number
  observedAt: string | null
  receivedAt: string
  provider: string
  publisherFamily: string | null
  sourceFamily: string | null
  evidenceId: string | null
  discoveryProvenance: TerraLiveDiscoveryProvenance
  country: string | null
  region: string | null
  jurisdiction: string | null
  freshness: TerraLiveFreshness
  confidence: number | null
  sourceUrl: string | null
  coordinateOrigin: string | null
  /** Stable identity for vessel merge (MMSI). Never used for Build #6 news/evidence independence. */
  identityKey: string | null
}

export type TerraLiveProviderStatus = {
  id: string
  displayName: string
  layer: TerraLiveLayerId
  implemented: boolean
  configurationState: string
  freshness: TerraLiveFreshness
  reason: string
  objectCount: number
  /** Client-safe boolean only — never the credential value. */
  credentialsPresent?: boolean
}

export type TerraLiveLayerStatus = {
  id: TerraLiveLayerId
  freshness: TerraLiveFreshness
  objectCount: number
  reason: string
}

export type TerraLiveIntelSnapshot = {
  fetchedAt: string
  objects: TerraLiveGeoObject[]
  layers: TerraLiveLayerStatus[]
  providers: TerraLiveProviderStatus[]
  truncated: boolean
}

export type TerraLiveFreshnessInput = {
  implemented: boolean
  configuredForLive: boolean
  fetchOk: boolean
  fromCache: boolean
  isHistorical: boolean
  delayedFeed: boolean
  observedAt: string | null
  now: string
  staleAfterMs?: number
}

export function isValidLiveCoordinate(latitude: unknown, longitude: unknown): boolean {
  return (
    typeof latitude === 'number'
    && typeof longitude === 'number'
    && Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180
  )
}

function parseLiveCoordinate(latitude: unknown, longitude: unknown): { latitude: number; longitude: number } | null {
  if (!isValidLiveCoordinate(latitude, longitude)) return null
  return { latitude: latitude as number, longitude: longitude as number }
}

export function liveLayerForKind(kind: TerraIntelligenceEventKind): TerraLiveLayerId {
  if (kind === 'vessel_position') return 'vessels'
  if (TERRA_INTELLIGENCE_EVENT_LAYER_KINDS.has(kind)) return 'intelligence_events'
  return 'other'
}

export function resolveTerraLiveFreshness(input: TerraLiveFreshnessInput): TerraLiveFreshness {
  if (!input.implemented) return 'NOT_IMPLEMENTED'
  if (!input.configuredForLive) return 'NEEDS_CREDENTIALS'
  if (!input.fetchOk && input.delayedFeed) return 'DELAYED'
  if (!input.fetchOk) return 'UNAVAILABLE'
  if (input.isHistorical) return 'HISTORICAL'
  if (input.observedAt && isTerraVesselStale(input.observedAt, input.now, input.staleAfterMs ?? 24 * 60 * 60 * 1000)) {
    return 'STALE'
  }
  if (input.fromCache) return 'CACHED'
  return 'LIVE'
}

export function liveFreshnessFromFeed(input: {
  enabled: boolean
  feedState: 'loading' | 'live' | 'empty' | 'error' | 'stale'
  fromCache?: boolean
  allHistorical?: boolean
  noCoverage?: boolean
}): TerraLiveFreshness {
  if (input.noCoverage) return 'NO_COVERAGE'
  if (!input.enabled) return 'READY'
  if (input.feedState === 'loading') return 'READY'
  if (input.feedState === 'error') return 'UNAVAILABLE'
  if (input.feedState === 'stale') return 'DELAYED'
  if (input.allHistorical) return 'HISTORICAL'
  if (input.feedState === 'empty') return 'EMPTY'
  if (input.fromCache) return 'CACHED'
  if (input.feedState === 'live') return 'LIVE'
  return 'UNAVAILABLE'
}

export function maritimeProviderLiveStatus(
  record: Parameters<typeof maritimeStatusFromRecord>[0],
  objectCount = 0,
  fetchFreshness?: TerraLiveFreshness,
): TerraLiveProviderStatus {
  return maritimeStatusFromRecord(record, { objectCount, fetchFreshness })
}

export function listMaritimeLiveProviderStatuses(opts?: {
  digitrafficObjectCount?: number
  digitrafficFreshness?: TerraLiveFreshness
}): TerraLiveProviderStatus[] {
  return listMaritimeStatusesFromRegistry({
    digitraffic_marine: {
      objectCount: opts?.digitrafficObjectCount ?? 0,
      fetchFreshness: opts?.digitrafficFreshness,
    },
  })
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function vesselIdentityKey(kind: string, mmsi: unknown): string | null {
  if (kind !== 'vessel_position') return null
  const value = typeof mmsi === 'string' ? mmsi.trim() : typeof mmsi === 'number' && Number.isFinite(mmsi) ? String(mmsi) : ''
  return value ? `mmsi:${value}` : null
}

function pointFromEvent(event: TerraIntelligenceEvent): { latitude: number; longitude: number; origin: string } | null {
  const geo = event.geography
  if (!geo) return null
  if (geo.kind === 'point') {
    if (!isValidLiveCoordinate(geo.latitude, geo.longitude)) return null
    return { latitude: geo.latitude, longitude: geo.longitude, origin: geo.coordinateOrigin }
  }
  if (geo.kind === 'region') {
    const ring = geo.rings[0]
    if (!ring || ring.length < 3) return null
    const sum = ring.reduce((acc, [lon, lat]) => ({ lon: acc.lon + lon, lat: acc.lat + lat }), { lon: 0, lat: 0 })
    const longitude = sum.lon / ring.length
    const latitude = sum.lat / ring.length
    if (!isValidLiveCoordinate(latitude, longitude)) return null
    return { latitude, longitude, origin: geo.coordinateOrigin }
  }
  const coords = geo.coordinates
  if (!coords.length) return null
  const sum = coords.reduce((acc, [lon, lat]) => ({ lon: acc.lon + lon, lat: acc.lat + lat }), { lon: 0, lat: 0 })
  const longitude = sum.lon / coords.length
  const latitude = sum.lat / coords.length
  if (!isValidLiveCoordinate(latitude, longitude)) return null
  return { latitude, longitude, origin: geo.coordinateOrigin }
}

export function normalizeLiveGeoFromEvent(
  event: TerraIntelligenceEvent,
  freshnessInput: Omit<TerraLiveFreshnessInput, 'observedAt' | 'fromCache' | 'isHistorical'> & { now: string },
): TerraLiveGeoObject | null {
  const point = pointFromEvent(event)
  if (!point) return null
  const observedAt = event.observedAt ?? event.publishedAt ?? event.updatedAt
  const freshness = resolveTerraLiveFreshness({
    ...freshnessInput,
    fromCache: event.provenance.fromCache,
    isHistorical: event.provenance.isHistorical || event.temporalStatus === 'historical',
    observedAt,
    staleAfterMs: event.kind === 'vessel_position' ? 10 * 60 * 1000 : freshnessInput.staleAfterMs,
  })
  const evidenceId = event.rawReference.documentId ?? event.rawReference.providerRecordId ?? event.id
  return {
    id: event.id,
    layer: liveLayerForKind(event.kind),
    type: event.kind,
    category: event.domain,
    title: event.title,
    summary: event.summary,
    latitude: point.latitude,
    longitude: point.longitude,
    observedAt,
    receivedAt: event.provenance.retrievedAt,
    provider: event.providerId,
    publisherFamily: asString(event.properties.publisherFamily) ?? asString(event.properties.sourceName) ?? event.providerId,
    sourceFamily: asString(event.properties.sourceFamily) ?? event.providerId,
    evidenceId,
    discoveryProvenance: {
      discoveredVia: asString(event.properties.discoveredVia) ?? event.providerId,
      alsoDiscoveredVia: [],
      upstreamEngines: [],
      storageOrigin: asString(event.properties.storageOrigin),
    },
    country: asString(event.properties.country),
    region: asString(event.properties.region) ?? asString(event.properties.affected_region),
    jurisdiction: asString(event.properties.jurisdiction),
    freshness,
    confidence: event.evidence?.source === 'intelligence_confidence_tier' ? null : asNumber(event.properties.confidence),
    sourceUrl: event.provenance.sourceUrl ?? event.rawReference.canonicalUrl,
    coordinateOrigin: point.origin,
    identityKey: vesselIdentityKey(event.kind, event.properties.mmsi),
  }
}

export function normalizeLiveGeoFromFeature(
  feature: TerraGeoFeature,
  freshnessInput: Omit<TerraLiveFreshnessInput, 'observedAt' | 'fromCache' | 'isHistorical'>,
): TerraLiveGeoObject | null {
  if (!isValidLiveCoordinate(feature.latitude, feature.longitude)) return null
  const observedAt = feature.timestamp
  const freshness = resolveTerraLiveFreshness({
    ...freshnessInput,
    fromCache: feature.provenance.fromCache,
    isHistorical: feature.provenance.isHistorical,
    observedAt,
    staleAfterMs: feature.kind === 'vessel_position' ? 10 * 60 * 1000 : freshnessInput.staleAfterMs,
  })
  const evidenceId = feature.rawReference.documentId ?? feature.rawReference.providerRecordId ?? feature.eventId
  return {
    id: feature.id,
    layer: liveLayerForKind(feature.kind),
    type: feature.kind,
    category: feature.kind,
    title: feature.title,
    summary: feature.summary,
    latitude: feature.latitude,
    longitude: feature.longitude,
    observedAt,
    receivedAt: feature.provenance.retrievedAt,
    provider: feature.providerId,
    publisherFamily: asString(feature.properties.publisherFamily) ?? feature.providerId,
    sourceFamily: asString(feature.properties.sourceFamily) ?? feature.providerId,
    evidenceId,
    discoveryProvenance: {
      discoveredVia: asString(feature.properties.discoveredVia) ?? feature.providerId,
      alsoDiscoveredVia: Array.isArray(feature.properties.alsoDiscoveredVia)
        ? feature.properties.alsoDiscoveredVia.filter((value): value is string => typeof value === 'string')
        : [],
      upstreamEngines: [],
      storageOrigin: asString(feature.properties.storageOrigin),
    },
    country: asString(feature.properties.country),
    region: asString(feature.properties.region) ?? asString(feature.properties.affected_region),
    jurisdiction: asString(feature.properties.jurisdiction),
    freshness,
    confidence: asNumber(feature.properties.confidence),
    sourceUrl: feature.provenance.sourceUrl ?? feature.rawReference.canonicalUrl,
    coordinateOrigin: feature.coordinateOrigin,
    identityKey: vesselIdentityKey(feature.kind, feature.properties.mmsi),
  }
}

function evidenceCoordinates(item: IntelligenceEvidenceItem): { latitude: number; longitude: number } | null {
  const record = item as IntelligenceEvidenceItem & { latitude?: unknown; longitude?: unknown }
  return parseLiveCoordinate(record.latitude, record.longitude)
}

export function normalizeLiveGeoFromEvidence(
  item: IntelligenceEvidenceItem,
  freshnessInput: TerraLiveFreshnessInput,
): TerraLiveGeoObject | null {
  const point = evidenceCoordinates(item)
  if (!point) return null
  return {
    id: item.id,
    layer: 'intelligence_events',
    type: item.source_type,
    category: 'research',
    title: item.title,
    summary: item.claim || item.content.slice(0, 280) || null,
    latitude: point.latitude,
    longitude: point.longitude,
    observedAt: item.published_at ?? item.observed_at,
    receivedAt: item.observed_at,
    provider: item.discovered_via ?? item.source_id,
    publisherFamily: item.publisher_family ?? item.source_family ?? item.source_label,
    sourceFamily: item.source_family ?? null,
    evidenceId: item.id,
    discoveryProvenance: {
      discoveredVia: item.discovered_via ?? null,
      alsoDiscoveredVia: item.also_discovered_via ?? [],
      upstreamEngines: item.upstream_engines ?? [],
      storageOrigin: item.storage_origin ?? null,
    },
    country: item.country ?? null,
    region: item.region ?? null,
    jurisdiction: item.jurisdiction ?? null,
    freshness: resolveTerraLiveFreshness({ ...freshnessInput, observedAt: item.published_at ?? item.observed_at }),
    confidence: Number.isFinite(item.confidence) ? item.confidence : null,
    sourceUrl: item.canonical_url ?? item.url ?? null,
    coordinateOrigin: 'source_embedded',
    identityKey: null,
  }
}

export function normalizeLiveGeoFromSettlement(record: SettlementRecord): TerraLiveGeoObject | null {
  const terms = record.terms as SettlementRecord['terms'] & { latitude?: unknown; longitude?: unknown }
  const point = parseLiveCoordinate(terms.latitude, terms.longitude)
  if (!point) return null
  return {
    id: record.id,
    layer: 'settlement_events',
    type: 'settlement',
    category: 'opportunity',
    title: record.name,
    summary: record.terms.court,
    latitude: point.latitude,
    longitude: point.longitude,
    observedAt: record.updatedAt,
    receivedAt: record.discoveredAt,
    provider: 'settlement_intelligence',
    publisherFamily: record.officialSourceState,
    sourceFamily: record.provenance[0]?.kind ?? 'AGGREGATOR',
    evidenceId: record.id,
    discoveryProvenance: {
      discoveredVia: 'settlement_intelligence',
      alsoDiscoveredVia: [],
      upstreamEngines: [],
      storageOrigin: null,
    },
    country: null,
    region: null,
    jurisdiction: record.terms.court,
    freshness: 'STALE',
    confidence: null,
    sourceUrl: record.officialUrl ?? record.aggregatorUrl,
    coordinateOrigin: 'source_embedded',
    identityKey: null,
  }
}

export function liveGeoDedupeKey(object: TerraLiveGeoObject): string {
  if (object.layer === 'vessels' && object.identityKey) return `vessels:${object.identityKey}`
  if (object.evidenceId) return `${object.layer}:${object.evidenceId}`
  return `${object.layer}:${object.provider}:${object.id}`
}

function observationTimeMs(object: TerraLiveGeoObject): number {
  const raw = object.observedAt ?? object.receivedAt
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : 0
}

export function collapseLiveGeoDuplicates(objects: TerraLiveGeoObject[]): TerraLiveGeoObject[] {
  const byKey = new Map<string, TerraLiveGeoObject>()
  for (const object of objects) {
    const key = liveGeoDedupeKey(object)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, object)
      continue
    }
    const newer = observationTimeMs(object) > observationTimeMs(existing) ? object : existing
    const older = newer === object ? existing : object
    const also = new Set([
      ...existing.discoveryProvenance.alsoDiscoveredVia,
      ...object.discoveryProvenance.alsoDiscoveredVia,
    ])
    if (older.discoveryProvenance.discoveredVia && older.discoveryProvenance.discoveredVia !== newer.discoveryProvenance.discoveredVia) {
      also.add(older.discoveryProvenance.discoveredVia)
    }
    if (object.provider !== existing.provider) also.add(object.provider === newer.provider ? existing.provider : object.provider)
    const engines = [...new Set([
      ...existing.discoveryProvenance.upstreamEngines,
      ...object.discoveryProvenance.upstreamEngines,
    ])]
    byKey.set(key, {
      ...newer,
      discoveryProvenance: {
        ...newer.discoveryProvenance,
        alsoDiscoveredVia: [...also].filter(value => value && value !== newer.discoveryProvenance.discoveredVia),
        upstreamEngines: engines,
      },
    })
  }
  return [...byKey.values()]
}

export function filterLiveGeoByTimeWindow(
  objects: TerraLiveGeoObject[],
  nowIso: string,
  window: TerraTimeWindow,
): TerraLiveGeoObject[] {
  if (!window) return objects
  const nowMs = Date.parse(nowIso)
  if (!Number.isFinite(nowMs)) return objects
  return objects.filter(object => {
    if (!object.observedAt) return false
    const observedMs = Date.parse(object.observedAt)
    if (!Number.isFinite(observedMs)) return false
    const delta = observedMs - nowMs
    if (window.lookbackMs > 0 && -delta > window.lookbackMs) return false
    if (window.lookaheadMs > 0 && delta > window.lookaheadMs) return false
    if (window.lookaheadMs === 0 && delta > 0) return false
    return true
  })
}

export function compareLiveGeoObjects(a: TerraLiveGeoObject, b: TerraLiveGeoObject): number {
  const aTime = a.observedAt ?? a.receivedAt
  const bTime = b.observedAt ?? b.receivedAt
  if (aTime !== bTime) return aTime < bTime ? 1 : -1
  if (a.provider !== b.provider) return a.provider.localeCompare(b.provider)
  return a.id.localeCompare(b.id)
}

export function stripLiveIntelSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => stripLiveIntelSecrets(item)) as T
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && SECRET_VALUE_RE.test(value)) return '[redacted]' as T
    return value
  }
  const out: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(key)) continue
    out[key] = stripLiveIntelSecrets(nested)
  }
  return out as T
}

export type ComposeTerraLiveIntelInput = {
  now: string
  events?: TerraIntelligenceEvent[]
  features?: TerraGeoFeature[]
  evidence?: IntelligenceEvidenceItem[]
  settlements?: SettlementRecord[]
  layers?: TerraLiveLayerId[]
  timeWindow?: TerraTimeWindow
  cap?: number
  perLayerCap?: number
  freshnessDefaults: Omit<TerraLiveFreshnessInput, 'observedAt' | 'fromCache' | 'isHistorical'>
  providerStatuses?: TerraLiveProviderStatus[]
}

export function composeTerraLiveIntel(input: ComposeTerraLiveIntelInput): TerraLiveIntelSnapshot {
  const layers = new Set(input.layers?.length ? input.layers : TERRA_LIVE_LAYER_IDS)
  const cap = Math.max(1, Math.min(input.cap ?? TERRA_LIVE_INTEL_BROWSER_CAP, TERRA_LIVE_INTEL_BROWSER_CAP))
  const perLayerCap = Math.max(1, Math.min(input.perLayerCap ?? TERRA_LIVE_INTEL_PER_LAYER_CAP, TERRA_LIVE_INTEL_PER_LAYER_CAP))
  const defaults = input.freshnessDefaults
  const collected: TerraLiveGeoObject[] = []

  for (const event of input.events ?? []) {
    const object = normalizeLiveGeoFromEvent(event, defaults)
    if (object) collected.push(object)
  }
  for (const feature of input.features ?? []) {
    const object = normalizeLiveGeoFromFeature(feature, defaults)
    if (object) collected.push(object)
  }
  for (const item of input.evidence ?? []) {
    const object = normalizeLiveGeoFromEvidence(item, {
      ...defaults,
      observedAt: item.published_at ?? item.observed_at,
      fromCache: false,
      isHistorical: false,
    })
    if (object) collected.push(object)
  }
  for (const record of input.settlements ?? []) {
    const object = normalizeLiveGeoFromSettlement(record)
    if (object) collected.push(object)
  }

  const filtered = collapseLiveGeoDuplicates(collected)
    .filter(object => layers.has(object.layer))
  const windowed = filterLiveGeoByTimeWindow(filtered, input.now, input.timeWindow ?? null)
  windowed.sort(compareLiveGeoObjects)

  const perLayer: Record<TerraLiveLayerId, TerraLiveGeoObject[]> = {
    vessels: [],
    intelligence_events: [],
    settlement_events: [],
    other: [],
  }
  for (const object of windowed) {
    const bucket = perLayer[object.layer]
    if (bucket.length < perLayerCap) bucket.push(object)
  }

  const uncapped = TERRA_LIVE_LAYER_IDS.flatMap(id => perLayer[id])
  const objects = stripLiveIntelSecrets(uncapped.slice(0, cap))
  const truncated = windowed.length > objects.length

  const layerStatuses: TerraLiveLayerStatus[] = TERRA_LIVE_LAYER_IDS.map(id => {
    const count = objects.filter(object => object.layer === id).length
    const sample = objects.find(object => object.layer === id)
    const enabled = layers.has(id)
    let freshness: TerraLiveFreshness = 'UNAVAILABLE'
    if (!enabled) freshness = 'DISABLED'
    else if (id === 'settlement_events' && count === 0) freshness = 'UNAVAILABLE'
    else if (id === 'vessels') {
      freshness = aggregateVesselLayerFreshness(input.providerStatuses ?? listMaritimeLiveProviderStatuses({
        digitrafficObjectCount: count,
        digitrafficFreshness: sample?.freshness,
      }), true)
    }
    else if (sample) freshness = sample.freshness
    return { id, freshness, objectCount: count, reason: !enabled
      ? 'Layer not requested'
      : id === 'settlement_events' && freshness === 'UNAVAILABLE'
        ? 'Settlement records have no projectable coordinates; coordinates are never invented.'
        : layerReason(freshness, count) }
  })

  const providers = stripLiveIntelSecrets(input.providerStatuses ?? listMaritimeLiveProviderStatuses({
    digitrafficObjectCount: objects.filter(o => o.provider === 'digitraffic_marine').length,
    digitrafficFreshness: objects.find(o => o.provider === 'digitraffic_marine')?.freshness,
  }))

  return {
    fetchedAt: input.now,
    objects,
    layers: layerStatuses,
    providers,
    truncated,
  }
}
