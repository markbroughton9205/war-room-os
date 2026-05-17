import 'server-only'

import { ANALYST_REGISTRY } from '@/lib/analysts/analystRegistry'
import { getDoctrineSummary } from '@/lib/learning/doctrineEngine'
import { countLearningTable } from '@/lib/learning/persistence/learningPersistence'
import { getProviderScorecards } from '@/lib/learning/providerPerformanceTracker'
import { summarizePatchHistory } from '@/lib/repair/patchHistorySummarizer'
import { buildUnresolvedRepairTracker } from '@/lib/repair/unresolvedRepairTracker'
import { getWorkerLimitCounters } from '@/lib/workers/limits'
import { buildAgentActivationSnapshot } from '@/lib/agents/activation/agentActivationWorkflow'
import { tryWarRoomSupabase, type WarRoomSupabase } from '@/lib/war-room/persistence'
import { AGENT_FOUNDRY_TABLES, type AgentFoundryTableName } from './agentBlueprints'
import { getCapabilityRegistry } from './agentCapabilityRegistry'
import { buildAgentFoundrySnapshot } from './agentFoundry'
import { summarizeAgentPersistence, type AgentTableSummary } from './agentPersistence'

export type AgentIntegrationStatus =
  | 'live_persistent'
  | 'persistent_store'
  | 'awaiting_data'
  | 'derived_from_existing_store'
  | 'static_seed'
  | 'not_connected'

export type AgentSubsystemKey =
  | 'agentRegistry'
  | 'workerQueues'
  | 'lifecycleTracking'
  | 'governanceEvents'
  | 'approvals'
  | 'degradationHistory'
  | 'memoryScopes'
  | 'performanceHistory'
  | 'coordinationRouting'
  | 'workerHealth'
  | 'backgroundEcosystem'
  | 'agentScorecards'
  | 'approvalQueues'

export type AgentSubsystemIntegration = {
  status: AgentIntegrationStatus
  label: string
  detail: string
  records: number | null
  lastEventAt: string | null
  sources: string[]
  warnings: string[]
}

export type AgentEventSourceVerification = {
  id: string
  label: string
  status: AgentIntegrationStatus
  records: number | null
  lastEventAt: string | null
  detail: string
}

export type AgentValidationFinding = {
  id: string
  severity: 'info' | 'watch' | 'warning' | 'critical'
  status: AgentIntegrationStatus
  summary: string
  detail: string
}

export type AgentIntegrationSnapshot = {
  generatedAt: string
  persistenceAvailable: boolean
  overallStatus: AgentIntegrationStatus
  guardrails: {
    commanderApprovalRequired: true
    externalExecutionAllowed: false
    autonomousActivationAllowed: false
    autonomousCapabilityExpansionAllowed: false
    readOnlySnapshot: true
  }
  subsystemStatuses: Record<AgentSubsystemKey, AgentSubsystemIntegration>
  eventSources: AgentEventSourceVerification[]
  tables: AgentTableSummary[]
  counts: {
    persistedAgents: number | null
    activeAgents: number | null
    proposedAgents: number | null
    workerQueueRows: number | null
    queuedWorkerItems: number | null
    pendingAgentApprovals: number | null
    memoryScopes: number | null
    performanceRows: number | null
    governanceEvents: number | null
    degradationRows: number | null
    existingApprovalQueue: number | null
    orchestrationRows: number | null
    workflowRows: number | null
    outcomeRows: number | null
    doctrineRows: number | null
  }
  validations: {
    agentHealth: AgentValidationFinding[]
    governance: AgentValidationFinding[]
    persistence: AgentValidationFinding[]
    performance: AgentValidationFinding[]
  }
  runtime: {
    workerCounters: ReturnType<typeof getWorkerLimitCounters>
    analystFamilies: number
    providerScorecards: number
    doctrinePromoted: number
    repairLedgerEntries: number
    unresolvedRepairItems: number
  }
  foundry: Awaited<ReturnType<typeof buildAgentFoundrySnapshot>>
  activation: Awaited<ReturnType<typeof buildAgentActivationSnapshot>>
}

