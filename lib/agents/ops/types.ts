/** Phase 10 — Agent Foundry and Long-Lived Operations. See docs/phases/PHASE_10_IMPLEMENTATION.md */

export const NEED_CRITERIA = [
  'recurring_task_pattern',
  'validated_workflow_with_measurable_value',
  'clear_permission_scope',
  'useful_memory_boundary',
  'repeatable_io_contract',
  'known_escalation_path',
  'failure_drift_review_process',
] as const
export type NeedCriterion = (typeof NEED_CRITERIA)[number]

export const SPECIALIZATIONS = [
  'codebase_triage',
  'deployment_readiness',
  'memory_curation',
  'provider_evaluation',
  'financial_review',
  'external_signal_monitoring',
  'red_team_challenge',
  'documentation_synthesis',
  'operator_support',
  'incident_review',
] as const
export type Specialization = (typeof SPECIALIZATIONS)[number]

export const WORKER_CATEGORIES = [
  'memory_compaction',
  'evaluation_scoring',
  'signal_monitoring',
  'documentation_freshness',
  'ci_deployment_readiness',
  'incident_watch',
  'operator_notification',
] as const
export type WorkerCategory = (typeof WORKER_CATEGORIES)[number]

export const RISK_CLASSES = ['low', 'moderate', 'elevated', 'high'] as const
export type RiskClass = (typeof RISK_CLASSES)[number]
export const riskRank = (r: RiskClass) => RISK_CLASSES.indexOf(r)

/** Safe, read-only permissions an agent scope may contain. */
export const SAFE_PERMISSIONS = ['read_repo', 'read_learning_log', 'read_docs', 'read_mission_records', 'write_own_reports'] as const
/** Protected effects: never in a scope without a recorded Commander approval; always gated per action. */
export const PROTECTED_EFFECTS = ['external_action', 'production_change', 'spend', 'external_communication'] as const
export type SafePermission = (typeof SAFE_PERMISSIONS)[number]
export type ProtectedEffect = (typeof PROTECTED_EFFECTS)[number]

export const MEMORY_SCOPES = ['mission_state', 'agent_operational', 'project_knowledge', 'learning_evidence', 'docs'] as const
export type MemoryScope = (typeof MEMORY_SCOPES)[number]

export type NeedEvidenceItem = { criterion: NeedCriterion; summary: string; evidenceRefs: string[] }
export type NeedRecord = { id: string; title: string; detectedAt: string; evidence: NeedEvidenceItem[] }

export type AgentState = 'PROPOSED' | 'APPROVED' | 'ACTIVE' | 'PAUSED' | 'UNDER_REVIEW' | 'RETIRED' | 'REJECTED'

export type AgentSpec = {
  /** Stable identity, independent of any model/provider process. */
  id: string
  name: string
  purpose: string
  specialization: Specialization
  riskCeiling: RiskClass
  permissionScope: SafePermission[]
  memoryScope: MemoryScope[]
  ioContract: { input: string; output: string }
  escalationPath: string
  reviewProcess: string
  needId: string
  /** Increments only through an approved scope change. */
  version: number
  createdAt: string
}

export type Actor = string // 'commander:<id>' | 'system:<name>'
export type TransitionRecord = { agentId: string; from: AgentState; to: AgentState; by: Actor; at: string; reason: string }

export type WorkerSpec = {
  id: string
  agentId: string
  category: WorkerCategory
  version: string
  mission: string
  permissionScope: SafePermission[]
  memoryScope: MemoryScope[]
  limits: { maxRuntimeMs: number; maxRunsPerDay: number; maxConsecutiveFailures: number; cadenceMinutes: number | null }
  /** Protected effects the Commander has pre-approved for this worker (narrow policy). Empty by default. */
  preApprovedEffects: ProtectedEffect[]
  createdAt: string
}

