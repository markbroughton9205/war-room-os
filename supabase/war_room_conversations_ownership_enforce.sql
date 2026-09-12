-- =============================================================================
-- War Room #19 — Conversation ownership ENFORCEMENT phase
-- File: supabase/war_room_conversations_ownership_enforce.sql
-- =============================================================================
-- Run ONLY after:
--   1) SCHEMA applied
--   2) BACKFILL completed with verified owner assignment
--   3) select count(*) from war_room_conversations where owner_user_id is null; → 0
--   4) Owner-aware application code is ready to deploy in the same change window
--
-- Makes owner_user_id NOT NULL so new inserts cannot silently create ownerless rows.
-- =============================================================================

do $$
declare
  null_count bigint;
begin
  select count(*) into null_count
  from public.war_room_conversations
  where owner_user_id is null;

  if null_count <> 0 then
    raise exception
      'war_room_conversations_ownership_enforce: refusing NOT NULL — % rows still have null owner_user_id. Finish backfill first.',
      null_count;
  end if;
end $$;

alter table public.war_room_conversations
  alter column owner_user_id set not null;
