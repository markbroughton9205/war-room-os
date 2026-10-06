import { compileContext } from '../context-compiler/engine'
import type { HierarchicalPlan } from '../hierarchical-planning/types'
import { mayExecutePlanNode } from '../hierarchical-planning/engine'
import type { ToolSelectionDecision } from '../tool-selection/types'

export function lumenCompileContext(input: Parameters<typeof compileContext>[0]) {
  return compileContext({ ...input, role: 'LUMEN' })
}

export function phoenixCompileContext(input: Parameters<typeof compileContext>[0]) {
  return compileContext({ ...input, role: 'PHOENIX' })
}

export function auroraCompileContext(input: Parameters<typeof compileContext>[0]) {
  return compileContext({ ...input, role: 'AURORA' })
}

export function janusConsumeHierarchicalPlan(plan: HierarchicalPlan): {
  invoked: true
  grants_authority: false
  scenario_nodes: Array<{ id: string; objective: string; authority_requirement: string }>
  execution_authority: false
} {
  return {
    invoked: true,
    grants_authority: false,
    scenario_nodes: plan.nodes.filter(node => node.kind === 'PHASE' || node.kind === 'TASK').map(node => ({
      id: node.id,
      objective: node.objective,
      authority_requirement: node.authority_requirement,
    })),
    execution_authority: false,
  }
}

export function sentinelInspectPlan(plan: HierarchicalPlan): {
  grants_authority: false
  authority_required_count: number
  waiting_authority: string[]
  auto_execute_blocked: boolean
} {
  const waiting = plan.nodes.filter(node => node.authority_requirement === 'COMMANDER' || node.status === 'WAITING_AUTHORITY')
  return {
    grants_authority: false,
    authority_required_count: waiting.length,
    waiting_authority: waiting.map(node => node.id),
    auto_execute_blocked: waiting.some(node => !mayExecutePlanNode(node, false)),
  }
}

export function auroraFacingFromEngines02(input: {
  evidence_state: string
  tool_selection?: Pick<ToolSelectionDecision, 'decision' | 'reason'> | null
}): { commander_facing: string[]; hides_engine_internals: true; commander_authority: 'REQUIRED_FOR_ACTION' } {
  void input.tool_selection
  return {
    commander_facing: [input.evidence_state].filter(Boolean),
    hides_engine_internals: true,
    commander_authority: 'REQUIRED_FOR_ACTION',
  }
}
