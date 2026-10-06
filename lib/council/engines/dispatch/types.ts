import type { EngineReceipt } from '../types'
import type { FailureClass } from '../tool-selection/types'
import type { AuthorityGateClass, ExecutionTaskState, ProofLevel } from '../execution-governor/types'
import type { CompiledContext } from '../context-compiler/types'

export type DispatchWorkProduct = {
  work_product_id: string
  summary: string
  claims: string[]
  role: string
  produces_evidence: boolean
  kind: 'primary_external' | 'live_telemetry' | 'repo_config' | 'none'
  url?: string | null
  title?: string | null
}

export type DispatchResult = {
  mission_id: string
  wave_id: string
  task_id: string
  tool_id: string
  capability: string
  selected_tool: string
  decision_honored: boolean
  authority: AuthorityGateClass
  started_at: string
  completed_at: string
  duration_ms: number
  status: ExecutionTaskState
  ok: boolean
  work_product_ref: string | null
  work_product: DispatchWorkProduct | null
  failure_ref: string | null
  failure: string | null
  failure_class: FailureClass
  retry_number: number
  context_tokens: number
  context_owner: string
  evidence_refs: string[]
  produces_evidence: boolean
  receipt_id: string
  proof_level: ProofLevel
  receipt: EngineReceipt
}

export type ToolHandler = (input: {
  mission_id: string
  task_id: string
  tool_id: string
  objective: string
  context: CompiledContext
  proof_level: ProofLevel
}) => Promise<{
  ok: boolean
  summary: string
  claims?: string[]
  failure?: string | null
  produces_evidence?: boolean
  kind?: DispatchWorkProduct['kind']
  url?: string | null
  title?: string | null
}>

export type ToolHandlerMap = Record<string, ToolHandler>
