/**
 * Client-safe summary of lib/terra/layerCatalog.ts — id/label/domain/kind/description only, no
 * `normalize` function and no import of it. TerraShell.tsx ('use client') needs to render the
 * layer list and group it by domain, but the full catalog now transitively imports
 * lib/terra/resolveGeography.ts -> executeResearch() -> the server-only Research Engine adapter
 * chain (added this phase for the EDH ENTITY_GEO_RESOLVABLE layer); importing layerCatalog.ts
 * directly from a client component would bundle that entire server-only chain into the browser.
 *
 * This file intentionally duplicates the display fields rather than re-exporting a mapped subset
 * of TERRA_LAYER_CATALOG, specifically so it carries zero runtime imports from
 * lib/terra/layerCatalog.ts or anything it imports. lib/terra/layerCatalogSummary.validation.ts
 * cross-checks this list against the real catalog so the two can never silently drift apart.
 */
import type { TerraIntelligenceDomain, TerraIntelligenceEventKind } from '@/lib/terra/types'

export type TerraLayerSummary = {
  id: string
  label: string
  domain: TerraIntelligenceDomain
  kind: TerraIntelligenceEventKind
  description: string
}

export const TERRA_LAYER_SUMMARIES: TerraLayerSummary[] = [
  { id: 'usgs_earthquake_feed', label: 'Earthquakes — Recent Feed (USGS)', domain: 'hazards', kind: 'earthquake', description: 'USGS real-time significant-earthquake feed (fixed magnitude/period selection).' },
  { id: 'usgs_earthquake', label: 'Earthquakes — Catalog Search (USGS)', domain: 'hazards', kind: 'earthquake', description: 'USGS earthquake catalog, default 30-day window, minimum magnitude 4.5.' },
  { id: 'usgs_water', label: 'Water Monitoring Station (USGS)', domain: 'hazards', kind: 'water_gauge_reading', description: 'USGS real-time water monitoring station — a single site queried by number.' },
  { id: 'opensky', label: 'Aircraft Positions (OpenSky)', domain: 'other', kind: 'aircraft_state', description: 'Live OpenSky Network aircraft state vectors within a bounding box.' },
  { id: 'idai_gazetteer', label: 'iDAI.gazetteer — Archaeological Places', domain: 'research', kind: 'heritage_site', description: 'German Archaeological Institute gazetteer of archaeological/historical places.' },
  { id: 'nominatim', label: 'Place Search (OpenStreetMap Nominatim)', domain: 'other', kind: 'place', description: 'General-purpose OpenStreetMap place-name geocoding search.' },
  { id: 'pleiades', label: 'Pleiades — Ancient World Places', domain: 'research', kind: 'heritage_site', description: 'Gazetteer of places in the ancient Greek and Roman world.' },
  { id: 'whg', label: 'World Historical Gazetteer', domain: 'research', kind: 'heritage_site', description: 'World Historical Gazetteer place index. Country-code-only records are honestly skipped, not misread as coordinates.' },
  { id: 'osm_overpass', label: 'OpenStreetMap Features (Overpass)', domain: 'other', kind: 'geographic_feature', description: 'Named OpenStreetMap features near a point — requires "<name> near <lat>,<lon>[,<radiusKm>]".' },
  { id: 'ohm_overpass', label: 'OpenHistoricalMap Features (Overpass)', domain: 'research', kind: 'geographic_feature', description: 'Named OpenHistoricalMap historical features near a point — requires "<name> near <lat>,<lon>[,<radiusKm>]".' },
  { id: 'met_no', label: 'Weather Forecast (MET Norway)', domain: 'weather', kind: 'weather_observation', description: 'MET Norway Locationforecast at a coordinate — requires "<lat>,<lon>".' },
  { id: 'open_meteo', label: 'Weather Forecast (Open-Meteo)', domain: 'weather', kind: 'weather_observation', description: 'Open-Meteo forecast at a coordinate — requires "<lat>,<lon>".' },
  { id: 'obis', label: 'Ocean Biodiversity Observations (OBIS)', domain: 'science', kind: 'biodiversity_observation', description: 'Marine species occurrence records from the Ocean Biodiversity Information System.' },
  { id: 'gbif', label: 'Species Occurrences (GBIF)', domain: 'science', kind: 'biodiversity_observation', description: 'Species occurrence records from the Global Biodiversity Information Facility.' },
  { id: 'edh', label: 'Roman Inscriptions (EDH) — Geo-Resolved', domain: 'research', kind: 'heritage_site', description: 'Epigraphic Database Heidelberg Roman inscriptions, geo-resolved by modern region/country name via nominatim.' },
]
