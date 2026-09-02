-- War Room Phase 50C: AGI Wave 1 — Prompt Intelligence artifacts & outcomes.
-- Additive only. Server API uses SUPABASE_SERVICE_ROLE_KEY; no anon/public write policies are added.

grant usage on schema public to service_role;

create table if not exists public.war_room_prompt_artifacts (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.war_room_conversations (id) on delete set null,
  project_id uuid references public.war_room_projects (id) on delete set null,
  context_snapshot_id uuid references public.war_room_context_snapshots (id) on delete set null,
  intent text not null,
  target_agent_id text not null,
  prompt_text text not null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_prompt_artifacts_intent_check check (
    intent in (
      'GIVE_CLAUDE_NEXT_PROMPT',
      'GIVE_KIMI_RESEARCH_PROMPT',
      'GIVE_CODEX_BUILD_PROMPT',
      'GENERIC_AGENT_MISSION_PROMPT'
    )
  ),
  constraint war_room_prompt_artifacts_status_check check (
    status in ('draft', 'delivered', 'superseded')
  )
);

create index if not exists war_room_prompt_artifacts_conversation_idx
  on public.war_room_prompt_artifacts (conversation_id, created_at desc);

create index if not exists war_room_prompt_artifacts_project_idx
  on public.war_room_prompt_artifacts (project_id, created_at desc);

alter table public.war_room_prompt_artifacts enable row level security;

drop policy if exists war_room_prompt_artifacts_service_role_all on public.war_room_prompt_artifacts;
create policy war_room_prompt_artifacts_service_role_all
  on public.war_room_prompt_artifacts
  for all to service_role using (true) with check (true);

grant select, insert, update, delete on table public.war_room_prompt_artifacts to service_role;

create table if not exists public.war_room_prompt_outcomes (
  id uuid primary key default gen_random_uuid(),
  prompt_artifact_id uuid not null references public.war_room_prompt_artifacts (id) on delete cascade,
  outcome text not null default 'unknown',
  commander_note text,
  recorded_at timestamptz not null default now(),
  constraint war_room_prompt_outcomes_outcome_check check (
    outcome in ('accepted', 'rejected', 'partial', 'unknown')
  )
);

create index if not exists war_room_prompt_outcomes_artifact_idx
  on public.war_room_prompt_outcomes (prompt_artifact_id, recorded_at desc);

alter table public.war_room_prompt_outcomes enable row level security;

drop policy if exists war_room_prompt_outcomes_service_role_all on public.war_room_prompt_outcomes;
create policy war_room_prompt_outcomes_service_role_all
  on public.war_room_prompt_outcomes
  for all to service_role using (true) with check (true);

grant select, insert, update, delete on table public.war_room_prompt_outcomes to service_role;

create or replace function public.touch_war_room_prompt_artifacts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_prompt_artifacts_set_updated_at on public.war_room_prompt_artifacts;
create trigger war_room_prompt_artifacts_set_updated_at
  before update on public.war_room_prompt_artifacts
  for each row
  execute procedure public.touch_war_room_prompt_artifacts_updated_at();

select pg_notify('pgrst', 'reload schema');
