-- Phase 30: Unified cognitive bus (additive; idempotent).

create table if not exists public.war_room_council_thread_events (
  id uuid primary key,
  thread_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  correlation_id text,
  created_at timestamptz not null default now()
);

create index if not exists war_room_council_thread_events_thread_created_idx
  on public.war_room_council_thread_events (thread_id, created_at desc);

create table if not exists public.war_room_council_thread_state (
  thread_id text primary key,
  phase text not null default 'intake',
  correlation_id text,
  operator_packet jsonb,
  inherited_context jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.war_room_council_thread_state
  drop constraint if exists war_room_council_thread_state_phase_check;

alter table public.war_room_council_thread_state
  add constraint war_room_council_thread_state_phase_check check (
    phase in ('intake', 'specialize', 'synthesize', 'red_team', 'operator_packet', 'closed')
  );

alter table public.war_room_council_thread_events enable row level security;
alter table public.war_room_council_thread_state enable row level security;

grant select, insert, update, delete on table public.war_room_council_thread_events to service_role;
grant select, insert, update, delete on table public.war_room_council_thread_state to service_role;

drop policy if exists war_room_council_thread_events_service_role_all on public.war_room_council_thread_events;
create policy war_room_council_thread_events_service_role_all
  on public.war_room_council_thread_events
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists war_room_council_thread_state_service_role_all on public.war_room_council_thread_state;
create policy war_room_council_thread_state_service_role_all
  on public.war_room_council_thread_state
  for all
  to service_role
  using (true)
  with check (true);

select pg_notify('pgrst', 'reload schema');
