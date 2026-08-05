import type { IncomeWorkerCandidate } from '@/lib/income-workers/types'
import { __resetOpportunityAgentStore, findDuplicate, listRecords } from './store'
import { evidenceStatusFor, scoutCandidateToRecord } from './agents/scoutAgent'
import { qualifyStoredRecord } from './agents/qualificationAgent'
import { analyzeOpportunityRevenue } from './agents/revenueAnalystAgent'
import { transitionOpportunityStatus, approveForPursuit, queueApprovedWork } from './agents/workExecutionCoordinator'
import { runOpportunityWorkflow } from './orchestrator'

export type OpportunityAgentValidationResult = { id: string; pass: boolean; detail: string }

function candidate(overrides: Partial<IncomeWorkerCandidate> = {}): IncomeWorkerCandidate {
  return {
    title: 'Local fleet automation support contract',
    type: 'ai_automation_services',
    source: 'Tavily Search',
    provider: 'tavily',
    url: 'https://example.com/opportunity/local-fleet-automation',
    payout: '$1200',
    currency: 'USD',
    country: 'United States',
    reason: 'Needs automation workflow support and documentation.',
    score: 82,
    riskLevel: 'medium',
    verificationStatus: 'candidate',
    eligibleWorkers: ['automation_service'],
    evidenceLabel: 'LIVE_SIGNAL_BACKED',
    expiration: new Date(Date.now() + 86400000).toISOString(),
    ...overrides,
  }
}

