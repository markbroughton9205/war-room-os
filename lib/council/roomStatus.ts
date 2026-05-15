import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { ProviderFamilyOutcomeStatus } from '@/lib/council/providerIsolation'

export type RoomStatus = {
  family: string
  status: 'active' | 'pending' | 'timeout' | 'failed' | 'offline'
}

function mapProviderOutcome(status: ProviderFamilyOutcomeStatus | undefined): RoomStatus['status'] {
  switch (status) {
    case 'RESPONDED':
    case 'READY':
    case 'DEGRADED':
      return 'active'
    case 'IN_FLIGHT':
      return 'pending'
    case 'TIMED_OUT':
      return 'timeout'
    case 'FAILED':
      return 'failed'
    case 'SKIPPED':
    default:
      return 'offline'
  }
}

export function buildRoomStatusesFromProviderStates(
  providerStates: Partial<Record<CouncilOrchestrationFamily, ProviderFamilyOutcomeStatus>> | undefined,
  families?: CouncilOrchestrationFamily[],
): RoomStatus[] {
  const keys = families?.length
    ? families
    : (Object.keys(providerStates ?? {}) as CouncilOrchestrationFamily[])
  return keys.map(family => ({
    family,
    status: mapProviderOutcome(providerStates?.[family]),
  }))
}

/** Pre-gather readiness from engine functional map (no fake presence). */
export function buildRoomStatusesFromEngineFunctional(
  families: CouncilOrchestrationFamily[],
  isFunctional: (family: CouncilOrchestrationFamily) => boolean,
): RoomStatus[] {
  return families.map(family => ({
    family,
    status: isFunctional(family) ? 'active' : 'offline',
  }))
}
