/**
 * #22 Phase 12 — Owner scope for NAVIGATION_AGENT.
 * Reuses Phase 9 navigation ownership helpers; no cross-user route state.
 */
import { assertBabyNavigationDenied, assertNavigationOwnerScopeMatch } from '@/lib/terra/navigation/ownership'

export function assertNavigationAgentOwnerScopeMatch(
  ownerUserId: string,
  resourceOwnerUserId: string | null | undefined,
): { ok: true } | { ok: false; reason: string } {
  return assertNavigationOwnerScopeMatch(ownerUserId, resourceOwnerUserId)
}

export function assertBabyNavigationAgentDenied(): { ok: false; reason: string } {
  const baby = assertBabyNavigationDenied()
  return {
    ok: false,
    reason: baby.reason.replace('Phase 9', 'Phase 12'),
  }
}
