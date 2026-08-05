/**
 * OPPORTUNITY SCOUT AGENT
 *
 * Converts real scout candidates (from the existing income-worker federation:
 * Tavily / RSS / Brave / Firecrawl / cache / historical) into opportunity
 * records. It never invents opportunities: every record is built from a
 * candidate the federation actually returned, and the evidence status is
 * derived from HOW the candidate was sourced — a model suggestion or a failed
 * live lookup can never become LIVE_VERIFIED.
 */
import type { IncomeWorkerCandidate, IncomeWorkerScoutSourceType } from '@/lib/income-workers/types'
import type { NormalizedOpportunitySourceRecord } from '@/lib/opportunity-agents/sources/types'
import type { EvidenceStatus, FreshnessStatus, OpportunityRecord } from '../types'
import { findDuplicate, insertRecord } from '../store'
import { classifyCategory } from '../commanderContext'

export type ScoutBuildResult = {
  record: OpportunityRecord
  isDuplicate: boolean
}

export function evidenceStatusFor(
  candidate: IncomeWorkerCandidate,
  sourceType: IncomeWorkerScoutSourceType,
): EvidenceStatus {
  if (candidate.evidenceLabel === 'HISTORICAL_PATTERN_BASED') return 'HISTORICAL'
  if (!candidate.url || candidate.url.startsWith('warroom://')) {
    // No real source URL — cannot claim live verification.
    if (sourceType === 'cached_opportunities') return 'CACHED_CURRENT'
    return candidate.evidenceLabel === 'LIVE_SIGNAL_BACKED' ? 'CACHED_CURRENT' : 'UNKNOWN'
  }
  switch (sourceType) {
    case 'tavily_live':
    case 'brave_live':
    case 'firecrawl_live':
      return 'LIVE_VERIFIED'
    case 'rss_intelligence':
    case 'cached_opportunities':
      return 'CACHED_CURRENT'
    case 'historical_pattern':
      return 'HISTORICAL'
    default:
      return 'UNKNOWN'
  }
}

export function freshnessFor(candidate: IncomeWorkerCandidate, evidence: EvidenceStatus): FreshnessStatus {
  if (evidence === 'HISTORICAL') return 'HISTORICAL'
  const deadline = candidate.expiration ?? null
  if (deadline) {
    const at = Date.parse(deadline)
    if (!Number.isNaN(at)) return at < Date.now() ? 'EXPIRED' : 'CURRENT'
    return 'UNCERTAIN'
  }
  if (evidence === 'LIVE_VERIFIED' || evidence === 'CACHED_CURRENT') return 'CURRENT'
  return 'UNCERTAIN'
}

