import { classifyEvidenceBoardMission, shouldDispatchEvidenceBoardCouncil } from '@/lib/council/evidence-board/classifier'
import type { EbcMissionClass } from '@/lib/council/evidence-board/types'
import type { PathClassifierResult } from './types'

export type AgentPathRoute = {
  path: 'AGENT_PATH'
  existing_module: 'evidence-board-council'
  mission_class: EbcMissionClass
  should_dispatch_ebc: boolean
  create_mission_id: true
  seats_default_six: false
}

/**
 * AGENT_PATH is a front door to existing Evidence-Board Council.
 * Does not reimplement EBC, LUMEN, PHOENIX, AURORA, or the tool runner.
 */
export function routeAgentPath(text: string, classified?: PathClassifierResult): AgentPathRoute {
  const ebc = classifyEvidenceBoardMission({ commanderMessage: text })
  return {
    path: 'AGENT_PATH',
    existing_module: 'evidence-board-council',
    mission_class: ebc.mission_class,
    should_dispatch_ebc: shouldDispatchEvidenceBoardCouncil(ebc.mission_class),
    create_mission_id: true,
    seats_default_six: false,
  }
}

export function agentPathUsesExistingEbc(route: AgentPathRoute): boolean {
  return route.existing_module === 'evidence-board-council' && route.should_dispatch_ebc
}
