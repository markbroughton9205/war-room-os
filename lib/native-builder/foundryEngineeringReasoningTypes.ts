/**
 * Concise engineering rationale for Foundry.
 * Persisted artifacts are evidence and decisions. They are not hidden chain-of-thought.
 * Reasoning roles are assignments. They do not add a second agent runtime or a new authority.
 */

export const FOUNDRY_REASONING_SCHEMA_VERSION = 1 as const

export const FOUNDRY_REASONING_ROLES = [
  'ARCHITECT',
  'IMPLEMENTER',
  'DEBUGGER',
  'TEST_ENGINEER',
  'REVIEWER',
  'VERIFIER',
] as const
export type FoundryReasoningRole = (typeof FOUNDRY_REASONING_ROLES)[number]

export const FOUNDRY_REASONING_STAGES = [
  'MISSION',
  'UNDERSTAND',
  'CODEBASE_MODEL',
  'UNCERTAINTIES',
  'CANDIDATES',
  'CRITIQUE',
  'SELECT',
  'IMPLEMENT',
  'OBSERVE',
  'DIAGNOSE',
  'REPLAN',
  'TEST',
  'ADVERSARIAL_REVIEW',
  'VERIFY',
  'LEARN',
] as const
export type FoundryReasoningStage = (typeof FOUNDRY_REASONING_STAGES)[number]

export const FOUNDRY_CAPABILITY_CLASSES = [
  'AMBIGUOUS_BUG',
  'MULTI_FILE_ARCHITECTURE',
  'MISLEADING_REGRESSION',
  'PERFORMANCE_BOTTLENECK',
  'CONCURRENCY_STATE',
  'INCOMPLETE_SPEC',
  'LEGACY_MODIFICATION',
  'CROSS_STACK_INTEGRATION',
  'ARCHITECTURE_COMPARISON',
] as const
export type FoundryCapabilityClass = (typeof FOUNDRY_CAPABILITY_CLASSES)[number]

export const FOUNDRY_CAPABILITY_DIFFICULTIES = ['D1', 'D2', 'D3', 'D4'] as const
export type FoundryCapabilityDifficulty = (typeof FOUNDRY_CAPABILITY_DIFFICULTIES)[number]

export const FOUNDRY_ADVERSARIAL_FINDING_KINDS = [
  'INCORRECT_ASSUMPTION',
  'MISSING_EDGE',
  'SECURITY',
  'BROKEN_INTEGRATION',
  'INCOMPLETE_REQUIREMENT',
  'WEAK_TEST',
  'ACCIDENTAL_COMPLEXITY',
  'REGRESSION',
] as const
export type FoundryAdversarialFindingKind = (typeof FOUNDRY_ADVERSARIAL_FINDING_KINDS)[number]

export const FOUNDRY_REASONING_PASS_STREAK = 3 as const
export const FOUNDRY_REASONING_MAX_ATTEMPTS = 4 as const

export type FoundryReasoningObservation = {
  id: string
  text: string
  facts: Record<string, string | number | boolean>
}

export type FoundryReasoningHypothesis = {
  id: string
  statement: string
  cites: string[]
  claimFacts: Record<string, string | number | boolean>
  files: Record<string, string>
}

export type FoundryReasoningAssumption = {
  id: string
  statement: string
  evidenceIds: string[]
  statedAsFact: boolean
  claimFacts?: Record<string, string | number | boolean>
}

export type FoundryAdversarialFinding = {
  findingId: string
  kind: FoundryAdversarialFindingKind
  summary: string
  evidenceRef: string
  blocksReady: boolean
  resolved: boolean
}

export type FoundryEngineeringDossier = {
  schemaVersion: typeof FOUNDRY_REASONING_SCHEMA_VERSION
  missionId: string
  capabilityClass: FoundryCapabilityClass | 'MISSION'
  problemModel: string
  assumptions: FoundryReasoningAssumption[]
  uncertainties: string[]
  codebaseModel: string[]
  hypotheses: Array<{ id: string; statement: string; status: 'open' | 'rejected' | 'failed' | 'selected' }>
  alternatives: string[]
  selectedApproach: string
  rejected: Array<{ statement: string; reason: string }>
  predictedFailureModes: string[]
  observedFailures: string[]
  rootCause: string
  missingRequirementIds: string[]
  excerpts: string[]
}

export type FoundryEngineeringLesson = {
  schemaVersion: typeof FOUNDRY_REASONING_SCHEMA_VERSION
  lessonId: string
  capabilityClass: FoundryCapabilityClass | 'MISSION'
  problemPattern: string
  failedApproach: string
  successfulApproach: string
  rootCause: string
  toolEvidence: string[]
  projectConstraints: string[]
  sourceMissionId: string
  category?: 'PLAN_IMPLEMENTATION_GAP' | 'GENERAL'
}

export type FoundryEngineeringOutcomeMetrics = {
  firstPlanSuccess: boolean
  failedHypothesisRecovery: boolean
  unnecessaryEditCount: number
  regressionCount: number
  verifierFoundDefectCount: number
  repeatedErrorCount: number
  replanSuccess: boolean
  toolCalls: number
  usefulToolCalls: number
  toolEfficiency: number
  modelCalls: number
  acceptanceSuccess: boolean
}

export type FoundryReasoningRoleAssignment = {
  reasoningRole: FoundryReasoningRole
  operationalRole: 'ARCHITECT' | 'BACKEND' | 'FRONTEND' | 'DATABASE' | 'DEBUGGER' | 'TEST' | 'REVIEWER' | 'VERIFIER'
  provider: string
  model: string
  reason: string
}

export const FOUNDRY_REASONING_OWNERSHIP = {
  foundry: ['orchestration', 'engineering process', 'memory', 'verification', 'governance', 'learning loop'],
  model: ['reasoning generation'],
  toolBroker: ['execution'],
  commander: ['authority'],
} as const
