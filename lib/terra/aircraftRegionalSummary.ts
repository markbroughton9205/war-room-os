/**
 * Bounded, honest summary of the currently-loaded aircraft set — Observed Data, not analysis.
 * Deliberately reports only counts/averages directly computable from the observed features
 * themselves; never infers congestion, military activity, danger, or "unusual behavior" (mission
 * requirement) — that would require an evaluative pipeline this phase does not build.
 */
import type { TerraGeoFeature } from './types'
import { isTerraAircraftStale, TERRA_AIRCRAFT_STALE_AFTER_MS } from './aircraftStaleness'

export type TerraAircraftRegionalSummary = {
  provider: 'opensky'
  totalCount: number
  airborneCount: number
  onGroundCount: number
  staleCount: number
  /** Mean altitude (meters) over airborne aircraft with a known altitude only — null when no
   * airborne aircraft supplied one, never a fabricated placeholder. */
  averageAltitudeMeters: number | null
  earliestObservedAt: string | null
  latestObservedAt: string | null
}

export function summarizeTerraAircraftFeatures(
  features: TerraGeoFeature[],
  nowIso: string,
  staleAfterMs: number = TERRA_AIRCRAFT_STALE_AFTER_MS,
): TerraAircraftRegionalSummary {
  const aircraft = features.filter(feature => feature.kind === 'aircraft_state')

  let onGroundCount = 0
  let staleCount = 0
  let altitudeSum = 0
  let altitudeCount = 0
  let earliestObservedAt: string | null = null
  let latestObservedAt: string | null = null

  for (const feature of aircraft) {
    const onGround = feature.properties.onGround === true
    if (onGround) onGroundCount += 1
    if (isTerraAircraftStale(feature.timestamp, nowIso, staleAfterMs)) staleCount += 1
    if (!onGround && typeof feature.altitude === 'number') {
      altitudeSum += feature.altitude
      altitudeCount += 1
    }
    if (feature.timestamp) {
      if (earliestObservedAt === null || feature.timestamp < earliestObservedAt) earliestObservedAt = feature.timestamp
      if (latestObservedAt === null || feature.timestamp > latestObservedAt) latestObservedAt = feature.timestamp
    }
  }

  return {
    provider: 'opensky',
    totalCount: aircraft.length,
    airborneCount: aircraft.length - onGroundCount,
    onGroundCount,
    staleCount,
    averageAltitudeMeters: altitudeCount > 0 ? altitudeSum / altitudeCount : null,
    earliestObservedAt,
    latestObservedAt,
  }
}
