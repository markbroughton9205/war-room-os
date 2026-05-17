-- War Room Phase 10B: automation modes and bounded execution domains.
-- Additive only. These tables persist planning, readiness, simulation, audit, throttle, rollback, and escalation state.
-- No public policies are created; service_role owns persistence access. No table grants autonomous execution authority.

grant usage on schema public to service_role;

create table if not exists public.war_room_automation_modes (
  id uuid primary key default gen_random_uuid(),
  mode_key text not null unique,
  label text not null,
  summary text not null,
  behavior text not null,
  commander_approval_required boolean not null default true,
  execution_allowed boolean not null default false,
  recurring_allowed boolean not null default false,
  isolated_domain_required boolean not null default false,
  rollback_plan_required boolean not null default false,
  throttle_required boolean not null default false,
  max_risk text not null default 'minimal',
  safeguards jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_automation_modes_key_check check (
    mode_key in ('manual','assisted','approval_checkpoint','bounded_auto','full_auto_domain')
  ),
  constraint war_room_automation_modes_risk_check check (
    max_risk in ('minimal','low','moderate','elevated')
  ),
  constraint war_room_automation_modes_commander_required_check check (commander_approval_required is true)
);

create table if not exists public.war_room_execution_domains (
  id uuid primary key default gen_random_uuid(),
  domain_key text not null unique,
  label text not null,
  purpose text not null,
  default_mode text not null,
  allowed_modes text[] not null default '{}'::text[],
  capabilities jsonb not null default '[]'::jsonb,
  restrictions jsonb not null default '[]'::jsonb,
  escalation_rules jsonb not null default '[]'::jsonb,
  rollback_behavior text not null,
  financial_limits jsonb not null default '{}'::jsonb,
  queue_scope text[] not null default '{}'::text[],
  risk_threshold text not null default 'moderate',
  memory_scope text[] not null default '{}'::text[],
  throttle_profile jsonb not null default '{}'::jsonb,
  commander_approval_required boolean not null default true,
  unrestricted_access_allowed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_execution_domains_key_check check (
    domain_key in (
      'research_domain','analysis_domain','lead_generation_domain','freight_monitoring_domain',
      'market_tracking_domain','financial_monitoring_domain','workflow_coordination_domain',
      'notification_domain','deployment_preparation_domain'
    )
  ),
  constraint war_room_execution_domains_default_mode_check check (
    default_mode in ('manual','assisted','approval_checkpoint','bounded_auto','full_auto_domain')
  ),
  constraint war_room_execution_domains_risk_check check (
    risk_threshold in ('low','moderate','elevated','high')
  ),
  constraint war_room_execution_domains_commander_required_check check (commander_approval_required is true),
  constraint war_room_execution_domains_no_unrestricted_access_check check (unrestricted_access_allowed is false)
);

create table if not exists public.war_room_execution_checkpoints (
  id uuid primary key default gen_random_uuid(),
  domain_key text not null,
  mode_key text not null,
  decision text not null default 'needs_review',
  doctrine_validation boolean not null default false,
  queue_validation boolean not null default false,
  risk_score integer not null default 0,
  memory_scope_check boolean not null default false,
  permission_validation boolean not null default false,
  financial_boundary_validation boolean not null default false,
  contradiction_scan boolean not null default false,
  red_team_scan boolean not null default false,
  confidence_score numeric(5,2) not null default 0,
  blockers jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  commander_approval_required boolean not null default true,
  actual_execution_allowed boolean not null default false,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_execution_checkpoints_decision_check check (
    decision in ('approved','blocked','needs_review','degraded','rollback_required')
  ),
  constraint war_room_execution_checkpoints_score_check check (risk_score between 0 and 100),
  constraint war_room_execution_checkpoints_confidence_check check (confidence_score between 0 and 1),
  constraint war_room_execution_checkpoints_commander_required_check check (commander_approval_required is true),
  constraint war_room_execution_checkpoints_no_execution_check check (actual_execution_allowed is false)
);

create table if not exists public.war_room_execution_simulations (
  id uuid primary key default gen_random_uuid(),
  domain_key text not null,
  mode_key text not null,
  expected_gain text not null,
  expected_risk text not null,
  unknowns jsonb not null default '[]'::jsonb,
  contradictions jsonb not null default '[]'::jsonb,
  dependencies jsonb not null default '[]'::jsonb,
  degradation_potential text not null default 'moderate',
  rollback_complexity text not null default 'low',
  confidence_score numeric(5,2) not null default 0,
  real_execution_performed boolean not null default false,
  simulated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_execution_simulations_degradation_check check (
    degradation_potential in ('low','moderate','high')
  ),
  constraint war_room_execution_simulations_rollback_check check (
    rollback_complexity in ('none','low','moderate','high')
  ),
  constraint war_room_execution_simulations_confidence_check check (confidence_score between 0 and 1),
  constraint war_room_execution_simulations_no_real_execution_check check (real_execution_performed is false)
);

