-- =============================================================================
-- War Room OS — consolidated production initialization (Supabase / Postgres)
-- =============================================================================
-- Purpose: single idempotent script for greenfield or repair installs. Merges
--   war_room_phase3.sql, war_room_phase3b.sql, war_room_phase4_permissions.sql,
--   war_room_phase4_events.sql, war_room_phase6_memory.sql, war_room_payments.sql,
--   plus war_room_files (files.sql), build_requests (build_requests.sql), and
--   income_opportunities (income_opportunities.sql) used by operational snapshot + income APIs.
--
-- Not included here (no schema in repo): public.rael_action_queue, public.memories — create
-- separately if those features are enabled in production.
--
-- Naming map (no duplicate shadow tables; app uses public.war_room_*):
--   * kernel_events / event bus      -> public.war_room_events (+ war_room_worker_runs)
--   * approval_queue                 -> public.war_room_actions (status lifecycle)
--   * payment_ledger                 -> public.war_room_deposits (+ proofs / notifications)
--   * deposit_notifications          -> public.war_room_deposit_notifications
--   * council_sessions / family flow -> public.war_room_conversations + war_room_messages
--   * family_memory_contexts         -> public.war_room_memory_proposals +
--                                          war_room_approved_memories
--
-- Safety: CREATE IF NOT EXISTS for tables/indexes; no DROP TABLE / TRUNCATE.
-- RLS enabled on all tables; server routes use SUPABASE_SERVICE_ROLE_KEY (bypasses RLS).
-- Safe to re-run: functions REPLACE; triggers DROP IF EXISTS then CREATE;
--   audit category CHECK is refreshed via DROP CONSTRAINT IF EXISTS + ADD (non-data).
--
-- After apply: verify PostgREST schema reload (Supabase often auto-reloads); if 404
-- persists, restart project or run NOTIFY pgrst, 'reload schema'; (dashboard).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Council — persistent threads, messages, standing permissions
-- -----------------------------------------------------------------------------
create table if not exists public.war_room_conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Untitled thread',
  metadata jsonb not null default '{}'::jsonb,
  state text not null default 'active',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint war_room_conversations_state_check check (
    state in ('active', 'paused', 'archived')
  )
);

create index if not exists war_room_conversations_updated_at_idx
  on public.war_room_conversations (updated_at desc);

create index if not exists war_room_conversations_deleted_at_idx
  on public.war_room_conversations (deleted_at);

create table if not exists public.war_room_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.war_room_conversations (id) on delete cascade,
  role text not null,
  content text not null,
  family text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint war_room_messages_role_check check (
    role in ('system', 'user', 'assistant', 'tool', 'note')
  )
);

create index if not exists war_room_messages_conversation_created_idx
  on public.war_room_messages (conversation_id, created_at asc);

create table if not exists public.war_room_permissions_state (
  id int primary key check (id = 1),
  mode text not null default 'operator',
  safety_lock boolean not null default false,
  last_auto_action_at timestamptz,
  last_auto_action_kind text,
  last_auto_action_detail jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint war_room_permissions_state_mode_check check (
    mode in ('manual', 'operator', 'commander')
  )
);

insert into public.war_room_permissions_state (id, mode, safety_lock)
values (1, 'operator', false)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Actions — operator queue, approval lifecycle, per-action execution logs
-- -----------------------------------------------------------------------------
create table if not exists public.war_room_actions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.war_room_conversations (id) on delete set null,
  status text not null default 'requested',
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  approval_granted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_actions_status_check check (
    status in (
      'requested',
      'planned',
      'routed',
      'waiting_approval',
      'approved',
      'executing',
      'qa_check',
      'completed',
      'failed',
      'rollback_available',
      'rolled_back'
    )
  )
);

create index if not exists war_room_actions_status_idx
  on public.war_room_actions (status);

create index if not exists war_room_actions_conversation_idx
  on public.war_room_actions (conversation_id);

create table if not exists public.war_room_action_logs (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.war_room_actions (id) on delete cascade,
  level text not null default 'info',
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint war_room_action_logs_level_check check (
    level in ('debug', 'info', 'warn', 'error')
  )
);

