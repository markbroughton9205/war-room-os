/**
 * Foundry engineering graduation harness schemas.
 * Orchestration capability is not engineering capability.
 * Fixture graduation is not production-proven. Not an AGI claim.
 * No OS daemon.
 */

export const FOUNDRY_GRADUATION_SCHEMA_VERSION = 1 as const

export const FOUNDRY_ENGINEERING_PROJECT_CLASSES = [
  'STATIC_WEB',
  'FRONTEND_APP',
  'BACKEND_API',
  'FULL_STACK_APP',
  'CLI_TOOL',
  'LIBRARY_PACKAGE',
  'DATA_PROCESSING',
  'DATABASE_APP',
  'DESKTOP_APP',
  'TEST_REPAIR',
  'BUG_FIX',
  'REFACTOR',
  'FEATURE_EXTENSION',
  'LEGACY_CODE_MODIFICATION',
] as const
export type FoundryEngineeringProjectClass = (typeof FOUNDRY_ENGINEERING_PROJECT_CLASSES)[number]

export const FOUNDRY_GRADUATION_LEVELS = [
  'UNTESTED',
  'ATTEMPTED',
  'PARTIAL',
  'PASSED_FIXTURE',
  'PASSED_MULTI_FIXTURE',
  'RELIABLE',
  'PRODUCTION_PROVEN',
] as const
export type FoundryGraduationLevel = (typeof FOUNDRY_GRADUATION_LEVELS)[number]

export const FOUNDRY_GRADUATION_LEVEL_DEFINITIONS: Record<FoundryGraduationLevel, string> = {
  UNTESTED: 'No graduation run has been recorded for this project class.',
  ATTEMPTED: 'At least one run exists and none of the required criteria passed as a complete benchmark.',
  PARTIAL: 'Some required criteria passed on at least one run, but no run satisfied every required criterion.',
  PASSED_FIXTURE: 'At least one distinct fixture run independently verified PASS. Not reliability.',
  PASSED_MULTI_FIXTURE: 'At least two substantially different fixture runs independently verified PASS.',
  RELIABLE: 'At least three substantially different fixture runs independently verified PASS with zero critical governance failures. Still not production-proven.',
  PRODUCTION_PROVEN: 'Requires named real deployed/use evidence from a later production mission. Fixtures cannot assign this level.',
}

export const FOUNDRY_GRADUATION_DIFFICULTIES = ['D1', 'D2', 'D3', 'D4'] as const
export type FoundryGraduationDifficulty = (typeof FOUNDRY_GRADUATION_DIFFICULTIES)[number]

export const FOUNDRY_GRADUATION_DIFFICULTY_DEFINITIONS: Record<FoundryGraduationDifficulty, string> = {
  D1: 'small / local',
  D2: 'multi-file / moderate',
  D3: 'multi-component / debugging',
  D4: 'larger integration / restart / replan',
}

export const FOUNDRY_GRADUATION_FAILURE_CLASSES = [
  'UNDERSTANDING',
  'PLANNING',
  'IMPLEMENTATION',
  'DEBUGGING',
  'TESTING',
  'TOOLING',
  'PROVIDER',
  'RESOURCE',
  'CONTRACT',
  'ENVIRONMENT',
  'VERIFICATION',
  'UNKNOWN',
] as const
export type FoundryGraduationFailureClass = (typeof FOUNDRY_GRADUATION_FAILURE_CLASSES)[number]

export const FOUNDRY_GRADUATION_RUN_RESULTS = ['PASS', 'FAIL', 'PARTIAL', 'BLOCKED', 'NEEDS_COMMANDER'] as const
export type FoundryGraduationRunResult = (typeof FOUNDRY_GRADUATION_RUN_RESULTS)[number]

export const FOUNDRY_GRADUATION_VERIFICATION_METHODS = [
  'FILE_INSPECT',
  'NODE_RUNTIME',
  'HTTP',
  'CLI',
  'JSON_PERSISTENCE',
  'DOM_PARSE',
  'SEMANTIC_COMPUTER_USE',
  'TYPECHECK',
  'BUILD',
  'TEST_RUNNER',
  'GOVERNANCE',
  'NOT_AVAILABLE',
] as const
export type FoundryGraduationVerificationMethod = (typeof FOUNDRY_GRADUATION_VERIFICATION_METHODS)[number]

export const FOUNDRY_GRADUATION_SUPPORTED_LANGUAGES = ['typescript', 'javascript'] as const
export type FoundryGraduationSupportedLanguage = (typeof FOUNDRY_GRADUATION_SUPPORTED_LANGUAGES)[number]

