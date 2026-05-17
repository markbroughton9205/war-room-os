import type { ActivationAgentCandidate } from './agentActivationWorkflow'
import type { ActivationApprovalDecision } from './activationApprovalEngine'
import type { ActivationQueueAssignment } from './activationQueuePlanner'
import type { ActivationReadinessState } from './activationReadinessEvaluator'

export type ActivationWorkerLaunchPreparation = {
  agentId: string
  workerKey: string
  launchState: 'prepared' | 'awaiting_approval' | 'blocked'
  queueKey: string
  readinessScore: number
  launchChecklist: string[]
  blockedBy: string[]
  externalExecutionAllowed: false
  executionStarted: false
}

export function prepareActivationWorkerLaunch(
  candidate: ActivationAgentCandidate,
  readiness: ActivationReadinessState,
  queueAssignment: ActivationQueueAssignment,
  approval: ActivationApprovalDecision,
): ActivationWorkerLaunchPreparation {
  const blockedBy = [
    ...readiness.blockers,
    approval.decision !== 'approved_for_activation' ? 'Commander activation approval is not persisted.' : null,
  ].filter((item): item is string => Boolean(item))
  const launchState = blockedBy.length
    ? readiness.canPrepareWorkerLaunch ? 'awaiting_approval' : 'blocked'
    : 'prepared'

  return {
    agentId: candidate.agentId,
    workerKey: `worker-${candidate.blueprintId}`,
    launchState,
    queueKey: queueAssignment.queueKey,
    readinessScore: readiness.score,
    launchChecklist: [
      'Verify doctrine inheritance.',
      'Verify memory binding.',
      'Register scoped queue assignment.',
      'Attach bootstrap task packet.',
      'Record lifecycle and activation audit events.',
      'Keep external execution disabled.',
    ],
    blockedBy,
    externalExecutionAllowed: false,
    executionStarted: false,
  }
}
