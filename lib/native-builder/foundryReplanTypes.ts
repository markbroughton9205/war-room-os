/**
 * Replan taxonomy, records, and budgets for the existing Command Center DAG.
 * Does not create a second graph engine or FailureSystem2.
 */
export const FOUNDRY_REPLAN_SCHEMA_VERSION = 1 as const

export const FOUNDRY_REPLAN_LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4'] as const
export type FoundryReplanLevel = (typeof FOUNDRY_REPLAN_LEVELS)[number]

export const FOUNDRY_REPLAN_STATUSES = [
  'PROPOSED',
  'APPLIED',
  'REFUSED',
  'REAPPROVAL_REQUIRED',
  'BLOCKED',
] as const
export type FoundryReplanStatus = (typeof FOUNDRY_REPLAN_STATUSES)[number]

export const FOUNDRY_REPLAN_FAILURE_CLASSES = [
  'IMPLEMENTATION_BUG',
  'TEST_EXPECTATION_OUTDATED',
  'TRANSIENT',
  'PROVIDER_LIMIT',
  'PERMISSION',
  'DEPENDENCY_MISSING',
  'ENVIRONMENT',
  'CONTRACT_SCOPE',
  'UNKNOWN',
] as const
export type FoundryReplanFailureClass = (typeof FOUNDRY_REPLAN_FAILURE_CLASSES)[number]

export const FOUNDRY_STAGNATION_THRESHOLDS = {
  identicalActionRepeats: 2,
  sameFailureRepeats: 2,
  noProgressAttempts: 3,
  unchangedDiffRepeats: 2,
  oscillationPairs: 2,
  frontierStallCycles: 3,
  actionWindow: 12,
  maxSteerPerTask: 4,
  maxTaskReplans: 3,
  maxDagReplans: 3,
  maxMissionReplanRequests: 2,
} as const

export type FoundryReplanDependencyChange = {
  taskId: string
  from: string[]
  to: string[]
  reason: string
}

export type FoundryReplanNewTask = {
  title: string
  role: string
  dependsOn?: string[]
  writeSet?: string[]
  requirementIds?: string[]
  criterionIds?: string[]
  mutating?: boolean
  strategy?: string
  replacesTaskId?: string
}

export type FoundryStructuredReplanProposal = {
  level: FoundryReplanLevel
  reason: string
  failureClass: FoundryReplanFailureClass
  changedTaskIds: string[]
  newTasks: FoundryReplanNewTask[]
  removedTaskIds: string[]
  dependencyChanges: FoundryReplanDependencyChange[]
  expectedProgressSignal: string
  strategy?: string
  writeSet?: string[]
  expandsMission?: boolean
  changesAcceptance?: boolean
  taskId?: string | null
}

export type FoundryReplanRecord = {
  schemaVersion: typeof FOUNDRY_REPLAN_SCHEMA_VERSION
  replanId: string
  missionId: string
  graphId: string
  taskId: string | null
  level: FoundryReplanLevel
  reason: string
  failureClass: FoundryReplanFailureClass
  previousPlanHash: string
  proposedPlanHash: string
  changedTaskIds: string[]
  addedTaskIds: string[]
  removedTaskIds: string[]
  dependencyChanges: FoundryReplanDependencyChange[]
  contractGeneration: string | null
  approvalId: string | null
  createdAt: string
  status: FoundryReplanStatus
  expectedProgressSignal: string
  steerCount?: number
  taskReplanCount?: number
  dagReplanCount?: number
}

export type FoundryActionObservation = {
  at?: string
  taskId: string
  tool?: string
  fingerprint: string
  ok: boolean
  kind: 'action' | 'failure' | 'test' | 'diff' | 'blocked' | 'progress'
  detail?: string
  filesChanged?: string[]
  testsPass?: number | null
  testsFail?: number | null
}

export type FoundryStagnationReport = {
  detected: boolean
  reasons: string[]
  score: number
  identicalAction: boolean
  sameFailure: boolean
  noProgress: boolean
  unchangedDiff: boolean
  oscillation: boolean
  frontierStalled: boolean
  retryExhausted: boolean
  lastProgressAt: string | null
  lastProgressFingerprint: string | null
  attemptCount: number
  repeatActionRefused: boolean
}

export type FoundryReplanBudgets = {
  steerCount: number
  taskReplanCount: number
  dagReplanCount: number
  missionReplanRequestCount: number
}
