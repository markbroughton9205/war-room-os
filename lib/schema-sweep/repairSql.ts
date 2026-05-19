export const BABY_AI_REPAIR_SQL = `-- War Room Baby AI memory repair packet.
-- Advisory only: paste into Supabase SQL editor after review. War Room will not execute this from the browser.
grant usage on schema public to service_role;

create table if not exists public.war_room_baby_agents (
  id uuid primary key default gen_random_uuid(),
  agent_key text not null unique,
  display_name text not null,
  family_identity text not null,
  role text not null,
  lifecycle_state text not null default 'seed',
  growth_level integer not null default 0,
  memory_scope text[] not null default '{}'::text[],
  skill_tree jsonb not null default '[]'::jsonb,
  confidence_score numeric(5,4) not null default 0,
  usefulness_score numeric(5,4) not null default 0,
  latest_lesson text not null default 'Awaiting approved lesson.',
  next_training_need text not null default 'Observe approved outcomes.',
  local_bridge_accelerator_allowed boolean not null default true,
  hidden_execution_allowed boolean not null default false,
  shell_execution_allowed boolean not null default false,
  filesystem_write_allowed boolean not null default false,
  deployment_control_allowed boolean not null default false,
  destructive_actions_allowed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.war_room_baby_agent_memories (
  id uuid primary key default gen_random_uuid(),
  baby_agent_id uuid not null references public.war_room_baby_agents(id) on delete cascade,
  memory_scope text not null,
  source_type text not null,
  lesson text not null,
  lesson_state text not null default 'candidate',
  evidence jsonb not null default '{}'::jsonb,
  validation_count integer not null default 0,
  commander_approved_at timestamptz,
  permanent boolean not null default false,
  confidence_delta numeric(5,4) not null default 0,
  usefulness_delta numeric(5,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.war_room_baby_agent_training_events (
  id uuid primary key default gen_random_uuid(),
  baby_agent_id uuid not null references public.war_room_baby_agents(id) on delete cascade,
  source_type text not null,
  event_kind text not null,
  summary text not null,
  observed_outcome text,
  raw_reference jsonb not null default '{}'::jsonb,
  requires_commander_approval boolean not null default true,
  approval_state text not null default 'not_requested',
  resulted_in_memory_id uuid references public.war_room_baby_agent_memories(id) on delete set null,
  hidden_execution_performed boolean not null default false,
  destructive_action_performed boolean not null default false,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.war_room_baby_agent_skill_growth (
  id uuid primary key default gen_random_uuid(),
  baby_agent_id uuid not null references public.war_room_baby_agents(id) on delete cascade,
  skill_key text not null,
  skill_label text not null,
  progress numeric(5,4) not null default 0,
  growth_level integer not null default 0,
  confidence_score numeric(5,4) not null default 0,
  usefulness_score numeric(5,4) not null default 0,
  last_training_event_id uuid references public.war_room_baby_agent_training_events(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_baby_skill_growth_unique unique (baby_agent_id, skill_key)
);

create table if not exists public.war_room_baby_agent_outcomes (
  id uuid primary key default gen_random_uuid(),
  baby_agent_id uuid not null references public.war_room_baby_agents(id) on delete cascade,
  memory_id uuid references public.war_room_baby_agent_memories(id) on delete set null,
  training_event_id uuid references public.war_room_baby_agent_training_events(id) on delete set null,
  outcome_type text not null,
  result_summary text not null,
  validated boolean not null default false,
  validation_count integer not null default 0,
  commander_feedback text,
  confidence_score numeric(5,4) not null default 0,
  usefulness_score numeric(5,4) not null default 0,
  external_execution_performed boolean not null default false,
  destructive_action_performed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists war_room_baby_agents_key_idx on public.war_room_baby_agents(agent_key);
create index if not exists war_room_baby_memories_agent_idx on public.war_room_baby_agent_memories(baby_agent_id, updated_at desc);
create index if not exists war_room_baby_memories_state_idx on public.war_room_baby_agent_memories(lesson_state, updated_at desc);
create index if not exists war_room_baby_training_agent_idx on public.war_room_baby_agent_training_events(baby_agent_id, created_at desc);
create index if not exists war_room_baby_training_source_idx on public.war_room_baby_agent_training_events(source_type, created_at desc);
create index if not exists war_room_baby_skill_agent_idx on public.war_room_baby_agent_skill_growth(baby_agent_id, updated_at desc);
create index if not exists war_room_baby_outcomes_agent_idx on public.war_room_baby_agent_outcomes(baby_agent_id, created_at desc);
create index if not exists war_room_baby_outcomes_validated_idx on public.war_room_baby_agent_outcomes(validated, created_at desc);

alter table public.war_room_baby_agents enable row level security;
alter table public.war_room_baby_agent_memories enable row level security;
alter table public.war_room_baby_agent_training_events enable row level security;
alter table public.war_room_baby_agent_skill_growth enable row level security;
alter table public.war_room_baby_agent_outcomes enable row level security;

revoke all on table public.war_room_baby_agents from anon, authenticated;
revoke all on table public.war_room_baby_agent_memories from anon, authenticated;
revoke all on table public.war_room_baby_agent_training_events from anon, authenticated;
revoke all on table public.war_room_baby_agent_skill_growth from anon, authenticated;
revoke all on table public.war_room_baby_agent_outcomes from anon, authenticated;

drop policy if exists war_room_baby_agents_service_role_all on public.war_room_baby_agents;
create policy war_room_baby_agents_service_role_all on public.war_room_baby_agents for all to service_role using (true) with check (true);
drop policy if exists war_room_baby_memories_service_role_all on public.war_room_baby_agent_memories;
create policy war_room_baby_memories_service_role_all on public.war_room_baby_agent_memories for all to service_role using (true) with check (true);
drop policy if exists war_room_baby_training_service_role_all on public.war_room_baby_agent_training_events;
create policy war_room_baby_training_service_role_all on public.war_room_baby_agent_training_events for all to service_role using (true) with check (true);
drop policy if exists war_room_baby_skill_growth_service_role_all on public.war_room_baby_agent_skill_growth;
create policy war_room_baby_skill_growth_service_role_all on public.war_room_baby_agent_skill_growth for all to service_role using (true) with check (true);
drop policy if exists war_room_baby_outcomes_service_role_all on public.war_room_baby_agent_outcomes;
create policy war_room_baby_outcomes_service_role_all on public.war_room_baby_agent_outcomes for all to service_role using (true) with check (true);

grant select, insert, update, delete on table public.war_room_baby_agents to service_role;
grant select, insert, update, delete on table public.war_room_baby_agent_memories to service_role;
grant select, insert, update, delete on table public.war_room_baby_agent_training_events to service_role;
grant select, insert, update, delete on table public.war_room_baby_agent_skill_growth to service_role;
grant select, insert, update, delete on table public.war_room_baby_agent_outcomes to service_role;

select pg_notify('pgrst', 'reload schema');`

