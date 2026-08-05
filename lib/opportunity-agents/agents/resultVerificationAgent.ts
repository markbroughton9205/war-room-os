import type { OpportunityRecord, ResultVerification, ResultVerificationStatus, RevenueFigure } from '../types'
import { appendAudit } from '../store'

function confirmed(amount: number | null, notes: string): RevenueFigure {
  return { amount, currency: 'USD', basis: 'confirmed', notes }
}

export function verifyOpportunityResult(
  record: OpportunityRecord,
  status: ResultVerificationStatus,
  evidence: string | null,
  confirmedRevenueAmount: number | null = null,
): ResultVerification {
  const safeToReportRevenue = status === 'independently_verified' && Boolean(evidence)
  const actualRevenue = safeToReportRevenue ? confirmed(confirmedRevenueAmount, `Verified by evidence: ${evidence}`) : null
  const actualCosts = safeToReportRevenue ? record.actualCosts : null
  const actualProfit = actualRevenue?.amount !== null && actualRevenue?.amount !== undefined && actualCosts?.amount !== null && actualCosts?.amount !== undefined
    ? confirmed(actualRevenue.amount - actualCosts.amount, 'Confirmed revenue minus confirmed costs.')
    : null
  if (safeToReportRevenue) {
    record.actualRevenue = actualRevenue
    record.actualCosts = actualCosts
    record.actualProfit = actualProfit
    record.outcomeEvidence = evidence
    record.verifiedAt = new Date().toISOString()
  }
  appendAudit(record.id, {
    actor: 'verification',
    fromStatus: record.status,
    toStatus: record.status,
    message: `Verification status recorded as ${status}; actual revenue reporting allowed: ${safeToReportRevenue}.`,
    evidence,
  })
  return {
    opportunityId: record.id,
    status,
    evidence,
    actualRevenue,
    actualCosts,
    actualProfit,
    verifiedAt: safeToReportRevenue ? record.verifiedAt : null,
    safeToReportRevenue,
  }
}
