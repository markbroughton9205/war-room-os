-- =============================================================================
-- War Room Phase 46P-E Migration A — Memory Authority Schema
-- =============================================================================
-- Review-only artifact. Do not run until approved.
--
-- Contains only:
--   * prechecks
--   * authority table
--   * Commander lookup function
--   * ownership columns
--   * indexes
--   * additive schema
--
-- Does not activate policies, remove policies, revoke access, or tighten nulls.
-- =============================================================================

begin;

do $$
declare
  authority_exists boolean;
  memories_owner_exists boolean;
  proposals_owner_exists boolean;
  commander_count integer;
  memories_without_owner integer;
  proposals_without_owner integer;
begin
  select to_regclass('public.war_room_memory_authorities') is not null into authority_exists;

  if authority_exists then
    execute $q$
      select count(*)
      from public.war_room_memory_authorities
      where authority_role = 'commander'
        and status = 'active'
    $q$ into commander_count;

    if commander_count > 1 then
      raise exception '46P-E precheck failed: multiple active Commander authority rows exist (%).', commander_count;
    end if;
  end if;

  if to_regclass('public.memories') is null then
    raise exception '46P-E precheck failed: public.memories is missing.';
  end if;

  if to_regclass('public.war_room_memory_proposals') is null then
    raise exception '46P-E precheck failed: public.war_room_memory_proposals is missing.';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'memories'
      and column_name = 'created_by_user_id'
      and data_type <> 'uuid'
  ) then
    raise exception '46P-E precheck failed: public.memories.created_by_user_id exists with unexpected type.';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'war_room_memory_proposals'
      and column_name = 'created_by_user_id'
      and data_type <> 'uuid'
  ) then
    raise exception '46P-E precheck failed: public.war_room_memory_proposals.created_by_user_id exists with unexpected type.';
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'memories'
      and column_name = 'created_by_user_id'
  ) into memories_owner_exists;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'war_room_memory_proposals'
      and column_name = 'created_by_user_id'
  ) into proposals_owner_exists;

  if authority_exists and memories_owner_exists then
    execute $q$
      select count(*)
      from public.memories
      where created_by_user_id is not null
        and not exists (
          select 1
          from public.war_room_memory_authorities a
          where a.user_id = memories.created_by_user_id
        )
    $q$ into memories_without_owner;
  else
    memories_without_owner := 0;
  end if;

  if authority_exists and proposals_owner_exists then
    execute $q$
      select count(*)
      from public.war_room_memory_proposals
      where created_by_user_id is not null
        and not exists (
          select 1
          from public.war_room_memory_authorities a
          where a.user_id = war_room_memory_proposals.created_by_user_id
        )
    $q$ into proposals_without_owner;
  else
    proposals_without_owner := 0;
  end if;

  if authority_exists then
    if memories_without_owner > 0 then
      raise exception '46P-E precheck failed: public.memories has unexpected ownership state (% rows).', memories_without_owner;
    end if;

    if proposals_without_owner > 0 then
      raise exception '46P-E precheck failed: public.war_room_memory_proposals has unexpected proposal ownership (% rows).', proposals_without_owner;
    end if;
  end if;
end $$;

create table if not exists public.war_room_memory_authorities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  authority_role text not null,
  status text not null default 'active',
  authority_basis text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint war_room_memory_authorities_role_check check (
    authority_role in ('commander')
  ),
  constraint war_room_memory_authorities_status_check check (
    status in ('active', 'revoked')
  ),
  constraint war_room_memory_authorities_basis_check check (
    authority_basis in ('configured_commander_user_id', 'manual_commander_rotation')
  ),
  constraint war_room_memory_authorities_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

create unique index if not exists war_room_memory_authorities_active_commander_uidx
  on public.war_room_memory_authorities (authority_role)
  where authority_role = 'commander' and status = 'active';

create index if not exists war_room_memory_authorities_user_status_idx
  on public.war_room_memory_authorities (user_id, status);

alter table public.memories
  add column if not exists created_by_user_id uuid;

alter table public.memories
  add column if not exists ownership_authority_basis text;

alter table public.war_room_memory_proposals
  add column if not exists created_by_user_id uuid;

alter table public.war_room_memory_proposals
  add column if not exists ownership_authority_basis text;

create index if not exists memories_created_by_user_created_idx
  on public.memories (created_by_user_id, created_at desc);

create index if not exists war_room_memory_proposals_owner_status_created_idx
  on public.war_room_memory_proposals (created_by_user_id, status, created_at desc);

create or replace function public.war_room_current_memory_commander_user_id()
returns uuid
language sql
stable
set search_path = public, pg_temp
as $$
  select a.user_id
  from public.war_room_memory_authorities a
  where a.authority_role = 'commander'
    and a.status = 'active'
  order by a.created_at asc
  limit 1
$$;

comment on table public.war_room_memory_authorities is
  'Commander authority registry for War Room memory ownership. Exactly one active commander is allowed.';

comment on function public.war_room_current_memory_commander_user_id() is
  'Stable lookup for the active War Room memory Commander user id. No dynamic SQL.';

commit;
