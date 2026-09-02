-- War Room Phase 51C: AGI Wave 2 — Contradiction records & Knowledge Gap registry.
-- Additive only. Server API uses SUPABASE_SERVICE_ROLE_KEY; no anon/public write policies are added.

grant usage on schema public to service_role;

create table if not exists public.war_room_contradiction_records (
  id uuid primary key default gen_random_uuid(),
  claim_a_id uuid not null references public.war_room_claim_records (id) on delete cascade,
  claim_b_id uuid not null references public.war_room_claim_records (id) on delete cascade,
  relationship text not null default 'unresolved',
  evidence jsonb not null default '[]'::jsonb,
  confidence numeric(4,3) not null default 0.5,
  detector text not null default 'rule_based',
  verification_status text not null default 'unverified',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_refs jsonb not null default '{}'::jsonb,
  constraint war_room_contradiction_records_relationship_check check (
    relationship in ('agrees', 'contradicts', 'qualifies', 'temporally_supersedes', 'unresolved')
  ),
  constraint war_room_contradiction_records_verification_check check (
    verification_status in ('unverified', 'reviewed', 'resolved')
  )
);

create index if not exists war_room_contradiction_records_claims_idx
  on public.war_room_contradiction_records (claim_a_id, claim_b_id);
create index if not exists war_room_contradiction_records_status_idx
  on public.war_room_contradiction_records (verification_status, created_at desc);

alter table public.war_room_contradiction_records enable row level security;
drop policy if exists war_room_contradiction_records_service_role_all on public.war_room_contradiction_records;
create policy war_room_contradiction_records_service_role_all
  on public.war_room_contradiction_records for all to service_role using (true) with check (true);
grant select, insert, update, delete on table public.war_room_contradiction_records to service_role;

create table if not exists public.war_room_knowledge_gaps (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.war_room_projects (id) on delete set null,
  conversation_id uuid references public.war_room_conversations (id) on delete set null,
  question text not null,
  gap_type text not null default 'missing_answer',
  priority smallint not null default 0,
  status text not null default 'open',
  source_refs jsonb not null default '[]'::jsonb,
  created_by text not null default 'commander',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_refs jsonb not null default '{}'::jsonb,
  constraint war_room_knowledge_gaps_gap_type_check check (
    gap_type in (
      'missing_answer', 'conflicting_sources', 'stale_knowledge', 'insufficient_evidence',
      'unknown_relationship', 'prediction_awaiting_verification', 'commander_question_unresolved',
      'capability_gap'
    )
  ),
  constraint war_room_knowledge_gaps_status_check check (
    status in ('open', 'researching', 'resolved', 'dropped')
  )
);

create index if not exists war_room_knowledge_gaps_project_idx
  on public.war_room_knowledge_gaps (project_id, status, priority desc, updated_at desc);
create index if not exists war_room_knowledge_gaps_question_fts_idx
  on public.war_room_knowledge_gaps using gin (to_tsvector('english', question));

alter table public.war_room_knowledge_gaps enable row level security;
drop policy if exists war_room_knowledge_gaps_service_role_all on public.war_room_knowledge_gaps;
create policy war_room_knowledge_gaps_service_role_all
  on public.war_room_knowledge_gaps for all to service_role using (true) with check (true);
grant select, insert, update, delete on table public.war_room_knowledge_gaps to service_role;

create or replace function public.touch_war_room_knowledge_gaps_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  if new.status in ('resolved', 'dropped') and old.status not in ('resolved', 'dropped') then
    new.resolved_at = now();
  end if;
  return new;
end;
$$;
drop trigger if exists war_room_knowledge_gaps_set_updated_at on public.war_room_knowledge_gaps;
create trigger war_room_knowledge_gaps_set_updated_at
  before update on public.war_room_knowledge_gaps
  for each row execute procedure public.touch_war_room_knowledge_gaps_updated_at();

select pg_notify('pgrst', 'reload schema');
