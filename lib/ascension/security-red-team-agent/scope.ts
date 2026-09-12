/**
 * #22 Phase 4 — Bounded security evaluation scope contract.
 */
import {
  SECURITY_RED_TEAM_PROHIBITED_PROBE_CLASSES,
  SECURITY_RED_TEAM_SAFE_PROBE_CLASSES,
} from './profile'

export const SECURITY_RED_TEAM_DEFAULT_BOUNDS = Object.freeze({
  max_findings: 40,
  max_files_read: 30,
  max_route_checks: 20,
  max_probe_count: 48,
  max_runtime_ms: 120_000,
  max_retries: 0,
} as const)

export type SecurityRedTeamScope = {
  security_question: string
  targets: string[]
  allowed_probe_classes: string[]
  denied_probe_classes: string[]
  repository_root: string | null
  worktree: string | null
  conversation_id: string | null
  owner_user_id: string
  requested_by: string
  max_findings: number
  max_files_read: number
  max_route_checks: number
  max_probe_count: number
  max_runtime_ms: number
  network_policy: 'NO_ACTIVE_EXTERNAL_SECURITY_SCANNING'
  created_at: string
  expires_at: string | null
  mission_id: string | null
}

export function createSecurityRedTeamScope(input: {
  securityQuestion: string
  targets: string[]
  allowedProbeClasses?: string[]
  ownerUserId: string
  requestedBy: string
  repositoryRoot?: string | null
  worktree?: string | null
  conversationId?: string | null
  missionId?: string | null
  expiresAt?: string | null
  nowIso?: string
  bounds?: Partial<typeof SECURITY_RED_TEAM_DEFAULT_BOUNDS>
}): SecurityRedTeamScope {
  const bounds = { ...SECURITY_RED_TEAM_DEFAULT_BOUNDS, ...input.bounds }
  const requested = input.allowedProbeClasses?.length
    ? input.allowedProbeClasses.filter(c => (SECURITY_RED_TEAM_SAFE_PROBE_CLASSES as readonly string[]).includes(c))
    : [...SECURITY_RED_TEAM_SAFE_PROBE_CLASSES]

  return {
    security_question: input.securityQuestion.trim(),
    targets: [...input.targets],
    allowed_probe_classes: requested,
    denied_probe_classes: [...SECURITY_RED_TEAM_PROHIBITED_PROBE_CLASSES],
    repository_root: input.repositoryRoot ?? null,
    worktree: input.worktree ?? null,
    conversation_id: input.conversationId ?? null,
    owner_user_id: input.ownerUserId,
    requested_by: input.requestedBy,
    max_findings: bounds.max_findings,
    max_files_read: bounds.max_files_read,
    max_route_checks: bounds.max_route_checks,
    max_probe_count: bounds.max_probe_count,
    max_runtime_ms: bounds.max_runtime_ms,
    network_policy: 'NO_ACTIVE_EXTERNAL_SECURITY_SCANNING',
    created_at: input.nowIso ?? new Date().toISOString(),
    expires_at: input.expiresAt ?? null,
    mission_id: input.missionId ?? null,
  }
}

export function isSecurityScopeExpired(scope: SecurityRedTeamScope, nowMs = Date.now()): boolean {
  if (!scope.expires_at) return false
  const t = Date.parse(scope.expires_at)
  return Number.isFinite(t) && nowMs > t
}