type CountResult = {
  records: number | null
  lastEventAt: string | null
  error?: string
}

type AgentRow = {
  id: string
  agent_key: string
  lifecycle_state: string
  assigned_doctrine: string[] | null
  memory_scope: string[] | null
  external_execution_allowed: boolean | null
  autonomous_self_expansion_allowed: boolean | null
  updated_at: string | null
}

type QueueRow = {
  id: string
  worker_key: string
  agent_id: string | null
  queue_state: string
  updated_at: string | null
}

type MemoryScopeRow = {
  id: string
  agent_id: string
  memory_domain: string
  scope_state: string
  expires_at: string | null
  updated_at: string | null
}

const VALID_AGENT_STATES = new Set(['proposed', 'approved', 'active', 'paused', 'degraded', 'retired'])
const REQUIRED_DOCTRINE = ['runtime-truth', 'approval-before-action']

function emptyCount(): CountResult {
  return { records: null, lastEventAt: null, error: 'Persistence is not configured.' }
}

async function countRows(client: WarRoomSupabase, table: string, dateColumn = 'created_at'): Promise<CountResult> {
  const countQuery = client.from(table).select('*', { count: 'exact', head: true })
  const latestQuery = client.from(table).select(dateColumn).order(dateColumn, { ascending: false }).limit(1).maybeSingle()
  const [countResult, latestResult] = await Promise.all([countQuery, latestQuery])
  if (countResult.error) return { records: null, lastEventAt: null, error: countResult.error.message }
  if (latestResult.error) return { records: countResult.count ?? 0, lastEventAt: null, error: latestResult.error.message }
  const row = latestResult.data as Record<string, unknown> | null
  return {
    records: countResult.count ?? 0,
    lastEventAt: typeof row?.[dateColumn] === 'string' ? row[dateColumn] : null,
  }
}

async function countFiltered(
  client: WarRoomSupabase,
  table: string,
  column: string,
  value: string,
  dateColumn = 'created_at',
): Promise<CountResult> {
  const countQuery = client.from(table).select('*', { count: 'exact', head: true }).eq(column, value)
  const latestQuery = client.from(table).select(dateColumn).eq(column, value).order(dateColumn, { ascending: false }).limit(1).maybeSingle()
  const [countResult, latestResult] = await Promise.all([countQuery, latestQuery])
  if (countResult.error) return { records: null, lastEventAt: null, error: countResult.error.message }
  if (latestResult.error) return { records: countResult.count ?? 0, lastEventAt: null, error: latestResult.error.message }
  const row = latestResult.data as Record<string, unknown> | null
  return {
    records: countResult.count ?? 0,
    lastEventAt: typeof row?.[dateColumn] === 'string' ? row[dateColumn] : null,
  }
}

function tableSummary(tables: AgentTableSummary[], table: AgentFoundryTableName): AgentTableSummary | null {
  return tables.find(row => row.table === table) ?? null
}

function liveOrEmpty(table: AgentTableSummary | null, empty: AgentIntegrationStatus): AgentIntegrationStatus {
  if (!table || table.status === 'not_connected') return 'not_connected'
  return (table.records ?? 0) > 0 ? 'live_persistent' : empty
}

function existingSourceStatus(count: CountResult, empty: AgentIntegrationStatus): AgentIntegrationStatus {
  if (count.error) return 'not_connected'
  return (count.records ?? 0) > 0 ? 'derived_from_existing_store' : empty
}

function subsystem(input: AgentSubsystemIntegration): AgentSubsystemIntegration {
  return input
}

function eventSource(
  id: string,
  label: string,
  count: CountResult,
  emptyStatus: AgentIntegrationStatus,
  liveStatus: AgentIntegrationStatus = 'live_persistent',
): AgentEventSourceVerification {
  const status = count.error
    ? 'not_connected'
    : (count.records ?? 0) > 0
      ? liveStatus
      : emptyStatus
  return {
    id,
    label,
    status,
    records: count.records,
    lastEventAt: count.lastEventAt,
    detail: count.error
      ? count.error
      : (count.records ?? 0) > 0
        ? `${count.records} row(s) verified.`
        : 'Store is reachable but awaiting rows.',
  }
}

