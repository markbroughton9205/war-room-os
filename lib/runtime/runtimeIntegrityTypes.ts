/** War Room runtime integrity dashboard — subsystem health classification (read-only diagnostics). */

export type OverallStatus = 'HEALTHY' | 'DEGRADED' | 'FAILING' | 'PARTIAL' | 'UNKNOWN'

export type SubsystemOperationalStatus =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'FAILING'
  | 'UNWIRED'
  | 'MOCK'
  | 'UNKNOWN'
  | 'CONFIGURED_ONLY'

export type TruthLevel = 'VERIFIED' | 'PARTIAL' | 'DECLARED' | 'UNKNOWN'

export type SubsystemSource = 'fetch' | 'supabase' | 'import' | 'declared'

export type SubsystemRow = {
  id: string
  label: string
  status: SubsystemOperationalStatus
  truthLevel: TruthLevel
  evidence: string
  risk: 'low' | 'medium' | 'high'
  source: SubsystemSource
  mock: boolean
  unwired: boolean
  configured: boolean
  reachable: boolean
  recommendation: string
}

/** Per-engine / cloud slot summary — only fields we can evidence from engine-control + provider hints. */
export type ProviderIntegritySlot = {
  id: string
  displayName?: string
  configured: boolean
  reachable: boolean
  functional: boolean
  /** True when configured but not fully functional (degraded path). */
  degraded: boolean
  /** True when configured but unreachable/non-functional in a hard-fail sense. */
  failed: boolean
  /** Included only when a counter exists server-side; otherwise omitted. */
  timeoutCount?: number
  lastSuccess: string | null
  lastFailure: string | null
  lastResponseMs: number | null
}

export type InternetLayerRollup = {
  lastChecked?: string | null
  overallStatus?: string | null
  label?: string | null
  tavily?: { keyPresent?: boolean; configured?: boolean; reachable?: boolean; notes?: string }
  firecrawl?: { keyPresent?: boolean; configured?: boolean; reachable?: boolean; notes?: string }
  grok?: { apiKeyPresent?: boolean; status?: string; notes?: string }
  gemini?: { apiKeyPresent?: boolean; configured?: boolean; reachable?: boolean; notes?: string }
  fetch?: { allowed?: boolean; exampleComProbe?: { status?: string; notes?: string } }
}

export type PersistenceTableProbeStatus = 'HEALTHY' | 'FAILING' | 'UNKNOWN'

export type PersistenceRollup = {
  conversations: PersistenceTableProbeStatus
  messages: PersistenceTableProbeStatus
  actions: PersistenceTableProbeStatus
  audit: PersistenceTableProbeStatus
  memoryProposals: PersistenceTableProbeStatus
  /**
   * When server URL is present but browser bundle likely cannot use Supabase (no anon key),
   * some flows may rely on sessionStorage — inferred from env only, not client inspection.
   */
  clientOnlyPersistenceFallbackLikely: boolean
}

export type ToolLayerClassification = 'LIVE' | 'PARTIAL' | 'DEGRADED' | 'UNWIRED' | 'MOCK'

export type ToolsLayerRollup = {
  internetToolStatus: ToolLayerClassification
  researchAdapters: ToolLayerClassification
  notes?: string
}

export type RuntimeHealthRollup = {
  /** Echoed only when client passes `?councilMode=` — not inferred. */
  councilModeFromQuery?: string | null
  orchestrationQueueDepth: number
  unresolvedFailures: { subsystemId: string; label: string }[]
}

export type DeploymentIntegrityRollup = {
  /** From deploy status payload when present (env / platform). */
  commitShort: string | null
  lastDeployment: string | null
  provider: string | null
  checkedAt: string | null
}

export type RuntimeIntegrityResponse = {
  generatedAt: string
  overallStatus: OverallStatus
  subsystems: SubsystemRow[]
  /** No cross-request attendance snapshot on the server — stays UNKNOWN unless a future store exists. */
  attendanceParticipation: 'UNKNOWN'
  providers: ProviderIntegritySlot[]
  internetRollup: InternetLayerRollup | null
  persistence: PersistenceRollup
  runtimeHealth: RuntimeHealthRollup
  toolsLayer: ToolsLayerRollup
  deployment: DeploymentIntegrityRollup
}
