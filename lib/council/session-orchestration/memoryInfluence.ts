import { isPriorContextDecreeRelevant } from '@/lib/council/contextRelevance'
import type { MemoryRecordRow } from '@/lib/context-assembler/types'
import type { AssembleInfluencePolicy, MemoryInfluenceDecision } from './types'

const STANDING_TYPES = new Set([
  'operator_preference',
  'safety_policy',
  'architecture_decision',
  'routing_correction',
])

const LOW_INFLUENCE_PLAN_SHAPE =
  /\b(?:plan|opportunity|relocation|visa|passport|taxation|property\s+law|logistics\s+checklist)\b/i

/**
 * RETENTION ≠ INFLUENCE. Durable rows stay in the store; they enter Council context only when
 * this gate returns include:true.
 */
export function decideMemoryInfluence(
  row: MemoryRecordRow,
  policy: AssembleInfluencePolicy,
): MemoryInfluenceDecision {
  if (!policy.allowDurableMemory) {
    return { include: false, reason: 'durable_memory_not_allowed_for_turn', memoryId: row.id, layer: 'durable_memory' }
  }

  if (policy.depth === 'FAST') {
    return { include: false, reason: 'fast_turn_no_durable_memory', memoryId: row.id, layer: 'durable_memory' }
  }

  const standing = STANDING_TYPES.has(row.memory_type)
  if (standing && policy.intent !== 'GREETING' && policy.intent !== 'STATUS_CHECK') {
    return { include: true, reason: 'standing_instruction_type', memoryId: row.id, layer: 'standing_instructions' }
  }

  if (policy.intent === 'EXPLICIT_MEMORY') {
    const relevant = isPriorContextDecreeRelevant(policy.commanderText, row.content)
    return {
      include: relevant,
      reason: relevant ? 'explicit_memory_ask_relevant' : 'explicit_memory_ask_not_relevant',
      memoryId: row.id,
      layer: 'durable_memory',
    }
  }

  if (LOW_INFLUENCE_PLAN_SHAPE.test(row.content) && policy.intent !== 'STRATEGIC_ANALYSIS') {
    const explicitTopic = isPriorContextDecreeRelevant(policy.commanderText, row.content)
    return {
      include: explicitTopic && policy.commanderText.length > 40,
      reason: explicitTopic ? 'plan_memory_topic_overlap' : 'plan_opportunity_low_default_influence',
      memoryId: row.id,
      layer: 'durable_memory',
    }
  }

  const relevant = isPriorContextDecreeRelevant(policy.commanderText, row.content)
  if (!relevant) {
    return { include: false, reason: 'not_relevant_to_current_turn', memoryId: row.id, layer: 'durable_memory' }
  }
  if (policy.intent === 'KNOWLEDGE_QUESTION' && !tokenOverlapStrong(policy.commanderText, row.content)) {
    return { include: false, reason: 'knowledge_question_requires_strong_overlap', memoryId: row.id, layer: 'durable_memory' }
  }
  return {
    include: true,
    reason: 'semantic_or_keyword_relevance',
    memoryId: row.id,
    layer: 'durable_memory',
  }
}

function tokenOverlapStrong(decree: string, memory: string): boolean {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 4),
    )
  const a = words(decree)
  const b = words(memory)
  if (a.size === 0 || b.size === 0) return false
  let n = 0
  for (const w of a) if (b.has(w)) n += 1
  return n >= 2
}

export function filterMemoriesForInfluence(
  rows: MemoryRecordRow[],
  policy: AssembleInfluencePolicy,
): { included: MemoryRecordRow[]; decisions: MemoryInfluenceDecision[] } {
  const decisions = rows.map(row => decideMemoryInfluence(row, policy))
  const includedIds = new Set(decisions.filter(d => d.include).map(d => d.memoryId))
  return { included: rows.filter(r => includedIds.has(r.id)), decisions }
}
