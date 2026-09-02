-- War Room Phase 50D: AGI Wave 1 — versioned Memory Records with temporal supersession.
-- This is the first table in the repo with superseded_by/effective_from/effective_until.
-- Legacy memory tables (memories, war_room_approved_memories, war_room_strategic_memories,
-- war_room_archived_transcripts, war_room_memory_proposals) are NOT migrated or rewritten —
-- they remain read-only-compatible secondary sources. New Commander-decision-grade memories
-- from Wave 1 forward are written here.
-- Server API uses SUPABASE_SERVICE_ROLE_KEY; no anon/public write policies are added.

grant usage on schema public to service_role;

create table if not exists public.war_room_memory_records (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  memory_type text not null,
  scope text not null,
  project_id uuid references public.war_room_projects (id) on delete set null,
  conversation_id uuid references public.war_room_conversations (id) on delete set null,
  status text not null default 'active',
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  superseded_by uuid references public.war_room_memory_records (id) on delete set null,
  importance_tier text not null default 'operational',
  source_type text not null default 'commander_message',
  source_ref jsonb not null default '{}'::jsonb,
  created_by text not null default 'commander',
  created_at timestamptz not null default now(),
  constraint war_room_memory_records_type_check check (
    memory_type in (
      'lesson', 'operator_preference', 'project_fact', 'routing_correction',
      'safety_policy', 'validation_result', 'architecture_decision'
    )
  ),
  constraint war_room_memory_records_scope_check check (
    scope in ('global_war_room', 'council_entity', 'project', 'operator', 'session', 'validation')
  ),
  constraint war_room_memory_records_status_check check (
    status in ('active', 'superseded', 'retracted')
  ),
  constraint war_room_memory_records_importance_check check (
    importance_tier in ('trivial', 'operational', 'strategic', 'critical')
  )
);

create index if not exists war_room_memory_records_active_idx
  on public.war_room_memory_records (scope, status, project_id, effective_from desc);

create index if not exists war_room_memory_records_project_idx
  on public.war_room_memory_records (project_id, status, effective_from desc);

create index if not exists war_room_memory_records_superseded_by_idx
  on public.war_room_memory_records (superseded_by);

alter table public.war_room_memory_records enable row level security;

drop policy if exists war_room_memory_records_service_role_all on public.war_room_memory_records;
create policy war_room_memory_records_service_role_all
  on public.war_room_memory_records
  for all to service_role using (true) with check (true);

grant select, insert, update, delete on table public.war_room_memory_records to service_role;

select pg_notify('pgrst', 'reload schema');
