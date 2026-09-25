export const FOUNDRY_MISSION_STATES = [
  'QUEUED',
  'UNDERSTANDING',
  'INSPECTING',
  'PLANNING',
  'EXECUTING',
  'VALIDATING',
  'BUILDING',
  'PACKAGING',
  'INSTALLING',
  'VERIFYING',
  'REPLANNING',
  'PAUSED',
  'WAITING_AUTHORIZATION',
  'WAITING_RESOURCE',
  'ACTIVATION_PENDING',
  'RECOVERING',
  'BLOCKED',
  'COMPLETE',
  'FAILED',
  'CANCELLED',
] as const

export type FoundryMissionState = (typeof FOUNDRY_MISSION_STATES)[number]

export type FoundryMissionKind = 'fixture' | 'application' | 'app_builder'

export const FOUNDRY_MISSION_CLASSIFICATIONS = [
  'COMMANDER_REAL',
  'SYSTEM_TEST',
  'ACCEPTANCE_FIXTURE',
  'CONTRACT_TEST',
  'RECOVERY_TEST',
  'UNKNOWN',
] as const

export type FoundryMissionClassification = (typeof FOUNDRY_MISSION_CLASSIFICATIONS)[number]
export type FoundryMissionVisibility = 'commander' | 'system'
export type FoundryProductionRole = 'PRODUCTION_OWNER' | 'HELPER'

export type FoundryMissionIntent =
  | 'UNDERSTAND'
  | 'SEARCH'
  | 'READ'
  | 'MAP'
  | 'IMPACT'
  | 'BASELINE'
  | 'PATCH_SOURCE'
  | 'PATCH_TESTS'
  | 'SELF_REVIEW'
  | 'CROSS_FILE'
  | 'TEST_REVIEW'
  | 'CONTRACT'
  | 'TEST'
  | 'DIAGNOSE'
  | 'REGRESSION'
  | 'LINT'
  | 'TYPECHECK'
  | 'LAUNCH'
  | 'BROWSER_VERIFY'
  | 'COMPUTER_VERIFY'
  | 'SELF_CHECK'
  | 'BUILD'
  | 'PACKAGE'
  | 'INSTALL'
  | 'ACTIVATE'
  | 'TRANSITION'
  | 'IDENTITY'
  | 'RESEARCH'
  | 'REQUIREMENTS'
  | 'STACK'
  | 'PROJECT_CREATE'
  | 'PREVIEW'
  | 'COMPLETE'

export type FoundryMissionStep = {
  id: string
  intent: FoundryMissionIntent
  title: string
  status: 'pending' | 'active' | 'done' | 'failed' | 'skipped'
  note?: string
}

export type FoundryMissionPermissions = {
  filesystem: boolean
  terminal: boolean
  browser: boolean
  computerUse: boolean
  tests: boolean
  lint: boolean
  typecheck: boolean
  build: boolean
  package: boolean
  installProduction: boolean
  activateInstall: boolean
  installedRuntimeControl: boolean
  process: boolean
  commit: boolean
  push: boolean
  liveDeploy: boolean
  internetResearch: boolean
}

export const PASS_004_PERMISSIONS: FoundryMissionPermissions = {
  filesystem: true,
  terminal: true,
  browser: true,
  computerUse: true,
  tests: true,
  lint: true,
  typecheck: true,
  build: true,
  package: true,
  installProduction: true,
  activateInstall: true,
  installedRuntimeControl: true,
  process: true,
  commit: false,
  push: false,
  liveDeploy: false,
  internetResearch: false,
}

export type FoundryFailureClass = 'TRANSIENT' | 'CODE' | 'PERMISSION' | 'HARD'

export type FoundryMissionInterpretation = {
  goal: string
  successCriteria: string[]
  constraints: string[]
  requiredVerification: string[]
  kind: FoundryMissionKind
  replace?: { from: string; to: string }
  insert?: { marker: string; locus: string }
  locateOnly?: boolean
  capabilityAssessment?: import('./capability-atlas/types').CapabilityAssessment
}

export type FoundryMissionContextSummary = {
  goal: string
  currentPlan: string[]
  architectureFindings: string[]
  changedFiles: string[]
  currentErrors: string[]
  latestObservations: string[]
  unresolvedQuestions: string[]
  completion: string
}

export type FoundryJournalEntry = {
  at: string
  kind: 'decision' | 'observation' | 'replan' | 'block' | 'auth' | 'transition'
  text: string
}

export type FoundryToolCallRecord = {
  at: string
  tool: string
  ok: boolean
  reason: string
  error?: string
  excerpt?: string
}

