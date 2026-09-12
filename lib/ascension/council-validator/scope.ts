/**
 * #22 Phase 7 — Bounded Council validation scope.
 */
import { COUNCIL_VALIDATOR_ALLOWED_READ_CLASSES } from './profile'

export const COUNCIL_VALIDATOR_DEFAULT_BOUNDS = Object.freeze({
  max_claims: 40,
  max_evidence_refs: 60,
  max_agent_results: 20,
  max_runtime_ms: 60_000,
  max_validation_rounds: 1,
  max_revision_requests: 1,
} as const)

export type CouncilValidatorScope = {
  conversation_id: string
  round_id: string | null
  owner_user_id: string
  requested_by: string
  claim_set: string[]
  evidence_refs: string[]
  agent_result_refs: string[]
  policy_refs: string[] | null
  runtime_truth_refs: string[] | null
  allowed_read_classes: string[]
  max_claims: number
  max_evidence_refs: number
  max_agent_results: number
  max_runtime_ms: number
  max_validation_rounds: number
  max_revision_requests: number
  created_at: string
  expires_at: string | null
}

export function createCouncilValidatorScope(input: {
  conversationId: string
  ownerUserId: string
  requestedBy: string
  roundId?: string | null
  claimSet?: string[]
  evidenceRefs?: string[]
  agentResultRefs?: string[]
  policyRefs?: string[] | null
  runtimeTruthRefs?: string[] | null
  allowedReadClasses?: string[]
  expiresAt?: string | null
  nowIso?: string
  bounds?: Partial<typeof COUNCIL_VALIDATOR_DEFAULT_BOUNDS>
}): CouncilValidatorScope {
  const bounds = { ...COUNCIL_VALIDATOR_DEFAULT_BOUNDS, ...input.bounds }
  const classes = input.allowedReadClasses?.length
    ? input.allowedReadClasses.filter(c =>
        (COUNCIL_VALIDATOR_ALLOWED_READ_CLASSES as readonly string[]).includes(c),
      )
    : [...COUNCIL_VALIDATOR_ALLOWED_READ_CLASSES]

  return {
    conversation_id: input.conversationId,
    round_id: input.roundId ?? null,
    owner_user_id: input.ownerUserId,
    requested_by: input.requestedBy,
    claim_set: [...(input.claimSet ?? [])].slice(0, bounds.max_claims),
    evidence_refs: [...(input.evidenceRefs ?? [])].slice(0, bounds.max_evidence_refs),
    agent_result_refs: [...(input.agentResultRefs ?? [])].slice(0, bounds.max_agent_results),
    policy_refs: input.policyRefs ? [...input.policyRefs] : null,
    runtime_truth_refs: input.runtimeTruthRefs ? [...input.runtimeTruthRefs] : null,
    allowed_read_classes: classes,
    max_claims: bounds.max_claims,
    max_evidence_refs: bounds.max_evidence_refs,
    max_agent_results: bounds.max_agent_results,
    max_runtime_ms: bounds.max_runtime_ms,
    max_validation_rounds: bounds.max_validation_rounds,
    max_revision_requests: bounds.max_revision_requests,
    created_at: input.nowIso ?? new Date().toISOString(),
    expires_at: input.expiresAt ?? null,
  }
}

export function isCouncilValidatorScopeExpired(scope: CouncilValidatorScope, nowMs = Date.now()): boolean {
  if (!scope.expires_at) return false
  const t = Date.parse(scope.expires_at)
  return Number.isFinite(t) && nowMs > t
}
