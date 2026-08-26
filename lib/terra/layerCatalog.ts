import 'server-only'

/**
 * Terra's layer catalog (Phase 3, extended Phase 4) — the declared set of genuinely renderable
 * multi-provider layers. Each entry references an existing Research Engine ResearchProviderId and
 * an existing normalize function; nothing here writes a second provider client or a second
 * Research Engine call path. The generic route (app/api/terra/layers/[layerId]/route.ts) and the
 * generic Cesium renderer (components/war-room/terra/TerraFeatureLayer.tsx) drive every entry
 * through the same code — adding a layer never means branching a component on providerId.
 *
 * Phase 3 entries: usgs_earthquake_feed, usgs_earthquake, usgs_water (DIRECT_GEO), opensky
 * (LATENT_GEO_SAFE, the extraction-boundary proof case).
 *
 * Phase 4 adds the remaining reconciled LATENT_GEO_SAFE providers (idai_gazetteer, nominatim,
 * pleiades, ohm_overpass, osm_overpass, whg, met_no, open_meteo, obis, gbif — obis/gbif newly
 * eligible after this phase's adapter bug fixes, see lib/research-engine/providers/obis.ts and
 * gbif.ts) through the SAME normalizeLatentGeoDocuments boundary Phase 3 built, plus one
 * ENTITY_GEO_RESOLVABLE entry (edh) proving the new geo-resolution boundary
 * (lib/terra/resolveGeography.ts, lib/terra/normalizeEdhInscriptions.ts) end to end.
 */
import { normalizeUsgsEarthquakeGeoFeatures } from '@/lib/terra/normalizeUsgsEarthquakeGeoFeatures'
import { normalizeUsgsWaterStations } from '@/lib/terra/normalizeUsgsWaterStations'
import { normalizeLatentGeoDocuments } from '@/lib/terra/normalizeLatentGeoDocument'
import { normalizeEdhInscriptions } from '@/lib/terra/normalizeEdhInscriptions'
import type { TerraLayerDefinition } from '@/lib/terra/types'

