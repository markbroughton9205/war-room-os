-- War Room — idempotent production patch: durable runtime KV store + audit 'runtime' category.
-- Applies the same DDL as war_room_runtime_state.sql and expands war_room_audit_logs CHECK.
-- Supabase dashboard / generic clients: paste and run once (no \\ir directives).

create table if not exists public.war_room_runtime_state (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  value jsonb not null default '{}'::jsonb,
  scope text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz null,
  constraint war_room_runtime_state_scope_key_unique unique (scope, key)
);

create index if not exists war_room_runtime_state_scope_idx
  on public.war_room_runtime_state (scope);

create index if not exists war_room_runtime_state_expires_idx
  on public.war_room_runtime_state (expires_at)
  where expires_at is not null;

create or replace function public.war_room_runtime_state_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists war_room_runtime_state_touch_updated_at on public.war_room_runtime_state;

create trigger war_room_runtime_state_touch_updated_at
  before update on public.war_room_runtime_state
  for each row
  execute procedure public.war_room_runtime_state_touch_updated_at();

alter table public.war_room_runtime_state enable row level security;

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on table public.war_room_runtime_state to service_role;

drop policy if exists war_room_runtime_state_service_role_all on public.war_room_runtime_state;

create policy war_room_runtime_state_service_role_all
  on public.war_room_runtime_state
  for all
  to service_role
  using (true)
  with check (true);

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
      'payment',
      'runtime'
    )
  );
