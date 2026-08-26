/**
 * Terra's layer catalog (Phase 3) — the declared set of genuinely renderable multi-provider
 * layers. Each entry references an existing Research Engine ResearchProviderId and an existing
 * normalize function; nothing here writes a second provider client or a second Research Engine
 * call path. The generic route (app/api/terra/layers/[layerId]/route.ts) and the generic Cesium
 * renderer (components/war-room/terra/TerraFeatureLayer.tsx) drive every entry through the same
 * code — adding a layer never means branching a component on providerId.
 *
 * Only entries for providers actually promoted this phase:
 *   - usgs_earthquake_feed: the Phase 1/2 feed, unchanged default query, still on its own entry so
 *     its distinct fixed-magnitude/period selection stays visible as its own toggle.
 *   - usgs_earthquake: newly promoted (DIRECT_GEO), a flexible custom-range catalog search — kept
 *     as a separate layer from the feed rather than merged, since they answer different questions
 *     (a broader/older catalog window vs. the feed's fixed recent-significant-events window) and
 *     merging them would blur that distinction from the Commander.
 *   - usgs_water: newly promoted (DIRECT_GEO), one event per monitoring station.
 *   - opensky: newly promoted (LATENT_GEO), proves normalizeLatentGeoDocuments against a real
 *     provider whose coordinates are not in ResearchGeoFeature form.
 * The other 7 reconciled-reliable LATENT_GEO providers (idai_gazetteer, nominatim, pleiades,
 * ohm_overpass, osm_overpass, whg, met_no/open_meteo) are left uncataloged this phase — the
 * extraction boundary (normalizeLatentGeoDocument.ts) already supports them generically, so adding
 * any of them later is one new catalog entry, not new extraction logic. Wiring all of them now
 * would be exactly the "mass provider projection" this phase's mission explicitly deferred.
 */
import { normalizeUsgsEarthquakeGeoFeatures } from '@/lib/terra/normalizeUsgsEarthquakeGeoFeatures'
import { normalizeUsgsWaterStations } from '@/lib/terra/normalizeUsgsWaterStations'
import { normalizeLatentGeoDocuments } from '@/lib/terra/normalizeLatentGeoDocument'
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
]

export function getTerraLayerDefinition(layerId: string): TerraLayerDefinition | undefined {
  return TERRA_LAYER_CATALOG.find(layer => layer.id === layerId)
}