export const FOUNDRY_GRADUATION_SUPPORTED_RUNTIMES = ['node'] as const
export const FOUNDRY_GRADUATION_SUPPORTED_FRAMEWORKS = ['vanilla', 'vanilla-react-pattern'] as const

export const FOUNDRY_GRADUATION_RELIABLE_MIN_DISTINCT_PASSES = 3 as const

export const FOUNDRY_FAST_GRADUATION_BENCHMARK_IDS = [
  'GRAD-E-CLI',
  'GRAD-G-BUGFIX',
  'GRAD-B-FRONTEND',
  'GRAD-Q-CONTRACT',
  'GRAD-N-RESOURCE',
] as const

export const FOUNDRY_MODEL_DRIVEN_GRADUATION_BENCHMARK_IDS = [
  'GRAD-E-CLI',
  'GRAD-G-BUGFIX',
  'GRAD-B-FRONTEND',
] as const

export const FOUNDRY_MODEL_DRIVEN_OPTIONAL_BENCHMARK_IDS = [
  'GRAD-C-BACKEND',
] as const

export const FOUNDRY_MODEL_DRIVEN_MULTIFIXTURE_FAST_IDS = [
  'GRAD-E-CLI-V2',
  'GRAD-G-BUGFIX-V2',
  'GRAD-B-FRONTEND-V2',
  'GRAD-C-BACKEND',
] as const

export const FOUNDRY_MODEL_DRIVEN_MULTIFIXTURE_FULL_IDS = [
  'GRAD-E-CLI-V2',
  'GRAD-E-CLI-V3',
  'GRAD-G-BUGFIX-V2',
  'GRAD-G-BUGFIX-V3',
  'GRAD-B-FRONTEND-V2',
  'GRAD-B-FRONTEND-V3',
  'GRAD-C-BACKEND',
  'GRAD-I-FEATURE-D3',
] as const

export const FOUNDRY_MODEL_DRIVEN_RELIABILITY_PRIOR_IDS = [
  'GRAD-E-CLI',
  'GRAD-G-BUGFIX',
  'GRAD-B-FRONTEND',
] as const

export const FOUNDRY_SELECTED_D3_CLASS = 'FEATURE_EXTENSION' as const
export const FOUNDRY_MODEL_DRIVEN_D3_BENCHMARK_ID = 'GRAD-I-FEATURE-D3' as const

export const FOUNDRY_MODEL_DRIVEN_D3_FAST_IDS = [
  'GRAD-H-TEST-REPAIR-V1',
  'GRAD-D-FULLSTACK-V1',
  'GRAD-C-BACKEND-V2',
] as const

export const FOUNDRY_MODEL_DRIVEN_D3_FULL_IDS = [
  'GRAD-H-TEST-REPAIR-V1',
  'GRAD-H-TEST-REPAIR-V2',
  'GRAD-H-TEST-REPAIR-V3',
  'GRAD-D-FULLSTACK-V1',
  'GRAD-D-FULLSTACK-V2',
  'GRAD-C-BACKEND-V2',
  'GRAD-C-BACKEND-V3',
] as const

export const FOUNDRY_MODEL_DRIVEN_D3_BACKEND_PRIOR_IDS = [
  'GRAD-C-BACKEND',
] as const

export const FOUNDRY_MODEL_DRIVEN_D3_FEATURE_V2_ID = 'GRAD-I-FEATURE-V2' as const

export const FOUNDRY_HARD_ENGINEERING_FAST_IDS = [
  'GRAD-D-FULLSTACK-V3',
  'GRAD-DA-DATABASE-V1',
  'GRAD-LV-LEGACY-V1',
  'GRAD-DP-DATA-V1',
] as const

export const FOUNDRY_HARD_ENGINEERING_FULL_IDS = [
  'GRAD-D-FULLSTACK-V3',
  'GRAD-DA-DATABASE-V1',
  'GRAD-DA-DATABASE-V2',
  'GRAD-DK-DESKTOP-V1',
  'GRAD-DK-DESKTOP-V2',
  'GRAD-LV-LEGACY-V1',
  'GRAD-LV-LEGACY-V2',
  'GRAD-RF-REFACTOR-V1',
  'GRAD-RF-REFACTOR-V2',
  'GRAD-DP-DATA-V1',
  'GRAD-DP-DATA-V2',
  'GRAD-LP-LIBRARY-V1',
  'GRAD-LP-LIBRARY-V2',
] as const

export const FOUNDRY_HARD_ENGINEERING_FULL_STACK_PRIOR_IDS = [
  'GRAD-D-FULLSTACK-V1',
  'GRAD-D-FULLSTACK-V2',
] as const

