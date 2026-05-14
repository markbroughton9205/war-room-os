-- War Room Phase 4: event bus persistence + worker run history + audit category `event`.
-- Apply after war_room_phase4_permissions.sql (or any migration that already allows `permissions` on audit).

-- ---------------------------------------------------------------------------
-- Event store
-- ---------------------------------------------------------------------------
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

alter table public.war_room_events enable row level security;

-- ---------------------------------------------------------------------------
-- Worker run log (one row per POST /api/workers/run completion)
-- ---------------------------------------------------------------------------
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

alter table public.war_room_worker_runs enable row level security;

-- ---------------------------------------------------------------------------
-- Audit: allow category `event`
-- ---------------------------------------------------------------------------
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
      'event'
    )
  );
