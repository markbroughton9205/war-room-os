-- War Room Phase 7: Economic Operations foundations.
-- Architecture-only persistence: registries, queues, telemetry, and approval-gated drafts.
-- Service-role API pattern: RLS enabled, service_role policies only, no anon policies.

create table if not exists public.war_room_economic_operational_domains (
  id text primary key,
  label text not null,
  provider_priority jsonb not null default '[]'::jsonb,
  workflow_type text not null,
  allowed_tools jsonb not null default '[]'::jsonb,
  approval_requirements jsonb not null default '[]'::jsonb,
  telemetry_category text not null,
  output_structure jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_economic_domains_id_check check (id in ('income_ops','freight_ops','lead_ops','research_ops','automation_ops','intelligence_ops','build_ops','media_ops','acquisition_ops','sales_ops','client_ops','market_ops')),
  constraint war_room_economic_domains_workflow_type_check check (workflow_type in ('leads','proposals','research_targets','outreach_drafts','automation_tasks','intelligence_reports','acquisition_targets')),
  constraint war_room_economic_domains_telemetry_category_check check (telemetry_category in ('provider_latency','opportunity_count','estimated_value_total','workflow_completion_rate','proposal_generation_volume','provider_success_failure_rate','routing_violation','operational_throughput'))
);

create table if not exists public.war_room_economic_opportunities (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null references public.war_room_economic_operational_domains (id),
  source text not null,
  source_provider text not null default 'unknown',
  confidence numeric not null default 0.5,
  estimated_value numeric,
  assigned_family text not null,
  required_actions jsonb not null default '[]'::jsonb,
  risk_level text not null default 'medium',
  status text not null default 'discovered',
  discovered_at timestamptz not null default now(),
  expires_at timestamptz,
  notes text not null default '',
  source_details jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_economic_opportunities_confidence_check check (confidence >= 0 and confidence <= 1),
  constraint war_room_economic_opportunities_source_provider_check check (source_provider in ('chatgpt','claude','grok','gemini','red_team','unknown')),
  constraint war_room_economic_opportunities_assigned_family_check check (assigned_family in ('chatgpt','claude','grok','gemini','red_team')),
  constraint war_room_economic_opportunities_risk_level_check check (risk_level in ('low','medium','high','critical')),
  constraint war_room_economic_opportunities_status_check check (status in ('discovered','investigating','approved','queued','executing','completed','rejected','archived')),
  constraint war_room_economic_opportunities_dedupe_key_key unique (dedupe_key)
);

create table if not exists public.war_room_economic_workflow_queue (
  id uuid primary key default gen_random_uuid(),
  workflow_type text not null,
  status text not null default 'pending',
  assigned_family text not null,
  priority integer not null default 3,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  summary text not null,
  domain_id text not null references public.war_room_economic_operational_domains (id),
  approval_required boolean not null default true,
  dedupe_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  constraint war_room_economic_workflow_type_check check (workflow_type in ('leads','proposals','research_targets','outreach_drafts','automation_tasks','intelligence_reports','acquisition_targets')),
  constraint war_room_economic_workflow_status_check check (status in ('pending','active','completed','failed','archived')),
  constraint war_room_economic_workflow_assigned_family_check check (assigned_family in ('chatgpt','claude','grok','gemini','red_team')),
  constraint war_room_economic_workflow_priority_check check (priority between 1 and 5),
  constraint war_room_economic_workflow_approval_required_check check (approval_required is true),
  constraint war_room_economic_workflow_queue_dedupe_key_key unique (dedupe_key)
);

create table if not exists public.war_room_economic_proposals (
  id uuid primary key default gen_random_uuid(),
  output_type text not null,
  status text not null default 'drafted',
  assigned_family text not null,
  workflow_id uuid references public.war_room_economic_workflow_queue (id) on delete set null,
  opportunity_id uuid references public.war_room_economic_opportunities (id) on delete set null,
  title text not null,
  body text not null,
  approval_required boolean not null default true,
  external_use_approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint war_room_economic_proposals_output_type_check check (output_type in ('outreach_draft','sales_proposal','freight_proposal','business_plan','automation_offer','operational_recommendation')),
  constraint war_room_economic_proposals_status_check check (status in ('drafted','approved','rejected','archived')),
  constraint war_room_economic_proposals_assigned_family_check check (assigned_family in ('chatgpt','claude','grok','gemini','red_team')),
  constraint war_room_economic_proposals_approval_required_check check (approval_required is true),
  constraint war_room_economic_proposals_external_approval_check check (external_use_approved_at is null or status = 'approved')
);

