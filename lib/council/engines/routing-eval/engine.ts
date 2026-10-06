/**
 * ENGINE-05C ModelProviderRoutingEngine
 * CALLSIGN ≠ PROVIDER. ROLE ≠ PROVIDER. Privacy/authority are hard gates.
 * Does not invent provider specs. Does not spend money.
 */
import { LOCAL_MODEL_REGISTRY } from '@/lib/council/live-orchestration/backends/localModelRegistry'
import { routeCognitiveJob } from '@/lib/council/intelligence/jobRouter'
import type { CognitiveJob } from '@/lib/council/intelligence/orchestrationTypes'
import { ENGINE_05_VERSION } from '../types'
import { createEngineReceipt } from '../receipts'
import { saveRouting } from '../evaluation/store'
import { metric } from '../evaluation/principles'
import { staleBenchmark } from '../benchmark/engine'
import type {
  AvailabilityState,
  CapabilityBenchmarkResult,
  CapabilityMatrixCell,
  CostClass,
  LatencyClass,
  ModelRoutingDecision,
  PrivacyClass,
  ProviderCapabilityRecord,
  RouterFallbackRow,
  TaskClass,
} from '../evaluation/types'
import { ROUTING_DECISION_SCHEMA } from '../evaluation/types'

const TASK_TO_JOB: Partial<Record<TaskClass, CognitiveJob>> = {
  research_discovery: 'research_synthesis',
  source_authority: 'verification',
  freshness: 'research_synthesis',
  claim_verification: 'verification',
  contradiction_handling: 'adversarial_review',
  tool_selection: 'planning',
  planning: 'planning',
  parallel_execution: 'planning',
  context_compilation: 'conversation',
  failure_diagnosis: 'coding_analysis',
  restart_recovery: 'coding_analysis',
  memory_retrieval: 'classification',
  temporal_reasoning: 'quant_reasoning',
  provider_model_reasoning: 'planning',
  structured_output: 'quant_reasoning',
  code_reasoning: 'coding_analysis',
}

export function knownProviderRecords(input: {
  localAvailable?: boolean
  cloudAvailable?: boolean
}): ProviderCapabilityRecord[] {
  const localHealth = input.localAvailable === true ? 'REACHABLE' : input.localAvailable === false ? 'UNREACHABLE' : 'UNKNOWN'
  const rows: ProviderCapabilityRecord[] = LOCAL_MODEL_REGISTRY.filter(r => r.enabled).map(r => ({
    provider_id: 'ollama',
    model_id: r.modelId,
    capabilities: [...r.roleSuitability],
    context_window: null,
    tool_support: 'UNMEASURED',
    structured_output_support: 'UNMEASURED',
    latency_history: [],
    reliability_history: [],
    task_class_results: {},
    privacy_class: 'LOCAL',
    availability: localHealth === 'REACHABLE' ? 'AVAILABLE' : localHealth === 'UNREACHABLE' ? 'UNAVAILABLE' : 'UNKNOWN',
    cost_class: 'LOCAL',
    local_or_cloud: 'LOCAL',
    health: localHealth,
    last_evaluated_at: null,
    specs_invented: false,
  }))
  rows.push({
    provider_id: 'deterministic',
    model_id: 'intelligence.atlas',
    capabilities: ['planning'],
    context_window: null,
    tool_support: false,
    structured_output_support: true,
    latency_history: [metric('latency_ms', 'UNMEASURED', 'UNMEASURED')],
    reliability_history: [],
    task_class_results: {},
    privacy_class: 'INTERNAL',
    availability: 'AVAILABLE',
    cost_class: 'LOCAL',
    local_or_cloud: 'LOCAL',
    health: 'DETERMINISTIC',
    last_evaluated_at: null,
    specs_invented: false,
  })
  if (input.cloudAvailable) {
    rows.push({
      provider_id: 'frontier',
      model_id: 'frontier-approved',
      capabilities: ['research_synthesis', 'verification', 'coding_analysis'],
      context_window: null,
      tool_support: 'UNMEASURED',
      structured_output_support: 'UNMEASURED',
      latency_history: [],
      reliability_history: [],
      task_class_results: {},
      privacy_class: 'CLOUD',
      availability: 'AVAILABLE',
      cost_class: 'HIGH',
      local_or_cloud: 'CLOUD',
      health: 'DECLARED_AVAILABLE',
      last_evaluated_at: null,
      specs_invented: false,
    })
  } else if (input.cloudAvailable === false) {
    rows.push({
      provider_id: 'frontier',
      model_id: 'frontier-approved',
      capabilities: ['research_synthesis'],
      context_window: null,
      tool_support: 'UNMEASURED',
      structured_output_support: 'UNMEASURED',
      latency_history: [],
      reliability_history: [],
      task_class_results: {},
      privacy_class: 'CLOUD',
      availability: 'UNAVAILABLE',
      cost_class: 'HIGH',
      local_or_cloud: 'CLOUD',
      health: 'UNAVAILABLE',
      last_evaluated_at: null,
      specs_invented: false,
    })
  }
  return rows
}

