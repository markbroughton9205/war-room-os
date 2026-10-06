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
  // engineering specializations (Phase 10 continuation): grounded in assignments, not labels
  'feature_implementation',
  'defect_repair',
  'test_authoring',
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
  /** Engineering tools this agent may be assigned. Empty = cannot take engineering assignments. */
  toolScope?: EngineeringTool[]
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

/** Engineering tools an assignment may use. All are bounded local effects; none can reach protected effects. */
export const ENGINEERING_TOOLS = ['read_workspace', 'write_workspace', 'run_workspace_tests', 'run_typecheck', 'model_local', 'read_runtime_output'] as const
export type EngineeringTool = (typeof ENGINEERING_TOOLS)[number]

export type AssignmentState = 'QUEUED' | 'RUNNING' | 'PAUSED' | 'BLOCKED' | 'CANCEL_REQUESTED' | 'STOPPING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'HANDED_OFF' | 'INTERRUPTED'
export type CancelDisposition = 'STOPPED' | 'UNABLE_TO_SAFELY_INTERRUPT'
export type AssignmentOutcome = {
  validation: 'PASSED' | 'FAILED' | 'UNKNOWN'
  summary: string
  artifacts: string[]
  executor: { provider: string; model: string } | Unknown
  tokens: number | Unknown
  latencyMs: number | Unknown
  retries: number
}
export type Assignment = {
  id: string
  /** Same key = same logical work: a second assign returns the first instead of duplicating it. */
  idempotencyKey: string
  agentId: string
  parentMission: { id: string; title: string }
  taskClass: string
  capabilities: string[]
  objective: string
  expectedOutputs: string[]
  completionConditions: string[]
  workspace: { id: string; root: string; kind: 'sandbox' | 'project' } | null
  tools: EngineeringTool[]
  limits: { maxSteps: number; maxRuntimeMs: number; maxModelCalls: number; maxRetries: number }
  dependencies: string[]
  createdBy: Actor
  createdAt: string
}
export type AssignmentEventKind =
  | 'STARTED' | 'PAUSED' | 'RESUMED' | 'BLOCKED' | 'UNBLOCKED'
  | 'CANCEL_REQUESTED' | 'CANCEL_ACKNOWLEDGED' | 'CANCELLED' | 'CANCEL_UNSAFE'
  | 'COMPLETED' | 'FAILED' | 'HANDED_OFF' | 'INTERRUPTED'

export type StepStatus = 'PENDING' | 'ACTIVE' | 'DONE' | 'FAILED' | 'SKIPPED'
export type CheckpointStep = { id: string; title: string; status: StepStatus; layer?: string; files: string[]; note?: string }
export type FileChange = { path: string; beforeHash: string | null; afterHash: string; stepId: string }
export type ValidationRecord = { stepId?: string; command: string; status: 'PASSED' | 'FAILED' | 'UNAVAILABLE'; at: string; outputHash: string; summary: string }
export type CheckpointState = {
  objective: string
  acceptanceCriteria: string[]
  steps: CheckpointStep[]
  currentStepId: string | null
  fileChanges: FileChange[]
  artifacts: string[]
  validations: ValidationRecord[]
  blockers: string[]
  failureReason?: string
  /** Keys of consequential actions already completed (never repeated blindly). */
  effectsDone: string[]
  /** Approaches/commands that failed or must not be repeated, with the reason. */
  doNotRepeat: { key: string; reason: string }[]
  dependencies: string[]
  workspace: { id: string; root: string; kind: string; gitHead: string | Unknown; baselineTreeHash: string | Unknown; baselineFileHashes: Record<string, string> | Unknown }
  stopReason?: string
}
export type EffectRecord = {
  assignmentId: string
  key: string
  kind: 'file_write' | 'command' | 'model_call' | 'test_run'
  /** Consequential effects are never re-executed once DONE; non-consequential ones (tests, type checks) are re-run on current state. */
  consequential: boolean
  summary: string
  status: 'STARTED' | 'DONE' | 'FAILED'
  at: string
  fileChanges?: FileChange[]
  result?: { exitCode?: number | null; outputHash?: string; summary?: string }
}

