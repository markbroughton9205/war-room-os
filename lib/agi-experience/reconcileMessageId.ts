import { tryWarRoomSupabase } from '@/lib/war-room/persistence'

/**
 * Closes Wave 1's "ordinary Council-turn Experience Records may lack a real message_id"
 * limitation WITHOUT any client-side change (app/page.tsx's ~14 postLiveCouncilMessage call
 * sites are deep, live, daily-use UI code — touching all of them to thread a server-minted
 * idempotency key through was assessed as materially higher risk than this approach).
 *
 * The client still performs its own dual-write of the assistant message (unchanged). This
 * function polls briefly for the row it creates, matched by conversation + role + exact content,
 * and returns its real id so AGIExperienceRecord can reference a genuine war_room_messages row
 * instead of null. A short bounded wait is acceptable because this only runs inside the
 * fire-and-forget experience-capture hook (lib/agi-experience/captureFromChatResponse.ts), never
 * on the Commander-facing response path.
 *
 * Known limitation, stated plainly: if two identical-content assistant messages land in the same
 * conversation within the polling window, this can attribute to the wrong (but still real) row.
 * Rare in practice and acceptable for Wave 2's bar ("can reference real messages"), not perfect
 * attribution.
 */
export async function reconcileAssistantMessageId(
  conversationId: string,
  expectedContent: string,
  sinceIso: string,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<string | null> {
  const sup = tryWarRoomSupabase()
  if (!sup.ok) return null

  const attempts = opts.attempts ?? 4
  const delayMs = opts.delayMs ?? 250
  const trimmed = expectedContent.trim()
  if (!trimmed) return null

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { data } = await sup.client
      .from('war_room_messages')
      .select('id,created_at')
      .eq('conversation_id', conversationId)
      .eq('role', 'assistant')
      .eq('content', trimmed)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (data?.id) return data.id as string
    if (attempt < attempts - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
  return null
}
