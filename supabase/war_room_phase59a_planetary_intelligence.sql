-- War Room Phase 59A: Divergent Council + Planetary Source Fabric P0
-- Additive only. Relational ledger is authoritative. Graph databases are not required.
-- This schema is Council/source-fabric storage only. It does not train models or alter Foundry.
--
-- DO NOT run against production from an agent session unless Commander applies it.
-- Apply manually in the Supabase SQL editor, then:
--   select pg_notify('pgrst', 'reload schema');

grant usage on schema public to service_role;

create table if not exists public.war_room_planetary_sources (
  source_id text primary key,
  canonical_name text not null,
  outlet_name text not null,
  publisher text not null,
  parent_company text,
  ownership_type text not null default 'UNKNOWN',
  canonical_domain text not null,
  domain_aliases text[] not null default '{}'::text[],
  country text,
  region text,
  state_province text,
  county_district text,
  city text,
  locality text,
  latitude numeric,
  longitude numeric,
  primary_language text not null default 'und',
  supported_languages text[] not null default '{}'::text[],
  source_type text not null,
  topic_specialties text[] not null default '{}'::text[],
  primary_or_secondary text not null default 'UNKNOWN',
  original_reporting_capability boolean not null default false,
  url text not null,
  status text not null default 'DISCOVERED',
  wire_relationship text,
  parent_network text,
  discovery_method text not null,
  discovered_at timestamptz not null default now(),
  last_checked timestamptz,
  last_successful_fetch timestamptz,
  observed_publish_rate numeric,
  freshness_class text not null default 'NATIONAL_REGIONAL',
  robots_status text not null default 'UNKNOWN',
  terms_status text not null default 'UNKNOWN',
  retention_class text not null default 'METADATA_ONLY',
  license_metadata text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists war_room_planetary_sources_domain_idx
  on public.war_room_planetary_sources (canonical_domain);
create index if not exists war_room_planetary_sources_status_idx
  on public.war_room_planetary_sources (status, region, source_type);

alter table public.war_room_planetary_sources enable row level security;
drop policy if exists war_room_planetary_sources_service_role_all on public.war_room_planetary_sources;
create policy war_room_planetary_sources_service_role_all
  on public.war_room_planetary_sources for all to service_role using (true) with check (true);
grant select, insert, update, delete on table public.war_room_planetary_sources to service_role;

create table if not exists public.war_room_planetary_source_endpoints (
  endpoint_id text primary key,
  source_id text not null references public.war_room_planetary_sources (source_id) on delete cascade,
  endpoint_type text not null,
  url text not null,
  etag text,
  last_modified text,
  last_fetch timestamptz,
  next_fetch timestamptz,
  fetch_interval_seconds integer not null default 900,
  status text not null default 'IDLE',
  error_count integer not null default 0,
  rate_limit_state text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists war_room_planetary_source_endpoints_source_idx
  on public.war_room_planetary_source_endpoints (source_id, status);

alter table public.war_room_planetary_source_endpoints enable row level security;
drop policy if exists war_room_planetary_source_endpoints_service_role_all on public.war_room_planetary_source_endpoints;
create policy war_room_planetary_source_endpoints_service_role_all
  on public.war_room_planetary_source_endpoints for all to service_role using (true) with check (true);
grant select, insert, update, delete on table public.war_room_planetary_source_endpoints to service_role;

create table if not exists public.war_room_planetary_missions (
  mission_id text primary key,
  commander_intent text not null,
  complexity text not null,
  protocol text not null,
  created_at timestamptz not null default now(),
  mission_json jsonb not null default '{}'::jsonb
);

alter table public.war_room_planetary_missions enable row level security;
drop policy if exists war_room_planetary_missions_service_role_all on public.war_room_planetary_missions;
create policy war_room_planetary_missions_service_role_all
  on public.war_room_planetary_missions for all to service_role using (true) with check (true);
grant select, insert, update, delete on table public.war_room_planetary_missions to service_role;

create table if not exists public.war_room_planetary_lane_packets (
  lane_id text primary key,
  mission_id text not null references public.war_room_planetary_missions (mission_id) on delete cascade,
  task_id text not null,
  seat text not null,
  packet_hash text not null,
  timestamp timestamptz not null,
  immutable boolean not null default true,
  packet_json jsonb not null default '{}'::jsonb
);

alter table public.war_room_planetary_lane_packets enable row level security;
drop policy if exists war_room_planetary_lane_packets_service_role_all on public.war_room_planetary_lane_packets;
create policy war_room_planetary_lane_packets_service_role_all
  on public.war_room_planetary_lane_packets for all to service_role using (true) with check (true);
grant select, insert, update, delete on table public.war_room_planetary_lane_packets to service_role;

create table if not exists public.war_room_planetary_documents (
  document_id text primary key,
  mission_id text,
  canonical_url text not null,
  url text not null,
  title text,
  publisher text,
  outlet text,
  parent_company text,
  source_origin_id text,
  independent_origin_id text,
  content_hash text,
  simhash text,
  original_text text,
  original_language text,
  translated_text text,
  translation_method text,
  translation_time timestamptz,
  translation_confidence numeric,
  geography text,
  topic text,
  source_class text,
  evidence_class text,
  prompt_injection_detected boolean not null default false,
  retention_class text not null default 'METADATA_ONLY',
  created_at timestamptz not null default now()
);

create index if not exists war_room_planetary_documents_canonical_idx
  on public.war_room_planetary_documents (canonical_url);
create index if not exists war_room_planetary_documents_origin_idx
  on public.war_room_planetary_documents (independent_origin_id);

alter table public.war_room_planetary_documents enable row level security;
drop policy if exists war_room_planetary_documents_service_role_all on public.war_room_planetary_documents;
create policy war_room_planetary_documents_service_role_all
  on public.war_room_planetary_documents for all to service_role using (true) with check (true);
grant select, insert, update, delete on table public.war_room_planetary_documents to service_role;

create table if not exists public.war_room_planetary_claims (
  claim_id text primary key,
  mission_id text,
  lane_id text,
  agent text not null,
  normalized_claim text not null,
  original_claim text not null,
  original_language text,
  topic text,
  geography text,
  event_time text,
  confidence numeric not null default 0.4,
  verification_state text not null default 'UNVERIFIED',
  story_cluster_id text,
  independent_origin_ids text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

create index if not exists war_room_planetary_claims_mission_idx
  on public.war_room_planetary_claims (mission_id, verification_state);

alter table public.war_room_planetary_claims enable row level security;
drop policy if exists war_room_planetary_claims_service_role_all on public.war_room_planetary_claims;
create policy war_room_planetary_claims_service_role_all
  on public.war_room_planetary_claims for all to service_role using (true) with check (true);
grant select, insert, update, delete on table public.war_room_planetary_claims to service_role;

create table if not exists public.war_room_planetary_evidence_edges (
  edge_id text primary key,
  mission_id text,
  claim_id text not null,
  document_id text not null,
  relation text not null,
  origin_id text,
  created_at timestamptz not null default now()
);

alter table public.war_room_planetary_evidence_edges enable row level security;
drop policy if exists war_room_planetary_evidence_edges_service_role_all on public.war_room_planetary_evidence_edges;
create policy war_room_planetary_evidence_edges_service_role_all
  on public.war_room_planetary_evidence_edges for all to service_role using (true) with check (true);
grant select, insert, update, delete on table public.war_room_planetary_evidence_edges to service_role;

create table if not exists public.war_room_planetary_story_clusters (
  story_cluster_id text primary key,
  syndication_cluster_id text not null,
  canonical_story_origin text not null,
  independent_origin_id text not null,
  origin_confidence numeric not null,
  origin_method text not null,
  member_document_ids text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

alter table public.war_room_planetary_story_clusters enable row level security;
drop policy if exists war_room_planetary_story_clusters_service_role_all on public.war_room_planetary_story_clusters;
create policy war_room_planetary_story_clusters_service_role_all
  on public.war_room_planetary_story_clusters for all to service_role using (true) with check (true);
grant select, insert, update, delete on table public.war_room_planetary_story_clusters to service_role;

create table if not exists public.war_room_planetary_coverage_cells (
  cell_id text primary key,
  mission_id text,
  geography text not null,
  topic text not null,
  language text not null,
  source_type text not null,
  time_window text not null,
  evidence_quality text not null,
  claims integer not null default 0,
  independent_origins integer not null default 0,
  status text not null,
  cell_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.war_room_planetary_coverage_cells enable row level security;
drop policy if exists war_room_planetary_coverage_cells_service_role_all on public.war_room_planetary_coverage_cells;
create policy war_room_planetary_coverage_cells_service_role_all
  on public.war_room_planetary_coverage_cells for all to service_role using (true) with check (true);
grant select, insert, update, delete on table public.war_room_planetary_coverage_cells to service_role;
