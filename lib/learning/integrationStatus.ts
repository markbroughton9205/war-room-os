import { buildConfigurationSweep } from '@/lib/configuration/configurationHealth'
import { listEconomicSurface } from '@/lib/economic/store'
import { summarizePatchHistory } from '@/lib/repair/patchHistorySummarizer'
import { buildUnresolvedRepairTracker } from '@/lib/repair/unresolvedRepairTracker'
import { getResourceSnapshot } from '@/lib/system/resourceMonitor'
import { tryWarRoomSupabase, type WarRoomSupabase } from '@/lib/war-room/persistence'
import { getWorkerLimitCounters } from '@/lib/workers/limits'
import { listDoctrineStoreEntries } from './persistence/doctrinePersistence'
import { listNotificationQueue } from './persistence/escalationPersistence'
import { listForecastFeedback } from './persistence/forecastPersistence'
import { countLearningTable, listOutcomeLedgerEntries } from './persistence/learningPersistence'
import { listNarrativeGraphRows } from './persistence/narrativePersistence'
import { listSpecializedAgents } from './persistence/specializedAgentPersistence'

export type LearningIntegrationStatus =
  | 'live_wired'
  | 'derived_from_existing_store'
  | 'static_seed'
  | 'not_connected'
  | 'persistent_store'
  | 'live_persistent'
  | 'awaiting_data'

export type LearningPanelKey =
  | 'outcomeLedger'
  | 'providerScorecards'
  | 'doctrine'
  | 'narrativeGraph'
  | 'forecastSimulation'
  | 'backgroundWorkers'
  | 'resourceAwareness'
  | 'agentEvolution'
  | 'escalationQueue'
  | 'patternsWorkflow'

export type LearningPanelIntegration = {
  status: LearningIntegrationStatus
  label: string
  detail: string
  sources: string[]
  gaps: string[]
}

export type LearningEventSourceConnection = {
  id: string
  label: string
  status: LearningIntegrationStatus
  detail: string
  records: number | null
  lastEventAt: string | null
}

export type LearningIntegrationSnapshot = {
  generatedAt: string
  persistenceAvailable: boolean
  guardrails: {
    externalExecutionAllowed: false
    commanderApprovalRequired: true
    readOnlySnapshot: true
  }
  panelStatuses: Record<LearningPanelKey, LearningPanelIntegration>
  eventSources: LearningEventSourceConnection[]
  counts: {
    auditLogs: number | null
    actionLogs: number | null
    pendingApprovals: number | null
    internetLogs: number | null
    economicOpportunities: number | null
    economicWorkflows: number | null
    economicProviderEffectiveness: number | null
    memoryProposalsPending: number | null
    approvedMemories: number | null
    redSentinelScans: number | null
    learningOutcomes: number | null
    doctrineEntries: number | null
    narrativeGraphRows: number | null
    forecastFeedback: number | null
    notificationPreferences: number | null
    notificationQueue: number | null
    specializedAgents: number | null
  }
  providerRuntime: {
    configuredProviders: number
    totalProviders: number
    degradedSystems: number
    economicProviderRows: number | null
    status: LearningIntegrationStatus
  }
  repair: {
    totalEntries: number
    monitorEntries: number
    unresolvedEntries: number
    unresolvedWarnings: number
    rollbackCheckpoints: number
  }
  economic: {
    activeOpportunities: number | null
    completedWorkflows: number | null
    providerSuccessRate: number | null
    unresolvedOperations: number | null
  }
  memory: {
    pendingProposals: number | null
    approvedMemories: number | null
    status: LearningIntegrationStatus
  }
  system: {
    memoryUsageRatio: number
    workerQueueDepth: number
    activeWorkers: number
    activeScans: number
    internetPollsInWindow: number
    memoryWarning: string
    cpuWarning: string
  }
  notConnectedGaps: string[]
  learningStores: {
    outcomeLedger: LearningStoreSummary
    doctrineEntries: LearningStoreSummary
    narrativeGraph: LearningStoreSummary
    forecastFeedback: LearningStoreSummary
    notificationPreferences: LearningStoreSummary
    notificationQueue: LearningStoreSummary
    specializedAgents: LearningStoreSummary
  }
  recentPersistent: {
    outcomes: string[]
    doctrine: string[]
    narratives: string[]
    forecasts: string[]
    notifications: string[]
    specializedAgents: string[]
  }
}

