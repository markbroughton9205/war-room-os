/**
 * Maritime Coverage Truth — the mission-critical distinction this file exists to enforce: "we
 * observed zero vessels" (a real, honest fetch that found nothing in view) must never be confused
 * with "we have no AIS coverage here" (the camera is somewhere no registered Maritime source
 * reaches at all, e.g. the open Pacific). Collapsing those two into one "empty" state — which
 * useTerraLayer.ts's generic feed state does, by design, for every other Terra layer — would be
 * release-blocking for Maritime specifically, per mission doctrine.
 *
 * Pure and deterministic: takes the camera-coverage answer (lib/terra/maritimeBoundingBox.ts) and
 * the generic layer feed state (components/war-room/terra/useTerraLayer.ts) and produces one of
 * the mission's required coverage-truth values. `PENDING` is an additional, honest transient state
 * for "still loading" — not one of the mission's eight listed values, but never conflated with any
 * of them either.
 */
import type { TerraLayerFeedState } from '@/components/war-room/terra/useTerraLayer'

export const TERRA_MARITIME_COVERAGE_STATES = [
  'PENDING',
  'LIVE_DATA_PRESENT',
  'NO_VESSELS_OBSERVED',
  'NO_COVERAGE',
  'SOURCE_OFFLINE',
  'DELAYED_DATA',
  'RATE_LIMITED',
] as const
export type TerraMaritimeCoverageState = (typeof TERRA_MARITIME_COVERAGE_STATES)[number]

export const TERRA_MARITIME_COVERAGE_LABELS: Record<TerraMaritimeCoverageState, string> = {
  PENDING: 'LOADING…',
  LIVE_DATA_PRESENT: 'LIVE',
  NO_VESSELS_OBSERVED: 'LIVE — NO VESSELS OBSERVED',
  NO_COVERAGE: 'NO AIS COVERAGE HERE',
  SOURCE_OFFLINE: 'SOURCE OFFLINE',
  DELAYED_DATA: 'DELAYED — LAST SUCCESSFUL DATA',
  RATE_LIMITED: 'RATE LIMITED',
}

export function resolveTerraMaritimeCoverageState(params: {
  hasKnownCoverage: boolean
  boundingBoxQuery: string | null
  feedState: TerraLayerFeedState
  lastErrorMessage: string | null
}): TerraMaritimeCoverageState {
  const { hasKnownCoverage, boundingBoxQuery, feedState, lastErrorMessage } = params

  // The camera doesn't touch any registered source's real coverage envelope at all — an honest
  // NO_COVERAGE, never silently reported as "0 vessels."
  if (!hasKnownCoverage || boundingBoxQuery === null) return 'NO_COVERAGE'

  if (feedState === 'loading') return 'PENDING'
  if (lastErrorMessage && /\b429\b/.test(lastErrorMessage)) return 'RATE_LIMITED'
  if (feedState === 'error') return 'SOURCE_OFFLINE'
  if (feedState === 'stale') return 'DELAYED_DATA'
  if (feedState === 'empty') return 'NO_VESSELS_OBSERVED'
  return 'LIVE_DATA_PRESENT'
}
