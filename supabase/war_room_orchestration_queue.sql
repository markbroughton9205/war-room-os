-- War Room — orchestration queue metadata (rows only; no worker execution in this migration).
-- Intended for durable queue inspection, audits, and future workers. API routes use SUPABASE_SERVICE_ROLE_KEY.

create table if not exists public.war_room_orchestration_queue (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  status text not null,
  payload jsonb not null default '{}'::jsonb,
  priority int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claimed_at timestamptz null,
  completed_at timestamptz null,
  error jsonb null
);

create index if not exists war_room_orchestration_queue_status_created_idx
  on public.war_room_orchestration_queue (status, created_at desc);

create index if not exists war_room_orchestration_queue_type_created_idx
  on public.war_room_orchestration_queue (type, created_at desc);

create or replace function public.war_room_orchestration_queue_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_orchestration_queue_touch_updated_at on public.war_room_orchestration_queue;

create trigger war_room_orchestration_queue_touch_updated_at
  before update on public.war_room_orchestration_queue
  for each row
  execute procedure public.war_room_orchestration_queue_touch_updated_at();

alter table public.war_room_orchestration_queue enable row level security;

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on table public.war_room_orchestration_queue to service_role;

drop policy if exists war_room_orchestration_queue_service_role_all on public.war_room_orchestration_queue;

create policy war_room_orchestration_queue_service_role_all
  on public.war_room_orchestration_queue
  for all
  to service_role
  using (true)
  with check (true);