type CountResult = {
  records: number | null
  lastEventAt: string | null
  error?: string
}

type LearningStoreSummary = {
  status: LearningIntegrationStatus
  records: number | null
  lastEventAt: string | null
  detail: string
}

async function countRows(
  client: WarRoomSupabase,
  table: string,
  dateColumn: string,
): Promise<CountResult> {
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

async function countPendingApprovals(client: WarRoomSupabase): Promise<CountResult> {
  const { count, error } = await client
    .from('war_room_actions')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'waiting_approval')
  if (error) return { records: null, lastEventAt: null, error: error.message }

  const { data, error: latestError } = await client
    .from('war_room_actions')
    .select('created_at')
    .eq('status', 'waiting_approval')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    records: count ?? 0,
    lastEventAt: latestError ? null : typeof (data as { created_at?: unknown } | null)?.created_at === 'string' ? (data as { created_at: string }).created_at : null,
    ...(latestError ? { error: latestError.message } : {}),
  }
}

function sourceStatus(result: CountResult | null, persistenceAvailable: boolean): LearningIntegrationStatus {
  if (!persistenceAvailable) return 'not_connected'
  if (!result || result.error) return 'not_connected'
  return 'live_wired'
}

function sourceConnection(
  id: string,
  label: string,
  result: CountResult | null,
  persistenceAvailable: boolean,
  emptyDetail: string,
): LearningEventSourceConnection {
  const status = sourceStatus(result, persistenceAvailable)
  const records = result?.records ?? null
  return {
    id,
    label,
    status,
    records,
    lastEventAt: result?.lastEventAt ?? null,
    detail: status === 'not_connected'
      ? (result?.error ?? (persistenceAvailable ? 'Table unavailable or query failed.' : 'Supabase persistence is not configured.'))
      : records === 0
        ? emptyDetail
        : `${records} persisted row(s) available.`,
  }
}

function panel(
  status: LearningIntegrationStatus,
  label: string,
  detail: string,
  sources: string[],
  gaps: string[] = [],
): LearningPanelIntegration {
  return { status, label, detail, sources, gaps }
}

function statusFromRows(count: number | null, fallback: LearningIntegrationStatus): LearningIntegrationStatus {
  if (typeof count !== 'number') return 'not_connected'
  return count > 0 ? 'live_wired' : fallback
}

function learningStoreSummary(count: CountResult | null, emptyLabel: string): LearningStoreSummary {
  if (!count) {
    return {
      status: 'not_connected',
      records: null,
      lastEventAt: null,
      detail: 'Persistence is unavailable or the learning storage migration has not been applied.',
    }
  }
  if (count.error) {
    return {
      status: 'not_connected',
      records: count.records,
      lastEventAt: count.lastEventAt,
      detail: count.error,
    }
  }
  if ((count.records ?? 0) > 0) {
    return {
      status: 'live_persistent',
      records: count.records,
      lastEventAt: count.lastEventAt,
      detail: `${count.records} persisted learning row(s) available.`,
    }
  }
  return {
    status: 'awaiting_data',
    records: 0,
    lastEventAt: null,
    detail: emptyLabel,
  }
}

