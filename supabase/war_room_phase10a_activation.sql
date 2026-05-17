-- War Room Phase 10A: governed agent activation workflow and operational worker launch preparation.
-- Additive only. Service-role APIs may read/write; no anon/browser policies are created.
-- These tables prepare activation and queue state only; they do not launch workers or mutate external systems.

grant usage on schema public to service_role;

create table if not exists public.war_room_agent_activation_queue (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.war_room_agents(id) on delete set null,
  agent_key text not null,
  activation_stage text not null default 'proposed',
  requested_by text not null default 'system',
  approval_state text not null default 'pending',
  requested_payload jsonb not null default '{}'::jsonb,
  governance_snapshot jsonb not null default '{}'::jsonb,
  readiness_snapshot jsonb not null default '{}'::jsonb,
  external_execution_allowed boolean not null default false,
  commander_approval_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_agent_activation_queue_stage_check check (
    activation_stage in ('proposed','blueprint_review','governance_review','memory_binding','queue_assignment','readiness_validation','commander_approval','active')
  ),
  constraint war_room_agent_activation_queue_approval_check check (
    approval_state in ('pending','approved','denied','blocked')
  ),
  constraint war_room_agent_activation_queue_no_external_execution_check check (external_execution_allowed is false),
  constraint war_room_agent_activation_queue_commander_required_check check (commander_approval_required is true),
  constraint war_room_agent_activation_queue_active_gate_check check (
    activation_stage <> 'active' or approval_state = 'approved'
  )
);

create table if not exists public.war_room_agent_memory_bindings (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.war_room_agents(id) on delete cascade,
  agent_key text not null,
  memory_domains text[] not null default '{}'::text[],
  doctrine_inheritance text[] not null default '{}'::text[],
  approved_operational_context jsonb not null default '[]'::jsonb,
  queue_specific_memory text[] not null default '{}'::text[],
  restrictions jsonb not null default '[]'::jsonb,
  leakage_controls jsonb not null default '[]'::jsonb,
  binding_state text not null default 'proposed',
  approved_by text,
  approved_at timestamptz,
  unrestricted_memory_access_allowed boolean not null default false,
  strategic_access_allowed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_agent_memory_bindings_unique unique (agent_key, binding_state),
  constraint war_room_agent_memory_bindings_state_check check (
    binding_state in ('proposed','approved','revoked','blocked')
  ),
  constraint war_room_agent_memory_bindings_no_unrestricted_check check (unrestricted_memory_access_allowed is false),
  constraint war_room_agent_memory_bindings_no_strategic_check check (strategic_access_allowed is false),
  constraint war_room_agent_memory_bindings_approval_gate_check check (
    binding_state <> 'approved' or (approved_by is not null and approved_at is not null)
  )
);

create table if not exists public.war_room_agent_queue_assignments (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.war_room_agents(id) on delete cascade,
  agent_key text not null,
  queue_key text not null,
  queue_type text not null,
  task_scope text[] not null default '{}'::text[],
  concurrency_limit integer not null default 1,
  escalation_rules jsonb not null default '[]'::jsonb,
  retry_policy jsonb not null default '{}'::jsonb,
  degradation_thresholds jsonb not null default '{}'::jsonb,
  assignment_state text not null default 'proposed',
  approval_bound boolean not null default true,
  monitorable boolean not null default true,
  auditable boolean not null default true,
  external_execution_allowed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_agent_queue_assignments_unique unique (queue_key),
  constraint war_room_agent_queue_assignments_type_check check (
    queue_type in ('monitoring','retrieval','analytics','local_intelligence','opportunity_tracking','forecasting','repair_monitoring','provider_health','workflow_coordination','governance_review')
  ),
  constraint war_room_agent_queue_assignments_state_check check (
    assignment_state in ('proposed','approved','paused','blocked','retired')
  ),
  constraint war_room_agent_queue_assignments_concurrency_check check (concurrency_limit between 1 and 5),
  constraint war_room_agent_queue_assignments_approval_bound_check check (approval_bound is true),
  constraint war_room_agent_queue_assignments_monitorable_check check (monitorable is true),
  constraint war_room_agent_queue_assignments_auditable_check check (auditable is true),
  constraint war_room_agent_queue_assignments_no_external_execution_check check (external_execution_allowed is false)
);

