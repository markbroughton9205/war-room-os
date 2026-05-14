import type { IncomeWorkerCandidate } from './types'

export type IncomeSkillMatch = {
  requiredSkills: string[]
  recommendedTools: string[]
  technicalExecution: boolean
}

export function matchIncomeOpportunitySkills(candidate: IncomeWorkerCandidate): IncomeSkillMatch {
  const text = `${candidate.title} ${candidate.type} ${candidate.source} ${candidate.reason}`.toLowerCase()
  const skills = new Set<string>(['source verification', 'legitimacy review', 'approval-gated execution'])
  const tools = new Set<string>(['Memory', 'Action Queue'])
  let technicalExecution = false

  if (/ai|data|evaluation|annotation|model|prompt/.test(text)) {
    skills.add('AI evaluation')
    skills.add('quality review')
    tools.add('Research')
    tools.add('Files')
  }
  if (/research|study|participant|interview|clinical|survey|testing/.test(text)) {
    skills.add('eligibility screening')
    skills.add('deadline tracking')
    tools.add('Research')
  }
  if (/freight|dispatch|truck|transport|delivery|logistics/.test(text)) {
    skills.add('freight lead qualification')
    skills.add('route/business fit review')
    tools.add('Repo')
  }
  if (/contract|rfp|proposal|client|consultant/.test(text)) {
    skills.add('proposal planning')
    skills.add('scope review')
    tools.add('Files')
  }
  if (/digital|product|template|course|affiliate|lead/.test(text)) {
    skills.add('offer design')
    skills.add('go-to-market planning')
    tools.add('Research')
  }
  if (/automation|workflow|zapier|api|script|webhook|software/.test(text)) {
    skills.add('technical scoping')
    skills.add('implementation planning')
    tools.add('Repo')
    tools.add('Files')
    technicalExecution = true
  }
  if (candidate.payout) {
    skills.add('expected payout tracking')
  }

  return {
    requiredSkills: [...skills],
    recommendedTools: [...tools],
    technicalExecution,
  }
}
