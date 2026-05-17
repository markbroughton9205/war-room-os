import { OUTCOME_LEDGER_ENTRIES } from './outcomeLedger'

export type WorkflowStage = 'retrieve' | 'analyze' | 'challenge' | 'approve' | 'execute' | 'verify' | 'learn'

export type WorkflowOutcome = {
  id: string
  name: string
  stages: WorkflowStage[]
  linkedOutcomeIds: string[]
  successRate: number
  averageDurationMinutes: number
  bottlenecks: string[]
  recommendedNextCheck: string
  permissionBoundary: string
}

export const WORKFLOW_OUTCOMES: WorkflowOutcome[] = [
  {
    id: 'workflow-intel-before-synthesis',
    name: 'Retrieval before synthesis',
    stages: ['retrieve', 'analyze', 'challenge', 'learn'],
    linkedOutcomeIds: ['outcome-runtime-truth-001', 'outcome-intel-retrieval-003'],
    successRate: 0.88,
    averageDurationMinutes: 180,
    bottlenecks: ['Slow source refresh', 'Contradiction cluster review'],
    recommendedNextCheck: 'Confirm source freshness and overlap before ranking analyst conclusions.',
    permissionBoundary: 'Read, classify, and recommend only; no external outreach without approval.',
  },
  {
    id: 'workflow-repair-checkpoint',
    name: 'Checkpointed repair review',
    stages: ['analyze', 'challenge', 'approve', 'execute', 'verify', 'learn'],
    linkedOutcomeIds: ['outcome-repair-ledger-002'],
    successRate: 0.81,
    averageDurationMinutes: 150,
    bottlenecks: ['Build validation time', 'Human approval wait'],
    recommendedNextCheck: 'Keep rollback checkpoints visible before repair execution.',
    permissionBoundary: 'Mutation requires Commander approval and a recorded rollback plan.',
  },
]

export function getWorkflowOutcomes(): WorkflowOutcome[] {
  return WORKFLOW_OUTCOMES.map(workflow => {
    const linked = OUTCOME_LEDGER_ENTRIES.filter(entry => workflow.linkedOutcomeIds.includes(entry.id))
    const averageDurationMinutes = linked.length
      ? Math.round(linked.reduce((sum, entry) => sum + entry.timeline.durationMinutes, 0) / linked.length)
      : workflow.averageDurationMinutes

    return { ...workflow, averageDurationMinutes }
  })
}

export function getWorkflowLearningSummary() {
  const workflows = getWorkflowOutcomes()
  return {
    workflowCount: workflows.length,
    bestWorkflow: [...workflows].sort((a, b) => b.successRate - a.successRate)[0],
    bottleneckCount: workflows.reduce((sum, workflow) => sum + workflow.bottlenecks.length, 0),
  }
}
