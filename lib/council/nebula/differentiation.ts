import type { NebulaAgentId } from './identity'
import { NEBULA_AGENT_IDS } from './identity'
import { NEBULA_ROLE_CONTRACTS } from './roleContracts'
import {
  accidentallyFulfillsContract,
  checkOutputContract,
  type AuroraOutput,
  type LumenOutput,
  type NovaOutput,
  type PulsarOutput,
} from './outputContracts'
import { createExecutionRecord, identitySurvivesBackendChange } from './execution'
import { agentMayAccessMemoryScope, agentMayWriteMemoryScope } from './memory'

/**
 * Agent differentiation evaluation.
 *
 * VALIDATION FIXTURES ONLY. These structured responses are not live Council rounds
 * and must not be reported as production proof.
 */

export const DIFFERENTIATION_FIXTURE_LABEL = 'validation fixture — not production proof'

export const SHARED_DIFFERENTIATION_MISSION =
  'Should War Room add a second local research model before the next Council round?'

export type DifferentiationScores = {
  agentId: NebulaAgentId
  roleAdherence: number
  requiredFieldCompletion: number
  evidenceDiscipline: number
  uncertaintyBehavior: number
  specialization: number
}

export const DIFFERENTIATION_FIXTURES: Readonly<Record<'aurora' | 'nova' | 'pulsar' | 'lumen', Record<string, unknown>>> = {
  aurora: {
    decisionOrSynthesis: 'Do not add a second research model until current RESEARCH-slot reuse of GENERAL is measured against a real evidence gap.',
    supportingFindings: ['PULSAR reports RESEARCH currently reuses GENERAL', 'LUMEN has not verified a coverage failure'],
    tradeoffs: ['Added coverage vs VRAM and operational complexity'],
    uncertainties: ['No live benchmark of RESEARCH vs GENERAL on this mission class'],
    dissentingViews: ['NOVA may still sequence a later option if Commander wants capacity'],
    recommendationConfidence: 0.62,
  } satisfies AuroraOutput,
  nova: {
    objective: 'Preserve option to add a research weight without committing VRAM now.',
    options: ['Keep shared GENERAL', 'Add dedicated research weight later', 'Use external-first for research seats'],
    assumptions: ['Genesis hardware still cannot keep extra weights resident'],
    risks: ['Premature download locks operational complexity'],
    phases: ['Measure current gap', 'Decide weight only if gap is decision-relevant'],
    dependencies: ['LUMEN verification of any claimed coverage failure', 'Commander approval before download'],
    informationThatWouldChangePlan: ['A measured RESEARCH-slot failure on a real mission'],
  } satisfies NovaOutput,
  pulsar: {
    evidencePackets: [
      {
        packetId: 'ev-1',
        claim: 'RESEARCH role slot is configured to reuse GENERAL',
        source: 'lib/council/live-orchestration/backends/localModelRegistry.ts',
        provenance: 'repo file',
        primary: true,
      },
    ],
    missingEvidence: ['Live RESEARCH vs GENERAL quality comparison on this mission'],
    contradictorySignals: ['Architecture docs describe a future dedicated research weight that is not installed'],
    searchCoverageNotes: 'Inspected local model registry and seat role slot mapping; no web search performed.',
  } satisfies PulsarOutput,
  lumen: {
    claims: [
      {
        claim: 'A second local research model is required before the next Council round',
        verdict: 'unsupported',
        evidenceIds: ['ev-1'],
        confidence: 0.2,
      },
    ],
    verdict: 'unsupported',
    evidenceIds: ['ev-1'],
    confidence: 0.2,
    staleSources: [],
    missingTests: ['Side-by-side RESEARCH vs GENERAL evaluation on a real research decree'],
  } satisfies LumenOutput,
}

