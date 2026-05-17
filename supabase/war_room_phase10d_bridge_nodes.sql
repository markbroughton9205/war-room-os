-- War Room Phase 10D: persistent multi-node bridge infrastructure.
-- Additive only. Service-role APIs persist bridge state; no anon/browser policies are created.
-- These tables do not grant shell execution, filesystem writes, deployment control, OS automation, or arbitrary command authority.

grant usage on schema public to service_role;

create table if not exists public.war_room_bridge_nodes (
  id uuid primary key default gen_random_uuid(),
  node_id text not null unique,
  node_name text not null,
  node_type text not null,
  status text not null default 'offline',
  provider text,
  active_model text,
  last_heartbeat timestamptz,
  latency_ms integer,
  capabilities text[] not null default '{}'::text[],
  trust_level text not null default 'inference',
  reconnect_status text not null default 'reconnecting',
  degraded_reason text,
  shell_execution_allowed boolean not null default false,
  filesystem_write_allowed boolean not null default false,
  deployment_control_allowed boolean not null default false,
  os_automation_allowed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_bridge_nodes_type_check check (
    node_type in ('commander_laptop','engineering_node','observer_node','future_gpu_node')
  ),
  constraint war_room_bridge_nodes_status_check check (
    status in ('online','offline','connecting','degraded','reconnecting')
  ),
  constraint war_room_bridge_nodes_provider_check check (
    provider is null or provider in ('lm_studio','ollama')
  ),
  constraint war_room_bridge_nodes_trust_check check (
    trust_level in ('observer','inference','engineering','restricted')
  ),
  constraint war_room_bridge_nodes_reconnect_check check (
    reconnect_status in ('online','offline','connecting','degraded','reconnecting')
  ),
  constraint war_room_bridge_nodes_no_shell_check check (shell_execution_allowed is false),
  constraint war_room_bridge_nodes_no_filesystem_check check (filesystem_write_allowed is false),
  constraint war_room_bridge_nodes_no_deploy_check check (deployment_control_allowed is false),
  constraint war_room_bridge_nodes_no_os_check check (os_automation_allowed is false)
);

create table if not exists public.war_room_bridge_heartbeat_history (
  id uuid primary key default gen_random_uuid(),
  node_id text not null,
  node_name text not null,
  node_type text not null,
  status text not null,
  provider text,
  active_model text,
  latency_ms integer,
  capabilities text[] not null default '{}'::text[],
  trust_level text not null,
  reconnect_status text not null,
  providers jsonb not null default '[]'::jsonb,
  event_type text not null default 'heartbeat',
  created_at timestamptz not null default now(),
  constraint war_room_bridge_heartbeat_event_check check (
    event_type in ('heartbeat','failure','reconnect')
  ),
  constraint war_room_bridge_heartbeat_provider_check check (
    provider is null or provider in ('lm_studio','ollama')
  ),
  constraint war_room_bridge_heartbeat_trust_check check (
    trust_level in ('observer','inference','engineering','restricted')
  )
);

create table if not exists public.war_room_bridge_provider_events (
  id uuid primary key default gen_random_uuid(),
  node_id text not null,
  event_type text not null,
  previous_provider text,
  next_provider text,
  previous_model text,
  next_model text,
  summary text not null,
  created_at timestamptz not null default now(),
  constraint war_room_bridge_provider_events_type_check check (
    event_type in ('provider_change','model_swap','failure','reconnect')
  ),
  constraint war_room_bridge_provider_events_previous_provider_check check (
    previous_provider is null or previous_provider in ('lm_studio','ollama')
  ),
  constraint war_room_bridge_provider_events_next_provider_check check (
    next_provider is null or next_provider in ('lm_studio','ollama')
  )
);

create table if not exists public.war_room_bridge_audit_logs (
  id uuid primary key default gen_random_uuid(),
  node_id text,
  event_type text not null,
  severity text not null default 'info',
  summary text not null,
  action text,
  payload jsonb not null default '{}'::jsonb,
  rejected boolean not null default false,
  shell_execution_allowed boolean not null default false,
  filesystem_write_allowed boolean not null default false,
  deployment_control_allowed boolean not null default false,
  os_automation_allowed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint war_room_bridge_audit_event_check check (
    event_type in ('heartbeat','provider_change','model_swap','failure','reconnect','invoke_request','node_action','rejection')
  ),
  constraint war_room_bridge_audit_severity_check check (
    severity in ('info','watch','warning','critical')
  ),
  constraint war_room_bridge_audit_action_check check (
    action is null or action in ('model_list','prompt_test','local_inference','diagnostics','health_check')
  ),
  constraint war_room_bridge_audit_no_shell_check check (shell_execution_allowed is false),
  constraint war_room_bridge_audit_no_filesystem_check check (filesystem_write_allowed is false),
  constraint war_room_bridge_audit_no_deploy_check check (deployment_control_allowed is false),
  constraint war_room_bridge_audit_no_os_check check (os_automation_allowed is false)
);

