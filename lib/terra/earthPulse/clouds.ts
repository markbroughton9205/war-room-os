import 'server-only'

import { cacheGet, cacheSet } from '@/lib/research-engine/cache/ttlCache'
import { PUBLIC_GIBS_WMTS_BASE_URL } from '@/lib/earth-intelligence/gibsPublicBase'
import {
  EARTH_PULSE_CLOUD_FRAME_CACHE,
  EARTH_PULSE_CLOUD_FRAME_MINUTES,
  type EarthPulseCloudCatalog,
  type EarthPulseCloudFrame,
} from './types'
import {
  CLOUD_SOURCE,
  GOES_EAST_GEOCOLOR_LAYER_ID,
  GOES_EAST_IDENTIFIER,
  GOES_GEOCOLOR_MAX_LEVEL,
  GOES_GEOCOLOR_TMS,
  GOES_WEST_GEOCOLOR_LAYER_ID,
  GOES_WEST_IDENTIFIER,
} from './sources'
import { alignToTenMinutes, headOk, toUtcIsoMinutes } from './shared'
import { classifyFreshness } from './freshness'

const CACHE_KEY = 'terra-earth-pulse-cloud-catalog'
const CACHE_MS = 5 * 60_000

function tileUrlTemplate(identifier: string, timestampIso: string): string {
  return `${PUBLIC_GIBS_WMTS_BASE_URL}${encodeURIComponent(identifier)}/default/${timestampIso}/${GOES_GEOCOLOR_TMS}/{z}/{y}/{x}.png`
}

function probeTileUrl(identifier: string, timestampIso: string): string {
  return `${PUBLIC_GIBS_WMTS_BASE_URL}${encodeURIComponent(identifier)}/default/${timestampIso}/${GOES_GEOCOLOR_TMS}/2/1/1.png`
}

function candidateTimes(selected: Date, count: number): string[] {
  const aligned = alignToTenMinutes(new Date(selected.getTime() - 10 * 60_000))
  const times: string[] = []
  for (let i = count - 1; i >= 0; i -= 1) {
    times.push(toUtcIsoMinutes(new Date(aligned.getTime() - i * EARTH_PULSE_CLOUD_FRAME_MINUTES * 60_000)))
  }
  return times
}

async function probeSatellite(
  satellite: EarthPulseCloudFrame['satellite'],
  layerId: string,
  identifier: string,
  times: string[],
): Promise<EarthPulseCloudFrame[]> {
  const frames: EarthPulseCloudFrame[] = []
  const queue = times.slice()
  const workers = 4
  async function worker() {
    while (queue.length) {
      const timestampIso = queue.shift()
      if (!timestampIso) return
      const probe = await headOk(probeTileUrl(identifier, timestampIso), 8_000)
      if (!probe.ok || probe.status === 404) continue
      frames.push({
        id: `${satellite}:${timestampIso}`,
        timestampIso,
        satellite,
        layerId,
        tileUrlTemplate: tileUrlTemplate(identifier, timestampIso),
        maximumLevel: GOES_GEOCOLOR_MAX_LEVEL,
      })
    }
  }
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return frames.sort((a, b) => a.timestampIso.localeCompare(b.timestampIso))
}

export async function loadEarthPulseCloudCatalog(input: {
  terraTime: string
  timeMode: 'live' | 'historical'
}): Promise<EarthPulseCloudCatalog> {
  const cached = cacheGet<EarthPulseCloudCatalog>(CACHE_KEY)
  if (cached && input.timeMode === 'live') return { ...cached, fromCache: true }

  const selected = new Date(input.terraTime)
  const safe = Number.isNaN(selected.getTime()) ? new Date() : selected
  const times = candidateTimes(safe, EARTH_PULSE_CLOUD_FRAME_CACHE)

  const [east, west] = await Promise.all([
    probeSatellite('GOES-East', GOES_EAST_GEOCOLOR_LAYER_ID, GOES_EAST_IDENTIFIER, times),
    probeSatellite('GOES-West', GOES_WEST_GEOCOLOR_LAYER_ID, GOES_WEST_IDENTIFIER, times),
  ])

  const frames = [...east, ...west].sort((a, b) => a.timestampIso.localeCompare(b.timestampIso) || a.satellite.localeCompare(b.satellite))
  const latestEast = east[east.length - 1] ?? null
  const latestWest = west[west.length - 1] ?? null
  const latestIso = [latestEast?.timestampIso, latestWest?.timestampIso].filter(Boolean).sort().at(-1) ?? null
  const truthState = frames.length
    ? classifyFreshness({
      observedAt: latestIso,
      nowIso: new Date().toISOString(),
      liveMaxMs: 25 * 60_000,
      recentMaxMs: 6 * 60 * 60_000,
      hasCoverage: true,
      hasItems: true,
      fetchOk: true,
    })
    : 'UNAVAILABLE'

  const catalog: EarthPulseCloudCatalog = {
    frames: frames.map(frame => ({ ...frame, product: 'GEOCOLOR', appearance: 'NATURAL_COLOR' })),
    latestBySatellite: {
      ...(latestEast ? { 'GOES-East': { ...latestEast, product: 'GEOCOLOR', appearance: 'NATURAL_COLOR' } } : {}),
      ...(latestWest ? { 'GOES-West': { ...latestWest, product: 'GEOCOLOR', appearance: 'NATURAL_COLOR' } } : {}),
    },
    intervalMinutes: EARTH_PULSE_CLOUD_FRAME_MINUTES,
    cacheBound: EARTH_PULSE_CLOUD_FRAME_CACHE,
    truthState,
    coverage: CLOUD_SOURCE.coverage,
    error: frames.length ? null : 'No GIBS GeoColor frames returned for the requested ten-minute window.',
    fromCache: false,
    playbackSatellite: latestEast ? 'GOES-East' : latestWest ? 'GOES-West' : undefined,
    federation: {
      primary: 'nasa_gibs_goes_geocolor',
      asia: 'jma_himawari',
      globalFill: 'ssec_realearth_globalir',
      himawariAvailable: false,
      fillAvailable: false,
      failover: frames.length ? 'NONE' : 'NOT_AVAILABLE_TRUTHFULLY',
    },
  }
  if (input.timeMode === 'live' && frames.length) cacheSet(CACHE_KEY, catalog, CACHE_MS)
  return catalog
}

export { cloudMotionIsObservedFrames } from './client'
