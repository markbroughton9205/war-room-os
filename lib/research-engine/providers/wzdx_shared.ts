import 'server-only'

/**
 * Shared WZDx (Work Zone Data Exchange) feed parsing — God's Eye Phase 3. One reusable core for
 * every state-DOT-published WZDx GeoJSON feed (wzdx_wsdot, wzdx_iowa_dot, wzdx_kytc this phase),
 * so per-feed adapters are a thin PROVIDER/URL/attribution wrapper rather than three copies of
 * the spec parsing.
 *
 * Version tolerance is deliberate and based on real feeds fetched live this build, not assumed
 * uniformity:
 *   - v4.x feeds nest common fields under properties.core_details (road_names, direction,
 *     description, creation_date, update_date, start_date, end_date, ...); v3.x-era feeds keep
 *     them flat on properties. Both shapes were observed in the real feeds tested this build
 *     (WSDOT v4.2, Iowa DOT v4.0, KYTC v4.1 all use core_details; the flat fallback exists for
 *     the documented v3.1 convention).
 *   - The feed-info key varies: road_event_feed_info is the v4-documented key; some feeds also
 *     emit feed_info. Both are read.
 *   - Geometry varies across LineString / MultiPoint / Point — all three are preserved verbatim
 *     as JSON in identifiers.rawGeography for the Terra normalizer, never collapsed.
 *   - Feed timestamps are ISO strings; a feed-level update_date is real source data and is
 *     preserved per-document.
 */
import type { ResearchDocument, ResearchProviderId } from '@/lib/research-engine/core/types'
import { safeJsonParse, safeProviderFetch } from '@/lib/research-engine/security/safeFetch'
import { makeDocument, okResponse } from '@/lib/research-engine/providers/shared'
import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'

export const BBOX_PATTERN = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/

export type WzdxFeedDefinition = {
  provider: ResearchProviderId
  feedUrl: string
  sourceName: string
  organization: string
  license: string
  exampleBbox: string
}

type WzdxGeometry = { type?: string; coordinates?: unknown }
type WzdxFeature = { id?: string | number; properties?: Record<string, unknown>; geometry?: WzdxGeometry }
type WzdxFeedPayload = {
  features?: WzdxFeature[]
  road_event_feed_info?: { update_date?: string; version?: string; publisher?: string }
  feed_info?: { update_date?: string; version?: string; publisher?: string }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function isoDate(value: unknown): string | null {
  const raw = str(value)
  if (!raw) return null
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function coordinatesWithinBbox(coordinates: unknown, lamin: number, lomin: number, lamax: number, lomax: number): boolean {
  if (!Array.isArray(coordinates)) return false
  // Point: [lon, lat]; MultiPoint/LineString: [[lon, lat], ...]
  const pairs: unknown[] = typeof coordinates[0] === 'number' ? [coordinates] : coordinates
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length < 2) continue
    const [lon, lat] = pair as number[]
    if (typeof lon !== 'number' || typeof lat !== 'number') continue
    if (lat >= lamin && lat <= lamax && lon >= lomin && lon <= lomax) return true
  }
  return false
}

export async function searchWzdxFeed(feed: WzdxFeedDefinition, queryText: string, maxResults: number | undefined) {
  const started = Date.now()
  const match = BBOX_PATTERN.exec(queryText.trim())
  if (!match) {
    throw new Error(`Query must be a bounding box "lamin,lomin,lamax,lomax" (e.g. "${feed.exampleBbox}").`)
  }
  const [, laminStr, lominStr, lamaxStr, lomaxStr] = match
  const [lamin, lomin, lamax, lomax] = [laminStr, lominStr, lamaxStr, lomaxStr].map(Number)
  const limit = Math.max(1, Math.min(maxResults ?? 60, 100))
  const cacheKey = `${feed.provider}:${queryText.trim()}:${limit}`
  const cached = cacheGet<ReturnType<typeof okResponse>>(cacheKey)
  if (cached) return { ok: true as const, response: { ...cached, fromCache: true } }

  const result = await safeProviderFetch(feed.provider, feed.feedUrl, { timeoutMs: 30_000, maxResponseBytes: 8 * 1024 * 1024 })
  if (!result.ok) return { ok: false as const, kind: 'http_error' as const, status: result.status }
  const payload = safeJsonParse<WzdxFeedPayload>(result.text)
  if (!payload || !Array.isArray(payload.features)) {
    return { ok: false as const, kind: 'malformed' as const, message: `${feed.sourceName} response was not a valid WZDx GeoJSON FeatureCollection.` }
  }
  const feedInfo = payload.road_event_feed_info ?? payload.feed_info ?? {}
  const feedUpdatedAtIso = isoDate(feedInfo.update_date)

  const documents: ResearchDocument[] = []
  for (const feature of payload.features) {
    if (documents.length >= limit) break
    const geometry = feature.geometry
    if (!geometry || typeof geometry.type !== 'string' || !coordinatesWithinBbox(geometry.coordinates, lamin, lomin, lamax, lomax)) continue
    const props = feature.properties ?? {}
    const core = (props.core_details && typeof props.core_details === 'object' ? props.core_details : props) as Record<string, unknown>
    const eventId = str(props.id) ?? (feature.id != null ? String(feature.id) : '')
    if (!eventId) continue

    const roadNames = Array.isArray(core.road_names) ? (core.road_names as unknown[]).map(String).filter(Boolean) : []
    const startDateIso = isoDate(core.start_date)
    const endDateIso = isoDate(core.end_date)
    const updatedAtIso = isoDate(core.update_date) ?? feedUpdatedAtIso

    documents.push(makeDocument({
      id: `${feed.provider}:${eventId}`,
      provider: feed.provider,
      providerRecordId: eventId,
      title: str(core.description) ?? `Work zone ${eventId}${roadNames.length ? ` — ${roadNames.join(', ')}` : ''}`,
      summary: roadNames.length ? roadNames.join(', ') : null,
      contentSnippet: [str(core.direction), str(core.vehicle_impact)].filter(Boolean).join(' · '),
      canonicalUrl: feed.feedUrl,
      sourceUrl: feed.feedUrl,
      sourceName: feed.sourceName,
      contentType: 'traffic_event',
      authors: [],
      organization: feed.organization,
      publishedAt: startDateIso,
      updatedAt: updatedAtIso,
      geography: null,
      language: 'en',
      identifiers: {
        eventId,
        eventType: 'work_zone',
        rawGeography: JSON.stringify(geometry),
        wzdxVersion: str(feedInfo.version) ?? '',
        ...(roadNames.length ? { road: roadNames.join(', ') } : {}),
        ...(str(core.direction) ? { direction: str(core.direction)! } : {}),
        ...(str(core.vehicle_impact) ? { vehicleImpact: str(core.vehicle_impact)! } : {}),
        ...(startDateIso ? { startDateIso } : {}),
        ...(endDateIso ? { endDateIso } : {}),
        ...(updatedAtIso ? { updatedAtIso } : {}),
        ...(feedUpdatedAtIso ? { feedUpdatedAtIso } : {}),
      },
      subjects: [],
      license: feed.license,
      accessStatus: 'open',
    }))
  }

  const response = okResponse(feed.provider, { documents, durationMs: Date.now() - started })
  cacheSet(cacheKey, response, CACHE_TTL.liveFeed)
  return { ok: true as const, response }
}
