import 'server-only'

import { AGENT_BLUEPRINTS, type AgentMemoryDomain, type AgentOperationalRole, type AgentRiskLevel } from '@/lib/agents/foundry/agentBlueprints'
import { createProposedAgentFromBlueprint } from '@/lib/agents/foundry/agentLifecycle'
import { getAgentSupabase, type AgentPersistenceResult } from '@/lib/agents/foundry/agentPersistence'
import { evaluateActivationApproval } from './activationApprovalEngine'
import { createActivationAuditTrail } from './activationAuditLogger'
import { validateActivationGovernance } from './activationGovernanceValidator'
import { planLifecycleTransitions } from './activationLifecycleTransition'
import { bindActivationMemory } from './activationMemoryBinder'
import { planActivationQueues, type ActivationQueueAssignment } from './activationQueuePlanner'
import { evaluateActivationReadiness } from './activationReadinessEvaluator'
import { prepareActivationTaskBootstrap } from './activationTaskBootstrap'
import { prepareActivationWorkerLaunch } from './activationWorkerLauncher'

export type ActivationIntegrationStatus = 'live_persistent' | 'persistent_store' | 'awaiting_data' | 'static_seed' | 'not_connected'

export type ActivationStage =
  | 'proposed'
  | 'blueprint_review'
  | 'governance_review'
  | 'memory_binding'
  | 'queue_assignment'
  | 'readiness_validation'
  | 'commander_approval'
  | 'active'

export type ActivationTableName =
  | 'war_room_agent_activation_queue'
  | 'war_room_agent_memory_bindings'
  | 'war_room_agent_queue_assignments'
  | 'war_room_agent_readiness'
  | 'war_room_agent_activation_audit'
  | 'war_room_agent_lifecycle_events'

export type ActivationTableSummary = {
  table: ActivationTableName
  records: number | null
  lastEventAt: string | null
  status: ActivationIntegrationStatus
  error?: string
}

export type ActivationAgentCandidate = {
  agentId: string
  blueprintId: string
  name: string
  purpose: string
  operationalRole: AgentOperationalRole
  currentStage: ActivationStage
  requestedStage: ActivationStage
  doctrine: string[]
  memoryScope: AgentMemoryDomain[]
  riskLevel: AgentRiskLevel
  approvedOperationalContext: string[]
  commanderApprovalRequired: true
  externalExecutionAllowed: false
  source: ActivationIntegrationStatus
}

export type ActivationQueueRow = {
  id: string
  agent_id: string | null
  agent_key: string
  activation_stage: ActivationStage
  requested_by: string
  approval_state: 'pending' | 'approved' | 'denied' | 'blocked'
  created_at: string
  updated_at: string
}

export type ActivationSnapshot = {
  generatedAt: string
  persistenceAvailable: boolean
  integrationStatus: ActivationIntegrationStatus
  guardrails: {
    commanderApprovalRequired: true
    externalExecutionAllowed: false
    autonomousExternalExecutionAllowed: false
    readOnlySnapshot: true
  }
  stages: ActivationStage[]
  tables: ActivationTableSummary[]
  activationQueue: ActivationQueueRow[]
  candidates: ReturnType<typeof buildActivationCandidate>[]
  queueAssignments: ActivationQueueAssignment[]
  governance: ReturnType<typeof validateActivationGovernance>[]
  memoryBindings: ReturnType<typeof bindActivationMemory>[]
  readiness: ReturnType<typeof evaluateActivationReadiness>[]
  approvals: ReturnType<typeof evaluateActivationApproval>[]
  lifecycle: ReturnType<typeof planLifecycleTransitions>
  taskBootstrap: ReturnType<typeof prepareActivationTaskBootstrap>[]
  workerLaunch: ReturnType<typeof prepareActivationWorkerLaunch>[]
  auditLog: ReturnType<typeof createActivationAuditTrail>
}

export const ACTIVATION_TABLES: ActivationTableName[] = [
  'war_room_agent_activation_queue',
  'war_room_agent_memory_bindings',
  'war_room_agent_queue_assignments',
  'war_room_agent_readiness',
  'war_room_agent_activation_audit',
  'war_room_agent_lifecycle_events',
]

export const ACTIVATION_STAGES: ActivationStage[] = [
  'proposed',
  'blueprint_review',
  'governance_review',
  'memory_binding',
  'queue_assignment',
  'readiness_validation',
  'commander_approval',
  'active',
]

function statusFromCount(records: number | null, error?: string): ActivationIntegrationStatus {
  if (error) return 'not_connected'
  if (records === null) return 'not_connected'
  return records > 0 ? 'live_persistent' : 'awaiting_data'
}

function overallStatus(tables: ActivationTableSummary[], candidates: ActivationAgentCandidate[]): ActivationIntegrationStatus {
  if (!tables.length || tables.some(table => table.status === 'not_connected')) return 'not_connected'
  if (tables.some(table => table.status === 'live_persistent')) return 'live_persistent'
  return candidates.length ? 'static_seed' : 'awaiting_data'
}

