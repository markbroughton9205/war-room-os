-- War Room Phase 13: Revenue Engine and leverage scoring.
-- Additive only. Stores estimated revenue opportunities, outcomes,
-- leverage scores, and execution patterns. This grants no hidden execution,
-- external outreach, filesystem mutation, shell access, deployment control,
-- autonomous dispatch, or public write path.

grant usage on schema public to service_role;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'war_room_revenue_category') then
    create type public.war_room_revenue_category as enum (
      'freight',
      'sprinter_van_routes',
      'local_delivery',
      'smb_automation',
      'ai_operations',
      'call_center_customer_operations',
      'scheduling_intake_systems',
      'ai_tooling',
      'consulting',
      'agency_services',
      'app_factory_ideas',
      'data_annotation_evaluation',
      'operational_dashboards'
    );
  end if;
end $$;

create table if not exists public.war_room_revenue_opportunities (
  id text primary key,
  title text not null,
  category public.war_room_revenue_category not null,
  status text not null default 'watching',
  source text not null default 'Commander-entered revenue engine note',
  notes text not null default '',
  estimated_revenue numeric,
  estimated_time_hours numeric,
  startup_cost_usd numeric,
  regional_signal text,
  shipper_pain_point text,
  smb_pain_point text,
  next_review_action text not null,
  leverage_score numeric not null default 0,
  confidence_score numeric not null default 0,
  urgency_score numeric not null default 0,
  startup_cost_score numeric not null default 0,
  scalability_score numeric not null default 0,
  automation_potential_score numeric not null default 0,
  repeatability_score numeric not null default 0,
  time_to_profit_score numeric not null default 0,
  strategic_alignment_score numeric not null default 0,
  stress_load_score numeric not null default 0,
  family_impact_score numeric not null default 0,
  long_term_compounding_score numeric not null default 0,
  priority_rank integer not null default 0,
  family_impact_estimate text not null default 'neutral',
  score_json jsonb not null default '{}'::jsonb,
  required_review_actions text[] not null default '{}'::text[],
  recommendation_only boolean not null default true,
  approval_required boolean not null default true,
  external_execution_performed boolean not null default false,
  hidden_execution_performed boolean not null default false,
  income_claimed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_revenue_opportunities_status_check check (
    status in ('watching','researching','ready_for_review','approved_to_execute','in_progress','won','lost','paused','archived')
  ),
  constraint war_room_revenue_opportunities_score_bounds check (
    leverage_score between 0 and 100
    and confidence_score between 0 and 100
    and urgency_score between 0 and 100
    and startup_cost_score between 0 and 100
    and scalability_score between 0 and 100
    and automation_potential_score between 0 and 100
    and repeatability_score between 0 and 100
    and time_to_profit_score between 0 and 100
    and strategic_alignment_score between 0 and 100
    and stress_load_score between 0 and 100
    and family_impact_score between 0 and 100
    and long_term_compounding_score between 0 and 100
  ),
  constraint war_room_revenue_opportunities_family_impact_check check (
    family_impact_estimate in ('positive','neutral','watch','high_stress')
  ),
  constraint war_room_revenue_opportunities_score_json_check check (jsonb_typeof(score_json) = 'object'),
  constraint war_room_revenue_opportunities_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint war_room_revenue_opportunities_recommendation_only_check check (recommendation_only is true),
  constraint war_room_revenue_opportunities_approval_required_check check (approval_required is true),
  constraint war_room_revenue_opportunities_no_external_execution_check check (external_execution_performed is false),
  constraint war_room_revenue_opportunities_no_hidden_execution_check check (hidden_execution_performed is false),
  constraint war_room_revenue_opportunities_no_income_claim_check check (income_claimed is false)
);

create table if not exists public.war_room_revenue_outcomes (
  id uuid primary key default gen_random_uuid(),
  opportunity_id text references public.war_room_revenue_opportunities(id) on delete set null,
  outcome_type text not null,
  summary text not null,
  estimated_roi numeric,
  actual_revenue_amount numeric,
  time_spent_hours numeric,
  validated boolean not null default false,
  evidence jsonb not null default '{}'::jsonb,
  income_claimed_by_war_room boolean not null default false,
  external_execution_performed boolean not null default false,
  hidden_execution_performed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint war_room_revenue_outcomes_type_check check (
    outcome_type in ('successful','failed','time_wasted','profitable_workflow','repeatable_pattern','low_roi_distraction','blocked')
  ),
  constraint war_room_revenue_outcomes_evidence_check check (jsonb_typeof(evidence) = 'object'),
  constraint war_room_revenue_outcomes_no_income_claim_check check (income_claimed_by_war_room is false),
  constraint war_room_revenue_outcomes_no_external_execution_check check (external_execution_performed is false),
  constraint war_room_revenue_outcomes_no_hidden_execution_check check (hidden_execution_performed is false)
);

