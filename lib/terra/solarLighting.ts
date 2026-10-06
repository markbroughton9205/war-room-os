/**
 * Location-aware Terra lighting — solar elevation at the accepted active coordinate + Terra time.
 *
 * Does not use the Commander machine clock hour. Does not hardcode Akron or any city.
 * Cesium still owns planetary sun geometry from viewer.clock; this module classifies the
 * ACTIVE LOCATION and Commander AUTO/DAY/NIGHT override.
 */
import { isValidLiveCoordinate } from './liveGeoIntelligence'
import { formatZonedClock, resolveIanaTimeZone, solarPosition } from './worldTime'

export const TERRA_LIGHTING_STATES = ['DAY', 'CIVIL_TWILIGHT', 'NAUTICAL_TWILIGHT', 'NIGHT'] as const
export type TerraLightingState = (typeof TERRA_LIGHTING_STATES)[number]

export const TERRA_LIGHTING_MODES = ['AUTO', 'DAY', 'NIGHT'] as const
export type TerraLightingMode = (typeof TERRA_LIGHTING_MODES)[number]

export const TERRA_LIGHTING_MODE_STORAGE_KEY = 'terra.lighting.mode'
export const DEFAULT_TERRA_LIGHTING_MODE: TerraLightingMode = 'AUTO'

/**
 * Cesium `lightingFade*` distances are measured from ECEF origin, not camera altitude.
 * Defaults (~π/2·R ≈ 10,000 km fade-out) sit ABOVE a city JUMP (~6,370 km from origin),
 * so ENABLE_DAYNIGHT_SHADING mixes to fully-lit and a night city looks like daytime.
 * fade-in MUST be greater than fade-out — both 0 is a divide-by-zero and collapses to fully-lit.
 */
export const TERRA_GLOBE_LIGHTING_FADE_OUT_DISTANCE = 0
export const TERRA_GLOBE_LIGHTING_FADE_IN_DISTANCE = 1_000_000

/** Daytime GIBS/aerial/OSM stay visible on the night side at this fraction — not pitch black. */
export const TERRA_DAYTIME_LAYER_DAY_ALPHA = 1
export const TERRA_DAYTIME_LAYER_NIGHT_ALPHA = 0.2

type TerraGlobeLightingTarget = {
  enableLighting: boolean
  lightingFadeOutDistance: number
  lightingFadeInDistance: number
  vertexShadowDarkness?: number
  dynamicAtmosphereLighting?: boolean
  dynamicAtmosphereLightingFromSun?: boolean
}

/** Keep sun lighting at city/street range without inventing a second light model. */
export function applyTerraGlobeSunLighting(globe: TerraGlobeLightingTarget, enabled: boolean): void {
  globe.enableLighting = enabled
  globe.lightingFadeOutDistance = TERRA_GLOBE_LIGHTING_FADE_OUT_DISTANCE
  globe.lightingFadeInDistance = TERRA_GLOBE_LIGHTING_FADE_IN_DISTANCE
  if (globe.vertexShadowDarkness !== undefined) globe.vertexShadowDarkness = 0.12
  if (globe.dynamicAtmosphereLighting !== undefined) globe.dynamicAtmosphereLighting = enabled
  if (globe.dynamicAtmosphereLightingFromSun !== undefined) globe.dynamicAtmosphereLightingFromSun = enabled
}

type TerraDayNightAlphaLayer = {
  dayAlpha: number
  nightAlpha: number
}

/** Dim photographic/OSM layers on the sun-shadowed hemisphere so VIIRS lights can read. Radar is not passed here. */
export function applyTerraDaytimeLayerNightAlpha(layer: TerraDayNightAlphaLayer): void {
  layer.dayAlpha = TERRA_DAYTIME_LAYER_DAY_ALPHA
  layer.nightAlpha = TERRA_DAYTIME_LAYER_NIGHT_ALPHA
}