function finding(
  id: string,
  severity: AgentValidationFinding['severity'],
  status: AgentIntegrationStatus,
  summary: string,
  detail: string,
): AgentValidationFinding {
  return { id, severity, status, summary, detail }
}

function statusRank(status: AgentIntegrationStatus): number {
  return {
    live_persistent: 5,
    derived_from_existing_store: 4,
    persistent_store: 3,
    awaiting_data: 2,
    static_seed: 1,
    not_connected: 0,
  }[status]
}

function overallStatus(statuses: AgentIntegrationStatus[]): AgentIntegrationStatus {
  if (statuses.some(status => status === 'not_connected')) return 'not_connected'
  if (statuses.some(status => status === 'live_persistent')) return 'live_persistent'
  return [...statuses].sort((a, b) => statusRank(b) - statusRank(a))[0] ?? 'not_connected'
}

async function fetchAgentRows(client: WarRoomSupabase | null): Promise<AgentRow[]> {
  if (!client) return []
  const { data, error } = await client
    .from('war_room_agents')
    .select('id,agent_key,lifecycle_state,assigned_doctrine,memory_scope,external_execution_allowed,autonomous_self_expansion_allowed,updated_at')
    .limit(500)
  if (error) return []
  return (data ?? []) as unknown as AgentRow[]
}

async function fetchQueueRows(client: WarRoomSupabase | null): Promise<QueueRow[]> {
  if (!client) return []
  const { data, error } = await client
    .from('war_room_agent_worker_queues')
    .select('id,worker_key,agent_id,queue_state,updated_at')
    .limit(500)
  if (error) return []
  return (data ?? []) as unknown as QueueRow[]
}

async function fetchMemoryScopeRows(client: WarRoomSupabase | null): Promise<MemoryScopeRow[]> {
  if (!client) return []
  const { data, error } = await client
    .from('war_room_agent_memory_scopes')
    .select('id,agent_id,memory_domain,scope_state,expires_at,updated_at')
    .limit(500)
  if (error) return []
  return (data ?? []) as unknown as MemoryScopeRow[]
}

