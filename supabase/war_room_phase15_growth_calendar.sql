-- War Room Phase 15: Council-Governed Growth Calendar.
-- Additive only. Stores internal strategic time recommendations, Commander-
-- approved planned events, reviews, and outcomes. This grants no external
-- calendar writes, hidden scheduling, outreach, fake automation, background
-- execution, or public write path.

grant usage on schema public to service_role;

create table if not exists public.war_room_growth_calendar_recommendations (
  id text primary key,
  title text not null,
  event_type text not null,
  status text not null default 'proposed',
  source text not null default 'calendar_seed',
  source_id text,
  description text not null default '',
  leverage_score numeric not null default 0,
  urgency_score numeric not null default 0,
  income_potential_score numeric not null default 0,
  energy_cost_score numeric not null default 0,
  family_impact_score numeric not null default 0,
  deadline_pressure_score numeric not null default 0,
  compounding_value_score numeric not null default 0,
  score_json jsonb not null default '{}'::jsonb,
  recommended_duration_minutes integer not null default 60,
  recommended_time_window text not null default 'Commander-selected window',
  assigned_family text not null,
  reason text not null default '',
  approval_required boolean not null default true,
  can_schedule_externally boolean not null default false,
  hidden_scheduling_allowed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_growth_calendar_recommendations_event_type_check check (
    event_type in (
      'income_action',
      'feature_build_session',
      'opportunity_follow_up',
      'skill_training',
      'business_development',
      'freight_logistics_outreach',
      'ai_automation_research',
      'family_personal_recovery',
      'war_room_maintenance',
      'council_review',
      'outcome_review',
      'strategic_planning',
      'deep_work_block'
    )
  ),
  constraint war_room_growth_calendar_recommendations_status_check check (
    status in ('proposed','approved','converted_to_event','rejected','archived')
  ),
  constraint war_room_growth_calendar_recommendations_source_check check (
    source in ('revenue_engine','signal_radar','baby_daily_briefing','feature_builder','approval_queue','outcome_ledger','calendar_seed')
  ),
  constraint war_room_growth_calendar_recommendations_family_check check (
    assigned_family in (
      'chatgpt-family-baby',
      'claude-family-baby',
      'grok-family-baby',
      'kimi-family-baby',
      'red-team-baby',
      'bridge-architect-baby',
      'analyst-baby',
      'income-operations-baby'
    )
  ),
  constraint war_room_growth_calendar_recommendations_score_bounds check (
    leverage_score between 0 and 100
    and urgency_score between 0 and 100
    and income_potential_score between 0 and 100
    and energy_cost_score between 0 and 100
    and family_impact_score between 0 and 100
    and deadline_pressure_score between 0 and 100
    and compounding_value_score between 0 and 100
  ),
  constraint war_room_growth_calendar_recommendations_duration_check check (
    recommended_duration_minutes between 15 and 240
  ),
  constraint war_room_growth_calendar_recommendations_score_json_check check (jsonb_typeof(score_json) = 'object'),
  constraint war_room_growth_calendar_recommendations_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint war_room_growth_calendar_recommendations_approval_required_check check (approval_required is true),
  constraint war_room_growth_calendar_recommendations_no_external_calendar_check check (can_schedule_externally is false),
  constraint war_room_growth_calendar_recommendations_no_hidden_scheduling_check check (hidden_scheduling_allowed is false)
);

