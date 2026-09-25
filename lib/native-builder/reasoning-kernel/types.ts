/**
 * Foundry Reasoning Kernel contracts.
 * Persisted fields are typed engineering artifacts.
 * Private chain-of-thought is not a field on any of these types.
 */
import type { FoundryReasoningRole } from '../foundryEngineeringReasoningTypes'
import type { FoundryResourceActionKind } from '../foundryResourceGovernorTypes'
import type {
  FoundryCapabilityGap,
  FoundryDerivedCache,
  FoundryEfficiencyState,
  FoundryProjectReasoningState,
  FoundryReasoningHealthFinding,
  FoundryStrategyDecision,
  FoundryStrategyLesson,
  FoundryWorkerCapabilityEvidence,
} from './program-types'

export const FRK_SCHEMA_VERSION = 1 as const
export const FRK_MAX_STEPS = 32 as const
export const FRK_TEXT_LIMIT = 280 as const

export const RAW_CHAIN_OF_THOUGHT_STORED_COUNT = 0 as const
export const UNBOUNDED_REASONING_LOOP_COUNT = 0 as const
export const FRK_QWEN_DEPENDENCY_COUNT = 0 as const
export const FRK_CURSOR_DEPENDENCY_COUNT = 0 as const
export const FRK_DIRECT_FILESYSTEM_WRITE_COUNT = 0 as const
export const SECOND_REASONING_TRUTH_COUNT = 0 as const
export const FRK_SEARCH_PROVIDER_DEPENDENCY_COUNT = 0 as const
export const FRK_REPEATED_FAILED_BRANCH_WITHOUT_REPLAN_COUNT = 0 as const
export const DUPLICATE_REASONING_SESSION_COUNT = 0 as const
export const REPLAYED_MUTATION_AFTER_RESTART_COUNT = 0 as const
export const UNBOUNDED_META_REASONING_COUNT = 0 as const
export const LIVE_MISSION_DUPLICATE_REASONING_SESSION_COUNT = 0 as const
export const HIDDEN_SOLUTION_MEMORY_ACCEPT_COUNT = 0 as const
export const SECRET_REASONING_MEMORY_COUNT = 0 as const
export const AUTONOMOUS_AUTHORITY_EXPANSION_COUNT = 0 as const
export const FALSE_REASONING_PASS_COUNT = 0 as const
export const FRK_PROVIDER_SPECIFIC_CORE_IMPORT_COUNT = 0 as const
export const FRK_WRIM_INTERNAL_DEPENDENCY_COUNT = 0 as const
export const AUTONOMOUS_KERNEL_CODE_REWRITE_COUNT = 0 as const
export const HIDDEN_VERIFIER_EXPORT_COUNT = 0 as const
export const RAW_CHAIN_OF_THOUGHT_EXPORT_COUNT = 0 as const
export const SECRET_EXPORT_COUNT = 0 as const

export const FRK_UNCERTAINTY_STATES = ['KNOWN', 'LIKELY', 'POSSIBLE', 'UNKNOWN', 'CONTRADICTED'] as const
export type FrkUncertainty = (typeof FRK_UNCERTAINTY_STATES)[number]

export const FRK_ASSUMPTION_STATUSES = ['OPEN', 'SUPPORTED', 'REJECTED', 'IRRELEVANT'] as const
export type FrkAssumptionStatus = (typeof FRK_ASSUMPTION_STATUSES)[number]

export const FRK_HYPOTHESIS_STATUSES = ['ACTIVE', 'SUPPORTED', 'WEAKENED', 'REJECTED', 'UNRESOLVED'] as const
export type FrkHypothesisStatus = (typeof FRK_HYPOTHESIS_STATUSES)[number]

export const FRK_NODE_TYPES = [
  'PROBLEM',
  'SUBPROBLEM',
  'HYPOTHESIS',
  'EVIDENCE',
  'ASSUMPTION',
  'QUESTION',
  'PLAN',
  'ACTION',
  'OBSERVATION',
  'CONTRADICTION',
  'CRITIQUE',
  'VERIFICATION',
  'DECISION',
  'LESSON',
] as const
export type FrkNodeType = (typeof FRK_NODE_TYPES)[number]

