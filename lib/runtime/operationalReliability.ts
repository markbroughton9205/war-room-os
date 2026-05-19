import { getProviderRuntimeHealth, type ProviderRuntimeStatus } from '@/lib/providers/health'
import type {
  DependencyHealth,
  OperationalMode,
  ProviderRuntimeSnapshot,
  RuntimeDegradedRecord,
  RuntimeDependencyEdge,
  RuntimeDependencyGraph,
  RuntimeDependencyNode,
  RuntimeObservability,
  RuntimeReliabilitySnapshot,
  RuntimeRollbackAwareness,
  RuntimeSystemId,
  TruthBoundaryLabel,
} from '@/lib/runtime/operationalReliabilityTypes'
import { persistRuntimeReliabilitySnapshot } from '@/lib/runtime/operationalReliabilityPersistence'
import { collectRuntimeIntegrity } from '@/lib/runtime/runtimeIntegrityCollect'
import type { RuntimeIntegrityResponse, SubsystemRow } from '@/lib/runtime/runtimeIntegrityTypes'

const STALE_AFTER_MS = 5 * 60 * 1000

const EDGES: RuntimeDependencyEdge[] = [
  { from: 'provider_runtime', to: 'signals', relationship: 'feeds', impactWhenDegraded: 'Signal freshness and source-backed research confidence are reduced.' },
  { from: 'signals', to: 'revenue_engine', relationship: 'informs', impactWhenDegraded: 'Revenue confidence is advisory until fresh signal evidence returns.' },
  { from: 'provider_runtime', to: 'commander_os', relationship: 'feeds', impactWhenDegraded: 'Commander decisions must be labeled advisory or unavailable by provider family.' },
  { from: 'approval_queue', to: 'commander_os', relationship: 'gates', impactWhenDegraded: 'Commander cannot claim executable approvals; queued action visibility is reduced.' },
  { from: 'signals', to: 'growth_calendar', relationship: 'informs', impactWhenDegraded: 'Growth recommendations become source-stale or estimated.' },
  { from: 'outcome_ledger', to: 'revenue_engine', relationship: 'informs', impactWhenDegraded: 'Revenue scoring loses verified outcome feedback.' },
  { from: 'feature_builder', to: 'engineering_lane', relationship: 'feeds', impactWhenDegraded: 'Engineering packets remain read-only recommendations only.' },
  { from: 'red_sentinel', to: 'engineering_lane', relationship: 'protects', impactWhenDegraded: 'Engineering changes need extra review because scan evidence is stale or unavailable.' },
  { from: 'approval_queue', to: 'feature_builder', relationship: 'gates', impactWhenDegraded: 'Build packets cannot advance beyond draft/advisory state.' },
  { from: 'provider_runtime', to: 'baby_ai', relationship: 'feeds', impactWhenDegraded: 'Baby AI outputs must be experimental or unavailable by provider family.' },
  { from: 'baby_ai', to: 'daily_briefing', relationship: 'informs', impactWhenDegraded: 'Briefing narrative loses Baby AI context and remains advisory.' },
  { from: 'signals', to: 'daily_briefing', relationship: 'informs', impactWhenDegraded: 'Briefing market/context sections become stale or fallback-labeled.' },
  { from: 'approval_queue', to: 'engineering_lane', relationship: 'gates', impactWhenDegraded: 'No packet can imply execution approval.' },
]

const SYSTEM_LABELS: Record<RuntimeSystemId, string> = {
  provider_runtime: 'Provider Runtime',
  signals: 'Signals',
  revenue_engine: 'Revenue Engine',
  commander_os: 'Commander OS',
  growth_calendar: 'Growth Calendar',
  outcome_ledger: 'Outcome Ledger',
  feature_builder: 'Feature Builder',
  baby_ai: 'Baby AI Systems',
  daily_briefing: 'Daily Briefing',
  red_sentinel: 'Red Sentinel',
  engineering_lane: 'Engineering Lane',
  approval_queue: 'Approval Queue',
}

