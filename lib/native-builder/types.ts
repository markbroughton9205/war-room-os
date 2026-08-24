/**
 * War Room Native Self-Builder — shared domain types.
 *
 * This is the first subsystem in this repo allowed to actually apply a file patch. Every other
 * "repair" system here (lib/operator/selfRepair, lib/red-team-coder/repairPlanner,
 * lib/council-repair/model.ts, lib/runtime/runtimeRepairMap.ts) was deliberately built advisory-
 * only, with `canExecute: false` baked in as a literal type. Do not blur that line: nothing in
 * this domain writes to disk without passing lib/native-builder/patchPolicy.ts, and nothing
 * reaches `resolved` without lib/native-builder/repairVerifier.ts producing real evidence.
 */

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export const NATIVE_ISSUE_SOURCES = [
  'browser_runtime_error',
  'panel_error_boundary',
  'typescript',
  'eslint',
  'test',
  'build',
  'terminal_stderr',
  'system_health',
  'commander_report',
] as const
export type NativeIssueSource = (typeof NATIVE_ISSUE_SOURCES)[number]

export type NativeIssueSeverity = 'low' | 'medium' | 'high'

export type NativeIssueStatus = 'open' | 'resolved' | 'dismissed'

export type NativeIssueRecord = {
  id: string
  /** Deterministic content-hash dedup key — see issueIngest.ts:fingerprintIssue. Same underlying
   * problem reported twice (even from different sources) must land on the same fingerprint. */
  fingerprint: string
  title: string
  severity: NativeIssueSeverity
  source: NativeIssueSource
  affectedSubsystem: string
  evidence: string[]
  /** Raw text that produced the fingerprint (e.g. a TS error message, a stack trace, a
   * Commander-submitted description) — kept for inspection, never executed. */
  rawEvidenceText: string
  occurrenceCount: number
  firstSeenAt: string
  lastSeenAt: string
  status: NativeIssueStatus
  resolvedAt?: string
  resolvedByRepairId?: string
}

