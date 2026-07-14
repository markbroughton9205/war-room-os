-- =============================================================================
-- War Room Phase 46P-E Migration B — Memory Authority Policies
-- =============================================================================
-- Review-only artifact. Do not run until Migration A is approved and applied.
--
-- Contains only:
--   * grants
--   * revokes
--   * RLS activation
--   * SECURITY DEFINER function
--   * anonymous removal
--   * Commander policies
--   * proposal policies
--
-- No schema changes.
-- =============================================================================

begin;

alter table public.memories enable row level security;
alter table public.war_room_memory_proposals enable row level security;
alter table public.war_room_approved_memories enable row level security;
alter table public.war_room_memory_authorities enable row level security;

revoke all on table public.memories from anon;
revoke all on table public.war_room_memory_proposals from anon;
revoke all on table public.war_room_approved_memories from anon;
revoke all on table public.war_room_memory_authorities from anon;

revoke all on function public.war_room_current_memory_commander_user_id() from public;
grant execute on function public.war_room_current_memory_commander_user_id() to service_role;

create or replace function public.war_room_is_memory_commander(candidate_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select candidate_user_id is not null
    and exists (
      select 1
      from public.war_room_memory_authorities a
      where a.user_id = candidate_user_id
        and a.authority_role = 'commander'
        and a.status = 'active'
    )
$$;

comment on function public.war_room_is_memory_commander(uuid) is
  'SECURITY DEFINER Commander check for memory RLS. Assumes owner is a trusted database role with read access to public.war_room_memory_authorities. No dynamic SQL or dynamic identifiers.';

revoke all on function public.war_room_is_memory_commander(uuid) from public;
revoke all on function public.war_room_is_memory_commander(uuid) from anon;
grant execute on function public.war_room_is_memory_commander(uuid) to authenticated;
grant execute on function public.war_room_is_memory_commander(uuid) to service_role;

grant select, insert on table public.memories to authenticated;
grant select, insert on table public.war_room_memory_proposals to authenticated;
grant select on table public.war_room_approved_memories to authenticated;

grant select on table public.war_room_memory_authorities to service_role;
grant select, insert, update, delete on table public.memories to service_role;
grant select, insert, update, delete on table public.war_room_memory_proposals to service_role;
grant select, insert, update, delete on table public.war_room_approved_memories to service_role;

drop policy if exists memories_commander_select on public.memories;
create policy memories_commander_select
  on public.memories
  for select
  to authenticated
  using (
    public.war_room_is_memory_commander(auth.uid())
    and created_by_user_id = auth.uid()
  );

drop policy if exists memories_commander_insert on public.memories;
create policy memories_commander_insert
  on public.memories
  for insert
  to authenticated
  with check (
    public.war_room_is_memory_commander(auth.uid())
    and created_by_user_id = auth.uid()
  );

drop policy if exists war_room_memory_proposals_commander_select on public.war_room_memory_proposals;
create policy war_room_memory_proposals_commander_select
  on public.war_room_memory_proposals
  for select
  to authenticated
  using (
    public.war_room_is_memory_commander(auth.uid())
    and created_by_user_id = auth.uid()
  );

drop policy if exists war_room_memory_proposals_commander_insert on public.war_room_memory_proposals;
create policy war_room_memory_proposals_commander_insert
  on public.war_room_memory_proposals
  for insert
  to authenticated
  with check (
    public.war_room_is_memory_commander(auth.uid())
    and created_by_user_id = auth.uid()
    and status = 'pending'
  );

drop policy if exists war_room_approved_memories_commander_select on public.war_room_approved_memories;
create policy war_room_approved_memories_commander_select
  on public.war_room_approved_memories
  for select
  to authenticated
  using (
    public.war_room_is_memory_commander(auth.uid())
  );

commit;
