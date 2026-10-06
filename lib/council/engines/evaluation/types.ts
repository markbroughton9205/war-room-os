/**
 * ENGINE-05 evaluation contracts.
 * Capability ≠ authority. Policy candidate ≠ production policy.
 * Benchmark win ≠ automatic promotion. Evaluation artifacts are not EBC facts.
 */
import type { EngineReceipt } from '../types'
import { ENGINE_05_VERSION } from '../types'

export const ENGINE05_SUITE_VERSION = 'engine05-core-suite.v1' as const
export const EMPIRICAL_POLICY_SCHEMA = 'war-room.empirical-policy.v1' as const
export const EVALUATION_PROGRAM_SCHEMA = 'war-room.evaluation-program.v1' as const
export const BENCHMARK_RUN_SCHEMA = 'war-room.benchmark-run.v1' as const
export const ROUTING_DECISION_SCHEMA = 'war-room.model-routing.v1' as const
export const COUNTERFACTUAL_SCHEMA = 'war-room.counterfactual-eval.v1' as const
export const PROMOTION_RECEIPT_SCHEMA = 'war-room.policy-promotion.v1' as const

export type MeasurementKind = 'MEASURED' | 'ESTIMATED' | 'INFERRED' | 'UNMEASURED'

export type MetricName =
  | 'task_success'
  | 'evidence_quality'
  | 'verification_quality'
  | 'latency_ms'
  | 'token_cost'
  | 'tool_cost'
  | 'tool_call_count'
  | 'retry_count'
  | 'failure_rate'
  | 'calibration_quality'
  | 'context_efficiency'
  | 'authority_compliance'
  | 'correctness_signal'
  | 'evidence_sufficiency'
  | 'context_size'
  | 'authority_violations'

export type MetricObservation = {
  name: MetricName
  value: number | string | boolean | null
  kind: MeasurementKind
  unit?: string
}

export type TaskClass =
  | 'research_discovery'
  | 'source_authority'
  | 'freshness'
  | 'claim_verification'
  | 'contradiction_handling'
  | 'tool_selection'
  | 'planning'
  | 'parallel_execution'
  | 'context_compilation'
  | 'failure_diagnosis'
  | 'restart_recovery'
  | 'memory_retrieval'
  | 'temporal_reasoning'
  | 'provider_model_reasoning'
  | 'structured_output'
  | 'code_reasoning'

export type EvaluationMethod = 'FIXTURE' | 'DETERMINISTIC_ENGINE' | 'LIVE_WINDOW' | 'SHADOW' | 'AB_APPROVED'

export type SuitePartition = 'development' | 'validation' | 'held_out'

export type BenchmarkCase = {
  case_id: string
  task_class: TaskClass
  input: Record<string, unknown>
  expected_constraints: string[]
  required_evidence: string[]
  authority_constraints: string[]
  freshness_requirement: string | null
  evaluation_method: EvaluationMethod
  baseline_refs: string[]
  ground_truth_refs: string[]
  difficulty: 'LOW' | 'MED' | 'HIGH'
  tags: string[]
  partition: SuitePartition
}

export type BenchmarkSuite = {
  suite_id: string
  version: string
  cases: BenchmarkCase[]
}

export type CaseResult = {
  case_id: string
  task_class: TaskClass
  completed: boolean
  correctness_signal: 'PASS' | 'FAIL' | 'NA' | 'INCONCLUSIVE'
  evidence_sufficiency: 'SUFFICIENT' | 'THIN' | 'MISSING' | 'NA'
  verification_state: string
  calibration_state: string
  failure_state: string
  completion_state: string
  metrics: MetricObservation[]
  authority_violations: number
  limitations: string[]
}

export type ReproducibilityBinding = {
  suite_version: string
  suite_hash: string
  policy_version: string
  policy_hash: string
  runtime_version: string
  model_provider: string
  tool_versions: string
  timestamp: string
  seed: string | null
  freshness_context: string | null
  environment_constraints: string[]
  live_window: { from: string; to: string } | null
  result_hash: string
}

