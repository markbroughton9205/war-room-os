/**
 * Bounded atmospheric depth presentation. Measured cloud frames still own location/time/structure.
 * No procedural noise. No storm relocation.
 */
import type { TerraViewBand } from '@/lib/terra/layerGovernor/viewBands'
import { isOrbitBand } from '@/lib/terra/layerGovernor/viewBands'

export const CLOUD_DEPTH_PRESENTATION = {
  kind: 'PRESENTATION' as const,
  altitudeShell: true,
  subtleParallax: false,
  softDepth: true,
  limbScattering: true,
  proceduralStormMotion: false,
}

export function atmosphereDepthForBand(band: TerraViewBand): {
  shell: number
  limb: number
  haze: number
  parallax: number
} {
  if (band === 'SPACE') return { shell: 0.55, limb: 0.7, haze: 0.18, parallax: 0 }
  if (isOrbitBand(band)) return { shell: 0.42, limb: 0.55, haze: 0.14, parallax: 0 }
  if (band === 'CONTINENTAL') return { shell: 0.28, limb: 0.4, haze: 0.1, parallax: 0 }
  if (band === 'REGIONAL') return { shell: 0.16, limb: 0.22, haze: 0.06, parallax: 0 }
  if (band === 'CITY') return { shell: 0.06, limb: 0.08, haze: 0.03, parallax: 0 }
  return { shell: 0, limb: 0, haze: 0, parallax: 0 }
}

export function atmosphereBrightnessShift(band: TerraViewBand): number {
  if (isOrbitBand(band)) return 1.04
  if (band === 'CONTINENTAL') return 1.02
  return 1
}
