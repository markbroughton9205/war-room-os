-- War Room Phase 23: Mission Runtime Graph + Adaptive Priority Engine.
-- Additive only. This prepares persistence for missions, graph snapshots,
-- priority candidates, and mission logs. It grants no public write path,
-- hidden provider invocation, autonomous execution, financial mutation,
-- browser-triggered schema mutation, or fake telemetry.

grant usage on schema public to service_role;

create table if not exists public.war_room_missions (
  id text primary key,
  title text not null,
  description text not null default '',
  status text not null default 'ACTIVE',
  current_stage text not null default 'review',
  priority_score numeric not null default 0,
  momentum_score numeric not null default 0,
  blocker_score numeric not null default 0,
  compounding_score numeric not null default 0,
  revenue_score numeric not null default 0,
  linked_packets text[] not null default '{}'::text[],
  linked_signals text[] not null default '{}'::text[],
  linked_outcomes text[] not null default '{}'::text[],
  linked_repairs text[] not null default '{}'::text[],
  approval_state text not null default 'none_required',
  metadata jsonb not null default '{}'::jsonb,
  human_approval_required boolean not null default true,
  autonomous_execution_allowed boolean not null default false,
  fake_telemetry_allowed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_missions_id_check check (
    id in (
      'phase-0-cashflow-base',
      'content-automation',
      'automation-services',
      'real-estate-monitor',
      'debt-freedom-trigger'
    )
  ),
  constraint war_room_missions_status_check check (
    status in ('ACTIVE','PAUSED','BLOCKED','AT_TRIGGER','COMPLETE')
  ),
  constraint war_room_missions_approval_check check (
    approval_state in ('none_required','pending','approved','rejected')
  ),
  constraint war_room_missions_score_bounds check (
    priority_score between 0 and 100
    and momentum_score between 0 and 100
    and blocker_score between 0 and 100
    and compounding_score between 0 and 100
    and revenue_score between 0 and 100
  ),
  constraint war_room_missions_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint war_room_missions_human_authority_check check (human_approval_required is true),
  constraint war_room_missions_no_autonomous_execution_check check (autonomous_execution_allowed is false),
  constraint war_room_missions_no_fake_telemetry_check check (fake_telemetry_allowed is false)
);

create table if not exists public.war_room_runtime_graph_snapshots (
  id uuid primary key default gen_random_uuid(),
  generated_at timestamptz not null default now(),
  operational_pressure numeric not null default 0,
  focus_fragmentation numeric not null default 0,
  mission_decay numeric not null default 0,
  overload_risk numeric not null default 0,
  momentum_trend text not null default 'unknown',
  highest_leverage_move text,
  graph_json jsonb not null default '{}'::jsonb,
  source_backed_financial_claims_only boolean not null default true,
  autonomous_execution_allowed boolean not null default false,
  fake_telemetry_allowed boolean not null default false,
  constraint war_room_runtime_graph_snapshots_bounds check (
    operational_pressure between 0 and 100
    and focus_fragmentation between 0 and 100
    and mission_decay between 0 and 100
    and overload_risk between 0 and 100
  ),
  constraint war_room_runtime_graph_snapshots_momentum_check check (
    momentum_trend in ('rising','stable','decaying','unknown')
  ),
  constraint war_room_runtime_graph_snapshots_json_check check (jsonb_typeof(graph_json) = 'object'),
  constraint war_room_runtime_graph_snapshots_source_backed_check check (source_backed_financial_claims_only is true),
  constraint war_room_runtime_graph_snapshots_no_autonomous_execution_check check (autonomous_execution_allowed is false),
  constraint war_room_runtime_graph_snapshots_no_fake_telemetry_check check (fake_telemetry_allowed is false)
);

create table if not exists public.war_room_priority_candidates (
  id text primary key,
  title text not null,
  estimated_value text not null,
  estimated_time text not null,
  linked_mission text not null references public.war_room_missions(id) on delete cascade,
  confidence numeric not null default 0,
  approval_state text not null default 'approval_required',
  source text not null,
  source_id text not null,
  evidence text[] not null default '{}'::text[],
  score numeric not null default 0,
  can_execute boolean not null default false,
  human_approval_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_priority_candidates_confidence_check check (confidence between 0 and 100),
  constraint war_room_priority_candidates_score_check check (score >= 0),
  constraint war_room_priority_candidates_approval_check check (
    approval_state in ('not_required','approval_required','pending_approval')
  ),
  constraint war_room_priority_candidates_source_check check (
    source in ('approval','signal','revenue','outcome','runtime_graph')
  ),
  constraint war_room_priority_candidates_no_execute_check check (can_execute is false),
  constraint war_room_priority_candidates_human_authority_check check (human_approval_required is true)
);