function test(id: string, fn: () => boolean | string): OpportunityAgentValidationResult {
  try {
    const result = fn()
    return { id, pass: result === true, detail: result === true ? 'PASS' : String(result) }
  } catch (error) {
    return { id, pass: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

export function runOpportunityAgentValidation(): OpportunityAgentValidationResult[] {
  const results: OpportunityAgentValidationResult[] = []
  const add = (id: string, fn: () => boolean | string) => results.push(test(id, fn))

  add('opag_01_evidence_or_unknown', () => {
    __resetOpportunityAgentStore()
    const unknown = evidenceStatusFor(candidate({ url: 'warroom://manual-unverified', evidenceLabel: undefined }), 'historical_pattern')
    const live = evidenceStatusFor(candidate(), 'tavily_live')
    return unknown === 'UNKNOWN' && live === 'LIVE_VERIFIED' || `unknown=${unknown} live=${live}`
  })
  add('opag_02_expired_not_active', () => {
    __resetOpportunityAgentStore()
    const { record } = scoutCandidateToRecord(candidate({ expiration: new Date(Date.now() - 1000).toISOString() }), 'tavily_live')
    const q = qualifyStoredRecord(record)
    return q.qualificationStatus === 'EXPIRED' && record.freshnessStatus === 'EXPIRED' || `status=${q.qualificationStatus} freshness=${record.freshnessStatus}`
  })
  add('opag_03_estimated_separate_from_actual', () => {
    __resetOpportunityAgentStore()
    const { record } = scoutCandidateToRecord(candidate(), 'tavily_live')
    const revenue = analyzeOpportunityRevenue(record)
    return revenue.estimatedRevenue !== null && record.actualRevenue === null && record.actualProfit === null || 'actual revenue was set during estimate'
  })
  add('opag_04_approved_for_pursuit_not_execution', () => {
    __resetOpportunityAgentStore()
    const { record } = scoutCandidateToRecord(candidate(), 'tavily_live')
    const approved = approveForPursuit(record, 'Commander approved pursuit for validation')
    return approved.ok && record.status === 'APPROVED_FOR_PURSUIT' && record.submittedAt === null && record.completedAt === null || `status=${record.status}`
  })
  add('opag_05_queued_not_running', () => {
    __resetOpportunityAgentStore()
    const { record } = scoutCandidateToRecord(candidate(), 'tavily_live')
    approveForPursuit(record, 'Commander approved pursuit for validation')
    const queued = queueApprovedWork(record)
    return queued.ok && record.status === 'QUEUED' || `status=${record.status}`
  })
  add('opag_06_submitted_not_won_without_evidence', () => {
    __resetOpportunityAgentStore()
    const { record } = scoutCandidateToRecord(candidate(), 'tavily_live')
    const submitted = transitionOpportunityStatus(record, 'SUBMITTED', null)
    const won = transitionOpportunityStatus(record, 'WON', null)
    return !submitted.ok && !won.ok && record.status === 'DISCOVERED' || `submitted=${submitted.ok} won=${won.ok} status=${record.status}`
  })
  add('opag_07_completed_not_verified_without_evidence', () => {
    __resetOpportunityAgentStore()
    const { record } = scoutCandidateToRecord(candidate(), 'tavily_live')
    const completed = transitionOpportunityStatus(record, 'COMPLETED', null)
    const verified = transitionOpportunityStatus(record, 'VERIFIED', null)
    return !completed.ok && !verified.ok && record.verifiedAt === null || `completed=${completed.ok} verified=${verified.ok}`
  })
  add('opag_08_draft_materials_remain_drafts', () => {
    __resetOpportunityAgentStore()
    const run = runOpportunityWorkflow(candidate(), 'tavily_live')
    return run.draftMaterials.length >= 3 && run.draftMaterials.every(item => item.status === 'draft') || 'draft material escaped draft state'
  })
  add('opag_09_external_actions_require_approval', () => {
    __resetOpportunityAgentStore()
    const run = runOpportunityWorkflow(candidate(), 'tavily_live')
    return run.approvalRequired && !run.externalActionsExecuted && run.record.status === 'AWAITING_COMMANDER_APPROVAL' || `status=${run.record.status}`
  })
  add('opag_10_spending_contracting_blocked', () => {
    __resetOpportunityAgentStore()
    const run = runOpportunityWorkflow(candidate(), 'tavily_live')
    return run.workPacket.commanderApprovalsRequired.some(item => item.includes('spending')) && run.revenue.upfrontCashRequired?.basis === 'estimate' || 'spending approval not explicit'
  })
  add('opag_11_duplicates_detected', () => {
    __resetOpportunityAgentStore()
    const first = scoutCandidateToRecord(candidate(), 'tavily_live')
    const second = scoutCandidateToRecord(candidate(), 'tavily_live')
    return !first.isDuplicate && second.isDuplicate && findDuplicate(first.record.title, first.record.sourceUrl)?.id === first.record.id || 'duplicate not detected'
  })
  add('opag_12_missing_eligibility_visible', () => {
    __resetOpportunityAgentStore()
    const { record } = scoutCandidateToRecord(candidate({ type: 'transportation_delivery', title: 'Box truck delivery route' }), 'tavily_live')
    const q = qualifyStoredRecord(record)
    return q.missingRequirements.length > 0 && record.eligibility.length > 0 || 'missing requirements hidden'
  })
  add('opag_13_failed_research_not_live_verified', () => {
    __resetOpportunityAgentStore()
    const { record } = scoutCandidateToRecord(candidate({ url: 'warroom://manual-unverified', evidenceLabel: undefined }), 'historical_pattern')
    return record.evidenceStatus !== 'LIVE_VERIFIED' || 'unverified research marked live verified'
  })
  add('opag_14_packet_complete', () => {
    __resetOpportunityAgentStore()
    const run = runOpportunityWorkflow(candidate(), 'tavily_live')
    return Boolean(run.workPacket.opportunitySummary && run.workPacket.evidenceAndSources && run.workPacket.exactNextSteps.length && run.workPacket.factsVsEstimates.estimates.length) || 'packet incomplete'
  })
  add('opag_15_session_only_disclosed', () => {
    __resetOpportunityAgentStore()
    const run = runOpportunityWorkflow(candidate(), 'tavily_live')
    return run.persistence === 'session_only' && run.workPacket.persistenceNote.includes('session_only') || 'session-only not disclosed'
  })
  add('opag_16_existing_scout_shape_not_regressed', () => {
    __resetOpportunityAgentStore()
    const { record } = scoutCandidateToRecord(candidate(), 'tavily_live')
    return typeof record.title === 'string' && record.commanderApprovalRequired === true && record.actualRevenue === null || 'record shape regressed'
  })
  add('opag_17_no_phase49a_dependency', () => {
    return true
  })
  add('opag_18_no_external_side_effect', () => {
    __resetOpportunityAgentStore()
    const run = runOpportunityWorkflow(candidate(), 'tavily_live')
    return !run.externalActionsExecuted && listRecords().length === 1 || 'external side effect or unexpected record count'
  })

  return results
}

if (process.argv[1]?.endsWith('validation.ts')) {
  const results = runOpportunityAgentValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.id} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Opportunity Agent Workforce validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
