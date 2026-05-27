/**
 * Unified engine control types (Phase 2). Used by status API, command router, and UI.
 */

export type EngineId =
  | 'cursor'
  | 'codex'
  | 'grok'
  | 'claude'
  | 'chatgpt'
  | 'gemini'
  | 'kimi'

/** Where the engine typically runs. */
export type EngineCategory = 'manual_workspace' | 'ide' | 'cloud' | 'cloud_model'

/** Upstream or transport kind (routing hints only). */
export type ProviderType =
  | 'openai'
  | 'anthropic'
  | 'xai'
  | 'google'
  | 'moonshot'
  | 'ide_external'

/** Capability tags for routing and permission hints. */
export type EngineCapabilityId =
  | 'chat_completion'
  | 'chat'
  | 'code_assist'
  | 'agent_loop'
  | 'repo_read'
  | 'repo_write'
  | 'terminal'
  | 'internet'
  | 'research'
  | 'reasoning'
  /** Internet-backed research assist; only advertised when same-origin internet tool status is reachable. */
  | 'research_assist'

export type EngineCapabilities = readonly EngineCapabilityId[]

/** Derived policy view for one engine from its live status. */
export type EnginePermissions = {
  /** Safe natural-language / prompt-only work. */
  allowPromptOnly: boolean
  allowInternet: boolean
  allowResearch: boolean
  allowRepoRead: boolean
  allowRepoWrite: boolean
}

export type ProviderAvailabilityDiagnostic = {
  providerId: string
  familyId: string | null
  configured: boolean
  apiKeyPresent: boolean
  registryStatus: 'registered' | 'missing'
  lastCheckResult: string
  reason?: string
}

export type EngineStatus = {
  id: EngineId
  displayName: string
  category: EngineCategory
  providerType: ProviderType
  /** Binary where known; IDE/CLI bridges may stay false with explanatory notes. */
  installed: boolean
  configured: boolean
  reachable: boolean
  functional: boolean
  capabilities: EngineCapabilities
  permissions: EnginePermissions
  /**
   * Baseline flag from `computeApprovalRequired(this, 'read_only_query')` in status collection
   * (`lib/engine-control/permissions.ts`): true when the engine is not reachable/functional (treat as
   * needing policy review). For execution, each command class re-runs `computeApprovalRequired(engine,
   * commandClass)` — `internet`, `research`, `repo_mutation`, and `terminal` require explicit
   * approvals when the engine is otherwise healthy.
   */
  approvalRequired: boolean
  lastChecked: string
  /**
   * Human-readable upstream/provider for the status table (e.g. "Google Gemini" for Gemini).
   * Populated in `collectEngineStatuses` — not derived from secrets.
   */
  providerLabel: string
  /**
   * ISO 8601 time of the last **successful** end-to-end probe. For Gemini, set only after
   * list-models and a minimal `generateContent` both succeed. Null/omitted when never succeeded.
   */
  lastSuccessfulProbeAt?: string | null
  /** When a live probe picked a working `generateContent` model id (Gemini). */
  probedModelId?: string | null
  providerDiagnostics?: ProviderAvailabilityDiagnostic
  notes: string
}

export type EngineControlStatusResponse = {
  engines: EngineStatus[]
  configuredProviders: EngineId[]
  reachableProviders: EngineId[]
  functionalProviders: EngineId[]
  routingReadiness: 'ready' | 'degraded' | 'unavailable'
  approvalRequired: boolean
  timestamp: string
  degradedReason: string | null
  checkedAt: string
}

export type CommandApprovals = {
  write?: boolean
  commit?: boolean
  rollback?: boolean
  internet?: boolean
  research?: boolean
  terminal?: boolean
}

/** Optional tool reachability passed into the pure router (built in API routes, not inside router). */
export type ToolRoutingSnapshot = {
  internetReachable: boolean
  researchConfigured: boolean
}

export type RouteCommandBody = {
  command: string
  approvals?: CommandApprovals
}
