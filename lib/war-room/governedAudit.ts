/**
 * #22 Phase 1 — Structured governed-action audit metadata (Gate C).
 * Extends war_room_audit_logs metadata; does not store chain-of-thought.
 */
import type { PolicyDecision } from '@/lib/permissions/policyDecision'
import { insertWarRoomAuditLog, type InsertWarRoomAuditRow, type WarRoomAuditCategory } from '@/lib/war-room/auditLog'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

export type GovernedAuditMetadata = {
  governanceVersion: 'ascension_phase1'
  requestedBy: string | null
  actorAgent: string | null
  missionId: string | null
  councilRound: string | number | null
  tool: string | null
  actionKind: string
  target: string | null
  ownerUserId: string | null
  technicalReach: string | null
  policyAuthority: string | null
  riskTier: string | null
  approvalRequired: boolean
  approvalId: string | null
  approvedBy: string | null
  approvedAt: string | null
  policyDecision: PolicyDecision['outcome']
  reasonCode: PolicyDecision['reasonCode']
  executionResult: 'allowed' | 'denied' | 'require_approval' | 'executed' | 'failed' | null
  denialReason: string | null
  rollbackRef: string | null
  evidenceRefs: string[] | null
  timestamp: string
}

export function buildGovernedAuditMetadata(input: {
  decision: PolicyDecision
  requestedBy?: string | null
  actorAgent?: string | null
  missionId?: string | null
  councilRound?: string | number | null
  tool?: string | null
  target?: string | null
  ownerUserId?: string | null
  approvalId?: string | null
  approvedBy?: string | null
  approvedAt?: string | null
  executionResult?: GovernedAuditMetadata['executionResult']
  rollbackRef?: string | null
  evidenceRefs?: string[] | null
  nowIso?: string
}): GovernedAuditMetadata {
  const d = input.decision
  return {
    governanceVersion: 'ascension_phase1',
    requestedBy: input.requestedBy ?? null,
    actorAgent: input.actorAgent ?? null,
    missionId: input.missionId ?? null,
    councilRound: input.councilRound ?? null,
    tool: input.tool ?? null,
    actionKind: d.actionKind,
    target: input.target ?? null,
    ownerUserId: input.ownerUserId ?? null,
    technicalReach: d.technicalReach,
    policyAuthority: d.policyAuthority,
    riskTier: d.riskTier,
    approvalRequired: d.requiresApproval,
    approvalId: input.approvalId ?? null,
    approvedBy: input.approvedBy ?? null,
    approvedAt: input.approvedAt ?? null,
    policyDecision: d.outcome,
    reasonCode: d.reasonCode,
    executionResult:
      input.executionResult ??
      (d.outcome === 'ALLOW' ? 'allowed' : d.outcome === 'REQUIRE_APPROVAL' ? 'require_approval' : 'denied'),
    denialReason: d.outcome === 'ALLOW' ? null : d.reason,
    rollbackRef: input.rollbackRef ?? null,
    evidenceRefs: input.evidenceRefs ?? null,
    timestamp: input.nowIso ?? new Date().toISOString(),
  }
}

export function governedAuditHasRequiredFields(meta: GovernedAuditMetadata): boolean {
  return (
    meta.governanceVersion === 'ascension_phase1' &&
    typeof meta.actionKind === 'string' &&
    meta.actionKind.length > 0 &&
    typeof meta.policyDecision === 'string' &&
    typeof meta.reasonCode === 'string' &&
    typeof meta.approvalRequired === 'boolean' &&
    typeof meta.timestamp === 'string'
  )
}

export async function insertGovernedAuditLog(
  client: WarRoomSupabase | null,
  input: {
    actor: InsertWarRoomAuditRow['actor']
    category: WarRoomAuditCategory
    message: string
    actionId?: string | null
    metadata: GovernedAuditMetadata
    extra?: Record<string, unknown>
  },
): Promise<void> {
  await insertWarRoomAuditLog(client, {
    actor: input.actor,
    category: input.category,
    action_id: input.actionId,
    message: input.message,
    metadata: {
      ...input.extra,
      governed: input.metadata,
    },
  })
}
