-- War Room Phase 9B.1: persistent learning storage + outcome feedback.
-- Additive only. Service-role APIs may read/write; no anon/browser policies are created.
-- No table in this migration dispatches notifications, executes agents, deploys, spends, or mutates external systems.

grant usage on schema public to service_role;

create table if not exists public.war_room_outcome_ledger (
  id uuid primary key default gen_random_uuid(),
  decree_id text,
  project_id text,
  workflow_id text,
  analyst_packet_id text,
  provider_scores jsonb not null default '{}'::jsonb,
  confidence numeric(4,3) not null default 0.5,
  predicted_outcome text,
  actual_outcome text,
  outcome_status text not null default 'pending',
  usefulness numeric(4,3),
  rollback_reference text,
  anomaly_flags text[] not null default '{}'::text[],
  repair_references text[] not null default '{}'::text[],
  evidence jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  evaluated_at timestamptz,
  constraint war_room_outcome_ledger_confidence_check check (confidence >= 0 and confidence <= 1),
  constraint war_room_outcome_ledger_usefulness_check check (usefulness is null or (usefulness >= 0 and usefulness <= 1)),
  constraint war_room_outcome_ledger_status_check check (
    outcome_status in ('pending','successful','partial','failed','unresolved','watching','rolled_back')
  )
);

create table if not exists public.war_room_doctrine_entries (
  id uuid primary key default gen_random_uuid(),
  principle text not null,
  evidence jsonb not null default '[]'::jsonb,
  origin_event text,
  recurrence_frequency integer not null default 0,
  confidence numeric(4,3) not null default 0.5,
  contradictions jsonb not null default '[]'::jsonb,
  doctrine_status text not null default 'candidate',
  promoted_by text,
  red_team_review jsonb not null default '{}'::jsonb,
  review_history jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  promoted_at timestamptz,
  constraint war_room_doctrine_confidence_check check (confidence >= 0 and confidence <= 1),
  constraint war_room_doctrine_recurrence_check check (recurrence_frequency >= 0),
  constraint war_room_doctrine_status_check check (
    doctrine_status in ('candidate','watching','red_team_review','promoted','retired','rejected')
  ),
  constraint war_room_doctrine_promotion_gate_check check (
    doctrine_status <> 'promoted'
    or (
      recurrence_frequency >= 3
      and confidence >= 0.75
      and jsonb_array_length(evidence) >= 2
      and coalesce(red_team_review->>'status', '') in ('approved','passed','reviewed')
      and promoted_by is not null
    )
  )
);

create table if not exists public.war_room_narrative_graph (
  id uuid primary key default gen_random_uuid(),
  entity_relationships jsonb not null default '[]'::jsonb,
  source_overlap numeric(4,3) not null default 0,
  event_links jsonb not null default '[]'::jsonb,
  contradiction_clusters jsonb not null default '[]'::jsonb,
  narrative_synchronization numeric(4,3) not null default 0,
  locality_links jsonb not null default '[]'::jsonb,
  confidence numeric(4,3) not null default 0.5,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  observed_at timestamptz not null default now(),
  constraint war_room_narrative_source_overlap_check check (source_overlap >= 0 and source_overlap <= 1),
  constraint war_room_narrative_sync_check check (narrative_synchronization >= 0 and narrative_synchronization <= 1),
  constraint war_room_narrative_confidence_check check (confidence >= 0 and confidence <= 1)
);

create table if not exists public.war_room_forecast_feedback (
  id uuid primary key default gen_random_uuid(),
  forecast_id text not null,
  assumptions jsonb not null default '[]'::jsonb,
  prediction text not null,
  actual_result text,
  predicted_probability numeric(4,3),
  actual_score numeric(4,3),
  variance numeric(6,3),
  confidence_accuracy numeric(4,3),
  provider_involved text,
  analyst_packet_id text,
  lessons_learned text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint war_room_forecast_predicted_probability_check check (predicted_probability is null or (predicted_probability >= 0 and predicted_probability <= 1)),
  constraint war_room_forecast_actual_score_check check (actual_score is null or (actual_score >= 0 and actual_score <= 1)),
  constraint war_room_forecast_confidence_accuracy_check check (confidence_accuracy is null or (confidence_accuracy >= 0 and confidence_accuracy <= 1))
);

