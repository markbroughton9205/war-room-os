/**
 * Terra event -> camera fly-to framing. Pure and deterministic: given the selected TerraGeoFeature
 * (its exact observed coordinates remain authoritative — this never re-geocodes or infers a
 * different position), decides how the Cesium camera should frame it. TerraShell.tsx converts the
 * result into an actual `viewer.camera.flyTo` call (Cesium types/instances don't belong in this
 * pure lib layer).
 *
 * Two modes:
 *   - 'rectangle': the event already carries a real polygon (geometryKind 'region', e.g. a NWS
 *     severe-weather-alert warning area) — fit the camera to the polygon's real bounding box,
 *     never a fixed altitude, per this phase's "fit actual geometry when Terra already has it"
 *     requirement.
 *   - 'point': every other event — an altitude chosen by event kind so a Commander lands somewhere
 *     that makes sense for that kind of event (e.g. a cyclone gets a wide regional view; a
 *     landmark gets a close-in view), not one fixed altitude for every event.
 *
 * Altitude bands below are independent of (but conceptually consistent with)
 * components/war-room/terra/useTerraCameraScale.ts's TERRA_SCALE_THRESHOLDS_M — that hook reads
 * live camera height back from Cesium and is 'use client'; this module stays framework-free so it
 * can run in a plain Node validation script.
 */
import type { TerraGeoFeature, TerraIntelligenceEventKind } from './types'

export type TerraEventCameraFraming =
  | { mode: 'rectangle'; west: number; south: number; east: number; north: number }
  | { mode: 'point'; longitude: number; latitude: number; altitudeMeters: number }

/** Altitude (meters above the ellipsoid) for a point-framed event, chosen per kind so the
 * Commander lands at a scale appropriate to that kind of event — never one fixed number for
 * every event. Kinds not listed fall back to DEFAULT_POINT_ALTITUDE_M. */
const EVENT_KIND_POINT_ALTITUDE_M: Partial<Record<TerraIntelligenceEventKind, number>> = {
  // Regional/local framing — enough to see the surrounding geography around the epicenter/incident.
  earthquake: 60_000,
  volcano_event: 60_000,
  wildfire_incident: 60_000,
  flood_event: 60_000,
  // Wide regional framing — cyclones and tsunami bulletins affect a much larger area than their
  // single reported center point.
  tropical_cyclone: 450_000,
  tsunami_alert: 450_000,
  // A severe-weather alert without an inline polygon (point fallback) still gets a regional view.
  severe_weather_alert: 150_000,
  water_gauge_reading: 20_000,
  aircraft_state: 30_000,
  weather_observation: 30_000,
  biodiversity_observation: 30_000,
  heritage_site: 10_000,
  place: 20_000,
  geographic_feature: 20_000,
  landmark_poi: 2_000,
}
const DEFAULT_POINT_ALTITUDE_M = 60_000

/** Minimum rectangle span so a very small or degenerate polygon never produces a camera height
 * below the underlying imagery's real tile resolution (the same failure mode TerraShell.tsx's
 * existing terraFlyToRectangleDegrees documents and guards against for typed-location search). */
const MIN_EVENT_RECTANGLE_SPAN_DEG = 0.05

function computeRegionBoundingBox(rings: number[][][]): { west: number; south: number; east: number; north: number } | null {
  let west = Infinity
  let east = -Infinity
  let south = Infinity
  let north = -Infinity
  for (const ring of rings) {
    for (const vertex of ring) {
      const [lon, lat] = vertex
      if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat)) continue
      west = Math.min(west, lon)
      east = Math.max(east, lon)
      south = Math.min(south, lat)
      north = Math.max(north, lat)
    }
  }
  if (!Number.isFinite(west) || !Number.isFinite(east) || !Number.isFinite(south) || !Number.isFinite(north)) return null
  return { west, east, south, north }
}

export function resolveTerraEventCameraFraming(feature: TerraGeoFeature): TerraEventCameraFraming {
  if (feature.geometryKind === 'region' && feature.regionRings && feature.regionRings.length > 0) {
    const bbox = computeRegionBoundingBox(feature.regionRings)
    if (bbox) {
      const halfMin = MIN_EVENT_RECTANGLE_SPAN_DEG / 2
      return {
        mode: 'rectangle',
        west: Math.min(bbox.west, feature.longitude - halfMin),
        east: Math.max(bbox.east, feature.longitude + halfMin),
        south: Math.min(bbox.south, feature.latitude - halfMin),
        north: Math.max(bbox.north, feature.latitude + halfMin),
      }
    }
  }

  return {
    mode: 'point',
    longitude: feature.longitude,
    latitude: feature.latitude,
    altitudeMeters: EVENT_KIND_POINT_ALTITUDE_M[feature.kind] ?? DEFAULT_POINT_ALTITUDE_M,
  }
}
