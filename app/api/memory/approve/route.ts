import { insertWarRoomAuditLog } from '@/lib/war-room/auditLog'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { approveMemoryProposal } from '@/lib/memory/store'
import { assertActionRouteAuthorized } from '@/lib/security/actionRouteGuard'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const unauthorized = assertActionRouteAuthorized(req)
  if (unauthorized) return unauthorized

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

  const parsed = body as { proposalId?: string }
  const proposalId = typeof parsed.proposalId === 'string' ? parsed.proposalId.trim() : ''
  if (!proposalId) {
    return jsonWithPersistence({ error: 'proposalId is required.' }, true, { status: 400 })
  }

  const res = await approveMemoryProposal(sup.client, proposalId)
  if (!res.ok) {
    return jsonWithPersistence({ error: res.error }, true, { status: 400 })
  }

  await insertWarRoomAuditLog(sup.client, {
    actor: 'system',
    category: 'memory',
    message: `Approved memory proposal ${proposalId}`,
    metadata: { proposalId, approvedMemoryId: res.approvedId },
  })

  return jsonWithPersistence({ ok: true, approvedId: res.approvedId }, true)
}
