import { routeIncomeOpportunityThroughKernel } from '@/lib/kernel/incomeRouting'
import { matchIncomeOpportunitySkills } from './skillMatching'
import type { IncomeWorkerCandidate } from './types'

export type IncomeCouncilReview = {
  opportunityId: string
  summary: string
  source: string
  requiredSkills: string[]
  recommendedFamilies: string[]
  recommendedAgents: string[]
  recommendedTools: string[]
  riskLevel: IncomeWorkerCandidate['riskLevel']
  incomePotential: string
  effortEstimate: string
  approvalRequired: true
  nextAction: string
  actionQueueIds: string[]
}

function stableOpportunityId(candidate: IncomeWorkerCandidate): string {
  const normalized = `${candidate.source}-${candidate.title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return `income_opp_${normalized || Date.now().toString(36)}`
}

function estimateEffort(candidate: IncomeWorkerCandidate): string {
  if (candidate.riskLevel === 'high') return 'high verification effort'
  if (/clinical|contract|rfp|proposal/i.test(`${candidate.title} ${candidate.type}`)) return 'medium review effort'
  return 'low-to-medium review effort'
}

export function createIncomeCouncilReview(candidate: IncomeWorkerCandidate, actionQueueIds: string[] = []): IncomeCouncilReview {
  const match = matchIncomeOpportunitySkills(candidate)
  const routing = routeIncomeOpportunityThroughKernel(candidate, match)

  return {
    opportunityId: stableOpportunityId(candidate),
    summary: `${candidate.title} from ${candidate.source}. ${candidate.reason}`,
    source: candidate.url,
    requiredSkills: match.requiredSkills,
    recommendedFamilies: routing.recommendedFamilies,
    recommendedAgents: routing.recommendedAgents,
    recommendedTools: routing.recommendedTools,
    riskLevel: routing.riskLevel,
    incomePotential: candidate.payout ? `Expected payout unconfirmed: ${candidate.payout}` : 'Payout unknown until verified.',
    effortEstimate: estimateEffort(candidate),
    approvalRequired: true,
    nextAction: candidate.verificationStatus === 'rejected'
      ? 'Reject or manually review before any action.'
      : 'Queue Ra’el approval for source verification and next-step planning.',
    actionQueueIds,
  }
}
