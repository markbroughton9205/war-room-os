/**
 * Cognitive orchestration contracts.
 * CouncilExecutive coordinates existing intelligence layers. It does not grant authority.
 * EBC remains the factual truth spine. Model prose is never upgraded to VERIFIED here.
 */

import type { EbcAgentId } from '@/lib/council/evidence-board/types'
import type { ModelPlacement } from '@/lib/council/gi/types'
import type { ContractRiskLevel, ProviderKind, StatementKind, TruthState } from './types'

export const ORCHESTRATION_SCHEMA = 'war-room.council-orchestration.v1' as const
export const TASK_GRAPH_SCHEMA = 'war-room.cognitive-task-graph.v1' as const
export const BLACKBOARD_SCHEMA = 'war-room.cognitive-blackboard.v1' as const
export const WORK_PRODUCT_SCHEMA = 'war-room.council-work-product.v1' as const

export const COGNITIVE_STRATEGIES = [
  'DIRECT',
  'DECOMPOSE',
  'RESEARCH',
  'DIAGNOSE',
  'COMPARE',
  'DESIGN',
  'VERIFY',
  'DEBATE',
  'PLAN',
  'SIMULATE',
  'REVIEW',
  'INCIDENT_RESPONSE',
  'DOCUMENT_ANALYSIS',
  'DATA_ANALYSIS',
] as const
export type CognitiveStrategyId = (typeof COGNITIVE_STRATEGIES)[number]

export const MISSION_BUDGETS = ['FAST', 'STANDARD', 'DEEP', 'MAXIMUM'] as const
export type MissionBudget = (typeof MISSION_BUDGETS)[number]

export const DELIBERATION_POLICIES = [
  'NONE',
  'PAIR_CHECK',
  'SPECIALIST_REVIEW',
  'ADVERSARIAL',
  'FULL_COUNCIL',
] as const
export type DeliberationPolicy = (typeof DELIBERATION_POLICIES)[number]

export const TASK_STATES = [
  'PLANNED',
  'READY',
  'RUNNING',
  'WAITING_EVIDENCE',
  'WAITING_TOOL',
  'WAITING_AUTHORITY',
  'BLOCKED',
  'COMPLETE',
  'FAILED',
  'SUPERSEDED',
  'REPLAN_REQUIRED',
] as const
export type CognitiveTaskStatus = (typeof TASK_STATES)[number]

export const WORK_PRODUCT_TYPES = [
  'INVESTIGATION',
  'RESEARCH',
  'DATA_ANALYSIS',
  'PLAN',
  'VERIFICATION',
  'CHALLENGE',
  'SCENARIO',
  'RISK',
  'SYNTHESIS_INPUT',
] as const
export type WorkProductType = (typeof WORK_PRODUCT_TYPES)[number]

export const QUESTION_TYPES = [
  'FACTUAL',
  'CAUSAL',
  'COMPARATIVE',
  'IMPLEMENTATION',
  'RISK',
  'TEMPORAL',
  'AUTHORITY',
  'DEPENDENCY',
  'UNKNOWN_UNKNOWN',
] as const
export type QuestionType = (typeof QUESTION_TYPES)[number]

export const QUESTION_ANSWER_STATES = ['OPEN', 'ANSWERED', 'BLOCKED', 'UNANSWERABLE'] as const
export type QuestionAnswerState = (typeof QUESTION_ANSWER_STATES)[number]

export const HYPOTHESIS_STATES = [
  'OPEN',
  'SUPPORTED',
  'WEAKENED',
  'FALSIFIED',
  'CONFIRMED_AS_CAUSAL_CANDIDATE',
  'REJECTED',
  'STALE',
  'RESOLVED',
] as const
export type HypothesisStatus = (typeof HYPOTHESIS_STATES)[number]

export const COMPLETION_VERDICTS = [
  'COMPLETE',
  'PARTIALLY_COMPLETE',
  'BLOCKED',
  'NEEDS_MORE_EVIDENCE',
  'NEEDS_COMMANDER',
  'FAILED',
] as const
export type CompletionVerdict = (typeof COMPLETION_VERDICTS)[number]

