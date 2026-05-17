-- War Room Phase 10E: persistent Commander Node runtime telemetry.
-- Additive only. Service-role APIs persist runtime state; no bridge table grants shell, filesystem, deployment, or OS automation authority.

grant usage on schema public to service_role;

alter table if exists public.war_room_bridge_audit_logs
  drop constraint if exists war_room_bridge_audit_event_check;

alter table if exists public.war_room_bridge_audit_logs
  add constraint war_room_bridge_audit_event_check check (
    event_type in ('heartbeat','provider_change','model_swap','failure','reconnect','invoke_request','node_action','rejection','runtime_status')
  );

create table if not exists public.war_room_bridge_runtime_snapshots (
  id uuid primary key default gen_random_uuid(),
  node_id text not null,
  uptime_seconds integer not null default 0,
  reconnect_count integer not null default 0,
  heartbeat_latency_ms integer,
  memory_usage_mb numeric(10,2),
  active_provider text,
  active_model text,
  node_health text not null,
  provider_switch_count integer not null default 0,
  last_provider_switch_at timestamptz,
  supervisor_enabled boolean not null default false,
  supervisor_restart_count integer not null default 0,
  supervisor_last_restart_at timestamptz,
  supervisor_backoff_ms integer,
  supervisor_launch_mode text not null default 'manual',
  shell_execution_allowed boolean not null default false,
  filesystem_write_allowed boolean not null default false,
  deployment_control_allowed boolean not null default false,
  os_automation_allowed boolean not null default false,
  reported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint war_room_bridge_runtime_health_check check (
    node_health in ('online','degraded','reconnecting','disconnected','recovered')
  ),
  constraint war_room_bridge_runtime_provider_check check (
    active_provider is null or active_provider in ('lm_studio','ollama')
  ),
  constraint war_room_bridge_runtime_launch_mode_check check (
    supervisor_launch_mode in ('manual','supervised','task_scheduler')
  ),
  constraint war_room_bridge_runtime_no_shell_check check (shell_execution_allowed is false),
  constraint war_room_bridge_runtime_no_filesystem_check check (filesystem_write_allowed is false),
  constraint war_room_bridge_runtime_no_deploy_check check (deployment_control_allowed is false),
  constraint war_room_bridge_runtime_no_os_check check (os_automation_allowed is false)
);

create table if not exists public.war_room_bridge_status_history (
  id uuid primary key default gen_random_uuid(),
  node_id text not null,
  node_name text not null,
  status text not null,
  previous_status text,
  summary text not null,
  created_at timestamptz not null default now(),
  constraint war_room_bridge_status_history_status_check check (
    status in ('online','degraded','reconnecting','disconnected','recovered')
  ),
  constraint war_room_bridge_status_history_previous_check check (
    previous_status is null or previous_status in ('online','degraded','reconnecting','disconnected','recovered')
  )
);

create index if not exists war_room_bridge_runtime_node_idx on public.war_room_bridge_runtime_snapshots(node_id, reported_at desc);
create index if not exists war_room_bridge_status_history_node_idx on public.war_room_bridge_status_history(node_id, created_at desc);
create index if not exists war_room_bridge_status_history_status_idx on public.war_room_bridge_status_history(status, created_at desc);

alter table public.war_room_bridge_runtime_snapshots enable row level security;
alter table public.war_room_bridge_status_history enable row level security;

drop policy if exists war_room_bridge_runtime_snapshots_service_role_all on public.war_room_bridge_runtime_snapshots;
create policy war_room_bridge_runtime_snapshots_service_role_all on public.war_room_bridge_runtime_snapshots
  for all to service_role using (true) with check (true);

drop policy if exists war_room_bridge_status_history_service_role_all on public.war_room_bridge_status_history;
create policy war_room_bridge_status_history_service_role_all on public.war_room_bridge_status_history
  for all to service_role using (true) with check (true);

grant select, insert, update, delete on table public.war_room_bridge_runtime_snapshots to service_role;
grant select, insert, update, delete on table public.war_room_bridge_status_history to service_role;
