/**
 * #22 Phase 13 — Owner / memory-class scope for WORLD_LEARNING_AGENT.
 * Commander private and session-local material must not become world knowledge.
 */
export type WorldLearningMemoryClass = 'WORLD_KNOWLEDGE' | 'COMMANDER_PRIVATE' | 'SESSION_LOCAL' | 'REMOTE_USER_DATA'

export function assertWorldLearningAgentOwnerScopeMatch(
  ownerUserId: string,
  resourceOwnerUserId: string | null | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!resourceOwnerUserId) return { ok: true }
  if (ownerUserId === resourceOwnerUserId) return { ok: true }
  return { ok: false, reason: 'WORLD_LEARNING_AGENT owner scope mismatch.' }
}

export function assertBabyWorldLearningAgentDenied(): { ok: false; reason: string } {
  return {
    ok: false,
    reason: 'Baby Observer cannot invoke WORLD_LEARNING_AGENT.',
  }
}

export function assertPrivateNotPromotedToWorldKnowledge(input: {
  memoryClass: WorldLearningMemoryClass
  promotePrivateToWorld?: boolean
  promoteSessionToWorld?: boolean
}): { ok: true } | { ok: false; reason: string } {
  if (input.promotePrivateToWorld && input.memoryClass === 'COMMANDER_PRIVATE') {
    return { ok: false, reason: 'Commander private conversations cannot be promoted to WORLD_KNOWLEDGE.' }
  }
  if (input.promoteSessionToWorld && input.memoryClass === 'SESSION_LOCAL') {
    return { ok: false, reason: 'Session-local data cannot be silently promoted to WORLD_KNOWLEDGE.' }
  }
  if (input.memoryClass === 'REMOTE_USER_DATA' && input.promotePrivateToWorld) {
    return { ok: false, reason: 'Remote user data cannot become general world knowledge without authorization.' }
  }
  return { ok: true }
}
