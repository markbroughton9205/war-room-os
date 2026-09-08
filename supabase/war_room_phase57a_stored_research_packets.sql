-- War Room Phase 57A: Build #4B stored research packets.
-- Additive only. One coherent JSONB record per completed research turn.
-- DO NOT run against production. Local/dev proof uses the filesystem store
-- at `.war-room/stored-research/` until this migration is applied to a non-prod database.

grant usage on schema public to service_role;

create table if not exists public.war_room_stored_research_packets (
  id text primary key,
  conversation_id uuid,
  logical_request_id text,
  round_request_id text,
  decree text not null,
  created_at timestamptz not null default now(),
  freshness text not null default 'unknown',
  confidence numeric(6,4) not null default 0,
  packet_json jsonb not null default '{}'::jsonb,
  constraint war_room_stored_research_packets_json_check check (jsonb_typeof(packet_json) = 'object'),
  constraint war_room_stored_research_packets_freshness_check check (
    freshness in ('live', 'recent', 'aging', 'stale', 'unknown')
  )
);

create index if not exists war_room_stored_research_packets_conversation_idx
  on public.war_room_stored_research_packets (conversation_id, created_at desc);
create index if not exists war_room_stored_research_packets_logical_idx
  on public.war_room_stored_research_packets (logical_request_id);
create index if not exists war_room_stored_research_packets_decree_fts_idx
  on public.war_room_stored_research_packets
  using gin (to_tsvector('english', coalesce(decree, '')));

alter table public.war_room_stored_research_packets enable row level security;
drop policy if exists war_room_stored_research_packets_service_role_all
  on public.war_room_stored_research_packets;
create policy war_room_stored_research_packets_service_role_all
  on public.war_room_stored_research_packets for all to service_role using (true) with check (true);
grant select, insert, update, delete on table public.war_room_stored_research_packets to service_role;

select pg_notify('pgrst', 'reload schema');
