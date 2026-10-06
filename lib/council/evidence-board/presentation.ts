import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import {
  appendDeliberationTurn,
  createDeliberationSession,
} from '@/lib/council/family-deliberation/runtime'
import type { DeliberationSession } from '@/lib/council/family-deliberation/types'
import { EBC_SEAT_BY_AGENT } from './assembly'
import type { EbcAgentId, EbcMissionResult } from './types'

export function deliberationSessionFromEbc(
  result: EbcMissionResult,
  commanderMessage: string,
  commanderBrief?: string | null,
): DeliberationSession {
  const session = createDeliberationSession({
    missionId: result.classification.mission_id,
    missionVersion: 1,
    commanderMessage,
    roundId: result.classification.mission_id,
  })
  const order = 1
  const visibleBrief = (commanderBrief ?? result.commander_brief).trim() || result.commander_brief
  appendDeliberationTurn(session, {
    family: 'chatgpt',
    role: 'council_synthesis',
    speakingOrder: order,
    inputMessageIds: [session.commander_message_id, ...session.turns.map(turn => turn.output_message_id).filter((id): id is string => Boolean(id))],
    evidenceReferenceIds: result.board.evidence.map(row => row.evidence_id),
    providerResult: {
      family: 'chatgpt',
      providerLabel: 'AURORA',
      providerModel: null,
      content: visibleBrief,
      status: 'complete',
      failureReason: null,
      backendType: 'LOCAL',
    },
    startedAt: new Date().toISOString(),
  })
  const synthesis = session.turns.find(turn => turn.turn_role === 'council_synthesis')
  session.synthesis_turn_id = synthesis?.turn_id ?? null
  session.completion_status = 'complete'
  session.diagnostics.push(
    `EBC ${result.classification.mission_class} completion=${result.snapshot.completion_state} agents=${result.classification.selected_agents.join(',')} evidence=${result.snapshot.evidence_count} peer_visibility=HIDDEN`,
  )
  return session
}

export function selectedSeatsFromAgents(agents: readonly EbcAgentId[]): CouncilOrchestrationFamily[] {
  return agents.map(agent => EBC_SEAT_BY_AGENT[agent])
}

export function selectedSeatsFromEbc(result: { selected_agents?: readonly EbcAgentId[]; classification?: { selected_agents: readonly EbcAgentId[] } }): CouncilOrchestrationFamily[] {
  const agents = result.selected_agents ?? result.classification?.selected_agents ?? []
  return selectedSeatsFromAgents(agents)
}