create table if not exists public.war_room_execution_audits (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null,
  domain_key text not null,
  mode_key text,
  event_type text not null,
  severity text not null default 'info',
  summary text not null,
  request_payload jsonb not null default '{}'::jsonb,
  checkpoint_snapshot jsonb not null default '{}'::jsonb,
  approval_snapshot jsonb not null default '{}'::jsonb,
  rollback_snapshot jsonb not null default '{}'::jsonb,
  escalation_snapshot jsonb not null default '{}'::jsonb,
  throttle_snapshot jsonb not null default '{}'::jsonb,
  simulation_snapshot jsonb not null default '{}'::jsonb,
  reconstructable boolean not null default true,
  actual_execution_performed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_execution_audits_event_type_check check (
    event_type in (
      'mode_assigned','domain_registered','simulation_recorded','checkpoint_evaluated',
      'policy_decided','throttle_evaluated','rollback_planned','escalation_planned',
      'approval_recorded','request_recorded','rollback_required'
    )
  ),
  constraint war_room_execution_audits_severity_check check (
    severity in ('info','watch','warning','critical')
  ),
  constraint war_room_execution_audits_reconstructable_check check (reconstructable is true),
  constraint war_room_execution_audits_no_real_execution_check check (actual_execution_performed is false)
);

create table if not exists public.war_room_execution_throttles (
  id uuid primary key default gen_random_uuid(),
  domain_key text not null,
  mode_key text not null,
  throttle_state text not null default 'open',
  queue_pressure text not null default 'normal',
  max_concurrent integer not null default 1,
  cooldown_minutes integer not null default 0,
  max_retries integer not null default 1,
  degradation_triggers jsonb not null default '[]'::jsonb,
  pause_reasons jsonb not null default '[]'::jsonb,
  emergency_shutdown boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_execution_throttles_state_check check (
    throttle_state in ('open','limited','cooldown','paused','emergency_shutdown')
  ),
  constraint war_room_execution_throttles_pressure_check check (
    queue_pressure in ('normal','watch','high','paused')
  ),
  constraint war_room_execution_throttles_concurrency_check check (max_concurrent between 0 and 10),
  constraint war_room_execution_throttles_retry_check check (max_retries between 0 and 5)
);

create table if not exists public.war_room_financial_guardrails (
  id uuid primary key default gen_random_uuid(),
  domain_key text not null unique,
  spend_ceiling_usd numeric(12,2) not null default 0,
  recurring_limit_usd numeric(12,2) not null default 0,
  domain_budget_usd numeric(12,2) not null default 0,
  execution_frequency_per_hour integer not null default 0,
  minimum_profit_risk_ratio numeric(8,2) not null default 1,
  maximum_rollback_cost_usd numeric(12,2) not null default 0,
  minimum_confidence_score numeric(5,2) not null default 0,
  uncontrolled_spending_allowed boolean not null default false,
  repeated_failed_execution_allowed boolean not null default false,
  domain_escalation_leaks_allowed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_financial_guardrails_nonnegative_check check (
    spend_ceiling_usd >= 0 and recurring_limit_usd >= 0 and domain_budget_usd >= 0 and maximum_rollback_cost_usd >= 0
  ),
  constraint war_room_financial_guardrails_frequency_check check (execution_frequency_per_hour between 0 and 24),
  constraint war_room_financial_guardrails_confidence_check check (minimum_confidence_score between 0 and 1),
  constraint war_room_financial_guardrails_no_uncontrolled_spend_check check (uncontrolled_spending_allowed is false),
  constraint war_room_financial_guardrails_no_repeated_failure_check check (repeated_failed_execution_allowed is false),
  constraint war_room_financial_guardrails_no_domain_leak_check check (domain_escalation_leaks_allowed is false)
);

create table if not exists public.war_room_rollback_plans (
  id uuid primary key default gen_random_uuid(),
  domain_key text not null,
  mode_key text not null,
  required boolean not null default true,
  complexity text not null default 'low',
  estimated_cost_usd numeric(12,2) not null default 0,
  steps jsonb not null default '[]'::jsonb,
  commander_review_required boolean not null default true,
  rollback_ready boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_rollback_plans_complexity_check check (
    complexity in ('none','low','moderate','high')
  ),
  constraint war_room_rollback_plans_cost_check check (estimated_cost_usd >= 0),
  constraint war_room_rollback_plans_commander_required_check check (commander_review_required is true)
);

