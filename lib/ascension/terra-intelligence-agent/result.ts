/**
 * #22 Phase 6 — Terra intelligence finding + result contracts. No hidden CoT.
 */
import type { TerraIntelligenceAgentIdentity } from './identity'
import type { TerraIntelligenceScope } from './scope'
import type { TerraLiveFreshness } from '@/lib/terra/liveGeoIntelligence'

export const TERRA_CONFIDENCE_KINDS = [
  'SOURCE_REPORTED',
  'DIRECT_OBSERVATION_FROM_FEED',
  'NORMALIZED',
  'INFERRED',
  'ESTIMATED',
  'CONFLICTING',
  'UNVERIFIED',
] as const
export type TerraConfidenceKind = (typeof TERRA_CONFIDENCE_KINDS)[number]

export const TERRA_CORRELATION_STATES = [
  'CORROBORATED',
  'SINGLE_SOURCE',
  'CONFLICTING',
  'INSUFFICIENT_EVIDENCE',
] as const
export type TerraCorrelationState = (typeof TERRA_CORRELATION_STATES)[number]

export const TERRA_INTELLIGENCE_STATUSES = [
  'COMPLETE',
  'PARTIAL',
  'DEGRADED',
  'FAILED',
  'DENIED',
  'NO_COVERAGE',
] as const
export type TerraIntelligenceStatus = (typeof TERRA_INTELLIGENCE_STATUSES)[number]

export type TerraWorldStateFinding = {
  finding_id: string
  title: string
  statement: string
  confidence: TerraConfidenceKind
  freshness: TerraLiveFreshness | string
  correlation: TerraCorrelationState
  evidence_refs: string[]
  provider_refs: string[]
  coverage_note: string | null
}

export type TerraWorldStateObject = {
  object_id: string
  type: string
  category: string
  title: string
  location: { latitude: number; longitude: number } | null
  observed_at: string | null
  retrieved_at: string | null
  provider: string
  freshness: TerraLiveFreshness | string
  confidence: TerraConfidenceKind
  provenance: string
  truth_status: string
  coverage_status: string
}

export type TerraIntelligenceDenial = {
  capability_or_action: string
  reason_code: string
  reason: string
}

export type TerraIntelligenceResult = {
  agent_id: string
  agent_role: 'TERRA_INTELLIGENCE_AGENT'
  status: TerraIntelligenceStatus
  world_state_question: string
  scope: TerraIntelligenceScope
  summary: string
  findings: TerraWorldStateFinding[]
  objects: TerraWorldStateObject[]
  events: Array<Record<string, unknown>>
  evidence_refs: string[]
  provider_refs: string[]
  sources: Array<{ provider: string; freshness: string; implemented: boolean; reason?: string }>
  freshness_summary: string
  coverage_summary: string
  confidence: TerraConfidenceKind
  conflicts: string[]
  limitations: string[]
  denials: TerraIntelligenceDenial[]
  unavailable_capabilities: string[]
  recommended_council_questions: string[]
  started_at: string
  completed_at: string
  owner_scope: string
  mission_id: string | null
  conversation_id: string | null
  audit_id: string | null
  identity: TerraIntelligenceAgentIdentity
  boundary_notes: readonly string[]
  plan_summary: string
  gps_state: 'NOT_IMPLEMENTED'
  traffic_state: 'NOT_IMPLEMENTED'
  planetary_descent_state: 'ABSENT'
}

export const TERRA_INTELLIGENCE_BOUNDARY_NOTES = Object.freeze([
  'TERRA != TERRA_INTELLIGENCE_AGENT',
  'OBSERVATION != AUTHORIZATION',
  'WORLD-STATE FINDING != MISSION AUTHORIZATION',
  'HIGH CONFIDENCE != HIGHER AUTHORITY',
  'TERRA SELECTION != COUNCIL SEND',
  'TERRA SELECTION != ASTRA MISSION',
  'TERRA FINDING != COUNCIL CONCLUSION',
  'COUNCIL CONCLUSION != EXECUTION AUTHORIZATION',
  'NO ACTION AUTHORITY',
  'ASCENSION AUTONOMY OFF',
] as const)

export function makeFinding(
  partial: Omit<TerraWorldStateFinding, 'finding_id'> & { finding_id?: string },
): TerraWorldStateFinding {
  return {
    finding_id: partial.finding_id ?? `terra_finding_${Math.random().toString(36).slice(2, 10)}`,
    title: partial.title,
    statement: partial.statement,
    confidence: partial.confidence,
    freshness: partial.freshness,
    correlation: partial.correlation,
    evidence_refs: partial.evidence_refs,
    provider_refs: partial.provider_refs,
    coverage_note: partial.coverage_note,
  }
}

export function classifyTerraIntelligenceStatus(input: {
  denied: boolean
  queryFailed: boolean
  noCoverage: boolean
  objects: number
  providerFailures: number
  providerOk: number
}): TerraIntelligenceStatus {
  if (input.denied) return 'DENIED'
  if (input.queryFailed && input.objects === 0 && input.providerOk === 0) return 'FAILED'
  if (input.noCoverage && input.objects === 0) return 'NO_COVERAGE'
  if (input.providerFailures > 0 && input.providerOk > 0) return input.objects > 0 ? 'PARTIAL' : 'DEGRADED'
  if (input.providerFailures > 0 && input.objects === 0) return 'DEGRADED'
  if (input.objects === 0) return 'PARTIAL'
  return 'COMPLETE'
}
