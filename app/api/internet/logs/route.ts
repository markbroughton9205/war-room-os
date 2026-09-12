import { jsonWithPersistence, jsonWithPersistenceSafe, tryWarRoomSupabase } from '@/lib/war-room/persistence'
import { requireOwnedConversationIfPresent } from '@/lib/war-room/conversationOwnership'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 80))
    const conversationId = url.searchParams.get('conversation_id')
    const ownedGate = await requireOwnedConversationIfPresent(conversationId)
    if (!ownedGate.ok) return ownedGate.response

    const sup = tryWarRoomSupabase()
    if (!sup.ok) {
      return jsonWithPersistence({ logs: [] }, false)
    }

    let q = sup.client
      .from('war_room_internet_logs')
      .select('id,conversation_id,action_id,provider,operation,query,status_code,duration_ms,metadata,created_at')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (conversationId) {
      q = q.eq('conversation_id', conversationId)
    }

    const { data, error } = await q

    if (error) {
      return jsonWithPersistence({ error: error.message, logs: [] }, true, { status: 500 })
    }

    return jsonWithPersistenceSafe({ logs: data ?? [] }, true)
  } catch (err) {
    console.error('[api/internet/logs] GET', err instanceof Error ? err.message : err)
    return jsonWithPersistence({ error: 'Internal server error', logs: [] }, false, { status: 500 })
  }
}