export const FRK_EDGE_TYPES = [
  'SUPPORTS',
  'CONTRADICTS',
  'DEPENDS_ON',
  'DERIVED_FROM',
  'TESTS',
  'RESOLVES',
  'REJECTS',
  'REFINES',
  'CAUSES',
  'VERIFIES',
] as const
export type FrkEdgeType = (typeof FRK_EDGE_TYPES)[number]

export const FRK_STRATEGIES = [
  'DIRECT',
  'DECOMPOSE',
  'HYPOTHESIS_COMPETITION',
  'ROOT_CAUSE',
  'ARCHITECTURE_COMPARISON',
  'COUNTEREXAMPLE_SEARCH',
  'VERIFICATION_FIRST',
  'PLAN_SEARCH',
  'REPAIR_LOOP',
] as const
export type FoundryReasoningStrategy = (typeof FRK_STRATEGIES)[number]

export const FRK_DEPTHS = ['R0', 'R1', 'R2', 'R3', 'R4'] as const
export type FrkDepth = (typeof FRK_DEPTHS)[number]

export const FRK_PHASES = [
  'UNDERSTAND',
  'SELECT_STRATEGY',
  'REASON',
  'REQUEST_EVIDENCE',
  'PLAN',
  'ACT',
  'OBSERVE',
  'UPDATE_GRAPH',
  'CRITIQUE',
  'REPLAN',
  'VERIFY',
  'DECIDE',
  'LEARN',
] as const
export type FrkPhase = (typeof FRK_PHASES)[number]

export const FRK_STOP_REASONS = [
  'ACCEPTANCE_PROVEN',
  'BUDGET_EXHAUSTED',
  'COMMANDER_DECISION',
  'ENVIRONMENT_BLOCKED',
  'CAPABILITY_INSUFFICIENT',
  'EVIDENCE_UNAVAILABLE',
  'BLOCKED_PROVIDER',
] as const
export type FrkStopReason = (typeof FRK_STOP_REASONS)[number]

export const FRK_SESSION_STATUSES = [
  'OPEN',
  'RUNNING',
  'REPLANNING',
  'BLOCKED_PROVIDER',
  'BLOCKED_RESOURCE',
  'BLOCKED_EVIDENCE',
  'BLOCKED_CAPABILITY',
  'BLOCKED_COMMANDER',
  'BLOCKED',
  'READY_REFUSED',
  'PROJECT_READY',
  'REASONING_STATE_UNTRUSTED',
  'STOPPED',
] as const
export type FrkSessionStatus = (typeof FRK_SESSION_STATUSES)[number]

export const FRK_CONTRADICTION_TYPES = [
  'MODEL_VS_SOURCE',
  'PLAN_VS_CODE',
  'PREDICTION_VS_RUNTIME',
  'TEST_VS_ASSUMPTION',
  'REVIEWER_VS_IMPLEMENTATION',
  'VERIFIER_VS_CLAIM',
  'EVIDENCE_VS_EVIDENCE',
  'PREDICTION_MISMATCH',
] as const
export type FrkContradictionType = (typeof FRK_CONTRADICTION_TYPES)[number]

export const FRK_CRITIC_CATEGORIES = [
  'BAD_ASSUMPTION',
  'MISSING_EDGE_CASE',
  'BROKEN_INTEGRATION',
  'SECURITY_RISK',
  'TEST_WEAKNESS',
  'CONSTRAINT_VIOLATION',
  'REGRESSION_RISK',
  'PLAN_CODE_MISMATCH',
  'UNSUPPORTED_CLAIM',
  'UNNECESSARY_COMPLEXITY',
] as const
export type FrkCriticCategory = (typeof FRK_CRITIC_CATEGORIES)[number]

export const FRK_EVIDENCE_SOURCES = [
  'SOURCE_CODE',
  'FILE_CONTENT',
  'TEST_RESULT',
  'BUILD_RESULT',
  'RUNTIME_OUTPUT',
  'HTTP_RESULT',
  'DATABASE_STATE',
  'DEBUG_STATE',
  'SCM_STATE',
  'STATIC_ANALYSIS',
  'USER_CONSTRAINT',
  'MISSION_CONTRACT',
  'TOOL_OBSERVATION',
  'MODEL_ASSERTION',
] as const
export type FrkEvidenceSource = (typeof FRK_EVIDENCE_SOURCES)[number]

