/**
 * God's Eye LOD — maps onto the existing Terra camera scale buckets.
 * Do not load the entire planet into memory. Unload invisible detail. Cluster at global/country.
 */
export const GODS_EYE_LOD_LEVELS = ['GLOBAL', 'COUNTRY', 'CITY', 'NEIGHBORHOOD', 'STREET'] as const
export type GodsEyeLodLevel = (typeof GODS_EYE_LOD_LEVELS)[number]

type TerraScaleLevelLike = 'global' | 'regional' | 'city' | 'local' | 'building'

export const GODS_EYE_LOD_FROM_TERRA_SCALE: Record<TerraScaleLevelLike, GodsEyeLodLevel> = {
  global: 'GLOBAL',
  regional: 'COUNTRY',
  city: 'CITY',
  local: 'NEIGHBORHOOD',
  building: 'STREET',
}

export const GODS_EYE_LOD_LAYERS: Record<GodsEyeLodLevel, readonly string[]> = {
  GLOBAL: ['live_intel_aggregate', 'terrain', 'imagery', 'world_time'],
  COUNTRY: ['hazards', 'volcanoes', 'storms', 'aviation_clustered', 'maritime_clustered', 'regional_intel'],
  CITY: ['major_roads', 'street_names_selective', 'traffic_events'],
  NEIGHBORHOOD: ['detailed_buildings', 'street_names', 'traffic_signals'],
  STREET: ['house_numbers', 'street_imagery', 'traffic_cameras', 'traffic_signs', 'lanes', 'building', 'road', 'signal', 'camera', 'vehicle', 'event'],
}

export function godsEyeLodForTerraScale(level: TerraScaleLevelLike): GodsEyeLodLevel {
  return GODS_EYE_LOD_FROM_TERRA_SCALE[level]
}

export function streetDetailVisible(level: GodsEyeLodLevel): boolean {
  return level === 'STREET'
}

export function neighborhoodDetailVisible(level: GodsEyeLodLevel): boolean {
  return level === 'NEIGHBORHOOD' || level === 'STREET'
}

export function shouldClusterIntel(level: GodsEyeLodLevel): boolean {
  return level === 'GLOBAL' || level === 'COUNTRY'
}