type NodeSeed = {
  id: RuntimeSystemId
  truthBoundary: TruthBoundaryLabel
  mode: OperationalMode
  health: DependencyHealth
  degradedReason: string | null
  lastVerifiedAt: string | null
  fallbackMode: boolean
  isolatedFailure: boolean
  evidence: string
  continuity: string
  recovery: string
}

function subsystemById(integrity: RuntimeIntegrityResponse, id: string): SubsystemRow | null {
  return integrity.subsystems.find(system => system.id === id) ?? null
}

function healthFromSubsystem(row: SubsystemRow | null): DependencyHealth {
  if (!row) return 'unavailable'
  if (row.status === 'FAILING') return 'unavailable'
  if (row.status === 'DEGRADED') return 'degraded'
  if (row.status === 'UNWIRED') return 'unavailable'
  if (row.status === 'CONFIGURED_ONLY') return 'source_backed'
  if (row.status === 'MOCK') return 'fallback'
  if (row.status === 'HEALTHY') return row.truthLevel === 'VERIFIED' ? 'verified' : 'source_backed'
  return 'stale'
}

function truthFromSubsystem(row: SubsystemRow | null): TruthBoundaryLabel {
  if (!row) return 'UNAVAILABLE'
  if (row.status === 'FAILING' || row.status === 'UNWIRED') return 'UNAVAILABLE'
  if (row.status === 'DEGRADED') return 'DEGRADED'
  if (row.status === 'MOCK') return 'FALLBACK'
  if (row.status === 'CONFIGURED_ONLY') return 'SOURCE_BACKED'
  if (row.truthLevel === 'VERIFIED') return 'VERIFIED'
  if (row.truthLevel === 'PARTIAL') return 'SOURCE_BACKED'
  if (row.truthLevel === 'DECLARED') return 'ADVISORY'
  return 'ADVISORY'
}

function providerTruth(provider: ProviderRuntimeStatus): TruthBoundaryLabel {
  if (provider.health === 'CONNECTED') return 'VERIFIED'
  if (provider.health === 'RATE_LIMITED' || provider.health === 'DEGRADED') return 'DEGRADED'
  if (provider.health === 'MISSING_KEY' || provider.health === 'INVALID_KEY') return 'UNAVAILABLE'
  return 'ADVISORY'
}

function buildProviderSnapshots(providers: ProviderRuntimeStatus[]): ProviderRuntimeSnapshot[] {
  return providers.map(provider => {
    const failed = provider.health !== 'CONNECTED' && (!provider.optional || provider.configured)
    const timeout = /timeout|aborted|abort/i.test(provider.note)
    return {
      provider: provider.provider,
      providerId: provider.id,
      latencyMs: provider.latencyMs,
      checkedAt: provider.checkedAt,
      lastSuccessAt: provider.lastSuccessAt,
      failureCount: failed ? 1 : 0,
      degradedReason:
        provider.integrity.degraded_reason
        ?? (provider.health === 'CONNECTED' ? null : provider.note),
      timeoutCount: timeout ? 1 : 0,
      rateLimitState: provider.quotaState,
      rateLimitResetAt: provider.rateLimitResetAt,
      activeModels: provider.activeModels,
      signalAvailability: provider.signalAvailability,
      fallbackMode: provider.health !== 'CONNECTED',
      health: provider.health,
      truthBoundary: providerTruth(provider),
    }
  })
}