export function routeModelProvider(input: {
  mission_id: string
  task_id?: string
  task_class: TaskClass
  role: string
  privacy: PrivacyClass
  localAvailable: boolean
  cloudAvailable: boolean
  historical?: CapabilityMatrixCell[]
  cost_constraint?: CostClass
  commander_policy?: string[]
  persist?: boolean
}): ModelRoutingDecision {
  const started = Date.now()
  const records = knownProviderRecords({ localAvailable: input.localAvailable, cloudAvailable: input.cloudAvailable })
  const job = TASK_TO_JOB[input.task_class] ?? 'planning'
  const jobRoute = routeCognitiveJob(job, input.localAvailable)
  const reasons: string[] = [`task_class=${input.task_class}`, `job=${job}`, `role=${input.role}`, 'role_is_not_provider']
  const privacyHard = input.privacy === 'LOCAL' || input.commander_policy?.includes('privacy_local')
  if (privacyHard) reasons.push('privacy_hard_gate')

  const available = records.filter(r => r.availability === 'AVAILABLE')
  const gated = privacyHard ? available.filter(r => r.privacy_class !== 'CLOUD') : available

  let selected: ProviderCapabilityRecord | null = gated.find(r => r.local_or_cloud === 'LOCAL' && r.provider_id === 'ollama')
    ?? gated.find(r => r.provider_id === 'deterministic')
    ?? gated[0]
    ?? null

  if (input.historical?.length) {
    const hist = input.historical.filter(h => h.task_class === input.task_class && h.success.kind === 'MEASURED' && h.success.value === true)
    const preferred = hist[0]
    if (preferred) {
      const match = gated.find(r => r.provider_id === preferred.provider_id && r.model_id === preferred.model_id)
      if (match) {
        selected = match
        reasons.push('historical_task_class_measured')
      } else {
        reasons.push('historical_correlation_not_universal')
      }
    }
  }

  if (input.task_class === 'structured_output' && gated.some(r => r.local_or_cloud === 'LOCAL' && r.provider_id === 'ollama')) {
    selected = gated.find(r => r.local_or_cloud === 'LOCAL' && r.provider_id === 'ollama') ?? selected
    reasons.push('structured_extraction_local_preferred_when_reliable')
  }

  if (input.task_class === 'code_reasoning' && gated.some(r => /coding|qwen|orion/i.test(r.model_id))) {
    selected = gated.find(r => /coding|qwen/i.test(r.model_id)) ?? selected
    reasons.push('code_analysis_task_specific')
  }

  if (input.task_class === 'research_discovery' && !privacyHard) {
    const cloud = gated.find(r => r.local_or_cloud === 'CLOUD')
    if (cloud) {
      selected = cloud
      reasons.push('research_synthesis_may_use_approved_frontier')
    }
  }

  let blocked: ModelRoutingDecision['blocked'] = 'NONE'
  if (privacyHard && selected?.privacy_class === 'CLOUD') {
    selected = null
    blocked = 'PRIVACY_BLOCKED'
    reasons.push('cloud_forbidden_despite_benchmark')
  }
  if (!selected) {
    const alt = gated[0] ?? null
    if (alt) selected = alt
    else {
      blocked = input.localAvailable || input.cloudAvailable ? 'MODEL_BLOCKED' : 'MODEL_BLOCKED'
      reasons.push('unavailable_not_invented')
    }
  }

  const alternates = gated.filter(r => r !== selected).map(r => `${r.provider_id}:${r.model_id}`)
  if (jobRoute.fallback) alternates.push(jobRoute.fallback)

  const decision: ModelRoutingDecision = {
    schema: ROUTING_DECISION_SCHEMA,
    mission_id: input.mission_id,
    task_id: input.task_id ?? 'task-0',
    task_class: input.task_class,
    selected_provider: selected?.provider_id ?? null,
    selected_model: selected?.model_id ?? null,
    alternates,
    reason_codes: reasons,
    benchmark_refs: input.historical?.map(h => `${h.task_class}:${h.provider_id}`) ?? [],
    availability: selected ? selected.availability : 'UNAVAILABLE',
    expected_latency_class: (selected?.cost_class === 'LOCAL' ? 'FAST' : selected ? 'MED' : 'UNMEASURED') as LatencyClass,
    privacy_class: selected?.privacy_class ?? (privacyHard ? 'LOCAL' : 'INTERNAL'),
    cost_class: selected?.cost_class ?? 'UNMEASURED',
    authority_cost_requirements: ['no_unapproved_spend', 'commander_policy'],
    blocked,
    role: input.role,
    role_is_provider: false,
    grants_authority: false,
    universal_best_model: false,
    cheapest_is_best: false,
    most_expensive_is_best: false,
    receipt: createEngineReceipt({
      engine: 'model-provider-routing',
      mission_id: input.mission_id,
      task_id: input.task_id,
      started_at: started,
      decision_count: 1,
      decision: selected ? `${selected.provider_id}:${selected.model_id}` : blocked,
      failure_state: blocked === 'NONE' ? 'none' : 'no_candidates',
    }),
  }
  if (input.persist !== false) void saveRouting(decision)
  return decision
}

