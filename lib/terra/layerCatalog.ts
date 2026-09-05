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
 *
 * Phase 5 adds Terra's first live planetary HAZARD intelligence family: nhc_current_storms
 * (tropical_cyclone — the "active hurricanes" gap Terra Phase 0 identified), nasa_eonet
 * (wildfire_incident/volcano_event/flood_event — one shared normalizer, three catalog entries),
 * nws_weather's new alerts capability (severe_weather_alert — Terra's first real polygon/region
 * geometry), and tsunami_gov (tsunami_alert, reusing the existing LATENT_GEO extraction boundary
 * unchanged since its `geography` field is already an exact "lat X, lon Y" string). Each declares
 * a source-appropriate refreshIntervalMs rather than sharing one fixed polling rate.
 */
import { normalizeUsgsEarthquakeGeoFeatures } from '@/lib/terra/normalizeUsgsEarthquakeGeoFeatures'
import { normalizeUsgsWaterStations } from '@/lib/terra/normalizeUsgsWaterStations'
import { normalizeLatentGeoDocuments } from '@/lib/terra/normalizeLatentGeoDocument'
import { normalizeOpenSkyAircraft } from '@/lib/terra/normalizeOpenSkyAircraft'
import { normalizeDigitrafficMarineVessels } from '@/lib/terra/normalizeDigitrafficMarineVessels'
import { normalizeDigitrafficRoadCameras } from '@/lib/terra/normalizeDigitrafficRoadCameras'
import { normalizeDriveBcTrafficEvents } from '@/lib/terra/normalizeDriveBcTrafficEvents'
import { normalizeWebtrisTrafficFlow } from '@/lib/terra/normalizeWebtrisTrafficFlow'
import { normalizeDigitrafficRoadWeather } from '@/lib/terra/normalizeDigitrafficRoadWeather'
import { normalizeOntarioTrafficCameras } from '@/lib/terra/normalizeOntarioTrafficCameras'
import { normalizeOntarioTrafficEvents } from '@/lib/terra/normalizeOntarioTrafficEvents'
import { normalizeHongKongTrafficCameras } from '@/lib/terra/normalizeHongKongTrafficCameras'
import { normalizeQuebecTrafficCameras } from '@/lib/terra/normalizeQuebecTrafficCameras'
import { normalizeQuebecTrafficEvents } from '@/lib/terra/normalizeQuebecTrafficEvents'
import { normalizeJarticTrafficFlow } from '@/lib/terra/normalizeJarticTrafficFlow'
import { normalizeWzdxWorkZones } from '@/lib/terra/normalizeWzdxWorkZones'
import { normalizeEdhInscriptions } from '@/lib/terra/normalizeEdhInscriptions'
import { normalizeNhcCurrentStorms } from '@/lib/terra/normalizeNhcCurrentStorms'
import { normalizeNasaEonet } from '@/lib/terra/normalizeNasaEonet'
import { normalizeNwsAlerts } from '@/lib/terra/normalizeNwsAlerts'
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
    // not an arbitrarily chosen region. Only used as a fallback if this route is ever called
    // without an explicit `?q=` override; TerraShell's real aircraft layer always supplies one
    // built from the Commander's live camera view (lib/terra/aircraftBoundingBox.ts).
    description: 'Live OpenSky Network aircraft state vectors within a bounding box.',
    defaultQueryText: '45.8,5.9,47.8,10.5',
    // Live aircraft intelligence phase: a dedicated normalizer (not the generic
    // normalizeLatentGeoDocuments boundary the other 7 LATENT_GEO providers still share) so real
    // altitude/heading/velocity/vertical-rate/on-ground fields survive into typed properties
    // instead of being dropped.
    normalize: response => normalizeOpenSkyAircraft(response.documents),
    // Aircraft move continuously — refreshed far more often than any hazard layer, but matched to
    // (never faster than) the Research Engine's own 60s live-feed cache TTL for opensky
    // (lib/research-engine/cache/ttlCache.ts CACHE_TTL.liveFeed) and this repo's own
    // no-layer-faster-than-60s floor (see layerCatalog.validation.ts) — refreshing any faster
    // would just re-poll the same cached response without ever seeing fresher data.
    refreshIntervalMs: 60_000,
  },
  {
    id: 'digitraffic_marine',
    providerId: 'digitraffic_marine',
    kind: 'vessel_position',
    domain: 'other',
    label: 'Vessel Positions (Digitraffic Marine — Finland)',
    // A small real bbox around the Helsinki/Gulf of Finland approaches — the adapter's own
    // documented example (lib/research-engine/providers/digitraffic_marine.ts), matching
    // usgs_water's "real example site number" and opensky's "real example bbox" convention. Only
    // used as a fallback if this route is ever called without an explicit `?q=` override;
    // TerraShell's real Maritime layer always supplies one built from the Commander's live camera
    // view via lib/terra/maritimeBoundingBox.ts, gated by the Maritime Coverage Resolver.
    description: 'Live Digitraffic (Fintraffic) AIS vessel positions + static/voyage metadata within a bounding box — Finnish territorial waters/EEZ only, not global blue-water AIS coverage.',
    defaultQueryText: '59.0,24.0,60.5,26.0',
    normalize: response => normalizeDigitrafficMarineVessels(response.documents),
    // Matched to (never faster than) the Research Engine's own 60s live-feed cache TTL for
    // digitraffic_marine and this repo's no-layer-faster-than-60s floor — same reasoning as
    // opensky's identical refreshIntervalMs above.
    refreshIntervalMs: 60_000,
  },
  {
    id: 'digitraffic_road_cameras',
    providerId: 'digitraffic_road_cameras',
    kind: 'traffic_camera',
    domain: 'other',
    label: 'Traffic Cameras (Digitraffic Road — Finland)',
    // Helsinki metro area — the adapter's own documented example, same convention as the maritime
    // entry above. TerraShell's real layer always supplies a bbox from the live camera view via
    // lib/terra/roadCameraBoundingBox.ts.
    description: 'Live Digitraffic (Fintraffic) road weathercam still images + real capture freshness within a bounding box — Finnish national road network only.',
    defaultQueryText: '59.9,24.5,60.3,25.3',
    normalize: response => normalizeDigitrafficRoadCameras(response.documents),
    refreshIntervalMs: 60_000,
  },
  {
    id: 'drivebc_events',
    providerId: 'drivebc_events',
    kind: 'traffic_event',
    domain: 'other',
    label: 'Traffic Events (DriveBC / Open511 — British Columbia)',
    // Greater Vancouver — the adapter's own documented example.
    description: 'Live DriveBC (Open511) source-backed road events — crashes, closures, construction, hazards — within a bounding box. British Columbia only.',
    defaultQueryText: '-123.3,49.0,-122.7,49.4',
    normalize: response => normalizeDriveBcTrafficEvents(response.documents),
    refreshIntervalMs: 60_000,
  },
  {
    id: 'webtris',
    providerId: 'webtris',
    kind: 'traffic_flow_observation',
    domain: 'other',
    label: 'Traffic Flow (WebTRIS — National Highways, UK)',
    // The M25/London area — the adapter's own documented example. Every observation this layer
    // returns is historical (see lib/research-engine/providers/webtris.ts) — never presented as
    // live, however fresh the fetch that retrieved it was.
    description: 'Historical WebTRIS (National Highways) roadside sensor speed/volume observations within a bounding box — England strategic road network only. Source data lags real time by roughly two months; never rendered as live.',
    defaultQueryText: '51.3,-0.6,51.7,0.3',
    normalize: response => normalizeWebtrisTrafficFlow(response.documents),
    // Matches this source's own real cadence (a batch statistical report, not a live feed) — no
    // value in polling faster than the Research Engine's own timeSeries cache TTL for it.
    refreshIntervalMs: 6 * 60 * 60 * 1000,
  },
  {
    id: 'digitraffic_road_weather',
    providerId: 'digitraffic_road_weather',
    kind: 'road_weather_observation',
    domain: 'weather',
    label: 'Road Weather (Digitraffic — Finland)',
    description: 'Live Digitraffic (Fintraffic) road-weather station observations (air/road/ground temperature, humidity, visibility, wind, precipitation) within a bounding box — Finnish national road network only.',
    defaultQueryText: '59.9,24.5,60.3,25.3',
    normalize: response => normalizeDigitrafficRoadWeather(response.documents),
    refreshIntervalMs: 60_000,
  },
  {
    id: 'ontario_511_cameras',
    providerId: 'ontario_511_cameras',
    kind: 'traffic_camera',
    domain: 'other',
    label: 'Traffic Cameras (Ontario 511 — Canada)',
    // Toronto/QEW area — the adapter's own documented example.
    description: 'Live Ontario 511 (511on.ca) traffic camera stills within a bounding box — Ontario, Canada only. Licensing/redistribution terms not independently confirmed this build.',
    defaultQueryText: '43.5,-79.6,43.9,-79.1',
    normalize: response => normalizeOntarioTrafficCameras(response.documents),
    refreshIntervalMs: 60_000,
  },
  {
    id: 'ontario_511_events',
    providerId: 'ontario_511_events',
    kind: 'traffic_event',
    domain: 'other',
    label: 'Traffic Events (Ontario 511 — Canada)',
    description: 'Live Ontario 511 (511on.ca) source-backed road events — crashes, closures, construction, hazards — within a bounding box. Ontario, Canada only.',
    defaultQueryText: '43.5,-79.6,43.9,-79.1',
    normalize: response => normalizeOntarioTrafficEvents(response.documents),
    refreshIntervalMs: 60_000,
  },
  // God's Eye Phase 3 — global traffic expansion. Seven new layers, every one backed by a real,
  // keyless, live-verified-this-build adapter (see lib/terra/roadTrafficSourceRegistry.ts).
  {
    id: 'hong_kong_td_cameras',
    providerId: 'hong_kong_td_cameras',
    kind: 'traffic_camera',
    domain: 'other',
    label: 'Traffic Cameras (Hong Kong TD — Hong Kong SAR)',
    // Urban Hong Kong (HK Island + Kowloon) — a real, documented example area. TerraShell's real
    // layer always supplies a bbox from the live camera view via lib/terra/hongKongBoundingBox.ts.
    description: 'Live Hong Kong Transport Department traffic snapshot cameras within a bounding box — Hong Kong SAR only. Snapshot JPEGs via the documented tdcctv.data.one.gov.hk/{key}.JPG pattern; no per-image capture timestamp in the source metadata, so freshness is honestly unknown.',
    defaultQueryText: '22.25,114.10,22.35,114.25',
    normalize: response => normalizeHongKongTrafficCameras(response.documents),
    refreshIntervalMs: 60_000,
  },
  {
    id: 'quebec_511_cameras',
    providerId: 'quebec_511_cameras',
    kind: 'traffic_camera',
    domain: 'other',
    label: 'Traffic Cameras (Québec 511 — Canada)',
    // Montréal area — the adapter's own documented example.
    description: 'Live Québec 511 (MTMD WFS) traffic camera sites within a bounding box — Québec, Canada only. The source publishes an HTML viewer page per camera, not a direct JPEG — no imageUrl is ever fabricated.',
    defaultQueryText: '45.3,-74.2,45.8,-73.3',
    normalize: response => normalizeQuebecTrafficCameras(response.documents),
    refreshIntervalMs: 60_000,
  },
  {
    id: 'quebec_511_events',
    providerId: 'quebec_511_events',
    kind: 'traffic_event',
    domain: 'other',
    label: 'Traffic Events (Québec 511 — Canada)',
    description: 'Live Québec 511 (MTMD WFS) road events — closures, construction, restrictions — within a bounding box. Real French-language source vocabulary and real Point/LineString geometry preserved verbatim. Québec, Canada only.',
    defaultQueryText: '45.3,-74.2,45.8,-73.3',
    normalize: response => normalizeQuebecTrafficEvents(response.documents),
    refreshIntervalMs: 60_000,
  },
  {
    id: 'jartic_traffic_volumes',
    providerId: 'jartic_traffic_volumes',
    kind: 'traffic_flow_observation',
    domain: 'other',
    label: 'Traffic Volumes (JARTIC — Japan)',
    // Tokyo area — the adapter's own documented example. Observations are hourly JST buckets with
    // a ~2-hour publication lag (empirically bracketed live this build) — recent, honestly
    // 'current', never a hardcoded lag.
    description: 'Near-real-time JARTIC (Japan) hourly directional traffic-volume observations within a bounding box — national Japan coverage. Vehicle counts only; no speed or congestion label is ever invented.',
    defaultQueryText: '35.0,139.0,36.0,140.0',
    normalize: response => normalizeJarticTrafficFlow(response.documents),
    refreshIntervalMs: 15 * 60 * 1000,
  },
  {
    id: 'wzdx_wsdot',
    providerId: 'wzdx_wsdot',
    kind: 'traffic_event',
    domain: 'other',
    label: 'Work Zones (WSDOT WZDx — Washington State)',
    // Seattle metro — a real example area within the feed's state coverage.
    description: 'Live WSDOT WZDx v4.2 work-zone road events within a bounding box — Washington State only. Feed self-reports a 60-second update cadence.',
    defaultQueryText: '47.2,-122.6,47.9,-121.9',
    normalize: response => normalizeWzdxWorkZones(response.documents, 'wzdx_wsdot'),
    refreshIntervalMs: 60_000,
  },
  {
    id: 'wzdx_iowa_dot',
    providerId: 'wzdx_iowa_dot',
    kind: 'traffic_event',
    domain: 'other',
    label: 'Work Zones (Iowa DOT WZDx)',
    // Des Moines metro — a real example area within the feed's state coverage.
    description: 'Live Iowa DOT WZDx v4.0 work-zone road events within a bounding box — Iowa only. Feed registry documents a 1-minute update cadence.',
    defaultQueryText: '41.4,-93.9,41.8,-93.4',
    normalize: response => normalizeWzdxWorkZones(response.documents, 'wzdx_iowa_dot'),
    refreshIntervalMs: 60_000,
  },
  {
    id: 'wzdx_kytc',
    providerId: 'wzdx_kytc',
    kind: 'traffic_event',
    domain: 'other',
    label: 'Work Zones (KYTC WZDx — Kentucky)',
    // Louisville metro — a real example area within the feed's state coverage.
    description: 'Live KYTC WZDx v4.1 work-zone road events within a bounding box — Kentucky only. Feed registry documents a 30-minute update cadence.',
    defaultQueryText: '38.0,-85.9,38.4,-85.4',
    normalize: response => normalizeWzdxWorkZones(response.documents, 'wzdx_kytc'),
    refreshIntervalMs: 5 * 60 * 1000,
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
    id: 'nearby_landmarks',
    providerId: 'osm_overpass',
    kind: 'landmark_poi',
    domain: 'other',
    label: 'Nearby Landmarks & POIs (Overpass)',
    // God's Eye multi-scale phase: driven entirely by TerraShell's camera-scale + active-location
    // state via useTerraLayer's queryOverride param (see components/war-room/terra/TerraShell.tsx)
    // — this defaultQueryText is never actually requested in practice (the layer only fetches once
    // a real override is computed), but every layer needs a real, documented default per this
    // catalog's own convention, so it uses the same real example radius as osm_overpass above.
    description: 'Named landmarks, attractions, and civic/natural/transit POIs near the active location — requires "category:<landmark|natural|civic|transit> near <lat>,<lon>[,<radiusKm>]".',
    defaultQueryText: 'category:landmark near 51.5074,-0.1278,3',
    normalize: response => normalizeLatentGeoDocuments(response.documents, { providerId: 'osm_overpass', kind: 'landmark_poi', domain: 'other' }),
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
  {
    id: 'nhc_current_storms',
    providerId: 'nhc_current_storms',
    kind: 'tropical_cyclone',
    domain: 'hazards',
    label: 'Active Tropical Cyclones (NHC)',
    description: 'NOAA National Hurricane Center — every currently active tropical/subtropical/post-tropical cyclone, all basins. Current observed position only; forecast track is linked, not rendered.',
    defaultQueryText: '',
    // Advisories issue roughly every 6h during a storm's lifecycle (more often near landfall) —
    // 5 minutes is a responsive-but-bounded check-in, well above the source's own real update
    // cadence, not a fixed "same as everything else" rate.
    refreshIntervalMs: 5 * 60 * 1000,
    normalize: normalizeNhcCurrentStorms,
  },
  {
    id: 'nasa_eonet_wildfires',
    providerId: 'nasa_eonet',
    kind: 'wildfire_incident',
    domain: 'hazards',
    label: 'Active Wildfires (NASA EONET)',
    description: 'Named wildfire incidents (e.g. via IRWIN), not raw satellite thermal-anomaly detections — NASA EONET, category=wildfires.',
    defaultQueryText: 'wildfires',
    // EONET's own catalog updates on the order of hours, not minutes.
    refreshIntervalMs: 10 * 60 * 1000,
    normalize: response => normalizeNasaEonet(response, { kind: 'wildfire_incident', domain: 'hazards' }),
  },
  {
    id: 'nasa_eonet_volcanoes',
    providerId: 'nasa_eonet',
    kind: 'volcano_event',
    domain: 'hazards',
    label: 'Active Volcanic Activity (NASA EONET)',
    description: 'Currently active volcanoes (Smithsonian Global Volcanism Program via NASA EONET, category=volcanoes).',
    defaultQueryText: 'volcanoes',
    refreshIntervalMs: 10 * 60 * 1000,
    normalize: response => normalizeNasaEonet(response, { kind: 'volcano_event', domain: 'hazards' }),
  },
  {
    id: 'nasa_eonet_floods',
    providerId: 'nasa_eonet',
    kind: 'flood_event',
    domain: 'hazards',
    label: 'Active Floods (NASA EONET)',
    description: 'Currently open flood events (NASA EONET, category=floods) — may legitimately be empty; a real empty result, never a fabricated one.',
    defaultQueryText: 'floods',
    refreshIntervalMs: 10 * 60 * 1000,
    normalize: response => normalizeNasaEonet(response, { kind: 'flood_event', domain: 'hazards' }),
  },
  {
    id: 'nws_severe_weather_alerts',
    providerId: 'nws_weather',
    kind: 'severe_weather_alert',
    domain: 'hazards',
    label: 'Severe Weather Alerts (NWS)',
    // Nationwide active alerts — real CAP severity/urgency/certainty preserved verbatim in
    // properties. Zone-only alerts (no real polygon) are honestly skipped, not geo-resolved from
    // a compound multi-county area description.
    description: 'Real NOAA/NWS CAP alerts (Severe Thunderstorm Warning, Flash Flood Warning, Red Flag Warning, etc.) with real polygon warning areas.',
    defaultQueryText: 'alerts',
    normalize: normalizeNwsAlerts,
  },
  {
    id: 'tsunami_gov',
    providerId: 'tsunami_gov',
    kind: 'tsunami_alert',
    domain: 'hazards',
    label: 'Tsunami Bulletins (NOAA NTWC)',
    // tsunami_gov's own `geography` field is already an exact "lat X, lon Y" string — reuses the
    // existing LATENT_GEO extraction boundary unchanged, not a new normalizer.
    description: 'NOAA National Tsunami Warning Center bulletins. Most real entries are "Information" statements confirming no danger — the honest common case, not a broken feed.',
    defaultQueryText: '',
    normalize: response => normalizeLatentGeoDocuments(response.documents, { providerId: 'tsunami_gov', kind: 'tsunami_alert', domain: 'hazards' }),
  },
]

export function getTerraLayerDefinition(layerId: string): TerraLayerDefinition | undefined {
  return TERRA_LAYER_CATALOG.find(layer => layer.id === layerId)
}