create table if not exists public.war_room_agent_readiness (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.war_room_agents(id) on delete cascade,
  agent_key text not null,
  readiness_score integer not null default 0,
  readiness_state text not null default 'blocked',
  missing_dependencies jsonb not null default '[]'::jsonb,
  degraded_prerequisites jsonb not null default '[]'::jsonb,
  activation_blockers jsonb not null default '[]'::jsonb,
  operational_warnings jsonb not null default '[]'::jsonb,
  stale_doctrine boolean not null default false,
  queue_pressure text not null default 'normal',
  unresolved_governance_issues jsonb not null default '[]'::jsonb,
  can_request_commander_approval boolean not null default false,
  can_prepare_worker_launch boolean not null default false,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_agent_readiness_score_check check (readiness_score between 0 and 100),
  constraint war_room_agent_readiness_state_check check (
    readiness_state in ('ready_for_commander_review','blocked','degraded_prerequisites','awaiting_persistence')
  ),
  constraint war_room_agent_readiness_queue_pressure_check check (
    queue_pressure in ('normal','watch','high')
  ),
  constraint war_room_agent_readiness_launch_gate_check check (
    can_prepare_worker_launch is false or can_request_commander_approval is true
  )
);

create table if not exists public.war_room_agent_activation_audit (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.war_room_agents(id) on delete set null,
  agent_key text,
  event_type text not null,
  severity text not null default 'info',
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  external_execution_allowed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_agent_activation_audit_event_type_check check (
    event_type in ('activation_proposed','governance_review','memory_binding','queue_assignment','readiness_failure','readiness_passed','commander_approval','activation_denial','lifecycle_transition')
  ),
  constraint war_room_agent_activation_audit_severity_check check (
    severity in ('info','watch','warning','critical')
  ),
  constraint war_room_agent_activation_audit_no_external_execution_check check (external_execution_allowed is false)
);

create table if not exists public.war_room_agent_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.war_room_agents(id) on delete set null,
  agent_key text not null,
  from_stage text,
  to_stage text not null,
  allowed boolean not null default false,
  requires_audit boolean not null default true,
  requires_doctrine_validation boolean not null default true,
  requires_commander_approval boolean not null default true,
  summary text not null,
  approval_id uuid references public.war_room_agent_approvals(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_agent_lifecycle_events_from_stage_check check (
    from_stage is null or from_stage in ('proposed','blueprint_review','governance_review','memory_binding','queue_assignment','readiness_validation','commander_approval','active')
  ),
  constraint war_room_agent_lifecycle_events_to_stage_check check (
    to_stage in ('proposed','blueprint_review','governance_review','memory_binding','queue_assignment','readiness_validation','commander_approval','active')
  ),
  constraint war_room_agent_lifecycle_events_audit_required_check check (requires_audit is true),
  constraint war_room_agent_lifecycle_events_doctrine_required_check check (requires_doctrine_validation is true),
  constraint war_room_agent_lifecycle_events_active_approval_check check (
    to_stage <> 'active' or requires_commander_approval is true
  )
);

create index if not exists war_room_agent_activation_queue_stage_idx
  on public.war_room_agent_activation_queue (activation_stage, approval_state, updated_at desc);
create index if not exists war_room_agent_memory_bindings_agent_idx
  on public.war_room_agent_memory_bindings (agent_key, binding_state, updated_at desc);
create index if not exists war_room_agent_queue_assignments_queue_idx
  on public.war_room_agent_queue_assignments (queue_type, assignment_state, updated_at desc);
create index if not exists war_room_agent_readiness_state_idx
  on public.war_room_agent_readiness (readiness_state, readiness_score desc, evaluated_at desc);
create index if not exists war_room_agent_activation_audit_agent_idx
  on public.war_room_agent_activation_audit (agent_key, severity, created_at desc);
create index if not exists war_room_agent_lifecycle_events_agent_idx
  on public.war_room_agent_lifecycle_events (agent_key, to_stage, created_at desc);

