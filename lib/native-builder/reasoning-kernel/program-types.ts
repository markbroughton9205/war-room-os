/**
 * Structured reasoning artifacts for FRK-03 through FRK-12.
 * These types do not store private model reasoning.
 */
import type { FoundryReasoningStrategy, FrkCapability, FrkDepth, FrkMetaDecision } from './types'

export type EvidenceGainEstimate = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN'
export type EvidenceToolCost = 'CHEAP' | 'MODERATE' | 'EXPENSIVE'

export type FoundryStrategyProfile = {
  strategy: FoundryReasoningStrategy
  goodFor: string[]
  poorFor: string[]
  ambiguityRange: 'low' | 'medium' | 'high' | 'any'
  componentRange: string
  crossLayerSuitability: 'no' | 'optional' | 'yes'
  uncertaintySuitability: 'low' | 'medium' | 'high'
  failureHistorySuitability: 'none' | 'some' | 'repeated'
  securitySensitivity: 'avoid' | 'neutral' | 'preferred'
  regressionSensitivity: 'avoid' | 'neutral' | 'preferred'
  evidenceRequirement: string
  verificationRequirement: string
  resourceClass: EvidenceToolCost
}

export type FoundryStrategyDecision = {
  decisionId: string
  candidateStrategies: FoundryReasoningStrategy[]
  selectedStrategy: FoundryReasoningStrategy
  selectionEvidenceIds: string[]
  rejectedStrategies: Array<{ strategy: FoundryReasoningStrategy; reason: string }>
  reasonForSelection: string
  expectedEvidenceGain: EvidenceGainEstimate
  resourceEstimate: EvidenceToolCost
  trigger: string
  depthBefore: FrkDepth | null
  depthAfter: FrkDepth | null
  timestamp: string
}

export type FoundryStrategyLessonStatus = 'ACTIVE' | 'STALE' | 'CONTRADICTED' | 'SUPERSEDED' | 'RETIRED'

export type FoundryStrategyMemoryCategory =
  | 'PATTERN'
  | 'ANTIPATTERN'
  | 'DEBUGGING_STRATEGY'
  | 'ARCHITECTURE_STRATEGY'
  | 'TESTING_STRATEGY'
  | 'VERIFICATION_STRATEGY'
  | 'PERFORMANCE_STRATEGY'
  | 'LEGACY_STRATEGY'
  | 'CROSS_LAYER_STRATEGY'
  | 'RECOVERY_STRATEGY'

export type FoundryStrategyLesson = {
  lessonId: string
  capabilityFamily: FrkCapability
  category: FoundryStrategyMemoryCategory
  problemPattern: string
  contextFeatures: string[]
  strategyUsed: FoundryReasoningStrategy
  failedStrategies: FoundryReasoningStrategy[]
  successfulStrategy: FoundryReasoningStrategy | null
  evidencePattern: string
  contradictionPattern: string
  toolPattern: string
  verificationPattern: string
  applicability: string
  antiPattern: string
  providerIndependent: true
  sourceMissionId: string
  sourceSessionId: string
  verified: boolean
  status: FoundryStrategyLessonStatus
  createdAt: string
  updatedAt: string
}

export type FoundryTransferRecord = {
  lessonId: string
  lessonRetrieved: boolean
  lessonApplicable: boolean
  strategyChanged: boolean
  firstPlanSuccess: boolean
  unnecessaryEdits: number
  replans: number
  verificationResult: string
  sameAnswer: false
}

export const FRK_SPECIALIST_ROLES = [
  'ARCHITECT',
  'CODE_ENGINEER',
  'DEBUGGER',
  'TEST_ENGINEER',
  'SECURITY_REVIEWER',
  'PERFORMANCE_REVIEWER',
  'DATABASE_ENGINEER',
  'SYSTEMS_ENGINEER',
  'REVIEWER',
  'VERIFIER',
] as const
export type FrkSpecialistRole = (typeof FRK_SPECIALIST_ROLES)[number]

export type FoundryWorkerCapabilityEvidence = {
  provider: string
  model: string
  capabilityFamily: FrkCapability
  fixtureDifficulty: string
  success: boolean
  failureType: string | null
  calls: number
  tokens: number
  toolCalls: number
  replans: number
  contradictions: number
  verificationResult: string
  timestamp: string
}

export type FoundryWorkerCandidate = {
  provider: string
  model: string
  available: boolean
  local: boolean
  privacy: 'local' | 'remote'
  taskTypes: FrkSpecialistRole[]
  toolCalls: number
  tokens: number
}

