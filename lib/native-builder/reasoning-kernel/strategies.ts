/**
 * Strategy shapes. They add typed graph structure and do not execute plans.
 */
import type {
  FoundryArchitectureOption,
  FoundryCandidatePlan,
  FoundryReasoningGraph,
  FoundryReasoningStrategy,
  FoundryRootCauseRecord,
} from './types'
import { FRK_COUNTEREXAMPLE_CASES } from './types'
import { addGraphEdge, addGraphNode, edgeShell, nodeShell } from './graph'
import { clipText } from './text'

export function directPath(graph: FoundryReasoningGraph, ids: () => string, goal: string): void {
  const understand = nodeShell(ids(), 'PROBLEM', `understand: ${goal}`, 'KNOWN')
  const solve = nodeShell(ids(), 'PLAN', 'solve with one localized change', 'POSSIBLE')
  const verify = nodeShell(ids(), 'VERIFICATION', 'verify once', 'UNKNOWN')
  addGraphNode(graph, understand)
  addGraphNode(graph, solve)
  addGraphNode(graph, verify)
  addGraphEdge(graph, edgeShell(ids(), understand.nodeId, solve.nodeId, 'REFINES'))
  addGraphEdge(graph, edgeShell(ids(), verify.nodeId, solve.nodeId, 'TESTS'))
}

export function decomposeProblem(
  graph: FoundryReasoningGraph,
  ids: () => string,
  parentAcceptance: string[],
  subgoals: string[],
): string[] {
  const parent = nodeShell(ids(), 'PROBLEM', `parent acceptance: ${parentAcceptance.join('; ')}`, 'KNOWN')
  addGraphNode(graph, parent)
  const childIds: string[] = []
  let previous = parent.nodeId
  for (const subgoal of subgoals) {
    const child = nodeShell(ids(), 'SUBPROBLEM', `${subgoal}. Acceptance remains: ${parentAcceptance.join('; ')}`, 'POSSIBLE')
    addGraphNode(graph, child)
    addGraphEdge(graph, edgeShell(ids(), child.nodeId, previous, 'DEPENDS_ON'))
    previous = child.nodeId
    childIds.push(child.nodeId)
  }
  return childIds
}

export function rootCauseRecord(input: {
  symptom: string
  candidateCauses: string[]
  evidenceIds: string[]
  rootCause?: string
  repairImplication?: string
}): { ok: true; record: FoundryRootCauseRecord } | { ok: false; reason: string } {
  if (!input.symptom || !input.candidateCauses.length) {
    return { ok: false, reason: 'Root cause requires a symptom and candidate causes.' }
  }
  if ((input.rootCause || input.repairImplication) && !input.evidenceIds.length) {
    return { ok: false, reason: 'A named root cause requires evidence.' }
  }
  return {
    ok: true,
    record: {
      symptom: clipText(input.symptom),
      candidateCauses: input.candidateCauses.map(clipText),
      evidenceIds: input.evidenceIds,
      rootCause: input.rootCause ? clipText(input.rootCause) : null,
      repairImplication: input.repairImplication ? clipText(input.repairImplication) : null,
    },
  }
}

export function compareArchitectures(options: FoundryArchitectureOption[]): {
  selectedId: string | null
  reason: string
} {
  const covering = options.filter(item => item.coversAcceptance)
  if (covering.length === 1) {
    return { selectedId: covering[0].optionId, reason: 'Only one option covers the acceptance conditions.' }
  }
  if (!covering.length) return { selectedId: null, reason: 'No option covers the acceptance conditions.' }
  return { selectedId: null, reason: 'Several options cover acceptance. No subjective score was assigned.' }
}

export function counterexampleQuestions(): string[] {
  return FRK_COUNTEREXAMPLE_CASES.map(item => `Where does the solution fail for ${item}?`)
}

export function chooseCandidatePlan(plans: FoundryCandidatePlan[]): FoundryCandidatePlan | null {
  const covering = plans.filter(item => item.coversAcceptance)
  if (covering.length !== 1) return null
  for (const plan of plans) {
    plan.selected = plan.planId === covering[0].planId
    plan.executed = false
  }
  return covering[0]
}

export function strategyCeremony(strategy: FoundryReasoningStrategy): 'minimal' | 'deliberate' {
  return strategy === 'DIRECT' ? 'minimal' : 'deliberate'
}
