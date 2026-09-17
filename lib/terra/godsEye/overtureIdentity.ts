/**
 * Overture / OSM urban identity — one identity lane, not a second address store.
 *
 * OSM Overpass (addr:housenumber / addr:street / osm id) remains the live urban identity source.
 * Overture/GERS identifiers are additive when a Re:Earth 3D Tiles feature actually carries them.
 * Do not infer house numbers, places, or entrances from neighbors.
 */
export const TERRA_URBAN_IDENTITY_PRIMARY = 'OPENSTREETMAP_OVERPASS' as const
export const TERRA_URBAN_IDENTITY_SECONDARY = 'OVERTURE_GERS' as const

export const OVERTURE_LICENSE = 'CDLA-Permissive-2.0 (OSM-derived portions ODbL-1.0)'
export const OVERTURE_SOURCE_URL = 'https://overturemaps.org/'
export const OVERTURE_DOCS_URL = 'https://docs.overturemaps.org/'

export const OVERTURE_IDENTITY_CLASSES = [
  'building',
  'address',
  'place',
  'road',
  'transportation',
  'entrance',
  'house_number',
  'traffic_signal',
] as const
export type OvertureIdentityClass = (typeof OVERTURE_IDENTITY_CLASSES)[number]

export type TerraUrbanIdentityRecord = {
  class: OvertureIdentityClass
  osmId: string | null
  osmType: 'node' | 'way' | 'relation' | 'cesium_osm_buildings' | null
  overtureId: string | null
  gersId: string | null
  houseNumber: string | null
  streetName: string | null
  name: string | null
  source: typeof TERRA_URBAN_IDENTITY_PRIMARY | typeof TERRA_URBAN_IDENTITY_SECONDARY | 'RE_EARTH_BUILDINGS'
  inferred: false
}

export function sourcedHouseNumber(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function sourcedStreetName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function identityFromOsmTags(input: {
  class: OvertureIdentityClass
  osmId: string | number | null
  osmType: TerraUrbanIdentityRecord['osmType']
  tags?: Record<string, string> | null
  name?: string | null
}): TerraUrbanIdentityRecord {
  const tags = input.tags ?? {}
  return {
    class: input.class,
    osmId: input.osmId === null || input.osmId === undefined ? null : String(input.osmId),
    osmType: input.osmType,
    overtureId: null,
    gersId: null,
    houseNumber: sourcedHouseNumber(tags['addr:housenumber']),
    streetName: sourcedStreetName(tags['addr:street'] ?? input.name),
    name: input.name?.trim() || tags.name?.trim() || null,
    source: TERRA_URBAN_IDENTITY_PRIMARY,
    inferred: false,
  }
}

export function identityFromReEarthFeature(properties: Record<string, unknown> | null | undefined): TerraUrbanIdentityRecord {
  const value = (key: string): string | null => {
    const raw = properties?.[key]
    if (typeof raw === 'string' && raw.trim()) return raw.trim()
    if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
    return null
  }
  return {
    class: 'building',
    osmId: value('osm_id') ?? value('elementId') ?? value('id'),
    osmType: 'cesium_osm_buildings',
    overtureId: value('overture_id') ?? value('id'),
    gersId: value('gers_id') ?? value('gersId'),
    houseNumber: sourcedHouseNumber(value('addr:housenumber') ?? value('housenumber') ?? value('address_number')),
    streetName: sourcedStreetName(value('addr:street') ?? value('street') ?? value('road')),
    name: value('name') ?? value('name:en'),
    source: 'RE_EARTH_BUILDINGS',
    inferred: false,
  }
}

export const OVERTURE_RUNTIME_QUERY = 'NO_COVERAGE' as const

export function overtureRuntimeHonesty(): string {
  return 'Overture GeoParquet is not ingested as a competing address store. OSM addr:* is the live sourced identity. Re:Earth Buildings may surface Overture/GERS ids when the tileset feature actually carries them. No neighbor inference.'
}
