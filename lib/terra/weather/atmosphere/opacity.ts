/**
 * Camera-height opacity for measured weather rasters.
 * Translucency is presentation. Frame timestamps stay the source observation times.
 * Heights match Terra scale bands in useTerraCameraScale (meters above WGS84 ellipsoid).
 */

export const CLOUD_OPACITY_ORBIT = 0.72
export const CLOUD_OPACITY_REGIONAL = 0.58
export const CLOUD_OPACITY_CITY = 0.38
export const CLOUD_OPACITY_LOCAL = 0.22
export const CLOUD_OPACITY_STREET = 0.14

export const RADAR_OPACITY_ORBIT = 0.40
export const RADAR_OPACITY_REGIONAL = 0.36
export const RADAR_OPACITY_CITY = 0.28
export const RADAR_OPACITY_LOCAL = 0.18
export const RADAR_OPACITY_STREET = 0.12

export const WEATHER_HEIGHT_ORBIT_M = 3_000_000
export const WEATHER_HEIGHT_REGIONAL_M = 200_000
export const WEATHER_HEIGHT_CITY_M = 20_000
export const WEATHER_HEIGHT_LOCAL_M = 2_000
export const WEATHER_HEIGHT_STREET_M = 400

export type WeatherOpacityStops = {
  orbit: number
  regional: number
  city: number
  local: number
  street: number
}

export const CLOUD_OPACITY_STOPS: WeatherOpacityStops = {
  orbit: CLOUD_OPACITY_ORBIT,
  regional: CLOUD_OPACITY_REGIONAL,
  city: CLOUD_OPACITY_CITY,
  local: CLOUD_OPACITY_LOCAL,
  street: CLOUD_OPACITY_STREET,
}

export const RADAR_OPACITY_STOPS: WeatherOpacityStops = {
  orbit: RADAR_OPACITY_ORBIT,
  regional: RADAR_OPACITY_REGIONAL,
  city: RADAR_OPACITY_CITY,
  local: RADAR_OPACITY_LOCAL,
  street: RADAR_OPACITY_STREET,
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t)
}

function opacityAtHeight(heightMeters: number, stops: WeatherOpacityStops): number {
  const h = Number.isFinite(heightMeters) ? heightMeters : WEATHER_HEIGHT_ORBIT_M
  if (h >= WEATHER_HEIGHT_ORBIT_M) return stops.orbit
  if (h >= WEATHER_HEIGHT_REGIONAL_M) {
    return lerp(stops.regional, stops.orbit, (h - WEATHER_HEIGHT_REGIONAL_M) / (WEATHER_HEIGHT_ORBIT_M - WEATHER_HEIGHT_REGIONAL_M))
  }
  if (h >= WEATHER_HEIGHT_CITY_M) {
    return lerp(stops.city, stops.regional, (h - WEATHER_HEIGHT_CITY_M) / (WEATHER_HEIGHT_REGIONAL_M - WEATHER_HEIGHT_CITY_M))
  }
  if (h >= WEATHER_HEIGHT_LOCAL_M) {
    return lerp(stops.local, stops.city, (h - WEATHER_HEIGHT_LOCAL_M) / (WEATHER_HEIGHT_CITY_M - WEATHER_HEIGHT_LOCAL_M))
  }
  if (h >= WEATHER_HEIGHT_STREET_M) {
    return lerp(stops.street, stops.local, (h - WEATHER_HEIGHT_STREET_M) / (WEATHER_HEIGHT_LOCAL_M - WEATHER_HEIGHT_STREET_M))
  }
  return stops.street
}

export function cloudOpacityForHeight(input: {
  heightMeters: number
  commanderOpacity?: number
  depthAuto?: boolean
}): number {
  const commander = clamp01(input.commanderOpacity ?? 1)
  const base = input.depthAuto === false
    ? CLOUD_OPACITY_ORBIT
    : opacityAtHeight(input.heightMeters, CLOUD_OPACITY_STOPS)
  return clamp01(base * commander)
}

export function radarOpacityForHeight(input: {
  heightMeters: number
  commanderOpacity?: number
  depthAuto?: boolean
}): number {
  const commander = clamp01(input.commanderOpacity ?? 1)
  const base = input.depthAuto === false
    ? RADAR_OPACITY_ORBIT
    : opacityAtHeight(input.heightMeters, RADAR_OPACITY_STOPS)
  return clamp01(base * commander)
}

export const WEATHER_OPACITY_MODEL = 'camera-height piecewise lerp × Commander slider. Not a retrieved cloud optical depth.'
export const WEATHER_INTERPOLATION_KIND = 'INTERPOLATED PRESENTATION'
export const GEOCOLOR_TRANSLUCENCY_NOTE =
  'GOES GeoColor is a full-disk RGB observation. Layer alpha and color-to-alpha on near-black space are presentation so terrain remains readable. Not a measured cloud-mask product.'
