/**
 * View-aware altitude bands with hysteresis.
 * Presentation only — does not change Earth Pulse truth or provider coverage.
 */

export const TERRA_VIEW_BANDS = ['SPACE', 'GLOBAL', 'CONTINENTAL', 'REGIONAL', 'CITY', 'STREET'] as const
export type TerraViewBand = (typeof TERRA_VIEW_BANDS)[number]

export const VIEW_BAND_ENTER_M: Record<TerraViewBand, number> = {
  SPACE: 8_400_000,
  GLOBAL: 3_200_000,
  CONTINENTAL: 880_000,
  REGIONAL: 220_000,
  CITY: 24_000,
  STREET: 0,
}

export const VIEW_BAND_EXIT_M: Record<TerraViewBand, number> = {
  SPACE: 7_600_000,
  GLOBAL: 2_700_000,
  CONTINENTAL: 720_000,
  REGIONAL: 175_000,
  CITY: 16_000,
  STREET: 0,
}

export function terraViewBandForHeight(heightMeters: number): TerraViewBand {
  const h = Number.isFinite(heightMeters) ? heightMeters : 12_000_000
  if (h >= 8_000_000) return 'SPACE'
  if (h >= 3_000_000) return 'GLOBAL'
  if (h >= 800_000) return 'CONTINENTAL'
  if (h >= 200_000) return 'REGIONAL'
  if (h >= 20_000) return 'CITY'
  return 'STREET'
}

export function nextViewBand(heightMeters: number, previous: TerraViewBand | null): TerraViewBand {
  const candidate = terraViewBandForHeight(heightMeters)
  if (!previous || previous === candidate) return candidate
  const h = Number.isFinite(heightMeters) ? heightMeters : 12_000_000
  const previousIndex = TERRA_VIEW_BANDS.indexOf(previous)
  const candidateIndex = TERRA_VIEW_BANDS.indexOf(candidate)
  if (candidateIndex < previousIndex) {
    return h >= VIEW_BAND_ENTER_M[candidate] ? candidate : previous
  }
  return h < VIEW_BAND_EXIT_M[previous] ? candidate : previous
}

export function viewBandFromScale(scale: 'global' | 'regional' | 'city' | 'local' | 'building'): TerraViewBand {
  if (scale === 'global') return 'GLOBAL'
  if (scale === 'regional') return 'REGIONAL'
  if (scale === 'city') return 'CITY'
  return 'STREET'
}

export function isOrbitBand(band: TerraViewBand): boolean {
  return band === 'SPACE' || band === 'GLOBAL'
}

export function isWideBand(band: TerraViewBand): boolean {
  return band === 'SPACE' || band === 'GLOBAL' || band === 'CONTINENTAL'
}

export function isLocalBand(band: TerraViewBand): boolean {
  return band === 'CITY' || band === 'STREET'
}

export const VIEW_BAND_TRANSITION_MS: Record<TerraViewBand, number> = {
  SPACE: 700,
  GLOBAL: 600,
  CONTINENTAL: 500,
  REGIONAL: 400,
  CITY: 320,
  STREET: 280,
}
