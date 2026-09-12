/**
 * #22 Phase 6 — Owner scope for TERRA_INTELLIGENCE_AGENT.
 * Public world-state evidence may be non-private; conversation/session context is owned.
 */
export function assertTerraIntelligenceOwnerScopeMatch(
  ownerUserId: string,
  conversationOwnerUserId: string | null | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!conversationOwnerUserId) {
    return { ok: false, reason: 'Conversation owner missing — fail closed.' }
  }
  if (ownerUserId !== conversationOwnerUserId) {
    return { ok: false, reason: 'Cross-user Terra/Council context fail-closed.' }
  }
  return { ok: true }
}

/** Baby must not inherit Commander Terra/Council session context. */
export function assertBabyTerraSessionDenied(): { ok: false; reason: string } {
  return {
    ok: false,
    reason: 'Baby Terra/session access DENIED / NOT_IMPLEMENTED in Phase 6 — no expansion.',
  }
}
