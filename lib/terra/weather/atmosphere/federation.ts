/**
 * Worldwide weather federation. Only wired providers emit imagery.
 * Reserved slots stay NO_COVERAGE until a lawful source is installed.
 */

export const WEATHER_FEDERATION_PROVIDERS = [
  {
    id: 'nasa_gibs_goes_geocolor',
    role: 'clouds',
    status: 'WIRED',
    coverage: 'regional',
    label: 'NASA GIBS · NOAA GOES-East/West ABI GeoColor',
    temporalResolution: 'PT10M',
    region: 'Americas / Pacific',
  },
  {
    id: 'iem_nexrad_n0q',
    role: 'radar',
    status: 'WIRED',
    coverage: 'regional',
    label: 'IEM USCOMP N0Q · NOAA/NWS NEXRAD',
    temporalResolution: 'PT5M',
    region: 'CONUS',
  },
  {
    id: 'eumetsat_msg',
    role: 'clouds',
    status: 'RESERVED_NO_COVERAGE',
    coverage: 'none',
    label: 'EUMETSAT Meteosat (reserved)',
    temporalResolution: 'unknown',
    region: 'Europe / Africa',
  },
  {
    id: 'jma_himawari',
    role: 'clouds',
    status: 'RESERVED_NO_COVERAGE',
    coverage: 'none',
    label: 'JMA Himawari (reserved until public timestamped tiles prove 200)',
    temporalResolution: 'unknown',
    region: 'Asia / Oceania',
  },
  {
    id: 'ssec_realearth_globalir',
    role: 'clouds',
    status: 'RESERVED_NO_COVERAGE',
    coverage: 'none',
    label: 'SSEC RealEarth globalir (reserved until explicit-timestamp tiles prove 200)',
    temporalResolution: 'unknown',
    region: 'Global IR fill',
  },
] as const

export type WeatherFederationProvider = (typeof WEATHER_FEDERATION_PROVIDERS)[number]

export function wiredWeatherProviders(): WeatherFederationProvider[] {
  return WEATHER_FEDERATION_PROVIDERS.filter(provider => provider.status === 'WIRED')
}

export function reservedWeatherProviders(): WeatherFederationProvider[] {
  return WEATHER_FEDERATION_PROVIDERS.filter(provider => provider.status === 'RESERVED_NO_COVERAGE')
}

export const WEATHER_RENDER_ORDER = [
  'SPACE_SKY',
  'AURORA',
  'CLOUDS',
  'RADAR_PRECIPITATION',
  'EARTH_IMAGERY',
  'ROADS_LABELS',
  'GODS_EYE_CAMERAS_INTEL',
] as const

/** Cesium imagery stack bottom → top. Entities (aurora, intel) render above the globe. */
export const CESIUM_WEATHER_IMAGERY_ORDER = ['EARTH_IMAGERY', 'NIGHT_LIGHTS', 'RADAR_PRECIPITATION', 'CLOUDS'] as const

export const CLOUDS_ENABLED_STORAGE_KEY = 'terra-weather-clouds-enabled'
export const CLOUDS_OPACITY_STORAGE_KEY = 'terra-weather-clouds-opacity'
export const RADAR_OPACITY_STORAGE_KEY = 'terra-weather-radar-opacity'
export const WEATHER_DEPTH_AUTO_STORAGE_KEY = 'terra-weather-depth-auto'
export const DEFAULT_COMMANDER_CLOUD_OPACITY = 1
export const DEFAULT_COMMANDER_RADAR_OPACITY = 1
