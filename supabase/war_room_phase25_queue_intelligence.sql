-- War Room Phase 25: Operator Queue Intelligence Layer.
-- Additive only. Separates operator leverage work from engineering/runtime noise.
-- No browser-side schema mutation, autonomous execution, outreach, spend, or repair completion is enabled.

grant usage on schema public to service_role;

create table if not exists public.operator_priority_queue (
  id text primary key,
  queue_type text not null default 'operator_priority_queue',
  title text not null,
  translated_title text not null,
  description text not null,
  source_type text not null,
  severity text not null default 'watch',
  confidence numeric not null default 0,
  revenue_impact numeric not null default 0,
  mission_impact numeric not null default 0,
  urgency_impact numeric not null default 0,
  dependency_blocking numeric not null default 0,
  debt_freedom_contribution numeric not null default 0,
  priority_score numeric not null default 0,
  estimated_minutes numeric,
  approval_required boolean not null default true,
  operator_visible boolean not null default true,
  engineering_visible boolean not null default false,
  truth_label text not null default 'SOURCE_BACKED',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint operator_priority_queue_type_check check (queue_type = 'operator_priority_queue'),
  constraint operator_priority_queue_source_check check (
    source_type in ('revenue_opportunity','approval_request','mission_action','debt_progress','operator_review','income_task')
  ),
  constraint operator_priority_queue_blocked_check check (
    source_type not in ('runtime_repair','provider_repair','schema_repair','diagnostics','infra_alert')
  ),
  constraint operator_priority_queue_severity_check check (severity in ('info','watch','important','critical')),
  constraint operator_priority_queue_truth_check check (truth_label in ('SOURCE_BACKED','PROPOSED','APPROVAL_REQUIRED','UNAVAILABLE')),
  constraint operator_priority_queue_scores_check check (
    confidence between 0 and 100
    and revenue_impact between 0 and 100
    and mission_impact between 0 and 100
    and urgency_impact between 0 and 100
    and dependency_blocking between 0 and 100
    and debt_freedom_contribution between 0 and 100
    and priority_score between 0 and 100
  ),
  constraint operator_priority_queue_minutes_check check (estimated_minutes is null or estimated_minutes >= 0),
  constraint operator_priority_queue_visibility_check check (
    operator_visible is true and engineering_visible is false
  )
);

create table if not exists public.engineering_queue (
  id text primary key,
  queue_type text not null default 'engineering_queue',
  title text not null,
  translated_title text not null,
  description text not null,
  source_type text not null,
  severity text not null default 'watch',
  confidence numeric not null default 0,
  revenue_impact numeric not null default 0,
  mission_impact numeric not null default 0,
  urgency_impact numeric not null default 0,
  dependency_blocking numeric not null default 0,
  debt_freedom_contribution numeric not null default 0,
  priority_score numeric not null default 0,
  estimated_minutes numeric,
  approval_required boolean not null default false,
  operator_visible boolean not null default false,
  engineering_visible boolean not null default true,
  truth_label text not null default 'SOURCE_BACKED',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint engineering_queue_type_check check (queue_type = 'engineering_queue'),
  constraint engineering_queue_source_check check (
    source_type in ('runtime_repair','provider_repair','schema_repair','diagnostics','infra_alert')
  ),
  constraint engineering_queue_severity_check check (severity in ('info','watch','important','critical')),
  constraint engineering_queue_truth_check check (truth_label in ('SOURCE_BACKED','PROPOSED','APPROVAL_REQUIRED','UNAVAILABLE')),
  constraint engineering_queue_scores_check check (
    confidence between 0 and 100
    and revenue_impact between 0 and 100
    and mission_impact between 0 and 100
    and urgency_impact between 0 and 100
    and dependency_blocking between 0 and 100
    and debt_freedom_contribution between 0 and 100
    and priority_score between 0 and 100
  ),
  constraint engineering_queue_minutes_check check (estimated_minutes is null or estimated_minutes >= 0),
  constraint engineering_queue_visibility_check check (
    operator_visible is false and engineering_visible is true
  )
);

