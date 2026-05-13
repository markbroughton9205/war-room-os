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

alter table public.build_requests enable row level security;

-- War Room API routes use SUPABASE_SERVICE_ROLE_KEY (server-only).
-- Service role bypasses RLS; no anon policies are required.

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
