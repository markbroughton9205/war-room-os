// AGI Wave 1 — Context Assembler contracts.
// Deterministic assembly of a bounded, inspectable ContextSnapshot from existing War Room state
// (project, open loops, thread summary, memory records, prompt artifacts, recent messages, and
// an optional caller-supplied Terra snapshot). Never injected into the live provider prompt in
// Wave 1 — computed and persisted for inspection/validation only (see lib/context-assembler/assemble.ts).

export type ContextSourceRef = {
  type: 'directive' | 'project' | 'open_loop' | 'summary' | 'memory_record' | 'artifact' | 'message' | 'terra' | 'world_knowledge'
  id: string
  label?: string
}

export type ContextSectionKind =
  | 'identity'
  | 'directives'
  | 'project'
  | 'open_loops'
  | 'summary'
  | 'memories'
  | 'artifacts'
  | 'recent_messages'
  | 'terra'
  | 'world_knowledge'

export type ContextSection = {
  kind: ContextSectionKind
  heading: string
  text: string
  tokenEstimate: number
  sourceRefs: ContextSourceRef[]
}

export type ContextBudget = {
  totalTokens: number
  sectionCaps: Record<ContextSectionKind, number>
}

export type TerraSnapshotInput = {
  activeLocation?: unknown
  selectedEvent?: unknown
  aircraftSummary?: unknown
  maritimeSummary?: unknown
  layerCoverage?: unknown
  capturedAt?: string
} | null

export type ProjectRow = {
  id: string
  name: string
  description: string | null
  status: string
  current_objective: string | null
  current_phase: string | null
}

export type OpenLoopRow = {
  id: string
  title: string
  description: string | null
  status: string
  priority: number
  blocked_by: string | null
  next_action: string | null
  updated_at: string
}

export type SessionSummaryRow = {
  id: string
  summary: string
  unfinished_tasks: string[]
  next_recommended_action: string | null
  decisions: string[]
  key_decrees: string[]
}

export type MemoryRecordRow = {
  id: string
  content: string
  memory_type: string
  scope: string
  status: string
  effective_from: string
  importance_tier: string
}

export type PromptArtifactRow = {
  id: string
  intent: string
  target_agent_id: string
  status: string
  created_at: string
}

export type MessageRow = {
  id: string
  role: string
  content: string
  created_at: string
}

export type WorldKnowledgeRow = {
  id: string
  content: string
  status: string
  confidence: number
  scope: string
}

/** Dependency-injected read/write surface so assemble.ts is testable without a live Supabase
 * instance — see lib/context-assembler/supabaseStore.ts (real) and
 * lib/context-assembler/__fixtures__/FakeContextAssemblerStore.ts (test double), mirroring the
 * fake-store pattern already used by lib/council/memory-write-gate. */
export type ContextAssemblerStore = {
  getConversation(conversationId: string): Promise<{ id: string; active_project_id: string | null } | null>
  getProject(projectId: string): Promise<ProjectRow | null>
  getOpenLoops(projectId: string): Promise<OpenLoopRow[]>
  getLatestSessionSummary(conversationId: string): Promise<SessionSummaryRow | null>
  getActiveMemoryRecords(scope: string, projectId: string | null): Promise<MemoryRecordRow[]>
  getRecentPromptArtifacts(conversationId: string, limit: number): Promise<PromptArtifactRow[]>
  getRecentMessages(conversationId: string, limit: number): Promise<MessageRow[]>
  getActiveWorldKnowledge(projectId: string | null, limit: number): Promise<WorldKnowledgeRow[]>
  insertContextSnapshot(row: NewContextSnapshotRow): Promise<ContextSnapshotRow | null>
}

export type NewContextSnapshotRow = {
  conversation_id: string | null
  project_id: string | null
  model_target: Record<string, unknown>
  token_estimate: number
  content_hash: string
  ranking_version: string
  retrieval_strategy_version: string
  included_source_ids: ContextSourceRef[]
  excluded_source_ids: ContextSourceRef[]
  budget_breakdown: Record<string, number>
}

export type ContextSnapshotRow = NewContextSnapshotRow & {
  id: string
  assembled_at: string
}

export type AssembleInfluencePolicy = {
  depth: 'FAST' | 'FULL'
  intent: string
  commanderText: string
  allowDurableMemory: boolean
  includeAssemblerRecentMessages: boolean
  includeProjectState: boolean
  includeTerra: boolean
}

export type AssembleContextInput = {
  conversationId: string | null
  projectIdOverride?: string | null
  terraSnapshot?: TerraSnapshotInput
  modelTarget?: Record<string, unknown>
  /** When omitted, Wave 2 assembly stays unchanged for existing validators. */
  influencePolicy?: AssembleInfluencePolicy | null
}

export type AssembledContext = {
  snapshot: ContextSnapshotRow | null
  promptText: string
  sections: ContextSection[]
  excludedSourceIds: ContextSourceRef[]
}
