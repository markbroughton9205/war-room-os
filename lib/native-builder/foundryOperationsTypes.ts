export const FOUNDRY_MISSION_PRIORITIES = ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'] as const
export type FoundryMissionPriority = (typeof FOUNDRY_MISSION_PRIORITIES)[number]

export const FOUNDRY_RESOURCE_IDS = [
  'REPO_WRITE',
  'PRODUCTION_LEASE',
  'BUILD_PIPELINE',
  'PACKAGE_PIPELINE',
  'INSTALL_PIPELINE',
  'ACTIVE_RUNTIME',
  'PORT_3847',
  'PORT_3848',
  'PERSISTENT_BROWSER',
  'COMPUTER_USE_DESKTOP',
  'DEPLOY_TARGET',
  'PROVIDER_SLOT',
] as const
export type FoundryResourceId = (typeof FOUNDRY_RESOURCE_IDS)[number]

/**
 * Deadlock-safe acquisition order (PASS 006 / PASS 012).
 *
 * Production exclusivity subsequence:
 *   PRODUCTION_LEASE → BUILD_PIPELINE → PACKAGE_PIPELINE → INSTALL_PIPELINE → ACTIVE_RUNTIME
 *
 * ACTIVE_RUNTIME stays last (after browser/desktop/deploy) so PASS 006 browser↔runtime
 * deadlocks cannot recur. Do not acquire BUILD/PACKAGE/INSTALL/ACTIVE_RUNTIME unless
 * PRODUCTION_LEASE is already held by the same mission — even when alreadyHeld is empty.
 */
export const FOUNDRY_LOCK_ORDER: readonly FoundryResourceId[] = [
  'PROVIDER_SLOT',
  'REPO_WRITE',
  'PRODUCTION_LEASE',
  'BUILD_PIPELINE',
  'PACKAGE_PIPELINE',
  'INSTALL_PIPELINE',
  'PORT_3847',
  'PORT_3848',
  'PERSISTENT_BROWSER',
  'COMPUTER_USE_DESKTOP',
  'DEPLOY_TARGET',
  'ACTIVE_RUNTIME',
]

/** Resources that require a live PRODUCTION_LEASE before acquire. */
export const PRODUCTION_GATED_RESOURCES: readonly FoundryResourceId[] = [
  'BUILD_PIPELINE',
  'PACKAGE_PIPELINE',
  'INSTALL_PIPELINE',
  'ACTIVE_RUNTIME',
]

export type FoundryToolIdempotency =
  | 'READ_ONLY'
  | 'IDEMPOTENT_WRITE'
  | 'NON_IDEMPOTENT_WRITE'
  | 'EXTERNAL_ACTION'

export type FoundryDurableToolStatus =
  | 'QUEUED'
  | 'STARTED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'INTERRUPTED'
  | 'UNKNOWN'

export type FoundryResourceClaim = {
  resource: FoundryResourceId
  missionId: string
  callId: string
  pid: number
  acquiredAt: string
  heartbeatAt: string
  exclusive: boolean
  paths?: string[]
  operation: string
}

export type FoundryDurableToolCall = {
  toolCallId: string
  missionId: string
  tool: string
  argsHash: string
  startTime: string
  endTime?: string
  status: FoundryDurableToolStatus
  resultSummary?: string
  artifacts?: string[]
  resourceClaims?: FoundryResourceId[]
  idempotency: FoundryToolIdempotency
}

export type FoundrySourceBaseline = {
  recordedAt: string
  branch: string | null
  head: string | null
  dirtyFiles: string[]
  fileHashes: Record<string, string>
  activeInstallId: string | null
  runningInstallId: string | null
}

export type FoundryOwnedArtifact = {
  artifactId: string
  missionId: string
  kind: 'build' | 'package' | 'screenshot' | 'log' | 'install' | 'test' | 'other'
  path: string
  createdAt: string
}

export type FoundryOwnedCleanup = {
  resourceId: string
  missionId: string
  kind: 'process' | 'port' | 'workspace' | 'browser-page' | 'fixture' | 'temp'
  label: string
  shared: boolean
}

export type FoundryPinnedModel = {
  provider: string
  modelId: string
  reasoningLevel?: string
  pinnedAt: string
}

export type FoundryRecoveryDisposition =
  | 'READY_TO_RESUME'
  | 'WAITING_FOR_RESOURCE'
  | 'WAITING_FOR_AUTHORIZATION'
  | 'BLOCKED'
  | 'RECONCILING'
  | 'COMPLETE'
  | 'CANCELLED'

export type FoundryRecoveryRecord = {
  recoveredAt: string
  recovered: boolean
  disposition: FoundryRecoveryDisposition
  interruptedToolCalls: string[]
  notes: string[]
}

export type FoundryContextCheckpoint = {
  checkpointId: string
  missionId: string
  at: string
  goal: string
  currentPlan: string[]
  confirmedFindings: string[]
  rejectedHypotheses: string[]
  architectureDiscoveries: string[]
  changedFiles: string[]
  currentErrors: string[]
  runtimeState: string
  latestVisualState: string
  unresolvedQuestions: string[]
  nextIntendedAction: string
}

export type FoundryRegistryEntry = {
  missionId: string
  title: string
  goal: string
  priority: FoundryMissionPriority
  createdAt: string
  updatedAt: string
  status: string
  phase: string
  owner: string
  workspace: string
  repoIdentity: string
  modelProvider: string | null
  modelId: string | null
  authorizationWaiting: boolean
  currentAction: string | null
  activeToolCall: string | null
  lockClaims: FoundryResourceId[]
  runtimeClaims: string[]
  lastHeartbeat: string | null
  resumeToken: string
  stateVersion: number
  completionGate: { complete: boolean; missing: string[]; detail: string }
  blockedReason: string | null
  recovered: boolean
  recoveryDisposition: FoundryRecoveryDisposition | null
  visibility?: 'commander' | 'system'
  archived?: boolean
  superseded?: boolean
  resumeEligible?: boolean
  testArtifact?: boolean
  classification?: 'COMMANDER_REAL' | 'SYSTEM_TEST' | 'ACCEPTANCE_FIXTURE' | 'CONTRACT_TEST' | 'RECOVERY_TEST' | 'UNKNOWN'
}

export type FoundryProviderHealth = {
  provider: string
  modelId: string | null
  healthy: boolean
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastError: string | null
  transientOutage: boolean
  consecutiveFailures: number
  nextRetryAt: string | null
  fallbackEligible: boolean
}

export const FOUNDRY_DEFAULT_PRIMARY_MODEL = 'cursor-agent:gpt-5.6-sol-medium'
export const FOUNDRY_DEFAULT_FALLBACK_MODEL = 'ollama:qwen2.5-coder:14b'
export const FOUNDRY_DEFAULT_PROVIDER_POLICY = 'AUTO' as const
export const FOUNDRY_DEFAULT_LOCAL_ENDPOINT = 'http://127.0.0.1:11434'

export const PRIORITY_RANK: Record<FoundryMissionPriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
}

export function isFoundryMissionPriority(value: unknown): value is FoundryMissionPriority {
  return typeof value === 'string' && (FOUNDRY_MISSION_PRIORITIES as readonly string[]).includes(value)
}

export function isFoundryResourceId(value: unknown): value is FoundryResourceId {
  return typeof value === 'string' && (FOUNDRY_RESOURCE_IDS as readonly string[]).includes(value)
}
