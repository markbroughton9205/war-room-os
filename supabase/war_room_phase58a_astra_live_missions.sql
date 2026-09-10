-- War Room Phase 58A: Roadmap #14 ASTRA live mission records.
-- Additive only. Does not reuse war_room_missions (fixed operator-graph IDs/status
-- enum) and does not merge with lib/missions, lib/mission-runtime, or
-- lib/opportunity-mission-bridge.
--
-- DO NOT run against production from an agent session. Local/dev proof uses the
-- labeled filesystem fallback at `.war-room/astra-missions/` until this
-- migration is applied to a non-prod database.
--
-- Apply manually in the Supabase SQL editor, then:
--   select pg_notify('pgrst', 'reload schema');

grant usage on schema public to service_role;

create table if not exists public.war_room_astra_missions (
  id text primary key,
  commander_user_id text not null,
  status text not null,
  objective text not null,
  intent text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  planned_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  terra_object_id text,
  terra_object_type text,
  terra_mmsi text,
  terra_provider text,
  terra_evidence_id text,
  terra_latitude numeric,
  terra_longitude numeric,
  terra_observed_at timestamptz,
  terra_freshness text,
  council_conversation_id uuid,
  constellation_spawned boolean not null default false,
  astra_provides_substantive_answer boolean not null default false,
  outcome_summary text,
  error text,
  mission_json jsonb not null default '{}'::jsonb,
  constraint war_room_astra_missions_id_check check (id like 'astra-mission-%'),
  constraint war_room_astra_missions_status_check check (
    status in ('planned', 'running', 'completed', 'failed')
  ),
  constraint war_room_astra_missions_constellation_spawned_false check (
    constellation_spawned is false
  ),
  constraint war_room_astra_missions_astra_no_answer check (
    astra_provides_substantive_answer is false
  ),
  constraint war_room_astra_missions_json_check check (jsonb_typeof(mission_json) = 'object')
);

create index if not exists war_room_astra_missions_commander_created_idx
  on public.war_room_astra_missions (commander_user_id, created_at desc);

create index if not exists war_room_astra_missions_status_idx
  on public.war_room_astra_missions (status, updated_at desc);

create index if not exists war_room_astra_missions_conversation_idx
  on public.war_room_astra_missions (council_conversation_id)
  where council_conversation_id is not null;

create index if not exists war_room_astra_missions_terra_object_idx
  on public.war_room_astra_missions (terra_object_id)
  where terra_object_id is not null;

create index if not exists war_room_astra_missions_terra_mmsi_idx
  on public.war_room_astra_missions (terra_mmsi)
  where terra_mmsi is not null;

alter table public.war_room_astra_missions enable row level security;

drop policy if exists war_room_astra_missions_service_role_all
  on public.war_room_astra_missions;
create policy war_room_astra_missions_service_role_all
  on public.war_room_astra_missions for all to service_role using (true) with check (true);

revoke all on table public.war_room_astra_missions from anon, authenticated;
grant select, insert, update, delete on table public.war_room_astra_missions to service_role;

select pg_notify('pgrst', 'reload schema');
