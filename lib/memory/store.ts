import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import type { ApprovedMemory, MemoryFamilyPartition, MemoryProposal, MemoryProposalStatus } from '@/lib/memory/types'

type ProposalRow = {
  id: string
  created_at: string
  updated_at: string
  family_partition: string
  proposed_by: string
  title: string
  content_redacted: string
  status: MemoryProposalStatus
  metadata: Record<string, unknown> | null
  conversation_id: string | null
}

function mapProposalRow(r: ProposalRow): MemoryProposal {
  return {
    id: r.id,
    created_at: r.created_at,
    updated_at: r.updated_at,
    family_partition: r.family_partition as MemoryFamilyPartition,
    proposed_by: r.proposed_by,
    title: r.title,
    content_redacted: r.content_redacted,
    status: r.status,
    metadata: r.metadata && typeof r.metadata === 'object' ? r.metadata : {},
    conversation_id: r.conversation_id,
  }
}

export async function insertMemoryProposal(
  client: WarRoomSupabase,
  input: {
    family_partition: MemoryFamilyPartition
    proposed_by: string
    title: string
    content_redacted: string
    conversation_id: string | null
    metadata: Record<string, unknown>
    created_by_user_id?: string | null
    ownership_authority_basis?: 'authenticated_commander_session' | 'legacy_backfill_commander' | null
  },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await client
    .from('war_room_memory_proposals')
    .insert({
      family_partition: input.family_partition,
      proposed_by: input.proposed_by,
      title: input.title,
      content_redacted: input.content_redacted,
      status: 'pending',
      metadata: input.metadata,
      conversation_id: input.conversation_id,
      ...(input.created_by_user_id ? { created_by_user_id: input.created_by_user_id } : {}),
      ...(input.ownership_authority_basis ? { ownership_authority_basis: input.ownership_authority_basis } : {}),
    })
    .select('id')
    .single()

  if (error || !data?.id) {
    return { ok: false, error: error?.message || 'Insert failed.' }
  }
  return { ok: true, id: data.id as string }
}

export async function listPendingMemoryProposals(
  client: WarRoomSupabase,
  limit = 100,
): Promise<{ ok: true; rows: MemoryProposal[] } | { ok: false; error: string }> {
  const { data, error } = await client
    .from('war_room_memory_proposals')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    return { ok: false, error: error.message }
  }
  const rows = (data as ProposalRow[] | null)?.map(mapProposalRow) ?? []
  return { ok: true, rows }
}

export async function approveMemoryProposal(
  client: WarRoomSupabase,
  proposalId: string,
): Promise<{ ok: true; approvedId: string } | { ok: false; error: string }> {
  const { data: row, error: fetchErr } = await client
    .from('war_room_memory_proposals')
    .select('*')
    .eq('id', proposalId)
    .eq('status', 'pending')
    .maybeSingle()

  if (fetchErr) {
    return { ok: false, error: fetchErr.message }
  }
  if (!row) {
    return { ok: false, error: 'Proposal not found or not pending.' }
  }

  const p = row as ProposalRow
  const { data: approved, error: insErr } = await client
    .from('war_room_approved_memories')
    .insert({
      family_partition: p.family_partition,
      title: p.title,
      content: p.content_redacted,
      source_proposal_id: p.id,
      metadata: { ...(p.metadata || {}), approvedFrom: 'war_room_memory_proposals' },
    })
    .select('id')
    .single()

  if (insErr || !approved?.id) {
    return { ok: false, error: insErr?.message || 'Approved insert failed.' }
  }

  const { error: updErr } = await client
    .from('war_room_memory_proposals')
    .update({ status: 'approved' })
    .eq('id', proposalId)
    .eq('status', 'pending')

  if (updErr) {
    return { ok: false, error: updErr.message }
  }

  return { ok: true, approvedId: approved.id as string }
}

export async function rejectMemoryProposal(
  client: WarRoomSupabase,
  proposalId: string,
  reason?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: existing, error: fetchErr } = await client
    .from('war_room_memory_proposals')
    .select('id,status,metadata')
    .eq('id', proposalId)
    .maybeSingle()

  if (fetchErr) {
    return { ok: false, error: fetchErr.message }
  }
  if (!existing || (existing as { status: string }).status !== 'pending') {
    return { ok: false, error: 'Proposal not found or not pending.' }
  }

  const meta = (existing as { metadata?: Record<string, unknown> }).metadata
  const merged: Record<string, unknown> =
    meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...meta } : {}
  if (reason && reason.trim()) {
    merged.reject_reason = reason.trim().slice(0, 2000)
  }

  const { error: updErr } = await client
    .from('war_room_memory_proposals')
    .update({ status: 'rejected', metadata: merged })
    .eq('id', proposalId)
    .eq('status', 'pending')

  if (updErr) {
    return { ok: false, error: updErr.message }
  }
  return { ok: true }
}

export async function listApprovedMemoriesByPartition(
  client: WarRoomSupabase,
  partition: MemoryFamilyPartition,
  limit: number,
): Promise<{ ok: true; rows: ApprovedMemory[] } | { ok: false; error: string }> {
  const { data, error } = await client
    .from('war_room_approved_memories')
    .select('*')
    .eq('family_partition', partition)
    .order('approved_at', { ascending: false })
    .limit(limit)

  if (error) {
    return { ok: false, error: error.message }
  }
  const rows =
    (data as {
      id: string
      approved_at: string
      family_partition: string
      title: string
      content: string
      source_proposal_id: string | null
      metadata: Record<string, unknown> | null
    }[] | null)?.map(r => ({
      id: r.id,
      approved_at: r.approved_at,
      family_partition: r.family_partition as MemoryFamilyPartition,
      title: r.title,
      content: r.content,
      source_proposal_id: r.source_proposal_id,
      metadata: r.metadata && typeof r.metadata === 'object' ? r.metadata : {},
    })) ?? []
  return { ok: true, rows }
}

export async function listRecentApprovedMemories(
  client: WarRoomSupabase,
  limit: number,
): Promise<{ ok: true; rows: ApprovedMemory[] } | { ok: false; error: string }> {
  const { data, error } = await client
    .from('war_room_approved_memories')
    .select('*')
    .order('approved_at', { ascending: false })
    .limit(limit)

  if (error) {
    return { ok: false, error: error.message }
  }
  const rows =
    (data as {
      id: string
      approved_at: string
      family_partition: string
      title: string
      content: string
      source_proposal_id: string | null
      metadata: Record<string, unknown> | null
    }[] | null)?.map(r => ({
      id: r.id,
      approved_at: r.approved_at,
      family_partition: r.family_partition as MemoryFamilyPartition,
      title: r.title,
      content: r.content,
      source_proposal_id: r.source_proposal_id,
      metadata: r.metadata && typeof r.metadata === 'object' ? r.metadata : {},
    })) ?? []
  return { ok: true, rows }
}