create table if not exists public.war_room_notification_preferences (
  id uuid primary key default gen_random_uuid(),
  commander_id text not null default 'commander',
  escalation_settings jsonb not null default '{}'::jsonb,
  alert_severity_preferences jsonb not null default '{}'::jsonb,
  delivery_modes text[] not null default array['dashboard']::text[],
  quiet_hours jsonb not null default '{}'::jsonb,
  disabled_alert_categories text[] not null default '{}'::text[],
  external_dispatch_enabled boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_notification_preferences_commander_key unique (commander_id),
  constraint war_room_notification_preferences_no_external_dispatch_check check (external_dispatch_enabled is false)
);

create table if not exists public.war_room_notification_queue (
  id uuid primary key default gen_random_uuid(),
  alert_payload jsonb not null default '{}'::jsonb,
  severity text not null default 'info',
  source text not null,
  status text not null default 'queued',
  delivery_readiness text not null default 'dashboard_ready',
  acknowledged boolean not null default false,
  acknowledged_at timestamptz,
  dismissed boolean not null default false,
  dismissed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_notification_queue_severity_check check (severity in ('info','watch','warning','critical')),
  constraint war_room_notification_queue_status_check check (status in ('queued','ready_for_commander','acknowledged','dismissed','archived')),
  constraint war_room_notification_queue_readiness_check check (delivery_readiness in ('dashboard_ready','waiting_commander','disabled_by_preference')),
  constraint war_room_notification_ack_check check (
    (acknowledged is false and acknowledged_at is null) or (acknowledged is true and acknowledged_at is not null)
  ),
  constraint war_room_notification_dismiss_check check (
    (dismissed is false and dismissed_at is null) or (dismissed is true and dismissed_at is not null)
  )
);

create table if not exists public.war_room_specialized_agents (
  id uuid primary key default gen_random_uuid(),
  proposed_agent text not null,
  approved_agent text,
  doctrine_inheritance jsonb not null default '[]'::jsonb,
  scoped_memory jsonb not null default '[]'::jsonb,
  permission_scope jsonb not null default '{}'::jsonb,
  status text not null default 'proposed',
  performance jsonb not null default '{}'::jsonb,
  approval_history jsonb not null default '[]'::jsonb,
  approved_by text,
  approved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_specialized_agents_status_check check (
    status in ('proposed','under_review','approved','active','paused','rejected','retired')
  ),
  constraint war_room_specialized_agents_approval_check check (
    status not in ('approved','active')
    or (approved_agent is not null and approved_by is not null and approved_at is not null)
  )
);

create index if not exists war_room_outcome_ledger_created_idx
  on public.war_room_outcome_ledger (created_at desc);
create index if not exists war_room_outcome_ledger_status_idx
  on public.war_room_outcome_ledger (outcome_status, updated_at desc);
create index if not exists war_room_doctrine_entries_status_idx
  on public.war_room_doctrine_entries (doctrine_status, confidence desc, updated_at desc);
create index if not exists war_room_narrative_graph_observed_idx
  on public.war_room_narrative_graph (observed_at desc);
create index if not exists war_room_forecast_feedback_forecast_idx
  on public.war_room_forecast_feedback (forecast_id, created_at desc);
create index if not exists war_room_notification_queue_status_idx
  on public.war_room_notification_queue (status, severity, created_at desc);
create index if not exists war_room_specialized_agents_status_idx
  on public.war_room_specialized_agents (status, updated_at desc);

create or replace function public.touch_war_room_phase9b_learning_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_outcome_ledger_set_updated_at on public.war_room_outcome_ledger;
create trigger war_room_outcome_ledger_set_updated_at
  before update on public.war_room_outcome_ledger
  for each row execute procedure public.touch_war_room_phase9b_learning_updated_at();

drop trigger if exists war_room_doctrine_entries_set_updated_at on public.war_room_doctrine_entries;
create trigger war_room_doctrine_entries_set_updated_at
  before update on public.war_room_doctrine_entries
  for each row execute procedure public.touch_war_room_phase9b_learning_updated_at();

