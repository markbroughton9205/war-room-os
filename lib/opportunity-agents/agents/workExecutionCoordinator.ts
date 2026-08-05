import { EVIDENCE_GATED_STATUSES, type OpportunityRecord, type OpportunityStatus } from '../types'
import { appendAudit } from '../store'

export type StatusTransitionResult = {
  ok: boolean
  record: OpportunityRecord
  blockedReason: string | null
}

export function transitionOpportunityStatus(
  record: OpportunityRecord,
  toStatus: OpportunityStatus,
  evidence: string | null,
  actor = 'coordinator',
): StatusTransitionResult {
  const fromStatus = record.status
  if (EVIDENCE_GATED_STATUSES.includes(toStatus) && !evidence) {
    appendAudit(record.id, {
      actor,
      fromStatus,
      toStatus: fromStatus,
      message: `Blocked transition to ${toStatus}: evidence is required.`,
      evidence: null,
    })
    return { ok: false, record, blockedReason: `Transition to ${toStatus} requires supporting evidence.` }
  }
  record.status = toStatus
  if (toStatus === 'SUBMITTED') record.submittedAt = new Date().toISOString()
  if (toStatus === 'COMPLETED') record.completedAt = new Date().toISOString()
  if (toStatus === 'VERIFIED') record.verifiedAt = new Date().toISOString()
  appendAudit(record.id, {
    actor,
    fromStatus,
    toStatus,
    message: `Status changed from ${fromStatus} to ${toStatus}.`,
    evidence,
  })
  return { ok: true, record, blockedReason: null }
}

export function approveForPursuit(record: OpportunityRecord, evidence: string): StatusTransitionResult {
  return transitionOpportunityStatus(record, 'APPROVED_FOR_PURSUIT', evidence, 'commander')
}

export function queueApprovedWork(record: OpportunityRecord): StatusTransitionResult {
  if (record.status !== 'APPROVED_FOR_PURSUIT') {
    return { ok: false, record, blockedReason: 'Commander approval is required before queuing work.' }
  }
  return transitionOpportunityStatus(record, 'QUEUED', 'Commander approved pursuit; queued internally only.', 'coordinator')
}
