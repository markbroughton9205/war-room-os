-- War Room Phase 24: Persistent Operator Command Deck.
-- Additive only. Stores proposed actions, confirmed earnings, mission overlays,
-- approval packets, and activity logs. It grants no browser-side mutation path,
-- automatic email sending, autonomous spending, hidden execution, or fake telemetry.

grant usage on schema public to service_role;

create table if not exists public.war_room_operator_actions (
  id text primary key,
  title text not null,
  linked_mission text not null references public.war_room_missions(id) on delete cascade,
  estimated_pay numeric,
  estimated_time_minutes numeric,
  source text not null default 'operator',
  source_id text,
  confidence numeric not null default 0,
  approval_state text not null default 'approval_required',
  status text not null default 'proposed',
  optional_link text,
  evidence text[] not null default '{}'::text[],
  truth_label text not null default 'PROPOSED',
  skip_reason text,
  actual_earnings numeric,
  actual_time_minutes numeric,
  human_approval_required boolean not null default true,
  external_action_performed boolean not null default false,
  autonomous_execution_performed boolean not null default false,
  hidden_action_performed boolean not null default false,
  income_claimed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint war_room_operator_actions_source_check check (
    source in ('approval','signal','revenue','outcome','runtime_graph','manual','operator')
  ),
  constraint war_room_operator_actions_approval_check check (
    approval_state in ('not_required','approval_required','pending_approval')
  ),
  constraint war_room_operator_actions_status_check check (
    status in ('proposed','approved','completed','skipped')
  ),
  constraint war_room_operator_actions_truth_check check (
    truth_label in ('SOURCE_BACKED','MANUAL_LOGGED','PROPOSED','APPROVAL_REQUIRED','UNAVAILABLE')
  ),
  constraint war_room_operator_actions_confidence_check check (confidence between 0 and 100),
  constraint war_room_operator_actions_estimated_pay_check check (estimated_pay is null or estimated_pay >= 0),
  constraint war_room_operator_actions_estimated_time_check check (estimated_time_minutes is null or estimated_time_minutes >= 0),
  constraint war_room_operator_actions_actual_earnings_check check (actual_earnings is null or actual_earnings >= 0),
  constraint war_room_operator_actions_actual_time_check check (actual_time_minutes is null or actual_time_minutes >= 0),
  constraint war_room_operator_actions_human_authority_check check (human_approval_required is true),
  constraint war_room_operator_actions_no_external_check check (external_action_performed is false),
  constraint war_room_operator_actions_no_autonomous_check check (autonomous_execution_performed is false),
  constraint war_room_operator_actions_no_hidden_check check (hidden_action_performed is false),
  constraint war_room_operator_actions_no_income_claim_check check (income_claimed is false)
);

create table if not exists public.war_room_operator_earnings (
  id uuid primary key default gen_random_uuid(),
  action_id text references public.war_room_operator_actions(id) on delete set null,
  title text not null,
  mission_id text not null references public.war_room_missions(id) on delete cascade,
  amount_earned numeric not null,
  time_spent_minutes numeric not null,
  notes text not null default '',
  source_uri text,
  truth_label text not null default 'MANUAL_LOGGED',
  commander_confirmed boolean not null default true,
  external_action_performed boolean not null default false,
  autonomous_execution_performed boolean not null default false,
  hidden_action_performed boolean not null default false,
  fake_revenue_claimed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint war_room_operator_earnings_truth_check check (
    truth_label in ('SOURCE_BACKED','MANUAL_LOGGED','PROPOSED','APPROVAL_REQUIRED','UNAVAILABLE')
  ),
  constraint war_room_operator_earnings_amount_check check (amount_earned >= 0),
  constraint war_room_operator_earnings_time_check check (time_spent_minutes > 0),
  constraint war_room_operator_earnings_confirmed_check check (commander_confirmed is true),
  constraint war_room_operator_earnings_no_external_check check (external_action_performed is false),
  constraint war_room_operator_earnings_no_autonomous_check check (autonomous_execution_performed is false),
  constraint war_room_operator_earnings_no_hidden_check check (hidden_action_performed is false),
  constraint war_room_operator_earnings_no_fake_revenue_check check (fake_revenue_claimed is false)
);

