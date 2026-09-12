import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Conversation-ownership caller identity (#19 / DATA-001 / P1-2).
 *
 * Resolves the authenticated session user id for war_room_conversations.owner_user_id.
 * NOT Commander-only: any authenticated account may own conversations; each is scoped to self.
 *
 * Pair with requireOwnedConversation / owner filters in lib/war-room/conversationOwnership.ts.
 * SERVICE ROLE BYPASSES RLS — caller identity + owner filters are mandatory at the app layer.
 *
 * Deploy with the ownership SQL phases (schema → backfill → enforce). Until owner_user_id
 * exists, owned fetches fail closed with 503 CONVERSATION_OWNERSHIP_MIGRATION_REQUIRED.
 */
export type ConversationCaller =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }

/** Injectable resolver seam for validation (no production override). */
export async function requireConversationCaller(
  resolveUserId: () => Promise<string | null> = defaultResolveUserId,
): Promise<ConversationCaller> {
  let userId: string | null = null
  try {
    userId = await resolveUserId()
  } catch {
    userId = null
  }
  if (!userId) {
    return { ok: false, response: NextResponse.json({ error: 'Authenticated session required.' }, { status: 401 }) }
  }
  return { ok: true, userId }
}

async function defaultResolveUserId(): Promise<string | null> {
  const client = await createSupabaseServerClient()
  const { data, error } = await client.auth.getUser()
  return !error && data.user?.id ? data.user.id : null
}
