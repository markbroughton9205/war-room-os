/**
 * Honest Nominatim / global-geocoder mapping.
 * Provider returned a point ≠ how precise that point is.
 * Never promotes STREET → ROOFTOP. Nominatim house nodes are at most ADDRESS_POINT.
 */

import {
  TERRA_PLACE_MATCH_CLASS_LABELS,
  TERRA_PLACE_MATCH_CLASSES,
  type TerraPlaceMatchClass,
} from './placePrecision/matchClass'

export const TERRA_ADDRESS_MATCH_QUALITIES = TERRA_PLACE_MATCH_CLASSES
export type TerraAddressMatchQuality = TerraPlaceMatchClass

export const TERRA_ADDRESS_MATCH_QUALITY_LABELS = TERRA_PLACE_MATCH_CLASS_LABELS

const HIGHWAY_TYPES = new Set([
  'residential', 'primary', 'secondary', 'tertiary', 'unclassified', 'service', 'living_street',
  'trunk', 'motorway', 'track', 'path', 'pedestrian', 'cycleway', 'footway', 'road',
])

const PLACE_TYPES = new Set([
  'city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'neighborhood', 'quarter',
  'locality', 'municipality', 'county', 'state', 'country', 'postcode', 'postal_code',
  'administrative', 'borough', 'district', 'region', 'continent', 'island', 'archipelago',
])

const LANDMARK_TYPES = new Set([
  'attraction', 'monument', 'memorial', 'viewpoint', 'tourism', 'museum', 'artwork',
])

export type NominatimMatchEvidence = {
  placeClass?: string | null
  placeType?: string | null
  osmType?: string | null
  houseNumber?: string | null
  road?: string | null
  requestedHouseNumber?: string | null
  streetConflict?: boolean
  candidateCount?: number
  /** Provider-explicit rooftop / building-entry signal. Generic "quality: strong" is not this. */
  providerPrecisionSignal?: string | null
}

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

export function classifyAddressMatchQuality(evidence: NominatimMatchEvidence): TerraAddressMatchQuality {
  if (evidence.streetConflict || (evidence.candidateCount ?? 0) > 1) return 'AMBIGUOUS'

  const placeClass = norm(evidence.placeClass)
  const placeType = norm(evidence.placeType)
  const osmType = norm(evidence.osmType)
  const houseNumber = evidence.houseNumber?.trim() || null
  const requestedHouse = evidence.requestedHouseNumber?.trim() || null
  const signal = norm(evidence.providerPrecisionSignal)

  if (placeClass === 'highway' || HIGHWAY_TYPES.has(placeType)) return 'STREET'
  if (placeType === 'postcode' || placeType === 'postal_code' || placeClass === 'postal_code') return 'PLACE'
  if (PLACE_TYPES.has(placeType) || placeClass === 'boundary' || (placeClass === 'place' && PLACE_TYPES.has(placeType))) {
    if (placeType !== 'house' && placeType !== 'addresses' && placeType !== 'yes') return 'PLACE'
  }
  if (placeClass === 'place' && placeType !== 'house' && placeType !== 'addresses') return 'PLACE'
  if (LANDMARK_TYPES.has(placeType) || placeClass === 'tourism' || placeClass === 'amenity') {
    if (!houseNumber) return 'PLACE'
  }

  const interpolating = /interpolat/.test(placeType)
    || /tiger/.test(signal)
    || (placeClass === 'place' && placeType === 'house' && (osmType === 'way' || osmType === 'relation'))
  if (interpolating) return 'INTERPOLATED'

  if (requestedHouse && houseNumber && requestedHouse.toLowerCase() !== houseNumber.toLowerCase()) return 'AMBIGUOUS'

  const explicitRooftop = /rooftop|building.?entry|entrance/.test(signal)
  if (explicitRooftop && houseNumber) return 'ROOFTOP'

  const buildingClass = placeClass === 'building' || placeType === 'apartments' || placeType === 'yes' && placeClass === 'building'
  if (buildingClass && houseNumber && osmType === 'way') return 'BUILDING'
  if (houseNumber && (placeType === 'house' || placeType === 'addresses' || osmType === 'node' || buildingClass)) {
    return 'ADDRESS_POINT'
  }
  if (requestedHouse && !houseNumber) return 'STREET'
  if (houseNumber) return 'INTERPOLATED'
  if (evidence.road && requestedHouse) return 'STREET'
  return 'PLACE'
}

export function matchQualityLabel(quality: TerraAddressMatchQuality | null | undefined): string {
  if (!quality) return ''
  return TERRA_ADDRESS_MATCH_QUALITY_LABELS[quality]
}
