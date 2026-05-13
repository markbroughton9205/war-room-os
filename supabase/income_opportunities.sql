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

alter table public.income_opportunities enable row level security;

-- The War Room app uses SUPABASE_SERVICE_ROLE_KEY from server-only API routes.
-- No anon policies are required for the frontend because the browser calls
-- /api/income/opportunities instead of calling Supabase directly.
