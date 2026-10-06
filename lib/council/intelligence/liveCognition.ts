/**
 * Live cognitive runtime. Makes INTEL-02 structures drive live EBC work.
 * Does not replace EBC. Does not grant authority. Does not store chain-of-thought.
 */

import type { EbcAgentId, EbcMissionResult } from '@/lib/council/evidence-board/types'
import { assembleCouncil } from './assembly'
import { initBudget, budgetAllowsOptional } from './budget'
import { packetsDiffer } from './contextPacket'
import { applyHypothesisEvidence, generateHypotheses } from './hypothesis'
import { amendMissionContract } from './missionContract'
import type { ReplanTrigger } from './replan'
import { buildQuestionGraph, prioritizeBlocking } from './questionGraph'
import { selectCognitiveStrategy } from './strategy'
import { estimateToolValue, pickHighInformationProbes } from './toolValue'
import { persistLiveMission } from './orchestrationStore'
import type {
  ContextPacket,
  CouncilWorkProduct,
  LearningRecord,
  MissionReplay,
  PhoenixSchedule,
  SentinelCheckpoint,
  ToolDecisionRecord,
  WorkProductEdge,
} from './orchestrationTypes'
import type { IntelligenceRouting, MissionContractV1, AtlasPlanGraph } from './types'

export const ALTERNATE_TOOLS: Record<string, string> = {
  'broker.fetch': 'wr.broker.status',
  'browser.navigate': 'broker.fetch',
  'browser.screenshot': 'wr.broker.status',
  'wr.core.health': 'wr.ui.health',
}

export type LiveEbcHooks = {
  forceUnavailable?: string[]
  packetQuery?: Partial<Record<EbcAgentId, string>>
  maxToolsPerTask?: number
  skipOptionalPhoenix?: boolean
  verifyOnlyMaterial?: boolean
  maxConcurrentWorkers?: number
  maxLocalModelWorkers?: number
}

export type LivePrep = {
  strategy: ReturnType<typeof selectCognitiveStrategy>
  contract: MissionContractV1
  questions: ReturnType<typeof buildQuestionGraph>
  hypotheses: ReturnType<typeof generateHypotheses>
  packets: ContextPacket[]
  tool_decisions: ToolDecisionRecord[]
  hooks: LiveEbcHooks
  phoenix: PhoenixSchedule
  sentinel_checkpoints: SentinelCheckpoint[]
  replanTrigger: ReplanTrigger | null
  unavailableTool: string | null
}

const TOOL_BY_QUESTION: Array<{ match: RegExp; tool: string }> = [
  { match: /chromium launching/i, tool: 'wr.broker.status' },
  { match: /\/tmp writable|quota/i, tool: 'wr.broker.status' },
  { match: /profile/i, tool: 'wr.broker.status' },
  { match: /giant dom|pixel/i, tool: 'wr.broker.status' },
  { match: /3847|3848|install/i, tool: 'wr.ports.list' },
  { match: /primary sources|current /i, tool: 'broker.fetch' },
  { match: /health/i, tool: 'wr.core.health' },
]

export function parseLiveHarness(text: string): {
  unavailableTool: string | null
  injectedConflicts: Array<{ claim: string; evidenceA: string[]; evidenceB: string[] }>
} {
  const unavailableTool = /\bforce one planned safe tool unavailable\b/i.test(text)
    || /\bLIVE_HARNESS\s+tool_block=/i.test(text)
    ? (/tool_block=([a-z0-9.]+)/i.exec(text)?.[1] ?? 'broker.fetch')
    : null
  const injectedConflicts = /\binject two contradictory(?: safe evidence sources)?\b/i.test(text)
    || /\bLIVE_HARNESS\s+conflict\b/i.test(text)
    ? [{
      claim: 'Chromium is launching',
      evidenceA: ['src-a:chromium-launching'],
      evidenceB: ['src-b:chromium-not-launching'],
    }]
    : []
  return { unavailableTool, injectedConflicts }
}

export function detectCommanderAmendment(text: string): string | null {
  const m = /\bchange the priority:\s*(.+)$/i.exec(text.trim())
    ?? /\bamend(?:ment)?:\s*(.+)$/i.exec(text.trim())
  return m?.[1]?.trim() || null
}

export function shouldInvokeJanusLive(strategyId: string, budgetAllows: boolean): boolean {
  if (['COMPARE', 'DESIGN'].includes(strategyId)) return true
  if (!budgetAllows) return false
  return ['SIMULATE', 'DEBATE'].includes(strategyId)
}

