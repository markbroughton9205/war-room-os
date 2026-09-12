/**
 * #22 Phase 5 — Operations finding + result contracts. No hidden CoT.
 */
import type { OperationsAgentIdentity } from './identity'
import type { OperationsAgentScope } from './scope'

export const OPERATIONS_TRUTH_STATES = [
  'HEALTHY',
  'DEGRADED',
  'UNHEALTHY',
  'UNAVAILABLE',
  'STOPPED',
  'RUNNING',
  'UNKNOWN',
  'MISMATCH',
  'STALE',
  'RESTARTING',
  'RECOVERED',
  'NOT_CONFIGURED',
  'NOT_IMPLEMENTED',
  'INTENTIONALLY_DOWN',
  'INCONCLUSIVE',
] as const
export type OperationsTruthState = (typeof OPERATIONS_TRUTH_STATES)[number]

export const OPERATIONS_FINDING_SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export type OperationsFindingSeverity = (typeof OPERATIONS_FINDING_SEVERITIES)[number]

export const OPERATIONS_AGENT_STATUSES = [
  'COMPLETE',
  'PARTIAL',
  'DEGRADED',
  'FAILED',
  'DENIED',
] as const
export type OperationsAgentStatus = (typeof OPERATIONS_AGENT_STATUSES)[number]

export type OperationsFinding = {
  finding_id: string
  title: string
  severity: OperationsFindingSeverity
  category: string
  target: string
  status: OperationsTruthState
  evidence: string[]
  observed_at: string
  expected_state: string
  actual_state: string
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  recommended_action: string
  action_kind_if_needed: string | null
  approval_required: boolean
  requires_commander: boolean
  runtime_truth: string
}

export type OperationsCheckRun = {
  check_id: string
  diagnostic: string
  ok: boolean
  denied: boolean
  summary: string
  state: OperationsTruthState
}

export type OperationsDenial = {
  capability_or_action: string
  reason_code: string
  reason: string
}

export type OperationsAgentResult = {
  agent_id: string
  agent_role: 'OPERATIONS_AGENT'
  status: OperationsAgentStatus
  operations_question: string
  targets: string[]
  checks_run: OperationsCheckRun[]
  findings: OperationsFinding[]
  health_summary: Record<string, unknown>
  process_summary: Record<string, unknown>
  port_summary: Record<string, unknown>
  watchdog_summary: Record<string, unknown>
  public_route_summary: Record<string, unknown>
  dependency_summary: Record<string, unknown>
  denials: OperationsDenial[]
  unavailable_checks: string[]
  limitations: string[]
  audit_id: string | null
  started_at: string
  completed_at: string
  owner_scope: string
  mission_id: string | null
  conversation_id: string | null
  identity: OperationsAgentIdentity
  scope: OperationsAgentScope
  severity_distribution: Record<OperationsFindingSeverity, number>
  boundary_notes: readonly string[]
  plan_summary: string
}

export const OPERATIONS_AGENT_BOUNDARY_NOTES = Object.freeze([
  'OBSERVING A FAILURE != AUTHORIZATION TO RESTART',
  'DETECTING A BAD PROCESS != AUTHORIZATION TO KILL IT',
  'DETECTING A DEPLOYMENT ISSUE != AUTHORIZATION TO DEPLOY',
  'COUNCIL RECOMMENDATION != RESTART AUTHORIZATION',
  'ASTRA MISSION != RESTART AUTHORIZATION',
  'NO AUTO-REPAIR IN PHASE 5',
  'ASCENSION AUTONOMY OFF',
] as const)

export function emptySeverityDistribution(): Record<OperationsFindingSeverity, number> {
  return { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 }
}

export function makeOpsFinding(
  partial: Omit<OperationsFinding, 'finding_id' | 'observed_at'> & {
    finding_id?: string
    observed_at?: string
  },
): OperationsFinding {
  return {
    finding_id: partial.finding_id ?? `ops_finding_${Math.random().toString(36).slice(2, 10)}`,
    title: partial.title,
    severity: partial.severity,
    category: partial.category,
    target: partial.target,
    status: partial.status,
    evidence: partial.evidence,
    observed_at: partial.observed_at ?? new Date().toISOString(),
    expected_state: partial.expected_state,
    actual_state: partial.actual_state,
    confidence: partial.confidence,
    recommended_action: partial.recommended_action,
    action_kind_if_needed: partial.action_kind_if_needed,
    approval_required: partial.approval_required,
    requires_commander: partial.requires_commander,
    runtime_truth: partial.runtime_truth,
  }
}

export function classifyOperationsStatus(input: {
  denied: boolean
  checksOk: number
  checksFailed: number
  openHighOrCritical: number
}): OperationsAgentStatus {
  if (input.denied) return 'DENIED'
  if (input.checksOk === 0 && input.checksFailed === 0) return 'FAILED'
  if (input.openHighOrCritical > 0) return 'DEGRADED'
  if (input.checksFailed > 0) return 'PARTIAL'
  return 'COMPLETE'
}
