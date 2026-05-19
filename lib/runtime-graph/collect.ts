import 'server-only'

import { listMissionSnapshot } from '@/lib/missions/persistence'
import { listOutcomeSnapshot } from '@/lib/outcomes/persistence'
import { listRevenueEngineSnapshot } from '@/lib/revenue-engine/persistence'
import { collectCanonicalRuntimeStatus } from '@/lib/runtime/canonicalStatus'
import { listPersistedSignalSnapshot } from '@/lib/signals'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { buildRuntimeGraph } from './build'
import type { RuntimeGraphInputs, RuntimeGraphSnapshot } from './types'

type ActionRow = {
  id?: unknown
  type?: unknown
  status?: unknown
  payload?: unknown
  created_at?: unknown
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function payloadTitle(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const title = (value as Record<string, unknown>).title
  return typeof title === 'string' && title.trim() ? title.trim() : null
}

async function listApprovals(): Promise<RuntimeGraphInputs['approvals']> {
  const supabase = tryWarRoomSupabase()
  if (!supabase.ok) return []
  const { data, error } = await supabase.client
    .from('war_room_actions')
    .select('id,type,status,payload,created_at')
    .in('status', ['requested', 'pending', 'approved'])
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return []
  return ((data ?? []) as ActionRow[]).map(row => ({
    id: text(row.id),
    type: text(row.type, 'approval'),
    status: text(row.status, 'requested'),
    title: payloadTitle(row.payload),
    created_at: text(row.created_at, new Date().toISOString()),
  })).filter(action => action.id)
}

export async function collectRuntimeGraph(req: Request): Promise<RuntimeGraphSnapshot> {
  const [canonical, missionSnapshot, outcomes, revenue, signals, approvals] = await Promise.all([
    collectCanonicalRuntimeStatus(req),
    listMissionSnapshot(),
    listOutcomeSnapshot(80),
    listRevenueEngineSnapshot(40),
    listPersistedSignalSnapshot(40),
    listApprovals(),
  ])

  return buildRuntimeGraph({
    canonical,
    missions: missionSnapshot.missions,
    outcomes,
    revenue,
    signals,
    approvals,
  })
}
