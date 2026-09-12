/**
 * #22 Phase 7 — Owner scope for COUNCIL_VALIDATOR.
 */
export function assertCouncilValidatorOwnerScopeMatch(
  ownerUserId: string,
  conversationOwnerUserId: string | null | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!conversationOwnerUserId) {
    return { ok: false, reason: 'Conversation owner missing — fail closed.' }
  }
  if (ownerUserId !== conversationOwnerUserId) {
    return { ok: false, reason: 'Cross-user Council session validation fail-closed.' }
  }
  return { ok: true }
}

/** Baby must not inherit Commander Council/validator session context. */
export function assertBabyCouncilValidatorDenied(): { ok: false; reason: string } {
  return {
    ok: false,
    reason: 'Baby Council/validator access DENIED / NOT_IMPLEMENTED in Phase 7 — no expansion.',
  }
}
