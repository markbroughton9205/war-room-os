/**
 * Coverage federation registry — every Terra provider Commander can actually query.
 * Query time: ACTIVE LOCATION → intersect coverage → invoke eligible providers → merge.
 * Never invents global coverage. Viewer-only rows are official links, not scraped HTML.
 */
import { DIGITRAFFIC_ROAD_CAMERA_COVERAGE_BBOX } from './roadCameraBoundingBox'
import { ONTARIO_511_COVERAGE_BBOX } from './ontarioBoundingBox'
import { QUEBEC_511_COVERAGE_BBOX } from './quebec511BoundingBox'
import { HONG_KONG_TD_COVERAGE_BBOX } from './hongKongBoundingBox'
import { OHGO_COVERAGE_BBOX } from './ohgoBoundingBox'
import { CALTRANS_COVERAGE_BBOX } from './caltransBoundingBox'
import { NY511_COVERAGE_BBOX } from './ny511BoundingBox'
import { DIGITRAFFIC_MARINE_COVERAGE_BBOX } from './maritimeBoundingBox'
import { DRIVEBC_EVENTS_COVERAGE_BBOX } from './trafficEventBoundingBox'
import { WEBTRIS_COVERAGE_BBOX } from './webtrisBoundingBox'
import { JARTIC_COVERAGE_BBOX } from './jarticBoundingBox'
import { WZDX_COVERAGE_BBOXES } from './wzdxBoundingBox'
import type { TerraDegreeRectangle } from './aircraftBoundingBox'
import { TERRA_OFFICIAL_VIEWERS } from './terraPublicIdentity'

export const TERRA_AUTH_MODELS = ['PUBLIC', 'PROVIDER_AUTH', 'COMMANDER_PRIVATE'] as const
export type TerraAuthModel = (typeof TERRA_AUTH_MODELS)[number]

export const TERRA_ENDPOINT_TYPES = ['API', 'OFFICIAL_VIEWER', 'TILE', 'RSS'] as const
export type TerraEndpointType = (typeof TERRA_ENDPOINT_TYPES)[number]

export const TERRA_COVERAGE_QUERY_RESULTS = ['COVERED', 'PARTIAL', 'NO_COVERAGE'] as const
export type TerraCoverageQueryResult = (typeof TERRA_COVERAGE_QUERY_RESULTS)[number]

export type TerraCoverageProviderRecord = {
  id: string
  category: string
  coverage: TerraDegreeRectangle | 'GLOBAL'
  country: string
  region: string
  authModel: TerraAuthModel
  endpointType: TerraEndpointType
  layerIds: readonly string[]
  apiUrl: string | null
  viewerUrl: string | null
  terms: string
  license: string
}

function pointIn(lat: number, lon: number, bbox: TerraDegreeRectangle): boolean {
  return lon >= bbox.west && lon <= bbox.east && lat >= bbox.south && lat <= bbox.north
}

