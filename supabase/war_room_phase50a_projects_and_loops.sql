-- War Room Phase 50A: AGI Wave 1 — Project state & Open Loop registry.
-- Additive only. Server API uses SUPABASE_SERVICE_ROLE_KEY; no anon/public write policies are added.

grant usage on schema public to service_role;

create table if not exists public.war_room_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'active',
  priority smallint not null default 0,
  current_objective text,
  current_phase text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_projects_status_check check (
    status in ('active', 'paused', 'completed', 'archived')
  )
);

create index if not exists war_room_projects_status_idx
  on public.war_room_projects (status, priority desc, updated_at desc);

alter table public.war_room_projects enable row level security;

drop policy if exists war_room_projects_service_role_all on public.war_room_projects;
create policy war_room_projects_service_role_all
  on public.war_room_projects
  for all to service_role using (true) with check (true);

grant select, insert, update, delete on table public.war_room_projects to service_role;

create table if not exists public.war_room_open_loops (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.war_room_projects (id) on delete set null,
  conversation_id uuid references public.war_room_conversations (id) on delete set null,
  title text not null,
  description text,
  status text not null default 'open',
  priority smallint not null default 0,
  source text not null default 'commander_stated',
  owner_type text not null default 'commander',
  blocked_by text,
  next_action text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint war_room_open_loops_status_check check (
    status in ('open', 'blocked', 'in_progress', 'done', 'dropped')
  ),
  constraint war_room_open_loops_owner_type_check check (
    owner_type in ('commander', 'claude', 'kimi', 'council', 'war_room', 'external')
  )
);

create index if not exists war_room_open_loops_project_idx
  on public.war_room_open_loops (project_id, status, priority desc, updated_at desc);

create index if not exists war_room_open_loops_conversation_idx
  on public.war_room_open_loops (conversation_id, status);

create index if not exists war_room_open_loops_status_idx
  on public.war_room_open_loops (status, priority desc, updated_at asc);

alter table public.war_room_open_loops enable row level security;

drop policy if exists war_room_open_loops_service_role_all on public.war_room_open_loops;
create policy war_room_open_loops_service_role_all
  on public.war_room_open_loops
  for all to service_role using (true) with check (true);

grant select, insert, update, delete on table public.war_room_open_loops to service_role;

create or replace function public.touch_war_room_projects_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_projects_set_updated_at on public.war_room_projects;
create trigger war_room_projects_set_updated_at
  before update on public.war_room_projects
  for each row
  execute procedure public.touch_war_room_projects_updated_at();

create or replace function public.touch_war_room_open_loops_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  if new.status in ('done', 'dropped') and old.status not in ('done', 'dropped') then
    new.resolved_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists war_room_open_loops_set_updated_at on public.war_room_open_loops;
create trigger war_room_open_loops_set_updated_at
  before update on public.war_room_open_loops
  for each row
  execute procedure public.touch_war_room_open_loops_updated_at();

-- ---------------------------------------------------------------------------
-- Additive linkage: conversations get an active project pointer; the Council's
-- separate cognitive-bus thread-state table gets a nullable convenience join
-- column back to war_room_conversations.id (no FK — thread_id is text and may
-- legitimately hold non-uuid values from other Council flows, so this stays a
-- soft, backfillable pointer rather than an enforced relation).
-- ---------------------------------------------------------------------------
alter table public.war_room_conversations
  add column if not exists active_project_id uuid references public.war_room_projects (id) on delete set null;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'war_room_council_thread_state'
  ) then
    execute 'alter table public.war_room_council_thread_state add column if not exists conversation_id uuid';
    execute $u$
      update public.war_room_council_thread_state
      set conversation_id = thread_id::uuid
      where conversation_id is null
        and thread_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    $u$;
    execute 'create index if not exists war_room_council_thread_state_conversation_idx on public.war_room_council_thread_state (conversation_id)';
  end if;
end
$$;

select pg_notify('pgrst', 'reload schema');
