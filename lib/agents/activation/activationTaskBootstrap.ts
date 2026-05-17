import type { ActivationAgentCandidate } from './agentActivationWorkflow'
import type { ActivationGovernanceValidation } from './activationGovernanceValidator'
import type { ActivationMemoryBinding } from './activationMemoryBinder'
import type { ActivationQueueAssignment } from './activationQueuePlanner'

export type ActivationTaskBootstrapPacket = {
  agentId: string
  packetId: string
  routingScope: string[]
  queueKey: string
  memoryDomains: string[]
  doctrineRefs: string[]
  analystCollaboration: string[]
  redTeamHooks: string[]
  orchestrationParticipation: string[]
  governanceStatus: ActivationGovernanceValidation['status']
  externalExecutionAllowed: false
  writesAllowed: false
}

export function prepareActivationTaskBootstrap(
  candidate: ActivationAgentCandidate,
  queueAssignment: ActivationQueueAssignment,
  memoryBinding: ActivationMemoryBinding,
  governance: ActivationGovernanceValidation,
): ActivationTaskBootstrapPacket {
  return {
    agentId: candidate.agentId,
    packetId: `bootstrap-${candidate.blueprintId}`,
    routingScope: queueAssignment.taskScope,
    queueKey: queueAssignment.queueKey,
    memoryDomains: memoryBinding.domains.map(domain => domain.id),
    doctrineRefs: candidate.doctrine,
    analystCollaboration: [
      'Share findings through analyst review queues.',
      'Attach evidence and confidence to all recommendations.',
    ],
    redTeamHooks: [
      'Route contradiction-sensitive output through Red Team review.',
      'Block promotion when governance status is blocked.',
    ],
    orchestrationParticipation: [
      'Accept only scoped internal task packets.',
      'Return auditable summaries to War Room orchestration.',
    ],
    governanceStatus: governance.status,
    externalExecutionAllowed: false,
    writesAllowed: false,
  }
}