export const FRK_CLAIM_STATUSES = ['PROVEN', 'SUPPORTED', 'UNRESOLVED', 'REFUTED'] as const
export type FrkClaimStatus = (typeof FRK_CLAIM_STATUSES)[number]

export const FRK_META_DECISIONS = [
  'CONTINUE',
  'CHANGE_STRATEGY',
  'GATHER_EVIDENCE',
  'DECOMPOSE',
  'MERGE_SUBPROBLEMS',
  'SIMPLIFY',
  'ESCALATE_DEPTH',
  'DEESCALATE_DEPTH',
  'BLOCK',
] as const
export type FrkMetaDecision = (typeof FRK_META_DECISIONS)[number]

export const FRK_WORKER_TASKS = [
  'understand',
  'hypotheses',
  'plans',
  'critique',
  'diagnosis',
  'repair',
  'counterexamples',
] as const
export type FrkWorkerTask = (typeof FRK_WORKER_TASKS)[number]

export const FRK_CAPABILITIES = [
  'AMBIGUITY_RESOLUTION',
  'ROOT_CAUSE_DIAGNOSIS',
  'PLAN_TO_CODE_FIDELITY',
  'COUNTEREXAMPLE_SEARCH',
  'CROSS_LAYER_REASONING',
  'ARCHITECTURE_SELECTION',
  'TEST_TRUTH_DISCRIMINATION',
  'PERFORMANCE_REASONING',
  'LEGACY_CONSTRAINT_REASONING',
] as const
export type FrkCapability = (typeof FRK_CAPABILITIES)[number]

export const FRK_COUNTEREXAMPLE_CASES = [
  'boundary values',
  'empty state',
  'concurrent state',
  'invalid input',
  'restart',
  'partial failure',
  'stale state',
  'duplicate input',
] as const

export const FRK_VERIFICATION_FORMS = [
  'tests',
  'hidden tests',
  'runtime behavior',
  'static invariants',
  'database state',
  'HTTP behavior',
  'build result',
  'source structure',
] as const

export const FRK_COMMANDER_GATED_ACTIONS = [
  'commit',
  'push',
  'deploy',
  'spend',
  'change acceptance',
  'raise budget',
  'download model',
  'install software',
  'activate production',
  'destructive delete',
] as const

export const FRK_REASONING_ROLES: readonly FoundryReasoningRole[] = [
  'ARCHITECT',
  'IMPLEMENTER',
  'DEBUGGER',
  'TEST_ENGINEER',
  'REVIEWER',
  'VERIFIER',
] as const

export type FoundryDepthSignals = {
  ambiguity: 'low' | 'medium' | 'high'
  blastRadius: 'local' | 'module' | 'cross-layer'
  componentCount: number
  uncertaintyCount: number
  previousFailures: number
  securitySensitive: boolean
  regressionRisk: 'low' | 'medium' | 'high'
  separable: boolean
  symptomMayDifferFromCause: boolean
  designTask: boolean
  wantsPlanSearch: boolean
  verificationFirst: boolean
  budgetAllowsDeepSearch: boolean
}

export type FoundryAssumption = {
  assumptionId: string
  statement: string
  reason: string
  risk: string
  howToVerify: string
  status: FrkAssumptionStatus
}

export type FoundryProblemModel = {
  goal: string
  subgoals: string[]
  constraints: string[]
  mustPreserve: string[]
  mustNotDo: string[]
  acceptanceConditions: string[]
  knownFacts: Array<{ statement: string; uncertainty: 'KNOWN' }>
  inferences: Array<{ statement: string; uncertainty: 'LIKELY' | 'POSSIBLE'; derivedFrom: string[] }>
  assumptions: FoundryAssumption[]
  unknowns: Array<{ statement: string; uncertainty: 'UNKNOWN' }>
  risks: string[]
  dependencies: string[]
}

export type FoundryReasoningNode = {
  nodeId: string
  type: FrkNodeType
  summary: string
  uncertainty: FrkUncertainty
  assumptionUnresolved: boolean
  supportRef: string | null
}

export type FoundryReasoningEdge = {
  edgeId: string
  from: string
  to: string
  type: FrkEdgeType
}

export type FoundryReasoningGraph = {
  nodes: FoundryReasoningNode[]
  edges: FoundryReasoningEdge[]
}

