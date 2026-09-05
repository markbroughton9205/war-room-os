-- War Room Phase 57A: WR-Engineer Phase 2 development schema artifact — nodes, node repositories,
-- pairing tokens, engineering sessions/messages, and node/tool events.
--
-- NOT APPLIED IN PHASE 2. Phase 2's actual runtime state lives in JSON files under
-- .war-room/wr-engineer/{node,session}/ (lib/wr-engineer/node/store.ts, lib/wr-engineer/session/store.ts)
-- — the same dev-backend convention lib/native-builder/storage.ts and workspaceRegistry.ts already
-- use. This file exists so the production persistence shape is designed and reviewable now, and so
-- a future phase's move to Supabase is a backend swap behind the existing NodeStore/SessionStore
-- interfaces, never a redesign. Apply only when explicitly authorized.
--
-- Only sha256 hashes of pairing codes and node device credentials are ever stored — see
-- lib/wr-engineer/node/pairing.ts and lib/wr-engineer/node/identity.ts for why plaintext never
-- reaches persistence at all, dev or production.

grant usage on schema public to service_role;

create table if not exists public.war_room_wr_engineer_nodes (
  node_id text primary key,
  node_name text not null,
  platform text not null check (platform in ('windows', 'macos', 'linux')),
  architecture text not null,
  hostname text not null,
  os_version text not null,
  agent_version text not null,
  capabilities jsonb not null default '[]'::jsonb,
  credential_id text not null,
  credential_hash text not null,
  credential_issued_at timestamptz not null,
  last_seen_at timestamptz,
  paired_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists war_room_wr_engineer_nodes_status_idx on public.war_room_wr_engineer_nodes (last_seen_at desc);

create table if not exists public.war_room_wr_engineer_node_repositories (
  repository_id text primary key,
  node_id text not null references public.war_room_wr_engineer_nodes(node_id) on delete cascade,
  name text not null,
  path text not null,
  default_branch text not null default 'main',
  current_branch text,
  head_sha text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (node_id, path)
);
create index if not exists war_room_wr_engineer_node_repositories_node_idx on public.war_room_wr_engineer_node_repositories (node_id);

create table if not exists public.war_room_wr_engineer_pairing_tokens (
  token_id text primary key,
  code_hash text not null unique,
  state text not null check (state in ('WAITING', 'PAIRING', 'AUTHORIZED', 'EXPIRED', 'REJECTED')),
  candidate jsonb,
  authorized_node_id text references public.war_room_wr_engineer_nodes(node_id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index if not exists war_room_wr_engineer_pairing_tokens_state_idx on public.war_room_wr_engineer_pairing_tokens (state, expires_at);

create table if not exists public.war_room_wr_engineer_sessions (
  session_id text primary key,
  commander_user_id uuid not null references auth.users(id) on delete cascade,
  node_id text not null references public.war_room_wr_engineer_nodes(node_id) on delete restrict,
  repository_id text not null references public.war_room_wr_engineer_node_repositories(repository_id) on delete restrict,
  repository_path text not null,
  branch text,
  head_sha text,
  mission jsonb,
  constraints jsonb not null default '[]'::jsonb,
  agent_state text not null check (agent_state in ('READY', 'WORKING', 'BLOCKED', 'VALIDATING', 'COMPLETE', 'FAILED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists war_room_wr_engineer_sessions_commander_idx on public.war_room_wr_engineer_sessions (commander_user_id, created_at desc);

create table if not exists public.war_room_wr_engineer_messages (
  message_id text primary key,
  session_id text not null references public.war_room_wr_engineer_sessions(session_id) on delete cascade,
  role text not null check (role in ('commander', 'wr_engineer', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists war_room_wr_engineer_messages_session_idx on public.war_room_wr_engineer_messages (session_id, created_at);

create table if not exists public.war_room_wr_engineer_node_events (
  event_id text primary key,
  session_id text references public.war_room_wr_engineer_sessions(session_id) on delete cascade,
  node_id text references public.war_room_wr_engineer_nodes(node_id) on delete cascade,
  tool text not null,
  detail text not null,
  outcome text not null check (outcome in ('PASS', 'FAIL')),
  occurred_at timestamptz not null default now()
);
create index if not exists war_room_wr_engineer_node_events_session_idx on public.war_room_wr_engineer_node_events (session_id, occurred_at);

alter table public.war_room_wr_engineer_nodes enable row level security;
alter table public.war_room_wr_engineer_node_repositories enable row level security;
alter table public.war_room_wr_engineer_pairing_tokens enable row level security;
alter table public.war_room_wr_engineer_sessions enable row level security;
alter table public.war_room_wr_engineer_messages enable row level security;
alter table public.war_room_wr_engineer_node_events enable row level security;

drop policy if exists war_room_wr_engineer_nodes_service_role_all on public.war_room_wr_engineer_nodes;
create policy war_room_wr_engineer_nodes_service_role_all on public.war_room_wr_engineer_nodes for all to service_role using (true) with check (true);

drop policy if exists war_room_wr_engineer_node_repositories_service_role_all on public.war_room_wr_engineer_node_repositories;
create policy war_room_wr_engineer_node_repositories_service_role_all on public.war_room_wr_engineer_node_repositories for all to service_role using (true) with check (true);

drop policy if exists war_room_wr_engineer_pairing_tokens_service_role_all on public.war_room_wr_engineer_pairing_tokens;
create policy war_room_wr_engineer_pairing_tokens_service_role_all on public.war_room_wr_engineer_pairing_tokens for all to service_role using (true) with check (true);

drop policy if exists war_room_wr_engineer_sessions_service_role_all on public.war_room_wr_engineer_sessions;
create policy war_room_wr_engineer_sessions_service_role_all on public.war_room_wr_engineer_sessions for all to service_role using (true) with check (true);
drop policy if exists war_room_wr_engineer_sessions_commander_all on public.war_room_wr_engineer_sessions;
create policy war_room_wr_engineer_sessions_commander_all on public.war_room_wr_engineer_sessions for all to authenticated using (commander_user_id = auth.uid()) with check (commander_user_id = auth.uid());

drop policy if exists war_room_wr_engineer_messages_service_role_all on public.war_room_wr_engineer_messages;
create policy war_room_wr_engineer_messages_service_role_all on public.war_room_wr_engineer_messages for all to service_role using (true) with check (true);

drop policy if exists war_room_wr_engineer_node_events_service_role_all on public.war_room_wr_engineer_node_events;
create policy war_room_wr_engineer_node_events_service_role_all on public.war_room_wr_engineer_node_events for all to service_role using (true) with check (true);

grant select, insert, update, delete on table public.war_room_wr_engineer_nodes to service_role;
grant select, insert, update, delete on table public.war_room_wr_engineer_node_repositories to service_role;
grant select, insert, update, delete on table public.war_room_wr_engineer_pairing_tokens to service_role;
grant select, insert, update, delete on table public.war_room_wr_engineer_sessions to service_role;
grant select, insert, update, delete on table public.war_room_wr_engineer_messages to service_role;
grant select, insert, update, delete on table public.war_room_wr_engineer_node_events to service_role;

select pg_notify('pgrst', 'reload schema');
