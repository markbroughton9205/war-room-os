/**
 * Structured rationale for "why did Council choose this plan?"
 * Evidence and constraints only. No hidden chain-of-thought.
 */

import type { AtlasPlanGraph, JanusAnalysis, MissionContractV1, SentinelReview, StructuredRationale } from './types'

export function buildStructuredRationale(input: {
  contract: MissionContractV1
  plan?: AtlasPlanGraph | null
  scenarios?: JanusAnalysis | null
  risks?: SentinelReview | null
  evidence?: Array<{ evidence_id: string; summary: string }>
}): StructuredRationale {
  return Object.freeze({
    mission_objective: input.contract.objective,
    plan_steps: (input.plan?.steps ?? []).map(item => ({
      step_id: item.step_id,
      title: item.title,
      status: item.status,
    })),
    evidence: (input.evidence ?? []).slice(0, 24),
    scenario_comparison: (input.scenarios?.scenarios ?? []).map(item => ({
      option: item.option,
      reversibility: item.reversibility,
    })),
    risks: (input.risks?.risks ?? []).map(item => ({
      risk_id: item.risk_id,
      category: item.category,
      blocking: item.blocking,
    })),
    authority_constraints: [
      ...input.contract.explicit_exclusions.map(item => `excluded: ${item}`),
      `commit=${input.contract.authority.commit ? 'yes' : 'no'}`,
      `push=${input.contract.authority.push ? 'yes' : 'no'}`,
      `production_deploy=${input.contract.authority.production_deploy ? 'yes' : 'no'}`,
      'Commander remains authority source',
    ],
    chain_of_thought_exposed: false,
  })
}

export function formatRationaleForCommander(rationale: StructuredRationale): string {
  const lines = [
    `Objective: ${rationale.mission_objective}`,
    rationale.plan_steps.length ? `Plan: ${rationale.plan_steps.map(item => `${item.title} [${item.status}]`).join('; ')}` : 'Plan: not invoked',
    rationale.evidence.length ? `Evidence: ${rationale.evidence.map(item => item.summary).join('; ')}` : 'Evidence: none attached',
    rationale.scenario_comparison.length ? `Scenarios: ${rationale.scenario_comparison.map(item => item.option).join(' | ')}` : '',
    rationale.risks.length ? `Risks: ${rationale.risks.map(item => `${item.category}${item.blocking ? ' BLOCKING' : ''}`).join('; ')}` : 'Risks: none blocking',
    `Authority: ${rationale.authority_constraints.join('; ')}`,
  ]
  return lines.filter(Boolean).join('\n')
}
