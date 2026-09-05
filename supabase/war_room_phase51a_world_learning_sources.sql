-- War Room Phase 51A: AGI Wave 2 — World Learning source records & versioning.
-- Additive only. Server API uses SUPABASE_SERVICE_ROLE_KEY; no anon/public write policies are added.

grant usage on schema public to service_role;

create table if not exists public.war_room_source_records (
  id uuid primary key default gen_random_uuid(),
  canonical_uri text,
  source_type text not null default 'web',
  title text,
  publisher text,
  language text,
  media_type text not null default 'text',
  discovered_at timestamptz not null default now(),
  first_acquired_at timestamptz,
  last_checked_at timestamptz,
  access_method text,
  content_hash text,
  provenance jsonb not null default '{}'::jsonb,
  quality_metadata jsonb not null default '{}'::jsonb,
  rights_metadata jsonb not null default '{}'::jsonb,
  terra_observation_ref jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_source_records_source_type_check check (
    source_type in ('web', 'api', 'pdf', 'document', 'dataset', 'audio', 'video', 'image', 'sensor', 'database', 'commander_artifact')
  ),
  constraint war_room_source_records_status_check check (
    status in ('active', 'stale', 'retracted', 'superseded')
  )
);

create index if not exists war_room_source_records_uri_idx on public.war_room_source_records (canonical_uri);
create index if not exists war_room_source_records_status_idx on public.war_room_source_records (status, discovered_at desc);
create index if not exists war_room_source_records_title_fts_idx on public.war_room_source_records
  using gin (to_tsvector('english', coalesce(title, '')));

alter table public.war_room_source_records enable row level security;
drop policy if exists war_room_source_records_service_role_all on public.war_room_source_records;
create policy war_room_source_records_service_role_all
  on public.war_room_source_records for all to service_role using (true) with check (true);
grant select, insert, update, delete on table public.war_room_source_records to service_role;

create or replace function public.touch_war_room_source_records_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists war_room_source_records_set_updated_at on public.war_room_source_records;
create trigger war_room_source_records_set_updated_at
  before update on public.war_room_source_records
  for each row execute procedure public.touch_war_room_source_records_updated_at();

create table if not exists public.war_room_source_versions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.war_room_source_records (id) on delete cascade,
  observed_at timestamptz not null default now(),
  content_hash text not null,
  previous_version_id uuid references public.war_room_source_versions (id) on delete set null,
  change_type text not null default 'initial',
  content_snippet text,
  parser_version text,
  extraction_version text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint war_room_source_versions_change_type_check check (
    change_type in ('initial', 'updated', 'unchanged', 'retracted')
  )
);

create unique index if not exists war_room_source_versions_dedupe_idx
  on public.war_room_source_versions (source_id, content_hash);
create index if not exists war_room_source_versions_source_idx
  on public.war_room_source_versions (source_id, observed_at desc);

alter table public.war_room_source_versions enable row level security;
drop policy if exists war_room_source_versions_service_role_all on public.war_room_source_versions;
create policy war_room_source_versions_service_role_all
  on public.war_room_source_versions for all to service_role using (true) with check (true);
grant select, insert, update, delete on table public.war_room_source_versions to service_role;

select pg_notify('pgrst', 'reload schema');
