import type { ActionPlan, OpportunityRecord, OpportunityWorkPacket, PursuitPlanStep } from '../types'
import type { QualificationResult } from './qualificationAgent'
import type { RevenueAnalysis } from '../types'
import { appendAudit } from '../store'

function buildSteps(record: OpportunityRecord): PursuitPlanStep[] {
  return [
    { order: 1, action: 'Review source, deadline, eligibility, and missing requirements.', requiresCommanderApproval: false, dependsOn: [] },
    { order: 2, action: 'Commander approves or rejects pursuit before any external contact.', requiresCommanderApproval: true, dependsOn: [1] },
    { order: 3, action: 'Prepare final application/proposal materials for Commander review.', requiresCommanderApproval: true, dependsOn: [2] },
    { order: 4, action: 'Submit or contact externally only after explicit Commander approval.', requiresCommanderApproval: true, dependsOn: [3] },
    { order: 5, action: `Collect proof before marking ${record.title} as submitted, won, completed, or paid.`, requiresCommanderApproval: false, dependsOn: [4] },
  ]
}

export function createActionPlan(record: OpportunityRecord): ActionPlan {
  const requiredDocuments = Array.from(new Set([
    ...record.requiredResources,
    'source link or saved evidence',
    'Commander approval record',
    'submission/proof receipt if pursued',
  ]))
  const commanderApprovalsRequired = [
    'approve pursuit',
    'approve any external application or outreach',
    'approve any spending, contract, or payment-related step',
  ]
  const plan: ActionPlan = {
    opportunityId: record.id,
    generatedAt: new Date().toISOString(),
    steps: buildSteps(record),
    requiredDocuments,
    commanderApprovalsRequired,
    verificationPlan: 'Do not claim outcome success until source evidence, submission receipt, award notice, invoice, or deposit proof is recorded.',
    earliestNextAction: record.nextAction ?? 'Commander review required.',
  }
  record.nextAction = plan.earliestNextAction
  if (!record.assignedAgents.includes('action_planner')) record.assignedAgents.push('action_planner')
  appendAudit(record.id, {
    actor: 'planner',
    fromStatus: record.status,
    toStatus: record.status,
    message: 'Action plan prepared; all external steps remain approval-gated.',
  })
  return plan
}

export function createWorkPacket(
  record: OpportunityRecord,
  qualification: QualificationResult,
  revenue: RevenueAnalysis,
  plan: ActionPlan,
): OpportunityWorkPacket {
  const recommendedDecision = record.freshnessStatus === 'EXPIRED'
    ? 'reject'
    : record.qualificationStatus === 'HIGH_FIT' || record.qualificationStatus === 'POSSIBLE_FIT'
      ? 'pursue'
      : record.qualificationStatus === 'NEEDS_MORE_EVIDENCE'
        ? 'research_more'
        : 'defer'
  const confidenceLevel = record.evidenceStatus === 'LIVE_VERIFIED' ? 0.78 : record.evidenceStatus === 'CACHED_CURRENT' ? 0.62 : 0.42
  return {
    opportunityId: record.id,
    generatedAt: new Date().toISOString(),
    persistenceNote: 'session_only: this work packet is in process memory until durable Opportunity Agent persistence is added.',
    opportunitySummary: record.summary,
    evidenceAndSources: {
      source: record.source,
      sourceUrl: record.sourceUrl,
      sourceReference: record.sourceReference,
      noticeId: record.noticeId,
      solicitationNumber: record.solicitationNumber,
      placeOfPerformance: record.placeOfPerformance,
      naicsCodes: record.naicsCodes,
      pscCodes: record.pscCodes,
      setAsideCode: record.setAsideCode,
      setAsideDescription: record.setAsideDescription,
      publishedAt: record.sourcePublishedAt,
      retrievedAt: record.retrievedAt,
      evidenceStatus: record.evidenceStatus,
      freshnessStatus: record.freshnessStatus,
    },
    whyItFits: qualification.whyItFits,
    whyItMayNotFit: qualification.whyItMayNotFit,
    eligibilityRequirements: record.eligibility,
    estimatedRevenue: revenue.estimatedRevenue,
    estimatedCosts: revenue.estimatedCosts,
    estimatedProfit: revenue.estimatedProfit,
    timeToFirstRevenue: revenue.timeToRevenue,
    riskAssessment: { level: record.riskLevel, factors: qualification.whyItMayNotFit },
    missingResources: record.missingRequirements,
    requiredDocuments: plan.requiredDocuments,
    recommendedDecision,
    exactNextSteps: plan.steps.map(step => `${step.order}. ${step.action}`),
    draftMaterials: [],
    commanderApprovalsRequired: plan.commanderApprovalsRequired,
    verificationPlan: plan.verificationPlan,
    expirationOrDeadline: record.deadline,
    confidenceLevel,
    factsVsEstimates: { facts: revenue.facts, estimates: revenue.estimates },
  }
}