create table if not exists public.war_room_mission_logs (
  id uuid primary key default gen_random_uuid(),
  mission_id text not null references public.war_room_missions(id) on delete cascade,
  event_type text not null,
  title text not null,
  notes text not null default '',
  source text not null default 'operator',
  source_backed boolean not null default false,
  approval_state text not null default 'none_required',
  metadata jsonb not null default '{}'::jsonb,
  external_action_performed boolean not null default false,
  autonomous_execution_performed boolean not null default false,
  fake_financial_claim_made boolean not null default false,
  created_at timestamptz not null default now(),
  constraint war_room_mission_logs_approval_check check (
    approval_state in ('none_required','pending','approved','rejected')
  ),
  constraint war_room_mission_logs_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint war_room_mission_logs_no_external_action_check check (external_action_performed is false),
  constraint war_room_mission_logs_no_autonomous_execution_check check (autonomous_execution_performed is false),
  constraint war_room_mission_logs_no_fake_financial_claim_check check (fake_financial_claim_made is false)
);

create index if not exists war_room_missions_status_priority_idx
  on public.war_room_missions(status, priority_score desc, updated_at desc);
create index if not exists war_room_runtime_graph_snapshots_generated_idx
  on public.war_room_runtime_graph_snapshots(generated_at desc);
create index if not exists war_room_priority_candidates_score_idx
  on public.war_room_priority_candidates(score desc, updated_at desc);
create index if not exists war_room_mission_logs_mission_created_idx
  on public.war_room_mission_logs(mission_id, created_at desc);

create or replace function public.touch_war_room_phase23_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_missions_set_updated_at on public.war_room_missions;
create trigger war_room_missions_set_updated_at
  before update on public.war_room_missions
  for each row
  execute procedure public.touch_war_room_phase23_updated_at();

drop trigger if exists war_room_priority_candidates_set_updated_at on public.war_room_priority_candidates;
create trigger war_room_priority_candidates_set_updated_at
  before update on public.war_room_priority_candidates
  for each row
  execute procedure public.touch_war_room_phase23_updated_at();

insert into public.war_room_missions (
  id, title, description, status, current_stage,
  priority_score, momentum_score, blocker_score, compounding_score, revenue_score
) values
  ('phase-0-cashflow-base', 'Phase 0 Cashflow Base', 'Stabilize cashflow with source-backed opportunities and approval-gated action.', 'ACTIVE', 'source-backed opportunity review', 92, 45, 30, 60, 95),
  ('content-automation', 'Content Automation', 'Build repeatable content systems without claiming output before evidence exists.', 'ACTIVE', 'workflow design', 70, 35, 20, 82, 62),
  ('automation-services', 'Automation Services', 'Package SMB and operator automations into human-approved service offers.', 'ACTIVE', 'offer validation', 82, 40, 25, 78, 86),
  ('real-estate-monitor', 'Real Estate Monitor', 'Watch real estate signals and debt freedom paths without speculative claims.', 'PAUSED', 'signal watch', 54, 20, 15, 65, 42),
  ('debt-freedom-trigger', 'Debt Freedom Trigger', 'Track verified progress toward debt freedom and reinvestment thresholds.', 'AT_TRIGGER', 'source-backed financial telemetry required', 88, 25, 55, 72, 90)
on conflict (id) do update set
  title = excluded.title,
  description = excluded.description;

alter table public.war_room_missions enable row level security;
alter table public.war_room_runtime_graph_snapshots enable row level security;
alter table public.war_room_priority_candidates enable row level security;
alter table public.war_room_mission_logs enable row level security;

revoke all on table public.war_room_missions from anon, authenticated;
revoke all on table public.war_room_runtime_graph_snapshots from anon, authenticated;
revoke all on table public.war_room_priority_candidates from anon, authenticated;
revoke all on table public.war_room_mission_logs from anon, authenticated;

grant select, insert, update on table public.war_room_missions to service_role;
grant select, insert on table public.war_room_runtime_graph_snapshots to service_role;
grant select, insert, update on table public.war_room_priority_candidates to service_role;
grant select, insert on table public.war_room_mission_logs to service_role;
