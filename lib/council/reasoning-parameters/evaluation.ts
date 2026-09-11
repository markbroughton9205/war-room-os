import type { DeliberationEvidenceReference, DeliberationTurn, DeliberationTurnRole } from '@/lib/council/family-deliberation/types'
import { buildDeliberationPrompt } from '@/lib/council/family-deliberation/runtime'
import { isNearEcho, tokenJaccardSimilarity } from '@/lib/council/seatDistinctness'
import { containsHiddenReasoning, stripHiddenReasoning } from '@/lib/council/nebula/thinkingStrip'
import { NEBULA_ROLE_CONTRACTS, type EvidencePosture, type FailureBias, type UncertaintyBehavior } from '@/lib/council/nebula/roleContracts'
import type { NebulaAgentId } from '@/lib/council/nebula/identity'
import { annotateEvidenceIndependence } from '@/lib/intelligence/sourceIndependence'
import type { IntelligenceEvidenceItem } from '@/lib/intelligence/intelligencePacket'
import { reasoningRoleKindForSeat, type ReasoningRoleKind } from './roster'

export type EvaluationTaskClass =
  | 'factual_evidence_analysis'
  | 'conflicting_source_analysis'
  | 'uncertainty_heavy'
  | 'strategic_planning'
  | 'adversarial_risk_review'
  | 'synthesis_problem'

export type EvaluationFixture = {
  id: string
  taskClass: EvaluationTaskClass
  commanderMessage: string
  evidence: DeliberationEvidenceReference[]
}

export type ContributionCategory = ReasoningRoleKind

export type RedundancyReport = {
  pairCount: number
  nearEchoPairs: Array<{ a: string; b: string; similarity: number }>
  meanPairwiseJaccard: number
  uniqueContributionCoverage: ContributionCategory[]
  redundancyProblematic: boolean
}

const SHARED_PACKET: DeliberationEvidenceReference[] = [
  {
    evidence_reference_id: 'ev-terra-ais',
    label: '[TERRA/LIVE] Digitraffic Marine: PILOT L-139 at 60.10496,24.973792, speed 0.0 kn, navStatus Under way using engine',
    source_kind: 'direct_fetch',
    url: 'https://meri.digitraffic.fi/api/ais/v1/vessels/230125910',
    origin_type: 'TERRA',
  },
  {
    evidence_reference_id: 'ev-news-conflict',
    label: '[LIVE_WEB/unverified] Local bulletin claims the same MMSI is in drydock and not moving under engine',
    source_kind: 'news_wire',
    url: 'https://example.test/fixture-drydock-bulletin',
    origin_type: 'LIVE_WEB',
  },
]

export const EVALUATION_FIXTURES: readonly EvaluationFixture[] = [
  {
    id: '15_factual',
    taskClass: 'factual_evidence_analysis',
    commanderMessage:
      'Using only the supplied Terra intelligence, what is currently known about vessel PILOT L-139, and what remains unknown? Separate observed AIS facts from inference. Do not invent coordinates or identity.',
    evidence: SHARED_PACKET,
  },
  {
    id: '15_conflict',
    taskClass: 'conflicting_source_analysis',
    commanderMessage:
      'The packet contains a live AIS observation and a bulletin that disagrees. Using only those two labeled items, what is observed, what conflicts, and what cannot be settled?',
    evidence: SHARED_PACKET,
  },
  {
    id: '15_uncertainty',
    taskClass: 'uncertainty_heavy',
    commanderMessage:
      'Freshness is LIVE for AIS and unverified for the bulletin. What can be stated, what must stay unknown, and what would change the conclusion?',
    evidence: SHARED_PACKET,
  },
  {
    id: '15_strategy',
    taskClass: 'strategic_planning',
    commanderMessage:
      'If the Commander must decide whether to keep watching this vessel tonight, what options exist, what assumptions matter, and what information would change the sequence?',
    evidence: SHARED_PACKET,
  },
  {
    id: '15_adversarial',
    taskClass: 'adversarial_risk_review',
    commanderMessage:
      'Challenge the easy reading that a 0.0 kn AIS track plus "under way using engine" is a settled operational picture. Name failure modes and the strongest counterexample in the packet.',
    evidence: SHARED_PACKET,
  },
  {
    id: '15_synthesis',
    taskClass: 'synthesis_problem',
    commanderMessage:
      'After distinct seat work, give Ra\'el one closing takeaway from only what survived. Do not add new facts. Preserve disagreement and uncertainty.',
    evidence: SHARED_PACKET,
  },
]

export const LIVE_SAME_EVIDENCE_DECREE = EVALUATION_FIXTURES[0]!.commanderMessage

/** Existing ASTRA RESEARCH routing seats PULSAR/ORION/LUMEN/PHOENIX/NOVA/AURORA. Same evidence packet. */
export const LIVE_ROLE_COVERAGE_DECREE =
  'Using only the supplied Terra intelligence, research the evidence about vessel PILOT L-139. What is observed, what conflicts, and what remains unknown? Separate AIS facts from inference. Do not invent coordinates or identity.'

