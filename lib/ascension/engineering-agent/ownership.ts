/**
 * #22 Phase 3 — Owner scope for ENGINEERING_AGENT.
 * Service-role reach does not grant cross-user engineering context.
 */
export function assertEngineeringOwnerScopeMatch(
  ownerUserId: string,
  conversationOwnerUserId: string | null | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!conversationOwnerUserId) {
    return { ok: false, reason: 'Conversation owner missing — fail closed.' }
  }
  if (ownerUserId !== conversationOwnerUserId) {
    return { ok: false, reason: 'Cross-user engineering context fail-closed.' }
  }
  return { ok: true }
}
