import type { AgentBlueprint, AgentCapabilityLimit } from './agentBlueprints'

export const AGENT_CAPABILITY_REGISTRY: AgentCapabilityLimit[] = [
  { id: 'read_scoped_memory', label: 'Read approved scoped memory domains', allowed: true, approvalRequiredForExpansion: true },
  { id: 'rank_sources', label: 'Rank sources and reliability signals', allowed: true, approvalRequiredForExpansion: true },
  { id: 'draft_briefings', label: 'Draft Commander-visible briefings', allowed: true, approvalRequiredForExpansion: true },
  { id: 'forecast_risk', label: 'Generate non-executing forecast risk assessments', allowed: true, approvalRequiredForExpansion: true },
  { id: 'prepare_escalations', label: 'Prepare dashboard-only escalation queue entries', allowed: true, approvalRequiredForExpansion: true },
  { id: 'diagnose_failures', label: 'Diagnose failures and validation risk', allowed: true, approvalRequiredForExpansion: true },
  { id: 'draft_repair_plans', label: 'Draft repair plans without applying patches', allowed: true, approvalRequiredForExpansion: true },
  { id: 'monitor_health', label: 'Monitor worker, provider, and runtime health', allowed: true, approvalRequiredForExpansion: true },
  { id: 'flag_contradictions', label: 'Flag contradictions for escalation', allowed: true, approvalRequiredForExpansion: true },
  { id: 'rank_opportunities', label: 'Rank opportunities without contacting or spending', allowed: true, approvalRequiredForExpansion: true },
  { id: 'route_internal_tasks', label: 'Route internal queue tasks for review', allowed: true, approvalRequiredForExpansion: true },
  { id: 'external_execution', label: 'Execute external actions autonomously', allowed: false, approvalRequiredForExpansion: true },
  { id: 'self_expansion', label: 'Expand own capability or memory scope', allowed: false, approvalRequiredForExpansion: true },
]

export function getCapabilityRegistry(): AgentCapabilityLimit[] {
  return AGENT_CAPABILITY_REGISTRY
}

export function resolveCapabilitiesForBlueprint(blueprint: AgentBlueprint): AgentCapabilityLimit[] {
  return blueprint.capabilityLimitIds.map((id) => {
    const capability = AGENT_CAPABILITY_REGISTRY.find(item => item.id === id)
    return capability ?? { id, label: `Unknown capability: ${id}`, allowed: false, approvalRequiredForExpansion: true }
  })
}

export function capabilityExpansionRequiresApproval(currentIds: string[], requestedIds: string[]) {
  const requestedExpansion = requestedIds.filter(id => !currentIds.includes(id))
  return {
    requestedExpansion,
    allowedWithoutApproval: requestedExpansion.length === 0,
    commanderApprovalRequired: requestedExpansion.length > 0,
    forbiddenRequests: requestedExpansion.filter((id) => {
      const capability = AGENT_CAPABILITY_REGISTRY.find(item => item.id === id)
      return capability?.allowed === false
    }),
  }
}
