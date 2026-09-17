/**
 * God's Eye zoom ladder from uploaded research.
 * Camera height still uses Terra's five Cesium bands. FEATURE is the pickable
 * object rung at street scale — not a sixth globe engine.
 */
import { GODS_EYE_LOD_FROM_TERRA_SCALE, type GodsEyeLodLevel } from './lod'

export const GODS_EYE_ZOOM_LADDER = [
  'PLANET',
  'COUNTRY',
  'CITY',
  'NEIGHBORHOOD',
  'STREET',
  'FEATURE',
] as const
export type GodsEyeZoomRung = (typeof GODS_EYE_ZOOM_LADDER)[number]

export const GODS_EYE_FEATURE_CLASSES = [
  'BUILDING',
  'ROAD',
  'SIGNAL',
  'CAMERA',
  'VEHICLE',
  'EVENT',
] as const
export type GodsEyeFeatureClass = (typeof GODS_EYE_FEATURE_CLASSES)[number]

type TerraScaleLevelLike = 'global' | 'regional' | 'city' | 'local' | 'building'

export const GODS_EYE_LADDER_FROM_TERRA_SCALE: Record<TerraScaleLevelLike, Exclude<GodsEyeZoomRung, 'FEATURE'>> = {
  global: 'PLANET',
  regional: 'COUNTRY',
  city: 'CITY',
  local: 'NEIGHBORHOOD',
  building: 'STREET',
}

export const GODS_EYE_LADDER_LAYERS: Record<GodsEyeZoomRung, readonly string[]> = {
  PLANET: ['live_intel_aggregate', 'terrain', 'imagery', 'world_time'],
  COUNTRY: ['hazards', 'volcanoes', 'storms', 'aviation_clustered', 'maritime_clustered'],
  CITY: ['buildings', 'major_roads', 'street_names_selective', 'traffic_events'],
  NEIGHBORHOOD: ['detailed_buildings', 'street_names', 'addresses', 'traffic_signals'],
  STREET: ['house_numbers', 'street_imagery', 'traffic_cameras', 'traffic_signs', 'lanes'],
  FEATURE: ['building', 'road', 'signal', 'camera', 'vehicle', 'event'],
}

export function godsEyeZoomRungForTerraScale(level: TerraScaleLevelLike): Exclude<GodsEyeZoomRung, 'FEATURE'> {
  return GODS_EYE_LADDER_FROM_TERRA_SCALE[level]
}

export function godsEyeZoomRungFromLod(lod: GodsEyeLodLevel): Exclude<GodsEyeZoomRung, 'FEATURE'> {
  if (lod === 'GLOBAL') return 'PLANET'
  if (lod === 'COUNTRY') return 'COUNTRY'
  if (lod === 'CITY') return 'CITY'
  if (lod === 'NEIGHBORHOOD') return 'NEIGHBORHOOD'
  return 'STREET'
}

export function godsEyeActiveRung(level: TerraScaleLevelLike, hasSelection: boolean): GodsEyeZoomRung {
  const rung = godsEyeZoomRungForTerraScale(level)
  if (hasSelection && (rung === 'STREET' || rung === 'NEIGHBORHOOD' || rung === 'CITY')) return 'FEATURE'
  return rung
}

export function godsEyeLodFromLadder(rung: GodsEyeZoomRung): GodsEyeLodLevel {
  if (rung === 'PLANET') return 'GLOBAL'
  if (rung === 'FEATURE') return 'STREET'
  return rung
}

export function streetNamesVisible(rung: GodsEyeZoomRung): 'hidden' | 'selective' | 'named' {
  if (rung === 'PLANET' || rung === 'COUNTRY') return 'hidden'
  if (rung === 'CITY') return 'selective'
  return 'named'
}

export function houseNumbersVisible(rung: GodsEyeZoomRung): boolean {
  return rung === 'STREET' || rung === 'FEATURE'
}

export { GODS_EYE_LOD_FROM_TERRA_SCALE }
