import type { CouncilFamilyLifecycle, CouncilFamilyOutcome } from './types'

const LEGAL_TRANSITIONS: Readonly<Record<CouncilFamilyLifecycle, readonly CouncilFamilyLifecycle[]>> = {
  waiting: ['queued', 'stopped_by_commander', 'not_reached'],
  queued: ['dispatched', 'stopped_by_commander', 'not_reached'],
  dispatched: ['retrieving', 'responding', 'reviewing_previous_family', 'terminal'],
  retrieving: ['responding', 'terminal'],
  reviewing_previous_family: ['responding', 'terminal'],
  responding: ['terminal'],
  stopped_by_commander: ['terminal'],
  not_reached: ['terminal'],
  terminal: [],
}

const TERMINAL_OUTCOME_ALLOWED_FROM: Readonly<Record<CouncilFamilyLifecycle, readonly CouncilFamilyOutcome[]>> = {
  waiting: [],
  queued: [],
  dispatched: ['failed', 'timed_out', 'incomplete'],
  retrieving: ['complete', 'incomplete', 'timed_out', 'failed', 'fallback_used'],
  reviewing_previous_family: ['complete', 'incomplete', 'timed_out', 'failed', 'fallback_used'],
  responding: ['complete', 'incomplete', 'timed_out', 'failed', 'fallback_used'],
  stopped_by_commander: ['stopped'],
  not_reached: ['not_reached', 'skipped_by_policy'],
  terminal: [],
}

export type CouncilLifecycleTransitionDecision = {
  ok: boolean
  reason: string
}

export function canTransitionCouncilFamilyLifecycle(
  from: CouncilFamilyLifecycle,
  to: CouncilFamilyLifecycle,
): CouncilLifecycleTransitionDecision {
  const allowed = LEGAL_TRANSITIONS[from] ?? []
  if (allowed.includes(to)) return { ok: true, reason: 'transition_allowed' }
  return { ok: false, reason: `illegal_transition:${from}->${to}` }
}

export function canEnterTerminalWithOutcome(
  from: CouncilFamilyLifecycle,
  outcome: CouncilFamilyOutcome,
): CouncilLifecycleTransitionDecision {
  if (!LEGAL_TRANSITIONS[from]?.includes('terminal')) {
    return { ok: false, reason: `terminal_not_reachable_from:${from}` }
  }
  const allowed = TERMINAL_OUTCOME_ALLOWED_FROM[from] ?? []
  if (allowed.includes(outcome)) return { ok: true, reason: 'terminal_outcome_allowed' }
  return { ok: false, reason: `illegal_terminal_outcome:${from}->${outcome}` }
}

export function isTerminalLifecycle(lifecycle: CouncilFamilyLifecycle): boolean {
  return lifecycle === 'terminal'
}

export function isDispatchLifecycle(lifecycle: CouncilFamilyLifecycle): boolean {
  return lifecycle === 'dispatched'
    || lifecycle === 'retrieving'
    || lifecycle === 'reviewing_previous_family'
    || lifecycle === 'responding'
    || lifecycle === 'terminal'
}
