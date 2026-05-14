import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import type { OperationalMemorySnapshot } from '@/lib/memory/types'

export type OperationalSnapshotResult = {
  snapshot: OperationalMemorySnapshot
  note?: string
}

/** Aggregate latest non-secret server state for mission continuity (best-effort). */
export async function buildOperationalMemorySnapshot(client: WarRoomSupabase): Promise<OperationalSnapshotResult> {
  const snapshot: OperationalMemorySnapshot = {}
  const notes: string[] = []

  const { data: conv, error: convErr } = await client
    .from('war_room_conversations')
    .select('id,title,state,last_message_at,metadata')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (convErr) {
    notes.push(`conversations:${convErr.message}`)
  } else if (conv && typeof conv === 'object') {
    const c = conv as {
      id: string
      title: string
      state: string
      last_message_at: string | null
    }
    snapshot.activeMission = {
      conversationId: c.id,
      title: c.title ?? null,
      state: c.state ?? null,
      lastMessageAt: c.last_message_at,
    }
  }

  const { data: perm, error: permErr } = await client.from('war_room_permissions_state').select('*').eq('id', 1).maybeSingle()

  if (permErr) {
    notes.push(`permissions:${permErr.message}`)
  } else if (perm && typeof perm === 'object') {
    const p = perm as {
      mode?: string
      safety_lock?: boolean
      last_auto_action_at?: string | null
      last_auto_action_kind?: string | null
    }
    snapshot.platformSummaryRefs = {
      permissionMode: typeof p.mode === 'string' ? p.mode : null,
      safetyLock: typeof p.safety_lock === 'boolean' ? p.safety_lock : null,
      lastAutoActionAt: p.last_auto_action_at ?? null,
      lastAutoActionKind: p.last_auto_action_kind ?? null,
    }
  }

  const { count: incomeCount, error: incErr } = await client
    .from('income_opportunities')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)

  if (incErr) {
    notes.push(`income_opportunities:${incErr.message}`)
  } else {
    const { data: newestInc } = await client
      .from('income_opportunities')
      .select('discovered_at')
      .eq('is_active', true)
      .order('discovered_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    snapshot.incomeOps = {
      activeOpportunityCount: incomeCount ?? 0,
      newestDiscoveredAt:
        newestInc && typeof newestInc === 'object' && 'discovered_at' in newestInc
          ? String((newestInc as { discovered_at: string }).discovered_at)
          : null,
    }
  }

  const { count: pendCount, error: actErr } = await client
    .from('war_room_actions')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'waiting_approval')

  if (actErr) {
    notes.push(`war_room_actions:${actErr.message}`)
  } else {
    const { data: types } = await client
      .from('war_room_actions')
      .select('type')
      .order('created_at', { ascending: false })
      .limit(8)

    const sample =
      Array.isArray(types) && types.length
        ? types.map(t => (t && typeof t === 'object' && 'type' in t ? String((t as { type: string }).type) : '')).filter(Boolean)
        : []
    snapshot.agentAssignments = {
      pendingApprovalCount: pendCount ?? 0,
      recentActionTypeSample: sample,
    }
  }

  return {
    snapshot,
    note: notes.length ? notes.join(' | ') : undefined,
  }
}
