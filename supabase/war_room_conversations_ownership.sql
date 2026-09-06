-- =============================================================================
-- War Room - conversation ownership (Wave 1 repair, audit findings DATA-001 / P1-2)
-- =============================================================================
-- Problem this fixes: public.war_room_conversations has no owner column at all today
-- (see supabase/war_room_production_init.sql) and app/api/conversations/route.ts's
-- queries never filter by caller identity - every authenticated account (including any
-- future invited account created via app/api/signup/invitations) can list, read, rename,
-- archive, and delete every conversation, including the Commander's private/financial ones.
--
-- This migration is ADDITIVE ONLY (new nullable column, backfilled, then made NOT NULL) and
-- does not delete or rewrite any existing row content. It is safe to run against production
-- as-is. It does NOT by itself change app behavior - app/api/conversations/**/route.ts must
-- still be updated to actually read/set/filter by owner_user_id (see the companion note at
-- the bottom of this file); until that code ships, this migration alone only adds the column
-- and backfills it, it does not restrict access.
--
-- Prerequisite: WAR_ROOM_COMMANDER_USER_ID must be set correctly in the environment this is
-- run against (used only to choose the backfill value below - verify it matches the real
-- Commander auth.users.id before running, e.g. via `select id from auth.users where email = ...`
-- in the Supabase SQL editor - do not guess it).
--
-- Safe to re-run: `add column if not exists`, backfill only touches NULL rows, policy
-- creation uses DROP POLICY IF EXISTS + CREATE.
-- =============================================================================

alter table public.war_room_conversations
  add column if not exists owner_user_id uuid references auth.users (id);

-- Backfill: every conversation that predates this column is assumed to belong to the
-- Commander (the only account that existed before invitations shipped). Replace the
-- placeholder below with the real Commander auth.users.id before running.
update public.war_room_conversations
set owner_user_id = '00000000-0000-0000-0000-000000000000'::uuid  -- REPLACE with real Commander user id
where owner_user_id is null;

-- Once every row is backfilled (verify with the SELECT below before uncommenting), make the
-- column mandatory so no future insert can silently create an ownerless row again.
-- select count(*) from public.war_room_conversations where owner_user_id is null;  -- expect 0
-- alter table public.war_room_conversations alter column owner_user_id set not null;

create index if not exists war_room_conversations_owner_user_id_idx
  on public.war_room_conversations (owner_user_id);

-- Defense-in-depth RLS for the `authenticated` role, in addition to the app-layer filter the
-- companion code change adds. The app queries via the service-role client today (which bypasses
-- RLS entirely - see lib/war-room/persistence.ts's tryWarRoomSupabase()), so this policy does not
-- fix the vulnerability by itself; it only prevents the same class of bug if any future code path
-- ever queries this table with a user-scoped (anon-key) client instead of service-role.
alter table public.war_room_conversations enable row level security;

drop policy if exists war_room_conversations_owner_read_write on public.war_room_conversations;

create policy war_room_conversations_owner_read_write
  on public.war_room_conversations
  for all
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- war_room_messages has no owner column of its own by design - ownership is inherited via
-- conversation_id -> war_room_conversations.owner_user_id. The companion app-code change must
-- verify the parent conversation's owner before returning/writing any message, the same way it
-- must for the conversation row itself.

-- =============================================================================
-- COMPANION APPLICATION CODE CHANGE (not included in this SQL file - ships alongside it in
-- the same PR, but is NOT applied by this migration):
--   - app/api/conversations/route.ts (GET/POST), app/api/conversations/[id]/route.ts
--     (GET/PATCH/DELETE), app/api/conversations/[id]/messages/route.ts must each: resolve the
--     caller's user id from the request's own Supabase session (the pattern already used by
--     lib/workspace-contributor/routes.ts's requireContributorContext - not
--     requireCommanderSession, since any authenticated account, not just the Commander, should be
--     able to use conversations - just scoped to their own), then filter every select/update/
--     delete by `.eq('owner_user_id', callerUserId)` and set `owner_user_id: callerUserId` on
--     every insert.
--   - Open product question this migration does not answer: should an invited account ever see
--     conversations the Commander created (a deliberate shared-history feature), or should every
--     account's conversations be strictly private to that account (the safe default assumed
--     above, and what "invited users must not automatically read Commander private chats" in the
--     audit implies)? If shared history is wanted later, that's a new, deliberate mechanism to
--     design - not something this migration or its companion code should default to.
-- =============================================================================