create table if not exists public.war_room_growth_calendar_events (
  id text primary key,
  recommendation_id text references public.war_room_growth_calendar_recommendations(id) on delete set null,
  title text not null,
  event_type text not null,
  status text not null default 'planned',
  planned_start timestamptz,
  planned_end timestamptz,
  duration_minutes integer not null default 60,
  approved_by_commander boolean not null default false,
  external_calendar_write boolean not null default false,
  hidden_scheduling_performed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_growth_calendar_events_event_type_check check (
    event_type in (
      'income_action',
      'feature_build_session',
      'opportunity_follow_up',
      'skill_training',
      'business_development',
      'freight_logistics_outreach',
      'ai_automation_research',
      'family_personal_recovery',
      'war_room_maintenance',
      'council_review',
      'outcome_review',
      'strategic_planning',
      'deep_work_block'
    )
  ),
  constraint war_room_growth_calendar_events_status_check check (
    status in ('proposed','planned','completed','cancelled','rejected')
  ),
  constraint war_room_growth_calendar_events_duration_check check (duration_minutes between 15 and 240),
  constraint war_room_growth_calendar_events_planned_approval_check check (
    status <> 'planned' or approved_by_commander is true
  ),
  constraint war_room_growth_calendar_events_no_external_calendar_check check (external_calendar_write is false),
  constraint war_room_growth_calendar_events_no_hidden_scheduling_check check (hidden_scheduling_performed is false),
  constraint war_room_growth_calendar_events_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.war_room_growth_calendar_reviews (
  id uuid primary key default gen_random_uuid(),
  recommendation_id text references public.war_room_growth_calendar_recommendations(id) on delete set null,
  event_id text references public.war_room_growth_calendar_events(id) on delete set null,
  review_type text not null,
  summary text not null,
  assigned_family text not null,
  approval_required boolean not null default true,
  can_execute boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint war_room_growth_calendar_reviews_type_check check (
    review_type in ('council','overload','family_balance','outcome_prompt')
  ),
  constraint war_room_growth_calendar_reviews_family_check check (
    assigned_family in (
      'chatgpt-family-baby',
      'claude-family-baby',
      'grok-family-baby',
      'kimi-family-baby',
      'red-team-baby',
      'bridge-architect-baby',
      'analyst-baby',
      'income-operations-baby'
    )
  ),
  constraint war_room_growth_calendar_reviews_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint war_room_growth_calendar_reviews_approval_check check (approval_required is true),
  constraint war_room_growth_calendar_reviews_no_execute_check check (can_execute is false)
);

create table if not exists public.war_room_growth_calendar_outcomes (
  id uuid primary key default gen_random_uuid(),
  event_id text references public.war_room_growth_calendar_events(id) on delete set null,
  recommendation_id text references public.war_room_growth_calendar_recommendations(id) on delete set null,
  outcome_type text not null,
  summary text not null,
  validated boolean not null default false,
  evidence jsonb not null default '{}'::jsonb,
  external_execution_performed boolean not null default false,
  hidden_scheduling_performed boolean not null default false,
  external_calendar_write boolean not null default false,
  created_at timestamptz not null default now(),
  constraint war_room_growth_calendar_outcomes_type_check check (
    outcome_type in ('completed','missed','rescheduled','overloaded','useful','low_roi')
  ),
  constraint war_room_growth_calendar_outcomes_evidence_check check (jsonb_typeof(evidence) = 'object'),
  constraint war_room_growth_calendar_outcomes_no_external_execution_check check (external_execution_performed is false),
  constraint war_room_growth_calendar_outcomes_no_hidden_scheduling_check check (hidden_scheduling_performed is false),
  constraint war_room_growth_calendar_outcomes_no_external_calendar_check check (external_calendar_write is false)
);

create index if not exists war_room_growth_calendar_recommendations_leverage_idx
  on public.war_room_growth_calendar_recommendations(leverage_score desc, status, created_at desc);
create index if not exists war_room_growth_calendar_recommendations_source_idx
  on public.war_room_growth_calendar_recommendations(source, source_id, created_at desc);
create index if not exists war_room_growth_calendar_events_status_idx
  on public.war_room_growth_calendar_events(status, created_at desc);
create index if not exists war_room_growth_calendar_events_recommendation_idx
  on public.war_room_growth_calendar_events(recommendation_id, created_at desc);
create index if not exists war_room_growth_calendar_reviews_event_idx
  on public.war_room_growth_calendar_reviews(event_id, created_at desc);
create index if not exists war_room_growth_calendar_outcomes_event_idx
  on public.war_room_growth_calendar_outcomes(event_id, created_at desc);

create or replace function public.touch_war_room_growth_calendar_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_growth_calendar_recommendations_set_updated_at on public.war_room_growth_calendar_recommendations;
create trigger war_room_growth_calendar_recommendations_set_updated_at
  before update on public.war_room_growth_calendar_recommendations
  for each row
  execute procedure public.touch_war_room_growth_calendar_updated_at();

drop trigger if exists war_room_growth_calendar_events_set_updated_at on public.war_room_growth_calendar_events;
create trigger war_room_growth_calendar_events_set_updated_at
  before update on public.war_room_growth_calendar_events
  for each row
  execute procedure public.touch_war_room_growth_calendar_updated_at();

alter table public.war_room_growth_calendar_recommendations enable row level security;
alter table public.war_room_growth_calendar_events enable row level security;
alter table public.war_room_growth_calendar_reviews enable row level security;
alter table public.war_room_growth_calendar_outcomes enable row level security;

revoke all on table public.war_room_growth_calendar_recommendations from anon, authenticated;
revoke all on table public.war_room_growth_calendar_events from anon, authenticated;
revoke all on table public.war_room_growth_calendar_reviews from anon, authenticated;
revoke all on table public.war_room_growth_calendar_outcomes from anon, authenticated;

drop policy if exists war_room_growth_calendar_recommendations_service_role_all on public.war_room_growth_calendar_recommendations;
create policy war_room_growth_calendar_recommendations_service_role_all on public.war_room_growth_calendar_recommendations
  for all
  to service_role
  using (true)
  with check (
    approval_required is true
    and can_schedule_externally is false
    and hidden_scheduling_allowed is false
  );

drop policy if exists war_room_growth_calendar_events_service_role_all on public.war_room_growth_calendar_events;
create policy war_room_growth_calendar_events_service_role_all on public.war_room_growth_calendar_events
  for all
  to service_role
  using (true)
  with check (
    external_calendar_write is false
    and hidden_scheduling_performed is false
    and (status <> 'planned' or approved_by_commander is true)
  );

drop policy if exists war_room_growth_calendar_reviews_service_role_all on public.war_room_growth_calendar_reviews;
create policy war_room_growth_calendar_reviews_service_role_all on public.war_room_growth_calendar_reviews
  for all
  to service_role
  using (true)
  with check (approval_required is true and can_execute is false);

drop policy if exists war_room_growth_calendar_outcomes_service_role_all on public.war_room_growth_calendar_outcomes;
create policy war_room_growth_calendar_outcomes_service_role_all on public.war_room_growth_calendar_outcomes
  for all
  to service_role
  using (true)
  with check (
    external_execution_performed is false
    and hidden_scheduling_performed is false
    and external_calendar_write is false
  );

grant select, insert, update, delete on table public.war_room_growth_calendar_recommendations to service_role;
grant select, insert, update, delete on table public.war_room_growth_calendar_events to service_role;
grant select, insert, update, delete on table public.war_room_growth_calendar_reviews to service_role;
grant select, insert, update, delete on table public.war_room_growth_calendar_outcomes to service_role;