async function countActivationTable(table: ActivationTableName): Promise<ActivationTableSummary> {
  const sup = getAgentSupabase()
  if (!sup.ok) {
    return { table, records: null, lastEventAt: null, status: 'not_connected', error: sup.error }
  }
  const countQuery = sup.value.from(table).select('*', { count: 'exact', head: true })
  const latestQuery = sup.value.from(table).select('updated_at,created_at').order('updated_at', { ascending: false }).limit(1).maybeSingle()
  const [countResult, latestResult] = await Promise.all([countQuery, latestQuery])
  if (countResult.error) {
    return { table, records: null, lastEventAt: null, status: 'not_connected', error: countResult.error.message }
  }
  if (latestResult.error) {
    return { table, records: countResult.count ?? 0, lastEventAt: null, status: 'not_connected', error: latestResult.error.message }
  }
  const row = latestResult.data as { updated_at?: unknown; created_at?: unknown } | null
  const records = countResult.count ?? 0
  const lastEventAt = typeof row?.updated_at === 'string'
    ? row.updated_at
    : typeof row?.created_at === 'string'
      ? row.created_at
      : null
  return { table, records, lastEventAt, status: statusFromCount(records) }
}

async function listActivationQueue(): Promise<AgentPersistenceResult<ActivationQueueRow[]>> {
  const sup = getAgentSupabase()
  if (!sup.ok) return sup
  const { data, error } = await sup.value
    .from('war_room_agent_activation_queue')
    .select('id,agent_id,agent_key,activation_stage,requested_by,approval_state,created_at,updated_at')
    .order('updated_at', { ascending: false })
    .limit(50)
  if (error) return { ok: false, error: error.message, persistenceAvailable: true }
  return { ok: true, value: (data ?? []) as unknown as ActivationQueueRow[] }
}

function buildActivationCandidate(blueprint: (typeof AGENT_BLUEPRINTS)[number], source: ActivationIntegrationStatus): ActivationAgentCandidate {
  const agent = createProposedAgentFromBlueprint(blueprint)
  return {
    agentId: agent.id,
    blueprintId: agent.blueprintId,
    name: agent.name,
    purpose: agent.purpose,
    operationalRole: agent.operationalRole,
    currentStage: 'proposed',
    requestedStage: 'readiness_validation',
    doctrine: agent.assignedDoctrine,
    memoryScope: agent.memoryScope,
    riskLevel: agent.riskProfile.level,
    approvedOperationalContext: [
      'Doctrine-scoped intelligence preparation',
      'Queue-bound collaboration',
      'Auditable task packet preparation',
    ],
    commanderApprovalRequired: true,
    externalExecutionAllowed: false,
    source,
  }
}

export async function summarizeActivationPersistence(): Promise<ActivationTableSummary[]> {
  return Promise.all(ACTIVATION_TABLES.map(table => countActivationTable(table)))
}

export async function buildAgentActivationSnapshot(): Promise<ActivationSnapshot> {
  const generatedAt = new Date().toISOString()
  const [tables, queueResult] = await Promise.all([
    summarizeActivationPersistence(),
    listActivationQueue(),
  ])
  const queueRows = queueResult.ok ? queueResult.value : []
  const candidates = AGENT_BLUEPRINTS.map(blueprint => buildActivationCandidate(blueprint, queueRows.length ? 'persistent_store' : 'static_seed'))
  const queueAssignments = planActivationQueues(candidates)
  const memoryBindings = candidates.map(candidate => bindActivationMemory(candidate))
  const governance = candidates.map((candidate, index) => validateActivationGovernance(candidate, memoryBindings[index], queueAssignments[index]))
  const readiness = candidates.map((candidate, index) => evaluateActivationReadiness(candidate, governance[index], memoryBindings[index], queueAssignments[index], tables))
  const approvals = candidates.map((candidate, index) => evaluateActivationApproval(candidate, readiness[index], queueRows))
  const workerLaunch = candidates.map((candidate, index) => prepareActivationWorkerLaunch(candidate, readiness[index], queueAssignments[index], approvals[index]))
  const taskBootstrap = candidates.map((candidate, index) => prepareActivationTaskBootstrap(candidate, queueAssignments[index], memoryBindings[index], governance[index]))

  return {
    generatedAt,
    persistenceAvailable: tables.every(table => table.status !== 'not_connected'),
    integrationStatus: overallStatus(tables, candidates),
    guardrails: {
      commanderApprovalRequired: true,
      externalExecutionAllowed: false,
      autonomousExternalExecutionAllowed: false,
      readOnlySnapshot: true,
    },
    stages: ACTIVATION_STAGES,
    tables,
    activationQueue: queueRows,
    candidates,
    queueAssignments,
    governance,
    memoryBindings,
    readiness,
    approvals,
    lifecycle: planLifecycleTransitions(candidates, approvals, readiness),
    taskBootstrap,
    workerLaunch,
    auditLog: createActivationAuditTrail(candidates, governance, memoryBindings, queueAssignments, readiness, approvals),
  }
}
