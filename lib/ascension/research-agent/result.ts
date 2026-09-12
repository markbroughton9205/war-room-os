/**
 * #22 Phase 2 — RESEARCH_AGENT structured result contract.
 * No hidden chain-of-thought — structured findings + evidence refs only.
 */
import type { LiveResearchEvidencePacket } from '@/lib/runtime/liveResearchEvidencePacket'
import type { ResearchAgentIdentity } from './identity'
import type { ResearchAgentScope } from './scope'

export const RESEARCH_AGENT_STATUSES = [
  'COMPLETE',
  'PARTIAL',
  'DEGRADED',
  'FAILED',
  'DENIED',
] as const
export type ResearchAgentStatus = (typeof RESEARCH_AGENT_STATUSES)[number]

export type ResearchFindingSupport =
  | 'SUPPORTED'
  | 'INFERRED'
  | 'UNVERIFIED'
  | 'CONFLICTING'
  | 'UNAVAILABLE'
  | 'STALE'
  | 'NO_COVERAGE'

export type ResearchAgentFinding = {
  statement: string
  support: ResearchFindingSupport
  evidence_refs: string[]
}

export type ResearchAgentDenial = {
  capability_or_action: string
  reason_code: string
  reason: string
}

export type ResearchAgentResult = {
  agent_id: string
  agent_role: 'RESEARCH_AGENT'
  status: ResearchAgentStatus
  research_question: string
  summary: string
  findings: ResearchAgentFinding[]
  evidence_refs: string[]
  terra_refs: string[]
  sources: Array<{ kind: string; ok: boolean; urls?: string[]; error?: string }>
  freshness_summary: string
  confidence: number
  limitations: string[]
  denials: ResearchAgentDenial[]
  unavailable_capabilities: string[]
  started_at: string
  completed_at: string
  mission_id: string | null
  conversation_id: string | null
  owner_user_id: string
  audit_id: string | null
  identity: ResearchAgentIdentity
  scope: ResearchAgentScope
  /** Structured evidence packet for Council — not private reasoning. */
  evidence_packet: LiveResearchEvidencePacket | null
  /** Explicit: findings are not Council conclusions or execution authorization. */
  boundary_notes: readonly string[]
}

export const RESEARCH_AGENT_BOUNDARY_NOTES = Object.freeze([
  'RESEARCH_AGENT FINDING != COUNCIL CONCLUSION',
  'COUNCIL RECOMMENDATION != EXECUTION AUTHORIZATION',
  'MISSION CREATED != ACTION AUTHORIZED',
  'SESSION_BOUNDED_READ_ONLY_DISCOVERY only',
] as const)

export function classifyResultStatus(input: {
  denied: boolean
  usedLiveResearch: boolean
  providerFailures: number
  providerOk: number
  findingsEmpty: boolean
}): ResearchAgentStatus {
  if (input.denied) return 'DENIED'
  if (!input.usedLiveResearch && input.providerOk === 0) return 'FAILED'
  if (input.providerFailures > 0 && input.providerOk > 0) {
    return input.findingsEmpty ? 'DEGRADED' : 'PARTIAL'
  }
  if (input.providerFailures > 0 && input.providerOk === 0) return 'FAILED'
  if (input.findingsEmpty) return 'PARTIAL'
  return 'COMPLETE'
}
