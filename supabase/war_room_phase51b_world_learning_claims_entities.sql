-- War Room Phase 51B: AGI Wave 2 — World Learning entities & claims.
-- Additive only. Server API uses SUPABASE_SERVICE_ROLE_KEY; no anon/public write policies are added.

grant usage on schema public to service_role;

create table if not exists public.war_room_entity_records (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  description text,
  entity_type text not null default 'concept',
  aliases text[] not null default '{}'::text[],
  relations jsonb not null default '[]'::jsonb,
  project_id uuid references public.war_room_projects (id) on delete set null,
  source_ref jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_entity_records_status_check check (
    status in ('active', 'merged', 'retracted')
  )
);

create index if not exists war_room_entity_records_project_idx on public.war_room_entity_records (project_id, status);
create index if not exists war_room_entity_records_label_fts_idx on public.war_room_entity_records
  using gin (to_tsvector('english', coalesce(label, '') || ' ' || coalesce(description, '')));

alter table public.war_room_entity_records enable row level security;
drop policy if exists war_room_entity_records_service_role_all on public.war_room_entity_records;
create policy war_room_entity_records_service_role_all
  on public.war_room_entity_records for all to service_role using (true) with check (true);
grant select, insert, update, delete on table public.war_room_entity_records to service_role;

create or replace function public.touch_war_room_entity_records_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists war_room_entity_records_set_updated_at on public.war_room_entity_records;
create trigger war_room_entity_records_set_updated_at
  before update on public.war_room_entity_records
  for each row execute procedure public.touch_war_room_entity_records_updated_at();

-- Claims are the first claim-level knowledge contract. evidence_refs is a jsonb array of
-- {sourceVersionId, relation: 'supports'|'contradicts'|'qualifies'|'mentions', note} objects —
-- kept embedded rather than a separate ClaimEvidenceLink table per Wave 2's brief allowance to
-- avoid a giant ontology; a claim's evidence set is small and always read/written as a unit.
create table if not exists public.war_room_claim_records (
  id uuid primary key default gen_random_uuid(),
  normalized_claim_text text not null,
  subject_entity_id uuid references public.war_room_entity_records (id) on delete set null,
  predicate text,
  object_value text,
  claim_type text not null default 'general',
  confidence numeric(4,3) not null default 0.5,
  valid_from timestamptz,
  valid_until timestamptz,
  observed_at timestamptz not null default now(),
  status text not null default 'candidate',
  superseded_by uuid references public.war_room_claim_records (id) on delete set null,
  evidence_refs jsonb not null default '[]'::jsonb,
  extraction_metadata jsonb not null default '{}'::jsonb,
  project_id uuid references public.war_room_projects (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_claim_records_status_check check (
    status in ('observed', 'candidate', 'supported', 'contested', 'verified', 'superseded', 'retracted')
  )
);

create index if not exists war_room_claim_records_project_idx on public.war_room_claim_records (project_id, status, observed_at desc);
create index if not exists war_room_claim_records_subject_idx on public.war_room_claim_records (subject_entity_id);
create index if not exists war_room_claim_records_text_fts_idx on public.war_room_claim_records
  using gin (to_tsvector('english', normalized_claim_text));

alter table public.war_room_claim_records enable row level security;
drop policy if exists war_room_claim_records_service_role_all on public.war_room_claim_records;
create policy war_room_claim_records_service_role_all
  on public.war_room_claim_records for all to service_role using (true) with check (true);
grant select, insert, update, delete on table public.war_room_claim_records to service_role;

create or replace function public.touch_war_room_claim_records_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists war_room_claim_records_set_updated_at on public.war_room_claim_records;
create trigger war_room_claim_records_set_updated_at
  before update on public.war_room_claim_records
  for each row execute procedure public.touch_war_room_claim_records_updated_at();

select pg_notify('pgrst', 'reload schema');