create index if not exists war_room_action_logs_action_created_idx
  on public.war_room_action_logs (action_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Diagnostics — internet layer audit (provider, timing, HTTP metadata)
-- -----------------------------------------------------------------------------
create table if not exists public.war_room_internet_logs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.war_room_conversations (id) on delete set null,
  action_id uuid references public.war_room_actions (id) on delete set null,
  provider text not null,
  operation text not null,
  query text,
  status_code int,
  duration_ms int,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint war_room_internet_logs_operation_check check (
    operation in ('status', 'search', 'fetch')
  )
);

create index if not exists war_room_internet_logs_created_idx
  on public.war_room_internet_logs (created_at desc);

-- -----------------------------------------------------------------------------
-- Unified audit — cross-cutting trail (includes payment + memory + events)
-- -----------------------------------------------------------------------------
create table if not exists public.war_room_audit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor text not null,
  category text not null,
  action_id uuid references public.war_room_actions (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  message text not null,
  constraint war_room_audit_logs_actor_check check (
    actor in ('system', 'user')
  ),
  constraint war_room_audit_logs_category_check check (
    category in (
      'action',
      'engine',
      'internet',
      'repo',
      'sentinel',
      'permissions',
      'event',
      'memory',
      'payment'
    )
  )
);

create index if not exists war_room_audit_logs_created_idx
  on public.war_room_audit_logs (created_at desc);

create index if not exists war_room_audit_logs_category_created_idx
  on public.war_room_audit_logs (category, created_at desc);

create index if not exists war_room_audit_logs_action_idx
  on public.war_room_audit_logs (action_id)
  where action_id is not null;

-- Expand category CHECK on existing DBs (e.g. after older phase scripts) — idempotent.
alter table public.war_room_audit_logs drop constraint if exists war_room_audit_logs_category_check;

alter table public.war_room_audit_logs
  add constraint war_room_audit_logs_category_check check (
    category in (
      'action',
      'engine',
      'internet',
      'repo',
      'sentinel',
      'permissions',
      'event',
      'memory',
      'payment'
    )
  );

-- -----------------------------------------------------------------------------
-- Runtime integrity diagnostic events (API inserts; service role bypasses RLS)
-- -----------------------------------------------------------------------------
create table if not exists public.war_room_runtime_integrity_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  subsystem text not null,
  severity text not null,
  source_family text,
  evidence jsonb not null default '{}'::jsonb,
  recommendation text,
  diagnostic_mode text
);

create index if not exists war_room_runtime_integrity_logs_created_idx
  on public.war_room_runtime_integrity_logs (created_at desc);

create index if not exists war_room_runtime_integrity_logs_subsystem_created_idx
  on public.war_room_runtime_integrity_logs (subsystem, created_at desc);

-- -----------------------------------------------------------------------------
-- Red Sentinel — scan snapshots / runtime diagnostics persistence
-- -----------------------------------------------------------------------------
create table if not exists public.war_room_sentinel_scans (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  findings_count int not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists war_room_sentinel_scans_created_idx
  on public.war_room_sentinel_scans (created_at desc);

-- -----------------------------------------------------------------------------
-- Kernel / event bus — durable events + worker run diagnostics
-- -----------------------------------------------------------------------------
create table if not exists public.war_room_events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  correlation_id text,
  source text not null,
  created_at timestamptz not null default now(),
  constraint war_room_events_source_check check (
    source in ('system', 'user', 'worker')
  )
);

create index if not exists war_room_events_created_idx
  on public.war_room_events (created_at desc);

