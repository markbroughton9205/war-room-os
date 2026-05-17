import 'server-only'

import { getLearningSupabase, type LearningStoreResult } from './learningPersistence'

export type NarrativeGraphStoreRow = {
  id: string
  entity_relationships: unknown[]
  source_overlap: number
  event_links: unknown[]
  contradiction_clusters: unknown[]
  narrative_synchronization: number
  locality_links: unknown[]
  confidence: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  observed_at: string
}

const NARRATIVE_COLUMNS = [
  'id',
  'entity_relationships',
  'source_overlap',
  'event_links',
  'contradiction_clusters',
  'narrative_synchronization',
  'locality_links',
  'confidence',
  'metadata',
  'created_at',
  'updated_at',
  'observed_at',
].join(',')

export async function listNarrativeGraphRows(limit = 25): Promise<LearningStoreResult<NarrativeGraphStoreRow[]>> {
  const sup = getLearningSupabase()
  if (!sup.ok) return sup

  const { data, error } = await sup.value
    .from('war_room_narrative_graph')
    .select(NARRATIVE_COLUMNS)
    .order('observed_at', { ascending: false })
    .limit(limit)

  if (error) return { ok: false, error: error.message, persistenceAvailable: true }
  return { ok: true, value: (data ?? []) as unknown as NarrativeGraphStoreRow[] }
}

export async function insertNarrativeGraphRow(input: {
  entityRelationships?: unknown[]
  sourceOverlap?: number
  eventLinks?: unknown[]
  contradictionClusters?: unknown[]
  narrativeSynchronization?: number
  localityLinks?: unknown[]
  confidence?: number
  metadata?: Record<string, unknown>
  observedAt?: string
}): Promise<LearningStoreResult<string>> {
  const sup = getLearningSupabase()
  if (!sup.ok) return sup

  const { data, error } = await sup.value
    .from('war_room_narrative_graph')
    .insert({
      entity_relationships: input.entityRelationships ?? [],
      source_overlap: input.sourceOverlap ?? 0,
      event_links: input.eventLinks ?? [],
      contradiction_clusters: input.contradictionClusters ?? [],
      narrative_synchronization: input.narrativeSynchronization ?? 0,
      locality_links: input.localityLinks ?? [],
      confidence: input.confidence ?? 0.5,
      metadata: input.metadata ?? {},
      observed_at: input.observedAt ?? new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error || !data?.id) return { ok: false, error: error?.message ?? 'Narrative graph insert failed.', persistenceAvailable: true }
  return { ok: true, value: String(data.id) }
}