export type CapabilityBenchmarkResult = {
  schema: typeof BENCHMARK_RUN_SCHEMA
  engine: 'capability-benchmark'
  version: typeof ENGINE_05_VERSION
  run_id: string
  suite_id: string
  candidate_policy_id: string
  baseline_policy_id: string | 'BASELINE_UNAVAILABLE'
  cases: CaseResult[]
  binding: ReproducibilityBinding
  grants_authority: false
  trains_wrim: false
  receipt: EngineReceipt
}

export type PolicyFamily =
  | 'tool_selection'
  | 'planning'
  | 'context_compilation'
  | 'retry'
  | 'fallback'
  | 'parallelism'
  | 'memory_use'
  | 'temporal_refresh'
  | 'provider_routing'
  | 'completion_thresholds'

export type PolicyStatus =
  | 'DRAFT'
  | 'READY_FOR_EVAL'
  | 'EVALUATING'
  | 'SUPPORTED'
  | 'INCONCLUSIVE'
  | 'REJECTED'
  | 'COMMANDER_REVIEW'
  | 'APPROVED'
  | 'PROMOTED'
  | 'RETIRED'

export type PolicyHypothesis = {
  proposed_change: string
  why_might_help: string
  metric_should_improve: MetricName[]
  must_not_regress: MetricName[]
  falsifier: string
}

export type PolicyParameters = {
  prefer_independent_primary: boolean
  max_parallel: number
  context_token_budget: number
  retry_transient: boolean
  memory_first: boolean
  privacy: 'LOCAL' | 'CLOUD_OK'
  routing_task_specific: boolean
}

export type EmpiricalPolicyCandidate = {
  schema: typeof EMPIRICAL_POLICY_SCHEMA
  policy_id: string
  policy_family: PolicyFamily
  version: string
  created_at: string
  source: string
  hypothesis: PolicyHypothesis
  changed_parameters: PolicyParameters
  baseline_policy: string
  evaluation_suite: string
  status: PolicyStatus
  applies_automatically: false
  grants_authority: false
  trains_wrim: false
  approval_fingerprint: string | null
  rollback_target: string | null
}

export type ShadowEvaluation = {
  production_policy_id: string
  candidate_policy_id: string
  grants_authority: false
  production_controls_execution: true
  compared: {
    selected_tools: { production: string[]; candidate: string[] }
    plan: { production: string; candidate: string }
    context_tokens: { production: number; candidate: number }
    expected_work: { production: string[]; candidate: string[] }
  }
  counterfactual_estimates_kind: 'ESTIMATED'
}

export type PolicyEvaluationResult = {
  schema: 'war-room.policy-evaluation.v1'
  evaluation_id: string
  candidate: EmpiricalPolicyCandidate
  baseline_policy: string | 'BASELINE_UNAVAILABLE'
  suite_id: string
  development: CapabilityBenchmarkResult | null
  validation: CapabilityBenchmarkResult | null
  held_out: CapabilityBenchmarkResult | null
  shadow: ShadowEvaluation | null
  comparable_ab: boolean
  sample_count: number
  overfit: boolean
  authority_regression: boolean
  truth_regression: boolean
  safety_regression: boolean
  result: 'SUPPORTED' | 'INCONCLUSIVE' | 'REJECTED' | 'MORE_EVIDENCE_REQUIRED'
  limitations: string[]
  grants_authority: false
  auto_promoted: false
  receipt: EngineReceipt
}

export type PrivacyClass = 'LOCAL' | 'INTERNAL' | 'CLOUD'
export type CostClass = 'LOCAL' | 'LOW' | 'MED' | 'HIGH' | 'UNMEASURED'
export type LatencyClass = 'FAST' | 'MED' | 'SLOW' | 'UNMEASURED'
export type AvailabilityState = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN'

export type ProviderCapabilityRecord = {
  provider_id: string
  model_id: string
  capabilities: string[]
  context_window: number | null
  tool_support: boolean | 'UNMEASURED'
  structured_output_support: boolean | 'UNMEASURED'
  latency_history: MetricObservation[]
  reliability_history: MetricObservation[]
  task_class_results: Partial<Record<TaskClass, MetricObservation[]>>
  privacy_class: PrivacyClass
  availability: AvailabilityState
  cost_class: CostClass
  local_or_cloud: 'LOCAL' | 'CLOUD'
  health: string
  last_evaluated_at: string | null
  specs_invented: false
}

