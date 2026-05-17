import type { ActivationAgentCandidate, ActivationTableSummary } from './agentActivationWorkflow'
import type { ActivationGovernanceValidation } from './activationGovernanceValidator'
import type { ActivationMemoryBinding } from './activationMemoryBinder'
import type { ActivationQueueAssignment } from './activationQueuePlanner'

export type ActivationReadinessState = {
  agentId: string
  score: number
  state: 'ready_for_commander_review' | 'blocked' | 'degraded_prerequisites' | 'awaiting_persistence'
  blockers: string[]
  warnings: string[]
  missingDependencies: string[]
  degradedPrerequisites: string[]
  staleDoctrine: boolean
  queuePressure: 'normal' | 'watch' | 'high'
  unresolvedGovernanceIssues: string[]
  canRequestCommanderApproval: boolean
  canPrepareWorkerLaunch: boolean
}

function tableReady(tables: ActivationTableSummary[], tableName: string) {
  const table = tables.find(row => row.table === tableName)
  return table?.status === 'live_persistent' || table?.status === 'awaiting_data'
}

export function evaluateActivationReadiness(
  candidate: ActivationAgentCandidate,
  governance: ActivationGovernanceValidation,
  memoryBinding: ActivationMemoryBinding,
  queueAssignment: ActivationQueueAssignment,
  tables: ActivationTableSummary[],
): ActivationReadinessState {
  const missingDependencies = [
    !tableReady(tables, 'war_room_agent_activation_queue') ? 'Activation queue table unavailable.' : null,
    !tableReady(tables, 'war_room_agent_memory_bindings') ? 'Memory binding table unavailable.' : null,
    !tableReady(tables, 'war_room_agent_queue_assignments') ? 'Queue assignment table unavailable.' : null,
    !tableReady(tables, 'war_room_agent_readiness') ? 'Readiness table unavailable.' : null,
    !memoryBinding.valid ? 'Approved memory binding missing.' : null,
  ].filter((item): item is string => Boolean(item))
  const degradedPrerequisites = [
    queueAssignment.concurrencyLimit <= 1 && candidate.riskLevel !== 'low' ? 'Concurrency narrowed because of elevated risk.' : null,
    governance.warnings.length ? 'Governance review warnings are unresolved.' : null,
  ].filter((item): item is string => Boolean(item))
  const staleDoctrine = !candidate.doctrine.includes('runtime-truth') && !candidate.doctrine.includes('source-backed-confidence')
  const unresolvedGovernanceIssues = [...governance.blockers]
  const blockers = [
    ...missingDependencies,
    ...governance.blockers,
    staleDoctrine ? 'Runtime truth or source-backed confidence doctrine is required.' : null,
  ].filter((item): item is string => Boolean(item))
  const queuePressure = queueAssignment.degradationThresholds.queueDepth <= 3 ? 'watch' : 'normal'
  const penalty = blockers.length * 25 + degradedPrerequisites.length * 8 + governance.warnings.length * 5 + (staleDoctrine ? 15 : 0)
  const score = Math.max(0, Math.min(100, 100 - penalty))
  const state = blockers.length
    ? 'blocked'
    : missingDependencies.length
      ? 'awaiting_persistence'
      : degradedPrerequisites.length
        ? 'degraded_prerequisites'
        : 'ready_for_commander_review'

  return {
    agentId: candidate.agentId,
    score,
    state,
    blockers,
    warnings: [
      ...governance.warnings,
      queuePressure !== 'normal' ? 'Queue pressure should be watched before activation.' : null,
    ].filter((item): item is string => Boolean(item)),
    missingDependencies,
    degradedPrerequisites,
    staleDoctrine,
    queuePressure,
    unresolvedGovernanceIssues,
    canRequestCommanderApproval: blockers.length === 0,
    canPrepareWorkerLaunch: blockers.length === 0 && score >= 75,
  }
}
