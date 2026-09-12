/**
 * #22 Phase 4 — SECURITY_RED_TEAM_AGENT identity.
 */
export const SECURITY_RED_TEAM_AGENT_ROLE = 'SECURITY_RED_TEAM_AGENT' as const
export type SecurityRedTeamAgentRole = typeof SECURITY_RED_TEAM_AGENT_ROLE

export const SECURITY_RED_TEAM_AGENT_RUNTIME_VERSION = 'ascension-phase4-v1' as const

export const SECURITY_RED_TEAM_AGENT_POLICY_PROFILE = 'BOUNDED_SECURITY_EVALUATION' as const

export const SECURITY_RED_TEAM_AGENT_AUTONOMOUS_EXECUTION_ENABLED = false as const

export function isSecurityRedTeamAgentRuntimeAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ASCENSION_SECURITY_RED_TEAM_AGENT_ENABLED !== 'false'
}

export type SecurityRedTeamAgentIdentity = {
  agent_id: string
  agent_role: SecurityRedTeamAgentRole
  runtime_version: typeof SECURITY_RED_TEAM_AGENT_RUNTIME_VERSION
  request_id: string
  mission_id: string | null
  owner_user_id: string
  conversation_id: string | null
  requested_by: string
  scope: string
  targets: string[]
  allowed_probe_classes: string[]
  denied_probe_classes: string[]
  created_at: string
  expires_at: string | null
  policy_profile: typeof SECURITY_RED_TEAM_AGENT_POLICY_PROFILE
}

export function createSecurityRedTeamAgentIdentity(input: {
  requestId: string
  ownerUserId: string
  requestedBy: string
  targets: string[]
  allowedProbeClasses: string[]
  deniedProbeClasses: string[]
  missionId?: string | null
  conversationId?: string | null
  expiresAt?: string | null
  nowIso?: string
}): SecurityRedTeamAgentIdentity {
  return {
    agent_id: `security_red_team_agent:${input.requestId}`,
    agent_role: SECURITY_RED_TEAM_AGENT_ROLE,
    runtime_version: SECURITY_RED_TEAM_AGENT_RUNTIME_VERSION,
    request_id: input.requestId,
    mission_id: input.missionId ?? null,
    owner_user_id: input.ownerUserId,
    conversation_id: input.conversationId ?? null,
    requested_by: input.requestedBy,
    scope: SECURITY_RED_TEAM_AGENT_POLICY_PROFILE,
    targets: [...input.targets],
    allowed_probe_classes: [...input.allowedProbeClasses],
    denied_probe_classes: [...input.deniedProbeClasses],
    created_at: input.nowIso ?? new Date().toISOString(),
    expires_at: input.expiresAt ?? null,
    policy_profile: SECURITY_RED_TEAM_AGENT_POLICY_PROFILE,
  }
}