export function shouldInvokePhoenixLive(input: {
  strategyId: string
  budget: 'FAST' | 'STANDARD' | 'DEEP' | 'MAXIMUM'
  evidenceThin: boolean
  conflicts: number
  highImpact: boolean
}): PhoenixSchedule {
  if (input.strategyId === 'DIRECT') {
    return { invoked: false, reason: 'DIRECT does not invoke PHOENIX', claim_ids: [], what_changed: null }
  }
  if (input.budget === 'FAST' && !input.conflicts && !input.highImpact) {
    return { invoked: false, reason: 'FAST budget skipped optional PHOENIX', claim_ids: [], what_changed: null }
  }
  const invoked = input.conflicts > 0 || input.evidenceThin || input.highImpact || input.strategyId === 'DESIGN' || input.strategyId === 'REVIEW'
  return {
    invoked,
    reason: invoked
      ? (input.conflicts ? 'material conflict' : input.evidenceThin ? 'thin evidence' : 'high-impact / architecture')
      : 'no high-impact thin claim',
    claim_ids: [],
    what_changed: invoked ? 'challenge scheduled before synthesis' : null,
  }
}

export function buildLivePackets(input: {
  contract: MissionContractV1
  questions: ReturnType<typeof buildQuestionGraph>
  hypotheses: ReturnType<typeof generateHypotheses>
  products?: readonly CouncilWorkProduct[]
  kgNodeIds?: string[]
  seats: readonly string[]
}): ContextPacket[] {
  const authority = [
    `commit=${input.contract.authority.commit}`,
    `push=${input.contract.authority.push}`,
    `deploy=${input.contract.authority.production_deploy}`,
  ]
  const products = input.products ?? []
  const seats = [...new Set([...input.seats, 'AURORA'])]
  return seats.map(agent => {
    const qs = input.questions.questions.filter(q =>
      agent === 'AURORA' ? q.blocking : q.assigned_role === agent,
    )
    const hyps = agent === 'ORION' || agent === 'AURORA' ? input.hypotheses.map(h => `${h.id}:${h.status}`) : []
    const prior = products.filter(p => {
      if (agent === 'LUMEN') return p.type === 'INVESTIGATION' || p.type === 'RESEARCH' || p.type === 'DATA_ANALYSIS'
      if (agent === 'PHOENIX') return p.type === 'VERIFICATION' || p.type === 'INVESTIGATION'
      if (agent === 'AURORA') return p.type === 'SCENARIO' || p.type === 'RISK' || p.type === 'VERIFICATION' || p.type === 'CHALLENGE'
      if (agent === 'ORION') return p.type === 'RESEARCH'
      return false
    })
    const query = agent === 'PULSAR'
      ? `primary sources: ${input.contract.objective}`
      : agent === 'ORION'
        ? (qs[0]?.text || `investigate: ${input.contract.objective}`)
        : agent === 'LUMEN'
          ? 'verify material claims against evidence ids only'
          : agent === 'PHOENIX'
            ? 'challenge thin high-impact claims only'
            : input.contract.objective
    return {
      agent: agent as ContextPacket['agent'],
      mission_objective: input.contract.objective,
      task_id: `live-${agent}`,
      task_objective: qs[0]?.text || `${agent} contribution`,
      constraints: [...input.contract.explicit_exclusions, ...input.contract.constraints].slice(0, 8),
      evidence_refs: [...new Set(prior.flatMap(p => p.evidence_refs))],
      prior_work_product_ids: prior.map(p => p.work_product_id),
      kg_node_ids: agent === 'AURORA' || agent === 'ORION' ? [...(input.kgNodeIds ?? [])] : [],
      unresolved_questions: qs.filter(q => q.answer_state === 'OPEN').map(q => q.text),
      hypotheses: hyps,
      authority,
      temporal_scope: 'CURRENT',
      query,
    }
  })
}

export function routeWorkProducts(products: readonly CouncilWorkProduct[]): WorkProductEdge[] {
  const edges: WorkProductEdge[] = []
  for (const p of products) {
    if (p.type === 'RESEARCH') {
      edges.push({ from: p.agent, to: 'LUMEN', product_id: p.work_product_id, reason: 'verify sources' })
      edges.push({ from: p.agent, to: 'ORION', product_id: p.work_product_id, reason: 'mechanism analysis' })
    } else if (p.type === 'INVESTIGATION') {
      edges.push({ from: p.agent, to: 'LUMEN', product_id: p.work_product_id, reason: 'evidence check' })
      edges.push({ from: p.agent, to: 'PHOENIX', product_id: p.work_product_id, reason: 'challenge if thin' })
    } else if (p.type === 'DATA_ANALYSIS') {
      edges.push({ from: p.agent, to: 'LUMEN', product_id: p.work_product_id, reason: 'validate structure' })
      edges.push({ from: p.agent, to: 'AURORA', product_id: p.work_product_id, reason: 'synthesis input' })
    } else if (p.type === 'VERIFICATION' || p.type === 'CHALLENGE' || p.type === 'SCENARIO' || p.type === 'RISK') {
      edges.push({ from: p.agent, to: 'AURORA', product_id: p.work_product_id, reason: 'grounded synthesis' })
    }
  }
  return edges
}

