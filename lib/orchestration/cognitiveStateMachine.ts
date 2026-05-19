import type { CouncilThreadState, OperatorPacket } from '@/lib/cognitive-bus/types'

export const COGNITIVE_PHASES = ['intake', 'specialize', 'synthesize', 'red_team', 'operator_packet'] as const

export type CognitivePhase = (typeof COGNITIVE_PHASES)[number]

export function nextCognitivePhase(current: CognitivePhase): CognitivePhase | 'closed' {
  switch (current) {
    case 'intake':
      return 'specialize'
    case 'specialize':
      return 'synthesize'
    case 'synthesize':
      return 'red_team'
    case 'red_team':
      return 'operator_packet'
    case 'operator_packet':
      return 'closed'
    default:
      return 'closed'
  }
}

export function applyPhaseTransition(state: CouncilThreadState): CouncilThreadState {
  const phase = state.phase === 'closed' ? 'intake' : state.phase
  const next = nextCognitivePhase(phase as CognitivePhase)
  if (next === 'closed') {
    return { ...state, phase: 'closed' }
  }
  return { ...state, phase: next }
}

export function operatorPacketRequiresApproval(packet: OperatorPacket): boolean {
  return packet.commander_approval_required || packet.escalation_pending || packet.status === 'PROPOSED'
}