export type FoundryHypothesis = {
  hypothesisId: string
  claim: string
  predictedEvidence: string[]
  supportingEvidence: string[]
  contradictingEvidence: string[]
  status: FrkHypothesisStatus
  confidenceClass: FrkUncertainty
  nextDiscriminatingCheck: string | null
}

export type FoundryEvidenceRequest = {
  requestId: string
  hypothesisIds: string[]
  question: string
  distinguishingObservation: string
}

export type FrkEvidenceAuthority = 'TOOL_RUNTIME' | 'MISSION' | 'MODEL_ASSERTION'

export type FoundryEvidence = {
  evidenceId: string
  source: FrkEvidenceSource
  statement: string
  provenance: {
    actor: string
    ref: string
    observedAt: string
  }
  authority: FrkEvidenceAuthority
  supportsHypothesisIds: string[]
  contradictsHypothesisIds: string[]
}

export type FoundryCandidatePlan = {
  planId: string
  label: 'A' | 'B' | 'C'
  summary: string
  coversAcceptance: boolean
  selected: boolean
  executed: boolean
}

export type FoundryPredictedOutcome = {
  predictionId: string
  expectedFileChange: string
  expectedTestOutcome: string
  expectedRuntimeEffect: string
  possibleRegressions: string[]
  compared: boolean
  matched: boolean | null
}

export type FoundryObservation = {
  observationId: string
  actionId: string | null
  hypothesisId: string | null
  planId: string | null
  predictionId: string | null
  summary: string
  evidenceId: string | null
}

export type FoundryContradiction = {
  contradictionId: string
  type: FrkContradictionType
  summary: string
  affectsAcceptance: boolean
  resolved: boolean
}

export type FoundryCriticFinding = {
  findingId: string
  category: FrkCriticCategory
  summary: string
  blocksAcceptance: boolean
  resolved: boolean
  sawSource: true
}

export type FoundryVerifiedClaim = {
  claimId: string
  claim: string
  supportingEvidenceIds: string[]
  contradictingEvidenceIds: string[]
  status: FrkClaimStatus
  workerDeclaredSuccess: boolean
}

export type FoundryVerificationState = {
  formsConsidered: string[]
  claims: FoundryVerifiedClaim[]
  projectReady: boolean
  refusal: string | null
}

export type FoundryReasoningResourceState = {
  workerCalls: number
  tokens: number
  toolCalls: number
  tests: number
  builds: number
  replans: number
  wallTimeMs: number
  searchBranches: number
  limits: {
    workerCalls: number
    tokens: number
    toolCalls: number
    tests: number
    builds: number
    replans: number
    wallTimeMs: number
    searchBranches: number
    maxSteps: number
  }
  automaticIncreaseRefused: number
}

export type FrkResourceCharge = keyof Pick<
  FoundryReasoningResourceState,
  'workerCalls' | 'tokens' | 'toolCalls' | 'tests' | 'builds' | 'replans' | 'wallTimeMs' | 'searchBranches'
>

export type FoundryReasoningLesson = {
  lessonId: string
  pattern: string
  context: string
  failedApproach?: string
  successfulApproach?: string
  evidence: string[]
  applicability: string
  antiPattern?: string
  capabilityFamily: FrkCapability
  sameAnswer: false
}

export type FoundryCapabilitySignal = {
  capability: FrkCapability | FrkSearchCapability
  gap: boolean
  evidence: string
}

export type FoundryDifficultyProfile = {
  ambiguity: number
  components: number
  constraints: number
  failureModes: number
  integrationDepth: number
  successStreak: number
}

export type FoundryPracticeRecord = {
  practiceId: string
  capability: FrkCapability
  chosen: string
  evaluated: boolean
  evidence: string
  commanderProjectsBlocked: false
}

export type FoundryRoutingEvidence = {
  problemFamily: string
  difficulty: FrkDepth
  provider: string
  model: string
  result: string
  resourceUse: { workerCalls: number; tokens: number }
  replans: number
  contradictions: number
  verification: string
  policyChanged: false
}

export type FoundryPendingMutation = {
  mutationId: string
  summary: string
  applied: boolean
}

export type FoundryToolSelection = {
  selectionId: string
  need: string
  toolFamily: string
  reason: string
  authority: 'TOOL_BROKER'
  executed: false
}

