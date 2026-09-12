-- =============================================================================
-- War Room #19 — Conversation ownership SCHEMA phase (ADDITIVE)
-- File: supabase/war_room_conversations_ownership.sql
-- =============================================================================
-- PURPOSE
--   Add war_room_conversations.owner_user_id so each conversation belongs to
--   exactly one auth.users row. Messages stay ownerless and inherit ownership
--   via war_room_messages.conversation_id → war_room_conversations.owner_user_id.
--
-- CRITICAL
--   - DO NOT put a real Commander / user UUID in this file (or any committed SQL).
--   - This phase does NOT backfill owners and does NOT SET NOT NULL.
--   - SERVICE ROLE BYPASSES RLS. Application-layer owner checks remain mandatory.
--   - Apply order: SCHEMA (this file) → BACKFILL → ENFORCE (companion files).
--
-- Companions:
--   supabase/war_room_conversations_ownership_backfill.sql
--   supabase/war_room_conversations_ownership_enforce.sql
--
-- Safe to re-run: IF NOT EXISTS / DROP POLICY IF EXISTS + CREATE.
-- Does NOT delete conversation or message row content.
-- =============================================================================

alter table public.war_room_conversations
  add column if not exists owner_user_id uuid
    references auth.users (id)
    on delete restrict;

comment on column public.war_room_conversations.owner_user_id is
  'Authenticated owner of this conversation. Messages inherit ownership via conversation_id. Service-role clients bypass RLS; app routes must still filter by owner_user_id.';

create index if not exists war_room_conversations_owner_user_id_idx
  on public.war_room_conversations (owner_user_id);

alter table public.war_room_conversations enable row level security;

-- Preserve existing service_role_all policy if present (permissions fix migration).
-- Authenticated policies: owner-scoped. Ownership cannot be reassigned because
-- WITH CHECK requires owner_user_id = auth.uid() on write.

drop policy if exists war_room_conversations_owner_select on public.war_room_conversations;
create policy war_room_conversations_owner_select
  on public.war_room_conversations
  for select
  to authenticated
  using (owner_user_id = auth.uid());

drop policy if exists war_room_conversations_owner_insert on public.war_room_conversations;
create policy war_room_conversations_owner_insert
  on public.war_room_conversations
  for insert
  to authenticated
  with check (owner_user_id = auth.uid());

drop policy if exists war_room_conversations_owner_update on public.war_room_conversations;
create policy war_room_conversations_owner_update
  on public.war_room_conversations
  for update
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

drop policy if exists war_room_conversations_owner_delete on public.war_room_conversations;
create policy war_room_conversations_owner_delete
  on public.war_room_conversations
  for delete
  to authenticated
  using (owner_user_id = auth.uid());

-- Remove legacy combined policy name if an older draft applied it.
drop policy if exists war_room_conversations_owner_read_write on public.war_room_conversations;

-- war_room_messages: no owner_user_id by design. Parent conversation ownership
-- must be proven in application code before message DML.