/** Apparent sunrise/sunset zenith with standard refraction (NOAA). */
const APPARENT_HORIZON_DEG = -0.833
const CIVIL_TWILIGHT_DEG = -6
const NAUTICAL_TWILIGHT_DEG = -12

export type TerraSolarLighting = {
  latitude: number
  longitude: number
  terraTime: string
  elevationDegrees: number
  rising: boolean
  lightingState: TerraLightingState
  sunriseUtc: string | null
  sunsetUtc: string | null
  sunriseLocal: string | null
  sunsetLocal: string | null
  timeZone: string | null
  /** 0 at day, 1 in night. Continuous across civil/nautical twilight. */
  nightBlend: number
}

export type TerraNightLayerVisual = {
  enableLighting: boolean
  dayAlpha: number
  nightAlpha: number
  alpha: number
  nightLightsVisible: boolean
  manual: boolean
}

export function parseTerraLightingMode(value: string | null | undefined): TerraLightingMode {
  if (value && (TERRA_LIGHTING_MODES as readonly string[]).includes(value)) return value as TerraLightingMode
  return DEFAULT_TERRA_LIGHTING_MODE
}

export function readTerraLightingMode(): TerraLightingMode {
  if (typeof window === 'undefined') return DEFAULT_TERRA_LIGHTING_MODE
  try {
    return parseTerraLightingMode(window.localStorage.getItem(TERRA_LIGHTING_MODE_STORAGE_KEY))
  } catch {
    return DEFAULT_TERRA_LIGHTING_MODE
  }
}

export function persistTerraLightingMode(mode: TerraLightingMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(TERRA_LIGHTING_MODE_STORAGE_KEY, parseTerraLightingMode(mode))
  } catch {
    /* Preference is local-only. */
  }
}

export function lightingStateFromElevation(elevation: number | null): TerraLightingState | null {
  if (elevation === null || !Number.isFinite(elevation)) return null
  if (elevation > 0) return 'DAY'
  if (elevation > CIVIL_TWILIGHT_DEG) return 'CIVIL_TWILIGHT'
  if (elevation > NAUTICAL_TWILIGHT_DEG) return 'NAUTICAL_TWILIGHT'
  return 'NIGHT'
}

/** Smooth 0..1 night-lights mix from solar elevation. Day is 0; below nautical twilight is 1. */
export function nightBlendFromElevation(elevation: number | null): number {
  if (elevation === null || !Number.isFinite(elevation)) return 0
  if (elevation >= 0) return 0
  if (elevation <= NAUTICAL_TWILIGHT_DEG) return 1
  return (0 - elevation) / (0 - NAUTICAL_TWILIGHT_DEG)
}

export function lightingStateLabel(state: TerraLightingState | null): string {
  if (state === 'DAY') return 'DAY'
  if (state === 'CIVIL_TWILIGHT') return 'CIVIL TWILIGHT'
  if (state === 'NAUTICAL_TWILIGHT') return 'NAUTICAL TWILIGHT'
  if (state === 'NIGHT') return 'NIGHT'
  return 'NO ACTIVE LOCATION'
}

function interpolateCrossing(prevMs: number, prevEl: number, nextMs: number, nextEl: number, target: number): string {
  const span = nextEl - prevEl
  const t = span === 0 ? nextMs : prevMs + ((target - prevEl) / span) * (nextMs - prevMs)
  return new Date(t).toISOString()
}

/**
 * Sunrise/sunset for the solar day around `utcIso`, using the same NOAA elevation engine.
 * Polar day/night returns nulls — times are never invented.
 */
