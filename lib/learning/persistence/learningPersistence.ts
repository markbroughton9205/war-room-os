import 'server-only'

import { tryWarRoomSupabase, type WarRoomSupabase } from '@/lib/war-room/persistence'

export type LearningStoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; persistenceAvailable: boolean }

export type OutcomeLedgerStoreRow = {
  id: string
  decree_id: string | null
  project_id: string | null
  workflow_id: string | null
  analyst_packet_id: string | null
  provider_scores: Record<string, unknown>
  confidence: number
  predicted_outcome: string | null
  actual_outcome: string | null
  outcome_status: 'pending' | 'successful' | 'partial' | 'failed' | 'unresolved' | 'watching' | 'rolled_back'
  usefulness: number | null
  rollback_reference: string | null
  anomaly_flags: string[]
  repair_references: string[]
  evidence: unknown[]
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  evaluated_at: string | null
}

export type CreateOutcomeLedgerInput = {
  decreeId?: string | null
  projectId?: string | null
  workflowId?: string | null
  analystPacketId?: string | null
  providerScores?: Record<string, unknown>
  confidence?: number
  predictedOutcome?: string | null
  actualOutcome?: string | null
  outcomeStatus?: OutcomeLedgerStoreRow['outcome_status']
  usefulness?: number | null
  rollbackReference?: string | null
  anomalyFlags?: string[]
  repairReferences?: string[]
  evidence?: unknown[]
  metadata?: Record<string, unknown>
  evaluatedAt?: string | null
}

export type LearningTableCount = {
  table: string
  records: number | null
  lastEventAt: string | null
  error?: string
}

const OUTCOME_COLUMNS = [
  'id',
  'decree_id',
  'project_id',
  'workflow_id',
  'analyst_packet_id',
  'provider_scores',
  'confidence',
  'predicted_outcome',
  'actual_outcome',
  'outcome_status',
  'usefulness',
  'rollback_reference',
  'anomaly_flags',
  'repair_references',
  'evidence',
  'metadata',
  'created_at',
  'updated_at',
  'evaluated_at',
].join(',')

export function getLearningSupabase(): LearningStoreResult<WarRoomSupabase> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return { ok: false, error: sup.configError, persistenceAvailable: false }
  return { ok: true, value: sup.client }
}

export async function countLearningTable(
  client: WarRoomSupabase,
  table: string,
  dateColumn = 'created_at',
): Promise<LearningTableCount> {
  const countQuery = client.from(table).select('*', { count: 'exact', head: true })
  const latestQuery = client.from(table).select(dateColumn).order(dateColumn, { ascending: false }).limit(1).maybeSingle()
  const [countResult, latestResult] = await Promise.all([countQuery, latestQuery])
  if (countResult.error) {
    return { table, records: null, lastEventAt: null, error: countResult.error.message }
  }
  if (latestResult.error) {
    return { table, records: countResult.count ?? 0, lastEventAt: null, error: latestResult.error.message }
  }
  const row = latestResult.data as Record<string, unknown> | null
  return {
    table,
    records: countResult.count ?? 0,
    lastEventAt: typeof row?.[dateColumn] === 'string' ? row[dateColumn] : null,
  }
}

export async function listOutcomeLedgerEntries(limit = 25): Promise<LearningStoreResult<OutcomeLedgerStoreRow[]>> {
  const sup = getLearningSupabase()
  if (!sup.ok) return sup

  const { data, error } = await sup.value
    .from('war_room_outcome_ledger')
    .select(OUTCOME_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return { ok: false, error: error.message, persistenceAvailable: true }
  return { ok: true, value: (data ?? []) as unknown as OutcomeLedgerStoreRow[] }
}

export async function insertOutcomeLedgerEntry(input: CreateOutcomeLedgerInput): Promise<LearningStoreResult<string>> {
  const sup = getLearningSupabase()
  if (!sup.ok) return sup

  const { data, error } = await sup.value
    .from('war_room_outcome_ledger')
    .insert({
      decree_id: input.decreeId ?? null,
      project_id: input.projectId ?? null,
      workflow_id: input.workflowId ?? null,
      analyst_packet_id: input.analystPacketId ?? null,
      provider_scores: input.providerScores ?? {},
      confidence: input.confidence ?? 0.5,
      predicted_outcome: input.predictedOutcome ?? null,
      actual_outcome: input.actualOutcome ?? null,
      outcome_status: input.outcomeStatus ?? 'pending',
      usefulness: input.usefulness ?? null,
      rollback_reference: input.rollbackReference ?? null,
      anomaly_flags: input.anomalyFlags ?? [],
      repair_references: input.repairReferences ?? [],
      evidence: input.evidence ?? [],
      metadata: input.metadata ?? {},
      evaluated_at: input.evaluatedAt ?? null,
    })
    .select('id')
    .single()

  if (error || !data?.id) return { ok: false, error: error?.message ?? 'Outcome ledger insert failed.', persistenceAvailable: true }
  return { ok: true, value: String(data.id) }
}
