/**
 * The one, generic "optional spatial projection" step from the Phase 2 mission's architecture:
 *
 *   TerraIntelligenceEvent -> TerraGeoFeature (Cesium rendering projection)
 *
 * Deliberately provider-agnostic and kind-agnostic — it knows nothing about earthquakes, USGS, or
 * any other domain. Any current or future TerraIntelligenceEvent with a point geography projects
 * through this exact function; there is no per-domain projector to keep in sync.
 *
 * Pure, side-effect-free: no network, no Cesium import (Cesium-specific Entity construction stays
 * in components/war-room/terra/TerraEarthquakeLayer.tsx, which only needs plain numbers).
 */
import type { TerraGeoFeature, TerraIntelligenceEvent } from '@/lib/terra/types'

/** Null when the event has no (yet) projectable geography — an honest, expected outcome, not an
 * error. Only 'point' geography is implemented; a future 'region'/'path' geometry kind would need
 * its own case here (and, likely, a different Terra rendering component — a bounding area or a
 * track isn't a single Cesium point Entity), not a silent point-only approximation of it. */
export function projectTerraIntelligenceEventToGeoFeature(event: TerraIntelligenceEvent): TerraGeoFeature | null {
  if (!event.geography || event.geography.kind !== 'point') return null

  return {
    id: event.id,
    eventId: event.id,
    providerId: event.providerId,
    kind: event.kind,
    longitude: event.geography.longitude,
    latitude: event.geography.latitude,
    altitude: event.geography.altitude,
    timestamp: event.observedAt ?? event.publishedAt ?? null,
    title: event.title,
    summary: event.summary,
    properties: event.properties,
    provenance: event.provenance,
    rawReference: event.rawReference,
    coordinateOrigin: event.geography.coordinateOrigin,
    geoResolution: event.geoResolution,
  }
}

export function projectTerraIntelligenceEvents(events: TerraIntelligenceEvent[]): TerraGeoFeature[] {
  const features: TerraGeoFeature[] = []
  for (const event of events) {
    const feature = projectTerraIntelligenceEventToGeoFeature(event)
    if (feature) features.push(feature)
  }
  return features
}
