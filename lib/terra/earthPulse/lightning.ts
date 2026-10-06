import 'server-only'

import { cacheGet, cacheSet } from '@/lib/research-engine/cache/ttlCache'
import {
  EARTH_PULSE_LIGHTNING_CAP,
  EARTH_PULSE_LIGHTNING_CELL_DEG,
  type EarthPulseLightningFlash,
  type EarthPulseTruthState,
} from './types'
import { GLM_BUCKETS, GOES_GLM_COMBINED_COVERAGE } from './sources'
import { fetchBuffer, fetchText, pad2, utcDayOfYear } from './shared'
import { classifyLightningFreshness } from './freshness'
import { parseGlmLcfaFlashes } from './glmHdf5'

const CACHE_KEY = 'terra-earth-pulse-glm-flashes'
const CACHE_MS = 25_000
const FILES_PER_SAT = 2

function parseKeys(xml: string): string[] {
  return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(match => match[1]!).filter(key => key.endsWith('.nc'))
}

function granuleObservedAt(key: string): string | null {
  const match = key.match(/_s(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})/)
  if (!match) return null
  const year = Number(match[1])
  const doy = Number(match[2])
  const hour = Number(match[3])
  const minute = Number(match[4])
  const second = Number(match[5])
  const date = new Date(Date.UTC(year, 0, doy, hour, minute, second))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

async function listLatestKeys(bucket: string, when: Date, limit: number): Promise<string[]> {
  const prefixes: string[] = []
  for (let offset = 0; offset < 2 && prefixes.length < 2; offset += 1) {
    const slot = new Date(when.getTime() - offset * 3_600_000)
    prefixes.push(`GLM-L2-LCFA/${slot.getUTCFullYear()}/${utcDayOfYear(slot)}/${pad2(slot.getUTCHours())}/`)
  }
  const keys: string[] = []
  for (const prefix of prefixes) {
    const url = `https://${bucket}.s3.amazonaws.com/?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=1000`
    const result = await fetchText(url, 12_000)
    if (!result.ok) continue
    keys.push(...parseKeys(result.text))
    if (keys.length >= limit) break
  }
  return [...new Set(keys)].sort().slice(-limit)
}

function aggregate(flashes: { lat: number; lon: number; energy: number; satellite: 'G18' | 'G19'; observedAt: string }[]): EarthPulseLightningFlash[] {
  const cell = EARTH_PULSE_LIGHTNING_CELL_DEG
  const bins = new Map<string, EarthPulseLightningFlash>()
  for (const flash of flashes) {
    const lat = Math.round(flash.lat / cell) * cell
    const lon = Math.round(flash.lon / cell) * cell
    const id = `${flash.satellite}:${lat.toFixed(2)}:${lon.toFixed(2)}`
    const existing = bins.get(id)
    if (!existing) {
      bins.set(id, {
        id,
        latitude: lat,
        longitude: lon,
        count: 1,
        energy: flash.energy,
        satellite: flash.satellite,
        observedAt: flash.observedAt,
      })
      continue
    }
    existing.count += 1
    existing.energy = Math.max(existing.energy, flash.energy)
    if (flash.observedAt > existing.observedAt) existing.observedAt = flash.observedAt
  }
  return [...bins.values()]
    .sort((a, b) => (b.count * b.energy) - (a.count * a.energy))
    .slice(0, EARTH_PULSE_LIGHTNING_CAP)
}

async function loadSatellite(sat: 'G18' | 'G19', when: Date): Promise<{ flashes: EarthPulseLightningFlash[]; observedAt: string | null; error: string | null }> {
  const bucket = GLM_BUCKETS[sat]
  const keys = await listLatestKeys(bucket, when, FILES_PER_SAT)
  if (!keys.length) return { flashes: [], observedAt: null, error: `No GLM-L2-LCFA objects listed for ${bucket}` }
  const collected: { lat: number; lon: number; energy: number; satellite: 'G18' | 'G19'; observedAt: string }[] = []
  let latest: string | null = null
  let error: string | null = null
  for (const key of keys) {
    const observedAt = granuleObservedAt(key) ?? when.toISOString()
    const result = await fetchBuffer(`https://${bucket}.s3.amazonaws.com/${key}`, 15_000)
    if (!result.ok) {
      error = result.message
      continue
    }
    try {
      const parsed = parseGlmLcfaFlashes(result.buffer)
      for (const flash of parsed) collected.push({ ...flash, satellite: sat, observedAt })
      if (!latest || observedAt > latest) latest = observedAt
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'GLM parse failed'
    }
  }
  return { flashes: aggregate(collected), observedAt: latest, error }
}

export async function loadGlmLightning(input: {
  terraTime: string
  timeMode: 'live' | 'historical'
}): Promise<{
  flashes: EarthPulseLightningFlash[]
  observedAt: string | null
  truthState: EarthPulseTruthState
  coverageLabel: string
  error: string | null
  fromCache: boolean
  rawFlashCells: number
}> {
  if (input.timeMode === 'historical') {
    return {
      flashes: [],
      observedAt: null,
      truthState: 'UNAVAILABLE',
      coverageLabel: GOES_GLM_COMBINED_COVERAGE.label,
      error: 'GOES GLM LCFA is a recent live catalog. Historical timeline playback is not supported.',
      fromCache: false,
      rawFlashCells: 0,
    }
  }

  const cached = cacheGet<{ flashes: EarthPulseLightningFlash[]; observedAt: string | null }>(CACHE_KEY)
  if (cached) {
    return {
      flashes: cached.flashes,
      observedAt: cached.observedAt,
      truthState: classifyLightningFreshness(cached.observedAt, input.terraTime, true, true),
      coverageLabel: GOES_GLM_COMBINED_COVERAGE.label,
      error: null,
      fromCache: true,
      rawFlashCells: cached.flashes.length,
    }
  }

  const when = new Date()
  const [east, west] = await Promise.all([
    loadSatellite('G19', when),
    loadSatellite('G18', when),
  ])
  const merged = aggregate([
    ...east.flashes.flatMap(cell => Array.from({ length: cell.count }, () => ({
      lat: cell.latitude,
      lon: cell.longitude,
      energy: cell.energy,
      satellite: cell.satellite,
      observedAt: cell.observedAt,
    }))),
    ...west.flashes.flatMap(cell => Array.from({ length: cell.count }, () => ({
      lat: cell.latitude,
      lon: cell.longitude,
      energy: cell.energy,
      satellite: cell.satellite,
      observedAt: cell.observedAt,
    }))),
  ])
  const observedAt = [east.observedAt, west.observedAt].filter(Boolean).sort().at(-1) ?? null
  const fetchOk = merged.length > 0 || (!east.error && !west.error)
  cacheSet(CACHE_KEY, { flashes: merged, observedAt }, CACHE_MS)
  const error = merged.length ? null : [east.error, west.error].filter(Boolean).join('; ') || 'No GLM flashes in the latest granules'
  return {
    flashes: merged,
    observedAt,
    truthState: classifyLightningFreshness(observedAt, input.terraTime, fetchOk || merged.length > 0, true),
    coverageLabel: GOES_GLM_COMBINED_COVERAGE.label,
    error,
    fromCache: false,
    rawFlashCells: merged.length,
  }
}
