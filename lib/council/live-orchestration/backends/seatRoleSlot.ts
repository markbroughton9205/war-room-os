import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { LocalRoleSlot } from './types'

/**
 * Default functional-role assignment per seat persona, for local backend resolution only.
 * Seat identity (name/persona/deliberation function) is untouched by this mapping — it only
 * decides which local model role slot would stand in for the seat when local is in play.
 *
 * Phase 1C: every permanent Nebula Council seat shares the Genesis GENERAL weight
 * (huihui_ai/qwen3-abliterated:14b). Distinctiveness lives in identity/role/memory, not in a
 * dedicated billion-parameter model per agent. Bridge Architect is not a Nebula permanent
 * identity and keeps the CODING slot mapping.
 */
export const SEAT_LOCAL_ROLE_SLOT: Record<CouncilOrchestrationFamily, LocalRoleSlot> = {
  claude: 'GENERAL',
  baby: 'GENERAL',
  grok: 'GENERAL',
  gemini: 'GENERAL',
  chatgpt: 'GENERAL',
  // PHOENIX (red_team) stays on GENERAL — must never require dolphin-mistral-venice:24b.
  red_team: 'GENERAL',
  // NOVA (kimi) shares Genesis GENERAL. Do not assign the uninstalled 30b coder as a Nebula brain.
  kimi: 'GENERAL',
  // Bridge Architect is not a permanent Nebula identity. Leave CODING for that optional seat.
  bridge_architect: 'CODING',
}
