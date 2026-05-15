-- =============================================================================
-- War Room — repair grants + RLS for public.war_room_conversations and
-- public.war_room_messages (PostgREST 403)
-- =============================================================================
-- Prerequisite: tables must already exist (e.g. supabase/war_room_production_init.sql).
-- This script does not CREATE tables to avoid FK ordering issues.
--
-- Symptom: valid service_role JWT but REST /war_room_conversations returns 403.
-- Typical cause: missing GRANT on the table for role `service_role`, or RLS with
-- no permissive policy for service_role.
--
-- Safe to re-run: DROP POLICY IF EXISTS + CREATE; GRANT is idempotent.
-- Does NOT disable RLS globally; does NOT grant broad anon/authenticated DML
-- on these tables (schema USAGE only for PostgREST read paths, same as actions).
-- Apply in Supabase SQL Editor, then reload API schema if needed.
-- =============================================================================

alter table public.war_room_conversations enable row level security;
alter table public.war_room_messages enable row level security;

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on table public.war_room_conversations to service_role;
grant select, insert, update, delete on table public.war_room_messages to service_role;

drop policy if exists war_room_conversations_service_role_all on public.war_room_conversations;

create policy war_room_conversations_service_role_all
  on public.war_room_conversations
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists war_room_messages_service_role_all on public.war_room_messages;

create policy war_room_messages_service_role_all
  on public.war_room_messages
  for all
  to service_role
  using (true)
  with check (true);
