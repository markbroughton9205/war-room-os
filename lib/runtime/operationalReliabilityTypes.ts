import type { ProviderRuntimeHealth } from '@/lib/providers/health'

export type TruthBoundaryLabel =
  | 'VERIFIED'
  | 'SOURCE_BACKED'
  | 'ADVISORY'
  | 'ESTIMATED'
  | 'EXPERIMENTAL'
  | 'DEGRADED'
  | 'READ_ONLY'
  | 'UNAVAILABLE'
  | 'FALLBACK'

export type OperationalMode =
  | 'EXPERIMENTAL'
  | 'DEVELOPMENT'
  | 'STABLE'
  | 'DEGRADED'
  | 'RECOVERY'
  | 'OBSERVATION_ONLY'

export type RuntimeSystemId =
  | 'provider_runtime'
  | 'signals'
  | 'revenue_engine'
  | 'commander_os'
  | 'growth_calendar'
  | 'outcome_ledger'
  | 'feature_builder'
  | 'baby_ai'
  | 'daily_briefing'
  | 'red_sentinel'
  | 'engineering_lane'
  | 'approval_queue'

export type DependencyHealth = 'verified' | 'source_backed' | 'degraded' | 'blocked' | 'stale' | 'fallback' | 'unavailable'

export type RuntimeDependencyNode = {
  id: RuntimeSystemId
  label: string
  truthBoundary: TruthBoundaryLabel
  mode: OperationalMode
  health: DependencyHealth
  upstream: RuntimeSystemId[]
  downstream: RuntimeSystemId[]
  degradedReason: string | null
  staleAfterMs: number
  lastVerifiedAt: string | null
  fallbackMode: boolean
  isolatedFailure: boolean
  blockedBy: RuntimeSystemId[]
  evidence: string
  continuity: string
  recovery: string
}

export type RuntimeDependencyEdge = {
  from: RuntimeSystemId
  to: RuntimeSystemId
  relationship: 'feeds' | 'gates' | 'informs' | 'persists' | 'protects'
  impactWhenDegraded: string
}

export type RuntimeDependencyGraph = {
  generatedAt: string
  nodes: RuntimeDependencyNode[]
  edges: RuntimeDependencyEdge[]
  propagation: RuntimePropagationRecord[]
  blockedSystems: RuntimeDependencyNode[]
  staleSystems: RuntimeDependencyNode[]
  fallbackSystems: RuntimeDependencyNode[]
  isolatedFailures: RuntimeDependencyNode[]
}

export type RuntimePropagationRecord = {
  source: RuntimeSystemId
  affected: RuntimeSystemId
  reason: string
  impact: string
  continuity: string
}

export type RuntimeDegradedRecord = {
  systemId: RuntimeSystemId
  label: string
  why: string
  impact: string
  recovery: string
  downstreamConsequences: string[]
  continuity: string
  truthBoundary: TruthBoundaryLabel
}

export type ProviderRuntimeSnapshot = {
  provider: string
  providerId: string
  latencyMs: number | null
  checkedAt: string
  lastSuccessAt: string | null
  failureCount: number
  degradedReason: string | null
  timeoutCount: number
  rateLimitState: 'ok' | 'rate_limited' | 'unknown'
  rateLimitResetAt: string | null
  activeModels: string[]
  signalAvailability: boolean
  fallbackMode: boolean
  health: ProviderRuntimeHealth
  truthBoundary: TruthBoundaryLabel
}

export type RuntimeObservability = {
  lastSuccessfulOrchestrationAt: string | null
  failedOrchestrationCount: number
  providerFailureHistory: Array<{ providerId: string; health: ProviderRuntimeHealth; note: string; checkedAt: string }>
  staleDataAgeMs: number | null
  signalFreshness: DependencyHealth
  dependencyHealth: Record<RuntimeSystemId, DependencyHealth>
  blockedPacketGeneration: boolean
  orphanSystems: RuntimeSystemId[]
  runtimeDrift: string[]
}

export type RuntimeRollbackAwareness = {
  mode: 'READ_ONLY'
  recentDeployment: string | null
  deploymentProvider: string | null
  recoveryPoint: string | null
  unstableReleaseSignals: string[]
  automaticRollbackAllowed: false
  note: string
}

export type RuntimeReliabilitySnapshot = {
  generatedAt: string
  mode: OperationalMode
  graph: RuntimeDependencyGraph
  degraded: RuntimeDegradedRecord[]
  providers: ProviderRuntimeSnapshot[]
  observability: RuntimeObservability
  rollbackAwareness: RuntimeRollbackAwareness
  recommendations: string[]
  persistence: {
    configured: boolean
    snapshotsPersisted: boolean
    error: string | null
  }
  guardrails: {
    hiddenExecution: false
    autonomousShellExecution: false
    fakeProviderStates: false
    fakeTelemetry: false
    fakeSuccessClaims: false
    deploymentExecution: false
    browserFilesystemMutation: false
    automaticRollback: false
  }
}
