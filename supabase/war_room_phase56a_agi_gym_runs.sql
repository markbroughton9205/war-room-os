-- War Room Phase 56A: Wave 6 AGI gym run ledger. Observable trajectories only. No training.
grant usage on schema public to service_role;

create table if not exists public.war_room_agi_gym_runs (
  id text primary key,
  gym_type text not null check (gym_type in ('code_operator','research_engine','terra_world_state','tool_use')),
  mission_id text not null,
  objective text not null,
  outcome text not null check (outcome in ('pass','fail')),
  started_at timestamptz not null,
  completed_at timestamptz not null,
  trajectory jsonb not null default '[]',
  criteria jsonb not null default '[]',
  evidence_id text,
  hidden_cot_detected boolean not null default false,
  secret_detected boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists war_room_agi_gym_runs_gym_idx on public.war_room_agi_gym_runs (gym_type, completed_at desc);

alter table public.war_room_agi_gym_runs enable row level security;
drop policy if exists war_room_agi_gym_runs_service_role_all on public.war_room_agi_gym_runs;
create policy war_room_agi_gym_runs_service_role_all on public.war_room_agi_gym_runs for all to service_role using (true) with check (true);
grant select, insert, update, delete on table public.war_room_agi_gym_runs to service_role;
select pg_notify('pgrst', 'reload schema');
