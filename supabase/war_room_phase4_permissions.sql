-- War Room Phase 4: standing permissions state + audit category `permissions`.
-- Apply after war_room_phase3b.sql. API routes use SUPABASE_SERVICE_ROLE_KEY (RLS on, no anon policies).

-- ---------------------------------------------------------------------------
-- Single-row standing permissions + last auto-run metadata
-- ---------------------------------------------------------------------------
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

alter table public.war_room_permissions_state enable row level security;

-- ---------------------------------------------------------------------------
-- Audit logs: allow category `permissions`
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
      'permissions'
    )
  );