function createSeeds(integrity: RuntimeIntegrityResponse, providers: ProviderRuntimeSnapshot[]): NodeSeed[] {
  const providerFailures = providers.filter(provider => provider.failureCount > 0)
  const liveSignals = providers.some(provider => provider.signalAvailability && provider.health === 'CONNECTED')
  const providerRuntimeHealth: DependencyHealth = providerFailures.length ? 'degraded' : 'verified'
  const providerRuntimeTruth: TruthBoundaryLabel = providerFailures.length ? 'DEGRADED' : 'VERIFIED'
  const internet = subsystemById(integrity, 'internet_layer')
  const approval = subsystemById(integrity, 'action_queue')
  const redSentinel = subsystemById(integrity, 'red_sentinel')
  const outcomePersistenceOk = integrity.persistence.conversations === 'HEALTHY' && integrity.persistence.messages === 'HEALTHY'

  return [
    {
      id: 'provider_runtime',
      truthBoundary: providerRuntimeTruth,
      mode: providerFailures.length ? 'DEGRADED' : 'STABLE',
      health: providerRuntimeHealth,
      degradedReason: providerFailures.length ? providerFailures.map(provider => `${provider.provider}: ${provider.degradedReason}`).join('; ') : null,
      lastVerifiedAt: providers.find(provider => provider.lastSuccessAt)?.lastSuccessAt ?? null,
      fallbackMode: providers.some(provider => provider.fallbackMode),
      isolatedFailure: providerFailures.length > 0,
      evidence: providerFailures.length ? `${providerFailures.length}/${providers.length} provider probes degraded or unavailable.` : `${providers.length} provider probes are source-backed by server runtime status.`,
      continuity: 'Provider failures are contained to provider-backed panels and downstream confidence labels.',
      recovery: 'Review provider keys, quotas, and timeout notes; refresh provider checks after remediation.',
    },
    {
      id: 'signals',
      truthBoundary: liveSignals ? truthFromSubsystem(internet) : 'DEGRADED',
      mode: liveSignals ? 'STABLE' : 'DEGRADED',
      health: liveSignals ? healthFromSubsystem(internet) : 'degraded',
      degradedReason: liveSignals ? null : 'No connected signal provider is currently reporting live availability.',
      lastVerifiedAt: integrity.internetRollup?.lastChecked ?? null,
      fallbackMode: !liveSignals,
      isolatedFailure: !liveSignals,
      evidence: integrity.internetRollup?.label ?? internet?.evidence ?? 'Signal providers are unavailable or not yet probed.',
      continuity: 'Revenue, calendar, and briefing panels can continue with stale/advisory labels.',
      recovery: 'Restore Tavily or Firecrawl connectivity; then refresh runtime snapshots.',
    },
    {
      id: 'revenue_engine',
      truthBoundary: liveSignals ? 'SOURCE_BACKED' : 'ESTIMATED',
      mode: liveSignals ? 'DEVELOPMENT' : 'DEGRADED',
      health: liveSignals ? 'source_backed' : 'degraded',
      degradedReason: liveSignals ? null : 'Revenue scoring depends on signal freshness and outcome feedback.',
      lastVerifiedAt: integrity.generatedAt,
      fallbackMode: !liveSignals,
      isolatedFailure: true,
      evidence: 'Revenue Engine remains recommendation-only; confidence changes with signals and outcome persistence.',
      continuity: 'Existing recommendations render as advisory estimates when upstream signals degrade.',
      recovery: 'Restore signals and outcome persistence before treating revenue confidence as source-backed.',
    },
    {
      id: 'commander_os',
      truthBoundary: providerFailures.length ? 'ADVISORY' : 'SOURCE_BACKED',
      mode: providerFailures.length ? 'DEGRADED' : 'DEVELOPMENT',
      health: providerFailures.length ? 'degraded' : 'source_backed',
      degradedReason: providerFailures.length ? 'One or more provider families are degraded.' : null,
      lastVerifiedAt: integrity.generatedAt,
      fallbackMode: providerFailures.length > 0,
      isolatedFailure: true,
      evidence: 'Commander OS depends on provider runtime and approval queue visibility.',
      continuity: 'Commander panels remain readable; action claims stay gated by approvals.',
      recovery: 'Repair provider runtime and approval queue before elevating outputs above advisory.',
    },
    {
      id: 'growth_calendar',
      truthBoundary: liveSignals ? 'SOURCE_BACKED' : 'ESTIMATED',
      mode: liveSignals ? 'DEVELOPMENT' : 'DEGRADED',
      health: liveSignals ? 'source_backed' : 'degraded',
      degradedReason: liveSignals ? null : 'Calendar recommendations lack fresh signal input.',
      lastVerifiedAt: integrity.generatedAt,
      fallbackMode: !liveSignals,
      isolatedFailure: true,
      evidence: 'Growth Calendar is source-backed only when signal freshness is available.',
      continuity: 'Calendar can show existing plans as estimates without blocking the dashboard.',
      recovery: 'Restore signal providers and rerun calendar recommendations.',
    },
    {
      id: 'outcome_ledger',
      truthBoundary: outcomePersistenceOk ? 'VERIFIED' : 'DEGRADED',
      mode: outcomePersistenceOk ? 'STABLE' : 'DEGRADED',
      health: outcomePersistenceOk ? 'verified' : 'degraded',
      degradedReason: outcomePersistenceOk ? null : 'Outcome and conversation persistence probes are not fully healthy.',
      lastVerifiedAt: integrity.generatedAt,
      fallbackMode: !outcomePersistenceOk,
      isolatedFailure: true,
      evidence: `Persistence probes: conversations=${integrity.persistence.conversations}, messages=${integrity.persistence.messages}.`,
      continuity: 'Revenue Engine can continue with estimates but cannot claim verified ROI feedback.',
      recovery: 'Repair Supabase service-role table access and migrations.',
    },
    {
      id: 'feature_builder',
      truthBoundary: 'EXPERIMENTAL',
      mode: 'EXPERIMENTAL',
      health: healthFromSubsystem(approval),
      degradedReason: approval?.status === 'FAILING' ? 'Approval queue persistence is unavailable.' : null,
      lastVerifiedAt: integrity.generatedAt,
      fallbackMode: approval?.status === 'FAILING',
      isolatedFailure: true,
      evidence: 'Feature Builder creates draft packets only; execution remains approval-gated.',
      continuity: 'Draft packet display can continue without implying file writes or deployments.',
      recovery: 'Restore approval queue persistence for packet lifecycle tracking.',
    },
    {
      id: 'baby_ai',
      truthBoundary: 'EXPERIMENTAL',
      mode: providerFailures.length ? 'DEGRADED' : 'EXPERIMENTAL',
      health: providerFailures.length ? 'degraded' : 'source_backed',
      degradedReason: providerFailures.length ? 'Baby AI depends on provider families that are degraded or unavailable.' : null,
      lastVerifiedAt: integrity.generatedAt,
      fallbackMode: providerFailures.length > 0,
      isolatedFailure: true,
      evidence: 'Baby AI systems are experimental and must not be presented as autonomous operators.',
      continuity: 'Experimental panels remain isolated from core dashboard stability.',
      recovery: 'Repair provider runtime before treating Baby AI context as source-backed.',
    },
    {
      id: 'daily_briefing',
      truthBoundary: liveSignals && !providerFailures.length ? 'SOURCE_BACKED' : 'ADVISORY',
      mode: liveSignals && !providerFailures.length ? 'DEVELOPMENT' : 'DEGRADED',
      health: liveSignals && !providerFailures.length ? 'source_backed' : 'degraded',
      degradedReason: liveSignals && !providerFailures.length ? null : 'Briefing depends on provider, signal, and Baby AI context.',
      lastVerifiedAt: integrity.generatedAt,
      fallbackMode: !liveSignals || providerFailures.length > 0,
      isolatedFailure: true,
      evidence: 'Daily briefing is composite intelligence; source labels follow its upstreams.',
      continuity: 'Briefing can render advisory summaries while source-backed sections are unavailable.',
      recovery: 'Restore signal and provider dependencies; keep unavailable sections explicitly labeled.',
    },
    {
      id: 'red_sentinel',
      truthBoundary: truthFromSubsystem(redSentinel),
      mode: redSentinel?.status === 'HEALTHY' ? 'STABLE' : 'DEGRADED',
      health: healthFromSubsystem(redSentinel),
      degradedReason: redSentinel?.status === 'HEALTHY' ? null : redSentinel?.evidence ?? 'Red Sentinel status unavailable.',
      lastVerifiedAt: integrity.generatedAt,
      fallbackMode: redSentinel?.status !== 'HEALTHY',
      isolatedFailure: true,
      evidence: redSentinel?.evidence ?? 'Red Sentinel status missing from runtime integrity.',
      continuity: 'Engineering lane remains read-only and approval-gated when scans degrade.',
      recovery: redSentinel?.recommendation ?? 'Restore Red Sentinel status endpoint and persistence.',
    },
    {
      id: 'engineering_lane',
      truthBoundary: 'READ_ONLY',
      mode: redSentinel?.status === 'HEALTHY' && approval?.status === 'HEALTHY' ? 'OBSERVATION_ONLY' : 'DEGRADED',
      health: redSentinel?.status === 'HEALTHY' && approval?.status === 'HEALTHY' ? 'source_backed' : 'degraded',
      degradedReason: redSentinel?.status !== 'HEALTHY' || approval?.status !== 'HEALTHY' ? 'Engineering packet generation depends on scan and approval visibility.' : null,
      lastVerifiedAt: integrity.generatedAt,
      fallbackMode: redSentinel?.status !== 'HEALTHY' || approval?.status !== 'HEALTHY',
      isolatedFailure: true,
      evidence: 'Engineering lane is read-only; no filesystem mutation is initiated from browser state.',
      continuity: 'Recommendations can render while packet generation is blocked.',
      recovery: 'Restore Red Sentinel and approval queue before packet confidence increases.',
    },
    {
      id: 'approval_queue',
      truthBoundary: truthFromSubsystem(approval),
      mode: approval?.status === 'HEALTHY' ? 'STABLE' : 'DEGRADED',
      health: healthFromSubsystem(approval),
      degradedReason: approval?.status === 'HEALTHY' ? null : approval?.evidence ?? 'Approval queue status unavailable.',
      lastVerifiedAt: integrity.generatedAt,
      fallbackMode: approval?.status !== 'HEALTHY',
      isolatedFailure: approval?.status !== 'HEALTHY',
      evidence: approval?.evidence ?? 'Approval queue status missing from runtime integrity.',
      continuity: 'No downstream system can claim approved execution without queue visibility.',
      recovery: approval?.recommendation ?? 'Repair approval queue persistence.',
    },
  ]
}

