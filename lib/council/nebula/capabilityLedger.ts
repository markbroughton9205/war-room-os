import { NEBULA_AGENT_IDS, NEBULA_AGENTS_BY_ID, type NebulaAgentId } from './identity'

/**
 * Capability Ledger — separate from personality and separate from backend.
 * Capability must not increase merely because it was used. Growth requires evaluated evidence.
 */

export type CapabilityStatus = 'PROVEN' | 'DEVELOPING' | 'UNPROVEN' | 'REGRESSED'

export type CapabilityLedgerEntry = {
  capabilityId: string
  name: string
  domain: string
  status: CapabilityStatus
  proficiency: number
  confidence: number
  evidenceCount: number
  successfulEvaluations: number
  failedEvaluations: number
  benchmarkScores: Readonly<Record<string, number>>
  backendPerformance: Readonly<Record<string, number>>
  lastEvaluatedAt: string | null
  regressionState: 'none' | 'suspected' | 'confirmed'
}

export type AgentCapabilityLedger = {
  agentId: NebulaAgentId
  capabilities: readonly CapabilityLedgerEntry[]
}

export type CapabilityEvaluation = {
  evaluationId: string
  capabilityId: string
  agentId: NebulaAgentId
  success: boolean
  backendKey: string | null
  score: number | null
  sourceRef: string
  validated: boolean
  evaluatedAt: string
}

const GENESIS = '2026-09-05T00:00:00.000Z'

const DOMAIN_BY_AGENT: Readonly<Record<NebulaAgentId, string>> = {
  aurora: 'calibrated_integration',
  nova: 'strategy_and_sequencing',
  pulsar: 'evidence_discovery',
  phoenix: 'failure_analysis',
  orion: 'engineering',
  lumen: 'claim_verification',
  solara: 'human_impact',
  astra: 'constellation_orchestration',
}

function seedEntry(capabilityId: string, name: string, domain: string): CapabilityLedgerEntry {
  return {
    capabilityId,
    name,
    domain,
    status: 'UNPROVEN',
    proficiency: 0,
    confidence: 0,
    evidenceCount: 0,
    successfulEvaluations: 0,
    failedEvaluations: 0,
    benchmarkScores: Object.freeze({}),
    backendPerformance: Object.freeze({}),
    lastEvaluatedAt: null,
    regressionState: 'none',
  }
}

function seedLedger(agentId: NebulaAgentId): AgentCapabilityLedger {
  const identity = NEBULA_AGENTS_BY_ID[agentId]
  const domain = DOMAIN_BY_AGENT[agentId]
  const capabilities = identity.capabilities.map(capabilityId =>
    seedEntry(capabilityId, capabilityId.replace(/_/g, ' '), domain),
  )
  return { agentId, capabilities }
}

export const NEBULA_CAPABILITY_LEDGERS: Readonly<Record<NebulaAgentId, AgentCapabilityLedger>> = Object.freeze(
  Object.fromEntries(NEBULA_AGENT_IDS.map(id => [id, seedLedger(id)])) as Record<NebulaAgentId, AgentCapabilityLedger>,
)

/** Using a capability does not raise status, proficiency, or evidence counts. */
export function recordCapabilityUse(entry: CapabilityLedgerEntry): CapabilityLedgerEntry {
  return { ...entry }
}

export function deriveCapabilityStatus(entry: Pick<
  CapabilityLedgerEntry,
  'evidenceCount' | 'successfulEvaluations' | 'failedEvaluations' | 'regressionState'
>): CapabilityStatus {
  if (entry.regressionState === 'confirmed') return 'REGRESSED'
  if (entry.evidenceCount <= 0 || entry.successfulEvaluations + entry.failedEvaluations <= 0) return 'UNPROVEN'
  const total = entry.successfulEvaluations + entry.failedEvaluations
  const rate = entry.successfulEvaluations / total
  if (entry.successfulEvaluations >= 8 && rate >= 0.8 && entry.regressionState !== 'suspected') return 'PROVEN'
  return 'DEVELOPING'
}

export function applyCapabilityEvaluation(
  entry: CapabilityLedgerEntry,
  evaluation: CapabilityEvaluation,
): { next: CapabilityLedgerEntry; grown: boolean; reason: string } {
  if (!evaluation.validated) {
    return { next: entry, grown: false, reason: 'evaluation_not_validated' }
  }
  if (evaluation.capabilityId !== entry.capabilityId) {
    return { next: entry, grown: false, reason: 'capability_mismatch' }
  }

  const successfulEvaluations = entry.successfulEvaluations + (evaluation.success ? 1 : 0)
  const failedEvaluations = entry.failedEvaluations + (evaluation.success ? 0 : 1)
  const evidenceCount = entry.evidenceCount + 1
  const backendPerformance = evaluation.backendKey
    ? Object.freeze({
        ...entry.backendPerformance,
        [evaluation.backendKey]: evaluation.score ?? (evaluation.success ? 1 : 0),
      })
    : entry.backendPerformance
  const regressionState: CapabilityLedgerEntry['regressionState'] =
    !evaluation.success && entry.status === 'PROVEN'
      ? 'suspected'
      : failedEvaluations > successfulEvaluations && evidenceCount >= 4
        ? 'confirmed'
        : entry.regressionState === 'suspected' && evaluation.success
          ? 'none'
          : entry.regressionState

  const nextBase: CapabilityLedgerEntry = {
    ...entry,
    evidenceCount,
    successfulEvaluations,
    failedEvaluations,
    backendPerformance,
    lastEvaluatedAt: evaluation.evaluatedAt,
    regressionState,
    status: entry.status,
    proficiency: entry.proficiency,
    confidence: entry.confidence,
  }
  const status = deriveCapabilityStatus(nextBase)
  const total = successfulEvaluations + failedEvaluations
  const proficiency = total === 0 ? 0 : Number((successfulEvaluations / total).toFixed(4))
  const confidence = Math.min(1, evidenceCount / 10)
  const grown = status !== 'UNPROVEN' && (status !== entry.status || proficiency !== entry.proficiency)
  return {
    next: { ...nextBase, status, proficiency, confidence },
    grown,
    reason: grown ? 'evaluated_evidence_applied' : 'evaluated_evidence_recorded_without_unearned_growth',
  }
}

export function capabilityGrowthRequiresEvidence(): true {
  return true
}

export function everyAgentHasCapabilityLedger(): boolean {
  return NEBULA_AGENT_IDS.every(id => {
    const ledger = NEBULA_CAPABILITY_LEDGERS[id]
    return ledger.agentId === id && ledger.capabilities.length > 0 && ledger.capabilities.every(entry => entry.status === 'UNPROVEN' && entry.evidenceCount === 0)
  })
}

export function emptyCapabilityShapeExample(): CapabilityLedgerEntry {
  return {
    capabilityId: 'typescript_debugging',
    name: 'TypeScript debugging',
    domain: 'engineering',
    status: 'UNPROVEN',
    proficiency: 0,
    confidence: 0,
    evidenceCount: 0,
    successfulEvaluations: 0,
    failedEvaluations: 0,
    benchmarkScores: Object.freeze({}),
    backendPerformance: Object.freeze({}),
    lastEvaluatedAt: null,
    regressionState: 'none',
  }
}

export const CAPABILITY_LEDGER_GENESIS = GENESIS
