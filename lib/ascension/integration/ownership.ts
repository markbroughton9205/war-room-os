/**
 * #22 Phase 14 — Owner/session identity must propagate.
 * No owner=null. No silent owner change. No cross-user handoff.
 */
import { integrationFailure, type IntegrationFailure } from './failures'

export function requireOwnerUserId(ownerUserId: string | null | undefined): IntegrationFailure | null {
  if (!ownerUserId || !ownerUserId.trim()) {
    return integrationFailure('OWNER_REQUIRED', 'Every cross-agent handoff requires a non-null owner.')
  }
  return null
}

export function assertSameOwner(sourceOwner: string, targetOwner: string | null | undefined): IntegrationFailure | null {
  const missing = requireOwnerUserId(sourceOwner)
  if (missing) return missing
  if (!targetOwner || !targetOwner.trim()) {
    return integrationFailure('OWNER_REQUIRED', 'Target owner cannot be null.')
  }
  if (sourceOwner !== targetOwner) {
    return integrationFailure('CROSS_USER_DENIED', 'Cross-user handoff is denied.')
  }
  return null
}

export function assertEvidenceOwnerMatch(
  missionOwner: string,
  evidenceOwner: string | null | undefined,
): IntegrationFailure | null {
  if (evidenceOwner && evidenceOwner !== missionOwner) {
    return integrationFailure('OWNER_MISMATCH', 'Foreign-user evidence cannot enter this mission.')
  }
  return null
}
