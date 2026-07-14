-- =============================================================================
-- War Room Phase 46P-E Migration C — Memory Authority Final Tightening
-- =============================================================================
-- Review-only artifact. Do not run until burn-in confirms all new writes carry
-- ownership and all legacy rows are backfilled.
--
-- Contains only:
--   * final NOT NULL tightening
--   * final constraints
--   * transitional compatibility cleanup
--
-- No new policies, no new tables, no anonymous access.
-- =============================================================================

begin;

do $$
declare
  missing_memory_owners integer;
  missing_proposal_owners integer;
begin
  select count(*)
  from public.memories
  where created_by_user_id is null
  into missing_memory_owners;

  select count(*)
  from public.war_room_memory_proposals
  where created_by_user_id is null
  into missing_proposal_owners;

  if missing_memory_owners > 0 then
    raise exception '46P-E tightening blocked: public.memories has % rows without created_by_user_id.', missing_memory_owners;
  end if;

  if missing_proposal_owners > 0 then
    raise exception '46P-E tightening blocked: public.war_room_memory_proposals has % rows without created_by_user_id.', missing_proposal_owners;
  end if;
end $$;

alter table public.memories
  alter column created_by_user_id set not null;

alter table public.memories
  alter column ownership_authority_basis set not null;

alter table public.memories
  drop constraint if exists memories_ownership_basis_check;

alter table public.memories
  add constraint memories_ownership_basis_check check (
    ownership_authority_basis in ('authenticated_commander_session', 'legacy_backfill_commander')
  );

alter table public.war_room_memory_proposals
  alter column created_by_user_id set not null;

alter table public.war_room_memory_proposals
  alter column ownership_authority_basis set not null;

alter table public.war_room_memory_proposals
  drop constraint if exists war_room_memory_proposals_ownership_basis_check;

alter table public.war_room_memory_proposals
  add constraint war_room_memory_proposals_ownership_basis_check check (
    ownership_authority_basis in ('authenticated_commander_session', 'legacy_backfill_commander')
  );

commit;
