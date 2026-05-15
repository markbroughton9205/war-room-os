-- War Room — runtime integrity diagnostic events (service-role API inserts; RLS on, no anon policies)
-- Apply after war_room_phase3b.sql or war_room_production_init.sql baseline.

create table if not exists public.war_room_runtime_integrity_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  subsystem text not null,
  severity text not null,
  source_family text,
  evidence jsonb not null default '{}'::jsonb,
  recommendation text,
  diagnostic_mode text
);

create index if not exists war_room_runtime_integrity_logs_created_idx
  on public.war_room_runtime_integrity_logs (created_at desc);

create index if not exists war_room_runtime_integrity_logs_subsystem_created_idx
  on public.war_room_runtime_integrity_logs (subsystem, created_at desc);

alter table public.war_room_runtime_integrity_logs enable row level security;

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on table public.war_room_runtime_integrity_logs to service_role;

drop policy if exists war_room_runtime_integrity_logs_service_role_all on public.war_room_runtime_integrity_logs;

create policy war_room_runtime_integrity_logs_service_role_all
  on public.war_room_runtime_integrity_logs
  for all
  to service_role
  using (true)
  with check (true);