const CATEGORY_MARKERS: Record<ContributionCategory, RegExp> = {
  engineering: /\b(interface|data model|component|runtime architecture|operational hazard|test plan)\b/i,
  evidence: /\b(provenance|missing evidence|contradict|observed|source|AIS|packet)\b/i,
  verification: /\b(unsupported|supported|unverified|reject|verdict|calibrat|still supported|stale)\b/i,
  strategy: /\b(option|sequence|assumption|phase|what would change|optionalit)\b/i,
  adversarial: /\b(failure mode|counterexample|attack assumption|recovery|hold up|challenge)\b/i,
  synthesis: /\b(surviv|dissent|tradeoff|closing|takeaway|weav)\b/i,
  human_impact: /\b(people|stakeholder|practical|usability|harm|adoption)\b/i,
  orchestration: /\b(task graph|constellation|temporary specialist|stopping condition)\b/i,
  observation: /\b(pattern|tone|alignment|chronicle|observ)\b/i,
  systems_bridge: /\b(bridge|systems reasoning)\b/i,
}

export function sameEvidencePacket(fixtures: readonly EvaluationFixture[] = EVALUATION_FIXTURES): boolean {
  const first = fixtures[0]?.evidence.map(item => item.evidence_reference_id).join('|')
  return fixtures.every(fixture => fixture.evidence.map(item => item.evidence_reference_id).join('|') === first)
}

export function promptForRole(input: {
  fixture: EvaluationFixture
  role: DeliberationTurnRole
  identityId: NebulaAgentId
  priorTurns?: DeliberationTurn[]
}): string {
  return buildDeliberationPrompt({
    role: input.role,
    commanderMessage: input.fixture.commanderMessage,
    evidenceReferences: input.fixture.evidence,
    priorTurns: input.priorTurns ?? [],
    identityId: input.identityId,
  })
}

export function contributionCategories(text: string): ContributionCategory[] {
  const visible = stripHiddenReasoning(text)
  return (Object.keys(CATEGORY_MARKERS) as ContributionCategory[]).filter(category => CATEGORY_MARKERS[category].test(visible))
}

export function scoreRedundancy(outputs: Array<{ id: string; text: string }>): RedundancyReport {
  const nearEchoPairs: RedundancyReport['nearEchoPairs'] = []
  let sum = 0
  let pairCount = 0
  for (let i = 0; i < outputs.length; i++) {
    for (let j = i + 1; j < outputs.length; j++) {
      const a = outputs[i]!
      const b = outputs[j]!
      const similarity = tokenJaccardSimilarity(a.text, b.text)
      sum += similarity
      pairCount += 1
      if (isNearEcho(a.text, b.text)) {
        nearEchoPairs.push({ a: a.id, b: b.id, similarity })
      }
    }
  }
  const coverage = [...new Set(outputs.flatMap(item => contributionCategories(item.text)))]
  return {
    pairCount,
    nearEchoPairs,
    meanPairwiseJaccard: pairCount ? sum / pairCount : 0,
    uniqueContributionCoverage: coverage,
    redundancyProblematic: nearEchoPairs.length > 0 || (pairCount > 0 && sum / pairCount >= 0.62),
  }
}

export function visibleOutputIsSafe(text: string): boolean {
  return !containsHiddenReasoning(text)
}

export function contractFingerprint(agentId: NebulaAgentId): {
  evidencePosture: EvidencePosture
  uncertaintyBehavior: UncertaintyBehavior
  failureBias: FailureBias
  outputContract: string
} {
  const contract = NEBULA_ROLE_CONTRACTS[agentId]
  return {
    evidencePosture: contract.evidencePosture,
    uncertaintyBehavior: contract.uncertaintyBehavior,
    failureBias: contract.failureBias,
    outputContract: contract.requiredOutputContract,
  }
}

export function contractsAreStructurallyDistinct(a: NebulaAgentId, b: NebulaAgentId): boolean {
  const left = contractFingerprint(a)
  const right = contractFingerprint(b)
  return left.evidencePosture !== right.evidencePosture
    || left.uncertaintyBehavior !== right.uncertaintyBehavior
    || left.failureBias !== right.failureBias
    || left.outputContract !== right.outputContract
}

export function independenceUnchanged(items: IntelligenceEvidenceItem[]): boolean {
  const annotated = annotateEvidenceIndependence(items)
  return annotated.length === items.length && annotated.every(item => typeof item.independence_key === 'string')
}

export function stageInstructionsDiffer(): boolean {
  const fixture = EVALUATION_FIXTURES[0]!
  const direct = promptForRole({ fixture, role: 'direct_response', identityId: 'orion' })
  const revision = promptForRole({ fixture, role: 'revision_or_stand_firm', identityId: 'orion' })
  const challenge = promptForRole({ fixture, role: 'red_team_challenge', identityId: 'phoenix' })
  const synthesis = promptForRole({ fixture, role: 'council_synthesis', identityId: 'aurora' })
  return direct.includes('Turn role: direct response')
    && revision.includes('Turn role: revision or stand firm')
    && challenge.includes('Turn role: challenge')
    && synthesis.includes('Turn role: council synthesis')
    && !synthesis.includes('Turn role: direct response')
    && !challenge.includes('Turn role: council synthesis')
}

export function sameEvidenceReachesMembers(): boolean {
  const fixture = EVALUATION_FIXTURES[1]!
  const pulsar = promptForRole({ fixture, role: 'direct_response', identityId: 'pulsar' })
  const lumen = promptForRole({ fixture, role: 'direct_response', identityId: 'lumen' })
  const phoenix = promptForRole({ fixture, role: 'red_team_challenge', identityId: 'phoenix' })
  const aurora = promptForRole({ fixture, role: 'council_synthesis', identityId: 'aurora' })
  const id = 'ev-terra-ais'
  return [pulsar, lumen, phoenix, aurora].every(prompt => prompt.includes(id) && prompt.includes('ev-news-conflict'))
}

export { reasoningRoleKindForSeat }
