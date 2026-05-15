import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

export type DiagnosticSessionMode = 'idle' | 'sequential_diagnostic' | 'hold'

export type DiagnosticTurnQueueItem = {
  family: CouncilOrchestrationFamily
  done: boolean
}

export type DiagnosticSessionState = {
  mode: DiagnosticSessionMode
  /** Monotonic step in the active order (0-based). */
  turnIndex: number
  /** Planned speakers for the current diagnostic run. */
  order: CouncilOrchestrationFamily[]
  hold: boolean
  /** Optional note when hold tripped (non-secret). */
  holdReason?: string
}
