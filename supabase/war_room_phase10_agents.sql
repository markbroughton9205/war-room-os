-- War Room Phase 10: Agent Foundry + long-lived worker ecosystem.
-- Additive only. Service-role APIs may read/write; no anon/browser policies are created.
-- No table in this migration dispatches notifications, executes agents, deploys, spends, or mutates external systems.

grant usage on schema public to service_role;

create table if not exists public.war_room_agents (
  id uuid primary key default gen_random_uuid(),
  agent_key text not null,
  display_name text not null,
  purpose text not null,
  lifecycle_state text not null default 'proposed',
  operational_role text not null,
  assigned_doctrine text[] not null default '{}'::text[],
  memory_scope text[] not null default '{}'::text[],
  capability_limits jsonb not null default '[]'::jsonb,
  risk_profile jsonb not null default '{}'::jsonb,
  performance_summary jsonb not null default '{}'::jsonb,
  approval_summary jsonb not null default '{}'::jsonb,
  activity_history jsonb not null default '[]'::jsonb,
  external_execution_allowed boolean not null default false,
  autonomous_self_expansion_allowed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  activated_at timestamptz,
  paused_at timestamptz,
  degraded_at timestamptz,
  retired_at timestamptz,
  constraint war_room_agents_agent_key_unique unique (agent_key),
  constraint war_room_agents_state_check check (
    lifecycle_state in ('proposed','approved','active','paused','degraded','retired')
  ),
  constraint war_room_agents_no_external_execution_check check (external_execution_allowed is false),
  constraint war_room_agents_no_self_expansion_check check (autonomous_self_expansion_allowed is false),
  constraint war_room_agents_approval_gate_check check (
    lifecycle_state not in ('approved','active')
    or (
      approved_at is not null
      and coalesce(approval_summary->>'approvedBy', '') <> ''
    )
  ),
  constraint war_room_agents_activation_gate_check check (
    lifecycle_state <> 'active'
    or (
      activated_at is not null
      and approved_at is not null
      and assigned_doctrine @> array['runtime-truth','approval-before-action']::text[]
    )
  )
);

create table if not exists public.war_room_agent_worker_queues (
  id uuid primary key default gen_random_uuid(),
  worker_key text not null,
  agent_id uuid references public.war_room_agents(id) on delete set null,
  queue_kind text not null,
  queue_state text not null default 'queued',
  priority integer not null default 5,
  payload jsonb not null default '{}'::jsonb,
  scoped_memory_domains text[] not null default '{}'::text[],
  external_execution_allowed boolean not null default false,
  approval_required boolean not null default true,
  locked_by text,
  locked_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_agent_worker_queues_state_check check (
    queue_state in ('queued','in_review','blocked','completed','archived')
  ),
  constraint war_room_agent_worker_queues_kind_check check (
    queue_kind in ('monitoring','retrieval','analytics','local_intelligence','opportunity_tracking','forecasting','repair_monitoring','provider_health','workflow_coordination','governance_review')
  ),
  constraint war_room_agent_worker_queues_priority_check check (priority between 1 and 10),
  constraint war_room_agent_worker_queues_no_external_execution_check check (external_execution_allowed is false),
  constraint war_room_agent_worker_queues_approval_required_check check (approval_required is true)
);

create table if not exists public.war_room_agent_lifecycle_states (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.war_room_agents(id) on delete cascade,
  previous_state text,
  next_state text not null,
  reason text not null,
  changed_by text not null default 'system',
  approval_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_agent_lifecycle_previous_check check (
    previous_state is null or previous_state in ('proposed','approved','active','paused','degraded','retired')
  ),
  constraint war_room_agent_lifecycle_next_check check (
    next_state in ('proposed','approved','active','paused','degraded','retired')
  )
);

create table if not exists public.war_room_agent_memory_scopes (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.war_room_agents(id) on delete cascade,
  memory_domain text not null,
  scope_state text not null default 'approved',
  source_table text,
  access_reason text not null,
  approved_by text,
  approved_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_agent_memory_scopes_unique unique (agent_id, memory_domain),
  constraint war_room_agent_memory_scopes_state_check check (
    scope_state in ('proposed','approved','paused','revoked')
  ),
  constraint war_room_agent_memory_scopes_domain_check check (
    memory_domain in ('local_intelligence','market_signals','freight_intelligence','repair_ledger','forecast_feedback','infrastructure_health','source_reliability','economic_opportunities','workflow_history','engineering_bridge','doctrine')
  ),
  constraint war_room_agent_memory_scopes_approval_check check (
    scope_state <> 'approved'
    or (approved_by is not null and approved_at is not null)
  )
);