export const TERRA_COVERAGE_REGISTRY: readonly TerraCoverageProviderRecord[] = [
  { id: 'met_no', category: 'weather', coverage: 'GLOBAL', country: 'NO', region: 'global', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['met_no'], apiUrl: 'https://api.met.no/weatherapi/locationforecast/2.0/compact', viewerUrl: TERRA_OFFICIAL_VIEWERS.metNorway, terms: 'https://api.met.no/doc/TermsOfService', license: 'CC BY 4.0' },
  { id: 'open_meteo', category: 'weather', coverage: 'GLOBAL', country: 'CH', region: 'global', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['open_meteo'], apiUrl: 'https://api.open-meteo.com/v1/forecast', viewerUrl: TERRA_OFFICIAL_VIEWERS.openMeteo, terms: 'https://open-meteo.com/en/terms', license: 'CC BY 4.0 (attribution)' },
  { id: 'gbif', category: 'science', coverage: 'GLOBAL', country: 'DK', region: 'global', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['gbif'], apiUrl: 'https://api.gbif.org/v1/occurrence/search', viewerUrl: TERRA_OFFICIAL_VIEWERS.gbif, terms: 'https://www.gbif.org/terms', license: 'per-record' },
  { id: 'obis', category: 'science', coverage: 'GLOBAL', country: 'UNESCO-IOC', region: 'global-marine', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['obis'], apiUrl: 'https://api.obis.org/v3/occurrence', viewerUrl: TERRA_OFFICIAL_VIEWERS.obis, terms: 'https://obis.org/about/', license: 'per-record' },
  { id: 'nominatim', category: 'poi', coverage: 'GLOBAL', country: 'OSM', region: 'global', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['nominatim'], apiUrl: 'https://nominatim.openstreetmap.org/search', viewerUrl: TERRA_OFFICIAL_VIEWERS.nominatim, terms: 'https://operations.osmfoundation.org/policies/nominatim/', license: 'ODbL' },
  { id: 'osm_overpass', category: 'poi', coverage: 'GLOBAL', country: 'OSM', region: 'global', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['osm_overpass', 'nearby_landmarks'], apiUrl: 'https://overpass-api.de/api/interpreter', viewerUrl: TERRA_OFFICIAL_VIEWERS.osm, terms: 'https://wiki.openstreetmap.org/wiki/Overpass_API', license: 'ODbL' },
  { id: 'ohm_overpass', category: 'heritage', coverage: 'GLOBAL', country: 'OHM', region: 'global-historical', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['ohm_overpass'], apiUrl: 'https://overpass-api.openhistoricalmap.org/api/interpreter', viewerUrl: TERRA_OFFICIAL_VIEWERS.ohm, terms: 'https://wiki.openstreetmap.org/wiki/OpenHistoricalMap', license: 'ODbL' },
  { id: 'idai_gazetteer', category: 'heritage', coverage: 'GLOBAL', country: 'DE', region: 'archaeological', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['idai_gazetteer'], apiUrl: 'https://gazetteer.dainst.org/search.json', viewerUrl: TERRA_OFFICIAL_VIEWERS.idai, terms: 'https://gazetteer.dainst.org/', license: 'iDAI terms' },
  { id: 'pleiades', category: 'heritage', coverage: 'GLOBAL', country: 'US', region: 'ancient-mediterranean', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['pleiades'], apiUrl: 'https://pleiades.stoa.org/search_rss', viewerUrl: TERRA_OFFICIAL_VIEWERS.pleiades, terms: 'https://pleiades.stoa.org/', license: 'CC-BY' },
  { id: 'whg', category: 'heritage', coverage: 'GLOBAL', country: 'US', region: 'historical-places', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['whg'], apiUrl: 'https://whgazetteer.org/api/index/', viewerUrl: TERRA_OFFICIAL_VIEWERS.whg, terms: 'https://whgazetteer.org/', license: 'WHG terms' },
  { id: 'edh', category: 'heritage', coverage: 'GLOBAL', country: 'DE', region: 'roman-epigraphy', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['edh'], apiUrl: 'https://edh.ub.uni-heidelberg.de/data/api/inschrift/suche', viewerUrl: TERRA_OFFICIAL_VIEWERS.edh, terms: 'https://edh.ub.uni-heidelberg.de/', license: 'EDH terms' },
  { id: 'ohgo', category: 'cameras', coverage: OHGO_COVERAGE_BBOX, country: 'US', region: 'Ohio', authModel: 'PROVIDER_AUTH', endpointType: 'API', layerIds: ['ohgo_cameras', 'ohgo_events', 'ohgo_road_weather'], apiUrl: 'https://publicapi.ohgo.com/api/v1/cameras', viewerUrl: TERRA_OFFICIAL_VIEWERS.ohgo, terms: 'https://publicapi.ohgo.com/docs/terms-of-use', license: 'OHGO Public API' },
  { id: 'digitraffic_road_cameras', category: 'cameras', coverage: DIGITRAFFIC_ROAD_CAMERA_COVERAGE_BBOX, country: 'FI', region: 'Finland', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['digitraffic_road_cameras'], apiUrl: 'https://tie.digitraffic.fi/api/weathercam/v1/stations', viewerUrl: 'https://www.digitraffic.fi/', terms: 'CC BY 4.0', license: 'CC BY 4.0' },
  { id: 'ontario_511_cameras', category: 'cameras', coverage: ONTARIO_511_COVERAGE_BBOX, country: 'CA', region: 'Ontario', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['ontario_511_cameras'], apiUrl: 'https://511on.ca/api/v2/get/cameras', viewerUrl: 'https://511on.ca/', terms: 'Government of Ontario', license: 'terms not independently confirmed' },
  { id: 'quebec_511_cameras', category: 'cameras', coverage: QUEBEC_511_COVERAGE_BBOX, country: 'CA', region: 'Québec', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['quebec_511_cameras'], apiUrl: 'https://ws.mapserver.transports.gouv.qc.ca/swtq', viewerUrl: 'https://www.quebec511.info/', terms: 'Québec open data', license: 'Québec open data' },
  { id: 'hong_kong_td_cameras', category: 'cameras', coverage: HONG_KONG_TD_COVERAGE_BBOX, country: 'HK', region: 'Hong Kong SAR', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['hong_kong_td_cameras'], apiUrl: 'https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.csv', viewerUrl: 'https://data.gov.hk/', terms: 'Hong Kong SAR open data', license: 'HK open data' },
  { id: 'caltrans_cctv', category: 'cameras', coverage: CALTRANS_COVERAGE_BBOX, country: 'US', region: 'California', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['caltrans_cctv'], apiUrl: 'https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm', viewerUrl: TERRA_OFFICIAL_VIEWERS.caltrans, terms: 'Caltrans CWWP2 fair use (stills; no bulk streaming)', license: 'Caltrans CWWP2' },
  { id: '511ny', category: 'cameras', coverage: NY511_COVERAGE_BBOX, country: 'US', region: 'New York', authModel: 'PROVIDER_AUTH', endpointType: 'OFFICIAL_VIEWER', layerIds: [], apiUrl: 'https://511ny.org/api/v2/get/cameras', viewerUrl: TERRA_OFFICIAL_VIEWERS.ny511, terms: '511NY developer key required for API; official map is public', license: '511NY' },
  { id: 'usgs_earthquake', category: 'hazards', coverage: 'GLOBAL', country: 'US', region: 'global', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['usgs_earthquake_feed', 'usgs_earthquake'], apiUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson', viewerUrl: 'https://earthquake.usgs.gov/', terms: 'USGS public domain', license: 'public domain' },
  { id: 'nhc_current_storms', category: 'hazards', coverage: 'GLOBAL', country: 'US', region: 'tropical-basins', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['nhc_current_storms'], apiUrl: 'https://www.nhc.noaa.gov/CurrentStorms.json', viewerUrl: 'https://www.nhc.noaa.gov/', terms: 'NOAA public', license: 'US government work' },
  { id: 'nasa_eonet', category: 'hazards', coverage: 'GLOBAL', country: 'US', region: 'global', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['nasa_eonet_wildfires', 'nasa_eonet_volcanoes', 'nasa_eonet_floods'], apiUrl: 'https://eonet.gsfc.nasa.gov/api/v3/events', viewerUrl: 'https://eonet.gsfc.nasa.gov/', terms: 'NASA EONET public', license: 'NASA' },
  { id: 'nws_severe_weather_alerts', category: 'hazards', coverage: { west: -179.2, south: 17.8, east: -64.5, north: 71.5 }, country: 'US', region: 'United States + territories', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['nws_severe_weather_alerts'], apiUrl: 'https://api.weather.gov/alerts/active', viewerUrl: 'https://www.weather.gov/', terms: 'NWS public', license: 'US government work' },
  { id: 'tsunami_gov', category: 'hazards', coverage: 'GLOBAL', country: 'US', region: 'tsunami-basins', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['tsunami_gov'], apiUrl: 'https://www.tsunami.gov/events/xml/PAAQAtom.xml', viewerUrl: 'https://www.tsunami.gov/', terms: 'NOAA NTWC public', license: 'US government work' },
  { id: 'digitraffic_marine', category: 'maritime', coverage: DIGITRAFFIC_MARINE_COVERAGE_BBOX, country: 'FI', region: 'Finnish waters / EEZ', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['digitraffic_marine'], apiUrl: 'https://meri.digitraffic.fi/api/ais/v1/locations', viewerUrl: 'https://www.digitraffic.fi/', terms: 'CC BY 4.0', license: 'CC BY 4.0' },
  { id: 'digitraffic_road_weather', category: 'weather', coverage: DIGITRAFFIC_ROAD_CAMERA_COVERAGE_BBOX, country: 'FI', region: 'Finland roads', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['digitraffic_road_weather'], apiUrl: 'https://tie.digitraffic.fi/api/weather/v1/stations', viewerUrl: 'https://www.digitraffic.fi/', terms: 'CC BY 4.0', license: 'CC BY 4.0' },
  { id: 'drivebc_events', category: 'traffic', coverage: DRIVEBC_EVENTS_COVERAGE_BBOX, country: 'CA', region: 'British Columbia', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['drivebc_events'], apiUrl: 'https://api.open511.gov.bc.ca/events', viewerUrl: 'https://www.drivebc.ca/', terms: 'Open511 / DriveBC', license: 'BC Open511' },
  { id: 'ontario_511_events', category: 'traffic', coverage: ONTARIO_511_COVERAGE_BBOX, country: 'CA', region: 'Ontario', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['ontario_511_events'], apiUrl: 'https://511on.ca/api/v2/get/event', viewerUrl: 'https://511on.ca/', terms: 'Government of Ontario', license: 'terms not independently confirmed' },
  { id: 'quebec_511_events', category: 'traffic', coverage: QUEBEC_511_COVERAGE_BBOX, country: 'CA', region: 'Québec', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['quebec_511_events'], apiUrl: 'https://ws.mapserver.transports.gouv.qc.ca/swtq', viewerUrl: 'https://www.quebec511.info/', terms: 'Québec open data', license: 'Québec open data' },
  { id: 'webtris', category: 'traffic', coverage: WEBTRIS_COVERAGE_BBOX, country: 'GB', region: 'England strategic roads', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['webtris'], apiUrl: 'https://webtris.nationalhighways.co.uk/api/v1.0/sites', viewerUrl: 'https://webtris.nationalhighways.co.uk/', terms: 'National Highways WebTRIS', license: 'historical counts; not live' },
  { id: 'jartic_traffic_volumes', category: 'traffic', coverage: JARTIC_COVERAGE_BBOX, country: 'JP', region: 'Japan main islands', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['jartic_traffic_volumes'], apiUrl: 'https://www.jartic.or.jp/', viewerUrl: 'https://www.jartic.or.jp/', terms: 'JARTIC open WFS', license: 'JARTIC' },
  { id: 'wzdx_wsdot', category: 'traffic', coverage: WZDX_COVERAGE_BBOXES.wzdx_wsdot, country: 'US', region: 'Washington', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['wzdx_wsdot'], apiUrl: 'https://data.wsdot.wa.gov/', viewerUrl: 'https://wsdot.wa.gov/', terms: 'WZDx', license: 'WSDOT WZDx' },
  { id: 'wzdx_iowa_dot', category: 'traffic', coverage: WZDX_COVERAGE_BBOXES.wzdx_iowa_dot, country: 'US', region: 'Iowa', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['wzdx_iowa_dot'], apiUrl: 'https://data.iowadot.gov/', viewerUrl: 'https://iowadot.gov/', terms: 'WZDx', license: 'Iowa DOT WZDx' },
  { id: 'wzdx_kytc', category: 'traffic', coverage: WZDX_COVERAGE_BBOXES.wzdx_kytc, country: 'US', region: 'Kentucky', authModel: 'PUBLIC', endpointType: 'API', layerIds: ['wzdx_kytc'], apiUrl: 'https://data.ky.gov/', viewerUrl: 'https://transportation.ky.gov/', terms: 'WZDx', license: 'KYTC WZDx' },
  { id: 'opensky', category: 'aviation', coverage: 'GLOBAL', country: 'CH', region: 'global', authModel: 'COMMANDER_PRIVATE', endpointType: 'API', layerIds: ['opensky'], apiUrl: 'https://opensky-network.org/api/states/all', viewerUrl: 'https://opensky-network.org/', terms: 'OpenSky Network terms; session-gated in War Room', license: 'OpenSky' },
]

function rectanglesIntersect(a: TerraDegreeRectangle, b: TerraDegreeRectangle): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south
}

