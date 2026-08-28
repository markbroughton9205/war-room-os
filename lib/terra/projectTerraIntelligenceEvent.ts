/**
 * The one, generic "optional spatial projection" step from the Phase 2 mission's architecture:
 *
 *   TerraIntelligenceEvent -> TerraGeoFeature (Cesium rendering projection)
 *
 * Deliberately provider-agnostic and kind-agnostic — it knows nothing about earthquakes, USGS, or
 * any other domain. Any current or future TerraIntelligenceEvent with a projectable geography
 * projects through this exact function; there is no per-domain projector to keep in sync.
 *
 * Pure, side-effect-free: no network, no Cesium import (Cesium-specific Entity/Polygon
 * construction stays in components/war-room/terra/TerraFeatureLayer.tsx, which only needs plain
 * numbers).
 */
import type { TerraGeoFeature, TerraIntelligenceEvent } from '@/lib/terra/types'

/** The real exterior ring's simple vertex-average — never an area-weighted centroid, and never
 * fabricated: every coordinate averaged is a real vertex the source itself supplied. Used only as
 * a representative click-target/label point for a region geometry; the real ring is preserved
 * separately in TerraGeoFeature.regionRings for the renderer to draw. */
function ringCentroid(exteriorRing: number[][]): { longitude: number; latitude: number } {
  const sum = exteriorRing.reduce((acc, [lon, lat]) => ({ lon: acc.lon + lon, lat: acc.lat + lat }), { lon: 0, lat: 0 })
  return { longitude: sum.lon / exteriorRing.length, latitude: sum.lat / exteriorRing.length }
}

/** Same simple, honest vertex-average convention as ringCentroid — a representative click-target
 * point for a line geometry, not a claimed "observed position." The real vertex sequence is
 * preserved separately in TerraGeoFeature.pathCoordinates for the renderer to draw as an actual
 * line, never collapsed to just this point. */
function lineVertexAverage(coordinates: number[][]): { longitude: number; latitude: number } {
  const sum = coordinates.reduce((acc, [lon, lat]) => ({ lon: acc.lon + lon, lat: acc.lat + lat }), { lon: 0, lat: 0 })
  return { longitude: sum.lon / coordinates.length, latitude: sum.lat / coordinates.length }
}

/** Null when the event has no (yet) projectable geography — an honest, expected outcome, not an
 * error. 'point', 'region', and 'path' geometry kinds are all implemented; a future GeoJSON kind
 * this codebase doesn't yet parse would need its own case here, not a silent point-only
 * approximation of it. */
export function projectTerraIntelligenceEventToGeoFeature(event: TerraIntelligenceEvent): TerraGeoFeature | null {
  if (!event.geography) return null

  const base = {
    id: event.id,
    eventId: event.id,
    providerId: event.providerId,
    kind: event.kind,
    timestamp: event.observedAt ?? event.publishedAt ?? null,
    title: event.title,
    summary: event.summary,
    properties: event.properties,
    provenance: event.provenance,
    rawReference: event.rawReference,
    coordinateOrigin: event.geography.coordinateOrigin,
    geoResolution: event.geoResolution,
  }

  if (event.geography.kind === 'point') {
    return {
      ...base,
      longitude: event.geography.longitude,
      latitude: event.geography.latitude,
      altitude: event.geography.altitude,
      geometryKind: 'point',
      regionRings: null,
      pathCoordinates: null,
    }
  }

  if (event.geography.kind === 'region') {
    const exteriorRing = event.geography.rings[0]
    if (!exteriorRing || exteriorRing.length < 3) return null
    const centroid = ringCentroid(exteriorRing)
    return {
      ...base,
      longitude: centroid.longitude,
      latitude: centroid.latitude,
      altitude: null,
      geometryKind: 'region',
      regionRings: event.geography.rings,
      pathCoordinates: null,
    }
  }

  if (event.geography.kind === 'path') {
    const coordinates = event.geography.coordinates
    if (!coordinates || coordinates.length < 2) return null
    const midpoint = lineVertexAverage(coordinates)
    return {
      ...base,
      longitude: midpoint.longitude,
      latitude: midpoint.latitude,
      altitude: null,
      geometryKind: 'line',
      regionRings: null,
      pathCoordinates: coordinates,
    }
  }

  return null
}

export function projectTerraIntelligenceEvents(events: TerraIntelligenceEvent[]): TerraGeoFeature[] {
  const features: TerraGeoFeature[] = []
  for (const event of events) {
    const feature = projectTerraIntelligenceEventToGeoFeature(event)
    if (feature) features.push(feature)
  }
  return features
}
