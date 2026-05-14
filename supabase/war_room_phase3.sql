-- War Room Phase 3: persistent threads, action queue lifecycle, internet audit logs.
-- Apply manually in Supabase SQL editor (same pattern as build_requests.sql).
-- API routes use SUPABASE_SERVICE_ROLE_KEY; RLS enabled with no anon policies (service role bypasses RLS).

-- ---------------------------------------------------------------------------
-- Conversations & messages
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Action queue (distinct from public.rael_action_queue)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Internet layer audit (no API keys; redact secrets in application layer)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.war_room_conversations enable row level security;
alter table public.war_room_messages enable row level security;
alter table public.war_room_actions enable row level security;
alter table public.war_room_action_logs enable row level security;
alter table public.war_room_internet_logs enable row level security;

-- War Room API routes use SUPABASE_SERVICE_ROLE_KEY (server-only).
-- Service role bypasses RLS; no anon policies are required.

-- ---------------------------------------------------------------------------
-- Triggers: timestamps + last_message_at
-- ---------------------------------------------------------------------------
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
