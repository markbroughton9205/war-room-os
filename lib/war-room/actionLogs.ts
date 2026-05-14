import type { WarRoomSupabase } from '@/lib/war-room/persistence'

export async function appendWarRoomActionLog(
  client: WarRoomSupabase | null,
  actionId: string,
  message: string,
  level: 'debug' | 'info' | 'warn' | 'error' = 'info',
  metadata: Record<string, unknown> = {},
) {
  if (!client) return
  await client.from('war_room_action_logs').insert({
    action_id: actionId,
    level,
    message,
    metadata,
  })
}