create table if not exists public.war_room_agent_performance_history (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.war_room_agents(id) on delete cascade,
  accuracy numeric(4,3) not null default 0,
  usefulness numeric(4,3) not null default 0,
  contradiction_rate numeric(4,3) not null default 0,
  hallucination_indicators numeric(4,3) not null default 0,
  successful_forecasts integer not null default 0,
  operational_contribution numeric(4,3) not null default 0,
  latency_ms integer not null default 0,
  retrieval_quality numeric(4,3) not null default 0,
  approval_success_rate numeric(4,3) not null default 0,
  evidence jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  measured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_agent_performance_ratio_check check (
    accuracy between 0 and 1
    and usefulness between 0 and 1
    and contradiction_rate between 0 and 1
    and hallucination_indicators between 0 and 1
    and operational_contribution between 0 and 1
    and retrieval_quality between 0 and 1
    and approval_success_rate between 0 and 1
  ),
  constraint war_room_agent_performance_nonnegative_check check (
    successful_forecasts >= 0 and latency_ms >= 0
  )
);

create table if not exists public.war_room_agent_governance_events (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.war_room_agents(id) on delete set null,
  event_type text not null,
  severity text not null default 'info',
  summary text not null,
  doctrine_refs text[] not null default '{}'::text[],
  contradiction_refs text[] not null default '{}'::text[],
  requires_commander_review boolean not null default true,
  external_execution_allowed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_agent_governance_events_severity_check check (
    severity in ('info','watch','warning','critical')
  ),
  constraint war_room_agent_governance_events_no_external_execution_check check (external_execution_allowed is false)
);

create table if not exists public.war_room_agent_approvals (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.war_room_agents(id) on delete cascade,
  approval_kind text not null,
  decision text not null default 'pending',
  requested_by text not null default 'system',
  approved_by text,
  approval_note text,
  requested_payload jsonb not null default '{}'::jsonb,
  external_execution_allowed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint war_room_agent_approvals_kind_check check (
    approval_kind in ('activation','capability_expansion','memory_scope','retirement','degradation_recovery','worker_assignment')
  ),
  constraint war_room_agent_approvals_decision_check check (
    decision in ('pending','approved','rejected','cancelled')
  ),
  constraint war_room_agent_approvals_no_external_execution_check check (external_execution_allowed is false),
  constraint war_room_agent_approvals_decision_gate_check check (
    decision = 'pending'
    or (approved_by is not null and decided_at is not null)
  )
);

alter table public.war_room_agent_lifecycle_states
  drop constraint if exists war_room_agent_lifecycle_approval_fk;
alter table public.war_room_agent_lifecycle_states
  add constraint war_room_agent_lifecycle_approval_fk
  foreign key (approval_id) references public.war_room_agent_approvals(id) on delete set null;

create table if not exists public.war_room_agent_degradation_history (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.war_room_agents(id) on delete cascade,
  degradation_reason text not null,
  severity text not null default 'watch',
  scorecard_snapshot jsonb not null default '{}'::jsonb,
  recovery_plan text,
  recovery_state text not null default 'open',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint war_room_agent_degradation_severity_check check (
    severity in ('watch','warning','critical')
  ),
  constraint war_room_agent_degradation_recovery_state_check check (
    recovery_state in ('open','monitoring','resolved','retired')
  )
);

create index if not exists war_room_agents_state_idx
  on public.war_room_agents (lifecycle_state, updated_at desc);
create index if not exists war_room_agent_worker_queues_state_idx
  on public.war_room_agent_worker_queues (queue_state, priority, created_at desc);
create index if not exists war_room_agent_lifecycle_agent_idx
  on public.war_room_agent_lifecycle_states (agent_id, created_at desc);
create index if not exists war_room_agent_memory_scopes_agent_idx
  on public.war_room_agent_memory_scopes (agent_id, memory_domain);
create index if not exists war_room_agent_performance_agent_idx
  on public.war_room_agent_performance_history (agent_id, measured_at desc);
create index if not exists war_room_agent_governance_events_agent_idx
  on public.war_room_agent_governance_events (agent_id, severity, created_at desc);
create index if not exists war_room_agent_approvals_decision_idx
  on public.war_room_agent_approvals (decision, approval_kind, created_at desc);
create index if not exists war_room_agent_degradation_agent_idx
  on public.war_room_agent_degradation_history (agent_id, severity, created_at desc);

create or replace function public.touch_war_room_phase10_agents_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_agents_set_updated_at on public.war_room_agents;
create trigger war_room_agents_set_updated_at
  before update on public.war_room_agents
  for each row execute procedure public.touch_war_room_phase10_agents_updated_at();

drop trigger if exists war_room_agent_worker_queues_set_updated_at on public.war_room_agent_worker_queues;
create trigger war_room_agent_worker_queues_set_updated_at
  before update on public.war_room_agent_worker_queues
  for each row execute procedure public.touch_war_room_phase10_agents_updated_at();

