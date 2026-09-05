/**
 * Bounded, honest summary of the currently-loaded vessel set — Observed Data, not analysis.
 * Mirrors lib/terra/aircraftRegionalSummary.ts's exact convention: only counts/averages directly
 * computable from the observed features themselves; never infers traffic congestion, smuggling,
 * "unusual behavior," or anything evaluative.
 */
import type { TerraGeoFeature } from './types'
import { isTerraVesselStale, TERRA_VESSEL_STALE_AFTER_MS } from './vesselStaleness'

export type TerraVesselRegionalSummary = {
  provider: 'digitraffic_marine'
  totalCount: number
  movingCount: number
  stationaryCount: number
  staleCount: number
  /** Mean speed (knots) over vessels with a known, real reported speed only — null when none
   * supplied one, never a fabricated placeholder. */
  averageSpeedKnots: number | null
  earliestObservedAt: string | null
  latestObservedAt: string | null
}

// A vessel making way under 0.5 kn reads as noise/drift, not real movement — the same
// "moving vs. stationary" cutoff AIS analysis conventionally uses, applied only to a real reported
// speedKnots value (never inferred when the source didn't supply one).
const MOVING_SPEED_THRESHOLD_KNOTS = 0.5

export function summarizeTerraVesselFeatures(
  features: TerraGeoFeature[],
  nowIso: string,
  staleAfterMs: number = TERRA_VESSEL_STALE_AFTER_MS,
): TerraVesselRegionalSummary {
  const vessels = features.filter(feature => feature.kind === 'vessel_position')

  let movingCount = 0
  let staleCount = 0
  let speedSum = 0
  let speedCount = 0
  let earliestObservedAt: string | null = null
  let latestObservedAt: string | null = null

  for (const feature of vessels) {
    const speedKnots = typeof feature.properties.speedKnots === 'number' ? feature.properties.speedKnots : null
    if (speedKnots !== null) {
      speedSum += speedKnots
      speedCount += 1
      if (speedKnots >= MOVING_SPEED_THRESHOLD_KNOTS) movingCount += 1
    }
    if (isTerraVesselStale(feature.timestamp, nowIso, staleAfterMs)) staleCount += 1
    if (feature.timestamp) {
      if (earliestObservedAt === null || feature.timestamp < earliestObservedAt) earliestObservedAt = feature.timestamp
      if (latestObservedAt === null || feature.timestamp > latestObservedAt) latestObservedAt = feature.timestamp
    }
  }

  return {
    provider: 'digitraffic_marine',
    totalCount: vessels.length,
    movingCount,
    // Only vessels with a known speed are classified as stationary; a vessel with no reported
    // speed is neither counted as moving nor stationary — this never invents a 0.0 for it.
    stationaryCount: speedCount - movingCount,
    staleCount,
    averageSpeedKnots: speedCount > 0 ? speedSum / speedCount : null,
    earliestObservedAt,
    latestObservedAt,
  }
}
