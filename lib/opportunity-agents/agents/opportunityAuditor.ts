import type { AuditorFlag, OpportunityRecord } from '../types'
import { hasSimilarLead } from './leadOutreachAgent'

export function auditOpportunity(record: OpportunityRecord): AuditorFlag[] {
  const now = new Date().toISOString()
  const flags: AuditorFlag[] = []
  if (record.qualificationStatus === 'DUPLICATE' || hasSimilarLead(record)) {
    flags.push({ kind: 'duplicate', message: 'A similar opportunity is already tracked.', raisedAt: now })
  }
  if (record.deadline && Date.parse(record.deadline) < Date.now()) {
    flags.push({ kind: 'deadline_exceeded', message: 'The listed deadline has passed.', raisedAt: now })
  }
  if ((record.status === 'WON' || record.status === 'COMPLETED' || record.status === 'VERIFIED') && !record.outcomeEvidence) {
    flags.push({ kind: 'unsupported_success_claim', message: 'Success status lacks outcome evidence.', raisedAt: now })
  }
  if (record.commanderApprovalRequired && record.status === 'AWAITING_COMMANDER_APPROVAL') {
    flags.push({ kind: 'awaiting_commander_approval', message: 'Commander approval is required before any external action.', raisedAt: now })
  }
  return flags
}