export const FOUNDRY_FINAL_CLASS_COVERAGE_FAST_IDS = [
  'GRAD-FX-FEATURE-V2',
  'GRAD-SW-STATIC-V1',
] as const

export const FOUNDRY_FINAL_CLASS_COVERAGE_FULL_IDS = [
  'GRAD-FX-FEATURE-V2',
  'GRAD-FZ-FEATURE-V3',
  'GRAD-SW-STATIC-V1',
] as const

export const FOUNDRY_FINAL_CLASS_FEATURE_PRIOR_IDS = [
  'GRAD-I-FEATURE-D3',
] as const

export type FoundryGraduationEngineeringMode = 'reference' | 'model-driven' | 'governance'

export type FoundryModelDrivenGovernanceCounts = {
  REFERENCE_SOLUTION_APPLY_COUNT: number
  REFERENCE_IMPLEMENTATION_WRITE_COUNT: number
  REFERENCE_FALLBACK_AFTER_MODEL_FAILURE_COUNT: number
  HIDDEN_ORACLE_READ_BY_ENGINEER_COUNT: number
  BENCHMARK_SOLUTION_LEAK_COUNT: number
  MODEL_DIRECT_FILESYSTEM_WRITE_COUNT: number
  MODEL_TEST_WEAKENING_COUNT: number
  BENCHMARK_CRITERIA_MUTATION_COUNT: number
  VERIFIER_MUTATION_COUNT: number
  MODEL_GRADUATION_SECRET_LEAK_COUNT: number
  FALSE_MODEL_DRIVEN_PASS_COUNT: number
  MODEL_ACTION_WITHOUT_DURABLE_ID_COUNT: number
  MODEL_GRADUATION_CONTINUE_PROMPT_COUNT: number
  REFERENCE_PASS_COUNT_USED_FOR_MODEL_RELIABILITY: number
  DUPLICATE_FIXTURE_COUNTED_AS_DISTINCT: number
  LEGACY_REWRITE_SHORTCUT_COUNT: number
  DESKTOP_FIXTURE_ORPHAN_PROCESS_COUNT: number
  REPEATED_FAILED_PATCH_WITHOUT_REPLAN_COUNT: number
}

export const EMPTY_MODEL_DRIVEN_GOVERNANCE: FoundryModelDrivenGovernanceCounts = {
  REFERENCE_SOLUTION_APPLY_COUNT: 0,
  REFERENCE_IMPLEMENTATION_WRITE_COUNT: 0,
  REFERENCE_FALLBACK_AFTER_MODEL_FAILURE_COUNT: 0,
  HIDDEN_ORACLE_READ_BY_ENGINEER_COUNT: 0,
  BENCHMARK_SOLUTION_LEAK_COUNT: 0,
  MODEL_DIRECT_FILESYSTEM_WRITE_COUNT: 0,
  MODEL_TEST_WEAKENING_COUNT: 0,
  BENCHMARK_CRITERIA_MUTATION_COUNT: 0,
  VERIFIER_MUTATION_COUNT: 0,
  MODEL_GRADUATION_SECRET_LEAK_COUNT: 0,
  FALSE_MODEL_DRIVEN_PASS_COUNT: 0,
  MODEL_ACTION_WITHOUT_DURABLE_ID_COUNT: 0,
  MODEL_GRADUATION_CONTINUE_PROMPT_COUNT: 0,
  REFERENCE_PASS_COUNT_USED_FOR_MODEL_RELIABILITY: 0,
  DUPLICATE_FIXTURE_COUNTED_AS_DISTINCT: 0,
  LEGACY_REWRITE_SHORTCUT_COUNT: 0,
  DESKTOP_FIXTURE_ORPHAN_PROCESS_COUNT: 0,
  REPEATED_FAILED_PATCH_WITHOUT_REPLAN_COUNT: 0,
}

export type FoundryGraduationFixtureIdentity = {
  fixtureId: string
  fixtureFamily: FoundryEngineeringProjectClass
  variationHash: string
  requirementsHash: string
  hiddenOracleHash: string
}

export type FoundryModelRouteCallRecord = {
  callId: string
  kind: string
  requestedProvider: string | null
  selectedProvider: string | null
  selectedModel: string | null
  reason: string
  fallbackOccurred: boolean
  ok: boolean
  latencyMs: number
  tokens: number
  estimatedCostUsd: number
  failureClass?: string | null
  decision?: string | null
}

