-- War Room Phase 16: Commander Operating System + Personal Leverage Engine.
-- Additive only. Stores explicit Commander profile context and derived,
-- recommendation-only leverage, review, pattern, metric, and trajectory rows.
-- No public writes, hidden actions, autonomous spending, external execution,
-- fake income claims, or medical/psychological diagnosis claims are allowed.

grant usage on schema public to service_role;

create table if not exists public.war_room_commander_profile (
  id text primary key default 'commander',
  active_goals text[] not null default '{}'::text[],
  unfinished_initiatives text[] not null default '{}'::text[],
  recurring_bottlenecks text[] not null default '{}'::text[],
  strongest_leverage_zones text[] not null default '{}'::text[],
  distraction_patterns text[] not null default '{}'::text[],
  best_execution_windows text[] not null default '{}'::text[],
  best_workflows text[] not null default '{}'::text[],
  stress_load_score numeric not null default 50,
  family_impact_score numeric not null default 70,
  notes text not null default '',
  approval_required boolean not null default true,
  can_execute boolean not null default false,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_commander_profile_singleton_check check (id = 'commander'),
  constraint war_room_commander_profile_score_bounds check (
    stress_load_score between 0 and 100
    and family_impact_score between 0 and 100
  ),
  constraint war_room_commander_profile_evidence_check check (jsonb_typeof(evidence) = 'object'),
  constraint war_room_commander_profile_approval_check check (approval_required is true),
  constraint war_room_commander_profile_no_execute_check check (can_execute is false)
);

create table if not exists public.war_room_commander_metrics (
  id text primary key,
  leverage_score numeric not null default 0,
  execution_score numeric not null default 0,
  focus_stability numeric not null default 0,
  momentum_score numeric not null default 0,
  compounding_score numeric not null default 0,
  burnout_risk numeric not null default 0,
  strategic_alignment numeric not null default 0,
  opportunity_responsiveness numeric not null default 0,
  time_to_action_hours numeric,
  income_per_hour_estimate numeric,
  roi_trend text not null default 'unknown',
  trajectory_direction text not null default 'unknown',
  source_summary jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  approval_required boolean not null default true,
  can_execute boolean not null default false,
  created_at timestamptz not null default now(),
  constraint war_room_commander_metrics_score_bounds check (
    leverage_score between 0 and 100
    and execution_score between 0 and 100
    and focus_stability between 0 and 100
    and momentum_score between 0 and 100
    and compounding_score between 0 and 100
    and burnout_risk between 0 and 100
    and strategic_alignment between 0 and 100
    and opportunity_responsiveness between 0 and 100
  ),
  constraint war_room_commander_metrics_nonnegative_check check (
    (time_to_action_hours is null or time_to_action_hours >= 0)
    and (income_per_hour_estimate is null or income_per_hour_estimate >= 0)
  ),
  constraint war_room_commander_metrics_roi_trend_check check (roi_trend in ('unknown','up','flat','down')),
  constraint war_room_commander_metrics_direction_check check (trajectory_direction in ('unknown','advancing','holding','drifting','overloaded')),
  constraint war_room_commander_metrics_source_summary_check check (jsonb_typeof(source_summary) = 'object'),
  constraint war_room_commander_metrics_evidence_check check (jsonb_typeof(evidence) = 'object'),
  constraint war_room_commander_metrics_approval_check check (approval_required is true),
  constraint war_room_commander_metrics_no_execute_check check (can_execute is false)
);

create table if not exists public.war_room_commander_patterns (
  id text primary key,
  kind text not null,
  title text not null,
  summary text not null,
  score numeric not null default 0,
  severity text not null default 'info',
  source text not null default 'derived',
  evidence text[] not null default '{}'::text[],
  generated_at timestamptz not null default now(),
  approval_required boolean not null default true,
  can_execute boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_commander_patterns_kind_check check (
    kind in (
      'leverage_zone',
      'distraction',
      'bottleneck',
      'compounding_win',
      'repeated_failure',
      'best_workflow',
      'best_execution_window',
      'burnout_load'
    )
  ),
  constraint war_room_commander_patterns_severity_check check (severity in ('info','watch','important','critical')),
  constraint war_room_commander_patterns_source_check check (
    source in ('outcome_ledger','revenue_engine','signal_radar','growth_calendar','baby_ai','commander_profile','derived')
  ),
  constraint war_room_commander_patterns_score_check check (score between 0 and 100),
  constraint war_room_commander_patterns_approval_check check (approval_required is true),
  constraint war_room_commander_patterns_no_execute_check check (can_execute is false)
);

create table if not exists public.war_room_commander_reviews (
  id text primary key,
  period text not null,
  summary text not null,
  advanced_position text[] not null default '{}'::text[],
  wasted_time text[] not null default '{}'::text[],
  strongest_opportunities text[] not null default '{}'::text[],
  highest_roi_actions text[] not null default '{}'::text[],
  compounding_behaviors text[] not null default '{}'::text[],
  repeated_mistakes text[] not null default '{}'::text[],
  next_strategic_focus text not null default '',
  approval_required boolean not null default true,
  can_execute boolean not null default false,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint war_room_commander_reviews_period_check check (period in ('daily','weekly','monthly')),
  constraint war_room_commander_reviews_evidence_check check (jsonb_typeof(evidence) = 'object'),
  constraint war_room_commander_reviews_approval_check check (approval_required is true),
  constraint war_room_commander_reviews_no_execute_check check (can_execute is false)
);

