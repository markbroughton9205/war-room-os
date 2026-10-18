/**
 * Sealed Mission / Acceptance / Evidence / Verdict contracts.
 * Standalone Engineer mission class only. Historical records without these
 * fields remain LEGACY_PRE_CONTRACT and are never retro-hashed.
 */
export const FOUNDRY_CONTRACT_SCHEMA_VERSION = 1 as const

export const FOUNDRY_ENGINEERING_CLASSES = ['STANDALONE_ENGINEER', 'LEGACY_PRE_CONTRACT'] as const
export type FoundryEngineeringClass = (typeof FOUNDRY_ENGINEERING_CLASSES)[number]

export const FOUNDRY_MISSION_CONTRACT_STATUSES = ['DRAFT', 'SEALED', 'SUPERSEDED'] as const
export type FoundryMissionContractStatus = (typeof FOUNDRY_MISSION_CONTRACT_STATUSES)[number]

export const FOUNDRY_ACCEPTANCE_VERIFICATION_TYPES = [
  'TEST',
  'VALIDATION',
  'BUILD',
  'RUNTIME',
  'BROWSER',
  'PERSISTENCE',
  'SECURITY',
  'DIFF_SCOPE',
  'CUSTOM_EVIDENCE',
] as const
export type FoundryAcceptanceVerificationType = (typeof FOUNDRY_ACCEPTANCE_VERIFICATION_TYPES)[number]

export const FOUNDRY_EVIDENCE_STATUSES = ['PASS', 'FAIL', 'INCONCLUSIVE'] as const
export type FoundryEvidenceStatus = (typeof FOUNDRY_EVIDENCE_STATUSES)[number]

export const FOUNDRY_VERDICT_RESULTS = ['PASS', 'FAIL', 'BLOCKED', 'INCONCLUSIVE'] as const
export type FoundryVerdictResult = (typeof FOUNDRY_VERDICT_RESULTS)[number]

export const FOUNDRY_REVIEW_OUTCOMES = ['PASS', 'FAIL', 'BLOCKED', 'INCONCLUSIVE'] as const
export type FoundryReviewOutcome = (typeof FOUNDRY_REVIEW_OUTCOMES)[number]

export const FOUNDRY_EXECUTION_APPROVAL_STATUSES = ['ACTIVE', 'SUPERSEDED', 'REVOKED'] as const
export type FoundryExecutionApprovalStatus = (typeof FOUNDRY_EXECUTION_APPROVAL_STATUSES)[number]

export const FOUNDRY_AUTHORITY_SNAPSHOT_ID = 'FOUNDRY_AUTHORITY_SNAPSHOT_V1' as const

export type FoundryExecutionApproval = {
  schemaVersion: typeof FOUNDRY_CONTRACT_SCHEMA_VERSION
  approvalId: string
  missionId: string
  graphId: string | null
  projectId: string | null
  specId: string
  specVersion: string
  specContentHash: string
  missionContractId: string
  missionContractHash: string
  acceptanceContractId: string
  acceptanceContractHash: string
  approvedBy: 'COMMANDER'
  approvedAt: string
  authoritySnapshotId: typeof FOUNDRY_AUTHORITY_SNAPSHOT_ID
  status: FoundryExecutionApprovalStatus
  supersedesApprovalId?: string | null
  resourceBudgetId?: string | null
}

export type FoundryAuthoritySnapshot = {
  foundryIsMissionOwner: true
  modelIsWorker: true
  toolsAreHands: true
  externalFrontierCannotOwn: true
  autoCommit: 0
  autoPush: 0
  autoDeploy: 0
}

export const FOUNDRY_AUTHORITY_SNAPSHOT: FoundryAuthoritySnapshot = {
  foundryIsMissionOwner: true,
  modelIsWorker: true,
  toolsAreHands: true,
  externalFrontierCannotOwn: true,
  autoCommit: 0,
  autoPush: 0,
  autoDeploy: 0,
}

export type FoundryMissionContract = {
  schemaVersion: typeof FOUNDRY_CONTRACT_SCHEMA_VERSION
  missionContractId: string
  missionId: string
  projectId: string | null
  workspaceId: string | null
  commanderRequest: string
  goal: string
  nonGoals: string[]
  constraints: string[]
  specId: string
  specVersion: string
  taskIds: string[]
  acceptanceContractId: string
  authoritySnapshot: FoundryAuthoritySnapshot
  engineeringClass: FoundryEngineeringClass
  createdAt: string
  sealedAt: string | null
  contentHash: string
  status: FoundryMissionContractStatus
  supersedesContractId?: string | null
}

export type FoundryAcceptanceCriterion = {
  criterionId: string
  description: string
  required: boolean
  verificationType: FoundryAcceptanceVerificationType
  expectedOutcome: string
  evidenceRequirements: string[]
  relatedTaskIds: string[]
}

export type FoundryAcceptanceContract = {
  schemaVersion: typeof FOUNDRY_CONTRACT_SCHEMA_VERSION
  acceptanceContractId: string
  missionContractId: string
  version: string
  criteria: FoundryAcceptanceCriterion[]
  createdAt: string
  sealedAt: string | null
  contentHash: string
  status: FoundryMissionContractStatus
  supersedesContractId?: string | null
}

