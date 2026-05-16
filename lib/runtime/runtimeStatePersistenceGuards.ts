import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const WAR_ROOM_RUNTIME_STATE_TABLE = 'war_room_runtime_state'

const AUDIT_COOLDOWN_MS = 300_000
const lastAuditAt = new Map<string, number>()

function shouldThrottleAudit(key: string): boolean {
  const now = Date.now()
  const prev = lastAuditAt.get(key) ?? 0
  if (now - prev < AUDIT_COOLDOWN_MS) return true
  lastAuditAt.set(key, now)
  return false
}

/** PostgREST / Postgres signals that the runtime_state relation is absent or unknown to the schema cache. */
export function isWarRoomRuntimeStateRelationMissingError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const o = error as { code?: string; message?: string; details?: string }
  const code = typeof o.code === 'string' ? o.code : ''
  if (code === 'PGRST205' || code === '42P01') return true
  const msg = `${o.message ?? ''} ${o.details ?? ''}`.toLowerCase()
  if (msg.includes('could not find the table') && msg.includes(WAR_ROOM_RUNTIME_STATE_TABLE)) return true
  if (msg.includes('schema cache') && msg.includes(WAR_ROOM_RUNTIME_STATE_TABLE)) return true
  if (msg.includes('relation') && msg.includes(WAR_ROOM_RUNTIME_STATE_TABLE) && msg.includes('does not exist')) return true
  return false
}

export type WarRoomRuntimeStateProbeResult =
  | { ok: true }
  | { ok: false; reason: 'no_admin_client' }
  | { ok: false; reason: 'supabase'; tableMissing: boolean; code?: string; message?: string }

export function probeWarRoomRuntimeStateWithClient(
  client: ReturnType<typeof createSupabaseAdminClient>,
): Promise<WarRoomRuntimeStateProbeResult> {
  return (async (): Promise<WarRoomRuntimeStateProbeResult> => {
    const { error } = await client.from(WAR_ROOM_RUNTIME_STATE_TABLE).select('key').limit(1).maybeSingle()
    if (!error) return { ok: true }
    const tableMissing = isWarRoomRuntimeStateRelationMissingError(error)
    const o = error as { code?: string; message?: string }
    return {
      ok: false,
      reason: 'supabase',
      tableMissing,
      code: typeof o.code === 'string' ? o.code : undefined,
      message: typeof o.message === 'string' ? o.message : undefined,
    }
  })()
}

export async function probeWarRoomRuntimeStateReachable(): Promise<WarRoomRuntimeStateProbeResult> {
  try {
    const client = createSupabaseAdminClient()
    return await probeWarRoomRuntimeStateWithClient(client)
  } catch {
    return { ok: false, reason: 'no_admin_client' }
  }
}

type RuntimePersistenceAuditEvents =
  | 'runtimeStateTableMissing'
  | 'runtimeStateReadFailed'
  | 'fallbackProviderRegistryUsed'

export function auditRuntimePersistenceEvent(
  kind: RuntimePersistenceAuditEvents,
  metadata?: Record<string, unknown>,
): void {
  const key = `${kind}:${metadata?.phase ?? ''}`
  if (shouldThrottleAudit(key)) return
  const sup = tryWarRoomSupabase()
  void insertWarRoomAuditLog(sup.ok ? sup.client : null, {
    actor: 'system',
    category: 'runtime',
    message: kind,
    metadata: {
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
      kind,
    },
  })
}