function buildGraph(generatedAt: string, seeds: NodeSeed[]): RuntimeDependencyGraph {
  const upstreamByNode = new Map<RuntimeSystemId, RuntimeSystemId[]>()
  const downstreamByNode = new Map<RuntimeSystemId, RuntimeSystemId[]>()
  for (const edge of EDGES) {
    upstreamByNode.set(edge.to, [...(upstreamByNode.get(edge.to) ?? []), edge.from])
    downstreamByNode.set(edge.from, [...(downstreamByNode.get(edge.from) ?? []), edge.to])
  }

  const seedById = new Map(seeds.map(seed => [seed.id, seed]))
  const nodes: RuntimeDependencyNode[] = seeds.map(seed => {
    const upstream = upstreamByNode.get(seed.id) ?? []
    const degradedUpstream = upstream.filter(id => {
      const upstreamSeed = seedById.get(id)
      return Boolean(upstreamSeed && ['degraded', 'blocked', 'fallback', 'unavailable', 'stale'].includes(upstreamSeed.health))
    })
    const health: DependencyHealth = seed.health === 'source_backed' && degradedUpstream.length ? 'blocked' : seed.health
    return {
      ...seed,
      label: SYSTEM_LABELS[seed.id],
      upstream,
      downstream: downstreamByNode.get(seed.id) ?? [],
      health,
      blockedBy: degradedUpstream,
      staleAfterMs: STALE_AFTER_MS,
    }
  })

  const propagation = EDGES.flatMap(edge => {
    const source = nodes.find(node => node.id === edge.from)
    const affected = nodes.find(node => node.id === edge.to)
    if (!source || !affected) return []
    if (!['degraded', 'blocked', 'fallback', 'unavailable', 'stale'].includes(source.health)) return []
    return [{
      source: edge.from,
      affected: edge.to,
      reason: source.degradedReason ?? source.evidence,
      impact: edge.impactWhenDegraded,
      continuity: affected.continuity,
    }]
  })

  return {
    generatedAt,
    nodes,
    edges: EDGES,
    propagation,
    blockedSystems: nodes.filter(node => node.health === 'blocked' || node.blockedBy.length > 0),
    staleSystems: nodes.filter(node => node.health === 'stale'),
    fallbackSystems: nodes.filter(node => node.fallbackMode || node.health === 'fallback'),
    isolatedFailures: nodes.filter(node => node.isolatedFailure && ['degraded', 'unavailable', 'blocked'].includes(node.health)),
  }
}