export type FoundryAcceptanceEvidence = {
  schemaVersion: typeof FOUNDRY_CONTRACT_SCHEMA_VERSION
  evidenceId: string
  criterionId: string
  missionId: string
  taskId: string | null
  evidenceType: FoundryAcceptanceVerificationType
  producer: string
  timestamp: string
  artifactReference: string | null
  commandReference: string | null
  result: string
  contentHash: string
  status: FoundryEvidenceStatus
  missionContractId: string
  acceptanceContractId: string
  missionContractHash: string
  acceptanceContractHash: string
  specVersion: string
  superseded: boolean
}

export type FoundryVerdictRecord = {
  schemaVersion: typeof FOUNDRY_CONTRACT_SCHEMA_VERSION
  verdictId: string
  missionId: string
  graphId: string | null
  missionContractId: string
  acceptanceContractId: string
  missionContractHash: string
  acceptanceContractHash: string
  specVersion: string
  result: FoundryVerdictResult
  reasons: string[]
  missingCriterionIds: string[]
  failedCriterionIds: string[]
  inconclusiveCriterionIds: string[]
  staleEvidenceIds: string[]
  reviewOutcome: FoundryReviewOutcome | null
  executorResult: 'PROPOSED_COMPLETE' | 'PROPOSED_READY' | 'IN_PROGRESS' | 'NONE'
  evaluatedAt: string
  midEvaluation: boolean
}

export type FoundryContractEventType =
  | 'MISSION_CONTRACT_DRAFTED'
  | 'MISSION_CONTRACT_SEALED'
  | 'ACCEPTANCE_CONTRACT_SEALED'
  | 'ACCEPTANCE_EVIDENCE_RECORDED'
  | 'CRITERION_PASSED'
  | 'CRITERION_FAILED'
  | 'VERDICT_STARTED'
  | 'VERDICT_PASS'
  | 'VERDICT_FAIL'
  | 'VERDICT_BLOCKED'
  | 'COMPLETION_REFUSED'
  | 'EXECUTION_APPROVAL_CREATED'
  | 'EXECUTION_APPROVAL_SUPERSEDED'
  | 'EXECUTION_APPROVAL_REVOKED'
  | 'REAPPROVAL_REQUIRED'
  | 'REAPPROVAL_COMPLETED'
  | 'VERDICT_INVALIDATED'
  | 'PROJECT_READY_INVALIDATED'
  | 'STAGNATION_DETECTED'
  | 'REPLAN_PROPOSED'
  | 'REPLAN_APPLIED'
  | 'REPLAN_REFUSED'
  | 'REPLAN_REAPPROVAL_REQUIRED'
  | 'TASK_PLAN_REPLACED'
  | 'DAG_REWIRED'
  | 'MISSION_BLOCKED_STAGNATION'
  | 'RESOURCE_BUDGET_CREATED'
  | 'RESOURCE_USAGE_RECORDED'
  | 'RESOURCE_SOFT_LIMIT'
  | 'RESOURCE_HARD_LIMIT'
  | 'RESOURCE_BUDGET_EXHAUSTED'
  | 'RESOURCE_BUDGET_EXTENDED'
  | 'RESOURCE_EXECUTION_PAUSED'
  | 'RESOURCE_EXECUTION_RESUMED'
  | 'MISSION_RUNTIME_STARTED'
  | 'MISSION_RUNTIME_HEARTBEAT'
  | 'MISSION_RUNTIME_CHECKPOINTED'
  | 'MISSION_RUNTIME_WAITING'
  | 'MISSION_RUNTIME_SLEEPING'
  | 'MISSION_RUNTIME_WAKE_SCHEDULED'
  | 'MISSION_RUNTIME_WAKING'
  | 'MISSION_RUNTIME_RECOVERING'
  | 'MISSION_RUNTIME_RECOVERED'
  | 'MISSION_RUNTIME_PAUSED'
  | 'MISSION_RUNTIME_RESUMED'
  | 'MISSION_RUNTIME_OWNER_TAKEOVER'
  | 'MISSION_RUNTIME_BLOCKED'
  | 'MISSION_RUNTIME_TERMINATED'
  | 'UNATTENDED_AUTHORIZED'
  | 'UNATTENDED_STARTED'
  | 'UNATTENDED_PAUSED'
  | 'UNATTENDED_RESUMED'
  | 'UNATTENDED_REVOKED'
  | 'UNATTENDED_STOPPED'
  | 'UNATTENDED_NEEDS_COMMANDER'
  | 'UNATTENDED_BLOCKED'
  | 'UNATTENDED_COMPLETE'
  | 'UNATTENDED_EXPIRED'
  | 'UNATTENDED_ACTION_STARTED'
  | 'UNATTENDED_ACTION_COMPLETED'

export type FoundryContractEvent = {
  eventId: string
  at: string
  type: FoundryContractEventType
  missionId: string
  text: string
  metadata?: Record<string, string | number | boolean | null>
}

export function isStandaloneEngineerClass(value: unknown): value is 'STANDALONE_ENGINEER' {
  return value === 'STANDALONE_ENGINEER'
}

export function classifyLegacyPreContract(value: unknown): FoundryEngineeringClass {
  return value === 'STANDALONE_ENGINEER' ? 'STANDALONE_ENGINEER' : 'LEGACY_PRE_CONTRACT'
}
