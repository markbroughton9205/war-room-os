import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import type { MemoryRecord } from './types'

const COLUMNS =
  'id,content,memory_type,scope,project_id,conversation_id,status,effective_from,effective_until,superseded_by,importance_tier,source_type,source_ref,created_by,created_at'

export async function getLatestActiveMemoryRecord(
  scope: string,
  projectId: string | null,
): Promise<MemoryRecord | null> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return null
  let query = sup.client
    .from('war_room_memory_records')
    .select(COLUMNS)
    .eq('scope', scope)
    .eq('status', 'active')
    .order('effective_from', { ascending: false })
    .limit(1)
  query = projectId ? query.eq('project_id', projectId) : query.is('project_id', null)
  const { data } = await query.maybeSingle()
  return (data as MemoryRecord | null) ?? null
}

export type WriteDirectiveInput = {
  content: string
  memoryType: string
  scope: string
  projectId: string | null
  conversationId: string | null
  importanceTier?: string
  sourceType?: string
  sourceRef?: Record<string, unknown>
}

/**
 * Writes a new active memory record, superseding the current active record in the same
 * scope/project (if any and if its content actually differs) rather than leaving two "active"
 * rows contradicting each other. Returns both rows so callers (e.g. the intent pre-router) can
 * show the Commander what changed.
 */
export async function writeDirectiveWithSupersession(
  input: WriteDirectiveInput,
): Promise<{ created: MemoryRecord; superseded: MemoryRecord | null } | null> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return null

  const previous = await getLatestActiveMemoryRecord(input.scope, input.projectId)
  if (previous && previous.content.trim() === input.content.trim()) {
    return { created: previous, superseded: null }
  }

  const { data: created, error: insertError } = await sup.client
    .from('war_room_memory_records')
    .insert({
      content: input.content,
      memory_type: input.memoryType,
      scope: input.scope,
      project_id: input.projectId,
      conversation_id: input.conversationId,
      status: 'active',
      importance_tier: input.importanceTier ?? 'strategic',
      source_type: input.sourceType ?? 'commander_message',
      source_ref: input.sourceRef ?? {},
    })
    .select(COLUMNS)
    .single()

  if (insertError || !created) return null

  let superseded: MemoryRecord | null = null
  if (previous) {
    const { data: updated } = await sup.client
      .from('war_room_memory_records')
      .update({ status: 'superseded', effective_until: new Date().toISOString(), superseded_by: created.id })
      .eq('id', previous.id)
      .select(COLUMNS)
      .single()
    superseded = (updated as MemoryRecord | null) ?? null
  }

  return { created: created as MemoryRecord, superseded }
}
