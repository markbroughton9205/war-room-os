/**
 * #22 Phase 13 — Bounded world-learning-agent scope.
 * Reuses RESEARCH_AGENT hard limits. No unbounded loops.
 */
import { RESEARCH_AGENT_DEFAULT_BOUNDS } from '@/lib/ascension/research-agent/scope'
import { WORLD_LEARNING_AGENT_ALLOWED_OPERATIONS, type WorldLearningAgentTaskType } from './profile'

export const WORLD_LEARNING_AGENT_DEFAULT_BOUNDS = Object.freeze({
  time_budget_ms: RESEARCH_AGENT_DEFAULT_BOUNDS.time_budget_ms,
  max_search_queries: RESEARCH_AGENT_DEFAULT_BOUNDS.max_search_queries,
  max_fetches: RESEARCH_AGENT_DEFAULT_BOUNDS.max_fetches,
  max_terra_queries: RESEARCH_AGENT_DEFAULT_BOUNDS.max_terra_queries,
  max_iterations: RESEARCH_AGENT_DEFAULT_BOUNDS.max_iterations,
  max_recursive_depth: RESEARCH_AGENT_DEFAULT_BOUNDS.max_recursive_depth,
  max_documents: 8,
  max_candidate_corpus_items: 8,
  max_model_calls: 1,
  max_topic_map_nodes: 12,
  max_follow_up_recommendations: 3,
} as const)

export type WorldLearningAgentScope = {
  task_type: WorldLearningAgentTaskType
  topic: string
  domain: string | null
  owner_user_id: string
  requested_by: string
  conversation_id: string | null
  mission_id: string | null
  allowed_operations: string[]
  time_budget_ms: number
  max_search_queries: number
  max_fetches: number
  max_terra_queries: number
  max_iterations: number
  max_recursive_depth: number
  max_documents: number
  max_candidate_corpus_items: number
  max_model_calls: number
  internet_available: boolean
  live_discovery_allowed: boolean
  terra_allowed: boolean
  created_at: string
  expires_at: string | null
}

export function createWorldLearningAgentScope(input: {
  taskType: WorldLearningAgentTaskType
  topic: string
  domain?: string | null
  ownerUserId: string
  requestedBy: string
  conversationId?: string | null
  missionId?: string | null
  allowedOperations?: string[]
  internetAvailable?: boolean
  liveDiscoveryAllowed?: boolean
  terraAllowed?: boolean
  expiresAt?: string | null
  nowIso?: string
  bounds?: Partial<typeof WORLD_LEARNING_AGENT_DEFAULT_BOUNDS>
}): WorldLearningAgentScope {
  const bounds = { ...WORLD_LEARNING_AGENT_DEFAULT_BOUNDS, ...input.bounds }
  const ops = input.allowedOperations?.length
    ? input.allowedOperations.filter(c =>
        (WORLD_LEARNING_AGENT_ALLOWED_OPERATIONS as readonly string[]).includes(c),
      )
    : [...WORLD_LEARNING_AGENT_ALLOWED_OPERATIONS]

  return {
    task_type: input.taskType,
    topic: input.topic.slice(0, 400),
    domain: input.domain ?? null,
    owner_user_id: input.ownerUserId,
    requested_by: input.requestedBy,
    conversation_id: input.conversationId ?? null,
    mission_id: input.missionId ?? null,
    allowed_operations: ops,
    time_budget_ms: bounds.time_budget_ms,
    max_search_queries: bounds.max_search_queries,
    max_fetches: bounds.max_fetches,
    max_terra_queries: bounds.max_terra_queries,
    max_iterations: bounds.max_iterations,
    max_recursive_depth: bounds.max_recursive_depth,
    max_documents: bounds.max_documents,
    max_candidate_corpus_items: bounds.max_candidate_corpus_items,
    max_model_calls: bounds.max_model_calls,
    internet_available: input.internetAvailable !== false,
    live_discovery_allowed: input.liveDiscoveryAllowed === true && input.internetAvailable !== false,
    terra_allowed: input.terraAllowed !== false,
    created_at: input.nowIso ?? new Date().toISOString(),
    expires_at: input.expiresAt ?? null,
  }
}

export function isWorldLearningAgentScopeExpired(scope: WorldLearningAgentScope, nowMs = Date.now()): boolean {
  if (!scope.expires_at) return false
  const t = Date.parse(scope.expires_at)
  return Number.isFinite(t) && nowMs > t
}
