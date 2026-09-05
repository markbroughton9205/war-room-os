/**
 * WR-Engineer audit — reuses War Room's existing audit sink (lib/war-room/auditLog.ts's
 * `insertWarRoomAuditLog`, backed by the `war_room_audit_logs` table) rather than inventing a
 * second logging system. No `'node'`/`'engineering'` category exists in `WAR_ROOM_AUDIT_CATEGORIES`
 * (confirmed: 'action' | 'engine' | 'internet' | 'repo' | 'sentinel' | 'permissions' | 'event' |
 * 'memory' | 'payment' | 'runtime') — 'runtime' is the closest semantic fit for a machine/tool
 * event, so every WR-Engineer node/tool event is logged under that existing category with a
 * `metadata.source: 'wr-engineer'` tag for filtering, rather than adding a new category to a
 * shared enum other subsystems also depend on.
 *
 * Best-effort: if Supabase isn't configured (dev environment, missing service-role key), this
 * silently no-ops exactly like `insertWarRoomAuditLog` itself does for a null client — audit
 * logging must never block or fail the actual engineering action it's describing.
 */
import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

export async function logWrEngineerAudit(message: string, metadata: Record<string, unknown> = {}): Promise<void> {
  const sup = tryWarRoomSupabase()
  await insertWarRoomAuditLog(sup.ok ? sup.client : null, {
    actor: 'system',
    category: 'runtime',
    message,
    metadata: { ...metadata, source: 'wr-engineer' },
  })
}