create table if not exists public.war_room_worker_runs (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null,
  ok boolean not null,
  detail jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists war_room_worker_runs_created_idx
  on public.war_room_worker_runs (created_at desc);

create index if not exists war_room_worker_runs_worker_created_idx
  on public.war_room_worker_runs (worker_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Memory — family-scoped proposals and approved snapshots
-- -----------------------------------------------------------------------------
create table if not exists public.war_room_memory_proposals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  family_partition text not null,
  proposed_by text not null default 'user',
  title text not null,
  content_redacted text not null,
  status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  conversation_id uuid references public.war_room_conversations (id) on delete set null,
  constraint war_room_memory_proposals_status_check check (
    status in ('pending', 'approved', 'rejected')
  ),
  constraint war_room_memory_proposals_partition_check check (
    family_partition in (
      'ChatGPT Family',
      'Claude Family',
      'Grok Family',
      'Gemini Family',
      'Kimi Family',
      'Red Team',
      'Bridge Architect',
      'Baby AI Observer'
    )
  )
);

create index if not exists war_room_memory_proposals_status_created_idx
  on public.war_room_memory_proposals (status, created_at desc);

create index if not exists war_room_memory_proposals_partition_idx
  on public.war_room_memory_proposals (family_partition, created_at desc);

create table if not exists public.war_room_approved_memories (
  id uuid primary key default gen_random_uuid(),
  approved_at timestamptz not null default now(),
  family_partition text not null,
  title text not null,
  content text not null,
  source_proposal_id uuid references public.war_room_memory_proposals (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  constraint war_room_approved_memories_partition_check check (
    family_partition in (
      'ChatGPT Family',
      'Claude Family',
      'Grok Family',
      'Gemini Family',
      'Kimi Family',
      'Red Team',
      'Bridge Architect',
      'Baby AI Observer'
    )
  )
);

create index if not exists war_room_approved_memories_partition_approved_idx
  on public.war_room_approved_memories (family_partition, approved_at desc);

create index if not exists war_room_approved_memories_source_idx
  on public.war_room_approved_memories (source_proposal_id);

-- -----------------------------------------------------------------------------
-- Payments — deposit lifecycle, proof metadata, notifications, guard findings
-- -----------------------------------------------------------------------------
create table if not exists public.war_room_deposits (
  deposit_id text primary key,
  opportunity_id text,
  income_worker_id text,
  provider text not null default 'manual_proof',
  payer_name text not null default 'Unknown platform',
  expected_amount numeric,
  confirmed_amount numeric,
  currency text not null default 'USD',
  expected_date timestamptz,
  confirmed_date timestamptz,
  proof_required boolean not null default true,
  proof_status text not null default 'required',
  deposit_status text not null default 'pending_proof',
  notification_status text not null default 'not_sent',
  risk_status text not null default 'clear',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint war_room_deposits_proof_status_check check (
    proof_status in ('not_required', 'required', 'submitted', 'verified', 'rejected')
  ),
  constraint war_room_deposits_deposit_status_check check (
    deposit_status in ('expected', 'pending_proof', 'proof_submitted', 'awaiting_confirmation', 'confirmed', 'notified', 'disputed', 'failed', 'rejected')
  ),
  constraint war_room_deposits_notification_status_check check (
    notification_status in ('not_sent', 'queued', 'sent', 'failed')
  ),
  constraint war_room_deposits_risk_status_check check (
    risk_status in ('clear', 'review', 'blocked')
  )
);

create table if not exists public.war_room_deposit_proofs (
  id uuid primary key default gen_random_uuid(),
  deposit_id text not null references public.war_room_deposits (deposit_id) on delete cascade,
  proof_url text,
  proof_metadata jsonb not null default '{}'::jsonb,
  proof_status text not null default 'submitted',
  created_at timestamptz not null default now(),
  constraint war_room_deposit_proofs_status_check check (
    proof_status in ('submitted', 'verified', 'rejected')
  )
);

create table if not exists public.war_room_deposit_notifications (
  id uuid primary key default gen_random_uuid(),
  deposit_id text not null references public.war_room_deposits (deposit_id) on delete cascade,
  notification_status text not null,
  message text,
  created_at timestamptz not null default now(),
  constraint war_room_deposit_notifications_status_check check (
    notification_status in ('queued', 'sent', 'failed')
  )
);

create table if not exists public.war_room_payment_guard_findings (
  id text primary key,
  deposit_id text references public.war_room_deposits (deposit_id) on delete set null,
  severity text not null,
  kind text not null,
  message text not null,
  blocks_confirmation boolean not null default false,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint war_room_payment_guard_findings_severity_check check (
    severity in ('info', 'warn', 'error', 'critical')
  )
);

create index if not exists war_room_deposits_status_idx on public.war_room_deposits (deposit_status);
create index if not exists war_room_deposits_opportunity_idx on public.war_room_deposits (opportunity_id);
create index if not exists war_room_deposit_proofs_deposit_idx on public.war_room_deposit_proofs (deposit_id, created_at desc);
create index if not exists war_room_deposit_notifications_deposit_idx on public.war_room_deposit_notifications (deposit_id, created_at desc);
create index if not exists war_room_payment_guard_deposit_idx on public.war_room_payment_guard_findings (deposit_id);

-- -----------------------------------------------------------------------------
-- Files — uploaded artifacts metadata (storage path + indexing status)
-- -----------------------------------------------------------------------------
create table if not exists public.war_room_files (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_type text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  storage_path text not null,
  source_context text not null default 'war-room',
  uploaded_at timestamptz not null default now(),
  tags text[] not null default '{}',
  status text not null default 'uploaded'
    check (status in ('uploaded', 'indexed', 'error')),
  notes text not null default ''
);

create index if not exists war_room_files_uploaded_at_idx
  on public.war_room_files (uploaded_at desc);

create index if not exists war_room_files_status_idx
  on public.war_room_files (status);

-- -----------------------------------------------------------------------------
-- Supporting — build request pipeline (used by /api/build-requests)
-- -----------------------------------------------------------------------------
create table if not exists public.build_requests (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique,
  title text not null,
  description text,
  type text not null,
  status text not null default 'drafted',
  assigned_agent text,
  priority text not null default 'medium',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint build_requests_type_check check (
    type in ('feature', 'bugfix', 'refactor', 'research', 'deployment')
  ),
  constraint build_requests_status_check check (
    status in ('drafted', 'reviewing', 'ready', 'blocked', 'completed')
  ),
  constraint build_requests_priority_check check (
    priority in ('low', 'medium', 'high')
  )
);

create index if not exists build_requests_created_at_idx
  on public.build_requests (created_at desc);

create index if not exists build_requests_status_idx
  on public.build_requests (status);

-- -----------------------------------------------------------------------------
-- Income opportunities — worker / opportunity registry (operational snapshot)
-- -----------------------------------------------------------------------------
create table if not exists public.income_opportunities (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  platform text not null,
  country text,
  currency text not null default 'USD',
  local_payout numeric,
  usd_estimate numeric,
  estimated_hourly numeric,
  payout_speed text,
  type text not null,
  risk_level text not null default 'medium',
  status text not null default 'not started',
  apply_url text,
  notes text,
  expires_at timestamptz,
  discovered_at timestamptz not null default now(),
  last_checked_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint income_opportunities_type_check check (
    type in (
      'surveys',
      'AI evaluation',
      'user testing',
      'research studies',
      'remote micro-contracts',
      'digital service gigs'
    )
  ),
  constraint income_opportunities_risk_level_check check (
    risk_level in ('low', 'medium', 'high')
  ),
  constraint income_opportunities_status_check check (
    status in ('not started', 'applied', 'active', 'paid')
  )
);

create index if not exists income_opportunities_created_at_idx
  on public.income_opportunities (created_at desc);

create index if not exists income_opportunities_expires_at_idx
  on public.income_opportunities (expires_at);

create index if not exists income_opportunities_is_active_idx
  on public.income_opportunities (is_active);

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------
alter table public.war_room_conversations enable row level security;
alter table public.war_room_messages enable row level security;
alter table public.war_room_permissions_state enable row level security;
alter table public.war_room_actions enable row level security;
alter table public.war_room_action_logs enable row level security;
alter table public.war_room_internet_logs enable row level security;
alter table public.war_room_audit_logs enable row level security;
alter table public.war_room_runtime_integrity_logs enable row level security;
alter table public.war_room_sentinel_scans enable row level security;
alter table public.war_room_events enable row level security;
alter table public.war_room_worker_runs enable row level security;
alter table public.war_room_memory_proposals enable row level security;
alter table public.war_room_approved_memories enable row level security;
alter table public.war_room_deposits enable row level security;
alter table public.war_room_deposit_proofs enable row level security;
alter table public.war_room_deposit_notifications enable row level security;
alter table public.war_room_payment_guard_findings enable row level security;
alter table public.war_room_files enable row level security;
alter table public.build_requests enable row level security;
alter table public.income_opportunities enable row level security;

-- -----------------------------------------------------------------------------
-- war_room_actions: PostgREST + service_role DML (prevents REST 403 with valid JWT)
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on table public.war_room_actions to service_role;

drop policy if exists war_room_actions_service_role_all on public.war_room_actions;

create policy war_room_actions_service_role_all
  on public.war_room_actions
  for all
  to service_role
  using (true)
  with check (true);

-- -----------------------------------------------------------------------------
-- war_room_conversations + war_room_messages: PostgREST + service_role DML
-- (prevents REST 403 with valid service_role JWT; mirrors war_room_actions)
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on table public.war_room_conversations to service_role;
grant select, insert, update, delete on table public.war_room_messages to service_role;

drop policy if exists war_room_conversations_service_role_all on public.war_room_conversations;

create policy war_room_conversations_service_role_all
  on public.war_room_conversations
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists war_room_messages_service_role_all on public.war_room_messages;

create policy war_room_messages_service_role_all
  on public.war_room_messages
  for all
  to service_role
  using (true)
  with check (true);

-- -----------------------------------------------------------------------------
-- war_room_audit_logs: PostgREST + service_role DML (mirrors actions/conversations)
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on table public.war_room_audit_logs to service_role;

drop policy if exists war_room_audit_logs_service_role_all on public.war_room_audit_logs;

create policy war_room_audit_logs_service_role_all
  on public.war_room_audit_logs
  for all
  to service_role
  using (true)
  with check (true);

-- -----------------------------------------------------------------------------
-- war_room_runtime_integrity_logs: PostgREST + service_role DML
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on table public.war_room_runtime_integrity_logs to service_role;

drop policy if exists war_room_runtime_integrity_logs_service_role_all on public.war_room_runtime_integrity_logs;

create policy war_room_runtime_integrity_logs_service_role_all
  on public.war_room_runtime_integrity_logs
  for all
  to service_role
  using (true)
  with check (true);

-- -----------------------------------------------------------------------------
-- Functions & triggers — updated_at + conversation last_message_at
-- -----------------------------------------------------------------------------
create or replace function public.touch_war_room_conversations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_conversations_set_updated_at on public.war_room_conversations;
create trigger war_room_conversations_set_updated_at
  before update on public.war_room_conversations
  for each row
  execute procedure public.touch_war_room_conversations_updated_at();

create or replace function public.touch_war_room_actions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_actions_set_updated_at on public.war_room_actions;
create trigger war_room_actions_set_updated_at
  before update on public.war_room_actions
  for each row
  execute procedure public.touch_war_room_actions_updated_at();

create or replace function public.war_room_messages_touch_conversation()
returns trigger
language plpgsql
as $$
begin
  update public.war_room_conversations
  set
    last_message_at = new.created_at,
    updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists war_room_messages_touch_conversation on public.war_room_messages;
create trigger war_room_messages_touch_conversation
  after insert on public.war_room_messages
  for each row
  execute procedure public.war_room_messages_touch_conversation();

create or replace function public.set_war_room_permissions_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_permissions_state_set_updated_at on public.war_room_permissions_state;
create trigger war_room_permissions_state_set_updated_at
  before update on public.war_room_permissions_state
  for each row
  execute procedure public.set_war_room_permissions_state_updated_at();

create or replace function public.touch_war_room_memory_proposals_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_memory_proposals_set_updated_at on public.war_room_memory_proposals;
create trigger war_room_memory_proposals_set_updated_at
  before update on public.war_room_memory_proposals
  for each row
  execute procedure public.touch_war_room_memory_proposals_updated_at();

create or replace function public.touch_war_room_deposits_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_deposits_set_updated_at on public.war_room_deposits;
create trigger war_room_deposits_set_updated_at
  before update on public.war_room_deposits
  for each row
  execute procedure public.touch_war_room_deposits_updated_at();

create or replace function public.touch_build_requests_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists build_requests_set_updated_at on public.build_requests;
create trigger build_requests_set_updated_at
  before update on public.build_requests
  for each row
  execute procedure public.touch_build_requests_updated_at();
