import { WAR_ROOM_RUNTIME_STATE_SCOPE } from '@/lib/runtime/runtimeContinuityConstants'
import { isWarRoomRuntimeStateRelationMissingError } from '@/lib/runtime/runtimeStatePersistenceGuards'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

type RuntimeStateRow = {
  id: string
  key: string
  value: unknown
  scope: string
  created_at: string
  updated_at: string
  expires_at: string | null
}

function getAdminOrNull() {
  try {
    return createSupabaseAdminClient()
  } catch {
    return null
  }
}

export function isRuntimeStatePersistenceConfigured(): boolean {
  return getAdminOrNull() !== null
}

export type SetRuntimeStateOptions = {
  scope?: string
  expiresAt?: string | null
}

export type RuntimeStatePersistResult =
  | { ok: true }
  | { ok: false; tableMissing?: boolean }

export async function getRuntimeState<T = unknown>(key: string, scope = WAR_ROOM_RUNTIME_STATE_SCOPE): Promise<T | null> {
  const supabase = getAdminOrNull()
  if (!supabase) return null
  const { data, error } = await supabase
    .from('war_room_runtime_state')
    .select('value, expires_at')
    .eq('scope', scope)
    .eq('key', key)
    .maybeSingle()
  if (error || !data) return null
  const exp = (data as { expires_at?: string | null }).expires_at
  if (exp) {
    const t = Date.parse(exp)
    if (Number.isFinite(t) && t < Date.now()) {
      void deleteRuntimeState(key, scope)
      return null
    }
  }
  return (data as { value: T }).value ?? null
}

export async function setRuntimeState(
  key: string,
  value: unknown,
  options?: SetRuntimeStateOptions,
): Promise<RuntimeStatePersistResult> {
  const supabase = getAdminOrNull()
  if (!supabase) return { ok: false }
  const scope = options?.scope ?? WAR_ROOM_RUNTIME_STATE_SCOPE
  const row: Record<string, unknown> = {
    scope,
    key,
    value: value === undefined ? {} : value,
    updated_at: new Date().toISOString(),
  }
  if (options?.expiresAt !== undefined) {
    row.expires_at = options.expiresAt
  }
  const { error } = await supabase.from('war_room_runtime_state').upsert(row, { onConflict: 'scope,key' })
  if (!error) return { ok: true }
  return { ok: false, tableMissing: isWarRoomRuntimeStateRelationMissingError(error) }
}

export async function deleteRuntimeState(key: string, scope = WAR_ROOM_RUNTIME_STATE_SCOPE): Promise<RuntimeStatePersistResult> {
  const supabase = getAdminOrNull()
  if (!supabase) return { ok: false }
  const { error } = await supabase.from('war_room_runtime_state').delete().eq('scope', scope).eq('key', key)
  if (!error) return { ok: true }
  return { ok: false, tableMissing: isWarRoomRuntimeStateRelationMissingError(error) }
}

export async function listRuntimeState(scope = WAR_ROOM_RUNTIME_STATE_SCOPE): Promise<RuntimeStateRow[]> {
  const supabase = getAdminOrNull()
  if (!supabase) return []
  const { data, error } = await supabase
    .from('war_room_runtime_state')
    .select('id, key, value, scope, created_at, updated_at, expires_at')
    .eq('scope', scope)
    .order('key', { ascending: true })
  if (error || !Array.isArray(data)) return []
  return data as RuntimeStateRow[]
}
