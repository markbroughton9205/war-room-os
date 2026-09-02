import { classifyCouncilTurn } from './turnIntent'
import { filterMemoriesForInfluence } from './memoryInfluence'
import { generateNeutralSessionTitle } from './sessionTitle'
import { expandResearchQuery } from './queryDecompose'
import { stageFromDeliberationRole, stageFromPersistedMetadata } from './messageStage'
import type { AssembleInfluencePolicy } from './types'

const GENERIC_OVERLAP_WORDS = new Set([
  'council',
  'family',
  'chatgpt',
  'claude',
  'gemini',
  'going',
  'whats',
  'what',
  'about',
  'status',
  'please',
  'commander',
])

/**
 * Cross-session isolation: a new session must not inherit another session's transcript,
 * synthesis, or opportunity state. Durable memory may be stored but is not auto-injected.
 */
export function assertNewSessionIsolation(input: {
  sessionIdA: string
  sessionIdB: string
  historyForB: string[]
  durableMemoryStored: boolean
  durableMemoryInjected: boolean
}): { pass: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (input.sessionIdA === input.sessionIdB) reasons.push('session_ids_not_distinct')
  if (input.historyForB.length > 0) reasons.push('new_session_inherited_history')
  if (input.durableMemoryInjected) reasons.push('durable_memory_auto_injected')
  if (!input.durableMemoryStored) reasons.push('durable_memory_must_remain_stored')
  return { pass: reasons.length === 0, reasons }
}

export function sessionHistoryContainsTopic(history: string[], topic: string): boolean {
  const needle = topic.toLowerCase()
  return history.some(line => line.toLowerCase().includes(needle))
}

export function buildAssemblePolicyForTurn(commanderText: string, extras?: Partial<AssembleInfluencePolicy>): AssembleInfluencePolicy {
  const classified = classifyCouncilTurn(commanderText)
  return {
    depth: extras?.depth ?? classified.depth,
    intent: extras?.intent ?? classified.intent,
    commanderText: extras?.commanderText ?? commanderText,
    allowDurableMemory: extras?.allowDurableMemory ?? (classified.intent === 'EXPLICIT_MEMORY' || classified.depth === 'FULL'),
    includeAssemblerRecentMessages: extras?.includeAssemblerRecentMessages ?? classified.depth === 'FULL',
    includeProjectState: extras?.includeProjectState ?? (classified.depth === 'FULL' && classified.intent !== 'KNOWLEDGE_QUESTION'),
    includeTerra: Boolean(extras?.includeTerra),
  }
}

export { GENERIC_OVERLAP_WORDS, classifyCouncilTurn, filterMemoriesForInfluence, generateNeutralSessionTitle, expandResearchQuery, stageFromDeliberationRole, stageFromPersistedMetadata }
