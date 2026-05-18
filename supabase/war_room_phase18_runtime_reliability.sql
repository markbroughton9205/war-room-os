-- Phase 18: Operational Reliability + Truth Boundary Layer
-- Service-role only runtime reliability persistence. No public writes.

grant usage on schema public to service_role;

create table if not exists public.war_room_provider_snapshots (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null,
  provider_name text not null,
  health text not null,
  truth_boundary text not null,
  latency_ms integer,
  checked_at timestamptz not null,
  last_success_at timestamptz,
  failure_count integer not null default 0,
  degraded_reason text,
  timeout_count integer not null default 0,
  rate_limit_state text not null default 'unknown',
  rate_limit_reset_at timestamptz,
  active_models text[] not null default '{}',
  signal_availability boolean not null default false,
  fallback_mode boolean not null default false,
  raw_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint war_room_provider_snapshots_health_check check (
    health in ('CONNECTED', 'DEGRADED', 'MISSING_KEY', 'RATE_LIMITED', 'INVALID_KEY')
  ),
  constraint war_room_provider_snapshots_truth_check check (
    truth_boundary in ('VERIFIED', 'SOURCE_BACKED', 'ADVISORY', 'ESTIMATED', 'EXPERIMENTAL', 'DEGRADED', 'READ_ONLY', 'UNAVAILABLE', 'FALLBACK')
  ),
  constraint war_room_provider_snapshots_rate_limit_check check (
    rate_limit_state in ('ok', 'rate_limited', 'unknown')
  ),
  constraint war_room_provider_snapshots_failure_count_check check (failure_count >= 0),
  constraint war_room_provider_snapshots_timeout_count_check check (timeout_count >= 0),
  constraint war_room_provider_snapshots_raw_json_check check (jsonb_typeof(raw_snapshot) = 'object')
);

create index if not exists war_room_provider_snapshots_provider_checked_idx
  on public.war_room_provider_snapshots (provider_id, checked_at desc);

create index if not exists war_room_provider_snapshots_health_idx
  on public.war_room_provider_snapshots (health, checked_at desc);

create table if not exists public.war_room_runtime_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  severity text not null default 'informational',
  mode text not null,
  truth_boundary text not null,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint war_room_runtime_events_severity_check check (
    severity in ('informational', 'degraded', 'blocked', 'failure', 'recovery')
  ),
  constraint war_room_runtime_events_mode_check check (
    mode in ('EXPERIMENTAL', 'DEVELOPMENT', 'STABLE', 'DEGRADED', 'RECOVERY', 'OBSERVATION_ONLY')
  ),
  constraint war_room_runtime_events_truth_check check (
    truth_boundary in ('VERIFIED', 'SOURCE_BACKED', 'ADVISORY', 'ESTIMATED', 'EXPERIMENTAL', 'DEGRADED', 'READ_ONLY', 'UNAVAILABLE', 'FALLBACK')
  ),
  constraint war_room_runtime_events_payload_json_check check (jsonb_typeof(payload) = 'object')
);

create index if not exists war_room_runtime_events_created_idx
  on public.war_room_runtime_events (created_at desc);

create index if not exists war_room_runtime_events_type_idx
  on public.war_room_runtime_events (event_type, created_at desc);

