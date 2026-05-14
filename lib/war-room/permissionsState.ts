import type { StandingPermissionMode } from '@/lib/permissions/standingPermissions'
import { isStandingPermissionMode } from '@/lib/permissions/standingPermissions'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

export type WarRoomPermissionsStateRow = {
  id: number
  mode: string
  safety_lock: boolean
  last_auto_action_at: string | null
  last_auto_action_kind: string | null
  last_auto_action_detail: Record<string, unknown> | null
  updated_at: string
}

export type ResolvedWarRoomPermissionsState = {
  mode: StandingPermissionMode
  safetyLock: boolean
  lastAutoAction: {
    at: string
    kind: string
    detail: Record<string, unknown>
  } | null
}

const DEFAULT_MODE: StandingPermissionMode = 'operator'

export function defaultPermissionsState(): ResolvedWarRoomPermissionsState {
  return {
    mode: DEFAULT_MODE,
    safetyLock: false,
    lastAutoAction: null,
  }
}

function normalizeRow(row: WarRoomPermissionsStateRow): ResolvedWarRoomPermissionsState {
  const mode = isStandingPermissionMode(row.mode) ? row.mode : DEFAULT_MODE
  const lastAt = row.last_auto_action_at
  const lastKind = row.last_auto_action_kind
  const lastDetail = row.last_auto_action_detail
  const lastAutoAction =
    lastAt && lastKind
      ? {
          at: lastAt,
          kind: lastKind,
          detail: lastDetail && typeof lastDetail === 'object' ? lastDetail : {},
        }
      : null

  return {
    mode,
    safetyLock: Boolean(row.safety_lock),
    lastAutoAction,
  }
}

export async function fetchWarRoomPermissionsState(
  client: WarRoomSupabase | null,
): Promise<ResolvedWarRoomPermissionsState> {
  if (!client) return defaultPermissionsState()

  const { data, error } = await client
    .from('war_room_permissions_state')
    .select('id,mode,safety_lock,last_auto_action_at,last_auto_action_kind,last_auto_action_detail,updated_at')
    .eq('id', 1)
    .maybeSingle()

  if (error || !data) return defaultPermissionsState()
  return normalizeRow(data as WarRoomPermissionsStateRow)
}

export async function upsertWarRoomPermissionsState(
  client: WarRoomSupabase,
  patch: { mode?: StandingPermissionMode; safetyLock?: boolean },
): Promise<ResolvedWarRoomPermissionsState> {
  const current = await fetchWarRoomPermissionsState(client)
  const nextMode = patch.mode ?? current.mode
  const nextLock = patch.safetyLock ?? current.safetyLock

  const updates = {
    mode: nextMode,
    safety_lock: nextLock,
    updated_at: new Date().toISOString(),
  }

  const { data: existing, error: selErr } = await client
    .from('war_room_permissions_state')
    .select('id')
    .eq('id', 1)
    .maybeSingle()

  if (selErr) throw new Error(selErr.message)

  if (existing) {
    const { error } = await client.from('war_room_permissions_state').update(updates).eq('id', 1)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await client.from('war_room_permissions_state').insert({ id: 1, ...updates })
    if (error) throw new Error(error.message)
  }

  return fetchWarRoomPermissionsState(client)
}

export async function recordLastStandingAutoAction(
  client: WarRoomSupabase | null,
  input: { kind: string; detail?: Record<string, unknown> },
): Promise<void> {
  if (!client) return
  await client
    .from('war_room_permissions_state')
    .update({
      last_auto_action_at: new Date().toISOString(),
      last_auto_action_kind: input.kind,
      last_auto_action_detail: input.detail ?? {},
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
}
