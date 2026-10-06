import {
  EARTH_PULSE_AURORA_CAP,
  EARTH_PULSE_AURORA_MIN,
  EARTH_PULSE_LIGHTNING_RECENT_MS,
  EARTH_PULSE_QUAKE_FRESH_MS,
  TERRA_LIGHTNING_CLOSE_CAP,
  TERRA_LIGHTNING_GLOBE_CAP,
  type EarthPulseAuroraCell,
  type EarthPulseCloudCatalog,
  type EarthPulseLightningFlash,
} from './types'
import { GOES_EAST_COVERAGE, GOES_WEST_COVERAGE } from './sources'

export function isFreshEarthquakePulse(observedAt: string, terraTime: string): boolean {
  const age = Date.parse(terraTime) - Date.parse(observedAt)
  return Number.isFinite(age) && age >= 0 && age <= EARTH_PULSE_QUAKE_FRESH_MS
}

export function pointInGoesGlmCoverage(longitude: number, latitude: number): boolean {
  const east = GOES_EAST_COVERAGE
  const west = GOES_WEST_COVERAGE
  const inEast = longitude >= (east.west ?? -135) && longitude <= (east.east ?? -15)
    && latitude >= (east.south ?? -55) && latitude <= (east.north ?? 55)
  const inWest = latitude >= (west.south ?? -55) && latitude <= (west.north ?? 55)
    && (longitude >= 165 || longitude <= -100)
  return inEast || inWest
}

export function aggregateOvationCells(coordinates: unknown, cap = EARTH_PULSE_AURORA_CAP, min = EARTH_PULSE_AURORA_MIN): EarthPulseAuroraCell[] {
  if (!Array.isArray(coordinates)) return []
  const cells: EarthPulseAuroraCell[] = []
  for (const row of coordinates) {
    if (!Array.isArray(row) || row.length < 3) continue
    const lon = row[0]
    const lat = row[1]
    const aurora = row[2]
    if (typeof lon !== 'number' || typeof lat !== 'number' || typeof aurora !== 'number') continue
    if (aurora < min) continue
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue
    cells.push({
      longitude: lon,
      latitude: lat,
      aurora,
      hemisphere: lat >= 0 ? 'north' : 'south',
    })
  }
  return cells.sort((a, b) => b.aurora - a.aurora).slice(0, cap)
}

export function prefersTerraReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function isFreshLightningVisual(observedAt: string, nowIso: string): boolean {
  const age = Date.parse(nowIso) - Date.parse(observedAt)
  return Number.isFinite(age) && age >= 0 && age <= EARTH_PULSE_LIGHTNING_RECENT_MS
}

/** Globe-scale aggregation for presentation. Does not drop source rows from Earth Pulse status. */
export function selectLightningVisuals(input: {
  flashes: EarthPulseLightningFlash[]
  nowIso: string
  globalLod: boolean
  reducedMotion: boolean
  cap?: number
}): EarthPulseLightningFlash[] {
  const fresh = input.flashes.filter(flash => isFreshLightningVisual(flash.observedAt, input.nowIso))
  if (input.reducedMotion) {
    if (input.globalLod) return []
    return fresh.filter(flash => flash.count >= 2).slice(0, Math.min(24, input.cap ?? 24))
  }
  if (input.globalLod) {
    return fresh.filter(flash => flash.count >= 3).slice(0, input.cap ?? TERRA_LIGHTNING_GLOBE_CAP)
  }
  return fresh.slice(0, input.cap ?? TERRA_LIGHTNING_CLOSE_CAP)
}

/** Presentation filter. Source OVATION rows stay at EARTH_PULSE_AURORA_MIN. */
export function selectAuroraVisuals(input: {
  cells: EarthPulseAuroraCell[]
  globalLod: boolean
  min?: number
  ovalAbsLat?: number
  cap?: number
}): EarthPulseAuroraCell[] {
  const min = input.min ?? 28
  const oval = input.ovalAbsLat ?? 48
  const cap = input.cap ?? (input.globalLod ? 72 : 120)
  return input.cells
    .filter(cell => cell.aurora >= min && Math.abs(cell.latitude) >= oval)
    .sort((a, b) => b.aurora - a.aurora)
    .slice(0, cap)
}

export function cloudMotionIsObservedFrames(catalog: EarthPulseCloudCatalog): boolean {
  const east = catalog.frames.filter(frame => frame.satellite === 'GOES-East')
  if (east.length < 2) return false
  for (let i = 1; i < east.length; i += 1) {
    if (east[i]!.tileUrlTemplate === east[i - 1]!.tileUrlTemplate) return false
    if (east[i]!.timestampIso <= east[i - 1]!.timestampIso) return false
  }
  return true
}
