/**
 * Public / provider-auth Terra layers that do not require a Commander session.
 * Public Earth data is not a Commander-private source. 403 (wrong identity) still blocks.
 * Protected: OpenSky, credentialed AIS, Exa-backed intel, private notes, Commander-owned state.
 */
export const PUBLIC_TERRA_LAYER_IDS = new Set<string>([
  'usgs_earthquake_feed',
  'usgs_earthquake',
  'usgs_water',
  'nhc_current_storms',
  'nasa_eonet_wildfires',
  'nasa_eonet_volcanoes',
  'nasa_eonet_floods',
  'nws_severe_weather_alerts',
  'tsunami_gov',
  'met_no',
  'open_meteo',
  'gbif',
  'obis',
  'nominatim',
  'osm_overpass',
  'nearby_landmarks',
  'ohm_overpass',
  'idai_gazetteer',
  'pleiades',
  'whg',
  'edh',
  'digitraffic_road_cameras',
  'digitraffic_road_weather',
  'digitraffic_marine',
  'drivebc_events',
  'webtris',
  'ontario_511_cameras',
  'ontario_511_events',
  'hong_kong_td_cameras',
  'quebec_511_cameras',
  'quebec_511_events',
  'jartic_traffic_volumes',
  'wzdx_wsdot',
  'wzdx_iowa_dot',
  'wzdx_kytc',
  'caltrans_cctv',
  'ohgo_cameras',
  'ohgo_events',
  'ohgo_road_weather',
  'ny511_cameras',
])

export function isPublicTerraLayer(layerId: string): boolean {
  return PUBLIC_TERRA_LAYER_IDS.has(layerId)
}

export const PUBLIC_INTEL_BANNER = 'PUBLIC INTEL ACTIVE — Protected sources require Commander session'
