import { estimateToolValue } from '@/lib/council/intelligence/toolValue'
import { lookupCapability } from '@/lib/council/intelligence/capabilityRegistry'
import { createEngineReceipt } from '../receipts'
import type { FailureClass, InformationGain, ToolCandidate, ToolHealth, ToolSelectionDecision, ToolSelectionInput } from './types'

const DEAD: ToolHealth[] = ['DEAD', 'UNAUTHENTICATED', 'MISCONFIGURED']
const TRANSIENT_RE = /timeout|rate.?limit|disconnect|ECONNRESET|temporar|503|429/i
const DETERMINISTIC_RE = /401|403|invalid configuration|auth(entication)? missing|policy.?denied|REJECT_OFF_TOPIC|REJECT_WRONG_AUTHORITY|file:\/\//i

export function classifyToolFailure(error: string | undefined): FailureClass {
  if (!error) return 'NONE'
  if (/authority|approval|DENY|BLOCKED_BY_AUTHORITY/i.test(error)) return 'AUTHORITY'
  if (DETERMINISTIC_RE.test(error)) return 'DETERMINISTIC'
  if (TRANSIENT_RE.test(error)) return 'TRANSIENT'
  return 'DETERMINISTIC'
}

export function informationGainForGap(input: {
  gap: string
  tool: string
  hint?: ToolSelectionInput['expected_information_gain_hint']
}): InformationGain {
  const gap = input.gap.toLowerCase()
  const tool = input.tool.toLowerCase()
  const researchTool = /research|broker|browser/.test(tool)
  const inspectTool = /health|ports|backend/.test(tool)
  if (/contradict/.test(gap) && researchTool) return 'HIGH'
  if (/fresh|stale|refresh/.test(gap) && researchTool) return 'HIGH'
  if (/authorit|primary|independent|source/.test(gap) && researchTool) return 'HIGH'
  if (/question|hypothesis/.test(gap) && inspectTool) return 'HIGH'
  if (/health|port|runtime|3847|3848/.test(gap) && inspectTool) return 'HIGH'
  if (input.hint === 'none') return 'NONE'
  if (input.hint === 'high' && researchTool && /primary|source|fresh|authorit/.test(gap)) return 'HIGH'
  if (input.hint === 'high' && inspectTool && /health|port|runtime/.test(gap)) return 'HIGH'
  const estimate = estimateToolValue({ tool: input.tool, question: { text: input.gap || 'probe' } })
  return estimate.expected_information_gain === 'HIGH' ? 'HIGH' : estimate.expected_information_gain === 'MED' ? 'MED' : 'LOW'
}

function gapFit(tool: string, gap: string): number {
  const g = gap.toLowerCase()
  const t = tool.toLowerCase()
  if (/primary|source|authorit|fresh|independent/.test(g) && /research|broker|browser/.test(t)) return 3
  if (/health|port|runtime|3847|3848/.test(g) && /health|ports|backend/.test(t)) return 3
  return 1
}

function healthOf(tool: string, map?: ToolSelectionInput['tool_health']): ToolHealth {
  return map?.[tool] ?? 'READY'
}

function isNoTool(input: ToolSelectionInput): { stop: boolean; reason: string; failure: ToolSelectionDecision['receipt']['failure_state'] } {
  if (input.current_verified_memory) {
    return { stop: true, reason: 'current verified memory already satisfies the evidence requirement', failure: 'no_tool_required' }
  }
  if (input.ebc_satisfied || input.stop_condition_state === 'EVIDENCE_REQUIREMENT_SATISFIED' || input.stop_condition_state === 'PRIMARY_PLUS_CORROBORATION') {
    return { stop: true, reason: 'EBC already satisfies the evidence requirement', failure: 'no_tool_required' }
  }
  if (!(input.remaining_evidence_gap ?? []).length && input.stop_condition_state && input.stop_condition_state !== 'CONTINUE') {
    return { stop: true, reason: 'no remaining evidence gap', failure: 'no_tool_required' }
  }
  if (input.cost_budget === 'EXHAUSTED' || input.stop_condition_state === 'TOOL_BUDGET_EXHAUSTED' || input.stop_condition_state === 'CANDIDATE_BUDGET_EXHAUSTED') {
    return { stop: true, reason: 'mission budget exhausted', failure: 'budget_exhausted' }
  }
  if (!input.available_tools.length) {
    return { stop: true, reason: 'required evidence cannot be obtained with available tools', failure: 'no_tool_required' }
  }
  return { stop: false, reason: '', failure: 'none' }
}

