import { buildConfigurationSweep } from '@/lib/configuration/configurationHealth'
import { listEconomicSurface } from '@/lib/economic/store'
import { summarizePatchHistory } from '@/lib/repair/patchHistorySummarizer'
import { buildUnresolvedRepairTracker } from '@/lib/repair/unresolvedRepairTracker'
import { getResourceSnapshot } from '@/lib/system/resourceMonitor'
import { tryWarRoomSupabase, type WarRoomSupabase } from '@/lib/war-room/persistence'
import { getWorkerLimitCounters } from '@/lib/workers/limits'

export type LearningIntegrationStatus = 'live_wired' | 'derived_from_existing_store' | 'static_seed' | 'not_connected'

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
}

type CountResult = {
  records: number | null
  lastEventAt: string | null
  error?: string
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
    ])

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
  }

  const providerStatus = statusFromRows(counts.economicProviderEffectiveness, 'derived_from_existing_store')
  const memoryStatus = typeof counts.memoryProposalsPending === 'number' || typeof counts.approvedMemories === 'number'
    ? 'live_wired'
    : 'not_connected'
  const outcomeStatus = eventSources.some(source => ['audit_logs', 'action_logs'].includes(source.id) && source.status === 'live_wired')
    ? 'live_wired'
    : 'static_seed'
  const retrievalStatus = statusFromRows(counts.internetLogs, 'not_connected')
  const economicWorkflowStatus = statusFromRows(counts.economicWorkflows, 'not_connected')

  const panelStatuses: LearningIntegrationSnapshot['panelStatuses'] = {
    outcomeLedger: panel(
      outcomeStatus,
      outcomeStatus === 'live_wired' ? 'live_wired' : 'static_seed',
      outcomeStatus === 'live_wired'
        ? 'Displays seed outcomes plus real audit/action event-source counts.'
        : 'Baseline outcomes are static seeds; persisted audit/action streams are awaiting connection or rows.',
      ['lib/learning/outcomeLedger.ts', 'war_room_audit_logs', 'war_room_action_logs'],
      outcomeStatus === 'live_wired' ? [] : ['No dedicated persisted Phase 9B outcome ledger table yet.'],
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
      'static_seed',
      'static_seed',
      'Doctrine entries are promoted seed principles backed by local outcome/repair evidence, not a persisted doctrine table.',
      ['lib/learning/doctrineEngine.ts', 'lib/repair/repairLedger.ts'],
      ['No Commander-approved doctrine persistence table yet.'],
    ),
    narrativeGraph: panel(
      'static_seed',
      'static_seed',
      'Narrative graph is a seed topology; no persisted event/person/source graph store exists yet.',
      ['lib/learning/narrativeGraph.ts'],
      ['No persisted narrative/event relationship graph yet.'],
    ),
    forecastSimulation: panel(
      retrievalStatus === 'live_wired' || economicWorkflowStatus === 'live_wired' ? 'derived_from_existing_store' : 'static_seed',
      retrievalStatus === 'live_wired' || economicWorkflowStatus === 'live_wired' ? 'derived_from_existing_store' : 'static_seed',
      'Forecasts remain scenario support; retrieval/economic streams provide context but do not auto-trigger action.',
      ['lib/learning/forecastingEngine.ts', 'war_room_internet_logs', 'war_room_economic_workflow_queue'],
      ['No persisted forecast accuracy feedback table yet.'],
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
      'static_seed',
      'static_seed',
      'Agent proposals are derived from seed patterns and doctrine constraints; no autonomous agent expansion is enabled.',
      ['lib/learning/agentEvolutionEngine.ts', 'lib/learning/strategicPatternDetector.ts'],
      ['No Commander-approved specialized-agent registry table yet.'],
    ),
    escalationQueue: panel(
      'derived_from_existing_store',
      'derived_from_existing_store',
      'Escalations are planned from anomalies, repair warnings, and worker/forecast signals; notification delivery is disabled.',
      ['lib/learning/escalationPlanner.ts', 'lib/repair/repairLedger.ts', 'worker counters'],
      ['No persisted Commander notification preference/dispatch queue yet.'],
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
  }
}
