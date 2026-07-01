import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { rejectMemoryProposal } from '@/lib/memory/store'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return jsonWithPersistence({ error: 'Supabase is not configured.' }, false, { status: 503 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence({ error: 'Invalid JSON body.' }, true, { status: 400 })
  }

  const parsed = body as { proposalId?: string; reason?: string | null }
  const proposalId = typeof parsed.proposalId === 'string' ? parsed.proposalId.trim() : ''
  if (!proposalId) {
    return jsonWithPersistence({ error: 'proposalId is required.' }, true, { status: 400 })
  }
  const reason = typeof parsed.reason === 'string' ? parsed.reason : null

  const res = await rejectMemoryProposal(sup.client, proposalId, reason)
  if (!res.ok) {
    return jsonWithPersistence({ error: res.error }, true, { status: 400 })
  }

  await insertWarRoomAuditLog(sup.client, {
    actor: 'system',
    category: 'memory',
    message: `Rejected memory proposal ${proposalId}`,
    metadata: { proposalId, reason: reason?.slice(0, 500) ?? null },
  })

  return jsonWithPersistence({ ok: true }, true)
}