export function buildToolCandidate(tool: string, input: ToolSelectionInput): ToolCandidate {
  const cap = lookupCapability(tool) ?? lookupCapability(input.tool_capabilities?.[tool] ?? '')
  const estimate = estimateToolValue({ tool, question: { text: input.objective } })
  const health = healthOf(tool, input.tool_health)
  const previous = (input.previous_attempts ?? []).filter(row => row.tool_id === tool)
  const gain = informationGainForGap({
    gap: (input.remaining_evidence_gap ?? [])[0] || input.objective,
    tool,
    hint: input.expected_information_gain_hint,
  })
  const duplicate = (input.previous_attempts ?? []).some(row => row.tool_id === tool && row.failure_class === 'NONE')
  return {
    tool_id: tool,
    capability: cap?.capability_id || tool,
    provider: cap?.version_provider || cap?.system || 'indexed',
    availability: health !== 'DEAD' && health !== 'MISCONFIGURED' && health !== 'UNAUTHENTICATED',
    health,
    authority_required: estimate.authority === 'REQUIRE_APPROVAL' || estimate.authority === 'DENY',
    expected_information_gain: gain,
    expected_latency: estimate.latency,
    expected_cost: estimate.cost,
    freshness_value: input.freshness_requirement ? 'CURRENT' : 'UNKNOWN',
    reliability: Math.max(0, 1 - previous.filter(row => row.failure_class !== 'NONE').length * 0.35),
    privacy_class: cap?.secret_access ? 'SECRET_ACCESS' : cap?.local_or_external === 'external' ? 'EXTERNAL_READ' : 'LOCAL',
    failure_history: previous.map(row => row.error || row.failure_class),
    duplicate_information_risk: duplicate,
    selection_reason: `${gain} information gain for ${(input.remaining_evidence_gap ?? ['objective'])[0]}`,
    economics: {
      expected_information_gain: gain,
      latency: estimate.latency,
      cost: estimate.cost,
      reliability: Math.max(0, 1 - previous.length * 0.35),
      freshness: input.freshness_requirement ? 'CURRENT' : 'UNKNOWN',
      privacy: cap?.secret_access ? 'SECRET_ACCESS' : cap?.local_or_external === 'external' ? 'EXTERNAL_READ' : 'LOCAL',
      authority: estimate.authority,
    },
  }
}

