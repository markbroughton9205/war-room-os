import { appendWarRoomActionLog } from '@/lib/war-room/actionLogs'
import { isWarRoomActionStatus } from '@/lib/war-room/actionStatuses'
import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return jsonWithPersistence({ actions: [] }, false)
  }

  const url = new URL(req.url)
  const conversationId = url.searchParams.get('conversationId')

  let q = sup.client
    .from('war_room_actions')
    .select('id,conversation_id,status,type,payload,approval_granted,created_at,updated_at')
    .order('created_at', { ascending: false })
    .limit(200)

  if (conversationId) {
    q = q.eq('conversation_id', conversationId)
  }

  const { data, error } = await q

  if (error) {
    return jsonWithPersistence({ error: error.message, actions: [] }, true, { status: 500 })
  }

  return jsonWithPersistence({ actions: data ?? [] }, true)
}

export async function POST(req: Request) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return jsonWithPersistence({ error: 'Supabase is not configured.' }, false, { status: 503 })
  }

  let body: { type?: string; payload?: Record<string, unknown>; conversationId?: string | null; status?: string }
  try {
    body = await req.json()
  } catch {
    return jsonWithPersistence({ error: 'Invalid JSON body.' }, true, { status: 400 })
  }

  const type = typeof body.type === 'string' ? body.type.trim() : ''
  if (!type) {
    return jsonWithPersistence({ error: 'type is required' }, true, { status: 400 })
  }

  const status = body.status && isWarRoomActionStatus(body.status) ? body.status : 'requested'
  if (status !== 'requested') {
    return jsonWithPersistence({ error: 'New actions must start in requested status.' }, true, { status: 400 })
  }

  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {}
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : null

  if (conversationId) {
    const { data: c, error: cErr } = await sup.client
      .from('war_room_conversations')
      .select('id')
      .eq('id', conversationId)
      .is('deleted_at', null)
      .maybeSingle()
    if (cErr) {
      return jsonWithPersistence({ error: cErr.message }, true, { status: 500 })
    }
    if (!c) {
      return jsonWithPersistence({ error: 'conversationId not found' }, true, { status: 400 })
    }
  }

  const { data, error } = await sup.client
    .from('war_room_actions')
    .insert({
      type,
      payload,
      conversation_id: conversationId,
      status: 'requested',
      approval_granted: false,
    })
    .select('id,conversation_id,status,type,payload,approval_granted,created_at,updated_at')
    .single()

  if (error) {
    return jsonWithPersistence({ error: error.message }, true, { status: 500 })
  }

  await appendWarRoomActionLog(sup.client, data.id, `Action enqueued (${type}).`, 'info', { status: data.status })

  return jsonWithPersistence({ action: data }, true, { status: 201 })
}
