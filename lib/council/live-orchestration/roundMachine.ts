import type { CouncilRoundPhase } from './types'

const TRANSITIONS: Record<CouncilRoundPhase, CouncilRoundPhase[]> = {
  ROUND_CREATED: ['CLASSIFYING', 'FAILED'],
  CLASSIFYING: ['RESEARCHING', 'DELIBERATING', 'COMPLETE', 'FAILED'],
  RESEARCHING: ['EVIDENCE_READY', 'DELIBERATING', 'FAILED'],
  EVIDENCE_READY: ['DELIBERATING', 'FAILED'],
  DELIBERATING: ['RED_TEAM', 'SYNTHESIS', 'COMPLETE', 'FAILED'],
  RED_TEAM: ['REVISION', 'SYNTHESIS', 'COMPLETE', 'FAILED'],
  REVISION: ['SYNTHESIS', 'COMPLETE', 'FAILED'],
  SYNTHESIS: ['COMPLETE', 'FAILED'],
  COMPLETE: [],
  FAILED: [],
}

export function canTransitionRoundPhase(from: CouncilRoundPhase, to: CouncilRoundPhase): boolean {
  return TRANSITIONS[from]?.includes(to) === true
}

export function transitionRoundPhase(from: CouncilRoundPhase, to: CouncilRoundPhase): CouncilRoundPhase {
  if (!canTransitionRoundPhase(from, to)) {
    throw new Error(`Illegal round phase transition ${from} → ${to}`)
  }
  return to
}

export function socialCheckinPhasePath(): CouncilRoundPhase[] {
  return ['ROUND_CREATED', 'CLASSIFYING', 'DELIBERATING', 'COMPLETE']
}