create table if not exists public.runtime_queue (
  id text primary key,
  queue_type text not null default 'runtime_queue',
  title text not null,
  translated_title text not null,
  description text not null,
  source_type text not null,
  severity text not null default 'watch',
  confidence numeric not null default 0,
  revenue_impact numeric not null default 0,
  mission_impact numeric not null default 0,
  urgency_impact numeric not null default 0,
  dependency_blocking numeric not null default 0,
  debt_freedom_contribution numeric not null default 0,
  priority_score numeric not null default 0,
  estimated_minutes numeric,
  approval_required boolean not null default false,
  operator_visible boolean not null default false,
  engineering_visible boolean not null default true,
  truth_label text not null default 'SOURCE_BACKED',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint runtime_queue_type_check check (queue_type = 'runtime_queue'),
  constraint runtime_queue_source_check check (
    source_type in ('runtime_repair','provider_repair','diagnostics','infra_alert')
  ),
  constraint runtime_queue_severity_check check (severity in ('info','watch','important','critical')),
  constraint runtime_queue_truth_check check (truth_label in ('SOURCE_BACKED','PROPOSED','APPROVAL_REQUIRED','UNAVAILABLE')),
  constraint runtime_queue_scores_check check (
    confidence between 0 and 100
    and revenue_impact between 0 and 100
    and mission_impact between 0 and 100
    and urgency_impact between 0 and 100
    and dependency_blocking between 0 and 100
    and debt_freedom_contribution between 0 and 100
    and priority_score between 0 and 100
  ),
  constraint runtime_queue_minutes_check check (estimated_minutes is null or estimated_minutes >= 0),
  constraint runtime_queue_visibility_check check (
    operator_visible is false and engineering_visible is true
  )
);

create table if not exists public.revenue_queue (
  id text primary key,
  queue_type text not null default 'revenue_queue',
  title text not null,
  translated_title text not null,
  description text not null,
  source_type text not null,
  severity text not null default 'watch',
  confidence numeric not null default 0,
  revenue_impact numeric not null default 0,
  mission_impact numeric not null default 0,
  urgency_impact numeric not null default 0,
  dependency_blocking numeric not null default 0,
  debt_freedom_contribution numeric not null default 0,
  priority_score numeric not null default 0,
  estimated_minutes numeric,
  approval_required boolean not null default true,
  operator_visible boolean not null default false,
  engineering_visible boolean not null default false,
  truth_label text not null default 'SOURCE_BACKED',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint revenue_queue_type_check check (queue_type = 'revenue_queue'),
  constraint revenue_queue_source_check check (
    source_type in ('revenue_opportunity','lead_generation','arbitrage','contract','automation_income','recurring_revenue_action','income_task')
  ),
  constraint revenue_queue_severity_check check (severity in ('info','watch','important','critical')),
  constraint revenue_queue_truth_check check (truth_label in ('SOURCE_BACKED','PROPOSED','APPROVAL_REQUIRED','UNAVAILABLE')),
  constraint revenue_queue_scores_check check (
    confidence between 0 and 100
    and revenue_impact between 0 and 100
    and mission_impact between 0 and 100
    and urgency_impact between 0 and 100
    and dependency_blocking between 0 and 100
    and debt_freedom_contribution between 0 and 100
    and priority_score between 0 and 100
  ),
  constraint revenue_queue_minutes_check check (estimated_minutes is null or estimated_minutes >= 0),
  constraint revenue_queue_visibility_check check (
    operator_visible is false and engineering_visible is false
  )
);

