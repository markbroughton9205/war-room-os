import type { EngineReceipt } from '../types'

export type AuthorityGateClass = 'READ_ONLY' | 'AUTO_ALLOWED' | 'COMMANDER_REQUIRED' | 'PROHIBITED'

export type ExecutionTaskState =
  | 'PLANNED'
  | 'READY'
  | 'WAITING_DEPENDENCY'
  | 'WAITING_AUTHORITY'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'BLOCKED'
  | 'CANCELLED'
  | 'SKIPPED'
  | 'REPLANNED'

export type ProofLevel = 'UNIT' | 'INTEGRATION' | 'LIVE_INSTALLED'

export type ExecutionBudget = {
  max_tool_calls: number
  max_retries: number
  max_ms: number
  max_local_model: 1
}

export type ExecutionGovernorState = {
  tool_calls: number
  retry_count: number
  latency_ms: number
  local_model_calls: number
  external_calls: number
  stopped: boolean
  stop_reason: string | null
  budget: ExecutionBudget
  receipt: EngineReceipt
}

export type AuthorityGate = {
  class: AuthorityGateClass
  execute: boolean
  reason: string
}
