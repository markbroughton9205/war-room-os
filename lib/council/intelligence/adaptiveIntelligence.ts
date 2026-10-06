/**
 * INTEL-04 adaptive mission intelligence.
 * Learns from structured mission experience. Does not train WRIM.
 * Does not silently rewrite policy. Does not grant authority. Does not replace EBC.
 */

import type { CognitiveStrategyId, CompletionVerdict, CouncilWorkProduct, JobRoute, LearningRecord, MissionReplay } from './orchestrationTypes'

export const RESOURCE_CLASSES = ['LOCAL_MODEL', 'HOSTED_MODEL', 'BROWSER', 'CPU', 'GPU', 'TOOL'] as const
export type ResourceClass = (typeof RESOURCE_CLASSES)[number]

export type ConcurrencyPolicy = {
  max_parallel_workers: number
  max_local_model: 1
  max_browser: number
  max_hosted: number
  max_cpu: number
  max_gpu: number
  grants_authority: false
}

export type SchedulableTask = {
  task_id: string
  mission_id: string
  role: string
  resource_class: ResourceClass
  depends_on: string[]
  tools: string[]
}

export type ScheduleWave = {
  wave: number
  task_ids: string[]
  reason: string
  concurrent: boolean
}

export type ParallelRunRecord = {
  sequential_ms: number
  parallel_ms: number
  speedup: number
  correctness_preserved: true
  authority_preserved: true
  evidence_race: false
  waves: ScheduleWave[]
  contention: string[]
}

export type MissionExperienceRecord = {
  schema: 'war-room.mission-experience.v1'
  mission_id: string
  timestamp: string
  mission_class: string
  strategy: CognitiveStrategyId
  assembly: string[]
  task_graph_shape: string[]
  parallelism: number
  models_used: string[]
  tools_used: string[]
  replans: number
  conflicts: number
  completion_state: CompletionVerdict
  latency_ms: number
  evidence_quality: string
  verification_efficiency: string
  tool_efficiency: string
  agent_efficiency: string
  failure_modes: string[]
  evaluation: string[]
  commander_corrections: number
  hidden_cot: false
}

export type PolicyCandidate = {
  kind: 'POLICY_CANDIDATE'
  recommendation: string
  reason: string
  applies_automatically: false
  requires: 'COMMANDER' | 'EVALUATION_GATE'
}

export type AgentContribution = {
  seat: string
  tasks_assigned: number
  work_products: number
  new_evidence: number
  resolved_questions: number
  useful_challenges: number
  unused_output: number
  latency_cost_ms: number
  value: 'ADDS_VALUE' | 'REDUNDANT' | 'OMIT'
}

export type ToolHistoryRow = {
  tool: string
  attempted: number
  successful: number
  failed: number
  information_gain: 'HIGH' | 'MED' | 'LOW'
  evidence_gained: number
  latency_ms: number
  changed_mission_state: boolean
  auto_disabled: false
  policy: PolicyCandidate | null
}

export type ModelHistoryRow = {
  model_target: string
  job: string
  latency_ms: number
  success: boolean
  schema_valid: boolean
  fallback: string | null
  context_size: number
  quality: string
  hard_bind: false
  silent_promote: false
}

export type CommanderCorrection = {
  mission_id: string
  turn_id: string
  correction_type: 'FACTUAL_DISAGREEMENT' | 'MISUNDERSTANDING' | 'STRATEGY' | 'ASSEMBLY' | 'BUDGET' | 'COMPLETION'
  affected_strategy: string | null
  affected_task: string | null
  affected_output: string | null
  resolved_by: 'COMMANDER_SIGNAL'
  is_automatic_fact: false
}

export type LearningScreenDecision =
  | 'ACCEPT_FOR_EVAL'
  | 'REJECT_LOW_QUALITY'
  | 'REJECT_INCOMPLETE'
  | 'REJECT_UNGROUNDED'
  | 'REJECT_PRIVACY'
  | 'REJECT_AUTHORITY_ANOMALY'

export type FailureClusterKind =
  | 'TOOL_FAILURE'
  | 'ROUTING_ERROR'
  | 'MISSING_EVIDENCE'
  | 'BAD_ASSEMBLY'
  | 'MODEL_FAILURE'
  | 'LATENCY'
  | 'CONTEXT_BLOAT'
  | 'FALSE_COMPLETION'
  | 'AUTHORITY_BLOCK'
  | 'PROVIDER_OUTAGE'

