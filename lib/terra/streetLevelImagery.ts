/**
 * God's Eye multi-scale local detail phase, mission section 11 — street-level panoramic
 * photographic imagery (Street View/Mapillary-style).
 *
 * Investigated this phase: no currently-configured, lawfully-usable provider exists in this
 * repository for real street-level panoramic photography.
 *   - Google Street View: proprietary, licensed API — not integrated, and scraping/bypassing its
 *     licensing is explicitly out of scope.
 *   - Mapillary: has a real, open (CC-BY-SA imagery + a free API tier), community-sourced
 *     street-level photo API — a legitimate future option — but it is not currently configured in
 *     this repository (no API key, no Research Engine provider adapter, no host-allowlist entry),
 *     so it is not wired up here rather than half-integrated without credentials.
 *   - KartaView: a similar open community photo platform, also not currently configured.
 *
 * This file is intentionally a clean, minimal, optional boundary — a type and a status constant —
 * not a speculative client, adapter, or UI component for a provider this build cannot actually
 * call. Terra's multi-scale camera still reaches street/building scale via Cesium OSM Buildings +
 * OSM raster map detail (see useTerraCameraScale.ts, TerraEarthImagery.tsx); this file only covers
 * ground-level PHOTOGRAPHY, which is a distinct, separately-gated capability.
 */

export type TerraStreetLevelImageryStatus = 'not_configured'

export const TERRA_STREET_LEVEL_IMAGERY_STATUS: TerraStreetLevelImageryStatus = 'not_configured'

export const TERRA_STREET_LEVEL_IMAGERY_MESSAGE = 'STREET-LEVEL PHOTOGRAPHIC IMAGERY — NOT YET CONFIGURED'

/** A future provider would implement this shape — coordinates in, either a real panorama
 * reference or null (never a fabricated placeholder image). Not called anywhere in this phase. */
export type TerraStreetLevelImageryProvider = {
  id: string
  label: string
  lookupNearest: (latitude: number, longitude: number, radiusMeters: number) => Promise<{ panoramaUrl: string; capturedAt: string | null; sourceUrl: string | null; attribution: string } | null>
}
