/**
 * Council Stage 1 -- shared types.
 *
 * Stage 1 adds a thin, deterministic intelligence layer AROUND the existing Council runtime
 * (execute.ts round plan, nebula members, session-intelligence persistence). It does not
 * replace them. Everything here is pure and testable; I/O is injected.
 */

/** Honest lifecycle statuses. COMPLETED is only ever derived from evidence (see provenance.ts). */
export type Stage1Status =
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED'
  | 'CANCELLED'
  | 'INTERRUPTED'

export type DialogueAct =
  | 'question'
  | 'command'
  | 'correction'
  | 'follow_up'
  | 'continuation'
  | 'social'
  | 'statement'

export type TurnReference = {
  /** The words in the turn that needed resolving ("the other one", "that", "it"). */
  phrase: string
  /** What it resolved to, or null when it could not be resolved. */
  resolvedTo: string | null
  /** Where the referent came from. */
  basis: 'previous_member_options' | 'previous_commander_topic' | 'previous_member_topic' | 'none'
}

export type HistoryTurn = {
  /** Stable message id when persisted. */
  id?: string
  role: 'commander' | 'member' | 'system'
  /** Member display id for role === 'member' (e.g. 'ORION'). */
  memberId?: string
  text: string
}

export type TurnUnderstanding = {
  raw: string
  /** Lower-cased, slang-expanded, domain-typo-corrected text. Used for routing only. */
  normalized: string
  act: DialogueAct
  /** True only for imperative requests to DO something (never for questions). */
  executionRequested: boolean
  topics: string[]
  references: TurnReference[]
  correction: null | {
    /** The earlier interpretation being replaced (when identifiable). */
    supersedes: string | null
    /** What the Commander says they meant, when stated. */
    replacement: string | null
  }
  continuation: boolean
  /** Set only when missing information materially affects execution. */
  clarification: string | null
  /** Fixes applied to the Commander's wording, for transparency. */
  normalizationNotes: string[]
}

export type KnowledgeTier = 1 | 2 | 3 | 4 | 5
export type KnowledgeStatus = 'FACT' | 'DOCUMENTED' | 'PLANNED' | 'UNKNOWN'

export type KnowledgeClaim = {
  id: string
  text: string
  status: KnowledgeStatus
  tier: KnowledgeTier
  /** Human-readable source label, e.g. 'INSTALL_STAMP.json' or 'docs/HIGHER_VISION_STUDIOS_MASTER_DIRECTIVE.md'. */
  source: string
}

export type ProvenanceActor = {
  id: string
  kind: 'model' | 'deterministic' | 'tool' | 'coordinator'
  label: string
  model: string | null
  provider: string | null
}

export type ProvenanceEntry = {
  seq: number
  at: string
  actor: ProvenanceActor
  action: string
  detail: string
  status: Stage1Status
}

export type CoordinatorDecision = {
  turnId: string
  complexity: 'trivial' | 'simple' | 'substantive' | 'research'
  route: 'self_knowledge' | 'direct_member' | 'small_group' | 'group_discussion' | 'research' | 'clarify' | 'handoff'
  members: string[]
  excluded: Array<{ member: string; reason: string }>
  /** Heavy local inference must run one at a time on this host. */
  serializeHeavyLocal: boolean
  externalResearch: boolean
  reasons: string[]
}