export type FoundryGraduationAttemptRecord = {
  attemptId: string
  runId: string
  benchmarkId: string
  provider: string | null
  model: string | null
  initialPlan: string
  actions: Array<{ tool: string; ok: boolean; path?: string; reason: string }>
  patches: string[]
  tests: Array<{ ok: boolean; detail: string }>
  verifierResult: string
  failureClass: FoundryGraduationFailureClass | null
  resourceUse: FoundryGraduationResourceUsageSummary
  createdAt: string
}

export type FoundryGraduationCriterion = {
  criterionId: string
  description: string
  required: boolean
  verificationType: string
  expectedOutcome: string
}

export type FoundryGraduationResourceBudget = {
  maxWallClockMs: number
  maxModelCalls: number
  maxTotalTokens: number
  maxToolCalls: number
  maxTestRuns: number
  maxBuildRuns: number
}

export const FOUNDRY_MODEL_DRIVEN_BUDGET: FoundryGraduationResourceBudget = {
  maxWallClockMs: 1_200_000,
  maxModelCalls: 12,
  maxTotalTokens: 80_000,
  maxToolCalls: 40,
  maxTestRuns: 8,
  maxBuildRuns: 2,
}

export const FOUNDRY_MODEL_DRIVEN_D3_BUDGET: FoundryGraduationResourceBudget = {
  maxWallClockMs: 1_800_000,
  maxModelCalls: 18,
  maxTotalTokens: 120_000,
  maxToolCalls: 60,
  maxTestRuns: 12,
  maxBuildRuns: 2,
}

export type FoundryEngineeringBenchmark = {
  benchmarkId: string
  letter: string
  projectClass: FoundryEngineeringProjectClass
  difficulty: FoundryGraduationDifficulty
  language: FoundryGraduationSupportedLanguage
  framework?: string | null
  runtime?: string | null
  environment?: string | null
  startingFixture: string
  missionPrompt: string
  acceptanceCriteria: FoundryGraduationCriterion[]
  forbiddenShortcuts: string[]
  timeoutMs: number
  resourceBudget: FoundryGraduationResourceBudget
  expectedArtifacts: string[]
  expectedTests: string[]
  independentVerifier: string
  writeSet: string[]
  outOfScopePaths: string[]
  networkRequired: boolean
  suite: 'fast' | 'full'
  variationKeys: string[]
}

export type FoundryGraduationResourceUsageSummary = {
  wallClockMs: number
  modelCalls: number
  tokens: number
  estimatedCostUsd: number
  actualCostUsd: number | null
  toolCalls: number
  testRuns: number
  buildRuns: number
  replans: number
  restartCount: number
}

export type FoundryGraduationCriterionResult = {
  criterionId: string
  required: boolean
  passed: boolean
  method: FoundryGraduationVerificationMethod
  detail: string
}

export type FoundryEngineeringCertification = {
  schemaVersion: typeof FOUNDRY_GRADUATION_SCHEMA_VERSION
  certificationId: string
  projectClass: FoundryEngineeringProjectClass
  language: string
  framework?: string | null
  runtime?: string | null
  environment?: string | null
  benchmarkIds: string[]
  attemptCount: number
  passCount: number
  failCount: number
  distinctFixturePassCount: number
  requiredCriteria: string[]
  passedCriteria: string[]
  firstPassedAt?: string | null
  lastPassedAt?: string | null
  status: FoundryGraduationLevel
  evidenceRefs: string[]
  modelProvidersUsed: string[]
  toolFamiliesUsed: string[]
  resourceUsageSummary: FoundryGraduationResourceUsageSummary
  productionEvidenceRefs: string[]
  schemaNote: string
  referencePassCount: number
  modelDrivenPassCount: number
  modelDrivenDistinctFixturePassCount: number
  modelDrivenRequirementsHashes?: string[]
  provenProviders?: string[]
  provenModels?: string[]
}

export type FoundryGraduationGovernanceCounts = {
  BENCHMARK_FALSE_PASS_COUNT: number
  PROJECT_READY_WITH_FAILED_CRITERION_COUNT: number
  BENCHMARK_SECRET_LEAK_COUNT: number
  BENCHMARK_CONTRACT_BYPASS_COUNT: number
  BENCHMARK_RESOURCE_BYPASS_COUNT: number
  BENCHMARK_TOOL_BROKER_BYPASS_COUNT: number
  BENCHMARK_AUTO_COMMIT_COUNT: number
  BENCHMARK_AUTO_PUSH_COUNT: number
  BENCHMARK_DEPLOY_COUNT: number
  FALSE_RELIABLE_CERTIFICATION_COUNT: number
  FALSE_PRODUCTION_PROVEN_COUNT: number
}