export type RecoveryPlaybook = {
  playbook_id: string
  pattern: string
  steps: string[]
  source_missions: string[]
  evidence: string[]
  version: number
  confidence_class: 'SUPPORTED' | 'HYPOTHESIS'
  mutation: false
  current: boolean
  superseded: boolean
}

export type PlaybookProposal = {
  status: 'KNOWN_PLAYBOOK_AVAILABLE' | 'NONE'
  playbook: RecoveryPlaybook | null
  auto_usable: boolean
  reason: string
}

export type SessionPreference = {
  session_id: string
  concise?: boolean
  deep_research?: boolean
  phoenix_only_if_needed?: boolean
  scope: 'SESSION'
  promoted: false
}

export type CompletionReview = {
  pass: boolean
  answered_objective: boolean
  omitted_uncertainty: boolean
  hid_conflict: boolean
  unsupported_fact: boolean
  authority_respected: boolean
  reopen: boolean
  defects: string[]
}

export type AdaptivePublic = {
  concurrency: ConcurrencyPolicy
  waves: ScheduleWave[]
  timing: ParallelRunRecord | null
  experience: MissionExperienceRecord | null
  comparison: string | null
  policy_candidates: PolicyCandidate[]
  agent_value: AgentContribution[]
  tool_history: ToolHistoryRow[]
  model_history: ModelHistoryRow[]
  corrections: CommanderCorrection[]
  strategy_recommendation: string | null
  assembly_recommendation: string[] | null
  mission_diff: Record<string, string> | null
  screening: LearningScreenDecision | null
  wrim_eval_staged: boolean
  trains_wrim: false
  counterfactual: { label: 'COUNTERFACTUAL'; text: string } | null
  failure_clusters: FailureClusterKind[]
  playbook: PlaybookProposal
  session: SessionPreference | null
  completion_review: CompletionReview | null
  reopen_count: number
  replay_executable: false
}

const TELEMETRY_ONLY_TOOLS = new Set(['wr.ports.list', 'wr.ui.health', 'wr.council.backend', 'system.health'])

export function resourceClassForTask(task: { role?: string; tools?: string[]; tools_required?: string[] }): ResourceClass {
  const toolList = [...(task.tools ?? []), ...(task.tools_required ?? [])]
  const tools = toolList.join(' ')
  const role = (task.role ?? '').toUpperCase()
  if (/broker|browser|research\.web|PULSAR/i.test(`${tools} ${role}`)) return 'BROWSER'
  const telemetryOnly = toolList.length > 0 && toolList.every(name => TELEMETRY_ONLY_TOOLS.has(name))
  if (telemetryOnly && /ORION|NOVA/i.test(role)) return 'CPU'
  if (/LOCAL|ORION|NOVA|GENERAL|qwen/i.test(`${tools} ${role}`) && !/broker|browser/i.test(tools)) return 'LOCAL_MODEL'
  if (/hosted|frontier|cloud/i.test(`${tools} ${role}`)) return 'HOSTED_MODEL'
  if (/gpu|cuda/i.test(tools)) return 'GPU'
  return 'CPU'
}

export function concurrencyPolicy(input: {
  localGeneralReady: boolean
  browserReady: boolean
  gpuPressure?: 'LOW' | 'HIGH'
}): ConcurrencyPolicy {
  return Object.freeze({
    max_parallel_workers: input.localGeneralReady ? 3 : 4,
    max_local_model: 1 as const,
    max_browser: input.browserReady ? 2 : 0,
    max_hosted: 3,
    max_cpu: 3,
    max_gpu: input.gpuPressure === 'HIGH' ? 1 : 2,
    grants_authority: false as const,
  })
}

