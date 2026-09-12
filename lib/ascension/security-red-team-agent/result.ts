/**
 * #22 Phase 4 — Finding + result contracts. No hidden CoT.
 */
import type { SecurityRedTeamAgentIdentity } from './identity'
import type { SecurityRedTeamScope } from './scope'

export const SECURITY_FINDING_SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export type SecurityFindingSeverity = (typeof SECURITY_FINDING_SEVERITIES)[number]

export const SECURITY_RED_TEAM_STATUSES = [
  'COMPLETE',
  'PARTIAL',
  'DEGRADED',
  'FAILED',
  'DENIED',
] as const
export type SecurityRedTeamStatus = (typeof SECURITY_RED_TEAM_STATUSES)[number]

export type SecurityFindingStatus = 'OPEN' | 'CONFIRMED_CONTROL' | 'INFORMATIONAL'

export type SecurityFinding = {
  finding_id: string
  title: string
  severity: SecurityFindingSeverity
  category: string
  affected_actor: string | null
  affected_tool_or_route: string | null
  description: string
  evidence: string[]
  attack_path: string
  technical_reach: string
  policy_effect: string
  exploitability: 'NONE' | 'THEORETICAL' | 'LOCAL_SAFE' | 'BLOCKED'
  runtime_status: string
  owner_scope: string | null
  recommended_fix: string
  requires_commander_action: boolean
  safe_reproduction: string
  status: SecurityFindingStatus
}

export type SecurityRedTeamDenial = {
  capability_or_action: string
  reason_code: string
  reason: string
}

export type SecurityTestRun = {
  test_id: string
  probe_class: string
  ok: boolean
  denied: boolean
  summary: string
}

export type SecurityRedTeamResult = {
  agent_id: string
  agent_role: 'SECURITY_RED_TEAM_AGENT'
  status: SecurityRedTeamStatus
  security_question: string
  scope: SecurityRedTeamScope
  targets: string[]
  tests_run: SecurityTestRun[]
  findings: SecurityFinding[]
  denials: SecurityRedTeamDenial[]
  unavailable_tests: string[]
  limitations: string[]
  audit_id: string | null
  started_at: string
  completed_at: string
  owner_scope: string
  mission_id: string | null
  conversation_id: string | null
  identity: SecurityRedTeamAgentIdentity
  severity_distribution: Record<SecurityFindingSeverity, number>
  boundary_notes: readonly string[]
  plan_summary: string
}

export const SECURITY_RED_TEAM_BOUNDARY_NOTES = Object.freeze([
  'SECURITY KNOWLEDGE != SECURITY EXECUTION AUTHORITY',
  'FINDING A BYPASS != AUTHORIZATION TO EXPLOIT IT DESTRUCTIVELY',
  'RESEARCH FINDING != SECURITY AUTHORIZATION',
  'SECURITY FINDING != AUTO ENGINEERING TASK',
  'NO AUTOMATIC REMEDIATION IN PHASE 4',
  'ASCENSION AUTONOMY OFF',
] as const)

export function emptySeverityDistribution(): Record<SecurityFindingSeverity, number> {
  return { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 }
}

export function classifySecurityStatus(input: {
  denied: boolean
  requiredProbesFailed: boolean
  probesRun: number
  probesExpected: number
  openHighOrCritical: number
}): SecurityRedTeamStatus {
  if (input.denied) return 'DENIED'
  if (input.probesRun === 0) return 'FAILED'
  if (input.requiredProbesFailed) return 'PARTIAL'
  if (input.probesRun < input.probesExpected) return 'PARTIAL'
  if (input.openHighOrCritical > 0) return 'DEGRADED'
  return 'COMPLETE'
}

export function makeFinding(partial: Omit<SecurityFinding, 'finding_id'> & { finding_id?: string }): SecurityFinding {
  return {
    finding_id: partial.finding_id ?? `finding_${Math.random().toString(36).slice(2, 10)}`,
    title: partial.title,
    severity: partial.severity,
    category: partial.category,
    affected_actor: partial.affected_actor,
    affected_tool_or_route: partial.affected_tool_or_route,
    description: partial.description,
    evidence: partial.evidence,
    attack_path: partial.attack_path,
    technical_reach: partial.technical_reach,
    policy_effect: partial.policy_effect,
    exploitability: partial.exploitability,
    runtime_status: partial.runtime_status,
    owner_scope: partial.owner_scope,
    recommended_fix: partial.recommended_fix,
    requires_commander_action: partial.requires_commander_action,
    safe_reproduction: partial.safe_reproduction,
    status: partial.status,
  }
}
