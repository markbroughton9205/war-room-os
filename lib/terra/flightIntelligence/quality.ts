import type { AircraftProviderObservation, FlightFreshness, PositionSource } from './types'

/** Aligned with Terra's existing 90s aircraft stale threshold. */
export const FLIGHT_LIVE_MAX_SEC = 15
export const FLIGHT_RECENT_MAX_SEC = 90
export const FLIGHT_STALE_MAX_SEC = 10 * 60

const SOURCE_RANK: Record<PositionSource, number> = {
  'ADS-B': 0,
  MLAT: 1,
  'TIS-B': 2,
  'ADS-R': 3,
  'ADS-C': 4,
  'MODE-S': 5,
  OTHER: 6,
  UNKNOWN: 7,
}

export function observationAgeSec(observation: AircraftProviderObservation, nowMs: number): number | null {
  if (observation.positionAgeSec !== null && Number.isFinite(observation.positionAgeSec)) return observation.positionAgeSec
  if (observation.lastSeenSec !== null && Number.isFinite(observation.lastSeenSec)) return observation.lastSeenSec
  if (!observation.sourceTimestamp) return null
  const sourceMs = Date.parse(observation.sourceTimestamp)
  if (!Number.isFinite(sourceMs)) return null
  return Math.max(0, (nowMs - sourceMs) / 1000)
}

export function freshnessFromAge(ageSec: number | null, hasPosition: boolean): FlightFreshness {
  if (!hasPosition) return 'POSITION_UNAVAILABLE'
  if (ageSec === null) return 'UNKNOWN'
  if (ageSec <= FLIGHT_LIVE_MAX_SEC) return 'LIVE'
  if (ageSec <= FLIGHT_RECENT_MAX_SEC) return 'RECENT'
  if (ageSec <= FLIGHT_STALE_MAX_SEC) return 'STALE'
  return 'LOST'
}

function freshnessRank(state: FlightFreshness): number {
  switch (state) {
    case 'LIVE': return 0
    case 'RECENT': return 1
    case 'UNKNOWN': return 2
    case 'STALE': return 3
    case 'LOST': return 4
    case 'POSITION_UNAVAILABLE': return 5
    default: return 6
  }
}

export function validPosition(observation: AircraftProviderObservation): boolean {
  const { lat, lon } = observation
  return lat !== null && lon !== null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
}

/**
 * Lower is better. Freshness dominates. Integrity breaks close ties.
 * Source type is only a tie-break when NIC is absent, so a fresh MLAT beats a stale ADS-B.
 */
export function compareObservations(left: AircraftProviderObservation, right: AircraftProviderObservation, nowMs: number): number {
  const leftPosition = validPosition(left)
  const rightPosition = validPosition(right)
  if (leftPosition !== rightPosition) return leftPosition ? -1 : 1
  const leftFresh = freshnessFromAge(observationAgeSec(left, nowMs), leftPosition)
  const rightFresh = freshnessFromAge(observationAgeSec(right, nowMs), rightPosition)
  const freshDelta = freshnessRank(leftFresh) - freshnessRank(rightFresh)
  if (freshDelta !== 0) return freshDelta
  const leftAge = observationAgeSec(left, nowMs)
  const rightAge = observationAgeSec(right, nowMs)
  if (leftAge !== null && rightAge !== null && leftAge !== rightAge) return leftAge - rightAge
  if (leftAge !== null && rightAge === null) return -1
  if (leftAge === null && rightAge !== null) return 1
  const leftNic = left.nic
  const rightNic = right.nic
  if (leftNic !== null && rightNic !== null && leftNic !== rightNic) return rightNic - leftNic
  if (leftNic !== null && rightNic === null) return -1
  if (leftNic === null && rightNic !== null) return 1
  if (left.rc !== null && right.rc !== null && left.rc !== right.rc) return left.rc - right.rc
  if (leftNic === null && rightNic === null) {
    const sourceDelta = SOURCE_RANK[left.positionSource] - SOURCE_RANK[right.positionSource]
    if (sourceDelta !== 0) return sourceDelta
  }
  return left.provider.localeCompare(right.provider)
}

export function selectPrimaryObservation(
  observations: readonly AircraftProviderObservation[],
  nowMs: number,
): { primary: AircraftProviderObservation | null; alternates: AircraftProviderObservation[]; reason: string } {
  if (observations.length === 0) {
    return { primary: null, alternates: [], reason: 'No provider observations.' }
  }
  const ordered = [...observations].sort((left, right) => compareObservations(left, right, nowMs))
  const primary = ordered[0]
  const age = observationAgeSec(primary, nowMs)
  const freshness = freshnessFromAge(age, validPosition(primary))
  const integrity = [
    primary.positionSource,
    age !== null ? `position age ${age.toFixed(1)} sec` : 'position age not reported',
    primary.nic !== null ? `NIC ${primary.nic}` : null,
    primary.rc !== null ? `RC ${primary.rc} m` : null,
  ].filter(Boolean).join(', ')
  return {
    primary,
    alternates: ordered.slice(1),
    reason: `${freshness} ${primary.provider} selected: ${integrity}`,
  }
}