export async function buildLearningIntegrationSnapshot(): Promise<LearningIntegrationSnapshot> {
  const generatedAt = new Date().toISOString()
  const sup = tryWarRoomSupabase()
  const persistenceAvailable = sup.ok
  const configuration = buildConfigurationSweep()
  const repairHistory = summarizePatchHistory()
  const unresolvedRepair = buildUnresolvedRepairTracker()
  const resourceSnapshot = getResourceSnapshot()
  const workerCounters = getWorkerLimitCounters()

  let auditLogs: CountResult | null = null
  let actionLogs: CountResult | null = null
  let pendingApprovals: CountResult | null = null
  let internetLogs: CountResult | null = null
  let economicOpportunities: CountResult | null = null
  let economicWorkflows: CountResult | null = null
  let economicProviderEffectiveness: CountResult | null = null
  let memoryProposals: CountResult | null = null
  let approvedMemories: CountResult | null = null
  let redSentinelScans: CountResult | null = null
  let learningOutcomes: CountResult | null = null
  let doctrineEntries: CountResult | null = null
  let narrativeGraphRows: CountResult | null = null
  let forecastFeedback: CountResult | null = null
  let notificationPreferences: CountResult | null = null
  let notificationQueue: CountResult | null = null
  let specializedAgents: CountResult | null = null
  let recentPersistent: LearningIntegrationSnapshot['recentPersistent'] = {
    outcomes: [],
    doctrine: [],
    narratives: [],
    forecasts: [],
    notifications: [],
    specializedAgents: [],
  }
  let economicStats: LearningIntegrationSnapshot['economic'] = {
    activeOpportunities: null,
    completedWorkflows: null,
    providerSuccessRate: null,
    unresolvedOperations: null,
  }

  if (sup.ok) {
    const client = sup.client
    ;[
      auditLogs,
      actionLogs,
      pendingApprovals,
      internetLogs,
      economicOpportunities,
      economicWorkflows,
      economicProviderEffectiveness,
      memoryProposals,
      approvedMemories,
      redSentinelScans,
      learningOutcomes,
      doctrineEntries,
      narrativeGraphRows,
      forecastFeedback,
      notificationPreferences,
      notificationQueue,
      specializedAgents,
    ] = await Promise.all([
      countRows(client, 'war_room_audit_logs', 'created_at'),
      countRows(client, 'war_room_action_logs', 'created_at'),
      countPendingApprovals(client),
      countRows(client, 'war_room_internet_logs', 'created_at'),
      countRows(client, 'war_room_economic_opportunities', 'discovered_at'),
      countRows(client, 'war_room_economic_workflow_queue', 'created_at'),
      countRows(client, 'war_room_economic_provider_effectiveness', 'updated_at'),
      countRows(client, 'war_room_memory_proposals', 'created_at'),
      countRows(client, 'war_room_approved_memories', 'approved_at'),
      countRows(client, 'war_room_sentinel_scans', 'created_at'),
      countLearningTable(client, 'war_room_outcome_ledger', 'created_at'),
      countLearningTable(client, 'war_room_doctrine_entries', 'updated_at'),
      countLearningTable(client, 'war_room_narrative_graph', 'observed_at'),
      countLearningTable(client, 'war_room_forecast_feedback', 'created_at'),
      countLearningTable(client, 'war_room_notification_preferences', 'updated_at'),
      countLearningTable(client, 'war_room_notification_queue', 'created_at'),
      countLearningTable(client, 'war_room_specialized_agents', 'updated_at'),
    ])

    const [
      outcomeRows,
      doctrineRows,
      narrativeRows,
      forecastRows,
      notificationRows,
      specializedAgentRows,
    ] = await Promise.all([
      listOutcomeLedgerEntries(5),
      listDoctrineStoreEntries(5),
      listNarrativeGraphRows(5),
      listForecastFeedback(5),
      listNotificationQueue(5),
      listSpecializedAgents(5),
    ])
    recentPersistent = {
      outcomes: outcomeRows.ok ? outcomeRows.value.map(row => row.predicted_outcome ?? row.actual_outcome ?? row.decree_id ?? row.id).slice(0, 5) : [],
      doctrine: doctrineRows.ok ? doctrineRows.value.map(row => row.principle).slice(0, 5) : [],
      narratives: narrativeRows.ok ? narrativeRows.value.map(row => `Narrative graph ${row.id.slice(0, 8)} · confidence ${Math.round(row.confidence * 100)}%`).slice(0, 5) : [],
      forecasts: forecastRows.ok ? forecastRows.value.map(row => `${row.forecast_id}: ${row.prediction}`).slice(0, 5) : [],
      notifications: notificationRows.ok ? notificationRows.value.map(row => `${row.severity}: ${row.source}`).slice(0, 5) : [],
      specializedAgents: specializedAgentRows.ok ? specializedAgentRows.value.map(row => `${row.proposed_agent} · ${row.status}`).slice(0, 5) : [],
    }

    const surface = await listEconomicSurface(client, 80)
    if (surface.ok) {
      const activeOpportunities = surface.value.opportunities.filter(opportunity => !['completed', 'rejected', 'archived'].includes(opportunity.status))
      const completedWorkflows = surface.value.workflows.filter(workflow => workflow.status === 'completed')
      const providerTotals = surface.value.providerEffectiveness.reduce(
        (acc, row) => ({
          success: acc.success + row.success_count,
          failure: acc.failure + row.failure_count,
        }),
        { success: 0, failure: 0 },
      )
      economicStats = {
        activeOpportunities: activeOpportunities.length,
        completedWorkflows: completedWorkflows.length,
        providerSuccessRate: providerTotals.success + providerTotals.failure > 0
          ? providerTotals.success / (providerTotals.success + providerTotals.failure)
          : null,
        unresolvedOperations: surface.value.unresolvedOperations.filter(operation => operation.status !== 'resolved' && operation.status !== 'archived').length,
      }
    }
  }

  const eventSources = [
    sourceConnection('audit_logs', 'Audit logs', auditLogs, persistenceAvailable, 'Connected; awaiting audit rows.'),
    sourceConnection('action_logs', 'Action logs', actionLogs, persistenceAvailable, 'Connected; awaiting action log rows.'),
    sourceConnection('pending_approvals', 'Pending approvals', pendingApprovals, persistenceAvailable, 'Connected; no approvals waiting.'),
    sourceConnection('internet_logs', 'Retrieval telemetry', internetLogs, persistenceAvailable, 'Connected; awaiting retrieval log rows.'),
    sourceConnection('economic_opportunities', 'Economic opportunities', economicOpportunities, persistenceAvailable, 'Connected; awaiting opportunities.'),
    sourceConnection('economic_workflows', 'Economic workflows', economicWorkflows, persistenceAvailable, 'Connected; awaiting workflow rows.'),
    sourceConnection('economic_provider_effectiveness', 'Economic provider effectiveness', economicProviderEffectiveness, persistenceAvailable, 'Connected; awaiting effectiveness rows.'),
    sourceConnection('memory_proposals', 'Strategic memory proposals', memoryProposals, persistenceAvailable, 'Connected; no memory proposals recorded.'),
    sourceConnection('approved_memories', 'Approved strategic memory', approvedMemories, persistenceAvailable, 'Connected; no approved memory rows recorded.'),
    sourceConnection('red_sentinel_scans', 'Red Sentinel scans', redSentinelScans, persistenceAvailable, 'Connected; awaiting scan rows.'),
    sourceConnection('learning_outcomes', 'Persistent outcome ledger', learningOutcomes, persistenceAvailable, 'Learning storage connected; awaiting outcome feedback.'),
    sourceConnection('learning_doctrine', 'Persistent doctrine', doctrineEntries, persistenceAvailable, 'Learning storage connected; awaiting doctrine entries.'),
    sourceConnection('learning_narrative_graph', 'Persistent narrative graph', narrativeGraphRows, persistenceAvailable, 'Learning storage connected; awaiting narrative graph rows.'),
    sourceConnection('learning_forecast_feedback', 'Persistent forecast feedback', forecastFeedback, persistenceAvailable, 'Learning storage connected; awaiting forecast feedback.'),
    sourceConnection('learning_notification_queue', 'Persistent notification queue', notificationQueue, persistenceAvailable, 'Learning storage connected; no queued notifications.'),
    sourceConnection('learning_specialized_agents', 'Persistent specialized agents', specializedAgents, persistenceAvailable, 'Learning storage connected; awaiting agent proposals.'),
  ]

  const counts = {
    auditLogs: auditLogs?.records ?? null,
    actionLogs: actionLogs?.records ?? null,
    pendingApprovals: pendingApprovals?.records ?? null,
    internetLogs: internetLogs?.records ?? null,
    economicOpportunities: economicOpportunities?.records ?? null,
    economicWorkflows: economicWorkflows?.records ?? null,
    economicProviderEffectiveness: economicProviderEffectiveness?.records ?? null,
    memoryProposalsPending: memoryProposals?.records ?? null,
    approvedMemories: approvedMemories?.records ?? null,
    redSentinelScans: redSentinelScans?.records ?? null,
    learningOutcomes: learningOutcomes?.records ?? null,
    doctrineEntries: doctrineEntries?.records ?? null,
    narrativeGraphRows: narrativeGraphRows?.records ?? null,
    forecastFeedback: forecastFeedback?.records ?? null,
    notificationPreferences: notificationPreferences?.records ?? null,
    notificationQueue: notificationQueue?.records ?? null,
    specializedAgents: specializedAgents?.records ?? null,
  }

  const learningStores: LearningIntegrationSnapshot['learningStores'] = {
    outcomeLedger: learningStoreSummary(learningOutcomes, 'Outcome ledger table exists; awaiting persisted outcome feedback.'),
    doctrineEntries: learningStoreSummary(doctrineEntries, 'Doctrine table exists; awaiting threshold-reviewed doctrine entries.'),
    narrativeGraph: learningStoreSummary(narrativeGraphRows, 'Narrative graph table exists; awaiting persisted relationship observations.'),
    forecastFeedback: learningStoreSummary(forecastFeedback, 'Forecast feedback table exists; awaiting resolved forecast outcomes.'),
    notificationPreferences: learningStoreSummary(notificationPreferences, 'Notification preferences table exists; Commander preferences are not configured yet.'),
    notificationQueue: learningStoreSummary(notificationQueue, 'Notification queue table exists; no queued alerts.'),
    specializedAgents: learningStoreSummary(specializedAgents, 'Specialized agents table exists; awaiting Commander-reviewed proposals.'),
  }

  const providerStatus = statusFromRows(counts.economicProviderEffectiveness, 'derived_from_existing_store')
  const memoryStatus = typeof counts.memoryProposalsPending === 'number' || typeof counts.approvedMemories === 'number'
    ? 'live_wired'
    : 'not_connected'
  const outcomeStatus = learningStores.outcomeLedger.status === 'live_persistent'
    ? 'live_persistent'
    : learningStores.outcomeLedger.status === 'awaiting_data'
      ? 'persistent_store'
      : eventSources.some(source => ['audit_logs', 'action_logs'].includes(source.id) && source.status === 'live_wired')
        ? 'derived_from_existing_store'
        : 'awaiting_data'
  const retrievalStatus = statusFromRows(counts.internetLogs, 'not_connected')
  const economicWorkflowStatus = statusFromRows(counts.economicWorkflows, 'not_connected')

  const panelStatuses: LearningIntegrationSnapshot['panelStatuses'] = {
    outcomeLedger: panel(
      outcomeStatus,
      outcomeStatus,
      outcomeStatus === 'live_persistent'
        ? 'Outcome ledger is reading persisted Phase 9B outcome feedback rows.'
        : outcomeStatus === 'persistent_store'
          ? 'Outcome ledger storage is installed and awaiting real outcome feedback rows.'
          : 'Outcome ledger falls back to audit/action-derived context until Phase 9B outcome rows arrive.',
      ['war_room_outcome_ledger', 'war_room_audit_logs', 'war_room_action_logs'],
      outcomeStatus === 'live_persistent' || outcomeStatus === 'persistent_store' ? [] : ['Apply Phase 9B learning storage and record outcome rows.'],
    ),
    providerScorecards: panel(
      providerStatus,
      providerStatus,
      providerStatus === 'live_wired'
        ? 'Provider cards are enriched by persisted economic provider effectiveness rows.'
        : 'Provider cards use baseline scorecards plus configuration sweep; measured provider outcomes are awaiting rows.',
      ['lib/learning/providerPerformanceTracker.ts', 'configuration sweep', 'war_room_economic_provider_effectiveness'],
      counts.economicProviderEffectiveness ? [] : ['No measured provider scorecard history beyond configured provider/economic rows.'],
    ),
    doctrine: panel(
      learningStores.doctrineEntries.status === 'live_persistent' ? 'live_persistent' : learningStores.doctrineEntries.status === 'awaiting_data' ? 'persistent_store' : 'awaiting_data',
      learningStores.doctrineEntries.status === 'live_persistent' ? 'live_persistent' : learningStores.doctrineEntries.status === 'awaiting_data' ? 'persistent_store' : 'awaiting_data',
      learningStores.doctrineEntries.status === 'live_persistent'
        ? 'Doctrine panel can read persisted threshold-reviewed doctrine entries.'
        : 'Doctrine persistence exists only after migration and remains candidate/awaiting data until threshold + Red Team + Commander gates are met.',
      ['war_room_doctrine_entries', 'lib/learning/doctrineEngine.ts', 'lib/repair/repairLedger.ts'],
      learningStores.doctrineEntries.status === 'not_connected' ? ['Doctrine storage is not connected yet.'] : [],
    ),
    narrativeGraph: panel(
      learningStores.narrativeGraph.status === 'live_persistent' ? 'live_persistent' : learningStores.narrativeGraph.status === 'awaiting_data' ? 'persistent_store' : 'awaiting_data',
      learningStores.narrativeGraph.status === 'live_persistent' ? 'live_persistent' : learningStores.narrativeGraph.status === 'awaiting_data' ? 'persistent_store' : 'awaiting_data',
      learningStores.narrativeGraph.status === 'live_persistent'
        ? 'Narrative graph panel can read persisted relationship and contradiction-cluster observations.'
        : 'Narrative graph storage is ready after migration and awaits relationship observations.',
      ['war_room_narrative_graph', 'lib/learning/narrativeGraph.ts'],
      learningStores.narrativeGraph.status === 'not_connected' ? ['Narrative graph storage is not connected yet.'] : [],
    ),
    forecastSimulation: panel(
      learningStores.forecastFeedback.status === 'live_persistent' ? 'live_persistent' : learningStores.forecastFeedback.status === 'awaiting_data' ? 'persistent_store' : retrievalStatus === 'live_wired' || economicWorkflowStatus === 'live_wired' ? 'derived_from_existing_store' : 'awaiting_data',
      learningStores.forecastFeedback.status === 'live_persistent' ? 'live_persistent' : learningStores.forecastFeedback.status === 'awaiting_data' ? 'persistent_store' : 'awaiting_data',
      'Forecasts remain scenario support; persistent feedback can compare predictions to actuals and record variance without triggering action.',
      ['war_room_forecast_feedback', 'lib/learning/forecastingEngine.ts', 'war_room_internet_logs', 'war_room_economic_workflow_queue'],
      learningStores.forecastFeedback.status === 'not_connected' ? ['Forecast feedback storage is not connected yet.'] : [],
    ),
    backgroundWorkers: panel(
      'live_wired',
      'live_wired',
      'Worker monitor uses live in-memory worker counters and resource gates; worker plans remain monitor-only.',
      ['lib/workers/limits.ts', 'lib/learning/backgroundWorkerCoordinator.ts'],
    ),
    resourceAwareness: panel(
      'live_wired',
      'live_wired',
      'Resource awareness is wired to live host memory/process and worker counter snapshots.',
      ['lib/system/resourceMonitor.ts', 'lib/workers/limits.ts', 'configuration sweep'],
    ),
    agentEvolution: panel(
      learningStores.specializedAgents.status === 'live_persistent' ? 'live_persistent' : learningStores.specializedAgents.status === 'awaiting_data' ? 'persistent_store' : 'awaiting_data',
      learningStores.specializedAgents.status === 'live_persistent' ? 'live_persistent' : learningStores.specializedAgents.status === 'awaiting_data' ? 'persistent_store' : 'awaiting_data',
      'Specialized agent proposals are persisted for Commander review; storage never spawns agents autonomously.',
      ['war_room_specialized_agents', 'lib/learning/agentEvolutionEngine.ts', 'lib/learning/strategicPatternDetector.ts'],
      learningStores.specializedAgents.status === 'not_connected' ? ['Specialized agent governance storage is not connected yet.'] : [],
    ),
    escalationQueue: panel(
      learningStores.notificationQueue.status === 'live_persistent' ? 'live_persistent' : learningStores.notificationQueue.status === 'awaiting_data' ? 'persistent_store' : 'derived_from_existing_store',
      learningStores.notificationQueue.status === 'live_persistent' ? 'live_persistent' : learningStores.notificationQueue.status === 'awaiting_data' ? 'persistent_store' : 'derived_from_existing_store',
      'Escalations can persist to a Commander-controlled queue; delivery readiness is dashboard-only and external dispatch remains disabled.',
      ['war_room_notification_queue', 'war_room_notification_preferences', 'lib/learning/escalationPlanner.ts', 'worker counters'],
      learningStores.notificationQueue.status === 'not_connected' ? ['Notification queue storage is not connected yet.'] : [],
    ),
    patternsWorkflow: panel(
      economicWorkflowStatus === 'live_wired' ? 'derived_from_existing_store' : 'static_seed',
      economicWorkflowStatus === 'live_wired' ? 'derived_from_existing_store' : 'static_seed',
      economicWorkflowStatus === 'live_wired'
        ? 'Workflow learning is enriched by economic workflow rows and static repair/outcome patterns.'
        : 'Workflow learning uses seed patterns and repair ledger until persisted workflow events arrive.',
      ['lib/learning/workflowOutcomeTracker.ts', 'lib/repair/repairLedger.ts', 'war_room_economic_workflow_queue'],
    ),
  }

  const notConnectedGaps = Object.values(panelStatuses)
    .flatMap(status => status.gaps)
    .concat(eventSources.filter(source => source.status === 'not_connected').map(source => `${source.label}: ${source.detail}`))

  return {
    generatedAt,
    persistenceAvailable,
    guardrails: {
      externalExecutionAllowed: false,
      commanderApprovalRequired: true,
      readOnlySnapshot: true,
    },
    panelStatuses,
    eventSources,
    counts,
    providerRuntime: {
      configuredProviders: configuration.summary.totalProvidersConfigured,
      totalProviders: configuration.summary.totalProviders,
      degradedSystems: configuration.summary.degradedSystems,
      economicProviderRows: counts.economicProviderEffectiveness,
      status: providerStatus,
    },
    repair: {
      totalEntries: repairHistory.totalEntries,
      monitorEntries: repairHistory.entriesByStatus.monitor,
      unresolvedEntries: repairHistory.entriesByStatus.unresolved,
      unresolvedWarnings: unresolvedRepair.items.length,
      rollbackCheckpoints: repairHistory.rollbackCheckpoints.length,
    },
    economic: economicStats,
    memory: {
      pendingProposals: counts.memoryProposalsPending,
      approvedMemories: counts.approvedMemories,
      status: memoryStatus,
    },
    system: {
      memoryUsageRatio: resourceSnapshot.memoryUsageRatio,
      workerQueueDepth: workerCounters.workerQueueDepth,
      activeWorkers: workerCounters.activeWorkers,
      activeScans: workerCounters.activeScans,
      internetPollsInWindow: workerCounters.internetPollsInWindow,
      memoryWarning: resourceSnapshot.warnings.memory,
      cpuWarning: resourceSnapshot.warnings.cpu,
    },
    notConnectedGaps,
    learningStores,
    recentPersistent,
  }
}