export function coverageProvidersForPoint(latitude: number, longitude: number, category?: string): TerraCoverageProviderRecord[] {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return []
  return TERRA_COVERAGE_REGISTRY.filter(row => {
    if (category && row.category !== category) return false
    if (row.coverage === 'GLOBAL') return true
    return pointIn(latitude, longitude, row.coverage)
  })
}

export function coverageProvidersForRectangle(rectangle: TerraDegreeRectangle | null, category?: string): TerraCoverageProviderRecord[] {
  if (!rectangle) return []
  return TERRA_COVERAGE_REGISTRY.filter(row => {
    if (category && row.category !== category) return false
    if (row.coverage === 'GLOBAL') return true
    return rectanglesIntersect(rectangle, row.coverage)
  })
}

export function coverageQueryResult(input: {
  latitude: number
  longitude: number
  category: string
  liveCount: number
}): { result: TerraCoverageQueryResult; providers: TerraCoverageProviderRecord[]; reason: string } {
  const providers = coverageProvidersForPoint(input.latitude, input.longitude, input.category)
  if (!providers.length) {
    return { result: 'NO_COVERAGE', providers, reason: `NO_COVERAGE — no ${input.category} provider envelope contains this point.` }
  }
  const apiProviders = providers.filter(row => row.endpointType === 'API')
  if (input.liveCount > 0) {
    return { result: 'COVERED', providers, reason: `COVERED — ${input.liveCount} live ${input.category} record(s) from ${apiProviders.map(row => row.id).join(', ') || providers.map(row => row.id).join(', ')}.` }
  }
  if (!apiProviders.length) {
    return { result: 'PARTIAL', providers, reason: `PARTIAL — no redistributable API for this point. Official viewer: ${providers.map(row => row.viewerUrl).filter(Boolean).join(', ')}.` }
  }
  return { result: 'COVERED', providers, reason: `COVERED — ${apiProviders.map(row => row.id).join(', ')} cover this region but returned no nearby records (LIVE_EMPTY / EMPTY_HEALTHY).` }
}
