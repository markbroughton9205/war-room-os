import type { TerraActiveLocation } from './activeLocation'

const COORD_LAYERS = new Set(['met_no', 'open_meteo'])
const NEAR_SCIENCE_LAYERS = new Set(['gbif', 'obis'])
const HISTORIC_NEAR_LAYERS = new Set(['ohm_overpass'])
const OSM_NEAR_LAYERS = new Set(['osm_overpass'])
const PLACE_NAME_LAYERS = new Set(['nominatim', 'idai_gazetteer', 'pleiades', 'whg', 'edh'])

export function isLocationBoundTerraLayer(layerId: string): boolean {
  return COORD_LAYERS.has(layerId)
    || NEAR_SCIENCE_LAYERS.has(layerId)
    || HISTORIC_NEAR_LAYERS.has(layerId)
    || OSM_NEAR_LAYERS.has(layerId)
    || PLACE_NAME_LAYERS.has(layerId)
}

function heritageQuery(location: TerraActiveLocation): string | null {
  const named = location.englishPlaceName
    || location.place
    || location.city
    || location.nativePlaceName
    || null
  if (named && !/^commander gps/i.test(named) && !/^-?\d/.test(named)) return named.slice(0, 120)
  if (location.county) return location.county.slice(0, 120)
  if (location.state) return location.state.slice(0, 120)
  return null
}

/**
 * Bounded query for a catalog layer given the active Terra location.
 * `null` = enabled but do not fetch (no honest query yet).
 * `undefined` = not location-bound; caller should use catalog defaultQueryText.
 */
export function terraLayerQueryOverride(layerId: string, location: TerraActiveLocation | null): string | null | undefined {
  if (!isLocationBoundTerraLayer(layerId)) return undefined
  if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return null
  const lat = location.latitude.toFixed(4)
  const lon = location.longitude.toFixed(4)
  if (COORD_LAYERS.has(layerId)) return `${lat},${lon}`
  if (NEAR_SCIENCE_LAYERS.has(layerId)) return `near ${lat},${lon},25`
  if (HISTORIC_NEAR_LAYERS.has(layerId)) return `historic near ${lat},${lon},12`
  if (OSM_NEAR_LAYERS.has(layerId)) return `category:civic near ${lat},${lon},3`
  if (PLACE_NAME_LAYERS.has(layerId)) return heritageQuery(location)
  return null
}