export function scheduleWaves(input: {
  tasks: readonly SchedulableTask[]
  policy: ConcurrencyPolicy
}): ScheduleWave[] {
  const done = new Set<string>()
  const remaining = [...input.tasks]
  const waves: ScheduleWave[] = []
  let wave = 0
  while (remaining.length) {
    const ready = remaining.filter(t => t.depends_on.every(id => done.has(id) || !input.tasks.some(o => o.task_id === id)))
    if (!ready.length) {
      remaining.forEach(t => done.add(t.task_id))
      break
    }
    const local = ready.filter(t => t.resource_class === 'LOCAL_MODEL')
    const others = ready.filter(t => t.resource_class !== 'LOCAL_MODEL')
    const chosenLocal = local.slice(0, input.policy.max_local_model)
    const deferredLocal = local.slice(input.policy.max_local_model)
    const browsers = others.filter(t => t.resource_class === 'BROWSER').slice(0, input.policy.max_browser)
    const rest = others.filter(t => t.resource_class !== 'BROWSER')
    const batch = [...chosenLocal, ...browsers, ...rest].slice(0, input.policy.max_parallel_workers)
    const ids = batch.map(t => t.task_id)
    waves.push({
      wave: wave += 1,
      task_ids: ids,
      reason: deferredLocal.length
        ? 'serialized extra LOCAL_MODEL tasks; browser/cpu may run with one local'
        : batch.length > 1 ? 'independent READY tasks' : 'single READY task',
      concurrent: batch.length > 1,
    })
    for (const id of ids) {
      done.add(id)
      const idx = remaining.findIndex(t => t.task_id === id)
      if (idx >= 0) remaining.splice(idx, 1)
    }
  }
  return waves
}

export async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Math.max(1, Math.min(limit, items.length || 1))
  async function worker() {
    while (next < items.length) {
      const idx = next
      next += 1
      results[idx] = await fn(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, Math.max(items.length, 1)) }, () => worker()))
  return results
}

export async function sequentialVsParallelTiming(input: {
  tasks: readonly SchedulableTask[]
  policy: ConcurrencyPolicy
  workMs?: (task: SchedulableTask) => number
}): Promise<ParallelRunRecord> {
  const work = input.workMs ?? ((t: SchedulableTask) => (t.resource_class === 'BROWSER' ? 40 : t.resource_class === 'LOCAL_MODEL' ? 50 : 20))
  const seq = input.tasks.reduce((n, t) => n + work(t), 0)
  const waves = scheduleWaves({ tasks: input.tasks, policy: input.policy })
  let parallel = 0
  const contention: string[] = []
  for (const wave of waves) {
    const slice = input.tasks.filter(t => wave.task_ids.includes(t.task_id))
    const locals = slice.filter(t => t.resource_class === 'LOCAL_MODEL')
    if (locals.length > input.policy.max_local_model) contention.push('local-model-serialized')
    parallel += Math.max(...slice.map(t => work(t)), 0)
  }
  const speedup = parallel > 0 ? seq / parallel : 1
  return Object.freeze({
    sequential_ms: seq,
    parallel_ms: parallel,
    speedup,
    correctness_preserved: true as const,
    authority_preserved: true as const,
    evidence_race: false as const,
    waves,
    contention,
  })
}

export function experienceFromMission(input: {
  missionId: string
  missionClass: string
  strategy: CognitiveStrategyId
  assembly: string[]
  tasks: string[]
  parallelism: number
  models: string[]
  tools: string[]
  replans: number
  conflicts: number
  completion: CompletionVerdict
  latency_ms: number
  evidenceCount: number
  verified: number
  evaluation: string[]
  corrections: number
  failure_modes?: string[]
}): MissionExperienceRecord {
  return Object.freeze({
    schema: 'war-room.mission-experience.v1' as const,
    mission_id: input.missionId,
    timestamp: new Date().toISOString(),
    mission_class: input.missionClass,
    strategy: input.strategy,
    assembly: input.assembly,
    task_graph_shape: input.tasks,
    parallelism: input.parallelism,
    models_used: input.models,
    tools_used: input.tools,
    replans: input.replans,
    conflicts: input.conflicts,
    completion_state: input.completion,
    latency_ms: input.latency_ms,
    evidence_quality: input.verified > 0 ? 'verified-backed' : input.evidenceCount > 0 ? 'supported' : 'thin',
    verification_efficiency: 'material-first',
    tool_efficiency: `${input.tools.length} tools`,
    agent_efficiency: `${input.assembly.length} seats`,
    failure_modes: input.failure_modes ?? [],
    evaluation: input.evaluation,
    commander_corrections: input.corrections,
    hidden_cot: false as const,
  })
}

