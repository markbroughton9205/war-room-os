/**
 * Commander-authorized bounded unattended engineering envelope.
 * Unattended does not mean unbounded. Models cannot grant this authority.
 */
export const FOUNDRY_UNATTENDED_SCHEMA_VERSION = 1 as const

export const FOUNDRY_UNATTENDED_STATES = [
  'AUTHORIZED',
  'ACTIVE',
  'PAUSED',
  'NEEDS_COMMANDER',
  'BLOCKED',
  'COMPLETE',
  'CANCELLED',
  'EXPIRED',
] as const
export type FoundryUnattendedState = (typeof FOUNDRY_UNATTENDED_STATES)[number]

export const FOUNDRY_UNATTENDED_TERMINAL_STATES: FoundryUnattendedState[] = ['COMPLETE', 'CANCELLED', 'EXPIRED']

export const FOUNDRY_ALLOWED_UNATTENDED_OPS = [
  'READ',
  'SEARCH',
  'ANALYZE',
  'FILE_WRITE_IN_SCOPE',
  'TEST',
  'TYPECHECK',
  'BUILD',
  'L0_STEER',
  'L1_REPLAN',
  'L2_REPLAN',
  'COLLECT_EVIDENCE',
  'VERIFY',
  'REVIEW',
  'VERDICT_EVALUATE',
  'SLEEP_WAKE',
  'PROVIDER_FALLBACK',
  'GIT_INSPECT',
  'MODEL_CALL',
  'BROWSER_MISSION',
  'COMPUTER_MISSION',
] as const
export type FoundryAllowedUnattendedOp = (typeof FOUNDRY_ALLOWED_UNATTENDED_OPS)[number]

export const FOUNDRY_ALWAYS_COMMANDER_OPS = [
  'MISSION_CONTRACT_EXPANSION',
  'ACCEPTANCE_CONTRACT_CHANGE',
  'L3_REPLAN',
  'REAPPROVAL',
  'RESOURCE_BUDGET_INCREASE',
  'PAID_SERVICE_AUTHORIZATION',
  'CANONICAL_COMMIT',
  'CANONICAL_PUSH',
  'DEPLOY',
  'PRODUCTION_ACTIVATE',
  'DESTRUCTIVE_FILESYSTEM',
  'DESTRUCTIVE_GIT',
  'CREDENTIAL_CHANGE',
  'SECRET_EXPANSION',
  'FINANCIAL_ACTION',
  'UNAUTHORIZED_REMOTE_SIDE_EFFECT',
] as const
export type FoundryAlwaysCommanderOp = (typeof FOUNDRY_ALWAYS_COMMANDER_OPS)[number]

export const FOUNDRY_UNATTENDED_COMMANDER_REASONS = [
  'REAPPROVAL_REQUIRED',
  'RESOURCE_EXTENSION_REQUIRED',
  'MISSION_SCOPE_DECISION',
  'DESTRUCTIVE_ACTION_APPROVAL',
  'REMOTE_MUTATION_APPROVAL',
  'UNKNOWN_OUTCOME',
  'CREDENTIAL_REQUIRED',
  'AMBIGUOUS_REQUIREMENT',
  'ENVELOPE_EXPIRED',
  'ENVELOPE_REVOKED',
  'WORKSPACE_MISSING',
  'UNIDENTIFIED_MUTATING_ACTION',
  'MISSING_PREREQUISITE',
] as const
export type FoundryUnattendedCommanderReason = (typeof FOUNDRY_UNATTENDED_COMMANDER_REASONS)[number]

export const FOUNDRY_UNATTENDED_ACTION_STATUSES = [
  'PLANNED',
  'STARTED',
  'COMPLETED',
  'FAILED',
  'UNKNOWN_OUTCOME',
  'CANCELLED',
] as const
export type FoundryUnattendedActionStatus = (typeof FOUNDRY_UNATTENDED_ACTION_STATUSES)[number]

export type FoundryUnattendedClock = {
  lastTickAt: string
  activeExecutionMs: number
  sleepMs: number
  pausedMs: number
  commanderWaitMs: number
}

export type FoundryUnattendedEnvelope = {
  schemaVersion: typeof FOUNDRY_UNATTENDED_SCHEMA_VERSION
  envelopeId: string
  missionId: string
  graphId: string | null
  runtimeId: string | null
  approvalId: string | null
  resourceBudgetId: string | null
  contractGeneration: string | null
  authorizedBy: string
  authorizedAt: string
  status: FoundryUnattendedState
  allowedOperationClasses: FoundryAllowedUnattendedOp[]
  forbiddenOperationClasses: FoundryAlwaysCommanderOp[]
  startedAt: string
  lastActivityAt: string
  endedAt: string | null
  endReason: string | null
  commanderReason: FoundryUnattendedCommanderReason | null
  expiresAt: string | null
  revokedAt: string | null
  revokedBy: string | null
  currentTaskId: string | null
  continuePromptCount: number
  clock: FoundryUnattendedClock
  lastPreflight: string | null
}

export type FoundryUnattendedPreflight = {
  ok: boolean
  missing: string[]
  reason: string | null
  commanderReason: FoundryUnattendedCommanderReason | null
}

export type FoundryUnattendedView = {
  envelopeId: string | null
  status: FoundryUnattendedState | 'NONE'
  truthfulLabel: string
  detail: string
  authorizedAt: string | null
  lastActivityAt: string | null
  currentTaskId: string | null
  nextWakeAt: string | null
  commanderReason: FoundryUnattendedCommanderReason | null
  contractGeneration: string | null
  budgetState: string | null
  replanState: string | null
}

export type FoundryUnattendedTickResult = {
  envelope: FoundryUnattendedEnvelope | null
  status: FoundryUnattendedState | 'REFUSED'
  reason: string
  continuePromptRequired: boolean
  actionIds: string[]
  commitCount: number
  pushCount: number
  deployCount: number
  brokerBypass: boolean
}
