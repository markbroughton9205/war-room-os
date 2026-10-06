import type { EngineReceipt } from '../types'

export type PlanNodeKind = 'MISSION' | 'PHASE' | 'TASK' | 'SUBTASK' | 'TOOL_ACTION'
export type PlanNodeStatus = 'PLANNED' | 'READY' | 'RUNNING' | 'COMPLETE' | 'FAILED' | 'SUPERSEDED' | 'WAITING_AUTHORITY' | 'STOPPED'
export type PlanEdgeKind = 'requires' | 'blocks' | 'can_parallelize_with' | 'produces' | 'consumes'

export type PlanNode = {
  id: string
  parent_id: string | null
  kind: PlanNodeKind
  objective: string
  dependencies: string[]
  evidence_requirement: string[]
  assigned_role: string
  candidate_tools: string[]
  budget: { tokens?: number; ms?: number }
  completion_condition: string
  failure_policy: string
  authority_requirement: 'NONE' | 'COMMANDER'
  parallelizable: boolean
  status: PlanNodeStatus
}

export type HierarchicalPlan = {
  mission_id: string
  nodes: PlanNode[]
  edges: Array<{ from: string; to: string; kind: PlanEdgeKind }>
  parallel_groups: string[][]
  atlas_role: 'ATLAS'
  grants_authority: false
  equivalent_to_previous: boolean
  stopped_for_completion: boolean
  change_reason: string | null
}

export type ParallelMeasurement = {
  claimed_parallel: boolean
  overlap_ms: number
  max_local_model: 1
  serial_mislabel: boolean
}

export type HierarchicalPlanInput = {
  mission_id: string
  objective: string
  mission_class?: string
  atlas_plan?: {
    steps: Array<{
      step_id: string
      title: string
      purpose: string
      depends_on: string[]
      required_capabilities: string[]
      required_evidence: string[]
      expected_output: string
      approval_required: boolean
      status: string
      parallel_group?: string | null
    }>
    parallelizable_groups?: string[][]
  } | null
  ebc_satisfied?: boolean
  failed_task_id?: string | null
  previous_plan_hash?: string | null
  tasks?: Array<{ task_id: string; started_at: string | null; completed_at: string | null; tools_required?: string[]; status?: string; depends_on?: string[] }>
}

export type HierarchicalPlanResult = {
  plan: HierarchicalPlan
  plan_hash: string
  parallelism: ParallelMeasurement
  receipt: EngineReceipt
}
