import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { updateEconomicOpportunityStatus } from '@/lib/economic/store'
import type { EconomicOpportunityStatus } from '@/lib/economic/types'

export const dynamic = 'force-dynamic'

const ALLOWED_ACTIONS: Record<string, EconomicOpportunityStatus> = {
  investigate: 'investigating',
  assign: 'investigating',
  generate_proposal: 'queued',
  queue_workflow: 'queued',
  approve: 'approved',
  reject: 'rejected',
  archive: 'archived',
}

export async function PATCH(req: Request) {
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

  const payload = body as { id?: string; action?: string }
  const id = typeof payload.id === 'string' ? payload.id.trim() : ''
  const action = typeof payload.action === 'string' ? payload.action.trim() : ''
  const status = ALLOWED_ACTIONS[action]

  if (!id || !status) {
    return jsonWithPersistence({ error: 'id and valid action are required.' }, true, { status: 400 })
  }

  const updated = await updateEconomicOpportunityStatus(sup.client, id, status)
  if (!updated.ok) {
    return jsonWithPersistence({ error: updated.error }, true, { status: 500 })
  }

  return jsonWithPersistence({
    ok: true,
    id: updated.value,
    status,
    approvalRequired: ['generate_proposal', 'queue_workflow', 'approve'].includes(action),
    externalExecution: false,
  }, true)
}