drop trigger if exists war_room_agent_lifecycle_states_set_updated_at on public.war_room_agent_lifecycle_states;
create trigger war_room_agent_lifecycle_states_set_updated_at
  before update on public.war_room_agent_lifecycle_states
  for each row execute procedure public.touch_war_room_phase10_agents_updated_at();

drop trigger if exists war_room_agent_memory_scopes_set_updated_at on public.war_room_agent_memory_scopes;
create trigger war_room_agent_memory_scopes_set_updated_at
  before update on public.war_room_agent_memory_scopes
  for each row execute procedure public.touch_war_room_phase10_agents_updated_at();

drop trigger if exists war_room_agent_performance_history_set_updated_at on public.war_room_agent_performance_history;
create trigger war_room_agent_performance_history_set_updated_at
  before update on public.war_room_agent_performance_history
  for each row execute procedure public.touch_war_room_phase10_agents_updated_at();

drop trigger if exists war_room_agent_governance_events_set_updated_at on public.war_room_agent_governance_events;
create trigger war_room_agent_governance_events_set_updated_at
  before update on public.war_room_agent_governance_events
  for each row execute procedure public.touch_war_room_phase10_agents_updated_at();

drop trigger if exists war_room_agent_approvals_set_updated_at on public.war_room_agent_approvals;
create trigger war_room_agent_approvals_set_updated_at
  before update on public.war_room_agent_approvals
  for each row execute procedure public.touch_war_room_phase10_agents_updated_at();

drop trigger if exists war_room_agent_degradation_history_set_updated_at on public.war_room_agent_degradation_history;
create trigger war_room_agent_degradation_history_set_updated_at
  before update on public.war_room_agent_degradation_history
  for each row execute procedure public.touch_war_room_phase10_agents_updated_at();

alter table public.war_room_agents enable row level security;
alter table public.war_room_agent_worker_queues enable row level security;
alter table public.war_room_agent_lifecycle_states enable row level security;
alter table public.war_room_agent_memory_scopes enable row level security;
alter table public.war_room_agent_performance_history enable row level security;
alter table public.war_room_agent_governance_events enable row level security;
alter table public.war_room_agent_approvals enable row level security;
alter table public.war_room_agent_degradation_history enable row level security;

drop policy if exists war_room_agents_service_role_all on public.war_room_agents;
create policy war_room_agents_service_role_all on public.war_room_agents
  for all to service_role using (true) with check (true);

drop policy if exists war_room_agent_worker_queues_service_role_all on public.war_room_agent_worker_queues;
create policy war_room_agent_worker_queues_service_role_all on public.war_room_agent_worker_queues
  for all to service_role using (true) with check (true);

drop policy if exists war_room_agent_lifecycle_states_service_role_all on public.war_room_agent_lifecycle_states;
create policy war_room_agent_lifecycle_states_service_role_all on public.war_room_agent_lifecycle_states
  for all to service_role using (true) with check (true);

drop policy if exists war_room_agent_memory_scopes_service_role_all on public.war_room_agent_memory_scopes;
create policy war_room_agent_memory_scopes_service_role_all on public.war_room_agent_memory_scopes
  for all to service_role using (true) with check (true);

drop policy if exists war_room_agent_performance_history_service_role_all on public.war_room_agent_performance_history;
create policy war_room_agent_performance_history_service_role_all on public.war_room_agent_performance_history
  for all to service_role using (true) with check (true);

drop policy if exists war_room_agent_governance_events_service_role_all on public.war_room_agent_governance_events;
create policy war_room_agent_governance_events_service_role_all on public.war_room_agent_governance_events
  for all to service_role using (true) with check (true);

drop policy if exists war_room_agent_approvals_service_role_all on public.war_room_agent_approvals;
create policy war_room_agent_approvals_service_role_all on public.war_room_agent_approvals
  for all to service_role using (true) with check (true);

drop policy if exists war_room_agent_degradation_history_service_role_all on public.war_room_agent_degradation_history;
create policy war_room_agent_degradation_history_service_role_all on public.war_room_agent_degradation_history
  for all to service_role using (true) with check (true);

grant select, insert, update, delete on table public.war_room_agents to service_role;
grant select, insert, update, delete on table public.war_room_agent_worker_queues to service_role;
grant select, insert, update, delete on table public.war_room_agent_lifecycle_states to service_role;
grant select, insert, update, delete on table public.war_room_agent_memory_scopes to service_role;
grant select, insert, update, delete on table public.war_room_agent_performance_history to service_role;
grant select, insert, update, delete on table public.war_room_agent_governance_events to service_role;
grant select, insert, update, delete on table public.war_room_agent_approvals to service_role;
grant select, insert, update, delete on table public.war_room_agent_degradation_history to service_role;

select pg_notify('pgrst', 'reload schema');