export type FoundryMissionRecord = {
  missionId: string
  title: string
  userRequest: string
  createdAt: string
  updatedAt: string
  status: FoundryMissionState
  phase: FoundryMissionState
  kind: FoundryMissionKind
  goal: string
  successCriteria: string[]
  constraints: string[]
  permissions: FoundryMissionPermissions
  interpretation: FoundryMissionInterpretation
  plan: FoundryMissionStep[]
  currentStep: string | null
  completedSteps: string[]
  failedSteps: string[]
  observations: { at: string; text: string; source: string }[]
  artifacts: string[]
  toolCalls: FoundryToolCallRecord[]
  errors: { at: string; klass: FoundryFailureClass; message: string }[]
  sourceState: { baselineFiles: string[]; changedFiles: string[]; newFiles: string[]; deletedFiles: string[]; diffSummary: string }
  testState: { ok: boolean | null; detail: string | null }
  buildState: { ok: boolean | null; detail: string | null }
  packageState: { ok: boolean | null; appimage?: { path: string; sha256: string }; deb?: { path: string; sha256: string }; linuxUnpackedDir?: string; detail: string | null }
  installState: { ok: boolean | null; installId: string | null; detail: string | null }
  runtimeState: { activeInstallId: string | null; runningInstallId: string | null; identityMatch: boolean | null; uiHealth: boolean | null; coreHealth: boolean | null; detail: string | null }
  browserState: { ok: boolean | null; detail: string | null; evidence?: string }
  computerUseState: { ok: boolean | null; detail: string | null; status?: 'PASS' | 'VERIFIED_HARD_BLOCKER' | 'FAIL' }
  deployState: { ok: boolean | null; detail: string | null }
  completionGate: { complete: boolean; missing: string[]; detail: string }
  journal: FoundryJournalEntry[]
  context: FoundryMissionContextSummary
  blocker: {
    blocker: string
    evidence: string
    attempted: string
    why: string
    unblock: string
  } | null
  authorization: {
    waiting: boolean
    action: string | null
    reason: string | null
    target?: string | null
    impact?: string | null
    requestedAt?: string
    approvalState?: 'pending' | 'approved' | 'denied'
  } | null
  cancelRequested: boolean
  pauseRequested?: boolean
  priority?: import('./foundryOperationsTypes').FoundryMissionPriority
  owner?: string
  workspace?: string
  repoIdentity?: string
  lastHeartbeat?: string
  resumeToken?: string
  stateVersion?: number
  currentAction?: string
  activeToolCallId?: string | null
  lockClaims?: import('./foundryOperationsTypes').FoundryResourceClaim[]
  runtimeClaims?: string[]
  baseline?: import('./foundryOperationsTypes').FoundrySourceBaseline
  durableToolCalls?: import('./foundryOperationsTypes').FoundryDurableToolCall[]
  ownedArtifacts?: import('./foundryOperationsTypes').FoundryOwnedArtifact[]
  ownedCleanup?: import('./foundryOperationsTypes').FoundryOwnedCleanup[]
  pinnedModel?: import('./foundryOperationsTypes').FoundryPinnedModel
  recovery?: import('./foundryOperationsTypes').FoundryRecoveryRecord
  latestCheckpointId?: string | null
  launchOrigin: string | null
  candidateFiles: string[]
  sourceFilesTouched: string[]
  testFilesTouched: string[]
  retryCounts: Record<string, number>
  replanCount: number
  loopCount: number
  maxLoops: number
  visibility?: FoundryMissionVisibility
  archived?: boolean
  archivedAt?: string
  superseded?: boolean
  resumeEligible?: boolean
  testArtifact?: boolean
  classification?: FoundryMissionClassification
  /** Explicit production authority. Helpers never inherit this automatically. */
  productionRole?: FoundryProductionRole | null
  productionOwner?: boolean
  parentMissionId?: string | null
  helperMissionId?: string | null
  requestId?: string | null
  classificationEvidence?: string[]
  /** PASS 005 model-derived state. Optional so PASS 004 missions remain loadable. */
  hypotheses?: import('./foundryModelTypes').FoundryHypothesis[]
  modelState?: import('./foundryModelTypes').FoundryModelRuntimeState
  architectureFindings?: string[]
  codeDecisions?: string[]
  importantPaths?: string[]
  testFindings?: string[]
  runtimeFindings?: string[]
  engineering?: import('./foundryEngineeringDepth').FoundryEngineeringState
  writeSet?: import('./foundryMissionWriteSet').FoundryMissionWriteSet
  capabilityLane?: import('./foundryApplicationBuilderTypes').FoundryCapabilityLane
  applicationBuilder?: import('./foundryApplicationBuilderTypes').FoundryApplicationBuilderState
  /** Bounded Atlas advisory metadata. Not an authority decision. */
  capabilityAssessment?: import('./capability-atlas/types').CapabilityAssessment
  agentEvents?: import('./foundryAgentEvents').FoundryAgentEvent[]
  contextPack?: import('./foundryContextManager').FoundryContextPack | null
  planningMode?: boolean
  skillImports?: string[]
  engineeringClass?: import('./foundryContractTypes').FoundryEngineeringClass
  missionContractId?: string | null
  acceptanceContractId?: string | null
  missionContractHash?: string | null
  acceptanceContractHash?: string | null
  contractSpecApproved?: boolean
  reviewOutcome?: import('./foundryContractTypes').FoundryReviewOutcome | null
  executionApprovalId?: string | null
  executionApprovalIds?: string[]
  /** FRK session reference. The graph lives in the reasoning session store, not here. */
  reasoningSessionId?: string | null
  reasoningBrief?: import('./reasoning-kernel/types').FoundryReasoningBrief | null
  reasoningStatus?: string | null
  reasoningUpdatedAt?: string | null
  routingDecisionId?: string | null
  routingDecision?: import('./foundryWorkerRouting').FoundryWorkerRoutingDecision | null
  recommendedWorker?: { provider: string | null; model: string | null } | null
  actualWorker?: { provider: string | null; model: string | null; source: 'POLICY_LOCAL' | 'PINNED' | 'CAPABILITY' | 'NONE' } | null
}

