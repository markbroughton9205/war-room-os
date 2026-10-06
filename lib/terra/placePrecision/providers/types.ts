import type { ParsedPlaceQuery } from '../parsePlaceQuery'
import type { TerraLonLat, TerraPlaceMatchClass, TerraProviderHealth } from '../matchClass'

export type PrecisionLookupQuery = {
  parsed: ParsedPlaceQuery
  hint?: TerraLonLat | null
  signal?: AbortSignal
}

export type PrecisionHit = {
  providerId: string
  source: string
  matchClass: TerraPlaceMatchClass
  longitude: number
  latitude: number
  houseNumber: string | null
  preDirectional: string | null
  streetName: string | null
  streetTypeAbbrev: string | null
  postDirectional: string | null
  unit: string | null
  city: string | null
  state: string | null
  postcode: string | null
  label: string
  geometryKind: 'point' | 'polygon'
  ring: TerraLonLat[] | null
  boundingBox: { south: number; north: number; west: number; east: number } | null
  providerPrecisionSignal: string | null
  provenance: string
}

export type PrecisionLookupResult =
  | { health: 'AVAILABLE'; hits: PrecisionHit[] }
  | { health: Exclude<TerraProviderHealth, 'AVAILABLE'>; hits: []; reason: string }

export type PrecisionProvider = {
  id: string
  label: string
  pluginFlag: 'summit_address_points' | 'ohio_lbrs' | 'custom'
  supports(query: PrecisionLookupQuery): boolean
  lookupAddressPoints(query: PrecisionLookupQuery): Promise<PrecisionLookupResult>
  lookupParcels?(query: PrecisionLookupQuery & { around: TerraLonLat }): Promise<PrecisionLookupResult>
  lookupBuildings?(query: PrecisionLookupQuery & { around: TerraLonLat }): Promise<PrecisionLookupResult>
}
