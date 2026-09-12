-- =============================================================================
-- War Room #19 — Conversation ownership BACKFILL phase
-- File: supabase/war_room_conversations_ownership_backfill.sql
-- =============================================================================
-- DO NOT RUN until SCHEMA phase has been applied.
-- DO NOT COMMIT a real user UUID into git.
--
-- Operator must supply the verified owner UUID at session time, e.g. in Supabase
-- SQL editor / psql BEFORE this script:
--
--   select set_config(
--     'war_room.backfill_owner_user_id',
--     '<verified-auth-users-id>',
--     false
--   );
--
-- Verify the id against auth.users (do not guess). Include archived / soft-deleted
-- conversations — they remain owned.
--
-- If historical ownership cannot be proven for ALL rows (e.g. multiple legitimate
-- application users already exist), STOP and obtain a Commander-approved
-- assignment strategy before running this script. Blind single-owner backfill is
-- then a LIVE-MIGRATION BLOCKER.
-- =============================================================================

do $$
declare
  owner_text text := nullif(current_setting('war_room.backfill_owner_user_id', true), '');
  owner_id uuid;
  null_before bigint;
  null_after bigint;
begin
  if owner_text is null then
    raise exception
      'war_room_conversations_ownership_backfill: set war_room.backfill_owner_user_id to a verified auth.users.id before running (never hard-code a UUID in the repo).';
  end if;

  begin
    owner_id := owner_text::uuid;
  exception when invalid_text_representation then
    raise exception
      'war_room_conversations_ownership_backfill: war_room.backfill_owner_user_id is not a valid UUID';
  end;

  if owner_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception
      'war_room_conversations_ownership_backfill: refusing all-zeros placeholder UUID';
  end if;

  if not exists (select 1 from auth.users where id = owner_id) then
    raise exception
      'war_room_conversations_ownership_backfill: % is not present in auth.users — verify before backfill',
      owner_id;
  end if;

  select count(*) into null_before
  from public.war_room_conversations
  where owner_user_id is null;

  update public.war_room_conversations
  set owner_user_id = owner_id
  where owner_user_id is null;

  select count(*) into null_after
  from public.war_room_conversations
  where owner_user_id is null;

  if null_after <> 0 then
    raise exception
      'war_room_conversations_ownership_backfill: % rows still have null owner_user_id after update (before=%)',
      null_after, null_before;
  end if;

  raise notice
    'war_room_conversations_ownership_backfill: assigned % previously-null rows to verified owner (null_before=%, null_after=%)',
    null_before, null_before, null_after;
end $$;
