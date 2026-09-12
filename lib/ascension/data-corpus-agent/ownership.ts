/**
 * #22 Phase 8 — Owner scope for DATA_CORPUS_AGENT.
 */
export function assertDataCorpusOwnerScopeMatch(
  ownerUserId: string,
  conversationOwnerUserId: string | null | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!conversationOwnerUserId) {
    return { ok: false, reason: 'Conversation owner missing — fail closed.' }
  }
  if (ownerUserId !== conversationOwnerUserId) {
    return { ok: false, reason: 'Cross-user corpus/session context fail-closed.' }
  }
  return { ok: true }
}

/** Baby must not inherit Commander corpus/session context. */
export function assertBabyDataCorpusDenied(): { ok: false; reason: string } {
  return {
    ok: false,
    reason: 'Baby corpus/session access DENIED / NOT_IMPLEMENTED in Phase 8 — no expansion.',
  }
}

/** Private Commander/user material must not promote to shared corpus. */
export function assertPrivateNotPromotedToShared(ownershipScope: string): {
  ok: boolean
  reason: string
} {
  if (ownershipScope === 'COMMANDER_PRIVATE' || ownershipScope === 'USER_PRIVATE') {
    return {
      ok: false,
      reason: 'Private owner data must not be promoted to shared/public corpus without explicit future authorization.',
    }
  }
  return { ok: true, reason: 'ok' }
}
