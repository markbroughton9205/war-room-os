-- War Room Phase 51D: AGI Wave 2 — Learning Sessions & retrievable World Knowledge.
-- Additive only. Server API uses SUPABASE_SERVICE_ROLE_KEY; no anon/public write policies are added.
-- source_ids/claim_ids/gap_ids/experience_ids are soft (uuid[]) references, not enforced FKs —
-- matches this repo's existing loose-array-of-refs convention (e.g. related_files text[] style)
-- and avoids forward/circular FK ordering between sessions and the records they produce.

grant usage on schema public to service_role;

create table if not exists public.war_room_learning_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.war_room_projects (id) on delete set null,
  conversation_id uuid references public.war_room_conversations (id) on delete set null,
  objective text not null,
  status text not null default 'running',
  initiated_by text not null default 'commander',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  source_ids uuid[] not null default '{}'::uuid[],
  claim_ids uuid[] not null default '{}'::uuid[],
  gap_ids uuid[] not null default '{}'::uuid[],
  experience_ids uuid[] not null default '{}'::uuid[],
  items jsonb not null default '[]'::jsonb,
  outcome_summary text,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint war_room_learning_sessions_status_check check (
    status in ('running', 'completed', 'failed', 'partial')
  )
);

create index if not exists war_room_learning_sessions_project_idx
  on public.war_room_learning_sessions (project_id, started_at desc);
create index if not exists war_room_learning_sessions_conversation_idx
  on public.war_room_learning_sessions (conversation_id, started_at desc);

alter table public.war_room_learning_sessions enable row level security;
drop policy if exists war_room_learning_sessions_service_role_all on public.war_room_learning_sessions;
create policy war_room_learning_sessions_service_role_all
  on public.war_room_learning_sessions for all to service_role using (true) with check (true);
grant select, insert, update, delete on table public.war_room_learning_sessions to service_role;

create table if not exists public.war_room_world_knowledge_records (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  claim_ids uuid[] not null default '{}'::uuid[],
  source_ids uuid[] not null default '{}'::uuid[],
  project_id uuid references public.war_room_projects (id) on delete set null,
  scope text not null default 'project',
  status text not null default 'candidate',
  confidence numeric(4,3) not null default 0.5,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  superseded_by uuid references public.war_room_world_knowledge_records (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_world_knowledge_records_scope_check check (
    scope in ('global', 'project')
  ),
  constraint war_room_world_knowledge_records_status_check check (
    status in ('candidate', 'active', 'superseded', 'retracted', 'contested')
  )
);

create index if not exists war_room_world_knowledge_records_active_idx
  on public.war_room_world_knowledge_records (scope, status, project_id, valid_from desc);
create index if not exists war_room_world_knowledge_records_content_fts_idx
  on public.war_room_world_knowledge_records using gin (to_tsvector('english', content));

alter table public.war_room_world_knowledge_records enable row level security;
drop policy if exists war_room_world_knowledge_records_service_role_all on public.war_room_world_knowledge_records;
create policy war_room_world_knowledge_records_service_role_all
  on public.war_room_world_knowledge_records for all to service_role using (true) with check (true);
grant select, insert, update, delete on table public.war_room_world_knowledge_records to service_role;

create or replace function public.touch_war_room_world_knowledge_records_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists war_room_world_knowledge_records_set_updated_at on public.war_room_world_knowledge_records;
create trigger war_room_world_knowledge_records_set_updated_at
  before update on public.war_room_world_knowledge_records
  for each row execute procedure public.touch_war_room_world_knowledge_records_updated_at();

select pg_notify('pgrst', 'reload schema');
