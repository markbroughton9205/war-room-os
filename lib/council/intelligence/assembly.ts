/**
 * Dynamic Council assembly. Builds on selectAgentsForMission.
 * Does not default to all six. Aurora is final synthesis unless it is the only seat.
 */

import type { EbcAgentId } from '@/lib/council/evidence-board/types'
import { neverDefaultSix, selectAgentsForMission } from '@/lib/council/gi/agentSelectionPolicy'
import type { IntelligenceRouting, MissionContractV1 } from './types'
import type { AssemblySeat, CognitiveStrategy, CouncilAssemblyPlan, MissionBudget, WorkProductType } from './orchestrationTypes'
import { AGENT_CONTRACTS } from '@/lib/council/evidence-board/assembly'

const PRODUCT: Partial<Record<EbcAgentId, WorkProductType>> = {
  ORION: 'INVESTIGATION',
  PULSAR: 'RESEARCH',
  NOVA: 'DATA_ANALYSIS',
  LUMEN: 'VERIFICATION',
  PHOENIX: 'CHALLENGE',
  AURORA: 'SYNTHESIS_INPUT',
}

export function assembleCouncil(input: {
  contract: MissionContractV1
  strategy: CognitiveStrategy
  routing: IntelligenceRouting
  text: string
  budget: MissionBudget
  conflictProbability?: 'low' | 'med' | 'high'
  evidenceThin?: boolean
}): CouncilAssemblyPlan {
  const base = selectAgentsForMission({
    mission_class: input.routing.ebc_mission_class,
    text: input.text,
    budget: input.budget === 'MAXIMUM' ? 'DEEP' : input.budget === 'FAST' ? 'FAST' : 'STANDARD',
    risk: input.contract.risk_level,
    conflict_probability: input.conflictProbability,
    verification_need: input.strategy.verification_depth !== 'NONE',
    structured_data: input.strategy.id === 'DATA_ANALYSIS' || input.strategy.id === 'DOCUMENT_ANALYSIS',
    source_freshness: input.strategy.evidence_requirement === 'MULTI_SOURCE' ? 'live' : 'stale_ok',
  })

  let selected = [...base.selected_agents]
  if (input.strategy.id === 'DIRECT' || input.strategy.id === 'DOCUMENT_ANALYSIS' || input.strategy.id === 'DATA_ANALYSIS') {
    selected = [...input.strategy.seat_mix]
  } else {
    for (const seat of input.strategy.seat_mix) {
      if (!selected.includes(seat)) selected.push(seat)
    }
  }

  const phoenixNeeded =
    input.strategy.adversarial_requirement === 'ALWAYS'
    || (input.strategy.adversarial_requirement === 'THRESHOLD' && (input.conflictProbability === 'high' || input.evidenceThin === true || base.phoenix_required))
  if (!phoenixNeeded) selected = selected.filter(agent => agent !== 'PHOENIX')
  else if (!selected.includes('PHOENIX')) selected.push('PHOENIX')

  if (input.budget === 'FAST') {
    selected = selected.filter(agent => agent !== 'PHOENIX' || phoenixNeeded && input.strategy.adversarial_requirement === 'ALWAYS')
  }

  if (input.strategy.id === 'DIRECT') selected = ['AURORA']
  if (input.strategy.id === 'RESEARCH' && !selected.includes('PULSAR')) selected = ['PULSAR', ...selected.filter(a => a !== 'PULSAR')]

  selected = uniqueCap(selected, input.budget === 'FAST' ? 3 : 5)
  if (!selected.includes('AURORA') && input.strategy.id !== 'DIRECT') selected.push('AURORA')
  selected = uniqueCap(selected, 5)

  const seats: AssemblySeat[] = selected.map(agent => ({
    agent,
    role: AGENT_CONTRACTS[agent]?.role ?? agent,
    expected_contribution: AGENT_CONTRACTS[agent]?.output ?? 'structured work product',
    internal: agent !== 'AURORA',
    completion_responsibility: agent === 'AURORA',
  }))

  const internals = selected.filter(agent => agent !== 'AURORA')
  const communication_edges: CouncilAssemblyPlan['communication_edges'] = internals.flatMap(agent => {
    const product = PRODUCT[agent]
    if (!product) return []
    return [{ from: agent, to: 'AURORA' as const, product }]
  })
  if (selected.includes('ORION') && selected.includes('LUMEN')) {
    communication_edges.push({ from: 'ORION', to: 'LUMEN', product: 'INVESTIGATION' })
  }
  if (selected.includes('PULSAR') && selected.includes('LUMEN')) {
    communication_edges.push({ from: 'PULSAR', to: 'LUMEN', product: 'RESEARCH' })
  }

  const decision: CouncilAssemblyPlan = {
    selected_seats: selected,
    seats,
    communication_edges,
    phoenix_required: selected.includes('PHOENIX'),
    aurora_final_only: selected.includes('AURORA') && selected.length > 1,
    never_default_six: true,
    reason: `${input.strategy.id}: ${base.reason} Phoenix=${selected.includes('PHOENIX') ? 'on' : 'off'}.`,
  }
  if (!neverDefaultSix({ selected_agents: selected, phoenix_required: decision.phoenix_required, aurora_required: true, reason: decision.reason })) {
    decision.selected_seats = selected.slice(0, 5)
  }
  return Object.freeze(decision)
}

function uniqueCap(agents: EbcAgentId[], cap: number): EbcAgentId[] {
  return [...new Set(agents)].slice(0, cap)
}
