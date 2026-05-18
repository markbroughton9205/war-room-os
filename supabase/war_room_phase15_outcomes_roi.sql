-- War Room Phase 15: Outcome Ledger + Real-World ROI Learning.
-- Additive only. Stores explicit or source-backed outcomes, ROI reviews,
-- execution results, compounding patterns, failure patterns, and time-waste
-- patterns. This grants no public write path, hidden actions, autonomous
-- spending, external execution, fake AI success, or fake revenue claims.

grant usage on schema public to service_role;

create table if not exists public.war_room_outcomes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null,
  related_opportunity text,
  estimated_revenue numeric,
  actual_revenue numeric,
  time_invested_hours numeric,
  stress_load numeric not null default 50,
  leverage_score numeric not null default 50,
  repeatability_score numeric not null default 50,
  scalability_score numeric not null default 50,
  family_impact_score numeric not null default 50,
  execution_difficulty_score numeric not null default 50,
  result_status text not null,
  what_worked text not null default '',
  what_failed text not null default '',
  lessons_learned text not null default '',
  recommended_repeat_avoid text not null,
  linked_feature_project text,
  linked_baby_ai_family text,
  approval_status text not null default 'not_required',
  source_uri text,
  explicit_commander_log boolean not null default true,
  source_backed boolean not null default false,
  external_action_performed_by_war_room boolean not null default false,
  autonomous_spend_performed boolean not null default false,
  hidden_action_performed boolean not null default false,
  fake_revenue_claimed boolean not null default false,
  fake_ai_success_claimed boolean not null default false,
  evidence jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_outcomes_category_check check (
    category in (
      'freight',
      'sprinter_van',
      'SMB_automation',
      'AI_service',
      'consulting',
      'app_factory',
      'data_annotation',
      'AI_evaluation',
      'customer_operations',
      'lead_generation',
      'outreach',
      'learning',
      'infrastructure',
      'distraction',
      'overbuilding',
      'failed_experiment'
    )
  ),
  constraint war_room_outcomes_result_status_check check (
    result_status in ('profitable','break_even','loss','failed','time_wasted','shipped','not_shipped','abandoned','compounded','needs_review')
  ),
  constraint war_room_outcomes_repeat_avoid_check check (
    recommended_repeat_avoid in ('repeat','avoid','iterate','monitor')
  ),
  constraint war_room_outcomes_approval_status_check check (
    approval_status in ('not_required','pending','approved','rejected','completed')
  ),
  constraint war_room_outcomes_baby_family_check check (
    linked_baby_ai_family is null or linked_baby_ai_family in (
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
  constraint war_room_outcomes_score_bounds check (
    stress_load between 0 and 100
    and leverage_score between 0 and 100
    and repeatability_score between 0 and 100
    and scalability_score between 0 and 100
    and family_impact_score between 0 and 100
    and execution_difficulty_score between 0 and 100
  ),
  constraint war_room_outcomes_time_nonnegative_check check (time_invested_hours is null or time_invested_hours >= 0),
  constraint war_room_outcomes_estimated_revenue_nonnegative_check check (estimated_revenue is null or estimated_revenue >= 0),
  constraint war_room_outcomes_actual_revenue_nonnegative_check check (actual_revenue is null or actual_revenue >= 0),
  constraint war_room_outcomes_explicit_or_source_check check (explicit_commander_log is true or source_backed is true),
  constraint war_room_outcomes_evidence_check check (jsonb_typeof(evidence) = 'object'),
  constraint war_room_outcomes_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint war_room_outcomes_no_external_action_check check (external_action_performed_by_war_room is false),
  constraint war_room_outcomes_no_autonomous_spend_check check (autonomous_spend_performed is false),
  constraint war_room_outcomes_no_hidden_action_check check (hidden_action_performed is false),
  constraint war_room_outcomes_no_fake_revenue_check check (fake_revenue_claimed is false),
  constraint war_room_outcomes_no_fake_ai_success_check check (fake_ai_success_claimed is false)
);

create table if not exists public.war_room_roi_reviews (
  id text primary key,
  outcome_id uuid not null references public.war_room_outcomes(id) on delete cascade,
  reviewer text not null default 'system',
  review_summary text not null,
  confidence_before numeric,
  actual_result_score numeric,
  estimate_accuracy numeric,
  time_value_score numeric,
  distraction_score numeric,
  leverage_adjustment numeric not null default 0,
  recommended_priority_change text not null default 'hold',
  approval_required boolean not null default true,
  can_execute boolean not null default false,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint war_room_roi_reviews_reviewer_check check (
    reviewer in (
      'commander',
      'system',
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
  constraint war_room_roi_reviews_score_bounds check (
    (confidence_before is null or confidence_before between 0 and 100)
    and (actual_result_score is null or actual_result_score between 0 and 100)
    and (estimate_accuracy is null or estimate_accuracy between 0 and 100)
    and (time_value_score is null or time_value_score >= 0)
    and (distraction_score is null or distraction_score between 0 and 100)
  ),
  constraint war_room_roi_reviews_priority_check check (
    recommended_priority_change in ('increase','hold','decrease','deprioritize')
  ),
  constraint war_room_roi_reviews_evidence_check check (jsonb_typeof(evidence) = 'object'),
  constraint war_room_roi_reviews_approval_check check (approval_required is true),
  constraint war_room_roi_reviews_no_execute_check check (can_execute is false)
);

create table if not exists public.war_room_execution_results (
  id text primary key,
  outcome_id uuid not null references public.war_room_outcomes(id) on delete cascade,
  category text not null,
  shipped boolean not null default false,
  made_money boolean not null default false,
  wasted_time boolean not null default false,
  created_leverage boolean not null default false,
  compounded boolean not null default false,
  should_repeat boolean not null default false,
  should_avoid boolean not null default false,
  time_to_money_hours numeric,
  value_per_hour numeric,
  stress_adjusted_roi numeric,
  source_backed boolean not null default false,
  external_action_performed_by_war_room boolean not null default false,
  hidden_action_performed boolean not null default false,
  autonomous_spend_performed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint war_room_execution_results_category_check check (
    category in (
      'freight',
      'sprinter_van',
      'SMB_automation',
      'AI_service',
      'consulting',
      'app_factory',
      'data_annotation',
      'AI_evaluation',
      'customer_operations',
      'lead_generation',
      'outreach',
      'learning',
      'infrastructure',
      'distraction',
      'overbuilding',
      'failed_experiment'
    )
  ),
  constraint war_room_execution_results_time_check check (time_to_money_hours is null or time_to_money_hours >= 0),
  constraint war_room_execution_results_no_external_action_check check (external_action_performed_by_war_room is false),
  constraint war_room_execution_results_no_hidden_action_check check (hidden_action_performed is false),
  constraint war_room_execution_results_no_autonomous_spend_check check (autonomous_spend_performed is false)
);

create table if not exists public.war_room_compounding_patterns (
  id text primary key,
  category text not null,
  title text not null,
  summary text not null,
  recurrence_count integer not null default 0,
  average_actual_revenue numeric not null default 0,
  average_value_per_hour numeric,
  average_stress_load numeric not null default 0,
  confidence numeric not null default 0,
  recommendation text not null default 'study_more',
  approval_required boolean not null default true,
  can_execute boolean not null default false,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_compounding_patterns_category_check check (
    category in (
      'freight','sprinter_van','SMB_automation','AI_service','consulting','app_factory','data_annotation','AI_evaluation',
      'customer_operations','lead_generation','outreach','learning','infrastructure','distraction','overbuilding','failed_experiment'
    )
  ),
  constraint war_room_compounding_patterns_confidence_check check (confidence between 0 and 1),
  constraint war_room_compounding_patterns_recommendation_check check (recommendation in ('repeat','scale_carefully','study_more')),
  constraint war_room_compounding_patterns_evidence_check check (jsonb_typeof(evidence) = 'object'),
  constraint war_room_compounding_patterns_approval_check check (approval_required is true),
  constraint war_room_compounding_patterns_no_execute_check check (can_execute is false)
);

create table if not exists public.war_room_failure_patterns (
  id text primary key,
  category text not null,
  title text not null,
  summary text not null,
  recurrence_count integer not null default 0,
  estimated_revenue_miss numeric not null default 0,
  time_lost_hours numeric not null default 0,
  confidence numeric not null default 0,
  recommended_avoidance text not null default '',
  approval_required boolean not null default true,
  can_execute boolean not null default false,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_failure_patterns_category_check check (
    category in (
      'freight','sprinter_van','SMB_automation','AI_service','consulting','app_factory','data_annotation','AI_evaluation',
      'customer_operations','lead_generation','outreach','learning','infrastructure','distraction','overbuilding','failed_experiment'
    )
  ),
  constraint war_room_failure_patterns_confidence_check check (confidence between 0 and 1),
  constraint war_room_failure_patterns_evidence_check check (jsonb_typeof(evidence) = 'object'),
  constraint war_room_failure_patterns_approval_check check (approval_required is true),
  constraint war_room_failure_patterns_no_execute_check check (can_execute is false)
);

create table if not exists public.war_room_time_waste_patterns (
  id text primary key,
  category text not null,
  title text not null,
  summary text not null,
  recurrence_count integer not null default 0,
  time_lost_hours numeric not null default 0,
  distraction_score numeric not null default 0,
  priority_decay numeric not null default 0,
  approval_required boolean not null default true,
  can_execute boolean not null default false,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_time_waste_patterns_category_check check (
    category in (
      'freight','sprinter_van','SMB_automation','AI_service','consulting','app_factory','data_annotation','AI_evaluation',
      'customer_operations','lead_generation','outreach','learning','infrastructure','distraction','overbuilding','failed_experiment'
    )
  ),
  constraint war_room_time_waste_patterns_score_check check (
    distraction_score between 0 and 100 and priority_decay between 0 and 100
  ),
  constraint war_room_time_waste_patterns_evidence_check check (jsonb_typeof(evidence) = 'object'),
  constraint war_room_time_waste_patterns_approval_check check (approval_required is true),
  constraint war_room_time_waste_patterns_no_execute_check check (can_execute is false)
);

create index if not exists war_room_outcomes_category_idx
  on public.war_room_outcomes(category, created_at desc);
create index if not exists war_room_outcomes_result_idx
  on public.war_room_outcomes(result_status, recommended_repeat_avoid, created_at desc);
create index if not exists war_room_outcomes_roi_idx
  on public.war_room_outcomes(actual_revenue desc, time_invested_hours, created_at desc);
create index if not exists war_room_roi_reviews_outcome_idx
  on public.war_room_roi_reviews(outcome_id, created_at desc);
create index if not exists war_room_execution_results_outcome_idx
  on public.war_room_execution_results(outcome_id, created_at desc);
create index if not exists war_room_execution_results_category_idx
  on public.war_room_execution_results(category, made_money, wasted_time, created_at desc);
create index if not exists war_room_compounding_patterns_category_idx
  on public.war_room_compounding_patterns(category, confidence desc, updated_at desc);
create index if not exists war_room_failure_patterns_category_idx
  on public.war_room_failure_patterns(category, confidence desc, updated_at desc);
create index if not exists war_room_time_waste_patterns_category_idx
  on public.war_room_time_waste_patterns(category, distraction_score desc, updated_at desc);

create or replace function public.touch_war_room_outcomes_roi_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_outcomes_set_updated_at on public.war_room_outcomes;
create trigger war_room_outcomes_set_updated_at
  before update on public.war_room_outcomes
  for each row
  execute procedure public.touch_war_room_outcomes_roi_updated_at();

drop trigger if exists war_room_compounding_patterns_set_updated_at on public.war_room_compounding_patterns;
create trigger war_room_compounding_patterns_set_updated_at
  before update on public.war_room_compounding_patterns
  for each row
  execute procedure public.touch_war_room_outcomes_roi_updated_at();

drop trigger if exists war_room_failure_patterns_set_updated_at on public.war_room_failure_patterns;
create trigger war_room_failure_patterns_set_updated_at
  before update on public.war_room_failure_patterns
  for each row
  execute procedure public.touch_war_room_outcomes_roi_updated_at();

drop trigger if exists war_room_time_waste_patterns_set_updated_at on public.war_room_time_waste_patterns;
create trigger war_room_time_waste_patterns_set_updated_at
  before update on public.war_room_time_waste_patterns
  for each row
  execute procedure public.touch_war_room_outcomes_roi_updated_at();

alter table public.war_room_outcomes enable row level security;
alter table public.war_room_roi_reviews enable row level security;
alter table public.war_room_execution_results enable row level security;
alter table public.war_room_compounding_patterns enable row level security;
alter table public.war_room_failure_patterns enable row level security;
alter table public.war_room_time_waste_patterns enable row level security;

revoke all on table public.war_room_outcomes from anon, authenticated;
revoke all on table public.war_room_roi_reviews from anon, authenticated;
revoke all on table public.war_room_execution_results from anon, authenticated;
revoke all on table public.war_room_compounding_patterns from anon, authenticated;
revoke all on table public.war_room_failure_patterns from anon, authenticated;
revoke all on table public.war_room_time_waste_patterns from anon, authenticated;

drop policy if exists war_room_outcomes_service_role_all on public.war_room_outcomes;
create policy war_room_outcomes_service_role_all on public.war_room_outcomes
  for all
  to service_role
  using (true)
  with check (
    (explicit_commander_log is true or source_backed is true)
    and external_action_performed_by_war_room is false
    and autonomous_spend_performed is false
    and hidden_action_performed is false
    and fake_revenue_claimed is false
    and fake_ai_success_claimed is false
  );

drop policy if exists war_room_roi_reviews_service_role_all on public.war_room_roi_reviews;
create policy war_room_roi_reviews_service_role_all on public.war_room_roi_reviews
  for all
  to service_role
  using (true)
  with check (approval_required is true and can_execute is false);

drop policy if exists war_room_execution_results_service_role_all on public.war_room_execution_results;
create policy war_room_execution_results_service_role_all on public.war_room_execution_results
  for all
  to service_role
  using (true)
  with check (
    external_action_performed_by_war_room is false
    and hidden_action_performed is false
    and autonomous_spend_performed is false
  );

drop policy if exists war_room_compounding_patterns_service_role_all on public.war_room_compounding_patterns;
create policy war_room_compounding_patterns_service_role_all on public.war_room_compounding_patterns
  for all
  to service_role
  using (true)
  with check (approval_required is true and can_execute is false);

drop policy if exists war_room_failure_patterns_service_role_all on public.war_room_failure_patterns;
create policy war_room_failure_patterns_service_role_all on public.war_room_failure_patterns
  for all
  to service_role
  using (true)
  with check (approval_required is true and can_execute is false);

drop policy if exists war_room_time_waste_patterns_service_role_all on public.war_room_time_waste_patterns;
create policy war_room_time_waste_patterns_service_role_all on public.war_room_time_waste_patterns
  for all
  to service_role
  using (true)
  with check (approval_required is true and can_execute is false);

grant select, insert, update, delete on table public.war_room_outcomes to service_role;
grant select, insert, update, delete on table public.war_room_roi_reviews to service_role;
grant select, insert, update, delete on table public.war_room_execution_results to service_role;
grant select, insert, update, delete on table public.war_room_compounding_patterns to service_role;
grant select, insert, update, delete on table public.war_room_failure_patterns to service_role;
grant select, insert, update, delete on table public.war_room_time_waste_patterns to service_role;
