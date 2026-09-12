/**
 * #22 Phase 3 — ENGINEERING_AGENT identity.
 */
export const ENGINEERING_AGENT_ROLE = 'ENGINEERING_AGENT' as const
export type EngineeringAgentRole = typeof ENGINEERING_AGENT_ROLE

export const ENGINEERING_AGENT_RUNTIME_VERSION = 'ascension-phase3-v1' as const

export const ENGINEERING_AGENT_POLICY_PROFILE = 'BOUNDED_ISOLATED_WORKTREE_ENGINEERING' as const

export const ENGINEERING_AGENT_AUTONOMOUS_EXECUTION_ENABLED = false as const

export function isEngineeringAgentRuntimeAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ASCENSION_ENGINEERING_AGENT_ENABLED !== 'false'
}

export type EngineeringAgentIdentity = {
  agent_id: string
  agent_role: EngineeringAgentRole
  runtime_version: typeof ENGINEERING_AGENT_RUNTIME_VERSION
  request_id: string
  mission_id: string | null
  owner_user_id: string
  conversation_id: string | null
  requested_by: string
  approved_worktree: string
  repository_root: string
  scope: string
  allowed_paths: string[]
  allowed_commands: string[]
  created_at: string
  deadline: string | null
  policy_profile: typeof ENGINEERING_AGENT_POLICY_PROFILE
}

export function createEngineeringAgentIdentity(input: {
  requestId: string
  ownerUserId: string
  requestedBy: string
  approvedWorktree: string
  repositoryRoot: string
  allowedPaths: string[]
  allowedCommands: string[]
  missionId?: string | null
  conversationId?: string | null
  deadline?: string | null
  nowIso?: string
}): EngineeringAgentIdentity {
  return {
    agent_id: `engineering_agent:${input.requestId}`,
    agent_role: ENGINEERING_AGENT_ROLE,
    runtime_version: ENGINEERING_AGENT_RUNTIME_VERSION,
    request_id: input.requestId,
    mission_id: input.missionId ?? null,
    owner_user_id: input.ownerUserId,
    conversation_id: input.conversationId ?? null,
    requested_by: input.requestedBy,
    approved_worktree: input.approvedWorktree,
    repository_root: input.repositoryRoot,
    scope: ENGINEERING_AGENT_POLICY_PROFILE,
    allowed_paths: [...input.allowedPaths],
    allowed_commands: [...input.allowedCommands],
    created_at: input.nowIso ?? new Date().toISOString(),
    deadline: input.deadline ?? null,
    policy_profile: ENGINEERING_AGENT_POLICY_PROFILE,
  }
}