function buildDegradedRecords(graph: RuntimeDependencyGraph): RuntimeDegradedRecord[] {
  return graph.nodes
    .filter(node => ['degraded', 'blocked', 'fallback', 'unavailable', 'stale'].includes(node.health))
    .map(node => ({
      systemId: node.id,
      label: node.label,
      why: node.degradedReason ?? node.evidence,
      impact: node.downstream.length
        ? `Downstream affected: ${node.downstream.map(id => SYSTEM_LABELS[id]).join(', ')}.`
        : 'No downstream system is directly dependent on this node.',
      recovery: node.recovery,
      downstreamConsequences: graph.propagation
        .filter(record => record.source === node.id)
        .map(record => `${SYSTEM_LABELS[record.affected]}: ${record.impact}`),
      continuity: node.continuity,
      truthBoundary: node.truthBoundary,
    }))
}

function buildMode(integrity: RuntimeIntegrityResponse, degraded: RuntimeDegradedRecord[]): OperationalMode {
  if (degraded.some(record => record.truthBoundary === 'UNAVAILABLE')) return 'RECOVERY'
  if (degraded.length || integrity.overallStatus === 'DEGRADED' || integrity.overallStatus === 'FAILING') return 'DEGRADED'
  if (process.env.NODE_ENV === 'production') return 'STABLE'
  return 'DEVELOPMENT'
}

