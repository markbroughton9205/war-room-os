-- =============================================================================
-- War Room — legacy gaps: public.memories + public.rael_action_queue
-- =============================================================================
-- Purpose: idempotent CREATE TABLE IF NOT EXISTS for tables referenced outside
-- war_room_production_init.sql (see comments there). RLS enabled with the same
-- service_role-only PostgREST pattern as other war_room permission fixes — no
-- broad anonymous write policies.
--
-- Inspect sources:
--   * memories — app/api/memory/route.ts, app/api/baby/chat/route.ts
--   * rael_action_queue — app/api/actions/route.ts, app/api/actions/[id]/route.ts,
--                         app/api/red-team-coder/diagnose/route.ts (fallback)
--
-- Safe to re-run: CREATE IF NOT EXISTS; DROP POLICY IF EXISTS + CREATE.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- memories (legacy loose store; newer flows use war_room_memory_* tables)
-- ---------------------------------------------------------------------------
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  category text,
  content text not null,
  source text,
  family text,
  tags text[] not null default '{}'::text[],
  importance int
);

create index if not exists memories_created_at_idx
  on public.memories (created_at desc);

alter table public.memories enable row level security;

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on table public.memories to service_role;

drop policy if exists memories_service_role_all on public.memories;

create policy memories_service_role_all
  on public.memories
  for all
  to service_role
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- rael_action_queue (legacy approval rows; primary queue is war_room_actions)
-- ---------------------------------------------------------------------------
create table if not exists public.rael_action_queue (
  action_id text primary key,
  related_opportunity_id text,
  title text not null,
  question text not null,
  response_options text[] not null default array['Approve', 'Decline']::text[],
  status text not null default 'pending',
  urgency text not null default 'medium',
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  source_agent text not null default 'War Room',
  answered_at timestamptz,
  answer text,
  constraint rael_action_queue_status_check check (
    status in ('pending', 'answered', 'expired')
  ),
  constraint rael_action_queue_urgency_check check (
    urgency in ('low', 'medium', 'high')
  )
);

create index if not exists rael_action_queue_status_created_idx
  on public.rael_action_queue (status, created_at desc);

alter table public.rael_action_queue enable row level security;

grant select, insert, update, delete on table public.rael_action_queue to service_role;

drop policy if exists rael_action_queue_service_role_all on public.rael_action_queue;

create policy rael_action_queue_service_role_all
  on public.rael_action_queue
  for all
  to service_role
  using (true)
  with check (true);
