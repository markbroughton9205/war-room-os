import type { AgentActivityEvent, AgentApprovalRecord, AgentBlueprint, AgentLifecycleState, FoundryAgent } from './agentBlueprints'
import { resolveCapabilitiesForBlueprint } from './agentCapabilityRegistry'
import { evaluateStateTransition } from './agentGovernance'

function event(kind: AgentActivityEvent['kind'], summary: string): AgentActivityEvent {
  return { at: new Date().toISOString(), kind, summary }
}

export function createProposedAgentFromBlueprint(blueprint: AgentBlueprint): FoundryAgent {
  const now = new Date().toISOString()
  return {
    id: `agent-${blueprint.id}`,
    blueprintId: blueprint.id,
    name: blueprint.name,
    purpose: blueprint.purpose,
    state: blueprint.defaultState,
    operationalRole: blueprint.operationalRole,
    assignedDoctrine: blueprint.assignedDoctrine,
    memoryScope: blueprint.memoryScope,
    capabilityLimits: resolveCapabilitiesForBlueprint(blueprint),
    performanceHistory: [],
    approvalHistory: [],
    riskProfile: blueprint.riskProfile,
    activityHistory: [event('proposal', `${blueprint.name} proposed from Phase 10 blueprint.`)],
    createdAt: now,
    updatedAt: now,
  }
}

export function approveAgent(agent: FoundryAgent, approvedBy: string, note = 'Commander approved agent proposal.'): FoundryAgent {
  const approval: AgentApprovalRecord = {
    at: new Date().toISOString(),
    by: approvedBy,
    decision: 'approved',
    note,
  }
  return {
    ...agent,
    state: 'approved',
    approvalHistory: [...agent.approvalHistory, approval],
    activityHistory: [...agent.activityHistory, event('approval', note)],
    updatedAt: approval.at,
  }
}

export function transitionAgentState(agent: FoundryAgent, nextState: AgentLifecycleState, reason: string): FoundryAgent {
  const decision = evaluateStateTransition(agent, nextState)
  if (!decision.allowed) {
    return {
      ...agent,
      activityHistory: [...agent.activityHistory, event('coordination', `Transition to ${nextState} held: ${decision.reasons.join(' ')}`)],
      updatedAt: new Date().toISOString(),
    }
  }
  const kind = nextState === 'active'
    ? 'activation'
    : nextState === 'paused'
      ? 'pause'
      : nextState === 'degraded'
        ? 'degradation'
        : nextState === 'retired'
          ? 'retirement'
          : 'coordination'
  return {
    ...agent,
    state: nextState,
    activityHistory: [...agent.activityHistory, event(kind, reason)],
    updatedAt: new Date().toISOString(),
  }
}

export function getLifecycleBehavior() {
  return {
    states: ['proposed', 'approved', 'active', 'paused', 'degraded', 'retired'] satisfies AgentLifecycleState[],
    activationRule: 'Only approved, doctrine-complete agents can become active.',
    degradationRule: 'Agents degrade when performance or health warnings cross thresholds; degraded agents remain non-executing.',
    retirementRule: 'Retirement is auditable and should be used for duplicate, stale, unsafe, or consistently low-value workers.',
  }
}
