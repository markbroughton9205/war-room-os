import 'server-only'

import { cacheGet, cacheSet } from '@/lib/research-engine/cache/ttlCache'
import { PUBLIC_GIBS_WMTS_BASE_URL } from '@/lib/earth-intelligence/gibsPublicBase'
import type { NightLightsCatalog } from './types'
import { classifyArchivalOrDaily } from './freshness'
import {
  NIGHT_LIGHTS_ARCHIVE_DATE,
  NIGHT_LIGHTS_ARCHIVE_LAYER_ID,
  NIGHT_LIGHTS_DAILY_IDENTIFIER,
  NIGHT_LIGHTS_DAILY_LAYER_ID,
  NIGHT_LIGHTS_MAX_LEVEL,
  VNP46A2_UNAVAILABLE_NOTE,
} from './sources'
import { headOk } from './shared'

const CACHE_KEY = 'terra-earth-pulse-night-lights'
const CACHE_MS = 30 * 60_000

function completedUtcDate(iso: string): string {
  const parsed = new Date(iso)
  const safe = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  return new Date(Date.UTC(safe.getUTCFullYear(), safe.getUTCMonth(), safe.getUTCDate()) - 86_400_000)
    .toISOString()
    .slice(0, 10)
}

function previousUtcDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toISOString().slice(0, 10) === isoDate
    ? new Date(Date.parse(`${isoDate}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
    : isoDate
}

function dailyTileUrl(date: string): string {
  return `${PUBLIC_GIBS_WMTS_BASE_URL}${encodeURIComponent(NIGHT_LIGHTS_DAILY_IDENTIFIER)}/default/${date}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`
}

function archiveTileUrl(): string {
  return `${PUBLIC_GIBS_WMTS_BASE_URL}VIIRS_Night_Lights/default/${NIGHT_LIGHTS_ARCHIVE_DATE}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`
}

function probeDaily(date: string): string {
  return `${PUBLIC_GIBS_WMTS_BASE_URL}${encodeURIComponent(NIGHT_LIGHTS_DAILY_IDENTIFIER)}/default/${date}/GoogleMapsCompatible_Level8/2/1/1.png`
}

export async function loadNightLightsCatalog(terraTime: string): Promise<NightLightsCatalog> {
  const cached = cacheGet<NightLightsCatalog>(CACHE_KEY)
  if (cached) return { ...cached, fromCache: true }

  const first = completedUtcDate(terraTime)
  const second = previousUtcDate(first)
  let dailyDate: string | null = null
  for (const date of [first, second]) {
    const probe = await headOk(probeDaily(date), 8_000)
    if (probe.ok) {
      dailyDate = date
      break
    }
  }

  const catalog: NightLightsCatalog = dailyDate
    ? {
      mode: 'DAILY',
      layerId: NIGHT_LIGHTS_DAILY_LAYER_ID,
      productDate: dailyDate,
      tileUrlTemplate: dailyTileUrl(dailyDate),
      maximumLevel: NIGHT_LIGHTS_MAX_LEVEL,
      truthState: classifyArchivalOrDaily('daily', true),
      dailyBlackMarble: 'UNAVAILABLE',
      dailyDnb: true,
      archiveFallback: false,
      note: `${VNP46A2_UNAVAILABLE_NOTE} Showing GIBS daily DNB radiance for ${dailyDate}. Not live electricity.`,
      fromCache: false,
    }
    : {
      mode: 'ARCHIVE',
      layerId: NIGHT_LIGHTS_ARCHIVE_LAYER_ID,
      productDate: NIGHT_LIGHTS_ARCHIVE_DATE,
      tileUrlTemplate: archiveTileUrl(),
      maximumLevel: NIGHT_LIGHTS_MAX_LEVEL,
      truthState: classifyArchivalOrDaily('annual', true),
      dailyBlackMarble: 'UNAVAILABLE',
      dailyDnb: false,
      archiveFallback: true,
      note: `${VNP46A2_UNAVAILABLE_NOTE} Daily DNB tiles were unavailable. Archive fallback is the 2016 VIIRS Night Lights composite.`,
      fromCache: false,
    }

  cacheSet(CACHE_KEY, catalog, CACHE_MS)
  return catalog
}