export function selectTool(input: ToolSelectionInput): ToolSelectionDecision {
  const started = Date.now()
  const remaining_evidence_gap = input.stale_freshness_gap
    ? [...new Set([...(input.remaining_evidence_gap ?? []), 'stale evidence refresh required'])]
    : input.remaining_evidence_gap
  const resolved = { ...input, remaining_evidence_gap, ebc_satisfied: input.stale_freshness_gap ? false : input.ebc_satisfied }
  const gated = isNoTool(resolved)
  const candidates = input.available_tools.map(tool => buildToolCandidate(tool, resolved))
  const avoid: ToolSelectionDecision['avoid'] = []
  if (gated.stop) {
    for (const row of candidates) avoid.push({ tool_id: row.tool_id, avoid_reason: gated.reason })
    return {
      selected_tool: null,
      decision: 'NO_TOOL_REQUIRED',
      alternate_tools: [],
      reason: gated.reason,
      evidence_gap_targeted: [...(remaining_evidence_gap ?? [])],
      expected_information_gain: 'NONE',
      budget_allocation: { latency: input.latency_budget ?? 'LOW', cost: input.cost_budget ?? 'LOW' },
      fallback_policy: 'stop honestly',
      stop_after_success: true,
      retry: { allowed: false, remaining: 0, failure_class: 'NONE' },
      avoid,
      candidates,
      receipt: createEngineReceipt({
        engine: 'tool-selection',
        mission_id: input.mission_id,
        task_id: input.task_id,
        input_refs: input.available_tools,
        output_refs: ['NO_TOOL_REQUIRED'],
        started_at: started,
        decision_count: candidates.length,
        decision: 'NO_TOOL_REQUIRED',
        failure_state: gated.failure,
      }),
    }
  }

  const last = input.previous_attempts?.at(-1)
  const lastClass = last ? (last.failure_class !== 'NONE' ? last.failure_class : classifyToolFailure(last.error)) : 'NONE'
  const lastTries = (input.previous_attempts ?? []).filter(row => row.tool_id === last?.tool_id).length

  for (const row of candidates) {
    if (DEAD.includes(row.health)) avoid.push({ tool_id: row.tool_id, avoid_reason: `tool health ${row.health}; will not route into a dead path` })
    else if (row.economics.authority === 'DENY') avoid.push({ tool_id: row.tool_id, avoid_reason: 'authority does not permit the action' })
    else if (row.duplicate_information_risk) avoid.push({ tool_id: row.tool_id, avoid_reason: 'another call would provide duplicate information' })
    else if (input.known_failures?.includes(row.tool_id) && lastClass === 'DETERMINISTIC') avoid.push({ tool_id: row.tool_id, avoid_reason: 'deterministic failure will not change outcome on retry' })
    else if (lastClass === 'DETERMINISTIC' && last?.tool_id === row.tool_id) avoid.push({ tool_id: row.tool_id, avoid_reason: 'deterministic failure will not change outcome on retry' })
    else if (lastClass === 'TRANSIENT' && last?.tool_id === row.tool_id && lastTries >= 2) avoid.push({ tool_id: row.tool_id, avoid_reason: 'transient retry budget exhausted; use alternate authoritative tool' })
  }

  const blocked = new Set(avoid.map(row => row.tool_id))
  const usable = candidates.filter(row => !blocked.has(row.tool_id) && row.availability)
  usable.sort((a, b) => {
    const gain = { HIGH: 3, MED: 2, LOW: 1, NONE: 0 }
    if (gain[b.expected_information_gain] !== gain[a.expected_information_gain]) return gain[b.expected_information_gain] - gain[a.expected_information_gain]
    const gap = (input.remaining_evidence_gap ?? [input.objective])[0] || input.objective
    const fit = gapFit(b.tool_id, gap) - gapFit(a.tool_id, gap)
    if (fit) return fit
    if (a.authority_required !== b.authority_required) return a.authority_required ? 1 : -1
    return b.reliability - a.reliability
  })

  if (!usable.length) {
    return {
      selected_tool: null,
      decision: 'TOOL_BLOCKED',
      alternate_tools: [],
      reason: avoid[0]?.avoid_reason || 'no healthy permitted tool remains',
      evidence_gap_targeted: [...(remaining_evidence_gap ?? [])],
      expected_information_gain: 'NONE',
      budget_allocation: { latency: input.latency_budget ?? 'LOW', cost: input.cost_budget ?? 'LOW' },
      fallback_policy: 'truthful TOOL_BLOCKED / insufficient evidence',
      stop_after_success: true,
      retry: { allowed: false, remaining: 0, failure_class: lastClass },
      avoid,
      candidates,
      receipt: createEngineReceipt({
        engine: 'tool-selection',
        mission_id: input.mission_id,
        task_id: input.task_id,
        input_refs: input.available_tools,
        output_refs: ['TOOL_BLOCKED'],
        started_at: started,
        decision_count: candidates.length,
        decision: 'TOOL_BLOCKED',
        failure_state: avoid.some(row => /health/.test(row.avoid_reason)) ? 'tool_unhealthy' : 'authority_blocked',
      }),
    }
  }

  const selected = lastClass === 'TRANSIENT' && lastTries < 2 && last?.tool_id
    ? (usable.find(row => row.tool_id === last.tool_id) ?? usable[0])
    : usable[0]
  const retryAllowed = lastClass === 'TRANSIENT' && lastTries < 2 && last?.tool_id === selected.tool_id
  const fallback = lastClass === 'TRANSIENT'
    ? 'retry bounded once, then alternate authoritative tool, then truthful TOOL_BLOCKED'
    : 'alternate authoritative tool, never silently substitute a lower-authority source'
  return {
    selected_tool: selected.tool_id,
    decision: 'SELECT',
    alternate_tools: usable.slice(1).map(row => row.tool_id),
    reason: selected.selection_reason,
    evidence_gap_targeted: [...(remaining_evidence_gap ?? [])],
    expected_information_gain: selected.expected_information_gain,
    budget_allocation: { latency: selected.expected_latency, cost: selected.expected_cost },
    fallback_policy: fallback,
    stop_after_success: true,
    retry: { allowed: retryAllowed, remaining: retryAllowed ? 1 : 0, failure_class: lastClass },
    avoid,
    candidates,
    receipt: createEngineReceipt({
      engine: 'tool-selection',
      mission_id: input.mission_id,
      task_id: input.task_id,
      input_refs: input.available_tools,
      output_refs: [selected.tool_id],
      started_at: started,
      decision_count: candidates.length,
      decision: 'SELECT',
    }),
  }
}

export function shouldRetryTool(input: { failure_class: FailureClass; attempts: number }): boolean {
  if (input.failure_class !== 'TRANSIENT') return false
  return input.attempts < 2
}
