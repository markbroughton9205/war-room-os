import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { DiagnosticIntentMode } from '@/lib/council/diagnosticMode'
import type { DiagnosticSessionState } from '@/lib/council/runtimeDiagnosticTypes'
import { advanceTurn, buildDefaultDiagnosticOrder, nextSpeaker } from '@/lib/council/turnSequencer'

export type DiagnosticQueue = {
  state: DiagnosticSessionState
}

function sessionModeFromIntent(intent: DiagnosticIntentMode): DiagnosticSessionState['mode'] {
  if (intent === 'runtime_audit') return 'runtime_audit'
  if (intent === 'repair_review') return 'repair_review'
  if (intent === 'sequential_diagnostics') return 'sequential_diagnostics'
  return 'sequential_diagnostic'
}

export function createDiagnosticQueue(
  families: CouncilOrchestrationFamily[],
  intentMode: DiagnosticIntentMode = 'sequential_diagnostics',
): DiagnosticQueue {
  const order = buildDefaultDiagnosticOrder(families)
  const activeMode = sessionModeFromIntent(intentMode)
  return {
    state: {
      mode: order.length ? activeMode : 'idle',
      intentMode,
      turnIndex: 0,
      order,
      hold: false,
    },
  }
}

export function setHold(queue: DiagnosticQueue, reason?: string): DiagnosticQueue {
  return {
    state: {
      ...queue.state,
      mode: 'hold',
      hold: true,
      holdReason: reason,
    },
  }
}

export function advanceDiagnosticQueue(queue: DiagnosticQueue): DiagnosticQueue {
  if (queue.state.hold) return queue
  const nextIdx = advanceTurn(queue.state.turnIndex, queue.state.order.length)
  const done = nextIdx >= queue.state.order.length
  const resumeMode = sessionModeFromIntent(queue.state.intentMode)
  return {
    state: {
      ...queue.state,
      turnIndex: nextIdx,
      mode: done ? 'idle' : resumeMode,
    },
  }
}

export function currentDiagnosticSpeaker(queue: DiagnosticQueue): CouncilOrchestrationFamily | null {
  return nextSpeaker(queue.state.order, queue.state.turnIndex)
}
