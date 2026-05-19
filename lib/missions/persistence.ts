import 'server-only'

import { tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { clonePersistentMissions, isMissionStatus, PERSISTENT_MISSION_IDS } from './definitions'
import type { Mission, MissionApprovalState, MissionId, MissionSnapshot } from './types'

type MissionRow = Record<string, unknown>

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.min(100, Math.round(value)))
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, Math.round(parsed)))
  }
  return fallback
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : []
}

function approvalState(value: unknown): MissionApprovalState {
  const raw = text(value)
  return raw === 'pending' || raw === 'approved' || raw === 'rejected' ? raw : 'none_required'
}

function missionId(value: unknown): MissionId | null {
  const raw = text(value)
  return (PERSISTENT_MISSION_IDS as readonly string[]).includes(raw) ? raw as MissionId : null
}

function mapMissionRow(row: MissionRow): Mission | null {
  const id = missionId(row.id)
  if (!id) return null
  const statusRaw = text(row.status)
  return {
    id,
    title: text(row.title, id),
    description: text(row.description),
    status: isMissionStatus(statusRaw) ? statusRaw : 'ACTIVE',
    current_stage: text(row.current_stage, 'review'),
    priority_score: num(row.priority_score),
    momentum_score: num(row.momentum_score),
    blocker_score: num(row.blocker_score),
    compounding_score: num(row.compounding_score),
    revenue_score: num(row.revenue_score),
    linked_packets: stringArray(row.linked_packets),
    linked_signals: stringArray(row.linked_signals),
    linked_outcomes: stringArray(row.linked_outcomes),
    linked_repairs: stringArray(row.linked_repairs),
    approval_state: approvalState(row.approval_state),
    updated_at: text(row.updated_at, new Date().toISOString()),
  }
}

function snapshot(input: {
  generatedAt: string
  persistenceAvailable: boolean
  persistenceNote: string
  missions: Mission[]
}): MissionSnapshot {
  const byId = new Map(input.missions.map(mission => [mission.id, mission]))
  const ordered = PERSISTENT_MISSION_IDS.map(id => byId.get(id)).filter(Boolean) as Mission[]
  return {
    generatedAt: input.generatedAt,
    persistenceAvailable: input.persistenceAvailable,
    persistenceNote: input.persistenceNote,
    missions: ordered.length === PERSISTENT_MISSION_IDS.length ? ordered : clonePersistentMissions(input.generatedAt),
    guardrails: {
      persistentMissionSet: true,
      humanApprovalAuthorityPreserved: true,
      noAutonomousExecution: true,
      noPlaceholderMissions: true,
    },
  }
}

export async function listMissionSnapshot(): Promise<MissionSnapshot> {
  const generatedAt = new Date().toISOString()
  const supabase = tryWarRoomSupabase()
  if (!supabase.ok) {
    return snapshot({
      generatedAt,
      persistenceAvailable: false,
      persistenceNote: `Supabase unavailable: ${supabase.configError}. Static persistent missions are shown without fabricated telemetry.`,
      missions: clonePersistentMissions(generatedAt),
    })
  }

  const { data, error } = await supabase.client
    .from('war_room_missions')
    .select('*')
    .in('id', [...PERSISTENT_MISSION_IDS])
    .order('priority_score', { ascending: false })

  if (error) {
    return snapshot({
      generatedAt,
      persistenceAvailable: true,
      persistenceNote: `Mission table unavailable or not migrated: ${error.message}. Static persistent missions are shown without fabricated telemetry.`,
      missions: clonePersistentMissions(generatedAt),
    })
  }

  return snapshot({
    generatedAt,
    persistenceAvailable: true,
    persistenceNote: 'Mission persistence is available.',
    missions: ((data ?? []) as MissionRow[]).map(mapMissionRow).filter(Boolean) as Mission[],
  })
}
