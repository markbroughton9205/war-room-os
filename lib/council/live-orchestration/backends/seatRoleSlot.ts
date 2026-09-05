import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { LocalRoleSlot } from './types'

/**
 * Default functional-role assignment per seat persona, for local backend resolution only.
 * Seat identity (name/persona/deliberation function) is untouched by this mapping — it only
 * decides which local model role slot would stand in for the seat when local is in play.
 * Commander-editable; not derived from anything the seats themselves declare.
 */
export const SEAT_LOCAL_ROLE_SLOT: Record<CouncilOrchestrationFamily, LocalRoleSlot> = {
  claude: 'GENERAL',
  baby: 'GENERAL',
  grok: 'RESEARCH',
  gemini: 'RESEARCH',
  chatgpt: 'SYNTHESIS',
  red_team: 'RED_TEAM',
  kimi: 'CODING',
  bridge_architect: 'CODING',
}
