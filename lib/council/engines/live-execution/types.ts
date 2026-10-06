import type { EngineReceipt } from '../types'
import type { DispatchResult } from '../dispatch/types'
import type { ExecutionGovernorState, ExecutionTaskState, ProofLevel } from '../execution-governor/types'
import type { HierarchicalPlan } from '../hierarchical-planning/types'
import type { ToolSelectionDecision } from '../tool-selection/types'
import type { FailureDiagnosis } from '../failure-diagnosis/types'
import type { WaveResult } from '../parallel-wave/engine'
import type { ToolHandlerMap } from '../dispatch/types'
import type { ToolHealth } from '../tool-selection/types'
import type { MissionEvidenceBoard, EbcEvidence } from '@/lib/council/evidence-board/types'

export type ExecutionWave = {
  wave_id: string
  mission_id: string
  task_ids: string[]
  tool_actions: string[]
  dependencies: string[][]
  parallel_groups: string[][]
  authority_requirements: string[]
  start_conditions: string[]
  stop_conditions: string[]
  budget: ExecutionGovernorState['budget']
  status: ExecutionTaskState
}

export type TaskRunRecord = {
  task_id: string
  state: ExecutionTaskState
  selected_tool: string | null
  decision: ToolSelectionDecision['decision'] | null
  dispatch: DispatchResult | null
  skipped_reason: string | null
}

export type LiveExecutionResult = {
  mission_id: string
  proof_level: ProofLevel
  waves: WaveResult[]
  wave_models: ExecutionWave[]
  tasks: TaskRunRecord[]
  dispatches: DispatchResult[]
  avoided_tool_calls: number
  cancelled_tasks: string[]
  replans: number
  diagnoses: FailureDiagnosis[]
  overlap_ms: number
  parallelism: 'PARALLEL' | 'SERIAL'
  completion: 'COMPLETE' | 'PARTIAL' | 'BLOCKED' | 'WAITING_AUTHORITY' | 'FAILED'
  ebc_evidence_ids: string[]
  receipt_ids: string[]
  governor: ExecutionGovernorState
  plan: HierarchicalPlan
  grants_authority: false
  ebc_canonical: true
  receipts: EngineReceipt[]
}

export type LiveExecutionInput = {
  mission_id: string
  objective: string
  atlas_plan?: Parameters<typeof import('../hierarchical-planning/engine').buildHierarchicalPlan>[0]['atlas_plan']
  ebc_satisfied?: boolean
  remaining_evidence_gap?: readonly string[]
  available_tools?: readonly string[]
  tool_health?: Readonly<Record<string, ToolHealth>>
  handlers?: ToolHandlerMap
  board?: MissionEvidenceBoard | null
  proof_level?: ProofLevel
  budget?: Partial<ExecutionGovernorState['budget']>
  optional_task_ids?: readonly string[]
  stop_when_complete?: boolean
  force_attempts?: Record<string, { failure_class: 'TRANSIENT' | 'DETERMINISTIC'; error: string; times: number }>
  skip_task_ids?: readonly string[]
  completed_dispatch_ids?: readonly string[]
  current_verified_memory?: boolean
  stale_freshness_gap?: boolean
  memory_facts?: import('../context-compiler/types').CompiledFact[]
  approved_fingerprints?: readonly string[]
  launch_new_waves?: boolean
  spent?: Partial<{ tool_calls: number; retry_count: number; latency_ms: number; local_model_calls: number; external_calls: number }>
}

export type BoundEvidence = {
  evidence: EbcEvidence
  from_receipt: false
}