const OPERATIONAL = ['PAUSED', 'WAITING_AUTHORIZATION', 'WAITING_RESOURCE', 'RECOVERING'] as const

export const LEGAL_TRANSITIONS: Record<FoundryMissionState, FoundryMissionState[]> = {
  QUEUED: ['UNDERSTANDING', 'CANCELLED', ...OPERATIONAL],
  UNDERSTANDING: ['INSPECTING', 'PLANNING', 'BLOCKED', 'FAILED', 'CANCELLED', ...OPERATIONAL],
  INSPECTING: ['PLANNING', 'EXECUTING', 'BLOCKED', 'FAILED', 'CANCELLED', ...OPERATIONAL],
  PLANNING: ['EXECUTING', 'INSPECTING', 'BLOCKED', 'FAILED', 'CANCELLED', ...OPERATIONAL],
  EXECUTING: ['VALIDATING', 'REPLANNING', 'BUILDING', 'VERIFYING', 'BLOCKED', 'FAILED', 'CANCELLED', 'ACTIVATION_PENDING', ...OPERATIONAL],
  VALIDATING: ['EXECUTING', 'BUILDING', 'VERIFYING', 'REPLANNING', 'COMPLETE', 'BLOCKED', 'FAILED', 'CANCELLED', 'ACTIVATION_PENDING', ...OPERATIONAL],
  BUILDING: ['PACKAGING', 'REPLANNING', 'BLOCKED', 'FAILED', 'CANCELLED', 'ACTIVATION_PENDING', ...OPERATIONAL],
  PACKAGING: ['INSTALLING', 'REPLANNING', 'BLOCKED', 'FAILED', 'CANCELLED', 'ACTIVATION_PENDING', ...OPERATIONAL],
  INSTALLING: ['VERIFYING', 'REPLANNING', 'BLOCKED', 'FAILED', 'CANCELLED', 'ACTIVATION_PENDING', ...OPERATIONAL],
  VERIFYING: ['COMPLETE', 'REPLANNING', 'BLOCKED', 'FAILED', 'CANCELLED', 'ACTIVATION_PENDING', ...OPERATIONAL],
  REPLANNING: ['INSPECTING', 'EXECUTING', 'VALIDATING', 'BLOCKED', 'FAILED', 'CANCELLED', 'ACTIVATION_PENDING', ...OPERATIONAL],
  PAUSED: ['QUEUED', 'EXECUTING', 'CANCELLED', 'RECOVERING', 'WAITING_AUTHORIZATION', 'WAITING_RESOURCE', 'ACTIVATION_PENDING', 'BLOCKED'],
  WAITING_AUTHORIZATION: ['EXECUTING', 'BLOCKED', 'CANCELLED', 'PAUSED', 'RECOVERING', 'ACTIVATION_PENDING'],
  WAITING_RESOURCE: ['EXECUTING', 'PAUSED', 'BLOCKED', 'CANCELLED', 'RECOVERING', 'ACTIVATION_PENDING'],
  ACTIVATION_PENDING: ['EXECUTING', 'VERIFYING', 'WAITING_RESOURCE', 'PAUSED', 'BLOCKED', 'CANCELLED', 'RECOVERING', 'FAILED'],
  RECOVERING: ['QUEUED', 'EXECUTING', 'PAUSED', 'WAITING_AUTHORIZATION', 'WAITING_RESOURCE', 'ACTIVATION_PENDING', 'BLOCKED', 'CANCELLED', 'FAILED'],
  BLOCKED: ['QUEUED', 'EXECUTING', 'CANCELLED', 'FAILED', 'PAUSED', 'WAITING_AUTHORIZATION', 'WAITING_RESOURCE', 'ACTIVATION_PENDING', 'RECOVERING'],
  COMPLETE: [],
  FAILED: ['CANCELLED', 'ACTIVATION_PENDING'],
  CANCELLED: [],
}

export const FOUNDRY_TERMINAL_STATES: readonly FoundryMissionState[] = ['COMPLETE', 'FAILED', 'CANCELLED']
export const FOUNDRY_HOLD_STATES: readonly FoundryMissionState[] = [
  'COMPLETE',
  'FAILED',
  'CANCELLED',
  'BLOCKED',
  'PAUSED',
  'WAITING_AUTHORIZATION',
  'WAITING_RESOURCE',
  'ACTIVATION_PENDING',
]