export type FoundryArchitectureOption = {
  optionId: string
  name: string
  requirementsCoverage: string
  complexity: string
  dependencies: string
  failureModes: string
  operationalCost: string
  migrationDifficulty: string
  testability: string
  securityImplications: string
  coversAcceptance: boolean
}

export type FoundryRootCauseRecord = {
  symptom: string
  candidateCauses: string[]
  evidenceIds: string[]
  rootCause: string | null
  repairImplication: string | null
}

export type FoundryReasoningWorkerRequest = {
  requestId: string
  missionId: string
  task: FrkWorkerTask
  problem: string
  constraints: string[]
  evidenceSummaries: string[]
}

export type FoundryReasoningWorkerResponse = {
  task: FrkWorkerTask
  summary: string
  hypotheses?: Array<{ claim: string; predictedEvidence: string[] }>
  plans?: Array<{ label: 'A' | 'B' | 'C'; summary: string }>
  critique?: Array<{ category: FrkCriticCategory; summary: string }>
  claims?: string[]
  toolRequests?: Array<{ name: string; args?: Record<string, string> }>
  declaredDone?: boolean
  resourceTokens?: number
}

export const FRK_BRANCH_STATUSES = ['ACTIVE', 'PROMISING', 'WEAKENED', 'REJECTED', 'SELECTED', 'EXHAUSTED', 'BLOCKED'] as const
export type FrkBranchStatus = (typeof FRK_BRANCH_STATUSES)[number]

export const FRK_BRANCH_KINDS = ['hypothesis', 'plan', 'repair', 'architecture', 'counterexample', 'verification'] as const
export type FrkBranchKind = (typeof FRK_BRANCH_KINDS)[number]

export const FRK_LIFECYCLE = ['CREATE', 'ATTACH', 'LOAD', 'UPDATE', 'SUSPEND', 'RESUME', 'COMPLETE', 'BLOCK'] as const
export type FrkLifecycle = (typeof FRK_LIFECYCLE)[number]

export const FRK_BRANCH_REASONS = ['alternative', 'contradiction', 'critic', 'stagnation'] as const
export type FrkBranchReason = (typeof FRK_BRANCH_REASONS)[number]

export const FRK_TOOL_COSTS = ['cheap', 'moderate', 'expensive'] as const
export type FrkToolCost = (typeof FRK_TOOL_COSTS)[number]

export const FRK_SEARCH_CAPABILITIES = [
  'HYPOTHESIS_SEARCH',
  'PLAN_SEARCH',
  'BRANCH_PRUNING',
  'EVIDENCE_SELECTION',
  'COUNTEREXAMPLE_REASONING',
  'STRATEGY_SWITCHING',
  'SEARCH_STAGNATION_RECOVERY',
] as const
export type FrkSearchCapability = (typeof FRK_SEARCH_CAPABILITIES)[number]

export type FoundryBranchScorecard = {
  requirementsCoverage: 'covered' | 'partial' | 'missed'
  evidenceSupport: number
  contradictions: number
  unresolvedAssumptions: number
  estimatedToolCost: FrkToolCost
  riskFlags: string[]
  verificationCoverage: 'none' | 'partial' | 'verified'
}

export type FoundryReasoningBranch = {
  branchId: string
  parentBranchId: string | null
  label: string
  kind: FrkBranchKind
  hypothesisIds: string[]
  planId: string | null
  assumptions: string[]
  evidenceIds: string[]
  predictedOutcome: string | null
  status: FrkBranchStatus
  resourceSpent: { workerCalls: number; toolCalls: number }
  scorecard: FoundryBranchScorecard
  rejectionReason: string | null
  proposedBy: { provider: string; model: string } | null
  createdBecause: string
  idempotencyKey: string
}

export type FoundryBranchDecision = {
  branchId: string
  decision: 'created' | 'weakened' | 'rejected' | 'selected'
  why: string
}

export type FoundrySearchTrace = FoundryBranchDecision

export type FoundrySearchBudget = {
  maxBranches: number
  maxDepth: number
  maxWorkerCalls: number
  maxToolCalls: number
  maxReplans: number
  maxWallTimeMs: number
}