export const SIGNAL_REPAIR_SQL = `-- War Room Signal Radar repair packet.
-- Advisory only: paste into Supabase SQL editor after review. War Room will not execute this from the browser.
grant usage on schema public to service_role;

create table if not exists public.war_room_signal_sources (
  id text primary key,
  label text not null,
  provider text not null,
  kind text not null,
  categories text[] not null default '{}'::text[],
  url text,
  query text,
  configured boolean not null default false,
  reliability_score numeric not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.war_room_signal_scans (
  id text primary key,
  status text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  source_count integer not null default 0,
  result_count integer not null default 0,
  provider_diagnostics jsonb not null default '{}'::jsonb,
  error text,
  approval_required boolean not null default true,
  external_execution_performed boolean not null default false,
  hidden_execution_performed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.war_room_signal_results (
  id text primary key,
  scan_id text references public.war_room_signal_scans(id) on delete set null,
  title text not null,
  source text not null,
  provider text not null,
  source_kind text not null,
  url text not null,
  summary text not null,
  category text not null,
  relevance_score numeric not null default 0,
  income_potential_score numeric not null default 0,
  urgency_score numeric not null default 0,
  confidence_score numeric not null default 0,
  startup_cost_score numeric not null default 0,
  time_to_profit_score numeric not null default 0,
  repeatability_score numeric not null default 0,
  strategic_alignment_score numeric not null default 0,
  family_impact_score numeric not null default 0,
  highest_leverage_score numeric not null default 0,
  startup_cost_estimate text not null default 'unknown',
  time_to_profit_estimate text not null default 'unknown',
  recommended_next_action text not null,
  assigned_baby_family text not null,
  approval_status text not null default 'pending_review',
  captured_at timestamptz not null default now(),
  source_backed boolean not null default true,
  recommendation_only boolean not null default true,
  approval_required boolean not null default true,
  external_execution_allowed boolean not null default false,
  hidden_execution_allowed boolean not null default false,
  income_claimed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.war_room_signal_scores (
  id uuid primary key default gen_random_uuid(),
  result_id text references public.war_room_signal_results(id) on delete cascade,
  scan_id text references public.war_room_signal_scans(id) on delete set null,
  category text not null,
  relevance_score numeric not null default 0,
  income_potential_score numeric not null default 0,
  urgency_score numeric not null default 0,
  confidence_score numeric not null default 0,
  startup_cost_score numeric not null default 0,
  time_to_profit_score numeric not null default 0,
  repeatability_score numeric not null default 0,
  strategic_alignment_score numeric not null default 0,
  family_impact_score numeric not null default 0,
  highest_leverage_score numeric not null default 0,
  rationale text not null default '',
  approval_required boolean not null default true,
  can_execute boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.war_room_signal_alerts (
  id uuid primary key default gen_random_uuid(),
  scan_id text references public.war_room_signal_scans(id) on delete set null,
  severity text not null,
  title text not null,
  summary text not null,
  source_attribution text not null default '',
  approval_required boolean not null default true,
  can_execute boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists war_room_signal_sources_provider_idx on public.war_room_signal_sources(provider, configured);
create index if not exists war_room_signal_scans_completed_idx on public.war_room_signal_scans(completed_at desc, status);
create index if not exists war_room_signal_results_leverage_idx on public.war_room_signal_results(highest_leverage_score desc, approval_status, captured_at desc);
create index if not exists war_room_signal_results_category_idx on public.war_room_signal_results(category, captured_at desc);
create index if not exists war_room_signal_scores_result_idx on public.war_room_signal_scores(result_id, created_at desc);
create index if not exists war_room_signal_alerts_scan_idx on public.war_room_signal_alerts(scan_id, created_at desc);

alter table public.war_room_signal_sources enable row level security;
alter table public.war_room_signal_scans enable row level security;
alter table public.war_room_signal_results enable row level security;
alter table public.war_room_signal_scores enable row level security;
alter table public.war_room_signal_alerts enable row level security;

revoke all on table public.war_room_signal_sources from anon, authenticated;
revoke all on table public.war_room_signal_scans from anon, authenticated;
revoke all on table public.war_room_signal_results from anon, authenticated;
revoke all on table public.war_room_signal_scores from anon, authenticated;
revoke all on table public.war_room_signal_alerts from anon, authenticated;

drop policy if exists war_room_signal_sources_service_role_all on public.war_room_signal_sources;
create policy war_room_signal_sources_service_role_all on public.war_room_signal_sources for all to service_role using (true) with check (true);
drop policy if exists war_room_signal_scans_service_role_all on public.war_room_signal_scans;
create policy war_room_signal_scans_service_role_all on public.war_room_signal_scans for all to service_role using (true) with check (approval_required is true and external_execution_performed is false and hidden_execution_performed is false);
drop policy if exists war_room_signal_results_service_role_all on public.war_room_signal_results;
create policy war_room_signal_results_service_role_all on public.war_room_signal_results for all to service_role using (true) with check (source_backed is true and recommendation_only is true and approval_required is true and external_execution_allowed is false and hidden_execution_allowed is false and income_claimed is false);
drop policy if exists war_room_signal_scores_service_role_all on public.war_room_signal_scores;
create policy war_room_signal_scores_service_role_all on public.war_room_signal_scores for all to service_role using (true) with check (approval_required is true and can_execute is false);
drop policy if exists war_room_signal_alerts_service_role_all on public.war_room_signal_alerts;
create policy war_room_signal_alerts_service_role_all on public.war_room_signal_alerts for all to service_role using (true) with check (approval_required is true and can_execute is false);

grant select, insert, update, delete on table public.war_room_signal_sources to service_role;
grant select, insert, update, delete on table public.war_room_signal_scans to service_role;
grant select, insert, update, delete on table public.war_room_signal_results to service_role;
grant select, insert, update, delete on table public.war_room_signal_scores to service_role;
grant select, insert, update, delete on table public.war_room_signal_alerts to service_role;

select pg_notify('pgrst', 'reload schema');`