export type ModelRoutingDecision = {
  schema: typeof ROUTING_DECISION_SCHEMA
  mission_id: string
  task_id: string
  task_class: TaskClass
  selected_provider: string | null
  selected_model: string | null
  alternates: string[]
  reason_codes: string[]
  benchmark_refs: string[]
  availability: AvailabilityState
  expected_latency_class: LatencyClass
  privacy_class: PrivacyClass
  cost_class: CostClass
  authority_cost_requirements: string[]
  blocked: 'NONE' | 'TOOL_BLOCKED' | 'MODEL_BLOCKED' | 'PRIVACY_BLOCKED'
  role: string
  role_is_provider: false
  grants_authority: false
  universal_best_model: false
  cheapest_is_best: false
  most_expensive_is_best: false
  receipt: EngineReceipt
}

export type ReplayLevel =
  | 'EXACT_REPLAY'
  | 'DETERMINISTIC_SIMULATION'
  | 'SHADOW_EXECUTION'
  | 'MODEL_ESTIMATE'
  | 'NOT_EVALUABLE'

export type CounterfactualResult = {
  schema: typeof COUNTERFACTUAL_SCHEMA
  evaluation_id: string
  mission_id: string
  actual_policy: string
  alternate_policy: string
  kind: 'TOOL' | 'PLAN' | 'PROVIDER' | 'CONTEXT' | 'PARALLEL' | 'RETRY' | 'MEMORY'
  replay_level: ReplayLevel
  actual_outcome: Record<string, unknown>
  counterfactual_outcome: Record<string, unknown>
  comparison: string
  uncertainty: MeasurementKind
  historical_fact: false
  ebc_evidence: false
  grants_authority: false
  isolated_from_production_ebc: true
  receipt: EngineReceipt
}

export type PromotionRecommendation = 'PROMOTE' | 'DO_NOT_PROMOTE' | 'INCONCLUSIVE' | 'MORE_EVIDENCE_REQUIRED'

export type PromotionReceipt = {
  schema: typeof PROMOTION_RECEIPT_SCHEMA
  promotion_id: string
  policy_id: string
  baseline: string
  candidate_version: string
  evaluations: string[]
  improvements: string[]
  regressions: string[]
  tradeoffs: string[]
  sample_size: number
  confidence_state: 'OBSERVED' | 'INCONCLUSIVE' | 'INSUFFICIENT_SAMPLE'
  known_limitations: string[]
  rollback_policy: string
  recommendation: PromotionRecommendation
  commander_decision: 'PENDING' | 'APPROVED' | 'DECLINED' | 'ROLLED_BACK'
  approval_fingerprint: string | null
  auto_promoted: false
  effective_at: string | null
  receipt: EngineReceipt
}

export type EvaluationProgramState = 'CREATED' | 'RUNNING' | 'PAUSED' | 'WAITING' | 'COMPLETED' | 'CANCELLED'

export type EvaluationProgram = {
  schema: typeof EVALUATION_PROGRAM_SCHEMA
  program_id: string
  mission_id: string
  kind: 'BENCHMARK' | 'POLICY_EVAL' | 'SHADOW' | 'COUNTERFACTUAL' | 'ROUTING'
  state: EvaluationProgramState
  candidate_id: string | null
  suite_id: string | null
  created_at: string
  updated_at: string
  paused_at: string | null
}

export type CapabilityMatrixCell = {
  task_class: TaskClass
  provider_id: string
  model_id: string
  success: MetricObservation
  quality: MetricObservation
  latency: MetricObservation
  tokens: MetricObservation
  tool_use: MetricObservation
  failure_rate: MetricObservation
  last_evaluated_at: string | null
  universal_best: false
}

export type RouterFallbackRow = {
  task_class: TaskClass
  preferred: string | null
  alternate: string | null
  local_fallback: string | null
  blocked_condition: string | null
}
