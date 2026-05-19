import type { CouncilConversationRuntime } from '@/lib/conversation-runtime/types'
import type { WarRoomSupabase } from '@/lib/war-room/persistence'

const MIGRATION_HINT = 'supabase/war_room_phase32_conversation_runtime.sql'

function isMissingColumnError(message: string): boolean {
  return /conversation_runtime/i.test(message) && /(does not exist|schema cache|PGRST)/i.test(message)
}

export async function loadConversationRuntimeFromSupabase(
  client: WarRoomSupabase | null,
  threadId: string,
): Promise<{ runtime: Partial<CouncilConversationRuntime> | null; migrationRequired: boolean }> {
  if (!client || !threadId.trim()) return { runtime: null, migrationRequired: false }

  const { data, error } = await client
    .from('war_room_council_thread_state')
    .select('conversation_runtime')
    .eq('thread_id', threadId.trim())
    .maybeSingle()

  if (error) {
    if (isMissingColumnError(error.message)) return { runtime: null, migrationRequired: true }
    return { runtime: null, migrationRequired: false }
  }

  const raw = data?.conversation_runtime
  if (!raw || typeof raw !== 'object') return { runtime: null, migrationRequired: false }
  return { runtime: raw as Partial<CouncilConversationRuntime>, migrationRequired: false }
}

export async function persistConversationRuntimeToSupabase(
  client: WarRoomSupabase | null,
  threadId: string,
  runtime: CouncilConversationRuntime,
): Promise<{ ok: boolean; migrationRequired?: boolean }> {
  if (!client || !threadId.trim()) return { ok: true }

  const { error } = await client
    .from('war_room_council_thread_state')
    .upsert(
      {
        thread_id: threadId.trim(),
        conversation_runtime: runtime,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'thread_id' },
    )

  if (error) {
    if (isMissingColumnError(error.message)) return { ok: false, migrationRequired: true }
    return { ok: false }
  }
  return { ok: true }
}

export function conversationRuntimeMigrationHint(): string {
  return MIGRATION_HINT
}
