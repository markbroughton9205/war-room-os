/**
 * God's Eye Terra imagery phase — close-range satellite/aerial imagery truth boundary
 * and the lawful visible fallback chain when high-res aerial is missing.
 *
 * NASA GIBS True Color (TerraEarthImagery.tsx) is a real daily photograph, but it is capped at
 * WMTS zoom level 9 — well short of city/street detail. Cesium ion World Imagery (Bing Maps Aerial)
 * is the preferred close-range photograph when the same `NEXT_PUBLIC_CESIUM_ION_TOKEN` boundary
 * already gating World Terrain / OSM Buildings actually yields a loaded asset.
 *
 * Fallback chain (never invent imagery; never leave the globe as a blank gray sheet):
 *   1. ion World Imagery when a real asset loaded
 *   2. NASA GIBS True Color at global/regional (where zoom 9 is still a photograph)
 *   3. OSM raster map-detail (OpenStreetMap tiles already on the Viewer baseLayer) at
 *      city/local/building when high-res aerial is unavailable, or at any scale if GIBS
 *      itself fails to provide tiles
 *   4. Globe baseColor only if even OSM cannot attach — that path is an explicit error,
 *      not a silent "ready" state
 *
 * Holding GIBS at alpha 1 past its resolution ceiling while forcing OSM to alpha 0 was the
 * gray-screen failure: stretched/empty level-9 pixels over a black globe, with the Commander
 * asked to manually OPEN MAP DETAIL. OSM map-detail is now the automatic close-range fallback
 * in that case. The Commander toggle remains an overlay preference (force OSM even when
 * photographs are available), not the only way to see a readable Earth.
 */
import { TERRA_SCALE_THRESHOLDS_M, type TerraScaleLevel } from '@/components/war-room/terra/useTerraCameraScale'

/** GIBS' native resolution ceiling roughly matches this scale band and below. */
const HIGH_RES_UNAVAILABLE_LEVELS: ReadonlySet<TerraScaleLevel> = new Set(['city', 'local', 'building'])

export const TERRA_HIGH_RES_AERIAL_UNAVAILABLE_MESSAGE = 'HIGH-RES AERIAL IMAGERY UNAVAILABLE'
export const TERRA_FALLBACK_IMAGERY_ACTIVE_MESSAGE = 'FALLBACK IMAGERY ACTIVE'
export const TERRA_OPEN_MAP_DETAIL_LABEL = 'OPEN MAP DETAIL'
export const TERRA_CLOSE_MAP_DETAIL_LABEL = 'CLOSE MAP DETAIL'

/** Tile-error streak that means a photographic provider is not actually painting the globe. */
export const TERRA_IMAGERY_PROVIDER_FAIL_STREAK = 8

export type TerraImageryAlphas = {
  osm: number
  gibs: number
  world: number
  /** True when OSM map-detail is the visible close-range (or photographic-failure) surface. */
  fallbackActive: boolean
}

function clamp01(value: number): number {
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

/** GIBS share: 1 at regional and above, 0 at city and below. */
export function terraGibsHeightShare(heightMeters: number): number {
  if (heightMeters >= TERRA_SCALE_THRESHOLDS_M.regional) return 1
  if (heightMeters <= TERRA_SCALE_THRESHOLDS_M.city) return 0
  return (heightMeters - TERRA_SCALE_THRESHOLDS_M.city) / (TERRA_SCALE_THRESHOLDS_M.regional - TERRA_SCALE_THRESHOLDS_M.city)
}

/**
 * Layer alphas for the current camera height. `fade` is the boot crossfade (0..1).
 * Callers multiply Cesium ImageryLayer.alpha from this object — they do not invent a second chain.
 */
export function resolveTerraImageryAlphas(input: {
  aerialAvailable: boolean
  photographicFailed: boolean
  mapDetailMode: boolean
  heightMeters: number
  fade?: number
}): TerraImageryAlphas {
  const fade = clamp01(input.fade ?? 1)
  const gibsShare = terraGibsHeightShare(input.heightMeters)
  const closeShare = 1 - gibsShare

  if (input.mapDetailMode) {
    return { osm: 1, gibs: 0, world: 0, fallbackActive: true }
  }

  if (input.aerialAvailable) {
    return {
      osm: input.photographicFailed ? fade * gibsShare : 0,
      gibs: input.photographicFailed ? 0 : fade * gibsShare,
      world: fade * closeShare,
      fallbackActive: input.photographicFailed && gibsShare > 0,
    }
  }

  return {
    osm: input.photographicFailed ? 1 : fade * closeShare,
    gibs: input.photographicFailed ? 0 : fade * gibsShare,
    world: 0,
    fallbackActive: input.photographicFailed || closeShare > 0,
  }
}

/**
 * True when the Commander is at a scale where GIBS' resolution ceiling matters and no real
 * ion-backed aerial imagery is available to take over — i.e. the honest "unavailable" banner
 * should show, and OSM map-detail must already be the visible fallback (not a hidden toggle).
 * `aerialImageryActive` must reflect a real detected asset load (see TerraEarthImagery.tsx),
 * never bare token presence.
 */
export function terraHighResAerialUnavailable(aerialImageryActive: boolean, level: TerraScaleLevel): boolean {
  return !aerialImageryActive && HIGH_RES_UNAVAILABLE_LEVELS.has(level)
}

/** Banner companion: fallback OSM/map-detail is actually on the globe, not merely offered. */
export function terraFallbackImageryActive(aerialImageryActive: boolean, level: TerraScaleLevel): boolean {
  return terraHighResAerialUnavailable(aerialImageryActive, level)
}