create table if not exists public.war_room_economic_telemetry (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  provider_family text,
  domain_id text references public.war_room_economic_operational_domains (id) on delete set null,
  metric_name text not null,
  metric_value numeric not null default 0,
  recorded_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint war_room_economic_telemetry_category_check check (category in ('provider_latency','opportunity_count','estimated_value_total','workflow_completion_rate','proposal_generation_volume','provider_success_failure_rate','routing_violation','operational_throughput')),
  constraint war_room_economic_telemetry_provider_family_check check (provider_family is null or provider_family in ('chatgpt','claude','grok','gemini','red_team'))
);

create table if not exists public.war_room_economic_provider_effectiveness (
  provider_family text primary key,
  success_count integer not null default 0,
  failure_count integer not null default 0,
  average_latency_ms numeric,
  routing_violation_count integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint war_room_economic_provider_effectiveness_family_check check (provider_family in ('chatgpt','claude','grok','gemini','red_team')),
  constraint war_room_economic_provider_effectiveness_counts_check check (success_count >= 0 and failure_count >= 0 and routing_violation_count >= 0)
);

create table if not exists public.war_room_economic_active_missions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  domain_id text not null references public.war_room_economic_operational_domains (id),
  assigned_family text not null,
  status text not null default 'planned',
  approval_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint war_room_economic_active_missions_family_check check (assigned_family in ('chatgpt','claude','grok','gemini','red_team')),
  constraint war_room_economic_active_missions_status_check check (status in ('planned','active','paused','completed','archived')),
  constraint war_room_economic_active_missions_approval_check check (approval_required is true)
);

create table if not exists public.war_room_economic_unresolved_operations (
  id uuid primary key default gen_random_uuid(),
  domain_id text not null references public.war_room_economic_operational_domains (id),
  workflow_id uuid references public.war_room_economic_workflow_queue (id) on delete set null,
  opportunity_id uuid references public.war_room_economic_opportunities (id) on delete set null,
  reason text not null,
  severity text not null default 'medium',
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint war_room_economic_unresolved_operations_severity_check check (severity in ('low','medium','high','critical')),
  constraint war_room_economic_unresolved_operations_status_check check (status in ('open','reviewing','resolved','archived'))
);

create index if not exists war_room_economic_opportunities_status_idx
  on public.war_room_economic_opportunities (status, discovered_at desc);
create index if not exists war_room_economic_opportunities_category_idx
  on public.war_room_economic_opportunities (category, discovered_at desc);
create index if not exists war_room_economic_workflow_status_idx
  on public.war_room_economic_workflow_queue (status, priority desc, created_at desc);
create index if not exists war_room_economic_workflow_domain_idx
  on public.war_room_economic_workflow_queue (domain_id, created_at desc);
create index if not exists war_room_economic_proposals_status_idx
  on public.war_room_economic_proposals (status, created_at desc);
create index if not exists war_room_economic_proposals_workflow_idx
  on public.war_room_economic_proposals (workflow_id);
create index if not exists war_room_economic_telemetry_category_idx
  on public.war_room_economic_telemetry (category, recorded_at desc);
create index if not exists war_room_economic_telemetry_provider_idx
  on public.war_room_economic_telemetry (provider_family, recorded_at desc);
create index if not exists war_room_economic_active_missions_status_idx
  on public.war_room_economic_active_missions (status, created_at desc);
create index if not exists war_room_economic_unresolved_operations_status_idx
  on public.war_room_economic_unresolved_operations (status, severity, created_at desc);

create or replace function public.touch_war_room_phase7_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_economic_domains_set_updated_at on public.war_room_economic_operational_domains;
create trigger war_room_economic_domains_set_updated_at
  before update on public.war_room_economic_operational_domains
  for each row execute procedure public.touch_war_room_phase7_updated_at();

drop trigger if exists war_room_economic_opportunities_set_updated_at on public.war_room_economic_opportunities;
create trigger war_room_economic_opportunities_set_updated_at
  before update on public.war_room_economic_opportunities
  for each row execute procedure public.touch_war_room_phase7_updated_at();

