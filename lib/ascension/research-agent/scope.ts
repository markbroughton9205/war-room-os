/**
 * #22 Phase 2 — RESEARCH_AGENT bounded scope contract + hard resource limits.
 */
export type ResearchAgentScope = {
  research_question: string
  mission_id: string | null
  conversation_id: string | null
  owner_user_id: string
  requested_by: string
  allowed_capabilities: readonly string[]
  time_budget_ms: number
  result_limit: number
  source_evidence_limit: number
  max_search_queries: number
  max_fetches: number
  max_terra_queries: number
  max_iterations: number
  max_recursive_depth: number
  network_policy: 'SESSION_BOUNDED_READ_ONLY_DISCOVERY'
  terra_allowed: boolean
  live_search_allowed: boolean
  stored_research_allowed: boolean
  created_at: string
  deadline_at: string | null
}

export const RESEARCH_AGENT_DEFAULT_BOUNDS = Object.freeze({
  time_budget_ms: 45_000,
  result_limit: 24,
  source_evidence_limit: 40,
  max_search_queries: 3,
  max_fetches: 6,
  max_terra_queries: 2,
  max_iterations: 1,
  max_recursive_depth: 0,
})

export type CreateResearchAgentScopeInput = {
  researchQuestion: string
  ownerUserId: string
  requestedBy: string
  missionId?: string | null
  conversationId?: string | null
  terraAllowed?: boolean
  liveSearchAllowed?: boolean
  storedResearchAllowed?: boolean
  timeBudgetMs?: number
  resultLimit?: number
  sourceEvidenceLimit?: number
  nowIso?: string
  deadlineAt?: string | null
  allowedCapabilities?: readonly string[]
}

export function createResearchAgentScope(input: CreateResearchAgentScopeInput): ResearchAgentScope | { error: string } {
  const question = input.researchQuestion.trim()
  if (question.length < 8) {
    return { error: 'research_question must be at least 8 characters.' }
  }
  if (!input.ownerUserId.trim()) {
    return { error: 'owner_user_id is required.' }
  }
  if (!input.requestedBy.trim()) {
    return { error: 'requested_by is required.' }
  }

  const now = input.nowIso ?? new Date().toISOString()
  const timeBudget = Math.min(
    Math.max(1_000, input.timeBudgetMs ?? RESEARCH_AGENT_DEFAULT_BOUNDS.time_budget_ms),
    120_000,
  )

  return {
    research_question: question.slice(0, 2_000),
    mission_id: input.missionId ?? null,
    conversation_id: input.conversationId ?? null,
    owner_user_id: input.ownerUserId.trim(),
    requested_by: input.requestedBy.trim(),
    allowed_capabilities: input.allowedCapabilities ?? [
      'TERRA_QUERY',
      'LIVE_SEARCH_QUERY',
      'PUBLIC_WEB_PASSIVE_FETCH',
      'STORED_RESEARCH_READ',
      'EVIDENCE_SYNTHESIZE',
      'COUNCIL_RETURN_FINDINGS',
      'ASTRA_RETURN_RESULT',
      'INTERNAL_AUDIT_WRITE',
    ],
    time_budget_ms: timeBudget,
    result_limit: Math.min(input.resultLimit ?? RESEARCH_AGENT_DEFAULT_BOUNDS.result_limit, 50),
    source_evidence_limit: Math.min(
      input.sourceEvidenceLimit ?? RESEARCH_AGENT_DEFAULT_BOUNDS.source_evidence_limit,
      80,
    ),
    max_search_queries: RESEARCH_AGENT_DEFAULT_BOUNDS.max_search_queries,
    max_fetches: RESEARCH_AGENT_DEFAULT_BOUNDS.max_fetches,
    max_terra_queries: RESEARCH_AGENT_DEFAULT_BOUNDS.max_terra_queries,
    max_iterations: RESEARCH_AGENT_DEFAULT_BOUNDS.max_iterations,
    max_recursive_depth: RESEARCH_AGENT_DEFAULT_BOUNDS.max_recursive_depth,
    network_policy: 'SESSION_BOUNDED_READ_ONLY_DISCOVERY',
    terra_allowed: input.terraAllowed !== false,
    live_search_allowed: input.liveSearchAllowed !== false,
    stored_research_allowed: input.storedResearchAllowed !== false,
    created_at: now,
    deadline_at: input.deadlineAt ?? null,
  }
}

export function isScopeExpired(scope: ResearchAgentScope, nowIso: string): boolean {
  if (!scope.deadline_at) return false
  return Date.parse(scope.deadline_at) <= Date.parse(nowIso)
}