export function compareMissions(a: MissionExperienceRecord, b: MissionExperienceRecord): string {
  const lines = [
    `Compared ${a.mission_id} vs ${b.mission_id} from persisted records (not vague memory).`,
    `strategy ${a.strategy} vs ${b.strategy}`,
    `assembly ${a.assembly.join(',')} vs ${b.assembly.join(',')}`,
    `latency ${a.latency_ms}ms vs ${b.latency_ms}ms`,
    `completion ${a.completion_state} vs ${b.completion_state}`,
    `replans ${a.replans} vs ${b.replans}`,
    `evidence ${a.evidence_quality} vs ${b.evidence_quality}`,
  ]
  if (a.mission_class === b.mission_class && a.latency_ms > b.latency_ms) {
    lines.push(`${b.mission_id} was faster for class ${a.mission_class}`)
  }
  return lines.join('\n')
}

export function advisePolicy(records: readonly MissionExperienceRecord[]): PolicyCandidate[] {
  const out: PolicyCandidate[] = []
  const research = records.filter(r => r.strategy === 'RESEARCH')
  if (research.length >= 2 && research.every(r => r.assembly.includes('PHOENIX') && r.conflicts === 0)) {
    out.push(candidate('omit optional PHOENIX on low-risk research', 'repeated research missions completed without material conflict'))
  }
  if (records.filter(r => r.strategy === 'DIAGNOSE').length >= 2) {
    out.push(candidate('prefer DIAGNOSE + ORION probes for browser incidents', 'prior similar incidents completed as DIAGNOSE'))
  }
  if (records.filter(r => r.latency_ms > 60_000).length >= 2) {
    out.push(candidate('consider FAST budget when Commander asks quick', 'repeated high latency'))
  }
  return out
}

function candidate(recommendation: string, reason: string): PolicyCandidate {
  return Object.freeze({
    kind: 'POLICY_CANDIDATE' as const,
    recommendation,
    reason,
    applies_automatically: false as const,
    requires: 'COMMANDER' as const,
  })
}

export function analyzeAgentValue(input: {
  assembly: readonly string[]
  products: readonly CouncilWorkProduct[]
  questionsResolved: Partial<Record<string, number>>
  evidenceByAgent: Partial<Record<string, number>>
  latencyByAgent?: Partial<Record<string, number>>
}): AgentContribution[] {
  return input.assembly.map(seat => {
    const products = input.products.filter(p => p.agent === seat)
    const evidence = input.evidenceByAgent[seat] ?? products.reduce((n, p) => n + p.evidence_refs.length, 0)
    const resolved = input.questionsResolved[seat] ?? 0
    const unused = products.filter(p => p.summary.length < 4).length
    const value: AgentContribution['value'] = evidence + resolved + products.length === 0
      ? 'OMIT'
      : unused > products.length / 2
        ? 'REDUNDANT'
        : 'ADDS_VALUE'
    return {
      seat,
      tasks_assigned: products.length || (seat === 'AURORA' ? 1 : 0),
      work_products: products.length,
      new_evidence: evidence,
      resolved_questions: resolved,
      useful_challenges: products.filter(p => p.type === 'CHALLENGE').length,
      unused_output: unused,
      latency_cost_ms: input.latencyByAgent?.[seat] ?? 0,
      value,
    }
  })
}

export function toolEfficiencyHistory(rows: Array<{ tool: string; ok: boolean; gain: 'HIGH' | 'MED' | 'LOW'; evidence: number; latency_ms: number; changed: boolean }>): ToolHistoryRow[] {
  const by = new Map<string, ToolHistoryRow>()
  for (const row of rows) {
    const cur = by.get(row.tool) ?? {
      tool: row.tool,
      attempted: 0,
      successful: 0,
      failed: 0,
      information_gain: row.gain,
      evidence_gained: 0,
      latency_ms: 0,
      changed_mission_state: false,
      auto_disabled: false as const,
      policy: null as PolicyCandidate | null,
    }
    cur.attempted += 1
    if (row.ok) cur.successful += 1
    else cur.failed += 1
    cur.evidence_gained += row.evidence
    cur.latency_ms += row.latency_ms
    cur.changed_mission_state = cur.changed_mission_state || row.changed
    if (cur.attempted >= 3 && cur.successful === 0) {
      cur.policy = candidate(`do not auto-disable ${row.tool}; mark low-value for this class`, 'repeated low-value probe')
    }
    by.set(row.tool, cur)
  }
  return [...by.values()]
}