create table if not exists public.war_room_runtime_dependencies (
  id uuid primary key default gen_random_uuid(),
  system_id text not null,
  label text not null,
  truth_boundary text not null,
  mode text not null,
  health text not null,
  upstream text[] not null default '{}',
  downstream text[] not null default '{}',
  degraded_reason text,
  fallback_mode boolean not null default false,
  isolated_failure boolean not null default false,
  blocked_by text[] not null default '{}',
  evidence text not null,
  continuity text not null,
  recovery text not null,
  edges jsonb not null default '[]'::jsonb,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint war_room_runtime_dependencies_system_check check (
    system_id in (
      'provider_runtime',
      'signals',
      'revenue_engine',
      'commander_os',
      'growth_calendar',
      'outcome_ledger',
      'feature_builder',
      'baby_ai',
      'daily_briefing',
      'red_sentinel',
      'engineering_lane',
      'approval_queue'
    )
  ),
  constraint war_room_runtime_dependencies_truth_check check (
    truth_boundary in ('VERIFIED', 'SOURCE_BACKED', 'ADVISORY', 'ESTIMATED', 'EXPERIMENTAL', 'DEGRADED', 'READ_ONLY', 'UNAVAILABLE', 'FALLBACK')
  ),
  constraint war_room_runtime_dependencies_mode_check check (
    mode in ('EXPERIMENTAL', 'DEVELOPMENT', 'STABLE', 'DEGRADED', 'RECOVERY', 'OBSERVATION_ONLY')
  ),
  constraint war_room_runtime_dependencies_health_check check (
    health in ('verified', 'source_backed', 'degraded', 'blocked', 'stale', 'fallback', 'unavailable')
  ),
  constraint war_room_runtime_dependencies_edges_json_check check (jsonb_typeof(edges) = 'array')
);

create index if not exists war_room_runtime_dependencies_system_observed_idx
  on public.war_room_runtime_dependencies (system_id, observed_at desc);

create index if not exists war_room_runtime_dependencies_health_idx
  on public.war_room_runtime_dependencies (health, observed_at desc);

create table if not exists public.war_room_runtime_failures (
  id uuid primary key default gen_random_uuid(),
  system_id text not null,
  label text not null,
  truth_boundary text not null,
  reason text not null,
  impact text not null,
  recovery text not null,
  downstream_consequences text[] not null default '{}',
  continuity text not null,
  resolved_at timestamptz,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint war_room_runtime_failures_system_check check (
    system_id in (
      'provider_runtime',
      'signals',
      'revenue_engine',
      'commander_os',
      'growth_calendar',
      'outcome_ledger',
      'feature_builder',
      'baby_ai',
      'daily_briefing',
      'red_sentinel',
      'engineering_lane',
      'approval_queue'
    )
  ),
  constraint war_room_runtime_failures_truth_check check (
    truth_boundary in ('VERIFIED', 'SOURCE_BACKED', 'ADVISORY', 'ESTIMATED', 'EXPERIMENTAL', 'DEGRADED', 'READ_ONLY', 'UNAVAILABLE', 'FALLBACK')
  )
);

create index if not exists war_room_runtime_failures_system_observed_idx
  on public.war_room_runtime_failures (system_id, observed_at desc);

create index if not exists war_room_runtime_failures_unresolved_idx
  on public.war_room_runtime_failures (observed_at desc)
  where resolved_at is null;

alter table public.war_room_provider_snapshots enable row level security;
alter table public.war_room_runtime_events enable row level security;
alter table public.war_room_runtime_dependencies enable row level security;
alter table public.war_room_runtime_failures enable row level security;

revoke all on table public.war_room_provider_snapshots from anon, authenticated;
revoke all on table public.war_room_runtime_events from anon, authenticated;
revoke all on table public.war_room_runtime_dependencies from anon, authenticated;
revoke all on table public.war_room_runtime_failures from anon, authenticated;

grant select, insert, update, delete on table public.war_room_provider_snapshots to service_role;
grant select, insert, update, delete on table public.war_room_runtime_events to service_role;
grant select, insert, update, delete on table public.war_room_runtime_dependencies to service_role;
grant select, insert, update, delete on table public.war_room_runtime_failures to service_role;

drop policy if exists war_room_provider_snapshots_service_role_all on public.war_room_provider_snapshots;
create policy war_room_provider_snapshots_service_role_all
  on public.war_room_provider_snapshots
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists war_room_runtime_events_service_role_all on public.war_room_runtime_events;
create policy war_room_runtime_events_service_role_all
  on public.war_room_runtime_events
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists war_room_runtime_dependencies_service_role_all on public.war_room_runtime_dependencies;
create policy war_room_runtime_dependencies_service_role_all
  on public.war_room_runtime_dependencies
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists war_room_runtime_failures_service_role_all on public.war_room_runtime_failures;
create policy war_room_runtime_failures_service_role_all
  on public.war_room_runtime_failures
  for all
  to service_role
  using (true)
  with check (true);
