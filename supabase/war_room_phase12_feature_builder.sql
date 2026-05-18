-- War Room Phase 12: App Feature Builder Pipeline.
-- Additive only. Stores Commander feature ideas, generated build packets,
-- Baby AI family reviews, and outcomes. This grants no shell execution,
-- file mutation, Cursor invocation, deployment control, or public write path.

grant usage on schema public to service_role;

create table if not exists public.war_room_feature_requests (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique,
  idea text not null,
  target_app_module text not null default 'War Room app module',
  commander_context text,
  status text not null default 'idea',
  approval_status text not null default 'awaiting_commander_approval',
  source text not null default 'war_room_feature_builder',
  hidden_execution_performed boolean not null default false,
  file_mutation_performed boolean not null default false,
  deployment_performed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_feature_requests_status_check check (
    status in ('idea','reviewed','approved','sent_to_cursor','building','validated','shipped')
  ),
  constraint war_room_feature_requests_approval_check check (
    approval_status in ('proposal_only','awaiting_commander_approval','approved','rejected')
  ),
  constraint war_room_feature_requests_no_hidden_execution_check check (hidden_execution_performed is false),
  constraint war_room_feature_requests_no_file_mutation_check check (file_mutation_performed is false),
  constraint war_room_feature_requests_no_deploy_check check (deployment_performed is false)
);

create table if not exists public.war_room_feature_build_packets (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.war_room_feature_requests(id) on delete cascade,
  packet_key text not null unique,
  title text not null,
  objective text not null,
  user_story text not null,
  target_app_module text not null,
  required_files_to_inspect text[] not null default '{}'::text[],
  technical_approach text[] not null default '{}'::text[],
  database_changes text[] not null default '{}'::text[],
  api_routes text[] not null default '{}'::text[],
  ui_components text[] not null default '{}'::text[],
  validation_commands text[] not null default '{}'::text[],
  risks text[] not null default '{}'::text[],
  rollback_notes text[] not null default '{}'::text[],
  approval_status text not null default 'awaiting_commander_approval',
  status text not null default 'reviewed',
  monetization_angle text not null default '',
  cursor_ready_prompt text not null,
  packet_json jsonb not null default '{}'::jsonb,
  execution_allowed boolean not null default false,
  cursor_invoked boolean not null default false,
  file_mutation_performed boolean not null default false,
  deployment_performed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_feature_packets_status_check check (
    status in ('idea','reviewed','approved','sent_to_cursor','building','validated','shipped')
  ),
  constraint war_room_feature_packets_approval_check check (
    approval_status in ('proposal_only','awaiting_commander_approval','approved','rejected')
  ),
  constraint war_room_feature_packets_json_check check (jsonb_typeof(packet_json) = 'object'),
  constraint war_room_feature_packets_no_execution_check check (execution_allowed is false),
  constraint war_room_feature_packets_no_cursor_invocation_check check (cursor_invoked is false),
  constraint war_room_feature_packets_no_file_mutation_check check (file_mutation_performed is false),
  constraint war_room_feature_packets_no_deploy_check check (deployment_performed is false)
);

create table if not exists public.war_room_feature_reviews (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null references public.war_room_feature_build_packets(id) on delete cascade,
  agent_key text not null,
  agent_name text not null,
  review_type text not null,
  summary text not null,
  confidence numeric(5,4) not null default 0,
  approval_required boolean not null default true,
  can_execute boolean not null default false,
  created_at timestamptz not null default now(),
  constraint war_room_feature_reviews_agent_check check (
    agent_key in (
      'chatgpt-family-baby',
      'claude-family-baby',
      'grok-family-baby',
      'kimi-family-baby',
      'red-team-baby',
      'bridge-architect-baby',
      'analyst-baby',
      'income-operations-baby'
    )
  ),
  constraint war_room_feature_reviews_type_check check (
    review_type in ('synthesis','architecture','decomposition','risk','market','monetization','integration','trend')
  ),
  constraint war_room_feature_reviews_confidence_check check (confidence >= 0 and confidence <= 1),
  constraint war_room_feature_reviews_approval_check check (approval_required is true),
  constraint war_room_feature_reviews_no_execute_check check (can_execute is false)
);

