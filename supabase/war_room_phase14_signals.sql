-- War Room Phase 14: Live Economic Signal Ingestion and Scoring.
-- Additive only. Stores source configuration, bounded cloud-source scans,
-- source-backed signal results, leverage scores, and recommendation alerts.
-- This grants no local agent behavior, localhost bridge, hidden execution,
-- outreach, spending, job applications, dispatch, automation execution, or
-- income claims. All operational actions remain approval-gated.

grant usage on schema public to service_role;

create table if not exists public.war_room_signal_sources (
  id text primary key,
  label text not null,
  provider text not null,
  kind text not null,
  categories text[] not null default '{}'::text[],
  url text,
  query text,
  configured boolean not null default false,
  reliability_score numeric not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_signal_sources_provider_check check (
    provider in ('tavily','firecrawl','rss','newsapi','guardian','manual_registry','source_url')
  ),
  constraint war_room_signal_sources_kind_check check (
    kind in ('search','page_extract','rss','news_api','guardian','manual_registry','job_gig_url','freight_url','smb_lead_url','ai_trend_url','local_economic_url')
  ),
  constraint war_room_signal_sources_reliability_check check (reliability_score between 0 and 1),
  constraint war_room_signal_sources_no_localhost_check check (
    url is null
    or (
      url like 'https://%'
      and url !~* 'https://(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])'
      and url !~* 'https://(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)'
    )
  )
);

create table if not exists public.war_room_signal_scans (
  id text primary key,
  status text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  source_count integer not null default 0,
  result_count integer not null default 0,
  provider_diagnostics jsonb not null default '{}'::jsonb,
  error text,
  approval_required boolean not null default true,
  external_execution_performed boolean not null default false,
  hidden_execution_performed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint war_room_signal_scans_status_check check (status in ('completed','partial','failed')),
  constraint war_room_signal_scans_diagnostics_check check (jsonb_typeof(provider_diagnostics) = 'object'),
  constraint war_room_signal_scans_approval_required_check check (approval_required is true),
  constraint war_room_signal_scans_no_external_execution_check check (external_execution_performed is false),
  constraint war_room_signal_scans_no_hidden_execution_check check (hidden_execution_performed is false)
);

create table if not exists public.war_room_signal_results (
  id text primary key,
  scan_id text references public.war_room_signal_scans(id) on delete set null,
  title text not null,
  source text not null,
  provider text not null,
  source_kind text not null,
  url text not null,
  summary text not null,
  category text not null,
  relevance_score numeric not null default 0,
  income_potential_score numeric not null default 0,
  urgency_score numeric not null default 0,
  confidence_score numeric not null default 0,
  startup_cost_score numeric not null default 0,
  time_to_profit_score numeric not null default 0,
  repeatability_score numeric not null default 0,
  strategic_alignment_score numeric not null default 0,
  family_impact_score numeric not null default 0,
  highest_leverage_score numeric not null default 0,
  startup_cost_estimate text not null default 'unknown',
  time_to_profit_estimate text not null default 'unknown',
  recommended_next_action text not null,
  assigned_baby_family text not null,
  approval_status text not null default 'pending_review',
  captured_at timestamptz not null default now(),
  source_backed boolean not null default true,
  recommendation_only boolean not null default true,
  approval_required boolean not null default true,
  external_execution_allowed boolean not null default false,
  hidden_execution_allowed boolean not null default false,
  income_claimed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_signal_results_provider_check check (
    provider in ('tavily','firecrawl','rss','newsapi','guardian','manual_registry','source_url')
  ),
  constraint war_room_signal_results_kind_check check (
    source_kind in ('search','page_extract','rss','news_api','guardian','manual_registry','job_gig_url','freight_url','smb_lead_url','ai_trend_url','local_economic_url')
  ),
  constraint war_room_signal_results_category_check check (
    category in ('freight','sprinter_van','local_delivery','load_board','job','gig','data_annotation','AI_evaluation','SMB_automation','customer_operations','call_center','AI_trends','local_Akron','Ohio_business','economic_warning','app_factory_opportunity')
  ),
  constraint war_room_signal_results_approval_status_check check (
    approval_status in ('pending_review','approved','rejected','low_confidence','archived')
  ),
  constraint war_room_signal_results_score_bounds check (
    relevance_score between 0 and 100
    and income_potential_score between 0 and 100
    and urgency_score between 0 and 100
    and confidence_score between 0 and 100
    and startup_cost_score between 0 and 100
    and time_to_profit_score between 0 and 100
    and repeatability_score between 0 and 100
    and strategic_alignment_score between 0 and 100
    and family_impact_score between 0 and 100
    and highest_leverage_score between 0 and 100
  ),
  constraint war_room_signal_results_no_localhost_check check (
    url like 'https://%'
    and url !~* 'https://(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])'
    and url !~* 'https://(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)'
  ),
  constraint war_room_signal_results_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint war_room_signal_results_source_backed_check check (source_backed is true),
  constraint war_room_signal_results_recommendation_only_check check (recommendation_only is true),
  constraint war_room_signal_results_approval_required_check check (approval_required is true),
  constraint war_room_signal_results_no_external_execution_check check (external_execution_allowed is false),
  constraint war_room_signal_results_no_hidden_execution_check check (hidden_execution_allowed is false),
  constraint war_room_signal_results_no_income_claim_check check (income_claimed is false)
);