create table if not exists public.council_queue (
  id text primary key,
  queue_type text not null default 'council_queue',
  title text not null,
  translated_title text not null,
  description text not null,
  source_type text not null,
  severity text not null default 'watch',
  confidence numeric not null default 0,
  revenue_impact numeric not null default 0,
  mission_impact numeric not null default 0,
  urgency_impact numeric not null default 0,
  dependency_blocking numeric not null default 0,
  debt_freedom_contribution numeric not null default 0,
  priority_score numeric not null default 0,
  estimated_minutes numeric,
  approval_required boolean not null default true,
  operator_visible boolean not null default false,
  engineering_visible boolean not null default false,
  truth_label text not null default 'PROPOSED',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint council_queue_type_check check (queue_type = 'council_queue'),
  constraint council_queue_source_check check (
    source_type in ('council_proposal','strategic_recommendation','research_packet','contradiction_analysis')
  ),
  constraint council_queue_severity_check check (severity in ('info','watch','important','critical')),
  constraint council_queue_truth_check check (truth_label in ('SOURCE_BACKED','PROPOSED','APPROVAL_REQUIRED','UNAVAILABLE')),
  constraint council_queue_scores_check check (
    confidence between 0 and 100
    and revenue_impact between 0 and 100
    and mission_impact between 0 and 100
    and urgency_impact between 0 and 100
    and dependency_blocking between 0 and 100
    and debt_freedom_contribution between 0 and 100
    and priority_score between 0 and 100
  ),
  constraint council_queue_minutes_check check (estimated_minutes is null or estimated_minutes >= 0),
  constraint council_queue_visibility_check check (
    operator_visible is false and engineering_visible is false
  )
);

create index if not exists operator_priority_queue_rank_idx
  on public.operator_priority_queue(resolved_at, priority_score desc, created_at desc);
create index if not exists operator_priority_queue_type_idx
  on public.operator_priority_queue(source_type, severity, created_at desc);
create index if not exists engineering_queue_rank_idx
  on public.engineering_queue(resolved_at, priority_score desc, created_at desc);
create index if not exists runtime_queue_rank_idx
  on public.runtime_queue(resolved_at, priority_score desc, created_at desc);
create index if not exists revenue_queue_rank_idx
  on public.revenue_queue(resolved_at, priority_score desc, created_at desc);
create index if not exists council_queue_rank_idx
  on public.council_queue(resolved_at, priority_score desc, created_at desc);

alter table public.operator_priority_queue enable row level security;
alter table public.engineering_queue enable row level security;
alter table public.runtime_queue enable row level security;
alter table public.revenue_queue enable row level security;
alter table public.council_queue enable row level security;

revoke all on table public.operator_priority_queue from anon, authenticated;
revoke all on table public.engineering_queue from anon, authenticated;
revoke all on table public.runtime_queue from anon, authenticated;
revoke all on table public.revenue_queue from anon, authenticated;
revoke all on table public.council_queue from anon, authenticated;

drop policy if exists operator_priority_queue_service_role_all on public.operator_priority_queue;
create policy operator_priority_queue_service_role_all on public.operator_priority_queue
  for all
  to service_role
  using (true)
  with check (
    queue_type = 'operator_priority_queue'
    and source_type in ('revenue_opportunity','approval_request','mission_action','debt_progress','operator_review','income_task')
    and source_type not in ('runtime_repair','provider_repair','schema_repair','diagnostics','infra_alert')
    and operator_visible is true
    and engineering_visible is false
  );

drop policy if exists engineering_queue_service_role_all on public.engineering_queue;
create policy engineering_queue_service_role_all on public.engineering_queue
  for all
  to service_role
  using (true)
  with check (queue_type = 'engineering_queue' and operator_visible is false and engineering_visible is true);

drop policy if exists runtime_queue_service_role_all on public.runtime_queue;
create policy runtime_queue_service_role_all on public.runtime_queue
  for all
  to service_role
  using (true)
  with check (queue_type = 'runtime_queue' and operator_visible is false and engineering_visible is true);

drop policy if exists revenue_queue_service_role_all on public.revenue_queue;
create policy revenue_queue_service_role_all on public.revenue_queue
  for all
  to service_role
  using (true)
  with check (queue_type = 'revenue_queue' and operator_visible is false and engineering_visible is false);

drop policy if exists council_queue_service_role_all on public.council_queue;
create policy council_queue_service_role_all on public.council_queue
  for all
  to service_role
  using (true)
  with check (queue_type = 'council_queue' and operator_visible is false and engineering_visible is false);

grant select, insert, update, delete on table public.operator_priority_queue to service_role;
grant select, insert, update, delete on table public.engineering_queue to service_role;
grant select, insert, update, delete on table public.runtime_queue to service_role;
grant select, insert, update, delete on table public.revenue_queue to service_role;
grant select, insert, update, delete on table public.council_queue to service_role;
