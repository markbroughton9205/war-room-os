import 'server-only'

import { cacheGet, cacheSet, CACHE_TTL } from '@/lib/research-engine/cache/ttlCache'
import type { EarthPulseQuakeEvent } from './types'
import { EARTH_PULSE_QUAKE_CAP } from './types'
import { USGS_QUAKE_FEED_URL, USGS_SOURCE } from './sources'
import { fetchText } from './shared'
import { classifyFreshness } from './freshness'
import { isFreshEarthquakePulse } from './client'

const CACHE_KEY = 'terra-earth-pulse-usgs-4.5-day'

type GeoFeature = {
  id?: string
  properties?: {
    mag?: number | null
    place?: string | null
    time?: number
    updated?: number | null
    url?: string | null
  }
  geometry?: { coordinates?: unknown }
}

type GeoCollection = { metadata?: { generated?: number; title?: string }; features?: GeoFeature[] }

function isoFromEpoch(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const iso = new Date(value).toISOString()
  return Number.isNaN(Date.parse(iso)) ? null : iso
}

function lonLatDepth(coordinates: unknown): { lon: number; lat: number; depthKm: number | null } | null {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null
  const lon = coordinates[0]
  const lat = coordinates[1]
  const depth = coordinates[2]
  if (typeof lon !== 'number' || typeof lat !== 'number') return null
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null
  return {
    lon,
    lat,
    depthKm: typeof depth === 'number' && Number.isFinite(depth) ? depth : null,
  }
}

export async function loadUsgsEarthquakePulses(terraTime: string): Promise<{
  events: EarthPulseQuakeEvent[]
  observedAt: string | null
  generatedAt: string | null
  truthState: ReturnType<typeof classifyFreshness>
  error: string | null
  sourceUrl: string
}> {
  const cached = cacheGet<{ events: EarthPulseQuakeEvent[]; generatedAt: string | null }>(CACHE_KEY)
  let events: EarthPulseQuakeEvent[] = cached?.events ?? []
  let generatedAt = cached?.generatedAt ?? null
  let error: string | null = null
  let fetchOk = Boolean(cached)

  if (!cached) {
    const result = await fetchText(USGS_QUAKE_FEED_URL, 12_000)
    if (!result.ok) {
      error = result.message
      fetchOk = false
    } else {
      try {
        const parsed = JSON.parse(result.text) as GeoCollection
        generatedAt = isoFromEpoch(parsed.metadata?.generated)
        const next: EarthPulseQuakeEvent[] = []
        for (const feature of parsed.features ?? []) {
          const point = lonLatDepth(feature.geometry?.coordinates)
          const observedAt = isoFromEpoch(feature.properties?.time)
          if (!point || !observedAt || !feature.id) continue
          next.push({
            id: feature.id,
            longitude: point.lon,
            latitude: point.lat,
            depthKm: point.depthKm,
            magnitude: typeof feature.properties?.mag === 'number' ? feature.properties.mag : null,
            place: typeof feature.properties?.place === 'string' ? feature.properties.place : null,
            observedAt,
            updatedAt: isoFromEpoch(feature.properties?.updated),
            url: typeof feature.properties?.url === 'string' ? feature.properties.url : null,
            pulse: isFreshEarthquakePulse(observedAt, terraTime),
          })
          if (next.length >= EARTH_PULSE_QUAKE_CAP) break
        }
        events = next
        fetchOk = true
        cacheSet(CACHE_KEY, { events, generatedAt }, CACHE_TTL.liveFeed)
      } catch {
        error = 'USGS GeoJSON parse failed'
        fetchOk = false
      }
    }
  } else {
    events = events.map(event => ({ ...event, pulse: isFreshEarthquakePulse(event.observedAt, terraTime) }))
  }

  const latest = events.map(event => event.observedAt).sort().at(-1) ?? generatedAt
  return {
    events,
    observedAt: latest,
    generatedAt,
    truthState: classifyFreshness({
      observedAt: latest,
      nowIso: terraTime,
      liveMaxMs: 30 * 60_000,
      recentMaxMs: 24 * 60 * 60_000,
      hasCoverage: true,
      hasItems: events.length > 0,
      fetchOk,
    }),
    error,
    sourceUrl: USGS_SOURCE.docsUrl,
  }
}
