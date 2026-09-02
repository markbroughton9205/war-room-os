import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import type { KnowledgeGap, KnowledgeGapType } from './types'

export async function createKnowledgeGap(input: {
  question: string
  gapType?: KnowledgeGapType
  projectId?: string | null
  conversationId?: string | null
  priority?: number
  createdBy?: string
}): Promise<KnowledgeGap | null> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return null
  const { data, error } = await sup.client
    .from('war_room_knowledge_gaps')
    .insert({
      question: input.question,
      gap_type: input.gapType ?? 'missing_answer',
      project_id: input.projectId ?? null,
      conversation_id: input.conversationId ?? null,
      priority: input.priority ?? 0,
      created_by: input.createdBy ?? 'commander',
    })
    .select('*')
    .single()
  if (error || !data) return null
  return data as KnowledgeGap
}

export async function resolveKnowledgeGap(
  gapId: string,
  resolutionRefs: Record<string, unknown>,
): Promise<KnowledgeGap | null> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return null
  const { data, error } = await sup.client
    .from('war_room_knowledge_gaps')
    .update({ status: 'resolved', resolution_refs: resolutionRefs })
    .eq('id', gapId)
    .select('*')
    .single()
  if (error || !data) return null
  return data as KnowledgeGap
}

export async function listOpenKnowledgeGaps(projectId: string | null, limit = 20): Promise<KnowledgeGap[]> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return []
  let query = sup.client
    .from('war_room_knowledge_gaps')
    .select('*')
    .in('status', ['open', 'researching'])
    .order('priority', { ascending: false })
    .order('updated_at', { ascending: true })
    .limit(limit)
  query = projectId ? query.eq('project_id', projectId) : query.is('project_id', null)
  const { data } = await query
  return (data as KnowledgeGap[] | null) ?? []
}

export async function listUnresolvedContradictionsForProject(projectId: string | null, limit = 20) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return []
  // Contradictions don't carry project_id directly (they relate two claims); join through
  // claim_a's project scope, which is the common case for Wave 2's bounded pipeline.
  const { data: claims } = projectId
    ? await sup.client.from('war_room_claim_records').select('id').eq('project_id', projectId)
    : { data: [] as { id: string }[] }
  const claimIds = (claims ?? []).map(c => c.id)
  if (!claimIds.length) return []
  const { data } = await sup.client
    .from('war_room_contradiction_records')
    .select('*')
    .eq('verification_status', 'unverified')
    .in('claim_a_id', claimIds)
    .limit(limit)
  return data ?? []
}

/** Same as listUnresolvedContradictionsForProject, but resolves each contradiction's two claim
 * ids into their normalized claim text — used by Prompt Intelligence (Phase 35) so a composed
 * research prompt can name the actual disagreement rather than bare ids. */
export async function listUnresolvedContradictionsWithClaimText(
  projectId: string | null,
  limit = 10,
): Promise<{ claimAText: string; claimBText: string }[]> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return []
  const contradictions = await listUnresolvedContradictionsForProject(projectId, limit)
  if (!contradictions.length) return []

  const claimIds = Array.from(new Set(contradictions.flatMap(c => [c.claim_a_id as string, c.claim_b_id as string])))
  const { data: claims } = await sup.client
    .from('war_room_claim_records')
    .select('id,normalized_claim_text')
    .in('id', claimIds)
  const textById = new Map((claims ?? []).map(c => [c.id as string, c.normalized_claim_text as string]))

  return contradictions.map(c => ({
    claimAText: textById.get(c.claim_a_id as string) ?? '(claim text unavailable)',
    claimBText: textById.get(c.claim_b_id as string) ?? '(claim text unavailable)',
  }))
}
