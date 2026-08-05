-- Phase 49-C-2 Opportunity Agent Workforce durable persistence proposal.
-- REVIEW ONLY. Do not apply until Commander review approves durable Opportunity Agent storage.

create table if not exists public.war_room_opportunity_agent_records (
  opportunity_id text primary key,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  category text not null,
  summary text not null,
  source text not null,
  source_url text null,
  source_reference text null,
  source_published_at timestamptz null,
  retrieved_at timestamptz not null,
  deadline timestamptz null,
  location text null,
  evidence_status text not null,
  freshness_status text not null,
  qualification_status text not null,
  risk_level text not null,
  effort_level text not null,
  status text not null,
  dedupe_fingerprint text not null,
  opportunity_value jsonb null,
  estimated_revenue jsonb null,
  estimated_costs jsonb null,
  estimated_profit jsonb null,
  upfront_cash_required jsonb null,
  actual_revenue jsonb null,
  actual_costs jsonb null,
  actual_profit jsonb null,
  payment_terms text null,
  time_to_revenue text null,
  required_resources text[] not null default '{}'::text[],
  missing_requirements text[] not null default '{}'::text[],
  eligibility text[] not null default '{}'::text[],
  next_action text null,
  commander_approval_required boolean not null default true,
  assigned_agents text[] not null default '{}'::text[],
  outcome_evidence text null,
  submitted_at timestamptz null,
  completed_at timestamptz null,
  verified_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_opportunity_agent_evidence_check check (evidence_status in ('LIVE_VERIFIED','CACHED_CURRENT','HISTORICAL','MODEL_JUDGMENT','UNKNOWN')),
  constraint war_room_opportunity_agent_freshness_check check (freshness_status in ('CURRENT','EXPIRED','UNCERTAIN','HISTORICAL')),
  constraint war_room_opportunity_agent_status_check check (status in ('DISCOVERED','RESEARCHING','QUALIFIED','REJECTED','DEFERRED','PREPARING','AWAITING_COMMANDER_APPROVAL','APPROVED_FOR_PURSUIT','QUEUED','RUNNING','SUBMITTED','AWAITING_RESPONSE','WON','LOST','COMPLETED','VERIFIED','BLOCKED','FAILED')),
  constraint war_room_opportunity_agent_approval_check check (commander_approval_required is true),
  constraint war_room_opportunity_agent_actual_revenue_evidence_check check (actual_revenue is null or outcome_evidence is not null)
);

create unique index if not exists war_room_opportunity_agent_owner_dedupe_idx
  on public.war_room_opportunity_agent_records(owner_user_id, dedupe_fingerprint);
create index if not exists war_room_opportunity_agent_owner_status_idx
  on public.war_room_opportunity_agent_records(owner_user_id, status, created_at desc);
create index if not exists war_room_opportunity_agent_deadline_idx
  on public.war_room_opportunity_agent_records(deadline);

create table if not exists public.war_room_opportunity_agent_work_packets (
  packet_id text primary key,
  opportunity_id text not null references public.war_room_opportunity_agent_records(opportunity_id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  packet jsonb not null,
  draft_materials jsonb not null default '[]'::jsonb,
  facts_vs_estimates jsonb not null default '{}'::jsonb,
  approval_requirements text[] not null default '{}'::text[],
  external_actions_executed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint war_room_opportunity_packet_no_external_check check (external_actions_executed is false),
  constraint war_room_opportunity_packet_json_check check (jsonb_typeof(packet) = 'object')
);

create index if not exists war_room_opportunity_packet_owner_idx
  on public.war_room_opportunity_agent_work_packets(owner_user_id, created_at desc);

create table if not exists public.war_room_opportunity_agent_audit (
  audit_id uuid primary key default gen_random_uuid(),
  opportunity_id text not null references public.war_room_opportunity_agent_records(opportunity_id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  actor text not null,
  from_status text null,
  to_status text null,
  message text not null,
  evidence text null,
  created_at timestamptz not null default now()
);

create index if not exists war_room_opportunity_agent_audit_opportunity_idx
  on public.war_room_opportunity_agent_audit(opportunity_id, created_at desc);

alter table public.war_room_opportunity_agent_records enable row level security;
alter table public.war_room_opportunity_agent_work_packets enable row level security;
alter table public.war_room_opportunity_agent_audit enable row level security;

grant select, insert, update on public.war_room_opportunity_agent_records to authenticated, service_role;
grant select, insert on public.war_room_opportunity_agent_work_packets to authenticated, service_role;
grant select, insert on public.war_room_opportunity_agent_audit to authenticated, service_role;

create policy war_room_opportunity_agent_records_commander_all
  on public.war_room_opportunity_agent_records
  for all
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy war_room_opportunity_agent_work_packets_commander_all
  on public.war_room_opportunity_agent_work_packets
  for all
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy war_room_opportunity_agent_audit_commander_all
  on public.war_room_opportunity_agent_audit
  for all
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy war_room_opportunity_agent_records_service_role_all
  on public.war_room_opportunity_agent_records
  for all
  to service_role
  using (true)
  with check (true);

create policy war_room_opportunity_agent_work_packets_service_role_all
  on public.war_room_opportunity_agent_work_packets
  for all
  to service_role
  using (true)
  with check (true);

create policy war_room_opportunity_agent_audit_service_role_all
  on public.war_room_opportunity_agent_audit
  for all
  to service_role
  using (true)
  with check (true);
