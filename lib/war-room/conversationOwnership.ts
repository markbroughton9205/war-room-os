import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireConversationCaller, type ConversationCaller } from '@/lib/war-room/conversationAuth'
import { tryWarRoomSupabase, type WarRoomSupabase } from '@/lib/war-room/persistence'

/**
 * #19 conversation ownership — application-layer authorization.
 *
 * SERVICE ROLE BYPASSES RLS. Every externally reachable path that accepts a
 * conversation UUID must call these helpers (or equivalent owner filters) before
 * performing privileged reads/writes. RLS on war_room_conversations is defense
 * in depth only.
 *
 * Fail-closed: if the owner_user_id column is missing, return 503 migration
 * required — never fall back to global/unowned access.
 */

export const CONVERSATION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const TABLE_CONVERSATIONS = 'war_room_conversations'

export type OwnedConversationRow = {
  id: string
  owner_user_id: string
  title?: string | null
  metadata?: unknown
  state?: string | null
  deleted_at?: string | null
  created_at?: string | null
  updated_at?: string | null
  last_message_at?: string | null
}

export type OwnedConversationOk = {
  ok: true
  userId: string
  conversationId: string
  conversation: OwnedConversationRow
  client: WarRoomSupabase
}

export type OwnedConversationErr = {
  ok: false
  status: 400 | 401 | 404 | 500 | 503
  error: string
  code?: 'UNAUTHENTICATED' | 'INVALID_ID' | 'NOT_FOUND' | 'MIGRATION_REQUIRED' | 'SUPABASE_UNAVAILABLE' | 'QUERY_FAILED'
  response: NextResponse
}

export type OwnedConversationResult = OwnedConversationOk | OwnedConversationErr

function isMissingOwnerColumnError(message: string): boolean {
  const m = message.toLowerCase()
  return m.includes('owner_user_id') && (m.includes('does not exist') || m.includes('schema cache') || m.includes('pgrst'))
}

function notFoundResponse(message = 'Not found'): NextResponse {
  // Non-enumerating: unowned UUIDs look identical to missing ones.
  return NextResponse.json({ error: message }, { status: 404 })
}

function migrationRequiredResponse(): NextResponse {
  return NextResponse.json(
    {
      error: 'Conversation ownership migration required.',
      code: 'CONVERSATION_OWNERSHIP_MIGRATION_REQUIRED',
      hint: 'Apply supabase/war_room_conversations_ownership*.sql before enabling owner-aware routes.',
    },
    { status: 503 },
  )
}

export function parseConversationId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const id = raw.trim()
  return CONVERSATION_UUID_RE.test(id) ? id : null
}

/** Strip any client-supplied ownership field — server assigns owner exclusively. */
export function stripClientOwnerFields<T extends Record<string, unknown>>(body: T): T {
  if (!body || typeof body !== 'object') return body
  const next = { ...body }
  delete next.owner_user_id
  delete next.ownerUserId
  return next
}