export type HandoffPacket = {
  objective: string
  acceptanceCriteria: string[]
  attempted: string[]
  changed: { path: string; beforeHash: string | null; afterHash: string }[]
  succeeded: string[]
  failed: string[]
  doNotRepeat: { key: string; reason: string }[]
  remaining: string[]
  stopReason: string
  blockers: string[]
  validations: { command: string; status: string; summary: string }[]
  workspace: CheckpointState['workspace']
  consequentialActionsDone: string[]
  lessonsApplied?: string[]
}

export type EvidenceKind = 'command_output' | 'file_read' | 'server_log' | 'browser_console' | 'network' | 'api_response' | 'rendered_state' | 'type_diagnostic' | 'docs' | 'test_result'
export type DebugEvidence = { id: string; kind: EvidenceKind; ref: string; excerptHash: string; summary: string; available: boolean; unavailableReason?: string }
export type DebugEntry =
  | { kind: 'FAILURE'; failureId: string; argv: string[]; ran: true; exitCode: number | null; startedAt: string; outputHash: string; excerpt: string; signature: string; testsTargeted: string[]; testsRun: number | Unknown; failingTests: string[] }
  | { kind: 'EVIDENCE'; evidence: DebugEvidence; failureId: string }
  | { kind: 'HYPOTHESIS'; failureId: string; hypothesisId: string; statement: string; revisionOf?: string; whyRevised?: string; supporting: string[]; refuting: string[] }
  | { kind: 'HYPOTHESIS_STATUS'; hypothesisId: string; status: 'OPEN' | 'SUPPORTED' | 'REFUTED' | 'UNDETERMINED'; reason: string }
  | { kind: 'REPAIR'; failureId: string; repairId: string; hypothesisId: string; filesEdited: { path: string; afterHash: string }[]; rationale: string; differsFromPrevious: string | null; newEvidence: string[]; attempt: number }
  | { kind: 'VALIDATION'; failureId: string; repairId: string; argv: string[]; exitCode: number | null; testsRun: number | Unknown; outcome: 'ORIGINAL_FIXED' | 'SAME_FAILURE' | 'NEW_FAILURE' | 'VACUOUS' | 'WRONG_TEST_SUSPECTED'; signature: string | null; note: string }
  | { kind: 'UNDETERMINED'; failureId: string; reason: string; attempts: number }

export type LessonClass = 'DUPLICATE_DECLARATION' | 'MISSING_EXPORT' | 'REMOVED_EXPORT' | 'ESM_COMMONJS_MIX' | 'MISSING_FILE' | 'SYNTAX' | 'ASSERTION' | 'OTHER'
/** A correction learned from REAL evidence (a fixed failure or a gate rejection); never from narrative. */
export type Lesson = { id: string; cls: LessonClass; taskClass: string; observation: string; correction: string; evidence: { assignmentId: string; failureId?: string; kind: 'FIXED_FAILURE' | 'GATE_REJECTION' }; at: string; executor: string }
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
  | { t: 'assignment'; rid: string; assignment: Assignment }
  | { t: 'assignmentEvent'; rid: string; assignmentId: string; kind: AssignmentEventKind; by: Actor; at: string; reason: string; outcome?: AssignmentOutcome; disposition?: CancelDisposition; stopReason?: string; handoffTo?: string; blocker?: string }
  | { t: 'checkpoint'; rid: string; assignmentId: string; seq: number; at: string; by: Actor; state: CheckpointState }
  | { t: 'effect'; rid: string; effect: EffectRecord }
  | { t: 'handoff'; rid: string; fromAssignment: string; toAssignment: string; at: string; by: Actor; reason: string; packet: HandoffPacket }
  | { t: 'lesson'; rid: string; lesson: Lesson }
  | { t: 'lessonUse'; rid: string; lessonId: string; assignmentId: string; at: string; kind: 'RETRIEVED' | 'AVOIDED' | 'REPEATED' | 'UNKNOWN'; note: string }
  | { t: 'debug'; rid: string; assignmentId: string; seq: number; at: string; entry: DebugEntry }
  | { t: 'feedback'; rid: string; runId: string; verdict: 'accepted' | 'corrected' | 'rejected'; usefulEscalation?: boolean; by: Actor; at: string; note: string }
  | { t: 'effectApproval'; rid: string; workerId: string; effects: ProtectedEffect[]; by: Actor; at: string; reason: string }
  | { t: 'scope'; rid: string; agentId: string; proposalId: string; permissionScope: SafePermission[]; memoryScope: MemoryScope[]; by: Actor; at: string }
  | { t: 'recommendation'; rid: string; rec: Recommendation }