drop trigger if exists war_room_narrative_graph_set_updated_at on public.war_room_narrative_graph;
create trigger war_room_narrative_graph_set_updated_at
  before update on public.war_room_narrative_graph
  for each row execute procedure public.touch_war_room_phase9b_learning_updated_at();

drop trigger if exists war_room_forecast_feedback_set_updated_at on public.war_room_forecast_feedback;
create trigger war_room_forecast_feedback_set_updated_at
  before update on public.war_room_forecast_feedback
  for each row execute procedure public.touch_war_room_phase9b_learning_updated_at();

drop trigger if exists war_room_notification_preferences_set_updated_at on public.war_room_notification_preferences;
create trigger war_room_notification_preferences_set_updated_at
  before update on public.war_room_notification_preferences
  for each row execute procedure public.touch_war_room_phase9b_learning_updated_at();

drop trigger if exists war_room_notification_queue_set_updated_at on public.war_room_notification_queue;
create trigger war_room_notification_queue_set_updated_at
  before update on public.war_room_notification_queue
  for each row execute procedure public.touch_war_room_phase9b_learning_updated_at();

drop trigger if exists war_room_specialized_agents_set_updated_at on public.war_room_specialized_agents;
create trigger war_room_specialized_agents_set_updated_at
  before update on public.war_room_specialized_agents
  for each row execute procedure public.touch_war_room_phase9b_learning_updated_at();

alter table public.war_room_outcome_ledger enable row level security;
alter table public.war_room_doctrine_entries enable row level security;
alter table public.war_room_narrative_graph enable row level security;
alter table public.war_room_forecast_feedback enable row level security;
alter table public.war_room_notification_preferences enable row level security;
alter table public.war_room_notification_queue enable row level security;
alter table public.war_room_specialized_agents enable row level security;

drop policy if exists war_room_outcome_ledger_service_role_all on public.war_room_outcome_ledger;
create policy war_room_outcome_ledger_service_role_all on public.war_room_outcome_ledger
  for all to service_role using (true) with check (true);

drop policy if exists war_room_doctrine_entries_service_role_all on public.war_room_doctrine_entries;
create policy war_room_doctrine_entries_service_role_all on public.war_room_doctrine_entries
  for all to service_role using (true) with check (true);

drop policy if exists war_room_narrative_graph_service_role_all on public.war_room_narrative_graph;
create policy war_room_narrative_graph_service_role_all on public.war_room_narrative_graph
  for all to service_role using (true) with check (true);

drop policy if exists war_room_forecast_feedback_service_role_all on public.war_room_forecast_feedback;
create policy war_room_forecast_feedback_service_role_all on public.war_room_forecast_feedback
  for all to service_role using (true) with check (true);

drop policy if exists war_room_notification_preferences_service_role_all on public.war_room_notification_preferences;
create policy war_room_notification_preferences_service_role_all on public.war_room_notification_preferences
  for all to service_role using (true) with check (true);

drop policy if exists war_room_notification_queue_service_role_all on public.war_room_notification_queue;
create policy war_room_notification_queue_service_role_all on public.war_room_notification_queue
  for all to service_role using (true) with check (true);

drop policy if exists war_room_specialized_agents_service_role_all on public.war_room_specialized_agents;
create policy war_room_specialized_agents_service_role_all on public.war_room_specialized_agents
  for all to service_role using (true) with check (true);

grant select, insert, update, delete on table public.war_room_outcome_ledger to service_role;
grant select, insert, update, delete on table public.war_room_doctrine_entries to service_role;
grant select, insert, update, delete on table public.war_room_narrative_graph to service_role;
grant select, insert, update, delete on table public.war_room_forecast_feedback to service_role;
grant select, insert, update, delete on table public.war_room_notification_preferences to service_role;
grant select, insert, update, delete on table public.war_room_notification_queue to service_role;
grant select, insert, update, delete on table public.war_room_specialized_agents to service_role;

select pg_notify('pgrst', 'reload schema');
