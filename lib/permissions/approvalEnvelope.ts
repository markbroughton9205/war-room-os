/**
 * #22 Phase 1 — Scoped approval envelope helpers.
 * Reuses ExplicitExecutionApproval semantics; does not invent a second approval DB.
 */
import type { PolicyDecision } from '@/lib/permissions/policyDecision'

export type ApprovalEnvelope = {
  approvalId: string
  actorId: string
  actionKind: string
  target: string
  missionId: string | null
  ownerUserId: string | null
  expiresAt: string
  singleUse: boolean
  consumedAt: string | null
  approvedBy: string
}

export type ApprovalEnvelopeRequest = {
  actorId: string
  actionKind: string
  target: string
  missionId?: string | null
  ownerUserId?: string | null
  nowIso: string
}

export function verifyApprovalEnvelope(
  approval: ApprovalEnvelope | null,
  request: ApprovalEnvelopeRequest,
): PolicyDecision {
  if (!approval) {
    return deny('APPROVAL_MISSING', 'Approval envelope is missing.', request)
  }
  if (approval.consumedAt && approval.singleUse) {
    return deny('APPROVAL_REPLAY', 'Single-use approval has already been consumed.', request)
  }
  if (Date.parse(approval.expiresAt) <= Date.parse(request.nowIso)) {
    return deny('APPROVAL_EXPIRED', 'Approval has expired.', request)
  }
  if (approval.actorId !== request.actorId) {
    return deny('APPROVAL_ACTOR_MISMATCH', 'Approval actor does not match requesting actor.', request)
  }
  if (approval.actionKind !== request.actionKind) {
    return deny('APPROVAL_SCOPE_MISMATCH', 'Approval action kind does not match request.', request)
  }
  if (approval.target !== request.target) {
    return deny('APPROVAL_SCOPE_MISMATCH', 'Approval target does not match request.', request)
  }
  if (
    request.missionId != null &&
    approval.missionId != null &&
    approval.missionId !== request.missionId
  ) {
    return deny('APPROVAL_SCOPE_MISMATCH', 'Approval mission scope mismatch.', request)
  }
  if (
    request.ownerUserId != null &&
    approval.ownerUserId != null &&
    approval.ownerUserId !== request.ownerUserId
  ) {
    return deny('OWNER_SCOPE_DENIED', 'Approval owner scope mismatch.', request)
  }
  if (approval.approvedBy === approval.actorId && approval.actorId !== 'commander') {
    return deny('SELF_ESCALATION_DENIED', 'Self-approved envelope is forbidden.', request)
  }

  return {
    outcome: 'ALLOW',
    reasonCode: 'ALLOWED_VIA_APPROVAL',
    reason: 'Approval envelope matches actor, action, target, and time scope.',
    actionKind: request.actionKind,
    canonicalKind: null,
    riskTier: null,
    technicalReach: null,
    policyAuthority: 'APPROVAL_REQUIRED',
    requiresApproval: true,
    approvalSatisfied: true,
    httpStatus: 200,
  }
}

export function markApprovalEnvelopeConsumed(
  approval: ApprovalEnvelope,
  consumedAt: string,
): ApprovalEnvelope {
  return { ...approval, consumedAt }
}

function deny(
  reasonCode: PolicyDecision['reasonCode'],
  reason: string,
  request: ApprovalEnvelopeRequest,
): PolicyDecision {
  return {
    outcome: 'DENY',
    reasonCode,
    reason,
    actionKind: request.actionKind,
    canonicalKind: null,
    riskTier: null,
    technicalReach: null,
    policyAuthority: 'DENIED',
    requiresApproval: true,
    approvalSatisfied: false,
    httpStatus: 403,
  }
}
