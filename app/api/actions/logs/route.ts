import { jsonWithPersistence, tryWarRoomSupabase } from '@/lib/war-room/persistence'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) {
    return jsonWithPersistence({ logs: [] }, false)
  }

  const url = new URL(req.url)
  const actionId = url.searchParams.get('action_id')
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100))

  if (actionId) {
    const { data, error } = await sup.client
      .from('war_room_action_logs')
      .select('id,action_id,level,message,metadata,created_at')
      .eq('action_id', actionId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      return jsonWithPersistence({ error: error.message, logs: [] }, true, { status: 500 })
    }
    return jsonWithPersistence({ logs: data ?? [] }, true)
  }

  const { data, error } = await sup.client
    .from('war_room_action_logs')
    .select('id,action_id,level,message,metadata,created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    return jsonWithPersistence({ error: error.message, logs: [] }, true, { status: 500 })
  }

  return jsonWithPersistence({ logs: data ?? [] }, true)
}
