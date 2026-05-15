import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'
import type { DiagnosticSessionState } from '@/lib/council/runtimeDiagnosticTypes'
import { advanceTurn, buildDefaultDiagnosticOrder, nextSpeaker } from '@/lib/council/turnSequencer'

export type DiagnosticQueue = {
  state: DiagnosticSessionState
}

export function createDiagnosticQueue(families: CouncilOrchestrationFamily[]): DiagnosticQueue {
  const order = buildDefaultDiagnosticOrder(families)
  return {
    state: {
      mode: order.length ? 'sequential_diagnostic' : 'idle',
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
  return {
    state: {
      ...queue.state,
      turnIndex: nextIdx,
      mode: done ? 'idle' : queue.state.mode,
    },
  }
}

export function currentDiagnosticSpeaker(queue: DiagnosticQueue): CouncilOrchestrationFamily | null {
  return nextSpeaker(queue.state.order, queue.state.turnIndex)
}
