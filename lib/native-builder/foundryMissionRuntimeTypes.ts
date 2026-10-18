/**
 * Durable multi-day mission runtime. Persistence is not execution.
 * Lifecycle: RUN → WAIT → SLEEP → WAKE → RECONCILE → RESUME.
 */
export const FOUNDRY_RUNTIME_SCHEMA_VERSION = 1 as const

export const FOUNDRY_RUNTIME_STATES = [
  'STARTING',
  'ACTIVE',
  'WAITING',
  'SLEEPING',
  'WAKING',
  'RECOVERING',
  'PAUSED',
  'NEEDS_COMMANDER',
  'BLOCKED',
  'COMPLETE',
  'FAILED',
  'CANCELLED',
] as const
export type FoundryRuntimeState = (typeof FOUNDRY_RUNTIME_STATES)[number]

export const FOUNDRY_RUNTIME_TERMINAL_STATES: FoundryRuntimeState[] = ['COMPLETE', 'FAILED', 'CANCELLED']

export const FOUNDRY_WAKE_REASONS = [
  'SCHEDULED_RETRY',
  'BACKOFF_EXPIRED',
  'PROVIDER_RETRY_WINDOW',
  'RESOURCE_RESUMED',
  'COMMANDER_RESUME',
  'SYSTEM_RESTART_RECOVERY',
  'DEPENDENCY_AVAILABLE',
  'TASK_BECAME_RUNNABLE',
] as const
export type FoundryWakeReason = (typeof FOUNDRY_WAKE_REASONS)[number]

export const FOUNDRY_SLEEP_REASONS = [
  'RETRY_BACKOFF',
  'PROVIDER_RATE_LIMIT',
  'SCHEDULED_FUTURE_RETRY',
  'EXTERNAL_DEPENDENCY',
  'COMMANDER_QUIET_PERIOD',
  'RESOURCE_PAUSE_UNTIL',
] as const
export type FoundrySleepReason = (typeof FOUNDRY_SLEEP_REASONS)[number]

export const FOUNDRY_INFLIGHT_OUTCOMES = [
  'CONFIRMED_COMPLETED',
  'SAFE_TO_RETRY',
  'UNKNOWN_OUTCOME',
  'NEEDS_VERIFICATION',
] as const
export type FoundryInflightOutcome = (typeof FOUNDRY_INFLIGHT_OUTCOMES)[number]

export const FOUNDRY_RUNTIME_DISPOSITIONS = [
  'RESUME',
  'WAIT',
  'SLEEP',
  'NEEDS_COMMANDER',
  'BLOCKED',
  'PAUSED',
  'CANCELLED',
  'COMPLETE',
] as const
export type FoundryRuntimeDisposition = (typeof FOUNDRY_RUNTIME_DISPOSITIONS)[number]

export type FoundryMissionRuntimeRecord = {
  schemaVersion: typeof FOUNDRY_RUNTIME_SCHEMA_VERSION
  runtimeId: string
  missionId: string
  graphId: string | null
  projectId: string | null
  workspaceId: string | null
  runtimeGeneration: number
  state: FoundryRuntimeState
  startedAt: string
  lastActiveAt: string
  lastHeartbeatAt: string | null
  lastCheckpointAt: string | null
  nextWakeAt: string | null
  sleepReason: FoundrySleepReason | null
  wakeReason: FoundryWakeReason | null
  ownerInstanceId: string | null
  leaseId: string | null
  activeTaskIds: string[]
  waitingTaskIds: string[]
  blockedTaskIds: string[]
  approvalId: string | null
  resourceBudgetId: string | null
  contractGeneration: string | null
  recoveryCount: number
  wakeCount: number
  cancelRequested: boolean
  paused: boolean
  lastProgressAt: string | null
  lastCheckpointId: string | null
  workspaceMissing: boolean
  diskDrift: boolean
  continuePromptRequired: boolean
  hotPollCount: number
}

export type FoundryRuntimeLease = {
  leaseId: string
  missionId: string
  runtimeId: string
  runtimeGeneration: number
  ownerInstanceId: string
  pid: number
  acquiredAt: string
  heartbeatAt: string
  expiresAt: string
}

export type FoundryRuntimeCheckpoint = {
  checkpointId: string
  runtimeId: string
  missionId: string
  graphId: string | null
  at: string
  reason: string
  state: FoundryRuntimeState
  approvalId: string | null
  resourceBudgetId: string | null
  contractGeneration: string | null
  taskFrontier: string[]
  workspaceId: string | null
  verdictId: string | null
}

export type FoundryWakeEntry = {
  wakeId: string
  missionId: string
  runtimeId: string
  runtimeGeneration: number
  nextWakeAt: string
  reason: FoundryWakeReason
  claimedBy: string | null
  claimedAt: string | null
  executedAt: string | null
}

export type FoundryDurableRuntimeAction = {
  actionId: string
  missionId: string
  taskId: string | null
  kind: 'model' | 'tool' | 'test' | 'build' | 'write' | 'browser' | 'computer' | 'replan' | 'verify'
  state: 'STARTED' | 'COMPLETED' | 'UNKNOWN'
  mutating: boolean
  startedAt: string
  finishedAt: string | null
  resultSummary: string | null
  evidencePath: string | null
  actionClass?: string
  runtimeGeneration?: number
  status?: 'PLANNED' | 'STARTED' | 'COMPLETED' | 'FAILED' | 'UNKNOWN_OUTCOME' | 'CANCELLED'
  tool?: string | null
  provider?: string | null
  model?: string | null
  writeSet?: string[]
  inputHash?: string | null
  resultRef?: string | null
}

export type FoundryRuntimeView = {
  runtimeId: string | null
  state: FoundryRuntimeState | 'NONE'
  lastActiveAt: string | null
  lastHeartbeatAt: string | null
  nextWakeAt: string | null
  wakeReason: FoundryWakeReason | null
  sleepReason: FoundrySleepReason | null
  recoveryCount: number
  ownerInstanceId: string | null
  runtimeGeneration: number | null
  lastCheckpointId: string | null
  leaseId: string | null
  activeTaskCount: number
  truthfulLabel: string
  detail: string
}

export const FOUNDRY_RUNTIME_HEARTBEAT_MS = 30_000
export const FOUNDRY_RUNTIME_LEASE_TTL_MS = 90_000
export const FOUNDRY_RUNTIME_MAX_BACKOFF_MS = 6 * 60 * 60 * 1000
export const FOUNDRY_RUNTIME_BASE_BACKOFF_MS = 60_000
