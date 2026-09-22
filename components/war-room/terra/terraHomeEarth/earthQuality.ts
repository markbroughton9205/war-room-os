import { EARTH_ASSETS } from './earthAssets'

export type HomeEarthQuality = 'ECO' | 'BALANCED' | 'CINEMATIC'

export const EARTH_AXIAL_TILT_DEG = 23.4
export const EARTH_AXIAL_TILT_RAD = (23.4 * Math.PI) / 180
export const EARTH_RADIUS = 1
export const CLOUD_RADIUS = 1.008
export const ATMOSPHERE_INNER_RADIUS = 1.016
export const ATMOSPHERE_OUTER_RADIUS = 1.068
export const EARTH_SPIN_PERIOD_SEC = 90
export const CLOUD_SPIN_PERIOD_SEC = 140
export const INTERACTION_IDLE_MS = 1_800
/** Faces the Atlantic basin (South America + Africa) toward the homepage camera. */
export const EARTH_HOME_YAW_RAD = 2.62
export const EARTH_HOME_PITCH_RAD = 0.16
export const EARTH_CLOUD_OPACITY = 0.16

export type HomeEarthQualityConfig = {
  quality: HomeEarthQuality
  segments: number
  targetFps: number
  maxDpr: number
  clouds: boolean
  atmosphere: boolean
  nightLights: boolean
  bump: boolean
  antialias: boolean
  dayUrl: string
  cloudUrl: string
  nightUrl: string
  specularUrl: string
  normalUrl: string
}

export function resolveHomeEarthQuality(input: {
  viewportWidth: number
  deviceMemory?: number
  focused: boolean
}): HomeEarthQuality {
  if (!input.focused) return 'ECO'
  if (input.viewportWidth > 0 && input.viewportWidth < 1100) return 'ECO'
  const memory = input.deviceMemory ?? 4
  if (memory < 4) return 'ECO'
  if (memory >= 8 && input.viewportWidth >= 1600) return 'CINEMATIC'
  return 'BALANCED'
}

export function homeEarthQualityConfig(quality: HomeEarthQuality): HomeEarthQualityConfig {
  if (quality === 'ECO') {
    return {
      quality,
      segments: 48,
      targetFps: 15,
      maxDpr: 1,
      clouds: false,
      atmosphere: true,
      nightLights: false,
      bump: false,
      antialias: false,
      dayUrl: EARTH_ASSETS.day2k,
      cloudUrl: EARTH_ASSETS.clouds2k,
      nightUrl: EARTH_ASSETS.night2k,
      specularUrl: EARTH_ASSETS.specular2k,
      normalUrl: EARTH_ASSETS.normal2k,
    }
  }
  if (quality === 'CINEMATIC') {
    return {
      quality,
      segments: 80,
      targetFps: 45,
      maxDpr: 2,
      clouds: true,
      atmosphere: true,
      nightLights: true,
      bump: true,
      antialias: true,
      dayUrl: EARTH_ASSETS.day4k,
      cloudUrl: EARTH_ASSETS.clouds2k,
      nightUrl: EARTH_ASSETS.night2k,
      specularUrl: EARTH_ASSETS.specular2k,
      normalUrl: EARTH_ASSETS.normal2k,
    }
  }
  return {
    quality: 'BALANCED',
    segments: 64,
    targetFps: 30,
    maxDpr: 1.5,
    clouds: true,
    atmosphere: true,
    nightLights: true,
    bump: true,
    antialias: true,
    dayUrl: EARTH_ASSETS.day2k,
    cloudUrl: EARTH_ASSETS.clouds2k,
    nightUrl: EARTH_ASSETS.night2k,
    specularUrl: EARTH_ASSETS.specular2k,
    normalUrl: EARTH_ASSETS.normal2k,
  }
}

export function boundDevicePixelRatio(maxDpr: number): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  return Math.min(Math.max(1, dpr), maxDpr)
}
