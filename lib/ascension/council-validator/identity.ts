/**
 * #22 Phase 7 — COUNCIL_VALIDATOR identity.
 */
export const COUNCIL_VALIDATOR_ROLE = 'COUNCIL_VALIDATOR' as const
export type CouncilValidatorRole = typeof COUNCIL_VALIDATOR_ROLE

export const COUNCIL_VALIDATOR_RUNTIME_VERSION = 'ascension-phase7-v1' as const

export const COUNCIL_VALIDATOR_POLICY_PROFILE = 'BOUNDED_COUNCIL_VALIDATION' as const

export const COUNCIL_VALIDATOR_AUTONOMOUS_EXECUTION_ENABLED = false as const

export function isCouncilValidatorRuntimeAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ASCENSION_COUNCIL_VALIDATOR_ENABLED !== 'false'
}

export type CouncilValidatorIdentity = {
  agent_id: string
  agent_role: CouncilValidatorRole
  runtime_version: typeof COUNCIL_VALIDATOR_RUNTIME_VERSION
  request_id: string
  mission_id: string | null
  conversation_id: string | null
  owner_user_id: string
  requested_by: string
  round_id: string | null
  validation_scope: string
  evidence_refs: string[]
  created_at: string
  expires_at: string | null
  policy_profile: typeof COUNCIL_VALIDATOR_POLICY_PROFILE
}

export function createCouncilValidatorIdentity(input: {
  requestId: string
  ownerUserId: string
  requestedBy: string
  evidenceRefs?: string[]
  missionId?: string | null
  conversationId?: string | null
  roundId?: string | null
  expiresAt?: string | null
  nowIso?: string
}): CouncilValidatorIdentity {
  return {
    agent_id: `council_validator:${input.requestId}`,
    agent_role: COUNCIL_VALIDATOR_ROLE,
    runtime_version: COUNCIL_VALIDATOR_RUNTIME_VERSION,
    request_id: input.requestId,
    mission_id: input.missionId ?? null,
    conversation_id: input.conversationId ?? null,
    owner_user_id: input.ownerUserId,
    requested_by: input.requestedBy,
    round_id: input.roundId ?? null,
    validation_scope: COUNCIL_VALIDATOR_POLICY_PROFILE,
    evidence_refs: [...(input.evidenceRefs ?? [])],
    created_at: input.nowIso ?? new Date().toISOString(),
    expires_at: input.expiresAt ?? null,
    policy_profile: COUNCIL_VALIDATOR_POLICY_PROFILE,
  }
}
