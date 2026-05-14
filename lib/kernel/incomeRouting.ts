import type { IncomeWorkerCandidate } from '@/lib/income-workers/types'
import type { IncomeSkillMatch } from '@/lib/income-workers/skillMatching'

export type IncomeCouncilRoutingDecision = {
  opportunityType: string
  recommendedFamilies: string[]
  recommendedAgents: string[]
  recommendedTools: string[]
  riskLevel: IncomeWorkerCandidate['riskLevel']
  approvalRequired: true
}

export function routeIncomeOpportunityThroughKernel(
  candidate: IncomeWorkerCandidate,
  match: IncomeSkillMatch,
): IncomeCouncilRoutingDecision {
  const families = new Set<string>(['ChatGPT Family', 'Claude Family', 'Red Team'])
  const agents = new Set<string>(['Income Workers'])

  if (candidate.type.includes('research') || candidate.type.includes('testing')) {
    families.add('Grok Family')
    families.add('Gemini Family')
    agents.add('Gig Scout Worker')
  }
  if (candidate.type.includes('AI') || match.requiredSkills.includes('AI evaluation')) {
    families.add('ChatGPT Family')
    families.add('Claude Family')
    agents.add('Remote Work Worker')
  }
  if (candidate.eligibleWorkers.includes('freight_lead')) {
    families.add('Grok Family')
    agents.add('Freight Lead Worker')
  }
  if (candidate.eligibleWorkers.includes('contract_opportunity')) {
    families.add('Claude Family')
    agents.add('Contract Opportunity Worker')
  }
  if (match.technicalExecution) {
    families.add('Bridge Architect')
    agents.add('Automation Service Worker')
    agents.add('Bridge Architect')
  }
  if (candidate.payout) {
    agents.add('Revenue Tracker Worker')
  }

  agents.add('Payout Preparation Worker')

  return {
    opportunityType: candidate.type,
    recommendedFamilies: [...families],
    recommendedAgents: [...agents],
    recommendedTools: match.recommendedTools,
    riskLevel: candidate.riskLevel,
    approvalRequired: true,
  }
}
