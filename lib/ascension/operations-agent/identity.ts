/**
 * #22 Phase 5 — OPERATIONS_AGENT identity.
 */
export const OPERATIONS_AGENT_ROLE = 'OPERATIONS_AGENT' as const
export type OperationsAgentRole = typeof OPERATIONS_AGENT_ROLE

export const OPERATIONS_AGENT_RUNTIME_VERSION = 'ascension-phase5-v1' as const

export const OPERATIONS_AGENT_POLICY_PROFILE = 'BOUNDED_OPERATIONAL_DIAGNOSTICS' as const

export const OPERATIONS_AGENT_AUTONOMOUS_EXECUTION_ENABLED = false as const

export function isOperationsAgentRuntimeAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ASCENSION_OPERATIONS_AGENT_ENABLED !== 'false'
}

export type OperationsAgentIdentity = {
  agent_id: string
  agent_role: OperationsAgentRole
  runtime_version: typeof OPERATIONS_AGENT_RUNTIME_VERSION
  request_id: string
  mission_id: string | null
  owner_user_id: string
  conversation_id: string | null
  requested_by: string
  targets: string[]
  allowed_diagnostics: string[]
  created_at: string
  expires_at: string | null
  policy_profile: typeof OPERATIONS_AGENT_POLICY_PROFILE
}

export function createOperationsAgentIdentity(input: {
  requestId: string
  ownerUserId: string
  requestedBy: string
  targets: string[]
  allowedDiagnostics: string[]
  missionId?: string | null
  conversationId?: string | null
  expiresAt?: string | null
  nowIso?: string
}): OperationsAgentIdentity {
  return {
    agent_id: `operations_agent:${input.requestId}`,
    agent_role: OPERATIONS_AGENT_ROLE,
    runtime_version: OPERATIONS_AGENT_RUNTIME_VERSION,
    request_id: input.requestId,
    mission_id: input.missionId ?? null,
    owner_user_id: input.ownerUserId,
    conversation_id: input.conversationId ?? null,
    requested_by: input.requestedBy,
    targets: [...input.targets],
    allowed_diagnostics: [...input.allowedDiagnostics],
    created_at: input.nowIso ?? new Date().toISOString(),
    expires_at: input.expiresAt ?? null,
    policy_profile: OPERATIONS_AGENT_POLICY_PROFILE,
  }
}
