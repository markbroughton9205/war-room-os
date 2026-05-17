import 'server-only'

import { tryWarRoomSupabase, type WarRoomSupabase } from '@/lib/war-room/persistence'
import { AGENT_FOUNDRY_TABLES, type AgentFoundryTableName } from './agentBlueprints'

export type AgentPersistenceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; persistenceAvailable: boolean }

export type AgentTableSummary = {
  table: AgentFoundryTableName
  records: number | null
  lastEventAt: string | null
  status: 'persistent_store' | 'awaiting_data' | 'not_connected'
  error?: string
}

export function getAgentSupabase(): AgentPersistenceResult<WarRoomSupabase> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return { ok: false, error: sup.configError, persistenceAvailable: false }
  return { ok: true, value: sup.client }
}

async function countAgentTable(client: WarRoomSupabase, table: AgentFoundryTableName): Promise<AgentTableSummary> {
  const countQuery = client.from(table).select('*', { count: 'exact', head: true })
  const latestQuery = client.from(table).select('updated_at,created_at').order('updated_at', { ascending: false }).limit(1).maybeSingle()
  const [countResult, latestResult] = await Promise.all([countQuery, latestQuery])
  if (countResult.error) {
    return { table, records: null, lastEventAt: null, status: 'not_connected', error: countResult.error.message }
  }
  if (latestResult.error) {
    return { table, records: countResult.count ?? 0, lastEventAt: null, status: 'not_connected', error: latestResult.error.message }
  }
  const row = latestResult.data as { updated_at?: unknown; created_at?: unknown } | null
  const lastEventAt = typeof row?.updated_at === 'string'
    ? row.updated_at
    : typeof row?.created_at === 'string'
      ? row.created_at
      : null
  return {
    table,
    records: countResult.count ?? 0,
    lastEventAt,
    status: (countResult.count ?? 0) > 0 ? 'persistent_store' : 'awaiting_data',
  }
}

export async function summarizeAgentPersistence(): Promise<AgentPersistenceResult<AgentTableSummary[]>> {
  const sup = getAgentSupabase()
  if (!sup.ok) return sup
  const summaries = await Promise.all(AGENT_FOUNDRY_TABLES.map(table => countAgentTable(sup.value, table)))
  return { ok: true, value: summaries }
}

export async function listPersistentAgents(limit = 25): Promise<AgentPersistenceResult<Record<string, unknown>[]>> {
  const sup = getAgentSupabase()
  if (!sup.ok) return sup
  const { data, error } = await sup.value
    .from('war_room_agents')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) return { ok: false, error: error.message, persistenceAvailable: true }
  return { ok: true, value: data ?? [] }
}

export async function insertAgentGovernanceEvent(input: {
  agentId?: string | null
  eventType: string
  severity?: 'info' | 'watch' | 'warning' | 'critical'
  summary: string
  metadata?: Record<string, unknown>
}): Promise<AgentPersistenceResult<string>> {
  const sup = getAgentSupabase()
  if (!sup.ok) return sup
  const { data, error } = await sup.value
    .from('war_room_agent_governance_events')
    .insert({
      agent_id: input.agentId ?? null,
      event_type: input.eventType,
      severity: input.severity ?? 'info',
      summary: input.summary,
      metadata: {
        ...(input.metadata ?? {}),
        externalExecutionAllowed: false,
      },
    })
    .select('id')
    .single()
  if (error || !data?.id) return { ok: false, error: error?.message ?? 'Agent governance event insert failed.', persistenceAvailable: true }
  return { ok: true, value: String(data.id) }
}
