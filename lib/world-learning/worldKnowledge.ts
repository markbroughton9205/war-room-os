import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import type { ClaimRecord, WorldKnowledgeRecord } from './types'

/**
 * Promotes a candidate claim into a retrievable WorldKnowledgeRecord. Never auto-promotes to
 * 'active' — Wave 2's pipeline creates these as 'candidate' (Phase 22: "do not make every
 * research result automatically 'trusted knowledge'"); an explicit Commander/verifier action is
 * required to move status to 'active'. Content is NOT a copy of the raw source — it's the
 * claim's own normalized text, with source/claim ids kept as references only (Phase 21/45).
 */
export async function createWorldKnowledgeCandidate(
  claim: ClaimRecord,
  sourceIds: string[],
  projectId: string | null,
): Promise<WorldKnowledgeRecord | null> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return null
  const { data, error } = await sup.client
    .from('war_room_world_knowledge_records')
    .insert({
      content: claim.normalized_claim_text,
      claim_ids: [claim.id],
      source_ids: sourceIds,
      project_id: projectId,
      scope: projectId ? 'project' : 'global',
      status: 'candidate',
      confidence: claim.confidence,
    })
    .select('*')
    .single()
  if (error || !data) return null
  return data as WorldKnowledgeRecord
}

/** Active (non-superseded, non-retracted) world knowledge for context injection — Phase 26. */
export async function getActiveWorldKnowledge(projectId: string | null, limit = 10): Promise<WorldKnowledgeRecord[]> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return []
  let query = sup.client
    .from('war_room_world_knowledge_records')
    .select('*')
    .eq('status', 'active')
    .order('valid_from', { ascending: false })
    .limit(limit)
  query = projectId ? query.or(`scope.eq.global,project_id.eq.${projectId}`) : query.eq('scope', 'global')
  const { data } = await query
  return (data as WorldKnowledgeRecord[] | null) ?? []
}
