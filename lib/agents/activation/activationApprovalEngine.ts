import type { ActivationAgentCandidate, ActivationQueueRow } from './agentActivationWorkflow'
import type { ActivationReadinessState } from './activationReadinessEvaluator'

export type ActivationApprovalDecision = {
  agentId: string
  decision: 'awaiting_commander_approval' | 'approved_for_activation' | 'denied' | 'blocked'
  approvalState: 'pending' | 'approved' | 'denied' | 'blocked'
  requiredApprovers: ['commander']
  permissionChecks: string[]
  reasons: string[]
  canTransitionActive: boolean
  commanderApprovalRequired: true
  externalExecutionAllowed: false
}

export function evaluateActivationApproval(
  candidate: ActivationAgentCandidate,
  readiness: ActivationReadinessState,
  queueRows: ActivationQueueRow[],
): ActivationApprovalDecision {
  const persisted = queueRows.find(row => row.agent_key === candidate.blueprintId || row.agent_key === candidate.agentId)
  const persistedApproval = persisted?.approval_state
  const approvalState = readiness.blockers.length
    ? 'blocked'
    : persistedApproval === 'approved' || persistedApproval === 'denied'
      ? persistedApproval
      : 'pending'
  const decision = approvalState === 'approved'
    ? 'approved_for_activation'
    : approvalState === 'denied'
      ? 'denied'
      : approvalState === 'blocked'
        ? 'blocked'
        : 'awaiting_commander_approval'

  return {
    agentId: candidate.agentId,
    decision,
    approvalState,
    requiredApprovers: ['commander'],
    permissionChecks: [
      'Commander approval is required before active state.',
      'Service-role persistence may record approval; public APIs remain read-only.',
      'Worker preparation does not grant external execution.',
    ],
    reasons: [
      ...readiness.blockers,
      decision === 'awaiting_commander_approval' ? 'Readiness can be reviewed, but Commander approval is not persisted.' : null,
      decision === 'approved_for_activation' ? 'Persisted activation approval exists.' : null,
      decision === 'denied' ? 'Persisted activation denial exists.' : null,
    ].filter((item): item is string => Boolean(item)),
    canTransitionActive: decision === 'approved_for_activation' && readiness.canPrepareWorkerLaunch,
    commanderApprovalRequired: true,
    externalExecutionAllowed: false,
  }
}
