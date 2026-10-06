/**
 * Collect candidate geometries, hard-filter identity, then choose ONE.
 * Never average lat/lon between providers.
 */

import { directionalConflict } from './directionals'
import { streetNameGuard } from '../streetNameGuard'
import type { ParsedPlaceQuery } from './parsePlaceQuery'
import { matchClassRank, type TerraPlaceMatchClass } from './matchClass'
import type { PrecisionHit } from './providers/types'

export type SelectableGeometry = {
  id: string
  longitude: number
  latitude: number
  matchClass: TerraPlaceMatchClass
  houseNumber?: string | null
  road?: string | null
  streetName?: string | null
  streetTypeAbbrev?: string | null
  preDirectional?: string | null
  postDirectional?: string | null
  city?: string | null
  state?: string | null
  postcode?: string | null
  provider: string
  label: string
  streetMismatch?: boolean
  hit?: PrecisionHit
}

export type GeometrySelection =
  | { status: 'selected'; geometry: SelectableGeometry }
  | { status: 'ambiguous'; geometries: SelectableGeometry[]; reason: string }
  | { status: 'none'; reason: string }

function eq(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()
}

export function hardFilterGeometries(parsed: ParsedPlaceQuery, candidates: SelectableGeometry[]): {
  matching: SelectableGeometry[]
  conflicting: SelectableGeometry[]
} {
  const matching: SelectableGeometry[] = []
  const conflicting: SelectableGeometry[] = []
  for (const candidate of candidates) {
    if (parsed.houseNumber && candidate.houseNumber && !eq(parsed.houseNumber, candidate.houseNumber)) {
      conflicting.push({ ...candidate, streetMismatch: true })
      continue
    }
    const requestedStreet = [parsed.streetName, parsed.streetTypeAbbrev].filter(Boolean).join(' ')
    const candidateStreet = candidate.road || [candidate.streetName, candidate.streetTypeAbbrev].filter(Boolean).join(' ')
    const guard = streetNameGuard(requestedStreet || parsed.us?.street, candidateStreet)
    if (guard.status === 'conflict') {
      conflicting.push({ ...candidate, streetMismatch: true })
      continue
    }
    if (directionalConflict(parsed.preDirectional, candidate.preDirectional)
      || directionalConflict(parsed.postDirectional, candidate.postDirectional)) {
      conflicting.push({ ...candidate, streetMismatch: true })
      continue
    }
    if (parsed.stateProvince && candidate.state && !eq(parsed.stateProvince, candidate.state) && parsed.stateProvince.length <= 2 && candidate.state.length <= 2) {
      conflicting.push(candidate)
      continue
    }
    if (parsed.postalCode && candidate.postcode && parsed.postalCode.slice(0, 5) !== candidate.postcode.slice(0, 5)) {
      conflicting.push(candidate)
      continue
    }
    matching.push(candidate)
  }
  return { matching, conflicting }
}

function score(parsed: ParsedPlaceQuery, candidate: SelectableGeometry): number {
  let value = matchClassRank(candidate.matchClass) * 100
  if (parsed.city && eq(parsed.city, candidate.city)) value += 20
  if (parsed.postalCode && candidate.postcode && parsed.postalCode.slice(0, 5) === candidate.postcode.slice(0, 5)) value += 15
  if (eq(parsed.streetStem, candidate.streetName)) value += 10
  if (candidate.provider.startsWith('summit') || candidate.provider === 'ohio_lbrs') value += 25
  return value
}

export function selectPrimaryGeometry(parsed: ParsedPlaceQuery, candidates: SelectableGeometry[]): GeometrySelection {
  if (candidates.length === 0) return { status: 'none', reason: 'No geometries to select.' }
  const { matching, conflicting } = hardFilterGeometries(parsed, candidates)
  const pool = matching.length > 0 ? matching : []
  if (pool.length === 0) {
    return {
      status: 'ambiguous',
      geometries: conflicting.length ? conflicting : candidates,
      reason: conflicting.some(row => row.streetMismatch)
        ? 'Street type or identity conflict — pick a listed match. Coordinates are never guessed or averaged.'
        : 'No candidate survived identity filters.',
    }
  }
  pool.sort((a, b) => score(parsed, b) - score(parsed, a))
  const best = pool[0]
  const tied = pool.filter(row => score(parsed, row) === score(parsed, best)
    && (Math.abs(row.latitude - best.latitude) > 0.00005 || Math.abs(row.longitude - best.longitude) > 0.00005)
    && row.matchClass === best.matchClass)
  if (tied.length > 1) {
    return { status: 'ambiguous', geometries: pool, reason: 'Multiple equally precise matches remain after hard filters.' }
  }
  return { status: 'selected', geometry: best }
}

export function neverAverage(a: SelectableGeometry, b: SelectableGeometry): SelectableGeometry {
  return matchClassRank(a.matchClass) >= matchClassRank(b.matchClass) ? a : b
}
