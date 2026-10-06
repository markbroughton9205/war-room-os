import { selectTool } from '../tool-selection/engine'
import { buildHierarchicalPlan } from '../hierarchical-planning/engine'
import { compileContext } from '../context-compiler/engine'
import { diagnoseFailure } from '../failure-diagnosis/engine'
import { ENGINE_02_VERSION } from '../types'
import type { ToolSelectionDecision } from '../tool-selection/types'
import type { HierarchicalPlan, ParallelMeasurement } from '../hierarchical-planning/types'
import type { CompiledContext } from '../context-compiler/types'
import type { FailureDiagnosis } from '../failure-diagnosis/types'
import type { EngineReceipt } from '../types'
import type { StopConditionState } from '../types'

export type CouncilEngine02Public = {
  schema: typeof ENGINE_02_VERSION
  ebc_canonical: true
  grants_authority: false
  atlas_role: 'ATLAS'
  tool_selection?: Pick<ToolSelectionDecision, 'decision' | 'selected_tool' | 'reason' | 'avoid' | 'expected_information_gain'>
  plan?: Pick<HierarchicalPlan, 'mission_id' | 'parallel_groups' | 'stopped_for_completion' | 'change_reason' | 'grants_authority'>
  plan_tree?: Array<{ id: string; parent_id: string | null; kind: string; status: string; authority_requirement: string }>
  parallelism?: ParallelMeasurement
  context_meta?: Array<{ role: string; tokens_used: number; token_budget: number; excluded: number }>
  diagnosis?: Pick<FailureDiagnosis, 'category' | 'confidence_state' | 'next_discriminating_check' | 'persist_as_proven'> | null
  receipts: EngineReceipt[]
}

export function attachCouncilEngine02Public(input: {
  mission_id: string
  objective: string
  available_tools?: readonly string[]
  remaining_evidence_gap?: readonly string[]
  ebc_satisfied?: boolean
  stop_condition_state?: StopConditionState
  tool_health?: Record<string, 'READY' | 'DEGRADED' | 'DEAD' | 'UNAUTHENTICATED' | 'RATE_LIMITED' | 'MISCONFIGURED' | 'UNKNOWN'>
  atlas_plan?: Parameters<typeof buildHierarchicalPlan>[0]['atlas_plan']
  failed_task_id?: string | null
  tasks?: Parameters<typeof buildHierarchicalPlan>[0]['tasks']
  roles?: Array<'PULSAR' | 'ORION' | 'LUMEN' | 'PHOENIX' | 'AURORA'>
  verified_facts?: Parameters<typeof compileContext>[0]['verified_facts']
  symptom?: string | null
}): CouncilEngine02Public {
  const tools = selectTool({
    mission_id: input.mission_id,
    objective: input.objective,
    available_tools: input.available_tools ?? ['research.web', 'browser.fetch', 'system.health'],
    remaining_evidence_gap: input.remaining_evidence_gap,
    ebc_satisfied: input.ebc_satisfied,
    stop_condition_state: input.stop_condition_state,
    tool_health: input.tool_health,
  })
  const plan = buildHierarchicalPlan({
    mission_id: input.mission_id,
    objective: input.objective,
    atlas_plan: input.atlas_plan,
    ebc_satisfied: input.ebc_satisfied,
    failed_task_id: input.failed_task_id,
    tasks: input.tasks,
  })
  const roles = input.roles ?? ['PULSAR', 'LUMEN', 'PHOENIX', 'AURORA']
  const contexts: CompiledContext[] = roles.map(role => compileContext({
    mission_id: input.mission_id,
    role,
    objective: input.objective,
    task_objective: `${role} work`,
    token_budget: 256,
    verified_facts: input.verified_facts,
  }))
  const diagnosis = input.symptom
    ? diagnoseFailure({ mission_id: input.mission_id, symptom: input.symptom })
    : null
  return {
    schema: ENGINE_02_VERSION,
    ebc_canonical: true,
    grants_authority: false,
    atlas_role: 'ATLAS',
    tool_selection: {
      decision: tools.decision,
      selected_tool: tools.selected_tool,
      reason: tools.reason,
      avoid: tools.avoid,
      expected_information_gain: tools.expected_information_gain,
    },
    plan: {
      mission_id: plan.plan.mission_id,
      parallel_groups: plan.plan.parallel_groups,
      stopped_for_completion: plan.plan.stopped_for_completion,
      change_reason: plan.plan.change_reason,
      grants_authority: false,
    },
    plan_tree: plan.plan.nodes.map(node => ({
      id: node.id,
      parent_id: node.parent_id,
      kind: node.kind,
      status: node.status,
      authority_requirement: node.authority_requirement,
    })),
    parallelism: plan.parallelism,
    context_meta: contexts.map(row => ({
      role: row.role,
      tokens_used: row.tokens_used,
      token_budget: row.token_budget,
      excluded: row.excluded_context.length,
    })),
    diagnosis: diagnosis
      ? {
        category: diagnosis.diagnosis.category,
        confidence_state: diagnosis.diagnosis.confidence_state,
        next_discriminating_check: diagnosis.diagnosis.next_discriminating_check,
        persist_as_proven: diagnosis.diagnosis.persist_as_proven,
      }
      : null,
    receipts: [tools.receipt, plan.receipt, ...contexts.map(row => row.compiler_receipt), ...(diagnosis ? [diagnosis.receipt] : [])],
  }
}