drop trigger if exists war_room_economic_workflow_set_updated_at on public.war_room_economic_workflow_queue;
create trigger war_room_economic_workflow_set_updated_at
  before update on public.war_room_economic_workflow_queue
  for each row execute procedure public.touch_war_room_phase7_updated_at();

drop trigger if exists war_room_economic_proposals_set_updated_at on public.war_room_economic_proposals;
create trigger war_room_economic_proposals_set_updated_at
  before update on public.war_room_economic_proposals
  for each row execute procedure public.touch_war_room_phase7_updated_at();

drop trigger if exists war_room_economic_active_missions_set_updated_at on public.war_room_economic_active_missions;
create trigger war_room_economic_active_missions_set_updated_at
  before update on public.war_room_economic_active_missions
  for each row execute procedure public.touch_war_room_phase7_updated_at();

drop trigger if exists war_room_economic_unresolved_operations_set_updated_at on public.war_room_economic_unresolved_operations;
create trigger war_room_economic_unresolved_operations_set_updated_at
  before update on public.war_room_economic_unresolved_operations
  for each row execute procedure public.touch_war_room_phase7_updated_at();

alter table public.war_room_economic_operational_domains enable row level security;
alter table public.war_room_economic_opportunities enable row level security;
alter table public.war_room_economic_workflow_queue enable row level security;
alter table public.war_room_economic_proposals enable row level security;
alter table public.war_room_economic_telemetry enable row level security;
alter table public.war_room_economic_provider_effectiveness enable row level security;
alter table public.war_room_economic_active_missions enable row level security;
alter table public.war_room_economic_unresolved_operations enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.war_room_economic_opportunities to service_role;
grant select, insert, update, delete on table public.war_room_economic_workflow_queue to service_role;

drop policy if exists war_room_economic_domains_service_role_all on public.war_room_economic_operational_domains;
create policy war_room_economic_domains_service_role_all on public.war_room_economic_operational_domains
  for all to service_role using (true) with check (true);

drop policy if exists war_room_economic_opportunities_service_role_all on public.war_room_economic_opportunities;
create policy war_room_economic_opportunities_service_role_all on public.war_room_economic_opportunities
  for all to service_role using (true) with check (true);

drop policy if exists war_room_economic_workflow_service_role_all on public.war_room_economic_workflow_queue;
create policy war_room_economic_workflow_service_role_all on public.war_room_economic_workflow_queue
  for all to service_role using (true) with check (true);

drop policy if exists war_room_economic_proposals_service_role_all on public.war_room_economic_proposals;
create policy war_room_economic_proposals_service_role_all on public.war_room_economic_proposals
  for all to service_role using (true) with check (true);

drop policy if exists war_room_economic_telemetry_service_role_all on public.war_room_economic_telemetry;
create policy war_room_economic_telemetry_service_role_all on public.war_room_economic_telemetry
  for all to service_role using (true) with check (true);

drop policy if exists war_room_economic_provider_effectiveness_service_role_all on public.war_room_economic_provider_effectiveness;
create policy war_room_economic_provider_effectiveness_service_role_all on public.war_room_economic_provider_effectiveness
  for all to service_role using (true) with check (true);

drop policy if exists war_room_economic_active_missions_service_role_all on public.war_room_economic_active_missions;
create policy war_room_economic_active_missions_service_role_all on public.war_room_economic_active_missions
  for all to service_role using (true) with check (true);

drop policy if exists war_room_economic_unresolved_operations_service_role_all on public.war_room_economic_unresolved_operations;
create policy war_room_economic_unresolved_operations_service_role_all on public.war_room_economic_unresolved_operations
  for all to service_role using (true) with check (true);

insert into public.war_room_economic_operational_domains
  (id, label, provider_priority, workflow_type, allowed_tools, approval_requirements, telemetry_category, output_structure)