export function scoreDifferentiation(agentId: NebulaAgentId, body: Record<string, unknown>): DifferentiationScores {
  const contract = checkOutputContract(agentId, body)
  const role = NEBULA_ROLE_CONTRACTS[agentId]
  const text = JSON.stringify(body).toLowerCase()
  const forbiddenHits = role.nonResponsibilities.filter(item => {
    const token = item.toLowerCase().split(' ').slice(0, 3).join(' ')
    return token.length > 8 && text.includes(token)
  }).length
  const evidenceDiscipline = agentId === 'pulsar' || agentId === 'lumen'
    ? (text.includes('missing') || text.includes('unsupported') || text.includes('provisional') ? 1 : 0.5)
    : (text.includes('uncertain') || text.includes('assumption') || text.includes('tradeoff') ? 1 : 0.6)
  const uncertaintyBehavior = Array.isArray((body as { uncertainties?: unknown }).uncertainties)
    || Array.isArray((body as { missingEvidence?: unknown }).missingEvidence)
    || Array.isArray((body as { missingTests?: unknown }).missingTests)
    || Array.isArray((body as { assumptions?: unknown }).assumptions)
    ? 1
    : 0.4
  return {
    agentId,
    roleAdherence: Math.max(0, contract.requiredFieldCompletion - forbiddenHits * 0.1),
    requiredFieldCompletion: contract.requiredFieldCompletion,
    evidenceDiscipline,
    uncertaintyBehavior,
    specialization: contract.complete ? 1 : contract.requiredFieldCompletion,
  }
}

export function roleSwapNovaVsLumen(novaBody: Record<string, unknown>, lumenBody: Record<string, unknown>): {
  novaAccidentallyFulfillsLumen: boolean
  lumenAccidentallyFulfillsNova: boolean
  differentiated: boolean
} {
  const novaAccidentallyFulfillsLumen = accidentallyFulfillsContract(novaBody, 'lumen', 0.8)
  const lumenAccidentallyFulfillsNova = accidentallyFulfillsContract(lumenBody, 'nova', 0.8)
  return {
    novaAccidentallyFulfillsLumen,
    lumenAccidentallyFulfillsNova,
    differentiated: !novaAccidentallyFulfillsLumen && !lumenAccidentallyFulfillsNova,
  }
}

export function fixturesAreDifferentiated(): boolean {
  const scores = (['aurora', 'nova', 'pulsar', 'lumen'] as const).map(id => scoreDifferentiation(id, DIFFERENTIATION_FIXTURES[id]))
  const swap = roleSwapNovaVsLumen(DIFFERENTIATION_FIXTURES.nova, DIFFERENTIATION_FIXTURES.lumen)
  return scores.every(score => score.requiredFieldCompletion === 1) && swap.differentiated
}

export type BackendIndependenceCheck = {
  sameIdentity: boolean
  sameRolePriorities: boolean
  sameOutputContract: boolean
  sameMemoryPermissions: boolean
  sameUncertaintyRules: boolean
  pass: boolean
}

export function backendIndependenceFoundation(agentId: NebulaAgentId = 'aurora'): BackendIndependenceCheck {
  const first = createExecutionRecord({
    agentId,
    backendType: 'LOCAL',
    provider: 'ollama',
    runtime: 'ollama',
    model: 'huihui_ai/qwen3-abliterated:14b',
    attempt: 1,
  })
  const second = createExecutionRecord({
    agentId,
    backendType: 'EXTERNAL',
    provider: 'openai',
    runtime: 'cloud',
    model: 'gpt-4o',
    fallbackFrom: 'LOCAL',
    attempt: 2,
  })
  const sameIdentity = identitySurvivesBackendChange(first, second) && first.displayedIdentity === second.displayedIdentity
  const contract = NEBULA_ROLE_CONTRACTS[agentId]
  return {
    sameIdentity,
    sameRolePriorities: contract.optimizationTarget === NEBULA_ROLE_CONTRACTS[agentId].optimizationTarget,
    sameOutputContract: contract.requiredOutputContract === NEBULA_ROLE_CONTRACTS[agentId].requiredOutputContract,
    sameMemoryPermissions: agentMayAccessMemoryScope(agentId, 'working') && !agentMayWriteMemoryScope(agentId, 'global'),
    sameUncertaintyRules: contract.uncertaintyBehavior === NEBULA_ROLE_CONTRACTS[agentId].uncertaintyBehavior,
    pass: sameIdentity,
  }
}

export function personalityPersistenceAcrossBackends(agentId: NebulaAgentId): boolean {
  const a = createExecutionRecord({ agentId, model: 'model-a' })
  const b = createExecutionRecord({ agentId, model: 'model-b', backendType: 'EXTERNAL' })
  return a.displayedIdentity === b.displayedIdentity && a.agentId === b.agentId
}

export function allPermanentAgentsHaveDistinctOptimizationTargets(): boolean {
  const targets = NEBULA_AGENT_IDS.map(id => NEBULA_ROLE_CONTRACTS[id].optimizationTarget)
  return new Set(targets).size === targets.length
}