export function fallbackMatrix(input: {
  localAvailable: boolean
  cloudAvailable: boolean
  privacy: PrivacyClass
}): RouterFallbackRow[] {
  const classes: TaskClass[] = [
    'research_discovery', 'structured_output', 'code_reasoning', 'planning', 'claim_verification',
    'contradiction_handling', 'failure_diagnosis', 'context_compilation',
  ]
  return classes.map(task_class => {
    const d = routeModelProvider({
      mission_id: 'matrix',
      task_class,
      role: 'ORION',
      privacy: input.privacy,
      localAvailable: input.localAvailable,
      cloudAvailable: input.cloudAvailable,
      persist: false,
    })
    return {
      task_class,
      preferred: d.selected_provider && d.selected_model ? `${d.selected_provider}:${d.selected_model}` : null,
      alternate: d.alternates[0] ?? null,
      local_fallback: d.alternates.find(a => /ollama|local|deterministic/i.test(a)) ?? (d.privacy_class === 'LOCAL' ? d.selected_model : null),
      blocked_condition: d.blocked === 'NONE' ? null : d.blocked,
    }
  })
}

export function capabilityMatrixFromRuns(runs: readonly CapabilityBenchmarkResult[], provider_id: string, model_id: string): CapabilityMatrixCell[] {
  const cells: CapabilityMatrixCell[] = []
  for (const run of runs) {
    if (staleBenchmark(run, run.binding.model_provider, new Date().toISOString()) && run.binding.model_provider !== 'deterministic-engine') {
      continue
    }
    const byClass = new Map<TaskClass, typeof run.cases>()
    for (const row of run.cases) {
      const list = byClass.get(row.task_class) ?? []
      list.push(row)
      byClass.set(row.task_class, list)
    }
    for (const [task_class, cases] of byClass) {
      const pass = cases.filter(c => c.correctness_signal === 'PASS').length
      cells.push({
        task_class,
        provider_id,
        model_id,
        success: metric('task_success', pass / Math.max(1, cases.length), 'MEASURED'),
        quality: metric('evidence_quality', cases[0]?.evidence_sufficiency ?? 'NA', 'MEASURED'),
        latency: metric('latency_ms', cases.reduce((n, c) => n + Number(c.metrics.find(m => m.name === 'latency_ms')?.value ?? 0), 0), 'MEASURED', 'ms'),
        tokens: metric('token_cost', null, 'UNMEASURED'),
        tool_use: metric('tool_call_count', cases.reduce((n, c) => n + Number(c.metrics.find(m => m.name === 'tool_call_count')?.value ?? 0), 0), 'MEASURED'),
        failure_rate: metric('failure_rate', cases.filter(c => c.correctness_signal === 'FAIL').length / Math.max(1, cases.length), 'MEASURED'),
        last_evaluated_at: run.binding.timestamp,
        universal_best: false,
      })
    }
  }
  return cells
}

export function inferTaskClass(text: string): TaskClass {
  const t = text.toLowerCase()
  if (/code|typescript|refactor/.test(t)) return 'code_reasoning'
  if (/extract|json|schema|structured/.test(t)) return 'structured_output'
  if (/fresh|current|today|live/.test(t)) return 'freshness'
  if (/contradict|conflict/.test(t)) return 'contradiction_handling'
  if (/verif|lumen/.test(t)) return 'claim_verification'
  if (/research|source|pulsar/.test(t)) return 'research_discovery'
  if (/plan|atlas/.test(t)) return 'planning'
  if (/fail|diagnos/.test(t)) return 'failure_diagnosis'
  if (/memory|recall/.test(t)) return 'memory_retrieval'
  if (/temporal|historical|current truth/.test(t)) return 'temporal_reasoning'
  return 'tool_selection'
}

export type AvailabilityStatePublic = AvailabilityState
