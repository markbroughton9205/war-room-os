-- War Room Phase 7B: Operational surface + opportunity intelligence layer.
-- Extends Phase 7 without enabling autonomous external execution.

alter table public.war_room_economic_opportunities
  add column if not exists source_provider text not null default 'unknown',
  add column if not exists notes text not null default '',
  add column if not exists source_details jsonb not null default '{}'::jsonb,
  add column if not exists dedupe_key text;

update public.war_room_economic_opportunities
set dedupe_key = coalesce(
  dedupe_key,
  lower(coalesce(source_provider, 'unknown') || ':' || coalesce(metadata->>'session_id', 'global') || ':' || regexp_replace(title, '[^a-zA-Z0-9]+', ' ', 'g'))
)
where dedupe_key is null;

alter table public.war_room_economic_opportunities
  alter column dedupe_key set not null;

alter table public.war_room_economic_opportunities
  drop constraint if exists war_room_economic_opportunities_status_check;

alter table public.war_room_economic_opportunities
  add constraint war_room_economic_opportunities_status_check check (
    status in ('discovered','investigating','approved','queued','executing','completed','rejected','archived')
  );

alter table public.war_room_economic_opportunities
  drop constraint if exists war_room_economic_opportunities_source_provider_check;

alter table public.war_room_economic_opportunities
  add constraint war_room_economic_opportunities_source_provider_check check (
    source_provider in ('chatgpt','claude','grok','gemini','red_team','unknown')
  );

create unique index if not exists war_room_economic_opportunities_dedupe_idx
  on public.war_room_economic_opportunities (dedupe_key);

alter table public.war_room_economic_workflow_queue
  add column if not exists dedupe_key text;

update public.war_room_economic_workflow_queue
set dedupe_key = coalesce(
  dedupe_key,
  coalesce(metadata->>'dedupe_key', id::text)
)
where dedupe_key is null;

alter table public.war_room_economic_workflow_queue
  alter column dedupe_key set not null;

alter table public.war_room_economic_workflow_queue
  drop constraint if exists war_room_economic_workflow_status_check;

alter table public.war_room_economic_workflow_queue
  add constraint war_room_economic_workflow_status_check check (
    status in ('pending','investigating','approved','queued','executing','completed','failed','archived')
  );

create unique index if not exists war_room_economic_workflow_dedupe_idx
  on public.war_room_economic_workflow_queue (dedupe_key);

alter table public.war_room_economic_active_missions
  add column if not exists last_activity_at timestamptz not null default now();

alter table public.war_room_economic_active_missions
  alter column status set default 'pending';

alter table public.war_room_economic_active_missions
  drop constraint if exists war_room_economic_active_missions_status_check;

alter table public.war_room_economic_active_missions
  add constraint war_room_economic_active_missions_status_check check (
    status in ('pending','investigating','approved','queued','executing','completed','archived')
  );

create table if not exists public.war_room_economic_assignment_history (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_id uuid not null,
  assigned_family text not null,
  provider_runtime_state text not null default 'recommended',
  confidence numeric not null default 0.5,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint war_room_economic_assignment_subject_type_check check (
    subject_type in ('opportunity','workflow','proposal','mission')
  ),
  constraint war_room_economic_assignment_family_check check (
    assigned_family in ('chatgpt','claude','grok','gemini','red_team')
  ),
  constraint war_room_economic_assignment_runtime_state_check check (
    provider_runtime_state in ('recommended','assigned','investigating','waiting_approval','completed','blocked')
  ),
  constraint war_room_economic_assignment_confidence_check check (confidence >= 0 and confidence <= 1)
);

create index if not exists war_room_economic_assignment_subject_idx
  on public.war_room_economic_assignment_history (subject_type, subject_id, created_at desc);

create index if not exists war_room_economic_assignment_family_idx
  on public.war_room_economic_assignment_history (assigned_family, last_activity_at desc);

alter table public.war_room_economic_assignment_history enable row level security;

drop policy if exists war_room_economic_assignment_history_service_role_all on public.war_room_economic_assignment_history;
create policy war_room_economic_assignment_history_service_role_all on public.war_room_economic_assignment_history
  for all to service_role using (true) with check (true);
