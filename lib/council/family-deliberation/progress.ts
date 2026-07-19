import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import { councilFamilyExecutionId } from '@/lib/council/request-state/types'
import type { CouncilProgressRuntimeTracker } from '@/lib/council/progress-events/runtime'
import type { CouncilFamilyOutcome, CouncilProviderReadiness } from '@/lib/council/request-state/types'
import type { DeliberationCompletionStatus, DeliberationTurn, DeliberationTurnRole } from './types'

// Red Team is intentionally a real, provider-executing selected family in
// family_to_family_v1 deliberation mode -- it receives its own opening
// prompt (the two prior completed messages) and its own genuine terminal
// lifecycle event (family_response_completed/failed/timed_out/not_reached)
// via this recorder, exactly like chatgpt and claude. This is a deliberate
// redefinition specific to this deliberation mode: elsewhere in the
// codebase (direct/parallel/legacy-sequential Council paths), "Red Team" is
// a synthetic integrity/audit role recorded via audit_scope_declared/
// audit_completed and never counted as a selected provider family. Do not
// mistake the real-provider accounting here for an accidental boundary
// violation -- the two roles are distinct by design, scoped to their
// respective execution paths.
const LIFECYCLE_FAMILY_TURNS: ReadonlySet<DeliberationTurnRole> = new Set([
  'opening_position',
  'direct_response',
  'red_team_challenge',
  'revision_or_stand_firm',
])

function contentFingerprint(content: string): string {
  let hash = 0
  for (let i = 0; i < content.length; i += 1) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0
  }
  return `len:${content.length}:h:${Math.abs(hash)}`
}

function terminalEventFor(status: DeliberationCompletionStatus): {
  eventType: 'family_response_completed' | 'family_failed' | 'family_timed_out' | 'family_not_reached'
  outcome: CouncilFamilyOutcome
  readiness: CouncilProviderReadiness
} {
  if (status === 'complete') {
    return { eventType: 'family_response_completed', outcome: 'complete', readiness: 'connected' }
  }
  if (status === 'timed_out') {
    return { eventType: 'family_timed_out', outcome: 'timed_out', readiness: 'configured' }
  }
  if (status === 'unavailable' || status === 'unresolved') {
    return { eventType: 'family_not_reached', outcome: 'not_reached', readiness: 'unavailable' }
  }
  return { eventType: 'family_failed', outcome: 'failed', readiness: 'configured' }
}

export type DeliberationProgressRecorder = {
  recordTurnStarted(family: CouncilOrchestrationFamily, role: DeliberationTurnRole, priorTurns: DeliberationTurn[]): void
  recordTurnCompleted(turn: DeliberationTurn, opts?: { finalFamilyTurn?: boolean }): void
  recordFamilyNotReached(family: CouncilOrchestrationFamily, reason: string): void
  closeIfTerminal(): ReturnType<CouncilProgressRuntimeTracker['closeIfTerminal']>
}

export function createDeliberationProgressRecorder(
  tracker: CouncilProgressRuntimeTracker,
): DeliberationProgressRecorder {
  const startedFamilies = new Set<CouncilOrchestrationFamily>()
  const terminalFamilies = new Set<CouncilOrchestrationFamily>()

  const executionId = (family: CouncilOrchestrationFamily) =>
    councilFamilyExecutionId(`${tracker.requestId}-${family}`)

  const recordPriorDelivery = (
    targetFamily: CouncilOrchestrationFamily,
    priorTurns: DeliberationTurn[],
  ) => {
    priorTurns
      .filter(turn => Boolean(turn.output_message_id && turn.full_response.trim()))
      .forEach((turn, index) => {
        tracker.record({
          eventType: 'family_prior_response_delivered',
          source: 'provider_adapter',
          family: targetFamily,
          payload: {
            priorResponse: {
              sourceFamily: turn.provider_family,
              targetFamily,
              sourceExecutionId: executionId(turn.provider_family),
              targetExecutionId: executionId(targetFamily),
              deliveryOrder: index + 1,
              delivered: true,
              contentFingerprint: contentFingerprint(turn.full_response),
            },
          },
        })
      })
  }

  return {
    recordTurnStarted(family, role, priorTurns) {
      if (!LIFECYCLE_FAMILY_TURNS.has(role) || terminalFamilies.has(family)) return
      if (!startedFamilies.has(family)) {
        tracker.record({ eventType: 'family_queued', source: 'server_orchestrator', family })
        tracker.record({
          eventType: 'family_dispatched',
          source: 'provider_adapter',
          family,
          payload: { readiness: 'configured', providerLabel: family },
        })
        recordPriorDelivery(family, priorTurns)
        if (priorTurns.some(turn => turn.output_message_id && turn.full_response.trim())) {
          tracker.record({ eventType: 'family_reviewing_previous', source: 'provider_adapter', family })
        }
        tracker.record({ eventType: 'family_response_started', source: 'provider_adapter', family })
        startedFamilies.add(family)
        return
      }
      recordPriorDelivery(family, priorTurns)
    },
    recordTurnCompleted(turn, opts) {
      if (!LIFECYCLE_FAMILY_TURNS.has(turn.turn_role) || terminalFamilies.has(turn.provider_family)) return
      if (turn.completion_status === 'complete' && !opts?.finalFamilyTurn) return
      const terminal = terminalEventFor(turn.completion_status)
      tracker.record({
        eventType: terminal.eventType,
        source: 'provider_adapter',
        family: turn.provider_family,
        payload: {
          outcome: terminal.outcome,
          readiness: terminal.readiness,
          providerLabel: turn.provider_label,
          ...(terminal.eventType === 'family_timed_out' ? { timeoutMs: 10000 } : {}),
        },
      })
      terminalFamilies.add(turn.provider_family)
    },
    recordFamilyNotReached(family, reason) {
      if (terminalFamilies.has(family)) return
      tracker.record({
        eventType: 'family_not_reached',
        source: 'server_orchestrator',
        family,
        payload: {
          outcome: 'not_reached',
          readiness: 'unavailable',
          reason,
        },
      })
      terminalFamilies.add(family)
    },
    closeIfTerminal() {
      return tracker.closeIfTerminal()
    },
  }
}
