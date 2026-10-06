/** Phase 9 — Recursive Learning and Evaluation Systems: shared types. See docs/phases/PHASE_9_RECURSIVE_LEARNING_IMPLEMENTATION.md */

export const TASK_CLASSES = [
  'architecture_analysis',
  'implementation_planning',
  'code_modification',
  'realtime_research',
  'summarization',
  'risk_review',
  'cross_reference',
  'long_context_recall',
  'cost_sensitive',
] as const
export type TaskClass = (typeof TASK_CLASSES)[number]

export type SubjectKind = 'provider' | 'model' | 'workflow' | 'tool'
export type EvalSubject = { kind: SubjectKind; id: string }

export type EvalOutcome = 'SUCCESS' | 'PARTIAL' | 'FAILURE' | 'ROLLED_BACK' | 'REJECTED'
export type ValidationStatus = 'PASSED' | 'FAILED' | 'UNKNOWN'
export type EvalSignal =
  | 'RUN'
  | 'COMMANDER_APPROVAL'
  | 'COMMANDER_REJECTION'
  | 'COMMANDER_CORRECTION'
  | 'VALIDATION'
  | 'REVIEWER_FINDING'
  | 'ROLLBACK'
  | 'INSTALLED_OUTCOME'

/** Every metric is optional: absent means UNKNOWN, never zero. */
export type EvalMetrics = {
  latencyMs?: number
  costUsd?: number
  tokensIn?: number
  tokensOut?: number
  retries?: number
}

export type EvaluationEventInput = {
  id?: string
  subject: EvalSubject
  taskClass: TaskClass
  outcome: EvalOutcome
  signal?: EvalSignal
  validation?: ValidationStatus
  occurredAt: string
  metrics?: EvalMetrics
  errorClass?: string
  note?: string
  source: { kind: string; ref: string }
  /** Ingestion provenance (adapters). Absent for hand-recorded events. */
  provenance?: EventProvenance
}

export type EventProvenance = {
  adapter: string
  /** True when the event was reconstructed from historical receipts rather than observed live. */
  backfilled: boolean
  /** Path/identifier of the durable source record (never its contents). */
  sourcePath?: string
}

export type EvaluationEvent = {
  id: string
  subject: EvalSubject
  taskClass: TaskClass
  outcome: EvalOutcome
  signal: EvalSignal
  validation: ValidationStatus
  occurredAt: string
  recordedAt: string
  metrics: EvalMetrics
  errorClass?: string
  note?: string
  source: { kind: string; ref: string }
  provenance?: EventProvenance
  /** Set when normalization overrode the reported outcome (e.g. failed validation cannot be SUCCESS). */
  coercions: string[]
  reportedOutcome: EvalOutcome
}

export type ProposalKind = 'ROUTING_RECOMMENDATION' | 'MEMORY_PROMOTION' | 'DOCTRINE_CHANGE' | 'ARCHITECTURE_CHANGE'

export type Proposal = {
  id: string
  kind: ProposalKind
  createdAt: string
  title: string
  summary: string
  evidenceEventIds: string[]
  contradictoryEventIds: string[]
  confidence: number | 'UNKNOWN'
  scope: string
  reviewBy?: string
  /** True when the proposal touches governance/security/auth/deploy. Such proposals are never self-applied. */
  targetsProtectedPolicy: boolean
  /** Always false: this layer cannot apply anything. */
  applied: false
  payload: Record<string, unknown>
}

export type DecisionStatus = 'APPROVED' | 'REJECTED' | 'DEFERRED'
export type Decision = {
  proposalId: string
  status: DecisionStatus
  decidedBy: string
  decidedAt: string
  reason: string
}

export type LogRecord =
  | { t: 'event'; event: EvaluationEvent }
  | { t: 'supersede'; eventId: string; supersededBy?: string; reason: string; at: string }
  | { t: 'proposal'; proposal: Proposal }
  | { t: 'decision'; decision: Decision }
  | { t: 'promotion'; proposalId: string; approvedBy: string; at: string }