export type RunStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'BLOCKED' | 'STOPPED' | 'INTERRUPTED'
export type Unknown = 'UNKNOWN'
export type RunRecord = {
  runId: string
  workerId: string
  agentId: string
  workerVersion: string
  mission: string
  permissionScope: SafePermission[]
  memoryScope: MemoryScope[]
  startedAt: string
  endedAt?: string
  status: RunStatus
  toolsUsed: string[]
  outputs: { kind: string; ref: string; summary: string }[]
  escalations: { to: string; reason: string }[]
  errors: { message: string; recovery: string }[]
  /** Actual executor of any model call; UNKNOWN when no model was used or it is not attributable. */
  executor: { provider: string; model: string } | Unknown
  resource: { durationMs?: number; costUsd?: number | Unknown; tokens?: number | Unknown }
  requestedEffects: ProtectedEffect[]
  approvalRef?: string
  /** manual (Commander) or scheduled (scheduler claim). Absent on runs recorded before P10-I = manual. */
  origin?: 'manual' | 'scheduled'
  claimId?: string
}

export type AdaptationKind =
  | 'workflow_change'
  | 'narrow_task_classification'
  | 'broaden_task_classification'
  | 'retrieval_strategy_update'
  | 'weak_tool_flag'
  | 'permission_change_request'
  | 'retire_step'

export const FORBIDDEN_ADAPTATIONS = ['silent_permission_expansion', 'hidden_external_action', 'production_mutation', 'spending', 'external_communication'] as const

export type AdaptationProposal = {
  id: string
  agentId: string
  kind: AdaptationKind
  summary: string
  evidenceRefs: string[]
  /** For permission_change_request only: what would be added. */
  requestedPermissions?: SafePermission[]
  requestedMemory?: MemoryScope[]
  createdAt: string
  /** Always false: this layer never applies an adaptation. */
  applied: false
}

export type Recommendation = {
  id: string
  agentId: string
  action: 'narrow' | 'retrain' | 'merge' | 'retire' | 'none'
  reasons: string[]
  evidenceRunIds: string[]
  createdAt: string
  applied: false
}

export type AgentOpsRecord =
  | { t: 'need'; rid: string; need: NeedRecord }
  | { t: 'agent'; rid: string; agent: AgentSpec }
  | { t: 'transition'; rid: string; tr: TransitionRecord }
  | { t: 'worker'; rid: string; worker: WorkerSpec; approvedBy: Actor }
  | { t: 'run'; rid: string; run: RunRecord }
  | { t: 'stop'; rid: string; workerId: string; by: Actor; at: string; reason: string; resumed: boolean }
  | { t: 'adaptation'; rid: string; proposal: AdaptationProposal }
  | { t: 'decision'; rid: string; proposalId: string; status: 'APPROVED' | 'REJECTED'; by: Actor; at: string; reason: string }
  | { t: 'schedule'; rid: string; workerId: string; enabled: boolean; cadenceMinutes: number; by: Actor; at: string; reason: string }
  | { t: 'schedulerGlobal'; rid: string; enabled: boolean; by: Actor; at: string; reason: string }
  | { t: 'schedClaim'; rid: string; claimId: string; workerId: string; slotMs: number; dueAt: string; instanceId: string; at: string; collapsedIntervals: number }
  | { t: 'schedDecision'; rid: string; workerId: string; at: string; decision: 'RUN' | 'SKIP'; reason: string; nextEligibleAt: string | null; claimId?: string }
  | { t: 'feedback'; rid: string; runId: string; verdict: 'accepted' | 'corrected' | 'rejected'; usefulEscalation?: boolean; by: Actor; at: string; note: string }
  | { t: 'effectApproval'; rid: string; workerId: string; effects: ProtectedEffect[]; by: Actor; at: string; reason: string }
  | { t: 'scope'; rid: string; agentId: string; proposalId: string; permissionScope: SafePermission[]; memoryScope: MemoryScope[]; by: Actor; at: string }
  | { t: 'recommendation'; rid: string; rec: Recommendation }