function parseAmount(text: string | null): number | null {
  if (!text) return null
  const match = text.replace(/,/g, '').match(/\$\s*(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : null
}

function candidateSummary(candidate: IncomeWorkerCandidate): string {
  return `${candidate.title} — ${candidate.reason}`.slice(0, 400)
}

/** Build and insert a record for one candidate. Duplicates are detected here
 * (DUPLICATE_CHECK stage) and flagged on the record instead of inserted twice. */
export function scoutCandidateToRecord(
  candidate: IncomeWorkerCandidate,
  sourceType: IncomeWorkerScoutSourceType,
): ScoutBuildResult {
  const duplicate = findDuplicate(candidate.title, candidate.url || null)
  const evidence = evidenceStatusFor(candidate, sourceType)
  const freshness = freshnessFor(candidate, evidence)
  const now = new Date().toISOString()
  const payoutAmount = parseAmount(candidate.payout)

  const base = {
    title: candidate.title.slice(0, 160),
    category: classifyCategory(`${candidate.title} ${candidate.type} ${candidate.reason}`) ?? 'uncategorized',
    summary: candidateSummary(candidate),
    source: candidate.source,
    sourceUrl: candidate.url && !candidate.url.startsWith('warroom://') ? candidate.url : null,
    sourceReference: null,
    noticeId: null,
    solicitationNumber: null,
    placeOfPerformance: null,
    naicsCodes: [],
    pscCodes: [],
    setAsideCode: null,
    setAsideDescription: null,
    sourcePublishedAt: null,
    retrievedAt: now,
    deadline: candidate.expiration ?? null,
    location: candidate.country || null,
    opportunityValue: payoutAmount !== null
      ? { amount: payoutAmount, currency: candidate.currency ?? 'USD', basis: 'confirmed' as const, notes: `Source states payout: ${candidate.payout}` }
      : candidate.payout
        ? { amount: null, currency: candidate.currency ?? 'USD', basis: 'confirmed' as const, notes: `Source states payout: ${candidate.payout}` }
        : null,
    estimatedRevenue: null,
    estimatedCosts: null,
    estimatedMargin: null,
    upfrontCashRequired: null,
    paymentTerms: null,
    eligibility: [],
    qualificationStatus: 'NEEDS_MORE_EVIDENCE' as const,
    evidenceStatus: evidence,
    freshnessStatus: freshness,
    riskLevel: candidate.riskLevel,
    effortLevel: 'medium' as const,
    timeToRevenue: null,
    requiredResources: [],
    missingRequirements: [],
    nextAction: null,
    commanderApprovalRequired: true as const,
    status: 'DISCOVERED' as const,
    assignedAgents: ['opportunity_scout'],
    submittedAt: null,
    completedAt: null,
    verifiedAt: null,
    actualRevenue: null,
    actualCosts: null,
    actualProfit: null,
    outcomeEvidence: null,
  }

  if (duplicate) {
    // Mark on the existing record instead of creating a second entry.
    duplicate.qualificationStatus = 'DUPLICATE'
    duplicate.auditHistory.push({
      at: now,
      actor: 'scout',
      fromStatus: duplicate.status,
      toStatus: duplicate.status,
      message: `Duplicate discovery suppressed: '${candidate.title}' already tracked as ${duplicate.id}.`,
      evidence: candidate.url || null,
    })
    duplicate.updatedAt = now
    return { record: duplicate, isDuplicate: true }
  }

  const record = insertRecord(base, {
    actor: 'scout',
    fromStatus: null,
    toStatus: 'DISCOVERED',
    message: `Discovered via ${sourceType} (provider: ${candidate.provider}). Evidence: ${evidence}; freshness: ${freshness}.`,
    evidence: candidate.url || null,
  })
  return { record, isDuplicate: false }
}


export function sourceRecordToCandidate(record: NormalizedOpportunitySourceRecord): IncomeWorkerCandidate {
  return {
    title: record.title,
    url: record.url ?? `warroom://source/${record.sourceId}/${record.dedupeFingerprint}`,
    source: record.sourceName,
    country: record.placeOfPerformance ?? 'United States',
    type: record.categoryHint,
    payout: record.estimatedValue,
    currency: 'USD',
    expiration: record.deadline,
    riskLevel: record.freshnessStatus === 'EXPIRED' ? 'high' : 'medium',
    verificationStatus: record.isActive ? 'candidate' : 'rejected',
    reason: record.summary,
    provider: record.sourceId,
    score: record.isActive ? 72 : 20,
    eligibleWorkers: ['contract_opportunity', 'revenue_tracker'],
    evidenceLabel: record.evidenceStatus === 'LIVE_VERIFIED' ? 'LIVE_SIGNAL_BACKED' : 'HISTORICAL_PATTERN_BASED',
  }
}

export function applySourceRecordMetadata(record: OpportunityRecord, source: NormalizedOpportunitySourceRecord): OpportunityRecord {
  record.sourceReference = source.sourceReference
  record.noticeId = source.noticeId
  record.solicitationNumber = source.solicitationNumber
  record.placeOfPerformance = source.placeOfPerformance
  record.naicsCodes = [...source.naicsCodes]
  record.pscCodes = [...source.pscCodes]
  record.setAsideCode = source.setAsideCode
  record.setAsideDescription = source.setAsideDescription
  record.sourcePublishedAt = source.publicationDate
  return record
}