export async function buildAgentIntegrationSnapshot(): Promise<AgentIntegrationSnapshot> {
  const generatedAt = new Date().toISOString()
  const sup = tryWarRoomSupabase()
  const client = sup.ok ? sup.client : null
  const [foundry, activation] = await Promise.all([
    buildAgentFoundrySnapshot(),
    buildAgentActivationSnapshot(),
  ])
  const persistence = await summarizeAgentPersistence()
  const tables = persistence.ok ? persistence.value : AGENT_FOUNDRY_TABLES.map(table => ({
    table,
    records: null,
    lastEventAt: null,
    status: 'not_connected' as const,
    error: persistence.ok ? undefined : persistence.error,
  }))

  const [
    agentRows,
    queueRows,
    memoryScopeRows,
    existingApprovals,
    orchestrationRows,
    workflowRows,
    outcomeRows,
    doctrineRows,
    actionLogs,
    memoryProposals,
  ] = await Promise.all([
    fetchAgentRows(client),
    fetchQueueRows(client),
    fetchMemoryScopeRows(client),
    client ? countFiltered(client, 'war_room_actions', 'status', 'waiting_approval') : Promise.resolve(emptyCount()),
    client ? countRows(client, 'war_room_orchestration_queue', 'created_at') : Promise.resolve(emptyCount()),
    client ? countRows(client, 'war_room_economic_workflow_queue', 'created_at') : Promise.resolve(emptyCount()),
    client ? countLearningTable(client, 'war_room_outcome_ledger', 'created_at') : Promise.resolve(emptyCount()),
    client ? countLearningTable(client, 'war_room_doctrine_entries', 'updated_at') : Promise.resolve(emptyCount()),
    client ? countRows(client, 'war_room_action_logs', 'created_at') : Promise.resolve(emptyCount()),
    client ? countRows(client, 'war_room_memory_proposals', 'created_at') : Promise.resolve(emptyCount()),
  ])

  const agentTable = tableSummary(tables, 'war_room_agents')
  const queueTable = tableSummary(tables, 'war_room_agent_worker_queues')
  const lifecycleTable = tableSummary(tables, 'war_room_agent_lifecycle_states')
  const memoryTable = tableSummary(tables, 'war_room_agent_memory_scopes')
  const performanceTable = tableSummary(tables, 'war_room_agent_performance_history')
  const governanceTable = tableSummary(tables, 'war_room_agent_governance_events')
  const approvalTable = tableSummary(tables, 'war_room_agent_approvals')
  const degradationTable = tableSummary(tables, 'war_room_agent_degradation_history')

  const activeAgents = agentRows.filter(agent => agent.lifecycle_state === 'active').length
  const proposedAgents = agentRows.filter(agent => agent.lifecycle_state === 'proposed').length
  const queuedWorkerItems = queueRows.filter(row => row.queue_state === 'queued').length
  const staleCutoff = Date.now() - 24 * 60 * 60 * 1000
  const stalledQueues = queueRows.filter((row) => {
    if (row.queue_state !== 'queued' && row.queue_state !== 'in_review') return false
    if (!row.updated_at) return false
    return new Date(row.updated_at).getTime() < staleCutoff
  })
  const duplicateAgentKeys = [...new Set(agentRows.map(agent => agent.agent_key))]
    .filter(key => agentRows.filter(agent => agent.agent_key === key).length > 1)
  const invalidLifecycleAgents = agentRows.filter(agent => !VALID_AGENT_STATES.has(agent.lifecycle_state))
  const agentsMissingDoctrine = agentRows.filter(agent => agent.lifecycle_state === 'active' && REQUIRED_DOCTRINE.some(id => !(agent.assigned_doctrine ?? []).includes(id)))
  const agentsWithExecution = agentRows.filter(agent => agent.external_execution_allowed || agent.autonomous_self_expansion_allowed)
  const expiredMemoryScopes = memoryScopeRows.filter(row => row.expires_at && new Date(row.expires_at).getTime() < Date.now() && row.scope_state === 'approved')
  const degradedAgents = agentRows.filter(agent => agent.lifecycle_state === 'degraded').length

  const workerCounters = getWorkerLimitCounters()
  const repairSummary = summarizePatchHistory()
  const unresolvedRepair = buildUnresolvedRepairTracker()
  const doctrineSummary = getDoctrineSummary()
  const providerScorecards = getProviderScorecards()
  const analystFamilies = Object.keys(ANALYST_REGISTRY).length

  const subsystemStatuses: AgentIntegrationSnapshot['subsystemStatuses'] = {
    agentRegistry: subsystem({
      status: liveOrEmpty(agentTable, 'persistent_store'),
      label: liveOrEmpty(agentTable, 'persistent_store'),
      detail: (agentTable?.records ?? 0) > 0
        ? 'Agent registry is reading persisted Phase 10 agent rows.'
        : 'Registry table is reachable; current UI blueprints are static seed until agent rows are inserted.',
      records: agentTable?.records ?? null,
      lastEventAt: agentTable?.lastEventAt ?? null,
      sources: ['war_room_agents', 'lib/agents/foundry/agentBlueprints.ts'],
      warnings: agentTable?.error ? [agentTable.error] : [],
    }),
    workerQueues: subsystem({
      status: liveOrEmpty(queueTable, 'awaiting_data'),
      label: liveOrEmpty(queueTable, 'awaiting_data'),
      detail: (queueTable?.records ?? 0) > 0
        ? 'Worker queue rows are persisted and available for read-only diagnostics.'
        : 'Worker queue table is ready but has no durable work items yet.',
      records: queueTable?.records ?? null,
      lastEventAt: queueTable?.lastEventAt ?? null,
      sources: ['war_room_agent_worker_queues'],
      warnings: stalledQueues.map(row => `${row.worker_key} stalled since ${row.updated_at}`),
    }),
    lifecycleTracking: subsystem({
      status: liveOrEmpty(lifecycleTable, 'awaiting_data'),
      label: liveOrEmpty(lifecycleTable, 'awaiting_data'),
      detail: 'Lifecycle history is persisted only when real agent state changes are recorded.',
      records: lifecycleTable?.records ?? null,
      lastEventAt: lifecycleTable?.lastEventAt ?? null,
      sources: ['war_room_agent_lifecycle_states', 'war_room_agents.lifecycle_state'],
      warnings: invalidLifecycleAgents.map(agent => `${agent.agent_key}: ${agent.lifecycle_state}`),
    }),
    governanceEvents: subsystem({
      status: liveOrEmpty(governanceTable, 'awaiting_data'),
      label: liveOrEmpty(governanceTable, 'awaiting_data'),
      detail: 'Governance events are reachable; rows appear when contradiction, capability, or review events are recorded.',
      records: governanceTable?.records ?? null,
      lastEventAt: governanceTable?.lastEventAt ?? null,
      sources: ['war_room_agent_governance_events', 'lib/agents/foundry/agentGovernance.ts'],
      warnings: [],
    }),
    approvals: subsystem({
      status: liveOrEmpty(approvalTable, existingSourceStatus(existingApprovals, 'persistent_store')),
      label: liveOrEmpty(approvalTable, existingSourceStatus(existingApprovals, 'persistent_store')),
      detail: (approvalTable?.records ?? 0) > 0
        ? 'Phase 10 agent approvals are persisted.'
        : 'Agent approval table is empty; existing War Room approval queue is used only as derived readiness context.',
      records: approvalTable?.records ?? null,
      lastEventAt: approvalTable?.lastEventAt ?? null,
      sources: ['war_room_agent_approvals', 'war_room_actions'],
      warnings: [],
    }),
    degradationHistory: subsystem({
      status: liveOrEmpty(degradationTable, 'awaiting_data'),
      label: liveOrEmpty(degradationTable, 'awaiting_data'),
      detail: 'Degradation history is ready and remains empty until scorecards or health checks record degradation.',
      records: degradationTable?.records ?? null,
      lastEventAt: degradationTable?.lastEventAt ?? null,
      sources: ['war_room_agent_degradation_history'],
      warnings: degradedAgents ? [`${degradedAgents} agent(s) currently degraded.`] : [],
    }),
    memoryScopes: subsystem({
      status: liveOrEmpty(memoryTable, 'persistent_store'),
      label: liveOrEmpty(memoryTable, 'persistent_store'),
      detail: (memoryTable?.records ?? 0) > 0
        ? 'Scoped memory mappings are persisted.'
        : 'Memory scope table is reachable; blueprint scopes are static seed until approved scope rows are inserted.',
      records: memoryTable?.records ?? null,
      lastEventAt: memoryTable?.lastEventAt ?? null,
      sources: ['war_room_agent_memory_scopes', 'war_room_memory_proposals', 'lib/agents/foundry/agentMemoryScope.ts'],
      warnings: expiredMemoryScopes.map(scope => `${scope.memory_domain} expired at ${scope.expires_at}`),
    }),
    performanceHistory: subsystem({
      status: liveOrEmpty(performanceTable, 'awaiting_data'),
      label: liveOrEmpty(performanceTable, 'awaiting_data'),
      detail: 'Performance history persists real accuracy/usefulness/retrieval rows before scorecards should be treated as measured.',
      records: performanceTable?.records ?? null,
      lastEventAt: performanceTable?.lastEventAt ?? null,
      sources: ['war_room_agent_performance_history'],
      warnings: [],
    }),
    coordinationRouting: subsystem({
      status: liveOrEmpty(queueTable, existingSourceStatus(orchestrationRows, 'static_seed')),
      label: liveOrEmpty(queueTable, existingSourceStatus(orchestrationRows, 'static_seed')),
      detail: (queueTable?.records ?? 0) > 0
        ? 'Agent coordination queue has persisted rows.'
        : 'Agent routing helper is available, but no durable Phase 10 coordination rows have been recorded.',
      records: queueTable?.records ?? null,
      lastEventAt: queueTable?.lastEventAt ?? null,
      sources: ['war_room_agent_worker_queues', 'war_room_orchestration_queue', 'lib/agents/foundry/agentWorkerCoordinator.ts'],
      warnings: [],
    }),
    workerHealth: subsystem({
      status: 'derived_from_existing_store',
      label: 'derived_from_existing_store',
      detail: 'Worker health is derived from live in-memory worker limit counters; it is not a durable Phase 10 worker daemon.',
      records: workerCounters.activeWorkers + workerCounters.workerQueueDepth,
      lastEventAt: null,
      sources: ['lib/workers/limits.ts'],
      warnings: workerCounters.workerQueueDepth > 0 ? [`Worker queue depth ${workerCounters.workerQueueDepth}.`] : [],
    }),
    backgroundEcosystem: subsystem({
      status: 'derived_from_existing_store',
      label: 'derived_from_existing_store',
      detail: 'Background ecosystem readiness is derived from worker counters, repair ledger, provider scorecards, and learning stores.',
      records: workerCounters.workerQueueDepth,
      lastEventAt: null,
      sources: ['lib/workers/limits.ts', 'lib/repair/repairLedger.ts', 'lib/learning/providerPerformanceTracker.ts'],
      warnings: unresolvedRepair.items.map(item => item.issue).slice(0, 5),
    }),
    agentScorecards: subsystem({
      status: (performanceTable?.records ?? 0) > 0 ? 'live_persistent' : 'static_seed',
      label: (performanceTable?.records ?? 0) > 0 ? 'live_persistent' : 'static_seed',
      detail: (performanceTable?.records ?? 0) > 0
        ? 'Agent scorecards can use persisted Phase 10 performance rows.'
        : 'Agent scorecards are generated from blueprint defaults until real performance rows are recorded.',
      records: performanceTable?.records ?? null,
      lastEventAt: performanceTable?.lastEventAt ?? null,
      sources: ['war_room_agent_performance_history', 'lib/agents/foundry/agentPerformanceTracker.ts'],
      warnings: (performanceTable?.records ?? 0) > 0 ? [] : ['No measured agent performance history yet.'],
    }),
    approvalQueues: subsystem({
      status: liveOrEmpty(approvalTable, existingSourceStatus(existingApprovals, 'persistent_store')),
      label: liveOrEmpty(approvalTable, existingSourceStatus(existingApprovals, 'persistent_store')),
      detail: 'Agent approvals are separate from existing War Room actions; existing approvals are shown as derived readiness only.',
      records: approvalTable?.records ?? null,
      lastEventAt: approvalTable?.lastEventAt ?? null,
      sources: ['war_room_agent_approvals', 'war_room_actions'],
      warnings: [],
    }),
  }

  const eventSources: AgentEventSourceVerification[] = [
    ...tables.map(table => eventSource(table.table, table.table, {
      records: table.records,
      lastEventAt: table.lastEventAt,
      error: table.error,
    }, table.table === 'war_room_agents' || table.table === 'war_room_agent_memory_scopes' ? 'persistent_store' : 'awaiting_data')),
    eventSource('existing_approvals', 'Existing approval queue', existingApprovals, 'persistent_store', 'derived_from_existing_store'),
    eventSource('orchestration_queue', 'Orchestration events', orchestrationRows, 'static_seed', 'derived_from_existing_store'),
    eventSource('workflow_queue', 'Workflow queue', workflowRows, 'awaiting_data', 'derived_from_existing_store'),
    eventSource('outcome_ledger', 'Outcome ledger', outcomeRows, 'awaiting_data', 'derived_from_existing_store'),
    eventSource('doctrine_store', 'Doctrine store', doctrineRows, 'persistent_store', 'derived_from_existing_store'),
    eventSource('action_logs', 'Action logs', actionLogs, 'awaiting_data', 'derived_from_existing_store'),
    eventSource('memory_proposals', 'Memory proposals', memoryProposals, 'persistent_store', 'derived_from_existing_store'),
  ]

  const persistenceFindings = [
    finding(
      'phase10-tables',
      tables.every(table => table.status !== 'not_connected') ? 'info' : 'critical',
      tables.every(table => table.status !== 'not_connected') ? 'persistent_store' : 'not_connected',
      'Phase 10 table reachability',
      tables.every(table => table.status !== 'not_connected')
        ? 'All Phase 10 tables responded to service-role read checks.'
        : 'One or more Phase 10 tables are unavailable or migration has not been applied.',
    ),
    finding(
      'duplicate-agent-keys',
      duplicateAgentKeys.length ? 'critical' : 'info',
      duplicateAgentKeys.length ? 'not_connected' : 'persistent_store',
      'Duplicate agent keys',
      duplicateAgentKeys.length ? duplicateAgentKeys.join(', ') : 'No duplicate agent keys detected in persisted rows.',
    ),
    finding(
      'memory-scope-staleness',
      expiredMemoryScopes.length ? 'warning' : 'info',
      expiredMemoryScopes.length ? 'awaiting_data' : 'persistent_store',
      'Stale memory scopes',
      expiredMemoryScopes.length ? `${expiredMemoryScopes.length} approved memory scope(s) are expired.` : 'No expired approved memory scopes detected.',
    ),
  ]

  const governanceFindings = [
    finding(
      'no-auto-activation',
      activeAgents > 0 ? 'watch' : 'info',
      activeAgents > 0 ? 'live_persistent' : 'persistent_store',
      'Auto-activation check',
      activeAgents > 0
        ? `${activeAgents} active persisted agent(s); activation rows should be reviewed against approvals.`
        : 'No active persisted agents; blueprints remain proposed/static until approved.',
    ),
    finding(
      'capability-expansion',
      'info',
      'persistent_store',
      'Capability expansion check',
      `${getCapabilityRegistry().filter(capability => capability.approvalRequiredForExpansion).length} registered capabilities require approval for expansion.`,
    ),
    finding(
      'doctrine-inheritance',
      agentsMissingDoctrine.length ? 'critical' : 'info',
      agentsMissingDoctrine.length ? 'not_connected' : 'persistent_store',
      'Doctrine inheritance check',
      agentsMissingDoctrine.length ? `${agentsMissingDoctrine.length} active agent(s) missing required doctrine.` : 'No active persisted agents are missing required doctrine.',
    ),
    finding(
      'external-execution',
      agentsWithExecution.length ? 'critical' : 'info',
      agentsWithExecution.length ? 'not_connected' : 'persistent_store',
      'External execution guardrail',
      agentsWithExecution.length ? `${agentsWithExecution.length} agent row(s) violate execution guardrails.` : 'No persisted agent rows allow external execution or self-expansion.',
    ),
  ]

  const agentHealthFindings = [
    finding(
      'empty-worker-queue',
      queuedWorkerItems === 0 ? 'info' : 'watch',
      queuedWorkerItems === 0 ? 'awaiting_data' : 'live_persistent',
      'Worker queue pressure',
      queuedWorkerItems === 0 ? 'Durable worker queue is empty.' : `${queuedWorkerItems} durable worker item(s) queued.`,
    ),
    finding(
      'stalled-workers',
      stalledQueues.length ? 'warning' : 'info',
      stalledQueues.length ? 'awaiting_data' : 'persistent_store',
      'Stalled worker detection',
      stalledQueues.length ? `${stalledQueues.length} queue item(s) are older than 24 hours.` : 'No stalled durable queue rows detected.',
    ),
    finding(
      'inactive-agents',
      agentRows.length === 0 || proposedAgents > 0 ? 'info' : 'watch',
      agentRows.length === 0 ? 'static_seed' : 'live_persistent',
      'Inactive agent detection',
      agentRows.length === 0 ? 'No persisted agents yet; static blueprints are not active workers.' : `${proposedAgents} proposed and ${activeAgents} active persisted agent(s).`,
    ),
    finding(
      'degraded-workers',
      degradedAgents > 0 ? 'warning' : 'info',
      degradedAgents > 0 ? 'live_persistent' : 'persistent_store',
      'Degraded worker detection',
      degradedAgents > 0 ? `${degradedAgents} persisted agent(s) are degraded.` : 'No degraded persisted agents detected.',
    ),
  ]

  const performanceFindings = [
    finding(
      'performance-history',
      (performanceTable?.records ?? 0) > 0 ? 'info' : 'watch',
      (performanceTable?.records ?? 0) > 0 ? 'live_persistent' : 'awaiting_data',
      'Performance history persistence',
      (performanceTable?.records ?? 0) > 0 ? `${performanceTable?.records} performance row(s) available.` : 'Performance history table is ready but no measured rows exist.',
    ),
    finding(
      'scorecard-generation',
      (performanceTable?.records ?? 0) > 0 ? 'info' : 'watch',
      (performanceTable?.records ?? 0) > 0 ? 'live_persistent' : 'static_seed',
      'Scorecard generation',
      (performanceTable?.records ?? 0) > 0 ? 'Scorecards can include persisted measurements.' : 'Scorecards are generated from defaults and must not be treated as measured reliability.',
    ),
    finding(
      'degradation-tracking',
      (degradationTable?.records ?? 0) > 0 ? 'info' : 'watch',
      (degradationTable?.records ?? 0) > 0 ? 'live_persistent' : 'awaiting_data',
      'Degradation tracking',
      (degradationTable?.records ?? 0) > 0 ? `${degradationTable?.records} degradation row(s) available.` : 'Degradation table is ready but has no events.',
    ),
    finding(
      'contradiction-escalation',
      (governanceTable?.records ?? 0) > 0 ? 'info' : 'watch',
      (governanceTable?.records ?? 0) > 0 ? 'live_persistent' : 'awaiting_data',
      'Contradiction escalation hooks',
      (governanceTable?.records ?? 0) > 0 ? 'Governance events can carry contradiction refs.' : 'Contradiction escalation storage is ready but no governance events exist.',
    ),
  ]

  return {
    generatedAt,
    persistenceAvailable: sup.ok && tables.every(table => table.status !== 'not_connected'),
    overallStatus: overallStatus(Object.values(subsystemStatuses).map(status => status.status)),
    guardrails: {
      commanderApprovalRequired: true,
      externalExecutionAllowed: false,
      autonomousActivationAllowed: false,
      autonomousCapabilityExpansionAllowed: false,
      readOnlySnapshot: true,
    },
    subsystemStatuses,
    eventSources,
    tables,
    counts: {
      persistedAgents: agentTable?.records ?? null,
      activeAgents,
      proposedAgents,
      workerQueueRows: queueTable?.records ?? null,
      queuedWorkerItems,
      pendingAgentApprovals: approvalTable?.records ?? null,
      memoryScopes: memoryTable?.records ?? null,
      performanceRows: performanceTable?.records ?? null,
      governanceEvents: governanceTable?.records ?? null,
      degradationRows: degradationTable?.records ?? null,
      existingApprovalQueue: existingApprovals.records,
      orchestrationRows: orchestrationRows.records,
      workflowRows: workflowRows.records,
      outcomeRows: outcomeRows.records,
      doctrineRows: doctrineRows.records,
    },
    validations: {
      agentHealth: agentHealthFindings,
      governance: governanceFindings,
      persistence: persistenceFindings,
      performance: performanceFindings,
    },
    runtime: {
      workerCounters,
      analystFamilies,
      providerScorecards: providerScorecards.length,
      doctrinePromoted: doctrineSummary.promoted,
      repairLedgerEntries: repairSummary.totalEntries,
      unresolvedRepairItems: unresolvedRepair.items.length,
    },
    foundry,
    activation,
  }
}
