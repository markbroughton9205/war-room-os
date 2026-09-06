import { NEBULA_AGENT_IDS, type NebulaAgentId } from './identity'
import { NEBULA_ROLE_CONTRACTS } from './roleContracts'

/**
 * Typed output contracts. Exact prose is not required; role-specific structure is.
 * A response that is interchangeable with another agent's contract is a differentiation failure.
 */

export type OutputContractId = NebulaRoleContractId
type NebulaRoleContractId =
  | 'aurora_synthesis_v1'
  | 'nova_plan_v1'
  | 'pulsar_evidence_v1'
  | 'lumen_verification_v1'
  | 'phoenix_adversarial_v1'
  | 'orion_engineering_v1'
  | 'solara_impact_v1'
  | 'astra_orchestration_v1'

export type LumenClaimVerdict =
  | 'supported'
  | 'partially_supported'
  | 'unsupported'
  | 'contradicted'
  | 'unresolved'

export type AuroraOutput = {
  decisionOrSynthesis: string
  supportingFindings: string[]
  tradeoffs: string[]
  uncertainties: string[]
  dissentingViews: string[]
  recommendationConfidence: number | null
}

export type NovaOutput = {
  objective: string
  options: string[]
  assumptions: string[]
  risks: string[]
  phases: string[]
  dependencies: string[]
  informationThatWouldChangePlan: string[]
}

export type PulsarEvidencePacket = {
  packetId: string
  claim: string
  source: string
  provenance: string
  primary: boolean
}

export type PulsarOutput = {
  evidencePackets: PulsarEvidencePacket[]
  missingEvidence: string[]
  contradictorySignals: string[]
  searchCoverageNotes: string
}

export type LumenClaimRecord = {
  claim: string
  verdict: LumenClaimVerdict
  evidenceIds: string[]
  confidence: number | null
}

export type LumenOutput = {
  claims: LumenClaimRecord[]
  verdict: LumenClaimVerdict | string
  evidenceIds: string[]
  confidence: number | null
  staleSources: string[]
  missingTests: string[]
}

export type PhoenixFailureMode = {
  failureModes: string
  likelihood: string
  impact: string
  mitigation: string
}

export type PhoenixOutput = {
  failureModes: PhoenixFailureMode[] | string[]
  likelihood: string
  impact: string
  mitigation: string
  strongestCounterexample: string
  recoveryPlan: string
  rejectionConditions: string[]
}

export type OrionOutput = {
  components: string[]
  interfaces: string[]
  dataModel: string
  implementationSequence: string[]
  operationalRisks: string[]
  testPlan: string[]
  openTechnicalQuestions: string[]
}

export type SolaraOutput = {
  stakeholders: string[]
  likelyBenefits: string[]
  likelyHarms: string[]
  adoptionBarriers: string[]
  accessibilityConcerns: string[]
  unintendedConsequences: string[]
  practicalRecommendations: string[]
}

export type AstraOutput = {
  taskGraph: string[]
  selectedSpecialists: string[]
  parallelGroups: string[]
  evidencePlan: string
  stoppingConditions: string[]
  estimatedCost: string
  estimatedLatency: string
}

export type NebulaAgentOutput =
  | { agentId: 'aurora'; contractId: 'aurora_synthesis_v1'; body: AuroraOutput }
  | { agentId: 'nova'; contractId: 'nova_plan_v1'; body: NovaOutput }
  | { agentId: 'pulsar'; contractId: 'pulsar_evidence_v1'; body: PulsarOutput }
  | { agentId: 'lumen'; contractId: 'lumen_verification_v1'; body: LumenOutput }
  | { agentId: 'phoenix'; contractId: 'phoenix_adversarial_v1'; body: PhoenixOutput }
  | { agentId: 'orion'; contractId: 'orion_engineering_v1'; body: OrionOutput }
  | { agentId: 'solara'; contractId: 'solara_impact_v1'; body: SolaraOutput }
  | { agentId: 'astra'; contractId: 'astra_orchestration_v1'; body: AstraOutput }

export type OutputFieldSpec = {
  field: string
  required: true
  description: string
}

export type OutputContractSpec = {
  contractId: OutputContractId
  agentId: NebulaAgentId
  fields: readonly OutputFieldSpec[]
}