export const TERRA_LAYER_CATALOG: TerraLayerDefinition[] = [
  {
    id: 'usgs_earthquake_feed',
    providerId: 'usgs_earthquake_feed',
    kind: 'earthquake',
    domain: 'hazards',
    label: 'Earthquakes — Recent Feed (USGS)',
    description: 'USGS real-time significant-earthquake feed (fixed magnitude/period selection).',
    defaultQueryText: '',
    normalize: response => normalizeUsgsEarthquakeGeoFeatures('usgs_earthquake_feed', response),
  },
  {
    id: 'usgs_earthquake',
    providerId: 'usgs_earthquake',
    kind: 'earthquake',
    domain: 'hazards',
    label: 'Earthquakes — Catalog Search (USGS)',
    description: 'USGS earthquake catalog, default 30-day window, minimum magnitude 4.5.',
    defaultQueryText: '',
    normalize: response => normalizeUsgsEarthquakeGeoFeatures('usgs_earthquake', response),
  },
  {
    id: 'usgs_water',
    providerId: 'usgs_water',
    kind: 'water_gauge_reading',
    domain: 'hazards',
    label: 'Water Monitoring Station (USGS)',
    // USGS-01646500 (Potomac River near Washington, DC — Little Falls Pump Station) is the same
    // stable, documented example site number usgsWater.ts's own live-check path pings — not an
    // arbitrary choice, and not a claim that it is more significant than any other station.
    description: 'USGS real-time water monitoring station — a single site queried by number.',
    defaultQueryText: 'site 01646500',
    normalize: normalizeUsgsWaterStations,
  },
  {
    id: 'opensky',
    providerId: 'opensky',
    kind: 'aircraft_state',
    domain: 'other',
    label: 'Aircraft Positions (OpenSky)',
    // The bounding box documented directly in the adapter's own validation error message
    // (lib/research-engine/providers/opensky.ts) — Switzerland, a small, well-known example box,
    // not an arbitrarily chosen region.
    description: 'Live OpenSky Network aircraft state vectors within a bounding box.',
    defaultQueryText: '45.8,5.9,47.8,10.5',
    normalize: response => normalizeLatentGeoDocuments(response.documents, { providerId: 'opensky', kind: 'aircraft_state', domain: 'other' }),
  },
  {
    id: 'idai_gazetteer',
    providerId: 'idai_gazetteer',
    kind: 'heritage_site',
    domain: 'research',
    label: 'iDAI.gazetteer — Archaeological Places',
    description: 'German Archaeological Institute gazetteer of archaeological/historical places.',
    defaultQueryText: 'Pergamon',
    normalize: response => normalizeLatentGeoDocuments(response.documents, { providerId: 'idai_gazetteer', kind: 'heritage_site', domain: 'research' }),
  },
  {
    id: 'nominatim',
    providerId: 'nominatim',
    kind: 'place',
    domain: 'other',
    label: 'Place Search (OpenStreetMap Nominatim)',
    description: 'General-purpose OpenStreetMap place-name geocoding search.',
    defaultQueryText: 'Berlin, Germany',
    normalize: response => normalizeLatentGeoDocuments(response.documents, { providerId: 'nominatim', kind: 'place', domain: 'other' }),
  },
  {
    id: 'pleiades',
    providerId: 'pleiades',
    kind: 'heritage_site',
    domain: 'research',
    label: 'Pleiades — Ancient World Places',
    description: 'Gazetteer of places in the ancient Greek and Roman world.',
    defaultQueryText: 'Roma',
    normalize: response => normalizeLatentGeoDocuments(response.documents, { providerId: 'pleiades', kind: 'heritage_site', domain: 'research' }),
  },
  {
    id: 'whg',
    providerId: 'whg',
    kind: 'heritage_site',
    domain: 'research',
    label: 'World Historical Gazetteer',
    description: 'World Historical Gazetteer place index. Country-code-only records are honestly skipped, not misread as coordinates.',
    defaultQueryText: 'Rome',
    normalize: response => normalizeLatentGeoDocuments(response.documents, { providerId: 'whg', kind: 'heritage_site', domain: 'research' }),
  },
  {
    id: 'osm_overpass',
    providerId: 'osm_overpass',
    kind: 'geographic_feature',
    domain: 'other',
    label: 'OpenStreetMap Features (Overpass)',
    // "<name> near <lat>,<lon>[,<radiusKm>]" is the adapter's own required query shape — Overpass
    // has no unbounded worldwide search. London, 5km, is a real, documented example radius.
    description: 'Named OpenStreetMap features near a point — requires "<name> near <lat>,<lon>[,<radiusKm>]".',
    defaultQueryText: 'cafe near 51.5074,-0.1278,5',
    normalize: response => normalizeLatentGeoDocuments(response.documents, { providerId: 'osm_overpass', kind: 'geographic_feature', domain: 'other' }),
  },
  {
    id: 'ohm_overpass',
    providerId: 'ohm_overpass',
    kind: 'geographic_feature',
    domain: 'research',
    label: 'OpenHistoricalMap Features (Overpass)',
    description: 'Named OpenHistoricalMap historical features near a point — requires "<name> near <lat>,<lon>[,<radiusKm>]".',
    defaultQueryText: 'castle near 51.5074,-0.1278,20',
    normalize: response => normalizeLatentGeoDocuments(response.documents, { providerId: 'ohm_overpass', kind: 'geographic_feature', domain: 'research' }),
  },
  {
    id: 'met_no',
    providerId: 'met_no',
    kind: 'weather_observation',
    domain: 'weather',
    label: 'Weather Forecast (MET Norway)',
    // "<lat>,<lon>" is the adapter's own required query shape.
    description: 'MET Norway Locationforecast at a coordinate — requires "<lat>,<lon>".',
    defaultQueryText: '51.5074,-0.1278',
    normalize: response => normalizeLatentGeoDocuments(response.documents, { providerId: 'met_no', kind: 'weather_observation', domain: 'weather' }),
  },
  {
    id: 'open_meteo',
    providerId: 'open_meteo',
    kind: 'weather_observation',
    domain: 'weather',
    label: 'Weather Forecast (Open-Meteo)',
    description: 'Open-Meteo forecast at a coordinate — requires "<lat>,<lon>".',
    defaultQueryText: '51.5074,-0.1278',
    normalize: response => normalizeLatentGeoDocuments(response.documents, { providerId: 'open_meteo', kind: 'weather_observation', domain: 'weather' }),
  },
  {
    id: 'obis',
    providerId: 'obis',
    kind: 'biodiversity_observation',
    domain: 'science',
    label: 'Ocean Biodiversity Observations (OBIS)',
    description: 'Marine species occurrence records from the Ocean Biodiversity Information System.',
    defaultQueryText: 'Orcinus orca',
    normalize: response => normalizeLatentGeoDocuments(response.documents, { providerId: 'obis', kind: 'biodiversity_observation', domain: 'science' }),
  },
  {
    id: 'gbif',
    providerId: 'gbif',
    kind: 'biodiversity_observation',
    domain: 'science',
    label: 'Species Occurrences (GBIF)',
    description: 'Species occurrence records from the Global Biodiversity Information Facility.',
    defaultQueryText: 'Puma concolor',
    normalize: response => normalizeLatentGeoDocuments(response.documents, { providerId: 'gbif', kind: 'biodiversity_observation', domain: 'science' }),
  },
  {
    id: 'edh',
    providerId: 'edh',
    kind: 'heritage_site',
    domain: 'research',
    label: 'Roman Inscriptions (EDH) — Geo-Resolved',
    // ENTITY_GEO_RESOLVABLE, not LATENT_GEO — EDH's own `geography` field is a real modern
    // region/country NAME (e.g. "Lazio"), never coordinates. Every event this layer produces goes
    // through lib/terra/resolveGeography.ts and carries coordinateOrigin: 'resolved', distinct
    // from every other layer here.
    description: 'Epigraphic Database Heidelberg Roman inscriptions, geo-resolved by modern region/country name via nominatim.',
    defaultQueryText: 'Roma',
    normalize: normalizeEdhInscriptions,
  },
]

export function getTerraLayerDefinition(layerId: string): TerraLayerDefinition | undefined {
  return TERRA_LAYER_CATALOG.find(layer => layer.id === layerId)
}
