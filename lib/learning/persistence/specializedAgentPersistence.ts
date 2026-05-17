import 'server-only'

import { getLearningSupabase, type LearningStoreResult } from './learningPersistence'

export type SpecializedAgentStatus = 'proposed' | 'under_review' | 'approved' | 'active' | 'paused' | 'rejected' | 'retired'

export type SpecializedAgentStoreRow = {
  id: string
  proposed_agent: string
  approved_agent: string | null
  doctrine_inheritance: unknown[]
  scoped_memory: unknown[]
  permission_scope: Record<string, unknown>
  status: SpecializedAgentStatus
  performance: Record<string, unknown>
  approval_history: unknown[]
  approved_by: string | null
  approved_at: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

const AGENT_COLUMNS = [
  'id',
  'proposed_agent',
  'approved_agent',
  'doctrine_inheritance',
  'scoped_memory',
  'permission_scope',
  'status',
  'performance',
  'approval_history',
  'approved_by',
  'approved_at',
  'metadata',
  'created_at',
  'updated_at',
].join(',')

export async function listSpecializedAgents(limit = 25): Promise<LearningStoreResult<SpecializedAgentStoreRow[]>> {
  const sup = getLearningSupabase()
  if (!sup.ok) return sup

  const { data, error } = await sup.value
    .from('war_room_specialized_agents')
    .select(AGENT_COLUMNS)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (error) return { ok: false, error: error.message, persistenceAvailable: true }
  return { ok: true, value: (data ?? []) as unknown as SpecializedAgentStoreRow[] }
}

export async function proposeSpecializedAgent(input: {
  proposedAgent: string
  doctrineInheritance?: unknown[]
  scopedMemory?: unknown[]
  permissionScope?: Record<string, unknown>
  metadata?: Record<string, unknown>
}): Promise<LearningStoreResult<string>> {
  const sup = getLearningSupabase()
  if (!sup.ok) return sup

  const { data, error } = await sup.value
    .from('war_room_specialized_agents')
    .insert({
      proposed_agent: input.proposedAgent,
      doctrine_inheritance: input.doctrineInheritance ?? [],
      scoped_memory: input.scopedMemory ?? [],
      permission_scope: {
        ...(input.permissionScope ?? {}),
        externalExecutionAllowed: false,
        commanderApprovalRequired: true,
      },
      status: 'proposed',
      performance: {},
      approval_history: [],
      metadata: input.metadata ?? {},
    })
    .select('id')
    .single()

  if (error || !data?.id) return { ok: false, error: error?.message ?? 'Specialized agent proposal insert failed.', persistenceAvailable: true }
  return { ok: true, value: String(data.id) }
}

export async function approveSpecializedAgent(input: {
  id: string
  approvedAgent: string
  approvedBy: string
  approvalNote?: string
}): Promise<LearningStoreResult<string>> {
  const sup = getLearningSupabase()
  if (!sup.ok) return sup
  const approvedAt = new Date().toISOString()
  const { data, error } = await sup.value
    .from('war_room_specialized_agents')
    .update({
      approved_agent: input.approvedAgent,
      status: 'approved',
      approved_by: input.approvedBy,
      approved_at: approvedAt,
      approval_history: [{
        at: approvedAt,
        by: input.approvedBy,
        note: input.approvalNote ?? 'Commander approved specialized agent proposal.',
        externalExecutionAllowed: false,
      }],
    })
    .eq('id', input.id)
    .select('id')
    .single()

  if (error || !data?.id) return { ok: false, error: error?.message ?? 'Specialized agent approval failed.', persistenceAvailable: true }
  return { ok: true, value: String(data.id) }
}
