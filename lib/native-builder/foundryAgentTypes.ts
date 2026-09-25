/**
 * Foundry Autonomous Multi-Agent Command Center contracts.
 * Client-safe: no Node imports. Every visible task/agent is a persisted execution record.
 */

export const FOUNDRY_AGENT_ROLES = [
  'ARCHITECT',
  'RESEARCHER',
  'BACKEND',
  'FRONTEND',
  'DATABASE',
  'TEST',
  'DEBUGGER',
  'REVIEWER',
  'VERIFIER',
  'RELEASE',
] as const
export type FoundryAgentRole = (typeof FOUNDRY_AGENT_ROLES)[number]

export const FOUNDRY_TASK_STATUSES = [
  'QUEUED',
  'PLANNING',
  'READY',
  'RUNNING',
  'WAITING',
  'BLOCKED',
  'PAUSED',
  'COMPLETE',
  'FAILED',
  'CANCELLED',
  'SUPERSEDED',
] as const
export type FoundryTaskStatus = (typeof FOUNDRY_TASK_STATUSES)[number]

export const FOUNDRY_ACTIVE_EXECUTION_STATUSES = [
  'QUEUED',
  'PLANNING',
  'READY',
  'RUNNING',
  'WAITING',
  'BLOCKED',
  'PAUSED',
] as const

export function isActiveExecutionStatus(status: FoundryTaskStatus): boolean {
  return (FOUNDRY_ACTIVE_EXECUTION_STATUSES as readonly string[]).includes(status)
}

export function isTerminalTaskStatus(status: FoundryTaskStatus): boolean {
  return status === 'COMPLETE' || status === 'FAILED' || status === 'CANCELLED' || status === 'SUPERSEDED'
}

export const FOUNDRY_TASK_PRIORITIES = ['URGENT', 'HIGH', 'NORMAL', 'LOW'] as const
export type FoundryTaskPriority = (typeof FOUNDRY_TASK_PRIORITIES)[number]

export const FOUNDRY_TASK_PHASES = [
  'queued',
  'spec',
  'research',
  'contract',
  'implement',
  'test',
  'repair',
  'preview',
  'verify',
  'integrate',
  'review',
  'ready',
] as const
export type FoundryTaskPhase = (typeof FOUNDRY_TASK_PHASES)[number]

export const FOUNDRY_WORKSPACE_KINDS = ['git-worktree', 'snapshot', 'project-root'] as const
export type FoundryWorkspaceKind = (typeof FOUNDRY_WORKSPACE_KINDS)[number]

export const FOUNDRY_MERGE_STATUSES = ['UNMERGED', 'CONFLICT', 'RECONCILED', 'MERGED', 'PRESERVED'] as const
export type FoundryMergeStatus = (typeof FOUNDRY_MERGE_STATUSES)[number]

export const FOUNDRY_PREVIEW_STATUSES = ['STARTING', 'RUNNING', 'STOPPED', 'FAILED'] as const
export type FoundryPreviewStatus = (typeof FOUNDRY_PREVIEW_STATUSES)[number]

export const FOUNDRY_INSTRUCTION_PRECEDENCE = [
  'COMMANDER_CURRENT',
  'APPROVED_SPEC',
  'PROJECT_INSTRUCTIONS',
  'WORKSPACE_TRUTH',
  'FOUNDRY_GLOBAL_RULES',
  'SKILL_GUIDANCE',
] as const
export type FoundryInstructionLayer = (typeof FOUNDRY_INSTRUCTION_PRECEDENCE)[number]

export const FOUNDRY_COMMAND_CENTER_GOVERNANCE = {
  AUTO_COMMIT: 0,
  AUTO_PUSH: 0,
  AUTO_DEPLOY: 0,
  MOCK_AGENT_CARDS: 0,
  PUBLIC_DEPLOY_WITHOUT_APPROVAL: 0,
} as const

