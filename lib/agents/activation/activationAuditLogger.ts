import type { ActivationAgentCandidate } from './agentActivationWorkflow'
import type { ActivationApprovalDecision } from './activationApprovalEngine'
import type { ActivationGovernanceValidation } from './activationGovernanceValidator'
import type { ActivationMemoryBinding } from './activationMemoryBinder'
import type { ActivationQueueAssignment } from './activationQueuePlanner'
import type { ActivationReadinessState } from './activationReadinessEvaluator'

export type ActivationAuditEvent = {
  id: string
  agentId: string
  eventType:
    | 'activation_proposed'
    | 'governance_review'
    | 'memory_binding'
    | 'queue_assignment'
    | 'readiness_failure'
    | 'readiness_passed'
    | 'commander_approval'
    | 'activation_denial'
  severity: 'info' | 'watch' | 'warning' | 'critical'
  summary: string
  metadata: Record<string, unknown>
  externalExecutionAllowed: false
}

export function createActivationAuditTrail(
  candidates: ActivationAgentCandidate[],
  governance: ActivationGovernanceValidation[],
  memoryBindings: ActivationMemoryBinding[],
  queueAssignments: ActivationQueueAssignment[],
  readiness: ActivationReadinessState[],
  approvals: ActivationApprovalDecision[],
): ActivationAuditEvent[] {
  return candidates.flatMap((candidate, index) => {
    const readinessState = readiness[index]
    const approval = approvals[index]
    return [
      {
        id: `audit-${candidate.blueprintId}-proposed`,
        agentId: candidate.agentId,
        eventType: 'activation_proposed',
        severity: 'info',
        summary: `${candidate.name} activation workflow is proposed from Phase 10 blueprint.`,
        metadata: { stage: candidate.currentStage, requestedStage: candidate.requestedStage },
        externalExecutionAllowed: false,
      },
      {
        id: `audit-${candidate.blueprintId}-governance`,
        agentId: candidate.agentId,
        eventType: 'governance_review',
        severity: governance[index].blockers.length ? 'critical' : governance[index].warnings.length ? 'watch' : 'info',
        summary: `Governance validation is ${governance[index].status}.`,
        metadata: { blockers: governance[index].blockers, warnings: governance[index].warnings },
        externalExecutionAllowed: false,
      },
      {
        id: `audit-${candidate.blueprintId}-memory`,
        agentId: candidate.agentId,
        eventType: 'memory_binding',
        severity: memoryBindings[index].valid ? 'info' : 'critical',
        summary: memoryBindings[index].valid ? 'Scoped memory binding is valid.' : 'Scoped memory binding is invalid.',
        metadata: { domains: memoryBindings[index].domains.map(domain => domain.id) },
        externalExecutionAllowed: false,
      },
      {
        id: `audit-${candidate.blueprintId}-queue`,
        agentId: candidate.agentId,
        eventType: 'queue_assignment',
        severity: 'info',
        summary: `${queueAssignments[index].queueType} queue assignment prepared.`,
        metadata: { queueKey: queueAssignments[index].queueKey, concurrencyLimit: queueAssignments[index].concurrencyLimit },
        externalExecutionAllowed: false,
      },
      {
        id: `audit-${candidate.blueprintId}-readiness`,
        agentId: candidate.agentId,
        eventType: readinessState.blockers.length ? 'readiness_failure' : 'readiness_passed',
        severity: readinessState.blockers.length ? 'critical' : readinessState.warnings.length ? 'watch' : 'info',
        summary: `Activation readiness score is ${readinessState.score}.`,
        metadata: { state: readinessState.state, blockers: readinessState.blockers, warnings: readinessState.warnings },
        externalExecutionAllowed: false,
      },
      {
        id: `audit-${candidate.blueprintId}-approval`,
        agentId: candidate.agentId,
        eventType: approval.decision === 'denied' ? 'activation_denial' : 'commander_approval',
        severity: approval.canTransitionActive ? 'info' : 'watch',
        summary: `Approval decision is ${approval.decision}.`,
        metadata: { approvalState: approval.approvalState, canTransitionActive: approval.canTransitionActive },
        externalExecutionAllowed: false,
      },
    ]
  })
}
