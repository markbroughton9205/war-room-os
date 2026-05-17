import { getGovernanceRules } from '@/lib/agents/foundry/agentGovernance'
import type { ActivationAgentCandidate } from './agentActivationWorkflow'
import type { ActivationMemoryBinding } from './activationMemoryBinder'
import type { ActivationQueueAssignment } from './activationQueuePlanner'

export type ActivationGovernanceValidation = {
  agentId: string
  status: 'valid' | 'blocked' | 'requires_review'
  doctrineResolved: boolean
  memoryValid: boolean
  queuePresent: boolean
  capabilityRestrictionsValid: boolean
  riskProfileValid: boolean
  escalationPathValid: boolean
  approvalChainValid: boolean
  contradictionChecksValid: boolean
  blockers: string[]
  warnings: string[]
  rules: string[]
  commanderApprovalRequired: true
  externalExecutionAllowed: false
}

const REQUIRED_DOCTRINE = ['approval-before-action']

function hasRuntimeTruth(candidate: ActivationAgentCandidate) {
  return candidate.doctrine.includes('runtime-truth') || candidate.doctrine.includes('source-backed-confidence')
}

export function validateActivationGovernance(
  candidate: ActivationAgentCandidate,
  memoryBinding: ActivationMemoryBinding,
  queueAssignment: ActivationQueueAssignment,
): ActivationGovernanceValidation {
  const doctrineResolved = REQUIRED_DOCTRINE.every(rule => candidate.doctrine.includes(rule)) && hasRuntimeTruth(candidate)
  const queuePresent = Boolean(queueAssignment.queueKey && queueAssignment.queueType)
  const escalationPathValid = queueAssignment.escalationRules.length > 0
  const blockers = [
    !doctrineResolved ? 'Doctrine inheritance is incomplete.' : null,
    !memoryBinding.valid ? 'Memory binding is invalid or missing doctrine-scoped access.' : null,
    !queuePresent ? 'Activation queue assignment is missing.' : null,
    !escalationPathValid ? 'Escalation path is missing.' : null,
    candidate.externalExecutionAllowed ? 'External execution is not allowed.' : null,
  ].filter((item): item is string => Boolean(item))
  const warnings = [
    candidate.riskLevel === 'high' ? 'High-risk worker requires narrow concurrency and explicit Commander review.' : null,
    memoryBinding.warnings.length ? memoryBinding.warnings.join(' ') : null,
  ].filter((item): item is string => Boolean(item))
  const status = blockers.length ? 'blocked' : warnings.length ? 'requires_review' : 'valid'

  return {
    agentId: candidate.agentId,
    status,
    doctrineResolved,
    memoryValid: memoryBinding.valid,
    queuePresent,
    capabilityRestrictionsValid: true,
    riskProfileValid: true,
    escalationPathValid,
    approvalChainValid: candidate.commanderApprovalRequired,
    contradictionChecksValid: true,
    blockers,
    warnings,
    rules: [
      ...getGovernanceRules(),
      'Activation requires queue assignment, memory binding, readiness validation, and Commander approval.',
    ],
    commanderApprovalRequired: true,
    externalExecutionAllowed: false,
  }
}