export const JANUS_FAMILIES = [
  'BASELINE',
  'OPTION_A',
  'OPTION_B',
  'OPTION_C',
  'DO_NOTHING',
  'ROLLBACK',
  'STAGED_MIGRATION',
] as const
export type JanusScenarioFamily = (typeof JANUS_FAMILIES)[number]

export const LIKELIHOOD_CLASSES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export type LikelihoodClass = (typeof LIKELIHOOD_CLASSES)[number]

export const COGNITIVE_JOBS = [
  'conversation',
  'classification',
  'planning',
  'quant_reasoning',
  'research_synthesis',
  'verification',
  'adversarial_review',
  'coding_analysis',
] as const
export type CognitiveJob = (typeof COGNITIVE_JOBS)[number]

export type CognitiveStrategy = {
  id: CognitiveStrategyId
  planning_depth: 'NONE' | 'SHALLOW' | 'FULL'
  evidence_requirement: 'NONE' | 'BOUNDED' | 'PRIMARY' | 'MULTI_SOURCE'
  seat_mix: EbcAgentId[]
  tool_expectation: 'NONE' | 'PROBE' | 'RESEARCH' | 'DIAGNOSTIC'
  verification_depth: 'NONE' | 'MATERIAL' | 'FULL'
  scenario_requirement: boolean
  adversarial_requirement: 'NONE' | 'THRESHOLD' | 'ALWAYS'
  replanning_threshold: 'NEVER' | 'ON_FAILURE' | 'ON_CONTRADICTION'
  runtime_knowledge: boolean
  deliberation: DeliberationPolicy
  reason: string
}

export type AssemblySeat = {
  agent: EbcAgentId
  role: string
  expected_contribution: string
  internal: boolean
  completion_responsibility: boolean
}

export type CouncilAssemblyPlan = {
  selected_seats: EbcAgentId[]
  seats: AssemblySeat[]
  communication_edges: Array<{ from: EbcAgentId; to: EbcAgentId; product: WorkProductType }>
  phoenix_required: boolean
  aurora_final_only: boolean
  never_default_six: true
  reason: string
}

