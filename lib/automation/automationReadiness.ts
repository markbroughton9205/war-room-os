import 'server-only'

import { buildAgentFoundrySnapshot } from '@/lib/agents/foundry/agentFoundry'
import { tryWarRoomSupabase, type WarRoomSupabase } from '@/lib/war-room/persistence'
import { createAutomationAuditTrail, type AutomationAuditEvent } from './automationAuditLogger'
import { planAutomationEscalation, type AutomationEscalationPlan } from './automationEscalationPlanner'
import { deriveAutomationLifecycle, type AutomationLifecycleState } from './automationLifecycle'
import { getAutomationMode, getAutomationModes, type AutomationModeDefinition } from './automationModeRegistry'
import { decideAutomationPolicy, type AutomationPolicyDecision } from './automationPolicyEngine'
import { previewAutomationSchedule, type AutomationSchedulePreview } from './automationScheduler'
import { deriveAutomationThrottleState, type AutomationThrottleState } from './automationThrottleController'
import { buildBoundedExecutionPlan, type BoundedExecutionPlan } from './boundedExecutionPlanner'
import { validateExecutionConstraints } from './executionConstraintValidator'
import { evaluateExecutionCheckpoint, type ExecutionCheckpoint } from './executionCheckpointEngine'
import { getExecutionDomains, type ExecutionDomainDefinition } from './executionDomainRegistry'
import { planExecutionRollback, type ExecutionRollbackPlan } from './executionRollbackPlanner'
import { scoreExecutionRisk, type ExecutionRiskScore } from './executionRiskScoring'
import { simulateExecution, type ExecutionSimulationResult } from './executionSimulation'

export type AutomationIntegrationStatus =
  | 'live_persistent'
  | 'persistent_store'
  | 'awaiting_data'
  | 'static_seed'
  | 'not_connected'

export type AutomationTableName =
  | 'war_room_automation_modes'
  | 'war_room_execution_domains'
  | 'war_room_execution_checkpoints'
  | 'war_room_execution_simulations'
  | 'war_room_execution_audits'
  | 'war_room_execution_throttles'
  | 'war_room_financial_guardrails'
  | 'war_room_rollback_plans'
  | 'war_room_automation_escalations'
  | 'war_room_execution_readiness'

export type AutomationTableSummary = {
  table: AutomationTableName
  records: number | null
  lastEventAt: string | null
  status: AutomationIntegrationStatus
  error?: string
}

export type AgentAutomationAssignment = {
  agentId: string
  name: string
  automationMode: AutomationModeDefinition['id']
  domainId: ExecutionDomainDefinition['id']
  throttleState: AutomationThrottleState['state']
  escalationStatus: AutomationEscalationPlan['status']
  rollbackComplexity: ExecutionRollbackPlan['complexity']
  readinessState: 'ready_for_commander_review' | 'blocked' | 'degraded' | 'draft'
  unrestrictedAccessAllowed: false
}

export type AutomationReadinessSnapshot = {
  generatedAt: string
  persistenceAvailable: boolean
  integrationStatus: AutomationIntegrationStatus
  guardrails: {
    commanderAuthorityRequired: true
    readOnlyApis: true
    actualExecutionRoutesExposed: false
    uncontrolledFinancialExecutionAllowed: false
    autonomousCapabilityExpansionAllowed: false
  }
  tables: AutomationTableSummary[]
  modes: AutomationModeDefinition[]
  domains: ExecutionDomainDefinition[]
  plans: BoundedExecutionPlan[]
  schedules: AutomationSchedulePreview[]
  checkpoints: ExecutionCheckpoint[]
  simulations: ExecutionSimulationResult[]
  financialGuardrails: ExecutionDomainDefinition['financialLimits'][]
  throttles: AutomationThrottleState[]
  rollbackPlans: ExecutionRollbackPlan[]
  escalations: AutomationEscalationPlan[]
  audits: AutomationAuditEvent[]
  policies: AutomationPolicyDecision[]
  lifecycle: AutomationLifecycleState[]
  foundryAssignments: AgentAutomationAssignment[]
}

export const AUTOMATION_TABLES: AutomationTableName[] = [
  'war_room_automation_modes',
  'war_room_execution_domains',
  'war_room_execution_checkpoints',
  'war_room_execution_simulations',
  'war_room_execution_audits',
  'war_room_execution_throttles',
  'war_room_financial_guardrails',
  'war_room_rollback_plans',
  'war_room_automation_escalations',
  'war_room_execution_readiness',
]

function statusFromCount(records: number | null, error?: string): AutomationIntegrationStatus {
  if (error) return 'not_connected'
  if (records === null) return 'not_connected'
  return records > 0 ? 'live_persistent' : 'awaiting_data'
}

