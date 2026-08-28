/**
 * Terra event -> Related Intelligence query construction. Pure and deterministic: given the
 * exact selected TerraGeoFeature (observed event semantics — title, kind) and the active-location
 * context (reverse-resolved place/region, once resolved), builds one bounded semantic query
 * string for the Research Engine — never keyword spam, never internal ids.
 *
 * The active-location contribution is gated on two things: `status === 'resolved'` (a
 * still-resolving or coordinate_only location adds nothing, so a query never flip-flops during the
 * brief resolving window) and a coordinate match against the selected feature (so a stale
 * activeLocation left over from a different prior selection can never leak into this event's
 * query — see isActiveLocationForFeature).
 */
import type { TerraGeoFeature, TerraIntelligenceEventKind } from './types'
import type { TerraActiveLocation } from './activeLocation'

/** Only kinds where adding a plain-English label genuinely helps a news/web search (an
 * earthquake's USGS title already says "M4.9" but not always the word "earthquake"). `null` for
 * kinds whose title is already a complete, searchable description on its own. */
const TERRA_EVENT_KIND_QUERY_LABEL: Record<TerraIntelligenceEventKind, string | null> = {
  earthquake: 'earthquake',
  tropical_cyclone: 'cyclone',
  wildfire_incident: 'wildfire',
  volcano_event: 'volcanic eruption',
  flood_event: 'flood',
  severe_weather_alert: 'severe weather',
  tsunami_alert: 'tsunami',
  water_gauge_reading: null,
  // A callsign/tail title (e.g. "UAL123") never says "aircraft" on its own — unlike the fallback
  // "Aircraft {icao24}" title, which already does and is left undoubled by the existing
  // titleLower.includes(kindLabel) guard below.
  aircraft_state: 'aircraft',
  // A vessel's title is its name (or "Vessel {mmsi}" fallback, matching aircraft's "Aircraft
  // {icao24}" convention) — neither says "vessel" on its own, so this is never doubled.
  vessel_position: 'vessel',
  heritage_site: null,
  place: null,
  geographic_feature: null,
  weather_observation: null,
  biodiversity_observation: null,
  landmark_poi: null,
  // A camera's title is its station/preset name (e.g. "Road 51 Inkoo — Hankoon") — never says
  // "traffic camera" on its own.
  traffic_camera: 'traffic camera',
  // A traffic event's title is its real Open511 headline (e.g. "CONSTRUCTION") — already
  // descriptive; doubling it would just repeat the same word.
  traffic_event: null,
}

const COORDINATE_MATCH_EPSILON_DEG = 0.0005

function isActiveLocationForFeature(feature: TerraGeoFeature, activeLocation: TerraActiveLocation | null): activeLocation is TerraActiveLocation {
  if (!activeLocation || activeLocation.status !== 'resolved') return false
  return (
    Math.abs(activeLocation.latitude - feature.latitude) < COORDINATE_MATCH_EPSILON_DEG &&
    Math.abs(activeLocation.longitude - feature.longitude) < COORDINATE_MATCH_EPSILON_DEG
  )
}

export function buildTerraEventIntelligenceQuery(feature: TerraGeoFeature, activeLocation: TerraActiveLocation | null): string {
  const title = feature.title.trim()
  const titleLower = title.toLowerCase()
  const parts: string[] = [title]

  const kindLabel = TERRA_EVENT_KIND_QUERY_LABEL[feature.kind]
  if (kindLabel && !titleLower.includes(kindLabel)) parts.push(kindLabel)

  if (isActiveLocationForFeature(feature, activeLocation)) {
    const place = activeLocation.region ?? activeLocation.place ?? null
    if (place && !titleLower.includes(place.toLowerCase())) parts.push(place)
  }

  return parts.filter(part => part.trim().length > 0).join(' ').trim()
}