values
  ('income_ops','Income Operations','["grok","chatgpt","gemini","claude","red_team"]','leads','["internal_registry","market_research_notes","opportunity_scoring"]','["email","outreach","contract","publishing","payment","account_action","external_submission"]','opportunity_count','{"format":"structured_brief","requiredFields":["title","source","estimated_value","risk_level","required_actions"],"approvalGate":"human_required"}'),
  ('freight_ops','Freight Operations','["grok","gemini","chatgpt","red_team","claude"]','research_targets','["freight_lane_research","demand_notes","risk_review"]','["email","outreach","contract","publishing","payment","account_action","external_submission"]','estimated_value_total','{"format":"report","requiredFields":["lane","demand_signal","estimated_value","risk_level","next_review"],"approvalGate":"human_required"}'),
  ('lead_ops','Lead Operations','["grok","chatgpt","gemini","red_team","claude"]','leads','["lead_research_notes","fit_scoring","approval_queue"]','["email","outreach","contract","publishing","payment","account_action","external_submission"]','operational_throughput','{"format":"structured_brief","requiredFields":["lead_segment","source","confidence","recommended_follow_up"],"approvalGate":"human_required"}'),
  ('research_ops','Research Operations','["gemini","grok","claude","chatgpt","red_team"]','research_targets','["research_brief","source_cross_reference","gap_analysis"]','["email","outreach","contract","publishing","payment","account_action","external_submission"]','provider_latency','{"format":"report","requiredFields":["question","known_signals","gaps","recommended_sources"],"approvalGate":"human_required"}'),
  ('automation_ops','Automation Operations','["claude","chatgpt","gemini","red_team","grok"]','automation_tasks','["requirements_brief","systems_design","implementation_plan"]','["email","outreach","contract","publishing","payment","account_action","external_submission"]','workflow_completion_rate','{"format":"plan","requiredFields":["problem","workflow","constraints","approval_points"],"approvalGate":"human_required"}'),
  ('intelligence_ops','Intelligence Operations','["grok","gemini","red_team","chatgpt","claude"]','intelligence_reports','["signal_capture","cross_reference","contradiction_review"]','["email","outreach","contract","publishing","payment","account_action","external_submission"]','routing_violation','{"format":"report","requiredFields":["signal","confidence","contradictions","recommended_watchlist"],"approvalGate":"human_required"}'),
  ('build_ops','Build Operations','["claude","chatgpt","gemini","red_team","grok"]','automation_tasks','["technical_plan","scope_register","risk_review"]','["email","outreach","contract","publishing","payment","account_action","external_submission"]','provider_success_failure_rate','{"format":"plan","requiredFields":["scope","architecture","dependencies","acceptance_criteria"],"approvalGate":"human_required"}'),
  ('media_ops','Media Operations','["chatgpt","gemini","grok","red_team","claude"]','outreach_drafts','["content_brief","audience_notes","approval_queue"]','["email","outreach","contract","publishing","payment","account_action","external_submission"]','proposal_generation_volume','{"format":"draft","requiredFields":["audience","message","channel","approval_notes"],"approvalGate":"human_required"}'),
  ('acquisition_ops','Acquisition Operations','["grok","chatgpt","red_team","gemini","claude"]','acquisition_targets','["target_research","valuation_notes","risk_review"]','["email","outreach","contract","publishing","payment","account_action","external_submission"]','estimated_value_total','{"format":"structured_brief","requiredFields":["target","source","estimated_value","risk_level","approval_notes"],"approvalGate":"human_required"}'),
  ('sales_ops','Sales Operations','["chatgpt","grok","gemini","red_team","claude"]','proposals','["offer_brief","proposal_draft","approval_queue"]','["email","outreach","contract","publishing","payment","account_action","external_submission"]','proposal_generation_volume','{"format":"draft","requiredFields":["prospect","offer","terms_placeholder","approval_notes"],"approvalGate":"human_required"}'),
  ('client_ops','Client Operations','["chatgpt","claude","gemini","red_team","grok"]','proposals','["client_brief","operational_recommendation","approval_queue"]','["email","outreach","contract","publishing","payment","account_action","external_submission"]','workflow_completion_rate','{"format":"recommendation","requiredFields":["client_need","recommendation","constraints","approval_notes"],"approvalGate":"human_required"}'),
  ('market_ops','Market Operations','["gemini","grok","chatgpt","red_team","claude"]','research_targets','["market_gap_scan","industry_notes","opportunity_scoring"]','["email","outreach","contract","publishing","payment","account_action","external_submission"]','opportunity_count','{"format":"report","requiredFields":["market","gap","confidence","estimated_value","recommended_next_step"],"approvalGate":"human_required"}')
on conflict (id) do update set
  label = excluded.label,
  provider_priority = excluded.provider_priority,
  workflow_type = excluded.workflow_type,
  allowed_tools = excluded.allowed_tools,
  approval_requirements = excluded.approval_requirements,
  telemetry_category = excluded.telemetry_category,
  output_structure = excluded.output_structure;
