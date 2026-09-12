/**
 * #22 Phase 5 — Owner scope for OPERATIONS_AGENT.
 */
export function assertOperationsOwnerScopeMatch(
  ownerUserId: string,
  conversationOwnerUserId: string | null | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!conversationOwnerUserId) {
    return { ok: false, reason: 'Conversation owner missing — fail closed.' }
  }
  if (ownerUserId !== conversationOwnerUserId) {
    return { ok: false, reason: 'Cross-user operations context fail-closed.' }
  }
  return { ok: true }
}
