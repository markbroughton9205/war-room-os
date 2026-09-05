/**
 * WR-Engineer Phase 1 — shared domain types.
 *
 * Foundation-only: these types describe the agent runtime's shape (state machine, mission
 * context, epistemic labeling, model abstraction) without granting any new write/execute
 * capability. Every capability that actually touches the filesystem, a shell, or git remains a
 * thin delegation to existing, already-governed War Room subsystems — see readSurface.ts,
 * validation.ts, codeEditProposals.ts, and each file's own header for exactly which existing
 * module it delegates to.
 */
import type { ProviderFailureClass } from './providerFailure'

// ---------------------------------------------------------------------------
// Epistemic labeling (SOUL.md §6) — every factual claim WR-Engineer records or reports carries one
// of these. Not decoration: evals assert this type is actually used on memory/model-adapter output.
// ---------------------------------------------------------------------------

export const EPISTEMIC_STATUSES = ['OBSERVED', 'INFERENCE', 'UNKNOWN', 'NOT_VERIFIED'] as const
export type EpistemicStatus = (typeof EPISTEMIC_STATUSES)[number]

export function isEpistemicStatus(value: string): value is EpistemicStatus {
  return (EPISTEMIC_STATUSES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// Agent state machine
// ---------------------------------------------------------------------------

export const AGENT_STATES = ['READY', 'WORKING', 'BLOCKED', 'VALIDATING', 'COMPLETE', 'FAILED'] as const
export type AgentState = (typeof AGENT_STATES)[number]

/** Explicit allowed transition graph, same discipline as lib/native-builder's
 * NATIVE_REPAIR_TRANSITIONS — an unlisted transition is rejected, never silently allowed. */
export const AGENT_STATE_TRANSITIONS: Record<AgentState, readonly AgentState[]> = {
  READY: ['WORKING'],
  WORKING: ['BLOCKED', 'VALIDATING', 'COMPLETE', 'FAILED'],
  BLOCKED: ['WORKING', 'FAILED'],
  VALIDATING: ['WORKING', 'COMPLETE', 'FAILED'],
  COMPLETE: ['READY'],
  FAILED: ['READY'],
}

export type AgentStateHistoryEntry = {
  state: AgentState
  at: string
  note?: string
}

// ---------------------------------------------------------------------------
// Mission context
// ---------------------------------------------------------------------------

export type MissionAcceptanceCriterion = {
  description: string
  /** Set once the runtime has real evidence the criterion is met — never true by assertion alone. */
  met: boolean
  evidence?: string
}

export type MissionContext = {
  id: string
  task: string
  scope: string
  constraints: string[]
  acceptanceCriteria: MissionAcceptanceCriterion[]
  /** Absent until the mission concludes. Distinct from AgentState — a mission can reach 'COMPLETE'
   * only once every acceptance criterion is `met` with real evidence, per resolveMission(). */
  result?: {
    outcome: 'success' | 'partial' | 'failed'
    summary: string
    epistemicStatus: EpistemicStatus
  }
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Model abstraction — WR-Engineer's reasoning is never permanently tied to one provider.
// ---------------------------------------------------------------------------

export type ModelAdapterRequest = {
  systemPrompt: string
  userPrompt: string
  maxTokens?: number
  timeoutMs?: number
}

export type ModelAdapterResult = {
  ok: boolean
  text: string
  /** Which adapter actually answered — auditable, never asserted as WR-Engineer's own identity
   * (IDENTITY.md is explicit that WR-Engineer never claims to BE its backing model). */
  adapterId: string
  epistemicStatus: EpistemicStatus
  error?: string
  /** Phase 5 optional telemetry — ignored by Phase 1–4 callers. */
  latencyMs?: number
  failureClass?: ProviderFailureClass
  runtime?: string
  modelName?: string
  answeredBy?: 'local' | 'external'
  truncatedPrompt?: boolean
}

/** Every reasoning backend WR-Engineer can use — local, hosted, or (eventually) a native
 * WR-Engineer model — implements this one interface. Swapping the backing model means writing a
 * new implementation of this interface, never touching identity/soul/user/runtime/tools/memory. */
export interface ModelAdapter {
  readonly id: string
  invoke(request: ModelAdapterRequest): Promise<ModelAdapterResult>
}

// ---------------------------------------------------------------------------
// Engineering memory categories (kept separate from SOUL/IDENTITY/USER — see memory/types.ts)
// ---------------------------------------------------------------------------

export const ENGINEERING_MEMORY_CATEGORIES = [
  'ARCHITECTURE',
  'DECISION',
  'BUG',
  'FIX',
  'FAILURE',
  'VALIDATION',
  'DEPENDENCY',
  'MISSION',
  'REPOSITORY_FACT',
  'MODEL_FACT',
] as const
export type EngineeringMemoryCategory = (typeof ENGINEERING_MEMORY_CATEGORIES)[number]
