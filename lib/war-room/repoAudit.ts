import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

export async function logWarRoomRepoAudit(message: string, metadata: Record<string, unknown> = {}) {
  const sup = tryWarRoomSupabase()
  await insertWarRoomAuditLog(sup.ok ? sup.client : null, {
    actor: 'system',
    category: 'repo',
    message,
    metadata,
  })
}