export function decideLiveTools(input: {
  taskTools: readonly string[]
  owner: EbcAgentId
  questions: ReturnType<typeof buildQuestionGraph>
  budget: 'FAST' | 'STANDARD' | 'DEEP' | 'MAXIMUM'
  forceUnavailable?: string[]
}): { tools: string[]; decisions: ToolDecisionRecord[] } {
  const blocking = prioritizeBlocking(input.questions)
  const mapped = blocking.flatMap(q => {
    const hit = TOOL_BY_QUESTION.find(row => row.match.test(q.text))
    return hit ? [estimateToolValue({ tool: hit.tool, question: q })] : []
  })
  const fromTask = input.taskTools.map(tool => estimateToolValue({
    tool,
    question: blocking[0] ?? { text: input.owner },
  }))
  const ranked = pickHighInformationProbes([...mapped, ...fromTask], input.budget === 'FAST' ? 1 : input.budget === 'MAXIMUM' ? 4 : 2)
  const decisions: ToolDecisionRecord[] = []
  const tools: string[] = []
  const seen = new Set<string>()
  for (const row of ranked) {
    if (seen.has(row.tool)) continue
    seen.add(row.tool)
    if (input.forceUnavailable?.includes(row.tool)) {
      const alt = ALTERNATE_TOOLS[row.tool] ?? null
      decisions.push({ tool: row.tool, chosen: false, reason: 'TOOL_BLOCKED / unavailable', question: row.question, alternate: alt })
      if (alt && !seen.has(alt)) {
        seen.add(alt)
        tools.push(alt)
        decisions.push({ tool: alt, chosen: true, reason: 'alternate after TOOL_BLOCKED', question: row.question })
      }
      continue
    }
    if (row.authority === 'DENY') {
      decisions.push({ tool: row.tool, chosen: false, reason: 'authority DENY', question: row.question })
      continue
    }
    tools.push(row.tool)
    decisions.push({ tool: row.tool, chosen: true, reason: `gain=${row.expected_information_gain}`, question: row.question })
  }
  if (!tools.length && input.taskTools.length && !input.forceUnavailable?.includes(input.taskTools[0])) {
    tools.push(input.taskTools[0])
    decisions.push({ tool: input.taskTools[0], chosen: true, reason: 'required fallback', question: blocking[0]?.text ?? '' })
  }
  for (const blocked of input.forceUnavailable ?? []) {
    if (!decisions.some(d => d.tool === blocked && !d.chosen)) {
      const alt = ALTERNATE_TOOLS[blocked] ?? null
      decisions.push({ tool: blocked, chosen: false, reason: 'TOOL_BLOCKED / unavailable', question: blocking[0]?.text ?? '', alternate: alt })
      if (alt && !seen.has(alt) && !input.forceUnavailable?.includes(alt)) {
        seen.add(alt)
        tools.push(alt)
        decisions.push({ tool: alt, chosen: true, reason: 'alternate after TOOL_BLOCKED', question: blocking[0]?.text ?? '' })
      }
    }
  }
  return { tools, decisions }
}

export function markDependencyFailure(status: 'WAITING' | 'BLOCKED' | 'REPLAN_REQUIRED', failed: boolean): typeof status | 'READY' {
  if (!failed) return 'READY'
  return status
}

export function evidenceEnough(input: {
  required: Array<{ evidence_type: string; minimum_sources: number }>
  kinds: readonly string[]
  okCount: number
}): boolean {
  if (!input.required.length) return true
  return input.required.every(req => {
    if (req.evidence_type === 'primary_external') return input.kinds.filter(k => k === 'primary_external').length >= req.minimum_sources
    if (req.evidence_type === 'live_telemetry') return input.kinds.includes('live_telemetry') || input.okCount > 0
    return input.okCount >= req.minimum_sources
  })
}

