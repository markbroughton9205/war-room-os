import {
  COUNCIL_SWARM_PHASES,
  SWARM_PHASE_ORDER,
  type CouncilSwarmPhase,
} from './types'

export type SwarmPhaseState = {
  phase: CouncilSwarmPhase
  enteredAt: string
  history: Array<{ phase: CouncilSwarmPhase; enteredAt: string }>
}

const NEXT: Record<CouncilSwarmPhase, CouncilSwarmPhase | null> = {
  MISSION_DECOMPOSITION: 'INDEPENDENT_DISCOVERY',
  INDEPENDENT_DISCOVERY: 'POSITION_FREEZE',
  POSITION_FREEZE: 'CROSS_REVIEW',
  CROSS_REVIEW: 'VERIFICATION',
  VERIFICATION: 'SYNTHESIS',
  SYNTHESIS: 'PERSISTENCE',
  PERSISTENCE: null,
}

export function createSwarmPhaseState(nowIso = new Date().toISOString()): SwarmPhaseState {
  return {
    phase: 'MISSION_DECOMPOSITION',
    enteredAt: nowIso,
    history: [{ phase: 'MISSION_DECOMPOSITION', enteredAt: nowIso }],
  }
}

export function canEnterSwarmPhase(from: CouncilSwarmPhase, to: CouncilSwarmPhase): boolean {
  return NEXT[from] === to
}

export function advanceSwarmPhase(state: SwarmPhaseState, to: CouncilSwarmPhase, nowIso = new Date().toISOString()): SwarmPhaseState {
  if (state.phase === to) return state
  if (!canEnterSwarmPhase(state.phase, to)) {
    throw new Error(`Illegal swarm phase transition ${state.phase} → ${to}`)
  }
  return {
    phase: to,
    enteredAt: nowIso,
    history: [...state.history, { phase: to, enteredAt: nowIso }],
  }
}

export function swarmPhaseIndex(phase: CouncilSwarmPhase): number {
  return SWARM_PHASE_ORDER.indexOf(phase)
}

export function freezeMustPrecedeCrossReview(history: SwarmPhaseState['history']): boolean {
  const freeze = history.findIndex(item => item.phase === 'POSITION_FREEZE')
  const review = history.findIndex(item => item.phase === 'CROSS_REVIEW')
  return freeze >= 0 && (review === -1 || freeze < review)
}

export function discoveryMustPrecedeFreeze(history: SwarmPhaseState['history']): boolean {
  const discovery = history.findIndex(item => item.phase === 'INDEPENDENT_DISCOVERY')
  const freeze = history.findIndex(item => item.phase === 'POSITION_FREEZE')
  return discovery >= 0 && (freeze === -1 || discovery < freeze)
}

export function synthesisMustFollowVerification(history: SwarmPhaseState['history']): boolean {
  const verification = history.findIndex(item => item.phase === 'VERIFICATION')
  const synthesis = history.findIndex(item => item.phase === 'SYNTHESIS')
  return verification >= 0 && (synthesis === -1 || verification < synthesis)
}

export function allSwarmPhasesAreAuditable(): boolean {
  return COUNCIL_SWARM_PHASES.length === 7 && SWARM_PHASE_ORDER.every((phase, index) => COUNCIL_SWARM_PHASES[index] === phase)
}
