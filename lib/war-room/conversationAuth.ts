import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Conversation-ownership authorization (audit findings DATA-001 / P1-2). Resolves the real,
 * caller-known identity for the war_room_conversations owner_user_id column added by
 * supabase/war_room_conversations_ownership.sql - NOT Commander-only (any authenticated account,
 * including a future invited one, may use conversations; each just sees only its own), matching
 * the pattern lib/workspace-contributor/routes.ts's requireContributorContext already uses for
 * the same "any authenticated user, scoped to themselves" shape.
 *
 * BLOCKED BY MIGRATION: every call site that filters/sets `owner_user_id` requires that column to
 * exist in the live database first (see the migration file's own header - it is deliberately not
 * applied here). Until it runs, these routes should not be deployed to production with this code
 * live; the migration and this code are meant to land and be verified together, not staged apart.
 */
export type ConversationCaller =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }

/** `resolveUserId` is an injectable seam for tests (see conversationOwnership.validation.ts) -
 * defaults to the real Supabase session lookup; no production call site overrides it. */
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
