/**
 * #22 Phase 13 — WORLD_LEARNING_AGENT identity.
 * One canonical bounded world-knowledge acquisition agent.
 * Not WR-CORPUS, WR-TOKENIZER, WRIM, Ra'el, Research2, or Corpus2.
 */
export const WORLD_LEARNING_AGENT_ROLE = 'WORLD_LEARNING_AGENT' as const
export type WorldLearningAgentRole = typeof WORLD_LEARNING_AGENT_ROLE

export const WORLD_LEARNING_AGENT_RUNTIME_VERSION = 'ascension-phase13-v1' as const

export const WORLD_LEARNING_AGENT_POLICY_PROFILE = 'BOUNDED_WORLD_KNOWLEDGE_ACQUISITION' as const

export const WORLD_LEARNING_AGENT_AUTONOMOUS_EXECUTION_ENABLED = false as const

export {
  ROADMAP_23_STATUS,
  WR_CORPUS_STATUS,
  WR_TOKENIZER_STATUS,
  WRIM_STATUS,
  RAEL_STATUS,
  MODEL_TRAINING_STATUS,
  AUTONOMOUS_CORPUS_PERSISTENCE,
} from '@/lib/wr-corpus/identity'

export function isWorldLearningAgentRuntimeAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ASCENSION_WORLD_LEARNING_AGENT_ENABLED !== 'false'
}

export type WorldLearningAgentIdentity = {
  agent_id: string
  agent_role: WorldLearningAgentRole
  runtime_version: typeof WORLD_LEARNING_AGENT_RUNTIME_VERSION
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
  policy_profile: typeof WORLD_LEARNING_AGENT_POLICY_PROFILE
}

export function createWorldLearningAgentIdentity(input: {
  requestId: string
  ownerUserId: string
  requestedBy: string
  allowedOperations: string[]
  taskType: string
  missionId?: string | null
  conversationId?: string | null
  expiresAt?: string | null
  nowIso?: string
}): WorldLearningAgentIdentity {
  return {
    agent_id: `world_learning_agent:${input.requestId}`,
    agent_role: WORLD_LEARNING_AGENT_ROLE,
    runtime_version: WORLD_LEARNING_AGENT_RUNTIME_VERSION,
    request_id: input.requestId,
    mission_id: input.missionId ?? null,
    owner_user_id: input.ownerUserId,
    conversation_id: input.conversationId ?? null,
    requested_by: input.requestedBy,
    scope: WORLD_LEARNING_AGENT_POLICY_PROFILE,
    task_type: input.taskType,
    allowed_operations: [...input.allowedOperations],
    created_at: input.nowIso ?? new Date().toISOString(),
    expires_at: input.expiresAt ?? null,
    policy_profile: WORLD_LEARNING_AGENT_POLICY_PROFILE,
  }
}
