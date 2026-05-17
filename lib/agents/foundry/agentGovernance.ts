import type { AgentLifecycleState, FoundryAgent } from './agentBlueprints'
import { capabilityExpansionRequiresApproval } from './agentCapabilityRegistry'
import { doctrineAllowsActivation } from './agentDoctrineInheritance'

export type AgentGovernanceDecision = {
  allowed: boolean
  requiresApproval: boolean
  decision: 'allowed' | 'blocked' | 'approval_required'
  reasons: string[]
}

export function evaluateAgentActivation(agent: FoundryAgent): AgentGovernanceDecision {
  const doctrine = doctrineAllowsActivation(agent)
  const approved = agent.state === 'approved' || agent.approvalHistory.some(item => item.decision === 'approved')
  const reasons = [
    doctrine.reason,
    approved ? 'Commander approval exists.' : 'Commander approval is required before activation.',
    'External execution remains disabled.',
  ]

  if (!doctrine.ok) return { allowed: false, requiresApproval: true, decision: 'blocked', reasons }
  if (!approved) return { allowed: false, requiresApproval: true, decision: 'approval_required', reasons }
  return { allowed: true, requiresApproval: false, decision: 'allowed', reasons }
}

export function evaluateCapabilityExpansion(agent: FoundryAgent, requestedCapabilityIds: string[]): AgentGovernanceDecision {
  const currentIds = agent.capabilityLimits.map(item => item.id)
  const expansion = capabilityExpansionRequiresApproval(currentIds, requestedCapabilityIds)
  const reasons = [
    expansion.requestedExpansion.length
      ? `Requested expansion: ${expansion.requestedExpansion.join(', ')}.`
      : 'No new capability requested.',
    expansion.forbiddenRequests.length
      ? `Forbidden capability request: ${expansion.forbiddenRequests.join(', ')}.`
      : 'No forbidden capability requested.',
    'Capability expansion cannot be self-approved.',
  ]

  if (expansion.forbiddenRequests.length) {
    return { allowed: false, requiresApproval: true, decision: 'blocked', reasons }
  }
  if (expansion.commanderApprovalRequired) {
    return { allowed: false, requiresApproval: true, decision: 'approval_required', reasons }
  }
  return { allowed: true, requiresApproval: false, decision: 'allowed', reasons }
}

export function evaluateStateTransition(agent: FoundryAgent, nextState: AgentLifecycleState): AgentGovernanceDecision {
  if (nextState === 'active') return evaluateAgentActivation(agent)
  if (agent.state === 'retired' && nextState !== 'retired') {
    return { allowed: false, requiresApproval: true, decision: 'blocked', reasons: ['Retired agents cannot be reactivated without a new proposal.'] }
  }
  if (nextState === 'approved' || nextState === 'retired') {
    return { allowed: false, requiresApproval: true, decision: 'approval_required', reasons: [`${nextState} requires Commander approval.`] }
  }
  return { allowed: true, requiresApproval: false, decision: 'allowed', reasons: ['Transition is internal and auditable.'] }
}

export function getGovernanceRules() {
  return [
    'Approval before activation.',
    'Approval before capability expansion.',
    'Doctrine inheritance enforcement.',
    'Risk monitoring and degradation handling.',
    'Contradiction escalation before promotion.',
    'No autonomous self-expansion.',
    'No autonomous external execution.',
  ]
}