export function solarEventsAround(
  latitude: number,
  longitude: number,
  utcIso: string,
): { sunriseUtc: string | null; sunsetUtc: string | null } {
  if (!isValidLiveCoordinate(latitude, longitude)) return { sunriseUtc: null, sunsetUtc: null }
  const center = Date.parse(utcIso)
  if (!Number.isFinite(center)) return { sunriseUtc: null, sunsetUtc: null }
  const start = center - 18 * 3_600_000
  const end = center + 18 * 3_600_000
  const step = 2 * 60_000
  let sunriseUtc: string | null = null
  let sunsetUtc: string | null = null
  let prevMs = start
  let prev = solarPosition(latitude, longitude, new Date(start).toISOString())
  for (let ms = start + step; ms <= end; ms += step) {
    const pos = solarPosition(latitude, longitude, new Date(ms).toISOString())
    if (!prev || !pos) {
      prev = pos
      prevMs = ms
      continue
    }
    if (sunriseUtc === null && prev.elevation < APPARENT_HORIZON_DEG && pos.elevation >= APPARENT_HORIZON_DEG) {
      sunriseUtc = interpolateCrossing(prevMs, prev.elevation, ms, pos.elevation, APPARENT_HORIZON_DEG)
    }
    if (sunsetUtc === null && prev.elevation >= APPARENT_HORIZON_DEG && pos.elevation < APPARENT_HORIZON_DEG) {
      sunsetUtc = interpolateCrossing(prevMs, prev.elevation, ms, pos.elevation, APPARENT_HORIZON_DEG)
    }
    if (sunriseUtc && sunsetUtc) break
    prev = pos
    prevMs = ms
  }
  return { sunriseUtc, sunsetUtc }
}

export function resolveSolarLighting(latitude: number, longitude: number, utcIso: string): TerraSolarLighting | null {
  const position = solarPosition(latitude, longitude, utcIso)
  if (!position) return null
  const lightingState = lightingStateFromElevation(position.elevation)
  if (!lightingState) return null
  const events = solarEventsAround(latitude, longitude, utcIso)
  const zone = resolveIanaTimeZone(latitude, longitude)?.timeZone ?? null
  const sunriseLocal = events.sunriseUtc && zone ? formatZonedClock(events.sunriseUtc, zone)?.localTime ?? null : null
  const sunsetLocal = events.sunsetUtc && zone ? formatZonedClock(events.sunsetUtc, zone)?.localTime ?? null : null
  return {
    latitude,
    longitude,
    terraTime: utcIso,
    elevationDegrees: position.elevation,
    rising: position.rising,
    lightingState,
    sunriseUtc: events.sunriseUtc,
    sunsetUtc: events.sunsetUtc,
    sunriseLocal,
    sunsetLocal,
    timeZone: zone,
    nightBlend: nightBlendFromElevation(position.elevation),
  }
}

export function displayedLightingState(mode: TerraLightingMode, auto: TerraSolarLighting | null): TerraLightingState | null {
  if (mode === 'DAY') return 'DAY'
  if (mode === 'NIGHT') return 'NIGHT'
  return auto?.lightingState ?? null
}

/**
 * Cesium layer/sun visual for AUTO vs Commander preview.
 * AUTO keeps physically sensible terminator (nightAlpha only).
 * MANUAL DAY/NIGHT are labeled overrides and must not pretend to be local solar truth.
 */
export function resolveNightLayerVisual(mode: TerraLightingMode): TerraNightLayerVisual {
  if (mode === 'DAY') {
    return { enableLighting: false, dayAlpha: 0, nightAlpha: 0, alpha: 0, nightLightsVisible: false, manual: true }
  }
  if (mode === 'NIGHT') {
    return { enableLighting: true, dayAlpha: 1, nightAlpha: 1, alpha: 1, nightLightsVisible: true, manual: true }
  }
  return { enableLighting: true, dayAlpha: 0, nightAlpha: 1, alpha: 1, nightLightsVisible: true, manual: false }
}

export function nightLightsVisibleAtActiveLocation(mode: TerraLightingMode, auto: TerraSolarLighting | null): boolean {
  if (mode === 'DAY') return false
  if (mode === 'NIGHT') return true
  return Boolean(auto && auto.nightBlend > 0)
}