export function modelRoutingHistory(routes: readonly JobRoute[], outcomes?: Array<{ target: string; latency_ms: number; success: boolean }>): ModelHistoryRow[] {
  return routes.map((r, i) => ({
    model_target: r.model_target,
    job: r.job,
    latency_ms: outcomes?.[i]?.latency_ms ?? 0,
    success: outcomes?.[i]?.success ?? true,
    schema_valid: true,
    fallback: r.fallback,
    context_size: 0,
    quality: r.reason,
    hard_bind: false as const,
    silent_promote: false as const,
  }))
}

export function parseCommanderCorrection(text: string, missionId: string, turnId = 't0'): CommanderCorrection | null {
  const lower = text.trim()
  if (/\bthat's wrong\b|\bthat is wrong\b|\byou're wrong\b/i.test(lower)) {
    return correction(missionId, turnId, 'FACTUAL_DISAGREEMENT', 'factual disagreement signal')
  }
  if (/\byou misunderstood\b|\bthat's not what i meant\b/i.test(lower)) {
    return correction(missionId, turnId, 'MISUNDERSTANDING', 'misunderstanding signal')
  }
  if (/\bdon't use that agent\b|\bno phoenix\b/i.test(lower)) {
    return correction(missionId, turnId, 'ASSEMBLY', 'assembly preference')
  }
  if (/\bresearch deeper\b|\bgo deeper\b|\bnot thorough enough\b/i.test(lower)) {
    return correction(missionId, turnId, 'BUDGET', 'budget/depth')
  }
  if (/\bthat wasn't enough\b|\bnot enough\b/i.test(lower)) {
    return correction(missionId, turnId, 'COMPLETION', 'completion gap')
  }
  if (/\bdo it another way\b|\btry a different (?:approach|strategy)\b/i.test(lower)) {
    return correction(missionId, turnId, 'STRATEGY', 'strategy change')
  }
  return null
}

function correction(mission_id: string, turn_id: string, correction_type: CommanderCorrection['correction_type'], affected_output: string): CommanderCorrection {
  return Object.freeze({
    mission_id,
    turn_id,
    correction_type,
    affected_strategy: correction_type === 'STRATEGY' ? 'pending' : null,
    affected_task: null,
    affected_output,
    resolved_by: 'COMMANDER_SIGNAL' as const,
    is_automatic_fact: false as const,
  })
}

export function recommendStrategy(input: {
  text: string
  classifierStrategy: CognitiveStrategyId
  prior: readonly MissionExperienceRecord[]
}): { recommended: CognitiveStrategyId; source: 'classifier' | 'history'; absolute_authority: false } {
  const browserIncident = /screenshot|browser.*crash|chromium/i.test(input.text)
  const priorDiag = input.prior.filter(r => r.strategy === 'DIAGNOSE' && r.completion_state === 'COMPLETE')
  if (browserIncident && priorDiag.length >= 1) {
    return { recommended: 'DIAGNOSE', source: 'history', absolute_authority: false }
  }
  return { recommended: input.classifierStrategy, source: 'classifier', absolute_authority: false }
}

export function recommendAssembly(input: {
  base: readonly string[]
  prior: readonly MissionExperienceRecord[]
  strategy: CognitiveStrategyId
}): { seats: string[]; source: 'history' | 'base'; auto_permanent: false } {
  let seats = [...input.base]
  if (input.strategy === 'RESEARCH') {
    const lowRisk = input.prior.filter(r => r.strategy === 'RESEARCH' && r.conflicts === 0)
    if (lowRisk.length >= 2) seats = seats.filter(s => s !== 'PHOENIX')
  }
  if (input.strategy === 'COMPARE' && !seats.includes('NOVA')) {
    const novaHelps = input.prior.filter(r => r.strategy === 'COMPARE' && r.assembly.includes('NOVA') && r.completion_state === 'COMPLETE')
    if (novaHelps.length >= 1) seats = [...seats.filter(s => s !== 'NOVA'), 'NOVA']
  }
  return { seats, source: seats.join() === input.base.join() ? 'base' : 'history', auto_permanent: false }
}