create table if not exists public.war_room_bridge_routing_rules (
  id uuid primary key default gen_random_uuid(),
  task_type text not null unique,
  route_to text not null,
  preferred_node_type text not null,
  preferred_provider text,
  trust_required text not null,
  notes text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_bridge_routing_trust_check check (
    trust_required in ('observer','inference','engineering','restricted')
  )
);

insert into public.war_room_bridge_routing_rules (task_type, route_to, preferred_node_type, preferred_provider, trust_required, notes)
values
  ('coding tasks', 'Engineering Node', 'engineering_node', null, 'engineering', 'Bounded engineering requests only; no shell, filesystem mutation, deployment, or autonomous execution.'),
  ('local reasoning', 'LM Studio Node', 'commander_laptop', 'lm_studio', 'inference', 'Private local reasoning and prompt tests routed to an authenticated local inference node.'),
  ('signal analysis', 'Grok/cloud', 'cloud_family', 'grok_cloud', 'observer', 'High-volume external signal analysis remains outside the local bridge invoke surface.'),
  ('synthesis', 'ChatGPT family', 'cloud_family', 'chatgpt_family', 'observer', 'Strategic synthesis remains advisory and does not grant local node execution rights.')
on conflict (task_type) do update set
  route_to = excluded.route_to,
  preferred_node_type = excluded.preferred_node_type,
  preferred_provider = excluded.preferred_provider,
  trust_required = excluded.trust_required,
  notes = excluded.notes,
  updated_at = now();

create index if not exists war_room_bridge_nodes_status_idx on public.war_room_bridge_nodes(status, last_heartbeat desc);
create index if not exists war_room_bridge_heartbeat_node_idx on public.war_room_bridge_heartbeat_history(node_id, created_at desc);
create index if not exists war_room_bridge_provider_events_node_idx on public.war_room_bridge_provider_events(node_id, created_at desc);
create index if not exists war_room_bridge_audit_logs_node_idx on public.war_room_bridge_audit_logs(node_id, created_at desc);
create index if not exists war_room_bridge_audit_logs_event_idx on public.war_room_bridge_audit_logs(event_type, created_at desc);

alter table public.war_room_bridge_nodes enable row level security;
alter table public.war_room_bridge_heartbeat_history enable row level security;
alter table public.war_room_bridge_provider_events enable row level security;
alter table public.war_room_bridge_audit_logs enable row level security;
alter table public.war_room_bridge_routing_rules enable row level security;

drop policy if exists war_room_bridge_nodes_service_role_all on public.war_room_bridge_nodes;
create policy war_room_bridge_nodes_service_role_all on public.war_room_bridge_nodes
  for all to service_role using (true) with check (true);

drop policy if exists war_room_bridge_heartbeat_service_role_all on public.war_room_bridge_heartbeat_history;
create policy war_room_bridge_heartbeat_service_role_all on public.war_room_bridge_heartbeat_history
  for all to service_role using (true) with check (true);

drop policy if exists war_room_bridge_provider_events_service_role_all on public.war_room_bridge_provider_events;
create policy war_room_bridge_provider_events_service_role_all on public.war_room_bridge_provider_events
  for all to service_role using (true) with check (true);

drop policy if exists war_room_bridge_audit_logs_service_role_all on public.war_room_bridge_audit_logs;
create policy war_room_bridge_audit_logs_service_role_all on public.war_room_bridge_audit_logs
  for all to service_role using (true) with check (true);

drop policy if exists war_room_bridge_routing_rules_service_role_all on public.war_room_bridge_routing_rules;
create policy war_room_bridge_routing_rules_service_role_all on public.war_room_bridge_routing_rules
  for all to service_role using (true) with check (true);

grant select, insert, update, delete on table public.war_room_bridge_nodes to service_role;
grant select, insert, update, delete on table public.war_room_bridge_heartbeat_history to service_role;
grant select, insert, update, delete on table public.war_room_bridge_provider_events to service_role;
grant select, insert, update, delete on table public.war_room_bridge_audit_logs to service_role;
grant select, insert, update, delete on table public.war_room_bridge_routing_rules to service_role;
