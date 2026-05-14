-- War Room Phase 3B: unified audit trail, sentinel scan history (additive; does not alter phase3 tables).
-- Apply after war_room_phase3.sql. Service role bypasses RLS (same pattern as phase 3).
--
-- Audit vs internet_logs: war_room_internet_logs remains the canonical per-query/provider row
-- (query text, status_code, duration). Each insert there also mirrors a summary row into
-- war_room_audit_logs (category internet) so GET /api/audit/logs can show cross-cutting
-- events without merging tables at read time.

-- ---------------------------------------------------------------------------
-- Unified audit log (action | engine | internet | repo | sentinel)
-- ---------------------------------------------------------------------------
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
    category in ('action', 'engine', 'internet', 'repo', 'sentinel')
  )
);

create index if not exists war_room_audit_logs_created_idx
  on public.war_room_audit_logs (created_at desc);

create index if not exists war_room_audit_logs_category_created_idx
  on public.war_room_audit_logs (category, created_at desc);

create index if not exists war_room_audit_logs_action_idx
  on public.war_room_audit_logs (action_id)
  where action_id is not null;

-- ---------------------------------------------------------------------------
-- Red Sentinel scan snapshots (optional persistence for status/history)
-- ---------------------------------------------------------------------------
create table if not exists public.war_room_sentinel_scans (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  findings_count int not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists war_room_sentinel_scans_created_idx
  on public.war_room_sentinel_scans (created_at desc);

-- ---------------------------------------------------------------------------
-- RLS (enabled; no anon policies — API uses service role)
-- ---------------------------------------------------------------------------
alter table public.war_room_audit_logs enable row level security;
alter table public.war_room_sentinel_scans enable row level security;