export async function requireOwnedConversation(
  conversationIdRaw: unknown,
  options: {
    resolveUserId?: () => Promise<string | null>
    client?: WarRoomSupabase | null
    /** When true, soft-archived rows remain readable/mutable for owner. Default false for list-style reads. */
    includeDeleted?: boolean
    select?: string
    notFoundMessage?: string
  } = {},
): Promise<OwnedConversationResult> {
  const caller = await requireConversationCaller(options.resolveUserId)
  if (!caller.ok) {
    return {
      ok: false,
      status: 401,
      error: 'Authenticated session required.',
      code: 'UNAUTHENTICATED',
      response: caller.response,
    }
  }

  const conversationId = parseConversationId(conversationIdRaw)
  if (!conversationId) {
    const response = NextResponse.json({ error: 'Valid conversation id required.' }, { status: 400 })
    return { ok: false, status: 400, error: 'Valid conversation id required.', code: 'INVALID_ID', response }
  }

  const sup = options.client
    ? { ok: true as const, client: options.client }
    : tryWarRoomSupabase()
  if (!sup.ok) {
    const response = NextResponse.json({ error: 'Supabase is not configured.' }, { status: 503 })
    return { ok: false, status: 503, error: 'Supabase is not configured.', code: 'SUPABASE_UNAVAILABLE', response }
  }

  const select =
    options.select
    ?? 'id,owner_user_id,title,metadata,state,created_at,updated_at,last_message_at,deleted_at'

  let query = sup.client
    .from(TABLE_CONVERSATIONS)
    .select(select)
    .eq('id', conversationId)
    .eq('owner_user_id', caller.userId)

  if (!options.includeDeleted) {
    query = query.is('deleted_at', null)
  }

  const { data, error } = await query.maybeSingle()

  if (error) {
    if (isMissingOwnerColumnError(error.message)) {
      const response = migrationRequiredResponse()
      return {
        ok: false,
        status: 503,
        error: 'Conversation ownership migration required.',
        code: 'MIGRATION_REQUIRED',
        response,
      }
    }
    const response = NextResponse.json({ error: error.message }, { status: 500 })
    return { ok: false, status: 500, error: error.message, code: 'QUERY_FAILED', response }
  }

  if (!data || typeof (data as { id?: unknown }).id !== 'string') {
    const msg = options.notFoundMessage ?? 'Not found'
    return {
      ok: false,
      status: 404,
      error: msg,
      code: 'NOT_FOUND',
      response: notFoundResponse(msg),
    }
  }

  const row = data as unknown as OwnedConversationRow
  if (typeof row.owner_user_id !== 'string' || row.owner_user_id !== caller.userId) {
    // Fail closed / non-enumerating if owner unexpectedly null or mismatched.
    const msg = options.notFoundMessage ?? 'Not found'
    return {
      ok: false,
      status: 404,
      error: msg,
      code: 'NOT_FOUND',
      response: notFoundResponse(msg),
    }
  }

  return {
    ok: true,
    userId: caller.userId,
    conversationId,
    conversation: row,
    client: sup.client,
  }
}

/**
 * Authorize an optional conversationId from an external request.
 * - missing/empty id → { ok: true, skipped: true }
 * - present id → must be owned
 */
export async function requireOwnedConversationIfPresent(
  conversationIdRaw: unknown,
  options: Parameters<typeof requireOwnedConversation>[1] = {},
): Promise<
  | { ok: true; skipped: true; caller: ConversationCaller & { ok: true } }
  | { ok: true; skipped: false; owned: OwnedConversationOk }
  | OwnedConversationErr
> {
  if (conversationIdRaw == null || conversationIdRaw === '') {
    const caller = await requireConversationCaller(options.resolveUserId)
    if (!caller.ok) {
      return {
        ok: false,
        status: 401,
        error: 'Authenticated session required.',
        code: 'UNAUTHENTICATED',
        response: caller.response,
      }
    }
    return { ok: true, skipped: true, caller }
  }

  // Invalid UUID format when supplied → 400
  if (typeof conversationIdRaw === 'string' && conversationIdRaw.trim() && !parseConversationId(conversationIdRaw)) {
    const response = NextResponse.json({ error: 'Valid conversation id required.' }, { status: 400 })
    return { ok: false, status: 400, error: 'Valid conversation id required.', code: 'INVALID_ID', response }
  }

  const owned = await requireOwnedConversation(conversationIdRaw, options)
  if (!owned.ok) return owned
  return { ok: true, skipped: false, owned }
}

/** Pure predicate used by structural/security validation (no I/O). */
export function ownerFilterRequiredForExternalPath(): true {
  return true
}

export type OwnershipBypassClass =
  | 'EXTERNAL_USER_PATH'
  | 'TRUSTED_INTERNAL_PATH'
  | 'TEST'
  | 'MIGRATION'
  | 'HISTORICAL'

export function serviceRoleBypassesRls(): true {
  return true
}

/** Type-only re-export convenience for routes that already have a service client. */
export type ServiceRoleClient = SupabaseClient | WarRoomSupabase
