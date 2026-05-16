import type { WarRoomSupabase } from '@/lib/war-room/persistence'

export const WAR_ROOM_AUDIT_CATEGORIES = [
  'action',
  'engine',
  'internet',
  'repo',
  'sentinel',
  'permissions',
  'event',
  'memory',
  'payment',
  'runtime',
] as const
export type WarRoomAuditCategory = (typeof WAR_ROOM_AUDIT_CATEGORIES)[number]

export type WarRoomAuditActor = 'system' | 'user'

export type InsertWarRoomAuditRow = {
  actor: WarRoomAuditActor
  category: WarRoomAuditCategory
  action_id?: string | null
  message: string
  metadata?: Record<string, unknown>
}

export function isWarRoomAuditCategory(value: string): value is WarRoomAuditCategory {
  return (WAR_ROOM_AUDIT_CATEGORIES as readonly string[]).includes(value)
}

export async function insertWarRoomAuditLog(
  client: WarRoomSupabase | null,
  row: InsertWarRoomAuditRow,
): Promise<void> {
  if (!client) return
  await client.from('war_room_audit_logs').insert({
    actor: row.actor,
    category: row.category,
    action_id: row.action_id ?? null,
    message: row.message,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
  })
}