create table if not exists public.war_room_operator_missions (
  mission_id text primary key references public.war_room_missions(id) on delete cascade,
  key_metric text not null default 'Not logged yet',
  progress numeric not null default 0,
  momentum numeric not null default 0,
  trigger_condition text not null default 'Commander review required',
  truth_label text not null default 'UNAVAILABLE',
  human_approval_required boolean not null default true,
  autonomous_execution_allowed boolean not null default false,
  fake_telemetry_allowed boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint war_room_operator_missions_truth_check check (
    truth_label in ('SOURCE_BACKED','MANUAL_LOGGED','PROPOSED','APPROVAL_REQUIRED','UNAVAILABLE')
  ),
  constraint war_room_operator_missions_score_check check (progress between 0 and 100 and momentum between 0 and 100),
  constraint war_room_operator_missions_human_authority_check check (human_approval_required is true),
  constraint war_room_operator_missions_no_autonomous_check check (autonomous_execution_allowed is false),
  constraint war_room_operator_missions_no_fake_telemetry_check check (fake_telemetry_allowed is false)
);

create table if not exists public.war_room_operator_packets (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  packet_type text not null default 'approval_packet',
  status text not null default 'pending',
  body text not null default '',
  recipient text,
  truth_label text not null default 'APPROVAL_REQUIRED',
  external_action_performed boolean not null default false,
  autonomous_execution_performed boolean not null default false,
  email_sent boolean not null default false,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  constraint war_room_operator_packets_type_check check (
    packet_type in ('approval_packet','email_draft','queue_refresh','council_proposal')
  ),
  constraint war_room_operator_packets_status_check check (
    status in ('pending','approved','drafted','completed')
  ),
  constraint war_room_operator_packets_truth_check check (
    truth_label in ('SOURCE_BACKED','MANUAL_LOGGED','PROPOSED','APPROVAL_REQUIRED','UNAVAILABLE')
  ),
  constraint war_room_operator_packets_no_external_check check (external_action_performed is false),
  constraint war_room_operator_packets_no_autonomous_check check (autonomous_execution_performed is false),
  constraint war_room_operator_packets_no_email_sent_check check (email_sent is false)
);

create table if not exists public.war_room_operator_activity (
  id uuid primary key default gen_random_uuid(),
  activity_type text not null,
  summary text not null,
  truth_label text not null default 'MANUAL_LOGGED',
  external_action_performed boolean not null default false,
  autonomous_execution_performed boolean not null default false,
  hidden_action_performed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint war_room_operator_activity_truth_check check (
    truth_label in ('SOURCE_BACKED','MANUAL_LOGGED','PROPOSED','APPROVAL_REQUIRED','UNAVAILABLE')
  ),
  constraint war_room_operator_activity_no_external_check check (external_action_performed is false),
  constraint war_room_operator_activity_no_autonomous_check check (autonomous_execution_performed is false),
  constraint war_room_operator_activity_no_hidden_check check (hidden_action_performed is false)
);

create index if not exists war_room_operator_actions_queue_idx
  on public.war_room_operator_actions(status, confidence desc, created_at desc);
create index if not exists war_room_operator_actions_mission_idx
  on public.war_room_operator_actions(linked_mission, created_at desc);
create index if not exists war_room_operator_earnings_created_idx
  on public.war_room_operator_earnings(created_at desc);
create index if not exists war_room_operator_earnings_mission_idx
  on public.war_room_operator_earnings(mission_id, created_at desc);
create index if not exists war_room_operator_packets_created_idx
  on public.war_room_operator_packets(created_at desc);
create index if not exists war_room_operator_activity_created_idx
  on public.war_room_operator_activity(created_at desc);

