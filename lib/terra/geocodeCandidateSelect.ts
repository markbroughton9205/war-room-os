/**
 * Candidate selection for Terra JUMP / GO. Street-type conflicts are never auto-selected.
 */

import { candidateStreetFromLabel, streetNameGuard } from './streetNameGuard'
import { classifyAddressMatchQuality, type TerraAddressMatchQuality } from './geocodeMatchQuality'

export type GeocodeCandidateLike = {
  label: string
  placeClass?: string | null
  placeType?: string | null
  osmType?: string | null
  houseNumber?: string | null
  road?: string | null
  city?: string | null
  state?: string | null
  postcode?: string | null
}

export function partitionByStreetGuard<T extends GeocodeCandidateLike>(requestedStreet: string | null | undefined, candidates: T[]): {
  matching: T[]
  conflicting: T[]
  unconstrained: T[]
} {
  const matching: T[] = []
  const conflicting: T[] = []
  const unconstrained: T[] = []
  for (const candidate of candidates) {
    const street = candidateStreetFromLabel(candidate.label, candidate.road)
    const guard = streetNameGuard(requestedStreet, street)
    if (guard.status === 'conflict') conflicting.push(candidate)
    else if (guard.status === 'match') matching.push(candidate)
    else unconstrained.push(candidate)
  }
  return { matching, conflicting, unconstrained }
}

export type GeocodeSelection<T extends GeocodeCandidateLike> =
  | { quality: 'strong'; candidate: T; addressMatchQuality: TerraAddressMatchQuality; streetMismatch: false }
  | { quality: 'ambiguous'; candidates: T[]; reason: string; addressMatchQuality: 'AMBIGUOUS' }

export function selectGeocodeCandidates<T extends GeocodeCandidateLike>(input: {
  requestedStreet?: string | null
  requestedHouseNumber?: string | null
  candidates: T[]
  uniquePostalFallback?: (candidates: T[]) => T | null
}): GeocodeSelection<T> {
  const { candidates } = input
  if (candidates.length === 0) {
    return { quality: 'ambiguous', candidates: [], reason: 'No coordinate-bearing candidates.', addressMatchQuality: 'AMBIGUOUS' }
  }

  const partitioned = input.requestedStreet
    ? partitionByStreetGuard(input.requestedStreet, candidates)
    : { matching: [] as T[], conflicting: [] as T[], unconstrained: candidates }

  if (partitioned.conflicting.length > 0 && partitioned.matching.length === 0) {
    const conflict = streetNameGuard(input.requestedStreet, candidateStreetFromLabel(partitioned.conflicting[0]?.label, partitioned.conflicting[0]?.road))
    const requestedType = conflict.status === 'conflict' ? conflict.requested.type : 'requested'
    const candidateType = conflict.status === 'conflict' ? conflict.candidate.type : 'candidate'
    const titled = (value: string | null) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : 'type')
    return {
      quality: 'ambiguous',
      candidates: partitioned.conflicting,
      reason: `Requested street type conflicts with ${partitioned.conflicting.length} candidate(s) — ${titled(requestedType)} ≠ ${titled(candidateType)}. Not auto-selected.`,
      addressMatchQuality: 'AMBIGUOUS',
    }
  }

  const pool = partitioned.matching.length > 0
    ? partitioned.matching
    : partitioned.unconstrained

  if (pool.length === 1) {
    const candidate = pool[0]
    return {
      quality: 'strong',
      candidate,
      streetMismatch: false,
      addressMatchQuality: classifyAddressMatchQuality({
        placeClass: candidate.placeClass,
        placeType: candidate.placeType,
        osmType: candidate.osmType,
        houseNumber: candidate.houseNumber,
        road: candidate.road,
        requestedHouseNumber: input.requestedHouseNumber,
        streetConflict: false,
        candidateCount: 1,
      }),
    }
  }

  if (input.uniquePostalFallback) {
    const postal = input.uniquePostalFallback(candidates)
    if (postal) {
      return {
        quality: 'strong',
        candidate: postal,
        streetMismatch: false,
        addressMatchQuality: classifyAddressMatchQuality({
          placeClass: postal.placeClass,
          placeType: postal.placeType,
          osmType: postal.osmType,
          houseNumber: postal.houseNumber,
          road: postal.road,
          requestedHouseNumber: input.requestedHouseNumber,
          candidateCount: 1,
        }),
      }
    }
  }

  const listed = partitioned.matching.length > 0 ? partitioned.matching : candidates
  return {
    quality: 'ambiguous',
    candidates: listed,
    reason: `Resolver returned ${listed.length} distinct coordinate-bearing candidates — never auto-selecting one.`,
    addressMatchQuality: 'AMBIGUOUS',
  }
}