export type CognitiveTask = {
  task_id: string
  mission_id: string
  objective: string
  assigned_role: EbcAgentId | 'ATLAS' | 'JANUS' | 'SENTINEL' | 'EXECUTIVE'
  required_inputs: string[]
  depends_on: string[]
  evidence_required: string[]
  tools_required: string[]
  authority_required: boolean
  expected_output: string
  completion_condition: string
  failure_condition: string
  status: CognitiveTaskStatus
  attempt: number
  revision: number
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export type CognitiveTaskGraph = {
  schema: typeof TASK_GRAPH_SCHEMA
  mission_id: string
  tasks: CognitiveTask[]
  parallel_groups: string[][]
  ready: string[]
}

export type CouncilWorkProduct = {
  schema: typeof WORK_PRODUCT_SCHEMA
  work_product_id: string
  mission_id: string
  task_id: string
  agent: EbcAgentId | 'ATLAS' | 'JANUS' | 'SENTINEL' | 'EXECUTIVE'
  type: WorkProductType
  summary: string
  claims: string[]
  evidence_refs: string[]
  unknowns: string[]
  questions: string[]
  risks: string[]
  recommendations: string[]
  requested_followups: string[]
  confidence_class: TruthState
  temporal_scope: 'CURRENT' | 'HISTORICAL' | 'UNKNOWN'
  created_at: string
}

export type BlackboardItem = {
  item_id: string
  section: BlackboardSection
  text: string
  origin: string
  mission_id: string
  status: 'OPEN' | 'ACTIVE' | 'RESOLVED' | 'SUPERSEDED'
  provenance: string[]
  timestamp: string
  ebc_evidence_ids: string[]
  truth_state: TruthState
}

export const BLACKBOARD_SECTIONS = [
  'OBJECTIVE',
  'TASKS',
  'QUESTIONS',
  'HYPOTHESES',
  'CLAIMS',
  'EVIDENCE',
  'UNKNOWNS',
  'CONFLICTS',
  'SCENARIOS',
  'RISKS',
  'DECISIONS',
  'BLOCKERS',
  'AUTHORITY',
  'NEXT_ACTIONS',
] as const
export type BlackboardSection = (typeof BLACKBOARD_SECTIONS)[number]

export type CognitiveBlackboard = {
  schema: typeof BLACKBOARD_SCHEMA
  mission_id: string
  items: BlackboardItem[]
  ebc_truth_spine: true
}

export type QuestionNode = {
  question_id: string
  type: QuestionType
  text: string
  parent_task: string | null
  priority: 'LOW' | 'MED' | 'HIGH' | 'BLOCKING'
  blocking: boolean
  answer_state: QuestionAnswerState
  required_evidence: string[]
  assigned_role: EbcAgentId | 'EXECUTIVE' | 'LUMEN'
}

export type QuestionGraph = {
  mission_id: string
  questions: QuestionNode[]
}

export type Hypothesis = {
  id: string
  statement: string
  supporting_evidence: string[]
  contradicting_evidence: string[]
  tests: string[]
  falsifiers: string[]
  status: HypothesisStatus
}

export type ToolValueEstimate = {
  tool: string
  question: string
  expected_information_gain: 'LOW' | 'MED' | 'HIGH'
  cost: 'LOW' | 'MED' | 'HIGH'
  latency: 'LOW' | 'MED' | 'HIGH'
  risk: ContractRiskLevel
  authority: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY'
  reversibility: boolean
}

export type EvidenceRequirement = {
  claim_or_question: string
  evidence_type: string
  minimum_sources: number
  freshness: 'CURRENT_LIVE' | 'LAST_VERIFIED' | 'ANY'
  primary_preference: boolean
  independence_required: boolean
  tool: string
  completion_threshold: string
}

export type PlanRevision = {
  revision: number
  reason: string
  old_task_ids: string[]
  new_task_ids: string[]
  affected_tasks: string[]
  receipt_id: string
  created_at: string
}

export type ConflictRecord = {
  conflict_id: string
  disputed_claim: string
  kind: 'FACTUAL' | 'INFERENTIAL'
  evidence_a: string[]
  evidence_b: string[]
  lumen_verdict: 'UNRESOLVED' | 'SUPPORTED' | 'CONTRADICTED' | 'NEEDS_DISCRIMINATING_EVIDENCE'
  phoenix_invoked: boolean
  consensus_invented: false
  unresolved: boolean
}

export type VerificationPriority = {
  claim_id: string
  impact: 'LOW' | 'MED' | 'HIGH'
  uncertainty: 'LOW' | 'MED' | 'HIGH'
  novelty: boolean
  temporal_sensitivity: boolean
  decision_relevance: boolean
  evidence_thinness: boolean
  score: number
  verify: boolean
}

export type ContextPacket = {
  agent: EbcAgentId | 'ATLAS' | 'JANUS' | 'SENTINEL' | 'AURORA'
  mission_objective: string
  task_id?: string
  task_objective?: string
  constraints: string[]
  evidence_refs: string[]
  prior_work_product_ids: string[]
  kg_node_ids: string[]
  unresolved_questions: string[]
  hypotheses?: string[]
  authority: string[]
  temporal_scope?: string
  query?: string
}

export type WorkProductEdge = {
  from: string
  to: string
  product_id: string
  reason: string
}

export type ToolDecisionRecord = {
  tool: string
  chosen: boolean
  reason: string
  question: string
  alternate?: string | null
}

export type PhoenixSchedule = {
  invoked: boolean
  reason: string
  claim_ids: string[]
  what_changed: string | null
}

export type SentinelCheckpoint = {
  at: 'plan' | 'replan' | 'tool_proposal' | 'authority' | 'execution' | 'completion'
  action: 'WARN' | 'MITIGATE' | 'REQUIRE_APPROVAL' | 'BLOCK' | 'REPLAN' | 'CONTINUE'
  grants_authority: false
}

export type LearningRecord = {
  schema: 'war-room.orchestration-learning.v1'
  mission_id: string
  mission_class: string
  strategy: CognitiveStrategyId
  assembly: string[]
  task_topology: string[]
  successful_steps: string[]
  failed_steps: string[]
  replans: number
  tool_efficiency: string
  verification_efficiency: string
  conflict_resolution: string
  latency_ms: number
  completion_quality: CompletionVerdict
  evaluation_findings: string[]
  trains_wrim: false
  auto_ingest: false
}

export type MissionReplay = {
  schema: 'war-room.orchestration-replay.v1'
  mission_id: string
  session_id: string | null
  executable: false
  strategy: CognitiveStrategyId
  assembly: string[]
  task_order: string[]
  parallel_groups: string[][]
  tool_decisions: ToolDecisionRecord[]
  replans: number
  conflicts: number
  risks: number
  completion: CompletionVerdict
  evaluation: string | null
}

export type CompressedContext = {
  facts: string[]
  evidence_refs: string[]
  decisions: string[]
  unknowns: string[]
  risks: string[]
  authority: string[]
  open_tasks: string[]
  dropped: string[]
  provenance_preserved: true
}

export type BudgetState = {
  budget: MissionBudget
  model_calls: number
  tool_calls: number
  browser_calls: number
  agent_turns: number
  latency_ms: number
  context_chars: number
  optional_work_skipped: string[]
  safety_not_skipped: true
}

export type JobRoute = {
  job: CognitiveJob
  model_target: string
  placement: ModelPlacement
  reason: string
  fallback: string | null
  fake_local: false
}

export type MissionEvaluation = {
  what_worked: string[]
  what_failed: string[]
  unresolved_questions: string[]
  wasted_calls: string[]
  unnecessary_agents: string[]
  missing_tools: string[]
  routing_issue: string | null
  evidence_issue: string | null
  latency_issue: string | null
  candidate_memory: string[]
  trains_wrim: false
}

export type OrchestrationTelemetry = {
  mission_id: string
  strategy: CognitiveStrategyId
  assembly: EbcAgentId[]
  task_count: number
  parallel_groups: number
  agents_used: EbcAgentId[]
  model_calls: number
  tool_calls: number
  evidence_count: number
  verified_claims: number
  conflicts: number
  replans: number
  risk_count: number
  authority_blocks: number
  completion_state: CompletionVerdict
  latency_ms: number
}

export type CouncilOrchestrationPublic = {
  schema: typeof ORCHESTRATION_SCHEMA
  strategy: CognitiveStrategy
  assembly: CouncilAssemblyPlan
  task_graph: CognitiveTaskGraph
  questions: QuestionGraph
  hypotheses: Hypothesis[]
  blackboard: CognitiveBlackboard
  work_products: CouncilWorkProduct[]
  evidence_plan: EvidenceRequirement[]
  tool_values: ToolValueEstimate[]
  deliberation: DeliberationPolicy
  conflicts: ConflictRecord[]
  verification: VerificationPriority[]
  packets: ContextPacket[]
  compression: CompressedContext | null
  budget: BudgetState
  job_routes: JobRoute[]
  completion: CompletionVerdict
  evaluation: MissionEvaluation | null
  revisions: PlanRevision[]
  telemetry: OrchestrationTelemetry
  grants_authority: false
  ebc_truth_spine: true
  live?: {
    work_product_edges: WorkProductEdge[]
    tool_decisions: ToolDecisionRecord[]
    phoenix: PhoenixSchedule
    sentinel_checkpoints: SentinelCheckpoint[]
    learning: LearningRecord | null
    replay: MissionReplay | null
    persisted: boolean
    adaptive?: import('./adaptiveIntelligence').AdaptivePublic
  }
  /** Optional ENGINE-02 overlay. ATLAS remains the planning role. Does not grant authority. */
  engines02?: import('@/lib/council/engines/integration/executive02').CouncilEngine02Public
  /** Optional ENGINE-03 live dispatch overlay. Does not grant authority. */
  engines03?: import('@/lib/council/engines/integration/executive03').CouncilEngine03Public
  /** Optional ENGINE-04 long-horizon overlay. Does not grant authority. */
  engines04?: import('@/lib/council/engines/integration/executive04').CouncilEngine04Public
  /** Optional ENGINE-05 evaluation overlay. Does not grant authority. Does not auto-promote. */
  engines05?: import('@/lib/council/engines/integration/executive05').CouncilEngine05Public
  /** Optional ENGINE-05P–12 overlay. Does not grant authority. Does not auto-promote. */
  enginesFinal?: import('@/lib/council/engines/integration/executiveFinal').CouncilEngineFinalPublic
}