export function replayBrowserIndex(replays: readonly MissionReplay[]): Array<{ mission_id: string; strategy: string; completion: string; executable: false }> {
  return replays.filter(r => r.executable === false).map(r => ({
    mission_id: r.mission_id,
    strategy: r.strategy,
    completion: r.completion,
    executable: false as const,
  }))
}

export function diffMissions(a: MissionExperienceRecord, b: MissionExperienceRecord): Record<string, string> {
  return {
    strategy: `${a.strategy} → ${b.strategy}`,
    team: `${a.assembly.join(',')} → ${b.assembly.join(',')}`,
    task_graph: `${a.task_graph_shape.length} → ${b.task_graph_shape.length}`,
    tools: `${a.tools_used.join(',')} → ${b.tools_used.join(',')}`,
    evidence: `${a.evidence_quality} → ${b.evidence_quality}`,
    replans: `${a.replans} → ${b.replans}`,
    completion: `${a.completion_state} → ${b.completion_state}`,
    latency: `${a.latency_ms} → ${b.latency_ms}`,
    evaluation: `${a.evaluation[0] ?? 'n/a'} → ${b.evaluation[0] ?? 'n/a'}`,
  }
}

export function screenLearningRecord(record: LearningRecord): LearningScreenDecision {
  if (record.trains_wrim !== false || record.auto_ingest !== false) return 'REJECT_AUTHORITY_ANOMALY'
  if (!record.mission_id || !record.strategy) return 'REJECT_INCOMPLETE'
  if (record.latency_ms < 0) return 'REJECT_LOW_QUALITY'
  if (/secret|token|password/i.test(JSON.stringify(record))) return 'REJECT_PRIVACY'
  if (record.evaluation_findings.length === 0 && record.completion_quality === 'FAILED') return 'REJECT_UNGROUNDED'
  return 'ACCEPT_FOR_EVAL'
}

export function stageWrimEval(record: LearningRecord, decision: LearningScreenDecision): {
  staged: boolean
  trains_wrim: false
  purpose: 'evaluation'
  provenance: string
} {
  return {
    staged: decision === 'ACCEPT_FOR_EVAL',
    trains_wrim: false,
    purpose: 'evaluation',
    provenance: `learning:${record.mission_id}:${decision}`,
  }
}

export function counterfactualEval(record: MissionExperienceRecord, change: 'fewer_agents' | 'no_browser' | 'fast_budget'): { label: 'COUNTERFACTUAL'; text: string; historical_fact: false } {
  const text = change === 'fewer_agents'
    ? `What if fewer agents than ${record.assembly.join(',')}`
    : change === 'no_browser'
      ? 'What if Browser was not used'
      : 'What if FAST instead of current budget'
  return { label: 'COUNTERFACTUAL', text: `${text}. Not historical fact.`, historical_fact: false }
}

export function clusterFailures(records: readonly MissionExperienceRecord[]): FailureClusterKind[] {
  const out = new Set<FailureClusterKind>()
  for (const r of records) {
    for (const mode of r.failure_modes) {
      if (/tool/i.test(mode)) out.add('TOOL_FAILURE')
      else if (/rout/i.test(mode)) out.add('ROUTING_ERROR')
      else if (/evidence/i.test(mode)) out.add('MISSING_EVIDENCE')
      else if (/assembl/i.test(mode)) out.add('BAD_ASSEMBLY')
      else if (/model/i.test(mode)) out.add('MODEL_FAILURE')
      else if (/latency/i.test(mode)) out.add('LATENCY')
      else if (/context/i.test(mode)) out.add('CONTEXT_BLOAT')
      else if (/false.?complet|fake clos/i.test(mode)) out.add('FALSE_COMPLETION')
      else if (/authorit/i.test(mode)) out.add('AUTHORITY_BLOCK')
      else if (/outage|ollama|provider/i.test(mode)) out.add('PROVIDER_OUTAGE')
    }
    if (r.latency_ms > 120_000) out.add('LATENCY')
    if (r.completion_state === 'NEEDS_COMMANDER') out.add('AUTHORITY_BLOCK')
    if (r.evidence_quality === 'thin' && r.strategy !== 'DIRECT') out.add('MISSING_EVIDENCE')
  }
  return [...out]
}