export const FOUNDRY_TASK_PRIORITY_RANK: Record<FoundryTaskPriority, number> = {
  URGENT: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
}

export type FoundryModelRoutingRecord = {
  provider: string
  model: string
  reason: string
  fallback: string | null
  switchedMidTask: boolean
}

export type FoundryTaskArtifact = {
  artifactId: string
  kind:
    | 'architecture_contract'
    | 'api_contract'
    | 'schema_contract'
    | 'task_result'
    | 'test_evidence'
    | 'blocker'
    | 'handoff'
    | 'review'
    | 'guidance'
    | 'repair'
    | 'preview'
    | 'trace'
  title: string
  body: string
  createdAt: string
  taskId: string
  agentId?: string
}

export type FoundryTraceLink = {
  requirementId: string
  taskId: string
  agentId?: string
  files: string[]
  tests: string[]
  browserEvidence?: string
  status: 'PENDING' | 'VERIFIED' | 'FAILED'
}

export type FoundryAgentRecord = {
  agentId: string
  role: FoundryAgentRole
  taskId: string
  missionId: string
  projectId: string
  graphId: string
  status: FoundryTaskStatus
  workspaceId: string | null
  modelRouting: FoundryModelRoutingRecord
  startedAt: string | null
  finishedAt: string | null
  latestAction: string
  filesChanged: string[]
  commands: string[]
  executionGeneration: number
}

export type FoundryWorkspaceRecord = {
  workspaceId: string
  kind: FoundryWorkspaceKind
  projectId: string
  missionId: string
  taskId: string
  agentId: string
  graphId: string
  sourceRoot: string
  runtimeDataRoot: string
  persistentDataRoot: string
  baseRevision: string | null
  filesChanged: string[]
  mergeStatus: FoundryMergeStatus
  createdAt: string
  cleaned: boolean
}

export type FoundryTaskRecord = {
  taskId: string
  title: string
  projectId: string
  projectName: string
  missionId: string
  graphId: string
  role: FoundryAgentRole
  status: FoundryTaskStatus
  priority: FoundryTaskPriority
  workspaceId: string | null
  agentId: string | null
  dependsOn: string[]
  startedAt: string | null
  currentPhase: FoundryTaskPhase
  latestAction: string
  tests: { ok: boolean | null; detail: string }
  result: string
  blocker: string | null
  specId: string | null
  specVersion: string | null
  requirementIds: string[]
  filesChanged: string[]
  guidance: string[]
  repairHistory: string[]
  retryCount: number
  maxRetries: number
  mutating: boolean
  writeSet: string[]
  modelRouting: FoundryModelRoutingRecord | null
  missionContractId?: string | null
  acceptanceContractId?: string | null
  criterionIds?: string[]
  lastActionFingerprint?: string | null
  lastFailureFingerprint?: string | null
  lastProgressAt?: string | null
  lastProgressFingerprint?: string | null
  steerCount?: number
  taskReplanCount?: number
  strategy?: string | null
  replacedTaskId?: string | null
}

export type FoundryPreviewRecord = {
  status: FoundryPreviewStatus
  localPreview: string | null
  openApp: boolean
  openWebsite: boolean
  warRoomBrowser: boolean
  shareContract: {
    localAuthoritative: true
    publicDeploy: 'COMMANDER_APPROVAL_REQUIRED'
  }
  pid?: number
}

export type FoundryResultArtifact = {
  summary: string
  filesChanged: string[]
  tests: string
  failuresRepairs: string[]
  preview: FoundryPreviewRecord | null
  verification: string
  specTraceability: FoundryTraceLink[]
  agentContributions: { agentId: string; role: FoundryAgentRole; files: string[] }[]
  projectReady: boolean
  verdict?: import('./foundryContractTypes').FoundryVerdictResult | null
  reviewOutcome?: import('./foundryContractTypes').FoundryReviewOutcome | null
}

