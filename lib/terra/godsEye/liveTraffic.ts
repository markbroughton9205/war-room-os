/**
 * Provider-neutral live traffic / signal schemas.
 * Static infrastructure may render immediately. Live state stays NO_COVERAGE until a real provider exists.
 * Never fabricate RED/YELLOW/GREEN or a global congestion mosaic.
 */
import { liveSignalPhaseFromInfrastructure } from '../godsEyeCoverageMatrix'
import type { GodsEyeLayerTruthState } from './coverageStates'

export const LIVE_TRAFFIC_EVENT_KINDS = ['incident', 'closure', 'congestion', 'travel_speed', 'traffic_signal', 'spat'] as const
export type LiveTrafficEventKind = (typeof LIVE_TRAFFIC_EVENT_KINDS)[number]

export type TerraLiveTrafficEvent = {
  id: string
  kind: LiveTrafficEventKind
  latitude: number | null
  longitude: number | null
  headline: string | null
  source: string
  retrievedAt: string | null
  coverageState: GodsEyeLayerTruthState
  sourceUrl: string | null
}

export type TerraLiveSignalPhase = {
  infrastructureId: string
  phase: 'NO_COVERAGE'
  spatAvailable: false
  source: string
}

export function liveSignalPhaseSchema(infrastructureId: string, source: string): TerraLiveSignalPhase {
  return {
    infrastructureId,
    phase: liveSignalPhaseFromInfrastructure(),
    spatAvailable: false,
    source,
  }
}

export function liveTrafficDefaultCoverage(kind: LiveTrafficEventKind): GodsEyeLayerTruthState {
  if (kind === 'traffic_signal' || kind === 'spat') return 'NO_COVERAGE'
  return 'NO_COVERAGE'
}