create or replace function public.touch_war_room_phase10a_activation_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_agent_activation_queue_set_updated_at on public.war_room_agent_activation_queue;
create trigger war_room_agent_activation_queue_set_updated_at
  before update on public.war_room_agent_activation_queue
  for each row execute procedure public.touch_war_room_phase10a_activation_updated_at();

drop trigger if exists war_room_agent_memory_bindings_set_updated_at on public.war_room_agent_memory_bindings;
create trigger war_room_agent_memory_bindings_set_updated_at
  before update on public.war_room_agent_memory_bindings
  for each row execute procedure public.touch_war_room_phase10a_activation_updated_at();

drop trigger if exists war_room_agent_queue_assignments_set_updated_at on public.war_room_agent_queue_assignments;
create trigger war_room_agent_queue_assignments_set_updated_at
  before update on public.war_room_agent_queue_assignments
  for each row execute procedure public.touch_war_room_phase10a_activation_updated_at();

drop trigger if exists war_room_agent_readiness_set_updated_at on public.war_room_agent_readiness;
create trigger war_room_agent_readiness_set_updated_at
  before update on public.war_room_agent_readiness
  for each row execute procedure public.touch_war_room_phase10a_activation_updated_at();

drop trigger if exists war_room_agent_activation_audit_set_updated_at on public.war_room_agent_activation_audit;
create trigger war_room_agent_activation_audit_set_updated_at
  before update on public.war_room_agent_activation_audit
  for each row execute procedure public.touch_war_room_phase10a_activation_updated_at();

drop trigger if exists war_room_agent_lifecycle_events_set_updated_at on public.war_room_agent_lifecycle_events;
create trigger war_room_agent_lifecycle_events_set_updated_at
  before update on public.war_room_agent_lifecycle_events
  for each row execute procedure public.touch_war_room_phase10a_activation_updated_at();

alter table public.war_room_agent_activation_queue enable row level security;
alter table public.war_room_agent_memory_bindings enable row level security;
alter table public.war_room_agent_queue_assignments enable row level security;
alter table public.war_room_agent_readiness enable row level security;
alter table public.war_room_agent_activation_audit enable row level security;
alter table public.war_room_agent_lifecycle_events enable row level security;

drop policy if exists war_room_agent_activation_queue_service_role_all on public.war_room_agent_activation_queue;
create policy war_room_agent_activation_queue_service_role_all on public.war_room_agent_activation_queue
  for all to service_role using (true) with check (true);

drop policy if exists war_room_agent_memory_bindings_service_role_all on public.war_room_agent_memory_bindings;
create policy war_room_agent_memory_bindings_service_role_all on public.war_room_agent_memory_bindings
  for all to service_role using (true) with check (true);

drop policy if exists war_room_agent_queue_assignments_service_role_all on public.war_room_agent_queue_assignments;
create policy war_room_agent_queue_assignments_service_role_all on public.war_room_agent_queue_assignments
  for all to service_role using (true) with check (true);

drop policy if exists war_room_agent_readiness_service_role_all on public.war_room_agent_readiness;
create policy war_room_agent_readiness_service_role_all on public.war_room_agent_readiness
  for all to service_role using (true) with check (true);

drop policy if exists war_room_agent_activation_audit_service_role_all on public.war_room_agent_activation_audit;
create policy war_room_agent_activation_audit_service_role_all on public.war_room_agent_activation_audit
  for all to service_role using (true) with check (true);

drop policy if exists war_room_agent_lifecycle_events_service_role_all on public.war_room_agent_lifecycle_events;
create policy war_room_agent_lifecycle_events_service_role_all on public.war_room_agent_lifecycle_events
  for all to service_role using (true) with check (true);

grant select, insert, update, delete on table public.war_room_agent_activation_queue to service_role;
grant select, insert, update, delete on table public.war_room_agent_memory_bindings to service_role;
grant select, insert, update, delete on table public.war_room_agent_queue_assignments to service_role;
grant select, insert, update, delete on table public.war_room_agent_readiness to service_role;
grant select, insert, update, delete on table public.war_room_agent_activation_audit to service_role;
grant select, insert, update, delete on table public.war_room_agent_lifecycle_events to service_role;

select pg_notify('pgrst', 'reload schema');
