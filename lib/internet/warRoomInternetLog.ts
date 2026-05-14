import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'
import { redactInternetQuery } from '@/lib/internet/redact'

type InsertRow = {
  conversation_id?: string | null
  action_id?: string | null
  provider: string
  operation: 'status' | 'search' | 'fetch'
  query: string | null
  status_code: number | null
  duration_ms: number | null
  metadata: Record<string, unknown>
}

export async function insertInternetLog(
  client: WarRoomSupabase | null,
  row: InsertRow,
): Promise<void> {
  if (!client) return
  const safeQuery = row.query ? redactInternetQuery(row.query) : null
  await client.from('war_room_internet_logs').insert({
    conversation_id: row.conversation_id ?? null,
    action_id: row.action_id ?? null,
    provider: row.provider,
    operation: row.operation,
    query: safeQuery,
    status_code: row.status_code,
    duration_ms: row.duration_ms,
    metadata: row.metadata,
  })

  await insertWarRoomAuditLog(client, {
    actor: 'system',
    category: 'internet',
    action_id: row.action_id ?? null,
    message: `Internet ${row.operation} (${row.provider})`,
    metadata: {
      provider: row.provider,
      operation: row.operation,
      status_code: row.status_code,
      duration_ms: row.duration_ms,
      query_redacted: safeQuery,
    },
  })
}
