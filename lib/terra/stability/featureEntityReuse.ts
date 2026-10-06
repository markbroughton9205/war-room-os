import type { TerraGeoFeature } from '@/lib/terra/types'

export function terraLiveFeatureIds(features: readonly { id: string }[]): Set<string> {
  return new Set(features.map(feature => feature.id))
}

export function canReuseVehicleEntities(features: readonly TerraGeoFeature[]): boolean {
  if (features.length === 0) return false
  return features.every(feature => {
    if (feature.kind !== 'aircraft_state' && feature.kind !== 'vessel_position') return false
    const clustered = feature.properties._terraWorkerClusterCount
    return !(typeof clustered === 'number' && clustered > 1)
  })
}

export function staleEntityIds(existingIds: readonly string[], liveIds: ReadonlySet<string>, prefix: string): string[] {
  return existingIds.filter(id => {
    if (!id.startsWith(prefix)) return false
    if (id.startsWith(`${prefix}trail:`)) return true
    return !liveIds.has(id.slice(prefix.length))
  })
}

type OpacityChannels = {
  country: number
  state: number
  county: number
  countryLabel: number
  stateLabel: number
  cityLabel: number
  flag: number
}

export function adminOpacityConverged(
  current: OpacityChannels,
  target: {
    countryBorderOpacity: number
    stateBorderOpacity: number
    countyBorderOpacity: number
    countryLabelOpacity: number
    stateLabelOpacity: number
    cityLabelOpacity: number
    countryFlagOpacity: number
    stateFlagOpacity: number
  },
  epsilon = 0.004,
): boolean {
  const flagTarget = Math.max(target.countryFlagOpacity, target.stateFlagOpacity)
  return Math.abs(current.country - target.countryBorderOpacity) <= epsilon
    && Math.abs(current.state - target.stateBorderOpacity) <= epsilon
    && Math.abs(current.county - target.countyBorderOpacity) <= epsilon
    && Math.abs(current.countryLabel - target.countryLabelOpacity) <= epsilon
    && Math.abs(current.stateLabel - target.stateLabelOpacity) <= epsilon
    && Math.abs(current.cityLabel - target.cityLabelOpacity) <= epsilon
    && Math.abs(current.flag - flagTarget) <= epsilon
}
