import type { AgentMemoryDomain, FoundryAgent } from './agentBlueprints'

export type MemoryDomainDefinition = {
  id: AgentMemoryDomain
  label: string
  persistenceSource: string
  defaultAccess: 'approved_only'
  notes: string
}

export const AGENT_MEMORY_DOMAINS: MemoryDomainDefinition[] = [
  { id: 'local_intelligence', label: 'Local intelligence', persistenceSource: 'war_room_internet_logs + economic surface', defaultAccess: 'approved_only', notes: 'Local signals and source context only.' },
  { id: 'market_signals', label: 'Market signals', persistenceSource: 'economic opportunities + forecast feedback', defaultAccess: 'approved_only', notes: 'Market observations, never trading or spend authority.' },
  { id: 'freight_intelligence', label: 'Freight intelligence', persistenceSource: 'economic opportunity metadata', defaultAccess: 'approved_only', notes: 'Lane and freight context when explicitly stored.' },
  { id: 'repair_ledger', label: 'Repair ledger', persistenceSource: 'repair ledger + rollback checkpoints', defaultAccess: 'approved_only', notes: 'Repair history and validation outcomes.' },
  { id: 'forecast_feedback', label: 'Forecast feedback', persistenceSource: 'war_room_forecast_feedback', defaultAccess: 'approved_only', notes: 'Predictions, actuals, and variance history.' },
  { id: 'infrastructure_health', label: 'Infrastructure health', persistenceSource: 'worker limits + provider health', defaultAccess: 'approved_only', notes: 'Runtime health snapshots and provider status.' },
  { id: 'source_reliability', label: 'Source reliability', persistenceSource: 'retrieval logs + narrative graph', defaultAccess: 'approved_only', notes: 'Reliability, freshness, and contradiction signals.' },
  { id: 'economic_opportunities', label: 'Economic opportunities', persistenceSource: 'war_room_economic_opportunities', defaultAccess: 'approved_only', notes: 'Opportunity records, no autonomous outreach.' },
  { id: 'workflow_history', label: 'Workflow history', persistenceSource: 'workflow queues + outcome ledger', defaultAccess: 'approved_only', notes: 'Operational outcomes and queue state.' },
  { id: 'engineering_bridge', label: 'Engineering bridge', persistenceSource: 'repair + Red Team + engineering coordination', defaultAccess: 'approved_only', notes: 'Engineering context, no mutation authority.' },
  { id: 'doctrine', label: 'Doctrine', persistenceSource: 'war_room_doctrine_entries', defaultAccess: 'approved_only', notes: 'Doctrine-relevant context and inherited constraints.' },
]

export function getMemoryDomains(): MemoryDomainDefinition[] {
  return AGENT_MEMORY_DOMAINS
}

export function resolveMemoryScope(scope: AgentMemoryDomain[]): MemoryDomainDefinition[] {
  return scope.map((id) => AGENT_MEMORY_DOMAINS.find(domain => domain.id === id)).filter((domain): domain is MemoryDomainDefinition => Boolean(domain))
}

export function canAgentAccessMemory(agent: FoundryAgent, domain: AgentMemoryDomain) {
  return {
    allowed: agent.memoryScope.includes(domain),
    reason: agent.memoryScope.includes(domain)
      ? `${agent.name} has approved access to ${domain}.`
      : `${agent.name} cannot access ${domain}; scope expansion requires Commander approval.`,
  }
}

export function summarizeMemoryScopes(agents: FoundryAgent[]) {
  return AGENT_MEMORY_DOMAINS.map(domain => ({
    ...domain,
    assignedAgents: agents.filter(agent => agent.memoryScope.includes(domain.id)).map(agent => agent.name),
  }))
}
