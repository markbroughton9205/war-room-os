import { AGENT_BLUEPRINTS, type FoundryAgent } from './agentBlueprints'
import { getGovernanceRules } from './agentGovernance'
import { monitorAgentEcosystem } from './agentHealthMonitor'
import { createProposedAgentFromBlueprint, getLifecycleBehavior } from './agentLifecycle'
import { getMemoryDomains, summarizeMemoryScopes } from './agentMemoryScope'
import { summarizeAgentPersistence, type AgentTableSummary } from './agentPersistence'
import { getPerformanceBehavior, rankAgentReliability } from './agentPerformanceTracker'
import { buildCoordinationSummary, buildDurableWorkers } from './agentWorkerCoordinator'
import { evaluateAgentPopulationEvolution } from './agentEvolutionTracker'

export type AgentFoundryIntegrationStatus = 'persistent_store' | 'awaiting_data' | 'not_connected'

export type AgentFoundrySnapshot = {
  generatedAt: string
  persistenceAvailable: boolean
  integrationStatus: AgentFoundryIntegrationStatus
  guardrails: {
    commanderApprovalRequired: true
    externalExecutionAllowed: false
    autonomousSelfExpansionAllowed: false
    readOnlySnapshot: true
  }
  tables: AgentTableSummary[]
  agents: FoundryAgent[]
  workers: ReturnType<typeof buildDurableWorkers>
  lifecycle: ReturnType<typeof getLifecycleBehavior>
  governance: {
    rules: string[]
    pendingApprovals: number
    activationRequiresApproval: true
    capabilityExpansionRequiresApproval: true
  }
  memory: {
    domains: ReturnType<typeof getMemoryDomains>
    scopedAssignments: ReturnType<typeof summarizeMemoryScopes>
    rule: string
  }
  coordination: ReturnType<typeof buildCoordinationSummary>
  performance: {
    behavior: string
    scorecards: ReturnType<typeof rankAgentReliability>
  }
  evolution: ReturnType<typeof evaluateAgentPopulationEvolution>
  health: ReturnType<typeof monitorAgentEcosystem>
}

function tableRows(tables: AgentTableSummary[], table: string): number | null {
  return tables.find(summary => summary.table === table)?.records ?? null
}

function persistenceStatus(tables: AgentTableSummary[]): AgentFoundryIntegrationStatus {
  if (!tables.length || tables.some(table => table.status === 'not_connected')) return 'not_connected'
  return tables.some(table => (table.records ?? 0) > 0) ? 'persistent_store' : 'awaiting_data'
}

export async function buildAgentFoundrySnapshot(): Promise<AgentFoundrySnapshot> {
  const generatedAt = new Date().toISOString()
  const persistence = await summarizeAgentPersistence()
  const tables = persistence.ok ? persistence.value : []
  const integrationStatus = persistence.ok ? persistenceStatus(tables) : 'not_connected'
  const agents = AGENT_BLUEPRINTS.map(createProposedAgentFromBlueprint)
  const workers = buildDurableWorkers(agents, integrationStatus)
  const agentRows = tableRows(tables, 'war_room_agents')
  const queueRows = tableRows(tables, 'war_room_agent_worker_queues')

  return {
    generatedAt,
    persistenceAvailable: persistence.ok,
    integrationStatus,
    guardrails: {
      commanderApprovalRequired: true,
      externalExecutionAllowed: false,
      autonomousSelfExpansionAllowed: false,
      readOnlySnapshot: true,
    },
    tables,
    agents,
    workers,
    lifecycle: getLifecycleBehavior(),
    governance: {
      rules: getGovernanceRules(),
      pendingApprovals: tableRows(tables, 'war_room_agent_approvals') ?? 0,
      activationRequiresApproval: true,
      capabilityExpansionRequiresApproval: true,
    },
    memory: {
      domains: getMemoryDomains(),
      scopedAssignments: summarizeMemoryScopes(agents),
      rule: 'Agents can access only approved domains mapped to their blueprint or persisted memory scope.',
    },
    coordination: buildCoordinationSummary(workers, queueRows),
    performance: {
      behavior: getPerformanceBehavior(),
      scorecards: rankAgentReliability(agents),
    },
    evolution: evaluateAgentPopulationEvolution(agents),
    health: monitorAgentEcosystem(agents, workers, agentRows),
  }
}
