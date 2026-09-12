/**
 * #22 Phase 5 — Bounded operations diagnostics scope.
 */
import { OPERATIONS_ALLOWED_DIAGNOSTICS } from './profile'

export const OPERATIONS_DEFAULT_BOUNDS = Object.freeze({
  max_process_checks: 8,
  max_port_checks: 6,
  max_log_reads: 3,
  max_log_bytes: 8_000,
  max_health_checks: 4,
  max_runtime_ms: 90_000,
  max_retries: 0,
  max_findings: 30,
} as const)

export type OperationsAgentScope = {
  operations_question: string
  targets: string[]
  allowed_diagnostics: string[]
  owner_user_id: string
  requested_by: string
  conversation_id: string | null
  mission_id: string | null
  max_process_checks: number
  max_port_checks: number
  max_log_reads: number
  max_log_bytes: number
  max_health_checks: number
  max_runtime_ms: number
  network_policy: 'READ_ONLY_HEALTH_PROBES'
  created_at: string
  expires_at: string | null
}

export function createOperationsAgentScope(input: {
  operationsQuestion: string
  targets: string[]
  allowedDiagnostics?: string[]
  ownerUserId: string
  requestedBy: string
  conversationId?: string | null
  missionId?: string | null
  expiresAt?: string | null
  nowIso?: string
  bounds?: Partial<typeof OPERATIONS_DEFAULT_BOUNDS>
}): OperationsAgentScope {
  const bounds = { ...OPERATIONS_DEFAULT_BOUNDS, ...input.bounds }
  const diagnostics = input.allowedDiagnostics?.length
    ? input.allowedDiagnostics.filter(d => (OPERATIONS_ALLOWED_DIAGNOSTICS as readonly string[]).includes(d))
    : [...OPERATIONS_ALLOWED_DIAGNOSTICS]

  return {
    operations_question: input.operationsQuestion.trim(),
    targets: [...input.targets],
    allowed_diagnostics: diagnostics,
    owner_user_id: input.ownerUserId,
    requested_by: input.requestedBy,
    conversation_id: input.conversationId ?? null,
    mission_id: input.missionId ?? null,
    max_process_checks: bounds.max_process_checks,
    max_port_checks: bounds.max_port_checks,
    max_log_reads: bounds.max_log_reads,
    max_log_bytes: bounds.max_log_bytes,
    max_health_checks: bounds.max_health_checks,
    max_runtime_ms: bounds.max_runtime_ms,
    network_policy: 'READ_ONLY_HEALTH_PROBES',
    created_at: input.nowIso ?? new Date().toISOString(),
    expires_at: input.expiresAt ?? null,
  }
}

export function isOperationsScopeExpired(scope: OperationsAgentScope, nowMs = Date.now()): boolean {
  if (!scope.expires_at) return false
  const t = Date.parse(scope.expires_at)
  return Number.isFinite(t) && nowMs > t
}
