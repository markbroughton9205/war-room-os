/**
 * #22 Phase 6 — Bounded Terra world-state analysis scope.
 */
import { TERRA_INTELLIGENCE_ALLOWED_QUERY_CLASSES } from './profile'

export const TERRA_INTELLIGENCE_DEFAULT_BOUNDS = Object.freeze({
  max_objects: 40,
  max_providers: 20,
  max_queries: 4,
  max_evidence_refs: 40,
  max_runtime_ms: 90_000,
  max_retries: 0,
  max_findings: 30,
} as const)

export type TerraIntelligenceScope = {
  world_state_question: string
  owner_user_id: string
  requested_by: string
  conversation_id: string | null
  mission_id: string | null
  geographic_scope: string | null
  time_scope: string | null
  provider_scope: string[] | null
  category_scope: string[] | null
  allowed_query_classes: string[]
  max_objects: number
  max_providers: number
  max_queries: number
  max_evidence_refs: number
  max_runtime_ms: number
  live_only: boolean
  include_cached: boolean
  include_historical: boolean
  include_inferred: boolean
  created_at: string
  expires_at: string | null
}

export function createTerraIntelligenceScope(input: {
  worldStateQuestion: string
  ownerUserId: string
  requestedBy: string
  conversationId?: string | null
  missionId?: string | null
  geographicScope?: string | null
  timeScope?: string | null
  providerScope?: string[] | null
  categoryScope?: string[] | null
  allowedQueryClasses?: string[]
  liveOnly?: boolean
  includeCached?: boolean
  includeHistorical?: boolean
  includeInferred?: boolean
  expiresAt?: string | null
  nowIso?: string
  bounds?: Partial<typeof TERRA_INTELLIGENCE_DEFAULT_BOUNDS>
}): TerraIntelligenceScope {
  const bounds = { ...TERRA_INTELLIGENCE_DEFAULT_BOUNDS, ...input.bounds }
  const classes = input.allowedQueryClasses?.length
    ? input.allowedQueryClasses.filter(c => (TERRA_INTELLIGENCE_ALLOWED_QUERY_CLASSES as readonly string[]).includes(c))
    : [...TERRA_INTELLIGENCE_ALLOWED_QUERY_CLASSES]

  return {
    world_state_question: input.worldStateQuestion.trim(),
    owner_user_id: input.ownerUserId,
    requested_by: input.requestedBy,
    conversation_id: input.conversationId ?? null,
    mission_id: input.missionId ?? null,
    geographic_scope: input.geographicScope ?? null,
    time_scope: input.timeScope ?? null,
    provider_scope: input.providerScope ? [...input.providerScope] : null,
    category_scope: input.categoryScope ? [...input.categoryScope] : null,
    allowed_query_classes: classes,
    max_objects: bounds.max_objects,
    max_providers: bounds.max_providers,
    max_queries: bounds.max_queries,
    max_evidence_refs: bounds.max_evidence_refs,
    max_runtime_ms: bounds.max_runtime_ms,
    live_only: input.liveOnly === true,
    include_cached: input.includeCached !== false,
    include_historical: input.includeHistorical === true,
    include_inferred: input.includeInferred === true,
    created_at: input.nowIso ?? new Date().toISOString(),
    expires_at: input.expiresAt ?? null,
  }
}

export function isTerraIntelligenceScopeExpired(scope: TerraIntelligenceScope, nowMs = Date.now()): boolean {
  if (!scope.expires_at) return false
  const t = Date.parse(scope.expires_at)
  return Number.isFinite(t) && nowMs > t
}