export type FoundryInstructionSource = {
  layer: FoundryInstructionLayer
  origin: string
  loaded: boolean
  excerpt: string
}

export type FoundryCommandCenterGraph = {
  graphId: string
  missionId: string
  projectId: string
  projectName: string
  projectRoot: string
  goal: string
  planningMode: boolean
  specId: string | null
  specVersion: string | null
  specApproved: boolean
  status: FoundryTaskStatus
  paused: boolean
  cancelRequested: boolean
  createdAt: string
  updatedAt: string
  tasks: FoundryTaskRecord[]
  agents: FoundryAgentRecord[]
  workspaces: FoundryWorkspaceRecord[]
  artifacts: FoundryTaskArtifact[]
  traces: FoundryTraceLink[]
  instructionSources: FoundryInstructionSource[]
  skillsLoaded: string[]
  result: FoundryResultArtifact | null
  preview: FoundryPreviewRecord | null
  recoveryCount: number
  lastRecoveryAt: string | null
  engineeringClass?: import('./foundryContractTypes').FoundryEngineeringClass
  missionContractId?: string | null
  acceptanceContractId?: string | null
  missionContractHash?: string | null
  acceptanceContractHash?: string | null
  reviewOutcome?: import('./foundryContractTypes').FoundryReviewOutcome | null
  verdictId?: string | null
  approvalId?: string | null
  approvalIds?: string[]
  taskReplanCount?: number
  dagReplanCount?: number
  missionReplanRequestCount?: number
  planHash?: string | null
  lastReplanId?: string | null
  lastReplan?: {
    level: string
    reason: string
    status: string
    attemptCount: number
  } | null
  stagnationDetected?: boolean
  stagnationReason?: string | null
  stagnationScore?: number
  lastProgressAt?: string | null
  lastProgressFingerprint?: string | null
  frontierStallCycles?: number
  actionWindow?: Array<{
    at: string
    taskId: string
    fingerprint: string
    ok: boolean
    kind: string
    detail: string
  }>
  contractVerdict?: import('./foundryContractVerdictView.types').FoundryContractVerdictView
  resourceBudgetId?: string | null
  resourceView?: import('./foundryResourceGovernorTypes').FoundryResourceView | null
  runtimeId?: string | null
  runtimeView?: import('./foundryMissionRuntimeTypes').FoundryRuntimeView | null
  unattendedView?: import('./foundryUnattendedTypes').FoundryUnattendedView | null
  reasoningDossier?: import('./foundryEngineeringReasoningTypes').FoundryEngineeringDossier | null
  adversarialFindings?: import('./foundryEngineeringReasoningTypes').FoundryAdversarialFinding[]
}

export type FoundryCommandCenterSnapshot = {
  graphs: FoundryCommandCenterGraph[]
  runningTaskCount: number
  queuedTaskCount: number
  backgroundLabel: string
  governance: typeof FOUNDRY_COMMAND_CENTER_GOVERNANCE
  engineeringCapabilities?: import('./foundryEngineeringGraduationTypes').FoundryEngineeringCapabilitiesView | null
}

export function isFoundryAgentRole(value: unknown): value is FoundryAgentRole {
  return typeof value === 'string' && (FOUNDRY_AGENT_ROLES as readonly string[]).includes(value)
}

export function isFoundryTaskPriority(value: unknown): value is FoundryTaskPriority {
  return typeof value === 'string' && (FOUNDRY_TASK_PRIORITIES as readonly string[]).includes(value)
}

export function commandCenterBackgroundLabel(running: number): string {
  if (running <= 0) return ''
  return running === 1 ? 'FOUNDRY · 1 TASK RUNNING' : `FOUNDRY · ${running} TASKS RUNNING`
}

export function visibleCommandCenterTasks(graph: FoundryCommandCenterGraph): FoundryTaskRecord[] {
  return graph.tasks.filter(task => task.status !== 'CANCELLED' || Boolean(task.startedAt))
}