create table if not exists public.war_room_signal_scores (
  id uuid primary key default gen_random_uuid(),
  result_id text references public.war_room_signal_results(id) on delete cascade,
  scan_id text references public.war_room_signal_scans(id) on delete set null,
  category text not null,
  relevance_score numeric not null default 0,
  income_potential_score numeric not null default 0,
  urgency_score numeric not null default 0,
  confidence_score numeric not null default 0,
  startup_cost_score numeric not null default 0,
  time_to_profit_score numeric not null default 0,
  repeatability_score numeric not null default 0,
  strategic_alignment_score numeric not null default 0,
  family_impact_score numeric not null default 0,
  highest_leverage_score numeric not null default 0,
  rationale text not null default '',
  approval_required boolean not null default true,
  can_execute boolean not null default false,
  created_at timestamptz not null default now(),
  constraint war_room_signal_scores_category_check check (
    category in ('freight','sprinter_van','local_delivery','load_board','job','gig','data_annotation','AI_evaluation','SMB_automation','customer_operations','call_center','AI_trends','local_Akron','Ohio_business','economic_warning','app_factory_opportunity')
  ),
  constraint war_room_signal_scores_bounds check (
    relevance_score between 0 and 100
    and income_potential_score between 0 and 100
    and urgency_score between 0 and 100
    and confidence_score between 0 and 100
    and startup_cost_score between 0 and 100
    and time_to_profit_score between 0 and 100
    and repeatability_score between 0 and 100
    and strategic_alignment_score between 0 and 100
    and family_impact_score between 0 and 100
    and highest_leverage_score between 0 and 100
  ),
  constraint war_room_signal_scores_approval_required_check check (approval_required is true),
  constraint war_room_signal_scores_no_execute_check check (can_execute is false)
);

create table if not exists public.war_room_signal_alerts (
  id uuid primary key default gen_random_uuid(),
  scan_id text references public.war_room_signal_scans(id) on delete set null,
  severity text not null,
  title text not null,
  summary text not null,
  source_attribution text not null default '',
  approval_required boolean not null default true,
  can_execute boolean not null default false,
  created_at timestamptz not null default now(),
  constraint war_room_signal_alerts_severity_check check (severity in ('info','watch','important','critical')),
  constraint war_room_signal_alerts_approval_required_check check (approval_required is true),
  constraint war_room_signal_alerts_no_execute_check check (can_execute is false)
);

create index if not exists war_room_signal_sources_provider_idx
  on public.war_room_signal_sources(provider, configured);
create index if not exists war_room_signal_scans_completed_idx
  on public.war_room_signal_scans(completed_at desc, status);
create index if not exists war_room_signal_results_leverage_idx
  on public.war_room_signal_results(highest_leverage_score desc, approval_status, captured_at desc);
create index if not exists war_room_signal_results_category_idx
  on public.war_room_signal_results(category, captured_at desc);
create index if not exists war_room_signal_scores_result_idx
  on public.war_room_signal_scores(result_id, created_at desc);
create index if not exists war_room_signal_alerts_scan_idx
  on public.war_room_signal_alerts(scan_id, created_at desc);

create or replace function public.touch_war_room_signal_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_signal_sources_set_updated_at on public.war_room_signal_sources;
create trigger war_room_signal_sources_set_updated_at
  before update on public.war_room_signal_sources
  for each row
  execute procedure public.touch_war_room_signal_updated_at();

drop trigger if exists war_room_signal_results_set_updated_at on public.war_room_signal_results;
create trigger war_room_signal_results_set_updated_at
  before update on public.war_room_signal_results
  for each row
  execute procedure public.touch_war_room_signal_updated_at();

alter table public.war_room_signal_sources enable row level security;
alter table public.war_room_signal_scans enable row level security;
alter table public.war_room_signal_results enable row level security;
alter table public.war_room_signal_scores enable row level security;
alter table public.war_room_signal_alerts enable row level security;

revoke all on table public.war_room_signal_sources from anon, authenticated;
revoke all on table public.war_room_signal_scans from anon, authenticated;
revoke all on table public.war_room_signal_results from anon, authenticated;
revoke all on table public.war_room_signal_scores from anon, authenticated;
revoke all on table public.war_room_signal_alerts from anon, authenticated;

drop policy if exists war_room_signal_sources_service_role_all on public.war_room_signal_sources;
create policy war_room_signal_sources_service_role_all on public.war_room_signal_sources
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists war_room_signal_scans_service_role_all on public.war_room_signal_scans;
create policy war_room_signal_scans_service_role_all on public.war_room_signal_scans
  for all
  to service_role
  using (true)
  with check (
    approval_required is true
    and external_execution_performed is false
    and hidden_execution_performed is false
  );

drop policy if exists war_room_signal_results_service_role_all on public.war_room_signal_results;
create policy war_room_signal_results_service_role_all on public.war_room_signal_results
  for all
  to service_role
  using (true)
  with check (
    source_backed is true
    and recommendation_only is true
    and approval_required is true
    and external_execution_allowed is false
    and hidden_execution_allowed is false
    and income_claimed is false
  );

drop policy if exists war_room_signal_scores_service_role_all on public.war_room_signal_scores;
create policy war_room_signal_scores_service_role_all on public.war_room_signal_scores
  for all
  to service_role
  using (true)
  with check (approval_required is true and can_execute is false);

drop policy if exists war_room_signal_alerts_service_role_all on public.war_room_signal_alerts;
create policy war_room_signal_alerts_service_role_all on public.war_room_signal_alerts
  for all
  to service_role
  using (true)
  with check (approval_required is true and can_execute is false);

grant select, insert, update, delete on table public.war_room_signal_sources to service_role;
grant select, insert, update, delete on table public.war_room_signal_scans to service_role;
grant select, insert, update, delete on table public.war_room_signal_results to service_role;
grant select, insert, update, delete on table public.war_room_signal_scores to service_role;
grant select, insert, update, delete on table public.war_room_signal_alerts to service_role;

select pg_notify('pgrst', 'reload schema');