export const OUTPUT_CONTRACTS: Readonly<Record<NebulaAgentId, OutputContractSpec>> = Object.freeze({
  aurora: {
    contractId: 'aurora_synthesis_v1',
    agentId: 'aurora',
    fields: [
      { field: 'decisionOrSynthesis', required: true, description: 'Coherent synthesis or decision' },
      { field: 'supportingFindings', required: true, description: 'Independent findings actually available' },
      { field: 'tradeoffs', required: true, description: 'Explicit tradeoffs' },
      { field: 'uncertainties', required: true, description: 'Preserved unknowns' },
      { field: 'dissentingViews', required: true, description: 'Disagreement that was not erased' },
      { field: 'recommendationConfidence', required: true, description: 'Calibrated confidence, not certainty theater' },
    ],
  },
  nova: {
    contractId: 'nova_plan_v1',
    agentId: 'nova',
    fields: [
      { field: 'objective', required: true, description: 'Stated objective' },
      { field: 'options', required: true, description: 'Strategic options' },
      { field: 'assumptions', required: true, description: 'Exposed assumptions' },
      { field: 'risks', required: true, description: 'Plan risks' },
      { field: 'phases', required: true, description: 'Sequenced phases' },
      { field: 'dependencies', required: true, description: 'Dependencies' },
      { field: 'informationThatWouldChangePlan', required: true, description: 'Information that would change the plan' },
    ],
  },
  pulsar: {
    contractId: 'pulsar_evidence_v1',
    agentId: 'pulsar',
    fields: [
      { field: 'evidencePackets', required: true, description: 'Evidence packets with provenance' },
      { field: 'missingEvidence', required: true, description: 'What was not found' },
      { field: 'contradictorySignals', required: true, description: 'Contradictions surfaced' },
      { field: 'searchCoverageNotes', required: true, description: 'Where the search did and did not look' },
    ],
  },
  lumen: {
    contractId: 'lumen_verification_v1',
    agentId: 'lumen',
    fields: [
      { field: 'claims', required: true, description: 'Atomic claims' },
      { field: 'verdict', required: true, description: 'Support classification' },
      { field: 'evidenceIds', required: true, description: 'Traceable evidence ids' },
      { field: 'confidence', required: true, description: 'Support-calibrated confidence' },
      { field: 'staleSources', required: true, description: 'Stale or weak sources' },
      { field: 'missingTests', required: true, description: 'Additional verification needed' },
    ],
  },
  phoenix: {
    contractId: 'phoenix_adversarial_v1',
    agentId: 'phoenix',
    fields: [
      { field: 'failureModes', required: true, description: 'Useful failure modes' },
      { field: 'likelihood', required: true, description: 'Likelihood bound' },
      { field: 'impact', required: true, description: 'Impact bound' },
      { field: 'mitigation', required: true, description: 'Mitigation' },
      { field: 'strongestCounterexample', required: true, description: 'Strongest counterexample' },
      { field: 'recoveryPlan', required: true, description: 'Recovery path' },
      { field: 'rejectionConditions', required: true, description: 'When the plan should be rejected' },
    ],
  },
  orion: {
    contractId: 'orion_engineering_v1',
    agentId: 'orion',
    fields: [
      { field: 'components', required: true, description: 'Architecture components' },
      { field: 'interfaces', required: true, description: 'Interfaces' },
      { field: 'dataModel', required: true, description: 'Data model' },
      { field: 'implementationSequence', required: true, description: 'Build sequence' },
      { field: 'operationalRisks', required: true, description: 'Operational hazards' },
      { field: 'testPlan', required: true, description: 'Proposed tests' },
      { field: 'openTechnicalQuestions', required: true, description: 'Open technical questions' },
    ],
  },
  solara: {
    contractId: 'solara_impact_v1',
    agentId: 'solara',
    fields: [
      { field: 'stakeholders', required: true, description: 'Affected groups' },
      { field: 'likelyBenefits', required: true, description: 'Likely benefits' },
      { field: 'likelyHarms', required: true, description: 'Likely harms' },
      { field: 'adoptionBarriers', required: true, description: 'Adoption friction' },
      { field: 'accessibilityConcerns', required: true, description: 'Access and accessibility' },
      { field: 'unintendedConsequences', required: true, description: 'Unintended consequences' },
      { field: 'practicalRecommendations', required: true, description: 'Practical recommendations' },
    ],
  },
  astra: {
    contractId: 'astra_orchestration_v1',
    agentId: 'astra',
    fields: [
      { field: 'taskGraph', required: true, description: 'Task graph' },
      { field: 'selectedSpecialists', required: true, description: 'Selected permanent or temporary specialists' },
      { field: 'parallelGroups', required: true, description: 'Parallel work groups' },
      { field: 'evidencePlan', required: true, description: 'Evidence plan' },
      { field: 'stoppingConditions', required: true, description: 'When to stop' },
      { field: 'estimatedCost', required: true, description: 'Cost estimate' },
      { field: 'estimatedLatency', required: true, description: 'Latency estimate' },
    ],
  },
})

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'object') return true
  return Boolean(value)
}

export type OutputContractCheck = {
  agentId: NebulaAgentId
  contractId: OutputContractId
  requiredFieldCompletion: number
  missingFields: string[]
  complete: boolean
}

export function checkOutputContract(agentId: NebulaAgentId, body: Record<string, unknown>): OutputContractCheck {
  const spec = OUTPUT_CONTRACTS[agentId]
  const missing = spec.fields.filter(field => !isPresent(body[field.field])).map(field => field.field)
  const requiredFieldCompletion = spec.fields.length === 0 ? 1 : (spec.fields.length - missing.length) / spec.fields.length
  return {
    agentId,
    contractId: spec.contractId,
    requiredFieldCompletion,
    missingFields: missing,
    complete: missing.length === 0,
  }
}

/** True when `body` accidentally fulfills a *different* agent's required fields. */
export function accidentallyFulfillsContract(
  body: Record<string, unknown>,
  otherAgentId: NebulaAgentId,
  minimumCompletion = 0.8,
): boolean {
  return checkOutputContract(otherAgentId, body).requiredFieldCompletion >= minimumCompletion
}

export function outputContractIdFor(agentId: NebulaAgentId): OutputContractId {
  return OUTPUT_CONTRACTS[agentId].contractId
}

export function everyAgentHasOutputContract(): boolean {
  return NEBULA_AGENT_IDS.every(id => {
    const spec = OUTPUT_CONTRACTS[id]
    return spec.agentId === id && spec.contractId === NEBULA_ROLE_CONTRACTS[id].requiredOutputContract && spec.fields.length > 0
  })
}

export function schemaPromptFor(agentId: NebulaAgentId): string {
  const spec = OUTPUT_CONTRACTS[agentId]
  const fields = spec.fields.map(field => `- ${field.field}: ${field.description}`).join('\n')
  return [
    `Write a Commander-facing answer in clean natural prose as ${spec.agentId.toUpperCase()}.`,
    'Do not dump JSON, schema field names, or structured objects into the visible answer.',
    'Do not include <think> blocks, hidden reasoning, or scratchpad text.',
    `Internally consider these fields for ${spec.contractId}, but keep them out of chat:`,
    fields,
  ].join('\n')
}
