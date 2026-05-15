import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { RoomStatus } from '@/lib/council/roomStatus'

const FULL_TEAM_PHRASES = [
  /\battendance\b/i,
  /\beverybody\s+check\s+in\b/i,
  /\bwhere\s+y'?all\s+at\b/i,
  /\bfull\s+team\b/i,
  /\bwe\s+don'?t\s+proceed\s+without\s+full\s+team\b/i,
]

export function detectFullTeamRequired(decreeText: string): boolean {
  const t = typeof decreeText === 'string' ? decreeText : ''
  return FULL_TEAM_PHRASES.some(re => re.test(t))
}

/**
 * Full-team satisfied when every required family reports `active` in room status.
 */
export function evaluateFullTeamSatisfied(
  requiredFamilies: CouncilOrchestrationFamily[],
  roomStatuses: RoomStatus[],
): boolean {
  if (!requiredFamilies.length) return true
  const byFamily = new Map(roomStatuses.map(r => [r.family, r]))
  return requiredFamilies.every(f => byFamily.get(f)?.status === 'active')
}

export const FULL_TEAM_GATE_TIMEOUT_MS = 5000

export const FULL_TEAM_UNSATISFIED_MESSAGE = 'Full-team condition not satisfied.'
