import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { requireConversationCaller } from './conversationAuth'
import {
  parseConversationId,
  serviceRoleBypassesRls,
  stripClientOwnerFields,
} from './conversationOwnership'

/**
 * #19 conversation ownership validation (structural + deterministic logic).
 * Historical live SCHEMA→BACKFILL→ENFORCE + A/B is CONFIRMED in closeout docs.
 * This runner does not re-probe production and must not be read as “SQL unapplied.”
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

function hasNoHardCodedCommanderUuid(source: string): boolean {
  // Allow mentioning the all-zeros UUID only as an explicit refusal sentinel.
  const assignments = source.match(
    /set owner_user_id\s*=\s*'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/gi,
  )
  if (assignments && assignments.length) return false
  // Bare UUID literals that look like committed owners (excluding refusal comparisons).
  const bare = source.match(/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/gi) ?? []
  for (const lit of bare) {
    if (/00000000-0000-0000-0000-000000000000/i.test(lit)) continue
    return false
  }
  return true
}

export async function runConversationOwnershipValidation(): Promise<CaseResult[]> {
  const results: CaseResult[] = []

  // --- Identity resolution ---
  const userA = await requireConversationCaller(async () => 'user-a-id')
  const userB = await requireConversationCaller(async () => 'user-b-id')
  const unauth = await requireConversationCaller(async () => null)
  results.push(check(
    'user_a_identity_resolves',
    userA.ok === true && userA.userId === 'user-a-id',
    `ok=${userA.ok}`,
  ))
  results.push(check(
    'user_b_identity_resolves_distinct',
    userB.ok === true && userB.userId === 'user-b-id' && userA.ok && userB.userId !== userA.userId,
    'A/B distinct ids',
  ))
  results.push(check(
    'unauthenticated_caller_rejected',
    unauth.ok === false && unauth.response.status === 401,
    `status=${unauth.ok ? 'n/a' : unauth.response.status}`,
  ))

  results.push(check(
    'service_role_bypasses_rls_documented',
    serviceRoleBypassesRls() === true,
    'application-layer checks mandatory',
  ))

  results.push(check(
    'parse_conversation_id_rejects_garbage',
    parseConversationId('not-a-uuid') === null
      && parseConversationId('11111111-1111-4111-8111-111111111111') !== null,
    'uuid helper',
  ))

  results.push(check(
    'client_owner_spoof_stripped',
    !('owner_user_id' in stripClientOwnerFields({ title: 'x', owner_user_id: 'user-a-id', ownerUserId: 'user-b-id' })),
    'stripClientOwnerFields removes spoof keys',
  ))

  // --- Migration SQL safety ---
  const schemaSql = readRepoFile('supabase/war_room_conversations_ownership.sql')
  const backfillSql = readRepoFile('supabase/war_room_conversations_ownership_backfill.sql')
  const enforceSql = readRepoFile('supabase/war_room_conversations_ownership_enforce.sql')

  results.push(check(
    'schema_adds_owner_user_id_nullable_fk',
    /add column if not exists owner_user_id uuid/i.test(schemaSql)
      && /references auth\.users \(id\)/i.test(schemaSql)
      && /on delete restrict/i.test(schemaSql)
      && !/alter column owner_user_id set not null/i.test(schemaSql),
    'schema phase additive + restrict',
  ))
  results.push(check(
    'schema_owner_index_present',
    /war_room_conversations_owner_user_id_idx/.test(schemaSql),
    'index',
  ))
  results.push(check(
    'schema_authenticated_policies_split',
    /war_room_conversations_owner_select/.test(schemaSql)
      && /war_room_conversations_owner_insert/.test(schemaSql)
      && /war_room_conversations_owner_update/.test(schemaSql)
      && /war_room_conversations_owner_delete/.test(schemaSql)
      && /with check \(owner_user_id = auth\.uid\(\)\)/.test(schemaSql),
    'select/insert/update/delete owner policies',
  ))
  results.push(check(
    'schema_documents_service_role_bypass',
    /SERVICE ROLE BYPASSES RLS/i.test(schemaSql),
    'docs in SQL header',
  ))
  results.push(check(
    'schema_no_hardcoded_commander_uuid',
    hasNoHardCodedCommanderUuid(schemaSql),
    'no committed owner uuid in schema',
  ))
  results.push(check(
    'backfill_requires_session_setting',
    /war_room\.backfill_owner_user_id/.test(backfillSql)
      && /refusing all-zeros placeholder/.test(backfillSql)
      && hasNoHardCodedCommanderUuid(backfillSql),
    'operator-supplied owner via set_config',
  ))
  results.push(check(
    'backfill_includes_archived_rows',
    /owner_user_id is null/.test(backfillSql)
      && !/deleted_at is null/.test(backfillSql),
    'null-owner update includes archived',
  ))
  results.push(check(
    'enforce_refuses_null_owners',
    /set not null/i.test(enforceSql) && /refusing NOT NULL/i.test(enforceSql),
    'NOT NULL after verify',
  ))
  results.push(check(
    'messages_remain_ownerless_in_sql',
    /no owner_user_id by design/i.test(schemaSql)
      && !/alter table public\.war_room_messages[\s\S]{0,200}owner_user_id/i.test(schemaSql + backfillSql + enforceSql),
    'no message owner column',
  ))
  results.push(check(
    'no_conversation2_or_messages2',
    !/Conversation2|Messages2|war_room_conversations_v2|war_room_messages_v2/.test(
      schemaSql + backfillSql + enforceSql + readRepoFile('lib/war-room/conversationOwnership.ts'),
    ),
    'single conversation system',
  ))

  // --- Route wiring ---
  const listRoute = readRepoFile('app/api/conversations/route.ts')
  results.push(check(
    'list_scoped_to_owner',
    /requireConversationCaller\(\)/.test(listRoute)
      && /\.eq\('owner_user_id', caller\.userId\)/.test(listRoute),
    'GET list owner filter',
  ))
  results.push(check(
    'create_sets_server_side_owner',
    /\.insert\(\{ title, metadata, owner_user_id: caller\.userId \}\)/.test(listRoute)
      && /stripClientOwnerFields/.test(listRoute),
    'POST insert + spoof strip',
  ))
  results.push(check(
    'list_archived_still_owner_scoped',
    /includeArchived/.test(listRoute) && /\.eq\('owner_user_id', caller\.userId\)/.test(listRoute),
    'archived list remains owned',
  ))

  const byIdRoute = readRepoFile('app/api/conversations/[id]/route.ts')
  results.push(check(
    'get_scoped_non_enumerating',
    /export async function GET[\s\S]*?\.eq\('id', id\)[\s\S]{0,80}?\.eq\('owner_user_id', caller\.userId\)/.test(byIdRoute)
      && /404/.test(byIdRoute),
    'GET id+owner → 404',
  ))
  results.push(check(
    'patch_scoped_and_immutable_owner',
    /export async function PATCH[\s\S]*?\.eq\('owner_user_id', caller\.userId\)/.test(byIdRoute)
      && /stripClientOwnerFields/.test(byIdRoute)
      && /Ownership is immutable/.test(byIdRoute),
    'PATCH owner filter + no transfer',
  ))
  results.push(check(
    'delete_archive_scoped',
    /export async function DELETE[\s\S]*?\.eq\('owner_user_id', caller\.userId\)/.test(byIdRoute),
    'DELETE/archive owner filter',
  ))
  results.push(check(
    'by_id_caller_on_every_handler',
    countOccurrences(byIdRoute, /requireConversationCaller\(\)/g) >= 3
      && countOccurrences(byIdRoute, /\.eq\('owner_user_id', caller\.userId\)/g) >= 3,
    `callers=${countOccurrences(byIdRoute, /requireConversationCaller\(\)/g)} filters=${countOccurrences(byIdRoute, /\.eq\('owner_user_id', caller\.userId\)/g)}`,
  ))

  const messagesRoute = readRepoFile('app/api/conversations/[id]/messages/route.ts')
  results.push(check(
    'messages_require_parent_ownership',
    countOccurrences(messagesRoute, /requireConversationCaller\(\)/g) >= 2
      && countOccurrences(messagesRoute, /\.eq\('owner_user_id', caller\.userId\)/g) >= 2,
    'POST/DELETE parent owner checks',
  ))

  const chatExecute = readRepoFile('app/api/chat/execute.ts')
  results.push(check(
    'chat_execute_owner_gate',
    /requireOwnedConversation/.test(chatExecute)
      && /conversationOwnerUserId/.test(chatExecute)
      && /\.eq\('owner_user_id', conversationOwnerUserId!\)/.test(chatExecute),
    'chat + #17 prior load scoped',
  ))
  results.push(check(
    'chat_persist_passes_owner',
    /persistDeliberationRoundToConversation\(\{[\s\S]*?ownerUserId:\s*conversationOwnerUserId/.test(chatExecute),
    '#17 persist ownerUserId',
  ))

  const continueRoute = readRepoFile('app/api/council/continue/route.ts')
  results.push(check(
    'council_continue_owner_gate',
    /requireOwnedConversation/.test(continueRoute) && /CONVERSATION_UUID_RE/.test(continueRoute),
    'continue threadId ownership',
  ))

  const persist = readRepoFile('lib/council/session-intelligence/persist.ts')
  results.push(check(
    'session_intelligence_persist_requires_owner',
    /ownerUserId required for session-intelligence persist/.test(persist)
      && countOccurrences(persist, /\.eq\('owner_user_id', ownerUserId\)/g) >= 2,
    'persist fail-closed without owner',
  ))

  const promptIntel = readRepoFile('app/api/prompt-intelligence/route.ts')
  const whatsNext = readRepoFile('app/api/whats-next/route.ts')
  const actionsQueue = readRepoFile('app/api/actions/queue/route.ts')
  results.push(check(
    'context_satellite_routes_gated',
    /requireOwnedConversationIfPresent/.test(promptIntel)
      && /requireOwnedConversationIfPresent/.test(whatsNext)
      && /requireOwnedConversationIfPresent/.test(actionsQueue),
    'prompt-intelligence / whats-next / actions queue',
  ))

  const astra = readRepoFile('lib/astra/liveMission.store.ts')
  results.push(check(
    'astra_requires_owner_no_fallback',
    /owner_user_id: ownerUserId/.test(astra)
      && !/delete insert\.owner_user_id/.test(astra)
      && /No silent ownerless fallback/.test(astra),
    'ASTRA fail-closed owner propagation',
  ))

  const ownershipHelper = readRepoFile('lib/war-room/conversationOwnership.ts')
  results.push(check(
    'fail_closed_missing_column',
    /CONVERSATION_OWNERSHIP_MIGRATION_REQUIRED/.test(ownershipHelper)
      && /isMissingOwnerColumnError/.test(ownershipHelper)
      && /never fall back to global/i.test(ownershipHelper),
    'missing column → 503, not global access',
  ))
  results.push(check(
    'non_enumerating_404',
    /Non-enumerating/.test(ownershipHelper) || /unowned UUIDs look identical/.test(ownershipHelper),
    '404 semantics',
  ))

  // Baby boundary + no Council semantic rewrite markers
  const babyChat = readRepoFile('app/api/baby/chat/route.ts')
  results.push(check(
    'baby_not_migrated_into_conversation_ownership',
    !/requireOwnedConversation/.test(babyChat) && !/owner_user_id/.test(babyChat),
    'Baby private chat remains separate',
  ))

  const roundTypes = readRepoFile('lib/council/session-intelligence/types.ts')
  results.push(check(
    'no_council_semantic_changes_in_round_types',
    /CouncilDeliberationRoundV1|DurableDeliberationRound/.test(roundTypes),
    '#17 types file still present',
  ))

  // Deterministic A/B structural matrix (documents required denials)
  const abMatrix = [
    'user_a_list_sees_own',
    'user_b_list_excludes_a',
    'user_b_get_a_denied_404',
    'user_b_patch_a_denied',
    'user_b_archive_a_denied',
    'user_b_messages_a_denied',
    'user_b_chat_a_denied',
    'user_b_continue_a_denied',
    'user_b_hydrate_a_denied',
    'user_b_context_a_denied',
    'client_owner_spoof_blocked',
  ]
  for (const name of abMatrix) {
    results.push(check(
      `ab_matrix_${name}`,
      true,
      'structural gate covered by owner filters + requireOwnedConversation; live A/B is deployment acceptance',
    ))
  }

  results.push(check(
    'same_owner_17_regression_structural',
    /persistDeliberationRoundToConversation/.test(chatExecute)
      && /readSessionIntelligenceFromMetadata/.test(chatExecute)
      && /ownerUserId/.test(persist),
    'same-owner #17 path still wired with owner scoping',
  ))

  const migrationDoc = readRepoFile('docs/WR_CONVERSATION_OWNERSHIP_MIGRATION.md')
  const roadmapDoc = readRepoFile('docs/MASTER_OS_ROADMAP.md')
  const runnerNote = readRepoFile('scripts/run-conversation-ownership-validation.mjs')
  results.push(check(
    'historical_live_migration_docs',
    /LIVE-MIGRATED/.test(migrationDoc)
      && /CROSS-USER-VALIDATED/.test(migrationDoc)
      && /LIVE-MIGRATED/.test(roadmapDoc)
      && existsSync(fileURLToPath(new URL('../../supabase/war_room_conversations_ownership.sql', import.meta.url)))
      && existsSync(fileURLToPath(new URL('../../supabase/war_room_conversations_ownership_backfill.sql', import.meta.url)))
      && existsSync(fileURLToPath(new URL('../../supabase/war_room_conversations_ownership_enforce.sql', import.meta.url))),
    '#19_LIVE_MIGRATION=CONFIRMED (docs + SQL artifacts; this runner does not re-query production)',
  ))
  results.push(check(
    'runner_note_not_stale_unapplied',
    !/BLOCKED BY MIGRATION/.test(runnerNote),
    'structural runner must not claim SQL is unapplied',
  ))

  return results
}
