import type { IncomeWorkerCandidate, IncomeWorkerScoutSourceType } from '@/lib/income-workers/types'
import type { NormalizedOpportunitySourceRecord } from './sources/types'
import type { OpportunityWorkflowRun } from './types'
import { listRecords } from './store'
import { applySourceRecordMetadata, scoutCandidateToRecord, sourceRecordToCandidate } from './agents/scoutAgent'
import { qualifyStoredRecord } from './agents/qualificationAgent'
import { analyzeOpportunityRevenue } from './agents/revenueAnalystAgent'
import { createActionPlan, createWorkPacket } from './agents/actionPlannerAgent'
import { prepareDraftMaterials } from './agents/proposalApplicationAgent'
import { createLeadRecord } from './agents/leadOutreachAgent'
import { transitionOpportunityStatus } from './agents/workExecutionCoordinator'
import { auditOpportunity } from './agents/opportunityAuditor'

export const OPPORTUNITY_WORKFORCE_STAGES = [
  'DISCOVER',
  'SOURCE_VERIFY',
  'DUPLICATE_CHECK',
  'QUALIFY',
  'REVENUE_ANALYSIS',
  'RISK_REVIEW',
  'PREPARE_WORK_PACKET',
  'PREPARE_DRAFTS',
  'AWAIT_COMMANDER_APPROVAL',
] as const

function workflowId(): string {
  return `opwf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function runOpportunityWorkflow(
  candidate: IncomeWorkerCandidate,
  sourceType: IncomeWorkerScoutSourceType,
): OpportunityWorkflowRun {
  const scout = scoutCandidateToRecord(candidate, sourceType)
  const record = scout.record
  const qualification = qualifyStoredRecord(record)
  const revenue = analyzeOpportunityRevenue(record)
  const actionPlan = createActionPlan(record)
  const workPacket = createWorkPacket(record, qualification, revenue, actionPlan)
  const draftMaterials = prepareDraftMaterials(record, workPacket)
  workPacket.draftMaterials = draftMaterials
  const lead = createLeadRecord(record, draftMaterials)
  if (record.status !== 'AWAITING_COMMANDER_APPROVAL') {
    transitionOpportunityStatus(record, 'AWAITING_COMMANDER_APPROVAL', 'Internal work packet prepared; awaiting Commander approval.', 'coordinator')
  }
  const auditFlags = auditOpportunity(record)
  return {
    id: workflowId(),
    opportunityId: record.id,
    createdAt: new Date().toISOString(),
    stages: [...OPPORTUNITY_WORKFORCE_STAGES],
    record,
    qualification: {
      qualificationStatus: qualification.qualificationStatus,
      whyItFits: qualification.whyItFits,
      whyItMayNotFit: qualification.whyItMayNotFit,
      missingRequirements: qualification.missingRequirements,
    },
    revenue,
    actionPlan,
    workPacket,
    draftMaterials,
    lead,
    auditFlags,
    approvalRequired: true,
    externalActionsExecuted: false,
    persistence: 'session_only',
  }
}

export function listOpportunityAgentRecords() {
  return { records: listRecords(), persistence: 'session_only' as const }
}


export function runOpportunityWorkflowFromSourceRecord(sourceRecord: NormalizedOpportunitySourceRecord): OpportunityWorkflowRun {
  const candidate = sourceRecordToCandidate(sourceRecord)
  const run = runOpportunityWorkflow(candidate, sourceRecord.sourceId === 'sam_gov' ? 'tavily_live' : sourceRecord.evidenceStatus === 'HISTORICAL' ? 'historical_pattern' : 'cached_opportunities')
  applySourceRecordMetadata(run.record, sourceRecord)
  run.workPacket.evidenceAndSources.sourceReference = sourceRecord.sourceReference
  run.workPacket.evidenceAndSources.noticeId = sourceRecord.noticeId
  run.workPacket.evidenceAndSources.solicitationNumber = sourceRecord.solicitationNumber
  run.workPacket.evidenceAndSources.placeOfPerformance = sourceRecord.placeOfPerformance
  run.workPacket.evidenceAndSources.naicsCodes = [...sourceRecord.naicsCodes]
  run.workPacket.evidenceAndSources.pscCodes = [...sourceRecord.pscCodes]
  run.workPacket.evidenceAndSources.setAsideCode = sourceRecord.setAsideCode
  run.workPacket.evidenceAndSources.setAsideDescription = sourceRecord.setAsideDescription
  run.workPacket.evidenceAndSources.publishedAt = sourceRecord.publicationDate
  return run
}