export const FRK_FAILURE_CLASSES = [
  'UNDERSTANDING',
  'HYPOTHESIS',
  'PLAN',
  'PLAN_TO_CODE',
  'IMPLEMENTATION',
  'DEBUGGING',
  'TESTING',
  'VERIFICATION',
  'TOOL_SELECTION',
  'STRATEGY_SELECTION',
  'MODEL_CAPABILITY',
  'PROVIDER',
  'RESOURCE',
  'ENVIRONMENT',
  'UNKNOWN',
] as const
export type FrkFailureClass = (typeof FRK_FAILURE_CLASSES)[number]

export type FrkFailureLayer = 'PROCESS' | 'MODEL' | 'PROVIDER' | 'RESOURCE' | 'ENVIRONMENT'

export type FoundryCapabilityGap = {
  gapId: string
  capability: FrkCapability
  observedFailure: string
  evidence: string[]
  failureClass: FrkFailureClass
  failureLayer: FrkFailureLayer
  practiceNeeded: boolean
  recommendedDifficulty: string
  providerSpecific: boolean
  processSpecific: boolean
  modelSpecific: boolean
  status: 'OPEN' | 'PRACTICING' | 'REEVALUATING' | 'CLOSED'
  practiceIds: string[]
  distinctPasses: string[]
}

export type FoundryPracticeVariant = {
  practiceId: string
  domain: string
  names: string[]
  layout: string
  inputs: string[]
  constraints: string[]
  failureEvidence: string
  protectedProject: false
  copiesBenchmarkAnswer: false
}

export type FoundryReasoningHealthCategory =
  | 'GRAPH_INCONSISTENCY'
  | 'EVIDENCE_STALE'
  | 'VERIFICATION_CONFLICT'
  | 'RESOURCE_ACCOUNTING_ERROR'
  | 'STRATEGY_STAGNATION'
  | 'BRANCH_EXPLOSION'
  | 'SESSION_CORRUPTION'
  | 'MEMORY_CONTAMINATION'
  | 'WORKER_OUTPUT_INVALID'
  | 'UNKNOWN'

export type FoundryReasoningHealthFinding = {
  findingId: string
  category: FoundryReasoningHealthCategory
  summary: string
  repaired: boolean
}

export type FoundryArchitectureDecisionRecord = {
  decisionId: string
  decision: string
  alternatives: string[]
  evidence: string[]
  constraints: string[]
  date: string
  status: 'ACTIVE' | 'REOPENED' | 'SUPERSEDED'
  supersededBy: string | null
}

export type FoundryProjectReasoningState = {
  projectGoal: string
  milestones: string[]
  dependencies: Array<{ from: string; to: string }>
  openQuestions: string[]
  architecturalDecisions: FoundryArchitectureDecisionRecord[]
  riskRegister: string[]
  acceptedConstraints: string[]
  currentMission: string | null
  futureMissions: string[]
  blockedItems: string[]
  verificationState: string
  technicalDebt: string[]
  lessons: string[]
}

export type FoundryEfficiencyState = {
  timeToFirstUsefulPlanMs: number | null
  workerCalls: number
  tokens: number
  toolCalls: number
  tests: number
  replans: number
  branches: number
  contradictions: number
  unnecessaryEdits: number
  verificationAttempts: number
  wallTimeMs: number
  evidenceReuses: number
}

export type FoundryDerivedCache = {
  revision: string
  entries: Array<{ key: string; value: string; revision: string }>
}

export type FoundryReasoningExportRecord = {
  recordId: string
  className: string
  problem: string
  constraints: string[]
  knownFacts: string[]
  unknowns: string[]
  assumptions: string[]
  hypotheses: string[]
  evidence: string[]
  strategy: string
  plan: string
  observations: string[]
  contradictions: string[]
  repair: string
  verification: string
  lesson: string
  capabilityOutcome: string
  verifiedSuccess: boolean
  problemHash: string
  requirementsHash: string
  strategyHash: string
  solutionStructureHash: string
}

export type FrkMetaControllerResult = {
  decision: FrkMetaDecision
  bounded: true
}

export function emptyEfficiency(): FoundryEfficiencyState {
  return {
    timeToFirstUsefulPlanMs: null,
    workerCalls: 0,
    tokens: 0,
    toolCalls: 0,
    tests: 0,
    replans: 0,
    branches: 0,
    contradictions: 0,
    unnecessaryEdits: 0,
    verificationAttempts: 0,
    wallTimeMs: 0,
    evidenceReuses: 0,
  }
}

export function emptyCache(): FoundryDerivedCache {
  return { revision: 'rev-0', entries: [] }
}