create table if not exists public.war_room_automation_escalations (
  id uuid primary key default gen_random_uuid(),
  domain_key text not null,
  mode_key text not null,
  escalation_status text not null default 'watch',
  reasons jsonb not null default '[]'::jsonb,
  family_roles jsonb not null default '{}'::jsonb,
  commander_review_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_automation_escalations_status_check check (
    escalation_status in ('none','watch','commander_review','red_team_required')
  ),
  constraint war_room_automation_escalations_commander_required_check check (commander_review_required is true)
);

create table if not exists public.war_room_execution_readiness (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null unique,
  domain_key text not null,
  mode_key text not null,
  readiness_state text not null default 'draft',
  policy_status text not null default 'allowed_for_planning',
  checkpoint_decision text not null default 'needs_review',
  throttle_state text not null default 'open',
  rollback_ready boolean not null default false,
  escalation_status text not null default 'watch',
  foundry_assignment_snapshot jsonb not null default '{}'::jsonb,
  commander_authority_required boolean not null default true,
  actual_execution_active boolean not null default false,
  revocable boolean not null default true,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_execution_readiness_state_check check (
    readiness_state in ('draft','ready_for_commander_review','blocked','degraded','paused')
  ),
  constraint war_room_execution_readiness_policy_check check (
    policy_status in ('allowed_for_planning','blocked','commander_review_required')
  ),
  constraint war_room_execution_readiness_checkpoint_check check (
    checkpoint_decision in ('approved','blocked','needs_review','degraded','rollback_required')
  ),
  constraint war_room_execution_readiness_commander_required_check check (commander_authority_required is true),
  constraint war_room_execution_readiness_no_actual_execution_check check (actual_execution_active is false),
  constraint war_room_execution_readiness_revocable_check check (revocable is true)
);

create index if not exists war_room_automation_modes_key_idx
  on public.war_room_automation_modes (mode_key, active);
create index if not exists war_room_execution_domains_key_idx
  on public.war_room_execution_domains (domain_key, default_mode);
create index if not exists war_room_execution_checkpoints_domain_idx
  on public.war_room_execution_checkpoints (domain_key, decision, evaluated_at desc);
create index if not exists war_room_execution_simulations_domain_idx
  on public.war_room_execution_simulations (domain_key, simulated_at desc);
create index if not exists war_room_execution_audits_plan_idx
  on public.war_room_execution_audits (plan_key, event_type, created_at desc);
create index if not exists war_room_execution_throttles_domain_idx
  on public.war_room_execution_throttles (domain_key, throttle_state, updated_at desc);
create index if not exists war_room_financial_guardrails_domain_idx
  on public.war_room_financial_guardrails (domain_key);
create index if not exists war_room_rollback_plans_domain_idx
  on public.war_room_rollback_plans (domain_key, complexity, updated_at desc);
create index if not exists war_room_automation_escalations_domain_idx
  on public.war_room_automation_escalations (domain_key, escalation_status, updated_at desc);
create index if not exists war_room_execution_readiness_state_idx
  on public.war_room_execution_readiness (readiness_state, evaluated_at desc);

create or replace function public.touch_war_room_phase10b_automation_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_automation_modes_set_updated_at on public.war_room_automation_modes;
create trigger war_room_automation_modes_set_updated_at
  before update on public.war_room_automation_modes
  for each row execute procedure public.touch_war_room_phase10b_automation_updated_at();

drop trigger if exists war_room_execution_domains_set_updated_at on public.war_room_execution_domains;
create trigger war_room_execution_domains_set_updated_at
  before update on public.war_room_execution_domains
  for each row execute procedure public.touch_war_room_phase10b_automation_updated_at();

drop trigger if exists war_room_execution_checkpoints_set_updated_at on public.war_room_execution_checkpoints;
create trigger war_room_execution_checkpoints_set_updated_at
  before update on public.war_room_execution_checkpoints
  for each row execute procedure public.touch_war_room_phase10b_automation_updated_at();

drop trigger if exists war_room_execution_simulations_set_updated_at on public.war_room_execution_simulations;
create trigger war_room_execution_simulations_set_updated_at
  before update on public.war_room_execution_simulations
  for each row execute procedure public.touch_war_room_phase10b_automation_updated_at();

drop trigger if exists war_room_execution_audits_set_updated_at on public.war_room_execution_audits;
create trigger war_room_execution_audits_set_updated_at
  before update on public.war_room_execution_audits
  for each row execute procedure public.touch_war_room_phase10b_automation_updated_at();

drop trigger if exists war_room_execution_throttles_set_updated_at on public.war_room_execution_throttles;
create trigger war_room_execution_throttles_set_updated_at
  before update on public.war_room_execution_throttles
  for each row execute procedure public.touch_war_room_phase10b_automation_updated_at();

