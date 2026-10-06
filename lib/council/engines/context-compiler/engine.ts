import { createEngineReceipt } from '../receipts'
import type { CompiledContext, CompiledFact, ContextCompilerInput } from './types'

function tokensOf(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function labelOf(fact: CompiledFact): CompiledFact['temporal_label'] {
  return fact.temporal_label ?? (fact.state === 'STALE' ? 'STALE' : fact.state === 'UNVERIFIED' ? 'UNVERIFIED' : 'CURRENT')
}

function neverUpgrade(facts: readonly CompiledFact[]): CompiledFact[] {
  return facts.map(fact => ({
    ...fact,
    state: fact.state === 'VERIFIED' || fact.state === 'SUPPORTED' || fact.state === 'CONFLICTING' || fact.state === 'STALE' || fact.state === 'UNVERIFIED'
      ? fact.state
      : 'UNVERIFIED',
    temporal_label: labelOf(fact),
  }))
}

export function compileContext(input: ContextCompilerInput): CompiledContext {
  const started = Date.now()
  const budget = Math.max(64, input.token_budget ?? 512)
  const excluded: string[] = []
  for (const foreign of input.foreign_mission_facts ?? []) {
    if (foreign.mission_id !== input.mission_id) excluded.push(`foreign:${foreign.mission_id}:${foreign.text.slice(0, 48)}`)
  }
  for (const line of input.history ?? []) {
    if (/unrelated|previous mission|other session/i.test(line)) excluded.push(`history:${line.slice(0, 48)}`)
  }

  const verified = neverUpgrade(input.verified_facts ?? []).filter(fact => fact.mission_id === input.mission_id)
  const supported = neverUpgrade(input.supported_facts ?? []).filter(fact => fact.mission_id === input.mission_id)
  const unverified = neverUpgrade(input.unverified_facts ?? []).filter(fact => fact.mission_id === input.mission_id)
  const memories = neverUpgrade(input.memory_facts ?? []).filter(fact => {
    if (fact.mission_id !== input.mission_id) {
      excluded.push(`foreign-memory:${fact.mission_id}:${fact.text.slice(0, 48)}`)
      return false
    }
    return true
  })

  const roleFacts: CompiledFact[] = []
  if (input.role === 'PULSAR') roleFacts.push(...verified, ...supported)
  else if (input.role === 'LUMEN') roleFacts.push(...verified, ...supported, ...unverified)
  else if (input.role === 'PHOENIX') roleFacts.push(...unverified, ...supported)
  else if (input.role === 'AURORA') roleFacts.push(...verified, ...supported)
  else if (input.role === 'ORION') roleFacts.push(...unverified, ...supported)
  else roleFacts.push(...verified)

  const prioritized: string[] = [
    `mission:${input.objective}`,
    `task:${input.task_objective}`,
    ...(input.authority ?? []).map(row => `authority:${row}`),
    ...(input.conflicts ?? []).map(row => `conflict:${row}`),
    ...verified.map(fact => `${labelOf(fact)}:verified:${fact.text}`),
    ...memories.map(fact => `${labelOf(fact)}:memory:${fact.text}`),
    ...(input.constraints ?? []).map(row => `constraint:${row}`),
    ...supported.map(fact => `${labelOf(fact)}:supported:${fact.text}`),
    ...(input.questions ?? []).map(row => `question:${row}`),
    ...(input.hypotheses ?? []).map(row => `hypothesis:${row}`),
    ...(input.tool_state ?? []).map(row => `tool:${row}`),
    ...(input.source_assessments ?? []).map(row => `assessment:${row}`),
    ...(input.work_products ?? []).map(row => `prior:${row}`),
    ...unverified.map(fact => `${labelOf(fact)}:unverified:${fact.text}`),
  ]

  const auroraSkip = /plan tree|tool econom|failure graph|selection_reason|replan history/i
  const kept: string[] = []
  let used = 0
  for (const item of prioritized) {
    const cost = tokensOf(item)
    if (input.role === 'AURORA' && auroraSkip.test(item)) {
      excluded.push(`aurora_internal:${item.slice(0, 48)}`)
      continue
    }
    if (used + cost > budget) {
      excluded.push(`budget:${item.slice(0, 48)}`)
      continue
    }
    kept.push(item)
    used += cost
  }

  if (input.role === 'LUMEN' || input.role === 'AURORA' || input.role === 'PULSAR') roleFacts.push(...memories.filter(fact => fact.state === 'VERIFIED' || fact.state === 'SUPPORTED'))
  const required = roleFacts.filter(fact => kept.some(item => item.includes(fact.text.slice(0, 24))) || fact.state === 'VERIFIED' || fact.state === 'CONFLICTING')
  const queryBits = input.role === 'PULSAR'
    ? kept.filter(item => /mission|task|authority|question|assessment/.test(item))
    : input.role === 'LUMEN'
      ? kept.filter(item => /verified|supported|unverified|conflict|assessment/.test(item))
      : input.role === 'PHOENIX'
        ? kept.filter(item => /unverified|conflict|question|hypothesis/.test(item))
        : input.role === 'AURORA'
          ? kept.filter(item => /verified|supported|conflict|mission/.test(item))
          : kept

  return {
    mission_summary: input.objective,
    task_objective: input.task_objective,
    required_facts: required.slice(0, 12),
    relevant_evidence_refs: [...new Set(required.map(fact => fact.evidence_ref).filter((id): id is string => Boolean(id)))],
    open_questions: input.role === 'PHOENIX' || input.role === 'ORION' || input.role === 'LUMEN' ? [...(input.questions ?? [])] : (input.role === 'AURORA' ? [] : [...(input.questions ?? [])].slice(0, 2)),
    conflicts: input.role === 'AURORA' || input.role === 'PHOENIX' || input.role === 'LUMEN' ? [...(input.conflicts ?? [])] : [],
    hypotheses: input.role === 'ORION' || input.role === 'PHOENIX' ? [...(input.hypotheses ?? [])] : [],
    constraints: [...(input.constraints ?? []), ...(input.authority ?? [])].slice(0, 8),
    tool_state: input.role === 'PULSAR' || input.role === 'ORION' ? [...(input.tool_state ?? [])] : [],
    authority_state: [...(input.authority ?? [])],
    prior_outputs: queryBits.filter(item => item.startsWith('prior:')).map(item => item.slice(6)),
    excluded_context: excluded,
    token_budget: budget,
    tokens_used: used,
    role: input.role,
    compiler_receipt: createEngineReceipt({
      engine: 'context-compiler',
      mission_id: input.mission_id,
      input_refs: [input.role, input.objective.slice(0, 80)],
      output_refs: required.map(fact => fact.evidence_ref || fact.state),
      started_at: started,
      decision_count: kept.length,
      decision: 'COMPILE',
    }),
  }
}

export function contextWouldUpgradeTruth(before: CompiledFact, after: CompiledFact): boolean {
  const rank = { UNVERIFIED: 0, STALE: 1, CONFLICTING: 1, SUPPORTED: 2, VERIFIED: 3 }
  return rank[after.state] > rank[before.state]
}

export function contextsDiffer(a: CompiledContext, b: CompiledContext): boolean {
  return a.role !== b.role
    || a.task_objective !== b.task_objective
    || a.open_questions.join('|') !== b.open_questions.join('|')
    || a.conflicts.join('|') !== b.conflicts.join('|')
    || a.hypotheses.join('|') !== b.hypotheses.join('|')
}
