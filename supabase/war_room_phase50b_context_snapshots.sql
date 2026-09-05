-- War Room Phase 50B: AGI Wave 1 — inspectable Context Assembler snapshots.
-- Additive only. Server API uses SUPABASE_SERVICE_ROLE_KEY; no anon/public write policies are added.

grant usage on schema public to service_role;

create table if not exists public.war_room_context_snapshots (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.war_room_conversations (id) on delete set null,
  project_id uuid references public.war_room_projects (id) on delete set null,
  assembled_at timestamptz not null default now(),
  model_target jsonb not null default '{}'::jsonb,
  token_estimate integer not null default 0,
  content_hash text not null,
  ranking_version text not null default 'v1',
  included_source_ids jsonb not null default '[]'::jsonb,
  excluded_source_ids jsonb not null default '[]'::jsonb,
  budget_breakdown jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists war_room_context_snapshots_conversation_idx
  on public.war_room_context_snapshots (conversation_id, assembled_at desc);

create index if not exists war_room_context_snapshots_project_idx
  on public.war_room_context_snapshots (project_id, assembled_at desc);

alter table public.war_room_context_snapshots enable row level security;

drop policy if exists war_room_context_snapshots_service_role_all on public.war_room_context_snapshots;
create policy war_room_context_snapshots_service_role_all
  on public.war_room_context_snapshots
  for all to service_role using (true) with check (true);

grant select, insert, update, delete on table public.war_room_context_snapshots to service_role;

select pg_notify('pgrst', 'reload schema');