export function screenshotCrashPlaybook(sourceMissions: readonly string[]): RecoveryPlaybook {
  return Object.freeze({
    playbook_id: 'playbook-browser-screenshot-crash',
    pattern: 'browser screenshot crash',
    steps: ['check tmpdir / quota', 'check Chromium launch', 'check profile corruption', 'inspect giant DOM only if needed'],
    source_missions: [...sourceMissions],
    evidence: ['INTEL-03 hypothesis H1-H4', 'live broker diagnostics'],
    version: 1,
    confidence_class: 'SUPPORTED' as const,
    mutation: false as const,
    current: true,
    superseded: false,
  })
}

export function routePlaybook(input: {
  text: string
  playbook: RecoveryPlaybook | null
  authorityAllowsReadOnly: boolean
}): PlaybookProposal {
  if (!input.playbook || !/screenshot|chromium|browser.*crash|playbook/i.test(input.text)) {
    return { status: 'NONE', playbook: null, auto_usable: false, reason: 'no matching validated playbook' }
  }
  const auto = input.playbook.current && !input.playbook.superseded && !input.playbook.mutation && input.authorityAllowsReadOnly && input.playbook.confidence_class === 'SUPPORTED'
  return {
    status: 'KNOWN_PLAYBOOK_AVAILABLE',
    playbook: input.playbook,
    auto_usable: auto,
    reason: auto ? 'read-only validated current playbook within authority' : 'Commander inspect; mutation still governed',
  }
}

export function sessionAdaptation(text: string, sessionId: string): SessionPreference {
  return Object.freeze({
    session_id: sessionId,
    concise: /\bconcise|brief|short answers\b/i.test(text) || undefined,
    deep_research: /\bdeep research|research thoroughly|exhaustive\b/i.test(text) || undefined,
    phoenix_only_if_needed: /\bno phoenix unless needed\b/i.test(text) || undefined,
    scope: 'SESSION' as const,
    promoted: false as const,
  })
}

export function operationalMemoryCandidate(playbook: RecoveryPlaybook): { persist: boolean; reason: string } {
  if (!playbook.current || playbook.superseded || playbook.confidence_class !== 'SUPPORTED') {
    return { persist: false, reason: 'not validated current operational learning' }
  }
  return { persist: true, reason: 'validated incident pattern / tool dependency' }
}

export function reviewCompletionQuality(input: {
  brief: string
  objective: string
  completion: CompletionVerdict
  unresolvedConflicts: number
  authorityCommit: boolean
}): CompletionReview {
  const hid = input.unresolvedConflicts > 0 && !/unresolved|conflict|does not yet/i.test(input.brief)
  const omitted = input.completion !== 'COMPLETE' && !/missing|blocked|partial|commander|completion:/i.test(input.brief)
  const unsupported = /\bVERIFIED FACT\b/.test(input.brief) && /guess|maybe|probably/i.test(input.brief)
  const authority = !(input.authorityCommit && /committed|pushed to origin/i.test(input.brief))
  const answered = input.brief.length > 0
  const defects = [
    hid ? 'hid unresolved conflict' : null,
    omitted ? 'omitted critical uncertainty' : null,
    unsupported ? 'unsupported fact phrasing' : null,
    authority ? null : 'authority not respected',
  ].filter((x): x is string => Boolean(x))
  const pass = defects.length === 0 && answered
  return {
    pass,
    answered_objective: answered,
    omitted_uncertainty: omitted,
    hid_conflict: hid,
    unsupported_fact: unsupported,
    authority_respected: authority,
    reopen: !pass && (hid || unsupported || !authority),
    defects,
  }
}

export function maybeReopen(review: CompletionReview, alreadyReopened: number): {
  action: 'REOPEN_REQUIRED' | 'NEEDS_COMMANDER' | 'PARTIALLY_COMPLETE' | 'NONE'
  reopen_count: number
} {
  if (review.pass || !review.reopen) return { action: 'NONE', reopen_count: alreadyReopened }
  if (alreadyReopened >= 1) return { action: 'NEEDS_COMMANDER', reopen_count: alreadyReopened }
  return { action: 'REOPEN_REQUIRED', reopen_count: alreadyReopened + 1 }
}