export type NativeIssueIngestInput = {
  source: NativeIssueSource
  title: string
  severity: NativeIssueSeverity
  affectedSubsystem: string
  evidence: string[]
  rawEvidenceText: string
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export type NativeRepairState =
  | 'detected'
  | 'collecting_evidence'
  | 'inspecting_repository'
  | 'planning'
  | 'awaiting_local_execution_approval'
  | 'applying_patch'
  | 'validating'
  | 'verification_failed'
  | 'partially_verified'
  | 'awaiting_commander_review'
  | 'resolved'
  | 'rolled_back'
  | 'blocked'
  | 'escalation_recommended'
  | 'cancelled'

export const NATIVE_REPAIR_STATES: readonly NativeRepairState[] = [
  'detected',
  'collecting_evidence',
  'inspecting_repository',
  'planning',
  'awaiting_local_execution_approval',
  'applying_patch',
  'validating',
  'verification_failed',
  'partially_verified',
  'awaiting_commander_review',
  'resolved',
  'rolled_back',
  'blocked',
  'escalation_recommended',
  'cancelled',
]

/** Explicit allowed transition graph — advanceState() rejects anything not listed here. */
export const NATIVE_REPAIR_TRANSITIONS: Record<NativeRepairState, readonly NativeRepairState[]> = {
  detected: ['collecting_evidence', 'blocked', 'cancelled'],
  collecting_evidence: ['inspecting_repository', 'blocked', 'cancelled'],
  inspecting_repository: ['planning', 'blocked', 'cancelled'],
  planning: ['awaiting_local_execution_approval', 'escalation_recommended', 'blocked', 'cancelled'],
  awaiting_local_execution_approval: ['applying_patch', 'blocked', 'escalation_recommended', 'cancelled'],
  applying_patch: ['validating', 'blocked'],
  // partially_verified is a distinct, honest outcome from a full 'resolved': the direct recheck
  // for this issue class never ran, so the Commander sees that caveat before deciding, instead of
  // it being silently folded into the same review state as a fully-proven fix.
  validating: ['verification_failed', 'partially_verified', 'awaiting_commander_review', 'blocked'],
  verification_failed: ['rolled_back', 'planning', 'escalation_recommended', 'blocked'],
  // Directly actionable (not funneled through awaiting_commander_review) so the Commander can
  // accept-with-the-caveat-shown or reject in one step — the UI still displays the
  // 'partially_verified' label distinctly before that decision is made.
  partially_verified: ['resolved', 'awaiting_commander_review', 'planning', 'rolled_back', 'blocked'],
  awaiting_commander_review: ['resolved', 'rolled_back', 'blocked'],
  // Not a dead end: Phase 11's Commander actions list "rollback" alongside "accept repair", and
  // the end-to-end proof explicitly demonstrates rollback *after* acceptance — Commander
  // approval is not an irrevocable act, it's the acceptance of the applied state at that moment.
  resolved: ['rolled_back'],
  rolled_back: ['planning', 'escalation_recommended'],
  blocked: ['collecting_evidence', 'planning', 'escalation_recommended'],
  escalation_recommended: ['planning', 'blocked'],
  cancelled: [],
}

export type NativeRepairHistoryEntry = {
  state: NativeRepairState
  at: string
  note?: string
  evidenceRef?: string
}

// ---------------------------------------------------------------------------
// Structured patches (what a proposal is allowed to contain)
// ---------------------------------------------------------------------------

export type StructuredPatchOperation = 'replace_range' | 'insert_after' | 'insert_before' | 'create_file'

export type StructuredPatch = {
  operation: StructuredPatchOperation
  /** Repo-relative, forward-slash path. Never absolute, never containing "..". */
  file: string
  /** sha256 of the full pre-patch file content — required for replace_range/insert_after/
   * insert_before. Rechecked at apply time; mismatch = stale-file rejection, never a silent
   * overwrite. Omitted (and disallowed) for create_file, which requires the file be absent. */
  expectedOriginalHash?: string
  /** Exact text that must appear exactly once in the current file — the anchor for
   * replace_range/insert_after/insert_before. */
  matchText?: string
  /** Replacement for replace_range, or the inserted block for insert_after/insert_before. */
  replacementText?: string
  /** Full content for create_file only. */
  newFileContent?: string
}

export type NativePlannedChange = {
  file: string
  reason: string
  operation: StructuredPatchOperation
  patch: StructuredPatch
}

export type NativeProposalConfidence = 'low' | 'medium' | 'high'

export type NativeValidationOperationId =
  | 'typecheck'
  | 'eslint_targeted'
  | 'build'
  | 'validation_script'
  | 'git_diff_check'

export type NativeValidationOperation = {
  id: NativeValidationOperationId
  /** For eslint_targeted: repo-relative files. For validation_script: the script's repo-relative
   * path (must be in scripts/run-*.mjs and pre-registered — see validationRunner.ts). Ignored by
   * typecheck/build/git_diff_check. */
  targets?: string[]
}

export type NativeProposalSourceKind = 'deterministic' | 'local_model' | 'hosted_model' | 'council_family'

export type NativeRepairProposal = {
  issueId: string
  sourceKind: NativeProposalSourceKind
  /** Family id when sourceKind === 'council_family' (e.g. 'claude'), model name when
   * 'local_model' (e.g. 'llama3.2:3b'), or 'deterministic-heuristics' otherwise. */
  proposerId: string
  diagnosis: string
  confidence: NativeProposalConfidence
  relevantFiles: string[]
  plannedChanges: NativePlannedChange[]
  validations: NativeValidationOperation[]
  risks: string[]
  rollbackPlan: string
  generatedAt: string
}

// ---------------------------------------------------------------------------
// Policy / validation / verification results
// ---------------------------------------------------------------------------

export type PatchPolicyViolation = {
  rule:
    | 'workspace_containment'
    | 'path_denylist'
    | 'file_type_denylist'
    | 'stale_hash'
    | 'max_files_exceeded'
    | 'max_lines_exceeded'
    | 'issue_relevance'
    | 'malformed_patch'
  file?: string
  detail: string
}

export type PatchPolicyResult = {
  ok: boolean
  violations: PatchPolicyViolation[]
  changedFileCount: number
  changedLineCount: number
}

export type NativeValidationResult = {
  operation: NativeValidationOperation
  ok: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
  ranAt: string
}

export type NativeVerificationStatus = 'resolved' | 'partially_verified' | 'verification_blocked'

export type NativeVerificationResult = {
  status: NativeVerificationStatus
  fingerprintRecurred: boolean
  evidence: string[]
  checkedAt: string
}

export type NativeDiffEvidence = {
  diff: string
  truncated: boolean
  changedFiles: string[]
  diffHash: string
}

// ---------------------------------------------------------------------------
// Immunity artifacts (recurrence defense created on accepted repairs)
// ---------------------------------------------------------------------------

export type ImmunityArtifactType =
  | 'regression_test'
  | 'health_probe'
  | 'fallback'
  | 'circuit_breaker'
  | 'timeout'
  | 'stale_state_detector'
  | 'repair_template'
  | 'dependency_guard'
  | 'invariant'
  | 'validation_rule'

export type ImmunityArtifact = {
  id: string
  issueFingerprint: string
  repairMissionId: string
  type: ImmunityArtifactType
  description: string
  files: string[]
  validationEvidenceIds: string[]
  createdAt: string
  status: 'active' | 'inactive' | 'failed'
}

/** Honest non-creation — Part 3 requires stating the reason explicitly rather than silently
 * skipping the immunity step. */
export type ImmunityArtifactOutcome =
  | { created: true; artifact: ImmunityArtifact }
  | { created: false; reason: string }

// ---------------------------------------------------------------------------
// Advisory provider opinions (Engineering Core Foundation Hardening §2)
// ---------------------------------------------------------------------------

/**
 * A single-agent (non-Council) provider's advisory read on an issue, recorded on the repair
 * itself so it survives a process restart. This is intentionally the same shallow shape as
 * lib/mission-runtime/types.ts's RuntimeMissionProviderOpinion plus a recordedAt stamp — it is
 * NOT turned into a patch and never affects selectPreferredProposal; it exists purely as durable
 * advisory text attached to the authoritative repair record, mirroring how Council-family
 * opinions are already folded into advisory (never-selected) proposals in repairPlanner.ts.
 */
export type NativeAdvisoryProviderOpinion = {
  family: string
  ok: boolean
  text: string
  error?: string
  recordedAt: string
}

// ---------------------------------------------------------------------------
// Repair record (persisted)
// ---------------------------------------------------------------------------

export type NativeRepairRecord = {
  id: string
  issueId: string
  state: NativeRepairState
  history: NativeRepairHistoryEntry[]
  proposals: NativeRepairProposal[]
  /** The proposal actually selected to apply, once planning concludes. */
  selectedProposal?: NativeRepairProposal
  policyResult?: PatchPolicyResult
  validationResults: NativeValidationResult[]
  verification?: NativeVerificationResult
  diffEvidence?: NativeDiffEvidence
  rollbackSnapshotId?: string
  immunityOutcome?: ImmunityArtifactOutcome
  autoRepairEligible: boolean
  autoRepairMode: boolean
  /** Optional, backwards-compatible: absent on every repair record written before this field
   * existed, and isRepairRecord (storage.ts) does not require it — old records continue to load
   * normally with this simply undefined. Written by lib/mission-runtime/engineeringStrategy.ts
   * via the existing saveRepair() path; native-builder's own runtime.ts never reads or writes it. */
  advisoryProviderOpinions?: NativeAdvisoryProviderOpinion[]
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Local reasoning routing (Phase 13 truthful labels)
// ---------------------------------------------------------------------------

export type LocalReasoningLabel =
  | 'LOCAL_REPAIR_READY'
  | 'LOCAL_MODEL_UNAVAILABLE'
  | 'LOCAL_ANALYSIS_INSUFFICIENT'
  | 'EXTERNAL_ESCALATION_RECOMMENDED'
  | 'EXTERNAL_ESCALATION_APPROVED'

// ---------------------------------------------------------------------------
// Terminal operation registry (typed operations only — see terminalExecutor.ts)
// ---------------------------------------------------------------------------

export const NATIVE_TERMINAL_OPERATION_IDS = [
  'repo_status',
  'repo_diff',
  'git_diff_check',
  'typecheck',
  'eslint_targeted',
  'validation_script',
  'test_script',
  'build',
  'dev_server_status',
  'terminate_builder_process',
] as const
export type NativeTerminalOperationId = (typeof NATIVE_TERMINAL_OPERATION_IDS)[number]

export function isNativeTerminalOperationId(value: string): value is NativeTerminalOperationId {
  return (NATIVE_TERMINAL_OPERATION_IDS as readonly string[]).includes(value)
}
