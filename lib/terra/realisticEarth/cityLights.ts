/**
 * Phase 2 city-light truth + presentation. Observed radiance is never branded live electricity.
 * Close-zoom glow from roads/buildings is PRESENTATION only.
 */
import type { TerraViewBand } from '@/lib/terra/layerGovernor/viewBands'
import { isLocalBand, isOrbitBand } from '@/lib/terra/layerGovernor/viewBands'

export const CITY_LIGHT_SOURCE_RECENT = {
  id: 'viirs_snpp_dnb_daily',
  label: 'NASA GIBS VIIRS SNPP Gap-Filled BRDF-Corrected Day/Night Band radiance',
  truthClass: 'OBSERVED' as const,
  freshnessLabel: 'RECENT NIGHT RADIANCE',
  liveClaim: false,
}

export const CITY_LIGHT_SOURCE_ARCHIVE = {
  id: 'viirs_night_lights_2016',
  label: 'NASA VIIRS Night Lights / Black Marble 2016 annual composite',
  truthClass: 'OBSERVED' as const,
  freshnessLabel: 'ARCHIVAL BLACK MARBLE',
  liveClaim: false,
  year: 2016,
}

export const CITY_LIGHT_BLEND = {
  globeEnableLighting: true,
  autoDay: { dayAlpha: 0, nightAlpha: 1 },
  twilight: 'smooth nightBlend from solar elevation',
  night: { nightAlpha: 'active' },
}

/** Restrain suburban haze and neon wash; keep urban cores readable. */
export const CITY_LIGHT_TUNING = {
  brightness: 0.74,
  gamma: 1.46,
  contrast: 1.34,
  saturation: 0.26,
  colorToAlphaThreshold: 0.22,
}

export const INFERRED_URBAN_ILLUMINATION = {
  truthClass: 'PRESENTATION' as const,
  label: 'INFERRED URBAN ILLUMINATION',
  basis: 'Lawful map/building/road geometry at close zoom. Not satellite observation.',
}

export function cityLightsTuningForBand(band: TerraViewBand): typeof CITY_LIGHT_TUNING {
  if (isOrbitBand(band)) {
    return { ...CITY_LIGHT_TUNING, brightness: 0.7, contrast: 1.4, saturation: 0.22 }
  }
  if (band === 'CONTINENTAL' || band === 'REGIONAL') {
    return { ...CITY_LIGHT_TUNING, brightness: 0.74, contrast: 1.34 }
  }
  return { ...CITY_LIGHT_TUNING, brightness: 0.68, contrast: 1.22, saturation: 0.22 }
}

/** Do not keep requesting native max tiles that only upscale blurry Black Marble. */
export function observedNightLightsMaxLevel(band: TerraViewBand, nativeMax = 8): number {
  if (band === 'STREET') return Math.min(nativeMax, 6)
  if (band === 'CITY') return Math.min(nativeMax, 7)
  return nativeMax
}

export function observedNightLightsOpacityScale(band: TerraViewBand): number {
  if (band === 'STREET') return 0.42
  if (band === 'CITY') return 0.7
  return 1
}

export function inferredUrbanIlluminationEnabled(input: {
  band: TerraViewBand
  solar: string | null
  lightingMode: 'AUTO' | 'DAY' | 'NIGHT'
}): boolean {
  if (input.lightingMode === 'DAY') return false
  if (input.solar === 'DAY') return false
  return isLocalBand(input.band)
}

export function cityLightsSourceLabel(mode: 'DAILY' | 'ARCHIVE' | string | null | undefined): string {
  if (mode === 'DAILY') return `${CITY_LIGHT_SOURCE_RECENT.freshnessLabel} · OBSERVED · not live`
  return `${CITY_LIGHT_SOURCE_ARCHIVE.freshnessLabel} · OBSERVED · not live`
}

export function archiveMustNotBeCalledLive(mode: string, freshness: string): boolean {
  if (mode === 'ARCHIVE') return freshness !== 'LIVE' && freshness !== 'RECENT'
  return true
}
