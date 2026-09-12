/**
 * #22 Phase 12 — NAVIGATION_AGENT identity.
 * One canonical bounded navigation reasoning agent. Not Terra. Not Navigation2.
 */
export const NAVIGATION_AGENT_ROLE = 'NAVIGATION_AGENT' as const
export type NavigationAgentRole = typeof NAVIGATION_AGENT_ROLE

export const NAVIGATION_AGENT_RUNTIME_VERSION = 'ascension-phase12-v1' as const

export const NAVIGATION_AGENT_POLICY_PROFILE = 'BOUNDED_NAVIGATION_REASONING' as const

export const NAVIGATION_AGENT_AUTONOMOUS_EXECUTION_ENABLED = false as const

export { ROADMAP_23_STATUS } from '@/lib/wr-corpus/identity'

export function isNavigationAgentRuntimeAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ASCENSION_NAVIGATION_AGENT_ENABLED !== 'false'
}

export type NavigationAgentIdentity = {
  agent_id: string
  agent_role: NavigationAgentRole
  runtime_version: typeof NAVIGATION_AGENT_RUNTIME_VERSION
  request_id: string
  mission_id: string | null
  owner_user_id: string
  conversation_id: string | null
  requested_by: string
  scope: string
  task_type: string
  allowed_operations: string[]
  created_at: string
  expires_at: string | null
  policy_profile: typeof NAVIGATION_AGENT_POLICY_PROFILE
}

export function createNavigationAgentIdentity(input: {
  requestId: string
  ownerUserId: string
  requestedBy: string
  allowedOperations: string[]
  taskType: string
  missionId?: string | null
  conversationId?: string | null
  expiresAt?: string | null
  nowIso?: string
}): NavigationAgentIdentity {
  return {
    agent_id: `navigation_agent:${input.requestId}`,
    agent_role: NAVIGATION_AGENT_ROLE,
    runtime_version: NAVIGATION_AGENT_RUNTIME_VERSION,
    request_id: input.requestId,
    mission_id: input.missionId ?? null,
    owner_user_id: input.ownerUserId,
    conversation_id: input.conversationId ?? null,
    requested_by: input.requestedBy,
    scope: NAVIGATION_AGENT_POLICY_PROFILE,
    task_type: input.taskType,
    allowed_operations: [...input.allowedOperations],
    created_at: input.nowIso ?? new Date().toISOString(),
    expires_at: input.expiresAt ?? null,
    policy_profile: NAVIGATION_AGENT_POLICY_PROFILE,
  }
}
