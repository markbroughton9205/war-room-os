import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { BackendMetadata } from './types'

export type SeatBackendStatusRow = {
  seat: CouncilOrchestrationFamily
  backendType: BackendMetadata['backendType']
  provider: string
  model: string
  ready: 'READY' | 'UNAVAILABLE' | 'RATE_LIMITED'
  fallbackUsed: boolean
  latencyMs: number
}

/**
 * Pure projection from seat invocation results to the status-row shape the local-backend
 * architecture calls for (seat / backend / model / local-or-external / ready-unavailable-
 * rate_limited / fallback used / latency). Deliberately NOT wired into any component this
 * phase — see the implementation report's UI section for why (bounded scope, no live-UI edits).
 */
export function projectSeatBackendStatusRows(
  results: { seat: CouncilOrchestrationFamily; backend: BackendMetadata }[],
): SeatBackendStatusRow[] {
  return results.map(({ seat, backend }) => ({
    seat,
    backendType: backend.backendType,
    provider: backend.provider,
    model: backend.model,
    ready: backend.status === 'OK' ? 'READY' : backend.failureClass === 'RATE_LIMIT' ? 'RATE_LIMITED' : 'UNAVAILABLE',
    fallbackUsed: Boolean(backend.fallbackFrom),
    latencyMs: backend.latencyMs,
  }))
}