drop trigger if exists war_room_financial_guardrails_set_updated_at on public.war_room_financial_guardrails;
create trigger war_room_financial_guardrails_set_updated_at
  before update on public.war_room_financial_guardrails
  for each row execute procedure public.touch_war_room_phase10b_automation_updated_at();

drop trigger if exists war_room_rollback_plans_set_updated_at on public.war_room_rollback_plans;
create trigger war_room_rollback_plans_set_updated_at
  before update on public.war_room_rollback_plans
  for each row execute procedure public.touch_war_room_phase10b_automation_updated_at();

drop trigger if exists war_room_automation_escalations_set_updated_at on public.war_room_automation_escalations;
create trigger war_room_automation_escalations_set_updated_at
  before update on public.war_room_automation_escalations
  for each row execute procedure public.touch_war_room_phase10b_automation_updated_at();

drop trigger if exists war_room_execution_readiness_set_updated_at on public.war_room_execution_readiness;
create trigger war_room_execution_readiness_set_updated_at
  before update on public.war_room_execution_readiness
  for each row execute procedure public.touch_war_room_phase10b_automation_updated_at();

alter table public.war_room_automation_modes enable row level security;
alter table public.war_room_execution_domains enable row level security;
alter table public.war_room_execution_checkpoints enable row level security;
alter table public.war_room_execution_simulations enable row level security;
alter table public.war_room_execution_audits enable row level security;
alter table public.war_room_execution_throttles enable row level security;
alter table public.war_room_financial_guardrails enable row level security;
alter table public.war_room_rollback_plans enable row level security;
alter table public.war_room_automation_escalations enable row level security;
alter table public.war_room_execution_readiness enable row level security;

drop policy if exists war_room_automation_modes_service_role_all on public.war_room_automation_modes;
create policy war_room_automation_modes_service_role_all on public.war_room_automation_modes
  for all to service_role using (true) with check (true);

drop policy if exists war_room_execution_domains_service_role_all on public.war_room_execution_domains;
create policy war_room_execution_domains_service_role_all on public.war_room_execution_domains
  for all to service_role using (true) with check (true);

drop policy if exists war_room_execution_checkpoints_service_role_all on public.war_room_execution_checkpoints;
create policy war_room_execution_checkpoints_service_role_all on public.war_room_execution_checkpoints
  for all to service_role using (true) with check (true);

drop policy if exists war_room_execution_simulations_service_role_all on public.war_room_execution_simulations;
create policy war_room_execution_simulations_service_role_all on public.war_room_execution_simulations
  for all to service_role using (true) with check (true);

drop policy if exists war_room_execution_audits_service_role_all on public.war_room_execution_audits;
create policy war_room_execution_audits_service_role_all on public.war_room_execution_audits
  for all to service_role using (true) with check (true);

drop policy if exists war_room_execution_throttles_service_role_all on public.war_room_execution_throttles;
create policy war_room_execution_throttles_service_role_all on public.war_room_execution_throttles
  for all to service_role using (true) with check (true);

drop policy if exists war_room_financial_guardrails_service_role_all on public.war_room_financial_guardrails;
create policy war_room_financial_guardrails_service_role_all on public.war_room_financial_guardrails
  for all to service_role using (true) with check (true);

drop policy if exists war_room_rollback_plans_service_role_all on public.war_room_rollback_plans;
create policy war_room_rollback_plans_service_role_all on public.war_room_rollback_plans
  for all to service_role using (true) with check (true);

drop policy if exists war_room_automation_escalations_service_role_all on public.war_room_automation_escalations;
create policy war_room_automation_escalations_service_role_all on public.war_room_automation_escalations
  for all to service_role using (true) with check (true);

drop policy if exists war_room_execution_readiness_service_role_all on public.war_room_execution_readiness;
create policy war_room_execution_readiness_service_role_all on public.war_room_execution_readiness
  for all to service_role using (true) with check (true);

grant select, insert, update, delete on table public.war_room_automation_modes to service_role;
grant select, insert, update, delete on table public.war_room_execution_domains to service_role;
grant select, insert, update, delete on table public.war_room_execution_checkpoints to service_role;
grant select, insert, update, delete on table public.war_room_execution_simulations to service_role;
grant select, insert, update, delete on table public.war_room_execution_audits to service_role;
grant select, insert, update, delete on table public.war_room_execution_throttles to service_role;
grant select, insert, update, delete on table public.war_room_financial_guardrails to service_role;
grant select, insert, update, delete on table public.war_room_rollback_plans to service_role;
grant select, insert, update, delete on table public.war_room_automation_escalations to service_role;
grant select, insert, update, delete on table public.war_room_execution_readiness to service_role;

select pg_notify('pgrst', 'reload schema');