export function composeIncompleteAurora(input: {
  completion: 'COMPLETE' | 'PARTIALLY_COMPLETE' | 'BLOCKED' | 'NEEDS_MORE_EVIDENCE' | 'NEEDS_COMMANDER' | 'FAILED'
  brief: string
  missing?: string
  blocker?: string
}): string {
  if (input.completion === 'COMPLETE') return input.brief
  if (input.completion === 'NEEDS_MORE_EVIDENCE') {
    return `${input.brief}\nStill missing: ${input.missing || 'required evidence for blocking questions'}.`
  }
  if (input.completion === 'BLOCKED') {
    return `${input.brief}\nBlocked: ${input.blocker || 'SENTINEL or authority gate'}.`
  }
  if (input.completion === 'NEEDS_COMMANDER') {
    return `${input.brief}\nCommander decision required: ${input.blocker || 'authority or scope amendment'}.`
  }
  if (input.completion === 'PARTIALLY_COMPLETE') {
    return `${input.brief}\nPartial: useful result above; remaining gap: ${input.missing || 'verification or evidence'}.`
  }
  return `${input.brief}\nFailed: ${input.blocker || 'task failure'}.`
}

export function prepareLiveCognition(input: {
  text: string
  contract: MissionContractV1
  routing: IntelligenceRouting
  plan: AtlasPlanGraph | null
  forceUnavailable?: string | null
  amendment?: string | null
  injectedConflicts?: number
}): LivePrep {
  let contract = input.contract
  const amendment = input.amendment ?? detectCommanderAmendment(input.text)
  if (amendment) {
    const amended = amendMissionContract(contract, {
      reason: `Commander amended: ${amendment}`,
      changes: { constraints: [...contract.constraints, amendment], objective: `${contract.objective} [priority: ${amendment}]` },
      executionStarted: true,
    })
    contract = amended.contract
  }
  const strategy = selectCognitiveStrategy({
    text: input.text,
    intelligenceClass: input.routing.intelligence_class,
    ebcClass: input.routing.ebc_mission_class,
  })
  const budget = initBudget(input.text, strategy)
  const questions = buildQuestionGraph({ contract, strategy, text: input.text })
  const hypotheses = strategy.id === 'DIAGNOSE' || strategy.id === 'INCIDENT_RESPONSE' ? generateHypotheses(input.text) : []
  const assembly = assembleCouncil({
    contract,
    strategy,
    routing: input.routing,
    text: input.text,
    budget: budget.budget,
    evidenceThin: true,
    conflictProbability: (input.injectedConflicts ?? 0) > 0 ? 'high' : 'low',
  })
  const packets = buildLivePackets({
    contract,
    questions,
    hypotheses,
    seats: assembly.selected_seats,
  })
  const packetQuery: Partial<Record<EbcAgentId, string>> = {}
  for (const packet of packets) {
    if (packet.query && (packet.agent === 'ORION' || packet.agent === 'PULSAR' || packet.agent === 'LUMEN' || packet.agent === 'NOVA')) {
      packetQuery[packet.agent] = packet.query
    }
  }
  const phoenix = shouldInvokePhoenixLive({
    strategyId: strategy.id,
    budget: budget.budget,
    evidenceThin: true,
    conflicts: input.injectedConflicts ?? 0,
    highImpact: strategy.id === 'DESIGN' || strategy.id === 'REVIEW',
  })
  const forceUnavailable = input.forceUnavailable ? [input.forceUnavailable] : []
  const sentinel_checkpoints: SentinelCheckpoint[] = [
    { at: 'plan', action: 'CONTINUE', grants_authority: false },
  ]
  if (input.forceUnavailable) sentinel_checkpoints.push({ at: 'tool_proposal', action: 'REPLAN', grants_authority: false })
  if (amendment) sentinel_checkpoints.push({ at: 'replan', action: 'CONTINUE', grants_authority: false })
  return {
    strategy,
    contract,
    questions,
    hypotheses,
    packets,
    tool_decisions: [],
    hooks: {
      forceUnavailable,
      packetQuery,
      maxToolsPerTask: budget.budget === 'FAST' ? 1 : budget.budget === 'MAXIMUM' ? 4 : 2,
      skipOptionalPhoenix: !phoenix.invoked || !budgetAllowsOptional(budget.budget, 'phoenix'),
      verifyOnlyMaterial: budget.budget === 'FAST' || strategy.verification_depth !== 'FULL',
      maxConcurrentWorkers: budget.budget === 'FAST' ? 2 : 3,
      maxLocalModelWorkers: 1,
    },
    phoenix,
    sentinel_checkpoints,
    replanTrigger: amendment ? 'COMMANDER_AMENDS' : input.forceUnavailable ? 'TOOL_UNAVAILABLE' : null,
    unavailableTool: input.forceUnavailable ?? null,
  }
}