function buildObservability(
  generatedAt: string,
  graph: RuntimeDependencyGraph,
  providers: ProviderRuntimeSnapshot[],
): RuntimeObservability {
  const generatedMs = Date.parse(generatedAt)
  const staleDataAgeMs = Number.isFinite(generatedMs) ? Math.max(0, Date.now() - generatedMs) : null
  const dependencyHealth = Object.fromEntries(graph.nodes.map(node => [node.id, node.health])) as Record<RuntimeSystemId, DependencyHealth>
  return {
    lastSuccessfulOrchestrationAt: null,
    failedOrchestrationCount: 0,
    providerFailureHistory: providers
      .filter(provider => provider.health !== 'CONNECTED')
      .map(provider => ({
        providerId: provider.providerId,
        health: provider.health,
        note: provider.degradedReason ?? 'Provider did not report CONNECTED.',
        checkedAt: provider.checkedAt,
      })),
    staleDataAgeMs,
    signalFreshness: dependencyHealth.signals,
    dependencyHealth,
    blockedPacketGeneration: graph.nodes.some(node => node.id === 'engineering_lane' && ['blocked', 'degraded', 'unavailable'].includes(node.health)),
    orphanSystems: graph.nodes
      .filter(node => node.upstream.length === 0 && node.downstream.length === 0)
      .map(node => node.id),
    runtimeDrift: graph.propagation.map(record => `${SYSTEM_LABELS[record.source]} -> ${SYSTEM_LABELS[record.affected]}: ${record.impact}`),
  }
}

