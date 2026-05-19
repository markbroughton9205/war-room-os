import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

function sanitizeDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(detail)) {
    if (typeof value === 'string') {
      out[key] = value
        .replace(/sk-[a-zA-Z0-9_-]{8,}/g, '[redacted]')
        .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .slice(0, 400)
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[key] = value
    } else if (Array.isArray(value)) {
      out[key] = value.slice(0, 12)
    }
  }
  return out
}

export async function logCognitiveBusAudit(
  client: WarRoomSupabase | null,
  row: {
    action: string
    threadId: string
    detail?: Record<string, unknown>
  },
): Promise<void> {
  await insertWarRoomAuditLog(client, {
    actor: 'system',
    category: 'runtime',
    message: `cognitive_bus:${row.action}`,
    metadata: sanitizeDetail({
      thread_id: row.threadId,
      timestamp: new Date().toISOString(),
      ...(row.detail ?? {}),
    }),
  })
}