function overallStatus(tables: AutomationTableSummary[]): AutomationIntegrationStatus {
  if (!tables.length || tables.some(table => table.status === 'not_connected')) return 'not_connected'
  if (tables.some(table => table.status === 'live_persistent')) return 'live_persistent'
  return 'static_seed'
}

async function countAutomationTable(client: WarRoomSupabase | null, table: AutomationTableName): Promise<AutomationTableSummary> {
  if (!client) return { table, records: null, lastEventAt: null, status: 'not_connected', error: 'Persistence is not configured.' }
  const countQuery = client.from(table).select('*', { count: 'exact', head: true })
  const latestQuery = client.from(table).select('updated_at,created_at').order('updated_at', { ascending: false }).limit(1).maybeSingle()
  const [countResult, latestResult] = await Promise.all([countQuery, latestQuery])
  if (countResult.error) return { table, records: null, lastEventAt: null, status: 'not_connected', error: countResult.error.message }
  if (latestResult.error) return { table, records: countResult.count ?? 0, lastEventAt: null, status: 'not_connected', error: latestResult.error.message }
  const row = latestResult.data as { updated_at?: unknown; created_at?: unknown } | null
  const records = countResult.count ?? 0
  const lastEventAt = typeof row?.updated_at === 'string'
    ? row.updated_at
    : typeof row?.created_at === 'string'
      ? row.created_at
      : null
  return { table, records, lastEventAt, status: statusFromCount(records) }
}

function buildPlan(domain: ExecutionDomainDefinition) {
  const mode = getAutomationMode(domain.defaultMode) ?? getAutomationModes()[0]
  const risk: ExecutionRiskScore = scoreExecutionRisk(domain, mode)
  const constraints = validateExecutionConstraints(domain, mode, risk)
  const rollback = planExecutionRollback(domain, mode)
  const simulation = simulateExecution(domain, mode, risk, rollback)
  const throttle = deriveAutomationThrottleState(domain, mode, risk)
  const checkpoint = evaluateExecutionCheckpoint(domain, mode, constraints, risk, simulation, throttle)
  const escalation = planAutomationEscalation(domain, mode, risk)
  const policy = decideAutomationPolicy(domain, mode, checkpoint)
  return buildBoundedExecutionPlan({ domain, policy, checkpoint, risk, simulation, throttle, rollback, escalation })
}

function assignFoundryAutomation(
  agents: Awaited<ReturnType<typeof buildAgentFoundrySnapshot>>['agents'],
  plans: BoundedExecutionPlan[],
): AgentAutomationAssignment[] {
  return agents.map((agent, index) => {
    const plan = plans[index % plans.length]
    return {
      agentId: agent.id,
      name: agent.name,
      automationMode: plan.modeId,
      domainId: plan.domainId,
      throttleState: plan.throttle.state,
      escalationStatus: plan.escalation.status,
      rollbackComplexity: plan.rollback.complexity,
      readinessState: plan.policy.status === 'blocked'
        ? 'blocked'
        : plan.checkpoint.decision === 'needs_review' || plan.checkpoint.decision === 'degraded'
          ? 'degraded'
          : plan.policy.status === 'commander_review_required'
            ? 'ready_for_commander_review'
            : 'draft',
      unrestrictedAccessAllowed: false,
    }
  })
}

export async function buildAutomationReadinessSnapshot(): Promise<AutomationReadinessSnapshot> {
  const generatedAt = new Date().toISOString()
  const sup = tryWarRoomSupabase()
  const client = sup.ok ? sup.client : null
  const [tables, foundry] = await Promise.all([
    Promise.all(AUTOMATION_TABLES.map(table => countAutomationTable(client, table))),
    buildAgentFoundrySnapshot(),
  ])
  const modes = getAutomationModes()
  const domains = getExecutionDomains()
  const plans = domains.map(buildPlan)

  return {
    generatedAt,
    persistenceAvailable: sup.ok && tables.every(table => table.status !== 'not_connected'),
    integrationStatus: overallStatus(tables),
    guardrails: {
      commanderAuthorityRequired: true,
      readOnlyApis: true,
      actualExecutionRoutesExposed: false,
      uncontrolledFinancialExecutionAllowed: false,
      autonomousCapabilityExpansionAllowed: false,
    },
    tables,
    modes,
    domains,
    plans,
    schedules: plans.map(previewAutomationSchedule),
    checkpoints: plans.map(plan => plan.checkpoint),
    simulations: plans.map(plan => plan.simulation),
    financialGuardrails: domains.map(domain => domain.financialLimits),
    throttles: plans.map(plan => plan.throttle),
    rollbackPlans: plans.map(plan => plan.rollback),
    escalations: plans.map(plan => plan.escalation),
    audits: createAutomationAuditTrail(plans),
    policies: plans.map(plan => plan.policy),
    lifecycle: deriveAutomationLifecycle(plans),
    foundryAssignments: assignFoundryAutomation(foundry.agents, plans),
  }
}
