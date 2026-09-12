/**
 * #22 Phase 6 — TERRA_INTELLIGENCE_AGENT identity.
 */
export const TERRA_INTELLIGENCE_AGENT_ROLE = 'TERRA_INTELLIGENCE_AGENT' as const
export type TerraIntelligenceAgentRole = typeof TERRA_INTELLIGENCE_AGENT_ROLE

export const TERRA_INTELLIGENCE_AGENT_RUNTIME_VERSION = 'ascension-phase6-v1' as const

export const TERRA_INTELLIGENCE_AGENT_POLICY_PROFILE = 'BOUNDED_TERRA_WORLD_STATE_ANALYSIS' as const

export const TERRA_INTELLIGENCE_AGENT_AUTONOMOUS_EXECUTION_ENABLED = false as const

export function isTerraIntelligenceAgentRuntimeAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ASCENSION_TERRA_INTELLIGENCE_AGENT_ENABLED !== 'false'
}

export type TerraIntelligenceAgentIdentity = {
  agent_id: string
  agent_role: TerraIntelligenceAgentRole
  runtime_version: typeof TERRA_INTELLIGENCE_AGENT_RUNTIME_VERSION
  request_id: string
  mission_id: string | null
  owner_user_id: string
  conversation_id: string | null
  requested_by: string
  scope: string
  geographic_scope: string | null
  time_scope: string | null
  provider_scope: string[] | null
  allowed_query_classes: string[]
  created_at: string
  expires_at: string | null
  policy_profile: typeof TERRA_INTELLIGENCE_AGENT_POLICY_PROFILE
}

export function createTerraIntelligenceAgentIdentity(input: {
  requestId: string
  ownerUserId: string
  requestedBy: string
  allowedQueryClasses: string[]
  geographicScope?: string | null
  timeScope?: string | null
  providerScope?: string[] | null
  missionId?: string | null
  conversationId?: string | null
  expiresAt?: string | null
  nowIso?: string
}): TerraIntelligenceAgentIdentity {
  return {
    agent_id: `terra_intelligence_agent:${input.requestId}`,
    agent_role: TERRA_INTELLIGENCE_AGENT_ROLE,
    runtime_version: TERRA_INTELLIGENCE_AGENT_RUNTIME_VERSION,
    request_id: input.requestId,
    mission_id: input.missionId ?? null,
    owner_user_id: input.ownerUserId,
    conversation_id: input.conversationId ?? null,
    requested_by: input.requestedBy,
    scope: TERRA_INTELLIGENCE_AGENT_POLICY_PROFILE,
    geographic_scope: input.geographicScope ?? null,
    time_scope: input.timeScope ?? null,
    provider_scope: input.providerScope ? [...input.providerScope] : null,
    allowed_query_classes: [...input.allowedQueryClasses],
    created_at: input.nowIso ?? new Date().toISOString(),
    expires_at: input.expiresAt ?? null,
    policy_profile: TERRA_INTELLIGENCE_AGENT_POLICY_PROFILE,
  }
}
