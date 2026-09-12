/**
 * #22 Phase 9 — Ownership + privacy for navigation sessions/routes.
 */
export function assertNavigationOwnerScopeMatch(
  ownerUserId: string,
  resourceOwnerUserId: string | null | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!resourceOwnerUserId) {
    return { ok: false, reason: 'Resource owner missing — fail closed.' }
  }
  if (ownerUserId !== resourceOwnerUserId) {
    return { ok: false, reason: 'Cross-user navigation/location access denied.' }
  }
  return { ok: true }
}

export function assertBabyNavigationDenied(): { ok: false; reason: string } {
  return {
    ok: false,
    reason: 'Baby navigation/location access DENIED / unchanged in Phase 9.',
  }
}

export function assertNoBackgroundTracking(attempt?: boolean): {
  allowed: false
  reason: string
} {
  return {
    allowed: false,
    reason: attempt
      ? 'Background/continuous tracking daemon denied.'
      : 'Navigation foundation is request/session driven — no background tracking.',
  }
}

export function assertNoDeviceControl(attempt?: boolean): {
  allowed: false
  reason: string
} {
  return {
    allowed: false,
    reason: attempt
      ? 'Vehicle/device control denied — routing is computation only.'
      : 'DEVICE_CONTROL = DENIED',
  }
}