create or replace function public.touch_war_room_phase24_operator_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_operator_actions_set_updated_at on public.war_room_operator_actions;
create trigger war_room_operator_actions_set_updated_at
  before update on public.war_room_operator_actions
  for each row
  execute procedure public.touch_war_room_phase24_operator_updated_at();

drop trigger if exists war_room_operator_missions_set_updated_at on public.war_room_operator_missions;
create trigger war_room_operator_missions_set_updated_at
  before update on public.war_room_operator_missions
  for each row
  execute procedure public.touch_war_room_phase24_operator_updated_at();

insert into public.war_room_operator_missions (mission_id, key_metric, progress, momentum, trigger_condition, truth_label)
values
  ('phase-0-cashflow-base', 'Not logged yet', 0, 0, '$600 verified weekly cashflow trigger', 'UNAVAILABLE'),
  ('content-automation', 'Not logged yet', 0, 0, 'source-backed content workflow ready', 'UNAVAILABLE'),
  ('automation-services', 'Not logged yet', 0, 0, 'approved service packet ready', 'UNAVAILABLE'),
  ('real-estate-monitor', 'Not logged yet', 0, 0, 'verified property/debt signal emerges', 'UNAVAILABLE'),
  ('debt-freedom-trigger', 'Not logged yet', 0, 0, 'verified debt payoff path reaches trigger', 'UNAVAILABLE')
on conflict (mission_id) do nothing;

alter table public.war_room_operator_actions enable row level security;
alter table public.war_room_operator_earnings enable row level security;
alter table public.war_room_operator_missions enable row level security;
alter table public.war_room_operator_packets enable row level security;
alter table public.war_room_operator_activity enable row level security;

revoke all on table public.war_room_operator_actions from anon, authenticated;
revoke all on table public.war_room_operator_earnings from anon, authenticated;
revoke all on table public.war_room_operator_missions from anon, authenticated;
revoke all on table public.war_room_operator_packets from anon, authenticated;
revoke all on table public.war_room_operator_activity from anon, authenticated;

drop policy if exists war_room_operator_actions_service_role_all on public.war_room_operator_actions;
create policy war_room_operator_actions_service_role_all on public.war_room_operator_actions
  for all
  to service_role
  using (true)
  with check (
    human_approval_required is true
    and external_action_performed is false
    and autonomous_execution_performed is false
    and hidden_action_performed is false
    and income_claimed is false
  );

drop policy if exists war_room_operator_earnings_service_role_all on public.war_room_operator_earnings;
create policy war_room_operator_earnings_service_role_all on public.war_room_operator_earnings
  for all
  to service_role
  using (true)
  with check (
    commander_confirmed is true
    and external_action_performed is false
    and autonomous_execution_performed is false
    and hidden_action_performed is false
    and fake_revenue_claimed is false
  );

drop policy if exists war_room_operator_missions_service_role_all on public.war_room_operator_missions;
create policy war_room_operator_missions_service_role_all on public.war_room_operator_missions
  for all
  to service_role
  using (true)
  with check (
    human_approval_required is true
    and autonomous_execution_allowed is false
    and fake_telemetry_allowed is false
  );

drop policy if exists war_room_operator_packets_service_role_all on public.war_room_operator_packets;
create policy war_room_operator_packets_service_role_all on public.war_room_operator_packets
  for all
  to service_role
  using (true)
  with check (
    external_action_performed is false
    and autonomous_execution_performed is false
    and email_sent is false
  );

drop policy if exists war_room_operator_activity_service_role_all on public.war_room_operator_activity;
create policy war_room_operator_activity_service_role_all on public.war_room_operator_activity
  for all
  to service_role
  using (true)
  with check (
    external_action_performed is false
    and autonomous_execution_performed is false
    and hidden_action_performed is false
  );

grant select, insert, update, delete on table public.war_room_operator_actions to service_role;
grant select, insert, update, delete on table public.war_room_operator_earnings to service_role;
grant select, insert, update, delete on table public.war_room_operator_missions to service_role;
grant select, insert, update, delete on table public.war_room_operator_packets to service_role;
grant select, insert, update, delete on table public.war_room_operator_activity to service_role;
