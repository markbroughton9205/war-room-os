-- War Room Phase 50E: AGI Wave 1 — minimal Experience & Failure records.
-- Reference-only: these tables point at existing messages/snapshots/artifacts by id and never
-- duplicate content, and never capture hidden chain-of-thought — only observable state deltas.
-- Server API uses SUPABASE_SERVICE_ROLE_KEY; no anon/public write policies are added.

grant usage on schema public to service_role;

create table if not exists public.war_room_agi_experience_records (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.war_room_conversations (id) on delete set null,
  message_id uuid references public.war_room_messages (id) on delete set null,
  context_snapshot_id uuid references public.war_room_context_snapshots (id) on delete set null,
  prompt_artifact_id uuid references public.war_room_prompt_artifacts (id) on delete set null,
  model_target jsonb not null default '{}'::jsonb,
  turn_kind text not null default 'assistant_response',
  outcome_signal text not null default 'none',
  created_at timestamptz not null default now(),
  constraint war_room_agi_experience_records_turn_kind_check check (
    turn_kind in ('commander_message', 'assistant_response', 'prompt_generated')
  ),
  constraint war_room_agi_experience_records_outcome_signal_check check (
    outcome_signal in ('none', 'commander_correction', 'commander_approval', 'provider_error')
  )
);

create index if not exists war_room_agi_experience_records_conversation_idx
  on public.war_room_agi_experience_records (conversation_id, created_at desc);

alter table public.war_room_agi_experience_records enable row level security;

drop policy if exists war_room_agi_experience_records_service_role_all on public.war_room_agi_experience_records;
create policy war_room_agi_experience_records_service_role_all
  on public.war_room_agi_experience_records
  for all to service_role using (true) with check (true);

grant select, insert, update, delete on table public.war_room_agi_experience_records to service_role;

create table if not exists public.war_room_failure_records (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.war_room_conversations (id) on delete set null,
  experience_record_id uuid references public.war_room_agi_experience_records (id) on delete set null,
  failure_kind text not null,
  detail text,
  provider_family text,
  created_at timestamptz not null default now(),
  constraint war_room_failure_records_kind_check check (
    failure_kind in ('commander_rejection', 'commander_correction', 'provider_error', 'validation_failure')
  )
);

create index if not exists war_room_failure_records_conversation_idx
  on public.war_room_failure_records (conversation_id, created_at desc);

alter table public.war_room_failure_records enable row level security;

drop policy if exists war_room_failure_records_service_role_all on public.war_room_failure_records;
create policy war_room_failure_records_service_role_all
  on public.war_room_failure_records
  for all to service_role using (true) with check (true);

grant select, insert, update, delete on table public.war_room_failure_records to service_role;

select pg_notify('pgrst', 'reload schema');