export type FoundryGraduationRun = {
  schemaVersion: typeof FOUNDRY_GRADUATION_SCHEMA_VERSION
  runId: string
  benchmarkId: string
  projectClass: FoundryEngineeringProjectClass
  missionId: string
  fixtureId: string
  variant: string
  projectRoot: string
  startedAt: string
  finishedAt: string
  result: FoundryGraduationRunResult
  failureClass?: FoundryGraduationFailureClass | null
  criteria: FoundryGraduationCriterionResult[]
  passedRequiredCount: number
  requiredCount: number
  forbiddenShortcutHits: string[]
  resourceUsage: FoundryGraduationResourceUsageSummary
  providers: string[]
  models: string[]
  toolFamilies: string[]
  evidenceRefs: string[]
  verificationMethods: FoundryGraduationVerificationMethod[]
  projectReady: boolean
  verdict: string | null
  governance: FoundryGraduationGovernanceCounts
  unattendedAuthorized: boolean
  notes: string[]
  engineeringMode?: FoundryGraduationEngineeringMode
  modelRouteCalls?: FoundryModelRouteCallRecord[]
  modelDrivenGovernance?: FoundryModelDrivenGovernanceCounts
  attemptHistoryRef?: string | null
  fixtureIdentity?: FoundryGraduationFixtureIdentity
}

export type FoundryGraduationHiddenOracle = {
  runId: string
  benchmarkId: string
  values: Record<string, string | number | boolean>
}

export type FoundryEngineeringCapabilitiesRow = {
  projectClass: FoundryEngineeringProjectClass
  label: string
  language: string
  status: FoundryGraduationLevel
  passCount: number
  attemptCount: number
  distinctFixturePassCount: number
  referencePassCount: number
  modelDrivenPassCount: number
  modelDrivenDistinctFixturePassCount: number
  provenProviders: string[]
  provenModels: string[]
  proofLabel: 'UNTESTED' | 'REFERENCE VERIFIED' | 'MODEL DRIVEN VERIFIED' | 'MIXED'
  productionProven?: boolean
  installedProductionEvidenceRefs?: string[]
}

export type FoundryEngineeringCapabilitiesView = {
  rows: FoundryEngineeringCapabilitiesRow[]
  generatedAt: string
  note: 'Factual certification counts only. Not a subjective intelligence score. Not AGI.'
}

export const EMPTY_GRADUATION_GOVERNANCE: FoundryGraduationGovernanceCounts = {
  BENCHMARK_FALSE_PASS_COUNT: 0,
  PROJECT_READY_WITH_FAILED_CRITERION_COUNT: 0,
  BENCHMARK_SECRET_LEAK_COUNT: 0,
  BENCHMARK_CONTRACT_BYPASS_COUNT: 0,
  BENCHMARK_RESOURCE_BYPASS_COUNT: 0,
  BENCHMARK_TOOL_BROKER_BYPASS_COUNT: 0,
  BENCHMARK_AUTO_COMMIT_COUNT: 0,
  BENCHMARK_AUTO_PUSH_COUNT: 0,
  BENCHMARK_DEPLOY_COUNT: 0,
  FALSE_RELIABLE_CERTIFICATION_COUNT: 0,
  FALSE_PRODUCTION_PROVEN_COUNT: 0,
}

export const EMPTY_RESOURCE_SUMMARY: FoundryGraduationResourceUsageSummary = {
  wallClockMs: 0,
  modelCalls: 0,
  tokens: 0,
  estimatedCostUsd: 0,
  actualCostUsd: null,
  toolCalls: 0,
  testRuns: 0,
  buildRuns: 0,
  replans: 0,
  restartCount: 0,
}

export const FOUNDRY_GRADUATION_CLASS_LABELS: Record<FoundryEngineeringProjectClass, string> = {
  STATIC_WEB: 'Static Web',
  FRONTEND_APP: 'JavaScript Frontend',
  BACKEND_API: 'Node API',
  FULL_STACK_APP: 'Full Stack',
  CLI_TOOL: 'TypeScript CLI',
  LIBRARY_PACKAGE: 'TypeScript Library',
  DATA_PROCESSING: 'Data Processing',
  DATABASE_APP: 'Database App',
  DESKTOP_APP: 'Desktop App',
  TEST_REPAIR: 'Test Repair',
  BUG_FIX: 'Bug Fix',
  REFACTOR: 'Refactor',
  FEATURE_EXTENSION: 'Feature Extension',
  LEGACY_CODE_MODIFICATION: 'Legacy Modification',
}
