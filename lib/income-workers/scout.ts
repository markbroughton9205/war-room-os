import { searchTavilyIncomeOpportunities } from '@/lib/income/tavily'
import type { OpportunityScoutCandidate } from '@/lib/income/tavily'
import type { IncomeWorkerCandidate, IncomeWorkerId, IncomeWorkerScoutResult } from './types'

function scoreCandidate(candidate: OpportunityScoutCandidate): number {
  let score = 50
  if (candidate.payout) score += 20
  if (candidate.expiration) score += 8
  if (candidate.riskLevel === 'low') score += 15
  if (candidate.riskLevel === 'high') score -= 35
  if (candidate.verificationStatus === 'rejected') score -= 30
  return Math.max(0, Math.min(100, score))
}

function eligibleWorkersFor(candidate: OpportunityScoutCandidate): IncomeWorkerId[] {
  const text = `${candidate.title} ${candidate.type} ${candidate.source}`.toLowerCase()
  const workers: IncomeWorkerId[] = ['revenue_tracker']
  if (/freight|dispatch|truck|transport|delivery/.test(text)) workers.unshift('freight_lead')
  if (/job|hiring|role|career|ai evaluator|evaluator/.test(text)) workers.unshift('job_scout', 'remote_work')
  if (/gig|micro|testing|survey|interview|research|participant/.test(text)) workers.unshift('gig_scout')
  if (/contract|rfp|proposal|client/.test(text)) workers.unshift('contract_opportunity')
  if (/digital|product|template|course/.test(text)) workers.unshift('digital_product')
  if (/affiliate|lead/.test(text)) workers.unshift('affiliate_lead_gen')
  if (/automation|zapier|workflow|no-code|nocode/.test(text)) workers.unshift('automation_service')
  return [...new Set(workers)]
}

function normalizeCandidate(candidate: OpportunityScoutCandidate): IncomeWorkerCandidate {
  return {
    title: candidate.title,
    url: candidate.url,
    source: candidate.source,
    country: candidate.country,
    type: candidate.type,
    payout: candidate.payout,
    currency: candidate.currency,
    expiration: candidate.expiration,
    riskLevel: candidate.riskLevel,
    verificationStatus: candidate.verificationStatus,
    reason: candidate.reason,
    provider: candidate.provider,
    score: scoreCandidate(candidate),
    eligibleWorkers: eligibleWorkersFor(candidate),
  }
}

export async function scoutIncomeWorkerOpportunities(): Promise<IncomeWorkerScoutResult> {
  const scannedAt = new Date().toISOString()

  if (!process.env.TAVILY_API_KEY) {
    return {
      status: 'config_needed',
      message: 'Tavily is not configured. Income Workers cannot scout live opportunities yet.',
      scannedAt,
      providerUsed: 'none',
      sourcesChecked: 0,
      candidates: [],
      rejected: [],
    }
  }

  try {
    const scan = await searchTavilyIncomeOpportunities()
    const candidates = scan.opportunities.map(normalizeCandidate).sort((a, b) => b.score - a.score)
    const rejected = scan.rejected.map(normalizeCandidate).sort((a, b) => b.score - a.score)

    return {
      status: candidates.length > 0 ? 'found' : 'no_results',
      message: candidates.length > 0
        ? 'Income Workers found real source-linked candidates. Review and assign before action.'
        : 'Income Workers completed a live scan. No candidates passed the current verification filter.',
      scannedAt,
      providerUsed: 'tavily',
      sourcesChecked: scan.sourcesChecked,
      candidates,
      rejected,
    }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Income Worker scout failed.',
      scannedAt,
      providerUsed: 'tavily',
      sourcesChecked: 0,
      candidates: [],
      rejected: [],
    }
  }
}