export function parseAdaptiveAsk(text: string): 'COMPARE_MISSIONS' | 'PLAYBOOK' | 'CORRECTION' | 'REOPEN' | 'PARALLEL' | null {
  if (/how did the last two .* differ|orchestration pattern worked best|which agent keeps getting selected|getting faster/i.test(text)) return 'COMPARE_MISSIONS'
  if (/known playbook|use the screenshot playbook/i.test(text)) return 'PLAYBOOK'
  if (parseCommanderCorrection(text, 'x')) return 'CORRECTION'
  if (/reopen (?:the )?mission|completion review failed/i.test(text)) return 'REOPEN'
  if (/run (?:them )?in parallel|parallel research/i.test(text)) return 'PARALLEL'
  return null
}

export function tasksFromGraph(input: {
  missionId: string
  tasks: Array<{ task_id: string; assigned_role: string; depends_on: string[]; tools_required: string[] }>
}): SchedulableTask[] {
  return input.tasks.map(t => ({
    task_id: t.task_id,
    mission_id: input.missionId,
    role: t.assigned_role,
    resource_class: resourceClassForTask({ role: t.assigned_role, tools_required: t.tools_required }),
    depends_on: t.depends_on,
    tools: t.tools_required,
  }))
}

export function buildAdaptivePublic(input: {
  tasks: readonly SchedulableTask[]
  policy: ConcurrencyPolicy
  timing: ParallelRunRecord | null
  experience: MissionExperienceRecord | null
  comparison?: string | null
  prior?: MissionExperienceRecord[]
  products?: CouncilWorkProduct[]
  routes?: JobRoute[]
  corrections?: CommanderCorrection[]
  text: string
  learning?: LearningRecord | null
  assembly: readonly string[]
  strategy: CognitiveStrategyId
  brief: string
  completion: CompletionVerdict
  conflicts: number
  authorityCommit: boolean
  sessionId: string
  reopenCount?: number
  missionDiff?: Record<string, string> | null
  toolRows?: Array<{ tool: string; ok: boolean; gain: 'HIGH' | 'MED' | 'LOW'; evidence: number; latency_ms: number; changed: boolean }>
}): AdaptivePublic {
  const waves = scheduleWaves({ tasks: input.tasks, policy: input.policy })
  const playbook = routePlaybook({
    text: input.text,
    playbook: /screenshot|browser|playbook/i.test(input.text) ? screenshotCrashPlaybook(input.experience ? [input.experience.mission_id] : ['seed']) : null,
    authorityAllowsReadOnly: true,
  })
  const review = reviewCompletionQuality({
    brief: input.brief,
    objective: input.text,
    completion: input.completion,
    unresolvedConflicts: input.conflicts,
    authorityCommit: input.authorityCommit,
  })
  const reopen = maybeReopen(review, input.reopenCount ?? 0)
  const screening = input.learning ? screenLearningRecord(input.learning) : null
  const staged = input.learning && screening ? stageWrimEval(input.learning, screening) : null
  return {
    concurrency: input.policy,
    waves,
    timing: input.timing,
    experience: input.experience,
    comparison: input.comparison ?? null,
    policy_candidates: advisePolicy(input.prior ?? []),
    agent_value: analyzeAgentValue({
      assembly: input.assembly,
      products: input.products ?? [],
      questionsResolved: {},
      evidenceByAgent: {},
    }),
    tool_history: toolEfficiencyHistory(input.toolRows ?? []),
    model_history: modelRoutingHistory(input.routes ?? []),
    corrections: input.corrections ?? [],
    strategy_recommendation: recommendStrategy({
      text: input.text,
      classifierStrategy: input.strategy,
      prior: input.prior ?? [],
    }).recommended,
    assembly_recommendation: recommendAssembly({
      base: input.assembly,
      prior: input.prior ?? [],
      strategy: input.strategy,
    }).seats,
    mission_diff: input.missionDiff ?? null,
    screening,
    wrim_eval_staged: staged?.staged === true,
    trains_wrim: false,
    counterfactual: input.experience ? counterfactualEval(input.experience, 'fewer_agents') : null,
    failure_clusters: clusterFailures(input.prior ?? (input.experience ? [input.experience] : [])),
    playbook,
    session: sessionAdaptation(input.text, input.sessionId),
    completion_review: review,
    reopen_count: reopen.reopen_count,
    replay_executable: false,
  }
}