create table if not exists public.war_room_leverage_scores (
  id uuid primary key default gen_random_uuid(),
  opportunity_id text references public.war_room_revenue_opportunities(id) on delete cascade,
  category public.war_room_revenue_category not null,
  leverage_score numeric not null default 0,
  confidence_score numeric not null default 0,
  urgency_score numeric not null default 0,
  startup_cost_score numeric not null default 0,
  scalability_score numeric not null default 0,
  automation_potential_score numeric not null default 0,
  repeatability_score numeric not null default 0,
  time_to_profit_score numeric not null default 0,
  strategic_alignment_score numeric not null default 0,
  stress_load_score numeric not null default 0,
  family_impact_score numeric not null default 0,
  long_term_compounding_score numeric not null default 0,
  score_json jsonb not null default '{}'::jsonb,
  rationale text not null default '',
  approval_required boolean not null default true,
  can_execute boolean not null default false,
  created_at timestamptz not null default now(),
  constraint war_room_leverage_scores_bounds check (
    leverage_score between 0 and 100
    and confidence_score between 0 and 100
    and urgency_score between 0 and 100
    and startup_cost_score between 0 and 100
    and scalability_score between 0 and 100
    and automation_potential_score between 0 and 100
    and repeatability_score between 0 and 100
    and time_to_profit_score between 0 and 100
    and strategic_alignment_score between 0 and 100
    and stress_load_score between 0 and 100
    and family_impact_score between 0 and 100
    and long_term_compounding_score between 0 and 100
  ),
  constraint war_room_leverage_scores_json_check check (jsonb_typeof(score_json) = 'object'),
  constraint war_room_leverage_scores_approval_check check (approval_required is true),
  constraint war_room_leverage_scores_no_execute_check check (can_execute is false)
);

create table if not exists public.war_room_execution_patterns (
  id uuid primary key default gen_random_uuid(),
  category public.war_room_revenue_category not null,
  pattern_type text not null,
  title text not null,
  summary text not null,
  confidence numeric not null default 0,
  approval_required boolean not null default true,
  can_execute boolean not null default false,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_execution_patterns_type_check check (
    pattern_type in ('profitable_repeat','bottleneck','low_roi','compounding_asset','family_stress_risk')
  ),
  constraint war_room_execution_patterns_confidence_check check (confidence between 0 and 1),
  constraint war_room_execution_patterns_evidence_check check (jsonb_typeof(evidence) = 'object'),
  constraint war_room_execution_patterns_approval_check check (approval_required is true),
  constraint war_room_execution_patterns_no_execute_check check (can_execute is false)
);

create index if not exists war_room_revenue_opportunities_priority_idx
  on public.war_room_revenue_opportunities(leverage_score desc, status, created_at desc);
create index if not exists war_room_revenue_opportunities_category_idx
  on public.war_room_revenue_opportunities(category, created_at desc);
create index if not exists war_room_revenue_outcomes_opportunity_idx
  on public.war_room_revenue_outcomes(opportunity_id, created_at desc);
create index if not exists war_room_leverage_scores_opportunity_idx
  on public.war_room_leverage_scores(opportunity_id, created_at desc);
create index if not exists war_room_execution_patterns_category_idx
  on public.war_room_execution_patterns(category, pattern_type, created_at desc);

create or replace function public.touch_war_room_revenue_engine_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_revenue_opportunities_set_updated_at on public.war_room_revenue_opportunities;
create trigger war_room_revenue_opportunities_set_updated_at
  before update on public.war_room_revenue_opportunities
  for each row
  execute procedure public.touch_war_room_revenue_engine_updated_at();

drop trigger if exists war_room_execution_patterns_set_updated_at on public.war_room_execution_patterns;
create trigger war_room_execution_patterns_set_updated_at
  before update on public.war_room_execution_patterns
  for each row
  execute procedure public.touch_war_room_revenue_engine_updated_at();

alter table public.war_room_revenue_opportunities enable row level security;
alter table public.war_room_revenue_outcomes enable row level security;
alter table public.war_room_leverage_scores enable row level security;
alter table public.war_room_execution_patterns enable row level security;

revoke all on table public.war_room_revenue_opportunities from anon, authenticated;
revoke all on table public.war_room_revenue_outcomes from anon, authenticated;
revoke all on table public.war_room_leverage_scores from anon, authenticated;
revoke all on table public.war_room_execution_patterns from anon, authenticated;

drop policy if exists war_room_revenue_opportunities_service_role_all on public.war_room_revenue_opportunities;
create policy war_room_revenue_opportunities_service_role_all on public.war_room_revenue_opportunities
  for all
  to service_role
  using (true)
  with check (
    recommendation_only is true
    and approval_required is true
    and external_execution_performed is false
    and hidden_execution_performed is false
    and income_claimed is false
  );

drop policy if exists war_room_revenue_outcomes_service_role_all on public.war_room_revenue_outcomes;
create policy war_room_revenue_outcomes_service_role_all on public.war_room_revenue_outcomes
  for all
  to service_role
  using (true)
  with check (
    income_claimed_by_war_room is false
    and external_execution_performed is false
    and hidden_execution_performed is false
  );

drop policy if exists war_room_leverage_scores_service_role_all on public.war_room_leverage_scores;
create policy war_room_leverage_scores_service_role_all on public.war_room_leverage_scores
  for all
  to service_role
  using (true)
  with check (approval_required is true and can_execute is false);

drop policy if exists war_room_execution_patterns_service_role_all on public.war_room_execution_patterns;
create policy war_room_execution_patterns_service_role_all on public.war_room_execution_patterns
  for all
  to service_role
  using (true)
  with check (approval_required is true and can_execute is false);

grant select, insert, update, delete on table public.war_room_revenue_opportunities to service_role;
grant select, insert, update, delete on table public.war_room_revenue_outcomes to service_role;
grant select, insert, update, delete on table public.war_room_leverage_scores to service_role;
grant select, insert, update, delete on table public.war_room_execution_patterns to service_role;

