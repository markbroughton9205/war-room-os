import type { Actor, AgentState } from './types'

export class AgentTransitionError extends Error {
  constructor(public readonly code: 'ILLEGAL_TRANSITION' | 'ACTOR_NOT_AUTHORIZED' | 'TERMINAL_STATE', message: string) { super(message) }
}

const COMMANDER = /^commander:[A-Za-z0-9._-]{1,64}$/
const SYSTEM = /^system:[A-Za-z0-9._-]{1,64}$/
export const isCommander = (a: Actor) => COMMANDER.test(a)
export const isSystem = (a: Actor) => SYSTEM.test(a)

/** Legal transitions. `system` may only move an ACTIVE agent toward a safer state (pause / review). */
const TABLE: Record<AgentState, Partial<Record<AgentState, 'commander' | 'commander_or_system'>>> = {
  PROPOSED: { APPROVED: 'commander', REJECTED: 'commander' },
  APPROVED: { ACTIVE: 'commander', RETIRED: 'commander' },
  ACTIVE: { PAUSED: 'commander_or_system', UNDER_REVIEW: 'commander_or_system', RETIRED: 'commander' },
  PAUSED: { ACTIVE: 'commander', UNDER_REVIEW: 'commander_or_system', RETIRED: 'commander' },
  UNDER_REVIEW: { ACTIVE: 'commander', PAUSED: 'commander_or_system', RETIRED: 'commander' },
  RETIRED: {},
  REJECTED: {},
}

/** Validates a transition; throws a typed error (fail closed). Pure. */
export function assertTransition(from: AgentState, to: AgentState, by: Actor): void {
  if (from === 'RETIRED' || from === 'REJECTED') throw new AgentTransitionError('TERMINAL_STATE', `${from} is terminal`)
  const rule = TABLE[from][to]
  if (!rule) throw new AgentTransitionError('ILLEGAL_TRANSITION', `${from} -> ${to} is not allowed`)
  if (rule === 'commander' && !isCommander(by)) throw new AgentTransitionError('ACTOR_NOT_AUTHORIZED', `${from} -> ${to} requires a Commander`)
  if (rule === 'commander_or_system' && !isCommander(by) && !isSystem(by)) throw new AgentTransitionError('ACTOR_NOT_AUTHORIZED', `${from} -> ${to} requires a Commander or system governor`)
}

export const canAcceptWork = (s: AgentState) => s === 'ACTIVE'