function buildRollbackAwareness(integrity: RuntimeIntegrityResponse): RuntimeRollbackAwareness {
  const unstableReleaseSignals = [
    ...integrity.currentFailures.map(failure => `${failure.label}: ${failure.severity}`),
    ...integrity.historicalWarnings.map(warning => `${warning.label}: ${warning.severity}`),
  ].slice(0, 8)

  return {
    mode: 'READ_ONLY',
    recentDeployment: integrity.deployment.lastDeployment,
    deploymentProvider: integrity.deployment.provider,
    recoveryPoint: integrity.deployment.commitShort,
    unstableReleaseSignals,
    automaticRollbackAllowed: false,
    note: 'Rollback awareness is read-only. No rollback, deployment, filesystem mutation, or shell command is executed by runtime diagnostics.',
  }
}

function recommendationsFor(snapshot: Omit<RuntimeReliabilitySnapshot, 'recommendations' | 'persistence'>): string[] {
  const recs = new Set<string>()
  if (snapshot.graph.fallbackSystems.length) recs.add('Keep fallback systems visibly labeled and avoid confidence upgrades until upstream probes recover.')
  if (snapshot.observability.blockedPacketGeneration) recs.add('Hold Engineering Lane packet generation in read-only advisory mode until approval and scan dependencies recover.')
  if (snapshot.providers.some(provider => provider.health === 'RATE_LIMITED')) recs.add('Respect provider rate-limit reset windows before refreshing provider checks.')
  if (snapshot.graph.propagation.some(record => record.source === 'signals')) recs.add('Treat Revenue Engine and Growth Calendar confidence as estimated while signal freshness is degraded.')
  if (!recs.size) recs.add('Continue observation-only monitoring; keep truth labels visible even when systems are stable.')
  return Array.from(recs)
}

export async function collectRuntimeReliabilitySnapshot(
  req: Request,
  opts: { persist?: boolean; forceProviders?: boolean } = {},
): Promise<RuntimeReliabilitySnapshot> {
  const [integrity, providerRuntime] = await Promise.all([
    collectRuntimeIntegrity(req),
    getProviderRuntimeHealth({ force: opts.forceProviders }),
  ])
  const providerSnapshots = buildProviderSnapshots(providerRuntime.providers)
  const graph = buildGraph(integrity.generatedAt, createSeeds(integrity, providerSnapshots))
  const degraded = buildDegradedRecords(graph)
  const mode = buildMode(integrity, degraded)
  const observability = buildObservability(integrity.generatedAt, graph, providerSnapshots)
  const rollbackAwareness = buildRollbackAwareness(integrity)

  const base = {
    generatedAt: integrity.generatedAt,
    mode,
    graph,
    degraded,
    providers: providerSnapshots,
    observability,
    rollbackAwareness,
    guardrails: {
      hiddenExecution: false,
      autonomousShellExecution: false,
      fakeProviderStates: false,
      fakeTelemetry: false,
      fakeSuccessClaims: false,
      deploymentExecution: false,
      browserFilesystemMutation: false,
      automaticRollback: false,
    },
  } satisfies Omit<RuntimeReliabilitySnapshot, 'recommendations' | 'persistence'>

  const withRecommendations = {
    ...base,
    recommendations: recommendationsFor(base),
    persistence: { configured: false, snapshotsPersisted: false, error: null },
  } satisfies RuntimeReliabilitySnapshot

  if (!opts.persist) return withRecommendations

  const persistence = await persistRuntimeReliabilitySnapshot(withRecommendations)
  return { ...withRecommendations, persistence }
}
