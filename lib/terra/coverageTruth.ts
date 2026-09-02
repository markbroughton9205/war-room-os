/**
 * God's Eye Phase 2 — the reusable Coverage Truth model for road/camera/traffic providers, per the
 * mission's exact required vocabulary. Generalizes lib/terra/maritimeCoverage.ts's proven pattern
 * (same pure/deterministic shape, same "camera-coverage answer + generic layer feed state in,
 * one honest state out" contract) rather than inventing a second one — maritimeCoverage.ts itself
 * is left untouched (its own bespoke state names — NO_VESSELS_OBSERVED, RATE_LIMITED, etc. — predate
 * this phase and already ship real UI/Council text keyed to them), but any Phase 2+ road/camera/
 * traffic layer (traffic flow, road weather, and — retrofittable, not required this phase — the
 * existing traffic camera/event layers) should resolve through this shared module instead of a
 * fourth bespoke enum.
 *
 * The mission-mandated invariants this module exists to enforce:
 *   - Never render NO_DATA as NO_COVERAGE (or vice versa) — "the provider covers here but observed
 *     nothing" and "the provider doesn't reach here at all" are always distinguishable.
 *   - Never render NO_COVERAGE as "everything is clear."
 *   - Never use LIVE merely because zero events were returned, and never use LIVE for data the
 *     source itself reports (or this module's own freshness check determines) is stale/historical.
 */
import type { TerraLayerFeedState } from '@/components/war-room/terra/useTerraLayer'

export const TERRA_COVERAGE_TRUTH_STATES = ['NO_COVERAGE', 'NO_DATA', 'LOADING', 'LIVE', 'STALE', 'OFFLINE', 'UNKNOWN'] as const
export type TerraCoverageTruthState = (typeof TERRA_COVERAGE_TRUTH_STATES)[number]

export const TERRA_COVERAGE_TRUTH_LABELS: Record<TerraCoverageTruthState, string> = {
  NO_COVERAGE: 'NO COVERAGE HERE',
  NO_DATA: 'COVERED — NO DATA RETURNED',
  LOADING: 'LOADING…',
  LIVE: 'LIVE',
  STALE: 'STALE',
  OFFLINE: 'OFFLINE',
  UNKNOWN: 'UNKNOWN',
}

export function resolveTerraCoverageTruth(params: {
  /** Whether the camera's current view genuinely overlaps this provider's real, documented
   * coverage envelope — independent of whether the layer is enabled or whether any features were
   * returned. Computed by a provider-specific *BoundingBox.ts module (e.g.
   * lib/terra/roadCameraBoundingBox.ts's terraCameraViewHasRoadCameraCoverage), never guessed here. */
  hasKnownCoverage: boolean
  boundingBoxQuery: string | null
  feedState: TerraLayerFeedState
  lastErrorMessage: string | null
  /** True when every feature currently held for this layer is honestly marked historical/stale by
   * its own source-derived freshness classification (e.g. webtris' unconditional
   * isHistoricalBatchReport, or a computed age-vs-threshold check) — the reason LIVE data can never
   * be reported for a provider whose only real data is old, even when the fetch itself just
   * succeeded. `null` when the layer has no per-feature freshness concept (or no features yet), in
   * which case feedState alone decides LIVE vs. STALE via the 'stale' feed state. */
  allFeaturesHistoricalOrStale: boolean | null
}): TerraCoverageTruthState {
  const { hasKnownCoverage, boundingBoxQuery, feedState, lastErrorMessage, allFeaturesHistoricalOrStale } = params

  if (!hasKnownCoverage || boundingBoxQuery === null) return 'NO_COVERAGE'
  if (feedState === 'loading') return 'LOADING'
  if (feedState === 'error') {
    // A definite upstream failure is OFFLINE; an ambiguous error with no HTTP-status evidence is
    // honestly UNKNOWN rather than assumed OFFLINE.
    if (lastErrorMessage && /\b(4\d{2}|5\d{2})\b/.test(lastErrorMessage)) return 'OFFLINE'
    return 'UNKNOWN'
  }
  if (feedState === 'stale' || allFeaturesHistoricalOrStale === true) return 'STALE'
  if (feedState === 'empty') return 'NO_DATA'
  return 'LIVE'
}