export type FoundrySearchState = {
  branches: FoundryReasoningBranch[]
  selectedBranchId: string | null
  trace: FoundrySearchTrace[]
  budget: FoundrySearchBudget
  repeatedFailedWithoutReplan: 0
  failureFingerprints: string[]
  lifecycle: FrkLifecycle
}

export type FoundryReasoningBranchLine = {
  label: string
  status: FrkBranchStatus
  note: string
}

export type FoundryReasoningBrief = {
  problem: string
  known: string[]
  uncertain: string[]
  hypothesis: string
  plan: string
  evidence: string[]
  contradictions: string[]
  directionChanges: string[]
  unproven: string[]
  strategy: string
  depth: string
  verification: string
  privateReasoningExposed: false
  currentGoal: string
  knownFacts: string[]
  unknowns: string[]
  activeHypotheses: string[]
  selectedPlan: string
  latestEvidence: string[]
  criticFindings: string[]
  verificationState: string
  blockedReason: string | null
  nextReasoningAction: string
  status: string
  searchBranches: FoundryReasoningBranchLine[]
  reasonForSelection: string
  previousStrategy: string
  strategyTrigger: string
}

export type FoundryReasoningSession = {
  schemaVersion: typeof FRK_SCHEMA_VERSION
  sessionId: string
  missionId: string
  seq: number
  problemModel: FoundryProblemModel
  constraints: string[]
  acceptanceCriteria: string[]
  unknowns: string[]
  assumptions: FoundryAssumption[]
  hypotheses: FoundryHypothesis[]
  evidence: FoundryEvidence[]
  evidenceRequests: FoundryEvidenceRequest[]
  reasoningGraph: FoundryReasoningGraph
  selectedStrategy: FoundryReasoningStrategy | null
  candidatePlans: FoundryCandidatePlan[]
  currentPlan: FoundryCandidatePlan | null
  observations: FoundryObservation[]
  contradictions: FoundryContradiction[]
  criticFindings: FoundryCriticFinding[]
  verificationState: FoundryVerificationState
  lessons: FoundryReasoningLesson[]
  rejectedLessons: Array<{ reason: string }>
  capabilitySignals: FoundryCapabilitySignal[]
  resourceState: FoundryReasoningResourceState
  selectedDepth: FrkDepth | null
  depthHistory: FrkDepth[]
  signals: FoundryDepthSignals
  predictions: FoundryPredictedOutcome[]
  pendingMutations: FoundryPendingMutation[]
  appliedMutationIds: string[]
  routingEvidence: FoundryRoutingEvidence[]
  metaDecisions: FrkMetaDecision[]
  toolSelections: FoundryToolSelection[]
  roleAssignments: Array<{ reasoningRole: FoundryReasoningRole; operationalRole: string }>
  directionChanges: string[]
  architectures: FoundryArchitectureOption[]
  selectedArchitectureId: string | null
  rootCause: FoundryRootCauseRecord | null
  stagnation: {
    detected: boolean
    fingerprint: string | null
    repeats: number
    response: 'replan' | 'strategy_change' | 'block' | null
  }
  status: FrkSessionStatus
  stopReason: FrkStopReason | null
  phase: FrkPhase
  stepCount: number
  workerStatus: 'IDLE' | 'BLOCKED_PROVIDER' | 'VALIDATED' | 'REJECTED'
  difficulty: FoundryDifficultyProfile
  practice: FoundryPracticeRecord[]
  commanderProjectsBlocked: false
  fidelity: {
    status: string | null
    mismatch: string | null
    reinspected: boolean
  }
  search: FoundrySearchState
  strategyDecisions: FoundryStrategyDecision[]
  previousStrategy: FoundryReasoningStrategy | null
  strategyTrigger: string | null
  metaSteps: number
  strategyLessons: FoundryStrategyLesson[]
  workerEvidence: FoundryWorkerCapabilityEvidence[]
  capabilityGaps: FoundryCapabilityGap[]
  healthFindings: FoundryReasoningHealthFinding[]
  efficiency: FoundryEfficiencyState
  derivedCache: FoundryDerivedCache
  project: FoundryProjectReasoningState | null
  sovereignPolicy: 'DISABLED' | 'SOVEREIGN_ONLY'
  createdAt: string
  updatedAt: string
}

export type FrkChargeKindMap = Record<FrkResourceCharge, FoundryResourceActionKind | null>
