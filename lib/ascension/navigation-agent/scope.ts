/**
 * #22 Phase 12 — Bounded navigation-agent scope.
 */
import { NAVIGATION_AGENT_ALLOWED_OPERATIONS, type NavigationAgentTaskType } from './profile'

export const NAVIGATION_AGENT_DEFAULT_BOUNDS = Object.freeze({
  max_waypoints: 4,
  max_alternatives: 2,
  max_runtime_ms: 8_000,
  max_explanation_chars: 4_000,
} as const)

export type NavigationAgentScope = {
  task_type: NavigationAgentTaskType
  owner_user_id: string
  requested_by: string
  conversation_id: string | null
  mission_id: string | null
  allowed_operations: string[]
  max_waypoints: number
  max_alternatives: number
  max_runtime_ms: number
  internet_available: boolean
  created_at: string
  expires_at: string | null
}

export function createNavigationAgentScope(input: {
  taskType: NavigationAgentTaskType
  ownerUserId: string
  requestedBy: string
  conversationId?: string | null
  missionId?: string | null
  allowedOperations?: string[]
  internetAvailable?: boolean
  expiresAt?: string | null
  nowIso?: string
  bounds?: Partial<typeof NAVIGATION_AGENT_DEFAULT_BOUNDS>
}): NavigationAgentScope {
  const bounds = { ...NAVIGATION_AGENT_DEFAULT_BOUNDS, ...input.bounds }
  const ops = input.allowedOperations?.length
    ? input.allowedOperations.filter(c => (NAVIGATION_AGENT_ALLOWED_OPERATIONS as readonly string[]).includes(c))
    : [...NAVIGATION_AGENT_ALLOWED_OPERATIONS]

  return {
    task_type: input.taskType,
    owner_user_id: input.ownerUserId,
    requested_by: input.requestedBy,
    conversation_id: input.conversationId ?? null,
    mission_id: input.missionId ?? null,
    allowed_operations: ops,
    max_waypoints: bounds.max_waypoints,
    max_alternatives: bounds.max_alternatives,
    max_runtime_ms: bounds.max_runtime_ms,
    internet_available: input.internetAvailable !== false,
    created_at: input.nowIso ?? new Date().toISOString(),
    expires_at: input.expiresAt ?? null,
  }
}

export function isNavigationAgentScopeExpired(scope: NavigationAgentScope, nowMs = Date.now()): boolean {
  if (!scope.expires_at) return false
  const t = Date.parse(scope.expires_at)
  return Number.isFinite(t) && nowMs > t
}