create table if not exists public.war_room_commander_trajectory (
  id text primary key,
  period text not null,
  direction text not null default 'unknown',
  leverage_score numeric not null default 0,
  execution_score numeric not null default 0,
  momentum_score numeric not null default 0,
  income_per_hour_estimate numeric,
  summary text not null,
  approval_required boolean not null default true,
  can_execute boolean not null default false,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint war_room_commander_trajectory_period_check check (period in ('daily','weekly','monthly')),
  constraint war_room_commander_trajectory_direction_check check (direction in ('unknown','advancing','holding','drifting','overloaded')),
  constraint war_room_commander_trajectory_score_bounds check (
    leverage_score between 0 and 100
    and execution_score between 0 and 100
    and momentum_score between 0 and 100
  ),
  constraint war_room_commander_trajectory_income_nonnegative_check check (income_per_hour_estimate is null or income_per_hour_estimate >= 0),
  constraint war_room_commander_trajectory_evidence_check check (jsonb_typeof(evidence) = 'object'),
  constraint war_room_commander_trajectory_approval_check check (approval_required is true),
  constraint war_room_commander_trajectory_no_execute_check check (can_execute is false)
);

create index if not exists war_room_commander_metrics_generated_idx
  on public.war_room_commander_metrics(generated_at desc);
create index if not exists war_room_commander_patterns_kind_idx
  on public.war_room_commander_patterns(kind, score desc, updated_at desc);
create index if not exists war_room_commander_reviews_period_idx
  on public.war_room_commander_reviews(period, created_at desc);
create index if not exists war_room_commander_trajectory_period_idx
  on public.war_room_commander_trajectory(period, created_at desc);

create or replace function public.touch_war_room_commander_os_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_commander_profile_set_updated_at on public.war_room_commander_profile;
create trigger war_room_commander_profile_set_updated_at
  before update on public.war_room_commander_profile
  for each row
  execute procedure public.touch_war_room_commander_os_updated_at();

drop trigger if exists war_room_commander_patterns_set_updated_at on public.war_room_commander_patterns;
create trigger war_room_commander_patterns_set_updated_at
  before update on public.war_room_commander_patterns
  for each row
  execute procedure public.touch_war_room_commander_os_updated_at();

alter table public.war_room_commander_profile enable row level security;
alter table public.war_room_commander_metrics enable row level security;
alter table public.war_room_commander_patterns enable row level security;
alter table public.war_room_commander_reviews enable row level security;
alter table public.war_room_commander_trajectory enable row level security;

revoke all on table public.war_room_commander_profile from anon, authenticated;
revoke all on table public.war_room_commander_metrics from anon, authenticated;
revoke all on table public.war_room_commander_patterns from anon, authenticated;
revoke all on table public.war_room_commander_reviews from anon, authenticated;
revoke all on table public.war_room_commander_trajectory from anon, authenticated;

drop policy if exists war_room_commander_profile_service_role_all on public.war_room_commander_profile;
create policy war_room_commander_profile_service_role_all on public.war_room_commander_profile
  for all
  to service_role
  using (true)
  with check (id = 'commander' and approval_required is true and can_execute is false);

drop policy if exists war_room_commander_metrics_service_role_all on public.war_room_commander_metrics;
create policy war_room_commander_metrics_service_role_all on public.war_room_commander_metrics
  for all
  to service_role
  using (true)
  with check (approval_required is true and can_execute is false);

drop policy if exists war_room_commander_patterns_service_role_all on public.war_room_commander_patterns;
create policy war_room_commander_patterns_service_role_all on public.war_room_commander_patterns
  for all
  to service_role
  using (true)
  with check (approval_required is true and can_execute is false);

drop policy if exists war_room_commander_reviews_service_role_all on public.war_room_commander_reviews;
create policy war_room_commander_reviews_service_role_all on public.war_room_commander_reviews
  for all
  to service_role
  using (true)
  with check (approval_required is true and can_execute is false);

drop policy if exists war_room_commander_trajectory_service_role_all on public.war_room_commander_trajectory;
create policy war_room_commander_trajectory_service_role_all on public.war_room_commander_trajectory
  for all
  to service_role
  using (true)
  with check (approval_required is true and can_execute is false);

grant select, insert, update, delete on table public.war_room_commander_profile to service_role;
grant select, insert, update, delete on table public.war_room_commander_metrics to service_role;
grant select, insert, update, delete on table public.war_room_commander_patterns to service_role;
grant select, insert, update, delete on table public.war_room_commander_reviews to service_role;
grant select, insert, update, delete on table public.war_room_commander_trajectory to service_role;
