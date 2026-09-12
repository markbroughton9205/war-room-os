/**
 * #22 Phase 2 — Ascension RESEARCH_AGENT public exports.
 */
export * from './identity'
export * from './profile'
export * from './scope'
export * from './result'
export * from './registry'
export {
  runBoundedResearchAgent,
  researchAgentResultForCouncil,
  researchAgentResultForAstra,
  type RunBoundedResearchInput,
} from './runtime'

/** Pure ownership match — service role does not bypass this check. */
export function assertResearchOwnerScopeMatch(
  ownerUserId: string,
  conversationOwnerUserId: string | null | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!conversationOwnerUserId) {
    return { ok: false, reason: 'Conversation owner missing — fail closed.' }
  }
  if (ownerUserId !== conversationOwnerUserId) {
    return { ok: false, reason: 'Cross-user research context fail-closed.' }
  }
  return { ok: true }
}
