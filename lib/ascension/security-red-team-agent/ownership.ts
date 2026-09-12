/**
 * #22 Phase 4 — Owner scope for SECURITY_RED_TEAM_AGENT.
 * Being a security actor does not grant cross-user access.
 */
export function assertSecurityOwnerScopeMatch(
  ownerUserId: string,
  conversationOwnerUserId: string | null | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!conversationOwnerUserId) {
    return { ok: false, reason: 'Conversation owner missing — fail closed.' }
  }
  if (ownerUserId !== conversationOwnerUserId) {
    return { ok: false, reason: 'Cross-user security evaluation context fail-closed.' }
  }
  return { ok: true }
}
