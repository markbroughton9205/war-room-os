/**
 * #22 Phase 2 — Ascension RESEARCH_AGENT identity.
 * Canonical role: RESEARCH_AGENT. No aliases.
 */
export const RESEARCH_AGENT_ROLE = 'RESEARCH_AGENT' as const
export type ResearchAgentRole = typeof RESEARCH_AGENT_ROLE

export const RESEARCH_AGENT_RUNTIME_VERSION = 'ascension-phase2-v1' as const

export const RESEARCH_AGENT_POLICY_PROFILE = 'SESSION_BOUNDED_READ_ONLY_DISCOVERY' as const

/** Soft kill-switch — default available. Does NOT enable Ascension autonomy. */
export function isResearchAgentRuntimeAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ASCENSION_RESEARCH_AGENT_ENABLED !== 'false'
}

/** Autonomy remains OFF — invocation-driven only. */
export const RESEARCH_AGENT_AUTONOMOUS_EXECUTION_ENABLED = false as const

export type ResearchAgentIdentity = {
  agent_id: string
  agent_role: ResearchAgentRole
  runtime_version: typeof RESEARCH_AGENT_RUNTIME_VERSION
  mission_id: string | null
  request_id: string
  owner_user_id: string | null
  conversation_id: string | null
  council_round: string | number | null
  created_at: string
  scope: string
  policy_profile: typeof RESEARCH_AGENT_POLICY_PROFILE
}

export function createResearchAgentIdentity(input: {
  requestId: string
  ownerUserId?: string | null
  conversationId?: string | null
  missionId?: string | null
  councilRound?: string | number | null
  scopeLabel: string
  nowIso?: string
}): ResearchAgentIdentity {
  return {
    agent_id: `research_agent:${input.requestId}`,
    agent_role: RESEARCH_AGENT_ROLE,
    runtime_version: RESEARCH_AGENT_RUNTIME_VERSION,
    mission_id: input.missionId ?? null,
    request_id: input.requestId,
    owner_user_id: input.ownerUserId ?? null,
    conversation_id: input.conversationId ?? null,
    council_round: input.councilRound ?? null,
    created_at: input.nowIso ?? new Date().toISOString(),
    scope: input.scopeLabel,
    policy_profile: RESEARCH_AGENT_POLICY_PROFILE,
  }
}
