import { summarizeOutcomeLedger } from './outcomeLedger'
import { getProviderScorecards } from './providerPerformanceTracker'
import { getWorkflowLearningSummary } from './workflowOutcomeTracker'

export type OperationalLearningMetrics = {
  outcomeAccuracy: number
  outcomeUsefulness: number
  providerAverageScore: number
  workflowCount: number
  unresolvedRiskCount: number
  contradictionMisses: number
  approvalGateIntegrity: 'intact' | 'needs_review'
  strategicPerformanceIndex: number
}

export function getOperationalLearningMetrics(): OperationalLearningMetrics {
  const ledger = summarizeOutcomeLedger()
  const providers = getProviderScorecards()
  const workflows = getWorkflowLearningSummary()
  const providerAverageScore = providers.reduce((sum, provider) => sum + provider.overallScore, 0) / providers.length
  const riskPenalty = Math.min(0.2, ledger.unresolvedRiskCount * 0.02 + ledger.contradictionMisses * 0.03)
  const strategicPerformanceIndex = Math.max(
    0,
    Math.min(1, (ledger.averageAccuracy + ledger.averageUsefulness + providerAverageScore) / 3 - riskPenalty),
  )

  return {
    outcomeAccuracy: ledger.averageAccuracy,
    outcomeUsefulness: ledger.averageUsefulness,
    providerAverageScore,
    workflowCount: workflows.workflowCount,
    unresolvedRiskCount: ledger.unresolvedRiskCount,
    contradictionMisses: ledger.contradictionMisses,
    approvalGateIntegrity: ledger.approvalGateIntegrity,
    strategicPerformanceIndex,
  }
}
