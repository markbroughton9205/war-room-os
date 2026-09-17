/**
 * Expected God's Eye urban density by zoom ladder.
 * The badge is not LOD — these numbers are the actual fetch/render policy.
 */
import type { GodsEyeZoomRung } from './zoomLadder'

export type GodsEyeLodDensity = {
  rung: GodsEyeZoomRung
  fetchUrban: boolean
  buildings: boolean
  signals: boolean
  streetNames: 'hidden' | 'selective' | 'named'
  houseNumbers: boolean
  clusterIntel: boolean
  maxStreetLabels: number
  maxHouseNumbers: number
}

export const GODS_EYE_LOD_DENSITY: Record<Exclude<GodsEyeZoomRung, 'FEATURE'>, GodsEyeLodDensity> = {
  PLANET: {
    rung: 'PLANET',
    fetchUrban: false,
    buildings: false,
    signals: false,
    streetNames: 'hidden',
    houseNumbers: false,
    clusterIntel: true,
    maxStreetLabels: 0,
    maxHouseNumbers: 0,
  },
  COUNTRY: {
    rung: 'COUNTRY',
    fetchUrban: false,
    buildings: false,
    signals: false,
    streetNames: 'hidden',
    houseNumbers: false,
    clusterIntel: true,
    maxStreetLabels: 0,
    maxHouseNumbers: 0,
  },
  CITY: {
    rung: 'CITY',
    fetchUrban: true,
    buildings: false,
    signals: false,
    streetNames: 'selective',
    houseNumbers: false,
    clusterIntel: false,
    maxStreetLabels: 24,
    maxHouseNumbers: 0,
  },
  NEIGHBORHOOD: {
    rung: 'NEIGHBORHOOD',
    fetchUrban: true,
    buildings: true,
    signals: true,
    streetNames: 'named',
    houseNumbers: false,
    clusterIntel: false,
    maxStreetLabels: 36,
    maxHouseNumbers: 0,
  },
  STREET: {
    rung: 'STREET',
    fetchUrban: true,
    buildings: true,
    signals: true,
    streetNames: 'named',
    houseNumbers: true,
    clusterIntel: false,
    maxStreetLabels: 48,
    maxHouseNumbers: 36,
  },
}

export function godsEyeLodDensity(rung: GodsEyeZoomRung): GodsEyeLodDensity {
  if (rung === 'FEATURE') return GODS_EYE_LOD_DENSITY.STREET
  return GODS_EYE_LOD_DENSITY[rung]
}