create table if not exists public.war_room_feature_outcomes (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null references public.war_room_feature_build_packets(id) on delete cascade,
  status text not null,
  summary text not null,
  validated boolean not null default false,
  evidence jsonb not null default '{}'::jsonb,
  hidden_execution_performed boolean not null default false,
  file_mutation_performed_from_war_room boolean not null default false,
  deployment_performed_from_war_room boolean not null default false,
  created_at timestamptz not null default now(),
  constraint war_room_feature_outcomes_status_check check (
    status in ('idea','reviewed','approved','sent_to_cursor','building','validated','shipped')
  ),
  constraint war_room_feature_outcomes_evidence_check check (jsonb_typeof(evidence) = 'object'),
  constraint war_room_feature_outcomes_no_hidden_execution_check check (hidden_execution_performed is false),
  constraint war_room_feature_outcomes_no_file_mutation_check check (file_mutation_performed_from_war_room is false),
  constraint war_room_feature_outcomes_no_deploy_check check (deployment_performed_from_war_room is false)
);

create index if not exists war_room_feature_requests_created_idx
  on public.war_room_feature_requests(created_at desc);
create index if not exists war_room_feature_requests_status_idx
  on public.war_room_feature_requests(status, approval_status);
create index if not exists war_room_feature_packets_request_idx
  on public.war_room_feature_build_packets(request_id, created_at desc);
create index if not exists war_room_feature_packets_status_idx
  on public.war_room_feature_build_packets(status, approval_status);
create index if not exists war_room_feature_reviews_packet_idx
  on public.war_room_feature_reviews(packet_id, created_at desc);
create index if not exists war_room_feature_outcomes_packet_idx
  on public.war_room_feature_outcomes(packet_id, created_at desc);

create or replace function public.touch_war_room_feature_builder_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_feature_requests_set_updated_at on public.war_room_feature_requests;
create trigger war_room_feature_requests_set_updated_at
  before update on public.war_room_feature_requests
  for each row
  execute procedure public.touch_war_room_feature_builder_updated_at();

drop trigger if exists war_room_feature_packets_set_updated_at on public.war_room_feature_build_packets;
create trigger war_room_feature_packets_set_updated_at
  before update on public.war_room_feature_build_packets
  for each row
  execute procedure public.touch_war_room_feature_builder_updated_at();

alter table public.war_room_feature_requests enable row level security;
alter table public.war_room_feature_build_packets enable row level security;
alter table public.war_room_feature_reviews enable row level security;
alter table public.war_room_feature_outcomes enable row level security;

revoke all on table public.war_room_feature_requests from anon, authenticated;
revoke all on table public.war_room_feature_build_packets from anon, authenticated;
revoke all on table public.war_room_feature_reviews from anon, authenticated;
revoke all on table public.war_room_feature_outcomes from anon, authenticated;

drop policy if exists war_room_feature_requests_service_role_all on public.war_room_feature_requests;
create policy war_room_feature_requests_service_role_all on public.war_room_feature_requests
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists war_room_feature_packets_service_role_all on public.war_room_feature_build_packets;
create policy war_room_feature_packets_service_role_all on public.war_room_feature_build_packets
  for all
  to service_role
  using (true)
  with check (
    execution_allowed is false
    and cursor_invoked is false
    and file_mutation_performed is false
    and deployment_performed is false
  );

drop policy if exists war_room_feature_reviews_service_role_all on public.war_room_feature_reviews;
create policy war_room_feature_reviews_service_role_all on public.war_room_feature_reviews
  for all
  to service_role
  using (true)
  with check (approval_required is true and can_execute is false);

drop policy if exists war_room_feature_outcomes_service_role_all on public.war_room_feature_outcomes;
create policy war_room_feature_outcomes_service_role_all on public.war_room_feature_outcomes
  for all
  to service_role
  using (true)
  with check (
    hidden_execution_performed is false
    and file_mutation_performed_from_war_room is false
    and deployment_performed_from_war_room is false
  );

grant select, insert, update, delete on table public.war_room_feature_requests to service_role;
grant select, insert, update, delete on table public.war_room_feature_build_packets to service_role;
grant select, insert, update, delete on table public.war_room_feature_reviews to service_role;
grant select, insert, update, delete on table public.war_room_feature_outcomes to service_role;

