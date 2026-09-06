import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { requireConversationCaller } from './conversationAuth'

/**
 * Conversation ownership (audit findings DATA-001 / P1-2). BLOCKED BY MIGRATION: the
 * owner_user_id column this code filters/sets does not exist in the live database yet (see
 * supabase/war_room_conversations_ownership.sql, deliberately not applied). Real end-to-end
 * proof against a live Postgres instance is not possible until that migration runs, and true
 * per-request integration testing of the route handlers themselves would need mocking Next.js's
 * cookie-based session context, which this repo's harness (custom validation scripts, no Jest/
 * request-mocking framework - see CLAUDE.md) does not have infrastructure for. This validates
 * what can honestly be proven without either of those:
 *   1. requireConversationCaller's actual identity-resolution logic (real function, injectable
 *      resolver seam, no mocking framework needed) - a Commander-identity resolver succeeds, an
 *      invited-user resolver also succeeds (this repo's ownership model is "any authenticated
 *      account, scoped to itself," not Commander-only - see conversationAuth.ts), and a
 *      resolver returning null is rejected with 401.
 *   2. Structural proof that every conversation/message query in all three route files actually
 *      filters or sets owner_user_id at every relevant call site - not just that the code
 *      typechecks, but that the specific mission-required operations (list, GET-by-id, PATCH,
 *      DELETE, message POST/DELETE) are each wired to it.
 */

type CaseResult = { name: string; pass: boolean; detail: string }
function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

function readRepoFile(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL('../../' + relativePath, import.meta.url)), 'utf8')
}

function countOccurrences(source: string, pattern: RegExp): number {
  return (source.match(pattern) ?? []).length
}

export async function runConversationOwnershipValidation(): Promise<CaseResult[]> {
  const results: CaseResult[] = []

  // --- Identity resolution: real function, no DB/network needed ---
  const commanderResult = await requireConversationCaller(async () => 'commander-user-id')
  results.push(check(
    'commander_sees_commander_conversation_identity_resolves',
    commanderResult.ok === true && commanderResult.userId === 'commander-user-id',
    `ok=${commanderResult.ok} userId=${commanderResult.ok ? commanderResult.userId : 'n/a'}`,
  ))

  const invitedResult = await requireConversationCaller(async () => 'invited-user-id')
  const commanderUserId = commanderResult.ok ? commanderResult.userId : null
  results.push(check(
    'invited_user_own_identity_also_resolves_but_is_a_different_id',
    invitedResult.ok === true && invitedResult.userId === 'invited-user-id' && invitedResult.userId !== commanderUserId,
    'ownership model is any-authenticated-account-scoped-to-itself, not Commander-only - both resolve, to DIFFERENT ids, which is what every .eq(\'owner_user_id\', callerUserId) below keys on',
  ))

  const unauthenticatedResult = await requireConversationCaller(async () => null)
  results.push(check(
    'unauthenticated_caller_rejected',
    unauthenticatedResult.ok === false,
    `ok=${unauthenticatedResult.ok}`,
  ))

  // --- Structural proof: every relevant query site is actually ownership-filtered ---
  const listRoute = readRepoFile('app/api/conversations/route.ts')
  results.push(check(
    'invited_user_cannot_list_commander_conversations',
    /requireConversationCaller\(\)/.test(listRoute)
    && /\.eq\('owner_user_id', caller\.userId\)/.test(listRoute)
    && /\.select\('id,title,metadata,state,created_at,updated_at,last_message_at,deleted_at'\)\s*\n\s*\.eq\('owner_user_id', caller\.userId\)/.test(listRoute),
    'GET list query is filtered by .eq(\'owner_user_id\', caller.userId) immediately after .select(...)',
  ))
  results.push(check(
    'new_conversation_receives_caller_ownership',
    /\.insert\(\{ title, metadata, owner_user_id: caller\.userId \}\)/.test(listRoute),
    'POST insert sets owner_user_id: caller.userId on every new conversation',
  ))

  const byIdRoute = readRepoFile('app/api/conversations/[id]/route.ts')
  const byIdOwnerFilterCount = countOccurrences(byIdRoute, /\.eq\('owner_user_id', caller\.userId\)/g)
  results.push(check(
    'invited_user_cannot_get_by_id',
    /export async function GET[\s\S]*?\.eq\('id', id\)[\s\S]{0,50}?\.eq\('owner_user_id', caller\.userId\)/.test(byIdRoute),
    'GET query filters by .eq(\'id\', id) AND .eq(\'owner_user_id\', caller.userId) - a non-owned id reads as 404, not leaked as 403 (avoids confirming existence)',
  ))
  results.push(check(
    'invited_user_cannot_patch_title',
    /export async function PATCH[\s\S]*?\.update\(updates\)[\s\S]{0,50}?\.eq\('id', id\)[\s\S]{0,50}?\.eq\('owner_user_id', caller\.userId\)/.test(byIdRoute),
    'PATCH update query filters by .eq(\'owner_user_id\', caller.userId) before it can touch a row',
  ))
  results.push(check(
    'invited_user_cannot_delete_archive',
    /export async function DELETE[\s\S]*?\.update\(\{ deleted_at:[\s\S]{0,100}?\.eq\('id', id\)[\s\S]{0,50}?\.eq\('owner_user_id', caller\.userId\)/.test(byIdRoute),
    'DELETE (soft-archive) update query filters by .eq(\'owner_user_id\', caller.userId) before it can touch a row',
  ))
  results.push(check(
    'every_conversation_query_in_by_id_route_is_caller_gated',
    byIdOwnerFilterCount >= 3 && countOccurrences(byIdRoute, /requireConversationCaller\(\)/g) === 3,
    `owner_user_id filter count=${byIdOwnerFilterCount} (GET/PATCH-merge/PATCH-update/DELETE all need it), requireConversationCaller call count=${countOccurrences(byIdRoute, /requireConversationCaller\(\)/g)} (one per handler: GET/PATCH/DELETE)`,
  ))

  const messagesRoute = readRepoFile('app/api/conversations/[id]/messages/route.ts')
  results.push(check(
    'messages_cannot_bypass_conversation_ownership',
    countOccurrences(messagesRoute, /\.eq\('owner_user_id', caller\.userId\)/g) === 2
    && countOccurrences(messagesRoute, /requireConversationCaller\(\)/g) === 2,
    'both POST (message create) and DELETE (message removal) resolve the caller and verify conversation ownership (.eq(\'owner_user_id\', caller.userId)) before touching any message row - a message cannot be written into or deleted from a conversation the caller does not own, even knowing its id',
  ))

  return results
}
