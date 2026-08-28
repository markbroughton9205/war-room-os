/**
 * God's Eye Terra imagery phase — close-range satellite/aerial imagery truth boundary.
 *
 * NASA GIBS True Color (TerraEarthImagery.tsx) is a real daily photograph, but it is capped at
 * WMTS zoom level 9 — well short of city/street detail. Before this phase, once the camera
 * descended past that resolution ceiling the GIBS layer simply faded to alpha 0, revealing the
 * flat OSM raster base underneath as if it were the intended close-range view. That produced the
 * "flat beige map" regression: a schematic road map silently standing in for a photograph.
 *
 * The fix: when a real Cesium ion token is configured (the same `NEXT_PUBLIC_CESIUM_ION_TOKEN`
 * boundary already gating Cesium World Terrain and OSM Buildings in TerraGlobe.tsx), Cesium ion's
 * World Imagery asset (Bing Maps Aerial) fades in as GIBS fades out, keeping real satellite/aerial
 * photography dominant all the way to building scale. When no ion token is configured — or the
 * asset request itself fails, matching this codebase's "a configured token doesn't guarantee asset
 * access" rule already applied to OSM Buildings — GIBS is held at full opacity instead of fading
 * to the OSM base, so the Commander always sees a real (if low-resolution close up) photograph
 * rather than a silently-substituted schematic map. OSM becomes an explicit, Commander-toggled
 * "map detail" overlay instead of an automatic close-range base.
 */
import type { TerraScaleLevel } from '@/components/war-room/terra/useTerraCameraScale'

/** GIBS' native resolution ceiling roughly matches this scale band and below. */
const HIGH_RES_UNAVAILABLE_LEVELS: ReadonlySet<TerraScaleLevel> = new Set(['city', 'local', 'building'])

export const TERRA_HIGH_RES_AERIAL_UNAVAILABLE_MESSAGE = 'HIGH-RES AERIAL IMAGERY UNAVAILABLE'
export const TERRA_OPEN_MAP_DETAIL_LABEL = 'OPEN MAP DETAIL'
export const TERRA_CLOSE_MAP_DETAIL_LABEL = 'CLOSE MAP DETAIL'

/**
 * True when the Commander is at a scale where GIBS' resolution ceiling matters and no real
 * ion-backed aerial imagery is available to take over — i.e. the honest "unavailable" banner and
 * the "open map detail" escape hatch should be offered. `aerialImageryActive` must reflect a real
 * detected asset load (see TerraEarthImagery.tsx), never bare token presence.
 */
export function terraHighResAerialUnavailable(aerialImageryActive: boolean, level: TerraScaleLevel): boolean {
  return !aerialImageryActive && HIGH_RES_UNAVAILABLE_LEVELS.has(level)
}