export function finalizeLiveCognition(input: {
  prep: LivePrep
  ebc: EbcMissionResult | null
  products: readonly CouncilWorkProduct[]
  calls?: Array<{ tool_name: string; ok: boolean }>
}): {
  packets: ContextPacket[]
  edges: WorkProductEdge[]
  hypotheses: ReturnType<typeof applyHypothesisEvidence>
  questions: ReturnType<typeof buildQuestionGraph>
  tool_decisions: ToolDecisionRecord[]
  packets_differ: boolean
} {
  const evidenceTexts = (input.ebc?.board.evidence ?? []).map(row => row.summary)
  const hypotheses = applyHypothesisEvidence(input.prep.hypotheses, evidenceTexts)
  const openQs = input.prep.questions.questions.map(q => {
    const answered = evidenceTexts.some(text => text.toLowerCase().includes(q.text.slice(0, 12).toLowerCase()))
      || (q.required_evidence.includes('primary_external') && (input.ebc?.board.evidence.some(e => e.kind === 'primary_external' && e.ok) ?? false))
      || (q.required_evidence.includes('live_telemetry') && (input.ebc?.board.evidence.some(e => e.kind === 'live_telemetry' && e.ok) ?? false))
      || (q.required_evidence.includes('tool_result') && (input.ebc?.board.evidence.some(e => e.ok) ?? false))
    return { ...q, answer_state: answered ? 'ANSWERED' as const : q.answer_state }
  })
  const questions = { mission_id: input.prep.questions.mission_id, questions: openQs }
  const packets = buildLivePackets({
    contract: input.prep.contract,
    questions,
    hypotheses,
    products: input.products,
    seats: [...new Set(input.products.map(p => p.agent).concat(input.prep.packets.map(p => p.agent)))],
  })
  const blocked = (input.calls ?? []).filter(c => !c.ok)
  const extraDecisions: ToolDecisionRecord[] = blocked.map(c => ({
    tool: c.tool_name,
    chosen: false,
    reason: 'TOOL_BLOCKED',
    question: 'live worker',
    alternate: ALTERNATE_TOOLS[c.tool_name] ?? null,
  }))
  return {
    packets,
    edges: routeWorkProducts(input.products),
    hypotheses,
    questions,
    tool_decisions: [...input.prep.tool_decisions, ...extraDecisions],
    packets_differ: packetsDiffer(packets),
  }
}

export function buildLearningAndReplay(input: {
  missionId: string
  sessionId: string | null
  strategy: string
  assembly: string[]
  taskIds: string[]
  parallel: string[][]
  tool_decisions: ToolDecisionRecord[]
  replans: number
  conflicts: number
  risks: number
  completion: LearningRecord['completion_quality']
  latency_ms: number
  findings: string[]
}): { learning: LearningRecord; replay: MissionReplay } {
  const learning: LearningRecord = {
    schema: 'war-room.orchestration-learning.v1',
    mission_id: input.missionId,
    mission_class: input.strategy,
    strategy: input.strategy as LearningRecord['strategy'],
    assembly: input.assembly,
    task_topology: input.taskIds,
    successful_steps: input.taskIds.filter(id => !/fail|block/i.test(id)),
    failed_steps: input.tool_decisions.filter(d => !d.chosen).map(d => d.tool),
    replans: input.replans,
    tool_efficiency: `${input.tool_decisions.filter(d => d.chosen).length}/${Math.max(1, input.tool_decisions.length)} chosen`,
    verification_efficiency: 'material-first',
    conflict_resolution: input.conflicts ? 'preserved_unresolved_or_discriminating' : 'none',
    latency_ms: input.latency_ms,
    completion_quality: input.completion,
    evaluation_findings: input.findings,
    trains_wrim: false,
    auto_ingest: false,
  }
  const replay: MissionReplay = {
    schema: 'war-room.orchestration-replay.v1',
    mission_id: input.missionId,
    session_id: input.sessionId,
    executable: false,
    strategy: input.strategy as MissionReplay['strategy'],
    assembly: input.assembly,
    task_order: input.taskIds,
    parallel_groups: input.parallel,
    tool_decisions: input.tool_decisions,
    replans: input.replans,
    conflicts: input.conflicts,
    risks: input.risks,
    completion: input.completion,
    evaluation: input.findings[0] ?? null,
  }
  return { learning, replay }
}

export async function persistLiveIfEnabled(record: Parameters<typeof persistLiveMission>[0]): Promise<boolean> {
  try {
    await persistLiveMission(record)
    return true
  } catch {
    return false
  }
}

void persistLiveIfEnabled
