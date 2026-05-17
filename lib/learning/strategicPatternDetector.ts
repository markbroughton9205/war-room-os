import { OUTCOME_LEDGER_ENTRIES } from './outcomeLedger'
import { getWorkflowOutcomes } from './workflowOutcomeTracker'

export type StrategicPattern = {
  id: string
  title: string
  frequency: number
  confidence: number
  supportingOutcomeIds: string[]
  interpretation: string
  recommendedDoctrineAction: 'promote' | 'watch' | 'retire'
}

export function detectStrategicPatterns(): StrategicPattern[] {
  const retrievalOutcomes = OUTCOME_LEDGER_ENTRIES.filter(entry => (
    entry.findings.some(finding => finding.toLowerCase().includes('source'))
  ))
  const approvalOutcomes = OUTCOME_LEDGER_ENTRIES.filter(entry => (
    entry.approvals.some(approval => approval.required)
  ))
  const workflows = getWorkflowOutcomes()

  return [
    {
      id: 'pattern-source-backed-confidence',
      title: 'Source-backed work improves confidence',
      frequency: retrievalOutcomes.length,
      confidence: 0.9,
      supportingOutcomeIds: retrievalOutcomes.map(entry => entry.id),
      interpretation: 'Accuracy and usefulness rise when retrieval and source overlap precede synthesis.',
      recommendedDoctrineAction: 'promote',
    },
    {
      id: 'pattern-approval-gate-safety',
      title: 'Approval gates preserve operational safety',
      frequency: approvalOutcomes.length,
      confidence: 0.96,
      supportingOutcomeIds: approvalOutcomes.map(entry => entry.id),
      interpretation: 'Commander approval converts proposed action into controlled execution and prevents silent external effects.',
      recommendedDoctrineAction: 'promote',
    },
    {
      id: 'pattern-validation-bottleneck',
      title: 'Validation is the recurring repair bottleneck',
      frequency: workflows.filter(workflow => workflow.bottlenecks.some(item => item.toLowerCase().includes('validation'))).length,
      confidence: 0.78,
      supportingOutcomeIds: ['outcome-repair-ledger-002'],
      interpretation: 'Repair loops should forecast validation cost before execution is approved.',
      recommendedDoctrineAction: 'watch',
    },
  ]
}
