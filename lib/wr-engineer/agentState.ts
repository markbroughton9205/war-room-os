/**
 * WR-Engineer agent state machine.
 *
 * Deliberately tiny and explicit — same discipline as
 * lib/native-builder/types.ts's NATIVE_REPAIR_TRANSITIONS: a fixed transition graph, no implicit
 * jumps, and every transition timestamped and (optionally) noted for later inspection. This is
 * observable-actions bookkeeping, not an execution engine — nothing in this file runs anything.
 */
import { AGENT_STATE_TRANSITIONS, type AgentState, type AgentStateHistoryEntry } from './types'

export class InvalidAgentStateTransitionError extends Error {
  constructor(from: AgentState, to: AgentState) {
    super(`Illegal WR-Engineer state transition: ${from} -> ${to}`)
    this.name = 'InvalidAgentStateTransitionError'
  }
}

export type AgentStateMachine = {
  current: AgentState
  history: AgentStateHistoryEntry[]
}

export function createAgentStateMachine(initial: AgentState = 'READY'): AgentStateMachine {
  return {
    current: initial,
    history: [{ state: initial, at: new Date().toISOString() }],
  }
}

/** Pure — returns a new machine rather than mutating, so callers can't accidentally hold a stale
 * reference across a rejected transition. Throws on any transition not in AGENT_STATE_TRANSITIONS. */
export function transitionAgentState(
  machine: AgentStateMachine,
  to: AgentState,
  note?: string,
): AgentStateMachine {
  const allowed = AGENT_STATE_TRANSITIONS[machine.current]
  if (!allowed.includes(to)) {
    throw new InvalidAgentStateTransitionError(machine.current, to)
  }
  return {
    current: to,
    history: [...machine.history, { state: to, at: new Date().toISOString(), note }],
  }
}

export function canTransition(from: AgentState, to: AgentState): boolean {
  return AGENT_STATE_TRANSITIONS[from].includes(to)
}
